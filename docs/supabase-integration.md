# 공용 인증·자료 가져오기 통합

2026-10-03 · PR #17 (`2b2a319615f9e079a2e19dfde67b85fe06071ae3`)과 Cloud 자료 모아보기를 `codex/cloud-platform-integration`에서 통합한다. 이 브랜치는 [초안 PR #19](https://github.com/wonchance-art/life-haedo/pull/19)로 연결했으며 기준 브랜치는 PR #17의 `codex/platform-home-auth`다. PR #17 자체의 갱신·병합·공개 배포를 뜻하지 않는다.

## 하나의 로그인과 계정별 자료

- `index.html`은 공개 홈, `workspace.html`은 개인 공간이다. 연표는 `timeline.html`, 자료 모아보기는 `life.html`에서 연다.
- Google OAuth·PKCE와 `HaedoAuth`의 공식 Supabase SDK **2.117.2**를 재사용한다. SDK는 `vendor/supabase/supabase.js` 한 개이며 추가 비밀번호 로그인이나 세션 복사를 두지 않는다.
- 보호 페이지는 서버 `getUser()` 검증 후 연다. 로그인되지 않은 사용자의 `life.html` 복귀 경로를 허용하지만 외부 URL·임의 쿼리는 거절한다.
- 계정 전환·로그아웃은 이전 화면과 입력창을 숨기고 요청·저장 핸들을 폐기한다. 같은 계정으로 다시 돌아오더라도 과거 인증·자료 응답이 적용되지 않도록 세대를 확인한다.
- 플랫폼 저장 큐도 요청을 시작한 계정·세대를 고정한다. 파일 읽기나 응답 JSON 해석 중 계정이 바뀌면 이전 결과를 새 계정에 저장하지 않는다.
- 명시 로그아웃은 공용 SDK의 정상 서버 로그아웃을 시도하고 기기에 로그아웃 상태를 남긴다. 만료 세션의 오프라인 실패가 새로고침으로 로그인 상태를 되살리지 않게 한다.

자료 화면은 아래 계약을 사용한다. `sync.connect()`의 무인자 호출은 공용 로그인 재개 API가 아니다.

```js
const user = await HaedoAuth.requireUser();
if (user) {
  const account = HaedoAuth.getAccount();
  const storage = HaedoLife.Storage.forAccount(account);
  const sync = HaedoLife.Sync.create({
    storage,
    core: HaedoLife.Core,
    remoteFactory: HaedoLife.PlatformRemote.create,
  });
  await sync.start();
}
```

어댑터는 공용 SDK를 빌려 자료 요청만 취소한다. Sync/Remote 폐기는 공용 SDK를 폐기하거나 로그아웃시키지 않는다. 로그인만으로 미연결 자료를 업로드하지 않는다. 작업공간의 동기화를 직접 선택한 뒤 기존 CAS·재시도 영수증·충돌 사본 보존을 사용한다.

## 기기의 기존 기록과 백업

IndexedDB의 계정별 고정 핸들에서 목록·active pointer·본문·검토 초안·작업 영수증·동기화 메타데이터를 제한한다. 기존 sync binding은 그 소유자 정보로 인정하며, 새 로컬 자료에는 별도 소유 메타데이터를 남긴다. 계정을 바꿀 때 기존 핸들과 진행 중 트랜잭션을 폐기하고 새 핸들을 만든다.

무소유 기존 자료는 자동으로 계정에 귀속시키지 않는다. 사용자가 직접 선택하면 새 ID의 계정 사본과 검토 초안을 만들고 원본을 보존한다. 이 사본은 자동 업로드하지 않는다. 기존 연표·`charts`도 자동으로 읽어 이전하지 않는다. 자료 화면의 연표 목록은 현재 계정의 registry만 읽어 정확한 `timeline.html?doc=…`로 연결한다.

- `haedo-platform-backup-v1`: 연표·목표·습관. 구 연표 백업 `haedo-backup-v1`과 원본 문서 가져오기를 유지한다.
- `life-tools-backup-v1`: 자료 작업공간의 원문·발췌·출처. 검토 중 초안과 계정/원격 연결 정보는 제외한다.

화면에 포함 범위를 표시하고 다른 형식을 명시한 파일을 섞어 가져오지 않는다. 복원은 새 사본이며 기존 기록이나 소유권을 덮어쓰지 않는다.

## SQL과 실제 서버 검증

해도 전용 Supabase의 [자료 SQL](../supabase/migrations/20261003085426_life_sync_workspaces.sql)은 Local이 설치했다. **재설치는 필요 없다.** `life_workspaces`, `life_sync_receipts`, `life_sync_put`만 추가했고 기존 `charts`, `haedo_documents`, `haedo_items`, Auth 설정은 바꾸지 않았다.

Local 인계는 실제 DB 역할/RLS/RPC 19개·동시 트랜잭션 3개 통과다. Cloud는 별도로 A/B 실제 HTTP **11개**를 통과했다. 계정·익명 격리, 직접 쓰기 거절, 재시도·CAS 동시 경합, 서버 JSONB 16 MiB 제한을 확인했다. [상세 증거](life-tools-design/local-handoff-verification.md).

크기 제한을 넘는 JSONB는 SQL 오류 `22001/life_snapshot_too_large`로 거절됐다. 16 MiB가 넘는 큰 HTTP 본문은 비정형 401을 받았으며 원인은 확정하지 않았다. 이 응답을 SQL 제한 검증 성공으로 계산하지 않는다. [서버 준비 기록](life-tools-design/server-readiness.md).

Cloud HTTP 검사의 합성 자료 8행은 관리자 정리가 남아 있다. [정리 SQL](../supabase/tests/cleanup-cloud-http-20261003.sql)은 정확한 생성 ID와 실행별 제목을 함께 제한한다. Cloud 앱 역할에는 DELETE 권한이 없으며 정리를 위해 권한을 늘리지 않는다. Local 관리자에서 실행 후 잔여 0건을 확인해야 한다. 원본은 `/workspace/life-haedo-handoff-results/cloud-http-cleanup-combined.sql`에도 보존했다.

## 오프라인·배포 경계

현재 SW v53은 공용 인증·플랫폼·자료 모듈을 같은 설치 묶음으로 캐시한다. 개인 API·인증 응답을 저장하지 않고 OAuth 콜백 쿼리는 캐시에 넣지 않는다. 부분 설치 실패 시 이전 워커를 유지한다. R2 파일별 검토 때에는 v51→v52 업데이트를 확인했으며, 이번 검색 변경의 검증 결과는 아래 후속 기록으로 구분한다.

이미 검증해 열린 자료 화면은 연결이 끊겨도 기기에 저장할 수 있다. 보호 페이지의 최초 진입·새로고침·bfcache 복귀에는 서버 재검증이 필요하며, 검증 실패로 로컬 원본을 삭제하지 않는다. 이전 독립 개발 화면의 오프라인 로그인 재개와 구분한다.

Pages 준비에 `life.html`과 단일 SDK·공용 모듈을 포함한다. 공개 설정은 배포 산출물에만 넣고 소스의 설정은 빈 템플릿으로 남긴다. 개발 서버도 OAuth 코드·문서 URL을 요청 로그에 남기지 않는다.

## 아직 외부 확인이 필요한 항목

실제 `/auth/v1/settings`에서 Google 제공자는 비활성화다. 기존 Google Cloud 프로젝트의 해도용 웹 OAuth Client ID·Secret·callback 및 Supabase Google 제공자 설정이 필요하다. Secret은 설정 화면에서만 입력한다. 사용자에게 기존 프로젝트/저장소 정보를 요청했으며 모의 OAuth 검사를 실제 제공자 로그인으로 보고하지 않는다.

실제 Google 로그인·Mac/iPad/iPhone 체험·합성 8행 관리자 정리·PR 병합과 공개 배포는 아직 완료하지 않았다. GitHub API 접근은 환경 설정 반영 후 실제 조회·PR 생성에 성공했다. 아래는 최초 통합 커밋 `f18b5ca`의 검사 기록이다. 브라우저의 Auth/HTTP는 익명 모사이며 실제 SDK·IndexedDB·서비스워커를 실행했다. 이후 R2의 최신 검사 결과는 다음 절과 [R2 구현 기록](life-tools-design/r2-implementation.md)을 따른다.

| 검사 | 결과 |
| --- | --- |
| `npm test` | 163/163, 실패·건너뜀 0 |
| `npm run check` | HTML 13개·JS 28개·로컬 리소스 참조 158개 통과 |
| `node tests/life-browser.cjs` | 가져오기·발췌·원문·재열기·백업 23/23 |
| `node tests/life-sync-browser.cjs` | 동기화·응답 유실·충돌·계정 전환 14/14 |
| `node tests/platform-life-browser.cjs` | Google 버튼·PKCE 모사·A/B 격리·로그아웃·오프라인·v50→v51 9/9 |
| `node tests/platform-import-browser.cjs` | 파일 읽기 중 A→B/A→B→A 전환·다른 백업 형식 거절 3/3 |
| 기존 플랫폼 체험 | 사건 저장·목표 55% 수정·습관 체크 재로드, 자료에서 정확한 연표 문서 열기 4개 흐름 통과 |
| 화면 | 공개 홈·개인 공간·원문·동기화 4화면 × 1440/820/390px 모사 12개, 가로 넘침 없음 |

통합 브라우저 회귀는 총 49개 통과했다. 예상 밖 console/pageerror는 0개이며 의도한 offline/schema/callback 전송 실패는 R1/R3/통합 각각 1/8/1개로 구분했다. 로그아웃 직전 400ms 안에 입력한 초안이 보존되고, 실제 IndexedDB 검토 저장 트랜잭션을 중단시키면 편집·인증을 유지하며 공용 로그아웃을 호출하지 않는 것을 확인했다.

SW·안전 빌드의 Node 검사 16개는 전체 163개에 포함된다. 생성 출력의 과거 파일 제거와 소스/비소유 출력 보존, 부분 설치 실패 보호를 확인했다. v50은 공개 배포로 가정하지 않고 보존한 Cloud 작업 파일 fixture를 사용했다.

재현 서버는 `npm run dev`다. 브라우저 러너는 설치된 Playwright/Chromium을 사용하며 `BASE_URL`, `PW_MODULE_PATH`, `CHROMIUM_PATH`로 지정할 수 있다. 개인 브라우저 프로필·실제 계정 세션을 복사하지 않는다. 검증 로그는 `/tmp/life-browser-final.log`, `/tmp/life-sync-browser-final.log`, `/tmp/platform-life-browser-final.log`, `/tmp/life-platform-node-final.log`에 있다. 환경의 재사용 시작 지침도 OAuth 쿼리를 기록하지 않는 서버와 이 인증 경계에 맞춰 저장했다. 환경 설정 저장은 공개 배포나 새 환경 복원 검증을 뜻하지 않는다.

## R2 TXT·Markdown 여러 파일 검토 후속

같은 통합 브랜치에서 파일별 검토초안·명시 저장·중단과 재개를 추가했다. 선택만으로 업로드하거나 동기화를 연결하지 않는다. 기존 SQL·인증·백업 형식·DB 버전은 유지한다. 보관 결과의 원문·버전 참조는 원문과 영수증에 함께 저장하며 무소유 자료의 명시 사본 가져오기에서도 참조를 재매핑한다.

Node **173/173**, 정적 점검, 브라우저 **54/54**(R1 23·동기화 14·공용 인증/업데이트 9·다중 파일 8)를 통과했다. 보존한 `f18b5ca` v51 산출물에서 v52로 업데이트하여 원문·미적용 초안 보존과 새 캐시의 주요 모듈 6개 SHA-256 일치를 확인했다. v51을 공개 배포된 버전으로 가정하지 않는다. 실제 Apple 파일 제공자·Google OAuth와 위 외부 작업은 여전히 미완료다.

## R2 검색·원문 버전 복귀 후속

검색 결과가 실제 일치한 원문 버전과 구절을 열도록 보완했다. 현재 제목이 일치하면 최신 버전을 포함하고, 본문이 일치한 과거 버전도 별도로 표시한다. 제목만 일치할 때 이전 본문 선택을 복원하지 않으며 요청한 버전이 없으면 부재를 알린다. 원문에서 발췌한 뒤 검색어·원천/주제 필터·포커스·스크롤을 유지한 목록으로 돌아온다. 검색 상태는 화면 메모리에만 두고 작업공간·계정 경계에서 초기화한다. [사용 장면과 지원 한계](life-tools-design/r2-search.md), [최신 OSS 비교와 선택 이유](life-tools-design/open-source-review.md#r2-검색-결과의-원문-버전구절-복귀)를 참고한다.

검색 변경 후 Node **181/181**, 정적 검사 **HTML 13·JS 28·참조 158**, 브라우저 **60/60**(검색 6·R1 23·동기화 14·공용 인증/업데이트 9·다중 파일 8)을 통과했다. 예상 밖 console/pageerror는 0개다. 의도한 전송 실패는 R1 1개·동기화 7개·플랫폼 1개로 구분했다. 1440/820/390px 검색·원문 화면 6장과 긴 원문의 중간/끝 구절 가시성·목록 복귀를 확인했다.

실제 보존한 `7f57ac5` v52 산출물에서 v53으로 업데이트하여 원문·미적용 초안·기존 로컬 자료 보존 및 새 캐시 6개 모듈의 SHA-256 일치를 확인했다. v52는 공개 배포 가정이 아닌 Cloud 작업 산출물이다. 로그는 `/tmp/life-search-node.log`, `/tmp/life-search-browser-final.log`, `/tmp/life-search-{r1,batch,sync,platform}.log`에 있다. 새 SQL·운영 DB 행·인증·백업 형식 변경은 없다. 실제 Google 설정 조회는 여전히 비활성화이며 Apple 실기·관리자 합성 행 정리·병합·배포는 위 외부 확인 항목으로 남는다.
