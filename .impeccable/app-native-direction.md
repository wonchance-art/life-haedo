# 앱다운 탐색과 반응 — 구현 계약

2026-10-18 Asia/Seoul. 모드: **Operate + Read**. 적용: 로그인 후 홈·자료실·도구·설정, 작성·저장 후 읽기·출발 화면 복귀. 기존 [시각 계약](blog-visual-direction.md)의 틸·흰 본문·Pretendard·한 열과 저장·공개·계정 경계를 유지한다.

사용자의 최신 앱다운 UX와 애니메이션 요청은 과거의 일괄적인 ‘본문 등장 모션 없음’을 **실제 화면 이동에 한해** 바꾼다. 입력 중 본문, 읽고 있는 문단, 화면에 들어온 각 글을 애니메이션 대상으로 만들지는 않는다.

## 구현 전 모션 논지

- **핵심 순간:** 홈의 글쓰기 → 작성 → 실제 저장된 글 읽기 → 그 글이 있는 홈. 작성은 아래에서 들어오고 읽기는 다음 화면으로, 뒤로가기는 반대 방향으로 짧게 연결한다. 저장 결과가 오기 전에는 성공 동작을 보이지 않는다.
- **연속성:** 상단 제목·뒤로가기와 전역 탐색은 안정된 기준점이다. 새 화면 push, 이전 화면 back, 같은 수준 tab의 관계만 이동으로 설명한다. 현재 메뉴의 별도 선택 표시가 목적지를 따라간다. 목록 탭·검색·표시 범위·정확한 항목·초점·페이지 위치와 작성 커서를 복원한다.
- **반응:** 누름 100ms, 탭 160ms, push 220ms, back 200ms, 작성 진입 260ms, 펼침 180ms, 실제 저장/실패 안내 180ms를 기준으로 한다. 자연스럽게 감속하는 `cubic-bezier(0.16, 1, 0.3, 1)`를 사용한다. 현재 상태·저장 결과는 글자와 접근성 속성이 설명하며 모션만으로 전달하지 않는다.
- **예산:** 현재 연결된 실제 요소에만 CSS/WAAPI transform·opacity를 적용한다. 화면 전체 캡처·View Transitions 스냅샷·DOM 복제·개인 자료의 별도 outgoing 캐시는 만들지 않는다. 문단별·스크롤 reveal, 반복 콘텐츠 모션, bounce, parallax, 상시 로딩 흉내는 없다.

## 상호작용과 복구

최종 소스 추출: 누름 100ms·색 140ms, 현재 탐색 표시 220ms, 저장/실패 안내 140ms다. 위의 구현 전 논지에서 제안한 안내 180ms는 더 즉각적인 결과 확인을 위해 140ms로 확정했다. 화면 이동·펼침 타이밍은 초기 기준을 유지한다. 실제 값은 [모션 CSS](../assets/haedo-motion.css)와 [모듈](../assets/haedo-motion.js)에서 확인한다.

같은 요소의 새 동작은 이전 애니메이션을 취소한다. 빠른 연속 이동은 최신 목적지를 우선하고 모션 완료를 저장·탐색·초점의 선행 조건으로 삼지 않는다. 숨겨진 탭·pagehide·모션 감소 설정에서는 공간 모션을 즉시 끝내고 현재 화면을 표시한다. WAAPI를 쓸 수 없어도 같은 조작과 결과를 정적으로 제공한다. 기본 콘텐츠는 항상 보인다.

브라우저의 문서 스크롤·텍스트 선택·caret·한글 조합·키보드 초점을 유지한다. 앱 느낌을 위해 본문을 별도 고정 높이 스크롤러에 가두거나 제스처를 가로채지 않는다. sticky 조작·하단 탐색·safe-area를 고려하되 가상 키보드 대응을 실기 확인 없이 검증됐다고 쓰지 않는다. 작성 중 모바일 탐색 숨김과 닫은 뒤 복원은 유지한다.

## 구현 선택

기존 일반 JavaScript와 CSS로 순서·취소·동적 좌표를 표현하므로 CSS transition + Web Animations API를 사용한다. Motion의 독립 JavaScript `animate`와 GSAP의 timeline도 후보지만 이 범위에는 의존성·라이선스 관리·오프라인 캐시·추가 API가 늘어난다. 새 패키지를 채택하지 않으므로 최신 패키지 조회나 버전 핀은 필요하지 않다. 복잡한 다중 요소 choreography가 실제 요구가 되고 플랫폼 구현의 유지 부담이 확인될 때 도입을 재검토한다.

공식 API 참고: [Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API), [Element.animate](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate), [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion), [Motion animate](https://motion.dev/docs/animate), [GSAP timeline](https://gsap.com/docs/v3/GSAP/Timeline/). 링크는 선택 비교의 참고 문서이며 이번 작업에서 최신 릴리스·보안·라이선스를 원격 조사했다는 뜻은 아니다.

## 완료 기준

1440·820·390px에서 실제 익명 한글 글의 작성→저장→읽기→목록 복귀와 영역 왕복을 확인한다. 빠른 중단·재진입, 저장 실패, reduced-motion, WAAPI 미지원, 숨겨진 탭, 키보드·커서·초점·스크롤·safe-area를 검증한다. 기능 결과·정지 이미지·실제 모션 관찰·실기·배포를 구분하며 실제 증거와 남은 한계는 [구현 검토](../docs/design-review/app-native-experience.md)에 기록한다.
