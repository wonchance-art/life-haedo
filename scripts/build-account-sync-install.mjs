// Builds supabase/operations/20261101-account-sync-install.sql: the six
// 2026-11-01 additive migrations in one transaction for the Supabase SQL
// Editor, with a row-count guard (any changed row count rolls everything back)
// and post-install checks. Run: node scripts/build-account-sync-install.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const MIGRATIONS = [
  '20261101090000_life_account_documents.sql',
  '20261101091500_life_blog_account_sync.sql',
  '20261101130000_life_material_tombstones.sql',
  '20261101140000_life_sync_edit_times.sql',
  '20261101150000_life_account_documents_owner_lock.sql',
  '20261101160000_life_blog_delete_guard.sql',
];
export const OUTPUT = 'supabase/operations/20261101-account-sync-install.sql';

// Each migration is its own begin/commit; inside one outer transaction those
// lines are removed so a failure anywhere rolls back every step.
export function body(sql, name) {
  const lines = sql.split('\n');
  const begins = lines.filter(line => /^begin;\s*$/i.test(line)).length;
  const commits = lines.filter(line => /^commit;\s*$/i.test(line)).length;
  if (begins !== 1 || commits !== 1) throw new Error(`${name}: expected exactly one top-level begin; and commit;`);
  return lines.filter(line => !/^(begin|commit);\s*$/i.test(line)).join('\n').trim();
}

export async function build(root = new URL('../', import.meta.url)) {
  const parts = [];
  for (const name of MIGRATIONS) {
    const sql = await readFile(new URL(`supabase/migrations/${name}`, root), 'utf8');
    parts.push({ name, sha: createHash('sha256').update(sql).digest('hex'), body: body(sql, name) });
  }
  return `-- 해도 2026-11-01 계정 자동 연동 설치 (Supabase SQL Editor에서 한 번에 실행)
-- 생성: node scripts/build-account-sync-install.mjs — 직접 고치지 말고 원본 마이그레이션을 고친 뒤 다시 생성한다.
-- 포함 마이그레이션(순서, 원본 sha256):
${parts.map(p => `--   ${p.name}  ${p.sha}`).join('\n')}
--
-- 안전 장치:
--   * 전체가 하나의 트랜잭션이다. 어느 단계든 실패하면 아무것도 바뀌지 않는다.
--   * 설치 전후로 public·haedo_* 스키마의 모든 테이블과 storage.objects의 행 수를 비교하고,
--     하나라도 달라지면 예외를 내서 전체를 되돌린다(새로 만든 테이블은 비교에서 제외).
--   * 함수 밖에서 바뀌는 설정은 haedo-blog-originals 버킷의 허용 형식에 HEIC/HEIF를 더하는 것뿐이다.
--   * 다시 실행해도 된다(if not exists / create or replace / drop ... if exists).
-- 실행 후 맨 아래 결과 표에서 모든 check 값이 true인지 확인한다.

begin;

create temporary table haedo_install_before on commit drop as
  select format('%I.%I', n.nspname, c.relname) as relation, 0::bigint as rows
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and (n.nspname = 'public' or n.nspname like 'haedo\\_%' or (n.nspname = 'storage' and c.relname = 'objects'));
do $snapshot$
declare r record; n bigint;
begin
  for r in select relation from haedo_install_before loop
    execute format('select count(*) from %s', r.relation) into n;
    update haedo_install_before set rows = n where relation = r.relation;
  end loop;
end
$snapshot$;

${parts.map(p => `-- ===== ${p.name} =====\n${p.body}\n`).join('\n')}
do $guard$
declare r record; n bigint;
begin
  for r in select relation, rows from haedo_install_before loop
    execute format('select count(*) from %s', r.relation) into n;
    if n <> r.rows then
      raise exception 'Row count changed in % (% -> %); installation rolled back', r.relation, r.rows, n;
    end if;
  end loop;
end
$guard$;

do $verify$
begin
  if to_regclass('public.life_account_documents') is null then raise exception 'life_account_documents missing'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.life_account_documents'::regclass) then raise exception 'RLS disabled on life_account_documents'; end if;
  if to_regprocedure('public.life_account_document_changes(bigint,integer)') is null then raise exception 'life_account_document_changes missing'; end if;
  if not exists (select 1 from pg_proc where proname = 'life_account_document_put' and pronamespace = 'public'::regnamespace) then raise exception 'life_account_document_put missing'; end if;
  if not exists (select 1 from pg_proc where proname = 'life_blog_sync_list' and pronamespace = 'public'::regnamespace) then raise exception 'life_blog_sync_list missing'; end if;
  if not exists (select 1 from pg_proc where proname = 'life_blog_delete' and pronamespace = 'public'::regnamespace) then raise exception 'life_blog_delete missing'; end if;
  if not exists (select 1 from pg_proc where proname = 'life_material_delete' and pronamespace = 'public'::regnamespace) then raise exception 'life_material_delete missing'; end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('life_account_document_put','life_account_document_changes','life_blog_sync_list','life_blog_delete','life_material_delete')
             and has_function_privilege('anon', p.oid, 'execute')) then
    raise exception 'anon can execute a new private function';
  end if;
end
$verify$;

commit;

-- 결과 확인용(읽기 전용)
select 'account documents table + RLS' as check_name,
       (to_regclass('public.life_account_documents') is not null
        and (select relrowsecurity from pg_class where oid = 'public.life_account_documents'::regclass)) as ok
union all
select 'new RPCs present', (select count(distinct proname) = 5 from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('life_account_document_put','life_account_document_changes','life_blog_sync_list','life_blog_delete','life_material_delete'))
union all
select 'anon cannot execute new RPCs', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('life_account_document_put','life_account_document_changes','life_blog_sync_list','life_blog_delete','life_material_delete')
  and has_function_privilege('anon', p.oid, 'execute'))
union all
select 'blog bucket accepts HEIC', coalesce((select 'image/heic' = any(allowed_mime_types) from storage.buckets where id = 'haedo-blog-originals'), false);
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = await build();
  await writeFile(new URL(`../${OUTPUT}`, import.meta.url), text);
  console.log(`Wrote ${OUTPUT} (${MIGRATIONS.length} migrations, ${Buffer.byteLength(text)} bytes).`);
}
