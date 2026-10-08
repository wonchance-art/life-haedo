# 책 화면 A안 적용 — 보존 계약과 회귀 맵

2026-10-08. 이번 범위는 책 목록·장 집필·전체 읽기의 관리 조작 재배치, 큰 책 제목 축소, 원고 textarea 높이 조절과 목록의 읽기 진입이다. 새 저장 모델·원문 버전·SQL·출력 형식을 만들지 않는다. 이 문서는 기존 구현과 테스트를 읽은 독립 보존 검토이며, 새 화면의 검증 결과를 대신하지 않는다. 운영 코드는 이 담당자가 수정하지 않는다.

## 공통 실행 경계

`WorkbenchUI.create`는 계정 범위 Storage와 `getBundle`을 받는다. `workspaceIs`는 살아 있는 UI와 현재 workspaceId, `showing`은 render generation·current session·visible을 함께 확인한다. `renderBooks`의 `active`는 추가로 `bookView.renderId`까지 확인한다. 화면 조작 재배치는 이 클로저를 새 전역 상태 검사로 대체하지 않는다.

- `transition`: IME 입력 중이면 거절 → `flush()` 성공 → `active()` 확인 → session view 변경/`redraw()` → 정확한 대상의 focus/scroll. 저장 실패·CAS 충돌에서는 기존 textarea와 원고를 남기고 이동·읽기·다운로드를 실행하지 않는다.
- `field`: `input.value`는 생성할 때 한 번 설정한다. 사용자 input에서 원값을 모델에 옮기고 edit tick을 올린다. compositionstart/end/blur와 session.composing, 650ms 저장 예약을 유지한다. 저장 응답은 revision·stored tick만 바꾸고 현재 초안 객체·편집 control의 정체성을 유지한다.
- `historyChange`: 현재 변경 flush → active 확인 → 순수 BookHistory의 detached validated state → live state 교체/mark → flush. 보관·복구·개정본 용량 거절이 원고 일부를 바꾸는 작업이 되지 않는다.
- 새 rAF/ResizeObserver/높이 계산은 현재 generation·session·node.isConnected를 확인하며 leave/dispose 이후 취소한다. 화면·계정 전환이 늦은 저장/읽기/폰트 준비 응답으로 돌아오지 않는다.

## 화면별 DOM·동작 맵

식별자는 내부 사용자 흐름과 회귀 검사의 연결점이다. 글자 크기·배치·class 추가는 가능하지만 아래의 ID/데이터 의미를 대체 없이 없애지 않는다. 접근 가능한 이름을 바꾸면 해당 테스트를 실제 새 동작으로 갱신하되 본문·범위 assertions는 유지한다.

| 영역 | 보존할 식별자·의미 | 조작·내용 계약 | 주요 기존 검사 |
| --- | --- | --- | --- |
| 책 목록 | `#wbBookList`, 행의 `data-book-id`, 목차 버튼 `data-chapter-id`, `#wbBooksBack` | 현재 공간의 active books만 기본 목록. 제목으로 다른 책을 추정하지 않고 exact ID로 연다. 특정 장 선택은 해당 부모 책의 non-archived 장만 편집. | [book-projects](../../tests/book-projects-browser.cjs), [book-completion](../../tests/book-completion-browser.cjs), [book-restore-entry](../../tests/book-restore-entry-browser.cjs) |
| 책 생성/설정 | `#wbBookCreateBox`, `#wbBookCreateTitle`, `#wbBookCreate`, `#wbBookFromReflection`, `#wbBookPlanStart`; `#wbBookTitle`, `#wbBookFromYear`, `#wbBookToYear`, `#wbBookQuestion` | 빈 제목 생성 거절. 회고 복사는 원본 reflection 유지. from/to는 메타데이터이며 자동 원문 필터가 아니다. 설정 이동은 저장 값을 바꾸지 않는다. | book-projects, [book-workshop](../../tests/book-workshop-browser.cjs), [book-workshop-recovery](../../tests/book-workshop-recovery-browser.cjs) |
| 현재 책 맥락 | `#wbBookHeading`와 tabindex, `#wbBookPreviewOpen` / `#wbBookPreviewReturn`, `#wbBookEditionOpen` | 큰 제목을 줄여도 현재 책 이름·focus 대상은 남긴다. 책/장 읽기와 편집 전환은 임시 view이며 저장 스키마에 넣지 않는다. | book-projects, [book-preview](../../tests/book-preview-browser.cjs), book-completion |
| 목차·장 생성/순서 | `#wbBookOutline`, `#wbBookOutlineHeading`, 행의 `data-chapter-id`, `.wb-chapter-open[aria-current]`, `#wbChapterCreateTitle`, `#wbChapterCreate` | active 장 순서 그대로. 위/아래 이동은 현재 active 이웃과 바꾸며 archived 장을 삭제하지 않는다. 장 선택·새 장 생성은 저장/IME guard 후 정확한 장에 초점. | book-projects, [book-history](../../tests/book-history-browser.cjs) |
| 장 집필 | `.wb-book-editor[data-active-chapter-id]`, `#wbChapterTitle`, `#wbChapterNote`, `#wbChapterLength`, `#wbChapterPrevious`, `#wbChapterNext` | textarea의 value·DOM 정체성·selectionStart/End/Direction·scrollTop/Left와 IME 유지. title/note 원값, UTF-16 maxLength/길이 표시 유지. 다른 장/읽기 전환에 flush 우선. | book-projects, book-preview, book-completion, [book-import](../../tests/book-import-browser.cjs) |
| 장 근거/원문 왕복 | `#wbChapterEvidence`, `#wbChapterSources`, `data-version-id`, 원문 열기 `data-focus-key` | exact version·본문 확보 범위·작성자 관계·이전 버전·누락 표시 유지. 없는 버전을 최신으로 대체하지 않는다. 원문 열기 전 flush/active; 돌아오면 정확한 조작과 원고 위치로 복귀. | book-projects, book-preview, book-import, book-completion |
| 자료 가져오기 연결 | `#wbChapterImport`, `#wbChapterImportReview`, `#wbChapterImportHeading`, `#wbChapterImportApply`, `#wbChapterImportCancel`, 후보 checkbox `data-version-id`; UI의 `#lifeChapterImportReturn` | 자료 보관과 장 연결은 분리. 후보 기본 미선택, 명시 union만 저장. accepted 저장 실패는 reviewer/dirty 연결 유지하고 취소로 버리지 않는다. archived/wrongworkspace/계정 변경은 다른 장 자동 연결 금지. | book-import, [book-import-recovery](../../tests/book-import-recovery-browser.cjs) |
| 장별 해석 | `#wbChapterInsights`, `#wbInsightCreate`, `#wbInsightStatement`, `#wbInsightUncertainty`, `#wbInsightSupport`, `#wbInsightCounter`, 각 `Rows`, `#wbInsightExclude`, `#wbInsightExcluded`, 행의 `data-insight-id` | 장근거와 support/counter refs는 독립. 빈 해석은 저장된 초안. excluded는 보관·백업에 남고 읽기/Markdown/출력에서 제외. 역할·불확실성·사용자 원고를 자동 합치지 않는다. | [book-insights](../../tests/book-insights-browser.cjs), book-preview, book-history |
| 전체 읽기 | `#wbBookPreview[aria-label]`, `#wbBookPreviewOutline`, `[data-preview-chapter-id]`, `[data-preview-edit]`, `#wbBookPreviewBack`; `[data-read-anchor]`, `[data-read-detail]`, 원문 `data-focus-key` | 같은 Books.project의 chapter order/active insights/evidence 사용. 원고 raw CRLF·emoji·악성문자 평문 유지. 정확한 장 편집으로 이동하고 읽던 문단·펼친 근거·focus 복원. | book-preview, book-workshop, book-completion |
| 읽기/Markdown 옵션 | `#wbBookPreviewOptions`, `#wbBookPreviewIncludeSources`, `#wbBookPreviewExport`; 편집의 `#wbBookIncludeSources`, `#wbBookExport` | 기본 source body 제외. 편집/읽기에서는 같은 view.includeSources 사용, 새 scope/reload는 false. Markdown은 flush 성공 후 해당 책 ID의 동일 선택 범위. 다른 책/제외/보관 데이터는 포함하지 않는다. | book-preview, book-projects, book-insights, book-workshop |
| 개정본·보관 | `#wbBookEditions`, `#wbBookEditionsHeading`, `#wbEditionLabel`, `#wbEditionCapture`, `data-edition-id`; `#wbBookArchive`, `#wbChapterArchive`, `#wbArchivedBooks`, `#wbArchivedChapters`, `data-book-restore`, `data-chapter-restore` | snapshot immutable, archive 비파괴. restore는 현재 원고 사전 snapshot을 한 슬롯에 보관하고 용량 부족이면 전체 거절. snapshot archived/excluded/refs 보존. 관리 이동은 active 책/장 선택을 추정하지 않는다. | book-history, book-insights, book-restore-entry |
| 독자용 책자 | `#wbBookEdition`, `#wbEditionHeading`, `#wbEditionSettings`, `#wbEditionPaper`, `#wbEditionInsights`, `#wbEditionSources`, `#wbEditionEditing`, `#wbEditionEditChapter`, `#wbEditionEdit`, `#wbEditionBack`; `#wbEditionPreview`, `#wbEditionStatus`, `#wbEditionHTML`, `#wbEditionPrint`, `#wbEditionRetry` | A5/A4·원문/해석 독립 opt-in. HTML 미리보기/다운로드/print 동일 문서. 준비 전 조작 disable, 실패 clear+retry. Blob iframe/URL revoke·same-document 목차·sequence/account 취소 유지. | [book-edition](../../tests/book-edition-browser.cjs), book-completion, book-restore-entry |
| 저장 오류·비교 | `#wbStatus[data-state]`, `#wbError`, `.wb-conflict`, `#wbReloadSaved` | 실패 때 textarea/dirty draft 유지. 명시 비교는 양쪽 실제 원고·책/해석/개정본 내용 유지. 다운로드·전환은 실패한 원고를 저장됐다고 실행하지 않는다. | book-projects, book-preview, book-workshop-recovery, book-import-recovery |
| 통합 백업/복원 | `#wbBackupDownload`, `#wbRestoreFile`, `#wbRestoreBookSummary`, `#wbRestoreInstall`; `#lifeRestoreResult` | snapshot bundle+workbench 원자 읽기/새 공간 설치. 모든 ID와 exact refs·공유 missing gap 재매핑. 새 복원 책 목록으로 진입, books 없는 old v1 fallback 유지. 설치 성공 후 조회 실패에 install 재시도 제공 금지. | book-projects, book-history, book-insights, book-restore-entry |

## 읽기 위치와 자동 높이 조절

현재 읽기 위치는 화면 session 안의 `readPosition={key,text,chapterId,top}`, 열린 근거의 `readOpen`, 편집기의 `editorPosition={chapterId,start,end,direction?,top,left?}`다. 기록용 ReadingPosition 저장소나 원문 bundle에 합치지 않는다.

`renderBookReading`은 실제 선택한 projection을 읽고 텍스트를 newline 단위 span으로 나눈다. CRLF의 `\r`, 빈 줄, 이모지를 그대로 두고 최대 200 span 뒤의 나머지는 하나로 합친다. anchor는 chapter/insight/role/key 조합이며 최신 원문이나 화면 제목으로 대체하지 않는다. 복귀 rAF는 `active()`와 reader.isConnected를 확인한 후 key+동일 text → 같은 장의 동일 text → exact key → 장 제목 순으로 돌아온다. 목록/도구 높이 변경은 이 anchor의 `top` 차이 보정으로 처리하고 단순 scrollY 고정으로 바꾸지 않는다.

textarea autogrow를 추가할 때의 보존 조건:

1. 사용자 입력은 원본 textarea에 남기고 style.height만 바꾼다. `.value` 재대입, trim/개행 정규화, innerHTML, input DOM 교체를 하지 않는다. input마다 redraw하지 않는다.
2. IME 중에도 높이 조절이 composition state·autosave guard를 해제하지 않도록 한다. 레이아웃 측정이 초점을 이동하거나 textarea를 재부모화하지 않는다.
3. 숨겨진 `<details>`/폭 0일 때 scrollHeight 값으로 높이를 확정하지 않는다. 현재 렌더의 연결된 visible input에서 측정하고, 초기 rAF·폰트 준비·폭 변경의 늦은 응답은 guard/cleanup한다.
4. 높이가 커지면 과거 내부 scrollTop과 실제 페이지 위치가 서로 달라진다. 읽기 → 같은 장 편집 → 읽던 곳, 원문 왕복, 가져오기 reviewer → 원고 복귀에서 caret과 보이는 위치가 함께 유지되는지 검사한다. 과거 테스트의 내부 scrollTop assertion을 삭제해 의미를 없애지 말고 새 실제 읽기 위치도 확인한다.
5. 인쇄 iframe·출력 CSS나 Books.project 선택 범위를 textarea 크기와 연결하지 않는다. 저장 maxLength·2MiB 검증은 그대로며, 화면 길이를 제한하려고 본문을 잘라 저장하지 않는다.

## 실제 목록 진입과 검사 의미

root 실제 적용은 기존 `책 열기` 아이콘의 **편집 진입을 보존**하고, 책 제목 버튼과 `전체 읽기` 버튼을 추가해 읽기 진입을 구분한다. `book-projects-browser.cjs`의 `openBook` helper는 목록의 `책 열기` 뒤 `#wbBooksBack`만 기다리고 반환하며 이후 호출부가 편집기를 사용한다. 이 기존 helper의 의미를 읽기로 바꿀 필요가 없다. 새 제목/전체 읽기 검사는 실제 읽기 진입과 `원고 편집` 복귀를 따로 확인한다. 버튼 재배치 때문에 원고·정확ID 검사를 제거하지 않는다.

- 목록 목차의 특정 장, 홈의 특정 장, 가져오기 return target은 정확한 장 편집을 유지한다. 제목/전체 읽기는 해당 책의 exact ID로 들어가며 원문이나 영속 chapter selection을 새로 저장하지 않는다.
- `bookView`의 reading/edition/includeSources/caret/anchor는 scope별 임시 값이다. 목록에서 새 책을 열 때 지난 다른 책의 옵션과 위치가 누출되지 않는다. 단 같은 책의 명시 읽던 곳 복귀는 남긴다.
- `#wbBookHeading`는 작은 맥락 제목으로 남아 복원 receipt의 집필 화면 삽입 방지와 초점 경로를 유지한다. 큰 장 제목은 textarea로 감싸되 같은 ID·label·maxLength와 단일 행 값 의미를 유지한다.
- 관리 `<details>`가 새 위치/이름으로 바뀌면 검사 helper가 실제 명시 조작을 통해 열도록 수정한다. 숨은 input을 evaluate로 강제 조작해 테스트를 통과시키지 않는다.

## 우선 검증 범위

기존 전체 테스트 수를 목표로 삼지 않고 다음 보존 경계의 기존 검사를 재사용한다. 새 시각 검사는 독립 QA 담당자가 수행한다.

1. **집필 입력/읽기 왕복:** book-preview의 1440·820·390 흐름(장 선택 → 수정 → 읽던 곳 복귀 → 정확 원문 왕복 → 동일범위 Markdown)과 실패/충돌·늦은 저장/계정 전환. 새 높이 조절에서 DOM identity/caret/한국어 composition을 추가 확인한다.
2. **관리 접근/비파괴 보관:** book-history의 개정본 A→B→restore→자동 현재 snapshot, 10칸/2MiB 전체 거절, archived 책/장 복구. source body·reflection·타인/누락 refs가 변하지 않는다.
3. **복원 출발:** book-restore-entry의 실제 파일 설치 → 정확한 새 책 ID 목록 → 명시 장 선택/읽기·집필·출력, archived-only/old v1, install failure·postcommit read failure·늦은 화면/계정 응답.
4. **출력 독립:** book-edition의 A5/A4 HTML/PDF, 전체 원고/출처부록/목차 links, 원문/해석 각각 opt-in, excluded/archived/다른 책 빠짐, print 준비 지연/cleanup. 새 화면 배치가 출력 HTML을 바꾸지 않는다.
5. **장 가져오기:** book-import/recovery의 기존 정확 버전·기본 미선택·CAS retry·취소·보관된 대상 fallback·원문 저장 후 읽기 실패. UI 재배치로 후보와 일반 picker를 동시에 보여주지 않는다.

## 독립 diff 검토 기록 — 실제 A안 변경 확인

2026-10-08 root의 `workbench-ui.js`/`workbench.css` 실제 diff를 읽었다. 기존 편집 진입은 보존하고 책 제목/전체 읽기 진입을 구분했다. 관리/출력 조작은 원고 뒤로 이동하며 상단 버튼에서 명시 접근하고, 목차는 상단에서 연다. exact ID·원문 연결·Books.project/markdown/print 호출과 역할별 provenance는 그대로다. Workbench/Books/Storage/BookHistory/BookPrint 저장·출력 모델 파일의 diff는 없었다.

| 확인 항목 | 독립 검토 결과와 실제 근거 |
| --- | --- |
| field 일반 영향 | `wrapTitle=false` 기본으로 다른 field 경로 유지. 현재 장 제목만 textarea로 시각적 줄바꿈, Enter/beforeinput 차단과 CR/LF 정규화는 WritingUI의 기존 단일 행 제목과 같은 방식. 일반 원고는 정규화하지 않는다. |
| IME·늦은 제목 이벤트 | 최초 finish의 새 change 호출에 stale guard가 없음을 전달했고, root가 `showing(token,session) && !installing`을 추가했다. composition 종료 후 제목의 높이 계산도 추가했다. textarea 본문 `.value` 재설정은 없다. |
| 장 이동 초점 | 큰 auto-height editor에 `scrollIntoView(nearest)`를 쓰면 viewport를 둘러싸는 editor에 스크롤하지 않는 것을 최소 Chromium DOM 실험으로 확인했다. root가 `wbChapterNote` 전환에서 editor `start` 정렬+84px scroll-margin을 반영했다. flush/IME/active 순서는 그대로다. |
| auto-height 페이지 점프 | 최소 Chromium151/390px 실험의 기존 height=auto→측정→fullheight에서 pageY 4496→23 점프를 확인했다. root는 측정 전 window scrollX/Y를 캡처해 최종 높이 뒤 복원했다. 늦은 font/ResizeObserver는 active+connected를 검사하고 observer는 cleanup한다. |
| 실제 앱 입력 확인 | 격리 모의 Auth·익명 실제 IDB/화면에서 6,149 UTF-16 글자의 긴 장 원고를 저장한 뒤 끝에서 한 글자를 입력했다. **pageY 9161→9161**, caret 6149→6150, value length 6150, 운영 원격 writes 0을 확인했다. 좁은 Chromium viewport 모사이며 Apple 실기/한글 IME 검사나 전체 회귀 통과는 아니다. |
| 읽기·출력 선택 범위 | 읽기 textBlocks/anchor/provenance와 projection 선택 로직 유지. 책 소개/옵션은 본문 밖으로 이동했지만 원고·질문·기간 원값을 저장 변경하지 않는다. archived/excluded/다른 책의 제외, source/insight opt-in·Blob iframe/print cleanup은 기존 호출 경로를 사용한다. |
| 저장 실패·복구 | 오류 `#wbError[role=alert]`와 `#wbStatus[role=status][aria-live=polite]` 유지. storageLine만 books에서 아래로 이동. transition/historyChange/flush mutation 경로는 바꾸지 않았고 관리 이동은 같은 control을 재배치한다. 최종 실패/CAS/복원/출력 회귀 실행은 root·독립 QA 결과로 별도 판단한다. |

실험 파일: `/tmp/book-design-autogrow-probe.cjs`/`.json`은 최소 DOM geometry, `/tmp/book-design-live-fit-probe.cjs`/`.json`은 root 보완 후 실제 앱의 익명 입력이다. 처음 live 실험은 smooth scroll이 완료되기 전 값을 읽어 pageY=0이었으므로 위치 보존 근거로 쓰지 않았고, `behavior:instant`로 다시 실행한 9161 결과만 사용했다. 임시 실험에 개인정보나 운영 인증을 사용하지 않았다. 앱 파일 수정은 root가 담당했다.

현재 diff에서 원문·저장 모델·exact version·출력 범위를 바꾸는 남은 blocker는 찾지 못했다. 근거/관리 배치의 실제 터치·겹침·초점 왕복과 장별 장문 입력은 독립 시각/기능 QA로 확인한다. 코드 검토를 사용자 체험이나 전체 회귀 통과로 표현하지 않는다.
