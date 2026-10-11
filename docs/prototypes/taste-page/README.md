# 취향 페이지 · 실제 브라우저 시안

2026-10-11. 기존 컬렉션 가상 자료를 사용한 편집 가능한 독립 페이지다. AI로 만든 비교 이미지가 아니라 HTML/CSS/JavaScript로 동작한다. 표지 배경만 AI 생성 샘플이며 실제 앨범·책이 아니다.

저장소 루트에서 `python3 scripts/dev-server.py --port 4189`를 실행한다. 같은 컴퓨터의 브라우저에서 `/docs/prototypes/taste-page/`를 연다. Cloud loopback 주소는 외부 접속 링크가 아니다. 서버 종료는 Ctrl+C. 기존 `/docs/prototypes/collection-space/`의 **내 페이지 꾸미기**로도 이동한다.

1. **꾸미기**에서 전시 / 글 중심 / 보관함 배치를 비교한다.
2. 제목·소개·내 문장·대표 앨범을 변경한다. 고딕/명조, 강조색, 바탕, 여백을 조절한다.
3. 문장·만든 사람·섹션 표시를 바꾸거나 두 섹션의 순서를 바꾼다.
4. **미리보기 → 편집으로**를 왕복한다. 게시나 업로드는 하지 않는다.
5. **처음으로**로 초기화한 뒤 편집 패널을 닫고 상단 되돌리기를 사용한다.
6. 표지를 눌러 가상 정보와 메모를 확인하고 Escape로 돌아온다.

모든 편집은 페이지 메모리에만 있다. 새로고침·다른 페이지 이동 시 초기화된다. 운영 데이터·Auth·IndexedDB·동기화·공개 API·YouTube·외부 요청을 연결하지 않았다. 실제 저장 완료로 표현하지 않는다. 표시 숨김은 공개 권한 조작이 아니다. 시안에는 업로드 입력이 없다.

검사: `BASE_URL=http://127.0.0.1:4189 node tests/taste-page-prototype-browser.cjs`. 필요한 경우 기존 설치의 `PW_MODULE_PATH`와 `CHROMIUM_PATH`를 지정한다.

[참고 화면·전후·검증·Local 인계](../../design-review/taste-page.md)
