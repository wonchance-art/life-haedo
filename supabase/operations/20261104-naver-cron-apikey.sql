-- 해도 2026-11-04 네이버 수집 cron 호출을 apikey 헤더 방식으로 전환 (Supabase SQL Editor에서 한 번에 실행)
-- ADMIN OPERATIONS ONLY. 기본 실행은 점검만 하고 아무것도 바꾸지 않는다.
-- 키 값은 이 파일·저장소·출력·클라이언트 설정에 넣지 않는다. cron 명령은 Vault 이름만 참조한다.
--
-- 왜: Supabase가 레거시 anon/service_role 키를 2026년 말까지 폐지한다.
--   새 서버 키(sb_secret_)는 JWT가 아니라 Authorization: Bearer로 보낼 수 없고 apikey 헤더로만 보낸다.
--   출처: https://supabase.com/docs/guides/api/api-keys (2026-11-04 확인)
--
-- 순서 (반대로 하면 cron 요청이 401로 거절된다):
--   1. apikey 헤더를 읽는 haedo-naver-blog Edge 함수(2026-11-04 판)를 먼저 배포한다.
--      그 판은 apikey 헤더와 기존 Bearer 방식을 모두 받는다.
--   2. 이 파일을 아래 SET LOCAL과 함께 실행한다.
--   3. 그 뒤 Vault의 haedo_naver_service_role_key 값을 새 sb_secret_ 키로 바꿀 수 있다.
--      (값이 레거시 service JWT여도 apikey 헤더 방식은 동작한다. 값 교체는 소유자가 직접 한다.)
--
-- 전환 (같은 트랜잭션 안에서):
--   set local haedo.naver_cron_action = 'apikey';
-- 되돌리기 (Edge 함수를 이전 판으로 되돌린 경우에만):
--   set local haedo.naver_cron_action = 'bearer';
--
-- 안전 장치:
--   * 전체가 DO 블록 한 문장이다. 어느 단계에서 실패하면 전체가 되돌려진다.
--   * 실행 전후로 public·haedo_* 스키마의 모든 테이블, storage.objects, cron.job의 행 수를 비교하고
--     하나라도 달라지면 예외를 내서 전체를 되돌린다.
--   * 이미 있는 haedo-naver-blog-poll·haedo-naver-capture-poll 일정의 명령만 바꾼다.
--     새 일정을 만들거나 지우지 않고, 일정 주기는 그대로 둔다. 수집 활성화(ready)는 바꾸지 않는다.
--   * 사용자 데이터 삭제·권한 완화가 없다. 다시 실행해도 된다.
-- 실행 후 맨 아래 결과 표: 있는 일정마다 header가 'apikey'이고 ok가 true인지 확인한다.
begin;
-- 전환할 때 아래 줄의 주석을 푼다.
-- set local haedo.naver_cron_action = 'apikey';
do $haedo_naver_cron$
declare
 action text:=coalesce(nullif(current_setting('haedo.naver_cron_action',true),''),'inspect');
 jobs constant text[]:=array['haedo-naver-blog-poll','haedo-naver-capture-poll'];
 job record; r record; n bigint; present boolean; before jsonb:='{}'::jsonb; credential text; changed int:=0;
begin
 if action='inspect' then return;end if;
 if action not in ('apikey','bearer') then raise exception 'Unknown Naver cron header operation';end if;
 if to_regclass('cron.job') is null then raise exception 'pg_cron is not installed; nothing to change';end if;
 if to_regclass('vault.decrypted_secrets') is null then raise exception 'Vault provisioning is required';end if;
 execute $guard$select count(*)=1 and bool_and(decrypted_secret ~ '^https://[a-z0-9-]+[.]supabase[.]co$')
  from vault.decrypted_secrets where name='haedo_naver_project_url'$guard$ into present;
 if not coalesce(present,false) then raise exception 'Exactly one valid named project URL is required';end if;
 execute $guard$select count(*)=1 and bool_and(length(decrypted_secret)>40 and decrypted_secret not like 'sb_publishable_%')
  from vault.decrypted_secrets where name='haedo_naver_service_role_key'$guard$ into present;
 if not coalesce(present,false) then raise exception 'Exactly one server-only named worker credential is required';end if;
 if action='bearer' then
  -- A Bearer token must be a JWT; an sb_secret_ key there is always refused.
  execute $guard$select bool_and(decrypted_secret not like 'sb_secret_%') from vault.decrypted_secrets
   where name='haedo_naver_service_role_key'$guard$ into present;
  if not coalesce(present,false) then raise exception 'An sb_secret_ key cannot be sent as a Bearer token';end if;
 end if;

 for r in
  select format('%I.%I', ns.nspname, c.relname) as relation
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where c.relkind = 'r' and (ns.nspname = 'public' or ns.nspname like 'haedo\_%'
   or (ns.nspname = 'storage' and c.relname = 'objects') or (ns.nspname = 'cron' and c.relname = 'job'))
 loop
  execute format('select count(*) from %s', r.relation) into n;
  before := before || jsonb_build_object(r.relation, n);
 end loop;

 credential := case when action='apikey'
  then $h$'apikey',(select decrypted_secret from vault.decrypted_secrets where name='haedo_naver_service_role_key')$h$
  else $h$'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='haedo_naver_service_role_key')$h$ end;
 for job in execute 'select jobname, schedule from cron.job where jobname = any($1) order by jobname' using jobs loop
  execute 'select cron.schedule($1,$2,$3)' using job.jobname, job.schedule, format($job$
  select net.http_post(
   url:=(select decrypted_secret from vault.decrypted_secrets where name='haedo_naver_project_url')||'/functions/v1/haedo-naver-blog',
   headers:=jsonb_build_object('Content-Type','application/json',%s),
   body:=%L::jsonb,timeout_milliseconds:=120000);
  $job$, credential, case when job.jobname='haedo-naver-blog-poll' then '{"action":"cron"}' else '{"action":"run"}' end);
  changed := changed + 1;
 end loop;

 for r in select key as relation, value::bigint as rows from jsonb_each_text(before) loop
  execute format('select count(*) from %s', r.relation) into n;
  if n <> r.rows then raise exception 'Row count changed in % (% -> %); rolled back', r.relation, r.rows, n;end if;
 end loop;
 for job in execute 'select jobname, command from cron.job where jobname = any($1)' using jobs loop
  if job.command like '%sb\_secret\_%' or job.command like '%sb\_publishable\_%' or job.command not like '%vault.decrypted_secrets%'
     or (action='apikey') <> (job.command like '%''apikey'',%' and job.command not like '%Authorization%') then
   raise exception 'Unexpected command for %; rolled back', job.jobname;
  end if;
 end loop;
 raise notice 'Naver cron header set to % for % existing schedule(s); % tables unchanged', action, changed, (select count(*) from jsonb_object_keys(before));
end
$haedo_naver_cron$;
commit;

-- 결과 표 (점검만 해도 현재 상태를 보여 준다). 키 값은 출력하지 않는다.
select j.jobname as check_name, j.schedule,
 case when j.command like '%''apikey'',%' and j.command not like '%Authorization%' then 'apikey'
      when j.command like '%''Authorization'',%' then 'bearer' else 'unknown' end as header,
 (j.command like '%''apikey'',%' and j.command not like '%Authorization%'
  and j.command not like '%sb\_secret\_%' and j.command like '%vault.decrypted_secrets%') as ok
from cron.job j where j.jobname in ('haedo-naver-blog-poll','haedo-naver-capture-poll') order by j.jobname;
