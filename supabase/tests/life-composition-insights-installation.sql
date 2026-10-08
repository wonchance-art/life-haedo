-- READ-ONLY administrator check. Constant anonymous examples only; no personal
-- row reads, synthetic accounts, writes, permission changes or RPC calls.
with example as (
  select '{"format":"life-workbench-v1","workspaceId":"installation_check","revision":0,"groups":[],"page":{"title":"설치 확인","intro":"","showIntro":true,"showRecent":true,"entries":[]},"reflection":{"versionIds":[],"note":""},"books":[{"id":"book","title":"기록으로 만든 책","fromYear":"","toYear":"","question":"","chapters":[{"id":"chapter","title":"처음의 선택","note":"","versionIds":[],"insights":[{"id":"insight","statement":"내가 바뀐 계기는 무엇이었나?","uncertainty":"다른 해석도 가능하다.","supportVersionIds":["missing_support"],"counterVersionIds":["missing_counter"],"excluded":false}]}]}]}'::jsonb as data
), checks as (
  select 'insights validator retains private invoker contract' as check_name,
    coalesce(not p.prosecdef and p.provolatile='i' and p.proconfig @> array['search_path=pg_catalog']
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where acl.grantee=0 and acl.privilege_type='EXECUTE'),false) as passed
    from (values(1)) required(dummy) left join pg_proc p on p.oid=to_regprocedure('public.life_composition_valid(jsonb)')
  union all select 'old v1 without books remains valid',public.life_composition_valid(data - 'books') is true from example
  union all select 'books without insights remain valid',public.life_composition_valid(data #- '{books,0,chapters,0,insights}') is true from example
  union all select 'missing role references outside chapter remain valid',public.life_composition_valid(data) is true from example
  union all select 'blank statement draft remains valid',public.life_composition_valid(jsonb_set(data,'{books,0,chapters,0,insights,0,statement}','""')) is true from example
  union all select 'insights null fails closed',public.life_composition_valid(jsonb_set(data,'{books,0,chapters,0,insights}','null')) is false from example
  union all select 'insight missing field fails closed',public.life_composition_valid(data #- '{books,0,chapters,0,insights,0,uncertainty}') is false from example
  union all select 'insight unknown field fails closed',public.life_composition_valid(jsonb_set(data,'{books,0,chapters,0,insights,0,extra}','true')) is false from example
  union all select 'composition IDs stay globally unique',public.life_composition_valid(jsonb_set(data,'{books,0,chapters,0,insights,0,id}','"chapter"')) is false from example
  union all select 'role reference duplicates rejected',public.life_composition_valid(jsonb_set(data,'{books,0,chapters,0,insights,0,supportVersionIds}','["same","same"]')) is false from example
  union all select 'cross role exact reference allowed',public.life_composition_valid(jsonb_set(data,'{books,0,chapters,0,insights,0,counterVersionIds}','["missing_support"]')) is true from example
  union all select 'excluded remains boolean',public.life_composition_valid(jsonb_set(data,'{books,0,chapters,0,insights,0,excluded}','"true"')) is false from example
  union all select 'UTF-16 statement limit matches client',
    public.life_composition_valid(jsonb_set(data,'{books,0,chapters,0,insights,0,statement}',to_jsonb(repeat('🌱',10000)))) is true
    and public.life_composition_valid(jsonb_set(data,'{books,0,chapters,0,insights,0,statement}',to_jsonb(repeat('🌱',10001)))) is false from example
)
select check_name,passed from checks order by check_name;
