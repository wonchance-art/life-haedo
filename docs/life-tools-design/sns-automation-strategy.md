# SNS 수신 전용 계정 연결 전략

2026-11-05 KST · 설계 제안 · 기준 `origin/main 9570f3d` · [총괄 요청 #193](https://github.com/wonchance-art/life-haedo/issues/193)

## 결론과 이번 범위

첫 단계는 **사용자가 지정한 RSS/Atom 한 곳**을 기존 자료 보관에 연결하고, 같은 계약을 검증한 뒤 **Bluesky 공개 작성 글**로 확장하는 안을 권한다. 실제 사용하지 않는 서비스를 연결하기 위해 계정을 새로 만들지는 않는다. 해당 원천이 없다면 본인 서비스의 공식 내보내기 파일을 먼저 가져오는 대안이 더 작다.

이 문서는 공개 공식 문서와 저장소 코드를 대조한 설계다. 실제 SNS 로그인·앱 등록·토큰 발급·운영 데이터 조회/쓰기·수집·공개·배포는 실행하지 않았다. 비용·쿼터는 확인 시점의 문서와 제안 예산을 구분하고 미확인 조건을 무료·무제한·허용으로 간주하지 않는다. 구현은 총괄의 검수와 소유자의 설계 채택 뒤 별도 작업 지시서로 시작한다.

이번 목표는 **연결 → 가져올 범위 확인 → 새 글 비공개 보관 → 자료 읽기·검색·기기 연속성 → 선택한 해도 사본 공개**다. 외부 SNS 게시·수정·삭제, DM/비공개 타인 자료 수집, 자동 AI 분석, 유료벽·로그인·차단 우회는 넣지 않는다. [현재 제품 기준](../../PRODUCT.md)과 [공통 작업 규칙](../../AGENTS.md)을 따른다.

## 기존 대화에서 총괄에게 넘길 별도 제품 맥락

이 대화에서는 개인 호기심·대중 궁금증·트렌드에서 출발해 질문 추천 → 탐구 → 콘텐츠 제작 → 외부 SNS 발행까지 구상했다. 이는 실제 구현·계정 연결·발행 결과가 아니다. #193의 **수신 전용 설계**와 같은 범위로 합치지 않는다. 총괄에게 이슈 댓글로 차이를 전달했으며, 외부 발행을 추가할지는 별도 제품 결정으로 남긴다. 이 기록은 대화 합의를 폐기하거나 원본 SNS 쓰기 기능을 승인된 구현으로 바꾸는 것이 아니다.

- 개인 추천은 관심·목표·최근 탐구를 쓰고, 계정 독자 반응과 분리한다. 텍스트 질문 소수만 먼저 표시하고 캐시를 재사용한다. 검색·생성·영상 로딩은 사용자가 고르거나 근거 확인이 필요할 때만 한다.
- 제목은 직관적이고 관심을 끌도록 하되 거짓 전제·허위 인용은 만들지 않는다. 원 질문을 표지 제목으로 재사용하거나 실제 발견에 맞춰 바꾼다. 설명부터 읽기와 경험부터 대화하기를 모두 둔다.
- 탐구 기록은 질문·처음 생각·확인 근거·현재 생각·남은 질문을 보관한다. 저장/중단/재개만으로 완결되며 제작·공개는 선택이다. 사용자 경험, AI 해석, 자료의 주장을 구분한다.
- **편집용 계정 프로필**은 목적 → 독자 → 콘셉트/약속 → 화자·말투·제목 강도 → 주제/근거/디자인 기준 → 샘플 확인 → 프로필 확정 순서다. 글·카드·영상 제작과 검수에 같은 프로필 버전을 적용하고 성과에 따른 변경은 제안 후 승인한다. 실제 경험·경력을 가공하지 않는다.
- 책·논문·전문가 발언의 원문과 맥락을 확인하고 영상의 실제 발언·번역·요약·자체 해설을 분리한다. 이용 허락/라이선스와 개별 인용 검토를 구분하며 자동 검사 통과를 법적 적정성 보장으로 표시하지 않는다.
- **수집 연결 프로필**(서비스 계정·접근 범위·수집 주기·보관 정책)과 위 **편집용 계정 프로필**은 다른 개체다. 로그인 계정 하나와 여러 외부 원천, 여러 주제별 편집 콘셉트를 혼동하지 않는다.
- 현재 `haedo-ai`의 선택 발췌·미리보기·명시 전송과 월 비용 계약을 재사용할 가능성은 있으나, 수집 동의로 전체 자료의 AI 전송을 허용하지 않는다. [기존 AI 제안 계약](../design-review/writing-ai-suggestions.md) 이상의 배치 분석·자동 연구는 이번 범위가 아니다.

## 판단 원칙과 자료 보관의 두 종류

**공개 조회 가능, API 이용 가능, 내 계정의 데이터라는 사실, 영구 보관과 재공개 가능은 각각 다르다.** 서비스별로 수집 경로와 정책을 정한 뒤 저장한다.

1. **보관 가능한 원문:** 사용자가 제공한 본인 파일 또는 해당 경로의 조건에서 보존 가능한 자료. 기존 정확 원문·버전·사진·백업 계약으로 보관한다. 파일 안의 타인 글·댓글·음원·사진까지 본인 권리로 간주하지 않는다.
2. **정책 제한 자료:** 갱신/삭제 의무가 있는 API 응답·캐시. 보존기한과 철회 상태가 있는 별도 저장 영역에서 읽기 전용으로 보여준다. 기존 불변 원문·범용 계정 문서·영구 ZIP·AI 색인에 자동 복사하지 않는다. 이 영역이 없으면 해당 API의 자동 수집을 켜지 않는다.

서비스 정책상 삭제가 필요한 자료를 '불변 판' 또는 '내보내기 사본'으로 이름만 바꾸어 보존하지 않는다. 사용자가 별도로 공급한 독립 파일은 경로·해시·제공 시점을 따로 기록한다. 제한 자료가 삭제되면 그 자료를 복제한 발췌·미리보기·파생물도 정책에 따라 제거/차단하며, 독립적으로 작성한 본인의 생각은 구분해 보존한다. 현재의 정확 원문 참조 계약과 충돌하면 자동 최신판 치환 대신 '원문 이용 불가'를 표시한다.

## 수집 방식 선택

| 방식 | 적합한 상황 | 비용·장점 | 제약·보존 조건 |
| --- | --- | --- | --- |
| OAuth 공식 API | 본인 계정과 권한을 검증해 지속 수신 | 구조화 ID·커서·상태, 권한 철회 가능 | 앱 심사·유료 사용·갱신/삭제 의무가 제공처별로 다름. 읽기 최소 범위만 요청하고 SNS 쓰기 권한은 요청하지 않음 |
| 공식 내보내기 파일 | 개인 계정 API가 없거나 초기 과거 자료 확보 | 반복 API 비용이 없고 원본 파일을 사용자가 보유 | 자동 최신화가 아님. 계정·기간·포함 범위를 확인하고 파일형식별 adapter 필요. ZIP/HTML은 비실행 검증·압축 해제 상한·경로 탈출·외부 이미지 차단 |
| RSS/Atom | 공개 블로그의 새 항목 발견 | 인증 없이 시작 가능, ETag/Last-Modified 활용 | 최근 일부만 제공하거나 본문이 요약일 수 있음. 피드 존재가 전문/사진 재수집·재게시 허가는 아님. 항목 소실을 삭제로 판정하지 않음 |
| 공개 페이지 수집 | 공식 경로가 없고 자동 접근·저장 조건이 확인된 원천 | 현재 네이버의 특정 경로 경험 재사용 가능 | robots와 약관·권리·개인정보를 각각 확인. robots 허용만으로 법적 허락을 확정하지 않음. 403/429/로그인 요구에서 우회하지 않고 중지/지연 |

모든 경로는 기존 계약에 맞춰 본문 확보 상태를 `link_only / partial / full_text`로 구분하고, 첨부의 원본/표시용/미확보도 별도 표시한다. API 반환 JSON 전체를 UI에 노출하거나 개인 식별자·토큰을 진단 로그로 복사하지 않는다.

## 서비스별 공식 경로·비용·권한 비교

확인일은 모두 **2026-11-05 KST**다. 아래 숫자는 문서상 수치이며 실제 계정/콘솔·승인 여부는 미검증이다. API 명세와 예제의 존재를 서비스의 모든 저장·재배포 정책 확인으로 확대하지 않는다. 특히 Meta 개발자 원문 일부는 429/접근 실패였으며 공식 Postman으로 확인한 기능과 미확인 정책을 나눴다.

| 원천·우선순위 | 가능한 공식 수신 경로·개인 계정 조건 | 심사·요금·한도 | 저장·미디어 제약과 제안 |
| --- | --- | --- | --- |
| **RSS/Atom · 1단계** | 사용자가 선택한 공개 피드. OAuth 계정 연결과 다름. [RSS 사양](https://www.rssboard.org/rss-specification)·[Atom 사양](https://www.rfc-editor.org/info/rfc4287/) | 공통 API 요금/숫자 quota는 없음; 호스트 정책과 자체 저장/실행 비용은 존재. feed TTL/조건부 GET/429 존중 | summary와 content, enclosure를 구분. 최근 일부만 보이는 피드가 일반 계정 전체 이력을 증명하지 않음. 공개 피드 중 자동 접근·보관 조건이 확인된 원천부터 |
| **Bluesky · 1b** | `public.api.bsky.app`의 [getAuthorFeed](https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed)는 공개 읽기·무토큰. 본인 인증은 별도. 재게시/답글은 원저자 DID로 구분 | 공개 AppView의 [수치 한도](https://bsky.network/docs/rate-limits/)는 고정 공개되지 않음. PDS 3,000/5분을 이 endpoint 한도로 쓰지 않음. 유료 플랜/중앙 심사가 필수라는 근거 미확인 | [CAR export](https://atproto.com/specs/sync)와 [blob](https://atproto.com/guides/blob-lifecycle)은 별도. [개발자 지침](https://bsky.network/docs/developer-guidelines/)의 삭제 요청 처리 필요. DID+AT URI를 항목 키, CID를 판으로 삼고 정책 검토 후 보관 |
| **Mastodon · 2단계, 실제 계정 있으면 1b 대체** | [공개 statuses](https://docs.joinmastodon.org/methods/accounts/)는 무토큰 가능. 비공개 수신은 이번 초기 범위 제외. 공식 글·첨부 Activity Streams JSON [아카이브](https://docs.joinmastodon.org/user/moving/) 제공 | 중앙 공통 심사/요금 없음, 인스턴스별 정책. [기본 rate](https://docs.joinmastodon.org/api/rate-limits/) 계정/IP 각 300/5분, 실제 헤더 우선. archive 요청 간격 7일 | 서버 URL+status ID/ActivityPub URI로 식별. 무만료 [access token](https://docs.joinmastodon.org/api/oauth-tokens/)에 다른 서비스의 refresh 가정을 강제하지 않음. 인스턴스 정책·SSRF 방어 확인 뒤 도입 |
| **Instagram · export 우선, API 후속** | [Meta 공식 API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)는 Business/Creator 대상. Facebook Login은 Page 연결 필요, Instagram Login에 같은 조건을 일괄 적용하지 않음. 일반 개인 계정은 [Accounts Center 내보내기](https://about.fb.com/news/2023/10/manage-your-information-across-apps/) 우선 | App Review/Advanced Access·사업자 인증의 적용 조건, 최신 읽기 quota/가격·토큰 수명·삭제 정책은 개발자 원문 접근 실패로 미확인. 무료/200회/시간으로 가정하지 않음 | 최소 읽기 권한은 로그인 방식·endpoint별 확정. 개인 계정을 강제로 프로 전환하지 않음. 반환 media URL을 최초 업로드 원본이나 영구 저장 권한으로 표시하지 않음 |
| **Threads · 2단계 조건부** | [Meta Threads collection](https://www.postman.com/meta/threads/collection/dht3nzz/threads-api): Threads use case 앱과 사용자 OAuth. 본인 읽기 `threads_basic` 후보, 게시/답글 관리 권한 제외 | [토큰 예제](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api)에 code→장기토큰 교환·refresh, 5,184,000초(60일) 수명. 실제 만료 응답 우선. 최신 읽기 quota/요금·심사·철회·export·보관정책 미확인 | Instagram 프로 조건을 Threads에 복사하지 않음. publishing limit을 읽기 한도로 쓰지 않음. 공식 정책과 실제 앱 조건이 확인되기 전 활성화하지 않음 |
| **X · export 우선, 유료 API 3단계** | [user timeline](https://docs.x.com/x-api/posts/timelines/introduction) 개발자 App 필요, 최근 최대 3,200개. [OAuth2 PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code) 읽기 `tweet.read users.read offline.access` 후보. [공식 ZIP](https://help.x.com/en/managing-your-account/how-to-download-your-x-archive)도 지원 | [현행 가격](https://docs.x.com/x-api/getting-started/pricing) 선불 사용량 과금: Post $0.005/resource, User $0.010. Owned Read $0.001은 인증 사용자=앱 소유자 등 조건 충족 시만. [timeline 제한](https://docs.x.com/x-api/fundamentals/rate-limits) 앱 10,000/15분·사용자 900/15분. 과거 Basic/Pro 가격 사용 안 함 | [정책](https://docs.x.com/developer-terms/policy)은 오프라인 콘텐츠도 수정/삭제 반영 요구. X/소유자 요청 수령 후 가능한 즉시·24시간 내 처리 조건은 모든 삭제의 24시간 polling 허용과 다름. 불변 보관에 직접 넣지 않음. ZIP의 DM/연락처/타인 자료 기본 제외 |
| **YouTube · 링크/메타 후속, API 3단계** | [공개 메타는 API key, 본인은 OAuth](https://developers.google.com/youtube/data/guides/authentication) `youtube.readonly`. channels→uploads playlist→playlistItems→videos로 읽음. [본인 영상 Studio/Takeout 다운로드](https://support.google.com/youtube/answer/56100)는 사용자 제공 파일의 별도 경로 | [11/03 갱신 quota](https://developers.google.com/youtube/data/determine_quota_cost): 기타 endpoint 합산 기본 10,000 units/일; search.list는 별도 100회/일 버킷. 실제 콘솔 우선. [증액 심사](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)는 OAuth 검증과 별개. 유료 quota 구매표는 미확인 | [정책](https://developers.google.com/youtube/terms/developer-policies)의 일반 API 자료 30일 내 갱신/삭제·영상 다운로드/캐시 제한 적용. 자막 일반 수집 불가. 정책 제한 저장 영역이 없으면 링크만 처리; 전사/영상 백업 제외 |
| **티스토리 · RSS/파일 1단계 후보** | [Open API 종료 공지](https://notice.tistory.com/2664)와 [문서의 종료 표시](https://tistory.github.io/document-tistory-apis/apis/). [현재 공식 백업](https://cs.daum.net/faq/service/2036/category/60785/detail/39654) 제공. RSS는 공식 과거 공지 확인, 최신 상세 규격 미확인 | API 신규 OAuth 통합 제외. [백업 재신청](https://cs.daum.net/faq/service/2036/category/60785/detail/39659)은 파일 생성 후 30일 이후. RSS quota·요금 수치 미확인 | 실제 공개 피드와 본인 백업 샘플로 본문·사진·형식 범위를 확인. 과거 2016년 백업 종료 공지를 현행 미지원 근거로 쓰지 않음 |
| **Medium · RSS/파일 1단계 후보** | [신규 API integration/token 중단](https://help.medium.com/hc/en-us/articles/213480228-API-Importing). [profile/publication RSS](https://help.medium.com/hc/en-us/articles/214874118-Using-RSS-feeds-of-profiles-publications-and-topics)·[본인 HTML ZIP](https://help.medium.com/hc/en-us/articles/115004745787-Export-your-account-data) 제공 | 신규 API 앱 경로 제외. RSS 숫자 quota/전체 이력 미확인. 기존 토큰 동작 안내는 새 사용자 연결 가능 근거가 아님 | 유료 글 전문은 RSS에 모두 제공되지 않음. 여러 저자 publication을 본인 글로 수입하지 않음. ZIP의 사진 원본 포함 여부는 샘플 확인 |
| **Substack · RSS/파일 1단계 후보** | [공식 /feed](https://support.substack.com/hc/en-us/articles/360038239391-Is-there-an-RSS-feed-for-my-publication), [본인 posts export](https://support.substack.com/hc/en-us/articles/360037466012-How-do-I-export-my-posts). [API 약관](https://substack.com/api-tos)·[Publisher API 소개](https://substack.com/startups)가 있어 'API 없음'으로 단정하지 않음 | 일반 글 본문 API의 자격·scope·요금·quota 미확인. Developer API 기술 도움말은 404. [공식 MCP](https://support.substack.com/hc/en-us/articles/50834026608916-How-to-connect-Substack-to-your-AI-Assistant)는 Bestseller Admin 제한이며 일반 importer 대체 아님 | Developer API 약관은 공개 프로필 중심·갱신/삭제·프로파일링 제한이 있어 개인 성향 분석과 자동 결합 금지. RSS 유료 본문 범위는 미확인. export에서 구독자 이메일/통계 제외 |
| **브런치스토리 · 파일 우선/연결 보류** | [카카오 공식 서비스](https://www.kakaocorp.com/page/service/service/Brunchstory) 확인. 지원 API·RSS 계약·일괄 export 공식 근거 미확인 | 요금·한도·심사·수집약관도 미확인. 비공식 RSS 주소나 비공식 scraper를 지원 증거로 삼지 않음 | 본인 원고·텍스트와 원문 URL 수입. URL만으로 전문 확보·자동 페이지 수집 허용을 가정하지 않음 |

### 계정·정책별 추가 관문

- **X:** 기본 access token 2시간, `offline.access`일 때 refresh token; [refresh/revoke](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token) 경로 사용. 1,000개 일반 Post 반환은 해당 항목만 $5이며 User 조회·재조회·인프라 비용은 별도다. 동일 UTC일 과금 중복 방지의 soft guarantee를 예산 상한 대신 쓰지 않는다. 자동 충전은 기본 꺼짐을 제안한다.
- **YouTube:** [개인용 OAuth 예외](https://support.google.com/cloud/answer/13464323?hl=en)가 있어도 정책 면제가 아니다. [External/Testing](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)의 일반 refresh token 7일 만료는 장기 무인 운영의 완료 조건과 맞지 않는다. [captions.download](https://developers.google.com/youtube/data/reference/rest/v3/captions/download)는 편집 권한 및 `youtube.force-ssl`/partner scope를 요구하고 200 units다. `youtube.readonly`로 임의 공개 영상 자막을 받을 수 있다고 설계하지 않는다.
- **YouTube 정책:** 앱 내 동의 철회/삭제 요청의 7일과 Google 보안 설정 경로 철회의 30일 조건을 구분한다. 즉시 수집 중지·해당 기한 이내 파기 검증이 필요하다. API 기반 새 파생 데이터/지표 제한도 있으므로 성향 추천/자동 분석 투입은 적합성 확인 전 제외한다. 30일 갱신 규칙은 모든 자료를 30일 보관해도 된다는 포괄 허가가 아니다.
- **Bluesky:** [OAuth](https://atproto.com/specs/oauth)의 PKCE·DPoP·PAR와 [세분화 권한](https://atproto.com/guides/permission-sets)은 별도 후속이다. `atproto`만으로 자료 읽기 권한을 뜻하지 않고 `transition:generic`이나 repo 쓰기 scope를 읽기 전용이라 부르지 않는다. 공개 GET 초기 범위에서는 이 인증 복잡도를 만들지 않는다.
- **Mastodon:** 본인 확인 scope는 [profile/read:accounts](https://docs.joinmastodon.org/api/oauth-scopes/) 지원 버전을 확인한다. 공개 GET과 본인 OAuth를 구분하고 [revoke](https://docs.joinmastodon.org/methods/oauth/)는 인스턴스별로 수행한다. 공통 API 문서로 특정 인스턴스 약관까지 확인한 것으로 표시하지 않는다.
- **공식 export:** 다운로드를 사용자가 직접 수행하고 본인 게시물·그 첨부만 선택해 파싱한다. 원본 ZIP 전체를 자동 서버 업로드하지 않는다. 선택되어 설치된 자료는 현행 규칙대로 계정에 동기화된다. 메시지·연락처·구독자 목록을 제거한 샘플로 포맷을 먼저 검증한다.

## 기존 구현과 오픈소스 선택

네이버 자동 수집은 이미 존재하지만 계정 전체 목록/새 글 수신 성공을 이번에 다시 확인한 것은 아니다. [운영 기록](../design-review/naver-operational-readiness.md)과 최신 로드맵의 관측 범위를 유지한다. 파일 수준 재사용 후보는 다음과 같다.

| 기존 파일/계약 | 재사용할 것 | 그대로 범용화하지 않을 것 |
| --- | --- | --- |
| [handler.mjs](../../supabase/functions/haedo-naver-blog/handler.mjs) | 서버 Auth 확인, owner·사용자/서비스 작업 경계 | Naver action/RPC/blog ID |
| [harvest-worker.mjs](../../supabase/functions/haedo-naver-blog/harvest-worker.mjs) | 작은 claim·기한·checkpoint/finish·부분 실패·유실 ACK 처리 | 현행 Naver 시간/사진 수 예산·페이지 기준선 |
| [harvest-network.mjs](../../supabase/functions/haedo-naver-blog/harvest-network.mjs) | 응답 크기·시간·형식 검사·HTTPS 제한 | Naver 호스트 allowlist를 임의 RSS 호스트로 개방 |
| [collector.mjs](../../supabase/functions/haedo-naver-blog/collector.mjs) | 제한된 RSS 입력·네트워크 방어 | Naver 전용 RSS reader를 범용 Atom parser로 표시 |
| [수집 SQL](../../supabase/migrations/20261021113658_life_naver_captures.sql) | lease/SKIP LOCKED·기대 revision·영속 영수증·manifest 확정의 계약 | blog_id/log_no·Naver count/page·별도 관측 기준선을 범용 테이블로 재사용 |
| [naver-capture-sync.js](../../assets/life/naver-capture-sync.js) | 계정 세대·정확 원문 판·받은 결과 검증 | 새 제공처를 Naver로 사칭해 registry에 설치 |
| [account-docs-sync.js](../../assets/life/account-docs-sync.js) | 계정별 설정·자동 기기 동기화·CAS | 비밀 토큰·raw API 캐시를 일반 문서/백업으로 저장 |

위는 **기존 계약 재사용 후보**이며 범용 수집 엔진이 이미 구현되어 있다는 뜻이 아니다. 새 원천 1개에서 공통점이 검증된 helper만 추출하고 Naver 경로를 동시에 대규모 재작성하지 않는다.

### 다른 세션과의 통합 경계

별도 개인 뉴스 세션이 #193에 [draft PR209](https://github.com/wonchance-art/life-haedo/pull/209) `ef346bf`의 인계를 전달했다. 그 [고정 인계 문서](https://github.com/wonchance-art/life-haedo/blob/ef346bfa676b5eac84938f458866a43325708f46/docs/design-review/news-reader-orchestration-handoff-20261105.md)를 읽고 다음을 반영했다.

- [PR145](https://github.com/wonchance-art/life-haedo/pull/145) `0b7f632`에는 `haedo-discovery-private`와 계정 전용 본문·이미지 캐시·lease/영수증·출처 adapter 원본이 있다. 10/29 설치 기록과 현재 운영 동일성은 별개이고 프런트엔드는 main 미병합이다. 이를 없다고 보고 중복 수집/캐시 서버를 만들지 않는다.
- PR145의 과거 지원 범위는 Frontiers 본문/최대 두 이미지, MIT 본문, LLT RSS 초록이다. 임의 SNS/블로그 전체 수집을 이미 지원한다고 확대하지 않는다. 해당 구현을 재사용하려면 최신 공유 수집 모듈·키 정책·현 뉴스 읽기 칸과 결합 검수가 필요하다.
- 뉴스 세션은 현재 뉴스 읽기 칸·정확 본문 보관·추천/설명 흐름, 이 문서는 서비스 연결·수집 범위·정책·작업 lifecycle을 담당한다. 공유 `storage.js`, 수집 helper, SourceVersion 연결은 총괄이 파일 담당과 공통 인터페이스를 먼저 확정한다. 이번에 옛 PR을 병합하거나 제품 파일을 고치지 않는다.
- 기존 뉴스 관심/언어/반응/읽기 평가·자료 설정은 이미 계정 자동 동기화 대상이다. 이를 신규 기능으로 다시 설계하지 않는다. AI 서버/모듈의 존재와 실제 편집기 화면 연결·운영 비밀값 준비도는 구분한다.

이 연락은 다른 Codex 작업자의 인계이며 **Claude 총괄의 회신/배정 승인으로 표시하지 않는다.** 최종 통합 우선순위와 운영 소스 대조는 Claude가 맡는다.

| 비교 대상 | 공식 최신 확인·라이선스·보안 근거 | 선택 이유 |
| --- | --- | --- |
| **기존 Edge/Cron + adapter** | 현행 저장소의 원문·영수증·사진/계정 동기화 재사용. 아래 Supabase 공식 제한 확인 | **우선안.** 새 상시 서버·별도 credential 저장소 없이 범위를 작게 검증. 제공처별 policy/normalization은 신규 필요 |
| **fast-xml-parser** | [v5.12.0](https://github.com/NaturalIntelligence/fast-xml-parser/releases/tag/v5.12.0), 2026-11-03·[MIT](https://github.com/NaturalIntelligence/fast-xml-parser/blob/master/LICENSE). [DOCTYPE 우회 공지](https://github.com/NaturalIntelligence/fast-xml-parser/security/advisories/GHSA-8r6m-32jq-jx6q)는 5.10.1 수정 명시 | RSS/Atom XML 계층의 **조건부 후보**. Deno 호환·DTD 거부·중첩/메모리 제한·정규화 fixture 실험 후 pin. 최신판의 무취약을 보장하지 않음 |
| **rss-parser** | [공식 manifest](https://github.com/rbren/rss-parser/blob/master/package.json) 3.13.0·MIT·Node≥18, GitHub Releases 없음. npm 최신/전이 보안 현황은 이번에 확정하지 못함 | 비교 후보. Edge 번들·의존성·보안 확인 전 자동 채택하지 않음. 정규식 자체 parser 확대보다 유지비를 비교 |
| **atproto SDK** | [lex 0.4.5](https://github.com/bluesky-social/atproto/releases/tag/%40atproto/lex%400.4.5)·[api 0.30.1](https://github.com/bluesky-social/atproto/releases/tag/%40atproto/api%400.30.1), 11/03. 공식 README는 새 코드 lex 권장·MIT·Node≥22. [OAuth client 0.5.14](https://github.com/bluesky-social/atproto/releases/tag/%40atproto/oauth-client-node%400.5.14) | 공개 GET는 기존 fetch+응답 검증 우선. OAuth 단계에서 공식 구현 재사용과 Edge 호환 검토; DPoP/PAR를 임의 자체 구현하지 않음 |
| **Mastodon 서버** | [v4.7.5](https://github.com/mastodon/mastodon/releases/tag/v4.7.5), 11/03 보안 릴리스·AGPL-3.0 | 수신을 위해 서버를 배포할 이유 없음. 선택한 기존 인스턴스의 API/정책만 사용 |
| **n8n** | [2.46.6](https://github.com/n8n-io/n8n/releases/tag/n8n%402.46.6), 11/04. [Sustainable Use/별도 enterprise 조건](https://github.com/n8n-io/n8n/blob/master/LICENSE.md). [구 Code node 공지](https://github.com/n8n-io/n8n/security/advisories/GHSA-9p7v-45m2-wxgj)에 영향/수정 버전 명시 | 시각 작업 흐름 참고. 현재 단일 사용자 수신만 위해 새 실행 서버·DB·토큰 관리·업데이트 부담을 추가하지 않음 |
| **Postiz** | [v2.25.3](https://github.com/gitroomhq/postiz-app/releases/tag/v2.25.3), 10/24·AGPL-3.0. [토큰 위조 공지](https://github.com/gitroomhq/postiz-app/security/advisories/GHSA-fw23-6gv6-pr5p)는 ≥2.15.0,<2.25.3 영향·2.25.3 수정 명시 | **외부 발행 도구 후보**로 비교했으나 현재 수신 전용과 목적이 달라 도입하지 않음. 수정 공지를 근거로 현 최신판도 해당 결함이 있다고 주장하지 않음 |

공식 릴리스/직접 공지는 조회했지만 설치·lockfile·전체 전이 의존성 감사·성능 실험은 하지 않았다. 이 표는 채택 결정용 근거이며 보안 인증이 아니다. 실제 도입 시 선택 버전과 의존성을 고정하고 현행 advisory를 다시 확인한다. 비교 기록의 형식은 [기존 오픈소스 검토](open-source-review.md)를 따른다.

### Supabase 운영 가능 범위

Supabase 스킬과 [changelog](https://supabase.com/changelog.md)를 읽고 현재 공식 문서를 확인했다. [Edge 한도](https://supabase.com/docs/guides/functions/limits)는 메모리 256 MB·CPU 2초/요청·wall time Free 150초/Paid 400초다. 따라서 긴 영상 처리·거대 ZIP 해제·브라우저 크롤링 대신 짧은 페이지/첨부 작업과 checkpoint를 쓴다. 실제 프로젝트 플랜은 조회하지 않았다.

[Cron](https://supabase.com/docs/guides/cron)의 동시 작업 8개 이하·10분 이하 권장을 따라 원천마다 독립 Cron을 무한 생성하지 않고 due-job dispatcher를 둔다. [예약 함수](https://supabase.com/docs/guides/functions/schedule-functions)의 pg_cron/pg_net/Vault 패턴을 재사용하되, pg_net 대기 queue의 인증 헤더 접근도 제한한다. [Vault](https://supabase.com/docs/guides/database/vault)의 암호화 저장과 복호 view 접근 권한은 별도이며, [Storage RLS](https://supabase.com/docs/guides/storage/security/access-control)와 worker의 명시 owner 검증을 모두 적용한다. OAuth는 [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)과 제공처 규칙을 함께 따른다.

[11/04 CLI v3 변경](https://supabase.com/changelog/supabase-cli-v3)은 이후 운영 설치 때 실행 대상·help·버전을 확인할 근거다. 이번에는 CLI 설치/업그레이드/운영 SQL을 수행하지 않았다. [TLS CBC 변경 예고](https://supabase.com/changelog/cbc-tls-ciphers-deprecated)는 실제 구형 기기 점검 대상이며 현 앱 장애로 단정하지 않는다.

## 제품 흐름과 계정별 상태

설정의 **연결된 서비스**에서 원천별 한 행을 보여준다. 기존 뉴스·일정·자료·설정 탐색을 재사용하고 새 최상위 SNS 메뉴는 만들지 않는다.

1. **원천 선택:** 서비스와 수집 방법, 본문·사진의 확보 범위, 제한된 보관 여부, 비용/외부 통신을 먼저 설명한다. 공개 URL 등록은 OAuth 계정 인증 완료라고 표시하지 않는다.
2. **범위 미리보기:** 과거 글은 `새 글만 / 기간 지정 / 파일에서 선택`으로 시작한다. 전체 과거 글은 제공처가 전체 목록을 제공하고 사용자가 실제 범위를 확인할 때만 선택한다. 기본은 제한된 표본이며 무단 과거 전체 수집이 아니다.
3. **기준 목록 확정:** 최초 피드의 관측 항목과 시점을 보관한다. `관측 범위 준비`와 `계정 전체 이력 확보`는 다른 상태다. 시작 전의 과거 글을 자동 신규 글로 오인하지 않는다.
4. **새 항목 자동 보관:** 선택한 범위·주기·용량 안에서 비공개로 저장한다. 저장 ACK 후 자료·검색·계정 동기화에 반영한다. 뉴스의 발견 후보를 자동으로 좋아요·개인 성향으로 바꾸지 않는다.
5. **읽기·활용:** 자료에서 출처와 정확 판을 연다. 본인 작성이 검증되거나 사용자 확인된 자료만 일정의 외부 기록 투영 후보가 된다. 출처 계정이 일치한다는 이유로 본인 작성 글 모델·연표 사건·행복도 값으로 자동 변환하지 않는다. 일정 투영은 기존 일정 계약 검토 후 연결한다.
6. **선택 공개:** 기존 해도 공개 사본·사진 선택·메타데이터 제거·익명 읽기 검수를 재사용한다. 수집과 공개는 별도이며 외부 SNS로 요청을 보내지 않는다.

원천별 기본값 → 모음 → 항목 예외는 폴더/분류·자료 활용·수집 대상 등 허용된 필드에만 적용한다. 항목 예외가 가장 구체적이며 정책상 금지/차단은 모든 단계보다 우선한다. 규칙이 바뀌어도 기존 원문·사용자 편집·공개본을 조용히 다시 쓰지 않는다. `공개=true`는 이 자동 규칙의 허용 필드가 아니다.

상태 행: 서비스·원천 표시명, 접근 방식, 마지막 시도/마지막 성공, 확보 범위, 새 항목 수, 본문/첨부 부분 실패, 다음 실행, 사용량, 오류 이유, `중지 / 재시도 / 연결 해제`. `연결됨`·`예약됨`·`새 글 보관 성공`을 분리하고 명시적인 첫 신규 항목 수신 전에는 자동 수집 성공으로 표시하지 않는다.

- `중지`: 이후 수집 예약 중지. 보관본 유지. 정책상 필수 갱신/삭제 작업은 멈추지 않으며 유지할 수 없으면 제한 자료를 만료 처리한다.
- `연결 해제`: 세대를 올려 실행 중 응답을 폐기하고 예약·토큰을 폐지한다. 일반 보관본은 유지하고 정책 제한 자료는 제공처 규정대로 처리한다. 외부 계정 자체나 원본 SNS 글은 삭제하지 않는다.
- `가져온 자료 삭제`: 별도 선택과 기존 휴지통/참조/공개 사본 계약으로 처리한다. 연결 해제 버튼에 사용자 자료 삭제를 숨기지 않는다.
- 로그아웃/기기 교체: 연결은 서버의 소유자 설정이며 다른 기기에도 같은 상태를 보여준다. 토큰·작업 비밀은 범용 계정 동기화·백업에 포함하지 않는다.

## 운영 구조와 실패 복구 계약

정적 Pages는 계정 확인·범위 선택·상태 표시만 담당한다. 제공처 토큰과 비밀 키는 서버에 둔다. 제안 구조는 **서비스 adapter → 제한된 Edge 작업 → 비공개 staging → 검증·원자 확정 → 기존 자료/계정 동기화**다. Cron은 작업 시작 수단이며 외부 응답이나 보관 완료의 증거가 아니다.

논리 개체(아직 SQL·스키마 이름 확정 아님):

| 개체 | 핵심 정보 |
| --- | --- |
| 수집 연결 | owner, provider, 외부 안정 ID, 원천 URL, scope, 접근 방식, 상태, generation, policy revision, Vault 참조 |
| 동기화 위치 | 연결 ID, backfill 범위, 관측 기준선, 커서, 마지막 성공, 다음 실행, ETag/Last-Modified |
| 작업/영수증 | 고유 operation ID, 연결 generation, lease/만료 시각, 시도 횟수, 입력 범위, 저장 결과, 비용·바이트 수 |
| 항목/원문 판 | provider+account+item 안정 ID, 원 URL, 원문 바이트 해시, 제공처 revision/CID, 확보 범위, 작성/수정/관측 시각 |
| 첨부 | 해당 정확 판, 순서, 원본/표시용, 해시·형식·바이트 수, 저장/실패 상태, 권리·정책 분류 |
| 제한 자료 정책 | source path, terms 확인일, refresh/delete 기한, 철회/삭제 세대, 백업/공개/분석 가능 범위 |

**OAuth와 토큰:** 짧고 일회성인 state를 해도 owner·연결·허용된 복귀 주소에 묶고 PKCE/제공처 요구를 따른다. callback에서 code를 서버가 교환하며 access/refresh token은 Vault에 저장한다. 브라우저에는 성공 상태만 반환하고 URL에서 code를 제거한다. credential 식별자만 application DB에 둔다. service-role·복호화 view를 브라우저/RLS 일반 조회·계정 문서·로그·백업에 노출하지 않는다. 갱신은 연결별 잠금과 generation/CAS로 직렬화하고 회전한 refresh token 교체를 원자 확정한다. 중간 실패는 재인증으로 복구하며 옛 토큰으로 무한 재시도하지 않는다. 해제/권한 변경 시 제공처 revoke 가능 경로와 로컬 폐기를 함께 처리하고 이미 날아간 응답은 generation 검증 후 거절한다.

**중복·편집:** 안정 ID로 항목을 찾고 정확 원문/첨부 해시와 제공처 revision으로 판을 구분한다. URL의 추적 파라미터·제목·날짜만으로 병합하지 않는다. 재조회와 유실 ACK 재시도는 같은 결과 영수증을 반환한다. 본문이 같아도 사진이 바뀌면 그 차이를 보관한다. 편집 결과는 새 원문 판이고 옛 발췌·사용자 생각·공개 사본을 최신 판으로 치환하지 않는다. 단, 정책상 삭제/교체 의무가 있으면 불변 보존 경로에 들이지 않고 제한 자료 정책을 적용한다.

RSS/Atom은 `feed identity + guid/Atom id`를 우선하고, 없으면 검증된 정확한 항목 링크를 제한적 대체키로 쓴다. 둘 다 없거나 같은 ID가 상충하면 임의 hash ID로 자동 저장하지 않고 확인 대상으로 보류한다. 같은 ID의 내용 변화는 수정 관측이다. `처음 발견`과 `새로 게시`는 구분하며, 신뢰할 수 있는 발행일이 시작 cutoff 뒤임을 확인한 항목만 새 글 자동 보관 대상으로 삼는다. 발행일 미상·과거 날짜·미래 시각 이상·옛 항목 재등장은 별도 확인 목록에 두고 수정 시각을 발행일 대신 쓰지 않는다. 작은 overlap 재조회와 영속 seen-ID 집합으로 재등장을 구분하되, feed 회전 사이 놓친 항목을 모두 찾았다고 보장하지 않는다.

**커서·실패:** 페이지의 항목별 성공/실패를 영속화한 뒤 그 실패가 별도 재시도 큐로 추적될 때만 커서를 전진시킨다. 저장이 실패한 페이지를 처리 완료로 표시하지 않는다. lease 만료 작업은 같은 op로 재개하며 자원 요청 전/저장 전 generation을 확인한다. 429는 Retry-After, 일시 5xx는 상한 있는 지수 backoff와 jitter, 401은 한정 갱신 후 재인증, 403/정책 차단은 명시 중지다. 반복 실패·일/월 비용·바이트 예산 초과에서는 자동 정지하고 성공으로 넘기지 않는다.

페이지 cursor·해당 페이지 모든 항목의 durable job/manifest·영수증은 같은 DB 트랜잭션에서 확정한다. Storage 업로드와 DB는 단일 원자 트랜잭션이 아니므로 staging 업로드→해시 검증→manifest commit을 사용한다. ACK 불명확 시 같은 op 결과를 조회한다. 미참조 객체 정리는 별도 제한된 작업이며 기존 사용자 자료를 삭제하지 않는다. 운영 정리는 총괄의 승인된 설치·삭제 범위를 따른다.

**삭제·철회:** 피드에서 사라짐·일시 404·권한 실패를 즉시 삭제로 보지 않는다. 제공처의 확정 삭제/철회와 확인 불가를 구분한다. 정책상 삭제는 tombstone과 연결 세대가 오래된 수신을 막고, 서버·기기 캐시·검색·미리보기·파생 사본에 전파된다. 오프라인 기기에서 이미 받은 바이트의 즉시 삭제를 보장하지 않으며, 만료/재검증 전 표시 차단과 재접속 정리를 계약에 넣는다. 이를 제공처 요구 안에서 구현할 수 없다면 그 API adapter를 활성화하지 않는다.

**네트워크·미디어:** 임의 URL fetch 프록시를 만들지 않는다. https·원천별 호스트·redirect 매 단계 검증·내부/loopback/link-local/metadata 주소 차단·DNS 재해석 방어가 필요하다. OAuth discovery·Mastodon 서버·feed enclosure도 같은 검증 대상이다. 로그인 cookie·제공처 Authorization을 다른 origin에 전달하지 않는다. XML 외부 엔티티/DTD·과도한 중첩·큰 응답과 HTML script/event/iframe 실행을 차단한다. 미디어는 형식/매직바이트·크기·해시를 확인해 비공개 Storage에 저장하고 검증이 끝난 manifest만 노출한다. 원본과 리사이즈된 CDN 이미지를 구분한다. 동영상 다운로드·전사·재편집은 1단계에 넣지 않는다.

Edge에서 임의 호스트의 DNS/IP 재검증을 보장할 수 없다면 **검증된 고정 호스트만** 첫 출시 대상으로 삼는다. hostname 문자열 검사만으로 SSRF 방어 완료라 하지 않는다. 정책 제한 자료의 백업 제외·tombstone 확인은 복원에서도 적용해 오래된 ZIP이 만료/삭제된 내용을 되살리지 않도록 한다.

**잠정 실행 예산(플랫폼 한도가 아니라 검증할 제품 제안):** 원천별 60분 간격, 변경 없음은 조건부 요청, 한 실행 목록 2페이지/100항목 이내, 텍스트 응답 최대 2 MiB, 사진 최대 10 MiB/개, 작업별 전체 시간·요청 수·일일 바이트 상한. 실제 제공처 한도가 더 작으면 그것을 따른다. 큰 과거 이력은 여러 작업으로 분할한다. 글/사진을 조용히 잘라 성공으로 표시하지 않고 제한 초과 항목을 따로 안내한다. 모바일은 텍스트 우선·사진 선택 로딩·영상 자동재생 없음. 비용 상한의 최종 값은 실제 계정·플랜과 소유자가 정한다.

## 단계별 실행안과 완료 기준

| 단계 | 목표·선행 조건 | 운영 변경·승인 | 완료 기준 |
| --- | --- | --- | --- |
| 0 · 설계 확정 | 본 문서 총괄 독립 검수, 실제 원천 1개·저장 가능한 범위 확인 | 앱/DB/계정 변경 없음. 새 외부 통신·보관 정책·예산은 구현 전 확정 | 공식 자료·불확실성·재사용/자체 구현·검수표·담당 경계가 문서에 있음 |
| 1 · RSS/Atom 한 원천 | 소유자가 사용하는 허용 피드; 기존 계정 자료/사진/백업 재사용 | 총괄이 검수된 신규 비공개 연결·작업·영수증/정책 테이블 및 최소 RPC 설치. 실제 원천·외부 통신·주기·용량 확인 후 켬 | 범위 확인→관측 기준선→실제 새 항목 1개→비공개 저장→다른 기기 읽기·검색→선택 해도 공개→중지/재개/유실 ACK/백업 복원까지 완주 |
| 1의 대안 · 본인 export만 | 실제 사용하는 허용 피드가 없거나 자동 연결 이득이 작은 경우. 개인정보를 제외한 파일 샘플·글/첨부 포함 범위 확인 | 기존 수입·계정 저장 재사용. 파일 adapter/포맷 검증 범위만 변경하고 scheduler/OAuth/연결 테이블 신규 설치는 요구하지 않음. 선택 자료의 계정 저장 범위 안내 | 선택 수입→같은 파일 재수입 중복 방지→수정된 원문 새 판→다른 기기 읽기·검색→백업/복원. 자동 신규 글 감지·예약 기능이 없음을 명시 |
| 1b · Bluesky 공개 글 | 안정 DID·피드/저장 조건 확인; 본인 또는 지정 공개 원천 구분 | 동일 기반의 adapter 추가. 공개 읽기는 OAuth 권한을 꾸며 요구하지 않음. 미디어·보존 범위 확정 | 동일 URI 재조회 중복 0, CID 변경 판 분리, 핸들 변경 추적, 삭제/확인불가 구분, 계정/공간 격리 |
| 2 · 공식 export와 필요한 OAuth | 본인이 실제 쓰는 Meta 개인 계정이면 export 우선; Mastodon/Threads는 심사·권한·정책 확인 후 | ZIP adapter 또는 제공처별 등록·약관·최소 scope·Vault·삭제 경로. 유료 서비스는 비용 별도 승인 | 잘못된 계정/ZIP 폭탄/경로 탈출/토큰 누출/회전 경합/해제 중 늦은 응답을 거절하고 원본·기존 기록 보존 |
| 3 · 제한 API 선택 도입 | X/YouTube처럼 정책 제한 자료의 갱신·삭제가 실제로 필요할 때 | 정책 저장 영역·기한 작업·삭제 전파·백업 제외를 먼저 검증. 요금·권한·허용 범위 확정 | 약정 기한 내 갱신/철회 처리가 복구·오프라인·실패 상황에서도 계약을 충족하는 근거. 불충족이면 활성화하지 않음 |

단계는 구현 지시의 분할안이며 이번 문서 작성으로 자동 승인하지 않는다. 작업자는 기능·SQL을 격리 환경에서 검증하고 브랜치로 넘기며, 총괄이 독립 검수·병합·운영 설치·출시 관문을 맡는다. 새 화면은 Designer에게 샘플/변경 목록을 전달하고 배포판/대기안을 구분한다. 실제 Mac·iPad·iPhone 확인은 브라우저 폭 모사와 별도로 남긴다.

## 검수·반대 검토

- **자료 보존:** 같은 항목 반복, GUID/Atom ID 없는 항목, 식별자 충돌, 발행일 미상/미래 이상, 과거 글 재등장, 같은 GUID 수정, 본문 같고 사진 다름, 과거 정확 인용, 부분 미디어 실패, 오래된 backup 복원에서 잘못된 최신판 치환·권한 부활이 없는지 확인한다.
- **실패 복구:** lease 만료, 저장 성공/ACK 유실, cursor 저장 실패, pagination 중복/누락, 토큰 회전 중단, 해제 직후 완료 응답, 다른 계정·공간 전환, 기기 오프라인 재접속을 검증한다.
- **사용 흐름:** 연결만 성공한 상태, 새 글 없음, 일부 확보, 제한 초과, 중지, 재인증, 해제와 삭제의 차이, 한글 입력/좁은 화면·키보드를 실제 흐름으로 확인한다.
- **공개 경계:** 수집만으로 공개 0, 기본 사진 공개 0, 출처 표시와 재게시 권한 구분, 새 원문이 옛 공개본을 자동 변경하지 않음, 익명은 선택 공개본만 읽음을 확인한다.
- **오픈소스 대안:** 독립 n8n/대형 SNS 관리 서버를 먼저 운영할 필요는 없다. 기존 Cron/Edge/비공개 보관과 소규모 adapter가 적합한지 1개 원천으로 검증한다. 외부 원천·전문 변환·작업량이 커지면 전용 수집 서비스를 다시 비교한다.
- **핵심 가정이 틀릴 때:** RSS가 요약/최근 일부만 제공하면 전문 확보를 약속하지 않고 export로 보완한다. 실제 관심 원천이 없으면 신규 계정 연결보다 파일 가져오기를 선택한다. 신규 글 빈도가 낮으면 수집 주기를 늘린다. OAuth/삭제 운영 비용이 효용보다 크면 공식 export 주기 업로드만 유지한다.
- **기존 콘텐츠 기능과의 관계:** 가져온 자료가 자동으로 사용자의 신념·글·추천 점수·AI 전송·공개물이 되지 않는다. 탐구·작성 흐름을 추가할 때 선택 자료의 정책과 정확 출처를 다시 확인한다.

## 검증 상태와 총괄 인계

이 문서는 설계이며 API 실호출·앱 심사·계정 권한·실제 요금·소유자의 데이터 이행·신규 글 실수신·실기기는 미검증이다. 공개 정책 확인과 기존 코드 읽기를 운영 성공으로 보고하지 않는다. 문서 상대 링크·diff·독립 검토 결과와 정확 커밋은 draft PR 및 #193 댓글에 기록한다. main/운영 적용은 총괄에게 넘긴다.

사전 독립 검토에서는 blocker/major가 없었고, RSS의 식별/신규 관측 기준과 export 대안 완료 기준 보완을 반영했다. 관련 PR209 인계도 추가했다. 이는 문서의 사전 검토이며 Claude 총괄이 배정하는 최종 검수·설계 채택을 대신하지 않는다.
