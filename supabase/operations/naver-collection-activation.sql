-- ADMIN OPERATIONS ONLY. Default invocation INSPECTS and changes nothing.
-- No credential values belong in this file, repository, output or client config.
--
-- Before activation, independently verify real robots + public list/body/photo
-- access for the selected mode (and RSS access for mode=all), and the worker with
-- HAEDO_NAVER_INGESTION_ENABLED=true. These flags are operator attestations,
-- not automated proof of either condition. Set BOTH only after that evidence.
-- Provision named secrets privately through Supabase Vault beforehand:
--   haedo_naver_project_url       = this project's HTTPS root URL
--   haedo_naver_service_role_key  = this same project's server-only service key
-- This tool only tests/uses them, never returns or logs their values.
--
-- ACTIVATE (run these SET statements in the SAME transaction as the DO below):
--   set local haedo.naver_action = 'activate';
--   set local haedo.naver_external_validation = 'verified';
--   set local haedo.naver_worker_environment = 'verified';
--   set local haedo.naver_mode = 'public'; -- PC inventory/capture only
-- Mode defaults to 'all' for the original RSS + PC schedule. Only use all after
-- separately verifying RSS. public explicitly removes an existing RSS schedule.
-- PAUSE (keeps subscriptions, inbox items, successful checks and receipts):
--   set local haedo.naver_action = 'pause';
--
-- Selected schedules run every 15 minutes. They share the runtime gate; no
-- subscription is enabled here. run claims due work across existing enabled
-- subscriptions, not just the blog used for a readiness sample. Inspect that
-- scope before activation. public changes schedules only: shared ready=true
-- still permits manual RSS checks, which retain their own live robots guard.
-- Schedule target is every 15 minutes, not a punctuality guarantee. The worker
-- currently claims at most two subscriptions. Network timeout budgets total
-- 80s (ready10 + claim10 + 2*(robots10 + RSS10 + finish10)); parsing, platform
-- and network overhead are separate. pg_net timeout and DB leases are 120s.
-- Running requests may already have collected bytes; ready=false prevents
-- subsequent finish commits. No existing private material is deleted on pause.
begin;
-- Uncomment the intended SET LOCAL lines INSIDE this transaction, or insert
-- equivalent SET LOCAL statements here when invoking this file programmatically.
-- set local haedo.naver_action = 'activate';
-- set local haedo.naver_external_validation = 'verified';
-- set local haedo.naver_worker_environment = 'verified';
-- set local haedo.naver_mode = 'public';
-- Or, to pause: set local haedo.naver_action = 'pause';
do $control$
declare
 action text:=coalesce(nullif(current_setting('haedo.naver_action',true),''),'inspect');
 mode text:=coalesce(nullif(current_setting('haedo.naver_mode',true),''),'all');
 job_name text:='haedo-naver-blog-poll'; capture_job text:='haedo-naver-capture-poll'; present boolean;
begin
 if action='inspect' then return;end if;
 if to_regclass('haedo_naver_private.runtime') is null then raise exception 'Naver schema must be installed first';end if;
 if action='pause' then
  update haedo_naver_private.runtime set ready=false where singleton;
  if to_regclass('cron.job') is not null then
   execute 'select exists(select 1 from cron.job where jobname=$1)' into present using job_name;
   if present then execute 'select cron.unschedule($1)' using job_name;end if;
   execute 'select exists(select 1 from cron.job where jobname=$1)' into present using capture_job;
   if present then execute 'select cron.unschedule($1)' using capture_job;end if;
  end if;
  return;
 end if;
 if action<>'activate' then raise exception 'Unknown Naver operation';end if;
 if mode not in ('public','all') then raise exception 'Unknown Naver collection mode';end if;
 if current_setting('haedo.naver_external_validation',true) is distinct from 'verified' or
    current_setting('haedo.naver_worker_environment',true) is distinct from 'verified' then
  raise exception 'Actual Naver and worker-environment verification is required before activation';
 end if;
 if to_regclass('vault.decrypted_secrets') is null then raise exception 'Vault provisioning is required';end if;
 execute $guard$select count(*)=1 and bool_and(decrypted_secret ~ '^https://[a-z0-9-]+[.]supabase[.]co$')
  from vault.decrypted_secrets where name='haedo_naver_project_url'$guard$ into present;
 if not coalesce(present,false) then raise exception 'Exactly one valid named project URL is required';end if;
 execute $guard$select count(*)=1 and bool_and(length(decrypted_secret)>40 and decrypted_secret not like 'sb_publishable_%')
  from vault.decrypted_secrets where name='haedo_naver_service_role_key'$guard$ into present;
 if not coalesce(present,false) then raise exception 'Exactly one server-only named worker credential is required';end if;
 if to_regclass('public.life_naver_captures') is null then raise exception 'Naver capture schema must be installed first';end if;
 -- These occur only AFTER every gate and named-secret check. Any later error
 -- rolls back extension, schedule and ready changes in this transaction.
 create extension if not exists pg_cron;
 create extension if not exists pg_net;
 if mode='all' then
  perform cron.schedule(job_name,'*/15 * * * *',$job$
  select net.http_post(
   url:=(select decrypted_secret from vault.decrypted_secrets where name='haedo_naver_project_url')||'/functions/v1/haedo-naver-blog',
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
    (select decrypted_secret from vault.decrypted_secrets where name='haedo_naver_service_role_key')),
   body:='{"action":"cron"}'::jsonb,timeout_milliseconds:=120000);
  $job$);
 else
  select exists(select 1 from cron.job where jobname=job_name) into present;
  if present then perform cron.unschedule(job_name);end if;
 end if;
 perform cron.schedule(capture_job,'*/15 * * * *',$job$
  select net.http_post(
   url:=(select decrypted_secret from vault.decrypted_secrets where name='haedo_naver_project_url')||'/functions/v1/haedo-naver-blog',
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
    (select decrypted_secret from vault.decrypted_secrets where name='haedo_naver_service_role_key')),
   body:='{"action":"run"}'::jsonb,timeout_milliseconds:=120000);
 $job$);
 update haedo_naver_private.runtime set ready=true where singleton;
end
$control$;
commit;
