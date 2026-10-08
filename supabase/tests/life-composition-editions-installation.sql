-- READ-ONLY administrator check. Only constant anonymous examples and routine
-- metadata are read. No private rows, synthetic accounts, writes or RPC calls.
with example as (
  select '{"format":"life-workbench-v1","workspaceId":"installation_check","revision":0,"groups":[],"page":{"title":"설치 확인","intro":"","showIntro":true,"showRecent":true,"entries":[]},"reflection":{"versionIds":[],"note":""},"books":[{"id":"book","title":"책","fromYear":"","toYear":"","question":"","archived":true,"chapters":[{"id":"chapter","title":"장","note":"","versionIds":[],"archived":true,"insights":[]}],"editions":[{"id":"edition","label":"첫 정리","createdAt":"2026-10-08T12:34:56.789Z","title":"보관한 책","fromYear":"2020","toYear":"2026","question":"","chapters":[{"id":"saved_chapter","title":"보관한 장","note":"","versionIds":["missing_version"],"archived":true,"insights":[{"id":"saved_insight","statement":"","uncertainty":"","supportVersionIds":["missing_support"],"counterVersionIds":["missing_counter"],"excluded":true}]}]}]}]}'::jsonb as data
), checks as (
  select 'editions validator retains private invoker contract' as check_name,
    coalesce(not p.prosecdef and p.provolatile='i' and p.proconfig @> array['search_path=pg_catalog']
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where acl.grantee=0 and acl.privilege_type='EXECUTE'),false) as passed
    from (values(1)) required(dummy) left join pg_proc p on p.oid=to_regprocedure('public.life_composition_valid(jsonb)')
  union all select 'old v1 without books remains valid',public.life_composition_valid(data - 'books') is true from example
  union all select 'old books and insights remain valid',public.life_composition_valid(data #- '{books,0,editions}' #- '{books,0,archived}' #- '{books,0,chapters,0,archived}') is true from example
  union all select 'archive snapshot and missing references remain valid',public.life_composition_valid(data) is true from example
  union all select 'book archive null fails closed',public.life_composition_valid(jsonb_set(data,'{books,0,archived}','null')) is false from example
  union all select 'chapter archive string fails closed',public.life_composition_valid(jsonb_set(data,'{books,0,chapters,0,archived}','"true"')) is false from example
  union all select 'edition missing field fails closed',public.life_composition_valid(data #- '{books,0,editions,0,label}') is false from example
  union all select 'edition unknown field fails closed',public.life_composition_valid(jsonb_set(data,'{books,0,editions,0,extra}','true')) is false from example
  union all select 'edition nesting rejected',public.life_composition_valid(jsonb_set(data,'{books,0,editions,0,editions}','[]')) is false from example
  union all select 'edition root archive rejected',public.life_composition_valid(jsonb_set(data,'{books,0,editions,0,archived}','true')) is false from example
  union all select 'edition label cannot be blank',public.life_composition_valid(jsonb_set(data,'{books,0,editions,0,label}','""')) is false from example
  union all select 'edition IDs cannot alias current chapters',public.life_composition_valid(jsonb_set(data,'{books,0,editions,0,chapters,0,id}','"chapter"')) is false from example
  union all select 'impossible calendar date rejected',public.life_composition_valid(jsonb_set(data,'{books,0,editions,0,createdAt}','"2026-02-29T12:34:56.789Z"')) is false from example
  union all select 'noncanonical UTC timestamp rejected',public.life_composition_valid(jsonb_set(data,'{books,0,editions,0,createdAt}','"2026-10-08T12:34:56.789+00:00"')) is false from example
  union all select 'timestamp year zero rejected',public.life_composition_valid(jsonb_set(data,'{books,0,editions,0,createdAt}','"0000-10-08T12:34:56.789Z"')) is false from example
  union all select 'UTF-16 edition label limit matches client',
    public.life_composition_valid(jsonb_set(data,'{books,0,editions,0,label}',to_jsonb(repeat('🌱',250)))) is true
    and public.life_composition_valid(jsonb_set(data,'{books,0,editions,0,label}',to_jsonb(repeat('🌱',251)))) is false from example
)
select check_name,passed from checks order by check_name;
