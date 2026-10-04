# Life 기준 전체 사이트 재구성

2026-10-04 · `life.html`의 본문 중심 피드를 홈·관리·도구·연표·인증 화면의 공통 기준으로 적용했다. 비교 기준은 앞선 통합 홈 `9d8501f`다. 자료를 읽기 전에 보이던 별도 계정줄·복귀줄·큰 요약 영역을 줄이고, 실제 목록과 편집 내용을 같은 위계로 배치했다.

## 발견한 문제와 변경

| 이전 문제 | 적용한 구성 |
| --- | --- |
| 홈에는 피드, 목표·습관에는 카드와 이전 테마가 남아 서로 다른 앱처럼 보임 | 흰 표면, 한글 산세리프, 700px 본문, 얇은 구분선과 같은 목록 간격 |
| 계정·뒤로가기·제목이 여러 행에 분산됨 | 56px 제목 행에 복귀·제목·화면 조작·계정을 정렬 |
| 자료 관리 진입을 펼쳐야 백업·동기화를 찾을 수 있음 | 현재 작업공간·자료 백업·동기화·연표 백업을 바로 보이는 행으로 구성 |
| 연표의 큰 수치와 장식이 차트보다 먼저 보임 | 실제 차트를 앞에 두고 문서 전환·요약 수치는 정보 아이콘에서 펼침 |
| 목표·습관의 작은 조작, 입력 글자, 낮은 삭제 글자 대비 | 44px 메뉴·폼, 16px 입력, 명확한 초점·선택 상태와 오류 색 |
| 연표 SVG의 축·선택 글자가 CSS `color`만 검사하면 누락됨 | 실제 `fill`과 상위 opacity까지 측정하고 축·날짜·선택 글자의 대비 보정 |

기록·도구·관리의 세 메뉴와 승인된 A 인용 아이콘은 유지한다. 홈과 기존 `life.html` 주소는 같은 자료 UI를 사용한다. 가져오기·원문·발췌의 내부 데이터 흐름은 그대로 두고 제목과 진입 조작을 같은 프레임으로 정리했다. 백업에서 복원 가능한 JSON과 다른 앱에서 읽는 Markdown을 구분하고, 자료 백업과 연표·목표·습관 백업의 범위를 명시했다.

## 전후 화면

같은 익명 한글 자료 6개·발췌 12개, 긴 제목의 목표·습관·연표 각 8개를 사용했다. 실제 사용자 계정·자료·Auth 토큰은 캡처하지 않았다. 아래는 전체 1440·820·390px 검토 중 대표 화면이다.

| 장면 | 이전 | 변경 후 |
| --- | --- | --- |
| 기록 피드 · 1440 | [이전](evidence/life-design-site/before-home-feed-desktop.png) | [변경](evidence/life-design-site/after-home-feed-desktop.png) |
| 도구 · 1440 | [이전](evidence/life-design-site/before-home-tools-desktop.png) | [변경](evidence/life-design-site/after-home-tools-desktop.png) |
| 관리 · 390 | [이전](evidence/life-design-site/before-home-manage-phone.png) | [변경](evidence/life-design-site/after-home-manage-phone.png) |
| 계정 확인 오류 · 390 | [이전](evidence/life-design-site/before-home-error-phone.png) | [변경](evidence/life-design-site/after-home-error-phone.png) |
| 목표 목록 · 1440 | [이전](evidence/life-design-site/before-goals-list-desktop.png) | [변경](evidence/life-design-site/after-goals-list-desktop.png) |
| 목표 편집 · 390 | [이전](evidence/life-design-site/before-goals-form-phone.png) | [변경](evidence/life-design-site/after-goals-form-phone.png) |
| 습관 목록 · 390 | [이전](evidence/life-design-site/before-habits-list-phone.png) | [변경](evidence/life-design-site/after-habits-list-phone.png) |
| 습관 편집 · 820 | [이전](evidence/life-design-site/before-habits-form-tablet.png) | [변경](evidence/life-design-site/after-habits-form-tablet.png) |
| 연표 목록 · 1440 | [이전](evidence/life-design-site/before-workspace-list-desktop.png) | [변경](evidence/life-design-site/after-workspace-list-desktop.png) |
| 연표·도구 백업 · 390 | [이전](evidence/life-design-site/before-workspace-manage-phone.png) | [변경](evidence/life-design-site/after-workspace-manage-phone.png) |
| 로그인 · 390 | [이전](evidence/life-design-site/before-login-phone.png) | [변경](evidence/life-design-site/after-login-phone.png) |
| 연표 차트 · 1440 | [이전](evidence/life-design-site/before-timeline-chart-desktop.png) | [변경](evidence/life-design-site/after-timeline-chart-desktop.png) |
| 연표 차트 · 390 | [이전](evidence/life-design-site/before-timeline-chart-phone.png) | [변경](evidence/life-design-site/after-timeline-chart-phone.png) |
| 연표 기록 목록 · 820 | [이전](evidence/life-design-site/before-timeline-records-tablet.png) | [변경](evidence/life-design-site/after-timeline-records-tablet.png) |
| 연표 편집 · 390 | [이전](evidence/life-design-site/before-timeline-form-phone.png) | [변경](evidence/life-design-site/after-timeline-form-phone.png) |
| 자료 백업·복원 · 390 | 이번 검토에 추가 | [변경](evidence/life-design-site/after-home-transfer-phone.png) |

큰 화면에서는 제목과 피드 시작선을 맞췄다. 좁은 화면에서도 제목·아이콘·아래 메뉴를 고정된 규칙으로 배치하고 긴 한글 제목은 줄여 숨기지 않는다. 안내문은 단어 단위 줄바꿈을 적용했다. 연표는 좌표를 보존하기 위해 넓은 작업 영역을 허용하고 기록 목록은 읽기 폭을 따른다.

## 재사용과 유지관리

[기존 오픈소스·제품 비교](references.md), [Impeccable 4.5.0 지침 설치](impeccable.md), [Lucide 고지](../../vendor/lucide/README.md)를 재사용했다. 공식 패키지 버전이나 라이선스를 이번에 바꾸지 않았으며 새로운 프레임워크·폰트·아이콘 라이브러리를 도입하지 않았다. 승인된 Life 컴포넌트와 네이티브 버튼·폼·details로 필요한 화면을 구성할 수 있다.

`haedo-shell.css`는 전역 메뉴·제목 행·계정 메뉴, `life/ui.css`는 자료 UI, `platform.css`는 목표·습관·연표 목록·로그인·개인정보, `timeline-shell.css`는 연표 편집 화면을 담당한다. 도구와 로그인 화면에서 불필요한 연표 `app.css`·daisyUI 및 중복 SVG 정의를 제거했다. 연표 엔진은 기존 CSS와 daisyUI를 유지한다. 원격 폰트 요청은 제거하고 Life의 시스템 한글 글꼴을 사용한다.

디자인 책임자 root가 공통 규칙과 홈을 통합했다. unified_shell은 플랫폼 화면, management_plan은 연표, sequence_review는 독립 기능·시각 검토를 담당했다. 새 화면은 [DESIGN.md](../../DESIGN.md)와 [디자인 스킬](../../.agents/skills/life-haedo-design/SKILL.md)의 공통 제목 행·목록·아이콘 기준을 따른다.

## 검증

- 정적 검사: HTML 16개, JavaScript 34개, 참조 186개와 PWA 검사 통과.
- Node 회귀: **188/188**. 날짜·자료·동기화·인증·서비스워커·공개 산출물 계약을 포함한다.
- 기존 브라우저 기능: 통합 홈 **12/12**, 자료 읽기·가져오기·보관 **23/23**, 발췌·출처 복귀 **6/6**, 플랫폼 공용 인증·백업·PWA **9/9**, 플랫폼 가져오기 **3/3**. 합계 **53/53**이며 실제 Google 로그인이나 운영 DB RLS 검증은 아니다.
- 추가 플랫폼 흐름 5개: 목표 편집·완료·재로드, 습관 편집·체크·오류·재로드, 연표 생성·백업과 제목 행·조작 크기를 확인했다.
- 추가 연표 흐름 12개: 세 폭에서 요약 정보·Escape, 기간·격자·설정·파일 메뉴, 새 문서·붙여넣기·검색 취소, 기존 사건 저장·실행 취소를 확인했다. 지연된 smooth scroll이 열린 파일 메뉴를 닫던 문제는 연표에만 즉시 스크롤을 적용해 해결했다.
- 서비스워커 `haedo-v57` → `haedo-v58` 업데이트에서 기존 로컬 자료와 가져오기 초안을 보존했다. 공개 허용 목록과 캐시에 새 연표 CSS를 포함했다.
- 예기치 않은 console/pageerror와 운영 Supabase 쓰기는 0건이다. 의도한 오프라인·인증 오류는 따로 집계했다.

시각 검사와 기능 검사는 별도로 수행했다. `scripts/check-site-design.cjs`는 익명 HTTP와 실제 Chromium 렌더링을 사용한다. 고정된 이전 화면 72장면, 변경 후 75장면을 1440·820·390px에서 확인한다. 변경 후에는 자료 백업 3개 폭을 추가했으므로 두 실행의 원시 검사 개수를 같은 모집단처럼 비교하지 않는다. 검사기는 실제 표면·SVG fill·상위 opacity를 반영하며, 유한 등장 애니메이션이 끝난 뒤 측정한다.

이전 513항목 중 39개 기준 미달, 변경 후 534항목 중 528개 통과·6개 미달이다. 남은 6개는 차트/편집 화면의 작은 공간 표식을 세 폭에서 검출한 것으로, 감사 명령은 이를 숨기지 않고 종료 코드 1을 유지한다. 메뉴·폼·목록의 44px 미달, 가로 넘침, 이름 없는 조작, 16px 미만 입력, 측정한 텍스트 대비 미달은 0건이다. 검사한 텍스트의 최저 대비는 6.05:1이며, SVG 키보드 초점은 3px·7.286:1이다. 전체 WCAG 적합성 인증을 뜻하지 않는다.

조밀한 연표 사건·기간 표식은 44px 기준에 미달한다. 크기를 일괄 확대하면 이웃 표식과 겹치므로 차트 좌표와 hit 영역은 유지했다. 같은 사건의 44px 이상 기록 목록과 키보드 Enter 편집 경로를 세 폭에서 확인했다. 이 제한을 메뉴·폼의 44px 통과와 혼동하지 않는다. 작은 표식의 실제 터치 정확도는 실기 검토가 남아 있다.

이번 브라우저 폭·터치 모사는 실제 Mac·iPad·iPhone 검증이 아니다. 한글 IME, Files, VoiceOver, 선택 손잡이, 실제 Google 로그인과 앱 전환은 이번 변경에서 검증하지 않았다. 라이브 Chromium은 클라우드 프록시 인증서 오류로 열리지 않았던 환경이므로, 공개 배포 파일의 HTTPS 검증과 라이브 브라우저 체험도 구분한다.

## 보존 범위와 직접 확인

로그인·계정별 저장·명시적 동기화 연결·백업 형식·원문 버전·출처·UTF-16 발췌 구간을 변경하지 않았다. 연표의 좌표·집계·저장 알고리즘과 의미별 색상은 보존하고 읽기 어려운 텍스트 대비만 보정했다. LPE 저장소 가져오기, SQL 재설치, 실자료 정리는 수행하지 않았다.

로컬은 `npm run dev` 후 `http://127.0.0.1:4173`, 공개 화면은 [해도](https://wonchance-art.github.io/life-haedo/)에서 확인한다. 로그인 → 기록 읽기 → 도구에서 목표·습관 열기 → 기록의 연표 열기 → 관리에서 두 백업 범위 확인 순서로 체험할 수 있다. 코드 반영과 실제 배포 완료는 PR의 CI·Pages 결과로 별도 기록한다.
