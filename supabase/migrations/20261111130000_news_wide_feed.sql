-- Account-private cache and upstream-call allowance for the haedo-news-wide Edge function
-- (owner approval 2026-11-11, docs/design-review/news-wide-feed.md).
-- What is stored: the interest topics the owner typed into the news settings (personal data),
-- the link-only items an outside news aggregator returned for each topic, and call counters.
-- Nothing here is public: no anon access, no table API, rows are reachable only through the
-- definer functions below, each bound to the caller's own account.
--   claim  (authenticated, own account): cache read, per-account call allowance, 60 s lease.
--   finish (service_role, Edge function only): stores validated items or a retry delay.
--   clear  (authenticated, own account): removes the caller's own cached rows.
-- Who may use it: only accounts listed in allowed_accounts. This migration creates that table
-- EMPTY, so nobody can use the feature until the reviewed operations SQL
-- (supabase/operations/20261111-news-wide-allow-first-account.sql) adds the owner's account.
-- No function callable by anon, authenticated or service_role writes that table. An account
-- that is not listed gets the answer not_allowed: no row, no lease, no call is counted.
-- Numbers (changing one needs a new migration and the document above):
--   cache TTL 30 minutes; 60 upstream calls per hour and 600 per day per account;
--   30 items and 256 KiB per topic; 64 cached topics per account; rows untouched for 7 days
--   are removed on the same account's next claim; retry delay 5 minutes (30 after a refusal).
-- No existing schema, table, function, policy or row is read or changed.
begin;
create schema if not exists haedo_news_wide_private;
revoke all on schema haedo_news_wide_private from public,anon,authenticated,service_role;
grant usage on schema haedo_news_wide_private to authenticated,service_role;

-- The same rule as the Edge function (topics.mjs), as far as it can be written without Unicode
-- letter classes: 1-40 characters, NFC, single spaces, and none of
--   * control, invisible and direction characters, other spaces, invisible letters (fillers)
--   * " $ ( ) * : ; < = > @ [ ] ^ _ ` { | } ~ and the backslash, non-ASCII punctuation,
--     symbols and emoji
--   * a word that starts with - or +
--   * OR, AND, NOT between two other words
--   * an apostrophe or a hyphen next to a space, an allowed mark or the start or end
--     (only between two letters or digits: O'Reilly, K-pop, 3-1)
--   * two dots in a row (1..10)
-- and at least one character that is not one of the allowed marks  . & + # ' / - , % ! ?
-- (plus U+00B7 and U+2019). Every topic the Edge function accepts passes here; the Edge
-- function additionally requires every other character to be a letter, digit or mark.
-- Every non-ASCII character below is written as an escape on purpose: this file is ASCII,
-- so no invisible character can be lost when the text is copied.
-- The result does not depend on the caller's standard_conforming_strings: every literal with
-- an escape is an E'' string (read the same way under either setting), no literal holds a
-- backslash for the regular expression itself, and the backslash character is found with
-- chr(92).
create or replace function haedo_news_wide_private.topic_valid(p_topic text)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(char_length(p_topic) between 1 and 40 and p_topic is nfc normalized
  and p_topic = btrim(p_topic, ' ') and position('  ' in p_topic) = 0
  and p_topic !~ E'[\u0001-\u001f\u007f-\u00a0\u00ad\u034f\u061c\u115f\u1160\u1680\u17b4\u17b5\u180b-\u180f\u2000-\u2018\u201a-\u206f\u3000\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffd\U000E0000-\U000E01EF]'
  and p_topic !~ '[]["$()*:;<=>@^_`{|}~]' and position(chr(92) in p_topic) = 0
  and p_topic !~ E'[\u00a1-\u00a9\u00ab\u00ac\u00ae-\u00b1\u00b4\u00b6\u00b8\u00bb\u00bf\u00d7\u00f7\u2190-\u23ff\u2600-\u2775\u2794-\u27bf\u3001-\u3003\u3008-\u3020\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65\U0001F300-\U0001FAFF]'
  and p_topic !~ '(^| )[-+]'
  and p_topic !~ ' (OR|AND|NOT) '
  and p_topic !~ E'(^|[ .&+#/,%!?\u00b7\u2019''-])[''\u2019-]|[''\u2019-]($|[ .&+#/,%!?\u00b7\u2019''-])'
  and position('..' in p_topic) = 0
  and p_topic ~ E'[^ .&+#/,%!?\u00b7\u2019''-]', false)
$$;

-- Link-only items. Each one is exactly {id,title,link,publishedAt,sourceName,sourceUrl}; the
-- link must stay on the supplier's own host. No article body, summary or image is accepted.
create or replace function haedo_news_wide_private.items_valid(p_supplier text, p_items jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare i jsonb;
begin
 if p_supplier is distinct from 'google-news-rss' or p_items is null or jsonb_typeof(p_items) <> 'array' then return false; end if;
 if jsonb_array_length(p_items) > 30 or octet_length(p_items::text) > 262144 then return false; end if;
 for i in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(i) <> 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(i)) <> 6
   or not i ?& array['id','title','link','publishedAt','sourceName','sourceUrl'] then return false; end if;
  if not coalesce(jsonb_typeof(i->'id') = 'string' and i->>'id' ~ '^[a-f0-9]{32}$', false) then return false; end if;
  if not coalesce(jsonb_typeof(i->'title') = 'string' and char_length(i->>'title') between 1 and 300
   and i->>'title' !~ E'[\u0001-\u001f\u007f-\u009f]', false) then return false; end if;
  if not coalesce(jsonb_typeof(i->'link') = 'string' and char_length(i->>'link') <= 2048
   and i->>'link' ~ '^https://news[.]google[.]com/[!-~]*$' and position(E'\\' in i->>'link') = 0, false) then return false; end if;
  if not coalesce(jsonb_typeof(i->'publishedAt') = 'null' or (jsonb_typeof(i->'publishedAt') = 'string'
   and i->>'publishedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'), false) then return false; end if;
  if not coalesce(jsonb_typeof(i->'sourceName') = 'null' or (jsonb_typeof(i->'sourceName') = 'string'
   and char_length(i->>'sourceName') between 1 and 100 and i->>'sourceName' !~ E'[\u0001-\u001f\u007f-\u009f]'), false) then return false; end if;
  if not coalesce(jsonb_typeof(i->'sourceUrl') = 'null' or (jsonb_typeof(i->'sourceUrl') = 'string'
   and char_length(i->>'sourceUrl') <= 2048 and i->>'sourceUrl' ~ '^https://[!-~]+$'
   and position(E'\\' in i->>'sourceUrl') = 0), false) then return false; end if;
 end loop;
 return true;
end $$;

create table if not exists haedo_news_wide_private.feeds (
 owner_id uuid not null references auth.users(id) on delete cascade,
 supplier text not null check (supplier in ('google-news-rss')),
 language text not null check (language in ('ko','en')),
 topic text not null check (haedo_news_wide_private.topic_valid(topic)),
 items jsonb, item_count integer not null default 0, items_bytes integer not null default 0,
 fetched_at timestamptz,
 next_attempt_at timestamptz not null default clock_timestamp(),
 lease_token uuid, lease_until timestamptz,
 touched_at timestamptz not null default clock_timestamp(),
 primary key (owner_id, supplier, language, topic),
 check ((lease_token is null) = (lease_until is null)),
 check ((items is null and item_count = 0 and items_bytes = 0 and fetched_at is null) or
        (items is not null and haedo_news_wide_private.items_valid(supplier, items)
         and item_count = jsonb_array_length(items) and items_bytes = octet_length(items::text)
         and fetched_at is not null))
);
create table if not exists haedo_news_wide_private.limits (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 hour_started_at timestamptz not null, hour_count integer not null check (hour_count between 0 and 60),
 day_started_at timestamptz not null, day_count integer not null check (day_count between 0 and 600)
);
-- The accounts that may use the feature. Created empty: nobody is allowed until the operations
-- SQL adds the owner's account. No account ID is written in the repository.
create table if not exists haedo_news_wide_private.allowed_accounts (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 added_at timestamptz not null default clock_timestamp()
);
alter table haedo_news_wide_private.feeds enable row level security;
alter table haedo_news_wide_private.limits enable row level security;
alter table haedo_news_wide_private.allowed_accounts enable row level security;
revoke all on haedo_news_wide_private.feeds, haedo_news_wide_private.limits, haedo_news_wide_private.allowed_accounts
 from public,anon,authenticated,service_role;
-- No policy and no direct table API: the definer functions below own every authorization.

-- The signed-in, non-anonymous account with a still-live session (same rule as the private reader).
create or replace function haedo_news_wide_private.owner()
returns uuid language plpgsql stable security definer set search_path=pg_catalog as $$
declare who uuid := auth.uid(); sid text := auth.jwt()->>'session_id';
begin
 if who is null or sid is null or sid !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or not exists (select 1 from auth.users u join auth.sessions s on s.user_id = u.id
   where u.id = who and s.id = sid::uuid and not coalesce(u.is_anonymous, false)
    and (s.not_after is null or s.not_after > statement_timestamp())) then
  raise exception using errcode='42501', message='life_news_wide_auth_required';
 end if;
 return who;
end $$;

-- One call for the whole request. An account that is not on the allow list gets
-- {"status":"not_allowed"} before anything is validated, created or counted. Otherwise the
-- answer is {"status":"ok","entries":[...]} and every {topic, language} gets a state.
--   fresh    cached within the TTL (no upstream call is allowed for it)
--   claimed  the caller may fetch it once; one call is counted and a 60 s lease is issued
--   busy     another request holds the lease
--   backoff  the last upstream attempt failed recently
--   limited  the account's hourly or daily allowance is used up ("limit": hour|day)
-- Cached items come back with every state that has them, with "expired" when past the TTL.
create or replace function haedo_news_wide_private.claim(p_supplier text, p_requests jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid := haedo_news_wide_private.owner(); stamp timestamptz;
 quota haedo_news_wide_private.limits%rowtype; r haedo_news_wide_private.feeds%rowtype;
 e jsonb; v_topic text; v_language text; seen text[] := array[]::text[]; entries jsonb := '[]'::jsonb;
 present boolean; has boolean; expired boolean; state text; reason text; token uuid;
begin
 if not exists (select 1 from haedo_news_wide_private.allowed_accounts a where a.owner_id = who) then
  return jsonb_build_object('status', 'not_allowed'); end if;
 if p_supplier is distinct from 'google-news-rss' or p_requests is null or jsonb_typeof(p_requests) <> 'array' then
  raise exception using errcode='22023', message='life_news_wide_invalid_request'; end if;
 if jsonb_array_length(p_requests) not between 1 and 16 then
  raise exception using errcode='22023', message='life_news_wide_invalid_request'; end if;
 for e in select value from jsonb_array_elements(p_requests) loop
  if jsonb_typeof(e) <> 'object' then raise exception using errcode='22023', message='life_news_wide_invalid_request'; end if;
  if (select count(*) from jsonb_object_keys(e)) <> 2
   or jsonb_typeof(e->'topic') is distinct from 'string' or jsonb_typeof(e->'language') is distinct from 'string' then
   raise exception using errcode='22023', message='life_news_wide_invalid_request'; end if;
  if not haedo_news_wide_private.topic_valid(e->>'topic') or e->>'language' not in ('ko','en')
   or ((e->>'language') || ' ' || (e->>'topic')) = any(seen) then
   raise exception using errcode='22023', message='life_news_wide_invalid_request'; end if;
  seen := seen || ((e->>'language') || ' ' || (e->>'topic'));
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('life-news-wide:' || who::text, 0));
 stamp := clock_timestamp(); -- read after the lock: a request that waited sees the time it really starts
 -- Retention: this account's rows nobody asked for in 7 days. No other account, no other table.
 delete from haedo_news_wide_private.feeds where owner_id = who and touched_at < stamp - interval '7 days'
  and (lease_until is null or lease_until <= stamp);
 insert into haedo_news_wide_private.limits values (who, stamp, 0, stamp, 0) on conflict (owner_id) do nothing;
 select * into quota from haedo_news_wide_private.limits where owner_id = who for update;
 if quota.hour_started_at <= stamp - interval '1 hour' then quota.hour_started_at := stamp; quota.hour_count := 0; end if;
 if quota.day_started_at <= stamp - interval '1 day' then quota.day_started_at := stamp; quota.day_count := 0; end if;
 for e in select value from jsonb_array_elements(p_requests) loop
  v_topic := e->>'topic'; v_language := e->>'language'; token := null; reason := null;
  select * into r from haedo_news_wide_private.feeds
   where owner_id = who and supplier = p_supplier and language = v_language and topic = v_topic for update;
  present := found;
  has := present and r.items is not null;
  expired := has and r.fetched_at <= stamp - interval '30 minutes';
  if has and not expired then state := 'fresh';
  elsif present and r.lease_until > stamp then state := 'busy';
  elsif present and r.next_attempt_at > stamp then state := 'backoff';
  elsif quota.hour_count >= 60 then state := 'limited'; reason := 'hour';
  elsif quota.day_count >= 600 then state := 'limited'; reason := 'day';
  else
   state := 'claimed'; token := gen_random_uuid();
   if not present then
    -- At most 64 topics per account: the least recently used rows of THIS account go until
    -- there is room (rows being fetched right now are kept, so the count can pass 64 for a
    -- moment and is brought back down here on the next new topic).
    while (select count(*) from haedo_news_wide_private.feeds where owner_id = who) >= 64 loop
     delete from haedo_news_wide_private.feeds where (owner_id, supplier, language, topic) in
      (select owner_id, supplier, language, topic from haedo_news_wide_private.feeds
        where owner_id = who and (lease_until is null or lease_until <= stamp)
        order by touched_at, supplier, language, topic limit 1);
     exit when not found;
    end loop;
    insert into haedo_news_wide_private.feeds(owner_id, supplier, language, topic) values (who, p_supplier, v_language, v_topic);
   end if;
   update haedo_news_wide_private.feeds set lease_token = token, lease_until = stamp + interval '60 seconds'
    where owner_id = who and supplier = p_supplier and language = v_language and topic = v_topic;
   quota.hour_count := quota.hour_count + 1; quota.day_count := quota.day_count + 1;
  end if;
  update haedo_news_wide_private.feeds set touched_at = stamp
   where owner_id = who and supplier = p_supplier and language = v_language and topic = v_topic;
  entries := entries || jsonb_build_object('topic', v_topic, 'language', v_language, 'status', state,
   'items', case when has then r.items end, 'fetchedAt', case when has then r.fetched_at end,
   'expired', expired, 'leaseToken', token, 'limit', reason);
 end loop;
 update haedo_news_wide_private.limits set hour_started_at = quota.hour_started_at, hour_count = quota.hour_count,
  day_started_at = quota.day_started_at, day_count = quota.day_count where owner_id = who;
 return jsonb_build_object('status', 'ok', 'entries', entries);
end $$;

-- The Edge function reports each claimed topic once: validated items, or why the call failed.
-- A result whose lease is gone or expired changes nothing ("stale"). Invalid input rolls the
-- whole call back, so nothing half-validated is stored. An owner who is not on the allow list
-- (removed since the claim) gets {"status":"not_allowed"} and nothing is stored.
create or replace function haedo_news_wide_private.finish(p_owner_id uuid, p_supplier text, p_results jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare stamp timestamptz; r haedo_news_wide_private.feeds%rowtype;
 e jsonb; v_items jsonb; v_error text; stored integer := 0; failed integer := 0; stale integer := 0;
begin
 if p_owner_id is null or p_supplier is distinct from 'google-news-rss' or p_results is null
  or jsonb_typeof(p_results) <> 'array' then
  raise exception using errcode='22023', message='life_news_wide_invalid_finish'; end if;
 if jsonb_array_length(p_results) not between 1 and 16 then
  raise exception using errcode='22023', message='life_news_wide_invalid_finish'; end if;
 if not exists (select 1 from haedo_news_wide_private.allowed_accounts a where a.owner_id = p_owner_id) then
  return jsonb_build_object('status', 'not_allowed', 'stored', 0, 'failed', 0, 'stale', 0); end if;
 for e in select value from jsonb_array_elements(p_results) loop
  if jsonb_typeof(e) <> 'object' then raise exception using errcode='22023', message='life_news_wide_invalid_finish'; end if;
  if exists (select 1 from jsonb_object_keys(e) k where k not in ('topic','language','leaseToken','items','error'))
   or jsonb_typeof(e->'topic') is distinct from 'string' or jsonb_typeof(e->'language') is distinct from 'string'
   or jsonb_typeof(e->'leaseToken') is distinct from 'string' then
   raise exception using errcode='22023', message='life_news_wide_invalid_finish'; end if;
  if not haedo_news_wide_private.topic_valid(e->>'topic') or e->>'language' not in ('ko','en')
   or e->>'leaseToken' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
   raise exception using errcode='22023', message='life_news_wide_invalid_finish'; end if;
  v_items := nullif(e->'items', 'null'::jsonb); v_error := e->>'error';
  if (v_items is null) = (v_error is null)
   or (v_error is not null and (jsonb_typeof(e->'error') <> 'string'
    or v_error not in ('network_error','rate_limited','blocked','invalid_response','not_attempted'))) then
   raise exception using errcode='22023', message='life_news_wide_invalid_finish'; end if;
  if v_items is not null and not haedo_news_wide_private.items_valid(p_supplier, v_items) then
   raise exception using errcode='22023', message='life_news_wide_invalid_items'; end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('life-news-wide:' || p_owner_id::text, 0));
 stamp := clock_timestamp();
 for e in select value from jsonb_array_elements(p_results) loop
  v_items := nullif(e->'items', 'null'::jsonb); v_error := e->>'error';
  select * into r from haedo_news_wide_private.feeds
   where owner_id = p_owner_id and supplier = p_supplier and language = e->>'language' and topic = e->>'topic' for update;
  if not found or r.lease_token is distinct from (e->>'leaseToken')::uuid or r.lease_until <= stamp then
   stale := stale + 1; continue; end if;
  if v_items is not null then
   update haedo_news_wide_private.feeds set items = v_items, item_count = jsonb_array_length(v_items),
    items_bytes = octet_length(v_items::text), fetched_at = stamp, next_attempt_at = stamp,
    lease_token = null, lease_until = null, touched_at = stamp
    where owner_id = p_owner_id and supplier = p_supplier and language = e->>'language' and topic = e->>'topic';
   stored := stored + 1;
  else
   update haedo_news_wide_private.feeds set next_attempt_at = stamp + case
     when v_error in ('rate_limited','blocked') then interval '30 minutes'
     when v_error = 'not_attempted' then interval '0'
     else interval '5 minutes' end,
    lease_token = null, lease_until = null, touched_at = stamp
    where owner_id = p_owner_id and supplier = p_supplier and language = e->>'language' and topic = e->>'topic';
   failed := failed + 1;
  end if;
 end loop;
 return jsonb_build_object('status', 'ok', 'stored', stored, 'failed', failed, 'stale', stale);
end $$;

-- Turning the setting off: the account removes its own cached topics and items. The call
-- counters stay, so clearing never buys a new allowance. An account that is not on the allow
-- list gets "not_allowed"; rows it may still have from an earlier time are removed all the same.
create or replace function haedo_news_wide_private.clear()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid := haedo_news_wide_private.owner(); removed integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('life-news-wide:' || who::text, 0));
 delete from haedo_news_wide_private.feeds where owner_id = who;
 get diagnostics removed = row_count;
 return jsonb_build_object('status', case when exists (select 1 from haedo_news_wide_private.allowed_accounts a where a.owner_id = who)
  then 'cleared' else 'not_allowed' end, 'removed', removed);
end $$;

create or replace function public.life_news_wide_claim(p_supplier text, p_requests jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$ select haedo_news_wide_private.claim(p_supplier, p_requests) $$;
create or replace function public.life_news_wide_finish(p_owner_id uuid, p_supplier text, p_results jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$ select haedo_news_wide_private.finish(p_owner_id, p_supplier, p_results) $$;
create or replace function public.life_news_wide_clear()
returns jsonb language sql security invoker set search_path=pg_catalog as $$ select haedo_news_wide_private.clear() $$;

revoke all on all functions in schema haedo_news_wide_private from public,anon,authenticated,service_role;
grant execute on function haedo_news_wide_private.claim(text,jsonb), haedo_news_wide_private.clear() to authenticated;
grant execute on function haedo_news_wide_private.finish(uuid,text,jsonb) to service_role;
revoke all on function public.life_news_wide_claim(text,jsonb), public.life_news_wide_finish(uuid,text,jsonb),
 public.life_news_wide_clear() from public,anon,authenticated,service_role;
grant execute on function public.life_news_wide_claim(text,jsonb), public.life_news_wide_clear() to authenticated;
grant execute on function public.life_news_wide_finish(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
