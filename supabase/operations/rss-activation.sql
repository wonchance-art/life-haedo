-- ADMIN OPERATIONS ONLY. The checked-in file INSPECTS; it does not activate RSS.
-- This entire file is ONE statement. Edit the constants INSIDE its DO block;
-- never prepend SET LOCAL/BEGIN or depend on SQL Editor retaining a session.
-- Keep this block intact: any failed prerequisite or postcondition rolls back
-- all changes. Concurrent row-count/state changes also fail conservatively.
-- Run only the reviewed file under the administrative role. No secret values
-- belong here, in query results, logs, or the repository. See rss-activation.md.
-- To activate, change action to 'activate', replace the one approved feed URL,
-- and mark both reviews 'verified' only after the checklist evidence exists.
-- Review flags are operator attestations, not automatic deployment verification.
-- This operation changes only runtime.ready/allowed_feed_urls; no subscriptions,
-- existing inbox data, schedules, grants or RLS policies are changed.
do $rss_activation$
<<rss_activation>>
declare
  action text := 'inspect';
  feed_url text := '__RSS_FEED_URL__';
  feed_review text := 'pending';
  edge_review text := 'pending';
  host text;
  rss_job_before jsonb := '[]'::jsonb;
  rss_job_after jsonb := '[]'::jsonb;
  before_counts jsonb := '{}'::jsonb;
  after_counts jsonb := '{}'::jsonb;
  runtime_before jsonb;
  runtime_after jsonb;
  other_jobs_before jsonb := '[]'::jsonb;
  other_jobs_after jsonb := '[]'::jsonb;
  status_before jsonb;
  status_after jsonb;
  rss_jobs_before bigint := 0;
  rss_jobs_after bigint := 0;
  job_name constant text := 'haedo-rss-poll';
  r record;
  n bigint;
begin
  if action not in ('inspect','activate') then raise exception 'Unknown RSS activation operation'; end if;
  if to_regclass('haedo_rss_private.runtime') is null then
    raise exception 'RSS migration must be installed first';
  end if;
  -- Serialize these operations; no application data is changed by this lock.
  perform pg_advisory_xact_lock(hashtextextended('haedo:rss-operations', 0));
  select to_jsonb(t) into runtime_before
    from haedo_rss_private.runtime t where singleton for update;
  if runtime_before is null then raise exception 'RSS runtime singleton is missing'; end if;

  for r in
    select format('%I.%I', s.nspname, c.relname) as relation
    from pg_class c join pg_namespace s on s.oid=c.relnamespace
    where c.relkind in ('r','p') and
      (s.nspname='public' or s.nspname like 'haedo\_%'
        or (s.nspname='storage' and c.relname='objects'))
    order by s.nspname, c.relname
  loop
    execute format('select count(*) from %s', r.relation) into n;
    before_counts := before_counts || jsonb_build_object(r.relation, n);
  end loop;
  select jsonb_build_object(
    'connection_states', (select coalesce(jsonb_object_agg(status, total), '{}'::jsonb)
      from (select status, count(*) as total from haedo_rss_private.connections group by status) s),
    'connection_errors', (select count(*) from haedo_rss_private.connections where last_error is not null))
    into status_before;
  if to_regclass('cron.job') is not null then
    execute 'select coalesce(jsonb_agg(to_jsonb(j) order by jobid), ''[]''::jsonb) from cron.job j where jobname is distinct from $1'
      into other_jobs_before using job_name;
    execute 'select count(*) from cron.job where jobname=$1' into rss_jobs_before using job_name;
  end if;
  -- Counts/state only: never print feed URLs, document bodies, Vault values,
  -- cron.command or pg_net request headers.
  raise notice 'RSS before: ready=%, allowed_url_count=%, rss_jobs=%, state=%, rows=%',
    runtime_before->'ready', jsonb_array_length(runtime_before->'allowed_feed_urls'),
    rss_jobs_before, status_before, before_counts;
  if to_regclass('cron.job') is not null then
    execute 'select coalesce(jsonb_agg(to_jsonb(j) order by jobid), ''[]''::jsonb) from cron.job j where jobname=$1'
      into rss_job_before using job_name;
  end if;
  if action='activate' then
    if feed_review is distinct from 'verified' or edge_review is distinct from 'verified' then
      raise exception 'Approved feed and deployed Edge verification are required';
    end if;
    host := substring(feed_url from '^https://([^/?#]+)');
    -- Require the exact canonical HTTPS URL reviewed alongside ALLOWED_HOSTS.
    -- This local syntax gate is not a DNS/rights check or proof of Edge contents.
    if feed_url is null or feed_url='__RSS_FEED_URL__' or octet_length(feed_url)>2048
      or feed_url !~ '^https://[^/@?#:]+/' or feed_url ~ '[[:space:]#]' or position(chr(92) in feed_url)>0 or feed_url ~ '[^ -~]'
      or host is null or host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      or host ~ '(^|[.])(0x[0-9a-f]+|[0-9]+)$'
      or host='metadata.google.internal' or host ~ '[.](localhost|local|internal|lan)$'
      or feed_url ~ '/([.]{1,2})(/|[?]|$)' or feed_url ~* '%2e'
    then raise exception 'One reviewed canonical public HTTPS feed URL is required'; end if;
    if exists(select 1 from haedo_rss_private.connections c
      where c.status<>'disconnected' and c.feed_url is distinct from rss_activation.feed_url) then
      raise exception 'An existing connection uses a different feed; no connection was changed';
    end if;
    update haedo_rss_private.runtime set ready=true,
      allowed_feed_urls=array[rss_activation.feed_url] where singleton;
  end if;
  select to_jsonb(t) into runtime_after from haedo_rss_private.runtime t where singleton;
  if runtime_after is null then raise exception 'RSS runtime singleton disappeared; rolled back'; end if;
  for r in select key as relation, value::bigint as rows from jsonb_each_text(before_counts)
  loop
    execute format('select count(*) from %s', r.relation) into n;
    after_counts := after_counts || jsonb_build_object(r.relation, n);
    if n <> r.rows then
      raise exception 'Row count changed in % (% -> %); rolled back', r.relation, r.rows, n;
    end if;
  end loop;
  select jsonb_build_object(
    'connection_states', (select coalesce(jsonb_object_agg(status, total), '{}'::jsonb)
      from (select status, count(*) as total from haedo_rss_private.connections group by status) s),
    'connection_errors', (select count(*) from haedo_rss_private.connections where last_error is not null))
    into status_after;
  if status_after is distinct from status_before then
    raise exception 'RSS connection state changed; rolled back';
  end if;
  if to_regclass('cron.job') is not null then
    execute 'select coalesce(jsonb_agg(to_jsonb(j) order by jobid), ''[]''::jsonb) from cron.job j where jobname is distinct from $1'
      into other_jobs_after using job_name;
    execute 'select count(*) from cron.job where jobname=$1' into rss_jobs_after using job_name;
  end if;
  if other_jobs_after is distinct from other_jobs_before then
    raise exception 'An unrelated cron job changed; rolled back';
  end if;
  if to_regclass('cron.job') is not null then
    execute 'select coalesce(jsonb_agg(to_jsonb(j) order by jobid), ''[]''::jsonb) from cron.job j where jobname=$1'
      into rss_job_after using job_name;
  end if;
  if rss_job_after is distinct from rss_job_before then raise exception 'RSS schedule changed during activation; rolled back'; end if;
  if action='activate' then
    if runtime_after is distinct from (runtime_before || jsonb_build_object('ready',true,'allowed_feed_urls',jsonb_build_array(feed_url))) then
      raise exception 'Unexpected RSS runtime change; rolled back';
    end if;
  elsif runtime_after is distinct from runtime_before then raise exception 'Inspect changed RSS runtime; rolled back';
  end if;
  raise notice 'RSS after: ready=%, allowed_url_count=%, rss_jobs=%, state=%, rows=%',
    runtime_after->'ready', jsonb_array_length(runtime_after->'allowed_feed_urls'),
    rss_jobs_after, status_after, after_counts;
end
$rss_activation$;
