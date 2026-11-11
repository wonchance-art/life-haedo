# 외부 글 공급·권리·수동 갱신

현재 자동화는 [주제·옵션과 자동 갱신](discovery-automation.md)을 따른다. 고정 출처·권리 계약은 유지하고, 기본 브랜치 반영 후 하루 1회 공개 수집과 15분 화면 갱신을 분리한다. 아래 수동 실행 기록과 Git에 고정한 50개 비교 카탈로그는 보존한다.


확인일: 2026-10-18 UTC / 2026-10-19 한국 시각. 현재 정적 카탈로그는 **성공한 한국어 공식 피드 4개의 50개 글**이다. 등록 피드는 5개이며 NAVER D2는 robots의 HTTPS→HTTP 이동 차단으로 실패·이전 성공 없음이다. [후속 공급·비교 검수](discovery-expansion.md)를 현재 실행 기록으로 삼는다.

## 2026-11-11 출처 확대 — 19곳 추가, 이미지 주소, 두 구간 형식

소유자 요청("지금은 지정된 곳에서만 나와서 지나치게 제한적")의 1단계다. 관심 주제를 밖으로 보내지 않고 할 수 있는 범위에서 고정 출처를 9곳에서 28곳으로 늘렸다. 화면과 설정은 [카드 피드 1단계](news-card-feed.md)에 있다. 선정 기준은 이 문서의 기존 기준과 같다.

1. 매체가 공식 RSS/Atom을 제공한다.
2. robots가 피드 수집을 막지 않는다(수집기의 실제 User-Agent 이름으로 판정).
3. 피드·사이트 약관이 제목·링크·날짜의 표시를 금지하지 않는다. 기준은 "공개 정적 파일에 메타데이터만 싣는다"는 점이다. 금지하거나 뜻이 불확실하면 넣지 않는다.
4. 기사 링크가 고정 HTTPS 호스트에 있다.
5. 수집기의 기존 파서(UTF-8 RSS 2.0/Atom, DTD 없음)로 읽힌다.

확인일은 2026-11-11(UTC)이다. 약관·RSS 안내 페이지는 그 주소를 직접 받아 해당 문장을 확인했다. robots와 피드 응답은 익명의 일반 클라이언트 이름으로 받았고, 계정·관심사·프로젝트 이름을 어떤 요청에도 넣지 않았다. robots 판정에는 수집기의 실제 User-Agent 문자열을 로컬에서 대입했다(전송하지 않음).

### 추가한 출처

| 출처 / 고정 ID | 언어·분야 | 공식 피드 | 이미지 주소 | 판정 근거 |
| --- | --- | --- | --- | --- |
| 연합뉴스 / `yna-news` — **조건부 · 소유자 판단 대기** | 한국어 · 종합 | [RSS](https://www.yna.co.kr/rss/news.xml) | 제공(`img.yna.co.kr`) | [RSS 안내](https://www.yna.co.kr/rss/index): "비상업적 블로그와 개인적인 용도로만 연합뉴스 RSS 피드를 사용하는 것을 허용", 사전 서면 허가 없는 상업적 이용 금지. robots 허용. |
| 연합뉴스 문화 / `yna-culture` — **조건부** | 한국어 · 문화 | [RSS](https://www.yna.co.kr/rss/culture.xml) | 제공 | 위와 같은 안내·호스트. |
| 연합뉴스 세계 / `yna-international` — **조건부** | 한국어 · 국제 | [RSS](https://www.yna.co.kr/rss/international.xml) | 제공 | 위와 같은 안내·호스트. |
| SBS 뉴스 / `sbs-news` — **조건부 · 소유자 판단 대기** | 한국어 · 종합 | [RSS](https://news.sbs.co.kr/news/newsflashRssFeed.do?plink=RSSREADER) | 제공(`img.sbs.co.kr`) | [RSS 안내](https://news.sbs.co.kr/news/rss.do): "RSS 서비스는 개인 이용자의 비상업적 사용에만 허가", 상업적 사용은 사전 문의. robots 허용. |
| SBS 뉴스 생활·문화 / `sbs-culture` — **조건부** | 한국어 · 생활·문화 | [RSS](https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=07&plink=RSSREADER) | 제공 | 위와 같은 안내·호스트. |
| 노컷뉴스 / `nocut-news` — **조건부 · 소유자 판단 대기** | 한국어 · 종합 | [RSS](https://rss.nocutnews.co.kr/nocutnews.xml) | 없음 | [RSS 안내](https://www.nocutnews.co.kr/rss/): "RSS 서비스는 개인 이용자의 비상업적 사용에만 허용", 상업적 활용 금지. 피드 호스트의 robots는 404(제공하지 않음). 피드가 한국 시각에 `GMT`를 붙여 적는다(아래 날짜 보정). |
| 서울시 경제·복지·교통·안전 / `seoul-economy` `seoul-welfare` `seoul-traffic` `seoul-safe` | 한국어 · 공공 | `https://news.seoul.go.kr/{economy,welfare,traffic,safe}/feed` | 없음 | 기존 서울시 문화·환경과 같은 호스트·robots·[저작권 정책](https://www.seoul.go.kr/helper/copyright.do). 본문·설명은 복사하지 않는다. |
| 카카오 기술블로그 / `kakao-tech` — **조건부 · 소유자 판단 대기** | 한국어 · 기술 | [RSS](https://tech.kakao.com/feed/) | 없음 | 공식 블로그의 피드. 하단 "All Rights Reserved". 피드 사용을 금지하는 문구를 찾지 못했다. 기존 우아한형제들 기술블로그와 같은 판정(제목·링크만). robots 허용. |
| 토스 기술블로그 / `toss-tech` — **조건부 · 소유자 판단 대기** | 한국어 · 기술 | [RSS](https://toss.tech/rss.xml) | 없음 | 위와 같은 판정. robots는 404(제공하지 않음). |
| LY Corporation 기술블로그 / `line-tech` — **조건부 · 소유자 판단 대기** | 한국어 · 기술 | [RSS](https://techblog.lycorp.co.jp/ko/feed/index.xml) | 없음 | 위와 같은 판정. robots 허용. |
| The Conversation / `conversation-global` | 영어 · 연구자가 쓰는 해설 | [Atom](https://theconversation.com/global/articles.atom) | 없음 | [재게시 안내](https://theconversation.com/global/republishing-guidelines): 글 전체가 CC BY-ND. 제목·링크만 싣는다. robots 허용. |
| NASA / `nasa-news` | 영어 · 과학 | [RSS](https://www.nasa.gov/feed/) | 없음 | [이용 안내](https://www.nasa.gov/nasa-brand-center/images-and-media/): NASA 자료는 대체로 미국 저작권 대상이 아니며 개인 웹페이지 사용을 허용한다(표장 제외). 기사 링크는 `www.nasa.gov`·`science.nasa.gov`. robots 허용. |
| MIT News / `mit-news` | 영어 · 과학기술·대학 | [RSS](https://news.mit.edu/rss/feed) | 제공(`news.mit.edu`) | [이용 약관](https://news.mit.edu/terms-of-use): "offers RSS feeds for syndication purposes". 이미지는 CC BY-NC-ND이고 출처 표시가 필요하다(카드는 출처 이름을 함께 보인다). 기존 MIT News 언어학과 같은 호스트. |
| Our World in Data / `owid` | 영어 · 통계·세계 | [Atom](https://ourworldindata.org/atom.xml) | 없음 | [FAQ](https://ourworldindata.org/faqs): 글·차트·데이터는 CC BY. robots 파일에 규칙 없음. |
| Global Voices / `global-voices` | 영어 · 국제·시민 미디어 | [RSS](https://globalvoices.org/feed/) | 제공(`globalvoices.org`) | [재게시 안내](https://globalvoices.org/about/global-voices-attribution-policy/): 별도 표시가 없으면 CC BY. 이미지별 권리는 원문에서 확인한다. robots 허용. |
| EFF / `eff-updates` | 영어 · 디지털 권리·정책 | [RSS](https://www.eff.org/rss/updates.xml) | 제공(`www.eff.org`) | [저작권 안내](https://www.eff.org/copyright): EFF 원작은 CC BY 4.0. 여러 글에 반복되는 기본 이미지는 수집기가 뺀다. robots 허용. |

기존 MIT News 언어학(`mit-linguistics`)도 같은 약관으로 이미지 주소를 싣는다. 나머지 기존 8곳의 피드에는 이미지 요소가 없다.

조건이 붙은 출처(연합뉴스·SBS·노컷뉴스)는 "개인·비상업 용도"가 전제다. 해도가 상업 서비스가 되거나 여러 사람에게 목록을 제공하게 되면 이 출처들은 다시 검토해야 한다.

### 조건부 출처 — 소유자 판단 대기 (2026-11-11 총괄 지시)

아래 6곳(피드 8개)은 지금 동작 그대로 목록에 있다. 다만 허용 조건이 해도의 쓰임(공개 정적 파일에 제목·링크를 싣는 개인 사이트)과 맞는지 소유자가 판단하기 전까지 **조건부**다. 총괄이 소유자에게 묻는다.

| 출처 | 조건(원문 인용, 확인일 2026-11-11) | 해도 쪽 사실 | 이미지 주소 |
| --- | --- | --- | --- |
| 연합뉴스 종합·문화·세계 | [RSS 안내](https://www.yna.co.kr/rss/index): "비상업적 블로그와 개인적인 용도로만 연합뉴스 RSS 피드를 사용하는 것을 허용" | 목록 파일은 누구나 받을 수 있는 공개 정적 파일이다. 광고·유료 기능은 없다. | 수집함(`img.yna.co.kr`) |
| SBS 뉴스·생활·문화 | [RSS 안내](https://news.sbs.co.kr/news/rss.do): "RSS 서비스는 개인 이용자의 비상업적 사용에만 허가" | 위와 같다. | 수집함(`img.sbs.co.kr`) |
| 노컷뉴스 | [RSS 안내](https://www.nocutnews.co.kr/rss/): "RSS 서비스는 개인 이용자의 비상업적 사용에만 허용" | 위와 같다. | 피드에 없음 |
| 카카오·토스·LY Corporation 기술블로그 | 명시적인 허용 문구가 없다. 사이트 아래의 권리 표기("All Rights Reserved")뿐이고 피드 이용을 금지하는 문구도 찾지 못했다. 기존 우아한형제들 기술블로그(2026-10-19)와 같은 선례로 넣었다. | 제목·링크·날짜만 싣는다. | 피드에 없음 |

**이미지 주소 수집을 끄는 자리:** 출처마다 두 줄을 함께 지운다. 수집기 등록부 `scripts/update-discovery-feed.py`의 그 출처 항목에 있는 `'images': {...}`(연합뉴스 3개·SBS 2개 피드에 있음)와 브라우저 등록부 `assets/life/discovery.js`의 `IMAGE_HOSTS`에서 같은 출처 ID 줄이다. 둘이 같아야 한다는 검사(`tests/discovery-card-feed.test.cjs`의 등록부 일치)가 한쪽만 지운 것을 잡는다. 그러면 다음 수집부터 그 출처의 글에 `imageUrl`이 실리지 않고, 브라우저는 그 출처의 이미지 주소를 받아도 버린다. 노컷뉴스·기술블로그 3곳은 지금도 이미지 주소를 싣지 않는다. 출처를 목록에서 아예 빼려면 두 등록부(수집기 `SOURCES`, 브라우저 `EXTENDED_SOURCES`·`PUBLISHERS`)를 함께 고친다. 배포 관문(`scripts/refresh-discovery-artifact.cjs`)은 브라우저 등록부를 그대로 따른다. 사용자는 지금도 뉴스 설정의 `목록에 표시할 출처`에서 끌 수 있다.

NPR은 넣지 않는다(아래 보류 유지).

### 탈락·보류한 후보

| 후보 | 결과 | 이유 |
| --- | --- | --- |
| BBC News·BBC 코리아 | 탈락 | [이용 약관 15절](https://www.bbc.co.uk/usingthebbc/terms-of-use/): "You're not allowed to pluck metadata from our content or RSS feeds". 메타데이터(텍스트·이미지·링크) 사용에는 별도 라이선스가 필요하다. |
| 경향신문 | 탈락 | [RSS 안내](https://www.khan.co.kr/help/help_rss.html): 개인 구독 목적이며 홈페이지 등으로 다수와 공유하려면 사전 허락이 필요하다고 적었다. 공개 정적 파일과 맞지 않는다. |
| WIRED·Ars Technica(Condé Nast) | 탈락 | [이용 약관](https://www.condenast.com/user-agreement): RSS로 받은 콘텐츠도 서면 허락 없이 aggregate·publish·display 금지. |
| UN News, WHO, 동아사이언스, 미디어오늘 | 탈락 | robots가 수집기 이름의 피드 요청을 허용하지 않는다. |
| The Guardian | 보류 | [피드 안내](https://www.theguardian.com/help/feeds): 개인·비상업 목적. 서비스 약관은 뉴스 모음 서비스에 별도 라이선스를 언급한다. 공개 파일 게시가 그 범위인지 불확실하다. |
| NPR | 보류 | [이용 약관](https://www.npr.org/about-npr/179876898/terms-of-use): 개인 사이트·앱에서 피드의 표시·링크를 허용하고 "NPR" 표기와 원문 링크를 요구한다. 다만 피드 전체를 보일 때 "may not redistribute the Content Feed"라고 적어, 공개 JSON에 싣는 것이 재배포인지 불확실하다. 소유자가 이 해석을 받아들이면 가장 먼저 추가할 후보다(피드 응답·robots는 정상). |
| ScienceDaily | 보류 | [RSS 약관](https://www.sciencedaily.com/terms.htm): 사이트·블로그에서 피드를 쓰도록 권장하지만 "failure to display content"를 위반으로 적었다. 제목만 보이고 요약을 빼는 지금의 공급 방식이 이에 해당하는지 불확실하다. 요약 표시 권한(`summary_allowed`)을 여는 작업에서 다시 검토한다. |
| ProPublica | 보류 | [재게시 안내](https://www.propublica.org/steal-our-stories): CC이지만 "wholesale, or automatically" 재게시 금지. 제목 목록의 자동 게시가 포함되는지 불확실하다. |
| Voice of America | 보류 | [저작권 안내](https://www.voanews.com/p/5338.html): VOA 자체 제작물은 공공 영역이지만 통신사(AP·AFP·Reuters) 자료는 재배포 금지이고, 피드에서 둘을 구분할 수 없다. |
| 한겨레, 조선일보, 매일경제, 한국경제, 전자신문, JTBC, 프레시안, 오마이뉴스, 블로터, AI타임스, ZDNet Korea, 슬로우뉴스, The Verge, MIT Technology Review, Al Jazeera, Smithsonian, Quanta, Aeon, Atlantic, Harvard Gazette | 보류 | 피드와 robots는 통과했지만 피드 이용 조건을 적은 공식 페이지를 이번 확인에서 찾지 못했다(일반 약관만 있거나 안내 페이지 주소 미확인). 불확실하면 넣지 않는다는 기준을 따랐다. |
| GeekNews | 보류 | 피드 주소가 등록 호스트 밖(feedburner)으로 이동한다. 수집기는 등록 호스트 밖 이동을 따르지 않는다. 이용 조건의 명시도 찾지 못했다. |
| 동아일보, Phys.org, 뉴스타파, ESA, CERN, 시사IN, 헬로디디, 요즘IT, NIH, Nature, DW | 탈락 | 기술 조건 미달: 응답 실패(시간 초과·403·404·429), 기사 링크가 HTTP 또는 다른 호스트, 발행일이 없거나 파서가 읽지 못하는 날짜, RDF(RSS 1.0) 형식. |
| Hacker News | 탈락 | 기사 링크가 임의의 외부 호스트라 고정 호스트 조건을 만족하지 못한다. |
| eLife, PLOS ONE, arXiv cs.AI | 넣지 않음 | 조건은 통과한다(CC BY·CC0 메타데이터). 하루 수십 편의 논문 제목이 목록을 채우게 되어 이번 확대(일반 언론·넓은 분야)의 목적과 맞지 않는다. |

영어권 일반 종합 언론은 이번 기준으로 한 곳도 통과하지 못했다. 약관이 개인 구독만 허용하거나 메타데이터 사용에 라이선스를 요구한다. 이 공백은 2단계(권리를 정리해 둔 집계 공급원)에서 다룰 일이다.

### 이미지 주소의 범위

- 출처 피드가 스스로 적은 대표 이미지 주소만 쓴다: `media:content`(image), `media:thumbnail`, 이미지 `enclosure`(Atom은 `link rel="enclosure"`). 본문·description 안의 이미지와 원문 페이지의 `og:image`는 읽지 않는다.
- 주소는 HTTPS, 기본 포트, 자격 증명 없음, 2,048자 이하여야 하고, 호스트는 그 출처에 등록한 이미지 호스트여야 한다. data URL, 다른 호스트, 이미지 조건을 확인하지 않은 출처의 이미지는 버린다.
- 한 피드 안에서 같은 주소가 두 글 이상에 나오면 로고나 기본 이미지로 보고 모두 뺀다.
- 이미지 파일은 수집하지 않는다. 공개 목록에는 주소(`imageUrl`)와 출처별 안내(`images.label`·`images.url`)만 실린다. 표시는 계정의 `기사 이미지 보기`(기본 꺼짐)를 켠 브라우저가 그 매체 서버에서 직접 받는다.
- 출처별로 켜고 끈다. 수집기 등록부(`scripts/update-discovery-feed.py`의 `images`)와 브라우저 등록부(`assets/life/discovery.js`의 `IMAGE_HOSTS`)가 같아야 하며 검사가 이를 고정한다.

### 두 구간 형식

```text
catalog {schemaVersion:1, generatedAt, sources:[첫 등록부 9곳], articles:[그 글],
         extended:{sources:[그 뒤에 더한 출처], articles:[그 글]}}
source  {…기존 필드, images?:{label,url}}
article {…기존 필드, imageUrl?}
```

2026-11-11 이전에 배포한 화면의 검증기는 `sources`에 모르는 출처 ID가 하나라도 있으면 목록 전체를 거절한다. 서비스워커가 새 셸을 받기 전까지 열려 있는 화면은 그 검증기로 새 목록을 읽는다. 그래서 첫 등록부 9곳은 `sources`·`articles`에 그대로 두고, 그 뒤의 출처는 이전 판이 읽지 않는 `extended`에 싣는다. 이전 판 화면은 9곳의 글을 그대로 보이고, 새 판은 두 구간을 하나로 합쳐 읽는다. 이전 판은 `imageUrl`·`images`를 읽지 않고 버린다.

배포 관문(`scripts/refresh-discovery-artifact.cjs`)은 두 구간의 출처 집합이 각각 정확히 맞는지, 글이 제 구간에 있는지, 이미지 주소가 등록 호스트인지 확인한다. 9곳만 있는 직전 게시본은 다음 수집의 기준(seed)으로만 받는다. 이전 판 파일은 `tests/fixtures/discovery-old-client/`에 고정해 두고 검사한다.

같은 호스트의 피드(서울시 6개, 연합뉴스 3개, SBS 2개, MIT 2개)는 차례로, 2초 간격으로 받는다. 다른 호스트는 계속 병렬이다. 출처별 실패 격리(마지막 성공 글·시각 유지)는 그대로다.

### 로컬 수집 결과 (익명, 2026-11-11T12:54Z)

실제 수집기를 로컬에서 돌렸다. 요청의 클라이언트 이름만 일반 이름으로 바꿨다. 저장소에 고정한 사본(`assets/life/discovery-feed.json`)은 기존 관례([자동 갱신](discovery-automation.md))대로 바꾸지 않았다.

| 출처 | 글 | 이미지 주소 | robots | 비고 |
| --- | --- | --- | --- | --- |
| 연합뉴스 | 20 | 14 | 허용 | |
| 연합뉴스 문화 | 20 | 20 | 허용 | |
| 연합뉴스 세계 | 20 | 18 | 허용 | |
| SBS 뉴스 | 20 | 20 | 허용 | |
| SBS 뉴스 생활·문화 | 20 | 19 | 허용 | |
| 노컷뉴스 | 20 | 0 | 제공 안 함 | |
| 서울시 경제 / 복지 / 교통 / 안전 | 10 / 10 / 10 / 10 | 0 | 허용 | 첫 실행에서 복지가 연결 실패(같은 호스트를 연달아 요청). 2초 간격을 넣은 두 번째 실행에서 모두 성공. |
| 카카오 기술블로그 | 10 | 0 | 허용 | 첫 실행 성공(10건), 두 번째 실행은 연결 실패. 원인은 확인하지 못했다. |
| 토스 기술블로그 | 20 | 0 | 제공 안 함 | |
| LY Corporation 기술블로그 | 20 | 0 | 허용 | |
| The Conversation | 20 | 0 | 허용 | |
| NASA | 10 | 0 | 허용 | |
| MIT News | 20 | 20 | 허용 | |
| Our World in Data | 10 | 0 | 규칙 없음 | |
| Global Voices | 15 | 15 | 허용 | |
| EFF | 20 | 16 | 허용 | 반복되는 기본 이미지 4건 제외 |
| (기존) MIT News 언어학 | 20 | 20 | 허용 | |
| (기존) 독서신문 20, 서울시 문화 10, 서울시 환경 10, arXiv cs.CL 20, LLT 10, Frontiers 20 | 90 | 0 | | |
| (기존) NAVER D2, 우아한형제들 기술블로그 | 0 | 0 | | D2는 알려진 robots 이동 실패. 우아한형제들은 이 환경에서 HTTP 403이었다. 운영 수집에서 확인해야 한다. |

두 번째 실행 합계: 28곳 중 25곳 성공, 글 405건, 이미지 주소 162건(40%). 브라우저 검증기와 배포 관문 검증기가 이 결과를 그대로 통과했다(거절 0건).

**최신순 상위 20건의 출처 분포:** SBS 뉴스 19건, 연합뉴스 1건(모두 2분 안에 올라온 글). 상위 40건은 SBS 뉴스 20·연합뉴스 20이고, 상위 100건 중 94건이 연합뉴스·SBS의 다섯 피드다. 분 단위로 글을 올리는 통신·방송 피드가 최신순을 차지한다. 기존 순위 규칙에는 최신순에서 출처를 섞는 장치가 없다(개인 추천에만 출처 다양성 보정이 있다).

같은 결과로 계산한 단순 규칙의 효과다. 2026-11-11 후속 지시로 **쪽마다 같은 매체 3건까지**를 최신순에 넣었다(아래).

| 규칙 | 상위 20건의 매체 수 | 분포 | 상위 20건 중 가장 오래된 글 |
| --- | --- | --- | --- |
| 지금(순수 최신순) | 2 | SBS 19, 연합 1 | 2분 전 |
| 같은 출처 연속 2건까지 | 2 | SBS 14, 연합 6 | 2분 전 |
| 쪽(20건)마다 같은 매체 4건까지 | 8 | SBS 4, 연합 4, 서울시 4, arXiv 3, NASA 2, 노컷뉴스·Global Voices·독서신문 1 | 8시간 전 |
| 쪽마다 같은 매체 3건까지 | 8 | SBS 3, 연합 3, 서울시 3, 독서신문 3, arXiv 3, NASA 2, Global Voices 2, 노컷뉴스 1 | 12시간 전 |
| 쪽마다 같은 매체 2건까지 | 11 | 11개 매체가 1~2건씩 | 23시간 전 |

"연속 노출 제한"만으로는 두 매체가 번갈아 나올 뿐이라 효과가 없다. 쪽 단위 상한이 섞임을 만든다. 여기서 매체는 같은 사이트의 피드를 하나로 센 것이다(연합뉴스 3개, SBS 2개, 서울시 6개, MIT 2개).

**적용한 규칙과 재측정 (2026-11-11T15:01:58Z 로컬 수집, 28곳 중 25곳 성공, 글 405건, 이미지 주소 166건):** 매체는 등록부의 발행처 키(`assets/life/discovery.js`의 `PUBLISHERS`와 수집기 `SOURCES`의 `publisher`, 검사로 일치 고정)로 센다. 최신순으로 늘어놓고 20건 쪽마다 같은 매체 3건까지 담으며, 넘친 글은 버리지 않고 다음 쪽으로 넘긴다. 남은 매체가 적어 3건 상한으로 20건을 못 채우는 쪽만 상한을 풀어 채운다. 쪽 안은 최신순이다. 같은 목록이면 어느 기기에서도 같은 순서다. 관심순·개인 추천에는 적용하지 않는다(관심순은 사용자가 고른 주제 일치가 먼저다).

| 쪽 | 매체 수 | 분포 |
| --- | --- | --- |
| 규칙 없음 첫 쪽 | 2 | 연합뉴스 10, SBS 10 |
| 첫 쪽 | 8 | 연합뉴스 3, SBS 3, 노컷뉴스 3, 서울시 3, arXiv 3, 독서신문 2, NASA 2, Global Voices 1(가장 오래된 글 05:00Z, 이미지 6건) |
| 둘째·셋째 쪽 | 각 8 | 같은 방식 |

391건 후보가 쪽을 나눈 뒤에도 391건 그대로다(중복·누락 0). 이 측정은 노컷뉴스 날짜 보정 뒤다(보정 전에는 노컷뉴스 글이 미래 시각이라 시간이 없는 글로 맨 뒤에 있었다).

### 노컷뉴스 날짜 보정

노컷뉴스 RSS는 한국 시각을 적고 `GMT`를 붙인다. 2026-11-11 12:20Z와 15:01Z 두 번 받았을 때 최신 글이 지금보다 7~9시간 앞섰다. 수집기는 등록부에 `gmtLabelIsKoreanTime`이 있는 출처(노컷뉴스만)에서, **그 실행에서 GMT 표기로 읽은 시각이 미래가 되는 글이 있을 때만** 그 피드의 `GMT` 표기를 +09:00으로 읽는다. 피드가 표기를 고치면 미래 시각이 생기지 않아 적힌 대로 읽는다. 다른 출처의 같은 표기는 고치지 않는다(검사: `tests/discovery-card-feed.test.cjs`의 노컷뉴스 날짜 사례).

## 출처 결정

| 출처 / 고정 ID | 공식 피드 | 현재 공급 / 공식 날짜 | 권리·robots 확인 |
| --- | --- | --- | --- |
| [NAVER D2](https://d2.naver.com/home) / `naver-d2` | [Atom](https://d2.naver.com/d2.atom) | 카탈로그 0개, 실패. 별도 공개 응답 확인에서는 Atom 200·20개, 최신 `updated` 2026-10-08. `published` 없음 | 공식 하단 All Rights Reserved. 피드 공개가 본문 재배포 허락은 아니다. `https://d2.naver.com/robots.txt`가 `302 Location: http://d2.naver.com/NotFound`를 반환하므로 updater는 이동을 따르지 않고 수집을 중단한다. robots 허용으로 기록하지 않는다. |
| [서울시 문화](https://news.seoul.go.kr/culture) / `seoul-culture` | [RSS](https://news.seoul.go.kr/culture/feed) | 10개, 최신 발행 2026-10-16 17:11:27 한국 시각 | [공식 robots](https://news.seoul.go.kr/robots.txt)는 전체 허용과 일부 별도 경로 금지이며 `/culture/feed`는 허용한다. [서울시 저작권 정책](https://www.seoul.go.kr/helper/copyright.do)은 공공누리 부착 저작물의 유형별 조건과 미부착 저작물의 사전 협의를 구분한다. 개별 글의 표시를 확인하지 않은 본문·설명은 재배포하지 않는다. |
| [우아한형제들 기술블로그](https://techblog.woowahan.com/) / `woowahan-tech` | [RSS](https://techblog.woowahan.com/feed/) | 10개, 최신 발행 2026-10-06 05:00:35 UTC | [공식 robots](https://techblog.woowahan.com/robots.txt)는 wp-admin 등 일부 경로를 금지하며 피드는 허용한다. 공식 피드·홈에서 전체 본문 재배포를 허용하는 명시적 공개 라이선스를 찾지 못했다. |
| [독서신문](https://www.readersnews.com/) / `readersnews-books` | [공식 RSS](https://www.readersnews.com/rss/allArticle.xml) | 최신 20개. 원 피드 50개 중 동일한 날짜 정렬·출처별 상한 적용. 최신 발행 2026-10-18 06:00 한국 시각 | [RSS 안내](https://www.readersnews.com/rssIndex.html)는 외부 사이트의 제목·링크 수집/표시 예를 명시한다. [저작권정책](https://www.readersnews.com/com/copyright.html)의 본문 복제·전송 금지를 함께 유지한다. robots는 피드를 허용한다. category가 없어 태그를 만들지 않는다. |
| [서울시 환경](https://news.seoul.go.kr/env) / `seoul-environment` | [공식 RSS](https://news.seoul.go.kr/env/feed) | 10개, 최신 발행 2026-10-14. 환경·공원·행사·행정 안내가 섞여 있으며 공연 1개 일치, 기후변화 0개 | 기존 서울시 문화와 같은 공식 호스트/robots·저작권 조건. 본문/설명/이미지는 복사하지 않는다. 기후 분야 공급을 확보했다고 부르지 않는다. |

공통 결정은 `rights.mode: metadata_only`, `coverage: link_only`다. 제목·실제 원문 링크·공식 날짜·공식 작성자 표시·발행자가 제공한 분류 태그만 저장한다. `summary`는 빈 문자열이며 `bodyText`는 없다. RSS에 실린 `description`·`content:encoded`·Atom `content`·이미지·댓글·담당자 연락처를 카탈로그에 복사하지 않는다. 요약이나 본문을 확보했다고 표시하지 않는다. `rights.label`은 서비스의 제공 범위 안내이며 원문 저작권 라이선스를 부여하는 문구가 아니다. 저작자 표시는 공개 피드의 표시명만 쓰고 이메일은 보존하지 않는다.

한국어 기술·문화 공급이 목적에 맞고 외부 검색 API·키·브라우저 직접 크롤링이 필요하지 않아 선택했다. 자동 타이머·서버 작업·배포는 추가하지 않았다. 권리 또는 robots 정책이 바뀌면 해당 출처를 중단하거나 새 조건을 명시적으로 검토해야 한다.

제외한 예: [정책브리핑 문화 RSS](https://www.korea.kr/rss/culture.xml)는 응답이 200이어도 항목이 2018년 자료이며, [공식 2026-07-01 중단 공지](https://www.korea.kr/etc/noticeView.do?newsId=132038885)가 저작권 권리 보호를 이유로 RSS 서비스 종료를 밝힌다. 현재 공급으로 채택하지 않았다. Smithsonian arts/culture는 영어 3개 응답을 확인했으나 이번 한국어 공급에 넣지 않았다.

## 데이터 계약과 날짜

파일은 `assets/life/discovery-feed.json` 하나다. 브라우저는 같은 출처의 고정 경로만 GET하고, 개인 본문·관심·검색어를 이 갱신 스크립트나 원천 사이트에 보내지 않는다. (공개 수집기에 한함. 계정 전용 넓게 찾기는 2026-11-11 소유자 승인으로 별도 경로다 — [넓게 찾기 서버](news-wide-feed.md).) 갱신기는 미리 고정한 공개 피드를 받으며 개인 입력 인자가 없다.

```text
catalog {schemaVersion:1, generatedAt, sources:[], articles:[]}
source {id,name,url,feedUrl,language,rights,status,
        lastSuccessAt,lastAttemptAt,fetchedAt,attemptAt,error,stale,
        freshnessMaxAgeDays,robotsStatus,robotsCheckedAt?,entryCount,latestArticleAt}
article {id,sourceId,url,canonicalUrl,title,publishedAt,dateStatus,
         updatedAt,updatedDateStatus,dateBasis,author,language,tags,
         summary,coverage,rights,fetchedAt}
rights {mode,label,url}
```

- `generatedAt`: 이 정적 파일을 만든 갱신 시도 시각. 원문 발행일이 아니다.
- `lastAttemptAt` / `attemptAt`: 해당 출처의 최근 갱신 시도 시각.
- `lastSuccessAt` / 출처 `fetchedAt`: 실제로 피드를 받고 유효한 항목을 읽은 마지막 성공 시각. 첫 실패는 `null`이다.
- 글의 `fetchedAt`: 그 메타데이터를 실제로 받은 성공 시각. 실패 때 새 시각으로 덮지 않는다.
- `publishedAt`: 원천이 명시한 발행일만 사용한다. 없는 경우 `null`·`dateStatus:unknown`, 잘못된 날짜는 `null`·`invalid`다. 수집 시각으로 대체하지 않는다.
- `updatedAt`: 원천이 제공한 수정 시각. D2의 Atom `updated`를 발행일로 바꾸지 않는다. `dateBasis:updated`와 화면의 수정일 표시를 구분한다.
- 서울 RSS의 시간대 없는 `pubDate`/`upDate`는 출처별 정책으로 한국 시각 UTC+09:00을 적용한다. 우아한 RSS의 명시적 RFC 시간대와 D2 ISO 시간대는 그대로 UTC로 변환한다. 현재 시각보다 5분 넘게 미래인 공식 날짜는 원값과 `future`를 보존하되 최신 발행/수정 정렬과 `latestArticleAt`의 긍정 근거에서 제외한다.
- `tags`: 공식 feed category/tags만 저장한다. 제목에서 관심 태그를 추정해 추가하지 않는다.

기사 ID는 출처 ID와 canonical URL의 SHA-256 앞 20자리로 안정적으로 만든다. `url`은 실제 안전한 원문 링크를 보존한다. `canonicalUrl`은 fragment와 알려진 추적 키(`utm_*`, `fbclid`, `gclid` 등)만 제거하고 `newsId` 같은 필수 query는 보존한다. 동일 canonical URL은 한 번만 공급한다. RSS guid의 예전 도메인을 원문 링크 대신 쓰지 않는다.

고정 허용 호스트는 `naver-d2 → d2.naver.com`, `seoul-culture → news.seoul.go.kr`, `woowahan-tech → techblog.woowahan.com`, `readersnews-books → www.readersnews.com`, `seoul-environment → news.seoul.go.kr`이다. HTTPS·기본 포트만 허용하고 자격 증명·다른 호스트·HTTP 이동·제어 문자 URL을 거절한다. 제목과 작성자도 평문으로 만들며 script/style 등 실행 가능한 요소·속성을 저장하지 않는다.

## 구현 선택과 보안 검토

갱신기는 Python 표준 라이브러리의 `urllib.request`, `urllib.robotparser`, `xml.etree.ElementTree`, `HTMLParser`를 쓴다. 확인 환경은 Python **3.12.14**, Expat **2.8.3**이다. [공식 XML 보안 설명](https://docs.python.org/3/library/xml.html#xml-security)을 확인했다. 고정 UTF-8 피드만 지원하고 실제 DTD/entity 선언·UTF-16 등 미검토 인코딩을 거절한다. 피드 최대 2 MiB, robots 128 KiB, 항목 1,000개, 출처별 최종 20개, 요청 timeout 20초, 동일 허용 호스트 HTTPS redirect 최대 3회로 제한한다. 공식 피드의 CDATA 코드 예시를 실제 entity 선언으로 오판하지 않도록 CDATA/주석과 XML 선언을 구분한다.

재사용 대안 [feedparser 공식 PyPI](https://pypi.org/pypi/feedparser/json)는 확인 당시 **6.0.14**(2026-07-30 배포), Python≥3.10, BSD-2-Clause였다. [공식 저장소](https://github.com/kurtmckee/feedparser)와 [공개 보안 공지 API](https://api.github.com/repos/kurtmckee/feedparser/security-advisories)도 확인했고 후자는 공개 공지 0개를 반환했다. 이는 취약점 부재 증명이 아니다. 이 라이브러리는 다양한 RSS 변형·오류 허용·본문 처리에 유리하다. 이번에는 고정 5개 피드의 RSS2/Atom에서 제한된 메타데이터만 읽고 미검토 형식을 실패로 처리하므로 의존성을 추가하지 않았다. 임의 출처·복잡한 namespace·다국어 인코딩을 지원하게 되면 자체 파서 범위를 넓히기보다 검증된 feedparser 도입을 다시 비교한다. 표준 라이브러리도 보안 업데이트가 필요한 런타임이다.

robots는 각 수동 갱신마다 먼저 확인한다. 404/410 또는 User-agent 지시문 없는 정상 응답은 `not_provided`로 구분하고, 명시적 금지·연결 오류·안전하지 않은 redirect는 그 출처의 실패로 기록한다. robots 허용은 저작권 허락으로 해석하지 않는다. 일반적인 공개 RSS User-Agent와 Accept만 쓰며 차단 우회·브라우저 UA 위장·인증 쿠키를 사용하지 않는다.

## 수동 갱신과 실패 복구

저장소 루트에서 실행한다.

```sh
python3 scripts/update-discovery-feed.py --report /tmp/haedo-discovery-update.json
```

종료 코드 `0`은 모든 출처 성공, `2`는 일부 실패를 표시한 새 카탈로그 저장, `1`은 기존 파일 형식·파일 쓰기 등 전체 오류다. 일부 출처가 실패해도 다른 출처는 갱신한다. 실패 출처는 마지막 성공의 글·글별 수집 시각·마지막 성공 시각을 유지하고, 최근 시도·오류·`status:error`·`stale:true`를 따로 쓴다. 한 번도 성공하지 않은 출처의 글을 만들어 넣지 않는다. 알 수 없는 본문 필드를 이전 파일에서 승계하지 않는다.

JSON 파싱 불가·잘못된 schema·기존 파일 크기 초과는 기존 파일을 덮지 않는다. 임시 파일에 쓰고 fsync한 후 원자 교체하며 교체 실패 때 이전 파일과 내용을 보존한다. 보고서는 본문 없이 공개 응답 상태·URL·크기·SHA-256·수집 수·실패 단계를 기록한다.

`freshnessMaxAgeDays:7`을 출처별로 제공한다. 파일의 `stale:false`는 작성 당시의 성공 상태이며, 화면/core가 현재 시각과 마지막 성공의 간격으로 오래된 자료를 추가 판정한다. 서비스워커의 브라우저 캐시 시각·오프라인 fallback은 원천 수집 성공 시각과 별개다. 정적 파일이 있으므로 갱신되지 않았는데도 계속 최신이라고 표시하면 안 된다.

## 현재 후속 실행 — 50개

최종 갱신은 **2026-10-18T18:41:59Z**다. 공식 수집기는 한 번 실행해 서울 문화 10·우아한 10·독서신문 20·서울 환경 10개를 저장했다. D2는 같은 robots 실패로 0개다. 종료 코드 2는 이 부분 실패를 뜻한다. 모두 metadata_only/link_only, summary/full_text 0, 브라우저 검증 제외 0이며 기존 20개 글의 ID를 모두 유지했다. [실제 수집 결과](evidence/discovery-expansion/source-update.json), [동결·표본 수](evidence/discovery-expansion/frozen.json).

updater의 필수 query 원표기 보존·미래 날짜 구분·손상된 이전 수집 시각 거절을 보완하고 16개 합성 회귀를 통과했다. 새 공식 RSS 권리·시간대·실패 후보와 원응답 해시는 후속의 조사 증거에 남겼다. 기사 본문·정책 전문·연락처는 공개 증거에 넣지 않는다.

## 최초 실행·검수 이력 — 20개

최초 구현 당시 최종 갱신 시각은 **2026-10-18T18:23:24Z**다. 서울 RSS 200(60,898 bytes)·우아한 RSS 200(308,561 bytes), 각각 10개 유효·거절 0개다. source별 원응답 SHA-256과 robots SHA-256은 실행 보고서에 남겼다. 현재 결과는 `link_only:20`, `summary:0`, `full_text:0`이다.

D2 첫 실제 갱신 18:20:53Z는 HTTP406이었다. 표준 Accept에 HTML을 추가한 두 번째 갱신 18:21:22Z에서는 robots의 안전하지 않은 이동이 드러났다. 별도 응답 헤더 확인에서 robots가 `302 → http://d2.naver.com/NotFound`, Atom 자체는 200임을 확인했다. 최종 갱신은 이 이동을 차단하고 단계 `robots`, 유형 `FeedError`, 오류 `허용되지 않은 피드 이동 (HTTPS·등록 호스트만 허용)`를 기록했다. 과거 연구의 Atom200 응답을 성공 자료로 끼워 넣거나 차단을 우회하지 않았다.

이번 최종 실행 증거는 [공개 수집 결과](evidence/external-discovery/source-update.json)에 보존했다. 원본 로컬 경로는 `/workspace/discovery-feed-validation/update-result.json`(최종), 같은 폴더의 `update-attempt-02.json`(두 번째 실제 시도)이다. 첫 시도는 당시 명령 stdout과 통합 검토의 관찰 기록이며 별도 원응답 스냅샷은 보존하지 못했다. 이를 원응답 파일이 있는 것처럼 표시하지 않는다. 최종 실제 실행 이후 추가한 UTF-8/중첩 script 방어는 고정 합성 회귀로 검증했으며 실제 공개 카탈로그를 다시 쓰지 않았다.

```sh
node --test tests/discovery-feed-update.test.cjs
```

9개 회귀 검사 통과: 날짜·권리·본문 미포함, 악성 HTML/URL·중복, 연결/파일 없음·XML 오류·DTD/entity·robots 금지의 마지막 성공 보존, 기존 손상 파일 보존, HTTP/외부 redirect·과대 입력·UTF-16 entity 거절, 원자 교체 실패 보존. 테스트는 합성 고정 피드이며 실제 공개 공급 수에 합산하지 않는다. Python 구문도 확인했고 자체 생성 `__pycache__`는 정리했다.

실제 본문 읽기는 원문 이동으로 제공한다. 사용자가 글을 보관하려면 기존 URL/본문 입력의 가져오기 검토에서 내용·출처·포함 범위를 확인하고 명시 보관해야 한다. 링크 이동을 본문 가져오기나 이미 읽음으로 자동 표시하지 않는다. 공급 검사만으로 추천 유용성·통합 UI·실제 Apple 기기·배포 완료를 주장하지 않는다. 같은 카탈로그의 직접 입력 관심→원문→복귀→가져오기 검토→명시 링크 보관·피드백은 [통합 검수](external-discovery.md)에서 별도로 확인했다. 다음은 공급 범위 보완과 실제 사용자 유용성·기기 평가다.
