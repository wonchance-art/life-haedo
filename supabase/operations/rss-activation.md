# RSS/Atom 운영 활성화 인계

이 문서는 [D1 총괄 지시](https://github.com/wonchance-art/life-haedo/pull/212#issuecomment-6658434756)에 따른 **운영 전 준비물**이다. 기준은 main `5fcaa3f80947fa78352a9d8e1724de557141b4e8`이다. 실제 피드 주소는 아직 없으며 이 작업에서 운영 DB·Edge·Cron·비밀값을 변경하거나 실제 피드를 요청하지 않는다. 적용·배포·첫 실수신은 총괄 담당이다.

현재 저장소의 `ALLOWED_HOSTS=[]`, DB 설치 기본값 `ready=false`, `allowed_feed_urls=[]`는 그대로다. 아래 SQL 세 파일도 그대로 실행하면 `inspect`만 수행한다. 실제 적용에는 검수된 파일의 선언부만 총괄이 명시적으로 바꾼다. 외부 `SET LOCAL`이나 문장별 실행에 의존하지 않으며, 각 파일의 변경과 보존 검사는 하나의 `DO` 문장 안에 있다.

| 파일 | 기본값 | 총괄이 적용할 때 | 변경 범위 |
| --- | --- | --- | --- |
| [rss-activation.sql](rss-activation.sql) | `action='inspect'` | `action='activate'`, 승인된 `feed_url`, `feed_review='verified'`, `edge_review='verified'` | RSS runtime의 허용 URL 한 곳과 `ready` |
| [rss-cron.sql](rss-cron.sql) | `action='inspect'` | `action='schedule'`, `edge_review='verified'` | `haedo-rss-poll` 일정 한 개 |
| [rss-rollback.sql](rss-rollback.sql) | `action='inspect'` | `action='rollback'` | RSS `ready=false`, RSS 일정만 해제 |

`verified`는 실제 원천·배포 검증을 끝낸 총괄의 확인 기록이다. SQL이 원격 Edge의 배포 내용이나 실제 피드 조건을 대신 확인하지 않는다. `__RSS_FEED_URL__`는 승인된 정확 주소를 넣기 전까지 남겨 두는 자리표시자이며, 그 상태의 활성화는 실패해야 한다. 상세 원천 조건과 허용 목록 PR 초안은 [rss-allowlist-pr.md](rss-allowlist-pr.md)를 따른다.

## 적용 순서와 사전 기록

1. **RSS 마이그레이션을 설치한다.** [20261105051010_rss_private_intake.sql](../migrations/20261105051010_rss_private_intake.sql)의 검수 SHA-256은 `d4914f97717f81e55cc05cefa642bff5e4137753bdaa3becdc8cc8914866187c`다. 적용 전 스키마·RPC 존재 여부, 함수 정의 해시·권한과 관련 표의 행 수를 기록한다. 이미 설치돼 있으면 현재 정의·권한을 대조하고 재실행하지 않는다. 이 마이그레이션은 `BEGIN`/`COMMIT`을 포함하므로 전체를 같은 세션 트랜잭션으로 실행하는 도구를 사용한다. SQL Editor가 문장을 나누어 커밋하는 실행 방식으로 원자성을 추정하지 않는다. 설치 후 신규 runtime 한 행이 꺼짐·빈 허용 목록인지, 기존 행 수·권한이 보존됐는지 확인한다.
2. **실제 피드를 받은 뒤 허용 목록 PR을 검수·병합한다.** 공개 HTTPS 호스트·정확 URL 한 곳, 최신순/날짜/페이지 조건과 보관 가능 범위를 확인한다. 피드 내용을 저장소나 보고에 복사하지 않는다. 아직 주소가 없으면 여기서 멈추며 샘플 도메인을 운영 허용 목록에 넣지 않는다.
3. **검수한 커밋의 `haedo-rss` Edge를 배포한다.** `verify_jwt=false`와 아래 파일 대조를 확인한다. 이 설정에서도 사용자 요청은 Auth 서버의 사용자 확인을 거치고, `run` 요청은 Edge가 선택한 서버 키와 정확히 일치하는 `apikey`를 요구한다. 일반 사용자 JWT로 Cron 배치를 실행할 수 없다. 배포 실패·파일 불일치이면 runtime을 켜지 않는다.
4. **활성화 SQL을 적용한다.** `rss-activation.sql`을 기본 `inspect`로 실행해 전 상태를 기록하고, 승인한 입력으로 `activate`를 수행한다. 직후 다시 원본 `inspect`로 상태·행 수를 대조한다. 이 단계는 사용자 연결 등록이나 `새 글만 수집 시작`을 대신하지 않는다.
5. **마지막으로 Cron을 등록한다.** 총괄이 기설치된 pg_cron·pg_net·Vault의 가용성과 아래 Vault 조건을 확인한 뒤 `rss-cron.sql`의 기본 점검 → `schedule` → 기본 점검 순으로 실행한다. 이 SQL은 확장을 설치하거나 권한을 부여하지 않는다. 준비되지 않았다면 총괄이 설치 범위를 별도로 판단한다. 새 일정은 `haedo-rss-poll`, 주기는 `* * * * *`이다. 같은 이름으로 반복 적용해도 일정을 중복 생성하지 않아야 한다. 다른 Cron 일정은 그대로 남는다.

각 변경 전후에는 SQL의 요약 출력을 보관한다. 출력 대상은 표별 행 수, runtime 상태·허용 URL **개수**, 연결 상태별 개수·오류 개수, RSS Cron 개수다. 본문·제목·원문 URL·계정 ID·작업 토큰·키 값과 `cron.job.command`는 보고에 출력하지 않는다. SQL은 `public`·`haedo_*` 표와 `storage.objects` 행 수 및 관계없는 Cron 행 보존을 검사한다. 다른 저장이 동시에 행 수를 바꾸면 보수적으로 예외를 내며 해당 변경 전체를 되돌린다. 이 경우 원인을 확인하고 다시 점검한다. 행 수 일치는 원문 내용의 동일성을 증명하지 않으며 원문 테이블을 갱신하지 않는 코드와 격리 검사도 함께 확인한다.

### 전후 확인 쿼리

다음은 총괄이 실행할 읽기 전용 쿼리다. 첫 쿼리는 RSS 설치 전에도 실행할 수 있다. 적용 직전·직후 결과를 구분해 보관하며, 이미 있는 표의 행 수가 달라지면 원인을 확인하기 전 다음 단계로 넘어가지 않는다.

```sql
select to_regnamespace('haedo_rss_private') is not null as rss_schema_exists,
       to_regclass('haedo_rss_private.runtime') is not null as runtime_exists,
       to_regclass('cron.job') is not null as cron_exists,
       to_regprocedure('cron.schedule(text,text,text)') is not null as cron_schedule_exists,
       to_regprocedure('cron.unschedule(bigint)') is not null as cron_unschedule_exists,
       to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null as http_post_exists,
       to_regclass('vault.decrypted_secrets') is not null as vault_view_exists;

do $rss_counts$
declare r record; n bigint;
begin
  for r in
    select format('%I.%I', s.nspname, c.relname) as relation
    from pg_class c join pg_namespace s on s.oid=c.relnamespace
    where c.relkind in ('r','p') and
      (s.nspname='public' or s.nspname like 'haedo\_%'
       or (s.nspname='storage' and c.relname='objects'))
    order by s.nspname,c.relname
  loop
    execute format('select count(*) from %s',r.relation) into n;
    raise notice '% rows=%',r.relation,n;
  end loop;
end
$rss_counts$;

select s.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       md5(pg_get_functiondef(p.oid)) as definition_md5, p.prosecdef, p.proacl
from pg_proc p join pg_namespace s on s.oid=p.pronamespace
where p.prokind='f' and
  (s.nspname='haedo_rss_private' or (s.nspname='public' and p.proname like 'life_rss\_%'))
order by s.nspname,p.proname,arguments;

select c.relname, c.relrowsecurity, c.relacl
from pg_class c join pg_namespace s on s.oid=c.relnamespace
where s.nspname='haedo_rss_private' and c.relkind in ('r','p')
order by c.relname;
```

함수 해시는 같은 검수 커밋을 재생한 격리 DB 결과와 비교한다. 해시 비교만으로 권한·RLS 비교를 대신하지 않는다. RSS 설치 뒤에는 아래 상태 쿼리도 함께 확인한다. `cron.job` 조회는 위 존재 확인이 참이고 pg_cron 설치가 끝난 뒤 실행한다.

```sql
select ready, cardinality(allowed_feed_urls) as allowed_url_count
from haedo_rss_private.runtime where singleton;
select status, count(*) as connections, count(*) filter(where last_error is not null) as errors,
       min(next_check_at) as next_check_at
from haedo_rss_private.connections group by status order by status;
select disposition, reason, count(*) as items, max(fetched_at) as latest_received_at
from haedo_rss_private.items group by disposition,reason order by disposition,reason;
select jobname, schedule, active,
       position('''apikey''' in command)>0 and position('Authorization' in command)=0 as apikey_only,
       position('vault.decrypted_secrets' in command)>0 as vault_reference
from cron.job where jobname='haedo-rss-poll';
```

예상 전이는 설치 직후 `false/0개`, 활성화 뒤 `true/1개`, Cron 등록 뒤 활성 일정 1개, 중지 뒤 `false/1개`와 RSS 일정 0개다. 중지는 허용 URL·보관 행을 지우지 않는다. 첫 수신의 항목 증가는 해당 시각의 실제 신규 수신과 대조하며 단순 행 수 변화만으로 성공을 판정하지 않는다.

## Edge 파일·설정 대조

배포할 깨끗한 체크아웃에서 아래 명령으로 커밋과 파일 해시를 기록한다. 새 원천을 넣은 `feed.mjs`의 해시는 허용 목록 PR의 최종 커밋으로 다시 확정한다.

```sh
git rev-parse HEAD
git status --porcelain
sha256sum supabase/functions/haedo-rss/index.ts \
  supabase/functions/haedo-rss/handler.mjs \
  supabase/functions/haedo-rss/feed.mjs \
  supabase/functions/haedo-rss/vendor/fast-xml-parser.mjs \
  supabase/functions/_shared/supabase-keys.mjs
sha256sum supabase/functions/haedo-rss/vendor/LICENSES.txt
```

`index.ts`만 배포 목록에 올리지 않는다. 실행 파일 5개가 같은 검수 커밋에서 포함돼야 한다. `LICENSES.txt`는 로컬 라이선스 근거로 따로 기록한다. import되지 않는 문서이므로 배포 번들의 필수 실행 파일로 세지 않는다. 로컬 파일의 해시는 배포된 파일의 해시 증거가 아니다.

아래는 **총괄이 운영 단계에서 실행할 예시**다. 대상 프로젝트 ref는 총괄이 확인해 `RSS_PROJECT_REF`에 설정한다. 2026-11-05에 CLI **3.0.0**의 버전·도움말만 확인했으며 이 예시의 배포·목록·다운로드는 실행하지 않았다. 이 버전은 `--remote`를 사용한다. 다른 버전을 사용할 때는 해당 버전의 도움말을 다시 확인한다.

```sh
set -eu
: "${RSS_PROJECT_REF:?총괄이 확인한 대상 프로젝트 ref를 설정하세요}"
RSS_REVIEW_ROOT="$(git rev-parse --show-toplevel)"
test -z "$(git -C "$RSS_REVIEW_ROOT" status --porcelain)"
RSS_VERIFY_DIR="$(mktemp -d)"
mkdir -p "$RSS_VERIFY_DIR/supabase"
git -C "$RSS_REVIEW_ROOT" rev-parse HEAD > "$RSS_VERIFY_DIR/reviewed-commit.txt"

npx --yes --package=supabase@3.0.0 supabase functions deploy haedo-rss \
  --remote="$RSS_PROJECT_REF" --no-verify-jwt --use-api --workdir "$RSS_REVIEW_ROOT"
npx --yes --package=supabase@3.0.0 supabase functions list \
  --remote="$RSS_PROJECT_REF" --output json > "$RSS_VERIFY_DIR/deployed-functions.json"
npx --yes --package=supabase@3.0.0 supabase functions download haedo-rss \
  --remote="$RSS_PROJECT_REF" --use-api --workdir "$RSS_VERIFY_DIR"

RSS_REVIEW_ROOT="$RSS_REVIEW_ROOT" RSS_VERIFY_DIR="$RSS_VERIFY_DIR" python3 - <<'PY'
from hashlib import sha256
from pathlib import Path
import os
import subprocess

reviewed = Path(os.environ['RSS_REVIEW_ROOT'])
downloaded = Path(os.environ['RSS_VERIFY_DIR'])
reviewed_commit = (downloaded / 'reviewed-commit.txt').read_text().strip()
paths = [
    'supabase/functions/haedo-rss/index.ts',
    'supabase/functions/haedo-rss/handler.mjs',
    'supabase/functions/haedo-rss/feed.mjs',
    'supabase/functions/haedo-rss/vendor/fast-xml-parser.mjs',
    'supabase/functions/_shared/supabase-keys.mjs',
]
for relative in paths:
    actual = downloaded / relative
    if not actual.is_file():
        raise SystemExit('필수 실행 파일 누락: ' + relative)
    expected_bytes = subprocess.check_output(
        ['git', '-C', str(reviewed), 'show', reviewed_commit + ':' + relative])
    expected_hash = sha256(expected_bytes).hexdigest()
    actual_hash = sha256(actual.read_bytes()).hexdigest()
    if expected_hash != actual_hash:
        raise SystemExit('배포 파일 불일치: ' + relative)
    print(actual_hash, relative)
PY
```

총괄은 목록/배포 관리 화면의 `haedo-rss` 버전·시각과 **`verify_jwt=false`**도 확인해 기록한다. 위 해시 스크립트는 런타임 설정을 확인하지 않는다. 내려받은 소스의 경로·바이트 보존은 실제 호스팅 환경에서 아직 확인하지 않았다. 경로가 달라지거나 실행 파일이 누락되거나 서버 소스를 얻을 수 없으면 위 대조는 실패하며, 임의로 제외해 통과시키지 않는다. 배포 도구의 파일 매핑을 확인해 별도 검수한 대조 근거가 생기기 전에는 활성화하지 않고 “서버 해시 일치”로 보고하지 않는다.

## Vault와 Cron 호출

총괄은 Vault에 아래 **이름**을 각각 한 개씩 준비한다. 키 값은 SQL·저장소·출력·브라우저 설정에 넣지 않는다. 이 인계 SQL은 비밀값을 생성하거나 교체하지 않는다.

| Vault 이름 | 값의 조건 |
| --- | --- |
| `haedo_rss_project_url` | 배포한 대상의 `https://…supabase.co` origin. 경로·쿼리·인증 정보가 없어야 한다. |
| `haedo_rss_service_role_key` | 같은 프로젝트에서 Edge의 공통 키 선택기가 선택한 서버 키와 같은 값. 새 `sb_secret_` 키 또는 기존 service JWT이며 publishable/anon 키를 쓰지 않는다. |

키 모양만 통과하는 것으로 올바른 프로젝트·권한·현재 Edge 키와의 일치를 증명할 수 없다. 공통 키 선택기는 `SUPABASE_SECRET_KEYS.default`를 우선하고 기존 `SUPABASE_SERVICE_ROLE_KEY`를 대체 경로로 쓴다. 총괄이 이 선택 결과와 Vault 설정을 비밀값을 출력하지 않고 맞춰야 한다.

Cron은 실행 시 Vault 이름을 조회하고 `/functions/v1/haedo-rss`에 JSON `{"action":"run"}`을 POST한다. `Content-Type: application/json`과 `apikey`를 쓰며 새 secret key를 `Authorization: Bearer`로 보내지 않는다. HTTP 제한 시간은 120초다. Cron 설정문에 키 리터럴을 복사하지 않는다.

pg_net은 발송 전 대기열에 복호화한 요청 헤더를 잠시 저장한다. Vault 참조는 `cron.job.command`에 키를 고정하지 않는 방법이며 대기열에서 키가 사라진다는 보장이 아니다. `net.http_request_queue`의 헤더·본문을 확인 로그로 출력하지 않는다. 이 준비물은 기존 대기열 권한을 변경하지 않는다.

Cron의 1분은 **worker 확인 간격**이다. 정상 활성 피드 수집은 DB의 `next_check_at`으로 원천별 60분 간격을 유지한다. 한 worker 호출은 최대 두 연결을 처리하며 연결별 실행은 최대 2페이지·100항목·텍스트 2 MiB다. 자료 원문 한 항목은 1 MiB까지이며 초과 원문을 잘라 보관하지 않는다. 사진·영상·댓글·원문 페이지는 요청하지 않는다. 따라잡기는 저장된 커서를 이어가며 즉시 재확인은 연속 한 회차, 회차는 처리한 총 50페이지까지다. 자세한 예산·실패 계약은 [RSS README](../functions/haedo-rss/README.md#경계와-예산)를 따른다.

## 첫 실수신 확인 — 총괄 운영 단계

아래는 아직 실행하지 않은 완료 기준이다. 실제 원천을 확보하고 위 설치가 끝난 뒤 소유자의 사용 흐름으로 확인한다. 운영에서 실패를 일으키려고 원본 피드나 사용자 데이터를 수정하지 않는다. 오류 주입은 격리 fixture에서만 한다.

1. 설정의 RSS/Atom 연결에서 승인된 주소를 등록한다. 처음에는 `pending`이며 기준 목록 확인이 끝나면 `preview`다. `새 글만 수집 시작` 전에 기준 목록은 자료로 들어오지 않아야 한다. 미완료 기준 목록을 강제로 `active`로 바꾸지 않는다.
2. 사용자가 `새 글만 수집 시작`을 선택한 뒤 `active`와 확인 예정 시각을 본다. 이후 실제로 발행된 새 항목 한 개를 기다려 수신함의 `stored` 증가, 정확 원문 판 보관, 자료 읽기·검색을 확인한다. 과거·날짜 불명·미래·식별 충돌 항목은 `held`로 구분하며 성공 본문으로 세지 않는다.
3. 같은 항목의 재확인과 다른 기기 수신으로 자료가 중복되지 않는지 본다. 기준 main에서는 기존 자료 반영이 RSS 화면을 열 때 수행된다. E의 앱 시작·주기 반영/영속 ACK 작업이 병합됐는지는 별도로 확인하고, 미병합 상태를 자동 반영 완료로 보고하지 않는다.
4. 중지·재개·사용자 재시도·연결 해제를 확인한다. 중지/해제는 이미 받은 본문·기존 자료를 삭제하지 않는다. 해제 후 재연결은 새 기준 목록을 만드는 동작이며 과거 누락 복구 수단이 아니다.
5. 오류가 발생하면 마지막 오류·자동 재시도 여부·다음 시각을 기록한다. `network_error`/`rate_limited`는 처음 두 번까지 60분 뒤 자동 재시도하며 세 번째부터 멈춘다. 연속 미완료 lease도 세 번째에서 `server_error`로 정지한다. 형식·URL·상한 오류를 무한 재시도하지 않는다. 보고에는 상태·개수·시각만 남긴다.

Cron HTTP 요청이 접수됐거나 HTTP 200인 것만으로 새 글 보관을 판정하지 않는다. worker 응답의 `checked/stored/failed/stale`는 **연결 실행 개수**이고 항목 수가 아니다. runtime·연결 상태·수신 항목 개수를 함께 대조한다. pg_net 응답에는 타 작업의 응답이 섞일 수 있으므로 전체 응답 본문을 덤프하지 않는다.

## 실패 시 중지와 재개

배포 파일 불일치, 인증 실패, 잘못된 원천·부하 또는 보존 검사 실패가 해결되지 않으면 `rss-rollback.sql`을 기본 점검한 뒤 `action='rollback'`으로 실행한다. `ready=false`와 RSS 일정 해제를 함께 적용해 자동 수집을 멈춘다. runtime의 승인 URL, 기존 연결 상태, 원문·관측·영수증은 유지한다. 다른 Cron·RLS·권한·스키마는 바꾸지 않는다.

활성화와 Cron 등록은 **각각 별도 트랜잭션**이다. 활성화가 성공한 뒤 Cron 등록만 실패하면 `ready=true`는 남아 수동 수집이 가능하다. 전체 운영 개시를 중단하려면 되돌리기 파일을 실행하고 꺼짐·일정 0개를 확인한다. 되돌리기 자체가 실패하면 해당 문장도 전부 원복되므로, 꺼졌다고 추정하지 말고 오류를 총괄에게 기록하고 현재 상태를 다시 확인한다.

이 중지는 이미 전송된 HTTP 요청 자체를 취소하지는 않는다. 꺼진 runtime을 확인한 claim/finish는 새 작업·저장을 진행하지 않지만, 중지 커밋 전에 끝난 정상 저장은 보존한다. 따라서 중지 뒤 다시 상태와 행 수를 확인한다. 잠시 늦어진 결과를 없애려고 본문·영수증을 삭제하거나 연결을 초기화하지 않는다.

원인이 해결되면 배포·원천 조건을 다시 확인하고 활성화 → Cron 순으로 진행한다. 이미 받은 자료와 진행 위치를 남겨 둔 상태에서 이어받는다. 서버 코드의 과거 판으로 되돌려야 하는 상황은 총괄이 별도로 판단하며, 이 SQL은 코드 배포나 데이터 복원을 수행하지 않는다.

## 검증과 남은 관문

저장소 루트에서 다음 검사로 실제 운영 SQL을 네트워크 없는 격리 PostgreSQL에 실행한다.

```sh
node tests/run-rss-operations-postgres.cjs
```

Docker와 로컬에 준비된 PostgreSQL 17 이미지 `postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`가 필요하다. 검사는 이미지를 자동으로 내려받지 않으며 전용 컨테이너를 `network=none`으로 만들고 종료 뒤 정리한다. pg_cron·pg_net·Vault는 함수 시그니처·권한·트랜잭션 실패를 재현하는 stub이므로, 실제 확장의 예약 실행·HTTP 발송·Vault 암호화나 호스팅 설정의 검증을 대신하지 않는다.

격리 검사의 결과와 변이 검증은 이 D1 PR의 정확 head SHA에 기록한다. 기본 점검의 무변경, 미확정 URL·미검증 Edge의 활성화 거절, 같은 일정 재실행, 다른 일정/기존 행 보존, 중지 후 재적용을 확인해야 한다. 운영 프로젝트·실제 피드·호스팅 Edge·Apple 기기는 이 준비물의 검증 범위가 아니다.

공식 참고: [Edge 배포](https://supabase.com/docs/guides/functions/deploy), [함수 인증](https://supabase.com/docs/guides/functions/auth), [예약 호출](https://supabase.com/docs/guides/functions/schedule-functions), [Vault](https://supabase.com/docs/guides/database/vault), [API 키](https://supabase.com/docs/guides/api/api-keys). 실제 적용 시 총괄이 현재 문서·CLI 버전과 대상 프로젝트 조건을 다시 대조한다.
