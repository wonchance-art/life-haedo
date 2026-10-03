# 따옴표와 아이콘 정렬 보정

2026-10-04 KST. 기존 시안의 각진 따옴표를 두 개의 둥근 닫는 인용부호로 바꾸고, 메뉴·원문 도구·자료 행동의 아이콘을 같은 계열로 맞췄다. 본문 배치와 기능은 그대로다.

[Lucide 1.51.0](../../vendor/lucide/README.md)의 SVG 13개만 로컬로 재사용했다. 24×24 좌표계·2단위 둥근 선을 유지하고, 메뉴는 20×20px 그림을 44×44px 조작 영역의 가운데에 둔다. 선과 끝 모양을 통일하되 더하기·북마크처럼 형태 자체의 자연스러운 너비 차이는 유지한다. SVG를 block으로 배치해 글자 기준선에 따라 뜨는 여지를 없애고 검색 입력의 돋보기도 수직 중앙에 맞췄다.

- [하단 메뉴 가까이 보기](evidence/icons/navigation-detail.png)
- [읽기 도구 가까이 보기](evidence/icons/reader-tools-detail.png) — 북마크를 선택한 상태
- 원문: [1440px](evidence/icons/thread-reader-1440.png) · [820px](evidence/icons/thread-reader-820.png) · [390px](evidence/icons/thread-reader-390.png)
- 목록: [1440px](evidence/icons/thread-feed-1440.png) · [820px](evidence/icons/thread-feed-820.png) · [390px](evidence/icons/thread-feed-390.png)

Linux Chromium에서 세 화면 폭의 목록/원문 6장면을 확인했다. 표시된 아이콘의 20px 영역·버튼 중심 일치·44px 조작 영역·접근 가능한 이름·선 굵기·SVG 도형의 경계 내 배치를 측정했다. 각 폭에서 키보드로 발췌 열기·닫기와 초점 복귀, 담기, 출처·필터 열기/Escape 닫기, 인용부호 메뉴로 내 발췌 이동을 확인했다. 콘솔/페이지 오류·외부 요청·가로 넘침은 0건이다. 대표 화면과 메뉴·도구 확대 캡처는 직접 눈으로도 검토했다. 확인용 스크립트와 보고서는 `.local/design-review/icons/`에 둔다.

정적 HTML 15/JS 31/참조 167/PWA 검사도 통과했다. 원본 SVG·라이선스 파일의 해시와 임베드한 도형을 고정 원본과 대조했다. 기존 03 전체 행위 검사를 다시 실행했다고 보고하지 않는다. 실제 Apple 기기·운영 배포는 이번 확인 범위 밖이다. 로컬 실행은 `npm run dev` 후 `social-sample.html`에서 확인한다.
