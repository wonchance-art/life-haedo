# 자료 검토 → 회고 → 목차 구성 보존 검토

확인일: 2026-10-09 KST. 대상: `codex/reflection-to-outline`의 실제 `renderReflection`/`bookPlanner`와 기존 순수 helper·회귀 검사. 읽기 전용 코드 검토이며 이 문서만 작성했다. 기존 테스트의 보존 계약을 읽었으며 이번 검토에서 브라우저나 회귀를 재실행한 것은 아니다. Local PR55·운영 자료·SQL·배포는 다루지 않았다.

## 현재 흐름과 최소 개선

| 현재 경로/막힘 | 최소 개선 | 반드시 보존할 조건 |
| --- | --- | --- |
| 기록 선택 → 회고 담기 → 별도 원문 선택기·연도/묶음·요약·목차/묶기 조작 → 선택 본문 → 내 회고. 자료 읽기와 현재 생각 사이에 여러 조작이 쌓인다. | 읽는 자료와 현재 회고를 중심에 두고 선택 변경·기간·요약은 접힌 보조 조작으로 정리한다. 목차 연결은 하나의 명시 행동으로 유지한다. | 선택/필터/회고 원고를 서로 다른 값으로 유지한다. 숨김은 선택 해제·삭제가 아니다. 입력 중 `#wbReflectionNote`의 DOM/value를 다시 만들지 않는다. |
| 목차 구성 화면은 별도 session draft. 연도/묶음 후보를 전환해도 이전 후보 제목·포함 선택을 유지한다. | 같은 원고 중심 프레임에서 후보와 제목 편집을 보여주되 회고로 돌아가는 조작을 남긴다. | 회고로 돌아갔다 재진입해도 후보 범위·이름·포함 선택을 자동 갱신하지 않는다. 명시 refresh+확인만 기존 후보를 교체한다. |
| 회고 sourceRow에는 `reflection:<group>:<version>` 복귀 키가 있다. 목차의 `sourceRow(id)`에는 키가 없고, 출처 목록은 펼칠 때 40개씩 새로 만든다. 원문 복귀는 화면 heading으로 초점이 돌아갈 수 있다. | 목차 출처에도 분류/후보/exact version별 안정적인 focusKey를 주고, 펼침과 표시 수를 session에 보관한다. | 키가 다른 후보/계정/공간에 재사용되지 않아야 한다. 원문 왕복은 미저장 회고 flush 후에만 진행한다. 표시 수 40은 전체 후보 참조를 자르는 제한이 아니다. |

## 데이터·날짜·선택 계약

- 원문은 `sourceVersions.id` 그대로다. 같은 출처의 최신 버전으로 치환하지 않는다. 제목은 현재 Source 제목이고 본문/작성자/원문 작성일/확보 범위는 선택한 불변 버전이다.
- `reflection.versionIds`와 `reflection.note`만 영속 회고다. `reflectionView={mode,from,to,shown}`와 `bookPlan`은 화면 session이다. 기간 프로젝트·나이·경험 시기·진행률을 저장하거나 추정하지 않는다.
- 날짜는 `Reflection.year`가 인정하는 실제 YYYY/YYYY-MM/YYYY-MM-DD/ISO 작성일에서만 분류한다. 수집일 fallback 금지. 같은 연도 안은 선택순이다. 따라서 정밀 시간순이라고 표시하지 않는다.
- `Reflection.chronology`는 범위를 포함 경계로 적용하고 unknown/누락 참조는 계속 남긴다. 빈 해를 만들지 않는다. 잘못되거나 역전된 범위는 적용 전 거절한다.
- 기간은 표시/후보 범위다. 범위 밖 reflection 선택을 삭제하지 않는다. 회고 Markdown은 보기 기간과 무관한 선택 전체다. 본문은 체크한 경우에만 포함한다.
- 묶음은 `Reflection.themes`의 exact 교집합이다. 겹친 버전은 여러 묶음/장에 들어갈 수 있다. 미분류 버전은 ungrouped에 남고 발췌 주제와 합치지 않는다. 타인/작성자 미상/부분/본문 미확보/누락을 숨기지 않는다.
- 원문 본문은 평문(textContent/pre)으로 표시한다. 본문 펼침·현재 회고 질문 append·출처 관리·책 생성은 별개 행동이다. 질문을 펼친 것만으로 원고가 수정되지 않는다.

## 저장·실패·늦은 응답

1. 회고 담기는 copy+validate → dirty → 실제 구성 저장 성공 후에만 기록 선택을 소비한다. 첫 실패 뒤 retry에도 이 순서를 유지한다.
2. 목차 진입/묶기/원문 열기/Markdown은 현재 회고 flush 성공 뒤 진행한다. 조합 입력 중 목차 진입/후보 재생성/책 만들기/질문 append는 차단한다. 화면 재배치 때문에 조합 중 입력을 제거하지 않는다.
3. 후보는 처음 들어간 당시 versionIds/from/to snapshot이고 연도/묶음 choices는 분리된다. 범위를 바꾼 뒤 돌아왔다고 후보를 암묵 갱신하면 작성한 장 제목·포함 선택이 손실된다.
4. 책 생성은 회고 flush → `Books.fromOutline`의 detached 전체 validation → session.state 교체 → 같은 CAS 저장 → books 이동이다. 장 note는 빈 문자열이며 회고를 복제하거나 자동 해석하지 않는다. 3~5장은 권장이지 강제 저장 제한이 아니다.
5. 새 책 상태를 만든 뒤 저장 실패하면 `draft.createdBookId`와 dirty state를 유지한다. retry는 같은 책을 저장한다. 실패를 숨기거나 후보를 초기화하거나 두 번째 책을 만들지 않는다. 이미 만든 후보의 제목/포함 변경을 막는 현행 경계도 유지한다.
6. CAS 충돌은 비교·초안 JSON·명시 적용 경로로 복구한다. 오래된 저장본 읽기 버튼이 이후 입력을 덮지 않게 클릭 시 dirty/saving/composing을 다시 검사한다.
7. 비동기 동작 시작 시 session/generation을 캡처하고 await 이후 `showing(token,session)`을 확인한다. 계정 폐기/작업공간 이동/다른 화면 전환 뒤 늦은 저장·조회가 화면·초점·목적지를 바꾸면 안 된다. 구독/타이머/observer도 기존 dispose 경로를 유지한다.
8. source return은 workspace/mode 검사 뒤 안정 키로 초점을 복원한다. 원문 왕복 후 필터/선택/메모/목차 choices는 유지한다. 새 화면의 heading을 옛 요청이 덮거나 늦은 rAF가 다른 계정/작업공간을 스크롤하면 안 된다.

## 기존 DOM·검사 계약

| 보존 대상 | 기존 검사와 핵심 의미 |
| --- | --- |
| `#wbReflectionTime/Themes/From/To/ApplyPeriod`, `[data-reflection-group]`, `#wbReflectionReading/Summary/More` | `tests/reflection-reading-browser.cjs`: 세 폭의 exact old/unknown/기간/묶음/40개 표시와 원문 왕복 초점. 기간 밖 선택 유지·reload 시 기간 초기화. |
| `#wbReflectionNote`, 질문 append, `#wbReflectionIncludeSources/Export` | 같은 검사: 질문 열기 무변경, 명시 append/caret 끝, 저장 실패 시 원문 열기·다운로드 차단, 원고 유지, retry와 통합 백업 새 사본 복원. |
| `#wbReflectionPlan/Group`, `#wbPlanTitle/Question/Time/Themes/ChapterN/Chapters/Summary/Create/Close/Refresh` | `tests/book-workshop-browser.cjs`: 실제 가져오기→회고·묶음 왕복→목차→빈 장→개정/정확 원문/MD/PDF/JSON. 시간/묶음 후보 전환과 close 후 후보 보존, 기간 변경에도 기존 snapshot 유지, 실패/반복 클릭 한 책만 생성. |
| 회고 담기·CAS 비교·지연된 책 생성 | `tests/book-workshop-recovery-browser.cjs`: 첫 저장 실패는 선택 미소비, retry 후 소비; conflict 초안 exact 버전 유지; 늦은 성공 이후 계정 전환에서 옛 책으로 자동 이동/노출 금지. |
| 선택→회고/묶음 왕복과 source coordinate | `tests/record-arrange-browser.cjs`: 고른 fixed versions·발췌 UTF-16·취소 무변경·100개 한도·저장 실패·다른 공간/계정·한글 조합. |
| pure helper | `tests/life-reflection.test.cjs`, `tests/book-workshop.test.cjs`: 실제달력/unknown/범위/겹침/누락; detached 생성·전역 ID·전체 byte budget 원자 거절; 메타 안전 fence와 본문 opt-in. |

## 이번 통합 후 필요한 집중 확인

- 390/820/1440에서 이전 버전+타인+자유 날짜+link-only+missing을 선택해 읽기→회고 작성→묶음 보기→목차 생성이 원문 재선택 없이 이어지는지.
- 원문 왕복 후 회고 textarea/커서·period·묶음·목차 후보 제목/포함/펼침/40개 이후 항목 초점이 유지되는지. 새 목차 focusKey가 있으면 그 exact row를 확인한다.
- 조합 입력 중 보기 전환/목차 close·전환이 DOM 재생성으로 입력을 유실하지 않는지. 기존 guard 없는 후보 분류 전환/회고 close는 개선 시 주의할 지점이며 이번 읽기만으로 실기 결함을 확정하지 않았다.
- abort 저장·CAS 충돌·지연 응답으로 회고/후보 유지, 한 책 ID retry, 선택 미소비/성공 뒤 소비, 계정/공간 전환 후 stale UI 차단을 기존 assertions 그대로 확인한다.
- 필터 밖 자료까지 포함하는 회고 Markdown과 명시 후보 범위로만 만든 장을 구분한다. JSON 새 사본 exact remap 및 기존 source bundle 무변경을 유지한다.

새 schema/의존성/SQL/AI/자동 공개가 필요하지 않다. 이번 단계는 기존 영속 회고와 검증된 책 생성 사이의 배치·초점·왕복을 연결하는 범위다. 개인 사용 평가·Apple 실제 IME·기기 파일 저장·배포 검증은 별도이며 이 문서에서 통과를 주장하지 않는다.

## 실제 적용 diff 후속 검토

2026-10-09 KST, `workbench-ui.js`의 회고/목차 부분 + `ui.js` heading + `workbench.css`를 정적으로 대조했다. 이번 검토는 테스트 실행이나 실제 Apple 기기 조작을 포함하지 않는다.

- `openSources`, `noteReturn`, `planPosition`은 `session.reflectionView` 아래, `sourceViews`는 `session.bookPlan` 아래에만 있다. `fromOutline`에는 title/question/선택한 chapters의 title/versionIds만 명시 전달하므로 새 보기 상태가 구성 저장·SQL·JSON 백업·동기화·공개 범위에 섞이지 않는다.
- sourceViews 키는 `by:item.key`, source 복귀 키는 `book-plan:by:item.key:exactId`로 분류/후보/버전이 분리된다. 열린 상태·보여준 40개 이상을 재생성하며 부모 details를 열어 exact 복귀 초점을 찾는 기존 `ui.returnToResults`를 재사용한다. 명시 후보 refresh 때만 sourceViews를 비운다.
- 회고 lazy 본문은 exact 버전 raw의 pre 평문이다. 기본 260 codepoint 도입부는 표시용 파생 문자열이며 저장 원문·locator를 바꾸지 않는다. partial/link-only/other/unknown/작성일·누락 설명은 기존 sourceRow/meta 경로다.
- 연도/묶음/기간/더보기는 selectedList만 다시 채운다. 회고 textarea는 같은 DOM으로 남고 autogrow는 height만 바꾼다. 입력 value/caret를 되쓰지 않고 scrollY를 보존한다. resize는 폭 변화만 처리하며 observer 해제·늦은 fonts ready showing/connected guard가 있다.
- 목차 mode 전환·close에 IME guard가 추가됐고 기존 진입/refresh/create guard는 유지된다. 같은 연도 선택순·unknown 포함·범위 밖 선택 유지·회고 Markdown 전체선택·본문 opt-in·빈 장 생성·createdBookId retry 순서는 변경되지 않았다.
- 기존 `#wbReflection*`/`#wbPlan*`, data-reflection-group/data-version-id/data-plan-key 및 source exact 참조는 유지된다. 저장 상태/live status/error·초안 JSON·CAS 비교는 제거되지 않고 아래 storageLine/위 error 영역으로 옮겼다. 새 heading은 보조 중복을 숨기며 회고 제목 자체는 공용 heading에 남긴다.

### 전달한 잔여 경계

목차 sourceRow에는 focusKey가 추가됐지만 local `isCurrent`는 없다. `openVersion`의 await flush 이후 generation/session/workspace 검사는 계정·공간·외부 화면 전환을 차단하지만, 같은 화면의 fill/redraw는 generation을 증가시키지 않는다. 원문 클릭의 저장 응답을 보류한 동안 목차 분류를 바꾸거나 회고 close를 누르면 제거된 row의 늦은 원문 열기가 이어질 수 있는 정적 경로다. sourceRow 호출에 해당 row 연결 여부를 검사하는 `isCurrent`를 주면 목적이 사라진 요청을 작게 차단한다. 실제 주입 재현 전이므로 발생 빈도·실기 결함을 확정하지 않는다. root에 위치와 경로를 전달했고 앱은 수정하지 않았다.

그 외 이번 diff에서 원문/구성 스키마·저장 실패 복구·정확 버전·출력 포함 범위를 바꾸는 결함은 발견하지 않았다. 펼침 toggle 이벤트의 빠른 연속 조작, focus/scroll 복귀와 세 화면 폭의 실제 결과는 별도 QA 결과로 판정한다.

후속: root가 목차 sourceRow에 `isCurrent: () => row.isConnected`를 추가한 것을 정적으로 확인했다. 따라서 원문 열기의 flush 완료 시 이미 제거된 후보 행이면 진행을 취소한다. 후보 입력은 임시값이고 목차 진입 전 flush가 끝나므로 사용자 실조작으로 저장 대기를 만드는 경로는 미확인이다. 이는 비동기 취소 예방 보완이며 실제 지연 저장 재현이나 실기 결함 해결을 주장하지 않는다.
