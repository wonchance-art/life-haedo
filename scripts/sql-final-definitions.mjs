// Lists the SQL objects that a later migration redefines, and the migration that
// holds each final definition: docs/design-review/sql-final-definitions.md.
// Static text scan of supabase/migrations/*.sql in filename order; no database.
// Regenerate: node scripts/sql-final-definitions.mjs   Check only: --check
// tests/run-sql-replay-postgres.cjs cross-checks the function list against the replayed catalog.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = 'supabase/migrations';
export const OUTPUT = 'docs/design-review/sql-final-definitions.md';

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const QNAME = String.raw`(${IDENT}(?:\s*\.\s*${IDENT})?)`;
const TYPE_ALIASES = new Map([
  ['int', 'integer'], ['int4', 'integer'], ['int8', 'bigint'], ['int2', 'smallint'], ['bool', 'boolean'],
  ['timestamptz', 'timestamp with time zone'], ['varchar', 'character varying'], ['float8', 'double precision'],
]);
// First words of multi-word types, so `timestamp with time zone` is not read as a parameter name.
const TYPE_STARTS = new Set(['timestamp', 'time', 'double', 'character', 'bit', 'interval']);

const qualify = name => {
  const parts = name.replace(/\s+/g, '').split('.').map(p => p.replace(/^"|"$/g, '').toLowerCase());
  return parts.length === 1 ? `public.${parts[0]}` : parts.join('.');
};

// Whole-line comments only: function bodies may hold `--` inside strings.
const stripComments = sql => sql.replace(/^[ \t]*--.*$/gm, '');

// Paren/comma scanners skip single-quoted literals such as '{"a":"","b":""}'::jsonb defaults.
function closingParen(text, open) {
  let depth = 0, quoted = false;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "'") quoted = !quoted;
    if (quoted) continue;
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

function splitTopLevel(text) {
  const out = []; let depth = 0, start = 0, quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "'") quoted = !quoted;
    if (quoted) continue;
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    else if (text[i] === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map(s => s.trim()).filter(Boolean);
}

export function argTypes(argText) {
  return splitTopLevel(argText).map(arg => {
    let words = arg.replace(/\s+(default\b|=).*$/is, '').trim().split(/\s+/);
    if (/^(in|out|inout|variadic)$/i.test(words[0]) && words.length > 1) words = words.slice(1);
    if (words.length > 1 && !TYPE_STARTS.has(words[0].toLowerCase())) words = words.slice(1);
    const type = words.join(' ').toLowerCase().replace(/^public\./, '');
    return TYPE_ALIASES.get(type) || type;
  }).join(', ');
}

function alterKind(action) {
  const a = action.trim().toLowerCase();
  if (/^(enable|disable|force|no force) row level security/.test(a) || /^owner to/.test(a) || /^replica identity/.test(a)) return null;
  const m = a.match(/^(add column|drop column|alter column|add constraint|drop constraint|validate constraint|rename|add|drop|alter|set)\b/);
  return m ? (m[1] === 'add' ? 'add column' : m[1] === 'drop' ? 'drop column' : m[1] === 'alter' ? 'alter column' : m[1]) : a.split(/\s+/).slice(0, 2).join(' ');
}

// Events per object, in file order then text order.
export function scan(files) {
  const functions = new Map(), tables = new Map(), views = new Map();
  const touch = (map, key) => { if (!map.has(key)) map.set(key, []); return map.get(key); };
  for (const { name: file, sql: raw } of files) {
    const sql = stripComments(raw);
    const events = [];
    for (const m of sql.matchAll(new RegExp(String.raw`\b(create\s+(?:or\s+replace\s+)?|drop\s+)function\s+(?:if\s+exists\s+)?${QNAME}\s*(\()?`, 'gi'))) {
      const drop = /^drop/i.test(m[1]);
      let signature = null;
      if (m[3]) { const open = m.index + m[0].length - 1, close = closingParen(sql, open); signature = argTypes(sql.slice(open + 1, close)); }
      events.push({ at: m.index, map: functions, key: qualify(m[2]), event: { file, kind: drop ? 'drop' : 'create', signature } });
    }
    // `alter function a(..) rename to b`: the body last created as `a` now lives on as `b`.
    for (const m of sql.matchAll(new RegExp(String.raw`\balter\s+function\s+${QNAME}\s*\(`, 'gi'))) {
      const open = m.index + m[0].length - 1, close = closingParen(sql, open);
      const to = sql.slice(close + 1).match(new RegExp(String.raw`^\s*rename\s+to\s+(${IDENT})`, 'i'));
      if (!to) continue;
      const from = qualify(m[1]), target = `${from.split('.')[0]}.${qualify(to[1]).split('.')[1]}`, signature = argTypes(sql.slice(open + 1, close));
      events.push({ at: m.index, map: functions, key: from, event: { file, kind: 'rename', signature, to: target } });
      events.push({ at: m.index + 0.5, map: functions, key: target, event: { file, kind: 'create', signature, renamedFrom: from } });
    }
    for (const m of sql.matchAll(new RegExp(String.raw`\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${QNAME}\s*\(`, 'gi')))
      events.push({ at: m.index, map: tables, key: qualify(m[1]), event: { file, kind: 'create' } });
    for (const m of sql.matchAll(new RegExp(String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${QNAME}\s+([^;']*)`, 'gi'))) {
      const kinds = splitTopLevel(m[2]).map(alterKind).filter(Boolean);
      if (kinds.length) events.push({ at: m.index, map: tables, key: qualify(m[1]), event: { file, kind: 'alter', detail: [...new Set(kinds)] } });
    }
    for (const m of sql.matchAll(new RegExp(String.raw`\b(create\s+(?:or\s+replace\s+)?|drop\s+)view\s+(?:if\s+exists\s+)?${QNAME}`, 'gi')))
      events.push({ at: m.index, map: views, key: qualify(m[2]), event: { file, kind: /^drop/i.test(m[1]) ? 'drop' : 'create' } });
    for (const e of events.sort((a, b) => a.at - b.at)) {
      if (e.event.renamedFrom) e.event.bodyFile = (functions.get(e.event.renamedFrom) || []).filter(x => x.kind === 'create').at(-1)?.bodyFile;
      else if (e.map === functions && e.event.kind === 'create') e.event.bodyFile = file;
      touch(e.map, e.key).push(e.event);
    }
  }
  return { functions, tables, views };
}

const uniq = list => [...new Set(list)];

// Live overloads after replaying create/drop events (a drop without args removes all).
export function liveSignatures(events) {
  const live = new Set();
  for (const e of events) {
    if (e.kind === 'create') live.add(e.signature);
    else if (e.signature === null) live.clear();
    else live.delete(e.signature);
  }
  return [...live];
}

export function summarize({ functions, tables, views }) {
  const fn = [...functions].map(([name, events]) => {
    const creates = events.filter(e => e.kind === 'create');
    const files = uniq(creates.map(e => e.file));
    const live = liveSignatures(events);
    const renames = events.filter(e => e.kind === 'rename');
    const last = creates.at(-1);
    return { name, files, finalFile: files[files.length - 1], live, signatures: uniq(creates.map(e => e.signature)), dropped: live.length === 0,
      renamedFrom: last?.renamedFrom, bodyFile: last?.bodyFile, renamedTo: renames.map(e => e.to) };
  });
  const tb = [...tables].map(([name, events]) => {
    const created = events.filter(e => e.kind === 'create').map(e => e.file);
    if (!created.length) return null; // tables owned by Supabase (storage.*) are out of scope
    const later = events.filter(e => e.kind === 'alter' && e.file > created[0]);
    return { name, created: uniq(created), alters: later, files: uniq([...created, ...later.map(e => e.file)]) };
  }).filter(Boolean);
  const vw = [...views].map(([name, events]) => ({ name, files: uniq(events.filter(e => e.kind === 'create').map(e => e.file)) }));
  return {
    functions: fn.sort((a, b) => a.name.localeCompare(b.name)),
    redefinedFunctions: fn.filter(f => f.files.length > 1).sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name)),
    redefinedTables: tb.filter(t => t.files.length > 1).sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name)),
    redefinedViews: vw.filter(v => v.files.length > 1),
    tableCount: tb.length,
  };
}

export async function load(root = new URL('../', import.meta.url)) {
  const dir = new URL(MIGRATIONS_DIR + '/', root);
  const names = (await readdir(dir)).filter(n => n.endsWith('.sql')).sort();
  return Promise.all(names.map(async name => ({ name, sql: await readFile(new URL(name, dir), 'utf8') })));
}

const short = file => file.replace(/\.sql$/, '');

export function render(files, summary) {
  const lines = [
    '# SQL 최종 정의 위치',
    '',
    '<!-- 생성: node scripts/sql-final-definitions.mjs — 직접 고치지 않는다. 마이그레이션을 바꾼 뒤 다시 생성한다. -->',
    '',
    `\`supabase/migrations/\`의 ${files.length}개 파일을 파일 이름 순서로 읽어, 뒤 마이그레이션이 다시 정의하는 함수·테이블을 모았다.`,
    '**최종** 열의 파일이 현재 정의를 담는다. 새 변경은 그 파일의 정의에서 출발한다. 이 문서는 목록만 보여 주며 마이그레이션을 고치지 않는다.',
    '',
    '- 함수: `create [or replace] function`이 둘 이상의 파일에 있는 경우. 같은 파일 안의 반복은 한 번으로 센다.',
    '- 테이블: 만든 파일보다 뒤 파일의 `alter table`이 열·제약을 바꾸는 경우. RLS 켜기·소유자 변경은 제외한다.',
    '- 인자 목록이 바뀌어 오버로드가 남는지는 `npm run test:sql-replay`가 재생한 DB 카탈로그와 대조한다.',
    '',
    `## 함수 (${summary.redefinedFunctions.length}개 재정의 / 전체 ${summary.functions.length}개)`,
    '',
    '| 함수 | 정의한 파일 수 | 최종 | 이전 정의 |',
    '| --- | ---: | --- | --- |',
  ];
  for (const f of summary.redefinedFunctions) {
    const sig = f.live.length === 1 ? `(${f.live[0]})` : f.dropped ? ' (삭제됨)' : ` — 남은 오버로드 ${f.live.length}개`;
    const kept = f.renamedTo.length ? `<br>이전 본문은 ${f.renamedTo.map(x => `\`${x}\``).join(', ')}로 이름을 바꿔 유지` : '';
    lines.push(`| \`${f.name}${sig}\` | ${f.files.length} | \`${short(f.finalFile)}\`${kept} | ${f.files.slice(0, -1).map(x => `\`${short(x)}\``).join(', ')} |`);
  }
  const renamed = summary.functions.filter(f => f.renamedFrom && !f.dropped);
  if (renamed.length) {
    lines.push('', '### 이름을 바꿔 남긴 함수', '', '본문은 이름을 바꾸기 전 마지막 `create`에 있다.', '',
      '| 함수 | 이전 이름 | 이름 바꾼 파일 | 본문 정의 |', '| --- | --- | --- | --- |');
    for (const f of renamed) lines.push(`| \`${f.name}(${f.live.join('; ')})\` | \`${f.renamedFrom}\` | \`${short(f.finalFile)}\` | \`${short(f.bodyFile)}\` |`);
  }
  lines.push('', `## 테이블 (${summary.redefinedTables.length}개 변경 / 전체 ${summary.tableCount}개)`, '',
    '| 테이블 | 만든 파일 | 뒤 변경 (파일: 종류) |', '| --- | --- | --- |');
  for (const t of summary.redefinedTables) {
    const byFile = new Map();
    for (const a of t.alters) byFile.set(a.file, uniq([...(byFile.get(a.file) || []), ...a.detail]));
    const later = [...byFile].map(([file, kinds]) => `\`${short(file)}\`: ${kinds.join(', ')}`);
    if (t.created.length > 1) later.unshift(`다시 \`create table\`: ${t.created.slice(1).map(x => `\`${short(x)}\``).join(', ')}`);
    lines.push(`| \`${t.name}\` | \`${short(t.created[0])}\` | ${later.join('<br>')} |`);
  }
  if (summary.redefinedViews.length) {
    lines.push('', '## 뷰', '', '| 뷰 | 최종 | 이전 정의 |', '| --- | --- | --- |');
    for (const v of summary.redefinedViews) lines.push(`| \`${v.name}\` | \`${short(v.files.at(-1))}\` | ${v.files.slice(0, -1).map(x => `\`${short(x)}\``).join(', ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

export async function build(root) {
  const files = await load(root);
  return render(files, summarize(scan(files)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('../', import.meta.url);
  const text = await build(root);
  const target = new URL(OUTPUT, root);
  if (process.argv.includes('--check')) {
    const current = await readFile(target, 'utf8').catch(() => '');
    if (current !== text) { console.error(`${OUTPUT} is stale. Run node scripts/sql-final-definitions.mjs`); process.exit(1); }
    console.log(`${OUTPUT} is current.`);
  } else {
    await writeFile(target, text);
    console.log(`Wrote ${OUTPUT}`);
  }
}
