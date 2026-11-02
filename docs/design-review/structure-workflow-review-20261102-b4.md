# CI 밖 브라우저 검사 판정 (B4, 2026-11-02)

기준: `origin/main` `a8d4a65`. 작업 브랜치 `b4`. 제품 코드(`assets/`, `*.html`, `sw.js`, `supabase/`)와 `AGENTS.md`·`CLAUDE.md`·`.agents/`·`.github/workflows`는 바꾸지 않았다. 운영 DB·실제 계정은 쓰지 않았다.

## 대상

`.github/workflows/pages.yml`이 실행하지 않는 `tests/*-browser.cjs`는 14개다. `platform-life-browser.cjs`는 `scripts/verify-prepared-site.mjs`가 실행하므로 뺐다. 나머지 13개를 같은 기준에서 한 번씩 실행했다.

- 실패 6개: `life-batch`, `life`, `life-sync`, `life-collections`, `life-rediscovery`, `record-arrange`.
- 통과 7개: `workbench-storage`, `platform-import`, `life-writing-sync`, `life-search`, `app-feel`, `life-workbench`, `life-writing`.
- 일곱 번째 실패 검사는 없다. 지시서의 "통과 5개"에 `life-workbench`(17/17)와 `life-writing`(12/12)이 더 있다.

판정 기호
- **T**: 검사가 낡았다. 문서화된 계약이 바뀌었는데 검사를 갱신하지 않았다.
- **P**: 제품 회귀다.

이력은 얕은 저장소(경계 `bde6d4e`, 2026-10-18)에서 `git log -S`로 찾았다. 그다음 해당 커밋과 부모 커밋의 `git archive` 트리를 각각 띄워 같은 검사를 돌려 확정했다.

실행 환경
- Linux Chromium `/opt/pw-browsers/chromium`, Playwright `/opt/node-tools/node_modules/playwright`.
- `python3 -m http.server`를 127.0.0.1의 5047 포트에 띄웠다.
- 익명 FakeCloud HTTP 모의만 썼다.
- 실제 Apple 기기와 실제 Supabase RLS는 확인하지 않았다.

## 판정 요약

| 검사 | 판정 | 원인 커밋 | 조치 | 갱신 후 |
|---|---|---|---|---|
| `life-batch` | T | `dd1169c` (10-22) Markdown 서식 읽기 | 실제 "원문 텍스트 보기"로 전환한 뒤 CRLF 원문 단언 | 3/3 통과 |
| `life` | T | 얕은 경계 `bde6d4e` 이전 (UI.mount가 BlogSync 생성) | 검증 계정으로 실제 Shell이 마운트하도록 변경 | 3/3 통과 |
| `life-sync` | T | `bed3142` (10-20) 계정 자료 목록 | 소유자 범위 부팅 GET만 허용하고 나머지 요청 0을 유지 | 3/3 통과 |
| `life-collections` | **P** | `c65aa4b` (10-21) 네이버 연결 진입 버튼 | 수정하지 않음. 재현 절차는 아래 | — |
| `life-rediscovery` | T + T | `bed3142` (10-20), `54ff4b3` (10-24) | 부팅 GET 범위 단언, 자료실 탐색 링크로 선택자 한정 | 3/3 통과 |
| `record-arrange` | T | `a6cefb3` (10-23) 폴더로 이동 | 선택 목록 자신의 summary로 선택자 한정. 저장 중 클릭 위치 이동(H1)도 고침 | 5/5 통과 |

검사 실행이 덮어쓴 추적 스크린샷 `docs/design-review/evidence/rediscovery-{390,820,1440}.png`는 되돌렸다. 이후 `life-rediscovery`의 게시용 사본 기본 위치를 `.local/life-rediscovery/`로 옮겼다. 추적 증거는 `REDISCOVERY_EVIDENCE_OUTPUT=docs/design-review/evidence`로 실행할 때만 다시 만든다.

## 검사별 근거

### life-batch (T) — CRLF는 저장 단계에서 바뀌지 않는다

| 항목 | 내용 |
|---|---|
| 실패 | `tests/life-batch-browser.cjs:96` `#lifeSourceText.textContent`가 `'첫 줄\n🌱 보존할 구절\n마지막 줄\n'`이다. 기대값은 `'…\r\n…\r\n…'`이다. |
| 실제 가져오기 경로 | 검사는 `#lifeBatchFiles.setInputFiles`에 Buffer 바이트를 넘긴다. 실제 여러 파일 가져오기 경로이고 textarea를 거치지 않는다. |
| 저장 바이트 | 같은 검사의 `:86` `b.sourceVersions[0].contentText === raw`(CRLF 포함)가 `:96` 전에 통과한다. 백업 JSON `:107`도 CRLF를 그대로 갖는다. `assets/life/core.js`·`storage.js`에는 CRLF 정규화가 없다. `\r`을 다루는 곳은 `storage.js:1156`의 제목 추출용 `split(/\r?\n/)`뿐이다. |
| 차이의 원인 | `first.md`는 `text/markdown`이다. `assets/life/ui.js:3664-3668`이 서식 DOM(`data-reading-mode="formatted"`)을 기본 표시로 고른다. `textContent`는 렌더된 블록 텍스트라서 LF와 끝 줄바꿈이 붙는다. 원문은 `ui.js:3663` 단일 Text 노드의 raw 보기로 따로 남는다. |
| textarea 정규화 | 이 경로는 해당하지 않는다. 다만 HTML 표준에서 textarea의 API value는 raw value에 "normalize newlines"를 적용한 값이다. 그래서 붙여넣기 칸 `#lifeImportText`(`ui.js:4007`)에서 사용자가 고친 본문은 LF가 되는 것이 정상이다. |
| 계약 | `docs/design-review/material-markdown-edit-delete.md:25` "Markdown 자료의 기본은 **서식 보기**다". `:26` "**원문 텍스트 보기 / 서식 보기**". `PRODUCT.md:23` "Markdown은 서식으로 읽고 정확 원문 보기로 전환한다". |
| 이력 | `git log -S "SourceMarkdown.render" -- assets/life/ui.js` → `dd1169c`. 부모 `4a1f381` 트리에서는 통과하고 `dd1169c`에서는 같은 단언으로 실패한다. 같은 문서 `:160`에 따르면 CI 검사의 "기존 Markdown raw DOM 단언 2곳"은 그때 고쳤지만, CI 밖 `life-batch`는 남았다. |
| 조치 | 서식 모드를 먼저 단언한다. 그다음 `#lifeSourceInfoToggle` → "원문 텍스트 보기"를 누르고, `data-reading-mode="raw"`에서 `textContent === raw`(CRLF)를 단언한다. `original-attachments-browser.cjs:88-92`와 같은 방식이다. |

### life (T) — 실제 사용자에게 오류 화면은 없다

| 항목 | 내용 |
|---|---|
| 실패 | "changed input discards delayed prepare result". 검사가 `life.html?view-only=1`(읽기 전용, 미로그인)에서 `HaedoLife.UI.mount`를 직접 부른다. `ui.js:144` `BlogSync.create` → `blog-sync.js:20-21` 기본 인자 `BlogRemote.create` → `blog-remote.js:53` `auth.ready=false`라서 `auth_required`("로그인 계정을 다시 확인해 주세요.")를 던진다. |
| 사용자 영향 | 없음. Shell은 읽기 전용 주소에서 마운트하지 않는다(`shell.js:206`). 일반 주소에서도 `auth.verify()/requireUser()`로 계정을 확인한 뒤에만 `UI.mount`를 부른다(`shell.js:171`, `:209-213`). |
| 재현 (공용 FakeCloud, 계정 로그인 상태) | `life.html`과 `index.html` 둘 다 같은 결과다. `authReady:true`, `#lifeApp` 표시, `#lifeStartup` 숨김, 오류 문구 0, `auth_required` 문구 없음, console/page 오류 0. 스크립트: 아래 "재현 스크립트" 항목. |
| 합성 환경 재현 | 미로그인 읽기 전용 페이지에서 직접 마운트하면 `{"auth":{"ready":false,...},"mount":"threw: 로그인 계정을 다시 확인해 주세요. code=auth_required"}`가 나온다. `bde6d4e`(얕은 경계), `b317eb5`(10-26), `bdc3d9c`(11-01), 현재 main에서 모두 같다. |
| 계약 | AGENTS.md "지켜야 할 제품 규칙" — "개인 화면은 공용 인증 설정과 서버 계정 확인이 필요하다". 같은 절 — "공개 홈은 서버 계정 검증 전 개인 저장소를 열지 않는다". |
| 이력 | `git log -S "BlogSync?.create(" -- assets/life/ui.js`의 가장 오래된 결과가 얕은 경계 `bde6d4e`이고, `blog-sync.js` 기본 `remote` 생성은 `fa65c57`(10-18)에 들어왔다. 11-01 `6cebb9a`는 같은 줄에 `autoSync: true`만 더했고, 예외는 그 전부터 났다. 정확한 시작 커밋은 얕은 이력 밖이다. |
| 조치 | 검사가 익명 검증 계정(`platformContext`)으로 `life.html`을 연다. 실제 Shell이 `HaedoAuth`와 계정 범위 저장소로 마운트한다. 지연 `prepareImport`는 `core.js`가 실행되기 전에 `HaedoLife.Core` setter로 감싼다(`core.js:4-5`, Shell은 `life.Core`를 그대로 넘긴다). 지연이 실제로 걸렸는지는 `__prepareWaiting`로 확인하고, 입력 경합 단언 7개는 그대로 둔다. 저장 확인만 `HaedoLife.Shell.storage`로 바꿨다. |

### life-sync (T) — 2건은 계정 자료 목록 GET이다

| 항목 | 내용 |
|---|---|
| 실패 | `:260` `server.requests.length 2 !== 0`. 나머지 13개는 이 단계에서 업로드가 일어나지 않아 연쇄로 실패했다. |
| 2건의 정체 | `{kind:'account-materials-list', owner:accounts.a, device:'a'}`, `{… device:'b'}`. 두 기기가 인증 부팅에서 한 번씩 보낸 `GET /rest/v1/life_account_materials?owner_id=eq.<본인>`이다(`assets/life/account-materials.js:102`). 탐침으로 HTTP를 모두 기록해 확인했다. |
| `isBackgroundSync` 분류 | 분류하지 않는다. `tests/helpers/account-sync-rpcs.cjs`는 RPC 이름(`/rest/v1/rpc/…`)과 비공개 원본 업로드만 본다. 이 요청은 REST 테이블 GET이다. 또 이 검사는 HTTP 전체가 아니라 FakeCloud 장부(`server.requests`)를 센다. 장부에 기록되는 계정 범위 요청은 이 목록 GET뿐이다. |
| 계약 | `docs/design-review/account-materials.md:17-19` — "`life_account_materials`는 소유자별 비공개 등록 목록 … 인증된 내 자료 부팅 시 현재 계정의 목록을 GET". 11-01 지시가 아니라 10-20 계약이다. |
| 이력 | `git log -S "account-materials-list" -- tests/life-sync-browser.cjs` → `bed3142`. 이 커밋은 FakeCloud 장부에 목록 기록을 추가하면서 0건 단언은 그대로 두었다. 부모 `45b47ae` 트리는 14/14, `bed3142` 트리는 0/14다. |
| 범위 참고 | FakeCloud 기본값은 capability 0(구 백엔드)이다. 그래서 `account-library.js:261-270`의 legacy 경로(`mode='unavailable'`, 연결된 공간만 자동 동기화)를 검사한다. 11-01 계정 모드의 자동 연동은 CI의 `account-library-browser.cjs` 등이 맡는다. |
| 조치 | `account-materials-list` 외 장부 항목이 0인지 단언한다(작업공간 list/read/write는 계속 실패). 부팅 GET이 기기 a, b에서 각각 나왔는지, 모두 소유자 a인지도 단언한다. 이후 13개 단언은 바꾸지 않았다. |

### life-collections (P) — 검토 단계에 네이버 연결 버튼이 남는다

| 항목 | 내용 |
|---|---|
| 실패 | `:126` 검토 제목 `원문·출처 검토` 다음 Tab의 `activeElement.id`가 `''`다. 기대값은 `lifeImportEdit`다. |
| 실제 초점 | "네이버 블로그 아이디로 연결" 버튼(`#lifeMain` 안, id 없음)이다. 다음 Tab이 `#lifeImportEdit`다. |
| `#lifeMain` 자식 순서 | `H2 | P#lifeImportPhase | BUTTON(네이버 연결) | FORM#lifeImportForm[hidden] | BUTTON#lifeImportEdit | SECTION.life-review | …` |
| 의심 위치 | 검토 단계(`state.prepared`)에서 `ui.js:3982`는 입력 폼을 숨긴다(`form.hidden = !!state.prepared`). 그런데 `ui.js:4035`의 `main.append(button('네이버 블로그 아이디로 연결', …navigate('naver-blog')))`는 폼 밖에 조건 없이 붙는다. 그래서 가져오기 방식 진입 하나가 검토 화면에 남는다. 이 버튼은 다른 화면으로 이동시키며, 검토 제목과 "입력 수정" 사이의 첫 키보드 정지점이 된다. |
| 계약 근거 | 검토 단계는 입력 폼을 숨긴다(`ui.js:3982`). 키보드 순서 검사(`5d2d018`, 10-05)는 제목 다음을 "입력 수정"으로 고정했다. `docs/design-review/naver-blog-connection.md`에는 검토 화면에 이 진입을 두라는 결정이 없다. |
| 이력 | `git log -S "네이버 블로그 아이디로 연결', guarded" -- assets/life/ui.js` → `c65aa4b`(10-21). 부모 `b835454` 트리는 6/6, `c65aa4b` 트리는 5/6(같은 단언)이다. |
| 영향 | 데이터 손실은 없다. 검토 초안은 stage에 남는다. 키보드와 화면에서 관련 없는 이동 버튼이 검토 화면 맨 앞에 보이는 마이너 회귀다. |
| 조치 | 지시에 따라 제품을 고치지 않았다. 검사도 바꾸지 않았다. |

재현 절차
1. 익명 FakeCloud 계정으로 `life.html?view=topics`를 연다.
2. "가져오기"를 누른다.
3. 제목·본문을 입력하고 "원문·출처 확인"을 누른다.
4. 초점이 `원문·출처 검토` 제목으로 간 뒤 Tab을 누른다. 초점이 "네이버 블로그 아이디로 연결"에 간다.
5. 한 번 더 Tab을 누르면 "입력 수정"이다.

최소 재현 스크립트: `collections-tab.cjs`(아래 "재현 스크립트").

### life-rediscovery (T, 두 건)

| 항목 | 내용 |
|---|---|
| 실패 1 | `:110` `server.requests.length 2 !== 0`. 첫 로드와 `page.reload()`에서 각 1회 나온 `account-materials-list`다. 같은 계약(`account-materials.md:17-19`)이고 원인 커밋도 같다. 부모 `45b47ae` 트리는 통과, `bed3142` 트리는 같은 `2 !== 0`이다. |
| 조치 1 | `account-materials-list` 외 장부 항목이 0인지, 모든 항목의 소유자가 `accounts.a`인지 단언한다. 다시 찾기 자체는 계속 요청 0이다. |
| 실패 2 | `:140` `[data-haedo-section="records"]` strict mode 위반. `<body data-haedo-section="records">`와 자료실 링크 두 요소에 걸린다. `assets/haedo-navigation.js:105`가 현재 영역을 body에도 표시한다. |
| 계약 2 | `docs/design-review/feature-flow-integration.md:26` — 자료실 메뉴에 "다시 찾기·회고·책 …". `docs/agents/feature-contracts.md:23` — records ID. 다시 찾기가 자료실 아래로 옮겨져 body 값이 `records`가 됐다. |
| 이력 2 | 부모 `ef075e4` 트리는 통과, `54ff4b3`(10-24 "Integrate existing features into contextual workflows") 트리는 같은 strict mode 위반이다. |
| 조치 2 | `[data-haedo-navigation] [data-haedo-section="records"]`(실제 자료실 링크)로 좁혔다. `life-sync-browser.cjs` `openSection`과 같은 선택자이고, 저장 실패 시 이동 차단 단언은 그대로다. |

### record-arrange (T)

| 항목 | 내용 |
|---|---|
| 실패 | `:132` `#lifeSelectionBar summary` strict mode 위반. 선택 목록 summary와 `summary.sf-assignment-toggle`("선택한 자료를 폴더로 이동") 두 요소에 걸린다. |
| 원인 | `ui.js:3014-3021`이 폴더 기능이 있을 때 선택 막대의 controls에 `folders.assignmentControl`(`source-folders-ui.js:245` summary)을 붙인다. |
| 계약 | `docs/design-review/material-folders.md:3` "자료 한 개 또는 선택 자료 이동". `:14` "선택한 정확 버전들, 목적 폴더". |
| 이력 | `git log -S "선택한 자료를 폴더로 이동" -- assets/life/ui.js` → `a6cefb3`(10-23). 부모 `8c62d8e` 트리는 통과, `a6cefb3` 트리는 같은 위반이다. |
| 조치 | `#lifeSelectionBar .life-selection-details > summary`(선택 목록 자신의 summary)로 좁혔다. 100/99/0 개수 단언은 유지했다. |

## 반복 실행 결과

갱신한 5개 검사를 같은 서버에서 각각 3번 연속 실행했다. 모두 종료 코드 0이다.

| 검사 | 결과 | 한 번 소요 |
|---|---|---|
| `life-batch` | 8/8 ×3 | 61–73초 |
| `life` | 23/23 ×3 | 40–62초 |
| `life-sync` | 14/14 ×3 | 약 60초 |
| `life-rediscovery` | 10/10 ×3 | 107–134초 |
| `record-arrange` | 선택자만 고친 상태: 5회 중 4회 14/14, 1회 13/14(아래 절). 저장 대기까지 고친 뒤: 14/14 ×5 | 93–191초 |

### 해결: record-arrange "selected page entry …" 1회 실패 — H1(검사 타이밍)

이 실패는 이번에 고친 선택자(`:132` 부근)와 다른 검사다.

| 항목 | 내용 |
|---|---|
| 실패 | 전체 실행 x2에서 1회 났다. `tests/record-arrange-browser.cjs:178` `uncheck()`이 "Clicking the checkbox did not change its state"로 실패했다. 대상은 두 번째 조각의 "전시에서 가장 오래 머문 빛 표시" 체크박스다. 호출 로그에는 클릭 직전 "element is not stable"이 두 번 나온다. 실패 화면의 상태는 "이 브라우저에 저장 중…"이었다. |
| 가설 | H1(검사 타이밍): 저장 중 레이아웃 이동으로 클릭이 빗나간다. H2(제품 입력 유실): 저장 완료 후 다시 그리기가 방금 해제한 표시를 되돌린다(`workbench-ui.js:1582`, `:1590`). |
| 고정 실험 | [`record-arrange-revert.cjs`](evidence/structure-workflow-20261102/repro/record-arrange-revert.cjs)를 쓴다. 검사가 쓰던 `storage.js` route hook 방식으로 `saveWorkbench`를 감싸, 코멘트 자동 저장을 명시 해제 전까지 붙잡는다. 붙잡힌 동안 체크박스를 한 번 클릭하고, 해제 전에 checked를 읽는다. 해제한 뒤 UI 저장 완료(`#wbStatus` saved, "저장 중" 없음)를 기다려 최종 checked와 저장된 `part.enabled`를 읽는다. |
| 실험 결과 (10회, 모두 같은 값) | 클릭 전 checked=true. 붙잡힌 동안 상태 "이 브라우저에 저장 중…", **클릭 직후(해제 전) checked=false**, 저장소는 아직 true. **해제 후 최종 checked=false, 저장 `enabled=false`**, 코멘트도 저장됐다. 체크박스 요소는 교체되지 않았고 page error는 0. 저장 시작 3회(제목 반영, 코멘트, 표시 해제). 되돌림 0/10, 클릭 미전달 0/10. |
| 레이아웃 | 체크박스의 문서 기준 y가 코멘트 입력 전 1626px → 저장 중 1735px → 저장 완료 후 1522px로 움직인다(위치를 잰 7회 모두 동일). 저장 상태 전환마다 100–200px씩 이동한다. |
| 판정 | **H1.** 저장 중에도 클릭이 전달되면 해제는 유지되고 저장된다(H2 반박). 원래 실패는 Playwright가 위치를 잡은 뒤 저장 상태가 바뀌어 체크박스가 100–200px 움직인 사이에 클릭이 다른 곳에 떨어진 경우와 맞는다. 입력 유실은 아니다. 레이아웃 이동은 UX 마이너 후보다([본문 7절](structure-workflow-review-20261102.md#7-결함-후보-처리-현황-2026-11-02-총괄-결정-기준)). |
| 조치 | 검사는 코멘트 입력 뒤 UI 저장 완료(`#wbStatus[data-state=saved]`, "저장 중" 없음)와 저장된 코멘트를 기다린 다음 해제한다. "지금 저장" 뒤 대기 조건에는 저장된 `parts[1].enabled === false`를 추가했다(강화). 제한시간은 늘리지 않았고 단언도 줄이지 않았다. |
| 결과 | 고친 뒤 전체 검사 5회 연속 14/14. 실패 로그·화면 사본은 작업 환경에 남겼다. |

## CI 추가용 명령 (갱신 후 통과하는 검사)

공통 조건 (`.github/workflows/pages.yml`의 browser 작업과 같다)
- 정적 서버만 있으면 된다. 기존 단계 "Start the OAuth-safe local server"가 `python3 scripts/dev-server.py --port 4184`를 띄운다.
- 작업 단위 `BASE_URL=http://127.0.0.1:4184`가 필요하다.
- "Select the pinned browser" 단계가 설정하는 `PW_MODULE_PATH`와 `CHROMIUM_PATH`가 필요하다.
- Postgres, `tests/sql-ci` 의존성, 비밀값, 외부 네트워크는 필요 없다. 모두 FakeCloud HTTP 가로채기다.
- `life-sync-browser.cjs`를 불러오는 검사는 기본값이 4173이므로 `BASE_URL`을 반드시 설정해야 한다. 작업 env에 이미 있다.

| 검사 | 명령 | 결과 위치 | 비고 |
|---|---|---|---|
| workbench-storage | `node tests/workbench-storage-browser.cjs` | `.local/workbench/storage-report.json` | 5/5 |
| platform-import | `node tests/platform-import-browser.cjs` | 없음(stdout) | 3/3 |
| life-writing-sync | `node tests/life-writing-sync-browser.cjs` | `.local/writing-sync/` | 통과 |
| life-search | `node tests/life-search-browser.cjs` | 없음(stdout) | 7/7 |
| app-feel | `node tests/app-feel-browser.cjs` | `.local/app-feel/` | 통과, `scripts/check-life-collections-design.cjs`를 불러옴 |
| life-workbench | `node tests/life-workbench-browser.cjs` | `.local/workbench/` | 17/17 기능, 시각 27 |
| life-writing | `node tests/life-writing-browser.cjs` | `.local/writing/` | 12/12, 시각 9 |
| life-batch (갱신) | `node tests/life-batch-browser.cjs` | 없음(stdout) | 8/8 |
| life (갱신) | `node tests/life-browser.cjs` | 없음(stdout) | 23/23 |
| life-sync (갱신) | `node tests/life-sync-browser.cjs` | 없음(stdout) | 14/14 |
| life-rediscovery (갱신) | `node tests/life-rediscovery-browser.cjs` | `.local/rediscovery/`, 게시용 사본 `.local/life-rediscovery/`(`REDISCOVERY_EVIDENCE_OUTPUT`로 변경) | 10/10. 추적 파일을 건드리지 않음 |
| record-arrange (갱신) | `node tests/record-arrange-browser.cjs` | `.local/record-arrange/` | 14/14 ×5 |

`life-collections`는 P 판정이므로 제품 수정 뒤에 추가한다.

로컬 재현 명령

```sh
python3 -m http.server 5047 --bind 127.0.0.1 &
BASE_URL=http://127.0.0.1:5047 PW_MODULE_PATH=/opt/node-tools/node_modules/playwright \
  CHROMIUM_PATH=/opt/pw-browsers/chromium node tests/<suite>-browser.cjs
```

Chromium은 5060·5061 포트를 unsafe port로 거부한다. 다른 포트를 쓴다.

## 재현 스크립트

작업 환경 scratchpad에 두었고 저장소에는 넣지 않았다. 모두 `BASE_URL`·`PW_MODULE_PATH`·`CHROMIUM_PATH`를 받는다.

- `viewonly-mount.cjs`: 미로그인 `life.html?view-only=1`에서 `UI.mount`를 부르면 `auth_required`가 난다.
- `signed-in-mount.cjs`: FakeCloud 로그인 상태의 `life.html`·`index.html`에 오류가 없다.
- `sync-requests.cjs`: 로그인 부팅의 장부와 클라우드 HTTP 목록, `isBackgroundSync` 분류를 출력한다.
- `collections-tab.cjs`: 검토 제목 다음 Tab 순서와 `#lifeMain` 자식 순서를 출력한다(P 재현).

## 확인하지 못한 것

- 실제 Apple 기기, 실제 Google OAuth, 운영 Supabase RLS.
- `life` 검사의 예외가 처음 생긴 커밋. 저장소가 얕아(`bde6d4e` 경계) 그 이전 이력은 보지 않았다. 공용 저장소의 shallow 상태를 바꾸지 않으려고 `--unshallow`도 하지 않았다.
- `life-collections` P의 의도 여부. 네이버 진입을 검토 화면에 남길지는 제품 결정이다. 현재 문서에는 근거가 없어 회귀로 판정했다.
- CI 러너(`scripts/dev-server.py`, Ubuntu, Noto CJK)에서의 실행. 로컬에서는 `python3 -m http.server`로만 확인했다.
