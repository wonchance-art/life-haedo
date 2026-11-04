# 뉴스 앱 안 원문 보기 — 출처별 허용 확인

2026-11-03, 부드러운 판 묶음 C. 뉴스 읽기 칸은 허용한 출처의 원문 페이지만 `iframe`으로 띄운다. 나머지 출처는 지금처럼 새 탭으로 연다.

- **허용 목록:** 공급 형식(`discovery-feed.json`)에는 필드를 더하지 않는다. 대신 클라이언트 상수 `FRAME_ALLOWED_SOURCES`(`assets/life/discovery-ui.js`)에 출처 ID를 둔다.
- **조건:** 허용 목록에 있는 출처 ID이고, 기사 주소가 `https`이며, 그 호스트가 `Discovery.ALLOWED_SOURCES`의 등록 호스트일 때만 띄운다.
- **iframe 속성:** `referrerpolicy="no-referrer"`, `sandbox="allow-scripts allow-popups"`(2026-11-03 재검수 뒤).
  - `allow-same-origin`이 없어서 출판사 페이지는 불투명 출처에서 돈다. 그 페이지는 자기 쿠키·저장소를 쓸 수 없고, 해도 앱의 출처에도 접근할 수 없다.
  - `allow-popups`만 두고 `allow-popups-to-escape-sandbox`는 뺐다. 출판사 링크로 연 새 창도 같은 샌드박스를 이어받는다.
  - 최상위 이동·양식 제출·대화상자는 허용하지 않는다.
  - **제3자 스크립트:** 출판사 페이지가 불러오는 광고·분석·소셜 위젯 스크립트도 그 틀 안에서 돈다. 해도는 그 스크립트를 고르거나 막지 않는다.
  - **CSP `frame-src`의 역할:** `index.html`·`life.html`의 `<meta http-equiv="Content-Security-Policy" content="frame-src …">`는 해도 문서에 있는 틀의 목적지를 제한한다. 이 meta는 HTML에 쓰지 않고 `assets/life/shell.js`가 화면을 열기 전에 `head`에 넣는다(아래 「HTML에 쓰지 않는 이유」). 허용 목록 밖 출처를 띄우는 실수를 막고, 허용된 출판사 틀이 스스로 허용 밖 호스트로 이동하려 할 때도 막는다(재검수 실측: 요청 0, 틀은 오류 화면). 그래서 YouTube나 출판사 틀이 다른 호스트로 리다이렉트하면 빈 틀이 된다(2026-11-03 실제 두 출판사는 iPhone UA에서도 리다이렉트 없음). `data:` 틀도 막히며, 저장소에는 `data:` 틀 사용처가 없다. 출판사 페이지 안의 하위 틀(예: Facebook 위젯)은 그 출판사 문서의 정책을 따르고, 해도의 `frame-src`와 무관하다.
  - **출판사에 보이는 것:** `referrerpolicy="no-referrer"`로 Referer는 보내지 않는다. 그래도 Chromium·Safari에서는 틀 안의 `location.ancestorOrigins`로 해도 앱의 출처(예: `https://<배포 주소>`)가 출판사 스크립트에 보인다. 읽는 글의 주소는 새 탭으로 열 때와 같이 출판사에 전달된다. 개인 자료·검색어·관심 주제는 틀에 넘기지 않는다.
- **`allow-same-origin` 실험 (2026-11-03, 이 세션의 프록시를 거친 실제 주소, Chromium 1243):** 같은 페이지를 두 sandbox로 띄워 비교했다.

  | 출처 | 주소 | `allow-same-origin` 있음 | 없음(채택) |
  | --- | --- | --- | --- |
  | readersnews-books | `articleView.html?idxno=200770` | 제목·본문·사진 표시(본문 글자 1587) | 제목·본문·사진 표시(본문 글자 1488). 오류는 두 경우 모두 Facebook 위젯 틀 거부와 400 응답 하나 |
  | frontiers-psychology | `fpsyg.2026.2022680/full` | 페이지가 localStorage 접근 오류로 "Unhandled error" 화면 | 서버가 그린 제목·저자·초록 표시(본문 글자 4604). 모듈 스크립트는 CORS로 막혀 메뉴 같은 동작은 없음 |

  - 두 출처 모두 `allow-same-origin` 없이 읽을 수 있어서 뺐다.
  - 실험의 부모 문서는 `about:blank`였다. 실제 앱 안 화면과 실제 기기 표시는 소유자 확인 항목이다.
- **실패 감지:** 다른 출처 iframe의 로드 실패는 믿을 만하게 감지할 수 없다. 그래서 허용 목록만 근거로 삼고, 읽기 칸에는 언제나 `새 탭에서 열기`를 둔다.
- **본문 보관:** 원문 본문은 복사·저장하지 않는다. 앱 안 보기도 새 탭처럼 사용자의 브라우저가 출판사 서버에서 직접 받는다. 보관하는 것은 지금처럼 제목·링크 메타데이터뿐이다.

## 앱 문서의 틀 사용처와 `frame-src` (2026-11-03 전수 조사)

`index.html`·`life.html`의 meta CSP는 `frame-src 'self' blob: https://www.youtube-nocookie.com https://www.readersnews.com https://www.frontiersin.org` 하나만 둔다. 다른 지시어가 없어서 스크립트·스타일·연결·이미지·worker는 바뀌지 않는다(`worker-src`는 `child-src`→`script-src`→`default-src`로 이어지는데 셋 다 없다). 저장소의 `iframe`·`frame` 생성처를 모두 찾아 대응시켰다(`vendor/`·`tests/`·문서 증거 제외).

| 사용처 | 틀 주소 | `frame-src` |
| --- | --- | --- |
| `assets/life/discovery-ui.js` 뉴스 읽기 칸 | `https://www.readersnews.com/…`, `https://www.frontiersin.org/…` | 두 호스트 |
| `assets/life/page-media.js` 내 페이지 YouTube 재생 | `https://www.youtube-nocookie.com/embed/…` | 그 호스트 |
| `assets/life/book-print.js` 책 인쇄 | `blob:` 문서 | `blob:` |
| `assets/life/workbench-ui.js` 책자 미리보기 | `srcdoc`(about:srcdoc) | 출처 검사 대상 아님, 실측으로 로드 확인 |
| 로그인(Google·Supabase) | 틀을 쓰지 않음. `signInWithOAuth`는 전체 페이지 이동이고 `login.html`은 이 meta가 없다 | – |
| `blog.html`·`share.html`·`series.html`·`cover.html`·`taste.html` | 각자 기존 CSP를 쓰고 이번에 바꾸지 않았다 | – |

로컬 Chromium 실측(합성 응답): srcdoc·blob·YouTube·두 출판사 틀은 열렸고, 허용 밖 `news.seoul.go.kr`은 `frame-src` 위반으로 막혔다.

### HTML에 쓰지 않는 이유 (2026-11-03 첫 화면 지연)

- **원인:** `haedo-v180`에서 `index.html`·`life.html`의 `head`에 CSP meta를 쓰자 Chromium 1243의 미리 읽기(preload scanner)가 그 뒤의 스크립트를 미리 받지 않았다. 스크립트 약 180개를 파서가 하나씩 만나서 받았다.
- **실측(로그인 전 `index.html`, Playwright 경로 지연):**
  - 정적 응답 지연 0ms: DOMContentLoaded 0.5초 → 1.0~1.2초. 마지막 스크립트 요청 시작이 39ms → 1040ms.
  - 요청당 40ms: 0.59초 → 7.6초.
  - meta만 빼거나 같은 정책을 HTTP 헤더로 보내면 v179와 같아진다.
- **지금 방식:** `shell.js`가 처음 실행될 때 같은 정책의 meta를 `head`에 넣는다. 틀은 모두 그 뒤 화면 코드가 만든다. HTML 명세상 `head`에 넣은 meta도 적용된다. 로컬 Chromium에서 넣은 meta도 허용 밖 틀을 `frame-src` 위반으로 막았다.
- **미검증:** Safari(WebKit)의 미리 읽기 동작과, 넣은 meta가 막는지는 실제 기기에서 확인하지 않았다.
- **바꿀 조건:** 배포처가 응답 헤더를 지원하면 정책을 헤더로 옮긴다.

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
