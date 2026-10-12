# 현재 제품 화면에서 가져온 컬렉션 탐색 패턴

확인·적용: 2026-10-12. 대상은 독립 시안 `docs/prototypes/collection-space/`다. 현재 공개 제품의 관찰 가능한 화면을 참고했으며, 이를 업계 전체의 유행이나 실제 앱 통합 완료로 주장하지 않는다.

## 관찰과 선택

| 공식 출처 | 직접 확인한 화면 | 해도에 채택한 부분 | 확인하지 못했거나 가져오지 않은 부분 |
| --- | --- | --- | --- |
| [Cosmos Explore](https://www.cosmos.so/explore) | HTTP 200. 검색, 가로 주제 탐색, Selected by Cosmos와 Explore elements 구분 | 짧은 상단 탐색, 검색 우선 배치, 가로 분류 | 이미지/피드가 자리표시자로 남았다. 추천 품질·로그인 후 동작은 검증하지 않았다. |
| [Are.na Search](https://www.are.na/search) | HTTP 200. 검색과 Where / Types / Fields / Order 필터 축 | 모음 범위와 자료 종류의 분리, 현재 선택 범위 표시, 최소 프레임 | 결과 피드는 로딩되지 않았다. 세부 선택 옵션과 계정 기능은 확인하지 않았다. |
| [Cosmos](https://www.cosmos.so/) · [Are.na](https://www.are.na/) | HTTP 200. 공식 제품 소개와 상단 구조 | 자료 수집·연결 중심이라는 제품 목적을 비교 | Cosmos 홈 이미지 119개 중 로드 확인 0. 홈페이지 이미지를 완전히 본 것으로 보고하지 않는다. |
| [Raindrop](https://raindrop.io/) · [공식 컬렉션 도움말](https://help.raindrop.io/collections/) | 프록시 연결 거절 `ERR_TUNNEL_CONNECTION_FAILED` | 이번 검증 근거에서 제외 | 우회하지 않았다. |

참고 화면: [Cosmos](evidence/collection-current-patterns/cosmos-explore.png), [Are.na](evidence/collection-current-patterns/arena-search.png). 공개 비로그인 화면을 Chromium으로 직접 열었다. 타 서비스의 코드·사진·로고를 복제하지 않았다. 이들은 제품 디자인 참고 자료이며 오픈소스 배포본이 아니다.

새 라이브러리는 필요하지 않았다. 기존 아이콘, CSS Grid, DOM 버튼, 네이티브 가로 스크롤을 재사용했다. 기존 도입 라이선스 계약을 바꾸지 않았으며, 계정/피드/추천 엔진을 새로 도입하지 않았다.

## 적용 결과

- 상단의 반복 경로·A/B 설명 줄을 정리하고, 내 페이지와 추가/글쓰기 조작을 제목 옆에 모았다. 시안 안내는 남기되 자세한 검토 설명은 접었다.
- 검색·모음 → 큰 분류 → 필요한 경우 세부 종류 → 자료 순서다. 큰 분류는 콘텐츠·작품 / 도구·서비스 / 인물 / 장소 / 기타를 유지한다. 종류와 사용자가 만드는 주제 모음을 하나의 계층으로 합치지 않는다.
- 좁은 화면에서는 분류가 가로 스크롤된다. 키보드로 선택한 항목도 보이게 이동한다. 현재 범위와 결과 수를 표시하며 종류 해제는 검색어·모음을 보존한다. 로딩 중에도 선택 범위를 갱신한다.
- 표지/메모 전환은 접근 가능한 이름이 있는 기존 아이콘으로 표시한다. 설명은 시안 검토 영역에서 확인한다.
- 공통 카드 바탕을 걷어내고 앨범의 정사각형, 책/영화/작품 비율, 인물의 원형을 유지했다. 밝은 기본면과 옅은 보라·민트 선택 상태만 사용한다.
- 기존 취향 페이지에서 생성한 가상 앨범 이미지 세 장을 재사용했다. 책 표지는 가상 타이포그래피, 영화/예술 작품은 이미지 미연결 표시다. 실제 표지 자동 조회로 표현하지 않는다.

[이전 분류 화면](evidence/category-collections/categories-390.png)과 같은 가상 자료를 사용한다. 이번 적용: [1440px](evidence/collection-current-patterns/library-1440.png), [820px](evidence/collection-current-patterns/library-820.png), [390px](evidence/collection-current-patterns/library-390.png), [세부 종류 390px](evidence/collection-current-patterns/content-390.png).

## 검증과 한계

`PW_MODULE_PATH=/workspace/life-haedo/tests/browser-ci/node_modules/playwright COLLECTION_PROTOTYPE_OUTPUT=.local/current-design-library node tests/collection-space-prototype-browser.cjs` — 56개 통과. [결과 JSON](evidence/collection-current-patterns/library-report.json).

1440·820·390px, 긴 한글 제목, 126개 자료, 빈/로딩/오류, 키보드 초점, 터치 모사, 쓰기 선택/취소, 비공개 메모 제외, 직접 입력을 확인했다. 검사한 텍스트 대비 최솟값 5.57:1. 페이지/콘솔 오류와 예상 밖 외부 요청 0, 영속 저장소·서비스워커·iframe 0. 자동 검사와 별개로 스크린샷의 카드 정렬·여백·탐색 높이·형태 구분을 확인했다.

`npm run check`의 HTML 18 / JS 59 / 참조 271 / PWA 통과. 실제 앱 기능 회귀 전체와 변경하지 않은 취향 페이지 검사를 이번 작업에서 다시 실행했다고 보고하지 않는다. 취향 페이지의 직전 44개 통과는 앞선 분류 작업 결과다.

Linux Chromium 151 화면 폭 검증이다. 실제 iPad/iPhone/Mac, VoiceOver, 한글 IME, 실제 개인 자료와 외부 이미지 권리는 미검증이다. 가로 분류의 숨겨진 항목 발견성이 실제 터치에서 부족하면 명시적 펼치기 방식과 비교한다. 모든 종류에 대표 이미지가 갖춰진 최종 시각 품질도 아직 평가할 수 없다.

## Local 인계와 다음 순서

기존 실행 방법: 저장소 루트에서 `python3 scripts/dev-server.py --port 4189`, 같은 기기에서 `/docs/prototypes/collection-space/`를 연다. 실제 보관 자료가 아닌 메모리 시안으로 새로고침하면 초기화된다. 이 Cloud의 loopback 주소를 외부 링크로 제공하지 않는다.

초안 PR #65에 포함한다. 병합·배포는 Local 담당이며 docs를 공개 배포 허용 목록에 추가하지 않는다. 운영 SQL·인증·동기화·백업·공개 범위는 변경하지 않았다.

1. Local 최신 코드와 대조해 컬렉션·취향 페이지의 실제 저장 계약 및 연결 지점을 확정한다.
2. 정식 메타데이터 제공처·이미지 표시 권리를 검토하고, 수동 입력을 보존하며 제목/출처/표지를 연결한다.
3. 실제 기기의 분류 탐색·편집·복구를 검증한다. 개인 메모와 명시적으로 공개할 내용을 구분한다.
