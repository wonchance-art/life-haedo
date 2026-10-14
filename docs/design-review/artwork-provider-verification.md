# 작품 제공자 접속·검색 실험

2026-10-14 KST. PR #80 후속. 두 도메인의 환경 반영 확인과 공식 API 실험을 재개했다. 자동 작품 검색 연결은 약관 본문 확인이 남아 있다.

## 접속 확인

`api.artic.edu`와 `www.artic.edu`는 환경 설정의 custom/effective 목록과 실행기의 `/etc/codex/network-policy.json`에 모두 있다. 환경은 running, 설정/관측 revision 3, observations_current=true다. 상태 도구의 network_policy.state는 여전히 unknown이므로 enforced로 보고하지 않는다. 실제 프록시 경유 요청은 아래처럼 성공했다.

| 공식 주소 | 실제 결과 |
| --- | --- |
| [작품 27992 API](https://api.artic.edu/api/v1/artworks/27992?fields=id,title,image_id,is_public_domain) | HTTP 200, 작품 ID·제목 반환 |
| [현재 API 문서](https://api.artic.edu/docs/) | HTTP 200 |
| [그랑드 자트 작품 페이지](https://www.artic.edu/artworks/27992/a-sunday-on-la-grande-jatte-1884) | HTTP 200 |
| [약관](https://www.artic.edu/terms) | HTTP 403, Cloudflare `Just a moment...`; 격리 Chromium에서도 동일 |

이는 이전 환경의 CONNECT 403과 다른 상태다. 약관 페이지 문제를 도메인 미추가로 판단하거나 같은 도메인을 다시 추가할 필요는 없다. 프록시·TLS 검증을 유지했고 차단을 우회하지 않았다. [접속 기록](evidence/artwork-provider/access-report.json)을 참고한다.

## 한국어·원어 각 5개 비교

기본 `artworks/search?q=…&fields=…&limit=6`는 한국어 5개 모두 `Self-Portrait`(Walter Shirlaw)을 첫 결과로 반환했다. 모든 10개 검색의 pagination.total은 133165였다. HTTP 200·비어 있지 않은 결과·전체 개수는 검색 적합성의 증거가 아니었다.

제목·작가에 명시적으로 일치하는 후보만 받도록 공식 Query DSL의 `multi_match`를 사용했다. 원어를 자동 번역하거나 한국어 검색을 임의로 다른 이름으로 바꾸지 않았다.

```json
{
  "query": {
    "multi_match": {
      "query": "Monet",
      "fields": ["title", "artist_title"],
      "operator": "and"
    }
  },
  "fields": ["id", "title", "artist_title", "date_display", "medium_display", "is_public_domain"],
  "limit": 6
}
```

위 JSON을 URL의 `params`로 인코딩한 GET 요청이다. 설명 HTML·이미지·개인 메모를 요청하지 않았고 각 검색은 후보 6개 이하만 읽었다.

| 한국어 입력 | 일치 후보 수 | 원어 입력 | 일치 후보 수 | 원어 첫 후보 |
| --- | ---: | --- | ---: | --- |
| 모네 | 0 | Monet | 49 | Stacks of Wheat (End of Summer), Claude Monet |
| 고흐 | 0 | Van Gogh | 22 | The Bedroom, Vincent van Gogh |
| 호쿠사이 | 0 | Hokusai | 592 | Under the Wave off Kanagawa, Katsushika Hokusai |
| 그랑드 자트 | 0 | La Grande Jatte | 8 | A Sunday on La Grande Jatte — 1884, Georges Seurat |
| 별이 빛나는 밤 | 0 | Starry Night | 7 | Starry Night and the Astronauts, Alma Thomas |

[실제 요청·응답 기록](evidence/artwork-provider/search-report.json). 이 작은 실험에서 한국어 검색은 유용한 후보를 제공하지 않았다. `Starry Night` 첫 후보도 고흐 작품이 아니다. 소장 범위를 미술관으로 명시하고 제목·작가·제작 시기를 확인한 뒤 선택해야 한다. 후보 순위·개수는 제공자 갱신에 따라 달라질 수 있다.

`multi_match`의 AND 조건은 무관한 기본 결과를 줄이는 대신 제목과 작가를 함께 입력하는 경우 등 일부 일치를 놓칠 수 있다. 전체 카탈로그의 검색 품질을 검증한 것은 아니다. 숫자 점수 임계값이나 샘플별 번역 사전으로 후보를 채우지 않는다.

## API 조건·브라우저 확인

현재 공식 문서는 익명 API 60회/분, HTTPS, fields 제한과 응답 캐시, 웹 앱 통합을 설명한다. 실제 작품 응답의 info.version은 1.16이고, description은 CC BY 4.0, 다른 데이터는 CC0 1.0 **및 artic.edu 약관**을 따른다고 명시한다. 설명·이미지를 제외한 작은 메타데이터 실험과 전체 API/이미지의 이용 허용을 구분한다.

API 응답의 `Access-Control-Allow-Origin: *`를 확인했다. 격리된 Linux Chromium의 별도 loopback origin에서 credentials=omit/referrerPolicy=no-referrer/redirect=error로 작품 API를 읽어 HTTP 200·type=cors·작품 ID 27992를 확인했다. [브라우저 기록](evidence/artwork-provider/browser-cors.json). 배포된 앱에서의 검색·첨부 검증은 아니다. 브라우저의 data URL 이동은 관리자 정책으로 거절되어 로컬 HTTP origin으로 확인했으며 외부 프록시는 유지했다.

공식 문서는 법적 조건의 최종 근거를 [약관](https://www.artic.edu/terms)과 이미지 이용 안내로 넘긴다. 약관 본문이 여전히 확인되지 않아 PR #80에서 정한 연결 완료 조건을 충족하지 못했다. 이미지 요청이나 앱의 외부 검색 버튼은 추가하지 않았다.

## 다음 구현과 Local 인계

1. 접근 가능한 공식 약관 본문으로 메타데이터 이용 조건을 확인한다. 같은 네트워크 설정을 중복 변경하지 않는다.
2. 확인 후 기존 CollectionMetadata/CollectionPicker에 제목·작가 일치 검색을 연결한다. 입력 중에는 요청하지 않고, 검색 버튼 한 번에 후보 6개 이하를 받는다. 원어 입력·미술관 소장 범위·빈 결과와 수동 입력을 안내한다.
3. 선택 → 수정 가능한 제목/작가/출처 → 명시 첨부/비공개 저장을 실제 앱에서 검증한다. 저장 실패·늦은 응답 취소·개인 메모/본문/정확 출처·백업 보존과 세 화면 폭을 확인한다.

이번 결과는 문서·공개 실험 증거만 추가했다. PR #80의 수동 작품 입력·기존 앱·SQL·의존성·서비스워커·종합 맵은 변경하지 않았다. Local 순서는 #74 → #75 → #76 → #77 → #78 → #79 → #80 → 이 검증 기록이다. 선행 squash 후 main/base/잔여 diff를 대조하며 #71 운영 설치·읽기 전용 8조건을 유지한다. 병합·배포는 Local 담당이며 실제 Apple 기기·운영 로그인·RLS는 이번 실험 범위가 아니다.
