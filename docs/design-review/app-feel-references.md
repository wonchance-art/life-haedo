# 앱다운 화면을 위한 플랫폼·오픈소스 참고

확인일 **2026-10-05 UTC**. 기준 코드는 `main`의 `1325f2a`이며, 이번 요청은 **깔끔한 앱 UI, 옅은 색상의 생기, 반응형 배치와 짧은 상호작용**이다. 기존 HTML/일반 JavaScript·공용 SVG·CSS 토큰·인증/저장 경계를 유지한다. 이 문서는 선택 근거이며 기능·시각 검사 완료 보고가 아니다. 실제 적용과 검증은 디자인 책임자 root가 통합한다.

공식 GitHub/npm 및 MDN의 원본을 상속된 프록시·TLS 검증으로 읽었다. 새로운 패키지를 설치하거나 CDN을 제품에 연결하지 않았고, 운영 계정·개인 기록은 사용하지 않았다.

## 권장 방향

**본문은 밝고 안정적으로, 옅은 색은 바탕·선택 상태·작은 조작 영역에 사용한다.** 본문이나 보조 글자를 파스텔로 옅게 만드는 것보다, 짙은 글자와 옅은 배경을 함께 쓰는 편이 읽기와 상태 인식을 유지한다. 기존 승인 A 인용 도형과 20px 아이콘/44px 이상 조작 영역을 재사용한다.

현재 좁은 기록 화면은 제목 → 묶음/내 페이지 → 검색 → 결과 개수가 세로로 쌓인다. 첫 기록을 더 빨리 볼 수 있게 이 위계를 정리하는 것이 카드·장식·소개 패널을 추가하는 것보다 우선이다. 홈의 빠른 진입에는 작고 옅은 배경을 줄 수 있지만, 긴 원문·공개 방문 페이지까지 여러 개의 떠 있는 카드로 분리하지 않는다.

앱의 반응은 클릭한 버튼·선택한 항목·저장 결과에서 보여준다. 짧은 색 전환과 미세한 눌림 반응은 사용할 수 있으며 기본 권고는 **120–180ms**다. 모든 행을 흔들거나 본문을 등장 애니메이션으로 지연시키지 않는다. 저장 전 성공 반응이나 실제 동작하지 않는 드래그 손잡이는 만들지 않는다.

## 웹 플랫폼 기능의 채택 범위

호환성은 [MDN browser-compat-data v8.1.4](https://github.com/mdn/browser-compat-data/releases/tag/v8.1.4)와 조회 당시 [기본 브랜치 commit `e0a9d6d`](https://github.com/mdn/browser-compat-data/commit/e0a9d6d95c68f9771887d79e2d02b487ba6c869c)을 기준으로 확인했다. 아래 버전은 해당 API/문법의 최초 지원 표기이며, 해도의 모든 동작이나 특정 OS 설정을 실제 기기에서 검증했다는 뜻이 아니다. `safari_ios`가 `mirror`인 항목은 Safari 엔진 표기를 함께 읽었다.

| 기능 | 공식 호환성에서 확인한 범위 | 해도와 비교한 결정 |
| --- | --- | --- |
| **크기 container queries** | [`@container`](https://github.com/mdn/browser-compat-data/blob/e0a9d6d95c68f9771887d79e2d02b487ba6c869c/css/at-rules/container.json): Chrome 105, Firefox 110, Safari 16 | **좁은 부분에 적용.** 홈의 원천/날짜 행처럼 창 전체보다 실제 내용 폭이 중요한 배치에 `container-type: inline-size`를 사용한다. 기본은 한 열이고 충분히 넓을 때만 나눈다. iPad 분할 화면도 창 이름이 아닌 실제 컨테이너 폭을 따르게 한다. 전체 페이지에 size containment를 무차별 적용하지 않으며 style/scroll-state query의 지원까지 동일하다고 추정하지 않는다. |
| **`:has()`** | [호환성](https://github.com/mdn/browser-compat-data/blob/e0a9d6d95c68f9771887d79e2d02b487ba6c869c/css/selectors/has.json): Chrome 105, Firefox 121, Safari 15.4 | **기존의 제한된 용도 유지.** 현재 체크박스 필드 배치와 로그인 전 홈의 여백에 이미 사용한다. 새 핵심 상태는 기존 `aria-current`·`aria-pressed`·클래스를 우선한다. 비지원 환경에서 저장/탐색 조작이 사라지게 만들지 않는다. |
| **`dvh` / `svh`** | [동적·작은 viewport 단위](https://github.com/mdn/browser-compat-data/blob/e0a9d6d95c68f9771887d79e2d02b487ba6c869c/css/types/length.json): Chrome 108, Firefox 101, Safari 15.4 | **기존 모달 최대 높이 보완.** `platform.css`의 dialog는 이미 `100dvh`를 쓴다. 필요한 곳에 `vh` 기본값 뒤 `dvh` 향상을 둔다. 본문 전체를 고정 높이와 `overflow:hidden`으로 가두지 않는다. 주소창 크기를 반영하는 기능을 소프트 키보드·IME 대응의 보증으로 쓰지 않는다. |
| **safe area / `env()`** | [`env()`와 inset](https://github.com/mdn/browser-compat-data/blob/e0a9d6d95c68f9771887d79e2d02b487ba6c869c/css/types/env.json): 현재 `env()`는 Chrome 69, Firefox 65, Safari 11.1. Safari 11의 이전 `constant()` 표기와 구별 | **기존 하단 보호 유지.** 메뉴 높이·본문 아래 여백·초점 스크롤 여백을 함께 계산한다. 가로 회전에서 필요하면 좌우 inset도 고려한다. 기본 여백을 없애거나 inset만으로 터치 영역을 정하지 않는다. [MDN 원문](https://github.com/mdn/content/blob/main/files/en-us/web/css/reference/values/env/index.md)의 `keyboard-inset-*`는 별도 기능이며 iPhone 키보드 해결책으로 가정하지 않는다. |
| **`prefers-reduced-motion`** | [호환성](https://github.com/mdn/browser-compat-data/blob/e0a9d6d95c68f9771887d79e2d02b487ba6c869c/css/at-rules/media.json): Chrome 74, Firefox 63, Safari 10.1 | **유지·새 반응에 확대.** 현재 일부 셸/생활 도구 CSS에 이미 있다. 새 선택·버튼·스크롤 반응에도 적용하고 줄어든 모션 환경에서 이동/확대 효과를 제거한다. 상태 자체는 즉시 전달한다. |
| **`forced-colors`** | [호환성](https://github.com/mdn/browser-compat-data/blob/e0a9d6d95c68f9771887d79e2d02b487ba6c869c/css/at-rules/media.json): Chrome/Firefox 89, Safari 16. 문법 지원과 실제 OS의 해당 모드 활성화는 별개 | **선택·초점 보완에 적용.** 현재 공통 CSS에는 별도 규칙이 없다. 그림자·옅은 배경만으로 구분한 버튼/선택을 `ButtonText`·`CanvasText` 등 시스템 색의 경계·outline과 함께 표시한다. [MDN 설명](https://github.com/mdn/content/blob/main/files/en-us/web/css/reference/at-rules/@media/forced-colors/index.md)처럼 이 모드에서는 `box-shadow`가 사라질 수 있다. 전역 `forced-color-adjust:none`으로 사용자 색을 막지 않는다. |
| **View Transitions** | [같은 문서 `startViewTransition()`](https://github.com/mdn/browser-compat-data/blob/e0a9d6d95c68f9771887d79e2d02b487ba6c869c/api/Document.json): Chrome 111, Firefox 144, Safari 18. [문서 간 `@view-transition`](https://github.com/mdn/browser-compat-data/blob/e0a9d6d95c68f9771887d79e2d02b487ba6c869c/css/at-rules/view-transition.json): Chrome 126, Safari 18.2, 조회 자료의 Firefox는 미지원 | **이번 전역 도입 제외.** 해도는 원문 선택 구간·검색 복귀 초점·계정 전환 시 즉시 숨김·공개 철회 후 내용 제거를 보존해야 한다. [공식 동작 설명](https://github.com/mdn/content/blob/main/files/en-us/web/api/view_transition_api/using/index.md)상 이전 화면의 정적 snapshot이 애니메이션이 끝날 때까지 남으므로, 전체 화면 전환에 붙이면 별도 개인정보·초점·읽기 회귀 검증이 필요하다. 지금은 CSS의 작은 상태 반응으로 목적을 충족한다. 후속 도입은 기능 탐지·모션 선호·로그아웃/계정/공개 상태 경계에서의 즉시 취소까지 포함한 작은 실험으로 제한한다. |

`prefers-color-scheme` 지원만으로 검증하지 않은 다크 테마를 자동 활성화하지 않는다. 옅은 바탕을 도입할 때도 입력 경계·보조 글자·오류·선택 상태의 실제 배경 대비를 다시 측정해야 한다. 큰 전역 blur나 투명 헤더는 본문과의 대비·스크롤 성능에 비용을 더하므로 기본 수단으로 삼지 않는다.

### iPad Chrome과 iPhone의 해석

[Chromium 공식 iOS Web Layer 문서](https://github.com/chromium/chromium/blob/main/ios/web/README.md)는 확인일의 구현이 Blink 대신 **WebKit의 `WKWebView`**를 감싼다고 설명한다. 따라서 데스크톱 Chrome의 버전 숫자로 사용자의 iPad Chrome 지원을 추정하지 않는다. 브라우저 이름만으로 모든 지역·배포의 엔진을 영구적으로 단정하지 않고, 실제 기기 검증에는 기기·iOS/iPadOS·브라우저 버전을 함께 남긴다.

특히 820px Chromium 검사는 iPad의 세로 화면 폭에 가까울 뿐, iPad Chrome·한글 IME·소프트 키보드·홈 화면 실행·Files·VoiceOver 검사가 아니다. 이번 CSS 설계에서는 기본 한 열과 자연스러운 페이지 스크롤을 유지하고 390px·820px·1440px 및 좁은 분할 폭을 검토한다. 포인터가 있다고 hover를 필수 동작으로 만들지 않으며 키보드와 터치 경로를 각각 확인한다.

## 좁혀서 확인한 오픈소스 3개

공식 npm `latest`, GitHub 릴리스·기본 브랜치 commit, 공개 security-advisories 및 **실제 npm tarball의 LICENSE**를 확인했다. 아래 세 후보 모두 앱 런타임에 추가하지 않는다.

| 후보 | 확인한 배포·라이선스·유지관리 | 채택/제외 이유 |
| --- | --- | --- |
| **Open Props 1.7.23 · MIT** | [npm](https://registry.npmjs.org/open-props) 게시 **2026-01-31 17:12:15 UTC**. [배포 tarball](https://registry.npmjs.org/open-props/-/open-props-1.7.23.tgz)의 `package/LICENSE`와 [고정 원본 설명](https://github.com/argyleink/open-props/blob/fcb77853851109cc45a801fc18b36293eb1f5be7/readme.md) 확인. [최근 commit](https://github.com/argyleink/open-props/commit/530682d04327f842f56bb1ec33cf84a3cadb3876)은 **2026-08-11**. GitHub `releases/latest`는 오래된 **v1.6.0**이므로 npm 최신으로 오인하지 않는다. | **토큰 설계 참고만 채택.** 간격·크기·모션·경계를 일관된 CSS 변수로 관리하는 방식을 참고하고 해도의 소수 토큰으로 유지한다. 전체 팔레트/normalize/애니메이션 CSS를 덧씌우면 기존 토큰과 두 기준이 생기므로 추가하지 않는다. |
| **Floating UI DOM 1.8.0 · MIT** | [npm](https://registry.npmjs.org/@floating-ui%2Fdom) 게시 **2026-07-11 08:41:32 UTC**, [해당 패키지 릴리스](https://github.com/floating-ui/floating-ui/releases/tag/%40floating-ui/dom%401.8.0) **08:41:44 UTC**. [tarball](https://registry.npmjs.org/@floating-ui/dom/-/dom-1.8.0.tgz)의 `package/LICENSE` 확인. [최근 commit](https://github.com/floating-ui/floating-ui/commit/dc62df23d72ad96d456c007d48d4541786fcd7eb)은 **2026-09-28**. 모노레포의 `releases/latest`가 Vue 패키지를 가리키는 것과 구분했다. | **현재 제외, 구체적 위치 충돌이 생기면 재검토.** 일반 DOM에서도 사용할 수 있어 React 도입은 필요 없지만, 현재 기능은 CSS 도움말과 펼친 패널로 동작한다. 경계 자동 회피·앵커 위치 조정이 실제로 필요한 팝오버가 생길 때만 유효한 후보다. 위치 계산 라이브러리만으로 초점 관리·키보드 의미·메뉴 동작까지 해결됐다고 판단하지 않는다. |
| **Vaul 1.1.2 · MIT** | [npm](https://registry.npmjs.org/vaul) 게시 **2024-12-14 00:56:00 UTC**, [공식 릴리스](https://github.com/emilkowalski/vaul/releases/tag/v1.1.2) **00:57:07 UTC**. [tarball](https://registry.npmjs.org/vaul/-/vaul-1.1.2.tgz)의 `package/LICENSE.md` 확인. [최근 commit](https://github.com/emilkowalski/vaul/commit/3e97aac6a38e4481bade71d7233ed6002e80f9b0)은 **2025-10-03**. 현재 [공식 README](https://github.com/emilkowalski/vaul/blob/3e97aac6a38e4481bade71d7233ed6002e80f9b0/README.md)에 **“This repo is unmaintained”**가 명시돼 있다. | **도입 제외.** 이동 가능한 바텀시트의 모양만을 위해 React/ReactDOM과 Radix Dialog 의존성을 새로 더할 이유가 없다. 유지관리 중단도 명시돼 있다. 모바일에서는 현재 필요한 버튼·폼을 세로로 정리하고 기존 native dialog/details를 활용한다. 검증하지 않은 swipe-to-dismiss/드래그 손잡이는 추가하지 않는다. |

세 저장소의 `archived`·`disabled`는 모두 false였지만 Vaul의 명시적 유지관리 중단을 이 값으로 덮어쓰지 않았다. [Open Props](https://api.github.com/repos/argyleink/open-props/security-advisories), [Floating UI](https://api.github.com/repos/floating-ui/floating-ui/security-advisories), [Vaul](https://api.github.com/repos/emilkowalski/vaul/security-advisories)의 공개 권고 API는 조회 시 빈 목록이었다. 공개된 해당 저장소 권고를 확인한 것이며 미공개 문제·모든 전이 의존성의 감사나 무취약성 보증이 아니다.

## 실제 제품 화면에서 참고한 것과 한계

아래 공식 이미지를 이번 조사에서 직접 열어 비교했다. 계정으로 제품을 실행하거나 상호작용을 검증하지 않았다. **최신 배포의 공식 저장소에 이미지가 남아 있다는 사실을 최신 실행 화면의 증거로 쓰지 않는다.** 로고·사진·본문·제품 코드는 해도 자산으로 복사하지 않는다.

| 실제 확인한 자료 | 관찰과 해도 적용 | 제외하거나 유보한 부분 |
| --- | --- | --- |
| [Karakeep 공식 대표 이미지](https://github.com/karakeep-app/karakeep/blob/1880a59f2c17dad96962b4110a8544d7e5ed41ea/screenshots/homepage.png) | 옅은 회색 캔버스와 흰 콘텐츠, 일정한 상단 검색, 선택한 탐색 항목의 작은 배경, 모바일 하단 탐색. 해도에는 본문 밖 바탕과 선택 상태의 부드러운 구분을 참고한다. | 이미지의 앱 표기는 **v0.23.1**, 이미지 마지막 변경은 **2025-04-25**다. 최신 UI 평가로 표현하지 않는다. 이미지 masonry·많은 태그·별도 큰 입력 카드를 해도 텍스트 피드에 가져오지 않는다. |
| [Karakeep 공식 reader 이미지](https://github.com/karakeep-app/karakeep/blob/f908b02e904a030604d56d8bcd871763474006c9/apps/landing/public/screenshots/reader-view.webp) | 본문 한 열과 출처 위계, 필요한 도구를 상단에 모으고 내용과 분리한 구성. 기록을 열면 바깥 탐색의 색과 장식이 줄어드는 원칙을 참고한다. | 영어 serif·큰 제목 여백·읽기 비율을 한글 화면에 복제하지 않는다. 이미지로 실제 읽기 이력이나 초점 복귀 동작을 확인한 것은 아니다. |
| [Joplin 공식 웹 앱 이미지](https://github.com/laurent22/joplin/blob/e41516e669efb693b009bedb21f3eb1fcbea4fc9/packages/app-mobile/web/public/screenshots/wide.png) | 복귀·제목·보조 조작이 한 줄로 모여 있고 문서는 한 영역에서 읽힌다. 해도에서는 화면을 바꿔도 제목/행동의 위치를 유지하는 패턴만 참고한다. | 문서 안 예시는 **2021년** 표기가 보인다. 이번 현대적인 색/모션의 시각 기준으로 삼지 않으며 큰 편집 FAB·여러 탐색 패널을 추가하지 않는다. |

이 비교에서 가져오는 것은 **조용한 캔버스, 일관된 조작 위치, 분명한 선택, 읽을 때 줄어드는 장식**이다. “앱처럼 보임”을 제스처·바텀시트·강제 전체 화면 전환의 수로 판단하지 않는다.

## 이번 변경의 검증 기준

이 조사에서 브라우저 기능 검사나 새 스타일의 대비 측정을 수행한 것은 아니다. 구현 검증은 다음 실패 장면에 집중한다.

- 390px과 iPad 분할 폭에서 검색·묶음/페이지 조작·긴 한글 제목이 첫 본문과 겹치지 않고, 44px 대상과 16px 입력을 유지한다. 820px/1440px에서도 컨테이너가 좁으면 기본 한 열로 동작한다.
- 선택·저장·버튼의 반응이 실제 상태와 일치한다. 키보드 초점과 `aria-*`가 색 없이도 의미를 전달하고, reduced motion에서는 이동 효과가 없다.
- forced colors에서 사라지는 그림자를 대신할 경계/초점이 남는다. 옅은 강조 바탕 위 보조 글자와 입력 경계도 실제 표면 대비로 검사한다.
- 기존 검색 복귀·고정 원문/구절·체크/선택·폼 초안·계정 전환·공개 페이지 내용 제거와 저장/동기화/백업 계약을 CSS 변경으로 바꾸지 않는다.
- Mac/iPad/iPhone 실기의 IME·키보드·안전 영역·주소창·앱 전환 검증은 Chromium의 폭·미디어 설정 모사와 별도로 남긴다.
