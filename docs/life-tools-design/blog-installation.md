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
   - 선행 조건 확인: `md5(prosrc)`가 `haedo_blog_private.publish` = `17bb2aa6befed545e6cf33158c7c2b06`, `haedo_blog_private.valid_document` = `da3cbe336718c99fe3601ff518422555`(AI판)인지 본다. 다르면 적용하지 않고 멈춘다(2026-11-02 운영 읽기에서 두 값 일치 확인).
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

## 2026-11-11 공개 전 철회 (저장소 작성, 운영 미적용)

마이그레이션 `supabase/migrations/20261111120000_life_blog_withdraw_before_publication.sql`. 작업자는 운영에 적용하지 않았다. 적용은 총괄 담당이다.

### 왜 바꿨나

- 첫 공개 게시 요청의 응답을 받지 못하면, 그 요청이 서버에 반영됐는지 이 기기는 알 수 없다. 사용자가 그 상태에서 `공개 철회`를 눌러도 서버에는 공개 행이 없어 `unpublish`가 `missing`만 답하고 아무것도 바꾸지 않았다. 그래서 늦게 도착한 게시 요청(expected 공개 revision 0)이 철회 뒤에 그대로 반영될 수 있었다.
- 앞 단계에서는 기기가 표지를 남겨 두고, 늦게 반영된 공개본의 이름·사진이 자기 요청과 같으면 철회했다. 같은 이름·사진 없는 글을 다른 기기가 일부러 공개한 경우와 구분할 수 없어, 그 공개를 내릴 수 있었다(재검수 R2-M1).
- 이제 내용으로 판단하지 않는다. 서버에서 닫는다: 공개 행이 없을 때 expected revision 0으로 철회하면 **비공개 행을 revision 1로 기록**하고 영수증을 남긴다. 모든 게시 경로가 공개 revision을 대조하므로, 먼저 보낸 첫 게시 요청은 도착해도 `conflict`로 끝난다.

### 바뀐 함수

`haedo_blog_private.unpublish(uuid,bigint,uuid)` 하나다. 서명·`security definer`·`search_path=pg_catalog`·소유자·권한(`authenticated`만 실행)은 그대로다. 공개 래퍼 `public.life_blog_unpublish`는 건드리지 않는다. 이전 정의는 `20261017144744_life_blog_originals.sql` 310–327행이다.

| 호출 | 이전 | 지금 |
| --- | --- | --- |
| expected 0, 공개 행 없음, 내 글 | `22023 life_invalid_request` | 비공개 행(revision 1) 기록, `{"status":"stored","revision":1}` |
| expected 0, 공개 행 있음 | `22023 life_invalid_request` | `{"status":"conflict","revision":<현재>}` |
| expected 0, 글 없음·남의 글 | `22023 life_invalid_request` | `{"status":"missing"}` (행 만들지 않음) |
| expected ≥1, 공개 행 없음 | `missing` | `missing` (그대로) |
| expected = 현재 revision | revision+1, 비공개 | 그대로 |
| expected ≠ 현재 revision | `conflict` | 그대로 |
| 같은 작업 ID 재요청 | 영수증 그대로 반환 | 그대로 (새 경로도 영수증을 남긴다) |

- 새 행의 `token`은 열이 `NOT NULL UNIQUE`라서 채운 자리값이다. 공개 주소가 아니다. 익명 읽기는 `active` 행만 보고, 첫 실제 게시가 자기 토큰을 새로 만든다.
- 소유자가 자기 글의 공개 상태를 읽는 경로(`owner_publication`)는 `profiles`와 조인한다. 프로필 행이 없는 계정은 빈 이름의 프로필 행을 하나 만든다. 이미 있는 이름·소개는 건드리지 않는다. 공개 중인 글이 없는 프로필은 누구에게도 보이지 않는다.
- 설치는 기존 행을 바꾸지 않는다. 파일 전체가 한 문장이고, 그 안에서 posts·assets·receipts·publications·profiles의 행 수와 해시를 전후 비교해 달라지면 예외로 되돌린다.

### 새 비공개 행이 다른 경로에 미치는 영향

| 경로 | 결과 | 근거 |
| --- | --- | --- |
| `publish`(사진 없는 v2 글), expected 0 | `conflict`(revision 1) | SQL 검사 |
| `publish_copies`(사진 사본), expected 0 | `conflict` | SQL 검사 |
| `markdown_publish_prepare`·`markdown_publish_commit`, expected 0 | `conflict` | SQL 검사 |
| 그다음 실제 게시(expected 1) | `stored`, revision 2, 새 토큰 | SQL·브라우저 검사 |
| `life_blog_read`·`list`·`sync_list`(소유자) | `{active:false, revision:1}` — 다음 게시가 보낼 expected 값 | SQL 검사 |
| `public_read`(행의 토큰)·`public_media` | `null` | SQL·브라우저 검사 |
| `public_list` | 글 수에 넣지 않고 이름도 비움 | SQL 검사 |
| 공개 표지·모음 | 앱이 `sync_list`의 `publication.active`인 글만 고른다(`public-cover-remote.js` 70행, `blog-series-remote.js` 24행). 비공개 행은 일반 철회 글과 같게 빠진다 | 코드 확인, 기존 브라우저 검사 |
| 공개 9칸 | 블로그 공개 행을 쓰지 않는다 | 코드 확인 |
| 글 삭제(`delete_post`) | `active` 행만 거절한다. 비공개 행은 글과 함께 지워지고 영수증도 지워진다 | SQL 검사 |
| 다른 계정의 글 | `missing`, 행 없음 | SQL 검사 |
| 익명 호출 | `42501` | SQL 검사 |
| 다시 설치 | 행·다른 함수·권한 변화 없음 | SQL 검사 |

검사: `node tests/run-blog-unpublish-postgres.cjs`(68개 확인. 변이 10종 `--mutation=no-row|active-row|no-revision|missing-as-before|blank-profile|profile-first|new-blog-token|any-receipt|no-lock|any-owner`은 실패해야 함). 두 연결 경합은 한 연결이 철회 트랜잭션을 연 채 다른 연결이 첫 게시를 보내, 글의 advisory lock을 기다렸다가 `conflict`로 끝나는지 본다. CI에서는 `npm run test:sql-replay`의 4.8 단계가 모든 마이그레이션을 재생한 사본에서 같은 계약을 돌린다. `tests/integrated-release-installation.cjs`의 고정 목록·해시에 이 파일을 더했다.

### 앱이 하는 일

- **공개 철회:** 결과를 모르는 게시 요청이 있으면 항상 철회 RPC를 보낸다. 공개 중이면 그 revision을, 공개 행이 비공개면 그 revision을, 행이 없으면 0을 보낸다. `stored`면 대기 표시를 지우고 `비공개`로 확정한다.
- **선택을 바꿔 다시 게시:** 공개 중이 아닌 글은 철회 RPC로 revision을 먼저 올리고 새 revision으로 보낸다. 공개 중인 글의 갱신만 주소를 지키려고 같은 revision으로 보내며(둘 중 하나만 반영), 앞 요청이 먼저 반영되면 새 선택을 한 번 더 보낸다.
- **게시 요청 취소:** `비공개 · 앞서 보낸 게시 미반영` 안내 옆 버튼. 같은 철회 RPC로 요청을 끝낸다. 공개 중인 글의 미반영 갱신에는 없다.
- **내용 비교로 철회하지 않는다.** 철회를 요청한 뒤 다른 revision으로 공개된 글은 그대로 두고 `철회를 요청한 뒤에 게시가 반영되어 지금 공개 중입니다`라고 알린다.
- **마지막 선택이 반영되지 않고 앞 요청이 공개된 경우:** 새 선택을 보내기 전의 철회가 닿지 못한 사이 앞 요청이 반영되면, 글에 `마지막 선택 미반영` 안내를 남긴다(목록·글 정보·검토 패널, 공개 중인 사본의 사진 수 포함). 사용자가 미리보기를 갱신해 다시 게시하거나 철회할 때까지 유지한다. 열려 있던 검토 패널의 미리보기와 동의는 무효로 한다. 기기가 대신 게시하거나 철회하지 않는다.
- **새 선택이 아무것도 보내지 못한 경우(2026-11-11 5차, R4-M1):** 계정 확인·글 head 읽기·사진 사본 올리기가 연결 문제로 실패해 이번 누름이 아무 요청도 보내지 못했고, 다른 선택의 앞 요청이 아직 반영될 수 있으면, 그 요청을 기기에 `choiceUnsent`로 남긴다(오프라인에서도 남는다). 상태 줄은 `이번 공개 게시 요청은 보내지 못했습니다. 앞서 보낸 요청의 결과는 아직 확인하지 못했습니다…`다. 그 요청이 나중에 공개되면 위와 같은 `마지막 선택 미반영` 안내를 남기고, 열린 검토 패널은 미리보기·동의를 끝내며 상태 줄도 그 안내(사진 수 포함)로 바뀐다. 공개 중인 글의 갱신이면 그 요청이 반영되기 전까지 `앞서 보낸 갱신 미반영`을 유지한다. 기록은 같은 글·같은 계정의 기기 기록에만 있고, 다시 게시(어떤 요청이든 보내면)·같은 선택을 다시 고름·철회·게시 요청 취소·공개 revision이 그 요청 뒤로 넘어감에서 끝난다.
- **안내의 귀속(r4-m1):** 공개 중인 사본을 익명으로 읽어 앞 요청과 이름·소개·사진이 같으면 `먼저 보낸 게시가 반영되어`, 다르면 `다른 게시가 반영되어`, 읽지 못하면 `먼저 보낸 게시나 다른 게시가 반영되어`라고 쓴다.
- **사진 수 읽기의 제한시간:** 이 익명 읽기는 글 잠금 안에서 돌아 같은 탭의 다른 조작이 그동안 기다린다(10초). 그래서 이 읽기만 4초로 끊고, 끊기면 사진 수 없이 안내를 남긴다. 이전에는 읽기가 12초 걸리면 같은 탭의 게시가 10초 뒤 `다른 탭에서 처리 중입니다`로 끝났다(브라우저 검사로 확인).
- 공개 중이 아니고 결과를 모르는 요청도 없는 글에서 `공개 철회`를 누르면 요청을 보내지 않고 `이 글은 공개 중이 아닙니다`라고 답한다.
- **서버가 아직 이전 정의일 때:** expected 0 철회가 거부된다(`missing`을 답해도 같게 다룬다). `확인 못 함`을 유지하고 주기(30초)마다 같은 작업 ID로 철회를 한 번씩 다시 보낸다. 선택을 바꾼 게시는 앞 요청과 같은 revision으로 보낸다(둘 중 하나만 반영).
- **제한시간:** 게시·철회·공개 head 읽기 30초, Markdown 게시(Edge) 60초. 넘기면 실패가 아니라 "결과 모름"이다. 다른 탭이 처리 중이면 10초 기다린 뒤 `다른 탭에서 처리 중입니다`를 보인다.

### 중간 실패 상태표

X는 결과를 모르는 앞 요청, Y는 새 선택이다. "주기"는 30초 자동 확인이다. 모든 줄은 `tests/blog-publication-settle.test.cjs`에 검사가 있다.

| 흐름 | 실패 지점 | 기기에 남는 것 | 화면 | 다음에 일어나는 일 |
| --- | --- | --- | --- | --- |
| 철회(공개 중 아님) | head 읽기 실패 | 그대로 | 확인 못 함 | 다시 누르거나 주기 |
| 철회(공개 중 아님) | 철회 RPC 미도착 | X + 철회 대기(끝내기) | 확인 못 함 | 주기가 같은 작업 ID로 다시 보냄 → 비공개. X는 conflict |
| 철회(공개 중 아님) | 철회 반영, 응답 유실 | X + 철회 대기 | 확인 못 함 | 주기가 revision이 오른 것을 보고 다시 보내지 않음 → 비공개 |
| 철회(공개 중 아님) | X가 철회 직전에 반영 | 공개 기록 | (같은 호출 안에서 이어짐) | 그 공개본의 revision으로 철회 → 비공개 |
| 철회(공개 중 아님) | 철회 대기 중 X가 반영 | 공개 기록, 대기 없음 | 공개 중 + 알림 | 철회하지 않는다. 사용자가 다시 철회 |
| 철회(공개 중 아님) | 서버가 이전 정의 | X + 철회 대기 | 확인 못 함 | 주기마다 한 번 다시 보냄. 서버가 받으면 비공개 |
| 철회(공개 중 아님) | 철회 대기 중 사용자가 같은 선택을 다시 게시 | 공개 기록, 대기 없음 | 공개 중 | 앞 요청을 같은 작업 ID로 다시 보낸 것이다. 옛 철회는 도착해도 conflict |
| 철회(공개 중) | 철회 RPC 미도착·응답 유실 | 철회 대기 | 확인 못 함 | 주기가 같은 revision에만 다시 보냄. 다른 revision으로 공개돼 있으면 보내지 않고 알림 |
| 새 선택(공개 중 아님) | 끝내는 철회 미도착 | X + 철회 대기 | 확인 못 함 | Y는 보내지 않았다. 주기가 X를 끝냄 → 비공개. 다시 게시하면 바로 이어짐 |
| 새 선택(공개 중 아님) | 끝내는 철회 미도착 → 그사이 X 반영 | 공개 기록 + 마지막 선택 미반영 기록(사진 수) | 공개 중 + `마지막 선택 미반영` 안내 | Y는 보내지 않았고 X가 공개 중이다. 철회·게시를 대신 하지 않는다. 열린 검토의 미리보기·동의 무효. 미리보기를 갱신해 다시 게시하거나 철회하면 안내가 끝난다 |
| 새 선택(공개 중 아님) | 서버 확인 전 연결 실패(계정 확인·head 읽기) | X + 앞 요청 기록(`choiceUnsent`) | 비공개 + 미반영 안내. 상태 줄 `이번 공개 게시 요청은 보내지 못했습니다…` | Y는 보내지 않았다. 다시 게시하거나 게시 요청 취소 |
| 새 선택(공개 중 아님) | 서버 확인 전 연결 실패 → 그사이 X 반영 | 공개 기록 + 마지막 선택 미반영 기록(사진 수) | 공개 중 + `마지막 선택 미반영` 안내, 상태 줄도 같은 안내 | 철회·게시를 대신 하지 않는다. 열린 검토의 미리보기·동의 무효. 미리보기를 갱신해 다시 게시하거나 철회 |
| 새 선택 | 서버 확인 전 연결 실패 → 그사이 다른 기기의 게시 반영 | 공개 기록 + 마지막 선택 미반영 기록 | 공개 중 + `다른 게시가 반영되어` 안내 | X는 conflict. 대신 하는 일 없음 |
| 갱신(공개 중) | X를 대체한 뒤 Y 전송 전 연결 실패 | 앞 요청 기록(`choiceUnsent`) | 공개 중 + 갱신 미반영 안내 | X가 반영되면 `마지막 선택 미반영` 안내. 다시 게시하면 기록이 끝난다 |
| 새 선택(공개 중 아님) | 철회 완료, Y 응답 유실 | Y | 확인 못 함 | 주기 → 공개 중(Y) |
| 새 선택(공개 중 아님) | 철회 완료, Y 미도착 | Y | 확인 못 함 | 주기 → 비공개 + 미반영 안내. 다시 게시하거나 게시 요청 취소 |
| 새 선택(공개 중 아님) | X가 철회 직전에 반영 | 공개 기록 + 마지막 선택 미반영 기록 | 공개 중 + `마지막 선택 미반영` 안내 | 검토 기준이 바뀌어 Y는 보내지 않음(`미리보기 갱신`). 갱신 뒤 게시하면 같은 주소의 갱신 |
| 새 선택(공개 중 아님) | 서버가 이전 정의 | Y(경합 표시) | 확인 못 함 | X와 같은 revision. 하나만 반영. X가 먼저면 Y를 한 번 더 보냄 |
| 갱신(공개 중) | X가 먼저 반영 | Y | — | Y conflict → 공개본이 X와 같으면 Y를 새 revision으로 한 번 더 → 공개 중(Y), 같은 주소 |
| 갱신(공개 중) | 다시 보낸 Y 응답 유실·미도착 | Y | 확인 못 함 | 주기 → 공개 중(Y) 또는 공개 중 + 갱신 미반영 안내 |
| 게시(모든 경우) | 다른 기기의 요청이 먼저 반영 | 공개 기록 | 공개 중 | 다시 보내지 않고 지금 공개 중인 사본을 알림 |
| 게시 요청 취소 | 철회 미도착 | X + 철회 대기 | 확인 못 함 | 주기가 끝냄 → 비공개 |
| 게시 요청 취소 | X가 이미 반영돼 있었음 | 공개 기록 | 공개 중 | 철회하지 않는다 |

남는 한계: 공개 중인 글을 갱신할 때, 같은 순간 다른 기기가 같은 이름·같은 사진으로 갱신했다면 그 공개본을 이 기기의 앞 요청으로 보고 새 선택을 한 번 더 보낸다(r2-m2). 사용자가 방금 검토한 선택으로 갱신되는 것이고 철회는 아니다.

### 운영 적용 순서 (총괄)

SQL을 먼저 적용하고 앱(Pages)을 나중에 내보낸다. 순서가 뒤바뀌어도 데이터는 바뀌지 않는다: 앱이 먼저 나가면 위 "서버가 이전 정의" 줄대로 동작한다. 지금 배포된 앱은 expected 0을 보내지 않으므로 SQL만 먼저 있어도 달라지는 것이 없다.

1. **적용 전 읽기(기록).** 개수·상태만 읽는다. 본문·토큰·키는 꺼내지 않는다.

   ```sql
   -- 현재 정의: 해시, definer, search_path, 권한
   select p.oid::regprocedure as fn, md5(p.prosrc) as src_md5, p.prosecdef as definer, p.proconfig::text as config, p.proacl::text as acl
   from pg_proc p where p.oid='haedo_blog_private.unpublish(uuid,bigint,uuid)'::regprocedure;
   -- 행 수
   select (select count(*) from haedo_blog_private.posts) posts, (select count(*) from haedo_blog_private.assets) assets,
          (select count(*) from haedo_blog_private.receipts) receipts, (select count(*) from haedo_blog_private.publications) publications,
          (select count(*) from haedo_blog_private.profiles) profiles;
   -- 공개 행: 활성 수와 revision 분포
   select active, revision, count(*) from haedo_blog_private.publications group by 1,2 order by 1,2;
   ```

   - 격리 PostgreSQL에서 이전 정의의 `md5(prosrc)`는 `ec59cc1e58b1f5db02093ec138116744`였다. 운영 값이 다르면(줄바꿈 차이 포함) 적용하지 않고 `pg_get_functiondef`로 본문을 저장소 310–327행과 대조한다.
   - definer `true`, config `{search_path=pg_catalog}`, 실행 권한은 `authenticated`.
2. **적용.** `supabase/migrations/20261111120000_life_blog_withdraw_before_publication.sql` 파일 전체(한 문장)를 그대로 적용한다. 다른 SQL은 없다. 이 마이그레이션에는 Edge 함수 배포가 없다(같은 출시의 `haedo-blog-media` 재배포는 아래 절).
   - 적용 문장은 전후 행 수·해시가 다르면 예외로 되돌린다. 적용 중 블로그 표에 쓰기가 끼면(기기의 저장·동기화) 예외가 날 수 있으니, 기기 동기화가 쉬는 때 적용한다. 예외가 나면 데이터와 정의는 그대로이므로 다시 실행한다.
   - 이 SQL의 검증은 PostgreSQL 16.15에서 했다. CI는 17에서 같은 계약을 돌린다(`npm run test:sql-replay` 4.8 단계). 운영 판과 다르면 CI 결과를 먼저 본다.
3. **적용 후 확인.**

   ```sql
   -- 정의가 바뀌었고 나머지는 그대로
   select md5(p.prosrc) as src_md5, p.prosecdef as definer, p.proconfig::text as config, p.proacl::text as acl,
          position('p_expected_revision not between 0 and' in p.prosrc) > 0 as accepts_zero
   from pg_proc p where p.oid='haedo_blog_private.unpublish(uuid,bigint,uuid)'::regprocedure;
   -- 1의 행 수·분포 쿼리를 다시 실행해 같은지 본다
   ```

   - 격리 PostgreSQL에서 새 정의의 `md5(prosrc)`는 `bf1f63852836b998dd57a7104349aa95`였다. `accepts_zero`는 `true`, definer·config·acl은 1과 같아야 한다.
   - 행 수와 분포는 1과 같아야 한다(설치 자체가 다르면 예외로 되돌린다).
   - 적용 뒤 운영에서 철회를 시험 호출하지 않는다. expected 0 호출은 그 글에 비공개 행과 영수증을 만든다.
4. **앱 배포** 뒤, 소유자 기기에서 사진 없는 시험 글로 확인할 것(에이전트 검사로 대신하지 않음): 게시 응답이 끊긴 상황은 만들기 어렵다. 평소 게시 → 철회 → 다시 게시가 그대로 되는지, 철회한 글의 주소가 열리지 않는지만 본다.

### 되돌리기 (소유자 승인 뒤에만)

이전 정의로 바꾸는 문장 하나다. 사용자 데이터를 지우지 않는다. 그동안 생긴 비공개 행(공개된 적 없는 글의 revision 1 행)과 빈 프로필 행은 남긴다. 이전 정의는 이 행을 일반 철회 글의 행처럼 다룬다. 되돌리면 앱은 위 "서버가 이전 정의" 줄대로 동작한다.

```sql
create or replace function haedo_blog_private.unpublish(p_post_id uuid,p_expected_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); h bytea; prior haedo_blog_private.receipts%rowtype; p haedo_blog_private.publications%rowtype; r jsonb;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 if p_post_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740990 then raise exception using errcode='22023',message='life_invalid_request'; end if;
 h:=sha256(convert_to(jsonb_build_array('unpublish',p_expected_revision)::text,'UTF8'));
 perform pg_advisory_xact_lock(hashtextextended('blog:'||who::text||':'||p_post_id::text,0));
 select * into prior from haedo_blog_private.receipts where owner_id=who and post_id=p_post_id and operation_id=p_operation_id;
 if found then if prior.request_hash<>h then raise exception using errcode='22023',message='life_operation_mismatch'; end if; return prior.result; end if;
 select * into p from haedo_blog_private.publications where owner_id=who and post_id=p_post_id for update;
 if not found then return '{"status":"missing"}'::jsonb; end if;
 if p.revision<>p_expected_revision then return jsonb_build_object('status','conflict','revision',p.revision); end if;
 update haedo_blog_private.publications set active=false,snapshot=null,media=null,revision=revision+1,updated_at=clock_timestamp() where owner_id=who and post_id=p_post_id;
 r:=jsonb_build_object('status','stored','revision',p.revision+1);
 insert into haedo_blog_private.receipts(owner_id,post_id,operation_id,request_hash,result) values(who,p_post_id,p_operation_id,h,r);
 return r;
end $$;
notify pgrst,'reload schema';
```

- `create or replace`는 권한을 유지한다. 되돌린 뒤 `md5(prosrc)`가 `ec59cc1e58b1f5db02093ec138116744`인지 본다.
- 이 문장은 `20261017144744_life_blog_originals.sql` 310–327행과 같다(격리 PostgreSQL에서 다시 적용해 같은 해시를 확인했다).

### 알고 두는 것

- 서버가 이전 정의인 동안 앱이 먼저 나가면, 끝내지 못한 철회를 주기마다 다시 보내며 그때마다 브라우저 콘솔에 400이 한 줄 남는다. SQL을 먼저 적용하므로 고치지 않았다.
- 같은 탭의 게시·철회가 그 탭의 주기 확인(공개 head 읽기, 최대 30초)이 잠금을 쥔 동안 눌리면 10초 뒤 `다른 탭에서 처리 중입니다`라고 답할 수 있다. 사진 수 읽기는 4초로 끊었지만 head 읽기 자체가 느린 경우는 남아 있고, 문구가 같은 탭을 구분하지 않는다.
- `마지막 선택 미반영`은 누름이 실패한 기기의 기록에만 있다. 같은 계정의 다른 기기에는 `공개 중`만 보인다.
- 한 탭이 보낸 요청을 다른 탭이 끝낸 경우, 보낸 탭의 열린 검토 패널은 다음 주기(30초)나 다음 조작까지 `확인하지 못함`으로 남을 수 있다. 공개 상태 기록의 변경을 탭 사이에 알리는 경로가 없다(저장소의 탭 간 알림은 글·자료 변경만 다룬다).

### 확인하지 못한 것

- 이 환경에는 PostgreSQL 16만 있다. SQL 검사는 16.15에서 돌렸다. CI는 17이다.
- Docker가 없어 `scripts/check-blog-backend.mjs`와 `tests/integrated-release-installation.cjs`는 실행하지 못했다. 뒤의 것은 고정 목록·해시 부분만 따로 계산해 맞췄다.
- 실제 기기와 실제 끊긴 연결에서의 동작은 확인하지 않았다. 브라우저 검사는 요청을 가로채 끊김을 만들었다.

## 2026-11-11 공개 사본 ICC 조각 검사 (Edge `haedo-blog-media` 재배포, 운영 미적용)

공개 사본 허용 목록에 ICC 프로필 조각 묶음(JPEG APP2 `ICC_PROFILE`)의 순번·개수·총 길이 검사를 더했다(커밋 `620b480`). 클라이언트(`blog-sync.js` 공개 사본 검사)와 Edge가 같은 규칙을 쓴다. 클라이언트만 먼저 나가도 공개는 더 엄격해질 뿐이라 순서 제약은 없다. Edge가 옛 판이면 서버 쪽 검사만 옛 규칙으로 남는다.

1. **적용 전 기록.** 현재 Edge 버전 번호와 `verify_jwt`(꺼짐이어야 한다)를 적는다.
2. **배포.** 파일은 `supabase/functions/haedo-blog-media/index.ts` 하나다(가져오는 공유 모듈 없음). SHA-256 `266b045617f757af21f9917b03a483506ea04e26f4d434c026125f7a1bbba232`(main `c767df3` 판은 `c2dc755a87d1cd156772c7205bd2de8746105ba7adfb2f783196fef255788249`). JWT 게이트 끔을 유지한다. 비밀값은 바꾸지 않는다.
3. **배포 후 확인.** 버전 번호가 1 올랐는지, 존재하지 않는 공개 사진 요청이 404·`no-store`·`nosniff`인지(위 "Edge `haedo-blog-media` 배포" 확인과 같다). 실제 공개 사진의 읽기는 소유자 기기에서 기존 공개 글 하나를 열어 본다(에이전트가 공개 글을 새로 만들지 않는다).
4. **되돌리기.** main 판(`c2dc755a…`)을 같은 방법으로 다시 배포한다. 데이터 변경이 없다.
