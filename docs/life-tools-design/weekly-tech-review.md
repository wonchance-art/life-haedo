# 주간 기술 동향 점검

매주 월요일 09:37 KST에 총괄 세션이 공식 출처를 확인하고, 이 앱(빌드 없는 GitHub Pages, Mac·iPad·iPhone) 기준으로 "적용 필요 / 관찰 / 무관"을 판정해 회차별로 기록한다. 적용 필요 항목은 작업 지시서 → 독립 검수 → CI → 병합·배포 관문을 따른다. 새 기능·외부 전송·삭제·권한 완화는 소유자 승인 뒤에만 한다.

**보안 권고 확인 절차(3회차 추가):** OSV 일괄 조회 0건은 안전 근거가 아니다. 3회차에 DOMPurify GHSA-qm7q·fast-xml-parser GHSA-7cfw가 OSV에 아직 없었고 각 저장소 Security 탭에만 있었다. 동봉·Edge 의존성마다 **GitHub 저장소 Security 탭(advisories)** 을 함께 읽는다.

## 주간 기술 동향 점검 — 2026-11-23 (4회차)

기준: 저장소 `origin/main` 8c3c54f(`haedo-v222`, 11-17 병합 #262), 조사 작업 트리 b1fb704. 조사는 읽기 전용이다(저장소 편집·운영 DB 조회 없음). 확인일은 모두 2026-11-23이고, 11-16 이후 새로 생기거나 바뀐 것만 적는다.

**도구 제약:** `gh api /advisories`는 쓰지 않고 각 저장소 Security 탭을 WebFetch로 읽었다. DOMPurify Security 탭은 1쪽(10건)만 읽혔다. OSV `querybatch`(24개 패키지)와 npm registry는 정상이었다. developer.apple.com 릴리스 노트 HTML은 본문이 읽히지 않아 공개 JSON(`/tutorials/data/...json`)과 개발자 릴리스 RSS로 대신 읽었다. Supabase changelog는 앞쪽 100k자(최근 항목)만 읽었다. OWASP는 웹 검색으로만 확인했다(공식 발표 목록을 직접 읽지 않음).

### 1. 동봉 라이브러리·Edge 의존성

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| DOMPurify 3.4.17(`vendor/dompurify`) | **3.5.0(11-22).** GHSA-hrxw-jjj6-2g2j(Low, 11-23 공개): `SAFE_FOR_TEMPLATES` 우회(nested `form` 재파싱). 그 밖에 `IN_PLACE` 실패 시 닫힘, `CUSTOM_ELEMENT_HANDLING` 이름공간 검사, hook 안의 `sanitize()` 호출이 바깥 설정을 덮던 문제를 고쳤다. 동작 변경은 DOM 노드 입력, `IN_PLACE`, hook, 사용자 정의 요소에 한정된다. **"No further 3.4.x release"**: 3.4 계열은 이제 수정판이 없다 | 유일한 호출 `assets/life/source-markdown.js:192`는 **문자열 입력**에 `RETURN_DOM_FRAGMENT`·`ALLOWED_TAGS`·`ALLOWED_ATTR`·`FORBID_TAGS`(`form`·`svg`·`template` 포함)·`FORBID_ATTR`·`SANITIZE_DOM`만 쓴다. `SAFE_FOR_TEMPLATES`·`IN_PLACE`·`addHook`·`setConfig`·`CUSTOM_ELEMENT_HANDLING` 사용 0건이고 클라이언트 템플릿 엔진(Vue·AngularJS)도 없다. 3.5.0의 동작 변경도 이 호출에 해당하지 않는다 | 관찰(다음 vendor 갱신 때 **3.5.0**으로 올림. 3.4 지원이 끝나 우선순위를 올린다) | https://github.com/cure53/DOMPurify/releases/tag/3.5.0 , https://github.com/cure53/DOMPurify/security/advisories/GHSA-hrxw-jjj6-2g2j |
| supabase-js 2.117.2(`vendor/supabase`) | 2.119.1(11-18): `X-Client-Info` 헤더 내용. 2.119.2(11-19): storage-js가 객체 요청 URL을 정규화하고 버킷 경계를 벗어나는 키(`../other/...`)를 로컬에서 거절한다(PR #2878). 보안 권고나 GHSA 표시는 없다. Security 탭 권고는 0건 | 앱의 Storage 경로는 모두 UUID·해시·고정 접두사로 만들고 정규식으로 검사한다(`assets/life/blog-remote.js:7-8,347`, `library-originals-remote.js:8-9,51`). 버킷 이름도 상수다. 서버 쪽 소유자 접두사 RLS가 따로 있다. 방어를 한 겹 더하는 수정일 뿐 앱에 노출된 경로는 없다 | 관찰(다음 vendor 갱신 후보) | https://github.com/supabase/supabase-js/releases , https://github.com/supabase/supabase-js/pull/2878 |
| @tiptap/* 3.32.2, prosemirror-view 1.42.9 외(`vendor/tiptap`) | tiptap 3.35.0(11-20): 캡처 그룹이 있는 input rule에서 마지막 글자가 두 번 들어가던 문제를 고쳤다. 3.34.0은 11-13에 나왔다. **prosemirror-view 1.43.0(11-19): 브라우저가 `compositionend`를 보내지 않으면 조합 상태에 갇히던 문제를 고쳤다.** IE 지원을 뺐고, 마우스 선택을 라이브러리가 직접 처리하며, 다른 스키마에서 붙여넣을 때 나던 충돌을 고쳤다. inputrules 1.7.0, transform 1.12.7, history 1.5.2(되돌리기 선택 위치)도 나왔다. 보안 수정은 없다. 동봉판의 옛 권고 GHSA-c8x8-7fp4-3x9w(<1.42.3)는 해당하지 않는다 | 번들은 여전히 화면에 연결되지 않았다. 참조는 `assets/life/post-markdown-editor.js` 하나이고, 그 파일을 불러오는 HTML과 `sw.js` SHELL 항목은 0건이다. `compositionend` 수정은 한글 IME와 직결되므로 B2 연결 때 같이 올릴 이유가 커졌다 | 관찰(B2 연결 때 tiptap 3.35.0·prosemirror-view 1.43.0·model 1.25.13과 함께. 1.43.0의 마우스 선택 변경은 iPad 터치 선택으로 회귀 확인) | https://github.com/ueberdosis/tiptap/releases , https://prosemirror.net/docs/changelog/ |
| undici 7.30.1(`haedo-naver-blog`·`haedo-discovery-private` deno.lock) | 11-05 이후 새 권고는 없다. 7.x 최신은 여전히 7.30.2이고 8.13.0·8.13.1(11-20)은 다른 계열이다 | 2회차 판정 유지(cheerio `/slim`만 쓰고 undici 사용 0건). 두 lock은 아직 `undici@7.30.1`이다 | 관찰(다음 Edge 배포 때 lock 7.30.2) | https://github.com/nodejs/undici/security |
| fast-xml-parser(`haedo-rss/vendor`, `haedo-news-wide` 공유) | 11-14 이후 새 권고와 새 판이 없다(최신 5.12.1, 마지막 권고 11-13) | 지난 회차의 "적용 필요"는 저장소에 반영됐다(719224f, `origin/main`에 포함, `tests/fixtures/rss/package-lock.json` 5.12.1). 운영 배포 상태는 이 세션에서 확인하지 않았다 | 완료(저장소) / 배포 미확인 | https://github.com/NaturalIntelligence/fast-xml-parser/security |
| markdown-it 15.0.3, js-yaml 5.5.0, Quill 2.0.3, idb 8.0.3, fflate 0.8.3, Pretendard 1.3.9, cheerio 1.2.0 | 새 판이나 새 권고가 없다. Security 탭 기준 markdown-it 마지막 권고는 10-16, js-yaml은 08-26, Quill은 0건이다. OSV에는 Quill GHSA-v3m3·lodash-es 2건만 있고, 이는 1회차 판정과 같다 | — | 무관 | npm registry, https://api.osv.dev/v1/querybatch , 각 저장소 Security 탭 |
| lucide-static 1.51.0 → 1.78.0, daisyUI 5.7.16 → 5.8.2 | 아이콘 추가와 CSS 테마판만 나왔고 보안 판은 없다 | — | 무관 | npm registry |

### 2. Safari·WebKit·Apple

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| Apple 보안 릴리스 | iOS·iPadOS·macOS는 11-09의 27.2.1 이후 새 항목이 없다(11-12·11-18 HomeView, 11-13 tvOS만) | — | 무관 | https://support.apple.com/en-us/100100 |
| iOS/iPadOS 27.3 beta 2(11-16, iOS·iPadOS는 11-19 beta 2 v2), macOS 27.3 beta 2(11-16) | Safari 27.3은 아직 beta다 | 정식 출시 대기 | 관찰 | https://developer.apple.com/news/releases/rss/releases.rss |
| Safari 27.3 beta 릴리스 노트: **`color-scheme: only light`로 Adaptive Dark Mode를 끌 수 있다(191328852)** | 1회차 기록("beta 1은 `only` 미지원")과 다르다. 문서 Last-Modified는 11-14라서 지난 회차(11-16)에 놓쳤을 수 있다 | 앱은 `color-scheme: light`만 선언한다(`assets/app.css:3`, `assets/life/ui.css:4`). 그래서 사용자가 Adaptive Dark Mode를 켜면 변환 대상이고, 검증한 대비가 깨질 수 있다. 끄는 방법은 이제 정해졌다: 두 줄을 `only light`로 바꾸면 된다. 표준 CSS라 다른 브라우저에도 해가 없지만, 적용은 디자인 판단이다 | 관찰(정식 출시 때 결정. 선택지는 `only light` 하나로 확정. 디자인 판단이라 소유자·Designer 확인) | https://developer.apple.com/documentation/safari-release-notes/safari-27_3-release-notes |
| Safari 27.3 beta의 그 밖의 항목(재확인) | `interactive-widget`, IME 확정 시 요소 삭제 수정, dead key `compositionend` 수정, URLPattern(SW 라우팅) 수정, `fetch()` 스트리밍 요청 본문, Temporal | 2회차 판정 유지 | 관찰(정식 출시 대기) | 같은 출처 |
| Safari Technology Preview 257(11-18) | 동시 `CacheStorage` 작업 오류, `Cache.put()`이 요청을 갱신하지 않던 문제, manifest를 항상 UTF-8로 해석, `pagehide` beacon 유실, 닫힌 `<details>` 글꼴 폭, Adaptive Dark Mode 그라디언트 성능 등을 고쳤다 | `sw.js`는 `cache.addAll`·`cache.put`(`sw.js:57,81`)을 쓰고 `<details>`는 12곳에서 쓴다. 모두 버그 수정 쪽이라 코드 변경은 필요 없다. View Transitions·`content-visibility` 사용은 0건이다 | 관찰/무관 | https://webkit.org/blog/18652/release-notes-for-safari-technology-preview-257/ |
| GPC WebKit API(11-18) | `WKWebView` 앱용 설정이다 | 웹 앱 무관 | 무관 | https://webkit.org/blog/18646/global-privacy-control-gpc-webkit-api/ |

### 3. Chromium

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| **Chrome 158 stable(데스크톱 11-17, 158.0.8127.36/.37 Win·Mac)** | 보안 수정 204건(Critical 6). 게시물에 "in the wild" 표시는 없다. 157.0.8103.80·.81(11-12·11-18), Extended 156.0.8078.108(11-17)도 나왔다 | 앱 코드 무관. 소유자가 Mac Chrome을 쓴다면 158로 업데이트한다. iPad·iPhone Chrome은 WebKit이라 해당 없다 | 관찰(소유자 Mac Chrome 업데이트) | https://chromereleases.googleblog.com/2026/11/ , https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Mac |
| Chrome 159 early stable(11-18, 159.0.8154.13), 160 dev | 159: 단축 스크롤 컨테이너의 scroll snap, `AccentColor`, background 목록 계산값, Sanitizer `javascriptURLs`. 160: View Transitions `shadowRoots`, XML MIME 판정 정리, CSS corner shorthand | 앱이 기대는 `scrollend`(`assets/life/discovery-ui.js`), `:has()`(18개 파일), forced-colors(14개), `details`/`summary`, `history.scrollRestoration`(`assets/life/ui.js`)을 바꾸는 항목은 없다. scroll-snap·View Transitions·`content-visibility` 사용도 0건이다 | 무관 | https://chromestatus.com/api/v0/features?milestone=159 , https://chromestatus.com/api/v0/features?milestone=160 |

### 4. Supabase

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| Auth v2.198.0(11-16) | Go 1.27.4·x/net 보안 갱신. OAuth 서버(`/oauth/token`)가 발급한 토큰은 OAuth 엔드포인트와 읽기 전용 접근만 허용한다. **AAL이 null인 옛 세션을 무효화한다** | 앱은 Google 제공자 `signInWithOAuth`(`assets/platform-auth.js:398`)로 일반 세션을 쓰고, Supabase를 OAuth 서버로 쓰지 않는다. 그래서 토큰 제한은 무관하다. 옛 세션 무효화는 호스팅 적용 시점을 알 수 없고, 기기에서 한 번 다시 로그인하게 될 수 있다(입력 보존은 앱 안전 원칙대로) | 관찰(소유자가 갑자기 로그아웃되면 원인 후보) | https://github.com/supabase/auth/releases |
| Storage·Auth·PostgREST·supabase-js 보안 권고 | 11-09 이후 새 권고가 없다(Storage 마지막 11-06, Auth 03-11, PostgREST·supabase-js 0건) | 2회차 판정 유지. 운영 S3 프로토콜 상태는 여전히 미확인 | 관찰(유지) | https://github.com/supabase/storage/security , https://github.com/supabase/auth/security |
| Changelog | 11-16 Breaking: Management API·MCP로 브랜치를 병합하려면 Production Branches 읽기·쓰기 토큰이 필요하다. 11-17: 대시보드에서 사용자 정의 OIDC 제공자 등록 | 앱은 브랜치 병합을 쓰지 않는다. 총괄의 MCP 운영 SQL 경로도 브랜치 병합을 쓰지 않는다 | 무관 | https://supabase.com/changelog |
| Edge Runtime 1.79.2·1.79.3(11-18·11-20) | AI 확장 onnxruntime 자산, brotli 해제 복사 줄임 | — | 무관 | https://github.com/supabase/edge-runtime/releases |
| 레거시 키 일정 | 변동 없음("by the end of 2026", 수동으로 끄기 전까지 유효) | 1회차 대기 항목 그대로(소유자 몫) | 변동 없음 | https://supabase.com/docs/guides/api/api-keys |

### 5. Anthropic API

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| 모델 수명 | 변동 없음. `claude-haiku-5-5`는 2027-10-07, `claude-sonnet-5-5`는 2027-09-28 전에 퇴역하지 않는다. 09-30 이후 새 퇴역 공지 없음 | 앱은 두 모델만 쓴다(`supabase/functions/haedo-ai/handler.mjs:49`, 마이그레이션 `20261104090000_life_ai_usage.sql:31`) | 무관 | https://platform.claude.com/docs/en/about-claude/model-deprecations |
| 요금 | 변동 없음. Haiku 5.5는 $0.10/$0.50(100K 초과 시 $0.50/$2.50), Sonnet 5.5는 $2/$10, `inference_geo:"us"`는 1.1배 | 마이그레이션 단가 표(`20261104090000_life_ai_usage.sql:56-64`)와 일치 | 무관 | https://platform.claude.com/docs/en/about-claude/pricing |
| 보존 | 변동 없음(30일, 정책 위반 표시 시 최대 2년, 문서 최종 갱신 2026-07-01) | 첫 사용 안내 문구 결정(1회차)과 일치 | 무관 | https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data |
| 릴리스 노트 11-16~11-17 | 텍스트 워터마크(Opus 4.6·4.5, Sonnet 4.5, Haiku 4.5만), 조직 webhook 키 이벤트, Linked billing(beta) | 해당 모델과 기능을 쓰지 않는다 | 무관 | https://platform.claude.com/docs/en/release-notes/overview |

### 6. 접근성·보안 표준

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| W3C WAI·TR | WAI 뉴스는 11-10 글 하나뿐이고 지난 회차에 이미 봤다. W3C 뉴스는 11-17 TAG 선거. Web App Manifest WD를 11-18에 다시 개정했다. 마지막 개정일은 WCAG 2.2 2024-12-12, ARIA 1.3 06-04, CSP3·IndexedDB 3.0 10-13, Trusted Types 09-17, Service Workers 11-02로 모두 11-16 이후 갱신이 없다 | — | 무관/관찰 | https://www.w3.org/WAI/news/ , https://www.w3.org/news/feed/ , https://www.w3.org/TR/appmanifest/ |
| OWASP | 11월 새 표준·Top 10 발표를 찾지 못했다(검색 기준, 이사회 일정만 있음) | — | 무관(미확인: 공식 발표 목록 직접 대조 안 함) | https://owasp.org/ |

### 3회차 관찰 항목 현황

- fast-xml-parser 5.12.1: 저장소 반영 완료(719224f). `haedo-news-wide` 소유자 CLI 배포 상태는 로드맵 11-12 기준 "미배포"이고, 이 세션에서는 운영을 읽지 않아 확인하지 않았다(총괄 몫).
- DOMPurify: 3.4.18이 아니라 이제 3.5.0으로 올린다. 3.4 계열 지원 종료.
- tiptap·prosemirror: B2 아직 미연결. 올릴 판은 tiptap 3.35.0, prosemirror-view 1.43.0(한글 IME 관련 수정 포함), model 1.25.13.
- undici lock 7.30.2: 미반영(두 lock 모두 7.30.1), 다음 Edge 배포 때.
- `interactive-widget`·Adaptive Dark Mode: 27.3 beta 2 단계. 끄는 방법(`only light`)은 문서로 확인.
- Storage S3 프로토콜: 미확인(이 세션 도구로 설정을 읽을 수 없음).
- supabase-js 2.119.2·idb 8.0.4: 보안 사유 없음, 유지.

### 총괄 판정 (2026-11-23)

- **적용 필요:** 이번 회차에는 없다. 새 권고 두 건(DOMPurify GHSA-hrxw, supabase-js storage URL 검증)은 앱이 쓰는 옵션·입력 경로와 맞지 않는다. 플랫폼 변경도 코드 수정을 요구하지 않는다.
- **관찰(다음 작업에 묶음):**
  1. 다음 vendor 갱신 때 DOMPurify 3.5.0으로 올린다. 3.4 지원 종료로 이전 회차보다 우선한다. 대상은 `vendor/dompurify/purify.min.js`·`manifest.json`·`license_header`이고 `sw.js` CACHE 판올림은 통합 담당이 한다. 검사는 `source-markdown`을 불러오는 CI 등록 검사 전체. 위험도 낮음, 소유자 승인 불필요(보안 유지 갱신).
  2. supabase-js 2.119.2는 같은 갱신 묶음의 후보로 둔다.
  3. tiptap·prosemirror는 B2 연결 때 함께 올린다. iPad 터치 선택과 한글 조합으로 회귀를 확인한다.
  4. undici lock은 다음 Edge 배포 때 갱신한다.
- **소유자 확인·승인:**
  1. Mac Chrome 158 업데이트. Apple 기기는 27.2.1이 그대로 최신이다.
  2. Safari 27.3 정식 출시 때 Adaptive Dark Mode를 `color-scheme: only light`로 끌지 결정한다(디자인 판단, Designer와 함께).
  3. `haedo-blog-publish`·`haedo-ai` CLI 배포(`--no-verify-jwt`)는 아직 대기다. 운영 함수 목록(총괄 읽기 조회, 2026-11-23)에서 두 함수의 배포 시각은 11-04·11-05이고, 저장소의 마지막 변경은 11-16(`fb9fdb7`)이다.
  4. Vault `sb_secret_` 교체와 레거시 키 끄기, `haedo-news-wide` 배포는 끝났다. Vault·레거시 키는 소유자 보고(11-1x)로, `haedo-news-wide`는 운영 배포 시각(11-16 09:51 UTC)이 fast-xml-parser 5.12.1 커밋(`719224f`, 11-16 01:04 UTC) 뒤인 것으로 확인했다. 배포 소스 해시는 저장소와 대조하지 않았다.
  5. Auth 옛 세션 무효화로 한 번 다시 로그인하게 될 수 있음을 알아 둔다.

### 미검증·한계

- DOMPurify Security 탭은 1쪽만 읽었다. 3.5.0 릴리스 노트에는 GHSA 번호가 없고, 권고 페이지는 GHSA-hrxw 하나만 대조했다.
- Safari 27.3 `only light` 항목이 beta 1부터 있었는지 beta 2에서 추가됐는지는 문서에 판 구분이 없어 확정하지 못했다.
- Supabase Auth v2.198.0의 호스팅 적용 시점은 공개 출처에 없다.
- 운영 Supabase의 S3 프로토콜 상태와 Edge 함수별 lock은 읽지 않았다. 함수 목록·배포 시각만 총괄이 읽었다.

### 자가개선 (지난 주 작업)

- **CI 설치 단계 멈춤:** 11-18 `browser` 실패 두 번이 같은 원인이었다. 러너 이미지의 apt 미러 이름이 `azure.archive…`에서 `us-east-2.ec2.archive…`로 바뀌어, 그 이름 하나만 바꾸던 우회(`0ff8ee1`)가 맞지 않았다. 첫 실패 때 재실행이 통과해 원인을 늦게 찾았다. → 멈춘 지점을 로그의 시각 간격으로 찾았고, 우회를 이름 패턴(`*.archive.ubuntu.com`)과 제한 시간·재시도로 바꿨다(`d313d2e`). 재실행 통과는 원인 판정이 아니다.
- **작업자가 사용 한도로 멈춤:** 복귀 위치 작업자가 구현·검사를 거의 끝낸 채 멈췄는데, 커밋이 하나도 없었다(지시서에는 "단위마다 커밋"이 있었다). 총괄이 저장해 둔 최종 사본과 작업 트리를 대조해 커밋했다. → 지시서의 커밋 조항을 "검사를 통과한 단위는 전체 점검 전에 바로 커밋"으로 구체화한다(AGENTS.md에 한 줄).
- **디자인 세션의 회신 경로:** Designer 세션은 총괄에게 메시지를 보낼 수 없어, W5 완료 전달문이 그 세션의 기록에만 있었다. 총괄은 회신을 기다리기만 했다. → 다른 세션에 맡긴 일은 회신을 기다리지 않고 그 세션의 기록(`list_events`)을 읽어 확인한다(AGENTS.md에 한 줄).
- **로컬 연속 검사의 결과 폴더:** "새 결과 폴더" 조건이 있는 검사 세 개가 앞선 실행의 폴더 때문에 0초 만에 종료 코드 1로 끝났다. 검사 실패와 실행 조건 실패를 구분해 다시 돌렸다. 로컬 실행 스크립트가 오류 문구 세 가지를 모두 알아보게 고친다(총괄 scratchpad, 저장소 밖).

## 주간 기술 동향 점검 — 2026-11-16 (3회차)

기준: 저장소 `main` bb49a46(`haedo-v220`). 조사는 읽기 전용(확인일 모두 2026-11-16), 11-09 이후 새로 생기거나 바뀐 것만 적는다.

**도구 제약:** `gh api /advisories`는 이번에도 막혔다(세션이 지정 저장소에 묶임) → 각 저장소 Security 탭·권고 페이지를 읽었다. OSV 77개 일괄 조회는 quill·lodash-es 기존 3건만 돌려줬다(아래 두 새 권고 없음). developer.apple.com은 공개 JSON으로 읽었고 `api.deno.land`는 proxy 502.

### 1. 동봉 라이브러리·Edge 의존성

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| fast-xml-parser 5.12.0(`haedo-rss/vendor`, `haedo-news-wide` 공유) | 5.12.1(11-13). **GHSA-7cfw-w2rf-f3jc**(Moderate): `XMLValidator.validate`의 속성 스캐너가 이름 없는 `=` 앞 공백을 다시 훑어 제곱 시간. 기본 옵션에서 해당 | `haedo-rss/feed.mjs:88`, `haedo-news-wide/xml.mjs:51`이 외부 XML에 `validate`를 부른다. 앞단 검사가 `<a      =>`를 막지 못함. 재현: 공백 80k에서 5.12.0 15.3 s, 5.12.1 9 ms. 실제 위험은 낮다(`haedo-rss` `ALLOWED_HOSTS` 빈 배열, `haedo-news-wide`는 `news.google.com`만이고 미배포, 피해는 소유자 요청 실패뿐) | **적용 필요**(news-wide 배포 전) | https://github.com/NaturalIntelligence/fast-xml-parser/security/advisories/GHSA-7cfw-w2rf-f3jc |
| fast-xml-parser 다른 권고 2건(GHSA-474x-hrwr-fgx4, fast-xml-builder GHSA-g62r-xqpr-7fwx) | 비기본 `stopNodes`·`XMLBuilder` 필요 | 사용 0건 | 무관 | 같은 저장소 Security 탭 |
| DOMPurify 3.4.17 | 3.4.18(11-14). GHSA-qm7q-q8h9-jg8q(Moderate) `SAFE_FOR_TEMPLATES` 우회, hook 허용 목록 잔존·clobbering 검사 수정 | 유일한 호출(`assets/life/source-markdown.js:173-176`)은 `SAFE_FOR_TEMPLATES`·hook·`USE_PROFILES` 미사용, `form`·`svg`·`template`·`id`·`name` 금지, 입력은 markdown-it `html:false` 출력 | 관찰(다음 vendor 갱신 때) | https://github.com/cure53/DOMPurify/releases/tag/3.4.18 |
| @tiptap/* 3.32.2, prosemirror-* | tiptap 3.33.1·3.34.0(mark 잔존, undo, 캐럿), inputrules 1.6.0. 보안·IME 수정 없음 | 편집기 번들이 아직 화면에 연결되지 않음 | 관찰(B2 연결 때 함께) | https://github.com/ueberdosis/tiptap/releases , https://prosemirror.net/docs/changelog/ |
| undici 7.30.1(deno.lock 2개) | 새 권고·판 없음 | 2회차 판정 유지(cheerio `/slim`만, undici 사용 0건) | 관찰(다음 Edge 배포 때 lock 7.30.2) | https://github.com/nodejs/undici/security |
| supabase-js 2.117.2, idb 8.0.3 | 새 판·권고 없음(최신 2.119.0·8.0.4 그대로) | — | 관찰(유지) | GitHub releases, npm registry |
| lucide 1.51.0, daisyUI 5.7.16, Quill 2.0.3, markdown-it, js-yaml, fflate, Pretendard, cheerio | 아이콘·테마 추가판만, 보안 판 없음(Quill GHSA-v3m3 패치 판 여전히 없음) | — | 무관 | npm registry, OSV |

### 2. Safari·WebKit·Apple

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| iOS/iPadOS/macOS 27.2.1(11-09) | 보안 수정 9건(AirPlay·Bluetooth·Messages·brotli 등), WebKit·Safari 항목 없음 | 웹 앱 동작 무관 | 관찰(소유자 기기 업데이트) | https://support.apple.com/en-us/149715 |
| Safari 27.3 | 여전히 beta 1. Adaptive Dark Mode·`interactive-widget`·IME 수정 그대로 | 2회차 판정 유지 | 관찰(정식 출시 대기) | https://developer.apple.com/documentation/safari-release-notes/safari-27_3-release-notes |

### 3. Chromium

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| Chrome 157.0.8103.50(11-09)·.78/.79(11-11) | 보안 수정, **CVE-2026-125350(XML use-after-free) 실제 악용 확인** | 앱 코드 무관. Mac Chrome 사용 시 157.0.8103.50 이상 필요. iPad·iPhone Chrome은 WebKit이라 해당 없음 | 관찰(소유자 Mac Chrome 업데이트 확인) | https://chromereleases.googleblog.com/2026/11/ |
| Chrome 158 early stable, 159 beta | Sanitizer `javascriptURLs`, scroll snap, SW static routing 메시지 | 사용 0건 | 무관 | https://chromestatus.com/api/v0/features?milestone=159 |

### 4. Supabase

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| Storage·Auth·PostgREST·supabase-js 권고 | 11-09 이후 새 권고 없음 | 2회차 판정 유지(S3 프로토콜 상태는 여전히 미확인) | 관찰(유지) | https://github.com/supabase/storage/security |
| Changelog | 계정 백업 로그인·MFA 복구 코드(11-13), Correlated Logs | 대시보드 계정 보안. 앱 코드 무관 | 관찰(소유자 선택) | https://supabase.com/changelog |
| 레거시 키 일정, Edge Runtime 1.78~1.79.1 | 일정 변동 없음("by the end of 2026"), 런타임은 지표·TLS 견고성 | — | 변동 없음/무관 | https://supabase.com/docs/guides/api/api-keys , https://github.com/supabase/edge-runtime/releases |

### 5. Anthropic API

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| 새 모델 Fable 5.2·Mythos 5.2(11-09), self-hosted Managed Agents(11-12) | 5.2 전용 규칙 | 앱은 `claude-haiku-5-5`·`claude-sonnet-5-5`만(`supabase/functions/haedo-ai/handler.mjs:42`) | 무관 | https://platform.claude.com/docs/en/release-notes/overview |
| 요금·수명·보존 | 변동 없음(단가는 `20261104090000_life_ai_usage.sql` 표와 일치, 퇴역 공지 없음, 보존 30일) | — | 무관 | https://platform.claude.com/docs/en/about-claude/pricing , https://platform.claude.com/docs/en/about-claude/model-deprecations |

### 6. 접근성·보안 표준

- WAI 뉴스는 11-10 "authoring tools" 글 하나, Web App Manifest WD 11-11 개정. WCAG·CSP3·Trusted Types·Service Workers·IndexedDB 3.0·Permissions Policy는 11-09 이후 갱신 없음. OWASP 새 발표 없음. 분류: 무관/관찰. 출처: https://www.w3.org/WAI/news/ , https://www.w3.org/TR/

### 2회차 관찰 항목 현황

- undici lock 7.30.2: 미반영(두 함수 11-09 이후 변경·배포 없음), 다음 Edge 배포 때.
- prosemirror-model 1.25.13: 미반영, B2 때 tiptap 3.34.0과 함께.
- `interactive-widget`·Adaptive Dark Mode: Safari 27.3 beta 1 그대로, 대기.
- Storage S3 프로토콜: 미확인(이 세션 도구로 설정을 읽을 수 없음).
- supabase-js 2.119.0·idb 8.0.4: 보안 사유 없음, 유지.

### 총괄 판정 (2026-11-16)

- **적용 필요:** fast-xml-parser 5.12.1 번들 교체(작업자 → 독립 검수 → CI → 병합). `haedo-news-wide` 소유자 CLI 배포는 이 병합 뒤에. `haedo-rss`는 RSS 운영 활성화 때 함께 재배포.
- **관찰:** DOMPurify 3.4.18(쓰는 옵션과 무관, 다음 vendor 갱신 때), tiptap·prosemirror(B2 때), 나머지 2회차 관찰 유지.
- **소유자 확인·승인:** Mac Chrome 157.0.8103.50 이상과 Apple 기기 27.2.1 업데이트 확인, Vault `sb_secret_` 교체·레거시 키 끄기(1회차부터 대기), 원하면 Supabase 계정 백업 로그인.

### 자가개선 (지난 주 작업)

- **유실 경로를 연 총괄 지시:** 11-12 W1 2차 검수의 q5("두 기기가 지운 글을 각자 고침 → 글 둘")를 규칙대로 하나로 합치려고 총괄이 결정적 식별자를 지시했고, 3차 검수가 그것이 같은 식별자 재생성을 다시 열어 판 2 이상에서 사본 없이 덮는 BLOCKER를 재현했다. 무작위 식별자로 되돌리고 q5를 한계로 남긴 뒤, 근본 해결은 서버 기록(`retired_posts`, #256)으로 했다. → 수정 회차마다 새 유실 경로가 나오면 총괄 지시도 가설로 보고 되돌린다(AGENTS.md에 추가).
- **저장소 전체 상태를 단언한 검사:** `run-news-wide-postgres`가 "이 마이그레이션이 마지막"을 단언해 무관한 새 마이그레이션(#256)이 CI를 멈췄다. 재현(종료 1) → 앞선 마이그레이션만 재생하도록 수정(종료 0). → 검사는 자기가 기대는 것과의 관계만 단언한다(AGENTS.md에 추가).
- **배포 단계에서만 나는 실패:** v219 배포가 공개 피드 갱신(외부 공급원 상태 의존)에서 멈췄다. 원인은 수집기 정리 함수의 비멱등(#253). PR CI는 외부 공급원 실패 조합을 만들지 않아 못 잡았다 → 같은 조합을 고정본 검사로 추가했다(#253). 시험 작업이 모두 녹색이어도 배포 실행 결과까지 확인한 것이 실패를 놓치지 않게 했다.
- **검사 경합 2건**(`publish-recovery`의 smooth scroll과 Playwright 클릭, `account-wide-home`의 폭 변경 직후 한 프레임): 모두 재현 장치로 결정적으로 만든 뒤 검사만 고쳤다(제품 결함 아님 근거 기록).

## 주간 기술 동향 점검 — 2026-11-09 (2회차)

기준: 저장소 `main` 078159e(`haedo-v217`), 작업 브랜치 dfbf377. 읽기 전용 조사(편집·운영 DB 조회 없음), 확인일은 모두 2026-11-09. 11-04 이후 새로 생기거나 바뀐 것만 적는다.

**네트워크 제약:** `gh api` 권고 경로(`/advisories`, 저장소 security-advisories)는 이번에도 HTTP 403이었다. OSV `api.osv.dev/v1/querybatch`(74개 패키지)·npm registry·github.com 웹 페이지로 대신 확인했다. **OSV에는 undici의 새 GHSA가 아직 GHSA ID로 올라오지 않아 CVE alias로만 조회된다.** OSV 일괄 조회 0건을 안전 근거로 쓰지 않는다.

### 1. 동봉 라이브러리·Edge 의존성

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| undici 7.30.1(deno.lock, `haedo-naver-blog`·`haedo-discovery-private`) | 7.30.2(11-05) 보안 수정 6건, 그중 GHSA-mqg3-3v4r-cm32 High(캐시+리다이렉트 오염, 7.30.1만), GHSA-r4pc-4jcp-7pqc(SRI 공백 우회) 등 | 두 함수는 `npm:cheerio@1.2.0/slim`만 불러오고(`haedo-naver-blog/index.ts:5`, `haedo-discovery-private/index.ts:4`), slim은 htmlparser2·dom-serializer만 쓴다. undici·`fromURL` 사용 0건, 네트워크는 Deno 내장 fetch. lock에만 잡힌 전이 의존성 | 관찰(다음 Edge 배포 때 lock 7.30.2 갱신) | https://github.com/nodejs/undici/releases/tag/v7.30.2 |
| @tiptap/* 3.32.2(14개) | 3.32.3·3.33.0(11-05): link defaultProtocol, bubble/floating-menu IME, collaboration. 보안 수정 없음 | 동봉본에 해당 확장 없음. 링크는 자체 mark·`safeLink`(`assets/life/post-markdown-editor.js:108`) | 무관 | https://github.com/ueberdosis/tiptap/releases |
| prosemirror-model 1.25.12 | 1.25.13(11-08): V8의 텍스트 노드 부분 문자열 메모리 누수 회피 | Chrome에서 긴 글 편집 때만 해당, Safari 무관 | 관찰(B2 편집기 연결 때 vendor 갱신 후보) | https://prosemirror.net/docs/changelog/ |
| supabase-js 2.117.2 | 2.119.0(11-04): global 로그아웃 실패 시 로컬 세션 유지 등. 보안 표시 없음 | 앱은 `signOut({scope:'local'})`만 사용(`assets/platform-auth.js:252,258,272`) | 관찰 | https://github.com/supabase/supabase-js/releases/tag/v2.119.0 |
| idb 8.0.3 | 8.0.4 공식 CHANGELOG 여전히 없음. tarball 비교로 내부 정리뿐(보안 아님) | — | 관찰(유지) | npm tarball 비교 |
| Quill 2.0.3 GHSA-v3m3-f69x-jf25 | 변동 없음(패치 판 없음) | HTML 내보내기 미사용(1회차 판정 유지) | 무관(감시) | https://api.osv.dev/v1/vulns/GHSA-v3m3-f69x-jf25 |
| `haedo-rss` 동봉 fast-xml-parser 5.12.0 외 7개(새 확인) | 5.12.0 최신, OSV 0건 | — | 무관 | https://registry.npmjs.org/fast-xml-parser |
| markdown-it·DOMPurify·js-yaml·fflate·Pretendard·cheerio·daisyUI·lucide | 새 보안 판 없음(lucide는 아이콘 추가만) | — | 무관 | npm registry |

### 2. Safari·WebKit·Apple

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| Apple 보안 릴리스 | 10-29 이후 새 항목 없음 | — | 무관 | https://support.apple.com/en-us/100100 |
| Adaptive Dark Mode | 아직 Safari 27.3 **beta**. `color-scheme: light only` 지원 공지 없음 | 앱은 `color-scheme: light`(`assets/app.css:3`, `assets/life/ui.css:4`) | 관찰(정식 출시 때 결정, 1회차 유지) | https://developer.apple.com/documentation/safari-release-notes/safari-27_3-release-notes |
| Safari 27.3 beta: viewport `interactive-widget` 지원 | 화상 키보드 때 페이지 반응 방식 지정 | 로드맵의 "모바일 편집기 머리 영역이 키보드를 열면 편집 영역을 가림" 항목과 직결. 지금은 `visualViewport`로 처리(`assets/life/photo-post-ui.js:374`) | 관찰(정식 출시 뒤 실기기 글쓰기 묶음에서 `resizes-content`와 비교 실험) | 같은 출처 |
| Safari 27.3 beta: IME 조합 확정 시 요소 삭제·dead key `compositionend` 수정, IndexedDB `getAllRecords()`, SW URLPattern·CSP 수정, line-clamp % 값 폐기 | — | 한글 입력에 유리. API·CSS 변경 불필요(line-clamp는 정수만 사용) | 관찰/무관 | 같은 출처, https://webkit.org/blog/18602/release-notes-for-safari-technology-preview-256/ |

### 3. Chromium

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| Chrome 157 stable(11-03, 보안 213건), 158 early stable(11-04) | 158: Web Install API, Permissions-Policy `focus-without-user-activation`, XSLT 단계 제거. IndexedDB·bfcache·SW 변경 없음 | XSLT 사용 0건, 설치 API 도입하지 않음 | 무관 | https://chromereleases.googleblog.com/2026/11/ , https://chromestatus.com/api/v0/features?milestone=158 |

### 4. Supabase

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| Storage 권고 3건: GHSA-fgvp-cqg6-q8h2(Critical, JWT role `none` RLS 우회, 호스팅 이미 패치), GHSA-3m3f-pjv4-x2fp(High, S3 SigV4 presigned PUT), GHSA-2p28-q2vx-mw6w(Moderate, S3 서명 재전송) | 1은 `none` role JWT를 발급하는 신뢰 발급자(custom access token hook 등)가 있어야, 2·3은 S3 프로토콜을 써야 해당 | 앱은 표준 Storage REST만 사용(`assets/life/blog-remote.js:216,228`, `library-originals-remote.js:86,93`). S3·`x-amz`·signed upload URL·resumable·custom access token hook 사용 0건 | 관찰(운영 Storage S3 프로토콜이 꺼져 있는지 총괄이 대시보드로 확인) | https://github.com/supabase/storage/security |
| JWT 검증 방침이 문서마다 다름 | Functions Auth 문서는 사용자 대상 함수에 verify_jwt=true·`withSupabase` 권고, Signing keys 문서는 회전 전 Verify JWT를 끄라고 함 | `haedo-discovery-private`만 verify_jwt=true로 운영(#214 결정), 나머지 5개는 false | 관찰(서명 키 회전 전 이 함수만 따로 결정) | https://supabase.com/docs/guides/auth/signing-keys , https://supabase.com/docs/guides/functions/auth |
| 새 키 Edge 읽기 방식 | `SUPABASE_JWKS` 문서화, `@supabase/server` 권고. 직접 읽기(`SUPABASE_SECRET_KEYS`의 `default`)도 여전히 문서에 있음 | `_shared/supabase-keys.mjs`는 문서의 직접 방식과 같아 변경 불필요 | 관찰 | https://supabase.com/docs/guides/functions/secrets |
| 레거시 키 폐지 일정, CLI v3 기본값 변경 | 일정은 여전히 "by the end of 2026". CLI는 저장소 CI에서 쓰지 않음 | — | 변동 없음/무관 | https://supabase.com/changelog |

### 5. Anthropic API

| 항목 | 바뀐 점 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| 요금·보존·모델 수명 | 변동 없음. `claude-haiku-5-5`는 2027-10-07, `claude-sonnet-5-5`는 2027-09-28 전 퇴역 없음 | `haedo-ai` 단가·모델 ID 일치 | 무관 | https://platform.claude.com/docs/en/about-claude/pricing , https://platform.claude.com/docs/en/about-claude/model-deprecations |
| IP allowlisting(beta, 11-05) | 조직 단위 API 호출 IP 제한 | 키 유출 피해를 줄일 수 있으나 Supabase Edge 송신 IP가 고정인지 미확인 | 관찰 | https://platform.claude.com/docs/en/release-notes/overview |
| Message threads·텍스트 워터마크·요청 128MB | — | 단일 턴·64KiB 요청이라 해당 없음 | 무관 | 같은 출처 |

### 6. 접근성·보안 표준

- W3C WAI 뉴스는 09-25 이후 새 항목 없음. Web App Manifest(11-06)·AccName 1.2(11-04)·Core-AAM 1.2 CR(11-05) 개정, CSP·Trusted Types·WCAG 문서는 11월 갱신 없음. OWASP 신규 발표 없음. 분류: 관찰/무관. 출처: https://www.w3.org/TR/ , https://www.w3.org/WAI/news/

### 1회차 미결 항목 현황

1. **Supabase 새 키 이전:** 코드 완료(Edge 6개 함수가 새 키를 먼저 읽고 naver cron은 `apikey` 헤더). 남은 일은 소유자 몫인 Vault `haedo_naver_service_role_key`를 `sb_secret_`로 교체하는 것과 레거시 키 끄기 승인.
2. **iOS 27 HEIC 경로:** 실기기 확인 전 그대로(27.3 beta에도 HEIC 변경 없음).
3. **haedo-ai verify_jwt:** false로 배포 완료. 서명 키 회전 전에는 `haedo-discovery-private`(true)만 따로 결정.
4. **개인 화면 CSP:** 여전히 미적용(로드맵 "다른 사용자를 전제로 한 작업은 뒤로").
5. **idb·supabase-js:** 보안 사유가 없어 유지(최신 8.0.4·2.119.0).
6. **Adaptive Dark Mode:** 아직 beta, 결정 보류.

### 총괄 판정 (2026-11-09)

- **적용 필요:** 이번 회차에는 없다. 영향이 확인된 보안 권고가 없고 플랫폼 변경도 앱 코드 수정을 요구하지 않는다.
- **관찰(다음 작업에 묶음):** undici lock 7.30.2 갱신은 다음 Edge 배포 때, prosemirror-model 1.25.13은 B2 편집기 연결의 vendor 갱신 때 함께. `interactive-widget`은 Safari 27.3 정식 출시 뒤 실기기 글쓰기 묶음에서 비교 실험. 운영 Storage S3 프로토콜 상태는 총괄이 대시보드 조회 권한이 생기면 확인(이번 세션 도구로는 설정을 읽을 수 없음).
- **소유자 승인·조치 필요:** Vault 비밀값 `sb_secret_` 교체와 레거시 키 끄기(1회차부터 대기). 서명 키 회전을 할 계획이 생기면 그 전에 `haedo-discovery-private` verify_jwt 방침 결정.

### 자가개선 (지난 주 작업)

- **검사 판정 실수:** 11-08 통합에서 `$(node … | tail -1)` 뒤에 `${PIPESTATUS[0]}`를 읽어 실패한 검사(feature-flow 11/12)를 통과로 기록했다가 다시 돌려 찾았다. → 실제 종료 코드로만 판정한다(AGENTS.md 운영에서 배운 점에 추가).
- **병렬 작업 통합 회귀:** 작업자 셋이 각자 통과했지만 합치자 820px 글 메뉴 패널이 단계 막대를 가렸고, 새 `목표 추가` 링크가 기존 검사 선택자 3곳을 모호하게 만들었다. 총괄이 새로 짠 연결 코드는 같은 일을 하는 기존 도우미를 쓰지 않아 거짓 떠남 확인창을 만들었다(검수 MAJOR). → 통합본 전체 재검사, 기존 도우미 재사용(AGENTS.md에 추가).
- **CI 실패 처리:** 이번 주 CI·통합 검사 실패는 모두 재현해 원인을 확정한 뒤 고쳤다. 검사 경합(홈 복귀 초점과 입력, 메뉴 초점 대기, 늦게 불러오는 RSS 모듈), 제품 동작 변화에 따른 규칙 변경(RSS 격리 Auth 호출 수, 새 링크로 모호해진 선택자), 실제 통합 결함(820px 메뉴 패널)이었다. 재현이 안 된 11-07 `nine-public` 1건은 미해결 기록을 유지한다. 타이밍을 고정하는 재현 장치(rAF 지연 주입, 프레임 붙잡기)가 "간헐"을 결정적으로 만드는 데 효과적이었다.

## 주간 기술 동향 점검 — 2026-11-04 (1회차)

기준: 저장소 `main` 작업 트리 f99a344, AI 제안 브랜치 `origin/claude/relaxed-mayer-7e42wi`(ed0e539). 읽기 전용으로 조사했다(편집·커밋·운영 DB 조회 없음). 확인일은 모두 2026-11-04.

**네트워크 제약:** 이 세션에서 `gh api`(GitHub REST, 대상 저장소 releases·advisories)는 HTTP 403(“GitHub access … not enabled for this session”)으로 막혔다. 그래서 GitHub Advisory DB를 직접 조회하지 못했고, GHSA를 모아 두는 OSV API(`api.osv.dev`)와 npm registry, github.com 웹 페이지(WebFetch)로 대신 확인했다. 그 밖의 공식 출처는 모두 열렸다.

### 1. 동봉 라이브러리 (`vendor/`, Edge 의존성)

| 라이브러리 | 저장소 판 | 최신 공식 판 | 보안 권고(해당 판) | 실제 영향 | 분류 | 출처 |
|---|---|---|---|---|---|---|
| Quill | 2.0.3 | 2.0.3 (2025-01) | **GHSA-v3m3-f69x-jf25 / CVE-2025-15056**, LOW(CVSS4 2.0), 패치 없음. `getSemanticHTML()`/`getHTML()`로 내보낸 HTML에 formula·video embed 값이 이스케이프 없이 들어감 | 앱은 HTML 내보내기를 쓰지 않음(`getSemanticHTML`/`getHTML`/`dangerouslyPasteHTML` 호출 0, AI 브랜치도 0). `assets/life/photo-post-ui.js:1536` formats에 formula·video 없음. 본문은 Delta ops로 저장(`:1585`) | 무관(감시 유지) | https://github.com/advisories/GHSA-v3m3-f69x-jf25 , https://fluidattacks.com/advisories/diomedes |
| Quill 번들의 lodash-es 4.17.21 | 번들 포함 | — | GHSA-r5fr-rjxr-66jc(`_.template`), GHSA-xxjr-mmjv-4gpg(`_.unset/_.omit/_.pullAt`) | `vendor/quill/quill.js`에 해당 함수 없음(트리셰이킹, 검색 0건) | 무관 | https://osv.dev/vulnerability/GHSA-xxjr-mmjv-4gpg |
| markdown-it | 15.0.3 | 15.0.3 | 없음 | `html:false, linkify:false`(`assets/life/source-markdown.js:99`) + DOMPurify | 무관 | https://registry.npmjs.org/markdown-it/latest |
| DOMPurify | 3.4.17 | 3.4.17 (2026-10-12) | 없음 | — | 무관 | https://registry.npmjs.org/dompurify/latest |
| js-yaml | 5.5.0 | 5.5.0 | 없음 | — | 무관 | https://registry.npmjs.org/js-yaml/latest |
| idb | 8.0.3 | 8.0.4 (2026-10-06) | 없음 | 변경 내역은 공식 CHANGELOG·Releases에 아직 없음 | 관찰 | https://registry.npmjs.org/idb |
| supabase-js(auth/storage/postgrest/realtime) | 2.117.2 | 2.118.0 (2026-10-15) | 없음 | 2.117.3: storage 멀티파트에서 필드를 파일보다 먼저 보냄, postgrest TimeoutError 처리. 2.118.0: storage content-encoding, postgrest computed field. 보안 수정은 예제·CI 의존성뿐 | 관찰 | https://github.com/supabase/supabase-js/releases/tag/v2.117.3 |
| lucide-static | 1.51.0 | 1.68.0 (2026-11-04) | 없음 | 아이콘만 추가됨. 보안 영향 없음 | 무관 | https://registry.npmjs.org/lucide-static |
| fflate | 0.8.3 | 0.8.3 | 없음 | — | 무관 | https://registry.npmjs.org/fflate/latest |
| daisyUI CSS | 5.7.16 | 5.7.50 | 없음 | `timeline.html`에서만 쓰는 CSS | 무관 | https://registry.npmjs.org/daisyui/latest |
| Pretendard | 1.3.9 | 1.3.9 (2023-11) | 없음 | — | 무관 | https://registry.npmjs.org/pretendard/latest |
| Edge `haedo-naver-blog` deno.lock(cheerio 1.2.0, undici 7.30.1 외 23개) | — | cheerio 1.2.0 최신 | 23개 모두 OSV 0건 | — | 무관 | https://api.osv.dev |

### 2. 플랫폼 (최근 약 2개월)

| 항목 | 내용 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| iOS/iPadOS 27·Safari 27.0 (09-14), 27.0.1 (09-28), 27.1 (10-23), 27.2 (10-26) | 공개 보안 릴리스 가운데 “actively exploited” 표시 없음 | 기기를 최신으로 유지하면 됨 | 관찰 | https://support.apple.com/en-us/100100 |
| Safari 27.0: **HEIC를 JPEG로 바꾸던 업로드·드래그 동작을 고침** | 앞으로 iPhone·iPad에서 고른 사진이 HEIC 그대로 들어온다 | 업로드한 HEIC는 원본으로 두고 보기용 JPEG를 만드는 처리(`assets/life/photo-post.js:427` createImageBitmap)를 모든 iPhone 사진이 지나게 된다. 실제 기기에서 확인해야 함 | **적용 필요(실기기 확인)** | https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ |
| Safari 27.0: 한국어 IME가 조합을 빠져나가 스페이스를 두 번 눌러야 하던 회귀 수정, contentEditable 선택 유실 수정 | 편집기(Quill) 한글 입력에 유리하다 | iPadOS 27에서 한글 조합 회귀 검사를 다시 하면 좋다 | 관찰 | 같은 출처 |
| Safari 27.0: IndexedDB 버그 수정 3건(배경 트랜잭션 정지, upgrade abort 뒤 v0, worker 복구) | 여러 탭·앱 전환을 쓰는 동기화에 유리 | — | 관찰 | 같은 출처 |
| Safari 27.0: CSP nonce/hash/trusted-types 파싱 강화 | `blog.html`·`cover.html` CSP는 단순 source만 사용 | — | 무관 | 같은 출처 |
| Safari 27.3 beta: **Adaptive Dark Mode**(11-03) | 사용자가 켜면 dark를 지원하지 않는 밝은 사이트를 어둡게 바꾼다. `light dark`를 선언한 사이트는 그대로 두고, 끄려면 `color-scheme: light only`(beta 1은 `only` 미지원) | 앱은 `color-scheme: light`만 선언(`assets/app.css:3`, `assets/life/ui.css:4`)해서 변환될 수 있다. 그러면 검증한 대비가 깨질 수 있다 | 관찰(정식 출시 때 결정) | https://webkit.org/blog/18541/introducing-adaptive-dark-mode/ |
| Safari 27.1/27.2 | 접힘 기기 API, 쿠키 7일 상한 CNAME 예외 수정, transient activation 수정 | 무관 | 무관 | https://webkit.org/blog/18515/webkit-features-for-safari-27-2/ |
| Safari 7일 스크립트 저장소 상한 | 앱은 `navigator.storage.persist()`를 호출하지 않음(검색 0건) | 계정 자동 동기화가 기본이라 피해는 아직 올리지 못한 대기열(outbox)과 초안에 한정된다 | 관찰 | https://searchengineland.com/what-safaris-7-day-cap-on-script-writeable-storage-means-for-pwa-developers-332519 |
| Chrome 157 stable (11-03), 156 (10-29) | 156: IndexedDB SQLite 백엔드(새 저장소에만, API 변화 없음). 157: WebSocket이 열린 페이지도 bfcache에 들어감(단계 출시), Sanitizer `javascriptURLs` 옵션 | 앱은 Realtime/WebSocket을 쓰지 않음(검색 0건). Sanitizer는 Safari에서 쓸 수 없어 DOMPurify 유지 | 관찰(IDB) / 무관 | https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Mac , https://chromestatus.com/feature/5161589557821440 |
| Web Locks·BroadcastChannel | 두 엔진 모두 지원. Safari 27은 lock 요청이 정리된 뒤 abort 처리만 고침 | — | 무관 | WebKit 27.0 |

### 3. Supabase

| 항목 | 내용 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| **레거시 `anon`/`service_role` JWT 키 폐지 예정(“by the end of 2026”)** | Edge에서는 `SUPABASE_SECRET_KEYS`·`SUPABASE_PUBLISHABLE_KEYS`(JSON, 이름별) 사용을 권고. 단수형 `SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SECRET_KEY`는 로컬 CLI용 | 세 Edge 함수가 `SUPABASE_SERVICE_ROLE_KEY`를 읽음: `supabase/functions/haedo-blog-media/index.ts:141`, `supabase/functions/haedo-naver-blog/handler.mjs:40-42,82`, AI 브랜치의 `supabase/functions/haedo-ai/handler.mjs:248-251`. 폴백 `SUPABASE_PUBLISHABLE_KEY`(단수)는 호스팅 환경에 없다. 네이버 cron은 Vault의 service_role JWT를 `Authorization: Bearer`로 보낸다(`supabase/operations/naver-collection-activation.sql:80-83`). `sb_secret_`는 JWT가 아니어서 Bearer로 쓸 수 없다. 레거시 키를 끄면 이 경로가 모두 멈춘다. 클라이언트는 이미 `sb_publishable_`만 받는다(`assets/platform-auth.js:38`) | **적용 필요** | https://supabase.com/docs/guides/api/api-keys , https://supabase.com/docs/guides/functions/auth |
| JWT 서명 키 회전과 `verify_jwt` | “Verify JWT를 켠 Edge 함수가 있으면 회전이 앱을 깨뜨릴 수 있다. 이 설정을 꺼야 한다.” | 기존 두 함수는 `verify_jwt=false`로 직접 확인한다. haedo-ai는 주석에 “platform JWT verification may stay enabled”라고 적혀 있다 → 회전 전에 끄고 배포하는 쪽이 일관됨 | 관찰(AI 배포 때 결정) | https://supabase.com/docs/guides/auth/signing-keys |
| Postgres 15.19/17.11 (09-25) | CVE 44건 수정. ltree/btree_gist 재색인, pgcrypto 레거시 cipher 재암호화 | 마이그레이션에서 ltree·btree_gist·pgp_* 사용 0건. 쓰는 확장은 pg_cron·pg_net뿐 | 무관(운영 판 확인은 총괄 몫) | https://supabase.com/changelog |
| 시간대 버그(10-30), TLS 1.2 CBC 암호 폐지(11-10) | Vancouver 등 3개 시간대 / 오래된 TLS 클라이언트 | 해당 없음 | 무관 | https://supabase.com/changelog |
| 범위를 좁힌 개인 접근 토큰 GA (10-06) | 프로젝트·권한 단위로 제한 | `.mcp.json`의 `SUPABASE_ACCESS_TOKEN`을 이 프로젝트와 필요한 권한만 가진 토큰으로 바꾸면 피해 범위가 줄어든다 | 관찰(소유자 조치) | https://supabase.com/changelog |
| supabase-js 2.118.0 | 위 표 참고 | — | 관찰 | — |

### 4. Anthropic API (AI 제안 `haedo-ai`)

| 항목 | 확인 결과 | 설계와 대조 | 분류 | 출처 |
|---|---|---|---|---|
| 요금 | Haiku 5.5: 입력 $0.10 / 출력 $0.50 per MTok(프롬프트 100K 토큰 이하; 초과 시 $0.50/$2.50). Sonnet 5.5: $2 / $10. 캐시 읽기는 Haiku $0.01, Sonnet $0.10. `inference_geo:"us"`는 1.1배 | 마이그레이션 `20261104090000_life_ai_usage.sql:54-64`의 단가와 일치. 요청은 최대 64 KiB라 100K 구간 아래 | 무관(일치) | https://platform.claude.com/docs/en/about-claude/pricing |
| 데이터 보존 | API 입력·출력은 30일 안에 자동 삭제. 사용 정책 위반으로 표시되면 최대 2년, 분류 점수는 7년. ZDR은 계약으로만 가능 (최종 갱신 2026-07-01) | `docs/life-tools-design/writing-ai-review.md:136`에 예외까지 적혀 있다. 첫 사용 안내 UI는 아직 없음. 안내 문구에 “위반 표시 시 더 길게”를 넣을지 결정 필요 | 관찰 | https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data |
| 구조화 출력 `output_config.format` | stable, Haiku 5.5·Sonnet 5.5 지원. `additionalProperties:false` 필수. min/maxLength·minimum 미지원. refusal이나 max_tokens면 스키마와 다를 수 있음. 스키마 문법은 처음 컴파일 뒤 24시간 캐시 | 핸들러의 두 스키마는 제약에 맞는다. `stop_reason`을 확인한 뒤에만 본문을 파싱한다(`handler.mjs:325-327`) | 무관(일치) | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| effort·thinking·버전 `2026-10-21` | Haiku 5.5 기본 effort는 medium이라 명시가 필요하다. 2026-10-21에서는 temperature/top_p/top_k가 400. Sonnet 5.5는 `thinking:{type:"disabled"}`가 400 | 핸들러가 effort를 명시하고 thinking·sampling 값을 보내지 않는다 | 무관(일치) | Claude API 스킬 문서(공식 문서 캐시), https://platform.claude.com/docs/en/api/migration-2026-10-21 |
| refusal 과금·대체 모델 | 출력 전 refusal은 `bio`·`frontier_llm`·`reasoning_extraction` 범주면 과금. Sonnet 5.5는 서버 측 `fallbacks:"default"`(beta `server-side-fallback-2026-07-01`) 사용 가능. Haiku 5.5는 서버 측 대체 모델·대체 크레디트 없음 | 핸들러는 stop_reason과 관계없이 usage로 정산한다(올바름). 대체 모델을 켜면 다른 모델 단가가 필요한데, 비용 함수가 그 모델을 거부한다 → 지금처럼 `ai_refused`로 표시하는 편이 단순 | 관찰 | https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback |

### 5. 접근성·보안 표준

| 항목 | 내용 | 앱 영향 | 분류 | 출처 |
|---|---|---|---|---|
| WCAG 3 Working Draft (2026-09-10) | 아직 초안. WCAG 2.2가 현행 기준 | 변경 불필요 | 관찰 | https://www.w3.org/WAI/news/ |
| WCAG-EM 2.0 Group Note (2026-07-23) | 웹 앱 평가 방법론 | 접근성 검수 절차를 짤 때 참고 | 관찰 | 같은 출처 |
| 개인 화면의 CSP 부재 | `blog/cover/share/series.html`에만 meta CSP가 있다. `index/life/workspace/login/timeline/privacy.html`에는 meta CSP가 없다(인라인 스크립트 0, 인라인 핸들러 0, `innerHTML =` 41곳). 단, `index.html`·`life.html`은 `assets/shell.js`가 실행 시 `frame-src`만 담은 CSP를 넣는다(PR181, 프리로드 보존 목적) — 총괄 정정 | AI 출시로 개인 글이 화면과 Edge 사이를 오가므로 XSS 2차 방어가 될 meta CSP 추가를 권고 | 관찰(다음 묶음 후보) | https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ (CSP 수정 목록) |
| Permissions-Policy | GitHub Pages는 응답 헤더를 설정할 수 없고 meta로는 지원되지 않는다 | 설정할 수단 없음 | 무관 | — |

### 우선순위 조치 목록

1. **[적용 필요] Supabase 새 API 키로 이전 준비 (2026년 말 전, 레거시 키를 끄기 전)**
   - Edge 세 함수: `SUPABASE_SECRET_KEYS`의 JSON에서 `default`를, `SUPABASE_PUBLISHABLE_KEYS`의 JSON에서 `default`를 먼저 읽고, 레거시 `SUPABASE_SERVICE_ROLE_KEY`·`SUPABASE_ANON_KEY`는 폴백으로만 둔다. 대상: `supabase/functions/haedo-blog-media/index.ts:141`, `supabase/functions/haedo-naver-blog/handler.mjs:40-42,82`, `supabase/functions/haedo-ai/handler.mjs:246-251`(AI 브랜치, 출시 전에 반영하면 재작업이 없다).
   - 서버 키 일치 판정(`key !== SUPABASE_ANON_KEY …`)을 `apikey` 헤더 기준으로 바꾼다. `sb_secret_`는 JWT가 아니어서 `Authorization: Bearer`로 보낼 수 없다.
   - 네이버 cron(`supabase/operations/naver-collection-activation.sql:80-83`)은 `apikey: sb_secret_…` 헤더로 바꾸고 Vault 비밀값 이름을 새로 만든다. 운영 적용은 총괄만 한다.
   - 완료 기준: 레거시 키가 꺼진 격리 환경(로컬 CLI)에서 세 함수 회귀 검사 통과. 운영은 새 키로 배포 → 확인 → 레거시 비활성은 소유자가 승인한 뒤에 한다.
2. **[적용 필요·실기기] iOS/iPadOS 27에서 HEIC 업로드 경로 확인.** Safari 27이 HEIC를 그대로 넘기므로 iPhone 사진으로 다음을 확인한다: 원본 HEIC 보관, 보기용 JPEG 생성(`assets/life/photo-post.js:427`), 메타데이터를 뺀 공개 사본(`supabase/functions/haedo-blog-media/index.ts`). 한글 조합 회귀도 iPadOS 27에서 같이 확인한다. 사용자가 할 확인이다.
3. **[관찰→결정] haedo-ai 배포 설정:** `verify_jwt=false`로 배포해 다른 함수와 맞춘다(서명 키 회전에 대비). 첫 사용 안내 문구에 “30일 보존(정책 위반 표시 시 더 길게)”을 넣을지 정한다.
4. **[관찰] 개인 화면에 meta CSP 추가(별도 묶음):** `script-src 'self'; connect-src https://<project>.supabase.co …; object-src 'none'; base-uri 'none'`부터 시작한다. 대상 파일은 `index.html`, `life.html`, `workspace.html`, `login.html`, `timeline.html`. YouTube oEmbed 등 실제로 연결하는 곳을 먼저 목록으로 만든다.
5. **[관찰] 작은 갱신:** supabase-js 2.118.0, idb 8.0.4로 올릴지는 다음 vendor 갱신 때 정한다(보안 사유 없음). Adaptive Dark Mode는 정식 출시 때 `color-scheme: light only` 적용 여부를 정한다(`assets/app.css:3`, `assets/life/ui.css:4`). 범위를 좁힌 Supabase PAT로 교체하는 일은 소유자 조치다.

### 미검증·한계
- GitHub REST(Advisory DB, releases API)는 세션 권한 때문에 403이었다. GHSA 확인은 OSV로 대신했다.
- idb 8.0.4의 변경 내역은 공식 출처에서 찾지 못했다.
- 운영 Supabase 프로젝트의 Postgres 판·키 상태·함수별 `verify_jwt`는 운영 DB를 읽어야 해서 조회하지 않았다(총괄 몫).
- Chrome 157의 상세 deprecation은 chromestatus 기능 목록만 확인했다.

### 총괄 판정 (2026-11-04)

- **1. Supabase 새 API 키 이전:** 적용한다. AI 세션이 `haedo-ai`(출시 전)와 기존 두 함수·네이버 cron 호출을 새 키 우선·레거시 폴백으로 바꾼다. 레거시 키 비활성은 소유자 승인 뒤에만 한다.
- **2. iOS/iPadOS 27 HEIC 경로:** 소유자 실기기 확인 항목으로 로드맵에 올린다.
- **3. haedo-ai 배포 설정:** `verify_jwt=false`로 배포한다. 함수가 `/auth/v1/user`로 직접 확인하므로 다른 두 함수와 같은 방식이다. 첫 사용 안내에는 "입력은 30일 안에 삭제(정책 위반 표시 시 더 길게 보관)"를 넣는다.
- **4. 개인 화면 CSP:** 다음 묶음 후보로 둔다. `shell.js` 주입 방식과 같이 설계해야 하므로 최적화 세션 범위가 끝난 뒤 다시 정한다.
- **5. 작은 갱신:** 보안 사유가 없으므로 다음 vendor 갱신 때 함께 정한다.
