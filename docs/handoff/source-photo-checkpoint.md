# 정확 원문 판·사진 복구: 미완료 구현 인계

상태 확인일: **2026-10-29 KST**. 이 문서와 [기계 판독 요약](evidence/source-photo-checkpoint.json)은 기존 로그를 읽어 만든 인계 자료다. 이번 인계에서 기능·브라우저 검사는 재실행하지 않았고, 현재 runner/helper의 구문과 문서·해시는 별도 점검했다. 공개 배포 기준은 PR139의 `ab6aef594a2d6d0cabbaf89864e7994ce22a6fec`이며, 사진 복구는 **핵심 신규 흐름이 검증되지 않은 미출시 후보**다. 인계 커밋·브랜치·PR의 확정 정보는 인계 진입 문서를 따른다.

제품·검사 후보는 checkpoint 커밋 `7aa3cd39f3873b6b33a501445e1db20d69f12e5a`로 보존됐다. 이 커밋에는 실패 후 변경된 현재 runner가 포함되므로 아래 실패 실행의 runner 해시와 구분한다. 문서 인계는 그 다음 커밋에서 추가된다.

## 먼저 알아야 할 상태

| 구분 | 보존한 사실 | 확대해서 해석하면 안 되는 것 |
| --- | --- | --- |
| 구현 | 원문 판의 불변 capture 참조, 계정 전달, 정확 owner/hash 조회, 사진만 원자 설치, 기존 사본의 명시 연결 보관, 사진 영역만 갱신하는 UI가 있음 | 전체 신규 사용자 여정 완료 |
| 제품 고정 | freeze1의 제품 224개 해시와 인계 시 파일이 모두 일치 | 검사 도구까지 동일하다는 뜻은 아님 |
| 기반 검사 | 전체 단위 1,569/1,569, 정적 22 HTML·173 JS·726 참조 통과 | 실제 계정·사진 복구의 종단 간 성공 |
| 기존 브라우저 회귀 | PWA 9, 시작 보존 5, 기존 네이버 수집 5, 기존 원문 사진 상태 검사 통과 | 새 사진 sidecar 복구 6개 흐름 통과 |
| 신규 핵심 검사 | 첫 흐름의 독립 B 기기 계정 반영 확인에서 20초 대기 실패 | 제품 결함 또는 검사 문제 중 어느 하나로 원인 확정 |
| 이후 상태 | runner를 수정한 흔적은 있으나 후속 성공 보고서는 없음 | 수정으로 해결됐다는 주장 |

개별 집중 검사와 전체 단위 검사의 숫자는 중첩하므로 합산하지 않는다. 모든 브라우저 결과는 실제 앱·동봉 SDK·IndexedDB와 **합성 계정 HTTP**를 사용한다. 실제 사용자 로그인·운영 자료·Apple 기기·실제 네이버 수집 완주를 확인한 결과가 아니다.

## 신규 검사에서 보존한 최초 실패

- 시작: `2026-10-27T04:26:23.830Z`.
- Chromium: `151.0.7922.173`.
- 예정 6개 그룹 중 첫 그룹 1개 실행·실패, 나머지 5개는 실행하지 않음.
- 실패 그룹: `same source/version arrives on B and explicit recovery preserves raw reader and exact quotation`.
- 위치: `peer → device → acknowledged`의 계정 원문/구성/메타데이터 반영 확인. 새 사진 복구를 완주하기 전이다.
- 콘솔·페이지·정적 응답 오류·예상 밖 외부 요청 0, 제품과 fixture는 **그 실행 도중** 불변, 브라우저 종료 확인. 이것만으로 계정 반영 성공을 판정할 수 없다.

원본 오류에서 절대 저장소 경로만 `<repo>`로 치환했다.

```text
Error: actual account source/composition/metadata acknowledgement did not arrive within 20000ms
    at waitValue (<repo>/tests/source-photo-recovery-browser.cjs:43:9)
    at async acknowledged (<repo>/tests/source-photo-recovery-browser.cjs:51:3)
    at async device (<repo>/tests/source-photo-recovery-browser.cjs:167:7)
    at async peer (<repo>/tests/source-photo-recovery-browser.cjs:190:17)
    at async <repo>/tests/source-photo-recovery-browser.cjs:226:38
    at async check (<repo>/tests/source-photo-recovery-browser.cjs:211:51)
    at async main (<repo>/tests/source-photo-recovery-browser.cjs:225:5)
```

첫 보고서에는 마지막 account state의 전체 진단값이 없다. 키 순서 비교 때문이라는 설명은 아직 가설이다. 현재 runner는 `node:util.isDeepStrictEqual`로 원격/로컬 bundle을 비교하고 timeout에 마지막 account state를 덧붙인다. **현재 runner의 성공 여부는 미확인**이다.

| 파일 | 실패 실행 때 SHA-256 | 인계 시 SHA-256 |
| --- | --- | --- |
| `tests/source-photo-recovery-browser.cjs` | `00a25f948b0d0cdd0994e78970ca441c57624d1dc80f39403c200e5323285bee` | `1cc998835d4bfcddd540f5129e3f4719c30b36033f82b34b93718d133ccf1e6c` |
| `tests/helpers/source-photo-cloud.cjs` | `932c26f8e8b00790e53fb5019c008137ae76b66cc211cf2a2a56359e3d7a13b1` | 동일 |

실패 당시 runner 원본 전체는 이 인계 팩에 포함되지 않는다. 위 해시와 오류를 보존하며, 아래 명령은 **인계한 현재 runner**를 실행한다. 과거 실패를 바이트까지 똑같이 재실행한다고 표현하지 않는다. 나머지 fixture 해시와 제품 해시는 JSON에 함께 있다.

## 다음 실행자가 가장 먼저 할 일

1. 현재 main과 인계 HEAD를 대조한다. 새로 병합된 관련 기능·worker 버전·테스트 fixture가 있으면 먼저 보존 관계를 정리한다. baseline과 candidate를 혼동하지 않는다.
2. 첫 신규 흐름을 새 출력 경로에서 실행한다. 실패한다면 제한시간을 늘리기 전에 `accountLibrary.getState`, 각 domain 상태, `storage.getSyncState`, 원격 row와 로컬 bundle의 실제 차이를 **익명 fixture 범위에서** 기록한다. `synced`가 아닌 영역, 첫 불일치 경로, 요청·ACK의 순서를 확인한다. 토큰·헤더·실계정 설정은 로그에 넣지 않는다.
3. 제품 상태 전이 문제와 검사 관측 문제를 분리한다. JSON 키 순서만의 문제라고 주장하려면 의미가 같은 두 객체를 근거로 남긴다. 상태 일부 도착을 전체 반영 완료로 처리하거나 predicate를 느슨하게 바꾸지 않는다.
4. 원인이 확인된 경계만 수정하고 최초 실패·수정 이유·전후 해시를 보존한다. 보이는 UI·실제 SDK·네이티브 IDB 경로와 원래 원문/사진/인용 단언을 유지한다.
5. 원인이 해결되면 신규 6개 그룹을 모두 검수하고, 변경 영향에 맞는 기존 회귀·PWA·정확 PR/main CI·배포 산출물 확인으로 이어간다. 첫 그룹 통과만으로 출시하지 않는다.

현재 선언된 6개 그룹은 다음과 같다.

1. 독립 B에 동일 source/version 도착 → 사진 가져오기 → 원문 DOM·구절·정확 인용 보존.
2. 같은 본문·다른 사진 판, 서버 누락·잘못된 행에서 옛 사진 판을 임의 치환하지 않음.
3. 다운로드 오류·사진 해시 손상·실제 IDB abort의 부분 설치 0, 재시도·중복 조작 보존.
4. 화면·공간·계정 전환 뒤 늦은 사진 응답의 쓰기 0, 다른 owner 거절.
5. 이미 검증한 사진의 오프라인 읽기·전용 ZIP → 새 독립 localOnly 공간 복원.
6. 기존 원격 sidecar는 명시적인 연결 보관 후에만 B에서 복구, 과거 본문만 있는 자료는 추정하지 않음.

동시 설치의 현재 계약은 두 번째 최종 트랜잭션이 사전 검증한 사진 상태와 다르면 쓰기 없이 거절하고, 재시도 때 실제 저장된 바이트를 검증하는 것이다. 동일 해시의 동시 요청을 무조건 성공으로 취급하도록 검사 단언을 바꾸지 않는다.

## 새 세션에서의 실행 준비

저장소 루트에서 Node 22 이상·Python 3·실행 가능한 Chromium을 준비한다. 원형 CI는 `tests/browser-ci/package-lock.json`의 Playwright 1.63.0을 고정한다. 다른 머신의 `/opt/codex/...`나 `/usr/bin/chromium`이 존재한다고 가정하지 않는다.

```bash
npm ci --prefix tests/browser-ci --ignore-scripts
node tests/browser-ci/node_modules/playwright/cli.js install chromium
export PW_MODULE_PATH="$PWD/tests/browser-ci/node_modules/playwright"
export CHROMIUM_PATH="$(node -e 'process.stdout.write(require(process.env.PW_MODULE_PATH).chromium.executablePath())')"
```

Chromium의 OS 의존성·한글 폰트가 없는 환경은 기존 `.github/workflows/pages.yml`의 설치 절차를 따른다. 환경의 정상 proxy/CA를 유지한다. 실제 Supabase 자격 증명이나 사용자 로그인이 이 합성 검사에 필요하지 않다.

첫 터미널에서 로컬 서버를 연다. 다른 작업이 점유한 포트라면 빈 포트를 택하고 아래 URL도 함께 바꾼다.

```bash
python3 scripts/dev-server.py --port 4201
```

같은 환경 변수가 설정된 두 번째 터미널에서 새 증거 디렉터리를 사용한다. runner의 출력 하위 디렉터리는 직접 만들지 않는다. 이미 있으면 runner가 거절하는 것이 정상이며 이전 결과를 지우고 재사용하지 않는다.

```bash
export TASK_EVIDENCE=".local/source-photo-handoff-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p .local
mkdir "$TASK_EVIDENCE"
BASE_URL=http://127.0.0.1:4201 \
SOURCE_PHOTO_MATCH='^same source/version arrives on B' \
SOURCE_PHOTO_OUTPUT="$TASK_EVIDENCE/new-first-flow" \
node tests/source-photo-recovery-browser.cjs > "$TASK_EVIDENCE/new-first-flow.log" 2>&1
```

확인한 원인에 대한 수정 후 전체 그룹 실행은 새 출력 경로에서 한다. `SOURCE_PHOTO_MATCH`를 지정하지 않아야 여섯 그룹이 모두 실행된다.

```bash
BASE_URL=http://127.0.0.1:4201 \
SOURCE_PHOTO_OUTPUT="$TASK_EVIDENCE/new-full-flow" \
node tests/source-photo-recovery-browser.cjs > "$TASK_EVIDENCE/new-full-flow.log" 2>&1
```

`SOURCE_PHOTO_SOURCE_ROOT`는 기본 저장소 루트를 사용한다. 실제 배포 산출물 확인 시에는 앱 파일의 출처와 fixture 파일의 출처를 별도로 고정하고, 실제 생성 설정·정적 파일을 fixture로 바꿔 성공 처리하지 않는다. 현재 runner가 의존하는 `tests/unified-home-browser.cjs`, `life-sync-browser.cjs`, `life-naver-capture-browser.cjs`, `composition-sync-browser.cjs`와 `tests/helpers/*`, 동봉 `vendor/fflate`는 인계 checkout에 있어야 한다. runner가 기록한 fixture 목록은 JSON의 `runnerProvenance`에 있다.

## 회귀와 출시 판정

실제 변경 경계에 맞춰 기존 검사를 실행한다. 전체 단위 검사 준비에는 기존 Naver extractor fixture 의존성 설치가 필요할 수 있으며 `.github/workflows/pages.yml`의 pinned 설치 순서를 재사용한다.

- 모델/저장/원격: `npm run check`, `npm test`; 집중 검사는 `tests/naver-capture-reference.test.cjs`, `naver-capture-recovery-sync.test.cjs`, `life-storage.test.cjs`, `material-continuity-storage.test.cjs`.
- 원형 수집·표시: `tests/life-naver-capture-browser.cjs`, `tests/naver-source-photo-status-browser.cjs`. 이 두 runner의 고정 `.local` 출력은 기존 증거와 충돌하지 않게 별도 checkout 또는 기존 출력 보존 절차를 사용한다.
- 시작 보존: `STARTUP_EXPECT_PROGRESSIVE=1 STARTUP_REGRESSION_ONLY=1`과 새 `STARTUP_OUTPUT`을 주어 `tests/startup-performance-browser.cjs`를 실행한다. 성능 수치 재측정과 구분한다.
- PWA: 새 `EXTERNAL_DISCOVERY_PWA_OUTPUT`으로 `tests/life-external-discovery-pwa-browser.cjs`. 현재 기본은 정확 v164→v165, 셸 192개·필수 해시 49개다. 출시 대상 main이 바뀌면 이전 배포 고정 기준을 다시 확인한다. 이 runner는 자체 로컬 서버를 연다.
- 마지막에는 실제 제품·검사 해시와 원문/사진/ZIP·키보드/세 폭 근거를 대조하고, 정확 PR·main의 CI 및 실제 배포 파일을 확인한다. 로컬 성공을 배포 완료로 보고하지 않는다.

## 이 인계 팩이 보존하는 근거와 한계

[JSON](evidence/source-photo-checkpoint.json)은 다음을 포함한다.

- baseline, 제품 freeze 224개 전체 SHA-256, QA에서 확인한 제품 23개 해시.
- 최초 실패의 메시지·스택·실행 시간·미실행 그룹·종료 상태.
- 실행 당시 fixture와 현재 fixture의 해시 및 변경된 runner.
- 기존 통과 보고서의 핵심 결과와 원본 로그/보고서의 상대 경로·파일 크기·SHA-256.

원본 `.local/source-photo-recovery-20261027/` 전체는 Git 인계에 포함하지 않는다. 그 경로가 없는 새 머신에서도 핵심 실패와 검증 상태를 읽을 수 있도록 위 자료를 발췌했다. 원본 해시는 파일을 갖고 있을 때 동일성을 대조하는 값이며, 원본 파일 접근을 대신하지 않는다. 원본 스크린샷·전체 HTTP 기록·환경 값·운영 스키마 응답 본문은 포함하지 않았다. 기존 단위 검사 작성 오류의 원본 로그 해시도 보존하되, 그것을 현재 신규 브라우저 실패 원인으로 연결하지 않는다.

설계의 현재 보장 범위는 [원문 사진 복구 계약](../design-review/source-photo-recovery.md)을 따른다. Core 포인터는 서버 보관 증명이 아니며, 새 앱이 이미 가진 참조를 보존하는 경계다. 기존 서버 Core CAS가 과거 모든 포인터 변경을 감사하거나 최초 기기가 그 이력을 탐지한다고 보증하지 않는다.
