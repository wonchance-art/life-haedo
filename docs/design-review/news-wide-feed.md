# 뉴스 넓게 찾기 — 서버 (2026-11-11)

**상태:** Edge 함수 `haedo-news-wide`, 마이그레이션 `20261111130000_news_wide_feed.sql`, 검사와 이 문서까지다. **운영 DB·운영 Edge에는 적용하지 않았고 화면 연결도 없다.** 로컬 검사 결과와 미검증 항목은 아래 「검증」 절에 나눠 적는다. 운영 적용은 마지막 절의 순서대로 총괄이 한다.

배경: 뉴스 탭이 정해 둔 출처에서만 나와 좁다는 소유자 요청(2026-11-11). 1단계(화면 카드화·5건 상한 해제·고정 출처 확대)는 `news/discover-feed` 브랜치의 다른 작업이다. 이 문서는 2단계의 서버 쪽, 곧 **뉴스 설정에 직접 적은 관심 주제로 외부 뉴스 집계 서비스를 조회해 그 계정에만 돌려주는 경로**다.

## 소유자 승인과 범위 (2026-11-11)

총괄의 질문: "관심 주제를 외부 뉴스 집계 서비스로 보내도 될까요?" 함께 제시한 범위:

- 뉴스 설정에 **직접 적은 관심 주제만**, **설정에서 켰을 때만** 보낸다.
- 좋아요에서 뽑은 단어는 보내지 않는다.
- 받는 서비스 이름을 설정에 적는다.
- 결과는 계정 전용 비공개 저장소에 둔다. 지금의 뉴스 목록은 공개 정적 파일이라 거기에 넣으면 관심사가 공개된다.

소유자 답: **"보내 ㄱ"**.

이 범위를 넘는 전송(다른 신호, 다른 수신처, 사용자를 식별하는 값)은 승인되지 않았다. 수신처를 바꾸거나 더하려면 다시 승인을 받는다.

**공개 수집기와 다른 경로다.** [새 글 자동 갱신](discovery-automation.md)·[출처와 갱신](discovery-sources.md)·[외부 글 발견](external-discovery.md)의 "임의 주제 검색을 받지 않는다", "개인 관심·검색어를 보내지 않는다"는 약속은 공개 정적 목록(`assets/life/discovery-feed.json`)과 그 수집기에 그대로 유효하다. 넓게 찾기는 그 수집기를 쓰지 않고, 로그인한 계정의 요청으로만 움직이는 별도 함수다. 공개 파일·서비스워커 캐시·Pages 산출물에는 주제도 결과도 들어가지 않는다.

## 공급원

**Google 뉴스 RSS 검색 피드** 하나로 시작한다(총괄 결정, 확인일 2026-11-11).

- 주소: `https://news.google.com/rss/search?q=<주제>&hl=ko&gl=KR&ceid=KR:ko`, 영어는 `hl=en-US&gl=US&ceid=US:en`.
- 실호출로 확인한 것: 질의 한 번에 최대 100건. 항목은 `title`("제목 - 매체"), `link`(Google 경유 주소), `pubDate`, `<source url="매체 홈">매체 이름</source>`. 이미지는 없다. `description`은 HTML이다.
- 피드 저작권 문구: 개인 피드 리더 안에서 개인·비상업 용도로 Google 뉴스 결과를 보여 주는 목적에만 제공한다. 그 밖의 사용은 금지한다.
- 원문 주소는 단순 리다이렉트로 얻을 수 없다. **풀려고 하지 않고** Google 주소를 그대로 쓴다.
- 비용 0원. 키·계정 없음.

쓰지 않은 것:

| 후보 | 이유 |
| --- | --- |
| GDELT DOC 2.0 | 이 환경에서 연결 뒤 12초 만에 끊기고 다른 경로에서는 HTTP 503이 두 번 왔다. **검증하지 못했다.** 어댑터 자리만 있고 구현은 없다. |
| 네이버 뉴스 검색 API | 약관이 다른 내용과 섞기·순위 수정·저장을 금지한다. 캐시와 병합이 불가능하다. |
| 유료 뉴스 API | 비용 0원 조건에 맞지 않는다. |

공급원은 `suppliers/google-news.mjs` 한 파일이다. 어댑터가 지킬 계약(고정 호스트·경로, 주제와 언어만 받는 주소 함수, 본문 없는 원시 항목)은 그 파일 머리말에 있고 `upstream.mjs`가 강제한다. 다른 공급원은 같은 모양의 파일 하나와 SQL의 공급원 이름 검사 한 줄을 더하는 작업이며, 그 전에 수신처 변경 승인이 필요하다. 오픈소스·대안 비교는 [오픈소스 검토](../life-tools-design/open-source-review.md)의 2026-11-11 절에 있다.

## 기기 밖으로 나가는 것

| 무엇 | 어디로 | 언제 |
| --- | --- | --- |
| 관심 주제 문자열, 언어판(`ko`/`en`) | 해도의 Edge 함수(Supabase) | 넓게 찾기를 켠 화면이 요청할 때 |
| 같은 주제 문자열과 언어판 | `news.google.com` (Google 뉴스) | 그 주제의 캐시가 30분을 넘었고 한도가 남았을 때만 |
| 글의 Google 경유 주소 | Google, 이어서 해당 매체 | 사용자가 글을 눌러 새 탭으로 열 때 |

Google로 가는 요청의 정확한 내용(주제·언어 한 쌍에 한 번):

```
GET https://news.google.com/rss/search?q=<주제>&hl=<ko|en-US>&gl=<KR|US>&ceid=<KR:ko|US:en>
Accept: application/xml, text/xml, application/rss+xml
Accept-Encoding: identity
User-Agent: Mozilla/5.0 (compatible; FeedReader/1.0)
```

- 코드가 싣는 것은 위 세 헤더와 네 질의 값이 전부다. 본문·쿠키·`Authorization`·`Referer`·`Origin`은 없다.
- **싣지 않는 것:** 계정 ID, 이메일, 세션 토큰, Supabase 키, 프로젝트 주소·이름, 좋아요·담기·읽은 글. 공급원과 통신하는 모듈(`upstream.mjs`)은 이 값들을 인자로 받지 않는다.
- 요청은 Supabase Edge의 IP에서 나간다. 사용자의 기기 IP는 Google에 닿지 않는다.
- Deno 런타임이 스스로 붙이는 헤더(`Host` 등)는 이 환경에 Deno가 없어 확인하지 못했다(미검증).
- Google이 알 수 있는 것: 같은 서버 IP에서 같은 시각에 온 주제 묶음. 계정과는 연결되지 않지만 한 사람의 관심 묶음으로 보일 수 있다.
- **글을 누르면** 브라우저가 Google 주소(`news.google.com/rss/articles/…`)를 먼저 거친다. 이때는 사용자의 브라우저가 직접 접속하므로 IP와, Google에 로그인해 있다면 그 쿠키가 Google에 간다. 목록을 보는 것만으로는 Google에 접속하지 않는다.
- 좋아요에서 뽑은 단어를 보내지 않는 것은 **클라이언트가 지킬 계약**이다. 서버는 주제가 어디서 왔는지 구분할 수 없다.

## 저장되는 것과 보존 기간

`haedo_news_wide_private`(비공개 스키마, RLS, 직접 표 접근 없음):

| 표 | 내용 | 개인 데이터 |
| --- | --- | --- |
| `feeds` | 계정, 공급원, 언어, **주제 문자열**, 항목 목록(제목·Google 주소·발행 시각·매체 이름·매체 주소), 받은 시각, 재시도 시각, 진행 표시 | 예. 주제는 관심사다. |
| `limits` | 계정, 이번 시간·오늘의 호출 수와 시작 시각 | 개수뿐 |

- 본문·요약·이미지는 받지도 저장하지도 않는다. 항목은 링크 메타데이터뿐이며 DB가 모양을 다시 검사한다(Google 주소가 아닌 링크, 본문 필드가 있는 항목은 저장을 거절한다).
- 다른 계정과 익명은 읽을 수 없다. 읽기는 `auth.uid()`에 묶인 함수로만 하고, 쓰기는 Edge 함수가 서버 키로만 한다. 사용자 토큰으로는 캐시에 쓸 수 없다.
- **보존:** 캐시는 30분 뒤 새로 받는다. 같은 계정이 7일 동안 찾지 않은 주제는 그 계정의 다음 조회 때 지운다. 계정당 주제 64개를 넘으면 가장 오래 안 쓴 것을 지운다. 계정을 지우면 함께 지워진다.
- **설정을 끄면** 클라이언트가 `life_news_wide_clear()`를 불러 그 계정의 캐시를 바로 지운다. 이 호출이 없으면 다음 조회가 없으므로 주제가 서버에 남는다. 호출 수 기록은 지우지 않는다(지워서 한도를 다시 얻지 못하게).
- 다른 표의 데이터는 읽지도 고치지도 않는다.
- **로그:** 시각, 상태, 주제 개수, 언어 개수, 공급원 호출 수, 상태별 개수, 항목 수, 걸린 시간뿐이다. 주제 문자열, 글 제목, 주소, 계정 ID, 공급원 응답 본문은 남기지 않는다.

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

시간·하루 한도는 고정 구간이다. 구간이 바뀌는 순간에는 짧은 시간에 두 구간 몫(최대 120회)이 나갈 수 있다. 값을 바꾸려면 새 마이그레이션과 이 표를 함께 고친다.

## 요청과 응답

`POST {SUPABASE_URL}/functions/v1/haedo-news-wide`

- 헤더: `Authorization: Bearer <사용자 세션 토큰>`, `apikey: <공개 키>`, `Content-Type: application/json`.
- 본문(이 두 필드만. 다른 필드가 있으면 거절):

```json
{ "topics": ["기후", "climate change"], "languages": ["ko", "en"] }
```

**주제 규칙.** 글자·숫자·결합 부호, 한 칸 띄어쓰기, 그리고 `. & + # ' ’ · / -`만 받는다. 정규화(NFC, 공백 한 칸, 앞뒤 공백 제거)한 뒤 대소문자만 다른 중복은 하나로 친다. 다음은 **인용하지 않고 거절한다**(인용하면 주제가 조용히 정확 일치 검색으로 바뀐다):

- 모든 따옴표와 괄호, 쌍점(`site:` `when:` `intitle:` `inurl:` `source:` `after:` `before:`가 여기서 막힌다)
- `-`나 `+`로 시작하는 낱말(제외·필수), `* | ~ < > =` 등 그 밖의 기호
- 대문자 낱말 `OR`, `AND`, `NOT`
- 제어 문자·줄바꿈·보이지 않는 문자(폭 없는 공백, 방향 전환), 이모지
- 작은따옴표는 글자 사이에서만(`O'Reilly`)

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
- `title`과 `sourceName`은 **일반 글자**다. `<`나 `&`가 그대로 들어 있을 수 있다.
- `fetchedAt`: 목록에서 가장 오래된 부분의 받은 시각. 보여 줄 것이 없으면 `null`.
- `stale`: 30분을 넘긴 캐시가 하나라도 섞였으면 `true`.

| `status` | 뜻 | `reason` |
| --- | --- | --- |
| `fresh` | 방금 공급원에서 받았다 | — |
| `cached` | 30분 안의 캐시 | — |
| `stale` | 새로 받지 못해 오래된 캐시를 돌려준다 | `network_error` `rate_limited` `blocked` `invalid_response` `not_attempted` `busy` `backoff` |
| `failed` | 새로 받지 못했고 캐시도 없다 | 위와 같음 |
| `limited` | 한도를 다 써서 캐시만 돌려준다(없으면 빈 목록) | `hourly_limit` `daily_limit` |

`blocked`는 공급원이 리다이렉트(동의 화면 등)나 401·403으로 답한 경우다. `busy`는 같은 계정의 다른 요청이 그 주제를 받는 중, `backoff`는 직전 실패 뒤 대기 중, `not_attempted`는 요청의 시간 예산이 먼저 끝난 경우다.

오류(본문 `{ "error": "<코드>" }`):

| 코드 | HTTP | 뜻 |
| --- | --- | --- |
| `invalid_request` | 400 | 본문 모양·개수·언어·알 수 없는 필드. `POST`가 아니면 405 |
| `invalid_topic` | 400 | 주제가 위 규칙에 맞지 않는다 |
| `unauthorized` | 401 | 로그인 세션이 없거나 끝났거나 익명 로그인 |
| `origin_not_allowed` | 403 | 허용하지 않은 웹 출처 |
| `setup_required` | 503 | 키·마이그레이션·파서가 준비되지 않았다 |
| `server_error` | 500 | 그 밖의 실패. 공급원·DB의 원문은 담지 않는다 |

캐시 지우기는 Edge를 거치지 않는 RPC다: `POST {SUPABASE_URL}/rest/v1/rpc/life_news_wide_clear`(사용자 세션, 본문 `{}`) → `{ "status": "cleared", "removed": 3 }`.

## 실패했을 때

- 공급원이 답하지 않거나 형식이 다르면 그 주제만 `stale`(캐시 있음)이나 `failed`(없음)가 되고 나머지 주제는 정상으로 온다. 요청 전체가 오류가 되지 않는다.
- 리다이렉트는 같은 호스트라도 따라가지 않는다. 그 주제는 실패다.
- 응답이 1 MiB를 넘거나 XML이 아니거나 DOCTYPE·엔티티 선언이 있으면 통째로 버린다. 일부만 쓰지 않는다.
- 실패한 주제는 5분(막힌 경우 30분) 동안 다시 부르지 않는다.
- 한도를 넘으면 공급원을 부르지 않고 캐시와 사유만 돌려준다.
- DB가 항목을 거절하면 그 항목은 화면에 내보내지 않고 실패로 한 번만 기록한다. 저장 결과를 확인하지 못하면 `server_error`다.

## 클라이언트가 지킬 계약 (화면 작업자에게)

1. 설정 `넓게 찾기`는 **기본 꺼짐**이다. 켜는 자리에 수신처를 **`Google 뉴스`**로 적는다(어댑터의 `label`).
2. **켰을 때만** 함수를 부른다. 꺼져 있으면 요청이 없다.
3. **뉴스 설정에 직접 적은 주제만** 보낸다. 좋아요·담기·읽은 글에서 뽑은 단어, 자동 추천 주제는 보내지 않는다.
4. 넓게 찾은 글은 **새 탭으로만** 연다(`target="_blank"`, `rel="noopener noreferrer"`). 앱 안 읽기(비공개 읽기 Edge)에는 넘기지 않는다. 주소가 `https://news.google.com/`으로 시작하는지 화면에서도 확인한다.
5. `담기`는 **링크만** 보관한다. 제목·매체 이름은 표시용으로 함께 둘 수 있으나 본문을 가져오지 않는다.
6. `title`·`sourceName`은 `textContent`로 넣는다. HTML로 넣지 않는다.
7. 결과와 주제를 공개 정적 파일, 서비스워커 캐시, 공개 페이지에 넣지 않는다.
8. 설정을 끄면 `life_news_wide_clear`를 부른다. 실패하면 다음에 다시 시도한다.
9. 계정이 바뀐 뒤 도착한 응답은 버린다.
10. 주제 입력란에서 위 규칙을 먼저 검사해 어느 주제가 안 되는지 알려 준다. 서버의 `invalid_topic`은 최종 확인이다.
11. `topics[].status`가 `stale`·`limited`·`failed`일 때 목록의 시각(`fetchedAt`)과 함께 짧게 알린다. `limited`에 재시도 버튼을 반복해서 누르게 만들지 않는다.
12. 고정 출처 목록과 한 화면에 섞어 보여 줄 수 있지만 넓게 찾은 글임을 구분할 수 있어야 한다(매체 이름, 받은 서비스).

## 검증

실행한 것(로컬, 2026-11-11):

- `node --test tests/news-wide-edge.test.cjs tests/news-wide-handler.test.cjs` — 입력 검증, 주소 조립, 어댑터 계약, 리다이렉트·크기·형식 거절, 파싱·정규화·상한, 인증 거절, 캐시 상태별 응답, 로그, 허용 출처, 키 형식.
- `node tests/run-news-wide-postgres.cjs` — 격리 PostgreSQL 16에서 기존 객체 불변, 권한, 소유자 격리, 입력 검증, TTL·대기·한도·보존, 동시 요청, 실제 handler와 실제 SQL의 연결. `--mutation=<이름>` 15가지는 각각 검사를 실패시킨다.
- `SQL_REPLAY_REQUIRED=1 npm run test:sql-replay` — 새 파일을 포함한 37개 마이그레이션 재생.
- `node scripts/check-news-wide-live.mjs`(수동) — 일반 검색어 "기후"·"climate" 각 1회. 두 응답 모두 fixture가 가정한 모양이었다.

미검증:

- **운영 설치, 실제 로그인 왕복, Supabase Edge(Deno)에서의 실행.** 이 환경에 Deno가 없어 `deno check`도 돌리지 못했다. Deno가 붙이는 기본 헤더도 확인하지 못했다.
- Supabase Edge의 IP에서 Google이 같은 응답을 주는지. 데이터센터 IP는 동의 화면·429로 답할 수 있다. 그때 함수는 `blocked`/`rate_limited`로 실패 처리한다.
- GDELT(연결 실패로 형식 확인 못 함).
- `tests/integrated-release-installation.cjs`는 Docker가 없어 마이그레이션 목록 대조까지만 통과를 확인했다.
- 화면, 실제 기기, 소유자가 읽어 본 유용성.

## 운영 적용 안내 (총괄)

작업자는 아래 어느 것도 실행하지 않았다. 새 비밀값은 **없다**(기존 `SUPABASE_URL`, `SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS`만 읽는다).

**1. 적용 전 읽기** (개수와 존재 여부만):

```sql
select to_regnamespace('haedo_news_wide_private') is null as schema_absent,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'life_news_wide_%') as own_public_functions,
  to_regprocedure('auth.jwt()') is not null as has_auth_jwt,
  to_regclass('auth.sessions') is not null as has_auth_sessions,
  exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'is_anonymous') as has_is_anonymous,
  (select count(*) from pg_namespace where nspname like 'haedo\_%') as haedo_schemas,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') as public_functions,
  (select count(*) from pg_policies) as policies;
```

기대: `schema_absent=true`, `own_public_functions=0`, 가운데 셋은 `true`. 뒤 세 숫자를 적어 둔다.

**2. 마이그레이션 적용:** `supabase/migrations/20261111130000_news_wide_feed.sql` 그대로. 한 트랜잭션이고 새 스키마·표 두 개·함수 아홉 개만 만든다. 기존 표·함수·정책·행을 읽거나 고치지 않으므로 기존 행 수가 바뀔 수 없다(격리 검사에서 기존 카탈로그 1,005항목 불변, 두 번 적용해도 같은 결과).

**3. 적용 후 확인:**

```sql
select c.relname, c.relrowsecurity as rls, (select count(*) from pg_policy where polrelid = c.oid) as policies,
  has_table_privilege('anon', c.oid, 'select') as anon_select,
  has_table_privilege('authenticated', c.oid, 'select') as user_select,
  has_table_privilege('service_role', c.oid, 'select') as server_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'haedo_news_wide_private' and c.relkind = 'r' order by 1;
-- 기대: feeds, limits 두 행. rls=true, policies=0, 세 select 모두 false.

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
  (select count(*) from haedo_news_wide_private.limits) as limits;
-- 기대: 0, 0
```

1번의 뒤 세 숫자는 `haedo_schemas` +1, `public_functions` +3, `policies` 그대로여야 한다.

**4. Edge 함수 배포:** 이름 `haedo-news-wide`, 진입점 `supabase/functions/haedo-news-wide/index.ts`, **`verify_jwt=false`**([2026-11-04 결정](../life-tools-design/weekly-tech-review.md): 함수가 JWT 모양이 아닌 Bearer를 본문을 읽기 전에 거절하고 `/auth/v1/user`로 세션을 확인한다). 함께 올릴 실행 파일 9개:

- `supabase/functions/haedo-news-wide/`의 `index.ts`, `handler.mjs`, `topics.mjs`, `upstream.mjs`, `items.mjs`, `xml.mjs`, `suppliers/google-news.mjs`
- `supabase/functions/_shared/supabase-keys.mjs`
- `supabase/functions/haedo-rss/vendor/fast-xml-parser.mjs` (SHA-256 `438ed6e4997ab8a22fb76957c5a12b5956f95965d105cb0ac8cbc75bec627f55`, 라이선스는 같은 폴더의 `LICENSES.txt`)

함수 폴더만 복사한 배포는 뒤 두 파일을 잃는다. `haedo-rss` 함수 자체는 배포하지 않아도 된다(파서 파일만 쓴다).

배포 직후 확인(운영 데이터 쓰기 없음): 토큰 없는 요청 401, 다른 `Origin` 403, 허용 출처의 `OPTIONS` 204. 로그인한 계정으로 일반 주제 하나(`기후`)를 부르면 `status`가 `fresh`인지, Supabase IP에서 `blocked`·`rate_limited`가 나오는지 본다. 이 한 번은 `feeds` 1행과 `limits` 1행을 만든다(계정 전용 캐시).

**5. 되돌리기:**

- 먼저 함수를 내리거나 클라이언트 설정을 끈다. SQL 객체는 함수가 없으면 아무 일도 하지 않으므로 남겨 둬도 된다.
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

1. **다른 계정.** 새 비밀값을 두지 않아, 로그인한(익명이 아닌) 계정이면 누구나 계정별 한도 안에서 쓸 수 있다. 소유자 한 명만 쓰게 하려면 `haedo-ai`처럼 계정 ID 비밀값으로 막는 변경이 필요하다.
2. **피드 약관.** "개인 피드 리더 안에서 개인·비상업"이라는 문구에 서버 캐시(30분)와 계정별 재전달이 들어맞는지는 해석의 문제다. 소유자 한 명의 개인 리더라는 전제에서만 근거가 있다.
3. **Google 주소 경유.** 원문 주소를 얻을 수 없어 글을 누르면 Google을 거친다. `담기`에도 Google 주소가 보관된다.
4. **끄면 지우기.** `life_news_wide_clear`는 지시서에 없던 추가다. 빼면 끈 뒤에도 주제가 서버에 남는다.
