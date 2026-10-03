# 소셜 스타일 시안 검증

> **이전 비교 02의 실행 기록이다.** `evidence/social/`과 아래 결과는 보존하며, 현재 `social-sample.html`의 본문 중심 비교 03 결과는 [새 검증 기록](minimal-verification.md)에 분리한다. 현재 검사 스크립트를 실행하면 03의 결과가 생성되므로 아래 수치를 현재 화면에 적용하지 않는다.

2026-10-04 KST. `social-sample.html`을 Linux Chromium 151.0.7922.173과 기존 Playwright로 실행했다. **78개 화면·상태 조합과 28개 동작 흐름을 통과**했다. 이어 B의 연결된 발췌·내 생각을 보여주는 **별도 1개 장면·흐름**을 검사하고 캡처했다.

비교 시안은 익명 자료만 사용하는 독립 화면이다. 기존 A/B/C 문서 중심 시안과 그 증거는 그대로 보존한다. 이번 실행을 실제 Apple 기기·운영 계정·데이터 동기화 검증과 구분한다.

## 검사 범위

| 구분 | 범위 |
| --- | --- |
| 핵심 화면 | Color/Thread/Pulse × 피드/원문 × 1440×1000·820×1000·390×844 |
| 상태 | 각 화면의 기본·빈 상태·로딩·오류 |
| 가로 배치 | 1024×768의 세 방향 피드·원문 |
| 상호작용 | 검색·출처·주제 필터, 원문 열기와 복귀, 북마크, 본문 펼치기, 원문 선택·발췌, 키보드와 터치, 감소된 모션 |
| 격리 | 시안 HTML/CSS/JS, 공통 익명 샘플과 아이콘의 로컬 GET만 허용. 새 브라우저 프로필과 서비스워커 차단 |

## 실행 결과

| 항목 | 결과 |
| --- | --- |
| 실행 조합 | 세 방향 × 피드/원문 × 기본/빈 상태/로딩/오류 × 세 화면 폭 = 72개, 1024×768 가로 배치 6개. 모든 정상 피드에 동일한 샘플 12개 |
| 가로 넘침·긴 제목 | 78개 장면에서 문서 가로 넘침과 의도하지 않은 화면 밖 요소, 긴 제목 잘림 없음. 주제 줄의 의도된 내부 가로 스크롤은 문서 넘침과 구분 |
| 조작 이름·터치 영역 | 활성 버튼·입력·링크·summary에 접근 가능한 이름, 최소 44×44 CSS px 영역 확인. 숨긴 요소·disabled 버튼·본문 건너뛰기 링크 제외 |
| 텍스트 대비 | 계산된 전경색과 조상 표면색을 합성해 일반 글자 4.5:1, 큰 글자 3:1 기준 검사. 실패 0, 측정 최저 4.980:1. 이번 표면에 배경 이미지·그라데이션 없음 |
| 입력 경계 | input/select/textarea의 표면 대비 3:1 미달 0 |
| 북마크 | 터치로 담기/빼기, `aria-pressed`와 안내 문구 변경. 다시 볼 자료 탭에는 선택한 원천만 표시 |
| 본문 펼치기 | 문장 펼치기/접기의 `aria-expanded`, 연결된 문단의 보임·숨김이 일치 |
| 검색과 출처 | `따옴표` 본문 검색으로 해당 원천 1개. Apple 메모 출처 필터와의 교집합 0개. 두 조건을 지우면 12개 복귀 |
| 한글 조합 | 합성 compositionstart 동안 목록 유지, compositionend 뒤 검색 결과 갱신. 실제 OS 한글 IME 사용은 아님 |
| 읽기 복귀 | 검색어·출처·결과 수·열었던 행의 초점·실제 클릭 순간 세로 위치 복원. 고정 하단 메뉴를 피하려 테스트 도구가 수행하는 클릭 전 스크롤과 구분 |
| 모바일 주제 | 끝에 있는 `원문과 출처`를 가로 스크롤하여 선택하면 source-06만 표시. 다시 렌더링한 뒤에도 선택 칩의 초점·눌림 상태·가시성 유지 |
| 데스크톱 주제 | `걷기와 관찰` 선택으로 source-03·11만 표시. 선택 후 보이는 해당 조작에 초점 유지 |
| Pulse 옆 미리보기 | source-03 선택으로 옆 제목·읽기 버튼·행의 선택 상태 변경. source-09는 본문 미확보·링크만 보관임을 유지 |
| 원문 선택·발췌 | DOM Range로 선택한 문자열을 그대로 표시. 주제·내 생각 없이도 연결 가능. 내 발췌 탭에서 해당 원천 옆에 선택한 문장 표시. 새로고침하면 발췌 초기화 |
| 연결된 생각 | 별도 B 검사에서 실제 원문 선택 → 주제·내 생각 입력 → 발췌 연결 → 내 발췌 탭을 실행. 발췌와 내 생각을 별도 문단으로 확인하고 대표 이미지 보존 |
| 본문 미확보 | source-09를 열면 원문 본문·발췌 연결 조작이 없음. 링크를 본문 확보로 표시하지 않음 |
| 실패 복구 | 피드·원문 오류의 다시 시도로 정상 화면 복귀 |
| 키보드 | Tab의 본문 건너뛰기 링크·Enter의 main 초점 이동, 뒤따르는 조작의 가시적 초점선 확인. 초점선 대비 3:1 이상. Escape로 안내 닫기 |
| 움직임 감소 | `prefers-reduced-motion: reduce`에서 0.01초를 넘는 CSS transition/animation 없음. 결과와 선택 상태는 유지 |
| 실행 오류·접근 | 실제 console error 0, pageerror 0, 금지된 요청 시도 0. 관찰한 Storage 메서드·IndexedDB open/delete·서비스워커 등록 호출 0 |

본 검사 시작 시각은 `2026-10-03T16:38:47.950Z`이며 `.local/design-review/social/report.json`에 기록했다. 본 검사 캡처는 49장이다. 별도 연결 장면은 `connected-report.json`과 `thread-connected-phone.png`에 기록했으며, 전체 화면 검사를 다시 실행한 것으로 합산하지 않는다. 기본 18장과 연결 장면 1장만 저장소의 검토 자료로 보존한다(약 2.2 MiB).

| 시안 | 1440px | 820px | 390px |
| --- | --- | --- | --- |
| A 컬러 모음 피드 | [캡처](evidence/social/color-feed-desktop.png) | [캡처](evidence/social/color-feed-tablet.png) | [캡처](evidence/social/color-feed-phone.png) |
| A 원문 | [캡처](evidence/social/color-reader-desktop.png) | [캡처](evidence/social/color-reader-tablet.png) | [캡처](evidence/social/color-reader-phone.png) |
| B 문장 피드 | [캡처](evidence/social/thread-feed-desktop.png) | [캡처](evidence/social/thread-feed-tablet.png) | [캡처](evidence/social/thread-feed-phone.png) |
| B 원문 | [캡처](evidence/social/thread-reader-desktop.png) | [캡처](evidence/social/thread-reader-tablet.png) | [캡처](evidence/social/thread-reader-phone.png) |
| C 빠른 탐색 피드 | [캡처](evidence/social/pulse-feed-desktop.png) | [캡처](evidence/social/pulse-feed-tablet.png) | [캡처](evidence/social/pulse-feed-phone.png) |
| C 원문 | [캡처](evidence/social/pulse-reader-desktop.png) | [캡처](evidence/social/pulse-reader-tablet.png) | [캡처](evidence/social/pulse-reader-phone.png) |

B의 주요 차이는 [원문에 연결된 발췌와 내 생각](evidence/social/thread-connected-phone.png)에서 비교할 수 있다. 이 화면은 샘플 입력과 발췌 동작 뒤의 실제 캡처이며 이미지에 가짜 문장을 합성한 것이 아니다.

## 시각 검토와 수정

검사 수치 외에 세 방향의 피드·원문 대표 이미지, 태블릿 내비게이션, 모바일 오류·키보드 초점, Pulse의 옆 미리보기, B 연결 장면을 직접 확인했다. 초기 검토에서 찾은 다음 항목을 수정한 뒤 최종 실행했다.

- 820px의 가져오기 버튼이 `가/져/오/기`로 세로로 갈라져 아이콘과 접근 가능한 이름으로 정리했다. 데스크톱 탐색 문구의 어색한 줄바꿈도 수정했다.
- Color의 선택 원형 테두리가 스크롤 영역의 모서리에서 잘려 내부 여백을 확보했다.
- Pulse의 작은 화면에 주제 조작이 모두 숨겨져 주제 칩을 유지했다. 마지막 칩 선택 후 스크롤과 초점이 사라지는 문제, 데스크톱에서 숨긴 주제 조작을 초점 대상으로 고르는 문제도 수정했다.
- Color의 첫 인용 표면은 진한 강조색과 흰 글자로 변경하고 대비를 다시 검사했다. Pulse에는 선택한 원천에 따라 바뀌는 옆 미리보기를 연결했다.

Color는 큰 실제 인용이 제목보다 먼저 보이고, Thread와 Pulse는 제목·본문 문맥이 먼저 나타난다. 1024×768의 Color에서는 첫 제목이 첫 화면 아래로 내려가지만 인용은 보인다. 이 차이는 밀도의 장단점이며 자동 검사 통과로 어느 안의 선호가 높다고 결론 내리지 않는다. 날짜·범위 같은 작은 보조 글자와 고정 메뉴가 실제 기기에서 편한지는 사용자 체험으로 확인해야 한다.

초기 스크롤 검사 1건은 앱의 복귀 오류가 아니었다. 테스트 도구가 고정 메뉴를 피하며 추가로 스크롤한 뒤 탭했는데 검사 기준을 그 이전 위치로 잡았다. 실제 click 이벤트의 캡처 단계에서 시작 위치를 기록하도록 보정했고, 최종 세 방향 모두 복귀를 확인했다.

## 재현

이미 실행 중인 개발 서버가 없으면 별도 터미널에서 `npm run dev`를 실행한다. 기존 Playwright와 Chromium 설치를 사용하며 새 앱 의존성이나 자격 증명은 필요하지 않다.

```sh
node scripts/check-social-preview.cjs
```

B의 연결된 발췌·생각 장면만 갱신하려면 다음을 실행한다. 전체 결과 `report.json`을 덮어쓰지 않는다.

```sh
node scripts/check-social-preview.cjs --connected-only
```

기본 서버는 `http://127.0.0.1:4173`이며 `BASE_URL`에는 localhost 계열만 허용한다. `PW_MODULE_PATH`, `CHROMIUM_PATH`로 이미 설치된 도구 위치를 지정할 수 있다. 전체 보고서와 캡처는 `.local/design-review/social/`, 대표 비교 캡처는 `docs/design-review/evidence/social/`에 저장한다. 같은 이름의 검사 결과는 실행 시 갱신된다.

## 검증 한계

Linux Chromium 화면 크기·터치 API 모사는 실제 Mac/iPad/iPhone, iPad Chrome, Apple 글꼴, 한글 키보드, VoiceOver, 브라우저 확대, 터치 손잡이로 문장 선택을 검증하지 않는다. 합성 composition 이벤트는 실제 IME 입력과 구분한다. DOM Range의 선택 문자열 표시는 운영 Core의 원문 버전·raw UTF-16 위치 보존을 구현하거나 증명하지 않는다.

대비 검사는 실제 계산된 평면 전경·배경색을 대상으로 한다. 배경 이미지나 그라데이션이 있으면 별도로 기록하고 단색의 결과로 충분한 대비를 추정하지 않는다. 기능 통과와 시각적 선호·읽기 피로·사용자 체험 결과는 별개다. 기존 운영 앱을 변경하지 않은 이번 비교 작업 때문에 이전 기능 회귀 수치를 새 실행으로 다시 보고하지 않는다.
