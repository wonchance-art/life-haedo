# R1 구현 계약과 진행

2026-10-03 · 사용자 구현 착수 요청 반영. 실제 대상은 Mac·iPad·iPhone이며 기존 iPad Chrome 확인도 유지한다. 세 기기의 실제 브라우저/OS 버전은 미확인이다. 이번 구현은 로컬 흐름이며 기기 간 자동 동기화는 R1 직후 우선 후속이다. 백업 사본 이동은 동기화가 아니다.

## 파일 소유권

- core.js + tests/life-core.test.cjs: domains. 원문·발췌·중복·백업/복원 검증의 순수 규칙.
- storage.js + tests/life-storage.test.cjs: data. idb 기반 트랜잭션·staging·작업공간·영수증.
- ui.js + ui.css: experience. 실제 가져오기·검토·모아보기·출처·내보내기 화면.
- life.html + shell.js + legacy.js + index.html + sw.js + scripts/check.mjs + service-worker tests + vendor/idb/: architecture. 로드/연결·OSS 동봉.
- tests/life-browser.cjs + 익명 fixtures: review. 실제 Chromium 검증; root와 동시 브라우저 프로필 공유 금지.
- 문서·README·통합 점검: root. 다른 담당 파일 수정은 인계 후 또는 합의 후 수행.

## 공통 런타임

기존 app.js를 로드하지 않는 별도 `life.html`에서 새 도구를 연다. index.html에는 명시적 진입 링크만 추가한다. 초기 개인 로컬 화면이며 기존 연표의 공유/VIEW_ONLY 화면에서 새 작업공간을 자동 조회하지 않는다. 기존 브라우저 입장 게이트와 서버 인증의 차이는 유지한다.
일반 script/IIFE `globalThis.HaedoLife.Core`, `.Storage`, `.UI`, `.Legacy`를 사용하며 core는 Node CommonJS도 내보낸다. 로드 순서는 동봉 idb → core → storage → legacy → ui → shell이다. 라이브러리는 최신 조사한 idb 8.0.3을 버전 고정하고 LICENSE를 동봉한다.

## 최소 형태

bundle: `{schemaVersion:1,workspaceId,title,revision,createdAt,updatedAt,sources:[],sourceVersions:[],records:[],links:[],resumeHints:[],tombstones:[]}`. R1에서 모든 미래 도메인 컬렉션을 만들지 않는다.
Source: `{id,origin,title,url?,sourceKey?,revision,createdAt,updatedAt}`.
SourceVersion: format은 `text/plain` 또는 `text/markdown`, coverage.status는 `full_text/partial/link_only/unknown`. `{id,sourceId,format,contentText,contentHash,coverage:{status,omissions:[]},originalAuthor:{label,relation},originalCreatedAt:null|string,importedAt,revision}`. 링크만은 본문/hash null, `link_only`; 받은 문자열은 변형하지 않는다.
Record: `{id,kind:'excerpt',text,topic,note,sourceRefs:[{sourceId,sourceVersionId,locator:{start,end}}],provenance:{kind:'user'},revision,createdAt,updatedAt}`. locator는 UTF-16이며 exact quote로 검증한다. topic은 선택 자유 문자열이다.
링크만인 자료도 원천 목록에서 열고 검색할 수 있다. 주제 모음은 records.topic에서 파생하며 같은 구절을 다른 주제로 잇는 것은 명시 사용자 작업이다.

원천 input: `{origin,title,text,url,fileName?,format?,author?,authorRelation?,originalCreatedAt?,coverage?,omissions?,existingSourceId?}`. origin enum apple_notes/obsidian/naver_blog/instagram/other. 지원 URL은 http/https만. 가져오기는 네트워크 요청·HTML 실행·이미지 로딩 없음. UTF-8 .txt/.md 파일은 1 MiB까지, 잘못된 인코딩/지원하지 않는 형식은 명시 거절(실기 성능 보장 수치는 아님).

## Core API

- `createWorkspace({workspaceId?,title?}={})` → 빈 bundle. `id()` → UUID.
- `validateWorkspace(bundle)` → 성공 true, 실패 throw(메시지/코드).
- `prepareImport(input,bundle)` async → `{source,version,match:{kind:'new'|'exact_duplicate'|'new_revision'|'overlap',sourceId?,sourceVersionId?}}`. 동일성 불확실하면 선택 후보이며 자동 병합하지 않는다. exact duplicate 채택은 원문 버전을 재사용한다. UI가 existingSourceId를 명시한 때만 같은 원천의 새 버전으로 적용한다.
- `buildImportChanges(bundle,prepared,excerpts=[])` → changes. excerpts=`[{start,end,topic,note}]`; 중복 버전/같은발췌·주제의 반복 반영을 피하며 exact quote 검사. 자료만 보관이면 excerpts=[].
- `applyChanges(bundle,changes)` → 검증된 새 bundle, 원본 수정 없음. changes=`{put:{sources?:[],sourceVersions?:[],records?:[],links?:[],resumeHints?:[]},remove?:{records?:[]}}`; SourceVersion은 불변. 성공 후 workspace revision+1. 소스 삭제는 향후 계약을 충족하기 전 UI에 제공하지 않으며 R1 삭제는 발췌/모음 연결만.
- `makeBackup(bundle)` → `{format:'life-tools-backup-v1',schemaVersion:1,exportedAt,workspace:bundle,manifest:...}`. 확정 데이터/본문 포함, 미적용 stage 제외를 명시.
- `restoreBackup(data)` async → 새 workspace/source/version/record IDs·참조를 remap한 검증 bundle. 기존 작업공간 덮어쓰기/legacy/계정/작업 자동실행 없음. 실패는 전부 거절하고 원본 파일 유지.
- `toMarkdown(bundle)` → 출처/인용/모음 포함 읽기용 텍스트. 정식 백업과 구분.

## Storage API

singleton `Storage.open()` async → 준비, `close()`.
`listWorkspaces()` → `{workspaceId,title,revision}[]`; `read(workspaceId)` → clone bundle; `createWorkspace(title?)` → 저장된 빈 bundle; `installWorkspace(bundle)` → 새 ID 사본 원자 설치; `getActive()` → workspaceId|null; `setActive(workspaceId)`.
`commitLocal({operationId,workspaceId,baseRevision,changes,stageId?,stageRevision?})` → `{status:'stored',revision,operationId}` / `{status:'conflict',currentRevision,operationId}` / `{status:'rejected',error:{code,message},operationId}`. receipt와 변경 및 stage applied는 한 tx. 성공 동일ID/내용 재시도 영수증, 다른내용 거절. 실패 영수증 없음. 예상 revision은 tx 안에서 검사. 네트워크/해시는 tx 이전.
`saveStage(stage)` → 저장된 stage; `getStage(stageId)`; `listStages(workspaceId)`; `deleteStage(stageId)`.
stage=`{stageId,workspaceId,revision,input,excerpts,createdAt,updatedAt,state:'draft'|'applied'}`. saveStage는 새stage revision0으로 요청/저장1, 기존은 기대 revision 비교 후 +1; conflict는 throw code='stage_conflict'. 가져오기 초안에는 미완성 필드 허용하며 확정 시 Core가 검증한다. applied stage를 다시 draft로 쓰지 않는다.
`subscribe(workspaceId,listener)` → unsubscribe. BroadcastChannel 알림은 잠금 아님. 새 탭 알림으로 편집초안을 덮지 않는다.
IndexedDB는 `life-tools-v1`, version1, bundles/operations/staging/meta/recovery. 실제 schema가 최초이므로 기존 연표 영역 변경 없음. upgrade blocked/versionchange를 UI 오류/쓰기중지로 전달하며 준비 실패를 빈새데이터로 숨기지 않는다.

## UI와 shell

`UI.mount(container,{storage,core,legacy})` async → `{dispose}`. shell은 의존성 확인·오류화면·SW등록 담당, UI는 작업공간 선택/생성·입력·stage저장·commit·다운로드 전체를 조율한다.
처음 자동 생성은 빈 개인 작업공간 하나만; 샘플 자동 입력 없음. 경로 life.html. view-only 쿼리/전역이면 mount하지 않는다.
기본 화면 모아보기 / 원천 기록 / 시간 보기, 공통 가져오기. Mac 1440px·iPad 820/1180px·iPhone390px 모사 확인. 실제 Apple 하드웨어 검증과 구분한다.
로컬 성공은 `이 브라우저에 저장됨`; `기기 간 자동 동기화 미연결`을 짧게 표시한다. 백업으로 다른기기에 가져오기는 새사본이며 양방향동기화 아님.
필수 사용자흐름: 본문/파일/링크→원문/누락 확인→자료만 보관 또는 선택구절+주제→모아보기→원문구간→새로고침→JSON백업/Markdown내보내기→새작업공간복원. stage 임시보관/모음확정 구분. 원문은 textContent 또는 readonly textarea로 표시.

Legacy.listDocuments() → `{legacyDocId,name}[]` (명시 사용자 행동으로 조회). Legacy.open(ref) → 기존 index.html URL 안내/이동; 저장과 클라우드 쓰기 없음. 원래 문서 선택을 바꾸는 자동 localStorage 쓰기도 하지 않는다.

## 검증과 후속

의미있는 core 회귀: UTF-16·잘린본문·위험URL·중복/새버전·불변원문·잘못된백업/참조·사본ID분리. storage 실제브라우저: tx중단·재시도·두탭경합·stage변경·영수증·복원. 기존 check/test 유지하고 실제 화면·콘솔·PWA 오프라인까지 확인한다.
완료 증거와 미구현 범위는 [구현 기록](r1-implementation.md)에 남긴다. 자동AI·API연동·원문삭제전파·새원격동기화는 구현했다고 표시하지 않는다. R1 뒤 여러 기기를 위한 R3을 분야 확장보다 먼저 다룬다.
