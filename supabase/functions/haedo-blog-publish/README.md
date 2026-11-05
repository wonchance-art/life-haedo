# Markdown 공개 Edge 경계

`haedo-blog-publish`는 비공개로 저장된 `life-post-md-v1`을 기존 `life-blog-public-v1` 공개 사본으로 게시한다. v1/v2는 기존 RPC 경로를 그대로 쓴다. 운영 설치·배포는 총괄만 실행한다.

## 요청과 인증

POST JSON은 `p_post_id`, `p_expected_revision`, `p_expected_publication_revision`, `p_operation_id`, `p_photo_ids`, `p_author`, `p_copies` 일곱 필드만 받는다. 사진 미선택은 `[]`와 `{}`다. 클라이언트 본문·ops·원문 해시·owner/session·공개 스냅샷은 받지 않는다.

1. 사용자 JWT 형태의 `Authorization: Bearer`가 필요하다. Auth `/auth/v1/user`가 실제 사용자·비익명 계정을 확인한다. `user_metadata`는 권한에 사용하지 않는다.
2. 같은 사용자 JWT로 `life_blog_markdown_publish_prepare`를 호출한다. DB가 현재 세션과 글 소유권을 확인하고 원문·revision·원문 해시·DB에서 얻은 owner/session을 반환한다. 완료 영수증이 있으면 원문을 다시 투영하거나 게시하지 않는다.
3. `projection.mjs`가 유지 중인 브라우저 codec과 공개 투영을 그대로 사용한다. SQL에는 AI 표시가 빠진 선택 본문 ops와 원래 사진 ID만 보낸다.
4. Auth `/auth/v1/user`로 같은 사용자를 다시 확인한 직후 서비스 전용 `life_blog_markdown_publish_commit`을 호출한다. DB가 세션·원문 해시·원문/공개 revision·사진 사본을 다시 확인하고 snapshot/media/영수증을 원자 저장한다.

배포 시 `verify_jwt`는 켜 둔다. 다만 최신 플랫폼 문서에 따르면 이 관문은 이행 호환을 위해 API 키도 허용할 수 있으므로, 관문 통과를 사용자 인증으로 간주하지 않는다. handler의 두 번의 Auth 확인과 SQL 세션 검사를 생략하지 않는다.

환경 변수는 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`이며 키 객체의 `default` 항목을 쓴다. 기존 `SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`는 공용 키 helper의 호환 경로다. 새 API 키는 `apikey`에만 보내며, 사용자 JWT와 서비스 자격은 다른 호출에서 쓴다. 별도 소유자 ID 비밀값이나 사용자 메타데이터 허용 목록은 추가하지 않는다.

## 예산과 실패

전체 요청 예산은 30초다. 입력 스트림 32 KiB, Auth 응답 16 KiB, 비공개 prepare 응답 3 MiB, 영수증/오류 응답 16 KiB로 제한한다. 각 네트워크 호출은 요청 취소와 남은 전체 예산을 함께 따른다. 공개 본문의 기존 글자·연산·바이트 제한은 공용 codec/model과 SQL이 검사한다.

성공은 기존 `{status, token, blogToken, revision}` 영수증이며 오류는 기존 BlogRemote 허용 코드 하나인 `{code}`다. 원문·업스트림 오류·키·JWT를 응답하거나 로그에 남기지 않는다. commit 응답 유실은 미확정 상태다. 클라이언트가 같은 operation ID와 같은 게시 의도를 다시 보내 DB의 기존 영수증을 받는다. 미확정 요청을 새 operation ID로 바꾸지 않는다.

## 배포 묶음과 검증

런타임 외부 npm/JSR/HTTP import는 없다. `index.ts`, `handler.mjs`, `projection.mjs`, `../_shared/supabase-keys.mjs`와 projection의 정적 import가 가리키는 저장소 `assets/life/`·`vendor/markdown-it/` 원본을 함께 묶는다. codec 사본을 함수 폴더에 만들지 않는다. `index.ts`만 수동 업로드하면 필요한 원본이 빠질 수 있다. 외부 런타임 의존성이 없어 함수별 패키지 lockfile은 추가하지 않는다. vendor 버전·라이선스는 저장소의 고정본을 따른다.

로컬 검사:

```sh
node --test tests/post-markdown-publish-handler.test.cjs tests/blog-publish-projection.test.cjs
deno check --no-config --no-lock supabase/functions/haedo-blog-publish/index.ts
```

확인한 런타임은 Deno 2.1.4다. 이 환경의 Deno 타입 검사는 저장소 Node 설정의 자동 탐색을 끄는 `DENO_NO_PACKAGE_JSON=1`과 시스템 인증서를 쓰는 `DENO_TLS_CA_STORE=system`으로 실행했다. Deno 타입 검사기가 사용하는 `@types/node@22.5.4`·`undici-types@6.19.8`은 개발용 캐시에만 내려받았으며 런타임 의존성이 아니다. 인증서 검증은 끄지 않았다. 실제 배포 번들은 미검증이며, 격리 PostgreSQL·브라우저 왕복 재현은 [설치 안내](../../operations/post-markdown-publish-install.md#격리-검증-재현)에 있다.

2026-11-05 확인 자료: [Edge 인증 헤더](https://supabase.com/docs/guides/functions/auth-headers), [Auth 세션](https://supabase.com/docs/guides/auth/sessions), [API 키 이행](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys), [변경 기록](https://supabase.com/changelog). 2026-11-04 CLI v3의 로컬 기본 대상·호스팅 변경 확인 절차와 2026-11-10 예정 TLS CBC 제거를 확인했으며, 이 작업에서 운영 명령은 실행하지 않았다.
