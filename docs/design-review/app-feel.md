# 본문 중심의 앱 표면 개선

2026-10-05. 사용자의 “더 깔끔하게, 옅은 색으로 생기 있게, 웹보다 앱처럼” 요청을 적용했다. 기준은 공개 게시 PR #30의 `1325f2a`다. root가 디자인·공통 컴포넌트·통합을 맡고, 탐색 셸·홈·공식 자료 조사·독립 QA를 나눴다. 기존 로그인·원문·저장·동기화·백업·공개 게시의 런타임 JavaScript와 SQL은 변경하지 않았다.

## 달라진 화면

본문은 흰색으로 유지하고 바깥 바탕을 아주 옅은 라벤더로 구분했다. 보라는 선택·주요 행동, 민트는 내 코멘트·비공개 표시·완료 상태, 스카이는 일부 도구 아이콘에만 쓴다. 원문마다 큰 색 카드를 만들지 않는다. 공통 SVG와 승인한 A 인용 도형을 그대로 사용한다.

- 넓은 화면은 최대 820px의 흰 앱 표면과 작은 측면 탐색을 사용한다. 읽기 열은 최대 700px다.
- 700px 이하에서는 전체 너비 본문과 4개 아이콘의 하단 탐색을 사용한다. 안전 영역·본문 끝·키보드 초점 여백을 함께 확보한다.
- 검색·해제·필터를 하나의 옅은 조작면으로 묶고, 반복 여백을 줄였다. 선택된 메뉴·버튼에는 색과 기존 접근성 상태를 함께 표시한다.
- 내 코멘트는 옅은 민트 바탕으로 원문과 구별한다. 실제 원문의 글자·줄바꿈·선택 구간은 바꾸지 않는다.
- 기존 목표·습관·연표 목록의 native dialog는 휴대폰에서 하단 시트로 열린다. 기존 취소·저장·초점·Escape 동작을 사용하며 드래그 동작을 새로 약속하지 않는다.
- 홈의 출처와 날짜는 컨테이너가 넓을 때만 같은 줄로 배치한다. 낮은 가로 창에서는 원문 앞의 도구·제목 간격을 줄인다.
- 버튼의 150–160ms 색 반응, 터치 hover 억제, 모션 감소·강제 색 지원을 적용했다. PWA 시작 색상과 viewport 안전 영역도 맞추고 서비스워커를 `haedo-v65`로 갱신했다.

| 같은 샘플 | 변경 전 | 변경 후 |
| --- | --- | --- |
| 홈 1440px | [보기](evidence/app-feel/before-home-1440.png) | [보기](evidence/app-feel/after-home-1440.png) |
| 기록 390px | [보기](evidence/app-feel/before-records-390.png) | [보기](evidence/app-feel/after-records-390.png) |

[휴대폰 홈](evidence/app-feel/after-home-390.png) · [원문 읽기](evidence/app-feel/after-reader-390.png) · [태블릿 도구](evidence/app-feel/after-tools-820.png) · [목표 편집 시트](evidence/app-feel/goals-form-phone.png) · [습관](evidence/app-feel/habits-list-phone.png) · [로그인 전 홈](evidence/app-feel/home-welcome-desktop.png) · [낮은 가로 읽기](evidence/app-feel/after-split-reader-844.png)

## 선택 근거와 유지할 기준

[공식 플랫폼·오픈소스 비교](app-feel-references.md)에서 Open Props 1.7.23의 토큰 구조를 참고했다. Floating UI DOM 1.8.0은 실제 위치 충돌 문제가 생길 때만 재검토하며, 유지관리 중단이 명시된 Vaul 1.1.2는 도입하지 않았다. 새 런타임 패키지나 프레임워크는 없다. Impeccable 4.5.0의 프로젝트 지침을 직접 참고했으며 launcher·자동 검사 엔진을 실행한 결과로 표시하지 않는다.

크기 container query·safe area·svh/dvh·`:has()`는 제한된 배치와 조작에 사용한다. 기본 한 열·기존 `aria-*`·문서 스크롤을 유지한다. 전체 화면 View Transitions는 계정 변경·공개 철회 때 과거 본문을 캡처하는 문제와 원문 선택 계약을 고려해 넣지 않았다. 모든 내용을 고정 높이 안에 가두거나 새 제스처를 추가하지 않는다.

후속 기능도 [DESIGN.md](../../DESIGN.md)와 [프로젝트 디자인 스킬](../../.agents/skills/life-haedo-design/SKILL.md)의 토큰·간격·접근성 기준을 재사용한다. 연표의 날짜·값·곡선·통계·차트 의미 색은 유지하며 바뀐 것은 공통 탐색과 하단 여백이다.

## 기능 검사와 시각 검토

검증에는 기존 익명 한글 6원문·12문장, 긴 제목의 목표·습관·연표 샘플을 사용했다. 개인 기록이나 운영 계정 세션을 복사하지 않았다. 실제 SDK·IndexedDB·서비스워커를 실행했지만 Auth·공유 서버는 HTTP 모사다. 운영 DB·Auth 설정·자료를 쓰지 않았다.

| 검사 | 이번 실행 결과 |
| --- | --- |
| 정적 검사·Node | HTML 17 / JS 41 / 참조 222 / PWA, Node **229/229** |
| 통합 탐색·인증 경계 | **13/13**: 초안 보존, 계정 변경, 복귀·기존 주소 |
| 공개 사본 기능 | **17/17**, 별도 화면 **21상태**: 검토·게시·갱신·철회·재시도·관리 |
| 집중 UI 기능 | **3/3**: 하단 조작 초점·터치 발췌·검색 복귀·백업/원문 불변 |
| 플랫폼·PWA | **9/9**: 가져오기·복원·로그아웃 실패 보존·오프라인·업데이트 |
| 홈·기록·읽기·도구·관리 | 전 15장 / 후 **36장**, 1440·820·390 및 600·844×390, **189/189** 세부 점검 |
| 로그인·목표·습관·연표·폼 | **33장**, **240/240** 세부 점검 |

일반 조작 44px, 입력 16px, 가로 넘침·이름 없는 조작·의도하지 않은 콘솔/페이지 오류를 확인했다. 위 시각 검사 최소 글자 대비는 **5.661:1**이다. 네 메뉴와 20px 도형 정렬, reduced-motion·forced-colors도 확인했다. 연표의 기존 공간 표식은 높이 26–33px인 예외로 별도 기록하며, 같은 기록을 여는 44px 목록과 키보드 Enter 경로를 검사했다. 이를 모든 차트 표식의 44px 통과로 합치지 않는다.

첫 844×390 검토에서 읽기 본문이 화면 아래로 밀리는 것을 발견했다. 낮은 높이의 여백을 보완하고 해당 3장만 재검증해 본문 시작점이 약 **375→271px**로 올라왔다. 원문 글자 크기를 줄인 결과가 아니다. iPhone 가로 회전의 좌우 안전 영역은 CSS 환경값 치환으로 6조합을 추가 검사했으며 실제 notch/키보드 기기 검사와 구별한다.

기존 사이트 검사에 남아 있던 3개 메뉴 가정과 플랫폼 회귀의 오래된 ‘원천 기록’ 버튼 이름을 현행 4개 메뉴·‘기록 검색’에 맞췄다. 연표 공간 표식의 기존 예외와 일반 조작 검사를 구분했다. 초기 실패와 수정 후 결과를 별도로 보존하며 검사 기준 수정만으로 기존 실패를 숨기지 않는다.

`1325f2a`의 실제 v64 파일을 별도 보존해 v65로 업데이트했다. 이전 원문·미적용 초안·로컬 연표 키가 그대로이고 새 캐시의 주요 모듈 해시가 준비한 산출물과 일치했다. 공개 `share.html`과 공개 본문은 기존처럼 오프라인 사본으로 캐시하지 않는다.

[검증 집계](evidence/app-feel/verification-summary.json) · [독립 육안 검토](evidence/app-feel/visual-review.md) · [플랫폼 측정](evidence/app-feel/platform-report.json) · [집중 기능](evidence/app-feel/browser-report.json) · [탐색 셸](evidence/app-feel/shell-report.json) · [안전 영역 모사](evidence/app-feel/safe-area-report.json) · [PWA 회귀 로그](evidence/app-feel/pwa-regression.log)

## 재현과 남은 실기 범위

`npm run dev`로 서버를 열고 해당 주소를 `BASE_URL`에 지정한다. 예: `BASE_URL=http://127.0.0.1:4173 node scripts/check-app-feel-design.cjs`, `node tests/app-feel-browser.cjs`, `node tests/unified-home-browser.cjs`, `node tests/life-share-browser.cjs`. 주소가 다른 경우 각 명령에도 같은 `BASE_URL`을 전달한다. 전체 플랫폼 검사는 `SITE_DESIGN_OUTPUT=.local/app-feel/platform node scripts/check-site-design.cjs`처럼 새 출력 경로를 지정해 이전 감사 자료를 보존한다.

기능·화면 크기 검사를 실제 Mac/iPad/iPhone의 IME·Files·VoiceOver·가상 키보드·앱 전환 체험으로 보고하지 않는다. 운영 Google 로그인이나 실제 소유자의 공개 게시·철회를 이번 디자인 회귀에서 다시 수행한 것도 아니다. 커밋한 사진은 대표 화면이며 전체 캡처와 실행 로그는 `.local/app-feel/`에 있다.
