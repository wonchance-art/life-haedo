-- Additive, disabled by default. No cron, live feed or existing source data changes.
-- Private inbox follows the existing exact-source projection contract; clients
-- reuse Core.prepareImport/commitLocal, never mutate existing material schemas.
begin;
create schema haedo_rss_private;
revoke all on schema haedo_rss_private from public,anon,authenticated,service_role;
grant usage on schema haedo_rss_private to authenticated,service_role;
create table haedo_rss_private.runtime(singleton boolean primary key default true check(singleton),ready boolean not null default false,allowed_feed_urls text[] not null default '{}');
insert into haedo_rss_private.runtime values(true,false,'{}');
create table haedo_rss_private.connections(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,workspace_id uuid not null,feed_url text not null,
 status text not null default 'pending' check(status in('pending','preview','active','paused','disconnected')),
 revision bigint not null default 1 check(revision between 1 and 9007199254740991),
 baseline_started_at timestamptz,baseline_at timestamptz,activated_at timestamptz,baseline_count integer not null default 0,
 cursor text,last_error text,retry_window_at timestamptz,retry_count integer not null default 0,last_checked_at timestamptz,next_check_at timestamptz not null default clock_timestamp(),
 lease_token uuid,lease_until timestamptz,unique(owner_id,id),check((lease_token is null)=(lease_until is null))
);
create unique index rss_one_connected_source on haedo_rss_private.connections(owner_id) where status<>'disconnected';
create index rss_due on haedo_rss_private.connections(next_check_at) where status in('active','pending');
create table haedo_rss_private.observations(
 connection_id uuid not null references haedo_rss_private.connections(id),identity text not null,url text,
 first_observed_at timestamptz not null default clock_timestamp(),baseline boolean not null,
 primary key(connection_id,identity)
);
create table haedo_rss_private.items(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,connection_id uuid not null,
 identity text not null,title text not null,url text,content_text text,content_hash text,
 published_at timestamptz,fetched_at timestamptz not null default clock_timestamp(),
 disposition text not null check(disposition in('stored','held')),reason text,
 item_hash bytea not null,unique(connection_id,item_hash),
 foreign key(owner_id,connection_id) references haedo_rss_private.connections(owner_id,id),
 check((content_text is null and content_hash is null) or content_hash=encode(sha256(convert_to(content_text,'UTF8')),'hex'))
);
create index rss_items_page on haedo_rss_private.items(owner_id,fetched_at,id);
create table haedo_rss_private.receipts(
 connection_id uuid not null references haedo_rss_private.connections(id),lease_token uuid not null,
 request_hash bytea not null,result jsonb not null,primary key(connection_id,lease_token)
);
alter table haedo_rss_private.runtime enable row level security;
alter table haedo_rss_private.connections enable row level security;
alter table haedo_rss_private.observations enable row level security;
alter table haedo_rss_private.items enable row level security;
alter table haedo_rss_private.receipts enable row level security;
revoke all on all tables in schema haedo_rss_private from public,anon,authenticated,service_role;

create function haedo_rss_private.view_connection(c haedo_rss_private.connections) returns jsonb
language sql immutable set search_path=pg_catalog as $$select to_jsonb(c)-'owner_id'-'lease_token'-'lease_until'$$;
create function haedo_rss_private.save(p_workspace_id uuid,p_feed_url text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid();c haedo_rss_private.connections%rowtype;
begin
 if who is null then raise exception using errcode='42501',message='rss_auth_required';end if;
 if p_workspace_id is null or p_feed_url is null or octet_length(p_feed_url)>2048 or p_feed_url !~ '^https://[^/@?#:]+/' then raise exception using errcode='22023',message='rss_invalid_feed';end if;
 perform 1 from haedo_rss_private.runtime where singleton and ready and p_feed_url=any(allowed_feed_urls) for share;
 if not found then raise exception using errcode='22023',message='rss_setup_required';end if;
 perform pg_advisory_xact_lock(hashtextextended('rss:'||who::text,0));
 select * into c from haedo_rss_private.connections where owner_id=who and status<>'disconnected' for update;
 if found then
  if c.workspace_id<>p_workspace_id or c.feed_url<>p_feed_url then raise exception using errcode='PT409',message='rss_connection_exists';end if;
 else insert into haedo_rss_private.connections(owner_id,workspace_id,feed_url) values(who,p_workspace_id,p_feed_url) returning * into c;end if;
 return haedo_rss_private.view_connection(c)||jsonb_build_object('ready',true);
end$$;
create function haedo_rss_private.list(p_workspace_id uuid,p_before jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid();cs jsonb;others jsonb;its jsonb;ready boolean;has_more boolean;cursor_time timestamptz;cursor_id uuid;last_row jsonb;row_data jsonb;q record;page_bytes bigint:=0;
begin
 if who is null then raise exception using errcode='42501',message='rss_auth_required';end if;
 if p_workspace_id is null then raise exception using errcode='22023',message='rss_invalid_workspace';end if;
 p_before:=nullif(p_before,'null'::jsonb);
 if p_before is not null then
  if jsonb_typeof(p_before)<>'object' or not(p_before ?& array['fetched_at','id']) or (select count(*) from jsonb_object_keys(p_before))<>2 then raise exception using errcode='22023',message='rss_invalid_cursor';end if;
  cursor_time:=(p_before->>'fetched_at')::timestamptz;cursor_id:=(p_before->>'id')::uuid;
  if cursor_time is null or cursor_id is null or not isfinite(cursor_time) then raise exception using errcode='22023',message='rss_invalid_cursor';end if;
 end if;
 select coalesce(jsonb_agg(haedo_rss_private.view_connection(c) order by c.id),'[]') into cs from haedo_rss_private.connections c where owner_id=who and workspace_id=p_workspace_id;
 select coalesce(jsonb_agg(haedo_rss_private.view_connection(c) order by c.id),'[]') into others from haedo_rss_private.connections c where owner_id=who and workspace_id<>p_workspace_id and status<>'disconnected';
 its:='[]';has_more:=false;
 for q in select i.* from haedo_rss_private.items i join haedo_rss_private.connections c on c.id=i.connection_id
 where c.owner_id=who and c.workspace_id=p_workspace_id and (p_before is null or (i.fetched_at,i.id)>(cursor_time,cursor_id)) order by i.fetched_at,i.id limit 101 loop
  row_data:=to_jsonb(q)-'item_hash';
  -- A held original remains in the private inbox; the status list does not need
  -- its potentially large body. Never truncate an eligible source to fit a page.
  if q.disposition='held' then row_data:=row_data||jsonb_build_object('content_text',null,'content_omitted',true);end if;
  if jsonb_array_length(its)>=100 or (jsonb_array_length(its)>0 and page_bytes+octet_length(row_data::text)>2097152) then has_more:=true;exit;end if;
  its:=its||jsonb_build_array(row_data);page_bytes:=page_bytes+octet_length(row_data::text);
 end loop;
 if has_more then last_row:=its->(jsonb_array_length(its)-1);end if;
 select r.ready into ready from haedo_rss_private.runtime r where singleton;
 return jsonb_build_object('connections',cs,'other_connections',others,'items',its,'ready',coalesce(ready,false),'has_more',has_more,'next_cursor',case when has_more then jsonb_build_object('fetched_at',last_row->'fetched_at','id',last_row->'id') else null end);
end$$;
create function haedo_rss_private.control(p_connection_id uuid,p_expected_revision bigint,p_action text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid();c haedo_rss_private.connections%rowtype;next_status text;
begin
 if who is null then raise exception using errcode='42501',message='rss_auth_required';end if;
 if p_action is null or p_action not in('activate','pause','resume','retry','disconnect') then raise exception using errcode='22023',message='rss_invalid_action';end if;
 select * into c from haedo_rss_private.connections where id=p_connection_id and owner_id=who for update;
 if not found then raise exception using errcode='42501',message='rss_not_found';end if;
 if p_expected_revision is null or c.revision<>p_expected_revision or c.status='disconnected' then raise exception using errcode='PT409',message='rss_conflict';end if;
 next_status:=c.status;
 if p_action='activate' then
  if c.status<>'preview' or c.baseline_at is null then raise exception using errcode='PT409',message='rss_baseline_required';end if;
  next_status:='active';
 elsif p_action='pause' then
  if c.status<>'active' then raise exception using errcode='PT409',message='rss_not_active';end if;next_status:='paused';
 elsif p_action='resume' then
  if c.status<>'paused' then raise exception using errcode='PT409',message='rss_not_paused';end if;next_status:='active';
 elsif p_action='retry' then
  if c.status not in('pending','active') or c.last_error is null then raise exception using errcode='PT409',message='rss_retry_unavailable';end if;
  if c.retry_window_at>clock_timestamp()-interval '60 minutes' and c.retry_count>=2 then raise exception using errcode='PT409',message='rss_retry_limit';end if;
 else next_status:='disconnected';end if;
 update haedo_rss_private.connections set status=next_status,revision=revision+1,lease_token=null,lease_until=null,
 activated_at=case when p_action='activate' then clock_timestamp() else activated_at end,
 next_check_at=case when p_action in('activate','retry') then clock_timestamp() else next_check_at end,
 retry_count=case when p_action='retry' then case when retry_window_at>clock_timestamp()-interval '60 minutes' then retry_count+1 else 1 end else retry_count end,
 retry_window_at=case when p_action='retry' and (retry_window_at is null or retry_window_at<=clock_timestamp()-interval '60 minutes') then clock_timestamp() else retry_window_at end,
 last_error=case when p_action='retry' then null else last_error end where id=c.id returning * into c;
 return haedo_rss_private.view_connection(c);
end$$;
create function haedo_rss_private.claim(p_connection_id uuid,p_owner_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c haedo_rss_private.connections%rowtype;
begin
 if p_connection_id is null or p_owner_id is null then raise exception using errcode='22023',message='rss_invalid_claim';end if;
 perform 1 from haedo_rss_private.runtime where singleton and ready for share;if not found then return null;end if;
 select * into c from haedo_rss_private.connections where id=p_connection_id and owner_id=p_owner_id
 and feed_url=any((select allowed_feed_urls from haedo_rss_private.runtime where singleton)::text[]) and status in('pending','active') and next_check_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp()) for update skip locked;
 if not found then return null;end if;
 update haedo_rss_private.connections set baseline_started_at=coalesce(baseline_started_at,clock_timestamp()),lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes' where id=c.id returning * into c;
 return to_jsonb(c)||jsonb_build_object('connection_id',c.id,'cursor',case when c.status='active' then null else c.cursor end);
end$$;
create function haedo_rss_private.finish(p_connection_id uuid,p_lease_token uuid,p_revision bigint,p_items jsonb,p_next_cursor text,p_complete boolean,p_error text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c haedo_rss_private.connections%rowtype;r haedo_rss_private.receipts%rowtype;o haedo_rss_private.observations%rowtype;
 request_hash bytea;item jsonb;published timestamptz;reason text;itemhash bytea;result jsonb;stamp timestamptz:=clock_timestamp();inserted integer:=0;held integer:=0;n integer;seen_baseline boolean;
begin
 if p_connection_id is null or p_lease_token is null or p_revision is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 or octet_length(p_items::text)>4194304 or p_complete is null
 or (p_next_cursor is not null and (octet_length(p_next_cursor)>2048 or p_complete)) or (not p_complete and p_next_cursor is null and p_error is null)
 or (p_error is not null and (p_error !~ '^[a-z_]{1,80}$' or p_complete)) then raise exception using errcode='22023',message='rss_invalid_result';end if;
 if (select coalesce(sum(octet_length(e->>'content_text')),0) from jsonb_array_elements(p_items) e)>2097152 then raise exception using errcode='22023',message='rss_text_limit';end if;
 request_hash:=sha256(convert_to(jsonb_build_array(p_revision,p_items,p_next_cursor,p_complete,p_error)::text,'UTF8'));
 select * into c from haedo_rss_private.connections where id=p_connection_id for update;
 if not found then return jsonb_build_object('status','stale','inserted',0,'held',0);end if;
 select * into r from haedo_rss_private.receipts where connection_id=c.id and lease_token=p_lease_token;
 if found then
  if r.request_hash<>request_hash then raise exception using errcode='PT409',message='rss_receipt_mismatch';end if;return r.result;
 end if;
 perform 1 from haedo_rss_private.runtime where singleton and ready for share;
 if not found or not(c.feed_url=any((select allowed_feed_urls from haedo_rss_private.runtime where singleton)::text[])) or c.revision<>p_revision or c.lease_token is distinct from p_lease_token or c.lease_until<=stamp or c.status not in('pending','active') then return jsonb_build_object('status','stale','inserted',0,'held',0);end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item)<>'object' or not(item ?& array['identity','title','url','content_text','content_hash','published_at'])
   or exists(select 1 from jsonb_object_keys(item) k where k not in('identity','title','url','content_text','content_hash','published_at','hold_reason'))
   or jsonb_typeof(item->'identity')<>'string' or char_length(item->>'identity') not between 1 and 2048
   or jsonb_typeof(item->'title')<>'string' or char_length(item->>'title') not between 1 and 400 or btrim(item->>'title')=''
   or (item->'url'<>'null'::jsonb and (jsonb_typeof(item->'url')<>'string' or octet_length(item->>'url')>2048 or item->>'url' !~ '^https?://[^/@?#[:space:]]+'))
   or (item->>'hold_reason' is not null and item->>'hold_reason' not in('missing_identity','identity_conflict','invalid_date','content_too_large','missing_url','missing_content','unsupported_content','ambiguous_links')) then raise exception using errcode='22023',message='rss_invalid_item';end if;
  if item->'content_text'='null'::jsonb then
   if item->'content_hash'<>'null'::jsonb then raise exception using errcode='22023',message='rss_invalid_hash';end if;
  elsif jsonb_typeof(item->'content_text')<>'string' or octet_length(item->>'content_text')>2097152 or item->>'content_hash' is distinct from encode(sha256(convert_to(item->>'content_text','UTF8')),'hex') then raise exception using errcode='22023',message='rss_invalid_hash';end if;
  published:=null;
  if item->'published_at'<>'null'::jsonb then
   if jsonb_typeof(item->'published_at')<>'string' then raise exception using errcode='22023',message='rss_invalid_date';end if;
   begin published:=(item->>'published_at')::timestamptz;exception when others then raise exception using errcode='22023',message='rss_invalid_date';end;
   if not isfinite(published) then raise exception using errcode='22023',message='rss_invalid_date';end if;
  end if;
  select * into o from haedo_rss_private.observations where connection_id=c.id and identity=item->>'identity';
  reason:=item->>'hold_reason';seen_baseline:=found and o.baseline;
  if found and o.url is distinct from (item->>'url') then reason:='identity_conflict';end if;
  if exists(select 1 from jsonb_array_elements(p_items) other where other->>'identity'=item->>'identity' and (other->>'url') is distinct from (item->>'url')) then reason:='identity_conflict';end if;
  insert into haedo_rss_private.observations(connection_id,identity,url,baseline) values(c.id,item->>'identity',item->>'url',c.baseline_at is null) on conflict do nothing;
  -- Baseline is inventory only, and remains so even when a feed republishes it.
  if c.baseline_at is null then continue;end if;
  if seen_baseline and reason is null then continue;end if;
  if reason is null and item->>'url' is null then reason:='missing_url';end if;
  if reason is null and (item->>'content_text' is null or btrim(item->>'content_text')='') then reason:='missing_content';end if;
  if reason is null and octet_length(item->>'content_text')>1048576 then reason:='content_too_large';end if;
  if reason is null then
   if published is null then reason:='date_unknown';
   elsif published>stamp then reason:='future_date';
   elsif published<=c.baseline_started_at and not exists(select 1 from haedo_rss_private.items i where i.connection_id=c.id and i.identity=item->>'identity' and i.disposition='stored') then reason:='old_observed';end if;
  end if;
  itemhash:=sha256(convert_to(item::text||':'||coalesce(reason,''),'UTF8'));
  insert into haedo_rss_private.items(owner_id,connection_id,identity,title,url,content_text,content_hash,published_at,fetched_at,disposition,reason,item_hash)
   values(c.owner_id,c.id,item->>'identity',item->>'title',item->>'url',item->>'content_text',item->>'content_hash',published,stamp,case when reason is null then 'stored' else 'held' end,reason,itemhash) on conflict do nothing;
  get diagnostics n=row_count;if reason is null then inserted:=inserted+n;else held:=held+n;end if;
 end loop;
 update haedo_rss_private.connections set lease_token=null,lease_until=null,last_checked_at=stamp,last_error=p_error,
 cursor=case when status='active' or p_complete then null when p_next_cursor is not null then p_next_cursor else cursor end,
 baseline_count=(select count(*) from haedo_rss_private.observations where connection_id=c.id and baseline),
 baseline_at=case when baseline_at is null and p_complete then stamp else baseline_at end,
 status=case when baseline_at is null and p_complete then 'preview' else status end,
 next_check_at=case when status='pending' and not p_complete and p_error is null then stamp else stamp+interval '60 minutes' end
 where id=c.id returning * into c;
 result:=jsonb_build_object('status',case when p_error is not null then 'error' when p_complete then 'stored' else 'partial' end,'inserted',inserted,'held',held,'baseline_count',c.baseline_count,'cursor',c.cursor);
 insert into haedo_rss_private.receipts values(c.id,p_lease_token,request_hash,result);
 return result;
end$$;

create function haedo_rss_private.due(p_limit integer default 2) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_limit is null or p_limit not between 1 and 2 then raise exception using errcode='22023',message='rss_invalid_limit';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('connection_id',id,'owner_id',owner_id,'workspace_id',workspace_id)),'[]') from (
 select c.* from haedo_rss_private.connections c join haedo_rss_private.runtime r on r.singleton and r.ready
 where c.status in('pending','active') and c.feed_url=any(r.allowed_feed_urls) and c.next_check_at<=clock_timestamp() and (c.lease_until is null or c.lease_until<=clock_timestamp()) order by c.next_check_at,c.id limit p_limit) q);
end$$;
-- Bounded observation lookup for the current page: never transmit the entire
-- lifetime identity set. Worker commit still requires its independent lease.
create function haedo_rss_private.known(p_connection_id uuid,p_owner_id uuid,p_identities jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_connection_id is null or p_owner_id is null or p_identities is null or jsonb_typeof(p_identities)<>'array' or jsonb_array_length(p_identities)>100
 or exists(select 1 from jsonb_array_elements(p_identities) v where jsonb_typeof(v)<>'string' or char_length(v#>>'{}') not between 1 and 2048) then raise exception using errcode='22023',message='rss_invalid_identities';end if;
 if not exists(select 1 from haedo_rss_private.connections c join haedo_rss_private.runtime r on r.singleton and r.ready
 where c.id=p_connection_id and c.owner_id=p_owner_id and c.status='active' and c.feed_url=any(r.allowed_feed_urls)) then return '[]'::jsonb;end if;
 return (select coalesce(jsonb_agg(identity order by identity),'[]') from haedo_rss_private.observations where connection_id=p_connection_id and identity in(select v#>>'{}' from jsonb_array_elements(p_identities) v));
end$$;
create function public.life_rss_known(p_connection_id uuid,p_owner_id uuid,p_identities jsonb) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_rss_private.known(p_connection_id,p_owner_id,p_identities)$$;
create function public.life_rss_due(p_limit integer default 2) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_rss_private.due(p_limit)$$;
create function public.life_rss_save(p_workspace_id uuid,p_feed_url text) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_rss_private.save(p_workspace_id,p_feed_url)$$;
create function public.life_rss_list(p_workspace_id uuid,p_before jsonb default null) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_rss_private.list(p_workspace_id,p_before)$$;
create function public.life_rss_control(p_connection_id uuid,p_expected_revision bigint,p_action text) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_rss_private.control(p_connection_id,p_expected_revision,p_action)$$;
create function public.life_rss_claim(p_connection_id uuid,p_owner_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_rss_private.claim(p_connection_id,p_owner_id)$$;
create function public.life_rss_finish(p_connection_id uuid,p_lease_token uuid,p_revision bigint,p_items jsonb,p_next_cursor text,p_complete boolean,p_error text) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_rss_private.finish(p_connection_id,p_lease_token,p_revision,p_items,p_next_cursor,p_complete,p_error)$$;
revoke all on all functions in schema haedo_rss_private from public,anon,authenticated,service_role;
revoke all on function public.life_rss_save(uuid,text),public.life_rss_list(uuid,jsonb),public.life_rss_control(uuid,bigint,text),public.life_rss_claim(uuid,uuid),public.life_rss_finish(uuid,uuid,bigint,jsonb,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function haedo_rss_private.save(uuid,text),haedo_rss_private.list(uuid,jsonb),haedo_rss_private.control(uuid,bigint,text),public.life_rss_save(uuid,text),public.life_rss_list(uuid,jsonb),public.life_rss_control(uuid,bigint,text) to authenticated;
grant execute on function haedo_rss_private.claim(uuid,uuid),haedo_rss_private.finish(uuid,uuid,bigint,jsonb,text,boolean,text),public.life_rss_claim(uuid,uuid),public.life_rss_finish(uuid,uuid,bigint,jsonb,text,boolean,text) to service_role;
revoke all on function public.life_rss_due(integer) from public,anon,authenticated,service_role;
grant execute on function haedo_rss_private.due(integer),public.life_rss_due(integer) to service_role;
revoke all on function public.life_rss_known(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function haedo_rss_private.known(uuid,uuid,jsonb),public.life_rss_known(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
