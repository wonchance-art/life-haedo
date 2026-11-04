# AI 글 표시 — 기본 작성기의 작성 주체 구분 (2026-11-02)

근거: [글쓰기·메모 AI 적용 검토](../life-tools-design/writing-ai-review.md) 묶음 A. 외부 AI 호출·전송은 없다. 소유자가 다른 AI 앱이나 OS 글쓰기 도구에서 가져온 문장에 출처를 남기는 기능이다. 참고 사례는 iA Writer Authorship(사람/AI 구분, 사람이 고친 부분은 사람 글)이다.

## 소유자 결정 (확정)

- **2026-11-02: 공개 글에는 AI 표시를 보이지 않는다.** 공개 사본(`life-blog-public-v1`)은 `author` 속성을 갖지 않는다. 클라이언트 `Blog.publicSnapshot()`과 서버 `haedo_blog_private.publish`가 같은 규칙으로 그 속성만 지우고, `Blog.validateSnapshot()`은 표시가 남은 공개 사본을 거부한다. 미결 선택이 아니다. 바꾸려면 새 소유자 결정이 필요하다.
- **2026-11-04: AI 글 표시를 내 읽기 보기에도 보인다(소유자 결정, 총괄 경유).** 범위는 내 글(단일 글) 읽기 화면과 비공개 연재 읽기다. 공개 글은 계속 표시하지 않는다(위 결정 유지). HTML 읽기 파일(내보내기)은 이번 결정 범위가 아니므로 지금처럼 표시를 그리지 않는다.
- (대체됨) 11-02 설계의 "내 글 읽기 화면·HTML 읽기 파일도 표시를 그리지 않는다, 편집기 안에서만"은 소유자 결정이 아니라 구현 설계였고, 위 11-04 결정으로 읽기 화면 부분을 바꿨다.

## 사용 장면

- **시작:** 다른 AI 앱·Apple 글쓰기 도구에서 받은 문장을 기본 작성기에 붙여넣거나 이미 쓴 글에 섞여 있다.
- **입력:** 그 문장을 선택해 `서식` → **AI 글 표시**를 누르거나, 선택 없이 눌러 다음 붙여넣기 한 번을 AI 글로 받는다.
- **종료 결과:** 저장·자동 임시저장·다른 기기·백업 복원 뒤에도 같은 구간이 AI 글로 남는다. 그 안을 직접 고친 글자는 내 글이 된다. 공개 글에는 표시가 없다.

## 저장 형식

- Quill Delta 인라인 속성 `author` 하나, 값은 문자열 `"ai"`만. 문자열 insert에만 붙고 사진 embed(`{photo}`)에는 붙지 않는다. 속성이 없으면 내 글이다.
- 별도 sidecar 문서를 만들지 않았다. 저장·ID 교체·BlogSync·전체 백업·글 ZIP·보존 ZIP·자료 이동은 ops를 그대로 옮기므로 표시가 자동으로 따라간다. 이 가정은 아래 검사로 확인했다(깨지는 경로 없음).
- 형식 번호(v1/v2)는 올리지 않았다. 표시 없는 글은 이전과 같은 ops 그대로 저장·동기화·공개된다.
- 검증: 클라이언트 `PhotoPost.validate`(ops 속성 검사)와 서버 `haedo_blog_private.valid_document`가 `author:"ai"`를 문자열 insert에서만 받는다. 다른 값(`"human"`·`"AI"`·`true`·`null`·객체), embed 위 표시, 알 수 없는 속성은 계속 거부한다.

## 편집기 동작 (`assets/life/photo-post-ui.js`)

- Quill 인라인 포맷 `author`(`span.photo-ai-text`, `data-author="ai"`)를 등록하고 작성기의 `formats`에 추가했다.
- **AI 글 표시** 아이콘 버튼(Lucide `sparkle`, 접근 가능한 이름 `AI 글 표시`, `title`, `aria-pressed`)은 `서식` 펼침 안에 있다.
  - 선택이 있으면: 선택한 글자가 모두 AI 글이면 표시 해제, 아니면 선택 전체를 AI 글로 표시. 줄바꿈·사진만 고르면 "AI 글로 표시할 글자를 선택해 주세요".
  - 선택이 없으면: "다음 붙여넣기를 AI 글로" 1회 대기를 켜고 끈다. 버튼을 다시 누르면 취소되고(터치·키보드 공통), 다음 붙여넣기 한 번(사진 붙여넣기 포함)·Esc·다른 글로 이동·명시 저장 때도 꺼진다.
  - 상태는 기존 상태 줄(`role=status`)에 짧게 알린다: 대기 `AI 붙여넣기 대기`(320px 상태 폭 108px에 들어감, 화면 낭독기에는 "다음 붙여넣기 한 번을 AI 글로 표시합니다. AI 글 표시 버튼을 다시 누르면 취소합니다."를 함께 읽음), `AI 글로 표시했어요`, `AI 글 표시를 해제했어요`, `붙여넣은 글을 AI 글로 표시했어요`, `AI 글 붙여넣기 대기를 껐어요`.
  - 문구 순서: 오류 > `한글 입력 중…` > AI 대기·알림 > 저장 상태. 알림은 다음 입력이나 자동 저장 완료 때 지워져 `자동 저장됨`이 다시 보인다.
- **사람이 고친 부분은 사람 글:** Quill은 커서 앞 글자의 서식을 이어받는다. `text-change`에서 사용자 입력이 물려받은 `author` 구간을 기록하고(이후 변경은 `Delta.transformPosition`으로 위치를 따라감) 그 변경 직후의 마이크로태스크에서 표시를 지운다. 다음 입력보다 먼저 끝나므로 다른 입력과 묶이지 않는다. 대상은 직접 입력, 대기 없는 붙여넣기, OS 치환 입력(`insertReplacementText`·선택 치환)이다. 대기 붙여넣기와 실행 취소/다시 실행 재생(`history.ignoreChange`)은 기록된 작성 주체를 그대로 둔다. AI 글 일부를 지우는 것은 그대로 둔다.
- **한글 조합:** 조합 중(`compositionstart`~`compositionend`, Quill `composition.isComposing`)에는 서식을 바꾸지 않는다. Quill은 조합 결과를 `compositionend` 뒤 마이크로태스크에서 한 번의 변경으로 내보내고, 그 조합분만 바로 뒤에 정리한다(다음 음절의 조합이 시작되기 전). 정리할 때 조합이 열려 있으면 다음 `compositionend`까지 미룬다. 조합 중 입력·커서·상태 문구(`한글 입력 중…`)·자동 임시저장 규칙(300ms 유휴/최대 2000ms, hidden/pagehide flush, 조합 중 강제 확정 없음)은 그대로다. 명시 저장·백업·사본 저장 직전에도 조합 중이 아니면 정리한다.
- **실행 취소:** 정리는 입력 변경마다 바로 뒤에 하므로 Quill 실행 취소 스택의 맨 위는 항상 그 입력의 단계다. 정리는 그 단계에 합친다(700ms 묶음 시간이 막 지난 경우에도 `history.lastRecorded`를 그 순간만 조정해 같은 단계에 둔다). 그래서 입력이 여러 단계(700ms 이상, 쉼 없는 타이핑·여러 음절 조합)에 걸쳐도 실행 취소 한 번은 그 단계의 글자만 지우고, 앞 단계의 사람 글을 AI 글로 되돌리지 않는다. 다시 실행은 사람 글을 사람 글로 되살린다. 표시·해제 자체도 실행 취소·다시 실행된다.
  - 2026-11-02 독립 검수 M1: 이전 구현은 120ms 쉼 뒤 모든 구간을 한꺼번에 정리해 맨 위 단계에 합쳤다. 입력이 여러 단계에 걸치면 실행 취소 한 번에 앞 단계의 사람 글이 통째로 AI 글로 돌아갔다(재현: 90ms 간격 16키). 변경마다 바로 정리하도록 고쳤다.
- 화면: 옅은 바탕(`--paper-2`)과 점선 밑줄(`--ink-soft`, 흰 바탕 대비 5.6:1)로 구분한다. 색만으로 구분하지 않는다. 앱은 밝은 테마 하나(`color-scheme: light`)라 어두운 테마 대비는 해당 없음.
- 버튼 위치 결정: 처음에는 굵게·링크 옆 한 줄 도구에 두었으나 실측에서 390px·393px에 `사진` 글자가 두 줄로 꺾이고 320px에 가로 넘침(316px > 280px)이 생겼다. 그래서 `서식` 펼침 안으로 옮겼다. 한 줄 도구의 폭은 이전과 같다(320~768px 측정).

## OS 글쓰기 도구

- Apple 글쓰기 도구·자동 고침이 쓰는 `beforeinput insertReplacementText`와 선택 치환(`execCommand('insertText')`)을 Chromium에서 모사했다. 자동 임시저장 반영, 실행 취소로 원래 AI 글과 표시 복원, 입력 유지 확인.
- 치환된 글을 AI 글로 추정하지 않는다. 필요하면 소유자가 직접 표시한다.
- 실제 Apple 기기의 글쓰기 도구 동작은 검증하지 않았다(소유자 실기기 확인 항목).

## 이전 버전 앱과의 호환

이전 클라이언트(업데이트 전 PWA)는 `author`를 모르는 서식으로 보고 검증에서 거부한다. 코드로 확인한 결과 지우거나 덮어쓰는 경로는 없다.

- BlogSync 수신: `download()`의 `Blog.hydrate` 실패가 `invalid_remote_data`가 되고 `commitBlogSync` 전에 멈춘다. 새 글은 설치되지 않고, 이미 가진 이전 판은 그대로다. 서버 행·사진은 바뀌지 않고 아무것도 보내지 않는다(`tests/ai-authorship.test.cjs`). `vanish`는 서버 목록에 행이 없을 때만 동작하므로 해당 없음.
- 같은 기기의 이전 탭: `listBlogSyncStates`는 요약만 읽고, 글 읽기·저장은 `validate` 실패로 오류를 낸다. 이전 판으로 덮어쓰는 저장은 `previous` 검증에서 거부된다. 삭제는 사용자의 명시 삭제만이다.
- 전체 백업·글 ZIP 복원: 이전 앱에서는 `readBackup`의 검증 실패로 해당 글만 복원되지 않는다. 복원은 새 사본이라 기존 데이터를 바꾸지 않는다(코드 확인, 실행 검사 없음).
- 업데이트하면 같은 기기가 두 글을 정확히 받는다(같은 검사).

## 서버와 출시 순서

- 새 마이그레이션 `supabase/migrations/20261102110000_life_blog_ai_authorship.sql`: `valid_document`(author 규칙 한 줄 추가)와 `publish`(공개 사본에서 author 제거)만 다시 정의한다. 나머지 본문은 `20261101091500`과 글자 단위로 같다(`tests/blog-ai-authorship-install-bundle.test.cjs`). 저장된 글을 고치지 않는다.
- 운영 설치 파일 `supabase/operations/20261102-blog-ai-authorship-install.sql`(생성기 `scripts/build-blog-ai-authorship-install.mjs`): 한 DO 문, 행 수 비교 보호, 결과 확인 5개. **실행하지 않았다.**
  - 선행 확인: 바꾸기 전에 두 함수의 현재 본문(`prosrc`) md5가 저장소 `20261101091500` 정의(`valid_document` `012fb393…`, `publish` `ea61d16b…`) 또는 이 설치의 정의(다시 실행)와 같아야 한다. 다르면 예외로 멈추고 아무것도 바꾸지 않는다. PostgreSQL은 `$$` 사이 본문을 그대로 보관하므로 마이그레이션·기존 설치(EXECUTE)로 적용한 정의는 같은 값이다. 운영 정의가 다른 경로로 고쳐졌다면 이 설치는 멈추며, 그때는 운영 본문과 차이를 먼저 확인한다. SQL 재생 검사가 다시 실행 통과와 본문이 다를 때 멈춤·무변경을 확인한다.
- **서버를 클라이언트보다 먼저 적용해야 한다.** 서버가 이전 정의면 표시가 있는 글의 서버 보관이 `life_blog_invalid_document`로 거부된다. 글은 기기에 남고 BlogSync가 재시도하지만, 다른 기기로 가지 않는다.
- `20261101-account-sync-install.sql`을 다시 실행하면 두 함수가 이전 정의로 돌아간다. 그때는 이 설치도 다시 실행한다. SQL 재생 검사가 이 순서로 두 설치를 적용해 카탈로그가 같음을 확인한다.

## 검증 (2026-11-02, Linux 컨테이너)

- `npm test` 1754/1754, `npm run check` 통과.
- 단위: `tests/ai-authorship.test.cjs` 6개 — 검증 허용/거부, 공개 사본 제거·거부, 글 ZIP·pack/hydrate 왕복, 두 기기 BlogSync 왕복, 이전 클라이언트 보존, 전체 백업·보존 ZIP 왕복.
- SQL: `npm run test:sql-replay`(PostgreSQL 16.15, 격리 클러스터) — 30개 마이그레이션 재생, 두 설치 재적용 후 카탈로그 783항목 동일, `supabase/tests/blog-ai-authorship.sql` 28개 단언. 이전 정의로 되돌리면 두 번째 단언(`author=ai on text validates`, 첫 단언은 표시 없는 글)에서 실패함을 확인. `scripts/check-blog-backend.mjs`는 Docker 데몬이 없어 실행하지 못했고, 같은 SQL 고정물(blog-bootstrap → 마이그레이션 → `blog-originals.sql` 114개 → `blog-ai-authorship.sql` 28개 → `blog-installation.sql` 15개 → 재적용 비교)을 로컬 PostgreSQL 16으로 실행했다.
- 브라우저: `tests/ai-authorship-browser.cjs`(Chromium, 1440×1000과 390×844 터치) — 선택 표시·저장·재열기, 표시 안 직접 입력, CDP `Input.imeSetComposition` 한글 조합(조합 중 AI 구간이 나뉘지 않음·조합 뒤 정리·임시저장. 조합 중 정리를 막는 방어 분기 `imeActive()` 자체는 이 검사로 따로 증명되지 않는다 — 재검수 변이 확인), 대기 붙여넣기/대기 없는 붙여넣기/Esc, 해제, 실행 취소·다시 실행, 치환 입력, 공개 사본에 표시 없음, 서버 비공개 사본 표시 유지, 두 번째 브라우저의 동기화 수신, 여러 실행 취소 단계에 걸친 입력(⑨ 90ms 간격 16키, ⑩ 1.4초 넘는 다섯 음절 조합)의 실행 취소·다시 실행 반복, 700ms 경계 직후 정리의 단계 합침(⑪, 시계를 800ms 건너뛰어 재현), 콘솔·페이지 오류 0, 외부 요청 0. 변이 확인(커밋하지 않음): 정리를 이전 120ms 일괄로 되돌리면 ⑨·⑩이 실패하고, 단계 합침(`lastRecorded` 조정)을 지우면 ⑪이 실패한다. 정리 호출을 끄면 ②가 실패한다.
- 회귀 브라우저 검사(같은 컨테이너, BASE_URL 로컬 서버): `photo-post-browser` 16, `blog-writing-completion-browser` 10, `blog-autosave-browser` 4, `blog-default-server-browser` 8, `blog-public-browser` 6, `blog-manager-browser` 4, `account-blog-receipt-browser` 4, `photo-post-evidence-browser` 6, `full-backup-browser` 8, `life-external-discovery-pwa-browser` 9(캐시 `haedo-v175`) 모두 통과.

## 미검증·후속

- 실제 Apple 기기(iPhone·iPad·Mac Safari)의 글쓰기 도구·한글 IME·붙여넣기 동작, 실제 기기 시각 확인.
  - 소유자 실기기 확인 항목: AI 글 가운데에서 한글을 쉬지 않고 여러 음절 입력 → 자모 누락·중복이 없고 입력한 글자가 내 글이 되는지. 정리는 앞 음절의 compositionend 직후에 일어나며, Safari·Chrome이 compositionend와 다음 compositionstart를 같은 태스크에서 보내면 그 사이에 서식이 바뀐다(Chromium CDP 모사로는 재현 불가, 재검수 마이너 1). 문제가 나오면 조합분 정리를 조합이 없는 첫 순간으로 미룬다.
- (완료 2026-11-02) 운영 DB 적용 16:15 UTC·PR169 병합 `c03011c`·배포·라이브 확인. 기록은 [로드맵](../life-tools-design/roadmap.md) 묶음 A 절.
- (해결) 새 브라우저 검사는 총괄이 CI 목록(`.github/workflows/pages.yml`)에 넣었다(`92d906d`).
- 화면 낭독기 실제 안내(VoiceOver 등)로 대기·표시 상태를 듣는 확인은 하지 않았다(검수 마이너 6, 후속).
- 같은 기기의 업데이트 전 탭이 표시가 있는 글을 열면 형식 오류로 멈춘다. 지우지는 않지만 업데이트 안내가 없다(검수 마이너 7, 후속).
- 후속 후보: 표시 구간 수 요약, AI 글 안에서 잘라 옮긴 문장의 표시 유지(현재는 대기 없는 붙여넣기라 내 글이 된다), 묶음 B의 수락한 제안 구간에 같은 표시 사용.

## 반대 검토

- **가정이 틀릴 수 있는 곳:** 소유자가 표시를 실제로 쓸지. 쓰지 않아도 저장 형식·공개·기존 글은 바뀌지 않는다.
- **더 단순한 대안:** 표시 없이 메모로 남기기. 구간 단위 수정 추적이 불가능해 iA Writer식 "고친 부분은 내 글"을 지킬 수 없다.
- **실패 후 복구:** 표시는 서식 속성이라 해제해도 본문은 바뀌지 않는다. 서버 적용 전 배포 시 서버 보관만 실패하고 기기 글은 남는다.

## 내 읽기 보기의 AI 표시 (2026-11-04, 구현)

2026-11-04 총괄 결정으로 AI 세션이 맡았다. 다른 세션 파일은 정해진 줄 범위만 고쳤다.

- **`blog.js`**
  - 비공개 화면 전용 `privateReadingSnapshot(doc, opts)`·`validateReadingSnapshot`을 추가했다. 형식은 `life-blog-private-reading-v1`이다.
  - 공개 사본과 같은 내부 투영을 쓰되 `author`를 남긴다. 전송·저장·공개에는 쓰지 않는다.
  - 공개 검증 `validateSnapshot`은 이 형식을 거부한다. `publicSnapshot` 결과는 이전과 같다.
- **`blog-public-ui.js`:** `privateView`이고 읽기 사본일 때만 별도 검증을 쓴다. `author:"ai"` 구간을 `span.blog-ai-text`로 감싼다.
- **`photo-post-ui.js` `renderRead`:** 한 줄을 추가했다. 내 글 읽기 화면(`portable`이 아닐 때)만 같은 `span.blog-ai-text`로 감싼다. HTML 읽기 파일(`portable`)은 감싸지 않는다.
- **`workbench-ui.js`:** 연재 읽기 `renderPhoto` 호출 한 곳만 `privateReadingSnapshot`으로 바꿨다.
- **`blog-public.css` `.blog-ai-text`**
  - 옅은 바탕에 점선을 **배경 이미지**(아래 가장자리의 점 반복)로 그린다.
  - 같은 글자에 밑줄(`u`)이나 링크 밑줄이 있어도 덮이지 않고, 색만으로 구분되지 않는다(검수 m1).
  - 글자 크기·자리·간격은 바꾸지 않는다. 편집기의 `photo-ai-text`(디자인 세션 파일)는 아직 `text-decoration` 점선이라 같은 겹침이 남는다(후속).
- **검사**
  - 단위(`ai-authorship.test.cjs`):
    - 읽기 사본은 표시를 남기고, 공개 사본에는 없다.
    - 두 검증기는 서로의 형식을 받지 않는다.
    - 공개 연재 패키지는 순서 있는 공개 링크(토큰)뿐이다. `ops`·`attributes`·`author`·본문 키가 들어갈 수 없다(검수 m3을 검사로 확인).
  - 브라우저(`blog-series-browser`, 실제 연재 경로):
    - 표시한 세 문장만 보인다(일반, 밑줄과 겹침, 링크와 겹침).
    - 세 문장 모두 점선 배경과 바탕이 있고, 크기와 inline 배치가 그대로다.
    - 본문 글자가 그대로다.
    - 공개 사본·공개 렌더의 표시는 0이고, 공개 렌더는 읽기 사본을 거부한다.
    - 1440·820·390 스크린샷에 가로 넘침이 없다.
  - 브라우저(`ai-authorship-browser` ①): 내 글 읽기 화면이 표시한 구간만 정확히 표시한다. 이전 단언 "읽기 화면 0개"는 11-04 결정에 따른 계약 변경으로 바꿨다.
  - 변이:
    - `workbench-ui.js`를 이전 호출로 되돌리면 연재 단계가 실패한다.
    - span의 `privateView` 조건은 방어용이다. 공개 렌더는 먼저 `validateSnapshot`이 `author`가 있는 사본을 거부하므로, 그 조건만 지워서는 동작이 바뀌지 않는다. 그래서 이를 잡는 검사는 거부 단언(공개 렌더가 읽기 사본과 표시가 남은 사본을 거부)으로 둔다.
  - 서버 `publish`의 표시 제거는 기존 SQL 검사(`blog-ai-authorship.sql`)가 지킨다.
- **후속**
  - 화면 읽기 프로그램용 구분(검수 m2, 위 마이너 6과 같다). 숨은 안내 문구를 넣으면 복사·`innerText`가 바뀌어서 이번에는 넣지 않았다.
  - 편집기 표시의 밑줄 겹침.
- **미검증:** 실제 Apple 기기의 시각 확인.
