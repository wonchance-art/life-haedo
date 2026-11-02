# 구조·작업 흐름 검토 B3 — CI 밖 브라우저 검사 · 네이버 자동 수집 계약 · 공개 요청 보관 (2026-11-02)

- 기준: `origin/main` `a8d4a65`. 작업자 B3. 앱 코드·마이그레이션·워크플로·운영 DB는 바꾸거나 읽지 않았다.
- 실행 환경: Linux, Node v22.23.4, Playwright 1.63.0(`/opt/node-tools`), Chrome for Testing 153.0.8010.12, `python3 -m http.server` 정적 서버(포트 4951·4960). Apple 기기·실제 계정·운영 SQL은 다루지 않았다.
- 고치지 않고 보고만 한다. 재현 스크립트 1개를 [repro/share-pending.cjs](evidence/structure-workflow-20261102/repro/share-pending.cjs)에 남겼다.

## 1. CI가 실행하지 않는 브라우저 검사

### 목록 산출 방법

1. `tests/*-browser.cjs` 151개를 나열했다.
2. `.github/workflows/pages.yml`에서 `tests/<이름>-browser.cjs` 형태의 참조를 모두 추출했다(137개). 차집합은 14개다.
3. pages.yml이 부르는 스크립트(`scripts/verify-prepared-site.mjs`, `scripts/check-blog-backend.mjs`, `supabase/tests/*.mjs`, `tests/run-*.cjs`)와 다른 검사의 `require`에서 이 14개의 이름을 다시 찾았다.
   - `platform-life-browser.cjs`는 `scripts/verify-prepared-site.mjs:59`가 `SITE_DIR`·`OLD_SITE_DIR`를 주고 `spawnSync`로 실행한다. pages.yml이 blog 작업의 "Verify generated configuration and complete installed shell hashes" 단계에서 이 스크립트를 부른다. **간접 실행이므로 목록에서 뺐다.**
   - `life-sync-browser.cjs`와 `life-workbench-browser.cjs`는 CI 검사 여러 개가 라이브러리로 `require`한다(예: `tests/page-composer-browser.cjs:3`, `tests/life-share-browser.cjs:9-11`). 다만 둘 다 `require.main === module` 안에 자체 검사 본문이 있어 **라이브러리 전용이 아니다.** CI는 내보낸 도구만 쓰고 본문 검사는 돌리지 않으므로 목록에 남겼다.
   - 이 14개 중 라이브러리 전용(본문 없이 내보내기만 하는 파일)은 없다.
4. 결과: **13개**가 CI에서 실행되지 않는다.

### 실행 결과

각 파일을 한 번 실행하고 실패하면 한 번 더 실행했다. `BASE_URL=http://127.0.0.1:4951`, `PW_MODULE_PATH=/opt/node-tools/node_modules/playwright`, `CHROMIUM_PATH=/opt/pw-browsers/chromium`. 실패한 7개는 두 번째에도 **같은 검사가 같은 이유로** 실패했다(간헐 실패 아님). `SITE_DIR`·Postgres가 필요한 파일은 이 13개에 없어 "실행 불가"는 0개다.

| 파일 | 다루는 내용 | 결과 | 시간 |
| --- | --- | --- | --- |
| `life-sync-browser.cjs` | 계정 동기화 옵트인·오프라인 outbox·충돌 사본·계정 전환(가짜 Supabase) | 실패 0/14. 첫 실패 "login alone never uploads local work; explicit opt-in uploads" — `authentication alone issued workspace data requests` `2 !== 0` (`:260`). 마지막 "unexpected browser console/page errors"는 `ERR_INTERNET_DISCONNECTED` 2건 | 28초 ×2 |
| `life-batch-browser.cjs` | 여러 파일 가져오기 초안·부분 반영·중지·계정 전환 | 실패 7/8. "multiple files remain drafts; partial commit, reload, manual duplicate, source and backup copy" — `sourceVersions[0].contentText`가 `'첫 줄\n…마지막 줄\n'`, 기대 `'첫 줄\r\n…마지막 줄'` (`:96`) | 30·29초 |
| `life-browser.cjs` | 저장소·앱 기본 회귀(`life.html` 구 주소 포함) | 실패 22/23. "UI regression: changed input discards delayed prepare result" — `page.evaluate: Error: 로그인 계정을 다시 확인해 주세요.` (`blog-remote.js:53`의 `auth_required`, 검사 `:69`) | 21·22초 |
| `life-collections-browser.cjs` | 모음·가져오기 검토 편집 흐름 | 실패 5/6. "review input editing retains exact candidate and note …" — Tab 뒤 초점 id가 `''`, 기대 `'lifeImportEdit'` (`:126`) | 17·16초 |
| `life-search-browser.cjs` | 검색 흐름·계정 범위 IDB | 통과 7/7 | 28초 |
| `life-rediscovery-browser.cjs` | 다시 찾기 후보·제외·복원 | 실패 8/10. 첫 실패 "past-version seed shows three explained latest-source candidates and keeps storage unchanged" — `server.requests.length` `2 !== 0` (`:110`). 둘째 "failed exclusion save preserves pending change …" — `locator('[data-haedo-section="records"]')` strict mode 위반(본문 `body`와 탐색 링크 2개 일치) | 52·56초 |
| `life-workbench-browser.cjs` | 자료실 구성(묶음·페이지·백업·복원) 본문 검사 | 통과 17/17, 시각 27 | 94초 |
| `life-writing-browser.cjs` | 직접 글쓰기 저장·재열기 | 통과 12/12, 시각 9 | 43초 |
| `life-writing-sync-browser.cjs` | 글쓰기 두 기기 동기화·원문 불변·초안 제외 | 통과 1/1 | 9초 |
| `platform-import-browser.cjs` | 백업 파일 선택(`backupFile.onchange`) 계정 경계 A-B·A-B-A | 통과 3/3 | 3초 |
| `record-arrange-browser.cjs` | 기록 선택 → 묶음·페이지 구성 | 실패 13/14. "hidden selections can be removed and a batch stops at one hundred fixed versions" — `locator('#lifeSelectionBar summary')` strict mode 위반(선택 요약과 새 "선택한 자료를 폴더로 이동" `summary` 2개) | 100초 ×2 |
| `workbench-storage-browser.cjs` | 두 탭 IDB/BroadcastChannel 구성 저장·계정 범위 | 통과 5/5 | 3초 |
| `app-feel-browser.cjs` | 하단 탐색 끝 초점·정확 인용/검색 복귀·백업 보존(390/600/844) | 통과(종료 코드 0) | 20초 |

통과 6개, 실패 7개, 실행 불가 0개. 전체 약 13분.

### 실패의 성격(추정)

- **제품 계약이 바뀐 뒤 갱신되지 않은 단언으로 보이는 것:** `life-sync`(로그인만으로 요청 0건·명시 옵트인)와 `life-rediscovery` 첫 실패(원격 요청 0건)는 2026-11-01 "모든 데이터 계정 자동 연동" 지시 이후의 동작과 충돌한다. 요청 내용을 확인하지 않았으므로 추정이다.
- **새 UI 요소와 겹친 선택자:** `record-arrange`와 `life-rediscovery` 둘째 실패는 strict mode 위반이다. 폴더 이동 `summary`, `body`의 `data-haedo-section`이 추가되며 선택자가 모호해졌다.
- **실제 결함일 수 있어 확인이 필요한 것:**
  - `life-batch`: 정확 원문(CRLF·끝 줄바꿈 없음)을 기대한 자리에 LF·끝 줄바꿈 본문이 나온다. 정렬 순서가 바뀐 것인지 원문 정규화인지 판정하지 않았다. 정확 원문 보존 계약과 관련되므로 우선 확인 대상이다.
  - `life-collections`: 검토 화면의 키보드 초점 순서가 바뀌었다.
  - `life-browser`: `life.html?view-only=1`에서 `Shell.mount`가 `blog-remote`의 `auth_required`로 던진다. 구 주소의 로그인 전 경로가 실제로 깨졌는지 확인이 필요하다.

### CI 추가 판단

- **바로 추가할 만함(통과·짧음·고유 범위):** `workbench-storage`(3초, 두 탭 저장 경계), `platform-import`(3초, 백업 파일 계정 경계), `life-writing-sync`(9초), `life-search`(28초), `app-feel`(20초). 합계 1분 남짓이다.
- **추가 가치는 있으나 실행 시간 확인 후:** `life-workbench`(94초). 많은 CI 검사가 이 파일의 도구를 쓰지만 본문 17개 흐름은 어디서도 돌지 않는다. `life-writing`(43초)도 같다.
- **먼저 원인을 판정한 뒤:** 실패 7개. 특히 `life-batch` CRLF와 `life-browser` 구 주소는 결함 여부를 먼저 가린다. `life-sync`는 11-01 지시에 맞게 계약을 다시 쓰거나 폐기 여부를 정한다. 고칠 때 단언을 약화하지 않는다.

## 2. 네이버 "자동 수집 켜기"와 운영 계약

### 판정: (a) 실제 코드의 계약 위반 — 단, 서버 수집 파이프라인이 아니라 **구형 RSS 항목의 클라이언트 자동 받기 경로**에서 일어난다. (c) 문구 문제도 함께 있다.

m3 동작은 가짜 서버의 부산물이 아니다. 실제 클라이언트 코드가 같은 동작을 하고, 가짜 서버는 실제 `life_naver_list` RPC를 충실히 흉내 낸다. 기준선·`auto_eligible` 계약은 서버의 목록 확인(inventory) 파이프라인에만 구현되어 있다. 같은 `enabled` 값이 기준선과 무관한 구형 경로까지 켠다.

### 두 경로가 같은 스위치를 공유한다

- 실제 앱은 구형 서비스와 수집 서비스를 합쳐 넘긴다.
  - `assets/life/ui.js:1940-1942`
    ```js
    const legacy = global.HaedoLife.NaverBlogSync.create({ storage, auth, core, isCurrent });
    const captures = global.HaedoLife.NaverCaptureSync.create({ storage, auth, core, isCurrent });
    naverBlogService = { ...legacy, ...captures, dispose() { … } };
    ```
  - 그래서 `assets/life/naver-blog-ui.js:19`의 `captureEnabled`가 항상 참이다. 한 화면에 두 목록과 두 스위치가 나온다.
- 화면에는 스위치가 두 개 있다.
  - 구형 구독 목록: `naver-blog-ui.js:301-302` "자동 수집 켜기/중지" → `service.save(...enabled: !row.enabled)`. 비활성 조건은 `:310` `!ready`뿐이고 기준선 완료를 보지 않는다.
  - 수집 연결 목록: `naver-blog-ui.js:145-155` "이후 새로 발견한 글 자동 수집 켜기". `connection.enabled || connection.baselineComplete`일 때만 보인다.
  - 연결 폼 체크박스: `naver-blog-ui.js:406` 라벨 "새로 확인되는 글을 비공개 자료로 수집" → `:422` 첫 저장에서 `enabled: ready && auto.checked`.
- 세 경로 모두 같은 RPC `life_naver_save`로 `life_naver_subscriptions.enabled`를 바꾼다. `naver-capture-sync.js:135-141`(`configureConnection`), `naver-blog-sync.js:110-115`(`save`)다.

### 구형 경로: 기준선 없이 기존 글을 자동으로 받는다

- `assets/life/naver-blog-sync.js:94-106`
  ```js
  // Opt-in applies only to this registered blog and workspace. …
  if (page.ready) for (const value of page.items) {
    if (!page.subscriptions.some(sub => sub.enabled && sub.blog_id === value.blog_id)) continue;
    const row = model.project([value], bundle)[0];
    if (row.status !== 'new') continue;
    try { const received = await receiveFound(context, workspaceId, value); …
  ```
  `list()`는 화면을 열거나 스위치를 바꾼 직후 `load()`(`naver-blog-ui.js:303`, `:149`)에서 불린다. 구독이 켜져 있으면 목록에 이미 보이던 `new` 항목 전부를 그 자리에서 현재 자료공간에 원문 사본으로 반영한다. 언제 발견된 글인지 묻지 않는다.
- 서버의 구형 테이블과 RPC에는 기준선 개념이 없다.
  - `supabase/migrations/20261021093111_life_naver_subscriptions.sql:30-42` `life_naver_items`: `baseline`·`auto_eligible`·발견 revision 열이 없다.
  - 같은 파일 `:83-108` `haedo_naver_private.list`: 소유자·공간의 항목을 조건 없이 돌려준다.
  - `:127-177` `finish`: RSS 결과를 `on conflict do nothing`으로 넣는다.
  - `:110-125` `claim`: `enabled and next_check_at<=now`인 구독을 고른다.
  - `20261102100000_naver_enable_schedules_first_inventory.sql:28`: 켜면 `next_check_at=clock_timestamp()`로 즉시 확인 대상이 된다.
- 항목은 Edge 함수의 비수집(harvest가 아닌) 경로가 만든다. `supabase/functions/haedo-naver-blog/handler.mjs:111-136`에서 `life_naver_claim` → `collect()`(RSS) → `life_naver_finish` 순서다. 구형 "지금 확인" 버튼(`naver-blog-ui.js:296`, `naver-blog-sync.js:117-131`)과 RSS 예약이 이 경로를 쓴다.

### 서버 수집 파이프라인은 계약을 지킨다

- `20261102100000_…sql:31-33`: 켜면 inventory 행만 만들고 기존 행은 덮지 않는다.
- `20261029112456_naver_observed_inventory_baseline.sql`
  - `:58-59` 항목 삽입. 기준선 전이면 `baseline=true`가 된다. 관측 방식에서는 `auto_eligible=false`로 두고, 켜진 상태일 때만 `observed_discovery_revision=s.revision`을 기록한다.
  - `:188-206` 연속 두 관측의 개수·집합 해시·차집합이 같을 때만 `observed_set` 기준선으로 승격한다. 그때 모든 항목을 `baseline=true, auto_eligible=false`로 둔다(`:205`).
  - `:209-223` 기준선 뒤 **검증된 종료 scan**에서만 현재 revision에 발견된 비기준선 항목을 `auto_eligible=true`로 바꾸고 `capture_jobs`를 만든다. 주석 "never turn discoveries made while stopped or before that boundary into retroactive auto jobs".
  - `:247-266` `inventory_claim`: 켜진 구독과 inventory 행이 있는 연결만 고른다.
  - 예외: `count_exact` 방식은 `:58`, `:61-62`에서 페이지마다 `auto_eligible`·작업을 바로 만든다. 검증 scan 종료를 기다리지 않는다. 운영 연결은 `observed_set`이라(로드맵 10-29) 이번 계약과 직접 충돌하지 않는다. 다만 "검증 scan 뒤에만"이라는 문장은 관측 방식에만 참이다.
- Edge 수집기는 `harvest-worker.mjs:70`에서 `life_naver_inventory_finish_observed`, `:185-189`에서 `inventory_claim`을 쓴다.
- CI의 `tests/run-naver-observed-baseline-postgres.cjs:200-231`이 실제 PG17에서 이 경로를 검증한다. 검증 내용은 기준선 승격 시 큐 0, 검증 scan 뒤 새 항목만 큐, 중지·재개 이전 발견의 비소급이다. 이번에는 로컬 docker 데몬이 없어 다시 돌리지 않았다.

### 가짜 서버의 충실도 (`tests/naver-blog-browser.cjs`)

- 구형 RPC는 충실하다. `:107-114` `life_naver_list`는 구독의 `items`를 조건 없이 돌려준다. 실제 SQL `list`와 같다.
  ```js
  items: sub ? copy(this.items.filter(item => item.owner_id === owner && item.subscription_id === sub.id)) : [],
  ```
  `:116-123` `life_naver_save`는 `enabled`·revision만 바꾼다.
- 기준선·`auto_eligible`은 **전혀 모델링하지 않는다.**
  - `:82-94` `life_naver_inventory_list`는 항상 `{ inventory: null, items: [], hasMore: false, nextCursor: null }`를 돌려준다.
  - 연결의 `inventory`는 검사가 직접 넣는 `accountInventories` 값이다(`:337`).
  - `inventory_claim/finish`·`capture_jobs`·`auto_eligible`가 없다. Edge 호출은 무조건 `{ status: 'checked' }`다(`:124-129`).
- 기존 검사 `:255-259`는 이미 받은 100003 뒤에 스위치를 켠다. 그 뒤 새로 넣은 100004만 자동 반영을 확인하므로 "켜기 전부터 있던 `new` 항목" 경우를 단언하지 않는다. 기준선이 없다는 것이 숨어 있는 이유다.

### 운영 노출과 문구

- 현재 운영은 PC 전용 예약이고 RSS 예약은 0이다. RSS origin은 robots로 막혀 있다(`docs/design-review/naver-operational-readiness.md:37`, 로드맵 11-02). 수집기는 `collector.mjs:243-244`에서 robots가 막으면 `blocked`로 끝나 항목을 넣지 않는다. **새 RSS 항목이 생기지 않는 한 지금 당장 기존 글이 대량으로 들어오지는 않을 것으로 추정한다.** 다만 과거에 RSS로 들어온 `life_naver_items`가 남아 있다면 켜는 순간 그 `new` 항목이 현재 공간에 반영된다. 운영 행 수는 확인하지 못했다(읽기 전용 확인 후보: `select count(*) from public.life_naver_items`).
- 문구: 실제 앱에서 보이는 안내는 `naver-blog-ui.js:407`의 수집 방식 문구다. "기준 목록 확인 뒤 새로 발견한 글의 자동 수집을 켤 수 있습니다." 라벨은 `:406` "새로 확인되는 글"이다. 구형 경로의 실제 동작을 설명하는 문구 "처음 확인한 목록도 포함합니다"는 `captureEnabled`가 거짓일 때만 보인다. 실제 앱에서는 나오지 않는다.
- 수정 방향(구현하지 않음): 구형 자동 받기를 수집 파이프라인의 `auto_eligible`에 묶거나 제거한다. 또는 구형 스위치를 기준선 완료로 막고, "켜기 이후 처음 들어온 항목"만 받도록 발견 시각·revision을 기록한다. 고치면 `naver-blog-browser.cjs`에 "켜기 전 `new` 항목은 받지 않는다" 단언을 추가한다.

## 3. 공개 사본 게시 요청의 sessionStorage 보관

### 판정: 확인됨(합성 서버) — 요청 기록만 사라지고, 게시는 고아·중복이 되지 않으며 다시 열어도 보이고 철회할 수 있다.

### 보관 내용

- 기본 저장소는 탭 단위 `sessionStorage`다. `assets/life/share-remote.js:110` `if (!storage) { try { storage = root.sessionStorage; } catch (_) {} }`. `assets/life/workbench-ui.js:21` `shareRemoteFactory = () => life.ShareRemote?.createOwner({ auth: global.HaedoAuth })`는 storage를 넘기지 않는다.
- 키: `share-remote.js:133` `life_share_pending_v1:` + `[연결 URL, 사용자 ID, 자료공간 ID]`.
- 값: `request()`(`:81-96`)를 거친 `{ workspaceId, expectedRevision, operationId, action, snapshot }`. publish이면 검토·동의한 **공개 사본 전체**가 들어간다. 재현에서 필드 5개, 항목 2개를 확인했다.
- 수명: `put()`(`:199-219`)이 전송 전에 `save()`(`:144-153`)한다. 확정 응답(`:217`)이나 명백한 미기록 오류(`:209`)일 때만 `clear()`(`:154-160`)한다. 전송 오류·응답 유실이면 남겨 "같은 요청 다시 확인"(`workbench-ui.js:739-740`, `:755`)에 쓴다.

### 탭을 닫으면

- 서버 계약: `supabase/migrations/20261005120000_life_public_pages.sql`
  - `:139` `primary key (owner_id, workspace_id)`: 자료공간당 공개 행은 하나다.
  - `:199` 같은 소유자·공간의 put을 자문(advisory) 잠금으로 직렬화한다.
  - `:200-207` 같은 `operation_id`이면 영수증을 돌려준다.
  - `:216` revision이 다르면 `conflict`를 돌려준다.
- 그래서 커밋된 뒤 응답 전에 탭을 닫아도 서버에는 정확히 한 번의 게시만 남는다. 새 탭은 `refreshShare()`(`workbench-ui.js:641-655`)가 `life_public_page_get`으로 현재 상태를 읽는다. "공개 중", 링크, "공개 철회"가 보인다. 공개 페이지 관리 목록(`workbench-ui.js:912-940`)에도 나온다.
- 잃는 것은 "같은 요청 다시 확인" 안내와 동일 요청 재전송 능력뿐이다. 서버 상태를 다시 읽으므로 무결성에는 영향이 없다.

### 재현

[`repro/share-pending.cjs`](evidence/structure-workflow-20261102/repro/share-pending.cjs)는 저장소 루트에서 실행한다. `tests/life-share-browser.cjs`의 `ShareCloud`를 재사용한다. 이 가짜는 행을 저장한 뒤 응답을 붙잡으므로 "커밋됐지만 응답 전" 상태를 만든다.

1. 탭2가 공개 패널을 열어 revision 0을 읽는다.
2. 탭1이 게시를 누른다. 서버는 저장했고 응답은 대기 중이다. 이때 탭1의 sessionStorage에 요청 기록 1개(`publish`, `expectedRevision` 0)가 있고 서버는 revision 1, 공개 상태다.
3. 탭1을 닫은 뒤 응답을 놓아준다.
4. 같은 프로필의 새 탭3에는 요청 기록이 0개다. 공개 패널은 "공개 중"이고 링크의 공개 ID가 커밋된 ID와 같다. "같은 요청 다시 확인" 버튼과 미확인 안내는 없다.
5. 공개 페이지 관리 목록에 해당 공간이 1개 보인다.
6. 오래된 탭2가 게시하면 `expected` 0으로 보내 `conflict`를 받는다. "다른 기기에서 공개본이 바뀌었습니다…" 안내가 나오고 공개 행은 1개, revision 1 그대로다.
7. 탭3에서 철회하면 "공개 철회됨", 서버 `published=false`, revision 2, 행 1개다.

결과: `REPRO PASS`, 종료 코드 0, 2회 실행했다. 운영 SQL은 위 줄 번호를 읽어 대조했을 뿐 실행하지 않았다.

### 남는 위험(추정)

- 응답을 못 받은 채 탭을 닫으면 사용자는 공개된 줄 모를 수 있다. 다시 공개 패널이나 관리 목록을 열기 전에는 알림이 없다. 공개는 명시적 선택이었으므로 개인정보 범위가 늘지는 않는다.
- 같은 공간을 연 다른 탭은 이 탭의 미확인 요청을 모른다. 대신 CAS가 막는다.
- iPhone·iPad Safari에서 백그라운드 탭이 폐기된 뒤 sessionStorage가 복원되는지는 확인하지 않았다.

## 검증하지 못한 것

- 운영 `life_naver_items` 행 수와 과거 RSS 항목 존재 여부(운영 DB 접근 금지).
- 네이버 SQL의 로컬 재실행: docker 데몬이 없다. `tests/helpers/supabase-pg-stub.cjs`(`claude/keen-maxwell-0ld7ns`)는 `tests/sql-ci`의 `pg` 설치가 필요해 이번에는 쓰지 않았다. 서버 수집 계약 판정은 코드 대조와 CI가 실행하는 `run-naver-observed-baseline-postgres.cjs` 단언에 기댄다.
- 실패 7개의 근본 원인(결함인지 오래된 단언인지). 특히 `life-batch` CRLF와 `life-browser` 구 주소 `auth_required`.
- 개발 서버(`scripts/dev-server.py`)로의 재실행: 지시대로 `http.server`만 썼다. 실패는 모두 단언·선택자 수준이라 서버 차이로 보이지 않지만 확인하지 않았다.
- 실제 Apple 기기, 실제 Google 로그인, 운영 RLS.
