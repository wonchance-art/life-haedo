# RSS/Atom 개인 수신 — D 1단계

2026-11-05, main `2eebd27`의 [총괄 지시](https://github.com/wonchance-art/life-haedo/pull/212#issuecomment-6650230384)에 따른 구현이다. **실제 피드는 아직 지정되지 않았으며 기본 설정은 꺼져 있다.** 테스트는 합성 피드·가짜 Auth/Edge 응답·격리 PostgreSQL만 사용한다. 운영 설치·피드 실수신·실제 기기 검증 완료를 뜻하지 않는다.

## 사용 흐름과 확보 범위

설정 → 계정의 RSS/Atom 연결 → 주소 등록 → 기준 목록 미리보기 → `새 글만 수집 시작` → 새 글 확인 → 비공개 수신함/기존 자료 보관으로 이어진다. 처음 확인한 목록은 가져오지 않는다. 시작 목록에 없더라도 발행일이 오래됐거나 없거나 미래인 항목은 보류한다. 연결은 소유자당 한 곳이며 중지·재개·실패 재시도·연결 해제를 제공한다. 해제는 이미 받은 본문을 지우지 않는다.

이 단위는 RSS 2.0/Atom 1.0이 제공한 UTF-8 본문만 보관한다. 원문 페이지·사진·영상·댓글은 요청하지 않는다. 피드의 HTML은 실행하지 않고 원문 텍스트로 보여 준다. Atom 외부 본문/XHTML이나 여러 alternate 링크로 원문 주소를 정할 수 없는 항목은 해당 항목만 보류하고 다른 글은 처리한다. `xml:base`는 주소를 조용히 바꾸지 않도록 명시적으로 거부한다. 전체 원문을 확보했다는 표시를 하지 않는다. 보류 자료의 수동 채택·삭제 전파는 이번 단위에 포함하지 않는다.

2026-11-05 [총괄 최종 검수 결정](https://github.com/wonchance-art/life-haedo/pull/213#issuecomment-6650672822)에 따라 Atom `published`가 없을 때는 `updated`를 수집 기준 시각으로 사용한다. 이는 발행 시각만 허용했던 최초 fixture와 다른 결정이다. `updated`는 최초 발행일의 증거가 아니며 수정된 과거 항목일 수도 있다. 이 fallback과 이미 관측한 식별자·기준 목록을 함께 적용하며, 실제 원천의 날짜 사용 방식은 채택 전에 별도로 확인한다.

서버 수신함은 불변 사본이며 클라이언트는 기존 `Core.prepareImport`/`buildImportChanges`/`storage.commitLocal`로 정확한 자료 원문을 만든다. 같은 연결·항목 식별자는 같은 자료 ID를, 각 수신 판은 다른 원문 버전 ID를 사용한다. 재시도와 다른 기기 수신은 중복 자료를 만들지 않는다. 기존 자료의 계정 동기화·검색·백업 경로를 사용하며 이 기능에서 공개하거나 AI에 전송하지 않는다. 수신함의 연결 설정/기준 목록/작업 영수증 자체를 기존 자료 ZIP에 넣는 확장은 하지 않았다.

서버 수집과 자료 투영은 별개다. 닫힌 앱에서도 설정된 worker는 서버 수신함에 보관할 수 있지만, 기존 자료/검색 경로로의 투영은 RSS 연결 화면을 열었을 때 실행한다. 화면을 열면 페이지를 순서대로 자동 처리하고 중간에 화면·계정이 바뀌거나 저장에 실패하면 멈춘다. 다음 진입은 불변 ID로 재시도한다. 연결 중지·해제 후에도 이미 보관된 본문은 읽고 자료로 받을 수 있다. 새로운 판으로 휴지통 자료를 자동 복원하지 않는다.

**총괄에게 후속으로 넘기는 제한(MINOR 6):** 앱 시작·주기 동기화에서의 자동 자료 투영과 영속 투영 커서는 이번 단위에 포함하지 않았다. 기존 source version의 가장 늦은 시각을 커서로 추정하면 이전 실패 항목, 수동 페이지 조회, 백업 복원으로 생긴 공백을 건너뛸 수 있다. 공유 동기화 생명주기·자료 저장소는 다른 묶음 담당이며, 기기별 정확 원문 ACK와 복원 시 커서 무효화를 함께 설계해야 한다. 임시 커서로 수신 완료를 과장하지 않고 현재는 화면을 열 때 수신함 전체를 순회한다(O(n), 페이지별 바이트 제한과 취소 가능). 이후 통합 단위의 완료 기준은 앱 시작/주기 수신, 실패 공백 재시도, 새 기기·복원 후 재수신을 빠짐없이 보이고 반복 조회를 영속 영수증으로 줄이는 것이다.

## 경계와 예산

- `feed.mjs`의 `ALLOWED_HOSTS`는 빈 배열이다. 클라이언트가 허용 호스트를 지정할 수 없다. DB의 정확한 피드 URL 허용 목록과 `ready=false`가 별도의 관문이다.
- HTTPS의 정확 호스트만 허용하고 사용자정보·명시 포트·IP 표기·로컬 주소·프래그먼트와 리다이렉트를 거절한다. 다음 페이지도 같은 origin과 허용 목록을 검사한다. 사용자 지정 호스트를 받는 범용 수집기가 아니다.
- 호스트 허용 목록은 DNS 고정/pinning을 보장하지 않는다. 실제 원천 채택 시 총괄은 신뢰할 수 있는 운영자가 관리하는 공개 호스트인지 확인해야 한다. 임의 도메인 수집을 허용하는 변경에는 별도의 DNS/egress 방어가 필요하다.
- 활성 연결은 기본 60분, 한 실행 최대 2페이지·100항목, 응답 합계 2 MiB. 활성 연결은 매 실행 첫 페이지에서 시작하며, 읽은 페이지의 식별자가 모두 관측된 경우 해당 페이지까지 처리하고 다음 페이지로 가지 않는다. 초기 기준 목록은 커서를 이어 읽고 오류 없는 부분 완료는 즉시 다음 worker 실행 대상이 된다. 이는 총괄 검수에서 확정한 기준 목록 분할 진행의 예외이며, 한 실행 예산은 유지한다. 자료 원문 한 항목은 기존 Core의 1 MiB 제한을 따르고 초과 원문은 자르지 않고 보류한다. 사진 10 MiB 상한은 이번에 사진 수집을 하지 않으므로 사용하지 않는다.
- GUID/Atom ID 우선, 없으면 피드가 제공한 링크를 사용한다. 식별 충돌과 식별 불능은 자동 자료 보관을 막는다. 발행 시각과 최초 관측 시각을 구분한다.
- 비공개 스키마·RLS·최소 함수 실행 권한, 소유자 확인, lease/revision·영수증·트랜잭션으로 늦은 결과와 재시도를 다룬다. 브라우저는 계정/화면이 바뀐 응답을 버린다. 공개 셸/SW에는 코드만 있고 본문/영수증은 없다.

## 실행 구성

`index.ts` → `handler.mjs` → `feed.mjs`와 고정 XML 파서 번들. 신규 SQL은 `supabase/migrations/20261105051010_rss_private_intake.sql`이다. 기존 네이버 파일과 기존 자료 스키마는 변경하지 않는다.

사용자 요청은 `{action, workspaceId, ...}` 형태의 POST다. `list`, `register`, `preview`, `poll`, `activate`, `pause`, `resume`, `retry`, `disconnect`를 제공한다. 상태 변경은 예상 revision을 요구한다. Auth 서버에서 사용자를 확인하고 사용자 토큰으로 소유 자료를 조회한 후에만 제한된 worker RPC를 호출한다. 서비스 전용 `run`은 최대 두 연결만 확인하며 일반 사용자 JWT로 실행할 수 없다. 새 secret key는 Bearer JWT로 보내지 않고 기존 `serverHeaders()` 계약을 따른다.

이미 관측한 식별자 확인 RPC도 서비스 전용이며 소유자·연결을 확인하고 최대 100개만 조회한다. 완료 기록은 호출자의 취소 신호와 분리된 제한 시간으로 저장한다. `not_due`·`stale`는 실행 성공과 구분해서 응답한다. 실패 재시도는 1시간에 2회까지이며, 연결 해제 전에는 보관본 유지와 재연결 시 기준 목록을 새로 만든다는 점을 확인받는다.

주기 실행 경로는 구현했지만 Cron 등록은 하지 않았다. 연결 활성화와 운영 스케줄 설치는 다르다. 실제 피드 주소, 코드의 호스트 허용 목록, DB 정확 URL 설정, Edge 배포와 Cron은 총괄의 후속 작업이다. 이 README에는 실행용 운영 SQL이나 비밀값을 넣지 않는다.

Cron의 worker 호출 주기와 활성 피드의 60분 수집 간격은 다르다. 기준 목록을 신속히 이어가려면 worker 호출은 더 짧은 주기(예: 1분)를 검토해야 하며, 활성 피드의 실제 수집 간격은 DB의 `next_check_at`이 지킨다. 각 호출은 최대 두 연결만 처리한다. 운영 주기·비용의 최종 결정과 등록은 총괄에게 남긴다.

## XML 파서 선택과 재현

기존 네이버 파서는 해당 서비스 전용이므로 일반 RSS/Atom 문법에 재사용하지 않았다. 기존 SNS 전략에서 검토한 MIT `fast-xml-parser` 5.12.0을 고정하고, 정규식만으로 XML을 직접 파싱하는 대안은 제외했다. 약 63.1 KiB의 ESM 번들은 Edge 전용이며 브라우저 셸에 포함하지 않는다. 의존성 라이선스는 `vendor/LICENSES.txt`, 전이 의존성 잠금은 `tests/fixtures/rss/package-lock.json`에 있다. DTD/ENTITY를 거절하고 깊이·확장·본문 바이트 제한을 별도로 둔다. 라이선스·현재 공식 자료 비교는 기존 `docs/life-tools-design/sns-automation-strategy.md`의 오픈소스 절도 참조한다.

번들 SHA-256: `438ed6e4997ab8a22fb76957c5a12b5956f95965d105cb0ac8cbc75bec627f55`.

저장소 루트에서 재현:

```sh
npm ci --prefix tests/fixtures/rss --ignore-scripts
npx --yes esbuild@0.28.2 tests/fixtures/rss/parser-entry.mjs --bundle --platform=neutral --main-fields=module,main --format=esm --target=es2022 --minify --legal-comments=inline --outfile=supabase/functions/haedo-rss/vendor/fast-xml-parser.mjs
```

## 검증 명령

```sh
node --test tests/rss-edge.test.cjs tests/rss-client.test.cjs
node tests/run-rss-postgres.cjs
node tests/rss-connection-browser.cjs
deno check supabase/functions/haedo-rss/index.ts
npm test
npm run check
node scripts/check-markdown-links.cjs
git diff --check
```

SQL 검사는 Docker의 고정 PostgreSQL 이미지로 네트워크 없는 일회용 DB를 만들며 외부 접속 인자를 받지 않는다. 브라우저 검사 실행 옵션과 가짜 서버 구성은 검사 파일 머리말을 따른다. 각 결과·변이 실패 증거·최종 독립 검수는 정확 head SHA와 함께 PR 댓글에 기록한다. 기존 단위 검사에는 `npm ci --prefix tests/fixtures/naver-extractor --ignore-scripts`가 필요하다. RSS 파서는 Edge 안의 고정 번들을 공유하므로 테스트 중 패키지 설치나 피드 호출이 필요하지 않다.

Deno 2.9.6에서 진입점 타입 검사와 vendor/feed를 직접 불러온 한국어 fixture 파싱도 확인했다. 호스팅된 Supabase Edge에서의 동작이나 운영 배포 검증을 대신하지 않는다.

## 총괄에게 넘길 것

1. 최종 독립 검수·새 브라우저/격리 DB 검사 CI 등록. 설정 화면의 새 연결 행은 디자인 세션에 전달한다.
2. 실제 원천을 받은 뒤 허용 호스트·정확 피드 URL·권리/보관 조건을 확인하고 fixture와의 차이를 검증한다. 그 뒤에만 운영 SQL/Edge/Cron 활성화를 판단한다.
3. 병합 시 다른 묶음의 셸 목록을 보존하고 CACHE 판올림·배포·라이브 확인을 담당한다. 작업자는 해당 작업을 하지 않았다.

다음 단위는 승인된 실제 원천의 새 글 실수신과 계정 간 복원 확인이다. 선행 조건은 원천 확정·운영 설치이며, 완료 기준은 기준 목록 제외·신규 판 보관·중지/재개·실패 복구를 실제 원천에서 확인하는 것이다. 이번 fixture 검증을 그 완료 근거로 대체하지 않는다.
