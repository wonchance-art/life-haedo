# 블로그 시각 디자인 교체

2026-10-18 KST. 사용 흐름 개편 뒤 요청한 실제 화면의 시각 교체다. 홈의 글·초안·보관함, 작성→저장→읽기→목록 복귀는 보존하고 공통 글꼴·색·프로필·글 제목·작성 진입·여백을 바꾼다. 이번 기준은 [DESIGN.md](../../DESIGN.md), 표면별 계약은 [현재 시각 방향](../../.impeccable/blog-visual-direction.md)이다.

## 선택과 전후 차이

이전 화면은 흰 면과 차콜, 시스템 한글 글꼴, 작은 프로필과 긴 회색 작성 안내를 사용했다. 실제 글과 프로필의 활자 차가 작아 내용보다 앱의 반복 제목·조작이 먼저 보였다. 새 방향은 현대적인 한국어 개인 블로그다. 이름과 실제 글 제목을 키우고, 옅은 초록 회색 바탕 위에 흰 읽기 열을 두며, 짙은 틸로 실제 행동과 현재 위치를 연결한다.

| 항목 | 이전 | 현재 |
| --- | --- | --- |
| 글꼴 | 기기별 시스템 산세리프 | 자체 호스팅 Pretendard Variable + 기존 시스템 fallback |
| 주 행동 | 차콜 | 짙은 틸, 본문색과 역할 분리 |
| 프로필 | 작은 이름·이니셜 | 44px 이니셜과 더 큰 실제 이름 |
| 글 제목·본문 | 위계가 비슷한 목록 | 큰 제목과 읽기 편한 본문의 명확한 위계 |
| 작성 진입 | 긴 회색 pill 안내 | 얇은 경계와 14px 반경을 공유하는 한 작성 행 |
| 전역 프레임 | 프로필과 경쟁하는 제목 | 홈의 반복 제목을 작게, 실제 글을 앞으로 |

큰 표지·장식 사진·가짜 좋아요·팔로워·활동 지표를 추가하지 않았다. 실제 사진과 제목·본문·출처가 화면의 시각 자료다. 같은 작성자의 이름과 아바타도 글마다 반복하지 않는다. 글은 그림자 카드 대신 여백과 구분선으로 잇는다.

## 글꼴과 오픈소스 근거

[Pretendard 공식 v1.3.9](https://github.com/orioncactus/pretendard/releases/tag/v1.3.9)는 2023-11-05 릴리스이며 2026-10-17 공식 릴리스 조회에서 최신 정식 버전으로 확인했다. 글꼴 담당자가 공식 태그의 WOFF2를 받아 [로컬 파일](../../vendor/pretendard/PretendardVariable.woff2)로 보관했다. 수정하지 않은 SIL Open Font License 1.1과 저작권·Reserved Font Name은 [LICENSE.txt](../../vendor/pretendard/LICENSE.txt)에 있다. 출처·SHA-256·크기·가변 축·한글 범위·대안 비교는 [도입 기록](../../vendor/pretendard/README.md)을 따른다.

기존 시스템 글꼴만 쓰는 대안은 외부 의존성과 다운로드가 적지만 기기마다 제목·본문의 폭과 인상이 달라진다. Pretendard 자체 호스팅은 한글 위계를 일관되게 만들고 제3자 글꼴 요청을 피한다. 원본 가변 파일 약 2.06MB의 초기 다운로드 비용은 남으며 `font-display:swap`과 시스템 fallback을 사용한다. 새 UI 프레임워크나 편집기 의존성은 추가하지 않는다.

## 행동과 보존

색·활자는 공통 셸·자료 UI·플랫폼·글쓰기·읽기 표면에서 이어진다. 홈·자료실·도구·설정의 목적지와 내부 ID는 유지한다. 작은 hover·눌림 반응만 사용하고 본문 등장 모션은 두지 않는다. 모션 감소에서는 전환·애니메이션·부드러운 스크롤을 끈다.

키보드 초점·44px 조작·16px 입력·탭 키 이동·모달 닫기와 복귀·하단 안전 영역은 보존 조건이다. 작성 안내는 실제 버튼이며 입력 필드가 아니다. 작성 중 한글 조합·커서·본문 DOM을 다시 만들지 않고 실패 때 입력과 복구 행동을 남긴다.

원문·정확 버전·발췌 위치·초안·사진 원본·계정 격리·백업 형식은 시각 변경과 독립적이다. 비공개 저장·현재 브라우저·동기화·공개 사본·화면 숨김을 같은 상태로 표시하지 않는다. 글쓰기와 공개 범위를 새로 연결하지 않으며 기존 공개 사본만 읽는 방문 화면의 경계를 유지한다.

## 구현 범위

- [공통 글꼴](../../assets/haedo-type.css)·[셸](../../assets/haedo-shell.css)·[자료 UI](../../assets/life/ui.css)에서 글꼴과 색을 공유한다. 홈은 [스타일](../../assets/life/home.css)·[렌더링](../../assets/life/home.js)에서 실제 이름을 h2로, 날짜·비공개를 글 하단으로 옮긴다. 760px 이하 프로필 편집은 44px 연필 버튼으로 표시하고 접근 가능한 이름과 title은 유지한다.
- [공개 읽기](../../share.html)는 자체 호스팅 글꼴에 필요한 `font-src 'self'`를 허용한다. 외부 글꼴 도메인이나 개인 저장소 권한을 추가하지 않는다.
- [정적 사이트 준비](../../scripts/prepare-site.mjs)·[서비스워커](../../sw.js)에 새 CSS·글꼴을 포함한다. 공통 테마 색과 [PWA manifest](../../manifest.webmanifest)의 블로그 설명·흰색/캔버스 값도 같은 체계로 맞춘다. 이는 새 저장 형식이나 서버 공개 기능의 도입이 아니다.

## 검증 근거와 한계

같은 익명 한글 글 세 형식과 사진으로 전후를 비교했다. 1440·820·390px의 홈·빈 상태·작성·읽기·프로필·자료실·도구와 320px 홈을 포함한 최종 23개 캡처에서 시각 검토와 조작·대비 측정을 분리했다. 긴 한글 제목과 프로필의 320px DOM 검수는 별도로 수행했다. 직접 이미지 검토에서는 프로필·글 제목의 위계, 얇은 한 작성 행, 틸 행동과 탐색, 본문을 방해하지 않는 전역 프레임의 변화를 확인했다. 첫 검토에서 소개와 이름의 세로 간격 때문에 본문 진입이 늦어진 부분을 같은 44px 이니셜의 두 행 grid와 작은 소개 간격으로 정리했다.

사진은 matplotlib 샘플에 포함된 미 해군의 공개 도메인 그레이스 호퍼 사진을 검증 fixture로만 사용했다. 글은 익명 합성 자료이며 사용자 기록·실제 세션·운영 사진을 복사하지 않았다. 앱 기본 자료로 이 사진이나 글을 추가하지 않았다.

| 같은 자료의 비교 | 이전 | 현재 |
| --- | --- | --- |
| 모바일 홈 | [390px 이전](evidence/blog-visual-redesign/before-home-390.png) | [390px 현재](evidence/blog-visual-redesign/after-home-390.png) |
| 넓은 홈 | [1440px 이전](evidence/blog-visual-redesign/before-home-1440.png) | [1440px 현재](evidence/blog-visual-redesign/after-home-1440.png) |
| 빈 홈·읽기 | — | [빈 홈 390px](evidence/blog-visual-redesign/after-empty-390.png) · [읽기 390px](evidence/blog-visual-redesign/after-reading-390.png) |

[모바일 전후 한 장 비교](evidence/blog-visual-redesign/comparison-390.png). 같은 자료의 첫 글 제목은 모바일에서 y341.5→338.98, 넓은 화면에서 y357.5→352.19로 본문 진입을 늦추지 않았다. 실제 텍스트 최소 대비는 5.15:1, 확인한 키보드 초점은 3px·5.159:1이었다. 최종 확인 뒤 모바일 소개의 기존 margin 충돌을 고친 390/320px 홈 두 장만 다시 확인했고 다른 21개 캡처는 보존했다.

[검증 요약](evidence/blog-visual-redesign/verification-summary.json): Node 520개·정적 18 HTML/90 JS/359 참조, 기존 사용자 흐름 10+8+2개, 공개 읽기 4개 흐름/11개 상태가 통과했다. 기존 작성·저장·정확 복귀·사진/ZIP 복구·계정 경계와 실패 뒤 입력 보존을 확인했다. Linux Chromium 151.0.7922.173의 실제 앱·IndexedDB와 익명 Auth HTTP 모사를 사용했으며 콘솔·페이지 오류·외부 요청·원격 쓰기는 0건이었다. 공개 읽기에서도 개인 DB/Auth 접근은 0건이었다.

320px의 긴 한글 이름·제목에서도 가로 넘침·44px 미만 조작·16px 미만 입력·이름 없는 조작·텍스트 대비 실패는 검출되지 않았다. Enter로 작성기를 열고 닫아 복귀하는 경로와 forced-colors를 확인했다. 모션 감소 환경에서는 활성 애니메이션 0개·최대 전환 0ms였다. CDP가 실제 사용하는 글꼴을 `PretendardVariable`의 custom font로 확인했고 로컬 WOFF2 2,057,688 bytes가 로드됐다. 이 측정은 수동 시각 판단과 구분한다.

PWA 9개 통합 검사는 v122→v123 갱신을 포함해 통과했다. 의도한 전송 실패 callback 2건과 예상하지 않은 콘솔/페이지 오류 0건을 구분했다. 전체 검사는 마지막 모바일 소개 margin 수정 전에 실행했으며, 수정 후에는 최신 정적 사이트 준비 결과·93개 캐시 응답의 SHA 일치·오프라인 글꼴 200 응답/로드를 별도로 재확인했다. 공개 수명주기 검사의 추가 리소스 timing 계측은 가상 clock에서 빈 목록을 반환해 중단됐고, 제품 코드 변경 없이 실제 FontFace 로드 상태로 확인해 최종 통과했다.

화면 폭을 바꾼 Chromium 검증은 실제 Mac/iPad/iPhone·한글 IME·Files·VoiceOver·앱 전환 체험과 구분한다. 로컬 결과는 운영 OAuth·DB·공개 Pages 배포 결과와도 구분한다.

전체 원본 보고서는 로컬 `.local/blog-visual/qa/{refinement,journeys,sns}/browser-report.json`, `.local/blog-visual/qa/edge-dom-report.json`, `.local/blog-visual/public/verification-summary.json`에 있다. 이 경로는 추적 증거 요약과 선택한 비교 캡처의 보충 자료이며 배포 파일이 아니다.

Impeccable 4.5.0의 프로젝트 지침과 [문서화 규칙](../../.agents/skills/impeccable/reference/document.md)을 수동 적용했다. context·detect·doctor·자동 hook은 설치되지 않아 실행하지 않았다. 이전 [SNS 전환](sns-blog-experience.md)·[사용 흐름 개편](blog-user-journeys.md)·[홈 정리](home-refinement.md)는 당시 상태와 보존 계약의 이력으로 유지한다.
