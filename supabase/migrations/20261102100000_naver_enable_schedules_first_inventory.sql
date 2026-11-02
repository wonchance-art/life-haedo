-- Turning a Naver connection on schedules its first inventory check in the same transaction.
-- The service claim only selects connections that already have an inventory row, and that
-- row was created solely by the owner-only inventory_start button. Same signature, checks,
-- lock, CAS and response; the only addition is an insert that never overwrites an existing
-- row (baseline, scan and page stay exact). The backfill only adds missing rows for
-- connections that are already enabled. Claim/finish/observed baseline/capture are unchanged.
-- Row guard: counts and the prior inventory hash are recorded before the backfill; afterwards
-- inventory must be exactly +N (N = enabled connections without a row), every other Naver
-- table count and every prior inventory row must be unchanged, or the whole install rolls back.
begin;
create or replace function haedo_naver_private.save(p_workspace_id uuid,p_blog_id text,p_expected_revision bigint,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); sub public.life_naver_subscriptions%rowtype; ready boolean; blog text:=btrim(p_blog_id);
begin
 if who is null then raise exception using errcode='42501',message='life_naver_auth_required'; end if;
 if p_workspace_id is null or blog is null or blog !~ '^[A-Za-z0-9_-]{1,50}$' or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 or p_enabled is null then
  raise exception using errcode='22023',message='life_naver_invalid_request'; end if;
 select r.ready into ready from haedo_naver_private.runtime r where singleton;
 if p_enabled and not coalesce(ready,false) then raise exception using errcode='22023',message='life_naver_setup_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(who::text||':'||p_workspace_id::text,0));
 select * into sub from public.life_naver_subscriptions where owner_id=who and workspace_id=p_workspace_id and blog_id=blog for update;
 if not found then
  if p_expected_revision<>0 then raise exception using errcode='PT409',message='life_naver_conflict'; end if;
  if (select count(*) from public.life_naver_subscriptions where owner_id=who and workspace_id=p_workspace_id)>=20 then raise exception using errcode='22023',message='life_naver_subscription_limit'; end if;
  insert into public.life_naver_subscriptions(owner_id,workspace_id,blog_id,enabled) values(who,p_workspace_id,blog,p_enabled) returning * into sub;
 else
  if sub.revision<>p_expected_revision then raise exception using errcode='PT409',message='life_naver_conflict'; end if;
  update public.life_naver_subscriptions set enabled=p_enabled,revision=revision+1,lease_token=null,lease_until=null,next_check_at=clock_timestamp()
   where id=sub.id returning * into sub;
 end if;
 if sub.enabled then
  insert into haedo_naver_private.inventory(subscription_id,owner_id) values(sub.id,sub.owner_id) on conflict (subscription_id) do nothing;
 end if;
 return (to_jsonb(sub)-'lease_token'-'lease_until'-'owner_id')||jsonb_build_object('ready',coalesce(ready,false));
end $$;

create temp table naver_enable_guard on commit drop as select
 (select count(*) from public.life_naver_subscriptions s where s.enabled and not exists(select 1 from haedo_naver_private.inventory i where i.subscription_id=s.id)) missing,
 (select count(*) from haedo_naver_private.inventory) inventory_rows,
 (select count(*) from haedo_naver_private.inventory_entries) entry_rows,
 (select count(*) from haedo_naver_private.inventory_seen) seen_rows,
 (select count(*) from haedo_naver_private.capture_jobs) job_rows,
 (select count(*) from haedo_naver_private.capture_receipts) receipt_rows,
 (select count(*) from haedo_naver_private.inventory_scan_observations) observation_rows,
 (select count(*) from haedo_naver_private.inventory_observation_receipts) observation_receipt_rows,
 (select count(*) from public.life_naver_subscriptions) subscription_rows,
 (select count(*) from public.life_naver_captures) capture_rows,
 (select encode(sha256(convert_to(coalesce(string_agg(to_jsonb(i)::text,',' order by i.subscription_id),''),'UTF8')),'hex') from haedo_naver_private.inventory i) inventory_hash;
create temp table naver_enable_prior on commit drop as select subscription_id from haedo_naver_private.inventory;

insert into haedo_naver_private.inventory(subscription_id,owner_id)
 select s.id,s.owner_id from public.life_naver_subscriptions s where s.enabled
 on conflict (subscription_id) do nothing;

do $$
declare g record;
begin
 select * into g from pg_temp.naver_enable_guard;
 if (select count(*) from haedo_naver_private.inventory)<>g.inventory_rows+g.missing
  or exists(select 1 from public.life_naver_subscriptions s where s.enabled and not exists(select 1 from haedo_naver_private.inventory i where i.subscription_id=s.id))
  or (select count(*) from haedo_naver_private.inventory_entries)<>g.entry_rows
  or (select count(*) from haedo_naver_private.inventory_seen)<>g.seen_rows
  or (select count(*) from haedo_naver_private.capture_jobs)<>g.job_rows
  or (select count(*) from haedo_naver_private.capture_receipts)<>g.receipt_rows
  or (select count(*) from haedo_naver_private.inventory_scan_observations)<>g.observation_rows
  or (select count(*) from haedo_naver_private.inventory_observation_receipts)<>g.observation_receipt_rows
  or (select count(*) from public.life_naver_subscriptions)<>g.subscription_rows
  or (select count(*) from public.life_naver_captures)<>g.capture_rows
  or (select encode(sha256(convert_to(coalesce(string_agg(to_jsonb(i)::text,',' order by i.subscription_id),''),'UTF8')),'hex')
       from haedo_naver_private.inventory i join pg_temp.naver_enable_prior p on p.subscription_id=i.subscription_id) is distinct from g.inventory_hash
 then raise exception using errcode='P0001',message='life_naver_enable_guard_mismatch'; end if;
end $$;

notify pgrst,'reload schema';
commit;
