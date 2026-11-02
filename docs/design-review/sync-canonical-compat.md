# S1 정렬 JSON 공유와 지문 호환성 조사 (2026-11-02)

[구조·흐름 점검](structure-workflow-review-20261102.md) 4-5절 큰 정리의 S1이다. 기준 main은 `4298f62`(S0 기준선 #167 포함)이다.

## 이번 변경

- 새 `assets/life/sync-common.js`(`HaedoLife.SyncCommon.canonical`)를 만들었다.
  - S0 묶음 G3의 정렬 JSON 문자열이다. 원래 식을 글자 그대로 옮겼다.
  - `blog-sync.js`와 `material-continuity-sync.js`는 이제 지역 정의 대신 이 함수를 쓴다.
  - 두 파일 모두 브라우저에서는 `HaedoLife.SyncCommon`을, Node에서는 `require('./sync-common.js')`를 쓴다.
- 로드 순서: `index.html`·`life.html`에서 `blog-sync.js` 바로 앞에 넣었다. `material-continuity-sync.js`보다도 앞이다.
- 목록 갱신: `sw.js` 오프라인 목록, `scripts/prepare-site.mjs` 배포 허용 목록
- S0 기준선
  - 두 라벨(`blog-sync.js#canonical`, `material-continuity-sync.js#canonical`)의 file·name만 `sync-common.js#canonical`로 바꿨다.
  - 고정 출력·묶음·ID는 그대로다. 출력 모드 결과가 main 고정값과 바이트 단위로 같다.
  - 브라우저 기준선의 전역 이름에 `SyncCommon` 1개를 더했다(130 → 131). 기준선 규칙에 따라 같은 PR에서 갱신했다.
- 출력은 바뀌지 않았다. 저장된 지문·해시와의 호환성은 구조상 유지된다.

## 범위에서 뺀 것과 이유

| 항목 | 이유 |
|---|---|
| `blog-sync.js`의 충돌 분기(`finishedElsewhere`) | 충돌 규칙 작업자 담당(총괄 지시). 이번 변경은 정의 한 줄(현재 37행)과 상단 참조 한 줄뿐이다 |
| `naver-capture.js`·`obsidian-decisions.js`(같은 G3) | 동기화 엔진이 아니다(총괄 범위). 게다가 `naver-capture.js`는 Edge 함수 `haedo-naver-blog`가 직접 import한다(`supabase/functions/haedo-naver-blog/index.ts:6`). 옮기면 Edge 재배포(운영)가 함께 필요하다 |
| G2·G4·G8의 여러 곳 | 동기화 엔진 밖의 모듈이다. 같은 묶음끼리만 합칠 수 있으므로, 공유 대상이 생기면 이후 단계에서 다룬다 |
| G5 `account-docs-sync.js` | 의미가 다르다(undefined 키 제거). 혼자인 묶음이라 합치지 않는다 |
| PostgREST 판정·UUID 상수 | 총괄이 S1을 정렬·지문 계열로 좁혔다 |

## 의심 출력 5종의 저장·비교 지도

정렬 JSON 출력이 어디에 쓰이는지 조사했다. 정규화(출력 변경)가 저장된 값을 깨는지 판단하기 위해서다.

| 묶음·위치 | 쓰임 | 저장되는가 |
|---|---|---|
| G3 `material-continuity-sync.js:104` | 준비 결과를 정렬 JSON → SHA-256 `fingerprint`로 만듦 | **예.** 준비 상태로 기기와 서버에 보관되고 다시 비교된다(`:100`, `:145`, `:195`, `:374` 등) |
| G3 `naver-capture.js:114` `hashInput` → `fingerprint()` | 수집 본문의 SHA-256 | **예.** Edge `harvest-worker.mjs:165`가 같은 파일로 계산해 서버 `p_capture_hash`에 저장한다. 클라이언트도 같은 함수로 대조한다 |
| G3 `blog-sync.js:183-190, 289, 431, 583-604` | 매니페스트·공개 상태의 동등 비교 | 아니오. 실행 중 양쪽을 같은 함수로 계산해 비교한다 |
| G5 `account-docs-sync.js:44-92` | 목록 항목 키, 내용 동등 비교 | 아니오. 실행 중 비교만 한다 |
| G2 `core.js:225-227, 343, 409-411` | 원문 버전 정체성(`versionIdentity`), 불변 검사 | 아니오. 저장된 원본 두 개를 같은 함수로 계산해 비교한다 |
| G2 `interest-profile.js:120`, `source-edit.js:14` | 동등 비교 | 아니오 |

의심 출력별 영향은 다음과 같다.

| 의심 출력 | 실제 입력에 나타나는가 | 정규화하면 생기는 일 |
|---|---|---|
| undefined를 `undefined`로 출력(G2·G3) | 선택 필드가 비어 있는 메모리 객체에서 나타날 수 있다. IDB·서버를 거친 JSON에는 없다 | G3: 그런 객체를 해시한 기존 지문이 바뀌어 "변경됨/충돌"로 잘못 판정된다 |
| toJSON을 `{"toJSON":undefined}`로 출력(G2·G3·G5) | 날짜 객체 외에는 없다 | 해당 없음에 가깝다 |
| 희소 배열 구멍 `[1,,3]` | 저장 데이터에는 없다 | 영향 거의 없음 |
| Date가 `{}` / ISO / 거부 | 저장 형식은 ISO 문자열이고 Date 객체는 들어오지 않는다 | G3 지문은 바뀌지 않을 가능성이 높다. 다만 보장되지는 않는다 |
| 숫자 문자열 키 순서("10" < "2") | 키가 숫자 문자열인 객체(예: 연도·순번 사전)가 있으면 나타난다 | G3: 해당 지문이 모두 바뀐다 |

## 판단과 권고

- **S1은 출력을 바꾸지 않는다.** 저장된 지문·해시(준비 fingerprint, Naver capture hash)와의 호환은 S0 고정 출력으로 보장된다.
- **G3 정규화는 권하지 않는다.** 바꾸려면 지문 형식 버전(v2)과 이전 판 읽기, 서버 재계산이 필요하다. Naver는 Edge 재배포도 필요하다. 얻는 것(JSON 규칙 준수)에 비해 위험(가짜 충돌·중복 보관)이 크다.
- **저장하지 않는 비교 경로는 바꿔도 안전하다.** 대상은 G2·G5·blog-sync 비교다. 다만 이득이 작아 별도 결함이 나올 때만 다룬다.
- **Naver capture 쪽 공유는 따로 다룬다.** G3의 `naver-capture.js`·`obsidian-decisions.js`도 같은 함수를 쓰게 하려면 Edge import 순서(`sync-common.js` 먼저)와 Edge 재배포를 묶은 별도 작업으로 해야 한다(총괄 운영 절차).

## 미검증

- 운영 DB의 기존 fingerprint·capture hash를 실제로 재계산해 대조하지는 않았다. 작업자는 운영 DB를 읽지 않는다. 출력 불변은 S0 기준선과 단위·브라우저 검사로 확인했다.
