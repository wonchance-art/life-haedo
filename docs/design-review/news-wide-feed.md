# 뉴스 넓게 찾기 — 서버 (2026-11-11)

**상태:** Edge 함수 `haedo-news-wide`, 마이그레이션 `20261111130000_news_wide_feed.sql`, 허용 계정 설치 SQL, 검사와 이 문서까지다. **마이그레이션 20261111130000은 2026-11-11 운영 적용(6함수 md5 일치). 허용 계정 SQL(2026-11-12 파일)은 2026-11-12 운영 적용(허용 목록 3행, 결과 표 6행 모두 ok). Edge `haedo-news-wide`는 미배포라 화면(#249의 넓게 찾기, 기본 꺼짐)은 켜도 `지금 가져오지 못했습니다`를 보인다.** 로컬 검사 결과와 미검증 항목은 아래 「검증」 절에 나눠 적는다. 운영 적용은 마지막 절의 순서대로 총괄이 한다.

배경: 뉴스 탭이 정해 둔 출처에서만 나와 좁다는 소유자 요청(2026-11-11). 1단계(화면 카드화·5건 상한 해제·고정 출처 확대)는 `news/discover-feed` 브랜치의 다른 작업이다. 이 문서는 2단계의 서버 쪽, 곧 **뉴스 설정에 직접 적은 관심 주제로 외부 뉴스 집계 서비스를 조회해 그 계정에만 돌려주는 경로**다.

## 소유자 승인과 범위 (2026-11-11)

총괄의 질문: "관심 주제를 외부 뉴스 집계 서비스로 보내도 될까요?" 함께 제시한 범위:

- 뉴스 설정에 **직접 적은 관심 주제만**, **설정에서 켰을 때만** 보낸다.
- 좋아요에서 뽑은 단어는 보내지 않는다.
- 받는 서비스 이름을 설정에 적는다.
- 결과는 계정 전용 비공개 저장소에 둔다. 지금의 뉴스 목록은 공개 정적 파일이라 거기에 넣으면 관심사가 공개된다.

소유자 답: **"보내 ㄱ"**.

이 범위를 넘는 전송(다른 신호, 다른 수신처, 사용자를 식별하는 값)은 승인되지 않았다. 수신처를 바꾸거나 더하려면 다시 승인을 받는다.

**승인은 소유자 자신의 주제에 대한 것이다.** 가입이 Google 로그인으로 열려 있으므로, 로그인만으로 쓸 수 있게 두면 다른 사람의 주제가 같은 경로로 나간다. 그래서 **허용 계정 목록에 있는 계정만** 쓸 수 있게 했다(독립 검수 MAJOR-1, 총괄 결정). 목록은 DB의 표이고 비어 있으면 아무도 쓰지 못한다. 아래 「허용 계정」 절 참고.

**공개 수집기와 다른 경로다.** [새 글 자동 갱신](discovery-automation.md)·[출처와 갱신](discovery-sources.md)·[외부 글 발견](external-discovery.md)의 "임의 주제 검색을 받지 않는다", "개인 관심·검색어를 보내지 않는다"는 약속은 공개 정적 목록(`assets/life/discovery-feed.json`)과 그 수집기에 그대로 유효하다. 넓게 찾기는 그 수집기를 쓰지 않고, 허용된 계정의 요청으로만 움직이는 별도 함수다. 공개 파일·서비스워커 캐시·Pages 산출물에는 주제도 결과도 들어가지 않는다.

## 공급원

**Google 뉴스 RSS 검색 피드** 하나로 시작한다(총괄 결정, 확인일 2026-11-11).

- 주소: `https://news.google.com/rss/search?q=<주제>&hl=ko&gl=KR&ceid=KR:ko`, 영어는 `hl=en-US&gl=US&ceid=US:en`.
- 실호출로 확인한 것: 질의 한 번에 최대 100건. 항목은 `title`("제목 - 매체"), `link`(Google 경유 주소), `pubDate`, `<source url="매체 홈">매체 이름</source>`. 이미지는 없다. `description`은 HTML이다.
- 피드 저작권 문구: 개인 피드 리더 안에서 개인·비상업 용도로 Google 뉴스 결과를 보여 주는 목적에만 제공한다. 그 밖의 사용은 금지한다. 이 함수는 **소유자 한 사람의 계정들의 개인 리더**라는 전제에서만 이 문구에 기댄다(2026-11-12: 소유자 계정 3개).
- 원문 주소는 단순 리다이렉트로 얻을 수 없다. **풀려고 하지 않고** Google 주소를 그대로 쓴다.
- 비용 0원. 키·계정 없음.

쓰지 않은 것:

| 후보 | 이유 |
| --- | --- |
| GDELT DOC 2.0 | 이 환경에서 연결 뒤 12초 만에 끊기고 다른 경로에서는 HTTP 503이 두 번 왔다. **검증하지 못했다.** 어댑터 자리만 있고 구현은 없다. |
| 네이버 뉴스 검색 API | 약관이 다른 내용과 섞기·순위 수정·저장을 금지한다. 캐시와 병합이 불가능하다. |
| 유료 뉴스 API | 비용 0원 조건에 맞지 않는다. |

공급원은 `suppliers/google-news.mjs` 한 파일이다. 어댑터가 지킬 계약(고정 호스트·경로, 주제와 언어만 받는 주소 함수, 본문 없는 원시 항목)은 그 파일 머리말에 있고 `upstream.mjs`가 강제한다. 다른 공급원은 같은 모양의 파일 하나와 SQL의 공급원 이름 검사 한 줄을 더하는 작업이며, 그 전에 수신처 변경 승인이 필요하다. 오픈소스·대안 비교는 [오픈소스 검토](../life-tools-design/open-source-review.md)의 2026-11-11 절에 있다.

## 허용 계정

- 표 `haedo_news_wide_private.allowed_accounts(owner_id, added_at)`에 있는 계정만 넓게 찾기를 쓸 수 있다. RLS가 켜져 있고 정책이 없으며 `anon`·`authenticated`·`service_role`에 어떤 표 권한도 없다.
- 마이그레이션은 이 표를 **빈 채로** 만든다. 저장소에는 계정 ID가 없다. 비어 있으면 모든 계정이 거절된다(닫힌 기본값).
- 목록에 계정을 넣는 길은 운영 설치 SQL 두 파일뿐이다. 사용자가 부를 수 있는 함수는 이 표에 쓰지 않는다(검사로 고정).
- `supabase/operations/20261111-news-wide-allow-first-account.sql`(1개 계정용 기록)은 **익명이 아닌 계정이 정확히 1개일 때만** 그 계정을 넣는다. 0개이거나 2개 이상이면 아무것도 넣지 않고 예외로 멈춘다. 운영에는 비익명 계정이 3개라 이 파일은 멈춘다.
- **2026-11-12 소유자 결정: 계정 3개.** 운영의 비익명 계정 3개가 모두 소유자 계정이라는 답에 따라 `supabase/operations/20261112-news-wide-allow-owner-accounts.sql`을 쓴다. 파일 맨 앞의 상수 `expected constant bigint := 3`과 비익명 계정 수가 **정확히 같고**, 비익명 계정 중 `created_cutoff constant timestamptz := '2026-10-04 00:00:00+00'` 이후(또는 생성 시각 없이) 만들어진 계정이 **하나도 없을 때만** 그 계정 전부를 넣는다. 컷오프는 총괄이 읽기 전용으로 잰 "비익명 중 가장 늦은 생성 2026-10-03 11:46Z"의 다음 날이다. 수만 보면 소유자 계정 하나가 지워지고 다른 사람이 가입해도 3개로 같기 때문에 넣었다. 수가 다르면 `Expected exactly 3 non-anonymous accounts (owner decision 2026-11-12), found N`으로, 컷오프 뒤 계정이 있으면 `Found N non-anonymous account(s) created on or after the cutoff …`로 아무것도 넣지 않고 멈춘다. 개수 판정·컷오프 판정·삽입·사후 집합 검사가 같은 조건을 쓴다. 그때는 총괄이 소유자에게 다시 묻는다(파일을 고쳐 계정을 고르지 않는다). 넣은 뒤 목록이 비익명 계정 집합과 정확히 같아야 하고, 목록에 다른 계정이 이미 있으면 멈춘다. 익명 계정은 넣지 않는다.
- 두 파일 모두 이미 들어 있는 계정은 그대로 두고(다시 실행해도 같은 결과), 결과와 알림에는 개수만 나온다.
- 목록에 없는 계정:
  - `claim`은 입력을 보기도 전에 `{"status":"not_allowed"}`를 돌려준다. 행·lease·호출 수를 만들지 않는다.
  - `finish`도 `not_allowed`를 돌려주고 아무것도 저장하지 않는다(받는 도중 목록에서 빠진 경우).
  - `clear`는 `not_allowed`를 돌려주되, 예전에 남은 자기 행이 있으면 지운다(없앨 수는 있어야 한다).
  - Edge 함수는 Auth 확인과 본문 검증 뒤 `claim`에서 `not_allowed`를 받으면 공급원을 **한 번도 부르지 않고** 403 `not_enabled_for_account`로 답한다.

## 기기 밖으로 나가는 것

| 무엇 | 어디로 | 언제 |
| --- | --- | --- |
| 관심 주제 문자열, 언어판(`ko`/`en`) | 해도의 Edge 함수(Supabase) | 넓게 찾기를 켠 화면이 요청할 때 |
| 같은 주제 문자열과 언어판 | `news.google.com` (Google 뉴스) | 허용된 계정이고, 그 주제의 캐시가 30분을 넘었고, 한도가 남았을 때만 |
| 글의 Google 경유 주소 | Google, 이어서 해당 매체 | 사용자가 글을 눌러 새 탭으로 열 때 |

Google로 가는 요청의 정확한 내용(주제·언어 한 쌍에 한 번):

```
GET https://news.google.com/rss/search?q=<주제>&hl=<ko|en-US>&gl=<KR|US>&ceid=<KR:ko|US:en>
Accept: application/xml, text/xml, application/rss+xml
Accept-Encoding: identity
User-Agent: Mozilla/5.0 (compatible; FeedReader/1.0)
```

- 코드가 싣는 것은 위 세 헤더와 네 질의 값이 전부다. 본문·쿠키·`Authorization`·`Referer`·`Origin`은 없다.
- **싣지 않는 것:** 계정 ID, 이메일, 세션 토큰, Supabase 키, 프로젝트 주소·이름, 좋아요·담기·읽은 글. 공급원과 통신하는 모듈(`upstream.mjs`)은 이 값들을 인자로 받지 않는다. 요청에 가짜 소유자 헤더를 실어도 어느 바깥 호출에도 나가지 않는다(검사로 고정).
- 요청은 Supabase Edge의 IP에서 나간다. 사용자의 기기 IP는 Google에 닿지 않는다.
- **런타임이 스스로 붙이는 헤더는 확인하지 못했다.** Deno의 `fetch`가 `Host` 말고 무엇을 더하는지(예: 기본 `Accept-Language`)는 이 환경에 Deno가 없어 보지 못했다. 코드가 넣는 값이 아니고 계정과 무관한 값이지만, 위 목록이 전선 위의 전부라고 단정하지 않는다.
- Google이 알 수 있는 것: 같은 서버 IP에서 같은 시각에 온 주제 묶음. 계정과는 연결되지 않지만 한 사람의 관심 묶음으로 보일 수 있다.
- **글을 누르면** 브라우저가 Google 주소(`news.google.com/rss/articles/…`)를 먼저 거친다. 이때는 사용자의 브라우저가 직접 접속하므로 IP와, Google에 로그인해 있다면 그 쿠키가 Google에 간다. 목록을 보는 것만으로는 Google에 접속하지 않는다.
- 좋아요에서 뽑은 단어를 보내지 않는 것은 **클라이언트가 지킬 계약**이다. 서버는 주제가 어디서 왔는지 구분할 수 없다.

## 저장되는 것과 보존 기간

`haedo_news_wide_private`(비공개 스키마, RLS, 직접 표 접근 없음):

| 표 | 내용 | 개인 데이터 |
| --- | --- | --- |
| `feeds` | 계정, 공급원, 언어, **주제 문자열**, 항목 목록(제목·Google 주소·발행 시각·매체 이름·매체 주소), 받은 시각, 재시도 시각, 진행 표시 | 예. 주제는 관심사다. |
| `limits` | 계정, 이번 시간·오늘의 호출 수와 시작 시각 | 개수뿐 |
| `allowed_accounts` | 허용된 계정, 넣은 시각 | 계정 식별자 |

- 본문·요약·이미지는 받지도 저장하지도 않는다. 항목은 링크 메타데이터뿐이며 DB가 모양을 다시 검사한다(Google 주소가 아닌 링크, 본문 필드가 있는 항목은 저장을 거절한다).
- 다른 계정과 익명은 읽을 수 없다. 읽기는 `auth.uid()`에 묶인 함수로만 한다.
- **누가 무엇을 쓸 수 있는가(정확히):**
  - **항목(글 목록)** 은 Edge 함수만 서버 키로 쓴다. 사용자 토큰으로는 쓸 수 없다.
  - **허용된 계정**은 Edge를 거치지 않고 `life_news_wide_claim` RPC를 직접 불러 자기 계정의 주제 행·진행 표시(lease)·호출 수를 만들 수 있다. 자기 한도를 스스로 쓰는 것뿐이고, 그렇게 만든 주제로 공급원이 호출되지는 않는다(공급원은 Edge가 그 요청에서 다시 검증한 주제로만 부른다).
  - **허용되지 않은 계정**은 아무것도 만들지 못한다.
- **보존:** 캐시는 30분 뒤 새로 받는다. 같은 계정이 7일 동안 찾지 않은 주제는 **그 계정의 다음 조회 때만** 지운다(조회가 없으면 정리도 없다). 계정당 주제는 64개까지이며, 넘으면 오래 안 쓴 것부터 64개가 될 때까지 지운다. 계정을 지우면 함께 지워진다.
- **설정을 끄면** 클라이언트가 `life_news_wide_clear()`를 불러 그 계정의 캐시를 바로 지운다. 이 호출이 없으면 다음 조회가 없으므로 주제가 서버에 남는다. 호출 수 기록은 지우지 않는다(지워서 한도를 다시 얻지 못하게).
- 다른 표의 데이터는 읽지도 고치지도 않는다.
- **로그:** 시각, 정해진 상태 낱말, 주제 개수, 언어 개수, 공급원 호출 수, 상태별 개수, 항목 수, 걸린 시간뿐이다. 기록기는 그 밖의 필드와 숫자가 아닌 값을 버린다. 주제 문자열, 글 제목, 주소, 계정 ID, 공급원 응답 본문은 남기지 않는다.

## 수치와 근거

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 주제 수 | 1~8개 | 설정에 손으로 적는 양. 8×언어 2 = 16쌍이 한 요청의 최대 호출이다. |
| 주제 길이 | 1~40자(코드 포인트) | 낱말 몇 개. 문장·본문을 보내는 통로가 되지 않게 한다. |
| 캐시 유지(TTL) | 30분 | 탭을 열 때 새로 보이면 충분하다. Google 응답은 `no-cache`라 따를 값이 없어 직접 정했다. 16쌍을 30분마다 받으면 시간당 32회다. |
| 계정당 공급원 호출 | 시간당 60회 | 전체 갱신 두 번(32회)에 주제를 고쳐 쓰는 여유를 더한 값. |
| 〃 | 하루 600회 | 16쌍 × 시간당 2회 × 18시간 = 576. 켜 둔 탭이나 고장 난 클라이언트가 하루 1,440회까지 보내는 것을 막는다. |
| 주제·언어당 항목 | 30건 | 응답 100건 중 최신 30건. |
| 요청 전체 항목 | 200건 | 16쌍 × 30 = 480을 한 번 더 줄인다. 주제마다 돌아가며 뽑아 뒤 주제가 밀려나지 않게 한다. |
| 공급원 응답 크기 | 1 MiB | 100건 응답 실측 약 111 KB의 9배. |
| 호출 제한시간 / 동시 호출 | 8초 / 4개 | 실측 0.7~1.7초. |
| 요청 전체 예산 | 25초(저장·응답용 4초 포함) | 남은 시간이 1초 미만이면 나머지 주제는 시도하지 않고 다음 요청으로 넘긴다(대기 없음). |
| 진행 표시(lease) | 60초 | 전체 예산 25초와 저장 8초보다 길게. 같은 주제를 두 요청이 동시에 받지 않는다. |
| 실패 뒤 대기 | 5분(연결·형식 오류), 30분(429·403·리다이렉트) | 공급원이 막고 있을 때 반복해서 두드리지 않는다. |
| 보관 주제 수 / 미사용 정리 | 64개 / 7일 | 주제를 몇 번 바꿔 쓴 분량. |

한도와 캐시는 계정별이다. 2026-11-12 소유자 결정으로 허용 계정이 3개이므로 전체 상한은 시간당 180회, 하루 1,800회다. 시간·하루 한도는 고정 구간이라, 구간이 바뀌는 순간에는 짧은 시간에 두 구간 몫(계정당 120회, 3개면 최대 360회)이 나갈 수 있다. 캐시도 계정별이라 같은 주제를 계정마다 따로 받는다(세 계정이 같은 주제 16쌍을 켜 두면 30분마다 48회, 시간당 96회).

Google 차단 위험은 이 수치로 본다. 공급원 쪽에서는 Supabase Edge의 같은 IP 대역에서 오는 호출로 보이므로, 계정이 셋이어도 한 출처의 호출량이다. 평소 쓰임(한두 기기에서 탭을 열 때 갱신)은 계정 하나 기준 시간당 32회 이하라 세 계정을 합쳐도 시간당 100회 안팎이고, 상한 180회·경계 360회는 고장 난 클라이언트나 켜 둔 탭이 셋 다 돌 때의 최악값이다. 이 최악값에서 429·동의 화면이 나오면 함수는 그 요청의 남은 호출을 멈추고, 막힌 주제만 30분 대기에 들어간다. 멈춘 나머지 주제는 대기가 없어 다음 요청에서 다시 시도하므로, 모든 주제가 대기에 들어갈 때까지 요청마다 최대 한 번(동시 4개까지) 더 나갈 수 있다. 실제 Edge IP에서 Google이 몇 회까지 받아 주는지는 확인하지 못했다(「검증」 절 미검증). 차단이 잦으면 계정당 한도를 낮추는 새 마이그레이션을 먼저 검토한다. 값을 바꾸려면 새 마이그레이션과 이 표를 함께 고친다.

## 요청과 응답

`POST {SUPABASE_URL}/functions/v1/haedo-news-wide`

- 헤더: `Authorization: Bearer <사용자 세션 토큰>`, `apikey: <공개 키>`, `Content-Type: application/json`.
- 본문(이 두 필드만. 다른 필드가 있으면 거절):

```json
{ "topics": ["기후", "climate change"], "languages": ["ko", "en"] }
```

### 주제 규칙

글자·숫자·결합 부호, 한 칸 띄어쓰기, 그리고 `. & + # ' ’ · / - , % ! ?`만 받는다. 정규화(NFC, 공백 한 칸, 앞뒤 공백 제거)한 뒤 대소문자만 다른 중복은 하나로 친다. 검색 서비스가 지시로 읽을 수 있는 것은 **인용하지 않고 거절한다**(인용하면 주제가 조용히 정확 일치 검색으로 바뀐다). Edge(`topics.mjs`)와 SQL(`topic_valid`)이 같은 규칙을 쓴다.

| 구분 | 예 | 결과 |
| --- | --- | --- |
| 낱말 | `기후`, `climate change`, `日本 経済`, `São Paulo` | 허용 |
| 낱말 안의 기호 | `K-pop`, `3-1`, `COVID-19`, `C++`, `C#`, `.NET`, `3.5`, `R&D`, `AI/ML`, `3·1 운동`, `Node.js 22` | 허용 |
| 일반 문장 부호 | `10%`, `10,000`, `1,000원`, `Yahoo!`, `왜?` | 허용(검색 연산자가 아니고 `q` 안에서 인코딩된다) |
| 글자 사이의 작은따옴표 | `O'Reilly`, `O’Reilly` | 허용(`’기후’`, `기후’`처럼 낱말 밖에 있으면 거절) |
| 맨 앞·맨 끝의 `OR` `AND` `NOT` | `Portland OR`, `Oregon OR`, `OR 연산`, `NOT 기후` | 허용(양쪽에 낱말이 있어야 연산자다) |
| 낱말 사이의 `OR` `AND` `NOT` | `기후 OR 날씨`, `a NOT b` | 거절 |
| 따옴표·괄호 | `"기후"`, `“기후”`, `'기후'`, `(기후)`, `[기후]`, `「기후」` | 거절 |
| 쌍점 | `site:example.com`, `when:1d`, `intitle:기후`, `50:50` | 거절 |
| `-`·`+`로 시작하는 낱말 | `-기후`, `기후 -날씨`, `+기후` | 거절 |
| 글자·숫자 사이가 아닌 `-` | `a,-b`, `a/-b`, `a.-b`, `a&-b`, `a!-b`, `a?-b`, `기후-`, `a--b` | 거절(기호 뒤의 `-b`가 제외 연산자로 읽힐 수 있다. `-`는 앞뒤가 모두 글자·숫자일 때만 받는다) |
| 이어진 점 | `1..10`, `a..b`, `..NET` | 거절(숫자 범위로 읽힐 수 있다. 점 하나는 허용) |
| 그 밖의 기호 | `기후*`, `a|b`, `기후~`, `a<b`, `a=b`, `a;b`, `@handle`, `$100`, `a_b` | 거절 |
| 이모지·그림 기호 | `🌿`, `❤`, `→` | 거절 |
| 보이지 않는 문자 | 줄바꿈, 탭, 제어 문자, 폭 없는 공백, 방향 전환 문자, 한글 채움 문자 | 거절 |
| 글자·숫자가 없는 주제 | `...`, `?!`, `#` | 거절 |
| 길이 | 41자 이상, 빈 문자열 | 거절 |

알려진 한계:

- 전각 글자는 글자다. 전각 `ＯＲ`은 낱말 사이에 있어도 통과한다(Google이 연산자로 읽는지는 확인하지 않았다).
- SQL은 유니코드 글자 분류를 쓸 수 없어, "글자·숫자·결합 부호만"은 Edge가 최종으로 본다. SQL은 위 표의 거절 항목과 알려진 기호·이모지 구간을 막고, Edge가 받는 주제는 모두 받는다(무작위 2만 개 대조). `-`와 작은따옴표도 SQL은 "앞뒤가 공백·허용 기호·처음·끝이 아닐 것"으로만 본다. 결합 부호 바로 옆의 `-`는 Edge만 거절한다.
- SQL 규칙은 호출한 세션의 `standard_conforming_strings`와 무관하다. 이스케이프가 든 리터럴은 모두 `E''`이고, 정규식에 백슬래시를 넘기지 않으며, 백슬래시 문자는 `chr(92)`로 찾는다(검사가 on·off 두 세션에서 같은 답을 단언한다).
- 발행 시각의 시간대 표기는 `+9999`처럼 실제로 없는 값도 형식만 맞으면 계산에 쓴다. 하루 넘게 앞선 시각은 버리므로 화면 순서를 크게 흔들지는 못한다.

### 응답

응답 200:

```json
{
  "supplier": "google-news-rss",
  "items": [
    { "id": "4f0c…32자", "title": "가상 도시, 기후 적응 계획 발표", "link": "https://news.google.com/rss/articles/CBMi…?oc=5",
      "publishedAt": "2026-11-11T09:35:00.000Z", "sourceName": "가상일보", "sourceUrl": "https://www.gasang-ilbo.example/",
      "topic": "기후", "language": "ko" }
  ],
  "fetchedAt": "2026-11-11T13:00:00.000Z",
  "stale": false,
  "topics": [
    { "topic": "기후", "language": "ko", "status": "fresh", "fetchedAt": "2026-11-11T13:00:00.000Z", "count": 6 },
    { "topic": "기후", "language": "en", "status": "limited", "fetchedAt": null, "count": 0, "reason": "hourly_limit" }
  ]
}
```

- `items`: 최신순(발행 시각 없는 글은 뒤). 같은 주소는 한 번만, 요청에서 먼저 적힌 주제 쪽에 붙는다. `id`는 주소의 SHA-256 앞 32자라 다시 받아도 같다. `publishedAt`·`sourceName`·`sourceUrl`은 없으면 `null`이다. `sourceUrl`은 https 주소만 남긴다(실측 100건 중 13건이 http라 `null`이 된다).
- `title`과 `sourceName`은 **일반 글자**다. `<`나 `&`가 그대로 들어 있을 수 있다. 보이지 않는 문자와 방향 전환 문자는 공백으로 바꾼다.
- `fetchedAt`: 목록에서 가장 오래된 부분의 받은 시각. 보여 줄 것이 없으면 `null`.
- `stale`: 30분을 넘긴 캐시가 하나라도 섞였으면 `true`.

| `status` | 뜻 | `reason` |
| --- | --- | --- |
| `fresh` | 방금 공급원에서 받았다 | — |
| `cached` | 30분 안의 캐시 | — |
| `stale` | 새로 받지 못해 오래된 캐시를 돌려준다 | `network_error` `rate_limited` `blocked` `invalid_response` `not_attempted` `busy` `backoff` |
| `failed` | 새로 받지 못했고 캐시도 없다 | 위와 같음 |
| `limited` | 한도를 다 써서 캐시만 돌려준다(없으면 빈 목록) | `hourly_limit` `daily_limit` |

`blocked`는 공급원이 리다이렉트(동의 화면 등)나 401·403으로 답한 경우다. `busy`는 같은 계정의 다른 요청이 그 주제를 받는 중, `backoff`는 직전 실패 뒤 대기 중, `not_attempted`는 요청의 시간 예산이 먼저 끝났거나 같은 요청에서 공급원이 이미 막은(`rate_limited`·`blocked`) 경우다.

오류(본문 `{ "error": "<코드>" }`):

| 코드 | HTTP | 뜻 |
| --- | --- | --- |
| `invalid_request` | 400 | 본문 모양·개수·언어·알 수 없는 필드. `POST`가 아니면 405 |
| `invalid_topic` | 400 | 주제가 위 규칙에 맞지 않는다 |
| `unauthorized` | 401 | Auth가 세션을 거절했다(401·403), 익명 로그인이다, 일반 로그인 계정이 아니다 |
| `not_enabled_for_account` | 403 | 로그인은 됐지만 허용 계정이 아니다 |
| `origin_not_allowed` | 403 | 허용하지 않은 웹 출처 |
| `auth_unavailable` | 503 | Auth가 잠시 답하지 못했다(429·5xx·연결 실패). **로그아웃할 일이 아니다.** 잠시 뒤 다시 시도 |
| `setup_required` | 503 | 키·마이그레이션·파서가 준비되지 않았다 |
| `server_error` | 500 | 그 밖의 실패. 공급원·DB의 원문은 담지 않는다 |

캐시 지우기는 Edge를 거치지 않는 RPC다: `POST {SUPABASE_URL}/rest/v1/rpc/life_news_wide_clear`(사용자 세션, 본문 `{}`) → `{ "status": "cleared", "removed": 3 }`. 허용 계정이 아니면 `status`가 `not_allowed`다.

## 실패했을 때

- 공급원이 답하지 않거나 형식이 다르면 그 주제만 `stale`(캐시 있음)이나 `failed`(없음)가 되고 나머지 주제는 정상으로 온다. 요청 전체가 오류가 되지 않는다.
- 리다이렉트는 같은 호스트라도 따라가지 않는다. 그 주제는 실패다.
- **공급원이 막으면(429, 401·403, 리다이렉트) 같은 요청의 남은 호출을 보내지 않는다.** 이미 나간 호출(최대 4개)만 끝나고 나머지는 `not_attempted`가 된다. 막은 주제는 30분, 시도하지 않은 주제는 바로 다시 받을 수 있다.
- 응답이 1 MiB를 넘거나 XML이 아니거나 DOCTYPE·엔티티 선언이 있으면 통째로 버린다. 일부만 쓰지 않는다.
- 실패한 주제는 5분(막힌 경우 30분) 동안 다시 부르지 않는다.
- 한도를 넘으면 공급원을 부르지 않고 캐시와 사유만 돌려준다.
- DB가 항목을 거절하면 그 항목은 화면에 내보내지 않고 실패로 한 번만 기록한다. 저장 결과를 확인하지 못하면 `server_error`다.
- Auth가 잠시 답하지 못하면 `auth_unavailable`(503)이다. 로그인 문제(`unauthorized`)와 구분한다.

## 클라이언트가 지킬 계약 (화면 작업자에게)

1. 설정 `넓게 찾기`는 **기본 꺼짐**이다. 켜는 자리에 수신처를 **`Google 뉴스`**로 적는다(어댑터의 `label`).
2. **켰을 때만** 함수를 부른다. 꺼져 있으면 요청이 없다.
3. **뉴스 설정에 직접 적은 주제만** 보낸다. 좋아요·담기·읽은 글에서 뽑은 단어, 자동 추천 주제는 보내지 않는다.
4. 넓게 찾은 글은 **새 탭으로만** 연다(`target="_blank"`, `rel="noopener noreferrer"`). 앱 안 읽기(비공개 읽기 Edge)에는 넘기지 않는다. 주소가 `https://news.google.com/`으로 시작하는지 화면에서도 확인한다.
5. `담기`는 **링크만** 보관한다. 제목·매체 이름은 표시용으로 함께 둘 수 있으나 본문을 가져오지 않는다.
6. `title`·`sourceName`은 `textContent`로 넣는다. HTML로 넣지 않는다. **`link`·`sourceUrl`도 DOM 속성으로만 넣는다**(`element.href = item.link`). HTML 문자열을 조립해 넣지 않는다 — `sourceUrl`에는 `'`가 들어 있을 수 있다.
7. 결과와 주제를 공개 정적 파일, 서비스워커 캐시, 공개 페이지에 넣지 않는다.
8. 설정을 끄면 `life_news_wide_clear`를 부른다. 실패하면 다음에 다시 시도한다.
9. 계정이 바뀐 뒤 도착한 응답은 버린다.
10. 주제 입력란에서 위 「주제 규칙」을 먼저 검사해 어느 주제가 안 되는지 알려 준다. 서버의 `invalid_topic`은 최종 확인이다. 안내에 쓸 거절 예: `"기후"`(따옴표), `site:example.com`·`50:50`(쌍점), `-날씨`(빼기로 시작), `a,-b`(기호 뒤의 빼기. `-`는 글자·숫자 사이에만), `1..10`(이어진 점), `기후 OR 날씨`(낱말 사이의 대문자 `OR`), `기후*`, `🌿`. 허용 예: `K-pop`, `3-1`, `.NET`, `10%`, `1,000원`, `Yahoo!`, `왜?`, `Portland OR`. 화면 검사는 `supabase/functions/haedo-news-wide/topics.mjs`의 `normalizeTopic`과 같은 결과를 내야 한다.
11. `topics[].status`가 `stale`·`limited`·`failed`일 때 목록의 시각(`fetchedAt`)과 함께 짧게 알린다. `limited`에 재시도 버튼을 반복해서 누르게 만들지 않는다.
12. 고정 출처 목록과 한 화면에 섞어 보여 줄 수 있지만 넓게 찾은 글임을 구분할 수 있어야 한다(매체 이름, 받은 서비스).
13. **403 `not_enabled_for_account`:** "이 계정에서는 넓게 찾기를 쓸 수 없습니다"라는 뜻으로 알리고 설정을 끈 상태로 둔다. 다시 시도하지 않는다. 로그아웃시키지 않는다.
14. **503 `auth_unavailable`·`setup_required`, 500 `server_error`:** 일시 오류로 알린다. **로그아웃 처리하지 않는다.** 로그인 화면으로 보내는 것은 401 `unauthorized`뿐이다.

## 검증

실행한 것(로컬, 2026-11-11, 최종 head 기준):

- `node --test tests/news-wide-edge.test.cjs tests/news-wide-handler.test.cjs` — 입력 검증, 주제 규칙, 주소 조립, 어댑터 계약, 리다이렉트·크기·형식 거절, 파싱·정규화·상한, 인증 거절과 Auth 일시 장애 구분, 허용 계정 거절, 캐시 상태별 응답, 공급원 거절 뒤 중단, 로그 필드, 허용 출처, 키 형식, 배포 파일의 보이지 않는 문자 없음과 SHA-256 표 대조.
- `node tests/run-news-wide-postgres.cjs` — 격리 PostgreSQL 16에서 기존 객체 불변, 권한, 허용 계정과 설치 SQL(계정 0·익명만·1·3개, 미리 채워진 목록, 재실행, 출력에 개수만), 2026-11-12 소유자 계정 SQL(별도 DB에서 비익명 0·익명만·1·2·4개와 익명이 실계정으로 바뀐 경우·3개 중 하나 삭제 → 멈춤과 목록 불변, 수는 3이지만 컷오프 뒤 계정이 섞인 경우(소유자 계정 하나 삭제 뒤 새 가입, 생성 시각 없음, 컷오프 뒤 생긴 익명의 영구 전환) → 멈춤과 목록 불변, 다른 계정이 든 목록 → 멈춤, 3개 → 셋 모두 들어가고 익명 제외·이미 있던 행 유지, 재실행 불변, 실행 중 `public` 표·`haedo_*` 표·`auth.users` 행 수 변경 → 되돌림, 들어간 세 계정의 실제 `claim`, 알림·오류·결과에 UUID·`@` 없음, 전부 ASCII·`\u`와 백슬래시 없음), 소유자 격리, 입력 검증, Edge·SQL 주제 규칙 대조(목록과 무작위 2만 개), `standard_conforming_strings` on·off 두 세션의 같은 답, 설치 SQL 실행 중 다른 표·`auth.users` 행 수가 바뀌면 되돌림(다른 연결에서 행 추가), TTL·대기·한도·보존, 동시 요청, 실제 handler와 실제 SQL의 연결, `md5(prosrc)` 표 대조. `--mutation=<이름>` 44가지(마이그레이션 29, 1개 계정 설치 SQL 6, 소유자 계정 SQL 9)는 각각 검사를 실패시킨다. 소유자 계정 SQL 안에 금지 문장(delete·grant 등)이 없는지 보는 정적 검사는 주석과 따옴표 문자열만 걷어 내고 찾는 보조 검사라 우회할 수 있다. 주 방어는 SHA-256 고정과 검수다.
- `SQL_REPLAY_REQUIRED=1 npm run test:sql-replay` — 새 파일을 포함한 37개 마이그레이션 재생.
- `node scripts/check-news-wide-live.mjs`(수동) — 일반 검색어 "기후"·"climate" 각 1회. 두 응답 모두 fixture가 가정한 모양이었다.

미검증:

- **운영 설치, 실제 로그인 왕복, Supabase Edge(Deno)에서의 실행.** 이 환경에 Deno가 없어 `deno check`도 돌리지 못했다. Deno가 붙이는 기본 헤더도 확인하지 못했다.
- Supabase Edge의 IP에서 Google이 같은 응답을 주는지. 데이터센터 IP는 동의 화면·429로 답할 수 있다. 그때 함수는 `blocked`/`rate_limited`로 실패 처리하고 같은 요청의 남은 호출을 멈춘다.
- 운영 Auth가 일반 계정에 `role: "authenticated"`, `is_anonymous: false`를 항상 돌려주는지. 둘 중 하나라도 빠지면 함수는 401로 닫힌다(열리는 쪽으로 틀리지는 않는다).
- 운영 `auth.users`의 실제 열(`is_anonymous`). 설치 SQL과 `owner()`가 이 열을 읽는다. 적용 전 읽기 쿼리에서 존재를 확인한다.
- GDELT(연결 실패로 형식 확인 못 함).
- `tests/integrated-release-installation.cjs`는 Docker가 없어 마이그레이션 목록 대조까지만 통과를 확인했다.
- 화면, 실제 기기, 소유자가 읽어 본 유용성.

## 운영 적용 안내 (총괄)

작업자는 아래 어느 것도 실행하지 않았다. **운영은 1·2단계를 이미 지났다(2026-11-11 마이그레이션 적용). 3번(해시·정규식 생존·권한과 빈 표)을 다시 확인한 뒤 4번부터 한다.** 1번의 `schema_absent=true` 같은 기대값은 적용 전 기록이다. 새 비밀값은 **없다**(기존 `SUPABASE_URL`, `SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS`만 읽는다). 순서는 **마이그레이션 → 해시 대조 → 허용 계정 설치 SQL → 함수 배포**다. 허용 계정을 넣기 전에는 함수를 배포해도 모든 계정이 403이다.

적용할 파일은 저장소의 파일을 **바이트 그대로** 쓴다. 마이그레이션은 전부 ASCII이고 보이지 않는 문자는 `\u` 표기로만 들어 있다(글자로 옮기다 빠지는 일을 막기 위해서다). 옮긴 뒤에는 아래 해시로 확인한다.

**1. 적용 전 읽기** (개수와 존재 여부만):

```sql
select to_regnamespace('haedo_news_wide_private') is null as schema_absent,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'life_news_wide_%') as own_public_functions,
  to_regprocedure('auth.jwt()') is not null as has_auth_jwt,
  to_regclass('auth.sessions') is not null as has_auth_sessions,
  exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'is_anonymous') as has_is_anonymous,
  (select count(*) from auth.users u where not coalesce(u.is_anonymous, false)) as non_anonymous_accounts,
  (select count(*) from pg_namespace where left(nspname, 6) = 'haedo_') as haedo_schemas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') as public_functions,
  (select count(*) from pg_policies) as policies;
```

기대: `schema_absent=true`, `own_public_functions=0`, 가운데 셋은 `true`. `non_anonymous_accounts`는 3이어야 한다(2026-11-12 소유자 결정). 3이 아니면 4번에서 멈추므로 먼저 소유자에게 다시 묻는다. 뒤 세 숫자를 적어 둔다.

**2. 마이그레이션 적용:** `supabase/migrations/20261111130000_news_wide_feed.sql` 그대로. 한 트랜잭션이고 새 스키마·표 세 개·함수 아홉 개만 만든다. 기존 표·함수·정책·행을 읽거나 고치지 않으므로 기존 행 수가 바뀔 수 없다(격리 검사에서 기존 카탈로그 불변, 두 번 적용해도 같은 결과).

**3. 적용 후 확인 — 해시 대조는 필수다.** 보이지 않는 문자나 이스케이프가 옮기는 도중 바뀌면 마이그레이션은 오류 없이 적용되고, 그 뒤 모든 호출이 실패한다. 아래 세 가지를 모두 본다.

(가) 함수 본문 해시:

```sql
select p.proname, md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='haedo_news_wide_private' order by 1;
```

기대값(저장소의 최종 마이그레이션을 격리 PostgreSQL에 적용해 잰 값. `node tests/run-news-wide-postgres.cjs --hashes`로 다시 잴 수 있고, 같은 검사가 이 표와 대조한다):

<!-- news-wide-function-hashes:start -->
| 함수 | md5(prosrc) |
| --- | --- |
| `claim` | `e42b29a2e6d080487604deb709a3d284` |
| `clear` | `f312782a6d5cb30082053d5c6ee4171d` |
| `finish` | `4e2e2498651a0a92d1193ad6fa89f182` |
| `items_valid` | `1ad4bc2cb3df561cf18e2a6a4e2f2955` |
| `owner` | `90c93fee513b5ad6e7084b208bed74de` |
| `topic_valid` | `bc1ca5640a7befb592317ce2b024ee8f` |
<!-- news-wide-function-hashes:end -->

하나라도 다르면 **허용 계정 설치와 함수 배포를 하지 않는다.** 저장소 파일을 바이트 그대로 다시 적용한다(마이그레이션은 `create or replace`라 다시 적용하면 함수 본문이 바뀐다). 그래도 다르면 멈추고 보고한다.

(나) 정규식이 살아 있는지(행을 만들지 않는 함수만 부른다):

```sql
select haedo_news_wide_private.topic_valid('test') as plain_word,
  haedo_news_wide_private.topic_valid('a:b') as colon,
  haedo_news_wide_private.topic_valid('a OR b') as operator_between_words,
  haedo_news_wide_private.items_valid('google-news-rss', '[]'::jsonb) as empty_items;
-- 기대: true, false, false, true. "invalid regular expression"이나 "invalid Unicode escape" 오류가 나면 옮기는 중에 글자가 바뀐 것이다.
```

(다) 권한과 빈 표:

```sql
select c.relname, c.relrowsecurity as rls, (select count(*) from pg_policy where polrelid = c.oid) as policies,
  has_table_privilege('anon', c.oid, 'select') as anon_select,
  has_table_privilege('authenticated', c.oid, 'select') as user_select,
  has_table_privilege('service_role', c.oid, 'select') as server_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'haedo_news_wide_private' and c.relkind = 'r' order by 1;
-- 기대: allowed_accounts, feeds, limits 세 행. rls=true, policies=0, 세 select 모두 false.

select p.oid::regprocedure::text as signature, p.prosecdef as definer, p.proconfig as config,
  has_function_privilege('anon', p.oid, 'execute') as anon,
  has_function_privilege('authenticated', p.oid, 'execute') as signed_in,
  has_function_privilege('service_role', p.oid, 'execute') as server
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'haedo_news_wide_private' or (n.nspname = 'public' and p.proname like 'life_news_wide_%') order by 1;
-- 기대: 9행. anon은 모두 false. config는 모두 {search_path=pg_catalog}.
--   claim·clear(비공개와 public 각각): signed_in=true, server=false
--   finish(비공개와 public): signed_in=false, server=true
--   owner·topic_valid·items_valid: 둘 다 false

select (select count(*) from haedo_news_wide_private.feeds) as feeds,
  (select count(*) from haedo_news_wide_private.limits) as limits,
  (select count(*) from haedo_news_wide_private.allowed_accounts) as allowed_accounts;
-- 기대: 0, 0, 0
```

1번의 뒤 세 숫자는 `haedo_schemas` +1, `public_functions` +3, `policies` 그대로여야 한다.

**4. 허용 계정 설치 (2026-11-12 소유자 결정: 계정 3개):** `supabase/operations/20261112-news-wide-allow-owner-accounts.sql`을 그대로 실행한다. 파일은 전부 ASCII이고 백슬래시가 하나도 없어(`\u`도 없다) 운영 SQL 도구가 이스케이프를 바꿔 보낼 거리가 없다(`npm test`와 격리 검사가 단언한다). 실행 전에 아래 표의 SHA-256과 대조한다.

- 익명이 아닌 계정이 정확히 3개이고 모두 2026-10-04 전에 만들어졌으면 셋 모두 넣고, 맨 아래 결과 표 6행의 `ok`가 모두 `true`다(`n`은 개수: 3, 3, 0, 0, 0, 비어 있음).
- 3개가 아니면 `Expected exactly 3 non-anonymous accounts (owner decision 2026-11-12), found N`으로 멈추고 아무것도 넣지 않는다. 컷오프 뒤 계정이 있으면 `Found N non-anonymous account(s) created on or after the cutoff of the owner decision 2026-11-12 (or with no creation time)`로 멈춘다. **두 경우 모두 총괄이 소유자에게 다시 묻는다.** 파일을 고쳐 계정을 고르지 않는다.
- 목록에 비익명 계정이 아닌 계정이 이미 있으면 `The allow list would hold N account(s) and must hold exactly the 3 non-anonymous accounts`로 멈춘다. 세 계정 중 일부가 이미 있으면 그 행은 그대로 두고 나머지만 넣는다(다시 실행해도 된다).
- 실행 전후로 `public`·`haedo_*`의 모든 표(`allowed_accounts` 제외)와 `auth.users`의 행 수를 비교하고 달라지면 되돌린다.
- 출력에는 계정 ID·이메일이 없다. 삭제·권한 완화가 없다.
- 이전 파일 `supabase/operations/20261111-news-wide-allow-first-account.sql`은 비익명 계정이 1개일 때의 기록이다. 운영에서는 `found 3`으로 멈추므로 실행하지 않는다.

**5. Edge 함수 배포:** 이름 `haedo-news-wide`, 진입점 `supabase/functions/haedo-news-wide/index.ts`, **`verify_jwt=false`**([2026-11-04 결정](../life-tools-design/weekly-tech-review.md): 함수가 JWT 모양이 아닌 Bearer를 본문을 읽기 전에 거절하고 `/auth/v1/user`로 세션을 확인한다). 함께 올릴 실행 파일 9개와, 2·4번의 SQL 3개(4번은 2026-11-12 파일을 쓰고, 이전 1개 계정용 파일도 기록으로 둔다)의 SHA-256(배포 뒤 플랫폼이 돌려준 소스와 대조한다):

<!-- news-wide-file-hashes:start -->
| 파일 | SHA-256 |
| --- | --- |
| `supabase/functions/haedo-news-wide/index.ts` | `55db3462860592c49780e4a5e958b671eaefd885adb628cb285bf7b455a91814` |
| `supabase/functions/haedo-news-wide/handler.mjs` | `1585a99c63c22b16c693b23e58d370643763968f1c902cfa31a66d2599583608` |
| `supabase/functions/haedo-news-wide/topics.mjs` | `cf290574d7d60a33286577609ff9fd2752276a238d477c1cc8e580da979600a4` |
| `supabase/functions/haedo-news-wide/upstream.mjs` | `103a0a4db3230a2a69bc978bd5f2f39930f803e38d546c11aa10ec95f9c60d7c` |
| `supabase/functions/haedo-news-wide/items.mjs` | `438e125e69074af3eeea9d75fc64780d1d84451a677214118db4eecfe60c2955` |
| `supabase/functions/haedo-news-wide/xml.mjs` | `1f6424e765f4ae8fbfd27acdc59b82908da4ecc95d9ba92b5bb6a713596c1477` |
| `supabase/functions/haedo-news-wide/suppliers/google-news.mjs` | `0be7fa9825f54565eea0d74793d6586a87f627497e90a374f526d865a7d26bc3` |
| `supabase/functions/_shared/supabase-keys.mjs` | `21c146952d2b4d1b58fe54ae571facd8447c4b7cb21ddd48f20919a9859f3707` |
| `supabase/functions/haedo-rss/vendor/fast-xml-parser.mjs` | `438ed6e4997ab8a22fb76957c5a12b5956f95965d105cb0ac8cbc75bec627f55` |
| `supabase/migrations/20261111130000_news_wide_feed.sql` | `7825f9fb5ae538a3254f6d9fde7f7dffecd17d212c79fd6c77ce841886fe84ed` |
| `supabase/operations/20261111-news-wide-allow-first-account.sql` | `407be756008f2bc62e758ac9728448da397d135c99bfbd02ed37e42c8a572cfb` |
| `supabase/operations/20261112-news-wide-allow-owner-accounts.sql` | `45a9e24c8a7c30aa9e5e6d7a5eba3206efa847855ee831f90ab33b2c0d076019` |
<!-- news-wide-file-hashes:end -->

함수 폴더만 복사한 배포는 `_shared/supabase-keys.mjs`와 파서 번들을 잃는다. `haedo-rss` 함수 자체는 배포하지 않아도 된다(파서 파일만 쓴다). 파서의 라이선스는 같은 폴더의 `LICENSES.txt`다.

배포 직후 확인(운영 데이터 쓰기 없음): 토큰 없는 요청 401, 다른 `Origin` 403, 허용 출처의 `OPTIONS` 204. 허용된 계정으로 일반 주제 하나(`기후`)를 부르면 `status`가 `fresh`인지, Supabase IP에서 `blocked`·`rate_limited`가 나오는지 본다. 이 한 번은 `feeds` 1행과 `limits` 1행을 만든다(계정 전용 캐시).

**6. 되돌리기:**

- 먼저 함수를 내리거나 클라이언트 설정을 끈다. SQL 객체는 함수가 없으면 아무 일도 하지 않으므로 남겨 둬도 된다.
- 넓게 찾기만 막으려면 허용 목록을 비우면 된다(`delete from haedo_news_wide_private.allowed_accounts`). 계정 한 줄을 지우는 일이므로 소유자 승인 뒤에 한다.
- 캐시만 비우려면 해당 계정으로 `life_news_wide_clear()`를 부른다.
- 스키마까지 지우는 SQL은 캐시된 관심 주제를 삭제한다. **소유자 승인 뒤에만** 실행한다:

```sql
begin;
drop function if exists public.life_news_wide_claim(text, jsonb), public.life_news_wide_finish(uuid, text, jsonb), public.life_news_wide_clear();
drop schema if exists haedo_news_wide_private cascade;
notify pgrst, 'reload schema';
commit;
```

## 소유자가 판단할 것

1. **허용할 계정.** 2026-11-12에 결정했다: 운영의 비익명 계정 3개가 모두 소유자 계정이고 셋 모두 허용한다. 계정 수가 달라지면 설치 SQL이 멈추고 다시 묻는다.
2. **피드 약관.** "개인 피드 리더 안에서 개인·비상업"이라는 문구에 서버 캐시(30분)와 재전달이 들어맞는지는 해석의 문제다. 소유자 한 사람의 계정들의 개인 리더라는 전제에서만 근거가 있다.
3. **Google 주소 경유.** 원문 주소를 얻을 수 없어 글을 누르면 Google을 거친다. `담기`에도 Google 주소가 보관된다.
4. **끄면 지우기.** `life_news_wide_clear`는 처음 지시서에 없던 추가다. 빼면 끈 뒤에도 주제가 서버에 남는다.
