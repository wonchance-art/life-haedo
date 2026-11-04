# 주간 기술 동향 점검

매주 월요일 09:37 KST에 총괄 세션이 공식 출처를 확인하고, 이 앱(빌드 없는 GitHub Pages, Mac·iPad·iPhone) 기준으로 "적용 필요 / 관찰 / 무관"을 판정해 회차별로 기록한다. 적용 필요 항목은 작업 지시서 → 독립 검수 → CI → 병합·배포 관문을 따른다. 새 기능·외부 전송·삭제·권한 완화는 소유자 승인 뒤에만 한다.

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
