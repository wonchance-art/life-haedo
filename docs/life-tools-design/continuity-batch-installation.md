# Local 일괄 설치 인계: 구성 + 선택한 글쓰기 초안

2026-10-06. 사용자가 “로컬에서 한번에 처리”하도록 요청한 두 단계의 신규 SQL이다. **운영 설치 완료 보고는 아직 받지 않았다.** 기존 Google 설정·원문 동기화·게시 SQL은 다시 설치하지 않는다. Cloud의 새 앱은 아직 공개 배포하지 않는다.

## 실행 순서

전달받은 동일 커밋에서 아래 파일을 읽고, 해도 전용 Supabase 관리 연결인지 확인한다. 원래 작업 폴더의 브랜치나 미커밋 변경을 바꾸지 않는다. 먼저 관련 migration 이력과 함수/테이블 존재를 확인해 이미 설치된 단계는 다시 실행하지 않고 해당 읽기 전용 검사만 수행한다.

| 순서 | 관리자 작업 | 성공 조건 |
| --- | --- | --- |
| 1 | [구성 migration](../../supabase/migrations/20261006010000_life_compositions.sql) | 오류 없이 한 번 설치 |
| 2 | [구성 설치 확인](../../supabase/tests/life-compositions-installation.sql) | 읽기 전용 트랜잭션, 11조건 모두 true |
| 3 | [초안 migration](../../supabase/migrations/20261006020000_life_writing_drafts.sql) | 오류 없이 한 번 설치. 1의 공용 JSON/UTF-16 검증 함수가 필요 |
| 4 | [초안 설치 확인](../../supabase/tests/life-writing-drafts-installation.sql) | 읽기 전용 트랜잭션, 9조건 모두 true |

마이그레이션 원문은 각각 자체 `BEGIN/COMMIT`을 포함한다. 설치 확인 파일은 `BEGIN READ ONLY` / `ROLLBACK`으로 감싼다. 단계 3이 실패하면 먼저 성공한 구성 SQL을 임의로 DROP하거나 사용자 자료를 정리하지 않는다. 오류를 전달하고 앱 배포는 계속 보류한다.

| 파일 | SHA-256 |
| --- | --- |
| `20261006010000_life_compositions.sql` | `9585ff0173932bc0afa509d6eb28a3f2957b7bca0ec285fa30ff7d19832cb935` |
| `life-compositions-installation.sql` | `ccd3d0ed2305b7ab23ca0336aff9ce63bbb8f6e906219a6c511cb2c63cf3f45a` |
| `20261006020000_life_writing_drafts.sql` | `b24e5f128f53ffc6f120b4e4b7550e7a70b0bd8b6cb31262cfb27863a8015e60` |
| `life-writing-drafts-installation.sql` | `8fc1e9636876ca82afd8eb0fbb8d43d5a4debdfda05373393ba999d197b5001b` |

도구가 저장소 파일명과 다른 실행 시각을 migration 이력 번호로 부여하면 이름·원문 해시로 대조한다. 번호 차이만으로 재설치하지 않는다.

## 보존 범위와 금지할 검사

기존 `charts`, `haedo_documents`, `haedo_items`, `life_workspaces`, `life_sync_receipts`, `life_public_pages`, `life_public_page_receipts`와 기존 Auth/함수/정책/권한은 변경하지 않는다. 설치 전후 메타데이터 지문으로 확인한다. 두 단계는 각각 새 테이블·함수만 추가한다. 두 테이블 계열 모두 직접 권한을 닫고 소유자 RPC만 허용하는 RLS 설계다.

`supabase/tests/life-compositions.sql`, `supabase/tests/life-writing-drafts.sql`은 격리 로컬 DB의 합성 자료 검사다. **운영에서 실행하지 않는다.** 과거 `scripts/check-life-cloud.py` 재실행, 합성 작업공간/게시본/계정 생성, 개인 기록 조회·삭제, Google/Auth 설정 변경도 하지 않는다.

초안 SQL은 제목·본문·원문 수정 기준을 담는 비공개 사본이다. `applied`는 기록으로 저장한 종료 상태이며 같은 초안을 다시 열지 않는다. 보관 완료 전송에는 현재 원문의 정확한 source/version 쌍이 필요하다. 동시 저장이 서로 다른 로컬 원문을 만들면 기존 원문 CAS 충돌에서 양쪽을 보존하며 전역 한 번 저장을 보장하지 않는다. 실패했다고 원문을 자동 삭제·병합하지 않는다.

## Local이 전달할 결과

실행한 Git 커밋, 두 설치의 실행 여부/기존 설치 여부와 migration 이력, 11+9조건 결과, 기존 구조·정책·권한 보존 여부를 알려 준다. 키·비밀번호·접속 문자열·개인 자료는 보내지 않는다. 병합·배포는 중복 실행하지 않고 Cloud가 이어간다.

Cloud는 보고를 받은 뒤 두 읽기 전용 검사기를 실행한다.

```sh
python3 scripts/check-life-composition-read.py
python3 scripts/check-life-writing-draft-read.py
```

두 검사기는 공개 키로 익명 권한 차단만 확인한다. 새 사본을 만들거나 put 요청·개인 자료 읽기·테스트 로그인을 하지 않으며 authenticated 성공 검증과는 다르다. 이후 최신 CI 확인 → 선행 PR #35 병합 → 후속 초안 PR 반영 → 공개 배포/라이브 확인 순서로 진행한다.
