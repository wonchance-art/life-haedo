# 외부 글 공급·권리·수동 갱신

확인일: 2026-10-18 UTC / 2026-10-19 한국 시각. 실제 정적 카탈로그는 **한국어 공개 피드 2곳의 20개 글**이다. 등록 출처는 3곳이지만 NAVER D2는 robots 요청의 HTTPS→HTTP 이동을 차단해 실패 상태다. 40개 목표를 맞추려고 실패한 출처·오래된 피드·추정 본문을 더하지 않았다.

## 출처 결정

| 출처 / 고정 ID | 공식 피드 | 현재 공급 / 공식 날짜 | 권리·robots 확인 |
| --- | --- | --- | --- |
| [NAVER D2](https://d2.naver.com/home) / `naver-d2` | [Atom](https://d2.naver.com/d2.atom) | 카탈로그 0개, 실패. 별도 공개 응답 확인에서는 Atom 200·20개, 최신 `updated` 2026-10-08. `published` 없음 | 공식 하단 All Rights Reserved. 피드 공개가 본문 재배포 허락은 아니다. `https://d2.naver.com/robots.txt`가 `302 Location: http://d2.naver.com/NotFound`를 반환하므로 updater는 이동을 따르지 않고 수집을 중단한다. robots 허용으로 기록하지 않는다. |
| [서울시 문화](https://news.seoul.go.kr/culture) / `seoul-culture` | [RSS](https://news.seoul.go.kr/culture/feed) | 10개, 최신 발행 2026-10-16 17:11:27 한국 시각 | [공식 robots](https://news.seoul.go.kr/robots.txt)는 전체 허용과 일부 별도 경로 금지이며 `/culture/feed`는 허용한다. [서울시 저작권 정책](https://www.seoul.go.kr/helper/copyright.do)은 공공누리 부착 저작물의 유형별 조건과 미부착 저작물의 사전 협의를 구분한다. 개별 글의 표시를 확인하지 않은 본문·설명은 재배포하지 않는다. |
| [우아한형제들 기술블로그](https://techblog.woowahan.com/) / `woowahan-tech` | [RSS](https://techblog.woowahan.com/feed/) | 10개, 최신 발행 2026-10-06 05:00:35 UTC | [공식 robots](https://techblog.woowahan.com/robots.txt)는 wp-admin 등 일부 경로를 금지하며 피드는 허용한다. 공식 피드·홈에서 전체 본문 재배포를 허용하는 명시적 공개 라이선스를 찾지 못했다. |

공통 결정은 `rights.mode: metadata_only`, `coverage: link_only`다. 제목·실제 원문 링크·공식 날짜·공식 작성자 표시·발행자가 제공한 분류 태그만 저장한다. `summary`는 빈 문자열이며 `bodyText`는 없다. RSS에 실린 `description`·`content:encoded`·Atom `content`·이미지·댓글·담당자 연락처를 카탈로그에 복사하지 않는다. 요약이나 본문을 확보했다고 표시하지 않는다. `rights.label`은 서비스의 제공 범위 안내이며 원문 저작권 라이선스를 부여하는 문구가 아니다. 저작자 표시는 공개 피드의 표시명만 쓰고 이메일은 보존하지 않는다.

한국어 기술·문화 공급이 목적에 맞고 외부 검색 API·키·브라우저 직접 크롤링이 필요하지 않아 선택했다. 자동 타이머·서버 작업·배포는 추가하지 않았다. 권리 또는 robots 정책이 바뀌면 해당 출처를 중단하거나 새 조건을 명시적으로 검토해야 한다.

제외한 예: [정책브리핑 문화 RSS](https://www.korea.kr/rss/culture.xml)는 응답이 200이어도 항목이 2018년 자료이며, [공식 2026-07-01 중단 공지](https://www.korea.kr/etc/noticeView.do?newsId=132038885)가 저작권 권리 보호를 이유로 RSS 서비스 종료를 밝힌다. 현재 공급으로 채택하지 않았다. Smithsonian arts/culture는 영어 3개 응답을 확인했으나 이번 한국어 공급에 넣지 않았다.

## 데이터 계약과 날짜

파일은 `assets/life/discovery-feed.json` 하나다. 브라우저는 같은 출처의 고정 경로만 GET하고, 개인 본문·관심·검색어를 이 갱신 스크립트나 원천 사이트에 보내지 않는다. 갱신기는 미리 고정한 공개 피드를 받으며 개인 입력 인자가 없다.

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
- 서울 RSS의 시간대 없는 `pubDate`/`upDate`는 출처별 정책으로 한국 시각 UTC+09:00을 적용한다. 우아한 RSS의 명시적 RFC 시간대와 D2 ISO 시간대는 그대로 UTC로 변환한다. 현재 시각보다 1일 넘게 미래인 날짜도 `invalid`다.
- `tags`: 공식 feed category/tags만 저장한다. 제목에서 관심 태그를 추정해 추가하지 않는다.

기사 ID는 출처 ID와 canonical URL의 SHA-256 앞 20자리로 안정적으로 만든다. `url`은 실제 안전한 원문 링크를 보존한다. `canonicalUrl`은 fragment와 알려진 추적 키(`utm_*`, `fbclid`, `gclid` 등)만 제거하고 `newsId` 같은 필수 query는 보존한다. 동일 canonical URL은 한 번만 공급한다. RSS guid의 예전 도메인을 원문 링크 대신 쓰지 않는다.

고정 허용 호스트는 `naver-d2 → d2.naver.com`, `seoul-culture → news.seoul.go.kr`, `woowahan-tech → techblog.woowahan.com`이다. HTTPS·기본 포트만 허용하고 자격 증명·다른 호스트·HTTP 이동·제어 문자 URL을 거절한다. 제목과 작성자도 평문으로 만들며 script/style 등 실행 가능한 요소·속성을 저장하지 않는다.

## 구현 선택과 보안 검토

갱신기는 Python 표준 라이브러리의 `urllib.request`, `urllib.robotparser`, `xml.etree.ElementTree`, `HTMLParser`를 쓴다. 확인 환경은 Python **3.12.14**, Expat **2.8.3**이다. [공식 XML 보안 설명](https://docs.python.org/3/library/xml.html#xml-security)을 확인했다. 고정 UTF-8 피드만 지원하고 실제 DTD/entity 선언·UTF-16 등 미검토 인코딩을 거절한다. 피드 최대 2 MiB, robots 128 KiB, 항목 1,000개, 출처별 최종 20개, 요청 timeout 20초, 동일 허용 호스트 HTTPS redirect 최대 3회로 제한한다. 공식 피드의 CDATA 코드 예시를 실제 entity 선언으로 오판하지 않도록 CDATA/주석과 XML 선언을 구분한다.

재사용 대안 [feedparser 공식 PyPI](https://pypi.org/pypi/feedparser/json)는 확인 당시 **6.0.14**(2026-07-30 배포), Python≥3.10, BSD-2-Clause였다. [공식 저장소](https://github.com/kurtmckee/feedparser)와 [공개 보안 공지 API](https://api.github.com/repos/kurtmckee/feedparser/security-advisories)도 확인했고 후자는 공개 공지 0개를 반환했다. 이는 취약점 부재 증명이 아니다. 이 라이브러리는 다양한 RSS 변형·오류 허용·본문 처리에 유리하다. 이번에는 고정 3곳의 RSS2/Atom에서 제한된 메타데이터만 읽고 미검토 형식을 실패로 처리하므로 의존성을 추가하지 않았다. 임의 출처·복잡한 namespace·다국어 인코딩을 지원하게 되면 자체 파서 범위를 넓히기보다 검증된 feedparser 도입을 다시 비교한다. 표준 라이브러리도 보안 업데이트가 필요한 런타임이다.

robots는 각 수동 갱신마다 먼저 확인한다. 404/410 또는 User-agent 지시문 없는 정상 응답은 `not_provided`로 구분하고, 명시적 금지·연결 오류·안전하지 않은 redirect는 그 출처의 실패로 기록한다. robots 허용은 저작권 허락으로 해석하지 않는다. 일반적인 공개 RSS User-Agent와 Accept만 쓰며 차단 우회·브라우저 UA 위장·인증 쿠키를 사용하지 않는다.

## 수동 갱신과 실패 복구

저장소 루트에서 실행한다.

```sh
python3 scripts/update-discovery-feed.py --report /tmp/haedo-discovery-update.json
```

종료 코드 `0`은 모든 출처 성공, `2`는 일부 실패를 표시한 새 카탈로그 저장, `1`은 기존 파일 형식·파일 쓰기 등 전체 오류다. 일부 출처가 실패해도 다른 출처는 갱신한다. 실패 출처는 마지막 성공의 글·글별 수집 시각·마지막 성공 시각을 유지하고, 최근 시도·오류·`status:error`·`stale:true`를 따로 쓴다. 한 번도 성공하지 않은 출처의 글을 만들어 넣지 않는다. 알 수 없는 본문 필드를 이전 파일에서 승계하지 않는다.

JSON 파싱 불가·잘못된 schema·기존 파일 크기 초과는 기존 파일을 덮지 않는다. 임시 파일에 쓰고 fsync한 후 원자 교체하며 교체 실패 때 이전 파일과 내용을 보존한다. 보고서는 본문 없이 공개 응답 상태·URL·크기·SHA-256·수집 수·실패 단계를 기록한다.

`freshnessMaxAgeDays:7`을 출처별로 제공한다. 파일의 `stale:false`는 작성 당시의 성공 상태이며, 화면/core가 현재 시각과 마지막 성공의 간격으로 오래된 자료를 추가 판정한다. 서비스워커의 브라우저 캐시 시각·오프라인 fallback은 원천 수집 성공 시각과 별개다. 정적 파일이 있으므로 갱신되지 않았는데도 계속 최신이라고 표시하면 안 된다.

## 이번 실제 실행과 검증

최종 실제 갱신 시각은 **2026-10-18T18:23:24Z**다. 서울 RSS 200(60,898 bytes)·우아한 RSS 200(308,561 bytes), 각각 10개 유효·거절 0개다. source별 원응답 SHA-256과 robots SHA-256은 실행 보고서에 남겼다. 현재 결과는 `link_only:20`, `summary:0`, `full_text:0`이다.

D2 첫 실제 갱신 18:20:53Z는 HTTP406이었다. 표준 Accept에 HTML을 추가한 두 번째 갱신 18:21:22Z에서는 robots의 안전하지 않은 이동이 드러났다. 별도 응답 헤더 확인에서 robots가 `302 → http://d2.naver.com/NotFound`, Atom 자체는 200임을 확인했다. 최종 갱신은 이 이동을 차단하고 단계 `robots`, 유형 `FeedError`, 오류 `허용되지 않은 피드 이동 (HTTPS·등록 호스트만 허용)`를 기록했다. 과거 연구의 Atom200 응답을 성공 자료로 끼워 넣거나 차단을 우회하지 않았다.

이번 최종 실행 증거는 [공개 수집 결과](evidence/external-discovery/source-update.json)에 보존했다. 원본 로컬 경로는 `/workspace/discovery-feed-validation/update-result.json`(최종), 같은 폴더의 `update-attempt-02.json`(두 번째 실제 시도)이다. 첫 시도는 당시 명령 stdout과 통합 검토의 관찰 기록이며 별도 원응답 스냅샷은 보존하지 못했다. 이를 원응답 파일이 있는 것처럼 표시하지 않는다. 최종 실제 실행 이후 추가한 UTF-8/중첩 script 방어는 고정 합성 회귀로 검증했으며 실제 공개 카탈로그를 다시 쓰지 않았다.

```sh
node --test tests/discovery-feed-update.test.cjs
```

9개 회귀 검사 통과: 날짜·권리·본문 미포함, 악성 HTML/URL·중복, 연결/파일 없음·XML 오류·DTD/entity·robots 금지의 마지막 성공 보존, 기존 손상 파일 보존, HTTP/외부 redirect·과대 입력·UTF-16 entity 거절, 원자 교체 실패 보존. 테스트는 합성 고정 피드이며 실제 공개 공급 수에 합산하지 않는다. Python 구문도 확인했고 자체 생성 `__pycache__`는 정리했다.

실제 본문 읽기는 원문 이동으로 제공한다. 사용자가 글을 보관하려면 기존 URL/본문 입력의 가져오기 검토에서 내용·출처·포함 범위를 확인하고 명시 보관해야 한다. 링크 이동을 본문 가져오기나 이미 읽음으로 자동 표시하지 않는다. 공급 검사만으로 추천 유용성·통합 UI·실제 Apple 기기·배포 완료를 주장하지 않는다. 같은 카탈로그의 직접 입력 관심→원문→복귀→가져오기 검토→명시 링크 보관·피드백은 [통합 검수](external-discovery.md)에서 별도로 확인했다. 다음은 공급 범위 보완과 실제 사용자 유용성·기기 평가다.
