# 책 작업실 디자인 재검토

2026-10-09 KST · 디자인 책임자 root · **비교 완료 · 사용자 A안 선택 · 실제 앱 적용**

사용 목표는 책 선택 → 원고 읽기 → 해당 장 집필 → 같은 문단 재확인이다. 기능을 더하기보다 원고 앞의 상태·메뉴·중복 제목을 줄인다. 실제 앱 d65daee를 감사 기준으로 삼으며 PR #54는 #53을 기반으로 한 미병합 초안이다. 병합·배포는 Local이 담당한다.

## 두 방향의 계약

### A · 원고 중심

- THESIS: 책을 열기 전부터 내 문장이 보인다. 한 열에서 읽기와 집필을 오가며 반복되는 관리 폼을 전면에서 치운다.
- OWN-WORLD: 흰 본문, 아주 옅은 자주색 조작면, 짙은 포도색 선택. 한글 산세리프, 읽기 19px/1.95, 제목 32px, 680px 읽기 열. 아이콘은 기존 20px 공통 도형이다.
- STORY: 책 제목과 첫 문장으로 대상을 알아보고 목차에서 장을 고른다. 자료·내 해석은 명시적으로 열어 읽는다.
- FIRST VIEWPORT: 한 줄 도구 모음 아래 책 목록의 실제 제목·본문, 집필은 장 제목과 textarea, 읽기는 장 제목과 문단. 목차는 펼쳐 쓰며 원고 너비를 늘리지 않는다.
- FORM: 모바일에서도 같은 단일 문서. 장 편집 후 같은 문단으로 돌아오는 것이 핵심 상호작용이다. 정해진 제품 요구에 따른 코드 기반 비교 시안으로 seed/생성 comp는 사용하지 않는다.

### B · 편집 작업실

- THESIS: 장 사이를 자주 오가는 집필에서 목차 위치를 고정한다. 본문과 관리 정보를 한 열에 순서대로 쌓지 않는다.
- OWN-WORLD: 옅은 청회색 목차 면과 흰 본문, 청록색 현재 장. 읽기 17px/1.9, 제목 28px, 목차 248px. 같은 한글 산세리프와 공통 도형을 쓴다.
- STORY: 목록에서 책 구조와 앞부분을 함께 보고 장을 고른다. 전체 읽기에서도 목차로 이동하며 출처를 요청할 때 곁에서 대조한다.
- FIRST VIEWPORT: 왼쪽에 책·목차, 오른쪽에 원고. 820px에서는 목차 폭을 줄이고, 390px에서는 네이티브 장 선택 줄로 전환한다. 원문 패널은 기본 접힘이다.
- FORM: master/detail 작업 화면. 넓은 화면의 탐색 유지와 휴대폰의 단일 작업이 비교 핵심이다. 실제 저장·자동 분석·공개 기능을 흉내 내지 않는다.

두 안의 FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance. 이 단계에서는 **시안별 기준만 이 문서에 기록**하며 승인 전 실제 앱의 DESIGN.md/토큰은 교체하지 않는다. Impeccable 실행기·자동 detector는 미설치이므로 수동 브라우저 측정과 독립 검토로 범위를 명시한다.

## 자료와 보존 경계

동일한 `evidence/book-edition/reader-book-backup.json`에서 책·4개 장·정확한 원문 버전을 읽어 익명 시안 데이터를 생성한다. 제외된 해석은 본문으로 승격하지 않는다. 본문·출처·내 해석은 별도로 표시한다. 많은 자료 상태의 복제 제목은 시안의 가상 목록이며 원본 백업을 바꾸지 않는다.

시안은 메모리에서만 편집하며 새로고침하면 초기화된다. 앱의 로그인·IndexedDB·동기화·공개 API·서비스워커에 연결하지 않는다. 브라우저에서 직접 실행하는 독립 HTML과 개발용 소스만 추가한다. Pages 공개 빌드 허용 목록은 변경하지 않는다.

## 결과

사용자가 비교 후 **A · 원고 중심**을 선택했다. 두 시안은 선택 근거를 보존하며 실제 앱에는 A만 적용한다.

- [A안 실제 앱 적용](book-design-reset-integration.md): 직접 체험 경로·입력/복귀 개선·검증·Local 인계.
- [현재 앱 감사](book-design-reset-audit.md): 3화면×3폭, 관리 조작 누적·입력창 이중 스크롤·목록 진입 문제와 번호 주석.
- [공식 참고 사례](book-design-reset-references.md): novelWriter·Zettlr·Manuskript·Obsidian. 공식 이미지와 코드 열람 범위를 구분하고 릴리스·라이선스·선택 이유를 기록.
- [오프라인 체험](evidence/book-design-reset/comparison.html) / [모든 화면 비교](evidence/book-design-reset/index.html) / [시안 소스와 토큰](../../design/book-workshop/README.md).
- [독립 시각 검토](book-design-reset-independent-review.md): 비교 시안 제시 범위에서 ship. A 추천, B 모바일 탐색의 공간 비용 명시.
- [독립 조작 검사](book-design-reset-qa.md): 편집·반영·문단 복귀·원문·오프라인 파일, 발견 문제와 수정 결과를 기능 검사로 별도 기록.
- [상태 24조합](evidence/book-design-reset/after/states-report.json): A/B×3폭×빈 목록·로딩·40권·저장 실패. 가로 넘침·페이지 오류 0, 가시 조작 44px 이상.
- [주요 색 대비](evidence/book-design-reset/after/contrast-report.json): 명시한 9개 글자/표면 조합 4.5:1 이상. 전체 OS 컨트롤·스크린리더 감사를 뜻하지 않는다.

시안 캡처는 Chromium 151에서 1440/820/390×900이다. presentation=1은 비교용 A/B·상태 선택 줄만 숨긴다. 실제 앱 감사는 1440/820×1000,390×844이며 자동 스크롤 도착과 페이지 위 상태를 구분했다. 높이·예시 도구 유무를 섞어 개선율을 계산하지 않는다.

실제 앱에는 기존 field/flush/transition, Books.project·출력·복구 계약 위에 A안을 적용했다. 익명 시안의 단순 저장·문단 복귀 코드를 운영 구현으로 복사하지 않는다. 원고 외 조작은 접힌 보조 영역으로 재배치하며 기능을 삭제하지 않는다. 병합·배포·운영 SQL은 Local 담당이고 이 시각 변경에는 새 SQL이 필요하지 않다.
