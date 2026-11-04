-- 해도 2026-11-04 AI 제안 월 상한 설치 (Supabase SQL Editor에서 한 번에 실행)
-- 생성: node scripts/build-ai-usage-install.mjs — 직접 고치지 말고 원본 마이그레이션을 고친 뒤 다시 생성한다.
-- 포함 마이그레이션(원본 sha256):
--   20261104090000_life_ai_usage.sql  0af63ce4d0b9133ed4e17d75c1961c07ba64410bddd224cddffb5a3384bfc6c9
--
-- 안전 장치:
--   * 설치 전체가 DO 블록 "한 문장"이다. 어느 단계에서 실패하면 전체가 되돌려져 아무것도 바뀌지 않는다.
--   * 설치 전후로 public·haedo_* 스키마의 모든 테이블과 storage.objects의 행 수를 비교하고,
--     하나라도 달라지면 예외를 내서 전체를 되돌린다(설치 중 새로 만든 테이블은 비교에서 제외).
--   * 새 스키마 haedo_ai_private와 새 함수만 만든다. 기존 테이블·함수·행은 읽거나 바꾸지 않는다.
--   * 다시 실행해도 된다(if not exists / create or replace / drop policy if exists).
--   * 사용자 데이터 삭제·권한 완화가 없다. anon에는 어떤 실행 권한도 주지 않는다.
-- 실행 후 맨 아래 결과 표에서 모든 ok 값이 true인지 확인한다.

do $haedo_install$
declare
  r record;
  n bigint;
  before jsonb := '{}'::jsonb;
begin
  for r in
    select format('%I.%I', ns.nspname, c.relname) as relation
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where c.relkind = 'r' and (ns.nspname = 'public' or ns.nspname like 'haedo\_%' or (ns.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format('select count(*) from %s', r.relation) into n;
    before := before || jsonb_build_object(r.relation, n);
  end loop;

  -- ===== 20261104090000_life_ai_usage.sql =====
  execute $haedo_ai_m1$
-- Server-enforced monthly cap for the haedo-ai Edge function (writing-ai-review §8, approved 2026-11-04).
-- Before a provider call the function reserves the request's worst-case cost; afterwards it
-- settles the real usage (or returns the reservation when the provider refused the request).
-- Only service_role (the Edge function) reserves, settles or releases. The owner may read their
-- own totals. Counts, costs, request IDs and times only: no selection, guidance, prompt or
-- response text is stored. No existing table, function or row is read or changed.
create schema if not exists haedo_ai_private;
revoke all on schema haedo_ai_private from public,anon,authenticated,service_role;
grant usage on schema haedo_ai_private to authenticated,service_role;

-- month is the first day of a UTC calendar month (KST 1st 09:00 resets).
create table if not exists haedo_ai_private.usage (
 owner_id uuid not null references auth.users(id) on delete cascade,
 month date not null check (month = date_trunc('month',month)::date),
 input_tokens bigint not null default 0 check (input_tokens >= 0),
 output_tokens bigint not null default 0 check (output_tokens >= 0),
 cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),
 reserved_micro_usd bigint not null default 0 check (reserved_micro_usd >= 0),
 requests integer not null default 0 check (requests >= 0),
 updated_at timestamptz not null default clock_timestamp(),
 primary key (owner_id, month)
);
create table if not exists haedo_ai_private.reservations (
 owner_id uuid not null,
 request_id uuid not null,
 month date not null,
 model text not null check (model in ('claude-haiku-5-5','claude-sonnet-5-5')),
 reserved_micro_usd bigint not null check (reserved_micro_usd > 0),
 status text not null default 'reserved' check (status in ('reserved','settled','released','expired')),
 cost_micro_usd bigint check (cost_micro_usd >= 0),
 created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 primary key (owner_id, request_id),
 foreign key (owner_id, month) references haedo_ai_private.usage(owner_id, month) on delete cascade,
 check ((status = 'reserved') = (finished_at is null)),
 check ((status in ('settled','expired')) = (cost_micro_usd is not null))
);
create index if not exists life_ai_open_reservations on haedo_ai_private.reservations(owner_id, created_at) where status = 'reserved';
alter table haedo_ai_private.usage enable row level security;
alter table haedo_ai_private.reservations enable row level security;
revoke all on haedo_ai_private.usage, haedo_ai_private.reservations from public,anon,authenticated,service_role;
grant select on haedo_ai_private.usage to authenticated;
drop policy if exists life_ai_usage_owner_select on haedo_ai_private.usage;
create policy life_ai_usage_owner_select on haedo_ai_private.usage for select to authenticated using (owner_id = (select auth.uid()));

-- Monthly cap: $10 = 10,000,000 micro-USD. Changing it needs an owner decision and a new migration.
create or replace function haedo_ai_private.monthly_limit_micro_usd()
returns bigint language sql immutable set search_path=pg_catalog as $$ select 10000000::bigint $$;

-- Prices in micro-USD per million tokens, official Claude API pricing checked 2026-11-04
-- (https://platform.claude.com/docs/en/about-claude/pricing):
--   claude-haiku-5-5   input $0.10  output $0.50  per MTok (prompts of 100K tokens or fewer;
--                      haedo-ai sends at most 64 KiB, far below that)
--   claude-sonnet-5-5  input $2     output $10    per MTok
-- Cost is rounded up to a whole micro-USD. Any other model has no price and is rejected.
create or replace function haedo_ai_private.cost_micro_usd(p_model text, p_input_tokens bigint, p_output_tokens bigint)
returns bigint language sql immutable set search_path=pg_catalog as $$
 select case p_model
  when 'claude-haiku-5-5' then ceil((p_input_tokens::numeric * 100000 + p_output_tokens::numeric * 500000) / 1000000)::bigint
  when 'claude-sonnet-5-5' then ceil((p_input_tokens::numeric * 2000000 + p_output_tokens::numeric * 10000000) / 1000000)::bigint
 end $$;

-- Open reservations older than 10 minutes belong to a call that never settled (the Edge
-- function stops long before). They are charged at their reserved maximum, because the
-- provider may have billed the call. Caller holds the owner lock.
create or replace function haedo_ai_private.expire_stale(p_owner_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare r record;
begin
 for r in select request_id, month, reserved_micro_usd from haedo_ai_private.reservations
  where owner_id=p_owner_id and status='reserved' and created_at < clock_timestamp() - interval '10 minutes' order by created_at for update loop
  update haedo_ai_private.reservations set status='expired', cost_micro_usd=r.reserved_micro_usd, finished_at=clock_timestamp()
   where owner_id=p_owner_id and request_id=r.request_id;
  update haedo_ai_private.usage set reserved_micro_usd=reserved_micro_usd-r.reserved_micro_usd,
   cost_micro_usd=cost_micro_usd+r.reserved_micro_usd, requests=requests+1, updated_at=clock_timestamp()
   where owner_id=p_owner_id and month=r.month;
 end loop;
end $$;

-- Reserve before calling the provider. One owner's reserve/settle/release run one at a time
-- (transaction advisory lock), so concurrent requests can never pass the cap together.
create or replace function haedo_ai_private.reserve(p_owner_id uuid, p_request_id uuid, p_model text, p_max_input_tokens integer, p_max_output_tokens integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_month date := date_trunc('month', clock_timestamp() at time zone 'UTC')::date;
 v_limit bigint := haedo_ai_private.monthly_limit_micro_usd(); v_cost bigint; v_used bigint; v_open integer;
begin
 if p_owner_id is null or p_request_id is null or p_model is null or p_model not in ('claude-haiku-5-5','claude-sonnet-5-5')
  or p_max_input_tokens is null or p_max_input_tokens not between 1 and 100000
  or p_max_output_tokens is null or p_max_output_tokens not between 1 and 16000 then
  raise exception using errcode='22023', message='life_ai_invalid_request'; end if;
 if not exists (select 1 from auth.users where id=p_owner_id) then raise exception using errcode='22023', message='life_ai_unknown_owner'; end if;
 perform pg_advisory_xact_lock(hashtextextended('haedo_ai_usage:' || p_owner_id::text, 0));
 perform haedo_ai_private.expire_stale(p_owner_id);
 if exists (select 1 from haedo_ai_private.reservations where owner_id=p_owner_id and request_id=p_request_id) then
  return jsonb_build_object('status','duplicate'); end if;
 select count(*) into v_open from haedo_ai_private.reservations where owner_id=p_owner_id and status='reserved';
 if v_open >= 4 then return jsonb_build_object('status','busy'); end if;
 v_cost := haedo_ai_private.cost_micro_usd(p_model, p_max_input_tokens, p_max_output_tokens);
 insert into haedo_ai_private.usage(owner_id, month) values (p_owner_id, v_month) on conflict (owner_id, month) do nothing;
 select cost_micro_usd + reserved_micro_usd into v_used from haedo_ai_private.usage where owner_id=p_owner_id and month=v_month for update;
 if v_used + v_cost > v_limit then
  return jsonb_build_object('status','limit','month',v_month,'used_micro_usd',v_used,'limit_micro_usd',v_limit); end if;
 insert into haedo_ai_private.reservations(owner_id, request_id, month, model, reserved_micro_usd)
  values (p_owner_id, p_request_id, v_month, p_model, v_cost);
 update haedo_ai_private.usage set reserved_micro_usd=reserved_micro_usd+v_cost, updated_at=clock_timestamp()
  where owner_id=p_owner_id and month=v_month;
 return jsonb_build_object('status','reserved','month',v_month,'reserved_micro_usd',v_cost,'remaining_micro_usd',v_limit-v_used-v_cost);
end $$;

-- Settle with the provider's reported usage. The real cost replaces the reservation. A request
-- that already finished or expired changes nothing.
create or replace function haedo_ai_private.settle(p_owner_id uuid, p_request_id uuid, p_input_tokens bigint, p_output_tokens bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r haedo_ai_private.reservations%rowtype; v_cost bigint; u haedo_ai_private.usage%rowtype; v_limit bigint := haedo_ai_private.monthly_limit_micro_usd();
begin
 if p_owner_id is null or p_request_id is null or p_input_tokens is null or p_input_tokens not between 0 and 10000000
  or p_output_tokens is null or p_output_tokens not between 0 and 10000000 then
  raise exception using errcode='22023', message='life_ai_invalid_request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('haedo_ai_usage:' || p_owner_id::text, 0));
 select * into r from haedo_ai_private.reservations where owner_id=p_owner_id and request_id=p_request_id for update;
 if not found then raise exception using errcode='22023', message='life_ai_unknown_request'; end if;
 if r.status <> 'reserved' then return jsonb_build_object('status','already_finished','state',r.status); end if;
 v_cost := haedo_ai_private.cost_micro_usd(r.model, p_input_tokens, p_output_tokens);
 update haedo_ai_private.usage set reserved_micro_usd=reserved_micro_usd-r.reserved_micro_usd, cost_micro_usd=cost_micro_usd+v_cost,
  input_tokens=input_tokens+p_input_tokens, output_tokens=output_tokens+p_output_tokens, requests=requests+1, updated_at=clock_timestamp()
  where owner_id=p_owner_id and month=r.month returning * into u;
 update haedo_ai_private.reservations set status='settled', cost_micro_usd=v_cost, finished_at=clock_timestamp()
  where owner_id=p_owner_id and request_id=p_request_id;
 return jsonb_build_object('status','settled','month',r.month,'cost_micro_usd',v_cost,'month_cost_micro_usd',u.cost_micro_usd,
  'remaining_micro_usd',greatest(0, v_limit-u.cost_micro_usd-u.reserved_micro_usd));
end $$;

-- Return a reservation whose provider call was refused before any work (not billed).
create or replace function haedo_ai_private.release(p_owner_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r haedo_ai_private.reservations%rowtype;
begin
 if p_owner_id is null or p_request_id is null then raise exception using errcode='22023', message='life_ai_invalid_request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('haedo_ai_usage:' || p_owner_id::text, 0));
 select * into r from haedo_ai_private.reservations where owner_id=p_owner_id and request_id=p_request_id for update;
 if not found then raise exception using errcode='22023', message='life_ai_unknown_request'; end if;
 if r.status <> 'reserved' then return jsonb_build_object('status','already_finished','state',r.status); end if;
 update haedo_ai_private.usage set reserved_micro_usd=reserved_micro_usd-r.reserved_micro_usd, updated_at=clock_timestamp()
  where owner_id=p_owner_id and month=r.month;
 update haedo_ai_private.reservations set status='released', finished_at=clock_timestamp()
  where owner_id=p_owner_id and request_id=p_request_id;
 return jsonb_build_object('status','released');
end $$;

-- The signed-in owner's own current-month totals (RLS: own row only).
create or replace function public.life_ai_usage()
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('month', m.month, 'limit_micro_usd', haedo_ai_private.monthly_limit_micro_usd(),
  'cost_micro_usd', coalesce(u.cost_micro_usd,0), 'reserved_micro_usd', coalesce(u.reserved_micro_usd,0),
  'requests', coalesce(u.requests,0), 'input_tokens', coalesce(u.input_tokens,0), 'output_tokens', coalesce(u.output_tokens,0))
 from (select date_trunc('month', clock_timestamp() at time zone 'UTC')::date as month) m
 left join haedo_ai_private.usage u on u.month=m.month and u.owner_id=(select auth.uid())
$$;
create or replace function public.life_ai_reserve(p_owner_id uuid, p_request_id uuid, p_model text, p_max_input_tokens integer, p_max_output_tokens integer)
returns jsonb language sql security invoker set search_path=pg_catalog as $$ select haedo_ai_private.reserve(p_owner_id,p_request_id,p_model,p_max_input_tokens,p_max_output_tokens) $$;
create or replace function public.life_ai_settle(p_owner_id uuid, p_request_id uuid, p_input_tokens bigint, p_output_tokens bigint)
returns jsonb language sql security invoker set search_path=pg_catalog as $$ select haedo_ai_private.settle(p_owner_id,p_request_id,p_input_tokens,p_output_tokens) $$;
create or replace function public.life_ai_release(p_owner_id uuid, p_request_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$ select haedo_ai_private.release(p_owner_id,p_request_id) $$;

revoke all on all functions in schema haedo_ai_private from public,anon,authenticated,service_role;
grant execute on function haedo_ai_private.monthly_limit_micro_usd() to authenticated,service_role;
grant execute on function haedo_ai_private.reserve(uuid,uuid,text,integer,integer), haedo_ai_private.settle(uuid,uuid,bigint,bigint),
 haedo_ai_private.release(uuid,uuid) to service_role;
revoke all on function public.life_ai_usage(), public.life_ai_reserve(uuid,uuid,text,integer,integer),
 public.life_ai_settle(uuid,uuid,bigint,bigint), public.life_ai_release(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.life_ai_usage() to authenticated;
grant execute on function public.life_ai_reserve(uuid,uuid,text,integer,integer), public.life_ai_settle(uuid,uuid,bigint,bigint),
 public.life_ai_release(uuid,uuid) to service_role;
notify pgrst,'reload schema';
$haedo_ai_m1$;

  for r in select key as relation, value::bigint as rows from jsonb_each_text(before) loop
    execute format('select count(*) from %s', r.relation) into n;
    if n <> r.rows then
      raise exception 'Row count changed in % (% -> %); installation rolled back', r.relation, r.rows, n;
    end if;
  end loop;

  if to_regclass('haedo_ai_private.usage') is null or to_regclass('haedo_ai_private.reservations') is null then raise exception 'AI usage tables missing'; end if;
  if not (select relrowsecurity from pg_class where oid = 'haedo_ai_private.usage'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'haedo_ai_private.reservations'::regclass) then raise exception 'RLS disabled on an AI usage table'; end if;
  if (select count(distinct proname) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('life_ai_usage','life_ai_reserve','life_ai_settle','life_ai_release')) <> 4 then
    raise exception 'an AI usage RPC is missing';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'haedo_ai_private'::regnamespace)
             and (p.proname in ('life_ai_usage','life_ai_reserve','life_ai_settle','life_ai_release') or p.pronamespace = 'haedo_ai_private'::regnamespace)
             and has_function_privilege('anon', p.oid, 'execute')) then
    raise exception 'anon can execute an AI usage function';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('life_ai_reserve','life_ai_settle','life_ai_release')
             and has_function_privilege('authenticated', p.oid, 'execute')) then
    raise exception 'a signed-in user can write AI usage directly';
  end if;
  if haedo_ai_private.monthly_limit_micro_usd() <> 10000000 then raise exception 'unexpected monthly AI cap'; end if;
  raise notice 'haedo AI usage cap installed; % existing tables unchanged', (select count(*) from jsonb_object_keys(before));
end
$haedo_install$;

-- 결과 확인용(읽기 전용)
select 'AI usage tables + RLS' as check_name,
       coalesce((select relrowsecurity from pg_class where oid = to_regclass('haedo_ai_private.usage')), false)
       and coalesce((select relrowsecurity from pg_class where oid = to_regclass('haedo_ai_private.reservations')), false) as ok
union all
select 'AI usage RPCs present', (select count(distinct proname) = 4 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('life_ai_usage','life_ai_reserve','life_ai_settle','life_ai_release'))
union all
select 'anon cannot execute AI usage functions', not exists (select 1 from pg_proc p
  where (p.pronamespace = 'public'::regnamespace and p.proname in ('life_ai_usage','life_ai_reserve','life_ai_settle','life_ai_release') or p.pronamespace = 'haedo_ai_private'::regnamespace)
  and has_function_privilege('anon', p.oid, 'execute'))
union all
select 'only service_role writes AI usage', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('life_ai_reserve','life_ai_settle','life_ai_release')
  and (has_function_privilege('authenticated', p.oid, 'execute') or not has_function_privilege('service_role', p.oid, 'execute')))
union all
select 'monthly cap is $10', haedo_ai_private.monthly_limit_micro_usd() = 10000000;
