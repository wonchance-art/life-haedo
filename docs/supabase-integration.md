# 자료 가져오기·동기화와 PR #17 통합

2026-10-03 · `Life-haedo cloud`의 최신 작업과 PR #17을 대조한 기록.
이번 변경은 서버 SQL 설치, 공유 인증 연결, 통합 경계 확인이다. Cloud의 전체 가져오기 화면은 아직 병합하지 않았다.

## 같은 서버, 하나의 로그인

양쪽 모두 `web for language` 조직의 해도 전용 `life-haedo` 프로젝트를 사용한다.
새 프로젝트를 만들거나 다른 서비스의 Supabase로 전환하지 않았다. 연결 값은 배포 설정에서 주입하며 문서·소스에는 자격 증명을 넣지 않는다.

| 구분 | PR #17 | Cloud 구현 | 통합 기준 |
| --- | --- | --- | --- |
| 사용자 로그인 | Google OAuth·PKCE | 독립 이메일·비밀번호 로그인 | Google OAuth·PKCE를 사용자 진입점으로 유지 |
| SDK | supabase-js 2.117.2, `vendor/supabase.js` | 같은 버전, `vendor/supabase/` | 이미 있는 SDK 한 개 재사용 |
| 세션 | `HaedoAuth`, `caeyeon_life_platform_session` | 프로젝트별 별도 세션 | `HaedoAuth`가 관리하는 SDK 클라이언트 공유 |
| 연표·목표·습관 | `haedo_documents`, `haedo_items` | 기존 연표는 별도 읽기 연결 | 기존 소유자 RLS와 계정별 사본 유지 |
| 새 자료 | 없음 | IndexedDB 작업공간, 원문·발췌·출처 | 별도 데이터 형식 유지, 명시 선택 후 연결 |
| 새 자료 서버 | 없음 | `life_workspaces`, `life_sync_receipts`, `life_sync_put` | 동일 Auth의 `auth.uid()`로 소유자 결정 |
| 백업 | `haedo-platform-backup-v1` | `life-tools-backup-v1` | 원본 형식 유지, 포함 범위를 화면에서 구분 |

테스트 이메일 계정은 실서버 검증에 사용할 수 있지만 운영 화면에 두 번째 로그인을 추가하지 않는다.
같은 이메일이라고 데이터를 합치지 않는다. 서버 사용자 UUID와 기존 binding이 일치해야 하며 다른 계정의 미전송 작업을 자동 업로드하지 않는다.
기존 `charts`와 개인 기록을 읽거나 이동하지 않았다.

## 적용한 SQL

Cloud 세션에서 작성한 [원본 마이그레이션](../supabase/migrations/20261003085426_life_sync_workspaces.sql)의 내용을 변경 없이 설치했다. 로컬 파일 이름도 서버의 실제 적용 버전과 맞춰, 후속 CLI 작업에서 이미 적용한 SQL을 미적용으로 인식하지 않게 했다.
Supabase 마이그레이션 이름은 `life_sync_workspaces`, 적용 버전은 `20261003085426`이다.

- `life_workspaces`: 로그인 계정 자신의 행만 조회. 앱의 직접 INSERT·UPDATE·DELETE는 차단한다.
- `life_sync_receipts`: 앱 역할의 직접 접근을 차단한다.
- `life_sync_put`: 로그인 계정에서 소유자를 결정하고 서버 revision으로 비교 후 저장한다. 같은 operation ID의 동일 요청은 기존 결과를 반환하고 다른 내용은 거부한다.
- 최대 JSON 스냅샷은 16 MiB. 기존 `charts`, `haedo_documents`, `haedo_items`, Auth 설정은 변경하지 않는다.

[실제 DB 권한·RPC 검사](../supabase/tests/life-sync.sql)는 합성 JWT claims로 **19개 통과**했고 모두 롤백했다.
별도 실제 DB 트랜잭션을 동시에 호출한 검사 **3개**도 통과했다. 같은 revision의 서로 다른 두 쓰기는 저장 1건·충돌 1건, 동일 요청의 두 재시도는 같은 결과, 예전 요청의 재시도는 원래 영수증을 반환했다.
이 추가 검사의 합성 작업공간·영수증은 정확한 ID로 삭제하고 잔여 0건을 확인했다.
이는 실제 PostgreSQL/RLS/RPC 검증이며 실제 OAuth 로그인·PostgREST 사용자 토큰 검증과는 구분한다.

Cloud의 [실서버 HTTP 검사](../scripts/check-life-cloud.py)도 인계했다. A/B 테스트 계정의 환경 변수는 해당 Cloud 환경에서 유지하며 채팅·로그로 가져오지 않는다.
SQL이 설치됐으므로 Cloud에서는 이 검사의 `--schema-only`, 이후 전체 검사와 생성한 cleanup SQL을 실행할 수 있다.

## 공유 인증 어댑터

[platform-life-remote.js](../assets/platform-life-remote.js)는 Cloud `Remote`의 `clientFactory` 계약으로 플랫폼 SDK를 빌려준다.
SDK를 새로 만들거나 토큰을 복사하지 않는다. 프로젝트·공개 키가 다르면 거부하고, 서버 `HaedoAuth.verify()`를 통해 사용자 확인을 재사용한다.
연결을 폐기하거나 계정을 바꾸면 해당 자료 요청만 취소하고 늦은 응답을 버린다. 어댑터 폐기로 공용 SDK의 세션·자동 갱신을 종료하지 않는다.
로그아웃은 플랫폼의 공통 로그아웃을 사용하며 비밀번호 로그인 호출은 거부한다.

Cloud의 파일이 병합될 때 `platform-config.js`, SDK, `platform-auth.js`, Cloud Core·Storage·Remote·Sync, 이 어댑터, 화면 모듈 순서로 로드한다.
현재 어댑터는 검증된 연결 코드이며 기존 HTML에 아직 추가하지 않았다. 통합 시 관리자는 다음처럼 생성한다.

```js
const sync = HaedoLife.Sync.create({
  storage,
  core: HaedoLife.Core,
  remoteFactory: HaedoLife.PlatformRemote.create,
});
await sync.connect();
```

`create.loadConfig`와 `create.saveConfig`도 Cloud 관리자 계약에 맞춰 제공한다. 플랫폼 설정이 정본이며 사용자가 새 URL·키·비밀번호를 입력하는 화면은 제거한다.
로그인이 자료의 업로드 동의를 대신하지 않는다. 현재 작업공간을 연결하는 명시적 선택은 유지한다.
공유 계정 확인 도중 SDK 계정이 바뀌면 과거 성공·실패 응답 모두 거부하며 새 계정을 로그아웃시키지 않도록 `platform-auth.js`도 보완했다.
정적 검사와 전체 Node 회귀 **47개**가 통과했다. 이 중 공유 연결 검사 8개에는 실제 동봉 SDK를 모의 HTTP 응답으로 실행한 SELECT·RPC·동일 토큰 사용 검사가 포함된다. 이는 실제 Google 로그인이나 전체 자료 화면의 브라우저 검증을 대신하지 않는다.

## 전체 화면 병합 전에 남은 항목

1. Cloud 구현은 최신 세션 작업 파일에 있으며 아직 커밋·푸시하지 않은 상태다. 최신 구현을 별도 커밋으로 보존한 뒤 이 인증 계약을 적용한다.
2. PR #17의 `index.html`은 공개 홈, 연표는 `timeline.html`이다. Cloud의 기존 `index.html` 연결을 그대로 덮어쓰지 않고 새 자료 기능 진입점을 홈·내 공간에 추가한다. `life.html`을 로그인 복귀 경로·보호 페이지 목록에 추가하고 계정 확인 후 화면을 연다.
3. IndexedDB의 accountBinding과 작업공간 목록을 확인한다. 이전 계정의 공간은 로그인 계정이 바뀌어도 노출·자동 업로드하지 않고, 미연결 기존 로컬 자료는 사용자 확인 뒤 사본으로 연결한다.
4. Cloud의 연표 읽기 연결은 계정별 registry와 `timeline.html` 경로로 맞춘다. 기존 로컬 기록과 `charts`를 자동 이전하지 않는다.
5. Pages 준비 스크립트에 `life.html`을 추가하고 서비스워커의 셸·캐시 버전을 하나로 통합한다. PR의 보호된 페이지 재열기 정책과 Cloud의 오프라인 재열기를 실제 계정으로 확인한다.
6. 가져오기→원문·발췌→재열기→백업 복원, 두 계정 전환, Google 로그인, 실제 HTTP 동시 수정, 배포 주소를 통합 상태에서 검증한 뒤 초안을 해제한다.

## 현재 인증 설정과 보안 점검

실제 공개 Auth 설정에서 Google 제공자는 비활성화, 이메일 제공자는 활성화로 확인했다.
기존 Google Cloud 프로젝트를 재사용할 수 있으며 해도용 웹 OAuth 클라이언트의 callback과 Supabase Google 제공자 설정이 필요하다.
Client Secret은 사용자가 Supabase 설정 화면에 직접 입력하며 저장소·채팅에 넣지 않는다.
[Google 로그인 공식 설정](https://supabase.com/docs/guides/auth/social-login/auth-google)을 기준으로 기존 PKCE 흐름을 유지한다.

2026-10-03 보안 advisor는 알림 3개였다. 자료 영수증 테이블의 정책 없음은 RLS·직접 권한 회수로 접근을 모두 막는 설계이며, 인증 역할의 SECURITY DEFINER 실행은 소유자 검사·고정 `pg_catalog` 경로·한정 객체명·RPC 전용 쓰기를 위한 의도된 권한이다.
알림을 숨기기 위해 테이블 직접 쓰기를 열거나 함수를 SECURITY INVOKER로 바꾸지 않았다.
이메일 인증의 유출 비밀번호 보호 비활성화 알림도 있었으며 기존 Auth 설정을 변경하지 않았다.
[정책 없음 설명](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [SECURITY DEFINER 설명](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [비밀번호 보호 설명](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Supabase 최신 changelog에서 이 기존 PostgreSQL 17 프로젝트·Google PKCE 연결에 추가 전환이 필요한 변경은 발견하지 않았다. 서버는 PostgreSQL 17.11이었다.
