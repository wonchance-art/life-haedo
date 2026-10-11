# 컬렉션 상호작용 시안

실제 앱과 분리된 비교용 화면이다. 가상의 작품명·창작자·표지 12개를 사용한다. 본문·항목·선택은 메모리에만 있으며 새로고침하면 초기화된다. 개인 자료를 입력하지 않는다.

저장소 루트에서 `python3 scripts/dev-server.py --port 4189` 실행 후 같은 컴퓨터의 브라우저에서 경로 `/docs/prototypes/collection-space/`를 연다. Cloud의 loopback 주소는 외부 접속 링크가 아니다. 종료는 서버 터미널에서 Ctrl+C.

1. A/B를 바꿔 같은 자료의 표지 중심 / 메모 중심 배치를 비교한다.
2. 음악·책·도구 필터, 모음 선택, 제목·만든 사람·메모 검색을 사용한다.
3. 항목을 열어 메모를 바꾸고 Escape로 돌아온다.
4. 연필 → 컬렉션에서 고르기 → 앨범·책·도구 선택 → 글에 연결. 선택 취소와 연결 해제도 체험한다.
5. 더하기에서 표지 없는 항목을 직접 입력한다. 실제 저장이 아니다.
6. 아래 시안 검토 도구에서 84개, 로딩, 오류를 살핀다. 오류의 다시 시도는 상태 모사다.

자동 메타데이터·외부 이미지·YouTube iframe·계정·IndexedDB·동기화·공개·백업은 연결하지 않았다. CSP도 외부 연결/프레임/폼 전송을 막는다. 제목·메모를 HTML로 해석하지 않는다.

검증: `BASE_URL=http://127.0.0.1:4189 node tests/collection-space-prototype-browser.cjs`.
필요 시 기존 설치의 `PW_MODULE_PATH`, `CHROMIUM_PATH`를 지정한다. 운영 앱에 새 패키지를 설치하지 않는다.

[설계·검토·Local 인계](../../design-review/collection-space.md)
