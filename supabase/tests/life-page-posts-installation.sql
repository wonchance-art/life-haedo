-- Read-only constant samples and function metadata. Does not read personal rows.
-- Execute after 20261012010000_life_page_posts.sql, as the administrator.
begin read only;
with fixture as (
 select '{"format":"life-workbench-v1","workspaceId":"installation_check","revision":0,"groups":[],"page":{"title":"check","intro":"","showIntro":true,"showRecent":true,"entries":[],"posts":[{"id":"post","status":"saved","replaces":null,"baseUpdatedAt":null,"body":"익명 설치 확인","attachments":[{"type":"book","title":"책","creator":"익명","url":"https://example.org/book"}],"visibility":"private","createdAt":"2026-10-12T00:00:00.000Z","updatedAt":"2026-10-12T00:00:00.000Z"}]},"reflection":{"versionIds":[],"note":""}}'::jsonb as value
), checks as (
 select 'saved page post accepted' as check_name, public.life_composition_valid(value) is true as passed from fixture
 union all select 'legacy composition accepted',public.life_composition_valid(value #- '{page,posts}') is true from fixture
 union all select 'local draft excluded from composition',public.life_composition_valid(jsonb_set(value,'{page,posts,0,status}','"draft"')) is false from fixture
 union all select 'private attachment note excluded', public.life_composition_valid(jsonb_set(value,'{page,posts,0,attachments,0,note}','"private"')) is false from fixture
 union all select 'new public snapshot accepted', public.life_public_page_valid('{"format":"life-share-v1","title":"check","intro":null,"entries":[{"title":"글","pinned":false,"note":"내 생각","parts":[],"attachments":[{"type":"book","title":"책","creator":"익명","url":"https://example.org/book"}]}]}'::jsonb) is true
 union all select 'old public snapshot accepted', public.life_public_page_valid('{"format":"life-share-v1","title":"check","intro":null,"entries":[]}'::jsonb) is true
 union all select 'private helpers deny both application roles', not exists (
 select 1 from (values ('public.life_page_attachments_valid(jsonb)'),('public.life_composition_valid(jsonb)'),('public.life_public_page_valid(jsonb)')) f(name), (values ('anon'),('authenticated')) r(name) where has_function_privilege(r.name,f.name,'EXECUTE'))
 union all select 'fixed helper search paths', not exists (
 select 1 from pg_proc where oid in ('public.life_page_attachments_valid(jsonb)'::regprocedure,'public.life_composition_valid(jsonb)'::regprocedure,'public.life_public_page_valid(jsonb)'::regprocedure) and proconfig is distinct from array['search_path=pg_catalog'])
)
select check_name,passed from checks order by check_name;
rollback;
