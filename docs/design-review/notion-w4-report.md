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
| `폴더 관리` | 검색 칸 아래 접힌 줄(`details` 요약) | `자료 메뉴(⋯)` › `목록` › `폴더 관리` `#lifeFolderManageOpen`. 누르면 검색 칸 아래 `폴더 관리` 칸 `#lifeFolderManage`가 열린다(내용·id 그대로, 오른쪽 위 `폴더 관리 닫기`) | 칸 안의 `편집할 폴더`(폴더를 읽거나 보관하는 중이면 `폴더 관리 닫기`) | 칸 안에서 Esc·`폴더 관리 닫기`: `⋯`. 열린 메뉴에서 Esc: `⋯` |
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
- 고침: `뉴스 설정`을 머리줄로 옮기고 탭 사이를 10px로 맞췄다. 390px에서 탭 296 + `정렬·필터` 44 = 340px ≤ 350px.
- 단언: `news-card-feed-browser`가 1440·820·390에서 네 탭이 모두 탭 줄 안에 있고 `정렬·필터`와 겹치지 않으며 가운데를 누를 수 있음을 본다.
- 남는 한계: 320px(또는 개수가 네 자리)에서는 전처럼 탭을 가로로 밀어 본다. 끝의 흐림 처리도 그대로다.

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
