-- ADMIN OPERATIONS ONLY. The checked-in file INSPECTS; it does not activate RSS.
-- This entire file is ONE statement. Edit the constants INSIDE its DO block;
-- never prepend SET LOCAL/BEGIN or depend on SQL Editor retaining a session.
-- Keep this block intact: any failed prerequisite or postcondition rolls back
-- all changes. Concurrent row-count/state changes also fail conservatively.
-- Run only the reviewed file under the administrative role. No secret values
-- belong here, in query results, logs, or the repository. See rss-activation.md.
-- To stop collection, change only action to 'rollback'. Existing connections,
-- cursors, leases, baseline observations, inbox bodies, receipts and exact URL
-- allowlist remain unchanged. Only ready=false and this RSS schedule are changed.
-- Requests already in flight may have read bytes; finish observes ready=false
-- and rejects new commits. Queued commands also check ready before HTTP dispatch.
do $rss_rollback$
declare
  action text := 'inspect';
  removed boolean;
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
  if action not in ('inspect','rollback') then raise exception 'Unknown RSS rollback operation'; end if;
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
  if action='rollback' then
    update haedo_rss_private.runtime set ready=false where singleton;
    if to_regclass('cron.job') is not null then
      if to_regprocedure('cron.unschedule(bigint)') is null then raise exception 'RSS schedule cannot be removed without pg_cron'; end if;
      -- An administrative operator can see and remove every exact-name RSS job;
      -- any unschedule failure rolls back ready and all removals together.
      for r in execute 'select jobid from cron.job where jobname=$1 order by jobid' using job_name loop
        execute 'select cron.unschedule($1)' into removed using r.jobid;
        if removed is distinct from true then raise exception 'RSS unschedule failed; rolled back'; end if;
      end loop;
    end if;
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
  if action='rollback' then
    if runtime_after is distinct from (runtime_before || '{"ready":false}'::jsonb) or rss_jobs_after<>0 then
      raise exception 'Unexpected RSS rollback state; rolled back';
    end if;
  elsif runtime_after is distinct from runtime_before or rss_jobs_after<>rss_jobs_before then
    raise exception 'Inspect changed RSS state; rolled back';
  end if;
  raise notice 'RSS after: ready=%, allowed_url_count=%, rss_jobs=%, state=%, rows=%',
    runtime_after->'ready', jsonb_array_length(runtime_after->'allowed_feed_urls'),
    rss_jobs_after, status_after, after_counts;
end
$rss_rollback$;
