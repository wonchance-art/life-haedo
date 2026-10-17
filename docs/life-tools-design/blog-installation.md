# 블로그 서버 설치 기록

2026-10-17 UTC. `life-haedo`의 블로그 전용 서버 구성을 설치했다. 프런트엔드 Pages 배포·개인 계정으로 실제 글 게시·Apple 실기 검증은 별도다. 기존 자료를 새 형식으로 변환하거나 시험 사진을 운영에 올리지 않았다.

## 설치한 구성

- 로컬 migration: `supabase/migrations/20261017143539_life_blog_originals.sql`. Supabase CLI `migration new`로 생성했다. SHA-256 `d8f82a704b37326275b323ff173658d7277e7a57a8911c86d0fb3023e8cba769`.
- 운영 migration 이력: `20261017144744_life_blog_originals`. MCP 설치 시 부여한 이력 번호이며 같은 SQL이다. 로컬 파일을 이 번호로 중복 생성하거나 재설치하지 않는다.
- `haedo_blog_private`의 문서·원본 선언·작업 영수증·공개 이름·게시 사본 5개 테이블. 모두 RLS를 켜고 클라이언트 직접 접근을 허용하지 않는다. 명시한 소유자/익명 RPC로만 접근한다.
- 비공개 Storage 버킷 `haedo-blog-originals`, JPEG·PNG·WebP 파일당 최대 64 MiB. 이 버킷의 원본을 덮어쓰거나 삭제하는 클라이언트 정책은 없다. 다른 버킷의 기존 정책은 유지한다.
- `haedo-blog-media` Edge 버전 1, ACTIVE. 파일 SHA-256 `ee036ae4ffc606526795810362148c72df59b6831f471a2f2d4f9905bed11813`. 익명 사진 읽기를 위해 JWT 게이트를 끄고 함수 자체에서 공개 글 토큰·공개 사진 ID의 현재 유효성을 검사한다. 서비스 키는 서버 환경에만 둔다.

## 운영에서 확인한 것

`supabase/tests/blog-installation.sql`의 읽기 전용 11개 조건이 모두 참이었다. 비공개 버킷·5개 테이블 RLS·직접 테이블 권한 차단·소유자 RPC의 익명 거부·익명 공개 RPC·서버 전용 미디어 조회·4개 restrictive Storage 정책·9개 invoker API·공개 revision 비교를 확인했다. 역할의 BYPASSRLS·스키마 CREATE 권한도 별도로 확인했다.

설치 전후 기존 작업공간 3개와 원문 전송 영수증 1개가 유지됐다. 새 블로그 문서·자산·게시 사본은 모두 0개다. 개인 원문이나 사진을 읽거나 새 계정으로 재배정하지 않았다.

운영 HTTPS에서 공개 키만 사용한 읽기·거절 검사도 통과했다. 존재하지 않는 공개 글은 HTTP 200/null, 블로그는 200/빈 목록이었다. 익명의 개인 글 조회와 원본 위치 RPC는 각각 401로 거부됐다. 존재하지 않는 공개 사진의 Edge 요청은 404이며 `Cache-Control: no-store, max-age=0`, `X-Content-Type-Options: nosniff`를 확인했다. 유효한 개인 사진을 운영에서 시험 공개한 결과는 아니다.

설치 전후 보안 advisor의 기존 경고 종류/건수는 유지됐다. 새 private 테이블 5개의 `RLS enabled / no policy` 정보가 추가됐으며, 직접 테이블 권한을 주지 않고 검증한 RPC만 허용하는 의도된 구성이다. 이 정보를 해결하려고 포괄적 RLS 정책이나 직접 SELECT 권한을 추가하지 않는다.

## 로컬 재현과 배포

Node 22.13+와 로컬 Docker에서 `node scripts/check-blog-backend.mjs`는 고정된 PostgreSQL 17 이미지로 네트워크·호스트 포트가 없는 임시 컨테이너를 만든다. 67개 SQL 조건, 11개 설치 조건, 실제 동시 CAS 4개, 실제 Edge handler 7개를 확인하고 자기 컨테이너만 정리한다. Auth/Storage 메타데이터 shim은 운영 Storage HTTP 성공의 증거가 아니다.

브라우저와 실제 SQL을 함께 검증하려면 `node scripts/check-blog-backend.mjs --keep` 후 생성된 `.local/blog-backend/report.json`의 컨테이너를 `BLOG_POSTGRES_CONTAINER`, 새 격리 DB 이름을 `BLOG_POSTGRES_DATABASE=haedo_blog_qa_local`로 지정하고 `node tests/blog-completion-browser.cjs --prepare-database`를 실행한다. 앱 서버 `BASE_URL`도 지정한다. 검수 후 보고서에 적힌 자기 컨테이너를 정리한다. 운영 접속 정보를 이 명령에 넣지 않는다.

CI는 별도 `blog` 작업에서 이 흐름과 글 관리·익명 읽기·정확 인용/9칸·실제 이전 서비스워커 업데이트를 검사한다. 기존 73개 브라우저 검사는 4개 병렬 묶음에서 모두 실행하고 `browser` 집계 검사가 전부 통과해야 배포할 수 있다. `PREVIOUS_RELEASE=9479866 node scripts/verify-prepared-site.mjs`는 생성한 실제 설정과 전체 캐시 해시, 이전 v119 및 현재 main v90에서 v121로의 업데이트를 익명 fixture로 검증한다. 정적 산출물은 `scripts/prepare-site.mjs`의 명시적 허용 목록만 복사하고 개인 파일·SQL 검수 fixture·서버 키·Edge 소스는 배포하지 않는다. 공개 원본 응답과 RPC 결과는 서비스워커 캐시에 넣지 않는다.

프런트엔드가 공개되면 사용자 본인이 글 관리에서 한 편씩 비공개 서버 보관·공개 사진 검토·게시를 선택한다. 원본 파일의 EXIF/GPS를 제거하는 기능은 없으며 공개 범위에 포함됨을 따로 확인한다. 이미 다운로드된 파일이나 진행 중 스트림의 바이트를 철회로 회수할 수 있다고 표시하지 않는다.
