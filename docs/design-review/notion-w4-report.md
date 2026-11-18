# 노션 방향 W4 자료·뉴스·설정 — 구현 보고 (2026-11-18, 작업자)

- **지시:** 총괄의 11-18 작업 지시서. [구현 계약](notion-visual-contract.md)의 W4(화면별 규칙 › 자료 / 뉴스·설정, 틸 규칙, 공통 부품 규칙, 보존 조건)다.
- **기준:** main `8c3c54f`(haedo-v222). 브랜치 `core4/notion-w4`.
- **하지 않은 것:** 푸시·PR·병합·배포·운영 DB 쓰기, `sw.js` CACHE, `AGENTS.md`·`.agents/`·`.github/workflows`. `haedo-shell.css`·`ui.css`·`home.css`(W1·W2·W5 파일)는 고치지 않았다.
- **Designer 확인이 남은 것:** 뉴스·설정은 시안이 없다. 아래 "옮긴 조작" 표를 총괄이 Designer에게 확인받는다. 구현은 표대로 끝냈고, 다르게 정해지면 각 항목이 따로 되돌릴 수 있는 작은 단위다.

## 바꾼 것

| 파일 | 내용 |
| --- | --- |
| `assets/life/ui.js` | `renderHeader`: 자료 머리 `가져오기` · `통합 검색` · `자료 메뉴(⋯)`(머리의 `기록 선택` 단추를 뺌). 1101px 이상에서 자료 목록·뉴스·설정도 44px 머리줄(경로 + 행동)과 큰 제목 줄. 뉴스 머리에 `뉴스 설정` 자리. `featureMenu`: 자료 목록일 때 첫 묶음 `목록`(`기록 선택`, `폴더 관리`). 자료 행: 날짜·시각을 꼬리표 줄 끝으로, 행 `⋯`(`자료 출처 정보`, `폴더로 이동`). 탭 줄 오른쪽 폴더 선택. 선택 취소 뒤 초점. 설정의 `뉴스 설정` 행이 머리줄 단추를 누름 |
| `assets/life/records-list.js` | `badges(document, values, tail)`: 꼬리표 줄 끝에 날짜·시각. `when()`은 날짜와 시각 사이에 공백 |
| `assets/life/source-folders-ui.js` | `mountList`: 폴더 선택을 받을 자리(`filterHost`), `폴더 관리`는 `openManage()`로 여는 칸(닫기·Esc → `onManageClose`). `assignmentControl`: 행 메뉴에서 여는 양식(`embedded`, `focusReturn`, Esc) |
| `assets/life/records.css`, `source-folders.css` | 검색 칸 44px, 글자 탭(먹색 600 + 2px 먹색 선), 탭 줄 폴더 선택, 행(제목 1줄·발췌 2줄·꼬리표 줄·오른쪽 ⋯), 꼬리표 `#F1F1EF`·12px·모서리 4px, 읽는 중인 행 2px 먹색 테, 떠 있는 메뉴(그림자·8px), 두 번째 표시, 토큰 굵기·모서리 |
| `assets/life/discovery-ui.js` | `뉴스 설정` 단추 하나를 화면 전체가 쓰고(`settingsControl()`), 앱 머리줄이 받아 간다. 받아 가는 쪽이 없으면(옛 셸) 전처럼 탭 줄에 둔다 |
| `assets/life/discovery.css` | 색·굵기·모서리 토큰. 탭·행·아이콘·글자 단추는 먹색·회색. 메뉴·알림 그림자와 8px. 카드 사진 8px. 행 메타 13px `--haedo-meta`. 760px 이하 탭 간격 |
| `assets/life/settings.css` | 좁은 칸의 회색 묶음 카드 → 1px 선 행. 나이 나눔 선택은 글자 탭 모양(라디오 묶음 그대로). 곡선 카드 1px 선·고른 카드 1.5px 먹색 테. 굵기 토큰. 머리 아이콘 두 번째 표시. 1101px 이상 계정 단추를 44px 머리줄에 맞춤 |
| `DESIGN.md` | 뉴스 머리·탭 문장, 자료 목록 문장, 설정 절 |
| 검사 | 아래 "바꾼 단언" |

`settings-ui.js`는 고치지 않았다(모양만 바꿨다).

## 옮긴 조작 — 지금 자리 → 새 자리 → 초점

| 조작(이름·id 그대로) | 지금 자리 | 새 자리 | 실행 뒤 초점 | Esc 뒤 초점 |
| --- | --- | --- | --- | --- |
| `기록 선택` `#lifeSelectionToggle`(`aria-pressed` 유지) | 자료 머리줄 아이콘 단추 | `자료 메뉴(⋯)` › `목록` › `기록 선택` | 메뉴가 닫히고 `⋯`(`#lifeRecordsMenu > summary`) | 열린 메뉴에서 Esc: `⋯` |
| `선택 취소`(선택 막대) | 그대로 | 그대로 | 전에는 머리의 `기록 선택` → 지금은 `⋯` | — |
| `폴더 관리` | 검색 칸 아래 접힌 줄(`details` 요약) | `자료 메뉴(⋯)` › `목록` › `폴더 관리` `#lifeFolderManageOpen`. 누르면 검색 칸 아래 `폴더 관리` 칸 `#lifeFolderManage`가 열린다(내용·id 그대로, 오른쪽 위 `폴더 관리 닫기`) | 칸 안의 `편집할 폴더`. 폴더가 아직 없으면 `이름`, 폴더를 읽거나 보관하는 중이면 `폴더 관리 닫기`(검수 MINOR-1 반영) | 칸 안에서 Esc·`폴더 관리 닫기`: `⋯`. 열린 메뉴에서 Esc: `⋯` |
| 폴더 선택 `#lifeFolderFilter`(이름 그대로) | 검색 칸 아래 한 줄 | 종류 탭 줄 오른쪽 끝 | 선택 상자 그대로 | — |
| `자료 출처 정보 · 〈제목〉` `.life-result-info`(`aria-expanded` 유지) | 행 꼬리표 줄 오른쪽 아이콘 단추 | 행 `⋯`(`자료 동작 · 〈제목〉`) › `자료 출처 정보`. 정보는 전처럼 행 아래에 펼친다 | 그 행의 제목 단추 | 열린 행 메뉴에서 Esc: 제목 단추. 펼친 정보 안에서 Esc: 접고 제목 단추 |
| `폴더로 이동 · 〈제목〉` | 행 꼬리표 줄 오른쪽 폴더 단추 | 행 `⋯` › `폴더로 이동`. 양식은 전처럼 행 아래에 열린다 | 양식의 `이동할 폴더`. `이동`·`취소` 뒤에는 그 자료의 제목 단추 | 양식 안에서 Esc: 닫고 제목 단추 |
| 날짜·시각(조작 아님) | 행 왼쪽 칸 | 꼬리표 줄 끝(`11.18 08:24`, 내용·`<time>` 그대로) | — | — |
| `검색어 지우기` | 검색 칸 안, 늘 보임 | 같은 자리, 글자가 있을 때만 보임 | 그대로(입력칸) | — |
| `뉴스 설정` `#discoveryNewsSettings` | 뉴스 탭 줄 오른쪽 끝(`정렬·필터` 옆) | 앱 머리줄, `통합 검색` 앞(모든 폭). 1100px 이하에서 글을 읽는 동안과 설정 화면이 열린 동안은 전처럼 보이지 않는다 | 뉴스 설정 화면의 `‹`(전과 같다) | 설정 화면의 `‹` 뒤: 머리줄의 `뉴스 설정`(전과 같은 단추) |
| 설정 화면 | — | 옮긴 조작 없음 | — | — |

- `정렬·필터`·담기·`⋯`(읽음·관련 없음·자료에 보관·기사 정보)·좋아요·번역·새 탭은 자리를 옮기지 않았다.
- 선택 막대의 `선택한 자료를 폴더로 이동`은 전처럼 막대 안의 폴더 단추다.
- 머리줄이 배경 갱신으로 다시 그려질 때 `뉴스 설정`에 있던 초점은 같은 단추로 돌아온다(전에는 탭 줄에 있어 영향이 없었다).

## 뉴스 390px 탭 겹침

- 원인: 네 탭(글자 226px) + 아이콘 두 개(88px)는 390px 화면의 350px에 들어가지 않아, 넘치는 `제외한 글`이 끝의 흐림 처리와 겹쳐 `제오`처럼 보였다. 탭 사이를 줄여서는 맞출 수 없었다(남는 폭 36px ÷ 3).
- 고침: `뉴스 설정`을 머리줄로 옮기고, 760px 이하에서 탭 사이를 16px로 줄였다(검수 MINOR-4 반영, 처음에는 20px).
- 단언: `news-card-feed-browser`가 1440·820·390에서 네 탭(`전체 57 · 담은 글 0 · 좋아요 0 · 제외한 글 0`)이 모두 탭 줄 안에 있고 `정렬·필터`와 겹치지 않으며 가운데를 누를 수 있음을 본다. 320px에서는 줄이 옆으로 밀리고 끝이 흐려지며, 밀기와 키보드(End)로 `제외한 글`에 닿는지 본다.
- **"390px에서 모두 보인다"의 조건(실측, 탭 글자 폭 / 탭 줄 폭 / 여유):**

  | 화면 폭 | `전체 57 · 0 · 0 · 0` | `전체 125 · 0 · 0 · 0` | `전체 57 · 담은 글 12 · 좋아요 34 · 0` | `전체 125 · 담은 글 12 · 좋아요 34 · 0` |
  | --- | --- | --- | --- | --- |
  | 430 | 281 / 346 / +65 | +55 | +46 | +37 |
  | 393 | 281 / 309 / +28 | +18 | +9 | 0 (꼭 맞음) |
  | 390 | 281 / 306 / +25 | +15 | +6 | −3 (넘침) |
  | 375 | 281 / 291 / +10 | 0 (꼭 맞음) | −9 (넘침) | −18 (넘침) |
  | 360 | 281 / 276 / −5 (넘침) | −15 | −24 | −33 |
  | 320 | 281 / 236 / −45 (넘침) | −55 | −64 | −73 |

  개수 글자는 화면에서 표본 값으로 바꿔 쟀다(실제 담기·좋아요를 그만큼 만든 것은 아니다). 측정 원본은 scratchpad의 `logs/news-tabs-measure.txt`다.
- 넘칠 때: 탭 줄을 옆으로 밀어 본다(끝 흐림). 반쯤 잘린 탭을 누르거나 키보드로 옮겨도 탭이 줄 안으로 오지 않던 것을 고쳐, 고른 탭은 줄 안으로 들어온다.
- 문구를 `제외`로 줄이면 390px에서 약 30px, 375px에서도 두 자리 개수까지 여유가 생긴다. 문구 판정은 Designer 몫이라 하지 않았다.

## 독립 검수 반영 (`63580b3` 검수: BLOCKER 0, MAJOR 1, MINOR 6, NIT 7)

| 항목 | 고친 것 | 단언과 수정 전 실패 확인 |
| --- | --- | --- |
| MAJOR-1 | `ui.js`의 보호 선택자 `#lifeFolderManage[open]`이 죽어 있었다(칸이 `details`가 아니게 됨). 열린 것을 한 곳(`listHeld`)에서 판단하고 폴더 관리 칸(`:not([hidden])`)·행 폴더 양식·행 정보·행 `⋯` 메뉴를 모두 넣었다 | `account-library-browser` "another device's change does not redraw…": 네 경우에서 열린 요소·입력·목록이 그대로이고 `최신 내용 확인`이 뜬다. 수정 전: 폴더 관리 칸에서 실패. 선택자만 고친 뒤: 행 정보에서 실패(기준판도 행 정보는 보호하지 않았다). 행 메뉴·행 정보를 선택자에서 빼면 실패 |
| MINOR-1 | 폴더 관리를 열면 초점이 `편집할 폴더`(폴더 0개면 `이름`)로 간다. 메뉴 항목의 실행 동안 입력칸이 꺼져 있어 닫기 단추로 떨어졌다. 다음 프레임에 초점을 둔다 | `source-folders-browser`: 둘 중 하나 허용 → 하나로. 폴더 0개일 때 `이름`. 수정 전 4개 검사 모두 실패 |
| MINOR-2 | 자료 메뉴 13개 항목이 1440×900·820×1000·390×844에서 모두 보인다(칸 높이를 화면에 맞추고 묶음 사이를 줄임). 390×844는 Chromium 화면 크기 모사 기준이고 여유가 4px다. 실제 iPhone은 안전 영역만큼 낮아 칸 안 스크롤 + 끝 흐림이 될 수 있다(실기 미확인). 더 낮으면 칸 안에서 밀고 끝을 흐린다. 320px에서 칸이 화면 왼쪽 밖으로 20px 나가던 것을 고쳤다 | `records-news-browser` "자료 메뉴 shows every item…": 다섯 크기. 높이 규칙·위치 규칙·끝 흐림을 각각 지우면 실패 |
| MINOR-3 | 행 제목 단추에는 공통 누름 축소(`transform`)를 쓰지 않는다. `transform`이 걸리면 행 전체로 늘린 `::after`가 단추 크기로 줄어 꼬리표 줄·발췌·여백 누름이 원문을 열지 못했다(기준판 동일) | `records-news-browser`: 실제 마우스(누름 160ms 유지)와 터치로 꼬리표·날짜·발췌·아래 여백·제목 옆·빈 곳을 눌러 원문이 열리고, 행 `⋯`·선택 단추는 열지 않는다. 규칙을 지우면 마우스·터치 둘 다 실패 |
| MINOR-4 | 위 "뉴스 390px 탭 겹침"의 조건 표, 탭 사이 16px, 고른 탭을 줄 안으로 | `news-card-feed-browser` 320px 검사. 고른 탭을 줄 안으로 옮기는 코드를 넣기 전에는 키보드(End) 단계에서 실패 |
| MINOR-5 | (검사만) | `records-news-browser` "검색어 지우기 hides…": 빈 칸에서 숨음, 입력·한글 조합 중 보임, 지운 뒤 초점은 입력칸. 숨김 규칙을 지우면 실패 |
| MINOR-6 | forced-colors에서 사라지는 box-shadow 표시를 outline·테두리로: 열린 `⋯`·검색 필터·정렬·필터의 테, 켜진 `기록 선택`, 폴더 관리 칸 테두리, 설정 행 구분선, 탭 줄 선, 읽는 중인 행 | `records-news-browser` "forced colours keep…"(Chromium `forcedColors: 'active'` 모사). 자료·설정·폴더·뉴스 규칙을 각각 지우면 실패 |
| NIT | `discovery.css` 숫자 굵기 → 토큰. `::selection` 복사본 두 줄을 지워 셸의 규칙 하나를 따른다. 분할 손잡이 호버의 틸 → 보조색 선·먹색 손잡이(초점·끌기 중은 초점색 유지). 폴더 초점 링 → `--haedo-focus` | — |

- **노트 행·뉴스 카드의 같은 결함 여부(MINOR-3, 측정만):** 실제 마우스 누름(160ms 유지)으로 노트 행의 메타 줄·제목 옆·아래 여백, 뉴스 카드의 메타 줄·아래쪽을 눌러 모두 열렸다. 같은 결함이 없다. 자료 읽기 칸의 목록 행은 이번 규칙이 함께 덮는다(따로 재지 않음).
- **`details`에서 다른 요소로 바꾼 것의 선택자 전수 확인:** 아래 "죽은 선택자 확인".
- **잘린 행 제목의 `title`:** 넣지 않았다(접근 이름이 온전하다).
- **미해결 — `account-library-browser`가 한 번 멈춤:** 검수 반영 뒤 첫 전체 재실행에서 둘째 검사(`default A import…`)가 끝나지 않아 약 10분 뒤 손으로 멈췄다(종료 코드 없음). 그 뒤 같은 검사를 8번(검사 하나만 1번, 전체 7번) 돌려 모두 0이었고 재현하지 못했다. 그때의 기록은 scratchpad `logs/F-A-account-library-browser.log`에 남겼다(마지막 줄이 그 검사의 `RUN`). 원인을 모른다. 그 실행과 뒤 실행 사이에 바뀐 것은 자료 메뉴 끝 흐림의 아래 여백 한 줄(`116c460`)뿐이고, 그것이 원인이라는 근거는 없다. 제한시간이 없는 `page.evaluate`(저장소 읽기)에서 멈춘 것으로 보이나 확인하지 못했다.
  - 재검수자가 67회 더 돌려 재현하지 못했고, 멈춘 곳은 `captureThree`의 390×844에서 `locator.evaluateAll`(제한시간 없음)로 좁혔다.
  - 진단 장치(`tests/helpers/stall-watch.cjs`): 그 `evaluateAll`을 30초 타이머와 경주시킨다. 멈추면 **실패**로 끝내고 오류 문구에 주 스레드 응답 여부(짧은 `page.evaluate`), 뷰포트, 주소, 마지막 콘솔 줄을 남긴다. `account-library-browser`와 같은 읽기를 쓰는 `source-folders-browser`에 넣었다. 기존 단언과 제한시간은 그대로다. 원인을 고친 것이 아니다.

### `news-wide-search-browser` 간헐 실패 — 근본 원인 수정 (`d31de9d`, 따로 되돌릴 수 있는 커밋)

- 증상: `the screen's own scrolls are not a use` 검사가 느린 기계에서 `nothing to announce: the list took them`으로 실패. W4 회귀가 아니다(기준판도 실패).
- 재현: CDP `Emulation.setCPUThrottlingRate`, 한 번에 하나. 수정 전 4배 3/6 실패, 8배 1/6 실패.
- 원인은 둘이었다.
  1. `새 글 n건`(과 `AI 추천 보기`)을 누르면 목록을 다시 그리는데, 그때 문서가 잠깐 짧아져 페이지가 스스로 움직인다(기록한 값: `scrollY` 300 → 0). 이 스크롤은 `placing()`으로 표시되지 않았고, 직전 `placing()`에서 250ms 안일 때만 우연히 화면의 것으로 넘어갔다. 검수 가설(복귀 스크롤이 창 밖으로 나감)과 다른 지점이다.
  2. `placing()` 뒤 250ms 시계만으로 판정해, 느린 기계에서는 화면이 건 스크롤의 `scroll` 이벤트가 그보다 늦게 왔다.
- 수정: (1) 다시 그리기 전에 `placing()`을 부른다. (2) `placing()`이 애니메이션 프레임 4개를 연다. `scroll` 이벤트는 그 렌더링 갱신의 프레임 콜백보다 먼저 나가므로, `placing()` 직후에 건 이동의 이벤트는 갱신이 아무리 늦어도 프레임이 남아 있을 때 도착한다. 그런 이벤트가 한 번 오면 그 움직임의 `scrollend`까지는 같은 움직임이다(부드러운 스크롤). `scrollend`가 없는 브라우저는 프레임과 기존 250ms 규칙을 이어 쓴다. 기존 250ms 규칙은 둘째 판정으로 남겨, 전에 화면의 것이던 스크롤이 사람의 것으로 바뀌는 경우가 없다. 휠·터치는 화면의 주장을 바로 끝낸다.
- 확인(같은 검사, 한 번에 하나, 실제 종료 코드):

  | 판 | 4배 | 8배 | 16배 | 스로틀 없음 |
  | --- | --- | --- | --- | --- |
  | 수정 전 | 3/6 실패 | 1/6 실패 | — | — |
  | (2)만(프레임·`scrollend`) | 8/10 실패 | 0/10 실패 | — | — |
  | (1)만(다시 그리기 전 `placing()`, 시계 그대로) | 2/10 실패 | 0/10 실패 | 3/6 실패 | — |
  | 둘 다(`d31de9d`) | 10/10 통과 | 10/10 통과 | 6/6 통과 | 10/10 통과 |
  | 재검수 뒤(N-1 반영, 지금) | 8/8 통과 | 8/8 통과 | 6/6 통과 | 8/8 통과 |

- 반대 방향 단언: 화면의 스크롤이 끝난(`scrollend`) 뒤 입력 없는 스크롤(스크롤 막대·화면 읽기 프로그램)은 사람의 것이라, 뉴스를 다시 열 때 온 답이 `새 글 n건`으로 안내되고 그려진 카드가 제자리에 남는다. `scrollend`에서 표시를 걷지 않게 바꾸면 실패한다.
- 검사에 더한 것: CPU를 늦추는 `NEWS_WIDE_THROTTLE` 환경 값(단언·대기 변경 없음). 제한시간과 기존 단언은 그대로다.
- **재검수(`78d291e`) N-1·N-2 반영:**
  - N-1: 문서가 짧아져 페이지가 당겨지는 스크롤은 `scroll`만 오고 `scrollend`가 오지 않아, 화면의 움직임 표시(`ownMoving`)가 끝없이 남았다. 그 뒤 스크롤 막대로 한 첫 스크롤이 사용으로 잡히지 않았다(`63580b3`은 잡았다). 움직임 중의 `scroll`마다 프레임 4개를 다시 열고, `scroll` 없이 프레임 4개가 지나면 움직임이 끝난 것으로 본다(`scrollend`가 먼저 오면 그때 끝난다).
  - 긴 부드러운 스크롤 도중 표시가 일찍 걷히는지: 움직이는 동안은 프레임마다 `scroll`이 와서 프레임이 다시 열린다. 걷히더라도 기존 250ms 규칙이 이어받는다. 스로틀 4·8·16배와 스로틀 없음에서 다시 돌려 확인했다(아래 표의 "재검수 뒤" 줄).
  - 숨김: 페이지가 숨겨지면 프레임이 멈춰 표시가 남는다. 돌아온 첫 렌더링에서 `scroll` 이벤트가 프레임 콜백보다 먼저 나가므로, 그때 온 첫 스크롤은 남은 표시에 덮인다. 그래서 숨겨질 때 표시를 걷는다(프레임·움직임·250ms 규칙 모두). 이것은 이벤트 순서로 따진 것이고 실제 탭 전환으로 재지는 못했다. 검사는 숨김 이벤트를 페이지에 보내 확인한다. 반대쪽 비용은 화면이 건 이동의 이벤트가 숨김을 넘겨 도착하면 사용으로 잡히는 것인데, 이 경우 답이 제자리에 들어가지 않고 안내로 나올 뿐이라 덜 해롭다.
  - 휠·터치는 250ms 규칙도 함께 끝낸다. 그러지 않으면 휠 바로 다음의 입력 없는 스크롤을 시계가 다시 화면의 것으로 본다(변이 R10b로 확인).
  - N-2: 느린 기계 없이 실패하는 검사 네 개를 더했다. 변이 확인은 인계 보고와 scratchpad `mutations.txt`에 있다.
- 남는 한계: `scrollend`가 없는 브라우저(구형 Safari)에서는 부드러운 스크롤의 뒷부분을 여전히 프레임·시계로 본다. 실기 Safari에서 재지 않았다. `placing()` 없이 화면을 다시 그리는 다른 경로가 페이지를 움직이는 경우는 이번에 확인한 두 단추 말고는 찾지 않았다.

### 죽은 선택자 확인 (`assets/`·`tests/`·`scripts/` 전체 grep)

`details`나 아이콘 단추에서 다른 요소·자리로 바꾼 것마다 `[open]`·`summary`·`details`·직접 누름을 찾았다. 원본은 scratchpad의 `dead-selector-grep.txt`(141줄)다.

| 바꾼 것 | 지금 요소 | 남아 있던 옛 전제 | 상태 |
| --- | --- | --- | --- |
| `#lifeFolderManage` (`details` → `section[hidden]`) | 칸 | `ui.js` 보호 선택자 `#lifeFolderManage[open]` 2곳 | **죽어 있었음 → 고침(MAJOR-1)** |
| 〃 | 〃 | `tests`의 `el.open`·`> summary` 누름(`source-folders`·`account-library`) | 첫 판에서 메뉴 경로로 고침. 지금 `#lifeFolderManage`에 `open`·`summary`를 쓰는 곳 0 |
| 〃 | 〃 | `source-folders.css`의 `.sf-manage > summary` | 첫 판에서 지움. 0 |
| 행 폴더 양식 `.source-folder-assignment` | 여전히 `details`(요약은 숨김, `data-embedded`) | `ui.js` `[open]` 3곳(보호·지연 갱신·toggle), `records.css`·`source-folders.css`의 `[open]` | 살아 있음(행 메뉴가 `open`을 켠다). 선택 막대의 양식은 요약 그대로 |
| 〃 | 〃 | `tests`의 `> summary` 누름 | `source-folders`의 `assign()`은 `data-embedded`면 행 메뉴로, 아니면 요약으로. `account-library`는 행 메뉴로. 0 |
| 행 정보 `.life-result-info` (아이콘 단추 → 행 메뉴 항목) | 메뉴 항목 | `search-quality`의 직접 누름 | 첫 판에서 고침. 보호 선택자에는 없었음 → 넣음(MAJOR-1) |
| 〃 | 〃 | `scripts/check-life-feed-design.cjs:111` `getByRole('button', { name: /^자료 출처 정보/ })`, `:65` `.life-feed-footer .life-icon-button` | **죽음. 고치지 않음** — `scripts/`는 작업 범위 밖이고 `pages.yml`에 없는 수동 디자인 점검이다 |
| `#lifeSelectionToggle` (머리 단추 → 메뉴 항목) | 메뉴 항목 | `tests`의 직접 누름 7개 파일 | 첫 판에서 메뉴 경로로 고침. `home-entry-browser`는 `aria-label`만 읽어 그대로 통과 |
| 〃 | 〃 | `scripts/check-app-feel-design.cjs:23` `#lifeSelectionToggle`에 초점 → Space | **죽음. 고치지 않음** — 위와 같은 이유 |
| `.records-when` (행의 첫 자식 → 꼬리표 줄 끝) | `time` | `records-news`의 `:scope > .records-when` | 첫 판에서 고침. 0 |
| `.records-row-tools` (`role=toolbar` 두 단추 → `⋯` 하나) | `div` | 참조 없음 | 0 |
| `#discoveryNewsSettings` (탭 줄 → 머리줄) | 같은 단추 | `ui.js`의 `main.querySelector('#discoveryNewsSettings')` | 첫 판 검사에서 잡아 고침. `tests`는 id로 눌러 그대로 통과(1100px 이하 읽기 중·설정 화면 중에는 전처럼 보이지 않음) |
| 폴더 선택 `#lifeFolderFilter` (폴더 묶음 안 → 탭 줄) | 같은 `select` | `source-folders-ui.js`의 `element.contains(select)` 가드 | 첫 판 검사에서 잡아 고침 |

`scripts/`의 두 점검 스크립트는 총괄이 정한다(고치거나 지금 화면에 맞게 다시 쓰기).

## 바꾼 단언 (규칙 변경, 약화 아님)

| 검사 | 전 | 후 | 근거 |
| --- | --- | --- | --- |
| `records-news-browser` | 날짜 칸이 제목 왼쪽 | 날짜·시각이 꼬리표 줄 끝(마지막 꼬리표 뒤), 문구 모양 그대로, 제목은 행 왼쪽 끝에서 시작 | 계약 "왼쪽 날짜·시각 칸은 꼬리표 줄 끝으로" |
| `news-card-feed-browser` | 카드 사진 모서리 `14px` | `8px`(`--haedo-radius`) + 탭 줄·머리줄 `뉴스 설정` 단언 추가 | 계약 토큰, 390px 결함 |
| `record-arrange-browser` | 머리의 `#lifeSelectionToggle`을 누름·보일 때까지 기다림 | `⋯` › `기록 선택`. 키보드 경로(Enter 두 번)와 실행 뒤 `⋯` 초점·닫힌 메뉴 단언 추가 | 계약 "`⋯`(`기록 선택`, 폴더 관리)", 초점 복귀 |
| `search-quality-browser` | 머리 단추, 행의 정보 아이콘 | `⋯` › `기록 선택`, 행 `⋯` › `자료 출처 정보`. 행 메뉴 항목 두 개·Esc 뒤 제목 초점·실행 뒤 제목 초점 단언 추가 | Designer 기본값 5 |
| `source-folders-browser`, `account-library-browser` | `폴더 관리` 요약을 Space·Enter로 여닫음, 행의 폴더 단추 | `⋯` › `폴더 관리`(Enter), Esc·닫기 뒤 `⋯` 초점, 행 `⋯` › `폴더로 이동`, 이동 뒤 제목 초점. 44px·16px·가림 없음 단언은 `⋯`와 칸 안 조작에 그대로 적용 | 계약 "폴더 관리" 이동 |
| `book-workshop-browser`, `book-workshop-recovery-browser`, `input-output-quality-browser` | 머리 단추 | `⋯` › `기록 선택` | 같은 이동 |
| `tests/helpers/feature-menus.cjs` | — | `toggleRecordSelection`·`openFolderManage`·`recordRowMenuItem`·`openRowFolderMove` 추가(사람이 누르는 길 그대로) | — |

`#lifeSearchCount`를 읽는 검사(`search-quality`·`obsidian-reading-scale`·`source-merge`·`life-collections`)는 고치지 않았고, 문구가 그대로라 통과한다.

## 대비 (실제 표면색, WCAG 2)

반투명 값은 흰 바탕에 합성해 쟀다(선택 면 `#F3F3F3`, 호버 면 `#F7F7F7`).

| 쓰임 | 글자·선 | 바탕 | 대비 |
| --- | --- | --- | --- |
| 행 제목·현재 탭·메뉴 항목 | `#37352F` | `#FFFFFF` | 12.26 |
| 먹색 / 호버 면 | `#37352F` | `#F7F7F7` | 11.44 |
| 먹색 / 선택 면(열린 ⋯, 켜진 기록 선택, 설정 목차 현재) | `#37352F` | `#F3F3F3` | 11.05 |
| 발췌·나머지 탭·폴더 선택(보조) | `#5F5E5B` | `#FFFFFF` | 6.48 |
| 보조 / 호버 면 | `#5F5E5B` | `#F7F7F7` | 6.05 |
| 보조 / 선택 면 | `#5F5E5B` | `#F3F3F3` | 5.84 |
| 꼬리표 글자 / 꼬리표 면 | `#5F5E5B` | `#F1F1EF` | 5.73 |
| 보조 / 옅은 채움(선택 막대) | `#5F5E5B` | `#F7F7F5` | 6.04 |
| 날짜·시각·개수 줄·뉴스 메타 | `#6F6E69` | `#FFFFFF` | 5.11 |
| 메타 / 호버 면(행 호버) | `#6F6E69` | `#F7F7F7` | 4.77 |
| 메타 / 선택 면 | `#6F6E69` | `#F3F3F3` | 4.60 |
| 검색 일치 글자 / 표시 면 | `#37352F` | `#FBEFC0` | 10.63 |
| 필터 개수·되돌리기 알림(흰 글자) | `#FFFFFF` | `#37352F` | 12.26 |
| 오류 문구 | `#A3243D` | `#FFFFFF` | 7.30 |
| 비글자: 검색 칸 테두리 | `#8A8984` | `#FFFFFF` | 3.50 |
| 비글자: 현재 탭 2px 선, 읽는 중인 행 2px 테 | `#37352F` | `#FFFFFF` | 12.26 |
| 비글자: 열린·켜진 단추의 1.5px 먹색 테 | `#37352F` | `#F3F3F3` | 11.05 |
| 비글자: 인용 3px 틸 바 | `#145B50` | `#FFFFFF` | 7.95 |
| 비글자: 초점 링 | `#267A69` | `#FFFFFF` / `#F3F3F3` | 5.16 / 4.65 |

- 꼬리표 면(1.13:1)과 구분선(1.17:1)은 장식이다. 뜻은 글자가 전한다.
- 상태를 색만으로 나타내는 곳은 없다. 현재 탭은 굵기 + 선, 열린 메뉴·켜진 선택은 면 + 테, 담기·좋아요는 채운 도형, 읽는 중인 행은 테 + `aria-current`다. 그래서 색각에 따라 달라지는 구분이 없다.

## 두 번째 표시 (W1 검수에서 넘긴 것)

- 자료·뉴스·설정 머리줄과 화면 안의 아이콘 단추가 `aria-expanded=true`·`aria-pressed=true`·`aria-current`이거나 열린 메뉴의 `⋯`이면 선택 면에 1.5px 먹색 테를 더했다(`records.css`·`discovery.css`·`settings.css`, 모든 폭). W2가 노트·일정 머리에 쓴 모양과 같다.
- 메뉴 안의 `기록 선택`이 켜져 있으면 선택 면 + 600 + 1.5px 테다.

## unslop 지침을 참고한 수동 점검

- 고친 것: 자료 검색 칸의 겹친 초점 링 두 개(칸 + 입력) → 하나, 브라우저 기본 검색 지우기 표시와 `검색어 지우기` 단추가 함께 보이던 것 → 단추 하나(둘 다 기준판에도 있던 것), 탭 줄과 행의 간격을 4px 단위로 맞춤, 모서리 값 10·12·14·16px 섞임 → 6px(조작)·8px(면), 굵기 650·700·730·750 → 600(글 제목만 700), 뉴스 화면의 틸 글자 단추·호버 → 먹색, 메뉴 그림자 한 가지.
- 일부러 남긴 것: 인용의 틸 3px 바와 체크의 틸(소유자 결정), 아이콘 선 굵기 1.8·20px(11-02 결정), 폴더 선택 글자 16px(시안은 더 작다. iPhone에서 선택 상자를 누를 때 화면이 확대되지 않게 하는 기존 규칙).

## 시안과 다른 점 (의도)

- 날짜는 시안의 `11월 11일 14:05`가 아니라 지금 문구 `11.18 08:24`다(계약 "내용 그대로").
- 검색 칸에 글자가 있으면 `검색어 지우기`가 `검색 필터` 왼쪽에 보인다.
- 폴더 선택 글자는 16px다(위).

## 검사 (실제 종료 코드)

로컬 Chromium 1243, 가짜 인증, 익명 샘플. 한 번에 하나씩 돌렸다.

- `npm test`: 0 (2888/2888) · `npm run check`: 0 (22 HTML, 202 JS, 803 로컬 참조) · `node scripts/check-markdown-links.cjs`: 0 — 마지막 코드 상태에서 다시 돌린 결과다.
- 검수 반영 뒤 최종 head의 결과는 인계 보고(총괄에 보낸 글)와 scratchpad의 `results.txt`에 있다. 아래는 첫 판(`63580b3`) 때의 기록이다.
- 마지막 코드 상태에서 다시 돌린 브라우저 검사(모두 0): `record-arrange`·`search-quality`·`source-folders`·`account-library`·`records-reader-small`·`records-split-resize`·`records-news`·`purpose-workflow`. 그 직전 상태(이후 바뀐 것은 `records.css`의 폴더 선택 정렬·검색 칸 초점 링뿐)에서 돌린 것: `settings`·`news-card-feed`·`obsidian-reading-scale`·`life-news`·`purpose-news`·`home-entry`·`source-merge`. 나머지는 각 묶음을 고친 직후에 한 번씩 돌렸고, 그 뒤 바뀐 것은 자료 행의 폴더 이동 뒤 초점(`ui.js`), 자료 CSS, 뉴스 메뉴 항목의 밑줄 제거(`discovery.css`)다. 통합본에서 전체를 다시 돌려야 한다.
- 브라우저(`BASE_URL=http://127.0.0.1:4641 node tests/<이름>.cjs`), 모두 0:
  - 계약 W4 표: `search-quality-browser`, `obsidian-reading-scale-browser`, `source-merge-browser`, `news-card-feed-browser`, `settings-browser`
  - 자료·폴더·검색: `source-folders-browser`, `account-library-browser`, `record-arrange-browser`, `records-news-browser`, `records-split-resize-browser`, `records-reader-small-browser`, `purpose-workflow-browser`, `feature-flow-browser`, `home-entry-browser`, `core-experience-browser`, `subview-navigation-browser`, `startup-performance-browser`, `product-flow-quality-browser`, `unified-home-browser`, `reading-resume-browser`, `reader-position-resize-browser`, `input-output-quality-browser`, `book-workshop-browser`, `book-workshop-recovery-browser`, `original-attachments-browser`, `source-reader-compose-browser`, `sns-blog-experience-browser`, `reading-quality-browser`, `obsidian-vault-browser`, `local-post-finder-browser`, `life-search-browser`, `life-naver-capture-browser`, `account-materials-browser`, `reading-writing-quality-browser`, `reader-panels-browser`, `material-library-browser`, `structure-baseline-browser`, `source-reimport-browser`, `source-edit-draft-browser`, `minor-defects-ui-browser`, `integrated-release-entry-browser`, `import-flow-quality-browser`, `app-motion-browser`, `life-sync-browser`, `obsidian-markdown-browser`, `reader-markdown-excerpt-browser`, `material-writing-sources-browser`, `sync-common-mixed-browser`, `schedule-exits-browser`, `life-annual-plan-browser`
  - 뉴스: `news-wide-search-browser`, `life-external-discovery-browser`, `news-old-shell-sync-browser`, `news-social-browser`, `life-discovery-automation-browser`, `life-personal-discovery-browser`, `life-discovery-reading-browser`, `life-discovery-reactions-browser`, `news-pick-browser`, `life-external-discovery-pwa-browser`, `life-discovery-languages-browser`, `life-news-browser`, `purpose-news-browser`, `life-rediscovery-browser`, `rss-connection-browser`, `rss-inbox-reflection-browser`, `life-interest-browser`
  - 설정: `timeline-display-sync-browser`, `full-backup-browser`
- **0이 아닌 것 1개:** `life-collections-browser` 종료 코드 1. 6개 중 1개(`review input editing retains exact candidate…`: `원문·출처 검토`에서 Tab을 누르면 `#lifeImportEdit`에 닿아야 하는데 닿지 않음)가 실패한다. 기준 커밋 `8c3c54f`를 따로 풀어 같은 검사를 돌려도 같은 단언에서 같은 값으로 실패했다(종료 코드 1). 이 작업이 만든 실패가 아니고, `pages.yml`에 등록된 검사도 아니다. 계약이 W4에 맡긴 `#lifeSearchCount` 단언(`:152`의 검사)은 통과한다. 원인은 찾지 않았다. 미해결로 남긴다.
- 처음 실패해서 고친 것(원인 → 수정):
  - `source-folders-browser`: 폴더를 골라도 목록이 걸러지지 않음 → 탭 줄로 옮긴 선택 상자가 폴더 묶음 밖이라 변경을 무시했다. 묶음 안인지 대신 살아 있는 선택 상자인지로 판단하게 고쳤다.
  - `settings-browser`: 설정의 `뉴스 설정` 행이 뉴스 설정을 열지 못함 → `ui.js`가 본문에서만 단추를 찾았다. 머리줄에서 찾게 고쳤다.
  - `record-arrange-browser`: 검색 입력 높이 42px → 테두리를 가리지 않게 줄였던 것을 44px·투명 바탕으로 되돌렸다.
  - `source-folders-browser`(새로 더한 단언): 행의 `폴더로 이동` 양식에서 `이동`을 누른 뒤 초점이 사라졌다(`<body>`). 기준 커밋 `8c3c54f`도 같았다(이동 뒤 목록을 다시 그리면서 행이 없어진다). 이동이 끝나면 새 목록에서 같은 자료의 제목 단추(목록에 없으면 폴더 선택)에 초점을 두게 고쳤다.
- 결과 폴더가 비어 있어야 하는 검사(`source-folders-browser` 등)는 앞선 `.local/…`을 scratchpad로 옮기고 돌렸다.
- **Docker·PostgreSQL 전용이라 돌리지 않은 것:** `pages.yml`의 `run-*-postgres` 12개(`run-account-docs-postgres`·`run-account-library-postgres`·`run-blog-public-choice-postgres`·`run-blog-revision-continuity-postgres`·`run-blog-unpublish-postgres`·`run-naver-activation-postgres`·`run-naver-media-postgres`·`run-naver-observed-baseline-postgres`·`run-news-wide-postgres`·`run-post-markdown-publish-postgres`·`run-post-markdown-sql-postgres`·`run-rss-postgres`)와 `integrated-release-installation`. 이 작업이 바꾼 파일을 읽지 않는다.
- 이 묶음 밖의 `pages.yml` 브라우저 검사(노트·일정·글쓰기·공개 페이지 등)는 돌리지 않았다. `ui.js`의 `renderHeader`를 함께 쓰므로 통합본에서 전체를 다시 돌려야 한다.

## 캡처

- 익명 샘플·가짜 클라우드, 1440·1101·820·390·320. 가로 넘침 0, 콘솔·페이지 오류 0, 44px 미만 조작 0(화면에 보이는 조작 기준, 캡처 스크립트의 점검).
  - 바뀌기 전에는 자료의 첫 탭 `전체`(현재 탭이 아닐 때)가 38×44px였다. 지금은 44px 이상이다.
- 경로(scratchpad, 저장소에 넣지 않음): `/tmp/claude-0/-home-user-life-haedo/cc8b2c05-846a-52db-844a-53448e40bb01/scratchpad/w4/shots/before/`와 `/tmp/claude-0/-home-user-life-haedo/cc8b2c05-846a-52db-844a-53448e40bb01/scratchpad/w4/shots/after/`. 파일 이름은 `<폭>-<화면>.png`다(자료 목록·검색·필터·발췌 탭·자료 메뉴·행 메뉴·출처 정보·폴더 이동·폴더 관리·선택 중·읽기, 뉴스 목록·필터·글 옵션·읽기·뉴스 설정, 설정).

## W5와 총괄에 넘길 것

- `ui.css:62` `.life-icon-button[aria-pressed|aria-expanded]`의 틸 글자는 다른 화면(가져오기·컬렉션 등)에 남아 있다. 자료·뉴스·설정에서는 이번 CSS가 먹색 + 테로 덮는다. 공통 규칙을 `haedo-shell.css`로 올리면 화면별 덮어쓰기 세 곳을 지울 수 있다.
- `ui.css:297` `.life-toolbar .life-title-button:hover`의 틸(1100px 이하 자료 제목 단추 호버), `ui.css:96` 검색 칸 초점 테(2px 틸, 초점이라 유지 가능).
- `저장한 문장 주제로 찾기`(view=topics)·컬렉션·가져오기 화면의 검색 칸과 행은 옛 모양이다(이번 범위 밖).
- 뉴스의 `새 탭에서 열기`·`더 보기` 같은 기본 `.life-button` 모양(틸 글자)은 공통 규칙이라 그대로다.
- 1101px 이상의 큰 제목 줄(`.haedo-title-band`) 규칙은 `home.css`에 있다. 자료·뉴스·설정도 쓰게 됐으므로 공통 파일로 옮기는 편이 맞다.
- `docs/design-review/README.md`에 이 보고서 줄을 더하는 일(작업 범위 밖 파일).
- `life-collections-browser`의 기준판 실패(위).
- `sw.js` CACHE 판올림, 통합본에서 `pages.yml` 브라우저 검사 전체.

## 확인하지 못한 것

- 실제 Mac·iPad·iPhone, Safari/WebKit, VoiceOver, 한글 IME 실기. 화면 폭만 바꾼 Chromium 결과다.
- iPhone에서 폴더 선택 상자를 눌렀을 때의 확대 여부(16px로 두었다).
- forced-colors 실기(탭 선·선택 카드에 대체 표시는 넣었다).
- 뉴스 설정을 머리줄로 옮긴 것과 행 `⋯`의 Designer 확인.
