# 네이버 블로그 본문 추출 오픈소스 활용 검토

2026-10-21 UTC. 검토 기준은 해도의 **공개 글 목록 대조 → 미보관 글 수집 → 본문·사진의 확보 범위 표시 → 기존 자료를 보존한 활용**이다. RSS 파서 선택과 본문 추출기 선택을 구분한다. GitHub의 공식 저장소 README·핵심 소스·LICENSE·커밋/릴리스를 직접 확인했으며, 실제 네이버 추출을 실행한 결과는 아니다.

## 결론

활용할 구현이 있다. **네이버 전용 MIT 구현의 추출부를 분리해 재사용하는 실험을 우선**한다. 1차 후보는 Node.js의 `sansoohan/naver-blog-to-markdown` v1.5.1이며, Python의 `molpass/naver-blog-archiver`를 목록 완전성·누락 보고·더보기 본문 처리의 비교 대상으로 둔다. 실제 HTML과 기존 Edge 번들 적합성이 확인되기 전에는 어느 쪽도 운영 도입 완료로 표시하지 않는다.

기존 RSS는 새 글 발견에 유지하고, 본문 추출은 글별 별도 단계로 연결하는 편이 적합하다. 별도 MCP·로그인 쿠키·대규모 브라우저 크롤러를 먼저 설치할 필요는 확인되지 않았다. 정적 HTML로 필요한 내용을 얻을 수 없다는 실제 근거가 있을 때만 브라우저 실행을 비교한다.

## 네이버 전용 후보

날짜는 별도 표시가 없으면 확인한 기본 브랜치의 마지막 커밋 날짜다. 최근 커밋·README 지원 설명이 현재 네이버 호환성이나 지속 유지보수의 증거는 아니다.

| 후보 | 라이선스·활동 | 소스에서 확인한 기능 | 해도 적용 판단 |
| --- | --- | --- | --- |
| [sansoohan/naver-blog-to-markdown](https://github.com/sansoohan/naver-blog-to-markdown/tree/0bc8cc10200879c52f99585b429bb0fcec4fe5bc) | MIT · [v1.5.1](https://github.com/sansoohan/naver-blog-to-markdown/releases/tag/v1.5.1), 2026-10-08 | Node HTTP 공개 글, 에디터 1·2·3·ONE 선택자와 본문 처리, Markdown·HTML·미디어 백업. 별도의 Playwright 로그인 모드도 포함 | **1차 추출부 재사용 실험 후보.** 백업·파일/캐시·폰트·로그인·브라우저 부분은 기존 Deno 서비스에 통째로 넣지 않음 |
| [molpass/naver-blog-archiver](https://github.com/molpass/naver-blog-archiver/tree/d3a973ef74748082b2646a8bbc4cfdb49de2e195) | MIT · 2026-06-28 · 공개 릴리스 없음 | Python HTTPX/BeautifulSoup, 공개 목록 페이지 순회·총수/누락 보고, 현대/구형 에디터, 더보기 본문, 이미지 저장·재개 | **목록·누락 검출·본문 처리의 유력 비교안.** Python 전체 도입은 별도 실행 환경 필요. README의 초기 단계 설명과 실제 구현 범위도 구분 |
| [hubert-bioinformatics/naver-blog-archiver](https://github.com/hubert-bioinformatics/naver-blog-archiver/tree/7bd74c3842a17a0cb13985e39e23857957ce9200) | MIT · 2026-08-05 · 공개 릴리스 없음 | Node/Cheerio, 목록·본문 텍스트·증분 JSONL. 이미지는 URL 저장 | 가벼운 보조 참고. 목록 400페이지 상한·기보관 항목에 따른 조기 종료가 있어 전체 과거 글 보장 불가 |
| [lazyyoyo/naver-blog-importer](https://github.com/lazyyoyo/naver-blog-importer/tree/f6104ddd0209222c909efdbc6126eff0b1abb90b) | MIT · 2026-04-25 | Python CLI/스킬, 현대/구형 본문·이미지 다운로드 | 직접 채택 제외. 날짜 미확인을 오늘로 채우고 날짜+제목 파일명으로 건너뛰어 같은 날 동명 글이 누락될 수 있음 |
| [jayce-jongseok-im/naver-blog-md](https://github.com/jayce-jongseok-im/naver-blog-md/tree/657a8c6d0d0c5144521eb64e58c4ac59ed71e8fa) | MIT · 2026-05-23 | 목록·모바일 본문→Markdown, 원문/글 번호 메타데이터 | 사진 파일 수집 없음. 목록 파싱 실패 시 부분 목록을 반환하므로 완전성 판단을 재사용할 수 없음 |
| [jeongseup/naver-blog-backer](https://github.com/jeongseup/naver-blog-backer/tree/ead0459fae3ab7f54ca5516dbf7b23885671c8d2) | GPLv3 · 2024-09-11 · 최신 공개 릴리스 v0.1.0은 2022-02-11 | Python HTTP iframe·목록·SmartEditor ONE·이미지 백업 | 구형 본문/일부 요소 누락·URL 처리·HTTP 사용 등의 보완 비용이 크고 직접 편입 시 GPL 계약 검토 필요. GPL이라 사용 불가인 것은 아님 |
| [betarixm/naver-blog.md](https://github.com/betarixm/naver-blog.md/tree/b24602f1c5733660c6933af5aeaec0e61c7cc754) | 2024-04-21 · LICENSE/패키지의 재사용 허가 미확인 | Python 문단·사진→Markdown, 목록 순회 | 직접 복사 제외. 공개 저장소라는 이유만으로 재사용 허가를 추정하지 않음. 일부 구성요소·문자/공백·링크 보존 한계도 있음 |

### 1차 후보를 통째로 도입하지 않는 이유

`sansoohan`의 [본문 선택자](https://github.com/sansoohan/naver-blog-to-markdown/blob/0bc8cc10200879c52f99585b429bb0fcec4fe5bc/src/post-parser.js#L46)는 에디터별 분기와 실패 처리가 있어 재사용 가치가 있다. 그러나 [백업 파이프라인](https://github.com/sansoohan/naver-blog-to-markdown/blob/0bc8cc10200879c52f99585b429bb0fcec4fe5bc/src/backup-post.js)은 Node 파일 저장·캐시·출력 폴더와 결합돼 있고, [요청 모듈](https://github.com/sansoohan/naver-blog-to-markdown/blob/0bc8cc10200879c52f99585b429bb0fcec4fe5bc/src/naver-request.js)은 Playwright를 함께 불러온다. 공개 HTTP 경로가 있다는 사실과 전체 패키지가 Deno Edge에 바로 들어간다는 주장은 다르다.

그대로 가져오면 [네트워크 재시도](https://github.com/sansoohan/naver-blog-to-markdown/blob/0bc8cc10200879c52f99585b429bb0fcec4fe5bc/src/network.js)의 별도 Google 접속·연결 회복 대기와 [이미지 후보](https://github.com/sansoohan/naver-blog-to-markdown/blob/0bc8cc10200879c52f99585b429bb0fcec4fe5bc/src/image.js#L101)의 HTTP 후보 추가 등도 함께 들어간다. 해도는 기존 고정 출처·HTTPS·시간/크기 제한·계정별 저장을 유지하며, 필요한 HTML 추출부와 에디터 구성요소 처리만 분리해야 한다. MIT 코드 편입 시 [저작권·허가 고지](https://github.com/sansoohan/naver-blog-to-markdown/blob/0bc8cc10200879c52f99585b429bb0fcec4fe5bc/LICENSE)를 함께 보존한다.

`molpass`의 비교 근거는 [목록·누락 검수](https://github.com/molpass/naver-blog-archiver/blob/d3a973ef74748082b2646a8bbc4cfdb49de2e195/src/naver_blog_archiver/index.py#L93), [본문·이미지 변환](https://github.com/molpass/naver-blog-archiver/blob/d3a973ef74748082b2646a8bbc4cfdb49de2e195/src/naver_blog_archiver/convert.py#L99), [목록·더보기 요청](https://github.com/molpass/naver-blog-archiver/blob/d3a973ef74748082b2646a8bbc4cfdb49de2e195/src/naver_blog_archiver/naver_api.py)이다. 이미지 요청의 임의 호스트·리디렉션·용량 경계를 해도의 서버 요청 계약으로 바꾸지 않고 전체 도구를 넣는 방식은 채택하지 않는다.

## 사진 원본과 추출 정확성

- `sansoohan`은 고해상도 후보에 [`type=w2000`](https://github.com/sansoohan/naver-blog-to-markdown/blob/0bc8cc10200879c52f99585b429bb0fcec4fe5bc/src/image.js#L134)을 추가한다. 이는 고해상도 요청 전략이며 업로드 당시 원본 파일의 해상도·해시 증거는 아니다. 모든 이미지를 2000px로 제한한다는 뜻도 아니다.
- `molpass`는 받은 이미지 바이트를 파일로 쓰지만 선택한 URL이 썸네일일 수 있다. 사진 다운로드 성공과 원본 확보 판정을 분리해야 한다.
- `lazyyoyo`의 [이미지 처리](https://github.com/lazyyoyo/naver-blog-importer/blob/f6104ddd0209222c909efdbc6126eff0b1abb90b/skills/naver-blog-importer/scripts/images.py#L31)와 `betarixm`의 [이미지 처리](https://github.com/betarixm/naver-blog.md/blob/b24602f1c5733660c6933af5aeaec0e61c7cc754/naver_blog_md/markdown/image.py#L39)는 쿼리 제거/호스트 변형 등으로 후보를 만든다. 이것만으로 원본 확보를 표시하지 않는다.
- `lazyyoyo`의 [날짜 대체](https://github.com/lazyyoyo/naver-blog-importer/blob/f6104ddd0209222c909efdbc6126eff0b1abb90b/skills/naver-blog-importer/scripts/fetch.py#L138)와 [날짜+제목 기반 건너뛰기](https://github.com/lazyyoyo/naver-blog-importer/blob/f6104ddd0209222c909efdbc6126eff0b1abb90b/skills/naver-blog-importer/scripts/import_blog.py#L75)는 해도의 미확인 값 유지·정확 blogId/logNo 식별과 맞지 않는다.

사진별 출처 URL·응답 바이트·픽셀 크기·해시와 실패 여부를 기록하고, 비교할 원본이 없으면 원본 여부는 미확인으로 남겨야 한다. 해도에 받은 파일을 다시 리사이즈하지 않는 것과 네이버가 이미 변환한 파일을 원본으로 되돌리는 것은 별개다. 본문도 OG 요약·일부 구성요소·접힌 내용 누락을 전체 본문으로 승격하지 않는다.

## 범용 추출기·MCP·공식 API

[Mozilla Readability](https://github.com/mozilla/readability)는 DOM에서 본문을 고르는 도구, [Trafilatura](https://github.com/adbar/trafilatura)는 Python HTML 추출기다. [Crawlee](https://github.com/apify/crawlee)는 요청/브라우저 순회·큐 기반이며 [Crawl4AI](https://github.com/unclecode/crawl4ai)는 Python 브라우저/추출 스택이다. 네이버의 iframe·에디터별 구성요소·전체 목록·원본 사진 보존을 이 도구들만으로 해결한다는 최신 공식 성공 근거는 확인하지 못했다. 현재 목표에는 네이버 전용 선택자/구성요소 추출을 먼저 비교한다.

[yeseong-p/naver-blog-reader](https://github.com/yeseong-p/naver-blog-reader/tree/879b0a4a48c4ddb121d1f310d57db1894153d3b5)는 MIT 스킬이며 MCP 서버가 아니다. TLS 검증 해제 요청·정규식·OG 요약 대체가 결합돼 직접 도입하지 않는다. 다른 블로그 작성·발행 MCP는 수신 전용 목표에 맞지 않는다. MCP라는 연결 방식이 수집 정확성·접근 권한·사진 보존을 추가해 주지는 않는다.

네이버 공식 [블로그 검색 API 문서](https://github.com/naver/naver-openapi-guide/blob/617252106233bb2a2591b6388a4b4ad2e0fd5dc3/ko/service-apis/search/blog/blog.md#L169)는 `description`을 요약 패시지로 정의한다. 이 API를 특정 블로그 전체 글·본문·사진을 내보내는 API로 취급하지 않는다.

## 해도 적용 설계와 완료 기준

1. **목록과 본문 분리:** 현재 RSS 연결/글 번호 식별/비공개 보관함은 재사용한다. 과거 목록 확보는 비공식 API의 페이지 순회·상한·중단·누락을 기록하며 전체 완료 여부를 별도로 판정한다. 최신 RSS에 없다는 이유만으로 글이 없다고 표시하지 않는다.
2. **추출부 어댑터:** 공개 글의 정적 HTML에서 에디터별 본문·제목·날짜·링크·이미지 참조를 구조화한다. 외부 결과가 owner/workspace를 정하지 않고 검증된 작업의 계정만 사용한다. 기존 고정 출처·리디렉션·응답 크기/시간 경계를 유지한다.
3. **기존 원문 보존:** 현재 [수집 보관함 SQL](../../supabase/migrations/20261021093111_life_naver_subscriptions.sql)은 `partial/link_only`만 받고 같은 글을 덮지 않는다. 전체 본문 보완은 기존 자료의 새 불변 버전/검토 경로를 재사용한다. RSS 항목을 조용히 교체하지 않으며 옛 인용은 옛 정확 버전을 유지한다.
4. **실험과 선택:** 접근 허용 후 실제 현대/구형 글과 접힌 본문·이미지 실패 사례에서 정적 추출 적합성, 누락 요소와 원본 판정 가능성을 비교한다. 순수 추출부의 Edge 번들/실행 비용을 확인하고, 정적 HTTP로 안 되는 사례에만 격리 브라우저나 별도 Node/Python 작업기를 비교한다. 실패하면 기존 RSS/수동 본문 보완을 유지한다.
5. **운영 완주:** 실제 목록 대조→새 글 한 번만 보관→본문 보완→기존 글쓰기 왕복→앱 종료 중 예약 수집→재접속 수신→중지/재시도까지 한 묶음으로 검증한다. 현재 네트워크 허용·실제 접근 조건·서버 실행 자격/일정 설정이 선행이며, 추출기를 바꾸는 것으로 이를 대체하지 않는다.

## 확인 범위

조사 기준 main은 `d6009ea`이며 다른 세션의 뉴스 변경을 보존했다. 코드 복사·패키지 설치·제3자 CLI 실행·실제 네이버 요청·개인 글 조회·DB/Edge/예약 설정 변경은 하지 않았다. 현재 환경 관측 spec358은 최신/enforced이며 네이버 허용 호스트는 없다. 기존 프록시403을 외부 서비스의 차단이나 네이버의 봇 판정으로 단정하지 않는다.

`sansoohan`, `molpass`, `hubert`, `jeongseup`의 GitHub 공개 저장소 security-advisories API는 확인 시 HTTP200/빈 목록이었다. 이는 저장소에 공개된 권고가 없다는 범위이며, 전이 의존성 감사·배포 패키지 서명·전체 안전성·현행 네이버 호환성 보증은 아니다. 실제 채택 버전과 의존성은 별도 고정·검증한다. 이번 결론은 **도입 가능성이 높은 후보와 재사용 범위를 정한 검토 완료**이며 운영 도입/실수집 완료가 아니다.
