-- ADMIN OPERATIONS ONLY. The checked-in file INSPECTS; it does not activate RSS.
-- This entire file is ONE statement. Edit the constants INSIDE its DO block;
-- never prepend SET LOCAL/BEGIN or depend on SQL Editor retaining a session.
-- Keep this block intact: any failed prerequisite or postcondition rolls back
-- all changes. Concurrent row-count/state changes also fail conservatively.
-- Run only the reviewed file under the administrative role. No secret values
-- belong here, in query results, logs, or the repository. See rss-activation.md.
-- To register/update only haedo-rss-poll, set action='schedule' and attest the
-- reviewed deployment. Provision the two named Vault entries privately first.
-- Worker dispatch is every minute; DB next_check_at still enforces each feed's
-- 60-minute normal collection interval. Each run processes at most 2 connections.
-- This does not create extensions or change connection status/runtime gates.
do $rss_cron$
declare
  action text := 'inspect';
  edge_review text := 'pending';
  schedule_text constant text := '* * * * *';
  valid boolean;
  installed_id bigint;
  old_job jsonb;
  new_job jsonb;
  command_text constant text := $job$
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='haedo_rss_project_url') || '/functions/v1/haedo-rss',
  headers := jsonb_build_object('Content-Type','application/json','apikey',
    (select decrypted_secret from vault.decrypted_secrets where name='haedo_rss_service_role_key')),
  body := '{"action":"run"}'::jsonb,
  timeout_milliseconds := 120000
)
where exists(select 1 from haedo_rss_private.runtime where singleton and ready);
$job$;
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
  if action not in ('inspect','schedule') then raise exception 'Unknown RSS cron operation'; end if;
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
  if action='schedule' then
    if edge_review is distinct from 'verified' then raise exception 'Deployed Edge verification is required'; end if;
    if runtime_before->'ready' is distinct from 'true'::jsonb
      or jsonb_array_length(runtime_before->'allowed_feed_urls')<>1 then
      raise exception 'Activate the reviewed RSS feed before scheduling';
    end if;
    if to_regclass('cron.job') is null or to_regprocedure('cron.schedule(text,text,text)') is null
      or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
      raise exception 'pg_cron and pg_net must be installed first';
    end if;
    if to_regclass('vault.decrypted_secrets') is null then raise exception 'Vault provisioning is required'; end if;
    execute $check$select count(*)=1 and bool_and(decrypted_secret ~ '^https://[a-z0-9-]+[.]supabase[.]co$')
      from vault.decrypted_secrets where name='haedo_rss_project_url'$check$ into valid;
    if not coalesce(valid,false) then raise exception 'Exactly one valid named project URL is required'; end if;
    execute $check$select count(*)=1 and bool_and(decrypted_secret ~ '^sb_secret_[A-Za-z0-9_-]{16,255}$'
      or decrypted_secret ~ '^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$')
      from vault.decrypted_secrets where name='haedo_rss_service_role_key'$check$ into valid;
    if not coalesce(valid,false) then raise exception 'Exactly one server-only named worker credential is required'; end if;
    if rss_jobs_before>1 then raise exception 'Multiple RSS jobs require operator review'; end if;
    execute 'select to_jsonb(j) from cron.job j where jobname=$1' into old_job using job_name;
    if old_job is not null and (old_job->>'username' is distinct from current_user
      or old_job->>'database' is distinct from current_database()) then
      raise exception 'Existing RSS job belongs to a different database or role';
    end if;
    execute 'select cron.schedule($1,$2,$3)' into installed_id using job_name,schedule_text,command_text;
    execute 'select to_jsonb(j) from cron.job j where jobname=$1' into new_job using job_name;
    if new_job is null or (new_job->>'jobid')::bigint is distinct from installed_id
      or new_job->>'schedule' is distinct from schedule_text or new_job->>'command' is distinct from command_text
      or new_job->'active' is distinct from 'true'::jsonb
      or new_job->>'username' is distinct from current_user or new_job->>'database' is distinct from current_database()
      or (old_job is not null and (new_job-'command'-'schedule'-'active') is distinct from (old_job-'command'-'schedule'-'active')) then
      raise exception 'Unexpected RSS schedule after registration; rolled back';
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
  if runtime_after is distinct from runtime_before then raise exception 'Cron changed RSS runtime; rolled back'; end if;
  if action='schedule' and rss_jobs_after<>1 then raise exception 'Expected one RSS schedule; rolled back'; end if;
  if action='inspect' and rss_jobs_after<>rss_jobs_before then raise exception 'Inspect changed RSS schedule count; rolled back'; end if;
  raise notice 'RSS after: ready=%, allowed_url_count=%, rss_jobs=%, state=%, rows=%',
    runtime_after->'ready', jsonb_array_length(runtime_after->'allowed_feed_urls'),
    rss_jobs_after, status_after, after_counts;
end
$rss_cron$;
