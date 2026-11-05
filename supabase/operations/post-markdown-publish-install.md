# B3 Markdown 공개 설치 안내

작업자는 이 파일의 운영 명령을 실행하지 않는다. 적용·배포는 총괄 담당이다. **B1은 소유자가 SQL Editor에서 적용했고 총괄이 읽기 전용으로 검증했다.** [확정 상태](https://github.com/wonchance-art/life-haedo/issues/212#issuecomment-6653067297)는 함수 6개 해시/ACL·트리거 2개·행 수 보존·기존 글 6/6 통과다. B2에는 A 병합·B3 운영 반영·구형 탭 교체 초안 보호·변환 거부 글 편집 경로가 남았다. B3는 별도 운영 적용과 검증이 필요하다.

1. B3 적용 전에 총괄이 현재 함수 정의·권한과 [B1 설치 전 크기 확인](post-markdown-install.md)의 행 수·바이트 합계를 기록한다. 본문·계정 ID·키는 조회 결과에 내보내지 않는다.
2. B1 `20261105051632_life_post_markdown.sql`의 최종 정의/권한/트리거가 맞는지 다시 대조한 뒤 `20261105081055_life_post_markdown_publish.sql`을 적용한다. 새 migration 전체는 단일 DO 문장이고, 그 안에서 변경 전후 행 수·해시를 비교한다. 문장별 커밋 도구에서도 정의 변경과 보호가 한 트랜잭션이다. B1의 `ON COMMIT DROP` 임시 표 방식은 SQL Editor에서 문장 사이에 표가 사라졌으므로 되풀이하지 않는다. B3 뒤에 과거 B1 정의를 다시 설치하지 않으며, 기존 글·사진·공개 사본·영수증은 변경하지 않는다.
3. `supabase/functions/haedo-blog-publish/index.ts`를 진입점으로 배포한다. 실제 `assets/life/post-markdown.js`와 vendor 파일을 직접 import하므로 프로젝트 루트 밖으로 파일을 따로 복사하지 않는다. 함수 디렉터리만 복사한 배포는 의존성을 잃는다. [Supabase 외부 경로 import 지원](https://supabase.com/changelog/33613-deploy-edge-functions-from-cli-without-needing-docker-import-files-outside-of-supabase-directory)과 [의존성 안내](https://supabase.com/docs/guides/functions/dependencies)를 따른다. 배포 도구의 현행 도움말·원격 대상·업로드 파일을 총괄이 확인한다.
4. 플랫폼 JWT 검사는 사용자 JWT 호출에 맞춰 유지한다. 플랫폼 검사만 믿지 않고 함수에서도 시작 시점과 commit 직전 두 번 Auth 사용자를 확인하고, DB는 현재 세션을 다시 검증한다. 기존 공통 키 선택기를 쓰며 서비스 비밀값을 클라이언트 설정이나 Pages 산출물에 넣지 않는다.
5. 적용 후 기존 함수·ACL·행 수/해시 보존, 익명/일반 사용자의 commit 호출 거부, 기존 v2 공개·철회, md 직접 RPC 거부와 Edge 경유 공개를 확인한다. 새 공개는 명시 선택한 사진의 등록된 사본만 사용하며 기본은 0장이다. 운영 합성 쓰기가 필요하면 총괄의 허용 범위에서 수행하고 개인 글을 시험 데이터로 사용하지 않는다.

기존 account-sync/AI 설치 묶음은 B1 publish 정의를 보존한다. B3는 해당 함수를 다시 정의하지 않고 별도 prepare/commit을 추가한다. 격리 검사에서는 B3 후 설치 묶음 재실행과 SQL 전체 재생의 최종 정의가 그대로인지 확인한다.

Edge만 실패하거나 아직 배포되지 않았으면 md 공개는 실패로 표시하고 기존 글·공개 사본·영수증을 유지한다. 응답 유실은 같은 요청 ID로 재시도한다. 운영 데이터를 되돌리는 SQL, 공개 영수증 삭제, 원문 형식 퇴행은 복구 절차로 사용하지 않는다.

## 격리 검증 재현

다음 명령은 운영 접속 옵션 없이 로컬의 임시 PostgreSQL만 만든다. PostgreSQL 17 서버 도구와 `tests/sql-ci`의 고정 의존성이 필요하다. 도구 위치가 기본 경로 밖이면 `HAEDO_PG_BIN`으로 지정한다. SQL 재생의 SKIP은 통과로 보지 않는다.

```sh
npm ci --prefix tests/sql-ci --ignore-scripts --no-audit --no-fund
node tests/run-post-markdown-publish-postgres.cjs
node tests/run-post-markdown-install-replay.cjs
SQL_REPLAY_REQUIRED=1 npm run test:sql-replay
node tests/integrated-release-installation.cjs
```

브라우저 검사는 별도 터미널의 `npm run dev`와 아래 고정 PostgreSQL 컨테이너를 쓴다. `pg_isready`가 준비 완료를 반환한 뒤 검사를 실행한다. `--prepare-database`는 이름이 같은 DB가 이미 있으면 중단하며 기존 DB를 초기화하지 않는다.

```sh
docker --host=unix:///var/run/docker.sock run -d --name haedo-blog-postgres-61735 --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-bookworm@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5
docker --host=unix:///var/run/docker.sock exec haedo-blog-postgres-61735 pg_isready -U postgres
BASE_URL=http://127.0.0.1:4173 BLOG_POSTGRES_CONTAINER=haedo-blog-postgres-61735 BLOG_POSTGRES_DATABASE=haedo_blog_qa_b3_final node tests/post-markdown-publish-browser.cjs --prepare-database
docker --host=unix:///var/run/docker.sock rm -f haedo-blog-postgres-61735
```

Auth/Storage HTTP는 합성 서버이고, handler·SQL·앱·익명 미디어 읽기는 실제 코드를 쓴다. 공개 사본은 기존 클라이언트 생성 경로로 메타데이터를 제거하며 DB가 등록된 사본·원본과 다른 digest·Storage 메타데이터를 확인한다. Edge가 파일 바이트를 다시 내려받아 EXIF를 검사하는 구조는 아니다. 운영 OAuth·Storage·호스팅 번들 검증을 이 검사로 대신하지 않는다.
