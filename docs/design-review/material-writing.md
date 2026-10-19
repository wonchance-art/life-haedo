# 자료에서 내 글 완성·공개·보관까지

2026-10-19 KST. PR102 `c5a5f93` 위의 새 작업. 로컬 구현과 범위별 검수를 마쳤으며 최종 커밋 전체의 원격 CI는 통합 PR의 HEAD/검사 기록을 따른다. 기존 공개 9칸 검수를 이번 기능의 성공으로 사용하지 않는다. main 병합·배포·운영 개인 자료 쓰기는 범위에 포함하지 않는다.

## 목표와 보존 조건

자료 선택·비교 → 비공개 자료 메모/질문 → 글에 담을 문단·개요·명시 인용 → 기존 PhotoPost 초안 → 글/사진 완성·저장·재열기 → 선택 공개·철회 → 완성 글의 근거 포함 파일·새 공간 복원을 한 작업으로 완결한다. 자료 2~3개는 대표 검수 사례이지 제품 고정 한도가 아니다.

기존 SourceReference·BlogEvidence·PhotoPost/Quill·BlogManager/BlogSync·Preservation을 재사용한다. 새 SQL·서버·에디터·AI·diff/드래그 의존성을 만들지 않는다. 비교 자료 전체/개인 메모를 글·공개·파일에 자동 포함하지 않는다. 새 준비 상태는 계정/작업공간별 브라우저 보관이며 기존 구성 동기화·사진 ZIP·근거 ZIP의 새 구성원이 아니다. 근거 ZIP의 대상은 완성해 저장한 글과 그 글이 실제 채택한 근거다.

## 실제 공백과 반대 검토

기존 한 구절 인용으로 새 글 만들기, PhotoPost의 본문·사진 편집, 정확 원문 복귀, 선택 공개·철회와 근거 파일은 완료 기능이다. 새로 필요한 것은 여러 자료의 정확 버전·비공개 메모·질문과 글에 채택할 블록을 함께 보관하고, 한 번 만든 기존 글로 돌아가는 준비 단계다. 작성기·공개 엔진·백업을 별도로 다시 만들지 않는다.

비교 자료가 서로 다른 관점의 글이면 버전 차이처럼 빨강/초록으로 표시하지 않는다. 원문, 개인 자료 메모, 실제 글에 담을 문단과 인용을 구분하며 자동 요약·유사도·AI 판단을 넣지 않는다. 자료 비교를 마쳤다는 이유만으로 그 자료가 글이나 공개본에 들어가지 않는다. 원문이 링크뿐이면 확보하지 않은 본문을 만들어 표시하지 않는다.

대표 완주 사례는 CRLF와 이모지가 있는 옛 버전 A, 다른 관점의 B, 링크만 가진 C다. A/B의 필요한 구절만 직접 채택하고 개인 메모·질문과 자기 문단을 작성한다. 개요 순서를 검토해 기존 PhotoPost로 한 번 옮긴 뒤 사진과 본문을 완성·저장·재열기하고 정확한 옛 원문으로 돌아온다. 완성 글의 명시 선택 공개·갱신·철회 후 근거 파일을 새 공간에 복원한다. C와 채택하지 않은 자료, 질문·자료 메모는 결과 글·공개·근거 파일에서 제외되어야 한다. 근거 파일에는 채택한 구절을 재검증하기 위한 정확 버전의 **전체 본문이 포함될 수 있음**을 기존 안내대로 고지한다.

원래 준비는 로컬이고 완성 글의 서버 보관·공개와 별개다. 글을 만든 뒤 준비를 고쳐도 기존 글을 조용히 덮지 않는다. 같은 인계의 재시도는 같은 글을 열고, 의도한 별도 시도는 명시한 새 준비 사본으로 시작한다. 이 구분이 모호하면 기능을 늘리기보다 명칭·복구 동선을 먼저 고친다.

## Direction contract

THESIS: 자료를 고르고 내 문단으로 전개하는 흐름을 기존 블로그 작성기에 연결한다. 큰 타일 대시보드·새 서식 편집기를 추가하지 않는다.

OWN-WORLD: DESIGN.md의 흰 본문·차콜·Pretendard·teal 조작·44px 타깃과 기존 workbench 필드를 그대로 쓴다. 새 모듈의 CSS만 총괄이 통합한다.

STORY: 제목 검색으로 정확 자료를 고르고, 비교한 뒤 필요한 구절만 개요에 채택한다. 비공개 메모와 글에 담을 문단을 구분하고 명시 미리보기 후 한 번 기존 초안을 만든다.

FIRST VIEWPORT: 기존 선택 자료 페이지의 ‘자료로 글쓰기’ 진입과 저장한 준비 목록. 준비 화면에서는 제목·질문과 자료/개요가 본문을 이룬다. 좁은 폭은 한 열에서 선택 자료를 전환하고 긴 원문은 접어 읽는다. 미리보기·글 이어쓰기와 저장 상태가 찾기 쉬워야 한다.

FORM: 기존 표면 확장, Operate/Read. 엔진이 없는 공식 direct-context fallback이며 새 시각 세계를 선택하거나 엔진 점수를 주장하지 않는다. 자료별 메모는 독립 보관하고, 글에 채택한 블록은 명시 순서의 한 열로 읽는다.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance. 기존 DESIGN.md는 유지하고 실제 완료 검수와 한계를 이 문서에 기록한다.

## 공통 모델·API 계약 — 구현 전 확정

`MaterialWriting` (`assets/life/material-writing.js`):

```js
{format:'life-material-writing-v1',workspaceId,revision,plans:[{
  id,title,question,createdAt,updatedAt,
  materials:[{id,sourceId,sourceVersionId,contentHash,note}],
  blocks:[
    {id,kind:'heading'|'paragraph',text},
    {id,kind:'quote',materialId,reference:SourceReference}
  ],
  output:null|{postId}
}]}
```

20개 준비·준비별 16자료/128블록·실제 근거64개와 기존 PhotoPost 50,000자/5,000ops 한도를 검증하고 넘으면 잘라내지 않는다. 자료 메모 `note`와 질문 `question`은 투영에서 제외한다. 본문에 쓸 생각은 사용자가 `paragraph`에 직접 쓰거나 명시 복사한다. 인용은 SourceReference의 정확 구절로만 만들며 변경하려면 재선택한다. 자료 제거는 채택한 인용이 있으면 먼저 그 인용의 처리를 요구하고 조용히 지우지 않는다.

모델 공개 함수: `empty(workspaceId)`, `create(idFn,now?)`, `validate(state)`, `material(bundle,sourceId,versionId,idFn)`, `resolveMaterial(bundle,material)`, `project(state,planId,idFn)` → `{doc,refs}`. `project`는 기존 BlogEvidence.draft와 PhotoPost.validate를 재사용하며 문단/헤딩과 채택 인용만 순서대로 투영한다. 부수효과·네트워크·저장 없음. 누락/변경된 자료를 최신판으로 치환하지 않는다.

저장 공개 함수: `readMaterialWriting(ws)`, `saveMaterialWriting(ws,state,baseRevision)`, `createMaterialWritingPost(ws,planId,expectedRevision)` → `{postId,revision,planRevision,created}`. 기존 meta에 준비 wrapper를 두고 owner+CAS를 확인한다. 인계는 저장한 최신 준비를 사용해 정확 근거를 현재 bundle과 대조하고 기존 PhotoPost/doc index/evidence/준비 output을 같은 tx로 저장한다. 이미 output이 있으면 같은 글의 현재 revision만 반환하고 새 글을 만들지 않는다. target이 없으면 오류를 표시하고 자동 재생성하지 않는다. 기존 saved 글의 편집 저장으로 ID가 교체될 때 연결도 같은 tx에서 옮긴다. 준비 변경은 인계한 글을 자동 덮지 않는다. 명시 ‘새 준비 사본’은 새 plan ID·output:null이다. 계정별 컬렉션 스코프·기존 BroadcastChannel 방식과 동일한 변경 알림을 사용한다.

총괄 승인 구현 상세: 같은 meta 트랜잭션의 별도 `material-writing-output:${ws}:${planId}` 영수증이 인계 결과를 보존한다. wrapper의 output을 비우거나 삭제한 준비 ID를 재사용해 같은 인계를 새 글 생성으로 바꾸지 않는다. saved 글의 ID 교체는 현재 준비와 남아 있는 과거 영수증의 같은 대상 연결을 함께 옮긴다. 기존 글 재개는 과거 예상 준비 revision이라도 읽기 전용으로 현재 글/revision을 돌려주며 UI는 그 결과와 최신 wrapper를 구분한다.

준비 UI: `MaterialWritingUI.create({storage,workspaceId,getBundle,isCurrent,onDirty,onOpenSource,onOpenPost,onClose})`, `mount(host,{planId?})`, `flush()`, `dirty()`, `detach()`, `dispose()`. 로컬 입력은 기존 workbench와 별도 CAS로 보관한다. 늦은 읽기/저장·IME·충돌·실패 중 입력/초점을 보존하고 이동 전 flush한다. 소스 UI는 아래 계약으로 별도 모듈을 사용하며 UI root에서 변경한 상태만 저장한다.

자료 UI: `MaterialWritingSources.create({host,getBundle,getPlan,isCurrent,onAdd,onRemove,onNote,onQuote,onOpenSource,onPendingChange})`, `mount()`, `refresh()`, `pending()`, `dispose()`. `onAdd(material)`/`onRemove(materialId)`/`onNote(materialId,text)`/`onQuote(materialId,reference)`는 상위 UI가 현재 준비를 변경하는 callback이다. 원문 추가는 제목 검색의 제한된 후보 목록→정확 버전 선택이며 전체 원문을 전부 DOM으로 만들지 않는다. 선택 자료의 read-only 비교/구절 선택과 정확 전문 열기만 맡긴다. `BlogEvidence.create`를 재사용하거나 동일한 rawOffset/SourceReference.build를 사용하되 새 풀 에디터/글로벌 리더를 만들지 않는다. quote callback 전후 계정/준비/선택자료 epoch를 확인하고, 미적용 구절·IME·비동기 선택 중 이동은 막거나 명시 취소한다. 새 자료 후보 취소는 기존 자료·개요를 바꾸지 않는다.

통합은 총괄의 workbench-ui.js 변경으로만 한다. 기존 PhotoPostUI.mount(postId)·onReadBack/onReturn으로 준비↔같은 글을 왕복하고, 원문 전문은 기존 openSource로 연다. 완성 글의 공개 관리는 기존 도구, 근거 파일은 기존 보관 화면을 연결한다. 전역 ui.js/home/search/추천 및 다른 세션 모델 작업은 수정하지 않는다.

## 분담과 실제 검수 상태

모델/단위: zip_validation. storage/단위: atomic_storage. 자료 선택/비교: large_vault_reading. 준비·개요 UI: receive_experience. 저장·공개·파일 실제 통합검사: independent_verification. 제품/시각 독립검수·문서: review_integrity. 총괄: workbench 연결·공통 CSS/자산/CI·최종 검수. 서로 소유한 파일을 수정하지 않는다.

로컬 구현과 아래 범위별 검수 완료. 합성 Auth/격리 SQL/Chromium 화면 모사와 실제 Google/Apple/운영 환경을 구분한다. 최종 HEAD 전체의 원격 CI는 대기 중이며 미검수 항목을 완료로 표시하지 않는다.

### 독립 검수 계획과 완료 판정

종합 UI/SQL 담당의 합성 자료·fixture·보고서를 재사용하고 동일한 전체 흐름을 별도 suite로 중복 작성하지 않는다. 시각·입력 검수는 부족한 상태만 보강한다. 1440/820/390px에서 준비 목록/질문, 자료 선택·비교와 원문, 채택한 개요·미리보기, 기존 글 작성기/결과를 읽는다. 실제 한글·긴 제목/URL·이모지·빈 상태를 사용하고 좁은 폭에서 여러 긴 원문을 억지로 나란히 배치하지 않는다.

초점·선택·스크롤과 한글 조합 중 입력, 미반영 구절, 저장 중 이동, 오류·충돌·재시도의 상태를 구분한다. 글/원문 왕복 뒤 정확한 대상과 입력이 유지되어야 한다. 44px 조작 크기, 입력 16px, 실제 표면 대비, 긴 문자열 줄바꿈과 가로 넘침을 확인한다. 기계 측정과 실제 화면 읽기를 분리해서 기록한다.

기능 완료는 선택부터 글 완성·재열기·정확 근거 왕복·명시 공개/철회·근거 파일 복원까지 동일 후보에서 연결되는 것이다. 실패 시 원본과 입력 보존, 인계 중복 방지와 부분 설치 방지는 종합 저장 검사 근거를 따른다. 시각 통과를 데이터 보존의 증거로 대신하지 않으며 Linux Chromium 화면 모사를 실제 Apple 한글 입력·Files·Google 인증·운영 게시의 통과로 표시하지 않는다. 최종 후보 커밋과 원격 CI 결과는 해당 PR의 HEAD/검사 기록으로 남긴다.

### 오픈소스 선택

2026-10-19 KST(공식 조회 2026-10-18 UTC)에 jsdiff와 SortableJS를 비교했다. 차이 계산·드래그 기반의 새 편집 계층은 이번 요구에 필요하지 않아 직접 도입하지 않는다. 정확 구절은 기존 SourceReference/BlogEvidence, 문단 편집과 순서는 네이티브 입력/위·아래 버튼, 완성 글은 기존 Quill을 재사용한다. 버전·라이선스·보안 권고·조회 한계와 다시 검토할 조건은 [이번 오픈소스 검토](../life-tools-design/open-source-review.md#자료-비교개요에서-기존-글-완성--2026-10-19-kst)를 따른다.

## 구현 중 실제 발견해 고친 경계

- 비교하던 두 번째 자료에 미적용 구절이 있는 채 좁은 폭으로 바꾸면 해당 자료가 숨고 탭 전환도 막혔다. 미완료 자료로 돌아가 명시 취소·교정할 수 있게 했으며, 다른 자료의 구절 선택과 한글 조합이 함께 있을 때는 조합 중인 입력을 우선 노출한다. 원문과 선택 위치를 새 버전으로 바꾸지 않는다.
- 같은 제목의 다른 자료는 테스트의 내부 ID로만 구분할 수 있던 사용성 공백이 있었다. 기존 URL 또는 파일 경로를 후보·선택 자료의 읽기 전용 단서와 접근 가능한 이름으로 표시한다. 전체 원문 검색·자동 본문 확보를 새로 만들지 않는다.
- 자료 구절을 명시 취소해 미리보기가 성공했는데 직전 입력 경고가 저장 실패처럼 남았다. 정상 guard 뒤 일시적인 입력/처리 경고만 정리하고 실제 저장·CAS 실패는 남긴다. 초안 생성 동의 행은 실제 높이 19px에서 44px 이상으로 보강했다.
- 개요의 인용마다 단일 인용 글 작성용 `BlogEvidence.draft`의 빈 생각 자리 `\n\n`까지 반복해서 붙어 결과 글에 큰 빈 공간이 생겼다. 새 개요 투영에서 정확한 자동 마지막 op만 제외한다. 사용자가 적은 문단의 빈 줄과 인용 원문의 CRLF·구절은 보존하며 기존 BlogEvidence는 바꾸지 않는다.
- A 준비의 완성 글을 읽는 중 B 준비를 선택하면 늦은 A 관리/파일 화면이 B 아래 열릴 수 있었다. 각 await 뒤 요청 순서·준비 ID를 재확인하고 열린 활용 화면의 수명을 분리했다. 실제 A 글의 IDB 조회를 지연한 뒤 B 입력을 만든 검사에서 A 도구가 생성되지 않고 B 입력 노드·값이 유지됨을 확인했다.
- 저장 글을 수정한 별도 기존 초안을 닫으면 준비로 돌아가지 않고, 이어쓰기는 옛 저장 글을 열어 미완성 입력이 바로 보이지 않았다. 기존 saved/replaces와 저장 초안을 읽어 같은 초안으로 재개하도록 연결했다. 새 글을 만들거나 저장한 원글을 덮지 않으며 실제 수정 중 본문·글 목록 보존을 독립 검사한다.

처음 시각 suite가 저장 전 기존 편집기에서 저장 후 읽기 화면의 복귀 버튼을 기다린 것은 검수 fixture의 잘못된 상태 가정이었다. 기존 `.photo-commandbar`의 실제 ‘닫기’로 수정해 준비 직복귀를 확인했다. 이를 제품 결함으로 세지 않는다. 기존 Quill 본문 안의 21px 인라인 출처 링크 두 개는 실제 측정값을 별도 기록하고, 폼/툴바/버튼의 44px 조작 기준과 구분한다. 기존 본문 링크를 키우기 위해 작성 내용을 바꾸거나 다른 조작부의 단언을 제외하지 않았다.

## 로컬 검수 결과와 확인 한계

- Node 22.23.3 전체 단위 749/749, 실패/skip 0. 정적 21 HTML/123 JS/524 로컬 참조와 PWA 검사 통과. 로그는 `.local/material-writing/unit-final-complete.log`, `check-final-complete.log`다. 정적 통과를 사용자 흐름·SQL·실기 통과로 대신하지 않는다.
- [종합 UI/격리 SQL 검사](../../tests/material-writing-browser.cjs): 8개 흐름과 1440/390px 10개 화면. 정확한 옛 CRLF/이모지 구절·비공개 준비 재열기·단일 인계, 실제 기존 작성기의 4032×3024/1200×1800 사진 두 장과 saved ID 교체, 한 장만 명시 공개·익명 읽기·철회, 근거 ZIP의 최소 정확 버전과 새 공간 복원의 본문/해시/실제 디코딩 픽셀, 실제 IDB 중단의 부분 설치 0·재시도 1개, 두 탭 CAS·새 준비 사본 복구, 인계 commit 뒤 열기 실패·같은 ID 재개, 해시 확인 중 SDK 계정 전환 차단을 확인했다. `.local/material-writing/report.json`·`browser-final.log`를 따른다. 예상한 철회 사진 404의 콘솔 오류 1건과 예상하지 않은 console/page/external 0을 구분한다. Auth·Storage 바이트/Edge HTTP는 합성이며 RPC/RLS는 네트워크 없는 격리 PostgreSQL이다.
- 미완성 saved 수정 초안의 왕복과 일반 새 글 진입은 각각 strict focused after 검사를 별도로 통과했다(`editing-return-after.json`, `ordinary-after-preparation-report.json`). 일반 글 회귀는 영구 종합 suite에도 넣었다. 종합 전체 실행 중 workbench의 복귀 baseline guard와 동명 자료 단서가 마지막으로 반영되어 두 파일 해시가 실행 중 바뀐 사실을 구분한다. 이 로컬 결과를 **정확한 최종 HEAD 전체 통과**로 쓰지 않는다. 같은 최종 HEAD의 전체 검수는 통합 PR의 원격 CI에서 확인한다.
- [독립 시각·입력 검사](../../tests/material-writing-visual-browser.cjs): 6개 흐름/11개 화면. 1440/820/390px 비교·개요/미리보기·기존 Quill, 820px 오류/인계 복귀, 합성 한글 조합의 같은 입력 노드·caret, 미적용 구절 명시 취소, 잘못된 입력의 이동 거절/교정, 키보드 순서 편집 초점, A의 늦은 실제 IDB 글 조회 뒤 B 선택·입력 보존을 확인했다. `.local/material-writing-visual/report.json`·`.local/material-writing-visual-run.log`는 pass=true, console/page/external/원격 쓰기 0이다. 가로 넘침·이름 누락·작은 폼/조작부·16px 미만 입력·실제 대비 실패 0. 위에 분리한 기존 본문 인라인 링크의 원시 측정은 유지한다.
- [자료 비교 컴포넌트 검사](../../tests/material-writing-sources-browser.cjs): 최종 8개 흐름/1440·820·390px 3개 화면, console/page/external 0. 별도 모델/합성 callback 경계이므로 실제 저장·SQL 완료 근거와 혼동하지 않는다. 정확한 구절/버전·제한된 제목 후보·실패/IME 보존·좁은 폭의 미완료 자료 복귀와 동명 자료 단서를 확인했다. 최종 `.mw-workspace` 래퍼와 실제 CSS를 적용한 화면을 읽어 출처 구분과 390px의 한 자료 읽기를 확인했다. 보고서는 `.local/material-writing-sources/report.json`, 로그는 `.local/material-writing-sources-final.log`다.

준비·미리보기·오류·기존 작성기와 공개/복원 화면을 직접 읽어 기능 검사와 시각 판단을 구분했다. fullPage 화면의 고정 탐색/일부 sticky bar가 긴 문서 중간에 찍히는 부분은 캡처 방식의 한계이며 해당 이미지 하나만으로 실제 겹침 결함이라 판정하지 않았다. 자료 비교의 마지막 출처 단서는 컴포넌트의 최신 3폭 증거로 보완한다. 테스트마다 새로 만든 익명 원문/계정/사진만 사용했으며 격리 DB 정리를 확인했다. 실제 Google 인증, Apple 기기·네이티브 IME·Files, 관리형 Storage/Edge의 개인 업로드/게시, 병합·Pages 배포는 실행하지 않았다. Linux Chromium 151.0.7922.173/PW 1.63 검수를 CI 고정 Chromium 153이나 실기 통과로 표시하지 않는다.

## 다음 큰 제품 목표 후보

**Mac에서 자료·생각을 준비하고 iPad에서 같은 글을 완성하기.** 이번 로컬 준비와 기존 글별 서버 보관 사이에 남는 차이는 완성 전의 선택 자료·질문·개요를 다른 기기에서 이어가는 경험이다. 기존 원문·CAS·글별 보관을 재사용할 수 있는지 먼저 대조하고, 준비 한 개의 명시 연결과 그에 필요한 정확 버전/개인 메모의 전송 범위를 확정한 뒤 설계한다. 전체 계정 백업·모든 준비 자동 업로드·홈/추천 재구현으로 확대하지 않는다.

선행은 현재 PR의 통합/검수, 선택한 준비만 명시 연결하는 계약과 필요한 정확 원문의 전송 동의, 로컬 전용 상태와 이미 전송된 자료의 의미 구분이다. 다른 채팅은 홈/관심/추천과 MODEL-01 한국어 의미모델 검증을 진행 중임을 총괄이 재확인했다. 이를 별도로 구현하지 않는다. 완료 기준은 같은 계정의 기기 A에서 비교/개요를 시작해 B에서 같은 정확 자료와 내 입력으로 마무리하고 A에서 재열기, 두 탭/기기 충돌 양쪽 보존·응답 유실 재확인, 원본 사진과 같은 완성 글의 명시 공개·철회·근거 파일 복원까지다. 실제 Apple/Google/관리형 환경 결과는 기기 접근이 가능한 시점에 모사와 따로 기록한다. 이 후보의 제시는 새 서버 변경·개인 자료 전송·병합·배포를 실행하는 권한이 아니다.
