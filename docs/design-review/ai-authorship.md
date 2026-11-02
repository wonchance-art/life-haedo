# AI 글 표시 — 기본 작성기의 작성 주체 구분 (2026-11-02)

근거: [글쓰기·메모 AI 적용 검토](../life-tools-design/writing-ai-review.md) 묶음 A. 외부 AI 호출·전송은 없다. 소유자가 다른 AI 앱이나 OS 글쓰기 도구에서 가져온 문장에 출처를 남기는 기능이다. 참고 사례는 iA Writer Authorship(사람/AI 구분, 사람이 고친 부분은 사람 글)이다.

## 소유자 결정 (확정)

- **2026-11-02: 공개 글에는 AI 표시를 보이지 않는다.** 공개 사본(`life-blog-public-v1`)은 `author` 속성을 갖지 않는다. 클라이언트 `Blog.publicSnapshot()`과 서버 `haedo_blog_private.publish`가 같은 규칙으로 그 속성만 지우고, `Blog.validateSnapshot()`은 표시가 남은 공개 사본을 거부한다. 미결 선택이 아니다. 바꾸려면 새 소유자 결정이 필요하다.
- 표시는 비공개 정보다. 내 글 읽기 화면·HTML 읽기 파일도 표시를 그리지 않는다. 편집기 안에서만 보인다.

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
  - 선택이 없으면: "다음 붙여넣기를 AI 글로" 1회 대기를 켜고 끈다. 다음 붙여넣기 한 번(사진 붙여넣기 포함)·Esc·다른 글로 이동·명시 저장 때 꺼진다.
  - 상태는 기존 상태 줄(`role=status`)에 짧게 알린다: `다음 붙여넣기를 AI 글로 표시 · Esc로 취소`, `AI 글로 표시했어요`, `AI 글 표시를 해제했어요`, `붙여넣은 글을 AI 글로 표시했어요`, `AI 글 붙여넣기 대기를 껐어요`. 오류가 있으면 오류가 우선한다.
- **사람이 고친 부분은 사람 글:** Quill은 커서 앞 글자의 서식을 이어받는다. `text-change`에서 사용자 입력이 물려받은 `author` 구간을 기록하고(이후 변경은 `Delta.transformPosition`으로 위치를 따라감) 120ms 뒤 표시를 지운다. 대상은 직접 입력, 대기 없는 붙여넣기, OS 치환 입력(`insertReplacementText`·선택 치환)이다. 대기 붙여넣기와 실행 취소/다시 실행 재생(`history.ignoreChange`)은 기록된 작성 주체를 그대로 둔다. AI 글 일부를 지우는 것은 그대로 둔다.
- **한글 조합:** 조합 중(`compositionstart`~`compositionend`, Quill `composition.isComposing`)에는 서식을 바꾸지 않는다. 조합이 끝난 뒤 정리한다. 조합 중 입력·커서·상태 문구(`한글 입력 중…`)·자동 임시저장 규칙(300ms 유휴/최대 2000ms, hidden/pagehide flush, 조합 중 강제 확정 없음)은 그대로다. 명시 저장·백업·사본 저장 직전에도 조합 중이 아니면 정리한다.
- **실행 취소:** 정리(표시 지우기)는 그 입력이 속한 실행 취소 단계에 합친다(`history.lastRecorded`를 그 순간만 조정). 그래서 실행 취소 한 번에 입력한 글자가 사라지고, 먼저 "AI 글로 다시 표시"되는 중간 단계가 없다. 표시·해제 자체도 실행 취소·다시 실행된다.
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
- **서버를 클라이언트보다 먼저 적용해야 한다.** 서버가 이전 정의면 표시가 있는 글의 서버 보관이 `life_blog_invalid_document`로 거부된다. 글은 기기에 남고 BlogSync가 재시도하지만, 다른 기기로 가지 않는다.
- `20261101-account-sync-install.sql`을 다시 실행하면 두 함수가 이전 정의로 돌아간다. 그때는 이 설치도 다시 실행한다. SQL 재생 검사가 이 순서로 두 설치를 적용해 카탈로그가 같음을 확인한다.

## 검증 (2026-11-02, Linux 컨테이너)

- `npm test` 1754/1754, `npm run check` 통과.
- 단위: `tests/ai-authorship.test.cjs` 6개 — 검증 허용/거부, 공개 사본 제거·거부, 글 ZIP·pack/hydrate 왕복, 두 기기 BlogSync 왕복, 이전 클라이언트 보존, 전체 백업·보존 ZIP 왕복.
- SQL: `npm run test:sql-replay`(PostgreSQL 16.15, 격리 클러스터) — 30개 마이그레이션 재생, 두 설치 재적용 후 카탈로그 783항목 동일, `supabase/tests/blog-ai-authorship.sql` 28개 단언. 이전 정의로 되돌리면 첫 단언에서 실패함을 확인. `scripts/check-blog-backend.mjs`는 Docker 데몬이 없어 실행하지 못했고, 같은 SQL 고정물(blog-bootstrap → 마이그레이션 → `blog-originals.sql` 114개 → `blog-ai-authorship.sql` 28개 → `blog-installation.sql` 15개 → 재적용 비교)을 로컬 PostgreSQL 16으로 실행했다.
- 브라우저: `tests/ai-authorship-browser.cjs`(Chromium, 1440×1000과 390×844 터치) — 선택 표시·저장·재열기, 표시 안 직접 입력, CDP `Input.imeSetComposition` 한글 조합(조합 중 서식 불변·조합 뒤 정리·임시저장), 대기 붙여넣기/대기 없는 붙여넣기/Esc, 해제, 실행 취소·다시 실행, 치환 입력, 공개 사본에 표시 없음, 서버 비공개 사본 표시 유지, 두 번째 브라우저의 동기화 수신, 콘솔·페이지 오류 0, 외부 요청 0. 정리 로직과 조합 보호를 각각 끄면 해당 단계가 실패함을 확인했다.
- 회귀 브라우저 검사(같은 컨테이너, BASE_URL 로컬 서버): `photo-post-browser` 16, `blog-writing-completion-browser` 10, `blog-autosave-browser` 4, `blog-default-server-browser` 8, `blog-public-browser` 6, `blog-manager-browser` 4, `account-blog-receipt-browser` 4, `photo-post-evidence-browser` 6, `full-backup-browser` 8, `life-external-discovery-pwa-browser` 9(캐시 `haedo-v174`) 모두 통과.

## 미검증·후속

- 실제 Apple 기기(iPhone·iPad·Mac Safari)의 글쓰기 도구·한글 IME·붙여넣기 동작, 실제 기기 시각 확인.
- 운영 DB 적용(총괄 관문), 배포 후 라이브 확인.
- 새 브라우저 검사는 CI 목록(`.github/workflows/pages.yml`)에 아직 없다. 작업자는 워크플로를 바꾸지 않는다.
- 후속 후보: 표시 구간 수 요약, AI 글 안에서 잘라 옮긴 문장의 표시 유지(현재는 대기 없는 붙여넣기라 내 글이 된다), 묶음 B의 수락한 제안 구간에 같은 표시 사용.

## 반대 검토

- **가정이 틀릴 수 있는 곳:** 소유자가 표시를 실제로 쓸지. 쓰지 않아도 저장 형식·공개·기존 글은 바뀌지 않는다.
- **더 단순한 대안:** 표시 없이 메모로 남기기. 구간 단위 수정 추적이 불가능해 iA Writer식 "고친 부분은 내 글"을 지킬 수 없다.
- **실패 후 복구:** 표시는 서식 속성이라 해제해도 본문은 바뀌지 않는다. 서버 적용 전 배포 시 서버 보관만 실패하고 기기 글은 남는다.
