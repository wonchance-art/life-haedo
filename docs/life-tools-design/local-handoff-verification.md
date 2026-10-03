> SQL 인계 수신 시점의 기록이다. 이후 화면 통합은 [공용 인증·자료 통합 기록](../supabase-integration.md)을 따른다.

# Local SQL 인계 수신·HTTP 검증

2026-10-03 · SQL 설치 대기는 해제했다. 공용 Google 인증과 전체 화면 병합·배포 완료를 뜻하지 않는다.

## 보존과 대조

`Life-Haedo local`의 PR #17, `codex/platform-home-auth`, HEAD `2b2a319615f9e079a2e19dfde67b85fe06071ae3`를 fetch해 비교했다. Cloud HEAD는 `29aeab31a1456eae93addd8151f5e04e4afdb8e8`이며 미커밋 변경을 덮거나 checkout하지 않았다.

비교 전에 변경 파일 46개를 `/workspace/life-haedo-handoff-backups/20261003T091603Z/changes.tar.gz`에 보존하고 모든 파일 SHA-256을 대조했다. 같은 위치에 manifest·tracked patch·기준 HEAD가 있다. 저장소·원격에는 백업이나 자격 정보를 업로드하지 않았다.

설치 SQL은 기존 Cloud 원본과 byte 단위로 같다. SHA-256은 `9bcbb8e814c998da885d6d289ff3433ccdf03e2e0c8db952b3ff914ed307acf6`다. 서버 migration 버전과 맞춰 파일을 [20261003085426_life_sync_workspaces.sql](../../supabase/migrations/20261003085426_life_sync_workspaces.sql)로 통일하고 도움말·검사 경로도 갱신했다. SQL을 다시 실행하지 않았다.

인계된 실제 DB 역할/RLS/RPC 19개·동시 트랜잭션 3개 통과는 Local의 증거다. 아래 HTTP 검사는 Cloud에서 새로 실행했다. 기존 `charts`, `haedo_documents`, `haedo_items`, Auth 제공자 설정을 읽거나 수정하지 않았다.

## Cloud에서 실행한 HTTP 검사

현재 환경의 기존 공개 키와 테스트 A/B 계정을 그대로 사용했다. 값·토큰·이메일·비밀번호는 출력하거나 파일에 기록하지 않았다. 두 계정 인증과 새 SELECT endpoint 설치를 확인했다.

[check-life-cloud.py](../../scripts/check-life-cloud.py) 전체 검사 최종 exit 0, **11개 통과**:

1. 최초 생성과 동일 요청 재시도의 한 번 반영.
2. 다른 계정의 조회 격리 및 익명 조회·RPC 거절.
3. 앱 역할의 영수증 테이블 직접 조회 거절.
4. 직접 INSERT·UPDATE·DELETE 거절.
5. 성공 operation ID에 다른 본문·기준 revision 사용 거절.
6. 서로 다른 계정의 동일 workspace/operation ID 격리.
7. 존재하지 않는 공간을 nonzero revision으로 재생성하지 않음.
8. 동시 최초 생성에서 저장 1건·충돌 1건.
9. 동일 revision의 동시 수정에서 저장 1건·충돌 1건.
10. 동시에 보낸 동일 요청에서 같은 성공 영수증 반환.
11. 서버 JSONB 16 MiB 제한의 `HTTP 400 / 22001 / life_snapshot_too_large`, 거절된 행 0건.

처음 큰 HTTP 본문 검사에서는 16,777,710-byte 요청에 JSON이 아닌 HTTP 401이 반환됐다. 작은 인증·SELECT·RPC는 같은 자격 정보로 정상이고 큰 요청의 행은 남지 않았다. 응답 출처와 원인은 아직 확정하지 않았으며 이 응답을 SQL 크기 제한 성공으로 처리하지 않았다.

서버 제한은 약 126 KB의 유한 숫자 JSON 배열이 PostgreSQL JSONB 표현에서 18 MB 이상이 되는 별도 bounded fixture로 확인했다. 검사 스크립트 기본 크기 사례를 이 방식으로 바꿔 SQL 오류 코드·고정 메시지·행 미생성을 확인한다. 원래 큰 HTTP 본문 검사는 선택적인 `--wire-size-check`로 유지했으며 이 환경에서 정상적인 크기 오류를 받는지는 미확인이다. 실제 크기 경계의 원문 업로드가 정상이라고 확대하지 않는다.

## 익명 테스트 정리 인계

첫 검사와 최종 검사에서 생성한 행은 A 6개·B 2개, 총 8개다. 개인 기록이 아닌 새 UUID와 고유 검사 제목의 빈 workspace만 썼다. 생성 시점마다 ID와 실행별 제목 접두를 기록해 정리 범위를 제한했다.

Cloud 계정은 의도적으로 직접 DELETE 권한이 없다. 정리 편의로 권한을 늘리지 않았다. 관리자 연결이 있는 Local에서 아래 Cloud 산출물의 SQL만 실행하고 잔여 0건을 확인해야 한다. 사용자에게 설치 SQL 재실행을 요청할 필요는 없다.

- `/workspace/life-haedo-handoff-results/cloud-http-cleanup-combined.sql`: 두 실행의 정확한 ID + 실행별 제목을 모두 제한한 DELETE, 영수증은 FK cascade.
- `/workspace/life-haedo-handoff-results/cloud-http-final-20261003.log`: 11개 최종 통과, 사용자 자료 접근 없음.
- `/workspace/life-haedo-handoff-results/cleanup-status.json`: 익명 행 개수 확인.

위 경로는 Cloud 환경의 파일이며 Local 파일시스템과 공유하지 않는다. 정리 SQL 전체는 이 Cloud 세션의 도구 결과에도 남겼으므로 Local의 세션 읽기 도구로 확인할 수 있다. 삭제 권한이 없는 Cloud에서 정리 완료로 보고하지 않는다.

## 공용 인증 계약 확인

[PR의 인계 문서](https://github.com/wonchance-art/life-haedo/blob/2b2a319615f9e079a2e19dfde67b85fe06071ae3/docs/supabase-integration.md)를 제품 통합 기준으로 삼는다. Google OAuth·PKCE와 `HaedoAuth` 공용 SDK를 재사용하며 두 번째 비밀번호 로그인·토큰 복사를 제품에 추가하지 않는다. 실제 Google 제공자는 인계상 비활성화이며 이번에는 설정하지 않았다.

Cloud의 실제 Remote·Sync·Core 및 동봉 SDK와 PR의 실제 platform-auth·platform-life-remote를 한 Node VM에서 모의 HTTP와 함께 실행했다. PR 문서의 `await sync.connect()`는 현재 Cloud 관리자가 이메일·비밀번호를 요구해 `auth_required`로 거절한다. 공용 로그인 완료 후 아래 재개 API를 사용해야 한다.

```js
// 플랫폼 보호 페이지에서 HaedoAuth.requireUser()가 성공한 뒤:
const sync = HaedoLife.Sync.create({
  storage,
  core: HaedoLife.Core,
  remoteFactory: HaedoLife.PlatformRemote.create,
});
await sync.start();
```

`start()`로 서버 검증한 공용 계정을 재사용하고, 별도 `life_tools_sync_*` 세션을 만들지 않으며, 미연결 공간을 업로드하지 않고, Sync 폐기가 공용 SDK/세션을 없애지 않는 것을 확인했다. 이는 모의 HTTP의 연결 계약 검사이며 실제 Google OAuth 검증이 아니다. 증거 스크립트는 `/workspace/life-haedo-handoff-results/check-shared-auth-contract.cjs`다.

전체 UI에는 아직 이 어댑터를 연결하지 않았다. 현재 Cloud 독립 개발 화면의 비밀번호 로그인은 테스트용 구현이며 최종 제품 인증 기준이 아니다. 두 계정의 로컬 목록 노출·공간 binding·오프라인 재열기, `life.html` 보호/복귀, 공개 홈 `index.html`과 연표 `timeline.html`, Pages 및 서비스워커를 함께 맞춰야 한다. 같은 이메일만으로 다른 Auth UUID의 자료를 합치지 않는다.

직접 겹치는 파일은 AGENTS.md·README.md·index.html·sw.js·service-worker 회귀·HTTP 검사 스크립트다. 단순 checkout이나 전체 복사로 덮지 않고 각 역할을 통합해야 한다. 이번 작업에서는 PR 병합·커밋·푸시·공개 배포를 수행하지 않았다.

## 변경 후 회귀 확인

`npm test` 91개 통과, `npm run check` 통과(HTML 7개·JS 20개·로컬 리소스 참조 50개), Python 검사 스크립트 구문·CLI 도움말과 `git diff --check`를 확인했다. 이번 변경은 설치된 migration 파일명·참조 통일과 HTTP 검사·인계 문서 보완이며, 이전 브라우저 검사를 새로 실행했다고 보고하지 않는다.
