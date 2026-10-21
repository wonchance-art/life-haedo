-- Additive, private Naver inventory and immutable text/photo captures.
-- Old subscriptions, RSS items and RPC signatures remain unchanged. No cron activation.
begin;
create table if not exists haedo_naver_private.inventory (
 subscription_id uuid primary key references public.life_naver_subscriptions(id), owner_id uuid not null,
 revision bigint not null default 1 check(revision between 1 and 9007199254740991),
 scan_id uuid not null default gen_random_uuid(), page integer not null default 1 check(page between 1 and 10000),
 total_start integer check(total_start between 0 and 300000), status text not null default 'pending' check(status in ('pending','running','partial','complete')),
 baseline_completed_at timestamptz, baseline_scan_id uuid, baseline_count integer,
 last_checked_at timestamptz, last_error text, next_check_at timestamptz not null default clock_timestamp(),
 lease_token uuid, lease_until timestamptz, subscription_revision bigint,
 check((lease_token is null)=(lease_until is null))
);
create table if not exists haedo_naver_private.inventory_entries (
 subscription_id uuid not null references public.life_naver_subscriptions(id), owner_id uuid not null,
 log_no text not null check(log_no ~ '^[1-9][0-9]{0,29}$'),title text not null,
 published_at text, first_seen_at timestamptz not null default clock_timestamp(), baseline boolean not null,auto_eligible boolean not null default false,
 primary key(subscription_id,log_no)
);
create table if not exists haedo_naver_private.inventory_seen (
 subscription_id uuid not null references public.life_naver_subscriptions(id),scan_id uuid not null,log_no text not null,
 primary key(subscription_id,scan_id,log_no)
);
create table if not exists haedo_naver_private.capture_jobs (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,subscription_id uuid not null references public.life_naver_subscriptions(id),
 blog_id text not null,log_no text not null,revision bigint not null default 1 check(revision between 1 and 9007199254740991),
 status text not null default 'pending' check(status in ('pending','running','failed','complete')),
 progress jsonb, last_error text, capture_id uuid, attempts integer not null default 0,
 next_check_at timestamptz not null default clock_timestamp(),lease_token uuid,lease_until timestamptz,subscription_revision bigint,
 unique(owner_id,blog_id,log_no),check((lease_token is null)=(lease_until is null)),
 check(progress is null or (jsonb_typeof(progress)='object' and octet_length(progress::text)<=2097152))
);
create table if not exists public.life_naver_captures (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,blog_id text not null check(blog_id ~ '^[A-Za-z0-9_-]{1,50}$'),
 log_no text not null check(log_no ~ '^[1-9][0-9]{0,29}$'),capture_hash text not null check(capture_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),payload jsonb not null,
 unique(owner_id,blog_id,log_no,capture_hash),check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=2097152)
);
create table if not exists haedo_naver_private.capture_assets (
 path text primary key,owner_id uuid not null,sha256 text not null,mime_type text not null,bytes bigint not null
);
create table if not exists haedo_naver_private.capture_receipts (
 kind text not null check(kind in ('inventory','capture')),id uuid not null,lease_token uuid not null,
 request_hash bytea not null,result jsonb not null,primary key(kind,id,lease_token)
);
alter table haedo_naver_private.inventory enable row level security;
alter table haedo_naver_private.inventory_entries enable row level security;
alter table haedo_naver_private.inventory_seen enable row level security;
alter table haedo_naver_private.capture_jobs enable row level security;
alter table haedo_naver_private.capture_assets enable row level security;
alter table haedo_naver_private.capture_receipts enable row level security;
alter table public.life_naver_captures enable row level security;
revoke all on haedo_naver_private.inventory,haedo_naver_private.inventory_entries,haedo_naver_private.inventory_seen,
 haedo_naver_private.capture_jobs,haedo_naver_private.capture_assets,haedo_naver_private.capture_receipts,public.life_naver_captures from public,anon,authenticated,service_role;
grant select on public.life_naver_captures to authenticated;
drop policy if exists naver_capture_owner on public.life_naver_captures;
create policy naver_capture_owner on public.life_naver_captures for select to authenticated using(owner_id=(select auth.uid()));
create index if not exists naver_captures_owner_page on public.life_naver_captures(owner_id,id);
create index if not exists naver_capture_jobs_due on haedo_naver_private.capture_jobs(next_check_at,id) where status<>'complete';

-- Fixed ASCII object keys; scalars retain their original JSON string content.
create or replace function haedo_naver_private.canonical_json(value jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare result text;
begin
 if jsonb_typeof(value)='object' then
  select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||haedo_naver_private.canonical_json(v),',' order by key collate "C"),'')||'}' into result from jsonb_each(value) e(key,v);
 elsif jsonb_typeof(value)='array' then
  select '['||coalesce(string_agg(haedo_naver_private.canonical_json(v),',' order by n),'')||']' into result from jsonb_array_elements(value) with ordinality e(v,n);
 else result:=value::text;end if;
 return result;
end $$;
create or replace function haedo_naver_private.capture_hash(value jsonb)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare stripped jsonb;
begin
 stripped:=(value-'extractedAt')||jsonb_build_object('photos',coalesce((select jsonb_agg(p-'storagePath' order by n) from jsonb_array_elements(value->'photos') with ordinality e(p,n)),'[]'::jsonb));
 return encode(sha256(convert_to(haedo_naver_private.canonical_json(stripped),'UTF8')),'hex');
end
$$;
create or replace function haedo_naver_private.text_ok(value jsonb,maximum integer,nonempty boolean default false)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select jsonb_typeof(value)='string' and (not nonempty or btrim(value#>>'{}')<>'') and
  (select coalesce(sum(case when ascii(c)>65535 then 2 else 1 end),0) from regexp_split_to_table(value#>>'{}','') c)<=maximum
$$;
create or replace function haedo_naver_private.validate_capture(value jsonb,who uuid,blog text,log text,expected_hash text)
returns void language plpgsql set search_path=pg_catalog as $$
declare photo jsonb;position bigint:=0;total_bytes bigint:=0; path text;object_meta jsonb;
begin
 if value is null or jsonb_typeof(value)<>'object' or (select count(*) from jsonb_object_keys(value))<>16
  or not(value ?& array['version','blogId','logNo','url','title','format','body','bodyHash','htmlHash','coverage','omissions','publishedAt','author','extractedAt','extractor','photos'])
  or value->'version'<>'1'::jsonb or value->>'blogId' is distinct from blog or value->>'logNo' is distinct from log
  or value->>'url' is distinct from 'https://blog.naver.com/'||blog||'/'||log
  or not coalesce(haedo_naver_private.text_ok(value->'title',500,true),false)
  or not coalesce(haedo_naver_private.text_ok(value->'author',500),false)
  or not coalesce(haedo_naver_private.text_ok(value->'extractor',200,true),false)
  or value->>'format' not in ('text/plain','text/markdown') or jsonb_typeof(value->'format')<>'string'
  or (value->>'htmlHash') !~ '^[a-f0-9]{64}$' or jsonb_typeof(value->'htmlHash')<>'string'
  or jsonb_typeof(value->'photos')<>'array' or jsonb_array_length(value->'photos')>20
  or jsonb_typeof(value->'omissions')<>'array' or jsonb_array_length(value->'omissions')>100
  or octet_length(haedo_naver_private.canonical_json(value))>2097152 then
  raise exception using errcode='22023',message='life_naver_invalid_capture';end if;
 if value->'body'='null'::jsonb then
  if value->'bodyHash'<>'null'::jsonb or value->'coverage'<>'"link_only"'::jsonb then raise exception using errcode='22023',message='life_naver_invalid_capture';end if;
 elsif jsonb_typeof(value->'body')<>'string' or length(value->>'body')=0 or octet_length(value->>'body')>1048576
  or value->>'coverage' not in ('partial','full_text','unknown') or jsonb_typeof(value->'coverage')<>'string'
  or jsonb_typeof(value->'bodyHash')<>'string' or value->>'bodyHash' is distinct from encode(sha256(convert_to(value->>'body','UTF8')),'hex') then
  raise exception using errcode='22023',message='life_naver_invalid_capture';end if;
 if jsonb_typeof(value->'extractedAt')<>'string' or not isfinite((value->>'extractedAt')::timestamptz)
  or (value->'publishedAt'<>'null'::jsonb and (jsonb_typeof(value->'publishedAt')<>'string' or not isfinite((value->>'publishedAt')::timestamptz))) then
  raise exception using errcode='22023',message='life_naver_invalid_capture';end if;
 if exists(select 1 from jsonb_array_elements(value->'omissions') e(v) where not coalesce(haedo_naver_private.text_ok(v,500,true),false)) or
  (jsonb_array_length(value->'omissions')=0 and exists(select 1 from jsonb_array_elements(value->'photos') p where p->>'status'='failed')) then
  raise exception using errcode='22023',message='life_naver_invalid_capture';end if;
 for photo in select v from jsonb_array_elements(value->'photos') e(v) loop
  if jsonb_typeof(photo)<>'object' or (select count(*) from jsonb_object_keys(photo))<>13 or
   not(photo ?& array['index','url','storagePath','sha256','mimeType','width','height','bytes','alt','caption','status','error','originalStatus'])
   or photo->'index'<>to_jsonb(position) or jsonb_typeof(photo->'url')<>'string'
   or length(photo->>'url')>8192 or (photo->>'url') !~ '^https://[A-Za-z0-9.-]+/[^[:space:][:cntrl:]]*$'
   or not coalesce(haedo_naver_private.text_ok(photo->'alt',2000),false) or not coalesce(haedo_naver_private.text_ok(photo->'caption',2000),false)
   or photo->'originalStatus'<>'"unverified"'::jsonb then raise exception using errcode='22023',message='life_naver_invalid_photo';end if;
  if photo->>'status'='stored' then
   if photo->'error'<>'null'::jsonb or (photo->>'sha256') !~ '^[a-f0-9]{64}$' or jsonb_typeof(photo->'sha256')<>'string'
    or photo->>'mimeType' not in ('image/jpeg','image/png','image/webp') or jsonb_typeof(photo->'mimeType')<>'string'
    or jsonb_typeof(photo->'bytes')<>'number' or (photo->>'bytes')::numeric not between 1 and 67108864
    or trunc((photo->>'bytes')::numeric)<>(photo->>'bytes')::numeric
    or jsonb_typeof(photo->'width')<>'number' or jsonb_typeof(photo->'height')<>'number'
    or (photo->>'width')::numeric not between 1 and 9007199254740991 or (photo->>'height')::numeric not between 1 and 9007199254740991
    or trunc((photo->>'width')::numeric)<>(photo->>'width')::numeric or trunc((photo->>'height')::numeric)<>(photo->>'height')::numeric
    or (photo->>'width')::numeric*(photo->>'height')::numeric>9007199254740991 then raise exception using errcode='22023',message='life_naver_invalid_photo';end if;
   path:=who::text||'/naver/'||blog||'/'||log||'/'||(photo->>'sha256');
   if photo->>'storagePath' is distinct from path then raise exception using errcode='22023',message='life_naver_invalid_photo';end if;
   select metadata into object_meta from storage.objects where bucket_id='haedo-naver-originals' and name=path;
   if not found or object_meta->>'size' is distinct from photo->>'bytes' or object_meta->>'mimetype' is distinct from photo->>'mimeType' then
    raise exception using errcode='22023',message='life_naver_photo_not_uploaded';end if;
   total_bytes:=total_bytes+(photo->>'bytes')::bigint;
  elsif photo->>'status'='failed' then
   if exists(select 1 from unnest(array['storagePath','sha256','mimeType','width','height','bytes']) k where photo->k<>'null'::jsonb)
    or jsonb_typeof(photo->'error')<>'string' or (photo->>'error')!~'^[a-z][a-z0-9_]{0,79}$' then raise exception using errcode='22023',message='life_naver_invalid_photo';end if;
  else raise exception using errcode='22023',message='life_naver_invalid_photo';end if;
  position:=position+1;
 end loop;
 if total_bytes>268435456 or expected_hash is null or expected_hash !~ '^[a-f0-9]{64}$' or expected_hash<>haedo_naver_private.capture_hash(value) then
  raise exception using errcode='22023',message='life_naver_capture_hash_mismatch';end if;
end $$;

create or replace function haedo_naver_private.inventory_view(sub uuid)
returns jsonb language sql stable set search_path=pg_catalog as $$
 select to_jsonb(i)-'owner_id'-'lease_token'-'lease_until'-'subscription_revision'||jsonb_build_object('seen_count',
  (select count(*) from haedo_naver_private.inventory_seen s where s.subscription_id=i.subscription_id and s.scan_id=i.scan_id))
 from haedo_naver_private.inventory i where i.subscription_id=sub
$$;
create or replace function haedo_naver_private.job_view(job haedo_naver_private.capture_jobs)
returns jsonb language sql immutable set search_path=pg_catalog as $$
 select to_jsonb(job)-'owner_id'-'lease_token'-'lease_until'-'subscription_revision'-'progress'||jsonb_build_object('error',job.last_error,'progress',case when job.progress is null then null else
  jsonb_build_object('nextImage',job.progress->'nextImage','totalImages',case when jsonb_typeof(job.progress->'images')='array' then jsonb_array_length(job.progress->'images') else null end) end)
$$;
create or replace function haedo_naver_private.account_list(p_limit integer default 100,p_before uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid();rows jsonb;more boolean;last_row jsonb;
begin
 if who is null then raise exception using errcode='42501',message='life_naver_auth_required';end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception using errcode='22023',message='life_naver_invalid_request';end if;
 select coalesce(jsonb_agg(to_jsonb(s)-'owner_id'-'lease_token'-'lease_until'||jsonb_build_object('inventory',haedo_naver_private.inventory_view(s.id)) order by s.id),'[]') into rows
 from (select * from public.life_naver_subscriptions where owner_id=who and (p_before is null or id>p_before) order by id limit p_limit+1) s;
 more:=jsonb_array_length(rows)>p_limit;if more then rows:=rows-p_limit;last_row:=rows->(p_limit-1);end if;
 return jsonb_build_object('subscriptions',rows,'ready',haedo_naver_private.ready(),'hasMore',more,'nextCursor',case when more then last_row->'id' else null end);
end $$;
create or replace function haedo_naver_private.inventory_state(p_subscription_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.uid() is null or not exists(select 1 from public.life_naver_subscriptions where id=p_subscription_id and owner_id=auth.uid()) then raise exception using errcode='42501',message='life_naver_owner_required';end if;
 return haedo_naver_private.inventory_view(p_subscription_id);
end $$;
create or replace function haedo_naver_private.inventory_start(p_subscription_id uuid,p_expected_revision bigint default 0)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.life_naver_subscriptions%rowtype;i haedo_naver_private.inventory%rowtype;
begin
 select * into s from public.life_naver_subscriptions where id=p_subscription_id and owner_id=auth.uid() for update;
 if not found then raise exception using errcode='42501',message='life_naver_owner_required';end if;
 select * into i from haedo_naver_private.inventory where subscription_id=s.id for update;
 if p_expected_revision is null or p_expected_revision<>s.revision then raise exception using errcode='PT409',message='life_naver_conflict';end if;
 if i.status in ('pending','running') then return haedo_naver_private.inventory_view(s.id);end if;
 if i.subscription_id is null then insert into haedo_naver_private.inventory(subscription_id,owner_id) values(s.id,s.owner_id);
 else update haedo_naver_private.inventory set revision=revision+1,status='pending',last_error=null,next_check_at=clock_timestamp(),lease_token=null,lease_until=null,
  scan_id=case when status='complete' or last_error in ('inventory_incomplete','inventory_changed') then gen_random_uuid() else scan_id end,page=case when status='complete' or last_error in ('inventory_incomplete','inventory_changed') then 1 else page end,
  total_start=case when status='complete' or last_error in ('inventory_incomplete','inventory_changed') then null else total_start end where subscription_id=s.id;end if;
 return haedo_naver_private.inventory_view(s.id);
end $$;
create or replace function haedo_naver_private.inventory_list(p_subscription_id uuid,p_limit integer default 100,p_before text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.life_naver_subscriptions%rowtype;rows jsonb;more boolean;last_row jsonb;
begin
 select * into s from public.life_naver_subscriptions where id=p_subscription_id and owner_id=auth.uid();
 if not found then raise exception using errcode='42501',message='life_naver_owner_required';end if;
 if p_limit is null or p_limit not between 1 and 200 or (p_before is not null and p_before!~'^[1-9][0-9]{0,29}$') then raise exception using errcode='22023',message='life_naver_invalid_request';end if;
 select coalesce(jsonb_agg(jsonb_build_object('blogId',s.blog_id,'logNo',e.log_no,'title',e.title,'publishedAt',e.published_at,'firstSeenAt',e.first_seen_at,'baseline',e.baseline,
  'captureId',j.capture_id,'job',case when j.id is null then null else haedo_naver_private.job_view(j) end) order by length(e.log_no) desc,e.log_no collate "C" desc),'[]') into rows
 from (select * from haedo_naver_private.inventory_entries where subscription_id=s.id and (p_before is null or (length(log_no),log_no collate "C")<(length(p_before),p_before collate "C")) order by length(log_no) desc,log_no collate "C" desc limit p_limit+1) e
 left join haedo_naver_private.capture_jobs j on j.owner_id=s.owner_id and j.blog_id=s.blog_id and j.log_no=e.log_no;
 more:=jsonb_array_length(rows)>p_limit;if more then rows:=rows-p_limit;last_row:=rows->(p_limit-1);end if;
 return jsonb_build_object('inventory',haedo_naver_private.inventory_view(s.id),'items',rows,'hasMore',more,'nextCursor',case when more then last_row->'logNo' else null end);
end $$;

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
  if i.status='complete' then
   update haedo_naver_private.inventory set scan_id=gen_random_uuid(),page=1,total_start=null,revision=revision+1 where subscription_id=s.id;
  end if;
  update haedo_naver_private.inventory set status='running',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',subscription_revision=s.revision where subscription_id=s.id returning * into i;
  result:=result||jsonb_build_array(jsonb_build_object('subscription_id',s.id,'owner_id',s.owner_id,'blog_id',s.blog_id,'revision',i.revision,'subscription_revision',s.revision,
   'lease_token',i.lease_token,'lease_until',i.lease_until,'scan_id',i.scan_id,'page',i.page,'page_size',30,'total_start',i.total_start));
 end loop;
 return result;
end $$;
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
   insert into haedo_naver_private.inventory_entries(subscription_id,owner_id,log_no,title,published_at,baseline,auto_eligible) values(s.id,s.owner_id,e->>'logNo',e->>'title',e->>'publishedAt',i.baseline_completed_at is null,i.baseline_completed_at is not null and s.enabled) on conflict do nothing;
   get diagnostics inserted=row_count;
   if i.baseline_completed_at is not null and s.enabled and not changed and exists(select 1 from haedo_naver_private.inventory_entries where subscription_id=s.id and log_no=e->>'logNo' and auto_eligible) then
    insert into haedo_naver_private.capture_jobs(owner_id,subscription_id,blog_id,log_no) values(s.owner_id,s.id,s.blog_id,e->>'logNo') on conflict do nothing;
   end if;
   insert into haedo_naver_private.inventory_seen(subscription_id,scan_id,log_no) values(s.id,i.scan_id,e->>'logNo') on conflict do nothing;
  end loop;
  select count(*) into seen from haedo_naver_private.inventory_seen where subscription_id=s.id and scan_id=i.scan_id;
  complete:=not changed and p_next_page is null and p_total is not null and seen=p_total;
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

create or replace function haedo_naver_private.capture_request(p_subscription_id uuid,p_log_no text,p_expected_revision bigint default 0,p_refresh boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.life_naver_subscriptions%rowtype;j haedo_naver_private.capture_jobs%rowtype;
begin
 select * into s from public.life_naver_subscriptions where id=p_subscription_id and owner_id=auth.uid() for update;
 if not found then raise exception using errcode='42501',message='life_naver_owner_required';end if;
 if p_log_no is null or p_log_no!~'^[1-9][0-9]{0,29}$' or p_refresh is null then raise exception using errcode='22023',message='life_naver_invalid_request';end if;
 if p_expected_revision is null or p_expected_revision<>s.revision then raise exception using errcode='PT409',message='life_naver_conflict';end if;
 if not exists(select 1 from haedo_naver_private.inventory_entries where subscription_id=s.id and log_no=p_log_no) and
  not exists(select 1 from public.life_naver_items where subscription_id=s.id and log_no=p_log_no) then raise exception using errcode='22023',message='life_naver_post_not_observed';end if;
 perform pg_advisory_xact_lock(hashtextextended(s.owner_id::text||':'||s.blog_id||':'||p_log_no,0));
 select * into j from haedo_naver_private.capture_jobs where owner_id=s.owner_id and blog_id=s.blog_id and log_no=p_log_no for update;
 if found and (j.status in ('pending','running') or j.status='complete' and not p_refresh) then return haedo_naver_private.job_view(j);end if;
 if j.id is null then insert into haedo_naver_private.capture_jobs(owner_id,subscription_id,blog_id,log_no) values(s.owner_id,s.id,s.blog_id,p_log_no) returning * into j;
 else update haedo_naver_private.capture_jobs set subscription_id=s.id,revision=revision+1,status='pending',attempts=0,next_check_at=clock_timestamp(),last_error=null,progress=null,lease_token=null,lease_until=null where id=j.id returning * into j;end if;
 return haedo_naver_private.job_view(j);
end $$;
create or replace function haedo_naver_private.capture_list(p_subscription_id uuid,p_limit integer default 100,p_before uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.life_naver_subscriptions%rowtype;rows jsonb;jobs jsonb;more boolean;last_row jsonb;
begin
 select * into s from public.life_naver_subscriptions where id=p_subscription_id and owner_id=auth.uid();if not found then raise exception using errcode='42501',message='life_naver_owner_required';end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception using errcode='22023',message='life_naver_invalid_request';end if;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') into rows from (select * from public.life_naver_captures where owner_id=s.owner_id and blog_id=s.blog_id and (p_before is null or id>p_before) order by id limit p_limit+1) c;
 more:=jsonb_array_length(rows)>p_limit;if more then rows:=rows-p_limit;last_row:=rows->(p_limit-1);end if;
 -- Jobs are paged separately by inventory_list; avoid silently truncated arrays.
 select coalesce(jsonb_agg(haedo_naver_private.job_view(j) order by j.id),'[]') into jobs from haedo_naver_private.capture_jobs j where j.owner_id=s.owner_id and j.blog_id=s.blog_id and j.id in
  (select id from haedo_naver_private.capture_jobs where owner_id=s.owner_id and blog_id=s.blog_id order by id limit 100);
 return jsonb_build_object('captures',rows,'jobs',jobs,'jobsTruncated',(select count(*)>100 from haedo_naver_private.capture_jobs where owner_id=s.owner_id and blog_id=s.blog_id),'hasMore',more,'nextCursor',case when more then last_row->'id' else null end);
end $$;
create or replace function haedo_naver_private.capture_read(p_capture_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if auth.uid() is null then raise exception using errcode='42501',message='life_naver_auth_required';end if;
 return (select to_jsonb(c) from public.life_naver_captures c where id=p_capture_id and owner_id=auth.uid());
end $$;
create or replace function haedo_naver_private.capture_claim(p_limit integer default 1,p_job_id uuid default null,p_owner_id uuid default null,p_subscription_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.life_naver_subscriptions%rowtype;j haedo_naver_private.capture_jobs%rowtype;candidate uuid;result jsonb:='[]';
begin
 if p_limit is null or p_limit not between 1 and 2 or ((p_job_id is not null or p_subscription_id is not null)<>(p_owner_id is not null)) then raise exception using errcode='22023',message='life_naver_invalid_request';end if;
 perform 1 from haedo_naver_private.runtime where singleton and ready for share;if not found then return result;end if;
 for candidate in select job.id from haedo_naver_private.capture_jobs job join public.life_naver_subscriptions sub on sub.id=job.subscription_id
  where job.status<>'complete' and (job.lease_until is null or job.lease_until<=clock_timestamp()) and
  (p_owner_id is null and sub.enabled and job.attempts<5 and job.next_check_at<=clock_timestamp() or p_owner_id is not null and job.owner_id=p_owner_id and (p_job_id is null or job.id=p_job_id) and (p_subscription_id is null or job.subscription_id=p_subscription_id))
  order by job.next_check_at,job.id limit p_limit*2 loop
  select sub.* into s from public.life_naver_subscriptions sub join haedo_naver_private.capture_jobs job on job.subscription_id=sub.id where job.id=candidate for update of sub skip locked;
  if not found then continue;end if;
  if p_owner_id is null and not s.enabled then continue;end if;
  select * into j from haedo_naver_private.capture_jobs where id=candidate for update skip locked;
  if not found or j.status='complete' or j.lease_until>clock_timestamp() then continue;end if;
  update haedo_naver_private.capture_jobs set status='running',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',subscription_revision=s.revision where id=j.id returning * into j;
  result:=result||jsonb_build_array(jsonb_build_object('job_id',j.id,'owner_id',j.owner_id,'subscription_id',s.id,'blog_id',j.blog_id,'log_no',j.log_no,'revision',j.revision,'subscription_revision',s.revision,'lease_token',j.lease_token,'lease_until',j.lease_until,'progress',j.progress));
  exit when jsonb_array_length(result)>=p_limit;
 end loop;
 return result;
end $$;
create or replace function haedo_naver_private.capture_finish_internal(p_job_id uuid,p_lease_token uuid,p_revision bigint,p_payload jsonb,p_capture_hash text,p_error text,p_progress jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j haedo_naver_private.capture_jobs%rowtype;s public.life_naver_subscriptions%rowtype;r haedo_naver_private.capture_receipts%rowtype;
 h bytea;capture uuid;result jsonb;photo jsonb;prior public.life_naver_captures%rowtype;partial_photos boolean:=false;
begin
 if p_job_id is null or p_lease_token is null or p_revision is null or p_revision<1 or
  (p_error is not null and (p_error!~'^[a-z][a-z0-9_]{0,79}$' or p_payload is not null or p_progress is not null or p_capture_hash is not null)) or
  (p_progress is not null and (p_payload is not null or p_capture_hash is not null or jsonb_typeof(p_progress)<>'object' or octet_length(p_progress::text)>2097152)) or
  (p_error is null and p_progress is null and (p_payload is null or p_capture_hash is null)) then raise exception using errcode='22023',message='life_naver_invalid_result';end if;
 h:=sha256(convert_to(jsonb_build_array(p_revision,p_payload,p_capture_hash,p_error,p_progress)::text,'UTF8'));
 select * into j from haedo_naver_private.capture_jobs where id=p_job_id;if not found then return jsonb_build_object('status','stale');end if;
 select * into s from public.life_naver_subscriptions where id=j.subscription_id for update;
 select * into j from haedo_naver_private.capture_jobs where id=p_job_id for update;
 select * into r from haedo_naver_private.capture_receipts where kind='capture' and id=j.id and lease_token=p_lease_token;
 if found then if r.request_hash<>h then raise exception using errcode='22023',message='life_naver_operation_mismatch';end if;return r.result;end if;
 perform 1 from haedo_naver_private.runtime where singleton and ready for share;
 if not found or j.revision<>p_revision or j.lease_token is distinct from p_lease_token or j.lease_until<=clock_timestamp() or j.subscription_revision<>s.revision then return jsonb_build_object('status','stale');end if;
 if p_payload is not null then
  perform haedo_naver_private.validate_capture(p_payload,j.owner_id,j.blog_id,j.log_no,p_capture_hash);
  partial_photos:=exists(select 1 from jsonb_array_elements(p_payload->'photos') p where p->>'status'='failed');
  insert into public.life_naver_captures(owner_id,blog_id,log_no,capture_hash,payload) values(j.owner_id,j.blog_id,j.log_no,p_capture_hash,p_payload) on conflict do nothing returning id into capture;
  if capture is null then
   select * into prior from public.life_naver_captures where owner_id=j.owner_id and blog_id=j.blog_id and log_no=j.log_no and capture_hash=p_capture_hash;
   if haedo_naver_private.capture_hash(prior.payload)<>p_capture_hash then raise exception using errcode='22023',message='life_naver_capture_hash_mismatch';end if;capture:=prior.id;
  end if;
  for photo in select value from jsonb_array_elements(p_payload->'photos') where value->>'status'='stored' loop
   insert into haedo_naver_private.capture_assets values(photo->>'storagePath',j.owner_id,photo->>'sha256',photo->>'mimeType',(photo->>'bytes')::bigint) on conflict do nothing;
   if not exists(select 1 from haedo_naver_private.capture_assets where path=photo->>'storagePath' and owner_id=j.owner_id and sha256=photo->>'sha256' and mime_type=photo->>'mimeType' and bytes=(photo->>'bytes')::bigint) then raise exception using errcode='22023',message='life_naver_invalid_photo';end if;
  end loop;
 end if;
 update haedo_naver_private.capture_jobs set revision=revision+1,status=case when p_error is not null or partial_photos then 'failed' when p_progress is not null then 'pending' else 'complete' end,
  progress=case when p_progress is not null then p_progress when p_error is not null then progress else null end,last_error=case when partial_photos then 'partial_capture' else p_error end,
  attempts=case when p_error is not null or partial_photos then attempts+1 else 0 end,capture_id=coalesce(capture,capture_id),lease_token=null,lease_until=null,
  next_check_at=clock_timestamp()+case when p_error is not null then interval '15 minutes' else interval '0 seconds' end where id=j.id;
 result:=jsonb_build_object('status',case when p_progress is not null then 'pending' else 'stored' end,'capture_id',capture,'job_id',j.id);
 insert into haedo_naver_private.capture_receipts values('capture',j.id,p_lease_token,h,result);
 return result;
end $$;

create or replace function haedo_naver_private.asset_access(object_path text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from haedo_naver_private.capture_assets where path=object_path and owner_id=(select auth.uid()))
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('haedo-naver-originals','haedo-naver-originals',false,67108864,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
do $$begin
 if not exists(select 1 from storage.buckets where id='haedo-naver-originals' and not public and file_size_limit=67108864 and allowed_mime_types=array['image/jpeg','image/png','image/webp']) then raise exception 'Naver private bucket configuration mismatch';end if;
end $$;
drop policy if exists naver_originals_read on storage.objects;
create policy naver_originals_read on storage.objects for select to authenticated using(bucket_id='haedo-naver-originals' and haedo_naver_private.asset_access(name));
drop policy if exists naver_originals_read_guard on storage.objects;
create policy naver_originals_read_guard on storage.objects as restrictive for select to public using(bucket_id<>'haedo-naver-originals' or haedo_naver_private.asset_access(name));
drop policy if exists naver_originals_insert_guard on storage.objects;
create policy naver_originals_insert_guard on storage.objects as restrictive for insert to public with check(bucket_id<>'haedo-naver-originals');
drop policy if exists naver_originals_update_guard on storage.objects;
create policy naver_originals_update_guard on storage.objects as restrictive for update to public using(bucket_id<>'haedo-naver-originals') with check(bucket_id<>'haedo-naver-originals');
drop policy if exists naver_originals_delete_guard on storage.objects;
create policy naver_originals_delete_guard on storage.objects as restrictive for delete to public using(bucket_id<>'haedo-naver-originals');

-- Every public RPC is an invoker wrapper; authorization lives in private fixed-path functions.
create or replace function public.life_naver_account_list(p_limit integer default 100,p_before uuid default null) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.account_list(p_limit,p_before)$$;
create or replace function public.life_naver_inventory_state(p_subscription_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.inventory_state(p_subscription_id)$$;
create or replace function public.life_naver_inventory_start(p_subscription_id uuid,p_expected_revision bigint default 0) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.inventory_start(p_subscription_id,p_expected_revision)$$;
create or replace function public.life_naver_inventory_list(p_subscription_id uuid,p_limit integer default 100,p_before text default null) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.inventory_list(p_subscription_id,p_limit,p_before)$$;
create or replace function public.life_naver_capture_request(p_subscription_id uuid,p_log_no text,p_expected_revision bigint default 0,p_refresh boolean default false) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.capture_request(p_subscription_id,p_log_no,p_expected_revision,p_refresh)$$;
create or replace function public.life_naver_capture_list(p_subscription_id uuid,p_limit integer default 100,p_before uuid default null) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.capture_list(p_subscription_id,p_limit,p_before)$$;
create or replace function public.life_naver_capture_read(p_capture_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.capture_read(p_capture_id)$$;
create or replace function public.life_naver_inventory_claim(p_limit integer default 1,p_subscription_id uuid default null,p_owner_id uuid default null) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.inventory_claim(p_limit,p_subscription_id,p_owner_id)$$;
create or replace function public.life_naver_inventory_finish(p_subscription_id uuid,p_lease_token uuid,p_revision bigint,p_page integer,p_entries jsonb,p_total integer,p_next_page integer,p_error text default null) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.inventory_finish(p_subscription_id,p_lease_token,p_revision,p_page,p_entries,p_total,p_next_page,p_error)$$;
create or replace function public.life_naver_capture_claim(p_limit integer default 1,p_job_id uuid default null,p_owner_id uuid default null,p_subscription_id uuid default null) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.capture_claim(p_limit,p_job_id,p_owner_id,p_subscription_id)$$;
create or replace function public.life_naver_capture_finish(p_job_id uuid,p_lease_token uuid,p_revision bigint,p_payload jsonb,p_capture_hash text,p_error text default null) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.capture_finish_internal(p_job_id,p_lease_token,p_revision,p_payload,p_capture_hash,p_error,null)$$;
create or replace function public.life_naver_capture_checkpoint(p_job_id uuid,p_lease_token uuid,p_revision bigint,p_progress jsonb) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.capture_finish_internal(p_job_id,p_lease_token,p_revision,null,null,null,p_progress)$$;

-- Never use ALL FUNCTIONS: preserve every previously installed RPC grant.
do $$declare fn record;role_name text;begin
 for fn in select n.nspname,p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
  (n.nspname='public' and p.proname in ('life_naver_account_list','life_naver_inventory_state','life_naver_inventory_start','life_naver_inventory_list','life_naver_capture_request','life_naver_capture_list','life_naver_capture_read','life_naver_inventory_claim','life_naver_inventory_finish','life_naver_capture_claim','life_naver_capture_finish','life_naver_capture_checkpoint')) or
  (n.nspname='haedo_naver_private' and p.proname in ('canonical_json','capture_hash','text_ok','validate_capture','inventory_view','job_view','account_list','inventory_state','inventory_start','inventory_list','capture_request','capture_list','capture_read','inventory_claim','inventory_finish','capture_claim','capture_finish_internal','asset_access')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
  if fn.proname in ('account_list','inventory_state','inventory_start','inventory_list','capture_request','capture_list','capture_read','asset_access','life_naver_account_list','life_naver_inventory_state','life_naver_inventory_start','life_naver_inventory_list','life_naver_capture_request','life_naver_capture_list','life_naver_capture_read') then role_name:='authenticated';
  elsif fn.proname in ('inventory_claim','inventory_finish','capture_claim','capture_finish_internal','life_naver_inventory_claim','life_naver_inventory_finish','life_naver_capture_claim','life_naver_capture_finish','life_naver_capture_checkpoint') then role_name:='service_role';else continue;end if;
  execute format('grant execute on function %s to %I',fn.signature,role_name);
 end loop;
end $$;
-- Policy expressions are initialized even for rows in unrelated buckets.
-- Anonymous evaluation must return false, rather than break those buckets.
-- Schema usage stays revoked from anon; captures and worker RPCs remain denied.
grant execute on function haedo_naver_private.asset_access(text) to anon;
notify pgrst,'reload schema';
commit;
