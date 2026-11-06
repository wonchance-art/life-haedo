# RSS 자동 반영 인계 — 2026-11-06 C 완주로 병합, 운영 활성화 전 후속 3건

> **현재 상태 (2026-11-06, 총괄):** 아래 보류 기록은 E의 11-05 인계 당시 상태다. C가 BLOCKER 2·MAJOR 2·MINOR를 고쳤고(head `b6aea87`, [완료 보고](https://github.com/wonchance-art/life-haedo/pull/227)), 총괄 독립 재검수 BLOCKER 0·MAJOR 0으로 병합했다. 운영 RSS는 아직 비활성(허용 피드 0)이다.
> **운영 활성화 전에 고칠 후속(MINOR):**
> 1. 연결이 살아 있고 화면이 보이는 동안 커서 앞 lease 구간(마지막 수집분 본문)을 매분 다시 받는다. 커서가 lease보다 오래되면 겹침을 한 번 읽은 뒤 정확한 커서만 쓰도록 바꾼다(`rss-connection.js` overlapCursor/reflectInbox).
> 2. '연결 없음'·'runtime 꺼짐'으로 멈춘 반영이 page-ready·bfcache 복귀로 다시 확인하지 않아, 다른 기기에서 연결을 등록하면 열린 탭은 새로 열 때까지 반영하지 않는다(createReflection ready/wake).
> 3. 응답 단위의 형식 오류(예: 프록시의 HTML 200)도 `rss_invalid_data`로 영구 정지된다. 항목 단위가 아닌 응답 단위 오류는 일시 오류로 분류한다.
> 참고: 매분 경로의 bundle 전체 읽기는 1,000건 warm 약 106ms, 18,000건 약 1.85초(측정, 허용 범위).


2026-11-05 UTC. [초안 PR #227](https://github.com/wonchance-art/life-haedo/pull/227), 브랜치 `codex/rss-inbox-reflection`.
제품 구현 커밋은 `5719b92cdab943d9a2d925f57ae9bb073cf6f741`, 기준 main은 `5fcaa3f80947fa78352a9d8e1724de557141b4e8`이다.
이후 인계 커밋은 진행 중이던 검사 갱신과 이 문서만 보존한다. 제품 결함은 해결하지 않았다.

[총괄 독립 검수 및 중단 지시](https://github.com/wonchance-art/life-haedo/pull/227#issuecomment-6659882507),
[인계 범위 확정](https://github.com/wonchance-art/life-haedo/pull/212#issuecomment-6659896387)에 따라 추가 구현을 중단했다.
**로컬 일부 검사 통과는 병합 가능 판정이 아니다.** 최종 제품 수정·독립 재검수·새 head CI가 필요하다.

## 보존한 구현

- 설정 화면을 열지 않아도 최초 유휴 시간과 주기에 기존 RSS 수신함을 자료에 반영한다. 피드 수집을 자동 실행하지 않는다.
- 계정·workspace별 기기 ACK, 연속 성공 구간, 정확 원문 증거, 복원 시 무효화, 수동 더보기의 ACK 선행 방지를 구현했다.
- 연결 없음·runtime 비활성·미배포 함수의 반복 조회 중단, 계정/페이지 경계 처리를 추가했다.
- `storage.js`는 새 ACK helper와 export만 추가했다. `ui.js`의 C 연결, C2 복구 코드, CACHE, workflow, 운영 DB/Edge/Cron은 변경하지 않았다.
- 실제 RSS 원천 요청은 0건이다. 검증은 합성 계정·모의 HTTP와 실제 SDK·IndexedDB를 사용했다.

## 남은 결함 — 총괄 독립 검수

| 등급 | 항목 | 현재 상태와 다음 확인 |
| --- | --- | --- |
| BLOCKER | 기존 CI 실패 | 시작 RSS list를 원격 쓰기/금지 요청으로 세는 검사를 아래 표처럼 일부 갱신했다. 미수정·미검증 검사가 남아 있다. |
| BLOCKER | C2 재확인·복구 회귀 | RSS의 `auth.verify()`가 늦게 성공하며 공용 `notify()`를 보내 오류 뒤 자동 재마운트를 유발한다. RSS 작업의 사후 guard만으로 이 알림을 취소하지 못한다. 제품 미수정. |
| MAJOR | 동시 finish의 영구 누락 | `fetched_at`은 finish 시작 시각이고 행 가시성은 커밋 시각이다. 같은 workspace의 늦게 시작한 Y가 먼저 커밋되어 ACK가 전진하면 먼저 시작한 X를 영구히 건너뛸 수 있다. lease 이상 겹치는 재조회와 receipt 중복 제거 또는 서버 안전 구간 이전만 ACK하는 방식을 검토해야 한다. |
| MAJOR | ACK 증거 확인 비용 | 매 주기·매 페이지마다 누적 본문 전체를 해시하고 receipts 전체를 다시 쓴다. 초기 수신은 O(n²), 독립 검수의 14KB×18,000건에서는 약 2.9초였다. 번들 revision별 검증 재사용과 receipts 압축이 필요하다. 복원 무효화·정확 본문 검증을 유지해야 한다. |
| MINOR | disconnected 연결의 polling | 연결이 모두 disconnected여도 60초 polling을 계속한다. 최초 보관물 반영 뒤 정지 조건이 필요하다. |
| MINOR | 재시도 지연·막힌 항목 안내 | 일시 오류 후 실제 재시도가 약 두 주기 늦고, 영구 거부 항목이 뒤 항목을 막아도 화면 안내가 없다. |
| MINOR | 항목별 Auth 호출 | 항목 커밋마다 `/auth/v1/user`를 호출한다. C2 회귀 및 검증 단위 설계와 함께 처리한다. |
| MINOR | 신규 브라우저 CI 등록 | `rss-inbox-reflection-browser.cjs` 등록은 총괄 담당이다. 작업자는 workflow를 변경하지 않았다. |

총괄이 인정한 통과 범위는 ACK 연속 구간 증명·복원 무효화·계정 격리·더보기 비선행·오프라인 무요청·storage 추가만 함·새 전송 데이터 없음이다. 위 누락 및 성능 문제를 해결했다는 뜻은 아니다.

## 인증 보완의 다음 출발점

자동 반영에 한해 `getSession → getUser(명시적 현재 access token) → getSession`으로 서버 계정을 검증하고 각 await 전후 epoch/owner/token/현재 작업을 대조하는 방향을 제안했다. 기존 수동 설정 action의 `auth.verify()`는 유지한다. 공용 Auth `notify()`를 직접 호출하지 않아 늦은 성공이 셸 복구를 시작하지 않도록 한다.

이 방향은 총괄이 타당하다고 확인했지만 **이번 실행은 승인하지 않았다. 코드·패치는 작성하지 않았다.** 동봉 SDK의 `getUser`는 세션 없음 오류 때 SIGNED_OUT을 발생시킬 수 있고 `getSession`은 토큰 갱신을 할 수 있다. 따라서 직접 notify를 피하는 것과 모든 SDK 부작용을 제거하는 것을 혼동하면 안 된다. 늦은 성공·실패·dispose·계정 변경·토큰 교체를 별도로 검증해야 한다.

셸 원본 로컬 검사는 16/18 통과했다. 인공 auth-unavailable 뒤 재시도 버튼 관측과 immutable_source_version gate에서 실패했다. `scheduleRssReflection` 호출만 제외한 격리 대조에서 두 사례가 통과했다. CI는 online 복구 실패도 보고했다. 제품 보완 전에 fixture 대기만 추가해 문제를 숨기지 않는다.

## 기존 검사 갱신 진행 상태

공통 `isRssInboxRead`는 정확한 POST/cloud origin/path, Bearer와 fixture의 알려진 계정, 정확히 `action`·`workspaceId` 두 키, `action=list`, UUID 및 알려진 workspace 일치를 확인한다. `before`·다른 키·poll/register·외부 origin·인증 없음·GET·경로 변형은 거부한다. 기존 URL 허용목록은 변경하지 않는다.

분류된 요청은 별도 ledger에 기록하고 HTTP 요청과 독립적인 `haedo:page-ready`로 실제 시작 횟수를 계측한다. 기존 쓰기·공개·삭제·본문 보존 단언은 유지한다. 승인: #212 댓글 6659584124, 6659627869, 6659647558, 6659771233.

| 검사 | 원본 재현 | 인계 시 상태 |
| --- | --- | --- |
| purpose-workflow | 8/8 행동 통과 후 RSS 11건 금지 요청 오분류 | 수정 후 8/8, 시작 11/조회 11, 오류 0·SHA 보존 통과 |
| nine-board-image | 최종 원격 쓰기에 RSS만 남음 | 수정 후 통과, 시작 5/조회 5, 오류 0 |
| nine-board-compose | 원격 쓰기에 RSS만 남음 | 수정 후 8/8, 각 시나리오 시작/조회 일치 |
| home-refinement | 10/10 행동·오류 0, RSS 19건 때문에 exit 1 | 수정 후 10/10, 원격 쓰기 0·오류 0 |
| blog-series | 모든 행동 후 최종 원격 쓰기에 RSS만 남음 | 수정 후 전체 통과, 원격 쓰기·오류 0 |
| life-sync | 첫 boot 감사에 RSS 2건이 남아 setup 중단, 0/14 연쇄 실패 | 감사 변경 작성·구문 검사만 완료. **브라우저 미실행.** 초기 두 기기 각각 시작 1/조회 1 명시 단언 추가 |
| life-rediscovery | 9/10, 첫 ledger 감사에서 RSS 2건 실패 | 감사 변경 작성·구문 검사만 완료. **브라우저 미실행.** 기존 account-materials-list 계수는 해당 종류만 셈 |
| life-annual-plan | 행동 10/10·오류 0, RSS 28건 오분류 | 원본 재현만, 미수정 |
| obsidian-markdown | 행동 4/4·오류 0, RSS 7건 오분류 | 원본 재현만, 미수정 |
| source-folders | 행동 4/4·오류 0, RSS 19건 오분류 | 원본 재현 완료, 미수정 |
| account-library | 행동 5/5·오류 0, RSS 16건 오분류 | 원본 재현 완료, 미수정 |

source-folders와 account-library는 총괄 중단 댓글의 현황보다 나중에 로컬 재현이 완료됐다. 두 파일 모두 아직 수정하지 않았다.

공통 분류 단위 검사 3/3 및 모든 요청을 허용하는 변이의 3/3 실패를 확인했다. 최초 helper·정책 검사·purpose·nine 두 파일의 독립 검수는 blocker/major 0이었다. 이후 home/blog/life-sync/rediscovery 변경은 이 독립 검수 범위에 포함되지 않으며, 제품 전체의 blocker/major가 없다는 판정도 아니다.

## 검증 근거와 재개 순서

원본 CI: [run 42037495450](https://github.com/wonchance-art/life-haedo/actions/runs/42037495450), 제품 head `5719b92`. CI 실패 원본은 이 실행에서 확인할 수 있다.
로컬 원본·수정·변이 로그는 `.local/rss-reflection/`, `.local/rss-inbox-progress/`, `.local/rss-inbox-reflection/`에 있으며 gitignore 대상이므로 브랜치에 포함되지 않는다.

제품 head에서 단위 2,217/2,217, 신규 RSS 브라우저 11/11, 기존 RSS 21/21, E 화면 6/6, 시작 성능 5/5를 통과했다. 분류 단위 검사 추가 후 전체 Node 2,220/2,220을 통과했다. 이는 나중에 발견된 전체 CI/제품 결함의 반증이 아니다. 최종 인계 head의 검사 상태는 PR 보고에 남긴다. 실제 피드 운영·Apple 기기·Google 제공자 로그인은 미검증이다.

1. **제품 정확성:** C2 알림 경계와 동시 finish 커서 누락부터 고친다. 기존 C2 원본 검사, 늦은 성공/실패·계정 변경, 역순 커밋 후 두 항목 모두 정확히 한 번 보관되는 반례가 통과해야 한다.
2. **비용·재시도:** revision별 검증 재사용과 receipts 구조, disconnected 정지 및 실패 안내를 설계한다. 큰 보관량에서도 증분 반영 비용을 측정하고 복원·본문 손상·중복·누락 변이를 유지한다.
3. **검사 마무리·통합:** 위 미검증·미수정 fixture와 신규 브라우저 CI 등록을 완료한다. 최신 main 병합, 독립 재검수, 최종 head CI 녹색 이후 총괄이 병합·운영 순서를 결정한다.
