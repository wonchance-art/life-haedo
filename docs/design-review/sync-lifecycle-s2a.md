# S2a 동기화 엔진 생명주기 공통화 (2026-11-02)

[구조·흐름 점검](structure-workflow-review-20261102.md) 4-5절 S2의 첫 묶음이다. 기준 main은 `2a224dc`이며, #169 병합 뒤 `c03011c`, #168 병합 뒤 `eafb7cf`로 재기준했고, #173·#177 병합 뒤 main `d079024`를 merge 커밋으로 받았다.

- 블로그 동기화(`blog-sync.js`)는 충돌 규칙 작업과 겹친다. 그래서 그 작업이 병합된 뒤 S2b로 한다(총괄 결정).

## 이번 변경

- **새 모듈:** `assets/life/sync-lifecycle.js`(`HaedoLife.SyncLifecycle.attach`)를 만들었다.
  - 엔진이 넘긴 `[대상, 이벤트, 처리기]` 목록을 **주어진 순서대로** 창(`window`)이나 문서(`document`)에 등록한다.
  - 그다음 주기 타이머를 하나 시작하고(Node에서는 `unref`), `detach()`로 등록한 것만 지우고 타이머를 멈춘다. `detach()`를 두 번 불러도 한 번만 지운다.
  - 네트워크·저장소·DOM 조작은 없다.
- **엔진 6개:** 직접 `addEventListener`·`setInterval`을 부르지 않고 이 모듈로 등록한다.
  - 대상: `sync.js`, `composition-sync.js`, `writing-sync.js`, `material-continuity-sync.js`, `account-docs-sync.js`, `account-library.js`
  - 직접 등록은 0이다(`grep addEventListener|setInterval` 결과 0).
- **바꾸지 않은 것:** 각 엔진의 처리기(무엇을 하는지)는 그대로다.
  - 뒤로가기 캐시(bfcache)의 `pagehide`/`pageshow` `persisted` 처리, 화면 숨김·보임 구분, `haedo:page-suspend`/`-ready`, 간격·지연·백오프, 상태 기계가 모두 그대로다.
  - 처리기를 모듈로 옮기지 않은 이유: 여섯 엔진의 처리가 조금씩 다르다. 예를 들어 `sync.js`는 `visible`만, `account-library.js`는 `hidden`이 아니면 실행한다. 공통화하면 동작이 바뀔 위험이 커서 이번에는 등록만 모았다.
- **로드 순서:** `index.html`·`life.html`에서 `sync.js` 바로 앞에서 불러온다. `sw.js` 오프라인 목록과 `scripts/prepare-site.mjs` 배포 허용 목록에 넣었다.
- **캐시 이름:** `haedo-v178` → `haedo-v179`. 작업 중 main이 #169로 v175, #168로 v176, #173으로 v178이 되었다. 같은 이름에 다른 파일이 섞이지 않도록 매번 main보다 큰 번호로 올렸다.
- **S0 기준선:** 브라우저 기준선에 `SyncLifecycle` 1개를 더했다(132개).

## 이벤트 → 처리기 대응표

`tests/sync-lifecycle.test.cjs`가 변경 전 main 코드에서 뽑아 고정했다. 변경 전 코드에서도, 변경 후 코드에서도 같은 표로 통과한다.

| 엔진 | 창 이벤트 | 문서 이벤트 | 주기 |
|---|---|---|---|
| `sync.js` (`setAutomatic(true)` 때) | online→`automatic` | visibilitychange→`visible` | 60초 `visible` |
| `composition-sync.js` | online·focus→`automatic`, pagehide→`pagehide`, pageshow→`pageshow` | visibilitychange→`automatic` | 30초 `automatic`(`polling`일 때) |
| `writing-sync.js` | online·focus→`automatic`, pagehide·pageshow | visibilitychange→`automatic`, page-suspend→`suspend`, page-ready→`resume` | `interval`(기본 30초) `automatic` |
| `material-continuity-sync.js` 자동 관리자 | online·focus→`pass`, pagehide·pageshow | visibilitychange→`pass`, page-suspend→`suspend`, page-ready→`resume` | `every`(기본 60초) `pass` |
| `account-docs-sync.js` | online·focus→`wake`, pagehide·pageshow | visibilitychange→`visibility`, page-suspend→`suspend`, page-ready→`ready` | `intervalMs`(기본 30초) 숨김이 아닐 때 `run` |
| `account-library.js` | online·focus→`lifecycle` | visibilitychange→`visible` | 30초 `lifecycle`(`polling`일 때) |
| `blog-sync.js` (S2b, `autoSync`일 때) | online→`online`, focus→`focus`, pagehide→`pagehide`, pageshow→`pageshow` | visibilitychange→`visibility` | 없음(주기마다 다음 주기를 스스로 예약) |

- 표의 처리기 이름은 엔진 안 함수 이름이다. 같은 함수 객체가 같은 대상·이벤트에 같은 순서로 붙는지를 비교한다.
- 해제(`dispose`, `sync.js`의 `setAutomatic(false)`) 뒤에는 남는 등록과 타이머가 0이다.
- `pagehide`의 동기 시작 시점: 이 여섯 엔진의 `pagehide`는 모두 `persisted`일 때 멈춤 표시와 타이머 정리만 한다. 요청을 시작하는 `pagehide`(persisted가 아닐 때 올리기 시작)는 `blog-sync.js`에만 있다. S2b에서 같은 모듈로 등록을 옮겼고, 처리기는 그대로다(아래 S2b 절).

## 모듈이 없을 때 (섞인 판)

- 갱신 중에 이전 HTML(이 모듈 없음)과 새 엔진이 섞이면 엔진은 자동 깨우기(online·focus·화면 전환·주기)만 하지 않는다.
  - 시작할 때의 동기화와 명시 동기화는 그대로 돈다. 오류나 화면 중단은 없다. 새로고침하면 정상이다.
- S1처럼 오류를 내지 않은 이유: 엔진을 만드는 곳이 `shell.js`·`ui.js`·`workbench-ui.js` 등 여러 곳이다. 오류를 내면 그 곳마다 보호 코드가 필요하고(#173의 후속 수정), `ui.js`는 #168과 겹친다.
- 영구 누락(HTML에서 줄을 빠뜨림)은 S0 브라우저 기준선이 잡는다. `index.html`·`life.html` 모두 `SyncLifecycle` 등록을 확인한다. `npm run check`는 오프라인·배포 목록만 보므로 이 누락을 잡지 못한다.
- 캐시 이름을 올렸으므로 서비스워커 경로에서는 섞이지 않는다.

## 검사

- `tests/sync-lifecycle.test.cjs`(신규, 13개)
  - 엔진 6개의 대응표: 변경 전 main 코드에서 6/6, 변경 후 6/6
  - 모듈 단위: 등록 순서, 타이머가 등록 뒤에 시작됨, `detach` 1회, 문서 없는 대상, 잘못된 대상·처리기 거절
  - 모듈이 없는 판(`vm`, `require` 없음): 여섯 엔진 모두 같은 표로 등록 0, 시작 동기화가 첫 의존성(설정·저장소·준비 목록·계정 문서·계정 확인)에 닿음, 오류 없음(검수 m2). 같은 판에 모듈을 넣으면 여섯 사례가 모두 실패하는 것을 확인했다.
- `tests/life-sync.test.cjs`·`tests/composition-sync.test.cjs`는 엔진을 `vm`에서 실행한다. 페이지처럼 이 모듈을 먼저 불러오게 바꿨다.
  - 바꾸기 전에는 `life-sync` 3개가 실패했다. 온라인·화면 보임 처리기를 실제로 부르는 검사이므로, 모듈 없이 실행하면 등록이 없어 실패한다.
- `tests/sync-lifecycle-browser.cjs`(신규, 4개, FakeCloud 합성 계정): 실제 개인 화면에서 이벤트마다 생기는 서버 호출 묶음을 고정했다.
  - online·focus → 준비(`life_material_list`)·계정 문서(`life_account_document_changes`)·블로그(대조군)
  - 화면 숨김 → 계정 문서만, 다시 보임 → 셋 다
  - persisted pagehide 뒤 online → 호출 0. persisted pageshow → 셸의 계정 재확인 뒤 `haedo:page-ready`로 준비·계정 문서. 그 뒤 online → 셋 다
  - `haedo:page-suspend` 뒤 focus → 블로그만(블로그에는 일시 중지 처리기가 없다). `haedo:page-ready` → 준비·계정 문서
  - 변경 전 main(`2a224dc`)에서 3회, 변경 후 3회 모두 4/4. `index.html`에서 이 모듈 줄을 빼면 첫 검사에서 실패한다.
  - 이 화면에서 서버 호출이 없는 엔진(원문 동기화·구성·글쓰기 초안·계정 자료실)은 단위 검사의 대응표로만 확인한다.
- 기존 브라우저 검사
  - 최종 판(v179)에서 다시 실행: 구조 기준선 6, sync-lifecycle 4, 섞인 판(sync-common-mixed) 5, PWA v163→v179 9, v162→v179 9
  - 이전 재기준 판(`eafb7cf` 위)에서 실행: 블로그 자동 저장 4, 구성 동기화 8, 글쓰기 동기화 10. 처음 판(`2a224dc` 위)에서 글쓰기 수신 2·1, 계정 자료 3, 글 찾기 3
- 로컬 PostgreSQL(UTF-8) 검사: 준비 이어쓰기 5, 계정 블로그 연속 5, 계정 전체 홈 4, 자료로 글쓰기 9
  - 처음에는 준비 이어쓰기가 `life_material_invalid_remote_data`로 실패했다. 원인은 검사용 클러스터를 `SQL_ASCII`로 만든 것이었다. 변경 전 main도 같은 환경에서 같은 방식으로 실패했고, UTF-8로 다시 만든 뒤에는 둘 다 통과했다. 코드 결함이 아니다.

## 한계

- 등록 순서가 같다는 것은 같은 엔진 안에서의 순서다. 엔진끼리의 순서는 엔진을 만드는 순서(그대로)로 정해진다.
- `writing-sync.js`·`material-continuity-sync.js`는 이전에 타이머를 이벤트 등록보다 먼저 만들었다. 지금은 등록 뒤에 만든다. 타이머 콜백은 등록이 끝난 뒤 다음 작업 단위에서만 돌기 때문에 관찰되는 차이는 없다.
- `dispose`에서 이벤트 해제 위치가 앞당겨졌다(원격 해제·구독 해제보다 먼저). 그 사이에 동기적으로 발생하는 DOM 이벤트는 없다.
- 실제 Mac·iPad·iPhone의 bfcache·앱 전환 확인은 하지 않았다.

## S2b 블로그 동기화 (2026-11-04)

총괄 지시서 범위 2다. 최적화 세션이 맡았고, 기준은 PR185 head `ea27890`이다.

- **바꾼 것:** `blog-sync.js`의 `start()`가 직접 부르던 `addEventListener` 다섯 개를 `SyncLifecycle.attach`로 옮겼다.
  - 처리기는 이름을 붙인 함수(`online`·`focus`·`pagehide`·`pageshow`·`visibility`)로 꺼냈고, 하는 일은 그대로다.
  - `stop()`은 `detach()`로 지운다.
  - 등록 대상은 이전처럼 `events`(기본 `window`)와 `events.document`다.
- **주기 타이머는 옮기지 않았다.** BlogSync는 고정 간격 대신 주기가 끝날 때 다음 주기를 예약한다(간격·백오프·초안 지연·새 기기 재시도). `poll`을 쓰면 이 계산이 바뀌므로 `poll: null`로 둔다.
- **처리기 본문은 옮기기 전과 같다.** 아래 다섯 동작을 검사로 고정했다.
  - online: 백오프를 무시하고 전체 주기
  - focus: 다음 주기를 즉시 예약
  - visibilitychange: 숨김이면 올리기만(초안 포함), 보이면 즉시 예약
  - pagehide: persisted면 멈춤 표시, 아니면 올리기만
  - pageshow: persisted 복귀면 정규 간격 뒤
- **검사(`tests/sync-lifecycle.test.cjs`, BlogSync 사례 3건)**
  - 대응표: 대상·이벤트·순서·처리기 이름, 처리기마다 계정 확인과 목록 요청 여부, 다음 예약 지연, dispose 뒤 등록 0.
  - 넘기는 옵션(#188 검수 M6·M8b): 실제 storage와 가짜 서버로 확인한다.
    - 재시도 대기 중인 글: online은 보내고 focus는 보내지 않는다(`force`).
    - 방금 쓴 초안: 숨김은 보내고 보이는 주기는 기다린다(`flushDrafts`).
    - 각 옵션을 빼는 변이에서 실패한다.
  - 섞인 판(모듈 없음): 등록 0, 첫 주기의 계정 확인 1회.
  - 동작 단언은 변경 전 코드(`ea27890`)에서도 통과한다. 변경 전 코드에서 실패하는 것은 이름 단언과 섞인 판 사례뿐이다(직접 등록).
  - 고정하지 않은 것: 처리기 안의 나머지 분기(멈춘 페이지의 pageshow가 아닐 때 등)는 기존 blog-sync 검사에 맡긴다.
- **모듈이 없을 때(섞인 판):** S2a와 같이 페이지 이벤트를 등록하지 않는다.
  - 시작 주기와 스스로 예약하는 주기, 명시 동기화는 그대로 돈다.
  - 그 판에서는 숨김·이탈 때 즉시 올리지 않는다. 글과 초안은 이 기기에 남고, 다음 주기(최대 30초)나 다음 열기에 올라간다.
  - `OLDER_PAGE`에 BlogSync 사례를 더했다(등록 0, 첫 주기의 계정 확인 1회, 오류 없음).
- **브라우저:** 로컬에서 다음 검사를 통과했다.
  - `sync-lifecycle-browser` 4
  - `sync-common-mixed-browser` 5
  - `structure-baseline-browser`(전역 이름 수 변화 없음)
  - `blog-autosave-browser` 4
- **sync-lifecycle.js 공통 모듈은 바꾸지 않았다.**
