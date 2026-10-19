# 공식 공급 보완과 자동 실사용 준비 검수

2026-10-19 KST. 사용자가 다음 P1을 진행하고 **지금은 자동 검수까지** 선택했다. 목표는 기존 주제→후보→원문→좋아요/담기·명시 보관→같은 목록 복귀를 재사용하고, 공식 공급·동일 조건 비교·운영 준비를 함께 확인하는 것이다. 실제 계정/기기·직접 독서/만족·운영 병합/배포·workflow_dispatch는 실행하지 않는다.

## 추가한 공급과 채택 근거

공식 RSS·robots·이용 조건을 확인한 두 출처를 고정 등록했다. 기존 5개 ID/호스트는 그대로 유지하며 임의 검색/URL 등록·본문 스크래핑을 추가하지 않는다. [공식 조사 근거](evidence/discovery-field/source-research.json), [실제 수집 영수증](evidence/discovery-field/source-update.json)을 따른다.

| 출처 | 선택 근거와 제한 |
| --- | --- |
| [MIT News 언어학](https://news.mit.edu/topic/linguistics) | 공식 페이지가 [RSS](https://news.mit.edu/topic/mitlinguistics-rss.xml)를 제공하고 [이용 조건](https://news.mit.edu/terms-of-use)이 RSS syndication을 명시한다. MIT News 출처명·원문 링크와 공개 작성자/날짜/분류만 제공한다. 기사·부제·요약·이미지는 복제하지 않는다. 영문 기관 뉴스이며 인사/행정·인접 분야도 섞이고 최신 글의 날짜는 최근 수집 시각과 다르다. |
| [arXiv cs.CL](https://arxiv.org/list/cs.CL/recent) | [공식 RSS](https://rss.arxiv.org/rss/cs.CL)와 [API/RSS 약관](https://info.arxiv.org/help/api/tou.html), [메타데이터 CC0](https://info.arxiv.org/help/license/index.html)를 확인했다. 초록·본문·PDF·이미지는 제공하지 않는다. 계산언어학/NLP 영문 사전공개 논문이며 동료심사/사실 검증을 뜻하지 않는다. RSS 공지일은 최초 제출/논문 출판일과 다를 수 있다. |

arXiv의 legacy API/RSS 요청은 최소 3초 간격·단일 연결을 지킨다. 출처 전용 pacer가 robots·feed·HTTPS redirect·실패 시도와 응답 닫힘까지 처리하며, 다른 출처 요청 정책은 바꾸지 않는다. monotonic clock/sleeper 주입으로 간격·redirect·실패/재시도·다른 출처의 독립성을 합성 검사했다. 이 gate는 한 process 안의 제어이므로 다른 arXiv 수집 작업을 동시에 실행하지 않는 운영 조건도 유지한다. 주말/무공지의 빈 RSS는 기존 마지막 성공/오래됨 보존 정책을 따른다.

Language Log는 공식 RSS가 정상이지만 명시적 재이용 조건을 충분히 확인하지 못해 보류했다. British Council은 확인한 RSS가404이고 재게시/직접 링크 약관도 제한적이어서 등록하지 않았다. robots 허용·CC 이미지 조건을 전체 본문 복제 허가로 바꾸지 않는다. 새 의존성·parser 프레임워크·추천 모델·서버는 추가하지 않았다.

## 실제 한 번의 수집

**2026-10-19T05:50:54Z / 14:50:54 KST**, 등록7개 중6개 성공·D2 부분 실패로 종료 코드2다. 총90개는 서울 문화10·우아한10·독서신문20·서울 환경10·arXiv20·MIT20이다. D2의 HTTPS→HTTP 이동 차단과0개를 유지했다. 모두 metadata_only/link_only이고 브라우저 검증 탈락0, 본문/요약/이미지 복사0이다.

이전50개 중 새 목록에도 있는44개는 ID·원문 URL·canonical 정체성이 같다. 6개는 공식 최신 목록 창에서 빠지고 새 글로 교체됐다(독서신문4·문화1·환경1). 이를 기존 사용자 글/반응 삭제로 표시하지 않는다. 좋아요/담은 글은 저장 snapshot으로 재열기하며 기존 UI·Storage·반응/관심/설정 schema·추천 점수 정책·별칭을 변경하지 않았다. 새 출처 수를 관련성/유용성 향상 점수로 쓰지 않는다.

영문 공급 추가가 한국어 입력을 자동 번역하지 않는다. 예컨대 한국어 단어만 입력해 영문 제목/태그에 표현이 없으면 관심순은0개일 수 있다. 해당 출처/최신순으로 공급 자체를 확인하거나 글에 실제 있는 표현을 명시 입력할 수 있다. 임의 별칭·부분 분해로 결과를 채우지 않았으며 일반 언어학·언어 학습 조언 전체를 확보했다고 주장하지 않는다.

## 이전 공개 목록과 연속 갱신

[`refresh-discovery-artifact.cjs`](../../scripts/refresh-discovery-artifact.cjs)의 초기 seed 단계에만 정확히 검토된 기존5개 집합을 허용한다. 임의 subset/알 수 없는 출처는 거절하고, 최종 candidate/install은 현재7개 전부를 계속 요구한다. 새 출처 첫 실패는 lastSuccess=null·0개 유지로만 허용해 기존 성공 이력과 혼동하지 않는다. 기존 출처 실패의 마지막 성공 시각·각 article 메타데이터 보존 검사는 유지한다. 수집/사이트 생성·설치는 격리 사본에서 수행하며 개인 설정/원문을 읽지 않는다.

## 같은 파일의 세 정렬 비교

[`evaluate-discovery-field.cjs`](../../scripts/evaluate-discovery-field.cjs)는 기존 공개 카탈로그 검증·Discovery/Recommendations.rank·Actions 검증기를 조합한다. 입력은 명시 파일만 읽고 네트워크·Auth·개인 Storage를 열지 않는다. 같은 raw feed SHA·고정 now·profile/source/known 조건으로 최신순/관심순/개인 추천 상위2개씩과 좋아요 제거 진단을 만든다. 원래 과거 좋아요 URL을 모든 arm에서 동일하게 제외해 자기 글 재추천과 후보 풀 변경을 분리한다. 신호 제거 결과는 관심순 전체 JSON과 정확히 같아야 한다.

반응 파일에는 simulation/user_supplied를 명시한다. 파일은 strict preview 뒤 비교용 메모리에만 재구성하고 기존 제외·시각을 유지한다. 비교 조건의 개인 추천 on은 앱 설정 변경/사본 import가 아니다. 실검증의 개인 추천 양성은 **합성6개 문서·합성 좋아요**이며 실제 사용자 반응으로 세지 않는다. 실제90개 파일로는 주제/반응을 지정하지 않은 양식 생성도 확인했다. 선택·실제 반응 확인·읽기 의향·실독·도움·순서 선호는 모두 null이다.

출력은 새 `.local/discovery-field/<run>` 안에만 만들고 기존 경로/ancestor symlink를 거절한다. 파일은 로컬 전용이며 공개 문서·Pages artifact에 넣지 않는다. stdout/오류에는 입력 문구·제목·개인 파일 경로/해시를 노출하지 않는다. 각 목록 A/B/C는 고정 순서이고 원문은 최대6개 합집합에서 한 번씩만 평가한다. 자동 통계는 사용자 만족·순서의 인과 효과가 아니다. 입력/기존 판단을 변경하거나 답을 자동 채우지 않는다.

```sh
node scripts/evaluate-discovery-field.cjs --now 2026-10-19T06:00:00Z --out .local/discovery-field/review-new
```

주제를 골랐을 때만 `{ "schemaVersion": 1, "topic": "직접 고른 표현" }` 파일을 `--topic-file FILE`로 지정한다. 전용 반응 사본은 원할 때만 `--actions FILE --actions-kind user_supplied`로 명시한다. 위 예제는 주제 미선택/반응 없음이며 효용 평가 완료가 아니다. 기존 공개9표본 비교 CLI는 같은 실제90개 bytes에서 report/review/Markdown 전체 출력 일치를 확인했다.

## 운영 상태와 남은 조건

착수 시 공개 GET과 [운영 영수증](evidence/discovery-field/operations.json)을 대조했다. 운영은 main `58e5cd5`·**SW v134**이고 공개 discovery feed는404다. 현재 main workflow에는 정기 수집 schedule이 없다. 후보의 매일15:15KST 설정과 로컬 수집 성공을 현재 운영 성공으로 보고하지 않는다. 배포 영수증은 run39195216038의03:45:20Z 성공·main SW/index/Shell 바이트와 일치했다.

후보 SW v137의 첫 공개 수집은 현재 v134의 정확한 허용 SHA+feed404를 확인해야 bootstrap할 수 있다. 이후에는 직전 공개 JSON을 seed로 받아 실패 출처의 마지막 성공을 보존한다. 검증된 수집·생성 사이트 SHA·설치/배포 영수증이 일치해야 릴리스를 완료로 판정한다. 복구는 호환 코드/자료 메타데이터를 보존하는 후보와 기존 검수 절차를 사용하고, 저장소 포맷을 모르는 과거 코드로 단순 되돌리지 않는다.

사용자가 이번 범위를 자동 검수로 정했으므로 병합·배포·dispatch를 실행하지 않았다. 실제 기기 한 대에서 주제 하나·글 하나의 원문 왕복/반응·선택 보관과 한 줄 경험부터 확인하고, 다른 기기·Google·IME/Files·실독 유용성은 별도 기록해야 한다. 사용자에게 기술 해시나 전체 평가표를 작성하게 하지는 않는다.

## 최종 자동 검수

- 전체 단위1048/1048, 정적HTML22·JS145·참조621 통과. 공급20·배포연속갱신32·기존/신규평가19 검사가 포함된다.
- CI와 같은 Chromium153에서 발견19/19·반응24/24·자동갱신23/23, 실제공개4출처 동선4/4 통과. 이 중 새 두 출처는 각20개 정상 공급에서 정확 원문URL 팝업·독립반응·명시link_only보관·재로드/두보관목록 재열기를 확인했다. 원문 팝업 응답은 명시 클릭 후 가로챈 합성HTML이며 실제 원문 독서가 아니다.
- 새 arXiv390px·MIT담은목록1440px을 실행 담당과 총괄이 직접 확인했다. 긴 영문 제목·출처/날짜·반응·모바일 줄바꿈을 유지했다. [arXiv 후보](evidence/discovery-field/actual-arxiv-candidate-390.png), [MIT 담은목록](evidence/discovery-field/actual-mit-saved-1440.png).
- v136→137 PWA9/9와 실제 생성된 이전전체앱v136/운영main전체앱v134→137 플랫폼10/10 통과. 별도PWA9는 이전worker만136·앱모듈은현재이며 현재API로심은반응을 비교한다. 전체이전앱검사는별도로 구분했다.
- 세 브라우저 suite의 실제 console/page오류·개인전송·예상밖외부/모델요청·원격쓰기0, 실행중제품해시불변. 기존원문/반응/관심/설정/전역UI/Shell·백업스키마를바꾸지 않았다. 원본별도작업공간도유지했다.

[고정소스해시·범위·결과JSON](evidence/discovery-field/verification.json)에 최종바이트와 실제/합성 구분을 남겼다. 위 숫자를 사용자 유용성 지표로 쓰지 않는다.

원격 CI는 [draft PR103의 정확한 현재 HEAD](https://github.com/wonchance-art/life-haedo/pull/103/checks)를 따른다. 착수556ee1d의 기존8개 성공을 이번 변경의 결과로 재사용하지 않는다. [최신 로드맵](../life-tools-design/roadmap.md)에 운영·실기·유용성과 추천 고도화 조건을 구분한다.
