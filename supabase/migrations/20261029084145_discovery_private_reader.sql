-- Account-private, disposable reading cache. This does not publish content,
-- change the material library, or enable a scheduled collector.
begin;
create schema if not exists haedo_discovery_private;
revoke all on schema haedo_discovery_private from public,anon,authenticated,service_role;
grant usage on schema haedo_discovery_private to authenticated,service_role;

create table if not exists haedo_discovery_private.articles (
 owner_id uuid not null references auth.users(id) on delete cascade,
 source_id text not null, url text not null,
 content jsonb, content_hash text, content_bytes integer not null default 0,
 fetched_at timestamptz, expires_at timestamptz, next_attempt_at timestamptz not null default clock_timestamp(),
 lease_token uuid, lease_until timestamptz, session_id uuid,
 touched_at timestamptz not null default clock_timestamp(),
 primary key(owner_id,source_id,url),
 check(source_id in ('frontiers-psychology','mit-linguistics','llt-journal')),
 check(char_length(url) between 1 and 2048),
 check((lease_token is null and lease_until is null and session_id is null) or
       (lease_token is not null and lease_until is not null and session_id is not null)),
 check((content is null and content_hash is null and content_bytes=0 and fetched_at is null and expires_at is null) or
       (jsonb_typeof(content)='object' and content_hash is not null and content_hash=encode(sha256(convert_to(content::text,'UTF8')),'hex')
        and content_bytes=octet_length(content::text) and content_bytes between 1 and 2097152
        and fetched_at is not null and expires_at is not null))
);
create table if not exists haedo_discovery_private.limits (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 hour_started_at timestamptz not null, hour_count integer not null check(hour_count between 0 and 30),
 day_started_at timestamptz not null, day_count integer not null check(day_count between 0 and 120)
);
alter table haedo_discovery_private.articles enable row level security;
alter table haedo_discovery_private.limits enable row level security;
revoke all on haedo_discovery_private.articles,haedo_discovery_private.limits from public,anon,authenticated,service_role;
-- No direct table API: private definers below own explicit authorization.

create or replace function haedo_discovery_private.owner()
returns uuid language plpgsql stable security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid();sid text:=auth.jwt()->>'session_id';
begin
 if who is null or sid is null or sid !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 or not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
  where u.id=who and s.id=sid::uuid and not coalesce(u.is_anonymous,false)
   and (s.not_after is null or s.not_after>statement_timestamp())) then
  raise exception using errcode='42501',message='life_discovery_auth_required';
 end if;
 return who;
end $$;
create or replace function haedo_discovery_private.target_valid(source_id text,url text)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(char_length(url) between 1 and 2048 and url !~ '[[:space:]\\?#]' and
 case source_id when 'frontiers-psychology' then url ~ '^https://www[.]frontiersin[.]org/(journals/psychology/articles/|articles/)10[.]3389/fpsyg[.][0-9]{4}[.][0-9]{1,12}(/(full|xml))?$'
 when 'mit-linguistics' then url ~ '^https://news[.]mit[.]edu/[0-9]{4}/[A-Za-z0-9-]+$'
 when 'llt-journal' then url ~ '^https://www[.]lltjournal[.]org/item/[0-9]{1,12}-[0-9]{1,12}/$'
 else false end,false)
$$;
create or replace function haedo_discovery_private.reply(r haedo_discovery_private.articles,stale boolean)
returns jsonb language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_object('status','ready','sourceId',r.source_id,'url',r.url,
 'content',r.content,'contentHash',r.content_hash,'cached',true,'stale',stale)
$$;
create or replace function haedo_discovery_private.claim(p_source_id text,p_url text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=haedo_discovery_private.owner();stamp timestamptz:=clock_timestamp();
 r haedo_discovery_private.articles%rowtype;quota haedo_discovery_private.limits%rowtype;token uuid;
begin
 if not haedo_discovery_private.target_valid(p_source_id,p_url) then
  raise exception using errcode='22023',message='life_discovery_invalid_article';end if;
 perform pg_advisory_xact_lock(hashtextextended('life-discovery:'||who::text,0));
 select * into r from haedo_discovery_private.articles where owner_id=who and source_id=p_source_id and url=p_url for update;
 if found then
  if r.content is not null and r.expires_at>stamp then return haedo_discovery_private.reply(r,false);end if;
  if r.next_attempt_at>stamp or r.lease_until>stamp then
   return case when r.content is not null then haedo_discovery_private.reply(r,true)
    else jsonb_build_object('status',case when r.lease_until>stamp then 'busy' else 'unavailable' end) end;
  end if;
 end if;
 insert into haedo_discovery_private.limits values(who,stamp,0,stamp,0) on conflict(owner_id) do nothing;
 select * into quota from haedo_discovery_private.limits where owner_id=who for update;
 if quota.hour_started_at<=stamp-interval '1 hour' then quota.hour_started_at:=stamp;quota.hour_count:=0;end if;
 if quota.day_started_at<=stamp-interval '1 day' then quota.day_started_at:=stamp;quota.day_count:=0;end if;
 if quota.hour_count>=30 or quota.day_count>=120 then
  return case when r.content is not null then haedo_discovery_private.reply(r,true) else jsonb_build_object('status','rate_limited') end;
 end if;
 if (select count(*) from haedo_discovery_private.articles where owner_id=who and lease_until>stamp)>=2 then
  return case when r.content is not null then haedo_discovery_private.reply(r,true) else jsonb_build_object('status','busy') end;
 end if;
 if r.owner_id is null then
  if (select count(*) from haedo_discovery_private.articles where owner_id=who)>=100 then
   delete from haedo_discovery_private.articles where (owner_id,source_id,url) in
    (select owner_id,source_id,url from haedo_discovery_private.articles where owner_id=who and (lease_until is null or lease_until<=stamp) order by touched_at,source_id,url limit 1);
  end if;
  insert into haedo_discovery_private.articles(owner_id,source_id,url) values(who,p_source_id,p_url);
 end if;
 token:=gen_random_uuid();
 update haedo_discovery_private.articles set lease_token=token,lease_until=stamp+interval '90 seconds',
  session_id=(auth.jwt()->>'session_id')::uuid,touched_at=stamp where owner_id=who and source_id=p_source_id and url=p_url;
 update haedo_discovery_private.limits set hour_started_at=quota.hour_started_at,hour_count=quota.hour_count+1,
  day_started_at=quota.day_started_at,day_count=quota.day_count+1 where owner_id=who;
 return jsonb_build_object('status','claimed','leaseToken',token);
end $$;
create or replace function haedo_discovery_private.finish(p_owner_id uuid,p_source_id text,p_url text,p_lease_token uuid,p_content jsonb,p_error text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare stamp timestamptz:=clock_timestamp();r haedo_discovery_private.articles%rowtype;bytes integer;fetched timestamptz;
begin
 if p_owner_id is null or p_lease_token is null or not haedo_discovery_private.target_valid(p_source_id,p_url)
 or (p_error is not null and p_error not in ('unavailable','blocked','network_error','invalid_response'))
 or (p_error is null)=(p_content is null) then raise exception using errcode='22023',message='life_discovery_invalid_finish';end if;
 perform pg_advisory_xact_lock(hashtextextended('life-discovery:'||p_owner_id::text,0));
 select * into r from haedo_discovery_private.articles where owner_id=p_owner_id and source_id=p_source_id and url=p_url for update;
 if not found or r.lease_token is distinct from p_lease_token or r.lease_until<=stamp
 or not exists(select 1 from auth.sessions s where s.id=r.session_id and s.user_id=p_owner_id and (s.not_after is null or s.not_after>stamp)) then
  return jsonb_build_object('status','stale');end if;
 if p_error is null then
  bytes:=octet_length(p_content::text);
  if jsonb_typeof(p_content) is distinct from 'object' or bytes>2097152
   or not coalesce(p_content->>'coverage' in ('summary','full_text','link_only'),false)
   or p_content->'acquisition'->>'scope' is distinct from 'private_account'
   or jsonb_typeof(p_content->'summary') is distinct from 'string'
   or p_content->'rights'->>'mode' is distinct from 'private_reading'
   or not coalesce(p_content->'acquisition'->>'method' in ('publisher_xml','publisher_rss','publisher_html'),false)
   or not coalesce(p_content->'acquisition'->>'sourceUrl' ~ '^https://(www[.]frontiersin[.]org|news[.]mit[.]edu|www[.]lltjournal[.]org)/',false)
   or (p_content->>'coverage'='full_text' and (jsonb_typeof(p_content->'bodyText') is distinct from 'string' or char_length(p_content->>'bodyText')=0)) then
    raise exception using errcode='22023',message='life_discovery_invalid_content';end if;
  begin fetched:=(p_content->'acquisition'->>'fetchedAt')::timestamptz;
  exception when others then raise exception using errcode='22023',message='life_discovery_invalid_content';end;
  if fetched is null or fetched>stamp+interval '5 minutes' or fetched<stamp-interval '1 day' then
   raise exception using errcode='22023',message='life_discovery_invalid_content';end if;
  -- Keep all cached bodies and images within 32 MiB per owner, including races.
  while coalesce((select sum(content_bytes) from haedo_discovery_private.articles where owner_id=p_owner_id),0)-r.content_bytes+bytes>33554432 loop
   delete from haedo_discovery_private.articles where (owner_id,source_id,url) in
    (select owner_id,source_id,url from haedo_discovery_private.articles where owner_id=p_owner_id
     and (source_id,url)<>(p_source_id,p_url) and (lease_until is null or lease_until<=stamp)
     order by touched_at,source_id,url limit 1);
   if not found then raise exception using errcode='54000',message='life_discovery_cache_limit';end if;
  end loop;
  update haedo_discovery_private.articles set content=p_content,content_hash=encode(sha256(convert_to(p_content::text,'UTF8')),'hex'),
   content_bytes=bytes,fetched_at=fetched,expires_at=stamp+interval '1 day',next_attempt_at=stamp+interval '1 day',
   lease_token=null,lease_until=null,session_id=null,touched_at=stamp
   where owner_id=p_owner_id and source_id=p_source_id and url=p_url returning * into r;
  return haedo_discovery_private.reply(r,false)||jsonb_build_object('cached',false);
 end if;
 update haedo_discovery_private.articles set next_attempt_at=stamp+interval '15 minutes',
  lease_token=null,lease_until=null,session_id=null,touched_at=stamp where owner_id=p_owner_id and source_id=p_source_id and url=p_url;
 return case when r.content is not null then haedo_discovery_private.reply(r,true) else jsonb_build_object('status','unavailable') end;
end $$;

create or replace function public.life_discovery_article_claim(p_source_id text,p_url text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_discovery_private.claim(p_source_id,p_url)$$;
create or replace function public.life_discovery_article_finish(p_owner_id uuid,p_source_id text,p_url text,p_lease_token uuid,p_content jsonb,p_error text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_discovery_private.finish(p_owner_id,p_source_id,p_url,p_lease_token,p_content,p_error)$$;
revoke all on all functions in schema haedo_discovery_private from public,anon,authenticated,service_role;
grant execute on function haedo_discovery_private.claim(text,text) to authenticated;
grant execute on function haedo_discovery_private.finish(uuid,text,text,uuid,jsonb,text) to service_role;
revoke all on function public.life_discovery_article_claim(text,text),public.life_discovery_article_finish(uuid,text,text,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.life_discovery_article_claim(text,text) to authenticated;
grant execute on function public.life_discovery_article_finish(uuid,text,text,uuid,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
