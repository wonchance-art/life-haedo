// Builds supabase/operations/20261102-blog-ai-authorship-install.sql: the
// 2026-11-02 AI authorship migration as ONE DO statement, with the same
// row-count guard as the 2026-11-01 account sync install and read-only result
// checks. Run: node scripts/build-blog-ai-authorship-install.mjs
// Apply only after 20261101-account-sync-install.sql (it redefines the same
// two functions); re-running that older install requires re-running this one.
// Before changing anything it requires each function's current body (prosrc)
// to be byte-identical (md5) to the repository's 20261101091500 definition or
// to this migration's own (a re-run); otherwise it stops with nothing changed.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { body, markdownPreservation } from './build-account-sync-install.mjs';

export const MIGRATIONS = ['20261102110000_life_blog_ai_authorship.sql'];
export const PREVIOUS = '20261101091500_life_blog_account_sync.sql';
export const FUNCTIONS = [
  { name: 'valid_document', signature: 'jsonb,uuid' },
  { name: 'publish', signature: 'uuid,bigint,uuid,text[],jsonb,bigint' },
];
// The text PostgreSQL stores as prosrc: exactly what lies between the $$ quotes.
export function prosrc(sql, name) {
  const start = sql.indexOf('create or replace function haedo_blog_private.' + name + '(');
  if (start < 0) throw new Error(name + ': definition not found');
  const open = sql.indexOf('$$', start), close = open < 0 ? -1 : sql.indexOf('$$', open + 2);
  const end = sql.indexOf('\nend $$;', start);
  // The body of these two functions ends with "end " just before its closing quotes.
  if (open < 0 || close < 0 || close !== end + 5) throw new Error(name + ': body quotes not found');
  return sql.slice(open + 2, close);
}
const md5 = text => createHash('md5').update(text, 'utf8').digest('hex');
export const OUTPUT = 'supabase/operations/20261102-blog-ai-authorship-install.sql';

// Synthetic documents for the result checks; never stored.
const SAMPLE = `jsonb_build_object('format','life-photo-post-v2','id','00000000-0000-4000-8000-000000000001','revision',1,'title','','status','saved','replaces',null,
    'createdAt','2026-11-02T00:00:00.000Z','updatedAt','2026-11-02T00:00:00.000Z','photos','[]'::jsonb,'attachments','[]'::jsonb,'archived',false,
    'ops',jsonb_build_array(jsonb_build_object('insert','AI','attributes',jsonb_build_object('author','ai')),jsonb_build_object('insert',E'\\n')))`;

export async function build(root = new URL('../', import.meta.url)) {
  const preservation = await markdownPreservation(root);
  const parts = [];
  for (const [index, name] of MIGRATIONS.entries()) {
    const sql = await readFile(new URL(`supabase/migrations/${name}`, root), 'utf8');
    const tag = `$haedo_m${index + 1}$`;
    const text = body(sql, name);
    if (text.includes(tag) || text.includes('$haedo_install$')) throw new Error(`${name}: dollar-quote tag collision`);
    parts.push({ name, tag, sha: createHash('sha256').update(sql).digest('hex'), body: text, sql });
  }
  const previous = await readFile(new URL(`supabase/migrations/${PREVIOUS}`, root), 'utf8');
  const expected = FUNCTIONS.map(f => ({ ...f, before: md5(prosrc(previous, f.name)), after: md5(prosrc(parts[0].sql, f.name)) }));
  return `-- 해도 2026-11-02 AI 글 표시 서버 검증 설치 (Supabase SQL Editor에서 한 번에 실행)
-- 생성: node scripts/build-blog-ai-authorship-install.mjs — 원본 이력은 유지하고 생성기로 다시 만든다.
-- 포함 마이그레이션(순서, 원본 sha256):
${parts.map(p => `--   ${p.name}  ${p.sha}`).join('\n')}
--
-- 선행 조건: 20261101-account-sync-install.sql이 적용되어 있어야 한다. 그 설치를 다시 실행하면
-- D2 이전의 같은 두 함수가 이전 정의로 돌아가므로 이 설치도 다시 실행한다.
-- 후속 Markdown 보존 기준: ${preservation.source}
-- 검증된 D2 정의가 이미 있으면 이 설치의 이전 함수 재정의는 건너뛴다.
-- 클라이언트(AI 글 표시를 쓰는 앱 버전)를 배포하기 전에 적용한다.
--
-- 안전 장치:
--   * 설치 전체가 DO 블록 "한 문장"이다. 어느 단계에서 실패하면 전체가 되돌려진다.
--   * 설치 전후로 public·haedo_* 스키마의 모든 테이블과 storage.objects의 행 수를 비교하고,
--     하나라도 달라지면 예외를 내서 전체를 되돌린다. 저장된 글은 고치지 않는다.
--   * 바꾸기 전에 두 함수의 현재 본문(prosrc) md5가 저장소의 ${PREVIOUS} 정의 또는
--     이 설치의 정의(다시 실행)와 같은지 확인하고, 다르면 아무것도 바꾸지 않고 멈춘다.
--   * 다시 실행해도 된다(create or replace).
-- 실행 후 맨 아래 결과 표에서 모든 ok 값이 true인지 확인한다.

do $haedo_install$
declare
  r record;
  n bigint;
  h text;
  before jsonb := '{}'::jsonb;
  markdown_definitions jsonb := '{}'::jsonb;
begin
  if to_regprocedure('haedo_blog_private.valid_document(jsonb,uuid)') is null
     or to_regprocedure('haedo_blog_private.photo_media(jsonb)') is null then
    raise exception 'apply 20261101-account-sync-install.sql first';
  end if;
${preservation.capture}
${expected.map(f => `  select md5(prosrc) into h from pg_proc where oid = to_regprocedure('haedo_blog_private.${f.name}(${f.signature})');
  if not (markdown_definitions ? '${f.name}') and (h is null or h not in ('${f.before}', '${f.after}')) then
    raise exception 'haedo_blog_private.${f.name} differs from the repository definition (md5 %); nothing was changed', coalesce(h, 'missing');
  end if;`).join('\n')}
  for r in
    select format('%I.%I', ns.nspname, c.relname) as relation
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where c.relkind = 'r' and (ns.nspname = 'public' or ns.nspname like 'haedo\\_%' or (ns.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format('select count(*) from %s', r.relation) into n;
    before := before || jsonb_build_object(r.relation, n);
  end loop;

  if markdown_definitions = '{}'::jsonb then
${parts.map(p => `  -- ===== ${p.name} =====\n  execute ${p.tag}\n${p.body}\n${p.tag};\n`).join('\n')}  end if;
  for r in select key as relation, value::bigint as rows from jsonb_each_text(before) loop
    execute format('select count(*) from %s', r.relation) into n;
    if n <> r.rows then
      raise exception 'Row count changed in % (% -> %); installation rolled back', r.relation, r.rows, n;
    end if;
  end loop;

  if not haedo_blog_private.valid_document(${SAMPLE}, '00000000-0000-4000-8000-000000000001') then
    raise exception 'valid_document does not accept author=ai text';
  end if;
  if haedo_blog_private.valid_document(jsonb_set(${SAMPLE}, '{ops,0,attributes,author}', '"human"'), '00000000-0000-4000-8000-000000000001') then
    raise exception 'valid_document accepts an unknown author value';
  end if;
  raise notice 'haedo blog AI authorship installed; % existing tables unchanged', (select count(*) from jsonb_object_keys(before));
end
$haedo_install$;

-- 결과 확인용(읽기 전용)
select 'author=ai text accepted' as check_name,
       haedo_blog_private.valid_document(${SAMPLE}, '00000000-0000-4000-8000-000000000001') as ok
union all
select 'other author values rejected',
       not haedo_blog_private.valid_document(jsonb_set(${SAMPLE}, '{ops,0,attributes,author}', '"human"'), '00000000-0000-4000-8000-000000000001')
union all
select 'documents without marks still accepted',
       haedo_blog_private.valid_document(jsonb_set(${SAMPLE}, '{ops,0}', '{"insert":"AI"}'), '00000000-0000-4000-8000-000000000001')
union all
select 'publish drops the private mark',
       coalesce((select prosrc like '%(op->''attributes'')-''author''%' from pg_proc where oid = to_regprocedure('haedo_blog_private.publish(uuid,bigint,uuid,text[],jsonb,bigint)')), false)
union all
select 'anon cannot execute valid_document',
       not has_function_privilege('anon', 'haedo_blog_private.valid_document(jsonb,uuid)', 'execute');
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = await build();
  await writeFile(new URL(`../${OUTPUT}`, import.meta.url), text);
  console.log(`Wrote ${OUTPUT} (${MIGRATIONS.length} migration, ${Buffer.byteLength(text)} bytes).`);
}
