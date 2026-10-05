# 선택한 내 페이지 사본의 게시·갱신·철회

2026-10-05. [기록에서 바로 담기](record-to-page.md) 다음 단위다. 내 페이지에서 선택한 사본을 확인하고 공개 주소로 보여준다. 원본 SNS에는 쓰지 않는다. 디자인·통합 책임은 root, 페이지 UI·공개 모델/통신·SQL·브라우저 QA·SQL/JS 계약 검사·도식/공식 자료 조사를 나눠 진행했다.

## 현재 적용 상태

구현과 아래 로컬 검증을 완료했다. 2026-10-05 Local이 지정 커밋의 신규 게시 SQL을 운영에 설치하고 읽기 전용 설치 점검 **12/12**를 확인했다. Cloud도 설치 후 실제 운영 HTTP 검사 **5/5**를 통과했다. SQL 재설치는 필요 없다. 최종 병합·Pages 배포 결과는 [PR #30](https://github.com/wonchance-art/life-haedo/pull/30)에 기록한다. 운영에서 실제 소유자의 게시·갱신·철회와 Apple 실기 체험은 이 읽기 전용 검사로 확인한 범위가 아니다.

## 체험 흐름

1. 기록에서 원문을 골라 내 페이지에 담고 소개·항목·코멘트를 편집한다.
2. 내 페이지의 연결 아이콘에서 공개 사본을 연다. 기본 사본에는 표시하도록 고른 제목·출처·소개·페이지용 코멘트가 포함된다. 원문 본문은 기본 제외한다.
3. 필요한 경우 ‘공개할 본문·인용 선택’을 펼쳐 본문을 켜거나 읽기 전용 원문에서 구절을 골라 사용한다. 실제 전송할 결과를 방문 화면과 같은 렌더러로 확인한다.
4. 누구나 읽을 수 있는 사본이라는 표시를 확인하고 게시한다. 서버의 최신 공개 상태를 다시 확인한 뒤 링크를 제공한다.
5. 개인 편집을 바꾼 뒤에는 명시적으로 공개본을 갱신한다. 철회하면 서버의 사본을 제거하고 기존 주소는 더 이상 조회되지 않는다. 다시 게시하면 새 주소를 만든다.
6. 관리 → 공개 페이지 관리에서는 같은 계정의 서버 공개본을 조회·철회한다. 원래 브라우저 자료가 없거나 새 기기인 경우에도 이 경로를 사용한다. 목록은 50개씩 읽는다.

공개 주소는 특정인 접근 제한이나 비밀 링크가 아니다. 검색 노출을 요청하지 않는 `noindex`는 접근 제어가 아니다. 가져오기·본문 표시·로그인·백업 복원만으로 게시하지 않는다. 페이지 구성은 기존처럼 브라우저별로 저장하며, 공개본 관리를 구성 전체의 동기화로 표시하지 않는다.

## 자료·권한·실패 경계

`life-share-v1`은 제목·소개·항목·출처 표시·선택 본문/인용·페이지용 코멘트만 허용한다. 원문·계정·작업공간 내부 식별자와 원문 해시, 개인 기록 메모·회고·숨긴 항목을 넣지 않는다. 원문은 고정된 버전을 사용하고 누락 참조를 최신 버전으로 대체하지 않는다. 인용의 UTF-16 구간과 textarea의 CRLF 정규화 차이도 대조한다. 검토 후 개인 구성이나 원문 revision이 바뀌면 게시를 멈추고 재검토한다.

새 `life_public_pages`와 `life_public_page_receipts` 테이블은 직접 접근을 허용하지 않는다. 소유자는 공용 Google 인증의 검증된 SDK로 전용 RPC만 사용한다. 익명은 임의의 공개 식별자에 대응하는 공개 사본 하나를 읽을 수 있고, 목록·소유자 관리·개인 원문 조회는 할 수 없다. 소유자 관리 목록은 본문 없이 제목·공개 주소·버전 등 관리 메타데이터만 제공한다. 기존 charts·자료 동기화·Auth 설정은 변경하지 않는다.

게시·갱신·철회는 revision 비교와 작업 ID 영수증으로 보호한다. 응답 유실은 성공이나 실패로 단정하지 않고 같은 요청을 재시도한다. 미확인 요청은 계정·프로젝트·작업공간별 sessionStorage에 전송 전에 보관한다. 해당 탭을 새로고침해도 같은 요청을 복구하고, 탭을 닫은 뒤에는 서버의 현재 상태를 조회한다. 과거 성공 영수증이 반환돼도 서버의 최신 상태를 다시 읽는다. 검증된 무기록 거절은 요청을 수정할 수 있게 하고, 모호한 결과는 새 요청으로 덮지 않는다.

방문 화면 `share.html?id=…`은 SDK·Auth·개인 IndexedDB 모듈을 불러오지 않는다. 사본은 검증 후 평문 DOM으로만 출력하고 출처 링크는 http/https만 허용한다. 외부 이동에 referrer를 보내지 않는다. 공개 본문 POST는 `no-store`이며 서비스워커의 오프라인 셸에 방문 문서를 넣지 않는다. 열린 화면은 30초마다 공개 상태를 확인하고 같은 revision이면 본문 DOM·읽기 선택을 유지한다. 숨김·페이지 이탈·오프라인에는 내용을 닫고 재진입 때 다시 확인한다. 철회가 이미 외부에서 복사한 사본까지 회수한다는 뜻은 아니다.

원문 저장·발췌 위치·자료/구성 백업 형식·기존 동기화·연표 값은 유지한다. 백업에는 공개 요청이나 게시 상태를 추가하지 않으며 새 사본 복원으로 기존 공개본을 덮거나 자동 게시하지 않는다.

## 구현 선택과 디자인

[공식 오픈소스 비교](../life-tools-design/open-source-review.md#선택한-사본의-공개-게시--기존-supabase와-별도-cms-비교)를 거쳐 동봉 Supabase SDK와 전용 RPC를 재사용했다. Ghost·Decap의 별도 인증·편집 저장소·배포 체계를 도입할 필요가 없다. 새 앱 런타임 패키지나 CMS를 추가하지 않았다.

방문 화면은 기존 Life의 700px 읽기 열·한글 산세리프·흰 표면·원문별 구분을 이어 쓴다. 개인용 탐색을 방문자에게 노출하지 않고 해도 홈과 공개 상태 재확인만 둔다. 검토와 방문 화면은 `ShareView`를 함께 사용한다. 긴 제목을 반복하지 않고 출처는 펼쳐 확인한다. 본문이 없는 출처 카드와 인용·본문·페이지 작성자의 생각을 구별한다.

## 검증 기록

기능 검사, SQL 권한 검사, 실제 SQL 출력과 JS 해석의 대조, 화면 크기 검사를 별도로 수행했다. 격리된 익명 한글 자료만 사용했다.

- 정적 검사: HTML 17·JS 41·로컬 참조 222·PWA 셸 통과. Node **229/229**. 공개 산출물의 익명 화면에서 Auth/개인 저장소 모듈 제외와 서비스워커 캐시 경계를 포함한다.
- 기존 Workbench 기능 **14/14**, 신규 공개 기능 14개와 폭별 흐름 3개 **17/17**. 새 브라우저에 개인 자료가 없어도 공개본을 관리하고, A의 51개 목록과 B의 1개 목록을 분리한다. 철회 확인 뒤 서버 버전이 바뀌면 요청하지 않고 재확인을 요구한다.
- 1440·820·390px에서 **21상태**, 최소 작은 글자 대비 **6.05:1**. 44px 조작·16px 입력·가로 넘침 검사 통과. 키보드·터치 이벤트·초점 복귀를 확인했다. 콘솔/페이지 오류·예상 밖 외부 요청 0. 분할 실행의 최신 결과와 원본 실패/수정 재검증을 함께 보존한다.
- PostgreSQL **17.11**의 네트워크 격리 Docker에서 설치 점검 **12개**, 역할/RLS/RPC **104개**, 실제 동시 세션 **3개** 통과. 반복 설치와 기존 charts/life_workspaces 보존을 확인했다. 합성 자료는 rollback하고 재현용 임시 컨테이너를 제거했다.
- 실제 SQL이 만든 JSON을 앱의 엄격한 응답 해석기로 읽는 별도 계약 검사 **56/56**. 게시/갱신/철회, 과거 영수증, 익명·타계정, 50+2 목록 페이지, Unicode·제어문자·URL·1 MiB 경계를 대조했다. SQL은 실제 엔진이지만 SDK/fetch 전송은 모사이며 PostgREST 실 HTTP 증거는 아니다.
- 초기 통합에서 철회 응답의 publicId와 원격 오류 이름 불일치가 발견됐다. SQL/JS를 맞추고 실제 SQL 응답 대조를 추가했다. 긴 제목의 중복을 제거하고 공개 1440/390·검토 820·관리 390·오류 화면을 검토했다. 같은 revision 재조회 때 본문 DOM을 바꾸지 않는다.

[브라우저 집계](evidence/page-publication/verification-summary.json) · [시각 검토](evidence/page-publication/visual-review.md) · [기존 구성 회귀](evidence/page-publication/workbench-regression.json) · [SQL 검사](evidence/page-publication/sql-report.json) · [SQL/JS 계약 검사](evidence/page-publication/contract-report.json) · [운영 설치 전 조회](evidence/page-publication/preinstall-live-probe.json) · [Local 설치 인계](evidence/page-publication/production-installation.json) · [설치 후 실제 HTTP 검사](evidence/page-publication/postinstall-live-probe.json)

[방문 화면 1440](evidence/page-publication/public-many-1440.png) · [방문 화면 390](evidence/page-publication/public-many-390.png) · [게시 검토 820](evidence/page-publication/owner-review-820.png) · [공개본 관리 390](evidence/page-publication/published-management-390.png) · [조회 오류 390](evidence/page-publication/public-error-390.png)

재현: `npm run check`, `npm test`, `BASE_URL=http://127.0.0.1:4184 node tests/life-share-browser.cjs`, `python3 tests/life-public-pages-local.py`. SQL/JS 계약 검사는 테스트 전용 스키마를 설치한 격리 컨테이너를 명시해 `node tests/life-share-contract.cjs --container life-haedo-public-page-sql`로 실행한다. 운영 DB를 대상으로 실행하지 않는다.

실제 Mac/iPad/iPhone의 한글 IME·Files·VoiceOver, 운영 Google 로그인과 실제 소유자의 게시·철회는 이번 로컬 브라우저 검사로 완료 처리하지 않는다. 브라우저 Auth/공개 HTTP 모사와 관리형 Supabase의 실 HTTP 권한 검증을 구분한다.

## 운영 설치·읽기 권한 확인 — 2026-10-05

Local 관리자 인계에 따르면 `e562e61dc140db69e7c099c474732d8302342f29`의 [신규 게시 SQL](../../supabase/migrations/20261005120000_life_public_pages.sql)을 1회 설치했다. SQL SHA-256은 `d44c711a293906b6962ff8e983578da742648d9938aaeb71b32062eb6ec4e78c`다. 운영 migration 이력은 실행 시각으로 생성된 `20261005090134 / life_public_pages`이며, 저장소 파일명과 시각이 다르다는 이유로 재설치하지 않는다.

Local이 [설치 점검 SQL](../../supabase/tests/life-public-pages-installation.sql)을 `BEGIN READ ONLY / ROLLBACK` 안에서 실행해 12조건 모두 통과했다. 기존 5개 테이블과 기존 public 함수의 정의·권한 메타데이터 지문은 설치 전후 `79430602812563783493ba58f008ca7d`로 동일했다. Auth 설정·개인 자료·기존 동기화 SQL은 바꾸지 않았다. 이는 Local의 관리자 인계이며 Cloud의 직접 SQL 실행 기록과 구분한다.

Cloud는 `python3 scripts/check-life-share-read.py`를 실제 운영 API에 실행했다. 존재하지 않는 고정 UUID의 익명 조회는 HTTP 200 `missing`과 `no-store`, 소유자 목록·소유자 상태·두 테이블 직접 접근은 모두 HTTP 401 / `42501`로 기대대로 거절됐다. **5/5 통과**이며 개인 자료를 읽거나 게시본을 만들지 않았다. 설치 전 `PGRST202`/`PGRST205` 기록은 과거 상태로 보존한다. 이전 로컬 기능·브라우저 검사 수치는 이 관리자/HTTP 확인 때 재실행한 결과가 아니다.

`supabase/tests/life-public-pages.sql`과 SQL/JS 계약 검사는 격리된 로컬 DB 전용이다. 운영 SQL Editor에서 테스트 자료를 생성하지 않는다. 이전 `scripts/check-life-cloud.py` 합성 검사도 다시 실행하지 않는다. 실제 계정의 선택 게시·갱신·철회는 배포 후 별도 사용자 체험으로 확인한다.
