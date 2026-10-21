-- Private Naver RSS subscriptions and immutable new-item inbox. No existing
-- workspace, writing, photo or publication rows are read or changed.
-- Runtime is gated OFF; this migration does not schedule a cron job.
begin;
create schema if not exists haedo_naver_private;
revoke all on schema haedo_naver_private from public,anon,authenticated,service_role;
grant usage on schema haedo_naver_private to authenticated,service_role;

create table if not exists haedo_naver_private.runtime (
 singleton boolean primary key default true check(singleton),
 ready boolean not null default false
);
insert into haedo_naver_private.runtime(singleton,ready) values(true,false) on conflict(singleton) do nothing;
alter table haedo_naver_private.runtime enable row level security;
revoke all on haedo_naver_private.runtime from public,anon,authenticated,service_role;

create table if not exists public.life_naver_subscriptions (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null,
 workspace_id uuid not null, blog_id text not null check(blog_id ~ '^[A-Za-z0-9_-]{1,50}$'),
 enabled boolean not null default false, revision bigint not null default 1 check(revision between 1 and 9007199254740991),
 last_checked_at timestamptz, last_success_at timestamptz, last_error text,
 next_check_at timestamptz not null default clock_timestamp(),
 lease_token uuid, lease_until timestamptz,
 unique(owner_id,id), unique(owner_id,workspace_id,blog_id),
 check((lease_token is null)=(lease_until is null)),
 check(last_error is null or last_error ~ '^[a-z_]{1,80}$')
);
create index if not exists life_naver_owner_workspace on public.life_naver_subscriptions(owner_id,workspace_id,id);
create index if not exists life_naver_due on public.life_naver_subscriptions(next_check_at,id) where enabled;
create table if not exists public.life_naver_items (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, subscription_id uuid not null,
 blog_id text not null check(blog_id ~ '^[A-Za-z0-9_-]{1,50}$'), log_no text not null check(log_no ~ '^[1-9][0-9]{0,29}$'),
 title text not null check(char_length(title) between 1 and 400 and octet_length(title)<=1600),
 url text not null check(url='https://blog.naver.com/'||blog_id||'/'||log_no),
 content_text text, content_hash text, published_at timestamptz, fetched_at timestamptz not null default clock_timestamp(),
 coverage text not null check(coverage in ('partial','link_only')),
 unique(subscription_id,log_no),
 foreign key(owner_id,subscription_id) references public.life_naver_subscriptions(owner_id,id) on delete restrict,
 check((coverage='link_only' and content_text is null and content_hash is null) or
       (coverage='partial' and content_text is not null and char_length(content_text) between 1 and 50000
        and octet_length(content_text)<=200000 and content_hash is not null and content_hash=encode(sha256(convert_to(content_text,'UTF8')),'hex')))
);
create index if not exists life_naver_item_owner_page on public.life_naver_items(owner_id,fetched_at desc,id desc);
alter table public.life_naver_subscriptions enable row level security;
alter table public.life_naver_items enable row level security;
revoke all on public.life_naver_subscriptions,public.life_naver_items from public,anon,authenticated,service_role;
grant select on public.life_naver_subscriptions,public.life_naver_items to authenticated;
drop policy if exists life_naver_subscription_owner on public.life_naver_subscriptions;
create policy life_naver_subscription_owner on public.life_naver_subscriptions for select to authenticated using(owner_id=(select auth.uid()));
drop policy if exists life_naver_item_owner on public.life_naver_items;
create policy life_naver_item_owner on public.life_naver_items for select to authenticated using(owner_id=(select auth.uid()));
create table if not exists haedo_naver_private.receipts (
 subscription_id uuid not null references public.life_naver_subscriptions(id) on delete restrict,
 lease_token uuid not null, request_hash bytea not null check(octet_length(request_hash)=32), result jsonb not null,
 primary key(subscription_id,lease_token)
);
alter table haedo_naver_private.receipts enable row level security;
revoke all on haedo_naver_private.receipts from public,anon,authenticated,service_role;

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
  if p_expected_revision<>0 then raise exception using errcode='40001',message='life_naver_conflict'; end if;
  if (select count(*) from public.life_naver_subscriptions where owner_id=who and workspace_id=p_workspace_id)>=20 then raise exception using errcode='22023',message='life_naver_subscription_limit'; end if;
  insert into public.life_naver_subscriptions(owner_id,workspace_id,blog_id,enabled) values(who,p_workspace_id,blog,p_enabled) returning * into sub;
 else
  if sub.revision<>p_expected_revision then raise exception using errcode='40001',message='life_naver_conflict'; end if;
  update public.life_naver_subscriptions set enabled=p_enabled,revision=revision+1,lease_token=null,lease_until=null,next_check_at=clock_timestamp()
   where id=sub.id returning * into sub;
 end if;
 return (to_jsonb(sub)-'lease_token'-'lease_until'-'owner_id')||jsonb_build_object('ready',coalesce(ready,false));
end $$;

create or replace function haedo_naver_private.list(p_workspace_id uuid,p_limit integer default 100,p_before jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); subs jsonb; items jsonb; ready boolean; cursor_time timestamptz; cursor_id uuid; last_row jsonb; more boolean;
begin
 if who is null then raise exception using errcode='42501',message='life_naver_auth_required'; end if;
 if p_workspace_id is null or p_limit is null or p_limit not between 1 and 200 then raise exception using errcode='22023',message='life_naver_invalid_request'; end if;
 if p_before is not null then
  if jsonb_typeof(p_before)<>'object' or (select count(*) from jsonb_object_keys(p_before))<>2 or not(p_before?'fetched_at' and p_before?'id') or jsonb_typeof(p_before->'fetched_at')<>'string' or jsonb_typeof(p_before->'id')<>'string' then
   raise exception using errcode='22023',message='life_naver_invalid_cursor'; end if;
  begin cursor_time:=(p_before->>'fetched_at')::timestamptz;cursor_id:=(p_before->>'id')::uuid;
  exception when others then raise exception using errcode='22023',message='life_naver_invalid_cursor'; end;
  if not isfinite(cursor_time) then raise exception using errcode='22023',message='life_naver_invalid_cursor'; end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(s)-'owner_id'-'lease_token'-'lease_until' order by s.blog_id,s.id),'[]') into subs
  from public.life_naver_subscriptions s where s.owner_id=who and s.workspace_id=p_workspace_id;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.fetched_at desc,q.id desc),'[]') into items from (
  select i.* from public.life_naver_items i join public.life_naver_subscriptions s on s.id=i.subscription_id and s.owner_id=i.owner_id
  where i.owner_id=who and s.workspace_id=p_workspace_id and (p_before is null or (i.fetched_at,i.id)<(cursor_time,cursor_id))
  order by i.fetched_at desc,i.id desc limit p_limit+1
 ) q;
 more:=jsonb_array_length(items)>p_limit;
 if more then items:=items-(jsonb_array_length(items)-1);last_row:=items->(p_limit-1);end if;
 select r.ready into ready from haedo_naver_private.runtime r where singleton;
 return jsonb_build_object('subscriptions',subs,'items',items,'ready',coalesce(ready,false),'has_more',more,
  'next_cursor',case when more then jsonb_build_object('fetched_at',last_row->'fetched_at','id',last_row->'id') else null end);
end $$;

create or replace function haedo_naver_private.claim(p_limit integer default 5,p_subscription_id uuid default null,p_owner_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 if p_limit is null or p_limit not between 1 and 20 or (p_subscription_id is null)<>(p_owner_id is null) then raise exception using errcode='22023',message='life_naver_invalid_request';end if;
 perform 1 from haedo_naver_private.runtime where singleton and ready for share;
 if not found then return '[]'::jsonb;end if;
 with due as (
  select id from public.life_naver_subscriptions where (p_subscription_id is not null or (enabled and next_check_at<=clock_timestamp())) and (lease_until is null or lease_until<=clock_timestamp())
   and (p_subscription_id is null or (id=p_subscription_id and owner_id=p_owner_id)) order by next_check_at,id for update skip locked limit p_limit
 ), taken as (
  update public.life_naver_subscriptions s set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes'
  from due where s.id=due.id returning s.*
 ) select coalesce(jsonb_agg(jsonb_build_object('subscription_id',id,'owner_id',owner_id,'workspace_id',workspace_id,'blog_id',blog_id,'revision',revision,'lease_token',lease_token,'lease_until',lease_until)),'[]') into result from taken;
 return result;
end $$;

create or replace function haedo_naver_private.finish(p_subscription_id uuid,p_lease_token uuid,p_revision bigint,p_items jsonb,p_error text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare sub public.life_naver_subscriptions%rowtype; receipt haedo_naver_private.receipts%rowtype; request_hash bytea; item jsonb;
 stamp timestamptz:=clock_timestamp(); published timestamptz; inserted integer:=0; n integer; result jsonb;
begin
 if p_subscription_id is null or p_lease_token is null or p_revision is null or p_revision<1 or p_revision>9007199254740991
  or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 or octet_length(p_items::text)>4194304
  or (p_error is not null and (p_error!~'^[a-z_]{1,80}$' or jsonb_array_length(p_items)<>0)) then
  raise exception using errcode='22023',message='life_naver_invalid_result';end if;
 request_hash:=sha256(convert_to(p_revision::text||':'||p_items::text||':'||coalesce(p_error,''),'UTF8'));
 select * into sub from public.life_naver_subscriptions where id=p_subscription_id for update;
 if not found then return jsonb_build_object('status','stale','inserted',0);end if;
 select * into receipt from haedo_naver_private.receipts where subscription_id=p_subscription_id and lease_token=p_lease_token;
 if found then
  if receipt.request_hash<>request_hash then raise exception using errcode='22023',message='life_naver_operation_mismatch';end if;
  return receipt.result;
 end if;
 perform 1 from haedo_naver_private.runtime where singleton and ready for share;
 if not found or sub.revision<>p_revision or sub.lease_token is distinct from p_lease_token or sub.lease_until<=stamp then
  return jsonb_build_object('status','stale','inserted',0);end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>7 or not(item ?& array['log_no','title','url','content_text','content_hash','published_at','coverage'])
   or jsonb_typeof(item->'log_no')<>'string' or (item->>'log_no')!~'^[1-9][0-9]{0,29}$'
   or jsonb_typeof(item->'title')<>'string' or char_length(item->>'title') not between 1 and 400 or octet_length(item->>'title')>1600 or btrim(item->>'title')=''
   or jsonb_typeof(item->'url')<>'string' or (item->>'url')<>('https://blog.naver.com/'||sub.blog_id||'/'||(item->>'log_no'))
   or jsonb_typeof(item->'coverage')<>'string' or (item->>'coverage') not in ('partial','link_only') then
    raise exception using errcode='22023',message='life_naver_invalid_item';end if;
  if item->>'coverage'='link_only' then
   if item->'content_text'<>'null'::jsonb or item->'content_hash'<>'null'::jsonb then raise exception using errcode='22023',message='life_naver_invalid_item';end if;
  else
   if jsonb_typeof(item->'content_text')<>'string' or char_length(item->>'content_text') not between 1 and 50000 or octet_length(item->>'content_text')>200000
    or btrim(item->>'content_text')='' or jsonb_typeof(item->'content_hash')<>'string' or (item->>'content_hash')<>encode(sha256(convert_to(item->>'content_text','UTF8')),'hex') then
    raise exception using errcode='22023',message='life_naver_invalid_item';end if;
  end if;
  published:=null;
  if item->'published_at'<>'null'::jsonb then
   if jsonb_typeof(item->'published_at')<>'string' then raise exception using errcode='22023',message='life_naver_invalid_date';end if;
   begin published:=(item->>'published_at')::timestamptz;exception when others then raise exception using errcode='22023',message='life_naver_invalid_date';end;
   if not isfinite(published) then raise exception using errcode='22023',message='life_naver_invalid_date';end if;
  end if;
  insert into public.life_naver_items(owner_id,subscription_id,blog_id,log_no,title,url,content_text,content_hash,published_at,fetched_at,coverage)
   values(sub.owner_id,sub.id,sub.blog_id,item->>'log_no',item->>'title',item->>'url',item->>'content_text',item->>'content_hash',published,stamp,item->>'coverage')
   on conflict(subscription_id,log_no) do nothing;
  get diagnostics n=row_count;inserted:=inserted+n;
 end loop;
 update public.life_naver_subscriptions set lease_token=null,lease_until=null,last_checked_at=stamp,
  last_success_at=case when p_error is null then stamp else last_success_at end,last_error=p_error,
  next_check_at=stamp+case when p_error is null then interval '1 hour' else interval '15 minutes' end where id=sub.id;
 result:=jsonb_build_object('status','stored','inserted',inserted);
 insert into haedo_naver_private.receipts(subscription_id,lease_token,request_hash,result) values(sub.id,p_lease_token,request_hash,result);
 return result;
end $$;

create or replace function haedo_naver_private.ready()
returns boolean language sql stable security definer set search_path=pg_catalog as $$select coalesce((select ready from haedo_naver_private.runtime where singleton),false)$$;
create or replace function public.life_naver_ready()
returns boolean language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.ready()$$;
create or replace function public.life_naver_save(p_workspace_id uuid,p_blog_id text,p_expected_revision bigint,p_enabled boolean)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.save(p_workspace_id,p_blog_id,p_expected_revision,p_enabled)$$;
create or replace function public.life_naver_list(p_workspace_id uuid,p_limit integer default 100,p_before jsonb default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.list(p_workspace_id,p_limit,p_before)$$;
create or replace function public.life_naver_claim(p_limit integer default 5,p_subscription_id uuid default null,p_owner_id uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.claim(p_limit,p_subscription_id,p_owner_id)$$;
create or replace function public.life_naver_finish(p_subscription_id uuid,p_lease_token uuid,p_revision bigint,p_items jsonb,p_error text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_naver_private.finish(p_subscription_id,p_lease_token,p_revision,p_items,p_error)$$;
revoke all on all functions in schema haedo_naver_private from public,anon,authenticated,service_role;
grant execute on function haedo_naver_private.save(uuid,text,bigint,boolean),haedo_naver_private.list(uuid,integer,jsonb) to authenticated;
grant execute on function haedo_naver_private.claim(integer,uuid,uuid),haedo_naver_private.finish(uuid,uuid,bigint,jsonb,text),haedo_naver_private.ready() to service_role;
revoke all on function public.life_naver_save(uuid,text,bigint,boolean),public.life_naver_list(uuid,integer,jsonb),public.life_naver_claim(integer,uuid,uuid),public.life_naver_finish(uuid,uuid,bigint,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.life_naver_save(uuid,text,bigint,boolean),public.life_naver_list(uuid,integer,jsonb) to authenticated;
grant execute on function public.life_naver_claim(integer,uuid,uuid),public.life_naver_finish(uuid,uuid,bigint,jsonb,text) to service_role;
revoke all on function public.life_naver_ready() from public,anon,authenticated,service_role;
grant execute on function public.life_naver_ready() to service_role;
notify pgrst,'reload schema';
commit;
