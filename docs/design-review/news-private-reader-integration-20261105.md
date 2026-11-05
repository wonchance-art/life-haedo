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

### 다시 보관할 때의 판 구분

자료에는 선택한 수집본의 원문을 그대로 앞에 두고 출처·수집 시각 등을 부록으로 붙인 텍스트와 작성자·발행일 같은 출처 메타데이터를 보관한다. 서버의 `privateReceipt.contentHash`·`cached`·`stale` 전체를 자료에 저장하는 것은 아니다.

기존 URL의 자료에서 `같은 자료로 확인 · 버전 비교`를 선택하고 보관 텍스트와 출처 메타데이터가 같으면 기존 판을 재사용한다. 새 수집 시각 등으로 부록이나 보관 정보가 달라지면 **본문이 같아도 새 판으로 남기며 이전 판을 덮지 않는다.** 이는 선택한 수집본의 출처·시각도 보관하는 현재 계약으로 유지한다. 같은 서버 영수증이라는 이유만으로 항상 중복이 없는 것은 아니며, 발행일 같은 입력 메타데이터가 바뀐 경우도 판 비교에 반영된다.

목록 갱신이나 글 선택만으로 자료에 새 판을 만들지는 않는다. 사용자가 자료 보관을 확정할 때 적용되며, `별개 자료로 보관`을 고른 경우는 별도 자료를 만드는 기존 선택을 따른다.

## 구현과 보존 경계

- `discovery-private-remote.js`: 인증한 소유자·workspace·세대 확인, 취소·늦은 응답 차단, 제한된 요청 `{sourceId,url}`, 수신 본문·출처·범위·이미지 검증. 공개 피드 검증기는 바꾸지 않았다.
- `discovery-reader-ui.js`: 본문·그림만 표시한다. 이동·history·toolbar는 현재 `discovery-ui.js`가 계속 맡는다.
- `ui.js`: 클라이언트 생성·주입·dispose와 정확 본문 가져오기 분기에 한정해 9줄 추가·2줄 제거. `storage.js`와 계정 동기화 모듈은 변경하지 않았다.
- 두 HTML·배포 파일 목록·SW SHELL에 새 모듈 2개를 등록했다. 초기 작업자 검수 당시 `sw.js` CACHE는 `haedo-v194` 그대로였다. 개인 본문·영수증·Edge·SQL을 공개 배포물이나 SW 캐시에 넣지 않는다.
- Edge는 기존 `_shared/supabase-keys.mjs`와 `serverHeaders()`를 사용한다. 사용자 JWT로 Auth·claim을 수행하고, finish에 쓰는 새 secret 키는 `apikey`로만 보낸다. 이번 운영 계약은 **`verify_jwt=true` 유지**다. 게이트웨이 검사와 handler의 Auth 사용자 검증·RPC의 살아 있는 세션 검증을 구분하며, 로컬 handler 검사만으로 운영 게이트웨이 왕복을 입증하지 않는다.
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

[최종 총괄 결정](https://github.com/wonchance-art/life-haedo/pull/214#issuecomment-6650834839)에 따른 초기 통합의 운영 적용 대상은 새 키 계약을 반영한 **`haedo-discovery-private`만이며 `verify_jwt=true`를 유지**한다. `haedo-naver-blog`는 기본 UA 동작이 같고 총괄의 robots 차분 24,000건에서 차이 0건이 확인되어 이번 재배포 대상에서 제외한다. 이 차분 수치는 총괄 증거이며 작업자가 다시 실행한 결과가 아니다. 기존의 ‘두 Edge 재배포’ 안내는 이 결정으로 대체한다.

운영 재배포·실제 인증 왕복·허용 출처 수신·배포판 간 PWA 갱신 확인은 총괄 담당이다. 이번 후속 작업은 검사·문서만 고치므로 그 자체로 Edge 재배포가 필요하지 않으며, 초기 통합의 운영 재배포를 실행하거나 완료를 확인한 기록도 아니다. 저장소 `index.ts`의 `verify_jwt=true` 주석을 운영 설정 적용의 증거로 쓰지 않는다.

향후 `verify_jwt=false`로 변경할 경우에는 `haedo-ai`처럼 **요청 본문을 읽기 전에 JWT 형식이 아닌 Bearer 값을 거절하는 단계와 회귀 검사**를 함께 추가한다. API 키나 잘못된 형식이 본문 읽기 전에 거절되는지, JWT 모양의 무효·위조 토큰은 Auth에서 거절되는지 확인한다. 형식 검사는 인증을 대신하지 않으며 Auth 사용자·익명 계정 거절과 RPC의 살아 있는 세션 검증을 유지한다. 이 변경은 현재 구현 범위가 아니다. [공식 Edge 인증 가이드](https://supabase.com/docs/guides/functions/auth)와 [헤더 설명](https://supabase.com/docs/guides/functions/auth-headers)을 2026-11-05에 확인했으며, 새 API 키를 사용한다는 이유만으로 `false`가 필수라고 해석하지 않는다.

## 초기 통합 검증 기록

검사 결과·변이·파일 해시는 [검증 증거](evidence/news-private-reader-integration-20261105.json)에 기록한다. 구현자와 별도 에이전트가 데이터 손실·개인정보·정확 판·기존 흐름·단언 약화를 검수했다. 모든 브라우저 계정·출처 응답은 합성 fixture이며 실제 계정 쓰기·운영 DB·외부 출판사 수집을 하지 않았다.

- 단위 2,022/2,022, 새 개인 읽기 브라우저 13/13, 기존 회귀 96/96, 후속 구조 기준 6/6(합계 115), SQL 전용 12/12·통합 설치 13/13·전체 재생 11/11. 정적·링크 검사 통과.
- 인증·출처·이미지 제한·취소·본문 범위·계정/세션/lease·화면 재개·누르는 중인 버튼·모듈 등록을 바꾼 변이 19개가 모두 해당 검사에서 실패했다.
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

### CI 후속 보완

첫 head `2ad2347`의 [CI](https://github.com/wonchance-art/life-haedo/actions/runs/41974011580)는 구조 기준의 고정 전역 목록에서 실패했다. 새 `DiscoveryPrivateRemote`·`DiscoveryReaderUI` 이름을 목록에 추가하지 않은 누락이다. 같은 원본 검사로 기준 `2eebd27`은 6/6 통과하고 현재 head는 정확히 두 이름 차이로 실패함을 별도 Git archive·합성 브라우저에서 재현했다.

[총괄 승인](https://github.com/wonchance-art/life-haedo/pull/212#issuecomment-6650747441)에 따라 `tests/structure-baseline-browser.cjs`에 두 이름만 정렬 위치로 추가했다. 다른 바이트와 3개 장면·strict 비교·전역 17개·페이지 오류 단언은 그대로다. 수정 후 6/6 통과하고 각 새 모듈 하나를 빠뜨린 변이는 각각 해당 이름 누락으로 실패했다. 독립 재검수도 통과했다. 첫 CI의 나머지 검사·블로그·브라우저 2–5 그룹은 성공했으며, 수정 head CI의 성공과 구분한다.

남은 한계:

- 실제 Apple 기기·VoiceOver·운영 인증과 출판사 응답은 미검증이다.
- 초기 작업자 검수의 PWA 결과는 같은 CACHE 이름에서 구 HTML·구 SW·신 모듈 조합과 누락 모듈의 복구 검사다. 총괄 캐시 판올림 후 실제 배포판 간 갱신 성공을 뜻하지 않는다.
- `contentHash`의 64자리 16진 형식과 sourceId·URL·캐시 상태 결합을 확인하고 서버 영수증 값을 보존한다. 브라우저에서 PostgreSQL jsonb 직렬화를 재현해 다시 계산한 해시가 아니다.
- 그림의 자료 저장, MIT·LLT 그림, LLT PDF, 추가 출처 본문과 추천 효용 검증은 이번 범위 밖이다.

## 병합 후 검사·문서 보완

#214 병합 후 main `321e00b6d05ea9fcf806cc00fa4005d9395bfeeb`에서 `codex/news-private-reader-followup`으로 시작했다. [후속 지시](https://github.com/wonchance-art/life-haedo/pull/214#issuecomment-6650844258)의 MINOR-2·3·4와 N1·N2만 다룬다. 제품·저장 형식·SQL·운영 설정은 변경하지 않았다. [이번 증거](evidence/news-private-reader-followup-20261105.json)는 위 초기 통합 결과와 별도로 기록한다.

- **MINOR-4:** 실제 뉴스 UI의 기존 `privateReader` 주입 지점으로 취소를 무시하는 지연 응답을 제공한다. 같은 글에서 설정 왕복→재시도 B 완료→이전 A 완료 순서를 만들고, 선택 객체·작업공간 동일성, 취소 신호 전달, 화면과 실제 자료 가져오기 콜백의 B 본문·영수증을 확인한다. 화면만 보면 놓치는 보관 대상 오염도 검사한다.
- **N1:** 공용 키 매트릭스에 private handler를 추가했다. 새 키·기존 키·둘 다 있는 세 환경에서 Auth와 claim은 사용자 JWT, finish만 서버 자격을 쓰는지 검증한다.
- **MINOR-2·3:** 위 운영 절에 `verify_jwt=true` 유지, 향후 false 전환의 선행 검사, 개인 읽기 Edge만 초기 재배포 대상이라는 결정을 반영했다.
- **N2:** 위 판 구분 절에 수집 시각을 포함한 보관 정보가 달라지면 새 판으로 남기는 기존 계약을 명시했다. 본문만으로 판을 합치는 변경은 하지 않는다.

독립 브라우저 검사는 기준 13/13, 변경 후 14/14 통과했다. 콘솔·페이지 오류와 미허용 외부 요청은 0이며, 390·1440px 화면과 두 기기·정확 원문·PWA 회귀를 포함한다. 이번 PWA 검사는 로컬 준비 사이트에서 현재 main의 `haedo-v197`을 설치하며, 실제 운영 갱신을 검증한 것은 아니다.

이번 전체 단위 검사는 2,077/2,077, 키·private handler 대상 검사는 29/29 통과했다. 정적 검사와 Markdown 링크 검사도 통과했다(기존 허용 누락 3건, 신규 누락 0). 새 worktree의 첫 단위 실행은 추출기 fixture 의존성 미설치로 3개 파일을 읽지 못했다. 고정 lockfile의 `npm ci --prefix tests/fixtures/naver-extractor` 후 같은 전체 명령을 다시 실행했으며, 최초 실패 로그도 증거에 남겼다.

변이 9종을 검출했다. UI의 `live()=true`와 요청 epoch·aborted 조건 제거는 실제 보관 콜백이 이전 A 본문으로 오염되어 실패한다. `abort()`만 제거한 변이는 취소 신호 전달 단언에서 별도로 실패하며, 이것을 epoch 방어 실패라고 해석하지 않는다. UI 3종은 독립 QA가 다시 확인했다. 키 경로 6종은 기존 공용 검사 11개로는 통과하지만 새 검사 추가 후 각각 11개 통과·1개 실패한다.

## 다음 묶음

1. **C 운영 확인과 후속 검수:** #214는 `e3b5285`로 main에 병합됐다. 후속 검사·문서 보강은 총괄 지시에 따라 병합된 main에서 별도 PR로 진행한다. 초기 통합의 `haedo-discovery-private` 운영 적용과 실제 읽기→자료 보관→기기 간 재열기 확인은 총괄 담당이며, 로컬 검증과 운영 확인을 구분한다.
2. **관심·질문·눈높이별 선별·설명:** 본문 확보 이후의 후보다. PR142의 평가 원칙, A의 AI 연결, D의 수신 범위와 담당을 총괄이 조정한 지시서를 받은 뒤 착수한다. 정확 원문과 AI 설명을 구분하고 직접 피드백으로 유용성을 비교하는 것이 완료 기준이다.

전체 로드맵의 A·B·D·E·F 담당을 이 세션이 재배정하거나 이미 구현된 계정 동기화를 미구현으로 되돌리지 않는다. 로드맵의 통합·출시 상태 갱신은 총괄이 맡는다.
