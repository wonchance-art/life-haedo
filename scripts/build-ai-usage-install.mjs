// Builds supabase/operations/20261104-ai-usage-install.sql: the 2026-11-04 monthly AI cap
// migration as ONE DO statement (EXECUTE), with the row-count guard and result checks of
// the earlier installs. Run: node scripts/build-ai-usage-install.mjs
// The orchestrator applies it (or the migration) to production; workers never run it.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { body } from './build-account-sync-install.mjs';

export const MIGRATION = '20261104090000_life_ai_usage.sql';
export const OUTPUT = 'supabase/operations/20261104-ai-usage-install.sql';
const PUBLIC_RPCS = "'life_ai_usage','life_ai_reserve','life_ai_settle','life_ai_release'";
const WRITERS = "'life_ai_reserve','life_ai_settle','life_ai_release'";

export async function build(root = new URL('../', import.meta.url)) {
  const sql = await readFile(new URL(`supabase/migrations/${MIGRATION}`, root), 'utf8');
  const text = body(sql, MIGRATION), tag = '$haedo_ai_m1$';
  if (text.includes(tag) || text.includes('$haedo_install$')) throw new Error(`${MIGRATION}: dollar-quote tag collision`);
  const sha = createHash('sha256').update(sql).digest('hex');
  return `-- 해도 2026-11-04 AI 제안 월 상한 설치 (Supabase SQL Editor에서 한 번에 실행)
-- 생성: node scripts/build-ai-usage-install.mjs — 직접 고치지 말고 원본 마이그레이션을 고친 뒤 다시 생성한다.
-- 포함 마이그레이션(원본 sha256):
--   ${MIGRATION}  ${sha}
--
-- 안전 장치:
--   * 설치 전체가 DO 블록 "한 문장"이다. 어느 단계에서 실패하면 전체가 되돌려져 아무것도 바뀌지 않는다.
--   * 설치 전후로 public·haedo_* 스키마의 모든 테이블과 storage.objects의 행 수를 비교하고,
--     하나라도 달라지면 예외를 내서 전체를 되돌린다(설치 중 새로 만든 테이블은 비교에서 제외).
--   * 새 스키마 haedo_ai_private와 새 함수만 만든다. 기존 테이블·함수·행은 읽거나 바꾸지 않는다.
--   * 다시 실행해도 된다(if not exists / create or replace / drop policy if exists).
--   * 사용자 데이터 삭제·권한 완화가 없다. anon에는 어떤 실행 권한도 주지 않는다.
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

  -- ===== ${MIGRATION} =====
  execute ${tag}
${text}
${tag};

  for r in select key as relation, value::bigint as rows from jsonb_each_text(before) loop
    execute format('select count(*) from %s', r.relation) into n;
    if n <> r.rows then
      raise exception 'Row count changed in % (% -> %); installation rolled back', r.relation, r.rows, n;
    end if;
  end loop;

  if to_regclass('haedo_ai_private.usage') is null or to_regclass('haedo_ai_private.reservations') is null then raise exception 'AI usage tables missing'; end if;
  if not (select relrowsecurity from pg_class where oid = 'haedo_ai_private.usage'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'haedo_ai_private.reservations'::regclass) then raise exception 'RLS disabled on an AI usage table'; end if;
  if (select count(distinct proname) from pg_proc where pronamespace = 'public'::regnamespace and proname in (${PUBLIC_RPCS})) <> 4 then
    raise exception 'an AI usage RPC is missing';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'haedo_ai_private'::regnamespace)
             and (p.proname in (${PUBLIC_RPCS}) or p.pronamespace = 'haedo_ai_private'::regnamespace)
             and has_function_privilege('anon', p.oid, 'execute')) then
    raise exception 'anon can execute an AI usage function';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${WRITERS})
             and has_function_privilege('authenticated', p.oid, 'execute')) then
    raise exception 'a signed-in user can write AI usage directly';
  end if;
  if haedo_ai_private.monthly_limit_micro_usd() <> 10000000 then raise exception 'unexpected monthly AI cap'; end if;
  raise notice 'haedo AI usage cap installed; % existing tables unchanged', (select count(*) from jsonb_object_keys(before));
end
$haedo_install$;

-- 결과 확인용(읽기 전용)
select 'AI usage tables + RLS' as check_name,
       coalesce((select relrowsecurity from pg_class where oid = to_regclass('haedo_ai_private.usage')), false)
       and coalesce((select relrowsecurity from pg_class where oid = to_regclass('haedo_ai_private.reservations')), false) as ok
union all
select 'AI usage RPCs present', (select count(distinct proname) = 4 from pg_proc where pronamespace = 'public'::regnamespace and proname in (${PUBLIC_RPCS}))
union all
select 'anon cannot execute AI usage functions', not exists (select 1 from pg_proc p
  where (p.pronamespace = 'public'::regnamespace and p.proname in (${PUBLIC_RPCS}) or p.pronamespace = 'haedo_ai_private'::regnamespace)
  and has_function_privilege('anon', p.oid, 'execute'))
union all
select 'only service_role writes AI usage', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${WRITERS})
  and (has_function_privilege('authenticated', p.oid, 'execute') or not has_function_privilege('service_role', p.oid, 'execute')))
union all
select 'monthly cap is $10', haedo_ai_private.monthly_limit_micro_usd() = 10000000;
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = await build();
  await writeFile(new URL(`../${OUTPUT}`, import.meta.url), text);
  console.log(`Wrote ${OUTPUT} (${Buffer.byteLength(text)} bytes).`);
}
