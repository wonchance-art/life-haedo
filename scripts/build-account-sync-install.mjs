// Builds supabase/operations/20261101-account-sync-install.sql: the six
// 2026-11-01 additive migrations as ONE DO statement (each migration runs via
// EXECUTE), so the install is atomic however the Supabase SQL Editor splits or
// pools statements, with a row-count guard and post-install checks. Run: node scripts/build-account-sync-install.mjs
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
  for (const [index, name] of MIGRATIONS.entries()) {
    const sql = await readFile(new URL(`supabase/migrations/${name}`, root), 'utf8');
    const tag = `$haedo_m${index + 1}$`;
    const text = body(sql, name);
    if (text.includes(tag) || text.includes('$haedo_install$')) throw new Error(`${name}: dollar-quote tag collision`);
    parts.push({ name, tag, sha: createHash('sha256').update(sql).digest('hex'), body: text });
  }
  return `-- 해도 2026-11-01 계정 자동 연동 설치 (Supabase SQL Editor에서 한 번에 실행)
-- 생성: node scripts/build-account-sync-install.mjs — 직접 고치지 말고 원본 마이그레이션을 고친 뒤 다시 생성한다.
-- 포함 마이그레이션(순서, 원본 sha256):
${parts.map(p => `--   ${p.name}  ${p.sha}`).join('\n')}
--
-- 안전 장치:
--   * 설치 전체가 DO 블록 "한 문장"이다. SQL Editor가 문장을 어떤 연결·트랜잭션으로
--     나눠 실행하든, 어느 단계에서 실패하면 그 문장 전체가 되돌려져 아무것도 바뀌지 않는다.
--   * 설치 전후로 public·haedo_* 스키마의 모든 테이블과 storage.objects의 행 수를 비교하고,
--     하나라도 달라지면 예외를 내서 전체를 되돌린다(설치 중 새로 만든 테이블은 비교에서 제외).
--   * 함수 밖에서 바뀌는 설정은 haedo-blog-originals 버킷의 허용 형식에 HEIC/HEIF를 더하는 것뿐이다.
--   * 다시 실행해도 된다(if not exists / create or replace / drop ... if exists).
-- 실행 후 맨 아래 결과 표에서 모든 ok 값이 true인지 확인한다.

do $haedo_install$
declare
  r record;
  n bigint;
  before jsonb := '{}'::jsonb;
begin
  for r in
    select format('%I.%I', ns.nspname, c.relname) as relation
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where c.relkind = 'r' and (ns.nspname = 'public' or ns.nspname like 'haedo\\_%' or (ns.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format('select count(*) from %s', r.relation) into n;
    before := before || jsonb_build_object(r.relation, n);
  end loop;

${parts.map(p => `  -- ===== ${p.name} =====\n  execute ${p.tag}\n${p.body}\n${p.tag};\n`).join('\n')}
  for r in select key as relation, value::bigint as rows from jsonb_each_text(before) loop
    execute format('select count(*) from %s', r.relation) into n;
    if n <> r.rows then
      raise exception 'Row count changed in % (% -> %); installation rolled back', r.relation, r.rows, n;
    end if;
  end loop;

  if to_regclass('public.life_account_documents') is null then raise exception 'life_account_documents missing'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.life_account_documents'::regclass) then raise exception 'RLS disabled on life_account_documents'; end if;
  if (select count(distinct proname) from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('life_account_document_put','life_account_document_changes','life_blog_sync_list','life_blog_delete','life_material_delete')) <> 5 then
    raise exception 'a new RPC is missing';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('life_account_document_put','life_account_document_changes','life_blog_sync_list','life_blog_delete','life_material_delete')
             and has_function_privilege('anon', p.oid, 'execute')) then
    raise exception 'anon can execute a new private function';
  end if;
  raise notice 'haedo account sync installed; % existing tables unchanged', (select count(*) from jsonb_object_keys(before));
end
$haedo_install$;

-- 결과 확인용(읽기 전용)
select 'account documents table + RLS' as check_name,
       coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.life_account_documents')), false) as ok
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
