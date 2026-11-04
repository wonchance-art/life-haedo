# S1 정렬 JSON 공유와 지문 호환성 조사 (2026-11-02)

[구조·흐름 점검](structure-workflow-review-20261102.md) 4-5절 큰 정리의 S1이다. 기준 main은 `4298f62`(S0 기준선 #167 포함)이다. 독립 검수에서 지적받은 저장 지문 지도를 바로잡은 판이다.

## 이번 변경

- **공통 모듈:** 새 `assets/life/sync-common.js`(`HaedoLife.SyncCommon.canonical`)를 만들었다.
  - S0 묶음 G3의 정렬 JSON 문자열을 글자 그대로 옮겼다.
  - 검수에서 경계값 33종과 무작위 20,000건을 대조했고 차이는 0이었다.
- **엔진 연결:** `blog-sync.js`와 `material-continuity-sync.js`는 엔진을 만들 때(`create()`) 공통 모듈을 꺼내 쓴다.
  - 공통 모듈이 없으면 `sync_common_missing` 오류를 낸다. 이때도 모듈 등록은 유지된다.
  - `ui.js`의 블로그 동기화 생성 한 곳은 이 오류일 때 블로그 동기화 없이 화면을 연다. 모듈이 없을 때와 같은 동작이다.
  - 갱신 중에 이전 `index.html`과 새 모듈이 섞인 상태를 탐침했다. 결과는 pageerror·콘솔 오류 0, 화면 정상이다.
    - 블로그 동기화와 준비(자료로 글쓰기) 동기화는 시작하지 않는다.
    - 블로그 상태는 `저장됨 · 앱을 새로고침하면 계정에 올립니다.`로 표시한다.
    - 글 관리의 공개 게시·공개 철회·삭제는 확인 창을 띄우기 전에 멈추고 `앱을 새로고침한 뒤 다시 시도해 주세요. 글은 이 기기에 그대로 있습니다.`(`app_refresh_required`)를 낸다(#173 검수 m3).
      - 삭제도 막는 이유: 블로그 동기화 없이 이 기기에서만 지우면 다른 기기에는 남고 다음 동기화 때 다시 내려온다. 그런데 안내는 "다른 기기에서도 삭제됩니다"였다.
    - `자료로 글쓰기`를 열면 페이지는 그대로 두고 오류 안내만 보인다(후속 검수 m-a). 이전에는 `materialOpen`이 남아, 다시 그릴 때마다 같은 예외로 본문이 사라졌다.
      - 되돌릴 때 페이지 전체를 다시 그려 `지금 저장`도 다시 보인다(#173 검수 m1).
      - 원문 읽기의 `이 자료로 글쓰기`로 들어온 경우 앱이 자료로 글쓰기 작업을 끝내므로 머리말이 `선택 자료 페이지`로 돌아온다(m2).
      - 브라우저 기록 항목은 다음에 기록할 때 페이지로 바뀐다. 새로고침한 뒤에는 정상 판이므로 다시 열 수 있다.
    - 검사: `tests/sync-common-mixed-browser.cjs`(5개). `index.html`에서 `sync-common.js` 한 줄만 뺀 판을 내려준다.
      - 페이지·원문 읽기 두 진입로에서 매번 새 오류 노드(`data-code="sync_common_missing"`)가 생기는지, 입력값·`지금 저장`·머리말이 유지되는지 본다.
      - m1·m2·삭제 막기를 하나씩 되돌리면 각각 실패하는 것을 확인했다.
- **로드 순서:** `index.html`·`life.html`에서 `blog-sync.js` 바로 앞에서 불러온다.
- **목록:** `sw.js` 오프라인 목록과 `scripts/prepare-site.mjs` 배포 허용 목록에 넣었다.
- **캐시 이름:** `haedo-v173` → `haedo-v174`로 올렸다.
  - 이름을 그대로 두면 설치 중에 이전 HTML과 새 모듈이 한 캐시에 섞일 수 있었다. 검수자가 `Cannot read properties of null (reading 'canonical')`로 재현했다.
- **S0 기준선**
  - 두 라벨의 file·name만 `sync-common.js#canonical`로 바꿨다. 고정 출력·묶음·ID는 그대로다.
  - 두 엔진이 공통 모듈을 쓰고 지역 정의가 없는지 확인하는 검사를 더했다.
  - 브라우저 기준선에 `SyncCommon` 1개를 더했다(131개).

## 범위에서 뺀 것과 이유

| 항목 | 이유 |
|---|---|
| `blog-sync.js`의 충돌 분기(`finishedElsewhere`) | 충돌 규칙 작업자 담당(총괄 지시) |
| `naver-capture.js`·`obsidian-decisions.js`(같은 G3) | 총괄 결정으로 공유하지 않는다. `naver-capture.js`는 Edge 함수 `haedo-naver-blog`가 직접 import하므로(`supabase/functions/haedo-naver-blog/index.ts:6`), 옮기면 Edge 재배포가 필요하다 |
| G2·G4·G6·G8 | 동기화 엔진 밖이다 |
| G5 `account-docs-sync.js` | 의미가 다른 묶음이다 |
| PostgREST 판정·UUID 상수 | 총괄이 S1 범위에서 뺐다 |

## 정렬 JSON 출력이 저장되는 곳

| 묶음·위치 | 쓰임 | 저장 |
|---|---|---|
| G4 `material-continuity.js:111-116` `fingerprint()` | 준비 내용의 SHA-256 | **예, 기기.** `storage.js:1755-1757`의 `pending.fingerprint`, 충돌 때의 `conflict.localFingerprint`(`material-continuity-sync.js:123`·`:382`, `storage.js:1760-1762`), `material-continuity-sync.js`의 전송 기준·서버 판 비교(`model.fingerprint`)에 쓰인다. 서버로는 보내지 않는다(`material-continuity-remote.js`에 0건) |
| G3 `naver-capture.js:111-115` `hashInput` → `fingerprint()` | 수집 본문의 SHA-256 | **예, 서버.** Edge `harvest-worker.mjs:165`가 같은 파일로 계산해 `p_capture_hash`에 저장하고, 클라이언트가 같은 함수로 대조한다 |
| G6 `account-materials.js:55-56` | 계정 자료 등록 그래프의 SHA-256 | **예, 영수증.** `account-materials.js:133`의 `accountMaterialRegistration.fingerprint`, `storage.js:3142`·`:3159` |
| G3 `material-continuity-sync.js` `canonical`(지금은 `SyncCommon.canonical`) | 검토 기준 비교와 확인용 해시(`:111-113`) | 아니오. 한 번 실행되는 동안만 비교하고 버린다 |
| G3 `blog-sync.js` `canonical`(지금은 `SyncCommon.canonical`) | 매니페스트·공개 상태 동등 비교 | 아니오 |
| G5 `account-docs-sync.js:44-92` | 목록 항목 키, 내용 동등 비교 | 아니오 |
| G2 `core.js:225-227, 343, 409-411, 414-526` | 원문 버전 정체성, 발췌 중복 키, 불변·휴지통·백업 목록 대조 | 아니오. 메모리에서 같은 함수로 양쪽을 계산한다 |
| G2 `interest-profile.js:120`, `source-edit.js:14` | 동등 비교 | 아니오 |

**결론:**
- `SyncCommon.canonical`(G3 공유분)의 출력은 지금 어디에도 저장되지 않는다.
- 정규화하면 저장된 값과 어긋나는 묶음은 다음 세 곳이다.
  - G4: 기기에 저장된 준비 지문
  - G3 `naver-capture`: 서버에 저장된 수집 해시
  - G6: 등록 영수증의 지문

## 의심 출력 5종의 영향

| 의심 출력 | 해당 묶음 | 저장 지문에 미치는 영향 |
|---|---|---|
| undefined를 `undefined`로 출력 | G2·G3 | G3 `naver-capture`의 수집 해시가 바뀔 수 있다. 수집 본문에 선택 필드가 비어 있는 경우다 |
| toJSON을 `{"toJSON":undefined}`로 출력 | G2·G3·G5 | 저장 데이터에는 toJSON이 없다 |
| 희소 배열 구멍 `[1,,3]` | G2·G3·G5 | 저장 데이터에는 없다 |
| Date가 `{}`·ISO·거부 | 묶음마다 다름 | 저장 형식은 ISO 문자열이고 Date 객체는 들어오지 않는다 |
| 숫자 문자열 키 순서 | G2·G3·G5는 "10"이 "2"보다 앞 | G3 `naver-capture`. G4·G6은 이 차이가 없는 묶음이다 |

## 판단과 권고

- S1은 출력을 바꾸지 않는다. 그리고 공유한 G3 출력은 저장되지 않는다. 그래서 저장된 지문·해시와의 호환 문제는 생기지 않는다.
- G4·G3 `naver-capture`·G6은 정규화하지 않는다. 바꾸려면 다음이 필요하다.
  - 지문 형식 판(v2)과 이전 판 읽기
  - G3 `naver-capture`: 서버 해시 재계산과 Edge 재배포
  - G6: 기존 영수증 재검증
  - 얻는 것에 비해 가짜 충돌·중복 보관 위험이 크다.
- `SyncCommon.canonical`은 저장되지 않으므로 바꿀 수는 있다. 다만 S0 기준선이 고정하고 있고 이득이 작다. 실제 결함이 나올 때만 다룬다.
- 총괄 결정(2026-11-02):
  - `naver-capture`·`obsidian-decisions`는 공유하지 않는다.
  - 지문 정규화는 하지 않는다.

## 한계 (후속 검수 m-e)

- 섞임 판별은 "블로그 모듈은 있는데 `SyncCommon`이 없다"는 조건 하나로 한다. 이것은 #171 이후의 섞임만 가리킨다. 다른 모듈 조합이 섞이는 경우는 이 문구가 아니라 기존 오류 안내가 나온다.
- 블로그 동기화가 섞임과 다른 이유로 없을 때(서버 설정이 없거나 동기화를 만들지 못한 경우)의 글 관리 삭제는 이번에 바꾸지 않았다. 이 경우도 이 기기에서만 지우면서 "다른 기기에서도 삭제됩니다"라고 안내한다. 판정이 다르므로 후속 후보로 둔다.
- 캐시 이름을 올렸으므로(`haedo-v174`) 서비스워커 경로에서는 섞임이 생기지 않는다. 남는 경로는 서비스워커 없이 처음 방문할 때의 HTTP 캐시(최대 600초)뿐이다.

## 미검증

- 운영 DB의 기존 수집 해시·영수증 지문을 실제로 재계산해 대조하지는 않았다. 작업자는 운영 DB를 읽지 않는다.
- 출력 불변은 S0 기준선, 검수자 퍼즈, 단위·브라우저 검사로 확인했다.
