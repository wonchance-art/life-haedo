# 현재 뉴스 화면의 개인 본문 읽기 통합

2026-11-05. 묶음 C. 기준 main `2eebd27cbde54f697c9de3a09382f2e21b39a743`, 브랜치 `codex/news-private-reader-integration`. 구현과 합성 브라우저·격리 PostgreSQL 검증 기록이며 운영 출시 기록이 아니다.

## 목표와 담당

뉴스 제목 선택 → 현재 읽기 칸에서 본문·그림 읽기 → 받은 정확한 본문을 자료로 보관 → 같은 계정의 다른 기기에서 읽기까지 연결한다. 현재 목록·390px 전체 화면·뒤로 가기·초점 복귀와 계정 자동 동기화를 유지한다.

- [PR209 작업 지시서](https://github.com/wonchance-art/life-haedo/pull/209#issuecomment-6648758416), [집중 구현 C 배정](https://github.com/wonchance-art/life-haedo/pull/212#issuecomment-6650230384).
- [공용 파일·수집 helper·SQL 검사 승인](https://github.com/wonchance-art/life-haedo/pull/212#issuecomment-6650248345), [`ui.js` 최소 연결 승인](https://github.com/wonchance-art/life-haedo/pull/212#issuecomment-6650254288).
- 원본은 PR145 `0b7f632518782686ea5ad29bf50169126f51e101`. 옛 브랜치를 병합하지 않고 필요한 모듈만 현재 화면에 이식했다. [이전 인계서](news-reader-orchestration-handoff-20261105.md)의 과거 상태와 이번 구현을 구분한다.

## 사용 흐름과 범위

| 출처 | 읽기 칸 | 자료 보관 |
| --- | --- | --- |
| Frontiers Psychology | 공식 JATS 본문, 검증된 그림 최대 2장 | 받은 본문·출처. 그림은 저장하지 않음 |
| MIT Linguistics | 기사 본문 | 받은 본문·출처 |
| LLT | RSS 초록. `초록`으로 표시 | 받은 초록·출처. 전체 본문으로 표시하지 않음 |
| 그 외 또는 본문 확보 실패 | 기존 허용 출처 iframe 또는 새 탭 링크 | 기존 메타데이터·링크 경로 |

- 수신 중에는 본문 보관 버튼을 잠근다. PR145의 수신 전 링크 보관과 다른 선택이다. 본문을 기다리다 링크만 저장하는 일을 막고, 실패하면 재시도와 기존 링크 경로를 제공한다.
- 읽는 순간의 제목·출처와 받은 본문을 하나의 snapshot으로 유지한다. 피드 갱신으로 현재 본문을 조용히 바꾸지 않는다. 반응·평가에는 공개 메타데이터만 전달한다.
- 성공 응답은 본문 영역과 보관 상태만 갱신한다. 누르고 있던 반응 버튼을 교체하지 않는다. 재시도 때의 키보드 초점과 페이지 중단·재개 상태도 보존한다.
- 본문은 텍스트 노드로 표시한다. 이미지 바이트를 제한·검증한 뒤 Blob으로 읽고 URL을 해제한다. 원문 HTML을 삽입하지 않는다. LF·CRLF 원문 줄바꿈을 보존한다.
- 보관은 기존 자료 가져오기·원문 저장·계정 동기화를 재사용한다. 별도의 기기 연결 메뉴나 저장 엔진을 만들지 않는다.

## 구현과 보존 경계

- `discovery-private-remote.js`: 인증한 소유자·workspace·세대 확인, 취소·늦은 응답 차단, 제한된 요청 `{sourceId,url}`, 수신 본문·출처·범위·이미지 검증. 공개 피드 검증기는 바꾸지 않았다.
- `discovery-reader-ui.js`: 본문·그림만 표시한다. 이동·history·toolbar는 현재 `discovery-ui.js`가 계속 맡는다.
- `ui.js`: 클라이언트 생성·주입·dispose와 정확 본문 가져오기 분기에 한정해 9줄 추가·2줄 제거. `storage.js`와 계정 동기화 모듈은 변경하지 않았다.
- 두 HTML·배포 파일 목록·SW SHELL에 새 모듈 2개를 등록했다. `sw.js` CACHE는 `haedo-v194` 그대로다. 개인 본문·영수증·Edge·SQL을 공개 배포물이나 SW 캐시에 넣지 않는다.
- Edge는 기존 `_shared/supabase-keys.mjs`와 `serverHeaders()`를 사용한다. 사용자 JWT로 Auth·claim을 수행하고, finish에 쓰는 새 secret 키는 `apikey`로만 보낸다. 기존 게이트웨이 설정 변경은 요청하지 않았다.
- 공유 collector 변경은 `robotsAllowed(text,path,userAgent=UA)`와 해당 UA 비교 두 줄이다. Naver 기본 UA는 유지하며 뉴스 UA의 명시적 robots 규칙을 따르게 한다. `harvest-network.mjs`·`extractor.mjs`는 그대로다.
- SQL은 원본 복구만 한다. 기존 migration 허용 목록·SHA 검사를 약화하지 않고 정확 원본 1개를 등록했다.

## 운영 원본 대응과 총괄 작업

| 항목 | 대응 |
| --- | --- |
| 저장소 SQL | `supabase/migrations/20261029084145_discovery_private_reader.sql` |
| 운영 migration 영수증 | `20261029084926 discovery_private_reader` |
| SQL SHA-256 | `30c741bba2ef5b3658c7b17d653828649b0d98d30e2db17d4e12c877b057bd0e` |
| 운영 대조 근거 | [Claude의 읽기 전용 대조](https://github.com/wonchance-art/life-haedo/pull/209#issuecomment-6648475271): Edge v1 ACTIVE, `verify_jwt=true`, 원본과 동일 |

운영 동일성은 위 총괄 증거이며 이번 작업자가 운영을 조회한 결과가 아니다. 번호 차이 때문에 SQL을 다시 설치하거나 기존 데이터를 지우지 않는다.

총괄은 최종 검수·현재 head CI와 새 검사 등록을 확인하고, 통합 시 캐시를 판올림한다. 키 helper·공유 collector 변경 때문에 **`haedo-discovery-private`와 `haedo-naver-blog` 둘 다 재배포**한다. 실제 인증 왕복·허용 출처 수신·배포판에서 새 판으로의 PWA 갱신은 총괄 운영 단계에서 확인한다. 화면 변경 사항은 디자인 담당에게 전달한다.

## 검증 기록

검사 결과·변이·파일 해시는 [검증 증거](evidence/news-private-reader-integration-20261105.json)에 기록한다. 구현자와 별도 에이전트가 데이터 손실·개인정보·정확 판·기존 흐름·단언 약화를 검수했다. 모든 브라우저 계정·출처 응답은 합성 fixture이며 실제 계정 쓰기·운영 DB·외부 출판사 수집을 하지 않았다.

- 단위 2,022/2,022, 새 개인 읽기 브라우저 13/13, 기존 회귀 96/96, SQL 전용 12/12·통합 설치 13/13·전체 재생 11/11. 정적·링크 검사 통과.
- 인증·출처·이미지 제한·취소·본문 범위·계정/세션/lease·화면 재개·누르는 중인 버튼을 바꾼 변이 17개가 모두 해당 검사에서 실패했다.
- 새 브라우저는 필터 없이 콘솔·페이지 오류 0이다. 기존 external 검사는 의도한 503 오류 2건, external·records 검사는 기존 SW-block iframe harness 오류 각 3건을 별도 기록한다. 이를 전체 오류 0으로 합산하지 않는다.
- [1440px 화면](evidence/news-private-reader-20261105-1440.png) · [390px 화면](evidence/news-private-reader-20261105-390.png): 익명 합성 자료이며 본문·그림·출처와 조작 위치를 직접 시각 검수했다.

재현 명령:

```sh
npm test
npm run check
node scripts/check-markdown-links.cjs
PW_MODULE_PATH="$PWD/tests/browser-ci/node_modules/playwright" CHROMIUM_PATH=/path/to/pinned/chromium node tests/life-personal-discovery-browser.cjs
node tests/run-discovery-private-postgres.cjs
node tests/integrated-release-installation.cjs
SQL_REPLAY_REQUIRED=1 npm run test:sql-replay
```

브라우저·PostgreSQL의 실제 환경 변수와 추가 회귀·변이 명령은 증거 파일 및 PR 보고를 따른다. 새 브라우저 검사는 준비된 배포물의 실제 모듈 바이트·HTML 등록·SHELL 목록부터 검사한다. 모듈 누락으로 기존 링크 대체 경로만 실행되어도 통과하는 검사를 피한다.

남은 한계:

- 실제 Apple 기기·VoiceOver·운영 인증과 출판사 응답은 미검증이다.
- PWA 결과는 같은 CACHE 이름에서 구 HTML·구 SW·신 모듈 조합과 누락 모듈의 복구 검사다. 총괄 캐시 판올림 후 실제 배포판 간 갱신 성공을 뜻하지 않는다.
- `contentHash`의 64자리 16진 형식과 sourceId·URL·캐시 상태 결합을 확인하고 서버 영수증 값을 보존한다. 브라우저에서 PostgreSQL jsonb 직렬화를 재현해 다시 계산한 해시가 아니다.
- 그림의 자료 저장, MIT·LLT 그림, LLT PDF, 추가 출처 본문과 추천 효용 검증은 이번 범위 밖이다.

## 다음 묶음

1. **C 통합·출시 검증:** 이 PR의 독립 검수·CI·총괄 회신이 선행한다. 두 Edge 재배포와 새 캐시의 실제 읽기→자료 보관→기기 간 재열기를 확인하면 완료다. 현재 로컬 검증과 출시 완료를 구분한다.
2. **관심·질문·눈높이별 선별·설명:** 본문 확보 이후의 후보다. PR142의 평가 원칙, A의 AI 연결, D의 수신 범위와 담당을 총괄이 조정한 지시서를 받은 뒤 착수한다. 정확 원문과 AI 설명을 구분하고 직접 피드백으로 유용성을 비교하는 것이 완료 기준이다.

전체 로드맵의 A·B·D·E·F 담당을 이 세션이 재배정하거나 이미 구현된 계정 동기화를 미구현으로 되돌리지 않는다. 로드맵의 통합·출시 상태 갱신은 총괄이 맡는다.
