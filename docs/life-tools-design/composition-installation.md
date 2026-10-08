# 구성 이어쓰기: 운영 설치 인계

2026-10-06 KST. **운영 설치 전**이다. 기존 원문 동기화와 공개 페이지 SQL은 다시 설치하지 않는다. 이번 기능은 묶음·비공개 내 페이지·회고·관련 기록 제외만 명시적으로 연결한다.

## 관리자에게 전달할 작업

1. 해도 전용 Supabase인지 확인하고, 전달받은 Git 커밋의 아래 두 파일을 읽는다. 다른 작업 폴더의 브랜치·미커밋 변경은 건드리지 않는다.
2. 새 테이블·함수가 이미 있는지 먼저 읽기 전용으로 확인한다. 이미 설치된 경우 이력을 대조하며 무조건 재설치하지 않는다.
3. 신규 [마이그레이션](../../supabase/migrations/20261006010000_life_compositions.sql)을 관리자 권한으로 한 번 실행한다. 파일 자체가 트랜잭션이다.
4. [설치 확인 SQL](../../supabase/tests/life-compositions-installation.sql)을 `BEGIN READ ONLY` / `ROLLBACK`으로 감싸 실행해 **11조건 모두 `passed=true`**인지 확인한다.
5. 기존 테이블·정책·권한·함수의 메타데이터가 보존됐는지 확인하고 결과·migration 이력·실제 실행 커밋을 Cloud에 전달한다. 개인 자료·키·접속 문자열은 보고하지 않는다.

| 파일 | SHA-256 |
| --- | --- |
| `20261006010000_life_compositions.sql` | `9585ff0173932bc0afa509d6eb28a3f2957b7bca0ec285fa30ff7d19832cb935` |
| `life-compositions-installation.sql` | `ccd3d0ed2305b7ab23ca0336aff9ce63bbb8f6e906219a6c511cb2c63cf3f45a` |

관리 도구가 실행 시각을 migration 이력 번호로 쓰더라도 파일 내용·해시가 같으면 별도 재설치 이유가 아니다. `supabase/tests/life-compositions.sql`은 **격리된 로컬 DB 전용**이며 운영에서 실행하지 않는다. 과거 Cloud 합성 자료·테스트 계정·공개 사본을 만들거나 정리하는 검사도 실행하지 않는다. Auth 설정은 변경하지 않는다.

## 추가되는 범위

- `life_compositions`, `life_composition_receipts` 두 테이블과 `life_composition_*` 여섯 함수만 추가한다. 기존 원문·연표·공개 페이지의 데이터나 함수를 변경하지 않는다.
- 원문 `(owner_id, id)`에 대한 복합 외래키, 독립 revision/CAS, 원문 도착 기준 `source_revision`, 영속 operation 영수증을 사용한다. 원문 RPC와 같은 계정/공간별 advisory lock을 공유한다.
- 두 테이블은 RLS를 켜고 직접 권한을 닫는다. `authenticated`는 `auth.uid()` 소유자로 고정한 get/put RPC만 실행하며 anon은 실행하지 못한다. 고정 `search_path=pg_catalog`를 사용한다. 직접 정책이 없다는 advisor 정보는 이 계약과 구분해 기록한다.
- 실패 시 클라이언트 구성 연결을 중지해 로컬 자료를 유지한다. 운영 사본/영수증을 DROP하는 자동 롤백은 제공하지 않는다.

## Cloud 후속과 현재 증거

관리자 설치 보고 후 `python3 scripts/check-life-composition-read.py`를 실행한다. 공개 키로만 익명 접근 차단을 확인하며 로그인·개인 자료 조회·게시/작업공간 생성·put 요청을 하지 않는다. 이 검사는 인증 사용자 RPC 성공이나 실제 기기 이동을 증명하지 않는다.

설치 전 읽기 전용 운영 HTTP 결과: get `404/PGRST202`, 두 테이블 `404/PGRST205`. 설치 완료로 표시하지 않았다. 현재 Cloud에는 앱용 공개 키만 있고 SQL 관리자 실행 도구 및 Local 세션으로 작업을 보내는 도구가 없어, 위 설치만 기존 Local 관리자 경로로 이어야 한다.

격리 PostgreSQL 17.11에서 역할/RLS/RPC·형식·한계 163조건, 설치 메타데이터 11조건, 실제 다중 트랜잭션 4조건을 통과했다. 첫 설치와 재실행 모두 기존 구조·권한·자료를 보존했다. 검사 트랜잭션과 임시 컨테이너는 정리했으며 운영 합성 쓰기는 하지 않았다. [구현 계약](device-continuity.md)과 화면 검증은 별도로 관리한다.
