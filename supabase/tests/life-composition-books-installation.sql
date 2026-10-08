-- READ-ONLY administrator installation check. Constant anonymous examples only;
-- no private records, test accounts, writes, permission changes or RPC calls.
with base as (
  select '{"format":"life-workbench-v1","workspaceId":"installation_check","revision":0,"groups":[],"page":{"title":"설치 확인","intro":"","showIntro":true,"showRecent":true,"entries":[]},"reflection":{"versionIds":[],"note":""}}'::jsonb as data
), example as (
  select data, data || '{"books":[{"id":"book","title":"기록으로 만든 책","fromYear":"2020","toYear":"2026","question":"내가 바뀐 계기는 무엇이었나?","chapters":[{"id":"chapter","title":"처음의 선택","note":"발췌와 생각","versionIds":["deliberately_missing_version"]}]}]}'::jsonb as with_books
    from base
), checks as (
  select 'books validator retains private invoker contract' as check_name,
    coalesce(not p.prosecdef and p.provolatile='i' and p.proconfig @> array['search_path=pg_catalog']
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where acl.grantee=0 and acl.privilege_type='EXECUTE'),false) as passed
    from (values(1)) required(dummy) left join pg_proc p on p.oid=to_regprocedure('public.life_composition_valid(jsonb)')
  union all select 'old v1 without books remains valid',public.life_composition_valid(data) is true from example
  union all select 'empty books array remains valid',public.life_composition_valid(data || '{"books":[]}') is true from example
  union all select 'book chapters preserve missing exact references',public.life_composition_valid(with_books) is true from example
  union all select 'books null fails closed',public.life_composition_valid(data || '{"books":null}') is false from example
  union all select 'book missing field fails closed',public.life_composition_valid(with_books #- '{books,0,question}') is false from example
  union all select 'chapter unknown field fails closed',public.life_composition_valid(jsonb_set(with_books,'{books,0,chapters,0,extra}','true')) is false from example
  union all select 'reversed period rejected',public.life_composition_valid(jsonb_set(with_books,'{books,0,fromYear}','"2027"')) is false from example
  union all select 'year zero rejected',public.life_composition_valid(jsonb_set(with_books,'{books,0,fromYear}','"0000"')) is false from example
  union all select 'composition IDs stay globally unique',public.life_composition_valid(jsonb_set(with_books,'{books,0,chapters,0,id}','"book"')) is false from example
  union all select 'duplicate chapter references rejected',public.life_composition_valid(jsonb_set(with_books,'{books,0,chapters,0,versionIds}','["v","v"]')) is false from example
  union all select 'UTF-16 title limit matches client',
    public.life_composition_valid(jsonb_set(with_books,'{books,0,title}',to_jsonb(repeat('🌱',250)))) is true
    and public.life_composition_valid(jsonb_set(with_books,'{books,0,title}',to_jsonb(repeat('🌱',251)))) is false from example
)
select check_name,passed from checks order by check_name;
