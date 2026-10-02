# 해도 플랫폼

공개 홈에서 서비스를 안내하고, Google 로그인 후 개인 공간에서 연표·목표·습관을 사용한다. 빌드 없이 실행하는 일반 HTML·CSS·JavaScript 구조를 유지한다.

## 화면과 코드

- `index.html`: 공개 홈. 합성 예시만 표시한다.
- `login.html`: Google OAuth 진입 및 PKCE 콜백. 외부 URL로 돌아가는 `next` 값은 허용하지 않는다.
- `workspace.html`: 내 연표와 오늘의 습관, 진행 중인 목표, 백업·기존 기록 연결.
- `timeline.html`: 기존 연표 엔진. `assets/timeline-entry.js`가 서버에서 계정을 검증한 뒤 `app.js`와 `workspace.js`를 불러온다.
- `goals.html`, `habits.html`: 마감일·진행률·완료, 반복 요일·날짜별 완료·연속 실천 횟수.
- `assets/platform-auth.js`: Supabase 공식 SDK의 PKCE·토큰 갱신·탭 간 잠금을 사용한다. 저장된 토큰만으로 개인 화면을 열지 않고 서버 `getUser()` 결과를 확인한다.
- `assets/platform-store.js`: 기기 저장, 항목별 직렬 동기화, 서버 수정 시점 비교, 사본 선택.

## 연결 설정

다른 프로젝트를 재사용하지 않고 해도 전용 Supabase 프로젝트를 사용한다. `supabase/migrations/202610020001_platform.sql`을 적용한다. 테이블은 `haedo_documents`, `haedo_items`이며, `user_id`가 로그인 계정과 같은 행에만 접근하는 RLS를 SELECT/INSERT/UPDATE/DELETE 모두에 적용한다. 익명 역할에는 테이블 권한이 없다. 수정 시점은 서버가 만든다.

Google Auth Platform에서 웹 애플리케이션 OAuth 클라이언트를 만들고, 해당 전용 Supabase 프로젝트의 `/auth/v1/callback` 주소를 리디렉션 URI로 등록한다. 클라이언트 ID·Secret은 Supabase의 Google 제공자 설정에 입력한다. 저장소와 채팅에 Secret을 넣지 않는다.

Supabase Auth 설정:

- Site URL: 배포된 홈 주소.
- Redirect URLs: 배포된 `login.html` 주소와 그 `next` 쿼리 변형을 허용한다. 로컬 검증이 필요하면 `http://127.0.0.1:4173/login.html`도 제한적으로 추가한다.
- Google 제공자 활성화. `openid`, `email`, `profile` 범위만 요청한다.

설정 방법은 [Supabase Google 로그인 문서](https://supabase.com/docs/guides/auth/social-login/auth-google), [리디렉션 설정](https://supabase.com/docs/guides/auth/redirect-urls), [PKCE 흐름](https://supabase.com/docs/guides/auth/sessions/pkce-flow)를 따른다.

GitHub 저장소 Actions secrets에 `HAEDO_SUPABASE_URL`, `HAEDO_SUPABASE_KEY`를 등록한다. KEY는 `sb_publishable_` 형식만 사용한다. Pages의 배포 방식은 GitHub Actions로 설정한다. 배포 워크플로는 검사 후 `scripts/prepare-site.mjs`로 공개 파일만 모으고, 배포 산출물의 `assets/platform-config.js`에 공개 연결 값을 넣는다. 개인 기록, `.local/`, Git 메타데이터, 서버 Secret은 배포하지 않는다. Publishable key는 브라우저에 공개되므로 서버 RLS가 접근 제어의 기준이다.

저장소의 설정 파일은 빈 값이다. 연결되지 않았으면 로그인 화면은 준비 중으로 표시한다. 실제 제공자 설정과 계정별 RLS를 검증하기 전에는 기존 배포를 교체하지 않는다.

브라우저 SDK는 로컬에 보관한 `@supabase/supabase-js` 2.117.2 UMD와 MIT 라이선스를 사용한다. 앱 패키지 설치는 필요 없다.

## 데이터 보존과 연결

기존 `caeyeon_life_registry`, `caeyeon_life_doc_*`, `caeyeon_life_v2`, `caeyeon_life_cloud`의 값과 형식을 변경하지 않는다. 새 계정의 사본은 `caeyeon_life_account_<user-id>_registry`, `_doc_*`, `_items`에 분리한다. 로그아웃할 때 사본은 지우지 않으며 개인 화면을 닫는다. 다른 계정의 사본은 자동으로 불러오지 않는다.

기존 연표 연결은 백업 다운로드와 본인 기록 확인 후 새 ID의 사본을 생성한다. 같은 원본은 같은 계정에 중복 연결하지 않는다. JSON 가져오기도 기존 문서를 덮어쓰지 않는다. 전체 백업은 `haedo-platform-backup-v1`이며 연표와 목표·습관을 함께 포함한다. 구 `haedo-backup-v1` 가져오기를 지원한다. 연결 값과 로그인 토큰은 백업에서 제외한다.

서버 수정과 기기 수정이 겹치면 기기 사본을 유지한다. 목표·습관은 백업 후 서버 또는 기기 사본을 선택할 수 있다. 연표에서 충돌이 발생하면 전체 JSON 백업을 만들고 내 공간에서 새 사본으로 가져올 수 있다. 원격 삭제된 문서를 자동으로 다시 만들지 않는다.

## 검증 범위

`npm run check`, `npm test`가 정적 앱과 데이터·날짜·직렬 저장·로그아웃 보호를 검사한다. 브라우저는 개인 기록이 없는 별도 localhost 세션에서 확인한다. OAuth 모의 서버 검증과 실제 Google 로그인/RLS 검증은 구분한다. 운영 서버 테스트에는 익명 합성 자료만 사용하고 개인 기록을 출력하지 않는다.

서비스워커는 공개 앱 셸만 캐시한다. 개인 API와 Auth 응답은 캐시하지 않는다. 앱 셸은 오프라인에도 남지만, 개인 화면을 처음 열거나 다시 여는 경우 서버 계정 확인을 위해 연결이 필요하다. 이미 열린 화면의 수정은 기기에 저장하고 연결 후 동기화한다.

## 구현 검증 기록 (2026-10-02)

- 정적 검사와 회귀 검사 36개 통과. 기존 80건의 합성 기록 사본 연결, 원본 보존, 계정 분리, 날짜 경계, 충돌, 전송 중 수정 보존을 포함한다.
- 로컬 OAuth 모의 서버에서 PKCE 교환과 서버 사용자 확인, 목표 진행률 저장·완료·취소, 습관 반복 요일·체크·재로드, 새 빈 연표와 사건 수정·재로드를 확인했다. 다른 탭에서 로그아웃하면 열려 있던 개인 입력창도 닫히고 로그인 화면으로 돌아가는 것을 확인했다. 모의 서버는 배포하지 않는다.
- 해도 전용 실제 Supabase에 마이그레이션을 적용했다. 익명 합성 계정으로 소유자 읽기·쓰기, 타 계정 조회·수정·삭제 차단, 소유자 위조·변경 거부, 익명 권한 거부, 서버 시간 적용을 검사하고 전부 롤백했다. 보안 advisor 결과는 0건이었다.
- 실제 Google 로그인은 제공자 Client ID·Secret과 콜백 설정이 완료된 뒤 확인해야 한다. 설정 전에는 기존 공개 배포를 교체하지 않는다.
