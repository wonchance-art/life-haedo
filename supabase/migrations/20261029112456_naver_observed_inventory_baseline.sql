-- Repeated, bounded public observations are a distinct baseline method.
-- No activation, existing-baseline rewrite, source/photo mutation, or old-job deletion.
-- Exact-count clients keep their signatures and receipts. New observed-set clients
-- defer automatic capture until a complete verified observation of that scan.
begin;
alter table haedo_naver_private.inventory add column if not exists baseline_method text
 check(baseline_method in ('count_exact','observed_set'));
alter table haedo_naver_private.inventory_entries add column if not exists observed_discovery_revision bigint
 check(observed_discovery_revision between 1 and 9007199254740991);

create table if not exists haedo_naver_private.inventory_scan_observations (
 subscription_id uuid not null,owner_id uuid not null,scan_id uuid not null,
 subscription_revision bigint not null check(subscription_revision between 1 and 9007199254740991),
 started_at timestamptz not null default clock_timestamp(),last_page integer not null default 0 check(last_page between 0 and 10000),
 source_total integer check(source_total between 0 and 300000),seen_count integer not null default 0 check(seen_count between 0 and 300000),
 head_log_nos jsonb not null default '[]' check(jsonb_typeof(head_log_nos)='array' and jsonb_array_length(head_log_nos)<=30),
 page_chain_hash text not null default '' check(page_chain_hash='' or page_chain_hash ~ '^[a-f0-9]{64}$'),
 valid boolean not null default true,verified boolean not null default false,
 set_hash text check(set_hash ~ '^[a-f0-9]{64}$'),completed_at timestamptz,
 primary key(subscription_id,scan_id),
 foreign key(owner_id,subscription_id) references public.life_naver_subscriptions(owner_id,id) on delete restrict,
 check(not verified or (valid and completed_at is not null and set_hash is not null))
);
create table if not exists haedo_naver_private.inventory_observation_receipts (
 subscription_id uuid not null references public.life_naver_subscriptions(id) on delete restrict,
 lease_token uuid not null,request_hash bytea not null check(octet_length(request_hash)=32),result jsonb not null,
 primary key(subscription_id,lease_token)
);
alter table haedo_naver_private.inventory_scan_observations enable row level security;
alter table haedo_naver_private.inventory_observation_receipts enable row level security;
revoke all on haedo_naver_private.inventory_scan_observations,haedo_naver_private.inventory_observation_receipts from public,anon,authenticated,service_role;

-- These two existing functions retain their signatures, owners and ACLs.
create or replace function haedo_naver_private.inventory_finish(p_subscription_id uuid,p_lease_token uuid,p_revision bigint,p_page integer,p_entries jsonb,p_total integer,p_next_page integer,p_error text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.life_naver_subscriptions%rowtype;i haedo_naver_private.inventory%rowtype;r haedo_naver_private.capture_receipts%rowtype;
 h bytea;e jsonb;seen integer;inserted integer;result jsonb;complete boolean;changed boolean;
begin
 if p_lease_token is null or p_revision is null or p_page is null or p_page not between 1 and 10000 or p_entries is null
  or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)>30 or octet_length(p_entries::text)>131072
  or (p_total is not null and p_total not between 0 and 300000) or (p_next_page is not null and p_next_page<>p_page+1)
  or (p_error is not null and (p_error!~'^[a-z_]{1,80}$' or jsonb_array_length(p_entries)<>0)) then raise exception using errcode='22023',message='life_naver_invalid_inventory';end if;
 h:=sha256(convert_to(jsonb_build_array(p_revision,p_page,p_entries,p_total,p_next_page,p_error)::text,'UTF8'));
 select * into s from public.life_naver_subscriptions where id=p_subscription_id for update;
 if not found then return jsonb_build_object('status','stale');end if;
 select * into i from haedo_naver_private.inventory where subscription_id=s.id for update;
 select * into r from haedo_naver_private.capture_receipts where kind='inventory' and id=s.id and lease_token=p_lease_token;
 if found then if r.request_hash<>h then raise exception using errcode='22023',message='life_naver_operation_mismatch';end if;return r.result;end if;
 perform 1 from haedo_naver_private.runtime where singleton and ready for share;
 if not found or i.subscription_id is null or i.revision<>p_revision or i.page<>p_page or i.lease_token is distinct from p_lease_token or i.lease_until<=clock_timestamp() or i.subscription_revision<>s.revision then return jsonb_build_object('status','stale');end if;
 if p_error is null then
  if (select count(distinct v->>'logNo') from jsonb_array_elements(p_entries) e(v))<>jsonb_array_length(p_entries) then raise exception using errcode='22023',message='life_naver_invalid_inventory';end if;
  changed:=i.total_start is not null and p_total is distinct from i.total_start;
  for e in select value from jsonb_array_elements(p_entries) loop
   if jsonb_typeof(e)<>'object' or (select count(*) from jsonb_object_keys(e))<>3 or not(e?&array['logNo','title','publishedAt'])
    or jsonb_typeof(e->'logNo')<>'string' or (e->>'logNo')!~'^[1-9][0-9]{0,29}$' or not coalesce(haedo_naver_private.text_ok(e->'title',500,true),false)
    or (e->'publishedAt'<>'null'::jsonb and (jsonb_typeof(e->'publishedAt')<>'string' or not isfinite((e->>'publishedAt')::timestamptz))) then raise exception using errcode='22023',message='life_naver_invalid_inventory';end if;
   insert into haedo_naver_private.inventory_entries(subscription_id,owner_id,log_no,title,published_at,baseline,auto_eligible,observed_discovery_revision) values(s.id,s.owner_id,e->>'logNo',e->>'title',e->>'publishedAt',i.baseline_completed_at is null,i.baseline_completed_at is not null and s.enabled and coalesce(i.baseline_method,'count_exact')<>'observed_set',
    case when i.baseline_completed_at is not null and s.enabled and i.baseline_method='observed_set' then s.revision else null end) on conflict do nothing;
   get diagnostics inserted=row_count;
   if i.baseline_completed_at is not null and s.enabled and coalesce(i.baseline_method,'count_exact')<>'observed_set' and not changed and exists(select 1 from haedo_naver_private.inventory_entries where subscription_id=s.id and log_no=e->>'logNo' and auto_eligible) then
    insert into haedo_naver_private.capture_jobs(owner_id,subscription_id,blog_id,log_no) values(s.owner_id,s.id,s.blog_id,e->>'logNo') on conflict do nothing;
   end if;
   insert into haedo_naver_private.inventory_seen(subscription_id,scan_id,log_no) values(s.id,i.scan_id,e->>'logNo') on conflict do nothing;
  end loop;
  select count(*) into seen from haedo_naver_private.inventory_seen where subscription_id=s.id and scan_id=i.scan_id;
  complete:=coalesce(i.baseline_method,'count_exact')<>'observed_set' and not changed and p_next_page is null and p_total is not null and seen=p_total;
  update haedo_naver_private.inventory set revision=revision+1,total_start=coalesce(total_start,p_total),page=coalesce(p_next_page,page),status=case when complete then 'complete' when changed or p_next_page is null then 'partial' else 'pending' end,
   last_error=case when changed then 'inventory_changed' when p_next_page is null and not complete then 'inventory_incomplete' else null end,
   baseline_completed_at=case when complete then coalesce(baseline_completed_at,clock_timestamp()) else baseline_completed_at end,
   baseline_scan_id=case when complete then coalesce(baseline_scan_id,scan_id) else baseline_scan_id end,
   baseline_count=case when complete then coalesce(baseline_count,seen) else baseline_count end,last_checked_at=clock_timestamp(),lease_token=null,lease_until=null,
   next_check_at=clock_timestamp()+case when complete then interval '1 hour' when changed or p_next_page is null then interval '15 minutes' else interval '0 seconds' end where subscription_id=s.id;
 else update haedo_naver_private.inventory set revision=revision+1,status='partial',last_error=p_error,last_checked_at=clock_timestamp(),lease_token=null,lease_until=null,next_check_at=clock_timestamp()+interval '15 minutes' where subscription_id=s.id;end if;
 result:=jsonb_build_object('status','stored','inventory',haedo_naver_private.inventory_view(s.id));
 insert into haedo_naver_private.capture_receipts values('inventory',s.id,p_lease_token,h,result);
 return result;
end $$;

create or replace function haedo_naver_private.observation_ids_ok(value jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select case when jsonb_typeof(value)='array' then jsonb_array_length(value)<=30 and
  not exists(select 1 from jsonb_array_elements(value) e(v) where jsonb_typeof(v)<>'string' or (v#>>'{}')!~'^[1-9][0-9]{0,29}$')
  and (select count(distinct v#>>'{}')=jsonb_array_length(value) from jsonb_array_elements(value) e(v))
 else false end
$$;

create or replace function haedo_naver_private.inventory_finish_observed(
 p_subscription_id uuid,p_lease_token uuid,p_revision bigint,p_page integer,p_entries jsonb,
 p_total integer,p_next_page integer,p_error text default null,p_probe jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 s public.life_naver_subscriptions%rowtype;i haedo_naver_private.inventory%rowtype;
 o haedo_naver_private.inventory_scan_observations%rowtype;
 receipt haedo_naver_private.inventory_observation_receipts%rowtype;
 h bytea;ids jsonb;result jsonb;stamp timestamptz:=clock_timestamp();expected integer;
 before_count integer;after_count integer;trusted_total integer:=p_total;set_digest text;
 terminal boolean:=p_next_page is null;scan_valid boolean:=true;probe_ok boolean:=false;
 mismatch boolean:=false;promoted boolean:=false;method text;
begin
 if p_subscription_id is null or p_lease_token is null or p_revision is null or p_revision<1 or p_revision>9007199254740991
  or p_page is null or p_page not between 1 and 10000 or p_entries is null or jsonb_typeof(p_entries)<>'array'
  or jsonb_array_length(p_entries)>30 or octet_length(p_entries::text)>131072
  or (p_total is not null and p_total not between 0 and 300000)
  or (p_next_page is not null and p_next_page<>p_page+1)
  or (p_error is not null and (p_error!~'^[a-z_]{1,80}$' or jsonb_array_length(p_entries)<>0))
  or (p_probe is not null and octet_length(p_probe::text)>16384) then
  raise exception using errcode='22023',message='life_naver_invalid_inventory';
 end if;
 h:=sha256(convert_to(jsonb_build_array(p_revision,p_page,p_entries,p_total,p_next_page,p_error,p_probe)::text,'UTF8'));
 -- Same lock order as the original finish. Exact replays remain readable after
 -- stop, but cannot add evidence, change a result, or commit a late operation.
 select * into s from public.life_naver_subscriptions where id=p_subscription_id for update;
 if not found then return jsonb_build_object('status','stale','observed_verified',false,'baseline_promoted',false);end if;
 select * into i from haedo_naver_private.inventory where subscription_id=s.id for update;
 select * into receipt from haedo_naver_private.inventory_observation_receipts where subscription_id=s.id and lease_token=p_lease_token;
 if found then
  if receipt.request_hash<>h then raise exception using errcode='22023',message='life_naver_operation_mismatch';end if;
  return receipt.result;
 end if;
 if exists(select 1 from haedo_naver_private.capture_receipts where kind='inventory' and id=s.id and lease_token=p_lease_token) then
  raise exception using errcode='22023',message='life_naver_observation_legacy_receipt';
 end if;
 perform 1 from haedo_naver_private.runtime where singleton and ready for share;
 if not found or i.subscription_id is null or i.revision<>p_revision or i.page<>p_page
  or i.lease_token is distinct from p_lease_token or i.lease_until<=clock_timestamp() or i.subscription_revision<>s.revision then
  return jsonb_build_object('status','stale','observed_verified',false,'baseline_promoted',false);
 end if;
 method:=coalesce(i.baseline_method,'count_exact');
 if p_error is null then
  select coalesce(jsonb_agg(e->'logNo' order by n),'[]') into ids from jsonb_array_elements(p_entries) with ordinality q(e,n);
  select count(*) into before_count from haedo_naver_private.inventory_seen where subscription_id=s.id and scan_id=i.scan_id;
  select * into o from haedo_naver_private.inventory_scan_observations where subscription_id=s.id and scan_id=i.scan_id for update;
  if not found then
   insert into haedo_naver_private.inventory_scan_observations(subscription_id,owner_id,scan_id,subscription_revision,source_total,valid,head_log_nos)
    values(s.id,s.owner_id,i.scan_id,s.revision,p_total,p_page=1 and before_count=0,case when p_page=1 then ids else '[]'::jsonb end)
    returning * into o;
  end if;
  scan_valid:=o.valid and o.completed_at is null and o.subscription_revision=s.revision and o.last_page+1=p_page
   and o.source_total is not distinct from p_total and p_total is not null
   and before_count=o.seen_count and coalesce(haedo_naver_private.observation_ids_ok(ids),false);
  if exists(select 1 from haedo_naver_private.inventory_seen old join jsonb_array_elements_text(ids) e(log_no) on e.log_no=old.log_no
   where old.subscription_id=s.id and old.scan_id=i.scan_id) then scan_valid:=false;end if;
  expected:=case when p_total is null then null else greatest(0,least(30,p_total-(p_page-1)*30)) end;
  mismatch:=p_total is null or jsonb_array_length(ids) is distinct from expected;
  -- The extension only accepts the established endpoint's excess terminal rows.
  -- Short middle/end pages, beyond-end clamps and zero-count overflow are not
  -- promoted to complete observations, even if two such sets happen to match.
  if terminal then
   scan_valid:=scan_valid and (p_total=0 and p_page=1 and jsonb_array_length(ids)=0 or
    p_total>0 and p_page=(p_total+29)/30 and jsonb_array_length(ids)>=expected and expected>0);
  else scan_valid:=scan_valid and p_total>p_page*30 and jsonb_array_length(ids)=30;end if;
  if terminal and scan_valid and jsonb_typeof(p_probe)='object' then
   if (select count(*) from jsonb_object_keys(p_probe))=2 and p_probe?&array['head','tail']
    and jsonb_typeof(p_probe->'head')='object' and jsonb_typeof(p_probe->'tail')='object' then
    if (select count(*) from jsonb_object_keys(p_probe->'head'))=2 and (select count(*) from jsonb_object_keys(p_probe->'tail'))=2
     and (p_probe->'head')?&array['total','logNos'] and (p_probe->'tail')?&array['total','logNos'] then
     probe_ok:=p_probe->'head'->'total'=to_jsonb(p_total) and p_probe->'tail'->'total'=to_jsonb(p_total)
      and coalesce(haedo_naver_private.observation_ids_ok(p_probe->'head'->'logNos'),false)
      and coalesce(haedo_naver_private.observation_ids_ok(p_probe->'tail'->'logNos'),false)
      and p_probe->'head'->'logNos'=o.head_log_nos and p_probe->'tail'->'logNos'=ids;
    end if;
   end if;
  end if;
  probe_ok:=coalesce(probe_ok,false);
  -- A valid exact-count scan retains the old completion path. A mismatch or
  -- an observed-set terminal without a valid witness never reaches that path.
  if terminal and (mismatch or not scan_valid or method='observed_set' and not probe_ok) then trusted_total:=null;end if;
 end if;
 result:=haedo_naver_private.inventory_finish(p_subscription_id,p_lease_token,p_revision,p_page,p_entries,trusted_total,p_next_page,p_error);
 if result->>'status'='stale' then return result||jsonb_build_object('observed_verified',false,'baseline_promoted',false);end if;
 if p_error is null then
  select count(*) into after_count from haedo_naver_private.inventory_seen where subscription_id=s.id and scan_id=i.scan_id;
  scan_valid:=scan_valid and after_count=before_count+jsonb_array_length(ids);
  if terminal then
   select encode(sha256(convert_to(coalesce(string_agg(log_no,E'\n' order by log_no collate "C"),''),'UTF8')),'hex') into set_digest
    from haedo_naver_private.inventory_seen where subscription_id=s.id and scan_id=i.scan_id;
  end if;
  update haedo_naver_private.inventory_scan_observations set last_page=p_page,seen_count=after_count,valid=scan_valid,
   page_chain_hash=encode(sha256(convert_to(o.page_chain_hash||':'||p_page::text||':'||ids::text,'UTF8')),'hex'),
   set_hash=case when terminal then set_digest else null end,
   completed_at=case when terminal and scan_valid and (probe_ok or not mismatch and method='count_exact') then clock_timestamp() else null end,
   verified=terminal and scan_valid and probe_ok
   where subscription_id=s.id and scan_id=i.scan_id returning * into o;
  -- Keep the source's count. In a one-page unknown/trusted-null finish, the old
  -- function has not populated total_start, so retain the actual reported value.
  update haedo_naver_private.inventory set total_start=coalesce(total_start,p_total) where subscription_id=s.id;
  if o.verified and i.baseline_completed_at is null and exists(
   select 1 from (
    select previous.* from haedo_naver_private.inventory_scan_observations previous
    where previous.subscription_id=s.id and previous.scan_id<>i.scan_id and previous.verified and previous.valid
     and previous.subscription_revision=s.revision and previous.completed_at<=o.started_at
    order by previous.completed_at desc,previous.scan_id desc limit 1
   ) prior
   where prior.source_total=o.source_total and prior.seen_count=o.seen_count and prior.set_hash=o.set_hash
    and not exists((select log_no from haedo_naver_private.inventory_seen where subscription_id=s.id and scan_id=prior.scan_id
     except select log_no from haedo_naver_private.inventory_seen where subscription_id=s.id and scan_id=i.scan_id)
     union all (select log_no from haedo_naver_private.inventory_seen where subscription_id=s.id and scan_id=i.scan_id
     except select log_no from haedo_naver_private.inventory_seen where subscription_id=s.id and scan_id=prior.scan_id))
  ) then
   update haedo_naver_private.inventory set baseline_method='observed_set',baseline_completed_at=clock_timestamp(),
    baseline_scan_id=i.scan_id,baseline_count=after_count,status='complete',last_error=null,next_check_at=clock_timestamp()+interval '1 hour' where subscription_id=s.id;
   -- All identities known before this boundary remain past observations,
   -- including identities from interrupted/older scans outside the final pair.
   update haedo_naver_private.inventory_entries set baseline=true,auto_eligible=false,observed_discovery_revision=null where subscription_id=s.id;
   promoted:=true;
  elsif i.baseline_completed_at is null and result->'inventory'->>'status'='complete' then
   update haedo_naver_private.inventory set baseline_method='count_exact' where subscription_id=s.id and baseline_method is null;
  elsif method='observed_set' and terminal then
   if o.verified then
    update haedo_naver_private.inventory set status='complete',last_error=null,next_check_at=clock_timestamp()+interval '1 hour' where subscription_id=s.id;
    if s.enabled then
     -- A stop/resume changes subscription revision: never turn discoveries
     -- made while stopped or before that boundary into retroactive auto jobs.
     update haedo_naver_private.inventory_entries e set auto_eligible=true
      where e.subscription_id=s.id and not e.baseline and not e.auto_eligible and e.observed_discovery_revision=s.revision
       and exists(select 1 from haedo_naver_private.inventory_seen z where z.subscription_id=s.id and z.scan_id=i.scan_id and z.log_no=e.log_no);
     insert into haedo_naver_private.capture_jobs(owner_id,subscription_id,blog_id,log_no)
      select s.owner_id,s.id,s.blog_id,e.log_no from haedo_naver_private.inventory_entries e
      where e.subscription_id=s.id and not e.baseline and e.auto_eligible and e.observed_discovery_revision=s.revision
       and exists(select 1 from haedo_naver_private.inventory_seen z where z.subscription_id=s.id and z.scan_id=i.scan_id and z.log_no=e.log_no)
      on conflict do nothing;
    end if;
   else
    update haedo_naver_private.inventory set status='partial',last_error='inventory_incomplete',next_check_at=clock_timestamp()+interval '15 minutes' where subscription_id=s.id;
   end if;
  end if;
 end if;
 result:=result||jsonb_build_object('inventory',haedo_naver_private.inventory_view(s.id),
  'observed_verified',coalesce(p_error is null and terminal and scan_valid and probe_ok,false),'baseline_promoted',promoted);
 insert into haedo_naver_private.inventory_observation_receipts values(s.id,p_lease_token,h,result);
 return result;
end $$;

create or replace function public.life_naver_inventory_finish_observed(
 p_subscription_id uuid,p_lease_token uuid,p_revision bigint,p_page integer,p_entries jsonb,
 p_total integer,p_next_page integer,p_error text default null,p_probe jsonb default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
 select haedo_naver_private.inventory_finish_observed(p_subscription_id,p_lease_token,p_revision,p_page,p_entries,p_total,p_next_page,p_error,p_probe)
$$;
revoke all on function haedo_naver_private.observation_ids_ok(jsonb),
 haedo_naver_private.inventory_finish_observed(uuid,uuid,bigint,integer,jsonb,integer,integer,text,jsonb),
 public.life_naver_inventory_finish_observed(uuid,uuid,bigint,integer,jsonb,integer,integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function haedo_naver_private.inventory_finish_observed(uuid,uuid,bigint,integer,jsonb,integer,integer,text,jsonb),
 public.life_naver_inventory_finish_observed(uuid,uuid,bigint,integer,jsonb,integer,integer,text,jsonb) to service_role;

create or replace function haedo_naver_private.inventory_claim(p_limit integer default 1,p_subscription_id uuid default null,p_owner_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.life_naver_subscriptions%rowtype;i haedo_naver_private.inventory%rowtype;result jsonb:='[]';
begin
 if p_limit is null or p_limit not between 1 and 2 or (p_subscription_id is null)<>(p_owner_id is null) then raise exception using errcode='22023',message='life_naver_invalid_request';end if;
 perform 1 from haedo_naver_private.runtime where singleton and ready for share;if not found then return result;end if;
 for s in select sub.* from public.life_naver_subscriptions sub join haedo_naver_private.inventory inv on inv.subscription_id=sub.id
  where (p_subscription_id is null and sub.enabled and inv.next_check_at<=clock_timestamp() or sub.id=p_subscription_id and sub.owner_id=p_owner_id)
   and (inv.lease_until is null or inv.lease_until<=clock_timestamp()) order by inv.next_check_at,sub.id for update of sub skip locked limit p_limit loop
  select * into i from haedo_naver_private.inventory where subscription_id=s.id for update;
  if i.lease_until>clock_timestamp() then continue;end if;
  if i.status='complete' or i.last_error in ('inventory_changed','inventory_incomplete') then
   update haedo_naver_private.inventory set scan_id=gen_random_uuid(),page=1,total_start=null,revision=revision+1 where subscription_id=s.id;
  end if;
  update haedo_naver_private.inventory set status='running',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',subscription_revision=s.revision where subscription_id=s.id returning * into i;
  result:=result||jsonb_build_array(jsonb_build_object('subscription_id',s.id,'owner_id',s.owner_id,'blog_id',s.blog_id,'revision',i.revision,'subscription_revision',s.revision,
   'lease_token',i.lease_token,'lease_until',i.lease_until,'scan_id',i.scan_id,'page',i.page,'page_size',30,'total_start',i.total_start,'baseline_method',i.baseline_method));
 end loop;
 return result;
end $$;
notify pgrst,'reload schema';
commit;
