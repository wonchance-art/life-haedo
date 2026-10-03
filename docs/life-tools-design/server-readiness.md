# 서버·인증 준비 상태

2026-10-03 · 설치된 동기화 SQL과 현재 Auth 제공자 상태를 구분한다. 이번 점검은 설정 변경이나 새 테스트 행 생성을 하지 않았다.

## 확인 결과

| 항목 | 상태와 근거 |
| --- | --- |
| 개인 동기화 스키마 | 설치 완료. 이전 404·설치 대기 기록은 현재 상태가 아니다. 설치 파일은 [20261003085426_life_sync_workspaces.sql](../../supabase/migrations/20261003085426_life_sync_workspaces.sql) |
| 실서버 권한·CAS | 직전 Cloud HTTP 검사 11개 통과. 이번에는 반복 실행하지 않았다. [인계 검증 기록](local-handoff-verification.md)에 SQL·HTTP 증거와 구분이 있음 |
| Google 로그인 제공자 | 이번에 `/auth/v1/settings`를 읽어 HTTP 200, `external.google=false` 확인. 제공자는 현재 비활성화이며 실제 Google OAuth 완료를 주장할 수 없음 |
| 환경 구성 readiness | `environment_status`의 연결은 connected이나 network/credential 상태는 unknown. 이 값으로 ready/enforced를 추정하지 않음 |
| 실제 요청 가능 범위 | 기존 프록시·CA·공개 키 경로로 Auth 설정 조회 성공. 이 사실이 모든 API·Google redirect·모든 요청 크기의 정상 동작을 보장하지 않음 |
| 익명 테스트 잔여 | 직전 확인 A 6행·B 2행, 총 8행. 이번에는 재조회·삭제하지 않았으며 정리 완료 상태가 아님 |

공용 제품 인증은 기존 Google OAuth·PKCE·`HaedoAuth`를 재사용한다. 테스트 A/B의 비밀번호 인증 성공을 제품의 Google 로그인 검증으로 대체하지 않는다.
Google 제공자 활성화·클라이언트 설정·redirect 허용 범위는 관리자 설정과 실제 로그인/복귀 검증이 필요한 별도 작업이다. 이번 점검에서 해당 설정을 바꾸지 않았다.

## 큰 HTTP 요청의 401

기존 점검에서 16,777,710-byte HTTP 요청이 JSON이 아닌 401로 거절됐다. 같은 자격 정보의 작은 요청은 성공했고 해당 큰 요청이 남긴 행은 없었다.
보존된 로그와 진단 코드를 검토했지만 당시 응답의 Content-Type·Via·WWW-Authenticate 헤더는 기록되지 않았다. 응답 주체가 환경 프록시인지 서비스의 앞단인지 Auth 서버인지 확정할 근거가 없다.
따라서 비밀번호 오류·키 오류·프록시 제한·SQL 크기 제한 중 하나로 단정하지 않는다. 추가 대용량 요청을 보내거나 프록시·CA·자격 정보를 바꾸지 않았다.

SQL의 JSONB 크기 방어는 별도로 확인됐다. 약 126 KB의 bounded 숫자 배열이 PostgreSQL JSONB에서 18 MB 이상으로 확장될 때 `HTTP 400 / 22001 / life_snapshot_too_large`를 반환했고 행을 만들지 않았다.
이는 SQL 방어의 증거이며 16 MiB에 가까운 실제 원문 HTTP 업로드가 성공한다는 증거는 아니다. JSONB 표현과 HTTP RPC 인자 포장은 앱의 JSON 스냅샷 바이트 수와 다르다.

[검사 스크립트](../../scripts/check-life-cloud.py)에 다음의 제한된 진단을 추가했다.

- `--auth-settings-only`: 로그인·자료 조회 없이 Google enabled 여부와 HTTP 상태만 출력한다.
- 기존 선택 옵션 `--wire-size-check`: 향후 명시적으로 실행할 때 요청/응답 바이트 수·상태·제한된 미디어 종류·헤더 존재 여부만 출력한다. 이번에는 실행하지 않았다.
- 원문·응답 본문·원본 헤더·키·토큰·이메일·비밀번호는 진단에 출력하거나 저장하지 않는다. 헤더의 존재만으로 응답 주체를 판정하지 않는다.

## 크기 오류 때 로컬 자료 보존

[Remote](../../assets/life/remote.js)의 `cloneSized`는 UTF-8 JSON 스냅샷이 16 MiB를 넘으면 RPC 전송 전에 `payload_too_large`로 차단한다. 서버 `22001`과 고정 크기 오류도 같은 사용자 오류로 정리하며 로컬 자료 보존을 안내한다.
[Sync](../../assets/life/sync.js)는 확정 `stored` 응답에만 `ackSync`를 실행한다. 크기·인증·네트워크 오류는 로컬 원문과 기존 outbox를 유지한 채 오류 상태를 남긴다. 실패를 성공으로 표시하거나 빈 자료로 덮지 않는다.
401만으로 발생 원인을 구분할 수 없으며 반환 형식에 따라 로그인 필요 또는 일반 원격 오류로 안내될 수 있다. 원인에 대한 추가 확정 없이 데이터 보존 경계를 유지하는 것이 현재 동작이다.
위 내용은 이번 코드 검토 결과이며 새 대용량 실서버 성공 검사로 표현하지 않는다. 기술 담당에게 401의 미확정 원인과 전송 포장 크기 차이를 전달했다.

## 정리와 검증 범위

익명 8행의 [정리 SQL](../../supabase/tests/cleanup-cloud-http-20261003.sql)은 저장소에도 보존했다. Cloud 원본은 `/workspace/life-haedo-handoff-results/cloud-http-cleanup-combined.sql`이다. 생성한 UUID와 실행별 검사 제목을 함께 제한하며 관리자 실행이 필요하다. 정리 편의로 앱 역할 DELETE 권한을 추가하지 않았다.
Local과 Cloud의 파일시스템은 별개다. Local 현황 확인과 정리 실행 인계는 총괄이 담당하며, 이 문서는 별도 전송·수신·삭제 완료를 주장하지 않는다.

이번 확인은 Google 설정의 제한된 실제 조회, 기존 로그·코드 검토, Python 구문·CLI 검사, 비밀 없는 HTTP 메타데이터의 모의 응답 검사다. 새 live fixture·원천 개인 자료 조회·OAuth 설정 변경·배포는 수행하지 않았다.
