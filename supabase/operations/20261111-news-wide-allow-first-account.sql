-- 해도 2026-11-11 뉴스 넓게 찾기: 허용 계정 등록 (Supabase SQL Editor 또는 총괄의 운영 SQL 도구에서 한 번에 실행)
-- ADMIN OPERATIONS ONLY. 먼저 supabase/migrations/20261111130000_news_wide_feed.sql 을 적용한다.
--
-- 하는 일: 익명이 아닌 계정이 "정확히 1개"일 때만 그 계정을
--   haedo_news_wide_private.allowed_accounts 에 넣는다. 넓게 찾기는 이 표에 있는 계정만 쓸 수 있다.
--
-- 안전 장치:
--   * 전체가 DO 블록 "한 문장"이다. 어느 단계에서 실패하면 전체가 되돌려져 아무것도 바뀌지 않는다.
--   * 익명이 아닌 계정이 0개이거나 2개 이상이면 아무것도 넣지 않고 예외로 멈춘다.
--     그때는 어느 계정을 허용할지 소유자에게 묻는다(이 파일을 고쳐서 계정을 고르지 않는다).
--   * 실행 뒤 허용 계정이 정확히 1개이고 그 계정이 유일한 비익명 계정이 아니면 되돌린다
--     (표에 다른 계정이 이미 들어 있던 경우 포함).
--   * 실행 전후로 public·haedo_* 스키마의 모든 테이블(allowed_accounts 제외)과 auth.users 의 행 수를
--     비교하고 하나라도 달라지면 되돌린다.
--   * 다시 실행해도 된다. 이미 들어 있으면 아무것도 바뀌지 않는다.
--   * 계정 ID·이메일을 출력하지 않는다. 결과와 알림에는 개수만 나온다. 이 파일에 계정 ID를 적지 않는다.
--   * 사용자 데이터 삭제·권한 완화가 없다.
-- 실행 후 맨 아래 결과 표에서 모든 ok 값이 true 인지 확인한다.

do $haedo_news_wide_allow$
declare
  r record;
  n bigint;
  before jsonb := '{}'::jsonb;
  accounts bigint;
  listed_before bigint;
  listed_after bigint;
begin
  if to_regclass('haedo_news_wide_private.allowed_accounts') is null then
    raise exception 'haedo_news_wide_private.allowed_accounts does not exist: apply migration 20261111130000_news_wide_feed.sql first';
  end if;

  for r in
    select ns.nspname, c.relname
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where c.relkind = 'r' and (ns.nspname = 'public' or ns.nspname like 'haedo\_%' or (ns.nspname = 'auth' and c.relname = 'users'))
       and not (ns.nspname = 'haedo_news_wide_private' and c.relname = 'allowed_accounts')
     order by 1, 2
  loop
    execute format('select count(*) from %I.%I', r.nspname, r.relname) into n;
    before := before || jsonb_build_object(r.nspname || '.' || r.relname, n);
  end loop;

  lock table haedo_news_wide_private.allowed_accounts in share row exclusive mode;
  select count(*) into accounts from auth.users u where not coalesce(u.is_anonymous, false);
  select count(*) into listed_before from haedo_news_wide_private.allowed_accounts;
  if accounts <> 1 then
    raise exception 'Expected exactly one non-anonymous account, found %. Nothing was added. Ask the owner which account to allow.', accounts;
  end if;

  insert into haedo_news_wide_private.allowed_accounts(owner_id)
    select u.id from auth.users u where not coalesce(u.is_anonymous, false)
    on conflict (owner_id) do nothing;

  select count(*) into listed_after from haedo_news_wide_private.allowed_accounts;
  if listed_after <> 1 or not exists (
      select 1 from haedo_news_wide_private.allowed_accounts a join auth.users u on u.id = a.owner_id
       where not coalesce(u.is_anonymous, false)) then
    raise exception 'The allow list would hold % account(s) and must hold exactly the one non-anonymous account. Nothing was changed.', listed_after;
  end if;

  for r in
    select ns.nspname, c.relname
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where c.relkind = 'r' and before ? (ns.nspname || '.' || c.relname)
  loop
    execute format('select count(*) from %I.%I', r.nspname, r.relname) into n;
    if n <> (before ->> (r.nspname || '.' || r.relname))::bigint then
      raise exception 'Row count changed in %.% (before %, after %). Rolled back; run again.',
        r.nspname, r.relname, before ->> (r.nspname || '.' || r.relname), n;
    end if;
  end loop;

  raise notice 'news-wide allow list: % account(s) before, % after; % existing tables unchanged',
    listed_before, listed_after, (select count(*) from jsonb_object_keys(before));
end
$haedo_news_wide_allow$;

-- 결과 확인용(읽기 전용, 개수만)
select 'exactly one allowed account' as check_name,
       (select count(*) from haedo_news_wide_private.allowed_accounts) = 1 as ok,
       (select count(*) from haedo_news_wide_private.allowed_accounts) as n
union all
select 'it is the only non-anonymous account',
       (select count(*) from auth.users u where not coalesce(u.is_anonymous, false)) = 1
       and (select count(*) from haedo_news_wide_private.allowed_accounts a join auth.users u on u.id = a.owner_id where not coalesce(u.is_anonymous, false)) = 1,
       (select count(*) from auth.users u where not coalesce(u.is_anonymous, false))
union all
select 'no API role can read or write the allow list',
       not exists (select 1 from unnest(array['anon','authenticated','service_role']) role, unnest(array['select','insert','update','delete','truncate']) privilege
                    where has_table_privilege(role, 'haedo_news_wide_private.allowed_accounts', privilege)),
       (select count(*) from pg_policy where polrelid = 'haedo_news_wide_private.allowed_accounts'::regclass)
union all
select 'row level security is on',
       coalesce((select relrowsecurity from pg_class where oid = 'haedo_news_wide_private.allowed_accounts'::regclass), false),
       null;
