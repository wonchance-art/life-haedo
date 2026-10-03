# 디자인 시안 검증

2026-10-04 KST. 독립 시안 `design-sample.html`을 Linux Chromium 151.0.7922.173과 기존 Playwright로 검사했다. 결과는 **99개 화면·상태 조합과 15개 동작 흐름 통과**다. 이는 디자인 비교용 익명 시안의 결과이며 실제 Apple 기기 검증·운영 앱 적용·사용자 선호 검증을 뜻하지 않는다.

## 범위와 증거

| 구분 | 검사 범위 |
| --- | --- |
| 화면·상태 | A/B/C × 검색/원문 × 기본/많은 자료/빈 상태/로딩/오류 × 1440×1000·820×1000·390×844 = 90개 |
| 공통 UI | A/B/C × 세 화면 폭 = 9개 |
| 상호작용 | 방향별 검색·필터·복귀, 발췌·새로고침, 본문 미확보·재시도, 키보드·터치·피드백, 글자 확대 실험 = 15개 묶음 |
| 캡처 | 기본 18장, A의 추가 상태 24장, 링크 자료·초점·글자 확대 9장 = 51장. 이 중 기본 18장 약 2.2 MiB를 저장소에 보존 |
| 원본 보고서 | `.local/design-review/after/report.json` 및 같은 디렉터리의 PNG. UTC 시작 시각 `2026-10-03T15:36:58.109Z` |
| 격리 | 새 브라우저 컨텍스트, 운영 계정·키·개인 자료 미사용. 시안 HTML/CSS/JS·아이콘의 로컬 GET만 허용, 외부 요청 시 실패 |

기본 검색어는 `기록`이며 세 방향 모두 같은 자료 11개가 나온다. 검색 조건을 지우면 샘플 원천 12개를 볼 수 있다. 많은 자료는 같은 샘플을 5회 반복하며 각 행에 예시 번호를 명시한다. `reader&state=many`는 원문을 임의로 늘리지 않고 동일한 긴 원문을 유지한다. 운영 화면 감사의 자료 네 개와 이번 시안의 자료 12개는 서로 다른 샘플이다. 두 감사 사이의 카드 수·세로 길이를 같은 콘텐츠의 성능 향상으로 비교하지 않는다.

| 시안 | 1440px | 820px | 390px |
| --- | --- | --- | --- |
| A 검색 | [캡처](evidence/after/a-search-desktop.png) | [캡처](evidence/after/a-search-tablet.png) | [캡처](evidence/after/a-search-phone.png) |
| A 원문 | [캡처](evidence/after/a-reader-desktop.png) | [캡처](evidence/after/a-reader-tablet.png) | [캡처](evidence/after/a-reader-phone.png) |
| B 검색 | [캡처](evidence/after/b-search-desktop.png) | [캡처](evidence/after/b-search-tablet.png) | [캡처](evidence/after/b-search-phone.png) |
| B 원문 | [캡처](evidence/after/b-reader-desktop.png) | [캡처](evidence/after/b-reader-tablet.png) | [캡처](evidence/after/b-reader-phone.png) |
| C 검색 | [캡처](evidence/after/c-search-desktop.png) | [캡처](evidence/after/c-search-tablet.png) | [캡처](evidence/after/c-search-phone.png) |
| C 원문 | [캡처](evidence/after/c-reader-desktop.png) | [캡처](evidence/after/c-reader-tablet.png) | [캡처](evidence/after/c-reader-phone.png) |

## 실제 확인한 동작과 수치

| 항목 | 결과 |
| --- | --- |
| 가로 넘침·긴 제목 | 99개 조합에서 문서 넘침·화면 밖 요소·긴 제목 잘림 없음. 긴 한글 제목이 여러 줄로 이어짐 |
| 조작 이름·크기 | 검색·읽기 90개 조합의 활성 버튼·링크·입력·선택·details 조작 모두 접근 가능한 이름과 최소 44×44 CSS px 영역. 숨긴 요소와 disabled 버튼 제외 |
| 텍스트 대비 | 실제 계산된 전경과 조상 배경색을 합성해 측정. 일반 글자 4.5:1, 큰 글자 3:1 기준 실패 0. 측정 최저 4.698:1 |
| 입력 경계 | 검색·읽기 90개 조합의 input/select/textarea 표면 대비 3:1 미달 0. 기본 경계색 `#7e8b79`와 종이 표면은 약 3.4:1 |
| 키보드 | 본문 건너뛰기 링크가 Tab 시 나타나고 Enter 시 main으로 이동. 뒤따르는 일곱 활성 조작에서 2px 초점선 표시. 초점선과 주변 표면 3:1 이상 |
| 추가 상태 대비 | 주요 버튼 hover·성공 피드백을 실제 렌더링 후 측정, 텍스트 대비 실패 0. disabled 조작과 OS의 select 팝업은 검사 대상에서 제외 |
| 검색 | 본문의 `따옴표` 검색 → 해당 자료 1개. Apple 메모 출처로 좁히면 결과 0개. 조건 지우기로 검색어·출처를 함께 초기화 |
| 한글 입력 | 합성 compositionstart 동안 결과 유지, compositionend 뒤 결과 갱신. 실제 한글 입력기에서 조합한 검사는 아님 |
| 원문 복귀 | 검색어·출처를 지정하고 긴 제목의 자료를 touch API로 열었다가 돌아옴. 필터·결과 수·원래 행의 키보드 초점·세로 위치 복원 확인 |
| 발췌 | DOM Range로 선택한 원문과 표시 발췌가 동일함. 선택 주제 없이 추가 가능, 주제·메모를 넣은 두 번째 추가도 가능. 새로고침 뒤 샘플 발췌 0개 |
| 본문 미확보 | 링크만 보관한 source-09에는 원문 본문·발췌 추가 조작이 없고 범위를 안내함 |
| 실패 복구 | 검색·원문 오류의 다시 시도로 정상 화면 복귀. 빈 검색의 조건 초기화와 피드백 Escape 닫기 확인 |
| 글자 확대 실험 | 390px에서 루트 글자 크기를 CSS 200%로 바꾼 세 방향에 문서 가로 넘침 없음. rem 기반 요소만 변하므로 브라우저 200% 줌이나 전체 텍스트 확대 합격으로 보고하지 않음 |
| 실행 오류 | 실제 console error 0, pageerror 0, 금지된 요청 시도 0 |
| 개인 자료 접근 | 관찰한 local/session Storage 메서드·IndexedDB open/delete·서비스워커 등록 호출 0. 실제 Auth·DB HTTP 요청 없음 |

위 대비 검사는 평면 CSS 배경에 한정한다. 그림 위 글자, 브라우저/OS 기본 메뉴, 화면읽기 프로그램의 실제 발음과 탐색을 검증한 것은 아니다. 단일 검사기를 통과했다는 이유로 WCAG 전체 준수나 모든 사용자에게 편안한 읽기를 주장하지 않는다.

## 시각 검토와 수정

자동 수치와 별도로 A/B/C 검색·읽기의 데스크톱·태블릿·휴대폰 대표 캡처, 빈 상태·로딩·오류·초점·글자 확대 캡처를 직접 살펴봤다. 한글 원문과 긴 제목의 흐름, 제목-문맥-메타정보 순서, 발췌 영역의 배치, 키보드 초점과 다음 행동을 확인했다.

첫 검토에서 검색의 `지우기`가 두 줄로 갈라지는 문제, 입력 경계의 2.866:1 대비, B의 820px 보조 자료 목록이 긴 제목으로 원문보다 많은 공간을 차지하는 문제를 찾았다. 버튼 여백·줄바꿈, 입력 경계색, 좁은 화면의 보조 목록 배치를 고친 뒤 위 검사를 다시 수행했다. 처음 검사에서 마지막 Tab이 브라우저 영역으로 빠져 BODY를 가리킨 것은 제품 오류가 아닌 검사 종료 조건 오류로 구분하고 수정했다.

현재 첫 검색 제목의 문서 Y 좌표는 A 403/395/557, B 439/439/549, C 522/522/575px다(1440/820/390 순). 상단 시안 비교 도구까지 포함한 값이며 모든 기본 크기의 첫 화면에 첫 결과 제목과 문맥이 보인다. 이것은 배치 관찰값으로, 실제 검색 시간이나 선호를 측정한 결과는 아니다. B의 높은 밀도와 C의 넓은 여백·명조 본문에 대한 선호는 비교 시안을 보고 결정할 부분이다.

## 기존 기능과 남은 확인

시안은 기존 로그인·저장·동기화·백업·발췌 모듈을 불러오지 않는다. DOM 선택으로 얻은 문자열을 메모리에 담는 동작은 운영 앱의 원문 버전·raw UTF-16 위치 보존 계약을 구현하거나 검증한 것이 아니다. 실제 화면에 적용할 때는 기존 Core/Reader API를 사용하고 기존 발췌·검색·계정 격리 회귀 검사를 유지해야 한다.

디자인 검증과 별도로 작업 책임자가 다음 기존 기능 회귀를 실행했다. 실제 운영 계정·DB에 쓰는 검사는 아니다.

| 별도 검사 | 이번 결과 |
| --- | --- |
| `npm test` | 181/181 통과 |
| `tests/life-search-browser.cjs` | 6/6 통과 |
| `tests/life-browser.cjs` | 23/23 통과. 오프라인 Auth 실패를 의도한 콘솔 오류 1건 구분 |
| `tests/platform-life-browser.cjs` | 8/8 통과. `OLD_SITE_DIR` 미제공으로 이전 사이트 갱신 fixture 1건 생략. 의도한 transport/callback 콘솔 오류 1건 구분 |
| `npm run check` | HTML 14개, JS 30개, 로컬 참조 163개, PWA 정적 검사 통과 |

플랫폼 검사의 첫 실행은 필수 `SITE_DIR`가 없어 시작하지 못했다. 익명 설정으로 산출물을 준비한 뒤 위 결과를 얻었다. 이 기능 회귀는 합성 Auth/계정 격리·원문 발췌·검색 복귀·저장·백업 사본·오프라인 흐름을 포함하며, 실제 DB/RLS·Google 로그인이나 새로운 디자인의 사용성 검증으로 해석하지 않는다. 전체 시안 검사 뒤 컴포넌트의 오류 예시 문구만 `주제를 입력해 주세요`에서 `필수 값을 입력해 주세요`로 수정했다. 선택 사항인 발췌 주제와 예시를 혼동하지 않게 하는 문구 수정이며 CSS·동작은 그대로다.

로컬 작성 파일의 diff 검사를 통과했다. 공식 Impeccable 원본에는 extract의 파일 끝 빈 줄 1건, harden의 공백 4건, optimize의 공백 1건이 기존 그대로 포함되어 있다. 출처 해시를 보존하기 위해 이 여섯 건을 수정하지 않았고, 원본의 공백 경고를 로컬 코드 검증 통과에 섞지 않았다.

실제 Mac·iPad Chrome·iPhone, Apple 글꼴·한글 IME, 길게 눌러 선택하는 터치 손잡이, 하드웨어 키보드, VoiceOver, 브라우저 줌, 화면 분할과 회전은 미검증이다. 새 시안에는 Files·로그인·실제 저장 동작이 연결되어 있지 않다.

## 재현

별도 터미널에서 `npm run dev`를 실행한 다음 아래 명령을 실행한다. 이미 서버가 떠 있으면 재시작할 필요가 없다. 새 의존성 설치나 자격 증명은 필요하지 않다.

```sh
node scripts/check-design-preview.cjs
```

기본 서버는 `http://127.0.0.1:4173`이다. `BASE_URL`은 localhost 계열만 허용한다. 기존 Playwright와 Chromium 위치가 다르면 `PW_MODULE_PATH`, `CHROMIUM_PATH`를 지정할 수 있다. 스크립트는 자신이 생성하는 같은 이름의 검증 PNG·보고서를 갱신한다. 검사 후 격리 브라우저는 닫으며 개발 서버는 직접 비교를 위해 계속 실행할 수 있다.

별도 기능 회귀를 재현하려면 같은 로컬 서버를 유지한 채 다음을 실행한다. 아래 URL과 공개 키 문자열은 테스트 helper가 가로채는 **익명 fixture**이며 실제 프로젝트 자격 증명으로 바꾸지 않는다. 플랫폼 검사는 이 산출물로 별도 임시 로컬 서버를 연다.

```sh
npm test
node tests/life-search-browser.cjs
node tests/life-browser.cjs
HAEDO_SUPABASE_URL=https://life-sync-test.supabase.co HAEDO_SUPABASE_KEY=sb_publishable_anonymous_browser_test_only node scripts/prepare-site.mjs .local/design-review/regression-site
SITE_DIR=.local/design-review/regression-site node tests/platform-life-browser.cjs
npm run check
```

`OLD_SITE_DIR`을 지정하지 않은 위 명령은 과거 배포본에서의 서비스워커 갱신 fixture를 생략한다. 이번 검증에서도 그 검사를 통과했다고 보고하지 않았다.
