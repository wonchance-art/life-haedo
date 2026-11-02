-- Turning a Naver connection on schedules its first inventory check in the same transaction.
-- The service claim only selects connections that already have an inventory row, and that
-- row was created solely by the owner-only inventory_start button. Same signature, checks,
-- lock, CAS and response; the only addition is an insert that never overwrites an existing
-- row (baseline, scan and page stay exact). The backfill only adds missing rows for
-- connections that are already enabled. Claim/finish/observed baseline/capture are unchanged.
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

insert into haedo_naver_private.inventory(subscription_id,owner_id)
 select s.id,s.owner_id from public.life_naver_subscriptions s where s.enabled
 on conflict (subscription_id) do nothing;

notify pgrst,'reload schema';
commit;
