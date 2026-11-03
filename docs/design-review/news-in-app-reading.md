# 뉴스 앱 안 원문 보기 — 출처별 허용 확인

2026-11-03, 부드러운 판 묶음 C. 뉴스 읽기 칸은 허용한 출처의 원문 페이지만 `iframe`으로 띄운다. 나머지 출처는 지금처럼 새 탭으로 연다.

- **허용 목록:** 공급 형식(`discovery-feed.json`)에는 필드를 더하지 않는다. 대신 클라이언트 상수 `FRAME_ALLOWED_SOURCES`(`assets/life/discovery-ui.js`)에 출처 ID를 둔다.
- **조건:** 허용 목록에 있는 출처 ID이고, 기사 주소가 `https`이며, 그 호스트가 `Discovery.ALLOWED_SOURCES`의 등록 호스트일 때만 띄운다.
- **iframe 속성:** `referrerpolicy="no-referrer"`, `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"`.
  - 최상위 이동·양식 제출·대화상자는 허용하지 않는다.
  - 출판사 스크립트는 그 출판사 출처 안에서만 돈다.
- **실패 감지:** 다른 출처 iframe의 로드 실패는 믿을 만하게 감지할 수 없다. 그래서 허용 목록만 근거로 삼고, 읽기 칸에는 언제나 `새 탭에서 열기`를 둔다.
- **본문 보관:** 원문 본문은 복사·저장하지 않는다. 앱 안 보기도 새 탭처럼 사용자의 브라우저가 출판사 서버에서 직접 받는다. 보관하는 것은 지금처럼 제목·링크 메타데이터뿐이다.

## 확인 결과 (2026-11-03)

이 세션의 프록시를 거쳐 `curl -sS -I -L`로 확인했다. HEAD가 404·403을 돌려준 곳은 같은 주소를 `GET`(`-D - -o /dev/null`)으로 다시 확인했다. 응답 본문의 `<meta http-equiv="Content-Security-Policy">`와 `top.location` 프레임 탈출 코드도 함께 찾았다.

| 출처 ID | 확인한 주소(예) | `X-Frame-Options` | CSP `frame-ancestors` | 결과 |
| --- | --- | --- | --- | --- |
| `readersnews-books` | `www.readersnews.com/news/articleView.html?idxno=200771`·`200770`·`200695` | 없음 | 없음(헤더·meta 모두) | **허용** |
| `frontiers-psychology` | `www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.2022680/full`(같은 호스트 `/abstract`로 302)·`…2018014/full` | 없음 | 없음 | **허용** (현재 공급에는 이 출처 기사가 없다) |
| `seoul-culture` | `news.seoul.go.kr/culture/archives/535011` | `SAMEORIGIN` | `'self'` | 새 탭 |
| `seoul-environment` | `news.seoul.go.kr/env/archives/571201` | `SAMEORIGIN` | `'self'` | 새 탭 |
| `arxiv-cs-cl` | `arxiv.org/abs/2610.23847` | `SAMEORIGIN` | `'none'` | 새 탭 |
| `mit-linguistics` | `news.mit.edu/2026/algorithmic-monoculture-effects-depend-on-details-0929` | `SAMEORIGIN` | 없음 | 새 탭 |
| `woowahan-tech` | `techblog.woowahan.com/27821/`(403 응답) | `SAMEORIGIN` | 없음 | 새 탭 |
| `naver-d2` | `d2.naver.com/home`(공급 수집 오류 상태) | `DENY` | 없음 | 새 탭 |
| `llt-journal` | `www.lltjournal.org/` | `DENY` | 없음 | 새 탭 |

## 다시 확인할 조건

- 출판사가 헤더를 바꿀 수 있다. 허용한 출처가 프레임 금지로 바뀌면 읽기 칸이 빈 페이지를 보일 수 있다. 이때도 `새 탭에서 열기`는 남는다.
- 새 출처를 공급에 더할 때는 위 표에 한 줄을 더하고, 확인한 경우에만 `FRAME_ALLOWED_SOURCES`에 넣는다.
- 확인은 헤더 기준이다. 쿠키 동의 창이나 로그인 요구처럼 페이지 안에서 생기는 읽기 방해는 실제 기기에서 소유자가 확인할 항목이다.
