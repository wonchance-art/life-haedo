# haedo-news-wide — 관심 주제로 넓게 찾기 (서버)

2026-11-11 소유자 승인에 따른 계정 전용 Edge 함수다. 승인 범위, 기기 밖으로 나가는 것, 저장·보존, 한도, 요청·응답 형식, 클라이언트 계약, 운영 적용 순서는 [넓게 찾기 설계·운영 문서](../../../docs/design-review/news-wide-feed.md) 한 곳에 적는다. **운영에는 아직 적용하지 않았다.** 화면 연결도 이 묶음에 없다.

## 구성

| 파일 | 하는 일 |
| --- | --- |
| `index.ts` | Deno 진입점. `haedo-rss`가 이미 보관한 XML 파서 묶음을 넘긴다(새 의존성 없음) |
| `handler.mjs` | Origin·로그인 확인, 입력 검증, 캐시 RPC, 동시 호출 제한, 응답 조립, 고정 필드 로그 |
| `topics.mjs` | 요청 형식과 주제 허용 규칙(글자·숫자·몇 가지 기호만, 검색 연산자 거절) |
| `upstream.mjs` | 바깥으로 나가는 유일한 요청. 호스트·경로 고정, 리다이렉트 거절, 크기·시간 상한 |
| `suppliers/google-news.mjs` | 공급원 어댑터(Google 뉴스 RSS 검색 피드)와 어댑터 계약 |
| `xml.mjs` | DOCTYPE·엔티티 선언·처리 명령을 거절하는 XML 읽기 |
| `items.mjs` | 링크만 남기는 항목 정규화, 중복 제거, 상한, 캐시 재검증 |

SQL은 `supabase/migrations/20261111130000_news_wide_feed.sql`(`haedo_news_wide_private`)이다. **허용 계정 목록(`allowed_accounts`)에 있는 계정만** 쓸 수 있고, 마이그레이션은 그 표를 비운 채 만든다. 목록에 계정을 넣는 길은 `supabase/operations/20261111-news-wide-allow-first-account.sql` 하나뿐이다. 목록에 없는 계정에는 403 `not_enabled_for_account`로 답하고 공급원을 부르지 않는다.

배포 파일과 SQL에는 보이지 않는 문자를 글자 그대로 넣지 않는다(`\u` 표기만). `npm test`가 이를 검사하고, 운영 문서의 SHA-256·`md5(prosrc)` 표와 실제 파일을 대조한다. 파일을 고치면 그 표도 함께 고친다.

## 검사

```sh
node --test tests/news-wide-edge.test.cjs tests/news-wide-handler.test.cjs
npm ci --prefix tests/sql-ci --ignore-scripts --no-audit --no-fund
node tests/run-news-wide-postgres.cjs
```

기본 검사는 외부에 접속하지 않는다. 실제 공급원 형식 확인은 `node scripts/check-news-wide-live.mjs`(수동, 일반 검색어만)로 따로 한다.
