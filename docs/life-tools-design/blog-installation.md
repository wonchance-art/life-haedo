# 블로그 서버 설치 기록

2026-10-17 UTC. `life-haedo`의 블로그 전용 서버 구성을 설치했다. 프런트엔드 Pages 배포·개인 계정으로 실제 글 게시·Apple 실기 검증은 별도다. 기존 자료를 새 형식으로 변환하거나 시험 사진을 운영에 올리지 않았다.

## 설치한 구성

- 로컬 migration: `supabase/migrations/20261017144744_life_blog_originals.sql`. Supabase CLI `migration new`로 최초 `20261017143539_life_blog_originals.sql`을 생성한 뒤, 실제 운영 이력 번호와 일치하도록 파일 이름만 정리했다. SHA-256 `d8f82a704b37326275b323ff173658d7277e7a57a8911c86d0fb3023e8cba769`.
- 운영 migration 이력: `20261017144744_life_blog_originals`. MCP 설치 시 부여한 이력 번호이며 로컬 파일과 같은 SQL이다. 이전 이름의 중복 파일은 남기지 않았고, SQL 재설치나 운영 이력 수정 없이 로컬 경로만 맞췄다.
- `haedo_blog_private`의 문서·원본 선언·작업 영수증·공개 이름·게시 사본 5개 테이블. 모두 RLS를 켜고 클라이언트 직접 접근을 허용하지 않는다. 명시한 소유자/익명 RPC로만 접근한다.
- 비공개 Storage 버킷 `haedo-blog-originals`, JPEG·PNG·WebP 파일당 최대 64 MiB. 이 버킷의 원본을 덮어쓰거나 삭제하는 클라이언트 정책은 없다. 다른 버킷의 기존 정책은 유지한다.
- `haedo-blog-media` Edge 버전 1, ACTIVE. 파일 SHA-256 `ee036ae4ffc606526795810362148c72df59b6831f471a2f2d4f9905bed11813`. 익명 사진 읽기를 위해 JWT 게이트를 끄고 함수 자체에서 공개 글 토큰·공개 사진 ID의 현재 유효성을 검사한다. 서비스 키는 서버 환경에만 둔다.

## 운영에서 확인한 것

`supabase/tests/blog-installation.sql`의 읽기 전용 11개 조건이 모두 참이었다. 비공개 버킷·5개 테이블 RLS·직접 테이블 권한 차단·소유자 RPC의 익명 거부·익명 공개 RPC·서버 전용 미디어 조회·4개 restrictive Storage 정책·9개 invoker API·공개 revision 비교를 확인했다. 역할의 BYPASSRLS·스키마 CREATE 권한도 별도로 확인했다.

설치 전후 기존 작업공간 3개와 원문 전송 영수증 1개가 유지됐다. 새 블로그 문서·자산·게시 사본은 모두 0개다. 개인 원문이나 사진을 읽거나 새 계정으로 재배정하지 않았다.

운영 HTTPS에서 공개 키만 사용한 읽기·거절 검사도 통과했다. 존재하지 않는 공개 글은 HTTP 200/null, 블로그는 200/빈 목록이었다. 익명의 개인 글 조회와 원본 위치 RPC는 각각 401로 거부됐다. 존재하지 않는 공개 사진의 Edge 요청은 404이며 `Cache-Control: no-store, max-age=0`, `X-Content-Type-Options: nosniff`를 확인했다. 유효한 개인 사진을 운영에서 시험 공개한 결과는 아니다.

설치 전후 보안 advisor의 기존 경고 종류/건수는 유지됐다. 새 private 테이블 5개의 `RLS enabled / no policy` 정보가 추가됐으며, 직접 테이블 권한을 주지 않고 검증한 RPC만 허용하는 의도된 구성이다. 이 정보를 해결하려고 포괄적 RLS 정책이나 직접 SELECT 권한을 추가하지 않는다.

## 로컬 재현과 배포

Node 22.13+와 로컬 Docker에서 `node scripts/check-blog-backend.mjs`는 고정된 PostgreSQL 17 이미지로 네트워크·호스트 포트가 없는 임시 컨테이너를 만든다. SQL 조건(`blog-originals.sql`), 설치 조건, 공개 사진 사본 조건(`blog-public-copies.sql`), 실제 동시 CAS 4개, 실제 Edge handler 13개를 확인하고 자기 컨테이너만 정리한다. Auth/Storage 메타데이터 shim은 운영 Storage HTTP 성공의 증거가 아니다.

Docker가 없으면 `npm ci --prefix tests/sql-ci` 뒤 `node tests/run-blog-sql-postgres.cjs`가 설치된 PostgreSQL 서버 바이너리로 같은 SQL 조건과, 실제 SQL·Edge handler·메모리 Storage로 GPS가 든 합성 JPEG/PNG/WebP/HEIC의 실제 응답 바이트를 확인한다. `node tests/public-photo-copy-browser.cjs`(앱 서버 `BASE_URL` 필요)는 실제 Chromium 캔버스로 같은 표본의 사본을 만들어 회전·형식·메타데이터 없음과 원본 바이트 보존을 확인한다.

브라우저와 실제 SQL을 함께 검증하려면 `node scripts/check-blog-backend.mjs --keep` 후 생성된 `.local/blog-backend/report.json`의 컨테이너를 `BLOG_POSTGRES_CONTAINER`, 새 격리 DB 이름을 `BLOG_POSTGRES_DATABASE=haedo_blog_qa_local`로 지정하고 `node tests/blog-completion-browser.cjs --prepare-database`를 실행한다. 앱 서버 `BASE_URL`도 지정한다. 검수 후 보고서에 적힌 자기 컨테이너를 정리한다. 운영 접속 정보를 이 명령에 넣지 않는다.

CI는 별도 `blog` 작업에서 이 흐름과 글 관리·익명 읽기·정확 인용/9칸·실제 이전 서비스워커 업데이트를 검사한다. 기존 73개 브라우저 검사는 4개 병렬 묶음에서 모두 실행하고 `browser` 집계 검사가 전부 통과해야 배포할 수 있다. `PREVIOUS_RELEASE=9479866 node scripts/verify-prepared-site.mjs`는 생성한 실제 설정과 전체 캐시 해시, 이전 v119 및 현재 main v90에서 v121로의 업데이트를 익명 fixture로 검증한다. 정적 산출물은 `scripts/prepare-site.mjs`의 명시적 허용 목록만 복사하고 개인 파일·SQL 검수 fixture·서버 키·Edge 소스는 배포하지 않는다. 공개 원본 응답과 RPC 결과는 서비스워커 캐시에 넣지 않는다.

프런트엔드가 공개되면 사용자 본인이 글 관리에서 한 편씩 공개 사진 검토·게시를 선택한다. 2026-11-02부터 공개하는 사진은 촬영·위치 정보를 뺀 사본이다(아래 절). 이미 다운로드된 파일이나 진행 중 응답의 바이트를 철회로 회수할 수 있다고 표시하지 않는다.

## 2026-11-02 공개 사진 사본 (저장소 작성, 운영 미적용)

소유자 결정: 공개하는 사진은 모든 형식에서 촬영·위치 정보를 뺀 사본을 쓰고 원본은 비공개로 남긴다. 적용 전 운영의 활성 공개 사진은 0장이다.

- **사본:** 공개 검토에서 고른 사진마다 브라우저가 EXIF 회전을 적용해 캔버스로 다시 인코딩한다. JPEG·불투명 WebP → JPEG(품질 0.9), PNG·투명 WebP → PNG(무손실), HEIC/HEIF → 이미 있는 보기용 JPEG. 긴 변은 4096px까지다. 움직이는 PNG/WebP는 첫 장면만 공개하며 대화상자에 표시한다. 다시 인코딩한 결과가 원본과 같은 바이트이면(이미 캔버스 출력인 파일) PNG는 sRGB 청크를 더하고 JPEG는 품질 0.89로 인코딩해 별도 객체로 만든다.
- **저장:** 사본은 문서·백업·ZIP·보존 파일에 넣지 않는 파생물이다. 같은 비공개 버킷의 같은 경로 규칙(`소유자/글/사진/digest`)에 별도 객체로 올리고 `assets.public_copy=true` 행으로 등록한다(`life_blog_publish_prepare_copy`). 글을 지우면 원본·보기용과 함께 지울 수 있는 경로로 표시된다.
- **서버 보장:** `20261102120000_life_blog_public_photo_copies.sql`
  - `life_blog_publish_copies`가 JPEG/PNG/WebP 사진마다 등록된 사본을 요구하고 HEIC는 문서의 보기용 JPEG만 쓴다. 원본은 공개 미디어가 될 수 없다.
  - 기존 `life_blog_publish`는 서명·권한·영수증 형식을 유지한 채 같은 함수로 넘기므로 글만·HEIC만 공개는 그대로 되고, 사본 없는 JPEG/PNG/WebP는 `life_blog_public_copy_required`로 거절한다(갱신하지 않은 앱이 원본을 공개하지 못함).
  - 공개 미디어에는 `copy` 표시가 붙고 `public_media`는 표시된 미디어만 돌려준다. 이전 함수로 만든 공개본의 사진은 더 이상 내보내지 않는다.
  - 11-01 설치 묶음의 함수(valid_document·save·ready·prepare_asset·private publish·delete_post)는 다시 정의하지 않으므로 그 묶음을 다시 실행해도 이 변경이 되돌아가지 않는다(`npm run test:sql-replay`와 `tests/run-blog-sql-postgres.cjs`가 확인).
  - 행 수 보호: public·haedo_*·storage.objects 모든 테이블의 행 수와 블로그 자산·글·공개본 행의 해시를 먼저 기록하고 다르면 전체를 되돌린다.
- **Edge `haedo-blog-media`:** 응답 전에 객체 전체를 읽어 SHA-256이 공개 digest와 같은지, JPEG(JFIF·ICC·Adobe 외 APPn/COM/뒤 붙은 바이트), PNG(eXIf·tEXt·zTXt·iTXt·tIME·애니메이션·모르는 청크), WebP(EXIF·XMP·애니메이션) 메타데이터가 없는지 확인한다. 하나라도 있으면 502로 아무 바이트도 보내지 않는다.

### 운영 적용 순서 (총괄)

1. 적용 전 기록: `haedo_blog_private.publish`·`public_media`·`public.life_blog_publish`의 현재 정의 해시, assets/posts/publications/receipts 행 수, 활성 공개본 중 사진이 있는 수(0 예상).
2. 마이그레이션 `20261102120000_life_blog_public_photo_copies` 적용. 확인: `assets.public_copy` 열, 새 함수 3개(`publish_copies`·`prepare_copy`·두 공개 래퍼)의 invoker·권한, 행 수 동일.
3. Edge `haedo-blog-media` 배포(JWT 게이트 끔 유지). 확인: 존재하지 않는 공개 사진 404·`no-store`·`nosniff`.
4. 그다음 Pages 배포(사본을 만드는 앱). 순서가 바뀌어 앱이 먼저 나가면 사진 공개가 `schema_missing`으로 실패할 뿐 데이터는 바뀌지 않는다. Edge만 먼저 나가면 이전 함수로 공개한 원본 사진은 502로 막힌다.

되돌리기: 사용자 데이터를 지우지 않는다. 이 마이그레이션 이전 정의(`20261017144744`의 `public_media`·`public.life_blog_publish`)를 다시 적용하면 이전 동작으로 돌아가며, `public_copy` 열과 사본 행은 남겨도 이전 함수가 쓰지 않는다. Edge는 이전 버전으로 다시 배포한다. 되돌리면 원본 공개가 다시 가능해지므로 소유자 승인 뒤에만 한다.
