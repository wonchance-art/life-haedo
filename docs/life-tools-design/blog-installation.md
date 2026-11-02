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

소유자 결정: 공개하는 사진은 모든 형식에서 촬영·위치 정보를 뺀 사본을 쓰고 원본은 비공개로 남긴다. 적용 전 운영의 활성 공개 사진은 0장이다. 규칙은 하나다: **공개 = 등록된 공개 사본(public_copy)**. 원본과 HEIC 보기용 JPEG는 공개 미디어가 되지 않는다.

- **사본 만들기** (공개 검토에서 고른 사진마다, 브라우저)
  - EXIF 회전을 적용해 캔버스로 다시 인코딩한다. 긴 변은 4096px까지다.
    - JPEG·불투명 WebP → JPEG(품질 0.9)
    - PNG·투명 WebP → PNG(무손실)
    - HEIC/HEIF → 보기용 JPEG를 디코드해 JPEG로. 어느 브라우저에서나 디코드할 수 있고 이미 바로 선 그림이다.
  - 움직이는 PNG/WebP는 첫 장면만 공개하고, 그 사실을 대화상자에 표시한다.
  - 인코딩한 바이트는 허용 목록(아래)으로 걸러 낸 뒤 그 결과로 digest를 계산한다. 그래서 iOS·macOS Safari의 ImageIO가 붙이는 최소 Exif APP1이나 PNG `iDOT`이 있어도 깨끗한 바이트만 올라간다.
  - 걸러 낸 결과가 허용 목록 판정을 통과하지 못하면 공개를 진행하지 않고 `public_copy_failed`로 알린다. "공개 성공인데 이미지가 깨짐"을 만들지 않기 위해서다.
  - 원본이나 보기용과 같은 바이트가 나오면(이미 캔버스 출력인 파일) 별도 객체가 되게 바꾼다. PNG는 sRGB 청크를 더하고, JPEG는 품질 0.89로 다시 인코딩한다.
- **허용 목록** (`PhotoPost.publicBytes`/`metadataFree`와 Edge `metadataFree`가 같은 규칙이다. `tests/blog-public-copies.test.cjs`가 같은 표본 묶음으로 둘을 비교한다)
  - JPEG: SOI·SOF·DHT·DQT·DRI·SOS·EOI, APP0 JFIF(표준 16바이트, 썸네일 없음), APP2 ICC(`ICC_PROFILE` 머리와 첫 조각의 `acsp` 서명), APP14 Adobe(14바이트).
    - 거부: APP1(EXIF·XMP), APP13(IPTC), JFXX, 덧붙은 APP0, JPGn(0xF0–0xFD), COM, EOI 뒤 바이트(MPF 보조 이미지).
  - PNG: IHDR·PLTE·IDAT·IEND·tRNS·gAMA·cHRM·sRGB·iCCP(이름·압축 방식·zlib 머리)·pHYs.
    - 거부: eXIf·tEXt·zTXt·iTXt·tIME·iDOT·애니메이션 청크·모르는 청크, IEND 뒤 바이트.
  - WebP는 공개 형식이 아니다.
  - **한계:** ICC 프로파일 내용은 구조만 본다. JPEG ICC는 머리·순번·서명, PNG iCCP는 이름·방식·zlib 머리까지다. 프로파일 안의 설명 텍스트 태그는 검사하지 않는다. 캔버스 출력의 프로파일은 브라우저가 붙이는 표준 sRGB 계열이다.
- **저장**
  - 사본은 문서·백업·ZIP·보존 파일에 넣지 않는 파생물이다.
  - 같은 비공개 버킷에 같은 경로 규칙(`소유자/글/사진/digest`)으로 별도 객체를 올리고, `assets.public_copy=true` 행으로 등록한다(`life_blog_publish_prepare_copy`).
  - 글을 지우면 사본도 원본·보기용과 함께 지울 수 있는 경로로 표시된다.
- **서버 보장** (`20261102120000_life_blog_public_photo_copies.sql`)
  - `life_blog_publish_copies`: 고른 사진마다 등록된 사본을 요구한다. 원본·보기용 digest는 사본이 될 수 없다.
  - `life_blog_publish_prepare_copy`: 사본은 JPEG/PNG만, HEIC 사본은 JPEG만 받는다. 크기는 표시 크기(HEIC는 보기용 크기) 이하여야 한다.
  - 기존 `life_blog_publish`: 서명·권한·영수증 형식을 유지한 채 같은 함수로 넘긴다. 글만 공개는 그대로 되고, 사진을 고르면 `life_blog_public_copy_required`로 거부한다. 갱신하지 않은 앱이 원본을 공개하지 못한다.
  - 트리거 `blog_publications_copies_only`: 활성 공개본의 모든 사진이 `copy` 표시된 미디어인지 확인한다.
    - 11-01 설치 묶음이 이전 private `publish`를 다시 만들거나 다시 grant해도, 그 함수는 사진이 든 공개본을 쓸 수 없다.
    - 철회(active=false)는 막지 않는다.
  - `public_media`: 표시된 미디어만 돌려준다. 이 마이그레이션 전의 공개본 사진은 내보내지 않는다.
  - AI 표시(`20261102110000_life_blog_ai_authorship`)도 이 경로에서 비공개로 남는다. `publish_copies`는 문자열 op에서 `author` 속성 하나만 지우고, 속성이 비면 `attributes`를 없앤다(도우미 `public_text_op`, AI 마이그레이션의 `publish`와 같은 규칙). 사진이 있든 없든, 기존 `life_blog_publish`로 들어오든 같다.
  - `valid_document`와 private `publish`는 다시 정의하지 않는다. 그래서 `20261102-blog-ai-authorship-install.sql`의 md5 가드(이 두 함수 본문 확인)에 영향이 없고, 이 마이그레이션 뒤에도 AI 설치 묶음은 그대로 진행된다(`npm run test:sql-replay`가 확인).
  - 11-01 묶음의 함수(valid_document·save·ready·prepare_asset·private publish·delete_post)는 다시 정의하지 않는다. `npm run test:sql-replay`와 `tests/run-blog-sql-postgres.cjs`가 묶음 재실행 직후에도 규칙이 유지되는지 확인한다.
  - 행 수 보호: public·haedo_*·storage.objects 모든 테이블의 행 수와 블로그 자산·글·공개본 행의 해시를 먼저 기록하고, 다르면 전체를 되돌린다.
- **Edge `haedo-blog-media`**: 응답 전에 객체 전체를 읽어 확인한다. 하나라도 어긋나면 502로 아무 바이트도 보내지 않는다.
  - SHA-256이 공개 digest와 같은지
  - 허용 목록을 통과하는지
  - 형식이 JPEG/PNG인지

### 실기기 확인 항목 (에이전트 검사로 대신하지 않음)

- **180° 방향(EXIF 3):** 회전해도 가로·세로가 바뀌지 않는다. 그래서 디코더가 EXIF 방향을 무시해도 크기 비교로는 알 수 없다. iPhone·iPad·Mac Safari·Chrome에서 거꾸로 찍은 사진을 공개해, 미리보기와 공개 화면이 똑바로 보이는지 눈으로 확인한다.
- 실제 iPhone HEIC와 Safari가 만든 사본이 허용 목록을 통과해 공개 화면에 보이는지 확인한다. 합성 ImageIO 형태로는 검사했다.

### 정한 것과 후속

- **사본 정리:** 이번에는 공개 철회나 사진 제거 때 사본 객체를 지우지 않는다.
  - 같은 기기·브라우저에서 다시 공개하면 같은 사본을 재사용한다.
  - 글을 지우면 사본도 원본과 함께 지운다.
  - 후속 후보: 활성 공개본이 참조하지 않는 `public_copy` 행만 비공개 버킷에서 지우는 소유자 전용 정리. 조건은 문서에 없는 사진이거나, 공개 철회 후 일정 시간이 지난 것이다. 공개 상태와 무관하게 비공개 버킷만 대상으로 한다.
- **PNG 형식:** 불투명 PNG도 무손실 PNG로 둔다.
  - PNG 원본은 대부분 화면 캡처·그림·글자다. JPEG로 바꾸면 글자 가장자리가 번져, 사본이 원본과 다른 그림이 된다.
  - 소유자가 채택한 권고도 "PNG 무손실"이다.
  - 긴 변 4096px 사진형 PNG는 수십 MB가 될 수 있다. 실제 공개 크기를 본 뒤, 큰 불투명 PNG만 JPEG 0.92로 바꾸는 규칙을 후속으로 검토한다.

### 운영 적용 순서 (총괄)

0. **선행 조건:** AI 표시 마이그레이션 `20261102110000_life_blog_ai_authorship`이 운영에 이미 적용돼 있어야 한다(2026-11-02 PR #169로 적용됨). 이 마이그레이션은 그 위에 적용한다. 11-01 설치 묶음을 다시 실행했다면, 그 문서 절차대로 AI 설치 SQL을 먼저 다시 적용한 뒤 이 마이그레이션을 적용한다. 이 마이그레이션은 두 설치 묶음이 다시 실행돼도 되돌아가지 않는다.
1. **적용 전 기록**
   - `haedo_blog_private.publish`·`public_media`·`public.life_blog_publish`의 정의 해시
   - assets/posts/publications/receipts 행 수
   - 사진이 있는 활성 공개본 수(0 예상)
   - 현재 Edge `haedo-blog-media` 버전 번호
2. **마이그레이션 `20261102120000_life_blog_public_photo_copies` 적용.** 확인할 것:
   - `assets.public_copy` 열
   - `haedo_blog_private.public_text_op` 함수(AI 표시 제거)와 `publish_copies`가 그것을 쓰는지(`prosrc like '%public_text_op%'`)
   - 새 함수와 두 공개 래퍼의 invoker·권한
   - 트리거 `blog_publications_copies_only` 사용 중
   - 행 수 동일
3. **Edge `haedo-blog-media` 배포** (JWT 게이트 끔 유지). 확인: 존재하지 않는 공개 사진 404, `no-store`, `nosniff`.
4. **Pages 배포** (사본을 만드는 앱, `sw.js` CACHE 갱신 포함)
   - 앱이 먼저 나가면 사진 공개가 `schema_missing`으로 실패할 뿐 데이터는 바뀌지 않는다.
   - Edge만 먼저 나가면 이전 함수로 공개한 원본 사진은 502로 막힌다.

### 되돌리기 (소유자 승인 뒤에만)

되돌리면 원본 공개가 다시 가능해진다. 사용자 데이터는 지우지 않는다. `public_copy` 열과 사본 행·객체는 남기며, 이전 함수는 이들을 쓰지 않는다. 파일 전체를 다시 실행하지 않고 아래 문장만 실행한다.

```sql
begin;
drop trigger if exists blog_publications_copies_only on haedo_blog_private.publications;
create or replace function haedo_blog_private.public_media(p_token uuid,p_photo_id text)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 select p.media->p_photo_id from haedo_blog_private.publications p where p.token=p_token and p.active and p.media ? p_photo_id
$$;
create or replace function public.life_blog_publish(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid,p_photo_ids text[] default '{}',p_author jsonb default '{"name":"","intro":""}'::jsonb,p_expected_publication_revision bigint default 0) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_blog_private.publish(p_post_id,p_expected_revision,p_operation_id,p_photo_ids,p_author,p_expected_publication_revision)$$;
revoke execute on function public.life_blog_publish_copies(uuid,bigint,uuid,text[],jsonb,bigint,jsonb) from authenticated;
revoke execute on function public.life_blog_publish_prepare_copy(uuid,text,text,bigint,text,integer,integer) from authenticated;
notify pgrst,'reload schema';
commit;
```

- `create or replace`는 기존 권한을 유지한다. `public_media`는 service_role, `life_blog_publish`는 authenticated 그대로다.
- Edge는 1에서 기록한 이전 버전 소스로 다시 배포한다.
- 되돌린 뒤 확인: `select prosrc from pg_proc where proname='public_media'`에 `'copy'`가 없고, 트리거 행이 0인지.
