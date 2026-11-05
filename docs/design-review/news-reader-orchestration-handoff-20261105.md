# 개인 뉴스 읽기 — Claude 총괄 인계

2026-11-05 KST. 소유자의 재개·최신 Git 갱신·Claude 총괄과 소통 지시에 따른 **현황 대조와 인계**다. 기준은 `origin/main`의 `9570f3da4de18c91269ff4a1d3e8149cb36c4a81`이다. 제품 구현·운영 설치·배포를 이번에 실행한 기록이 아니다.

## 결론과 소통 경로

개인 탐구용 본문·이미지 읽기의 원본은 [PR145](https://github.com/wonchance-art/life-haedo/pull/145)에 남아 있다. 현재 main의 뉴스 읽기 칸과 계정 자동 동기화를 보존하면서 필요한 부분을 이식해야 한다. 오래된 브랜치를 그대로 병합하면 과거 화면·저장 계약과 현재 구현이 섞인다.

- Claude가 총괄·통합·독립 검수·운영 변경·출시를 맡고, 이 세션은 작업자로 참여한다.
- [PR145 재개 보고](https://github.com/wonchance-art/life-haedo/pull/145#issuecomment-6647749217)에 완료 범위·현재 차이·후속 배정 요청을 전달했다. 회신 전의 제안이며 총괄 합의로 표시하지 않는다.
- [이슈193 분담 보고](https://github.com/wonchance-art/life-haedo/issues/193#issuecomment-6647758407)로 별도 SNS 전략 Codex 세션과 범위를 구분했다. 그 세션의 `codex/sns-automation-strategy`와 서비스/API 조사 문서를 중복 작성하지 않는다.
- 이번 브랜치: `codex/news-reader-orchestration-handoff-20261105`. 수정 범위는 이 인계서와 기존 로드맵·구조 점검의 원본 소재 정정이다. 앱 코드·운영 DB·계정 데이터·작업 규칙·CI는 수정하지 않는다.

## 기존 산출물과 현재 효력

| 산출물 | 고정 커밋 | 남아 있는 결과 | 현재 처리 |
| --- | --- | --- | --- |
| [PR145 개인 뉴스 읽기](https://github.com/wonchance-art/life-haedo/pull/145) | `0b7f632518782686ea5ad29bf50169126f51e101` | 계정 전용 캐시·출처 어댑터·본문/이미지 읽기·본문 자료 보관·검수 | 프런트엔드 미병합. 최신 main 기준 통합 필요 |
| [PR142 목적·workflow 설계](https://github.com/wonchance-art/life-haedo/pull/142) | `37e4137927aaf498699f98ab5d9924dd168c83c0` | 개인 탐구 목적, 추천 신호·근거·다국어·설명 설계 | 목적과 평가 원칙 재사용. 메뉴·동기화·외부 발행 가정은 최신 계약과 대조 |
| [PR140 실행 인계](https://github.com/wonchance-art/life-haedo/pull/140) | `dc1bef8f65b995fe72d472f0cccbaa83938287d3` | 계정·뉴스·계획 인계, 과거 사진 복구 체크포인트 | 계정 자동 연동과 사진 복구의 후속 main 구현을 먼저 확인. 옛 작업 목록을 신규 미구현으로 복사하지 않음 |

PR145의 [최종 CI](https://github.com/wonchance-art/life-haedo/actions/runs/40854333820)는 **위 고정 커밋의 과거 성공**이다. 당시 정적 검사·단위 1,647개, 합성 브라우저·격리 PostgreSQL·설정된 테스트 계정의 Auth/Edge/DB 검수를 마쳤다. 현재 main과 결합한 성공, 실제 Apple 기기, 추천 효용의 증거는 아니다. [당시 공개 검수 기록](https://github.com/wonchance-art/life-haedo/blob/0b7f632518782686ea5ad29bf50169126f51e101/docs/design-review/evidence/news-private-reader-20261029.json)에 범위와 설치·정리 이력이 있다.

작업트리를 바꾸지 않는 `git merge-tree --write-tree --name-only 9570f3d 0b7f632`로 **16개 파일의 충돌**을 확인했다. 제품 문서, `discovery-ui.js`·`ui.js`, OSS/로드맵, 배포 준비·SW·통합 설치 검사, 브라우저 검사 8개가 해당한다. 자동 병합되는 CSS·HTML도 의미상 호환을 보장하지 않는다. PR140에는 미완료 사진 복구 후보 코드가 포함돼 있지만, 현재 main에는 후속 [정확 판·사진 복구](naver-media-continuity.md)가 구현돼 있으므로 옛 후보를 복원하지 않는다.

## 운영 소스 소재 정정

11-02 점검에서는 `haedo-discovery-private`와 운영 migration의 원본을 찾지 못했다. **11-05 Git 확인에서는 PR145에 존재한다.** `main`에 없다는 사실과 모든 브랜치에 없다는 주장은 구분한다.

| 대상 | PR145의 정확한 경로·기록 |
| --- | --- |
| Edge 원본 | `supabase/functions/haedo-discovery-private/`의 `index.ts`, `handler.mjs`, `article-intake.mjs`, `deno.json`, `deno.lock` |
| 공유 수집 의존성 | 같은 커밋의 `supabase/functions/haedo-naver-blog/collector.mjs`, `harvest-network.mjs`, `extractor.mjs` |
| SQL 원본 | `supabase/migrations/20261029084145_discovery_private_reader.sql` |
| SQL SHA-256 | `30c741bba2ef5b3658c7b17d653828649b0d98d30e2db17d4e12c877b057bd0e` |
| 과거 운영 migration 영수증 | `20261029084926`, 이름 `discovery_private_reader`. 파일 번호 `20261029084145`와 구분 |
| 과거 Edge 설치 | 2026-10-29 `haedo-discovery-private` v1, `verify_jwt=true` |
| 계약·설치 검사 | `docs/design-review/news-internal-reader.md`, `supabase/tests/discovery-private-installation.sql`, `tests/run-discovery-private-postgres.cjs`, `tests/integrated-release-installation.cjs` |

[SQL 원본](https://github.com/wonchance-art/life-haedo/blob/0b7f632518782686ea5ad29bf50169126f51e101/supabase/migrations/20261029084145_discovery_private_reader.sql) · [Edge 원본](https://github.com/wonchance-art/life-haedo/tree/0b7f632518782686ea5ad29bf50169126f51e101/supabase/functions/haedo-discovery-private) · [설치 대응 기록](https://github.com/wonchance-art/life-haedo/blob/0b7f632518782686ea5ad29bf50169126f51e101/docs/design-review/news-internal-reader.md).

이번 작업은 운영 함수를 조회하거나 변경하지 않았다. **현재 운영 정의와 원본의 동일성은 미확인**이다. 총괄이 운영 정의·권한·이력과 원본을 대조하면 된다. 파일 번호 차이만 보고 같은 SQL을 새 migration으로 다시 적용하거나 기존 함수·표를 폐기하지 않는다. 과거 테스트 행·세션 정리는 완료된 기록이므로 다시 실행할 작업으로 넘기지 않는다.

## 최신 main으로 대체된 가정

| 이전 세션의 설명 | `9570f3d`에서 확인한 현재 상태 | 통합 시 보존할 것 |
| --- | --- | --- |
| 뉴스 관심·언어·반응·계획의 서버 연동이 다음 작업 | `account-docs-sync.js`와 `storage.js`에 뉴스 관심·설정·언어·반응·읽기 평가·연간 계획·읽기 위치 연결이 있음 | 기존 범용 계정 문서 사용. 별도 기기 연결 버튼·중복 동기화 엔진을 만들지 않음 |
| 읽기 평가 `discoveryReading`은 로컬 전용 | 11-01 결정으로 계정 자동 연동 대상 | 읽기 전 의향·읽은 뒤 도움·좋아요·담기의 의미와 정확한 평가 대상은 계속 분리 |
| 홈 → 뉴스 → 자료 → 도구 | 현재 뉴스·일정·자료·설정, 로그인 첫 화면 일정 | 최신 메뉴·주소 별칭·고정 글쓰기 위치 유지 |
| 뉴스 앱 안 읽기는 아직 없음 | #179의 목록/읽기 칸, 390px 전체 화면·뒤로 가기·`inert`, 허용 출처 iframe이 있음 | 현재 `discovery-ui.js`의 읽기 칸에 새 본문 경로 연결. 옛 reader 화면 전체로 교체하지 않음 |
| AI 기능 전체가 미구현 | `haedo-ai` 서버와 `writing-ai.js` 클라이언트 모듈이 있음. 로드맵은 운영 설치 완료와 비밀값 미등록을 기록 | 기존 승인 범위를 재사용 검토. **편집기 화면 연결도 아직 남음**. 뉴스 추천·눈높이 설명이 구현됐다고 표시하지 않음 |

근거: [계정 자동 연동](account-sync-everywhere.md), [현재 앱 안 읽기](news-in-app-reading.md), [제품 원칙](../../PRODUCT.md), [AI 제안의 화면 연결·출시 순서](writing-ai-suggestions.md#출시-순서-총괄소유자). AI 모듈 첫 주석에도 화면 미연결 상태가 적혀 있으며, 현재 `index.html`·`life.html`에 이 모듈이 로드되지 않는다. 키 등록만으로 편집기에서 바로 사용할 수 있다고 안내하지 않는다.

## 재사용과 변경 범위

PR145가 실제 지원한 범위는 Frontiers 공식 본문·최대 두 이미지, MIT 기사 본문, LLT RSS 초록이다. LLT PDF, MIT/LLT 그림, 나머지 여섯 출처의 본문, 자료실의 이미지 원본 보관은 지원하지 않았다. 이 범위를 확대 완료로 설명하지 않는다.

| 영역 | 재사용할 것 | 현재 main에 맞춰 확인·변경할 것 |
| --- | --- | --- |
| 서버 캐시·수집 | 계정/세션 분리, claim/finish lease, 용량·횟수·시간 제한, exact content hash, 출처별 어댑터 | 현재 운영본과 원본 대조, 최신 공유 수집 모듈 호환성, 원본/캐시 실패 복구 |
| 키·인증 | 사용자 JWT와 세션 검증, `no-store`, 제한된 요청 `{sourceId,url}` | PR145의 legacy 키 직접 읽기를 현재 `_shared/supabase-keys.mjs`와 `serverHeaders()` 계약에 맞춤. `sb_secret_`를 Bearer로 보내지 않음. 게이트웨이 설정은 총괄이 실제 토큰 왕복 검증 후 결정 |
| 브라우저 클라이언트 | 계정·workspace·세대 보호, 취소·늦은 응답 차단, 정확한 본문 수신 영수증 | 최신 Auth/페이지 수명과 공용 클라이언트 계약 대조. 계정 자동 동기화를 과거 방식으로 되돌리지 않음 |
| 뉴스 읽기 | 본문 범위 표시, 안전한 이미지 decode·Blob URL 정리, 재시도·출처 링크 | 현재 읽기 칸·키보드·390px history·스크롤/초점 복귀에 결합. iframe은 현재 계약과 총괄 결정에 따라 대체 경로 유지 |
| 자료 보관 | 받은 정확한 본문과 출처 정보로 기존 가져오기 연결 | 링크만/초록/본문을 구분. 현 계정 자료 저장을 재사용. 이미지를 보관하지 못하면 본문 보관과 구분 |
| 공개 목록·PWA | 개인 본문·영수증을 공개 artifact/SW에 넣지 않는 검사 | 최신 피드 수집 형식·내용·현재 캐시를 기준으로 이식. 과거 120개 목록이나 v168 캐시를 복원하지 않음. 캐시 번호와 CI 등록은 총괄 담당 |
| 검수 | 과거 실패 재현·소유권/보존·응답/관측 분리 사례 | 최신 소유자 결정에 맞는 테스트 유지. 이전 ‘로컬에만 보관’ 단언을 되살리지 않음 |

현재 `selectedArticle()`는 최신 피드 행을 우선하므로, 개인 본문 응답은 별도의 정확한 읽기 snapshot으로 유지해야 한다. PR145의 임시 reader history를 복사하지 않고 현재 `newsReaderHistory`/`state.newsArticle`를 쓴다. 현재 체크인 피드는 7출처·90편·103,470바이트이고 본문/요약/이미지는 모두 없다. 이는 예약 갱신 artifact나 현재 라이브 공급량을 조회한 수치가 아니다. PR145의 과거 9출처·120편을 현재 공급 결과로 덮어쓰지 않는다.

이식은 파일별 검토로 한다. `ui.js`·`discovery-ui.js`·`storage.js`·공유 Naver collector·설치 검사 전체를 옛 파일로 덮지 않는다. `AGENTS.md`·`CLAUDE.md`·`.agents/`·`.github/workflows`는 작업자 변경 범위에서 제외한다. 소스 복구와 배포본 검증이 끝나기 전까지 #145를 현재 main에서 사용할 수 있다고 표시하지 않는다.

## 총괄에게 넘기는 작업 묶음 제안

아래는 이 세션의 다음 후보이며 프로젝트 전체 우선순위를 바꾸는 결정이 아니다. 최신 [전체 로드맵](../life-tools-design/roadmap.md)의 D1·D2·AI 작업과 파일 담당을 총괄이 조정한다.

1. **현재 뉴스 화면에서 개인 본문 읽기 완주**
   - 이유: 원본 소스가 있으나 main과 단절돼 있고, 현재 iframe은 출처별 제한이 있다.
   - 선행: 총괄의 구현 배정·현재 iframe 결정 확인, 기존 운영본과 PR145 원본 대조, 최신 main 기준 파일 담당 확정.
   - 범위: 원본 소재 정리 → 새 키/공유 모듈 호환 → 현재 읽기 칸 본문·그림 → 정확한 본문 자료 보관 → 기존 계정 설정·반응 유지 → 통합 검수·총괄 출시 판단. 서버 복구와 화면 연결을 별개의 사용자 요청으로 잘게 나누지 않는다.
   - 완료: 지원 출처별 실제 확보 범위가 보이고, 계정 전환·철회·늦은 응답·빈 본문·원문 실패·반복 보관·두 기기·390px 복귀·PWA 혼합 판을 검증한다. 공개 목록/정적 캐시에 개인 본문·영수증 0. 운영 정의 대조와 배포 확인은 총괄 증거로 따로 기록한다.
2. **관심·질문·눈높이별 자료 선별과 설명**
   - 이유: 본문을 읽을 수 있는 것과 나에게 유용한 추천을 하는 것은 다르다.
   - 선행: 1번 안정화, 기존 PR142의 신호·평가 설계를 최신 계정 계약에 맞춤, 기존 AI 화면/비용/외부 전송 범위와 담당 조정.
   - 완료: 복수 원문 언어·번역 언어·직접 고른 질문/설명 수준을 구분하고, 정확한 원문 근거와 AI 설명을 분리한다. 직접 피드백으로 다음 선별을 비교하며 클릭·담기·무응답으로 실력·도움·신념을 추정하지 않는다.

[#193 SNS 자동 연결 전략](https://github.com/wonchance-art/life-haedo/issues/193)은 별도 담당자가 수신 경로·비용·토큰·운영 설계를 맡는다. 이 세션은 원문 수신 이후의 개인 읽기·추천 계약을 제공한다. 외부 SNS 게시·수정·삭제는 현 제품 범위에 추가하지 않는다.

## 이번 검수와 남은 확인

- 최신 원격 ref와 PR 상태, 고정 커밋의 원본 경로·SQL 해시·과거 검수 영수증, 현재 계정 자동 동기화·읽기 칸·AI 화면 미연결을 읽기 전용으로 대조했다.
- 두 독립 작업자가 읽기 통합과 과거 계정/workflow 인계의 유효성을 각각 확인했다. 문서 링크·diff 검사는 이 브랜치의 PR에 결과를 기록한다.
- 제품 코드 변경이 없으므로 과거 전체 브라우저·DB 검사를 반복해 현재 통합 성공으로 보고하지 않는다. 운영 조회/쓰기·실제 계정 연결·외부 SNS 연결·병합·배포는 이번 작업에서 실행하지 않았다.
- 총괄의 회신·담당 배정, 현재 운영본 동일성, 재통합 검수, 실제 Apple 기기와 추천 효용은 남아 있다.
