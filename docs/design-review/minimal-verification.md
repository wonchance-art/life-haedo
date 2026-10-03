# 본문 중심 미니멀 시안 검증

2026-10-04 KST. Linux Chromium 151.0.7922.173과 기존 Playwright로 **기본 78개 화면·상태, 펼친 도구 12개 상태, 연결된 발췌 1개 장면과 45개 동작 흐름**을 확인했다. 이후 긴 원문을 읽던 위치에서 출처를 여는 수정에 대해 **390/1440px 두 장면·흐름을 별도 확인**했다. 제품 검사 실패와 콘솔·페이지 오류는 0건이다.

이번 비교는 기본 메뉴와 화면 틀을 최소화하고, 원문을 먼저 읽다가 필요할 때 필터·출처·발췌 도구를 여는 흐름을 대상으로 한다. 이전 소셜 시안의 [검증 기록](social-verification.md)과 `evidence/social/` 이미지는 보존한다. 새 실행 결과는 `.local/design-review/minimal/`, 대표 이미지는 `evidence/minimal/`에 분리한다.

## 검사 범위

- 세 방향의 피드·원문, 1440×1000·820×1000·390×844, 기본·빈 상태·로딩·오류 및 1024×768 가로 배치.
- 기본 비교 설정·필터·출처·발췌 도구가 접힌 상태, 필요한 도구를 여는 버튼과 닫기·Escape의 초점 복귀.
- 아이콘 탐색의 명시적인 접근 가능한 이름과 키보드 도움말, 44×44px 조작 영역, 실제 표면 대비와 긴 한글 줄바꿈.
- 검색·출처·주제·북마크·본문 펼치기·읽기 복귀·발췌 연결·미리보기·움직임 감소의 기존 동작.
- 원문 선택만으로 패널을 열거나 초점을 이동하지 않는지, 사용자가 발췌 도구를 연 뒤 선택 문장이 유지되는지.

## 실행 결과

| 항목 | 결과 |
| --- | --- |
| 기본 화면 | A/B/C × 피드/원문 × 기본/빈 상태/로딩/오류 × 1440·820·390px = 72개, 1024×768 가로 배치 6개 통과 |
| 기본 표시 | 모든 기본 장면에서 비교 설정 접힘. 피드의 필터와 C 미리보기, 정상 원문의 출처·발췌 도구는 요청 전 숨김 |
| 펼친 도구 | 세 방향 × 필터/출처/발췌/비교 설정 = 12개 상태에서 이름·44px 영역·텍스트/입력 경계 대비·가로 넘침 확인 |
| 아이콘 탐색 | 보이는 레일 또는 하단 탐색을 통해 모아보기·다시 볼 자료·내 발췌 사용. 아이콘 버튼마다 명시적인 `aria-label`, 키보드 `:focus-visible`에서 실제 도움말 표시 |
| 필터 | 버튼으로 열기/닫기, `aria-expanded` 일치. 내부에서 Escape를 누르면 닫히고 필터 버튼으로 초점 복귀 |
| 검색·주제·출처 | 본문 `따옴표` 검색, 출처 교집합, 조건 지우기, 끝 주제 선택과 선택 상태/초점 유지. 합성 한글 조합 이벤트 중 결과 유지와 완료 후 갱신 |
| 자료 읽기·복귀 | 긴 제목의 원문 열기 후 검색어·출처·결과 수·행 초점·실제 클릭 당시 세로 위치 복원 |
| 원문 선택 | DOM Range의 선택 문장이 정확히 발췌 값에 반영됨. 선택만으로 패널이 열리거나 원문 초점이 이동하지 않음 |
| 발췌 도구 | 명시적인 발췌 아이콘으로 열기. 닫기 버튼·Escape 뒤 아이콘 초점 복귀. 카드의 발췌 바로가기는 원문과 도구를 함께 열고 닫으면 원문의 발췌 아이콘으로 복귀 |
| 발췌 연결 | 주제·생각 없이도 연결 가능. 내 발췌 보기에서 해당 원천과 선택 구절 확인, 새로고침하면 초기화. 별도 B 연결 장면은 주제·생각을 입력해 원문 발췌와 구분되는지 확인 |
| 북마크·본문 펼치기 | 담기·빼기와 `aria-pressed`, 선택 자료만 보기. 문장 펼치기·접기와 `aria-expanded`/연결 문단 보임이 일치 |
| 출처 기본 흐름 | 출처 버튼으로 메타정보를 요청하고 닫기. 초점은 출처 버튼으로 복귀 |
| 출처 스크롤 후 흐름 | 두 화면 폭에서 원문을 700px 이상 내려간 뒤 출처 요청. 메타정보 첫 행이 고정 도구막대 아래에 보이고 정보 영역에 초점 이동. Escape와 다시 누르기 모두 원래 읽던 세로 위치·출처 버튼 초점 복원 |
| C 미리보기 | 데스크톱·모바일에서 명시적으로 열기. 해당 원천 제목·읽기 동작·선택 행 일치, 닫기/Escape 후 원래 버튼 초점 복귀 |
| 본문 미확보 | source-09에는 원문 본문과 발췌 연결 조작이 없으며, 미리보기에서도 링크만 보관한 상태 유지 |
| 오류와 비교 설정 | 피드·원문 다시 시도로 정상 복귀. 닫힌 비교 설정도 키보드로 열고 다시 접을 수 있음 |
| 키보드·모션 | 본문 건너뛰기, Tab 순서·가시적 초점선과 3:1 초점 대비. 움직임 감소에서 0.01초를 넘는 transition/animation 없음 |
| 레이아웃·대비 | 문서 가로 넘침·긴 제목 잘림·이름 없는 활성 조작·44×44 CSS px 미만 영역 0건. 일반 글자 4.5:1, 큰 글자 3:1, 실제 표시된 입력 경계 3:1 기준 실패 0건. 텍스트 측정 최저 5.245:1 |
| 격리·오류 | 실제 console error 0, pageerror 0, 금지된 네트워크 요청 시도 0. 관찰한 Storage 메서드·IndexedDB open/delete·서비스워커 등록 호출 0 |

가려진 도구를 건너뛰어 기존 검사 조건을 완화하지 않았다. 기존 필터·발췌 동작을 실제로 연 뒤 확인하고, 검색 입력의 아래쪽 선처럼 **실제로 표시되는 경계**를 측정한다. 도움말은 `title` 속성 존재로 대신하지 않고 키보드 초점 상태에서 표시된 CSS 내용으로 확인했다. 대비의 전체 수치는 DOM 글자와 평면 CSS 표면에 한정하며 브라우저/OS 메뉴·스크린리더 발음·전체 WCAG 준수를 의미하지 않는다.

## 대표 이미지

| 시안 | 1440px | 820px | 390px |
| --- | --- | --- | --- |
| A 목록 | [캡처](evidence/minimal/color-feed-desktop.png) | [캡처](evidence/minimal/color-feed-tablet.png) | [캡처](evidence/minimal/color-feed-phone.png) |
| A 원문 | [캡처](evidence/minimal/color-reader-desktop.png) | [캡처](evidence/minimal/color-reader-tablet.png) | [캡처](evidence/minimal/color-reader-phone.png) |
| B 문장 피드 | [캡처](evidence/minimal/thread-feed-desktop.png) | [캡처](evidence/minimal/thread-feed-tablet.png) | [캡처](evidence/minimal/thread-feed-phone.png) |
| B 원문 | [캡처](evidence/minimal/thread-reader-desktop.png) | [캡처](evidence/minimal/thread-reader-tablet.png) | [캡처](evidence/minimal/thread-reader-phone.png) |
| C 빠른 탐색 | [캡처](evidence/minimal/pulse-feed-desktop.png) | [캡처](evidence/minimal/pulse-feed-tablet.png) | [캡처](evidence/minimal/pulse-feed-phone.png) |
| C 원문 | [캡처](evidence/minimal/pulse-reader-desktop.png) | [캡처](evidence/minimal/pulse-reader-tablet.png) | [캡처](evidence/minimal/pulse-reader-phone.png) |

요청 후에만 드러나는 도구와 결과도 남겼다: [필터](evidence/minimal/color-filters-open-phone.png), [발췌 도구](evidence/minimal/thread-excerpt-open-phone.png), [C 미리보기](evidence/minimal/pulse-preview-open-desktop.png), [원문에 연결된 발췌·생각](evidence/minimal/thread-connected-phone.png), [읽던 중 요청한 출처](evidence/minimal/thread-source-open-phone.png).

전체 PNG 61종 중 대표 23종, 약 2.2 MiB를 저장소에 보존한다. B 피드·원문 네 대표 화면과 펼친 도구·연결 결과를 직접 검토했다. 기본 원문의 첫 본문 시작 Y 좌표는 세 방향 모두 1440/820px에서 278, 390px에서 289px다. 수치는 비교 설정이 접힌 기본 상태의 배치 관찰값이며 읽기 시간이나 선호를 측정한 결과는 아니다.

## 실행 기록과 수정

| 보고서 | UTC 시작 시각 | 범위 |
| --- | --- | --- |
| `.local/design-review/minimal/report.json` | `2026-10-03T16:55:32.268Z` | 기본 78개 장면을 모두 검사·캡처한 뒤, 비교 설정의 테스트 선택자가 body와 button 두 요소를 골라 중단 |
| `.local/design-review/minimal/interactions-report.json` | `2026-10-03T16:57:39.139Z` | 선택자를 button으로 한정한 뒤 45개 동작·12개 펼친 상태·B 연결 장면 완료. 제품 코드 수정 없이 정상 장면 재실행 생략 |
| `.local/design-review/minimal/source-disclosure-report.json` | `2026-10-03T16:59:51.934Z` | 후속 출처 표시 수정 후 390/1440px 두 장면·흐름 통과 |

첫 중단은 제품의 런타임 오류가 아닌 검사 선택자 오류였다. `completed=false`와 원인을 기록했고, 두 번째 보고서에서 상호작용 전체 완료를 확인했다. 중복 실행한 Color 일부 흐름을 최종 수치에 더하지 않았다.

후속 코드 검토에서는 오래 읽은 뒤 고정 출처 아이콘을 눌렀을 때 정보가 화면 위에 열려 보이지 않는 실제 문제를 찾았다. 열기 전 읽던 위치를 보관하고, 정보에 초점을 옮겨 고정 도구막대 아래로 이동하며, 닫으면 원래 위치·아이콘으로 돌아오도록 수정했다. 정상 기본 화면에는 영향이 없어 두 화면 폭의 해당 흐름만 추가 검사했다.

## 재현과 한계

별도 터미널에서 `npm run dev`를 실행하거나 이미 떠 있는 로컬 서버를 사용한다.

```sh
node scripts/check-social-preview.cjs
```

B의 연결된 원문·발췌·내 생각 캡처만 갱신하려면 `node scripts/check-social-preview.cjs --connected-only`를 사용한다. 기본 주소는 `http://127.0.0.1:4173`이며 `BASE_URL`은 localhost 계열만 허용한다. 기존 Playwright와 Chromium을 사용하고, 새 패키지나 운영 자격 증명은 필요하지 않다.

동작만 이어 확인하는 명령은 `node scripts/check-social-preview.cjs --interactions-only`, 긴 읽기 뒤 출처 표시만 확인하는 명령은 `node scripts/check-social-preview.cjs --source-disclosure-only`다. 각 명령은 별도 보고서에 기록하며, 기본 78개 장면을 다시 검사한 것으로 보고하지 않는다. 인자 없는 명령은 기본 장면·모든 상호작용·연결 캡처·출처 후속 검사를 함께 재현한다.

독립 시안은 익명 샘플과 메모리 상태만 사용한다. Linux Chromium의 화면 크기·터치 모사는 실제 Mac/iPad/iPhone·Apple 글꼴·한글 IME·VoiceOver·터치 선택 손잡이 검증이 아니다. DOM Range 선택은 운영 Core의 원문 버전·raw UTF-16 위치 보존을 대체하지 않는다. 기존 운영 앱을 변경하지 않은 이번 시안 작업을 이유로 과거 기능 회귀 수치를 새 검사 결과로 다시 보고하지 않는다.
