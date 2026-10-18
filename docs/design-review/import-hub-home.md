# 가져온 글을 찾고 이어 읽는 홈

2026-10-18 KST. 사용자가 바로잡은 해도의 존재 목적은 **외부 여러 곳에 흩어진 내 글과 저장한 자료를 가져와 통합 관리하는 것**이다. [구현 전 계약](../../.impeccable/import-hub-home-direction.md)을 먼저 작성했다. 기존 흰색·틸·활자·본문 중심 규칙을 유지하며 홈의 역할과 조작 순서를 바꾼다.

## 바꾸는 이유와 범위

변경 전 공개 화면은 ‘내 이야기를 쓰는 블로그’와 첫 글 쓰기를 앞세웠고, 로그인 홈도 프로필·작성 행·상태 탭이 중심이었다. 익명 원문 13개가 있고 직접 쓴 글이 없는 경우에도 첫 글 쓰기 빈 상태가 나왔다. 이는 외부 글을 모아 관리하려는 목적과 맞지 않았다. 변경 전 근거는 로컬 익명 캡처 `.local/home-design-review-20261018`의 10개 화면이다.

| 화면 | 역할과 진입 |
| --- | --- |
| 공개 진입 | 흩어진 글의 가져오기·보관·찾기를 설명하고 로그인 후 가져오기로 연결 |
| 홈 | 검색·가져오기·이어읽기 한 행과 최근 자료 최대 6개; 프로필·작성 상자·상태 탭 제거 |
| 자료실 `sources` | 기존 전체 원문 검색·분류·메모/발췌·자료 관리; 직접 쓴 글로 가는 명시적 진입점 |
| 직접 쓴 글 `writings` | 기존 세 형식의 저장 글·초안·보관함·검색·프로필 편집·작성/읽기·사진/첨부·파일 경로 보존 |

홈의 최근 자료는 가져온 원문과 직접 저장한 글을 읽기 투영으로 섞는다. 홈에서 전체 보기를 누르면 자료실을 열고, 원천 모델 밖의 별도 작성 형식은 직접 쓴 글 진입점에서 찾는다. 전부를 같은 저장 형식·단일 원천 목록으로 합치거나 자동 변환하지 않는다. 기존 가져온 원문 목록과 분류 파일 연결은 그대로 둔다.

실제 공개 문구는 ‘흩어진 내 글을, 한곳에서.’이며 `글 가져오기`가 로그인 뒤 가져오기를 연다. 본문 붙여넣기·UTF-8 .txt/.md와 주소 복사 범위를 설명하고, 주소만으로 본문이 자동 확보된다고 표시하지 않는다. 로그인 홈은 `전체 글 검색`·`가져오기` → 이어읽기 → `최근 자료`·`전체 보기` 순서다. 목록 아래에는 보조 `새 글 쓰기`만 남긴다. 자료실의 정확한 진입 이름은 `직접 쓴 글·초안·보관함`이다.

최근 목록은 각 원문의 최신 불변 버전과 별도 형식의 저장 글을 읽기용으로 모아 시각 내림차순 최대 6개를 보여 준다. 행에는 제목 최대 두 줄·본문 앞부분 한 줄·출처와 필수 `본문 미확보`/`일부 본문` 안내만 남기고 작은 사진 미리보기를 유지한다. 날짜·작성자 관계·보관 범위의 전체 정보는 상세에서 확인한다. 기존 첨부 글의 첨부 제목 중복 행은 표시하지 않는다. 이전 버전 읽기나 저장 직후 항목이 최근 6개 밖이면 정확 항목을 여는 안내를 제공한다.

## 상태와 보존

직접 쓴 글이 없어도 가져온 원문이 있으면 실제 최근 자료를 보여 준다. 진짜 빈 상태는 가져오기부터 시작하고, 본문이 없는 링크 자료는 미확보 상태와 실제 원문 접근을 구별한다. 타인 글·작성자 관계 미확인·기계 추출물·주제 후보를 사용자가 직접 쓴 글이나 확정 분류로 바꾸지 않는다. 날짜는 저장/가져온 시각과 원 작성일을 구별한다.

원문·불변 버전·UTF-16 선택·사진 원본·첨부·계정/작업공간 격리·기존 초안·백업·동기화·공개 사본을 보존한다. 읽기·검색·새 글·수정·저장 뒤 복귀 목적지는 출발한 홈/자료실/직접 쓴 글을 따른다. 실패·늦은 응답·계정/공간 변경으로 입력과 다른 범위의 자료가 바뀌지 않게 한다.

자동 SNS 계정 연동·본문 자동 확보·AI 분류·새 DB/schema/API·라이브러리·외부 원문 수정/게시를 추가하지 않는다. 미니멀 비교 시안의 A/B/C 채택이나 색·서체 교체도 아니다. 최신 홈 역할이 과거 블로그 중심 홈 계약을 갱신하며 기존 작성·보관·복구 계약은 writings에서 계속 유효하다.

## 검증 상태

[검증 요약](evidence/import-hub-home/verification-summary.json)에 최초 홈 개편의 실행별 결과와 근거를 모았다. 아래 기존 수치는 후속 행 표시 간소화의 재실행 결과가 아니며 실제 검사 범위와 재확인 방식을 구분한다.

실제 소스에서 위 라벨·순서·타이포·미리보기와 별도 writings 경로를 추출했다. 익명 공개/빈 상태/가져온 원문만/혼합 자료를 390·820·1440px에서 캡처한 12장을 시각 담당이 직접 확인했다. 390px에서 검색·가져오기가 같은 행에 있고 첫 화면에 프로필·큰 작성 상자 대신 실제 최근 자료가 보인다. 원문만 있는 화면은 작성 유도를 빈 상태로 표시하지 않는다. 작은 사진·긴 제목·13px 출처 메타가 자료를 구별하며 추가 시각 수정은 없었다. 이어읽기 활성 상태의 별도 이미지는 이 12장에 포함되지 않는다.

[새 홈의 수용 기준 7개](evidence/import-hub-home/final-report.json)는 모두 최신 증거에서 통과했다. 공개 CTA 의도·명시적 가져오기 검토/저장 중단/재시도, 진짜 빈 홈, 원문만 13개인 홈의 최근 6개·통합 검색·정확 읽기·링크만 보관, 혼합 자료와 기존 초안/보관함 접근, 조건부 이어읽기의 이전 불변 버전(BOM·CRLF), 읽기 실패/재시도, 늦은 조회의 화면·작업공간·계정 경계를 확인했다. 원문·버전·records fingerprint는 불변이었다. [최초 7흐름](evidence/import-hub-home/browser-report.json) 뒤 숨긴 바깥 헤더 대신 실제 내부 복귀 조작·직접 IDB fixture 주입 후 앱 새로고침·초안 행 선택자를 교정해 [영향 3개](evidence/import-hub-home/confirmation/browser-report.json), [마지막 혼합 흐름 1개](evidence/import-hub-home/mixed-confirmation/browser-report.json)를 재확인했다. 단일 최종 전체 실행을 주장하지 않는다.

12개 시각 상태의 가로 넘침·44px 미만 조작·16px 미만 입력·이름 없는 조작·대비 실패는 0건이고 최소 텍스트 대비는 5.15:1이었다. Chromium 151.0.7922.173에서 콘솔·페이지·외부 요청 오류와 실제 원격 쓰기는 0건이었다.

대표 이미지: [변경 전 원문만 있는 홈](evidence/import-hub-home/before-imported-only-390.png) · [변경 후 원문만 있는 홈](evidence/import-hub-home/imported-only-390.png) · [모바일 첫 화면](evidence/import-hub-home/home-mobile.png) · [1440px 혼합 자료](evidence/import-hub-home/mixed-1440.png) · [공개 진입](evidence/import-hub-home/public-390.png) · [빈 홈](evidence/import-hub-home/empty-390.png).

최종 Node 검사 544/544와 정적 검사 HTML 18·JS 94·로컬 참조 386을 통과했다. 기존 [분류 8/8·원문 검색 7/7](evidence/import-hub-home/source-search-summary.json), [이어읽기 12/12](evidence/import-hub-home/reading-resume.json), [SNS 흐름 2/2](evidence/import-hub-home/sns-blog.json)를 확인했다. 기존 진입 16개는 [최초 15/16](evidence/import-hub-home/entry-full.json) 뒤 writings의 실제 복귀 이름으로 기대값을 맞춰 [해당 1개](evidence/import-hub-home/entry-recheck.json)를 통과했다. 각 수치는 해당 흐름의 근거이며 단일 최종 전체 회귀 실행을 뜻하지 않는다.

기존 모션 회귀에서 writings의 중복 복귀 헤더를 발견해 바깥 toolbar를 숨기고 내부 복귀 조작 하나를 유지하도록 수정했다. [모션 최초 8/9](evidence/import-hub-home/motion-full.json) 뒤 [해당 1개](evidence/import-hub-home/motion-recheck.json)를 확인했다. 하위 탐색은 [최초 10/11](evidence/import-hub-home/subview-full.json) 뒤 프로필 전용 `저장하고 돌아가기`에 검사 helper를 맞춰 [해당 1개](evidence/import-hub-home/subview-recheck.json)를 통과했다. 통합 홈 13개·기존 블로그 6개도 [최초 실행과 부분 재확인 요약](evidence/import-hub-home/entry-auth-summary.json)으로 구분한다.

추가 [통합 검색 9/9](evidence/import-hub-home/unified-search.json)·[사진 글 13/13](evidence/import-hub-home/photo-post.json)·[입출력 6/6](evidence/import-hub-home/input-output.json)·[글 작성 완료 10/10](evidence/import-hub-home/writing-completion.json)·[9칸 검색 7/7](evidence/import-hub-home/nine-board-search.json)을 확인했다. 작성 완료·9칸 표면의 초기 대비 지적은 등장 모션 중 부모 opacity를 포함한 측정 시점 문제여서 유한 모션 종료를 기다리도록 검사만 교정했다. [안정 opacity 1에서 대비 실패 0건과 기존 CSS 일치](evidence/import-hub-home/contrast-timing.json)를 확인했으며 제품 색이나 대비 assertion을 바꾸지 않았다.

[PWA](evidence/import-hub-home/pwa-report.json)는 기존 v125→v126 9/9와 최종 빈 검색 guard 뒤 [새 prepared/cache 재확인](evidence/import-hub-home/cache-report.json)을 구분한다. 최종 캐시 응답 98개와 변경 관련 13개 자산의 SHA 일치, 네트워크·HTTP 캐시를 모두 끈 서비스워커 응답, 합성 원문·분류 보존과 정확한 이전 버전 읽기를 확인했다. 이 로컬 검증을 배포 완료로 표시하지 않는다.

검토는 Linux Chromium의 익명 Auth·자료와 viewport 모사이며 실제 사용자 자료 적용·Apple 실기·한글 IME·실제 Google 로그인·운영 DB·배포 검증이 아니다. 원본 캡처 `.local/import-hub-home`과 변경 전 `.local/home-design-review-20261018`은 재현용 로컬 경로다.

후속 행 표시 간소화(2026-10-18 KST)는 [2흐름을 한 번 실행해 2/2](evidence/home-row-simplification/browser-report.json) 통과했다. [390px](evidence/home-row-simplification/mixed-390.png)·[1440px](evidence/home-row-simplification/mixed-1440.png)에서 제목·본문 앞부분 한 줄·출처·필수 확보 안내와 작은 사진, 상세의 첨부·작성/수정일, 정확 읽기·초점/스크롤 복귀와 원문 불변을 확인했다. 44px 조작·16px 입력·이름·넘침·대비 지적은 0건(최소 5.15:1), 콘솔·페이지·외부 요청 오류는 0건이었다. 정적 검사 18 HTML·94 JS·386 참조를 통과했으며 이번에는 Node 전체 검사를 재실행하지 않았다. [PWA v126→v127](evidence/home-row-simplification/pwa-report.json)은 실제 기존 프로필 업데이트·이전 캐시 제거·98개 캐시 응답의 prepared SHA 일치와 변경 JS 두 개의 source=prepared=cache, 네트워크/HTTP 캐시를 끈 SW 200 응답을 확인했다. CRLF·emoji의 정확 원문 읽기와 bundle/workbench는 불변이고 오류·원격 쓰기는 0건이었다. 실기·운영·배포 한계는 위와 같다.
