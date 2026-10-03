# 디자인 참고와 오픈소스 선택

확인일: **2026-10-04 KST / 2026-10-03 UTC**. [제품 사용 흐름](../life-tools-design/experience.md)과 [기존 오픈소스 검토](../life-tools-design/open-source-review.md)를 전제로 한 디자인 조사다. 목적은 이미 남긴 기록을 **찾기 → 읽기 → 발췌 → 출처로 돌아가기** 쉽게 만드는 것이다.

공식 GitHub API의 릴리스·저장소 상태·라이선스·공개 보안 권고, npm 배포 정보, 아래에 명시한 원본 파일을 읽었다. Joplin·Karakeep의 공식 이미지도 직접 열어 보았다. 두 제품을 설치하거나 사용자 계정으로 실행하지 않았으며, 이미지 관찰과 제품 동작 검증을 구분한다. 이 조사 자체는 런타임 패키지를 추가하거나 기존 패키지를 업데이트하지 않는다. Impeccable 도입 기록은 별도 스킬 고지에서 관리한다.

## 1. 재사용 후보와 결정

| 후보 | 확인한 버전·유지관리 | 라이선스 | 채택 범위와 이유 | 이번에 채택하지 않는 부분 |
| --- | --- | --- | --- | --- |
| **daisyUI** | 공식 안정 릴리스 **5.7.47**, 2026-09-30 UTC. 저장소 보관 처리 안 됨, 마지막 push 2026-09-30. 현재 해도 CSS 헤더는 **5.7.16** | MIT | 기존 `html[data-theme=spring]` 색 변수와 CSS 기반을 유지한다. 같은 의미의 색·표면·경계 토큰을 공통 컴포넌트로 연결하면 기존 연표·플랫폼과 충돌을 줄일 수 있다 | 새 시안 때문에 곧바로 버전을 올리거나 모든 화면을 daisyUI 기본 카드로 바꾸지 않는다. 별도 Tailwind 빌드도 추가하지 않는다 |
| **Lucide** | 공식 릴리스 **1.51.0**, 2026-10-03 UTC. 보관 처리 안 됨, 마지막 push 2026-10-03 | 기본 ISC. LICENSE에 열거된 Feather 유래 아이콘은 **MIT 고지도 함께 보존**해야 함 | 검색·가져오기·원문 열기·발췌 등 필요한 SVG만 버전 고정하여 로컬로 재사용할 수 있다. 선 굵기와 크기를 통일하고 텍스트 레이블을 우선한다 | 전체 아이콘 런타임, CDN의 `latest`, 텍스트를 없앤 모호한 아이콘 전용 메뉴 |
| **Open Props** | npm `latest` **1.7.23**, 2026-01-31 UTC. GitHub Releases API의 latest는 **v1.6.0**이므로 그것을 최신 npm 배포로 오인하지 않는다. 보관 처리 안 됨, 마지막 push 2026-08-11 | MIT | 단계별 간격·글자 크기·줄 길이·모션의 CSS 변수 설계를 참고한다. 해도에서 사용하는 소수의 토큰을 설명 가능한 이름으로 정리한다 | 전체 팔레트·normalize를 중복 로드하지 않는다. 기존 spring 변수와 두 개의 색상 기준을 만들지 않는다 |
| **Joplin** | 공식 안정 릴리스 **3.7.21**, 2026-09-25 UTC. 보관 처리 안 됨, 기본 개발 브랜치 push 2026-10-03 | 기본 AGPL-3.0-or-later, 하위 디렉터리별 별도 LICENSE 가능. 로고·아이콘은 별도 권리 고지 | 목록과 선택 문서를 가까이 두는 배치, 좁은 화면에서 본문 중심으로 전환하는 탐색 구조를 **설계 참고** | 앱 코드·브랜드·이미지를 해도 제품 자산으로 복사하지 않는다. 편집기·노트 생성·할 일 관리 중심의 기능 구조는 가져오지 않는다 |
| **Karakeep** | 공식 안정 릴리스 **0.33.2**, 2026-08-11 UTC. 보관 처리 안 됨, 기본 브랜치 push 2026-10-03 | AGPL-3.0 | 다양한 원천을 보관함에서 찾고 별도 리더에서 읽는 전환, 원문 안의 하이라이트 표현을 **설계 참고** | 제품 전체·서버·크롤러·자동 AI 태그를 도입하지 않는다. 이미지 중심 masonry와 수많은 태그를 해도의 기본 검색 결과로 쓰지 않는다 |

유지관리 날짜는 조회 시점의 관찰이며 장기 지원 약속이 아니다. 버전이 높다는 이유만으로 현재 해도의 의존성을 교체하지 않는다.

### 버전 고정 근거

- daisyUI: [릴리스](https://github.com/saadeghi/daisyui/releases/tag/v5.7.47), [패키지 원본](https://github.com/saadeghi/daisyui/blob/c51f50130ffefb293179e6fce8de7ad3f307e45f/package.json), [MIT](https://github.com/saadeghi/daisyui/blob/c51f50130ffefb293179e6fce8de7ad3f307e45f/LICENSE). 조회한 태그 commit `c51f50130ffefb293179e6fce8de7ad3f307e45f`.
- Lucide: [릴리스](https://github.com/lucide-icons/lucide/releases/tag/1.51.0), [README](https://github.com/lucide-icons/lucide/blob/45b0e148db4ee4d748340d0f99982aa1c2159d52/README.md), [ISC·Feather MIT 전체 고지](https://github.com/lucide-icons/lucide/blob/45b0e148db4ee4d748340d0f99982aa1c2159d52/LICENSE). commit `45b0e148db4ee4d748340d0f99982aa1c2159d52`.
- Open Props: [npm 1.7.23](https://registry.npmjs.org/open-props/1.7.23), [배포 기록](https://registry.npmjs.org/open-props), [package.json](https://github.com/argyleink/open-props/blob/fcb77853851109cc45a801fc18b36293eb1f5be7/package.json), [크기 변수](https://github.com/argyleink/open-props/blob/fcb77853851109cc45a801fc18b36293eb1f5be7/src/props.sizes.js), [글꼴 변수](https://github.com/argyleink/open-props/blob/fcb77853851109cc45a801fc18b36293eb1f5be7/src/props.fonts.js), [MIT](https://github.com/argyleink/open-props/blob/fcb77853851109cc45a801fc18b36293eb1f5be7/LICENSE). npm `gitHead`는 `fcb77853851109cc45a801fc18b36293eb1f5be7`.
- Joplin: [릴리스](https://github.com/laurent22/joplin/releases/tag/v3.7.21), [README](https://github.com/laurent22/joplin/blob/e41516e669efb693b009bedb21f3eb1fcbea4fc9/README.md), [라이선스·브랜드 고지](https://github.com/laurent22/joplin/blob/e41516e669efb693b009bedb21f3eb1fcbea4fc9/LICENSE). commit `e41516e669efb693b009bedb21f3eb1fcbea4fc9`.
- Karakeep: [릴리스](https://github.com/karakeep-app/karakeep/releases/tag/v0.33.2), [README](https://github.com/karakeep-app/karakeep/blob/98c0c7896e855a5f2104f89651bb7e1322712df4/README.md), [AGPL](https://github.com/karakeep-app/karakeep/blob/98c0c7896e855a5f2104f89651bb7e1322712df4/LICENSE). 안정판 commit `98c0c7896e855a5f2104f89651bb7e1322712df4`. 아래 공식 홍보 이미지의 별도 기준 commit은 `f908b02e904a030604d56d8bcd871763474006c9`.

## 2. 실제로 본 제품 화면과 배울 부분

이미지는 공식 저장소의 파일을 내려받아 직접 확인했다. 문서에는 원본 링크를 남기고, 타 제품의 로고·사진·본문을 해도 시안에 복제하지 않는다. 시안은 별도의 공통 한글 가상 자료를 사용한다.

| 직접 본 근거 | 이미지에서 관찰한 구성 | 해도에 적용할 패턴 | 복제하지 않을 것·검증 한계 |
| --- | --- | --- | --- |
| [Joplin 공식 대표 이미지](https://raw.githubusercontent.com/laurent22/joplin/e41516e669efb693b009bedb21f3eb1fcbea4fc9/Assets/WebsiteAssets/images/home-top-img.png) | 데스크톱의 탐색/목록/본문 3영역. 선택 행 배경과 본문 제목으로 현재 위치 구분. 휴대전화 예시는 뒤로가기와 본문 중심 | 넓은 화면에서 검색 결과 선택 상태를 유지하면서 문서를 읽는다. 좁은 화면은 한 영역씩 전환하고 목록 복귀 위치를 보존한다 | 제목 옆 편집 도구, 체크박스 할 일 목록, 빽빽한 태그 탐색을 모두 가져오지 않는다. **최신 릴리스에 들어 있는 공식 이미지지만 2021년 예시가 보여, 최신 UI 실행 증거로 쓰지 않는다** |
| [Joplin 웹 앱용 wide 이미지](https://raw.githubusercontent.com/laurent22/joplin/e41516e669efb693b009bedb21f3eb1fcbea4fc9/packages/app-mobile/web/public/screenshots/wide.png) | 상단 복귀/제목과 문서 렌더링이 중심. 문서 내부에 제품 예시 이미지 포함 | 좁은 화면에서 불필요한 보조 탐색을 덜어내는 비교 자료 | 긴 글 전체 너비·동작·접근성이 검증됐다는 근거가 아니다. 이 이미지를 iPad 실기 검증으로 표현하지 않는다 |
| [Karakeep 보관함 이미지](https://raw.githubusercontent.com/karakeep-app/karakeep/f908b02e904a030604d56d8bcd871763474006c9/apps/landing/public/screenshots/dashboard-light.webp) | 상단 검색, 좌측 모음, 내용별 카드. 제목/본문과 출처·날짜·태그가 분리됨 | 검색을 일관된 위치에 두고, 목록 행은 **제목 → 일치 문맥 → 원천·확보 범위** 순서로 구성한다. 원천과 모음을 탐색 기준으로 구분한다 | 원문 검색에 이미지 masonry를 쓰면 읽기 순서가 불명확해져 제외. 사진 없는 메모에 임의 표지 이미지를 만들지 않는다. 이미지 자체 버전 표기는 **v0.31.0**이므로 0.33.2 실행 화면으로 주장하지 않는다 |
| [Karakeep 리더 이미지](https://raw.githubusercontent.com/karakeep-app/karakeep/f908b02e904a030604d56d8bcd871763474006c9/apps/landing/public/screenshots/reader-view.webp) | 본문 폭 제한, 큰 제목/작성자/본문의 단계, 문장 안 하이라이트, 읽던 위치로 이동하는 행동 | 본문을 폼보다 문서처럼 보이게 한다. 발췌가 해당 원문과 연결되도록 선택 문장을 강조하고 출처를 가까이 둔다 | 영어 serif의 크기·자간을 한글에 그대로 적용하지 않는다. 과도한 제목 여백으로 모바일 첫 본문을 밀지 않는다. 진도율/자동 읽음 처리·복귀 동작은 이미지로 검증할 수 없음 |

이 비교에서 얻은 것은 배치 원칙이다. 색·로고·애니메이션을 닮게 만드는 것을 목표로 삼지 않는다. 현재 사용자 자료에는 텍스트 중심 메모·Markdown·부분 본문·본문 없는 링크가 섞이므로, 카드의 크기나 화려함으로 자료의 가치를 암시하지 않는다.

## 3. 동일 자료로 비교할 세 방향

세 방향 모두 같은 검색어·결과 개수·제목·출처·긴 원문·발췌를 사용한다. 차이는 배치·밀도·활자 계층이어야 하며, 특정 시안에만 좋은 사진이나 짧은 제목을 넣지 않는다.

| 방향 | 비교할 구체 선택 | 근거 | 실패하면 바꿀 조건 |
| --- | --- | --- | --- |
| **A · 읽기 중심** | 조용한 탐색과 목록, 넉넉한 본문. 원천·본문 확보 범위는 제목 아래, 상세 수신 시각/버전은 펼침으로 제공. 보조 패널은 발췌 하나에 집중 | Karakeep 리더의 문서 위계와 Joplin의 목록 맥락 유지 | 화면을 열어도 첫 본문이 보이지 않거나, 자료 간 비교에 반복 복귀가 너무 많으면 목록 밀도를 높인다 |
| **B · 비교 중심** | 넓은 화면에서 조밀한 결과 목록과 본문을 동시에 표시. 선택 행·검색어 강조·발췌 패널 구획을 명확히 한다. 작은 화면은 순차 전환 | Joplin의 목록/본문 분리. 문서를 바꿔도 검색 맥락이 유지되는 배치 | 820px에서 여러 패널이 본문을 지나치게 좁히거나 터치 대상이 줄면 목록을 접고 본문을 우선한다 |
| **C · 여백 중심** | 제목과 짧은 문맥의 열린 두 열 목록, 모바일 한 열. 넓은 여백과 얇은 구분선, 제목·본문은 시스템 명조(Noto Serif CJK KR/Batang)로 비교하며 UI 라벨은 산세리프 유지 | Karakeep 리더에서 본 위계와 폭 제한을 재해석한 자체 시안. 특정 제품과 동일하다는 주장은 하지 않음 | 20개 이상의 자료에서 탐색 시간이 늘거나 부가 설명이 본문보다 눈에 띄면 간격·제목 크기를 줄인다 |

조사에서의 초기 추천은 **A를 기본으로 B의 선택 행·검색 맥락 보존을 가져오는 방향**이다. 구현 시안은 A의 옆 탐색과 한 열 결과, B의 조밀한 결과 행 및 데스크톱 보조 자료 목록, C의 열린 두 열과 명조 읽기를 비교한다. B의 보조 자료 목록은 좁은 화면에서 접는다. 아이콘은 이번 시안에 필요한 단순 기하 SVG 6개를 직접 작성했으며 Lucide는 검토 후보로만 남겼다. 해도는 새 글 편집보다 기존 글을 찾아 읽고 출처를 확인하는 일이 먼저이기 때문이다. 확정은 같은 자료가 들어간 1440·820·390px 화면과 사용자 흐름 비교 결과에 따른다.

## 4. 한글·원문 보존·접근성에 적용할 규칙

- 라벨/제목/문장/보조정보의 역할별 크기와 행간을 정한다. 처음부터 모든 글자를 serif로 바꾸거나 영문 폰트 수치를 그대로 옮기지 않는다. 시스템 한글 글꼴에서도 기본 형태가 유지되어야 한다.
- 긴 한글 제목, 조사와 짧은 단어, URL·긴 파일명·공백 없는 문자열을 함께 확인한다. `word-break: keep-all`만 전역 적용해 넘침을 만들지 않는다. 적절한 영역에 줄바꿈 대책을 둔다.
- 읽기 본문과 주석은 시각적으로 구분한다. 원문을 예쁘게 보여주기 위해 실제 원문 문자열·줄바꿈·UTF-16 위치를 바꾸지 않는다. 렌더링 구조를 바꾸는 단계에는 기존 검색/발췌 locator 검증이 필요하다.
- 출처·본문 일부·본문 미확보는 색과 아이콘만으로 표시하지 않는다. 실제 제공되지 않은 썸네일·작성일·읽음률을 채우지 않는다.
- 시각적 밀도와 터치 영역을 별도로 설계한다. 좁은 목록도 주요 조작 대상 44px 기준, 입력 16px 기준과 키보드 포커스를 유지한다.
- 원문 이동·목록 복귀·보조 패널 전환 때 선택 문장, 목록 조건, 스크롤/포커스의 맥락을 유지한다. 시안에서 모사한 동작을 제품 데이터에 연결된 기능으로 보고하지 않는다.

## 5. 공개 보안 권고와 도입 경계

공식 저장소별 `/security-advisories?per_page=10` 응답을 확인했다. daisyUI·Lucide·Open Props는 조회 응답이 빈 목록이었다. 이는 취약점 부재나 의존성 전체 감사 완료를 뜻하지 않는다.

Joplin·Karakeep는 반환된 권고 10건을 표본으로 확인했다. 전체 페이지 순회나 제품 보안 검증은 하지 않았다. 예를 들어 Joplin의 [외부 callback 대상 검증 권고](https://github.com/laurent22/joplin/security/advisories/GHSA-v9jp-q5hw-w3p3)는 버전 범위 표기가 넓어 이 조사만으로 특정 릴리스가 안전하다고 판정하지 않는다. Karakeep의 [북마크 export XSS 권고](https://github.com/karakeep-app/karakeep/security/advisories/GHSA-4vx2-9j8p-jg8v)는 `<= 0.32.0` 영향·`0.33.1` 수정을 명시한다. [URL scheme 검증 권고](https://github.com/karakeep-app/karakeep/security/advisories/GHSA-6mfw-xrw2-h5x3)는 조회 당시 수정 버전 필드가 비어 있었다.

두 제품의 UI 패턴을 참고하는 것과 보안이 검증되지 않은 코드·크롤러·인증 흐름을 도입하는 것은 별개다. 해도는 이번 디자인 작업에서 해당 제품 코드를 실행하거나 인증·저장·동기화 경계를 교체하지 않는다.

공식 권고 목록: [daisyUI](https://github.com/saadeghi/daisyui/security/advisories), [Lucide](https://github.com/lucide-icons/lucide/security/advisories), [Open Props](https://github.com/argyleink/open-props/security/advisories), [Joplin](https://github.com/laurent22/joplin/security/advisories), [Karakeep](https://github.com/karakeep-app/karakeep/security/advisories).

## 6. 배포·개인정보·오프라인 비용

- **의존성 최소화:** 현재 일반 HTML/JS·로컬 CSS 구조를 유지한다. UI를 통일하기 위한 프레임워크 전환·추가 서버·검색 서버는 이번 요구에 필요하지 않다.
- **CSS와 SVG:** 실제 채택하는 파일만 정확한 버전·출처·해시·라이선스와 함께 로컬에 둔다. Lucide를 복사한다면 ISC와 적용되는 Feather MIT를 함께 보존한다. Open Props는 이번에는 토큰 설계 참고이며 CSS 추가 다운로드가 필요 없다.
- **외부 요청:** 시안의 글꼴·아이콘·썸네일 때문에 사용자 원천 URL을 자동 요청하지 않는다. 원문 안의 외부 이미지는 존재만으로 가져오지 않는다. 실제 공개 홈에 있는 외부 글꼴 요청을 이번 조사에서 제거했다고 주장하지 않는다.
- **CSP:** 새 시안은 별도 로컬 CSS/JS와 안전한 DOM 삽입을 우선한다. 스타일 개선을 이유로 `unsafe-eval`, 원격 script 허용, 무제한 `img-src`를 추가하지 않는다. 현재 앱 전체의 CSP 감사나 적용을 완료한 문서는 아니다.
- **오프라인:** 시스템 글꼴 대체와 로컬 아이콘만으로 읽기·버튼 의미가 유지되어야 한다. 공용 앱에 파일을 연결하는 구현 단계에서 공개 산출물과 서비스워커 캐시를 검증한다. 문서·시안 생성만으로 오프라인 제품 통합 완료를 선언하지 않는다.
- **갱신 조건:** 시안 선택 후 실제 패키지를 도입하거나 버전을 올릴 때, 파일의 라이선스/보안 권고/배포 비용을 해당 버전으로 다시 대조한다. 새 기능마다 후보 목록 전체를 재조사할 필요는 없으며 변경되는 의존성과 요구에 집중한다.
