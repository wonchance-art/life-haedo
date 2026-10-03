# 기술 구조와 기존 연표 연결

2026-10-03 설계안. 이후 R1 구현에 착수했으며 현재 완료한 코드와 실행 증거는 [R1 구현 기록](r1-implementation.md)에서 구분한다. 아래 후속 AI·원격 권한·공유 설계 전체의 완료를 뜻하지 않는다.
현재 근거는 [앱 구조](../architecture.md), [README](../../README.md), [현재 기준](../current.md), [참조 설계](../design.md), 관련 코드다.
생활 기반·학습·문화·창작·관계에 같은 실행 골격을 쓰되, 분야의 고유 데이터와 규칙을 유지한다.
첫 구현 단위는 **선택한 기존 기록 가져오기 → 원문·출처 보존 → 발췌·검토 → 통합 → 원문 추적·재열기·내보내기**다.
Apple 메모·Obsidian·네이버 블로그·인스타그램이 주요 원천이며 직접 입력은 기존 자료의 보충이다.
기본 장면은 iPad Chrome에서 사용자가 제공한 본문·텍스트/Markdown 파일·링크를 소량 처리하는 것이다.

## 확인한 기반과 지켜야 할 동작

- 빌드 없는 HTML/CSS/일반 JavaScript. `data.js → sync.js → app.js → workspace.js` 순서로 script를 로드한다.
- `app.js` 약 3,907줄에 연표 계산·SVG·편집·히스토리·저장·문서 관리·클라우드·지도·격자가 결합돼 있다.
- `DATA`, `REG`, `curDocId`가 전역이며, `workspace.js`도 이를 읽고 기존 팝오버 함수를 호출한다.
- `afterMutate()`는 계산·그리기·지도/경로/스크러버 갱신·`persist()`·작업 화면 갱신을 함께 수행한다.
- `persist()`는 DATA 스냅샷 실행 취소, localStorage 문서/목록 저장, 클라우드 예약, 저장 표시를 묶는다.
- `data.js`는 연표 구조·달력·손상 값 격리·새 사본 가져오기, `sync.js`는 문서별 전송 큐와 조건부 쓰기다.
- 기존 저장은 `caeyeon_life_*`; 선택적 원격 `charts`의 JSON 문서와 로컬 사본을 함께 고려해야 한다.
- 기존 동기화는 문서별 `updated_at` 비교·조건부 PATCH, 연결 세대 확인, 원격 삭제 재생성 방지를 갖춘다.
- 기존 실행 취소는 현재 DATA의 60개 스냅샷이다. 신규 작업공간의 기록이나 외부 실행을 되돌리는 기능이 아니다.
- PWA는 버전별 앱 셸만 캐시한다. 지도·폰트·서지 조회·AI 응답이 오프라인 보장에 포함되지는 않는다.

`prepare() → render()`, 저장 `future`와 파생 `fut`, 월별 행복도 집계 우선순위, `curveYAt(x)` 표식을 유지한다.
계획이나 진도율을 행복도로 자동 환산하지 않는다. 보기 토글은 데이터·통계를 바꾸지 않는다.
기존 회귀 22개, 실제 Supabase 검사 28개, 브라우저 동기화 통과는 전달받은 기존 기준선이다.
이는 신규 저장·활동·AI·권한·공유의 통과 증거가 아니며 이번 문서 작업에서 재실행하지 않았다.

## 작은 모듈로 확장하는 구조

다음 파일은 제안 경로다. 처음부터 전부 만들지 않고 첫 기능에 필요한 파일만 추가한다.
각 파일은 소유할 책임을 나타낸다. [오픈소스 검토](open-source-review.md)를 거쳐 적합한 라이브러리를 내부에서 사용하며, 범용 저장·검색·날짜·편집 기능을 일괄 자체 구현하는 계획이 아니다.

| 경계 | 제안 위치 | 책임 / 의존 방향 |
| --- | --- | --- |
| 앱 조립·선택 맥락 | `assets/life/shell.js` | 모듈 등록·화면 전환·현재 맥락; UI와 adapter를 연결 |
| 공통 모델·명령 | `assets/life/core.js` | 변경 검증·식별자·정규화·읽기 모델; DOM/네트워크 비의존 |
| 로컬 저장 | `assets/life/storage.js` | IndexedDB 작업공간·트랜잭션·복원; UI/분야 규칙 비의존 |
| 기존 앱 연결 | `assets/life/legacy.js` | clone 조회·문서/항목 열기·변경 알림; 전역 접근을 여기로 제한 |
| 가져오기 | `assets/life/import.js`, `adapters/*.js` | 원천 식별·입력 검사·stage·발췌 후보·검토·통합; 원천 앱 접근과 분리 |
| 공통 화면 | `assets/life/ui.js`, `assets/life/ui.css` | 모아보기·원천 기록·검토·재열기·폼·저장 안내·포커스; 명령만 제출 |
| 분야 규칙 | `assets/life/domains/*.js` | 생활·책/교재·장소/작품·프로젝트·관계의 검증과 진행 단위 |
| 외부 지원 | `assets/life/sources.js`, `ai.js`, `sync.js` | 후속 선택 자료 조회·AI·신규 동기화 adapter; 로컬 import와 분리 |

일반 script + 명시적 `HaedoLife` namespace/IIFE 등록으로 시작한다. 로드 순서는 조립부에서 문서화한다.
새 기능 UI는 연표 밖의 컨테이너에 mount하고 기존 CSS 변수·접근성·모바일 문법을 재사용한다.
공통 모델은 DOM을 모르고, 분야 규칙은 저장소를 직접 열지 않으며, AI는 모델에 직접 쓰지 않는다.
UI는 DATA·CLOUD·localStorage·fetch를 직접 사용하지 않는다. 저장·조회 adapter를 주입받는다.
`VIEW_ONLY` 화면은 개인 bundle을 자동 조회/mount하지 않는다. 공유 화면에는 승인된 읽기 모델만 전달한다.
ES modules·프레임워크·번들러 전환은 향후 필요가 확인될 때 별도 선택이며 첫 구현의 의존성이 아니다.

## 최소 공통 계약

논리 개념은 대상(Object), 계획(Plan), 활동(Activity), 기록(Record), 생각(Thought), 원문 문서(Source), 원문 버전(SourceVersion)이다.
Source는 문서 식별 단위, SourceVersion은 실제 받은 내용·형식·수집 범위·출처 시각의 불변 snapshot이다.
수신 원문 보존은 원천 서비스의 전체 원본·첨부·편집 이력을 확보했다는 뜻이 아니다.
각 개념은 코드상의 참조 단위이며 개념마다 파일·테이블·서비스를 만들라는 요구가 아니다.
공통 식별자는 `workspaceId/entityId`; 수정 항목은 `expectedRevision`을 갖는다. 제목은 식별자가 아니다.
사용자가 고른 분야·상태와 AI 추정·제안은 분리하며, 날짜 정확도와 진행 단위는 분야 규칙이 검사한다.

```js
Storage.read(workspaceId) // → 검증된 clone snapshot 또는 명시적 오류
Storage.commitLocal({ operationId, workspaceId, baseRevision, changes })
// → { status: 'stored', revision, operationId }
// | { status: 'conflict', currentRevision, conflictRefs, operationId }
// | { status: 'rejected', error: { code, message }, operationId }
Storage.subscribe(workspaceId, listener) // → unsubscribe; 저장 완료 revision 알림
Domain.validate(command, snapshot) // → 변경 집합 또는 필드별 오류
Domain.resume({ objectId, activityId }, snapshot) // 후속 활동 도구: 둘 중 하나로 재개
Domain.progress(objectId, snapshot) // 후속 활동 도구: 분야 단위·근거·미확인 부분
UI.mount(container, { context, snapshot, dispatch }) // → update, dispose
```

`dispatch(command)`는 검증 → `commitLocal` → 새 snapshot 조회 → 화면 갱신 순서를 조율한다.
`changes`는 Source/SourceVersion·선택한 기록/생각/대상·참조의 추가와 기존 항목 수정/삭제다. 수정은 예상 entity revision을 포함한다.
작업공간 revision 불일치는 자동 재실행하지 않고 `conflict`로 돌려 사용자의 초안을 보존한다.
`stored` 영수증만 같은 트랜잭션에 영속화하며 같은 operationId/내용의 재요청은 성공 영수증을 반환한다.
`rejected`/트랜잭션 중단은 변경과 영수증을 남기지 않아 같은 ID/내용으로 재시도한다. 성공 ID/다른 내용은 거절한다.
`conflict` 해결로 baseRevision/내용이 달라지면 새 operationId를 사용한다. 저장 실패를 영구 중복 결과로 고정하지 않는다.
`stored`만 저장 완료로 표시한다. 실패·충돌 시 편집 초안을 유지하고 재시도·별도 사본/내보내기를 제공한다.
기본 로컬 사용에는 outbox 항목이 필요 없다. 원격 기능을 선택한 변경만 보류 작업을 함께 생성한다.

UI 저장 상태 `editing/saving/saved/error`와 동기화 상태를 별도로 관리한다.
동기화 enum은 `not_configured/pending/syncing/synced/conflict/error`; 초기 로컬은 `not_configured`다.
로그인 필요는 `error.code='auth_required'`로 설명한다. 로컬 저장 완료를 동기화 실패 때문에 지우지 않는다.
이 enum과 저장 결과 계약은 [데이터 설계](data-model.md)와 [경험 설계](experience.md)에서 함께 적용한다.

## 상태와 분야별 책임

영속 상태: Source/SourceVersion·통합 항목·원문 참조·revision·선택적 보류 작업. 활동/계획은 선택 결과에 필요할 때 생성한다.
화면 상태: 열린 패널·폼 초안·포커스·검색어·스크롤·진행 중 요청. ImportSession stage는 본 작업공간과 별도로 임시 보존한다.
파생 상태: 주제 모아보기·검색 결과·원문 강조·연표 연결 목록. 저장된 사실로 재생성한다.
shell의 맥락은 `{workspaceId, stageId?, sourceId?, sourceVersionId?, locator?, objectId?, activityId?, resumeLocator?, questionId?}`다.
초안이 있는 다른 대상으로 이동할 때 저장 대기/실패를 분명히 알리고 자동으로 완료 처리하지 않는다.
원문·검토·통합 결과의 재개 위치는 bundle에 저장하고 패널 상태는 필요할 때만 따로 기억한다.
영속 재개는 `resumeHint={sourceId?,sourceVersionId?,stageId?,entityRef?,locator?,note?,revision}`로 `bundle.resumeHints`에 둔다.
후속 활동 도구는 activityId/objectId를 선택 확장한다. 대상 없는 활동도 가능하며 R1 원문 등록에 활동 생성을 강제하지 않는다.

| 분야 | 특화 책임 | 공통 시스템이 하지 않을 일 |
| --- | --- | --- |
| 생활 기반 | 예정 시각·반복 규칙·실제 수행·생활 상태 | 예정 생성만으로 수행 기록 만들기 |
| 책·교재 | 판본·페이지/구간·재독·단원·문제·이해·질문 | 마지막 위치를 실제 완료 구간으로 간주하기 |
| 문화·현장 | 작품/장소 판별·방문/감상 구간·현장 관찰 | 좌표·감상·작품 버전을 한 값으로 합치기 |
| 창작·프로젝트 | 단계·산출물 버전·선택 이유·다음 작업 | 초안을 발행본이나 승인된 성과로 취급하기 |
| 관계·약속 | 참여자 참조·약속 상태·개인 메모·공동 기록 | 개인 메모를 참여자에게 자동 공개하기 |

교차 분야 활동은 같은 activityId를 참조한다. 독서 도구와 오늘 목록이 서로 기록을 복사하지 않는다.
모듈은 필요한 필드·검증·읽기 모델만 선언한다. 분야마다 독립 엔진·AI 에이전트·서비스를 만들지 않는다.

## 저장과 기존 연표의 접점

신규 기본 저장 adapter는 별도 `life-tools-v1` IndexedDB의 작업공간 bundle JSON·operations·별도 staging store를 제안한다.
Source/SourceVersion·선택 항목·원문 참조·성공 영수증을 같은 트랜잭션에 저장한다. 후속 활동 편집은 활동·기록·재개 위치를 함께 저장한다.
원격 테이블을 개념별로 나누는 전제는 없다. 선택한 원격 기능만 outbox를 함께 만든다.
이 선택은 localStorage의 다중 키 쓰기보다 복구 경계를 분명히 한다. idb·Dexie의 공식 계약과 작은 실행 검증을 비교한 뒤 저장 adapter의 구현을 선택한다.
기존 localStorage 문서와 charts는 그대로 두고, 생활 도구의 저장 성공을 기존 `persist()`로 처리하지 않는다.
IndexedDB open/쓰기 실패는 메모리 초안만 유지하고 저장 실패를 표시한다. 기존 연표 읽기는 계속 가능하다.
R1은 받은 텍스트를 보존한다. 이미지/PDF/영상은 자동 수집·OCR하지 않고 누락 범위를 표시한다. 대형 첨부는 후속 설계다.

## sourceOrigins → adapters → stage → review → atomic apply

`sourceOrigins`는 `apple_notes/obsidian/naver_blog/instagram/other` 원천 식별과 출처 정보를 선언한다.
adapter는 서비스 이름보다 받은 형식을 처리한다. R1은 `paste-text`, `utf8-text-file(.txt/.md)`, `url-reference`부터 비교 검증한다.
Apple 메모 내보내기·계정 ZIP·vault 디렉터리의 자동 읽기나 웹 로그인은 이 adapter의 기능이 아니다.
`Import.stage({origin,input,sourceMeta})`는 입력 검사 후 ImportSession(stageId)에 수신 원문·후보를 임시 저장한다.
본문 입력은 SourceVersion 후보를 만들고 `coverage.status=full_text/partial/unknown`으로 실제 확보 범위를 표시한다.
URL만 입력하면 `coverage.status=link_only`, `contentText:null`, `contentHash:null`이다. 실제 빈 문서와 구분한다.
URL만 보관한 sourceRefs의 locator는 null이다. 확보하지 않은 본문 발췌를 만들지 않는다.
`Import.extract(stageId,selectionOrRule)`는 수동 선택 또는 결정적 구절·문단·명시 링크 규칙으로 후보와 locator를 만든다.
R1은 문단 발췌·주제 연결부터 시작한다. 문장 안의 날짜를 활동의 실제 수행일로 자동 확정하지 않는다.
`Import.review(stageId,decisions)`는 원문·발췌·통합 대상·누락·중복/변경을 함께 확인하고 선택만 보존한다.
`Import.apply({stageId,stageRevision,operationId,workspaceId,baseRevision})`는 검토가 고정한 changes를 `Storage.commitLocal`에 제출한다.
트랜잭션에서 stageRevision·현재 workspace revision·원문 해시·locator를 검사하고 applied stage 상태도 같이 반영한다.
다른 탭에서 검토가 바뀌면 오래된 선택을 자동 적용하지 않는다. `Import.resume({workspaceId,stageId?,sourceVersionId?,entityRef?})`로 다시 연다.
`자료만 보관`은 원문 Source/SourceVersion만 먼저 commitLocal하고, 발췌는 이후 별도 검토/커밋할 수 있다.
원문+선택 발췌를 한꺼번에 통합할 때는 그 작업의 원문·선택항목·링크·영수증을 한 트랜잭션으로 적용한다.
`stored` 전 성공 표시하지 않는다. 실패/취소는 미적용 stage만 재열기/삭제하며 이미 성공 보관한 원문을 지우지 않는다.
재적용은 성공 영수증/명시 sourceKey/contentHash로 비교한다. URL·제목·해시만으로 서로 다른 원문을 합치지 않는다.

파생 항목은 `sourceRefs:[{sourceId,sourceVersionId,locator}]`로 받은 불변 원문을 가리킨다.
locator는 해당 contentText의 UTF-16 `[start,end)`다. 줄 번호는 파생값이며 원문을 정규화하거나 요약으로 교체하지 않는다.
파일 byte 원본을 보존할 때 decoded contentText와 구분한다. UTF-8 오류/BOM·줄바꿈 처리 차이를 숨기지 않고 미지원 인코딩을 알린다.
다시 가져온 변경 본문은 새 SourceVersion으로 보존한다. 이전 발췌가 새 본문의 같은 위치를 가리킨다고 가정하지 않는다.
외부 재열기는 사용자 선택으로 원천 URL을 연다. 실패·비공개·삭제돼도 로컬 SourceVersion과 발췌는 유지한다.
URL 열기가 본문 수집·권한 획득을 뜻하지 않는다. `obsidian://` 같은 앱 링크는 실제 iPad 전환 검증 뒤 제공한다.
R1 외부 열기는 검증한 http/https URL만 허용하고 javascript/data 실행 URL을 거절한다. 앱 deep link는 후속이다.
본문과 Markdown은 우선 `textContent`로 표시한다. HTML/Markdown 렌더링·첨부 로딩·원격 이미지 요청을 자동 활성화하지 않는다.
자료/첨부의 명령을 앱 실행 지시로 취급하지 않고 import 중 AI·외부 전송·스크립트 실행을 하지 않는다.
업로드 ZIP은 이번 설계의 참고자료다. 실제 ZIP 지원은 경로/용량·중복·첨부 검증을 따로 끝낸 뒤 선택한다.
서비스별 공식 확인과 미확인 경로는 [오픈소스·원천 조사](open-source-review.md)에 둔다. 실제 iPad 검증을 대신하지 않는다.

```js
Legacy.listDocuments() // → {originScope, legacyDocId, name}[]; 비밀 제외
Legacy.read({originScope, legacyDocId, legacyEntityId?}) // → clone 또는 missing/unavailable
Legacy.open(ref) // → 기존 문서/항목 화면으로 이동; 신규 상태 쓰기 없음
Legacy.subscribe(listener) // → 문서 전환·변경·삭제 알림; 구독 해제 가능
```

bridge는 읽기 전용/허용 문서의 capability를 확인한다. 읽기 전용 연표로 연결해도 쓰기 권한이 생기지 않는다.
참조는 신규 bundle에 `{namespace:'charts', originScope, legacyDocId, legacyEntityId?, entityRef?}`로 둔다.
신규 통합 기록/생각/대상은 일반 `entityRefs`로 연결한다. 기존 연표 링크에 activityId를 필수로 만들지 않는다.
`originScope`는 비밀 없는 논리 식별자이며 미연결 로컬에도 생성한다. URL/계정명으로 무분별하게 매칭하지 않는다.
기존 항목에 안정적 ID가 없으면 문서 수준 연결로 남긴다. 날짜/제목/배열 순서로 영구 ID를 대신하지 않는다.
삭제·문서 미존재·권한 실패는 연결 불가 표시로 남기고 신규 활동을 함께 지우지 않는다.
연표에서 실제 생활 활동을 보고 싶으면 첫 단계는 읽기 목록/연결 진입을 제공한다. 자동 사건 생성은 하지 않는다.
후속의 선택적 연표 사건 추가는 승인된 요약만 복사하며, 원본 activityId 연결과 별도의 저장 실패 처리가 필요하다.
두 저장소 사이에는 원자적 트랜잭션이 없다. 부분 성공 시 연결 보류/복구를 표시하고 재시도로 중복 사건을 만들지 않는다.
생활 기록이 편집돼도 기존 연표의 행복도·생각·기간이 자동 수정되지 않는다. 상세 데이터는 생활 도구가 정본이다.

가져오기 예: Obsidian 메모 하나의 `.md` 선택 → 받은 본문/파일 출처 확인 → 두 문단 발췌 → 같은 주제에 통합.
다시 열면 통합 항목에서 정확한 수신 원문 구간을 강조하고 원래 파일명/원천 URL을 확인한다. 연표는 별도 읽기 연결이다.
후속 연표 사건 추가는 사용자가 날짜·문구를 확인한다. 기록 작성일이나 가져온 날을 실제 활동일로 자동 사용하지 않는다.

## 3,907줄 파일을 다루는 순서

1. 새 도구를 별도 컨테이너·저장 adapter로 추가한다. 먼저 app.js 전체 분해를 완료해야 한다는 조건을 두지 않는다.
2. 필요한 연결만 `legacy.js`로 감싼다. 초기에 기존 함수를 그대로 위임하고 데이터 조회는 clone으로 반환한다.
3. 문서 전환·원격 pull·수정/삭제의 실제 접점에 최소 변경 알림을 넣는다. MutationObserver로 데이터 변경을 추측하지 않는다.
4. 신규 기능이 기존 편집을 필요로 할 때만 명시적 legacy 명령을 만든다. UI가 전역 DATA를 조작하는 경로를 늘리지 않는다.
5. 반복해 다루는 기능만 작은 단위로 옮긴다. 예: 검색 후보 수집 → 검색 UI, 문서 목록/전환, 지도 adapter 순의 독립 작업.

옮기는 단위는 함수 수나 줄 수보다 책임과 검증 범위로 정한다. 각 이동 후 동일 입력의 결과와 실제 흐름을 확인한다.
현재 `afterMutate`가 전체를 다시 그리는 동작은 우선 유지한다. 신규 저장을 이 함수에 연결하지 않는다.
연표의 실행 취소와 생활 도구의 로컬 실행 취소는 대상/범위를 표시한다. 서버 작업 취소로 확장하지 않는다.
브라우저 구독·이벤트·타이머는 `dispose()`로 해제한다. 다른 작업공간의 응답을 현재 화면에 끼워 넣지 않는다.

## AI·자료·계정·외부 실행 경계

`SourceAdapter.lookup(query, {signal})`는 후보·출처·확보 범위·실패를 반환한다. 확정 등록은 사용자 선택 명령이다.
`AIAdapter.propose({purpose, contextSnapshot, sourceRefs, baseRevision}, {signal})`는 제안 결과를 반환한다.
결과는 제안 ID·요청 기준 revision·근거 참조·모델/실행 정보·불확실성을 담으며 원문/사용자 기록과 구분한다.
AI 요청 전 기본 기록을 저장하고 허용된 맥락만 선택한다. API 실패·취소는 진도/메모 저장과 독립적이다.
현재 대상/기준 revision이 달라졌으면 오래된 제안을 표시하고 자동 적용하지 않는다. 재검증 후 사용자 명령으로만 반영한다.
서버 전용 AI 키를 정적 앱·localStorage·service worker에 넣지 않는다. 유료 AI는 후속 proxy/backend 운영이 필요한 선택이다.
현재 Supabase Auth 로그인 UI와 토큰 갱신은 기존 charts 접근 경로다. 신규 작업공간·친구·공유 권한이 생긴 증거가 아니다.
계정 기반 신규 동기화/특정인 공유는 소유권·RLS·철회·삭제 계약을 따로 설계하고 서버에서 검증해야 한다.
외부 전송/발행은 로컬 기록 저장과 다른 명령이다. 승인된 스냅샷을 고정하고 결과 불명 시 자동 재전송하지 않는다.

## 오프라인·동기화·백업·실행 환경

새 런타임 파일을 추가할 때 `index.html` 로드 순서·`sw.js` SHELL·버전을 함께 갱신한다. 설정만 바꿔 캐시 준비를 주장하지 않는다.
현재 service worker는 같은 origin의 셸 요청만 처리하며 개인 데이터나 AI 응답을 캐시에 추가하지 않는다.
기존 네트워크 우선 캐시는 온라인 배포 전환 시 파일 버전 혼용 가능성을 별도 확인한다. 신규 모듈 호환 확인과 오프라인 재시작이 필요하다.
첫 IDB 실험에는 구버전 탭을 연 채 새 버전 열기→업그레이드 차단/중단→오프라인 재실행을 넣는다. 호환되지 않는 코드의 쓰기를 막고 초안 보존·탭 갱신 안내·내보내기 경로를 제공한다. 앱 캐시를 되돌려도 DB 스키마가 자동 복구된다고 가정하지 않는다.
PWA 설치 전/미캐시 첫 방문은 오프라인 실행을 보장하지 않는다. 셸 업데이트·저장소 마이그레이션·캐시 삭제를 구분한다.
로컬 저장 중 탭/기기 종료, 다른 탭의 revision 변경, 브라우저 용량/권한 실패를 각각 검증한다.
기존 charts 큐는 생활 도구 outbox가 아니며 디스크에 남는 범용 작업 큐도 아니다. 기본 신규 기능은 동기화하지 않는다.
후속 동기화는 별도 adapter가 서버 revision/CAS·중복 방지·삭제 표식·소유권을 검증한 뒤 붙인다. charts 형식 변경을 전제하지 않는다.
IndexedDB 도입만으로 여러 기기 데이터가 공유되지 않는다. 신규 원격 계약 구현 전에는 해당 범위를 UI에 분명히 표시한다.

현재 `haedo-backup-v1`은 연표 문서/손상 원본을 담는다. 새 저장소를 자동 포함하지 않으므로 그대로 전체 생활 백업이라 부르지 않는다.
R1 신규 백업은 Source/SourceVersion의 실제 contentText·format·coverage·출처 시각/URL, 통합 항목·sourceRefs·revision을 담는다.
본문 미확보의 null과 실제 빈 원문을 구분한다. 미적용 stage는 별도 초안 내보내기 범위를 표시하며 원천 기록 보관과 혼동하지 않는다.
보류 상태는 진단용이고 복원 시 실행하지 않는다. 연결 설정·토큰은 제외하며 기존 연표 백업은 별도로 유지한다.
후속 통합 백업은 생활 데이터와 연표 원본을 명시적 섹션에 담는다. R1에서 통합 백업을 먼저 완성할 필요는 없다.
두 저장소의 동시 스냅샷을 보장할 수 없으므로 export 중 revision을 재확인하고 변동 시 재시도/부분 상태를 알려준다.
복원은 항상 새 작업공간/ID의 사본이며 내부 참조를 재매핑한다. 외부 legacy 참조는 미확인 상태에서 재연결한다.
출처가 다른 소유권/전송 대상을 자동 재사용하거나 보류 작업을 자동 실행하지 않는다. 미래 형식은 읽기 전용·원본 내보내기로 보존한다.
`HaedoData.canonical`은 재귀적으로 `kind` 등 연표 파생 키를 제거하므로 신규 bundle 직렬화에 재사용하지 않는다.
`migrateScale/sanitize`도 연표 전용이다. 달력 helper만 실제 입력 범위를 확인한 뒤 재사용한다.
PNG/SVG는 기존 연표의 현재 화면 이미지다. 생활 백업·휴대 가능한 텍스트/자료 내보내기·공유본과 별도 메뉴/범위로 둔다.
통합 결과의 UTF-8 텍스트/Markdown 내보내기는 발췌·사용자 메모·출처/수신 범위를 포함한다. 정확한 SourceVersion·locator 왕복은 JSON 사본 백업으로 보장한다.

실행 환경은 정적 서버와 현대 브라우저의 IndexedDB다. 개발은 Node 20+·Python 3, 기존 npm 명령을 유지한다.
로컬 기본 도구는 사용자에게 DB·API 키·별도 패키지 설치·예약 worker를 요구하지 않는다. 개발에서는 검토한 라이브러리를 버전 고정해 함께 배포할 수 있다. 외부 제공처·AI·서버 실행 환경은 후속 기능별로 추가한다.
현재 cloud 환경의 Supabase 검사 설정은 개발 검증 수단이며 앱 사용자의 계정/키나 신규 서비스 준비 완료를 뜻하지 않는다.
사용자는 Mac·iPad·iPhone을 함께 쓴다. iPad Chrome은 기존 확인 환경이다. Chromium에서 화면 폭을 바꾼 결과를 각 Apple 기기의 엔진·파일 저장·앱 전환 검증으로 확대하지 않는다. 로컬 흐름 다음에는 개인 동기화를 우선한다.
작업공간 ID와 UI adapter는 같은 origin에서 실행되는 스크립트의 저장소 접근을 격리하지 않는다. 기존 지도 등을 포함해 런타임 JavaScript의 출처·고정 버전·동봉 또는 무결성 확인 방식을 검토하고, 변경이 필요하면 별도 범위로 반영한다.

## 구현 의존성과 완료 기준

순서: 원천별 소량 입력 실험/오픈소스 비교 → import 계약 → 신규 저장·stage·사본 백업 → 발췌/검토/원자 적용 → 원문 재열기·내보내기.
legacy 읽기 연결·직접 메모 보완은 이 흐름을 해치지 않는 작은 기능으로 붙인다. 분야별 진도 도구는 통합 자료의 필요에 따라 후속 확대한다.
자동 자료 조회는 수동 수신 경로 뒤, AI는 받은 원문/출처/선택 권한 뒤, 신규 동기화는 로컬 revision/보류 계약 뒤에 추가한다.
특정인 공유·공개는 원본/공유 스냅샷과 서버 권한 뒤에 가능하다. 예약 자동화는 실행 환경·중복 방지·취소/결과 확인 뒤의 별도 단계다.
각 단계 완료는 동작하는 작은 사용자 흐름과 그 실패/복구로 판단한다. 문서·adapter 이름 존재만으로 완료 처리하지 않는다.

- 첫 흐름: 받은 본문·출처를 보존하고 수동/규칙 발췌를 검토해 통합한다. 새로고침 후 같은 원문 구간을 열고 출처 포함 내보내기/사본 복원한다.
- 저장 실패/경합: 원문+발췌를 함께 확정한 한 작업이 일부만 반영되지 않고 stage를 보존한다. 재시도 중복·다른 탭 수정의 손실이 없다.
- 기존 보호: 연표 문서/키/백업/실행 취소/동기화가 동일하게 동작하며 새 저장이 charts 쓰기를 만들지 않는다.
- 연결/이식: 삭제된 연결·사본 복원·다른 origin에서 미확인 참조가 안전하게 표시되고 데이터가 사라지지 않는다.
- UI/PWA: iPad Chrome의 파일 선택·본문 복사·원문 구간 선택·한글/키보드·앱 전환·실제 내보내기 재선택과 준비된 셸의 오프라인 재시작을 확인한다.

문서 변경은 경로·링크·diff만 검사한다. 구현 시 기존 `npm run check`/`npm test`와 변경 흐름 검증을 수행한다.
새 데이터 계약 검사는 Node 회귀로, IndexedDB 원자성/탭 경합/PWA는 실제 브라우저로 검증한다.
신규 원격/AI를 구현한 단계에서만 실제 서비스 검사·비용/출처/계정 격리 검증을 별도로 추가한다.
