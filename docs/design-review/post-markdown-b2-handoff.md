# B2 Markdown 편집기 인계

2026-11-05, 기준 main `5fcaa3f80947fa78352a9d8e1724de557141b4e8`.
최종 범위는 [총괄 마무리 지시](https://github.com/wonchance-art/life-haedo/pull/212#issuecomment-6659250294)를 따른다. **B2 제품 편집기는 아직 켜지 않는다.** A 본체 #217과 B3 #221은 병합됐지만, B3 운영 반영과 B2 통합 완료를 뜻하지 않는다. 병합·운영·로드맵 통합 갱신은 총괄이 맡는다.

## 준비 PR에 포함한 것

- `post-markdown.js`: 해독한 Delta가 5,000 ops를 넘을 때만 의미가 같은 text/newline 속성을 묶는다. 정본 Markdown, 일반 문서의 기존 투영 바이트, 5,000 ops/50,000자 한도는 유지한다. 사진은 묶음 경계이며 AI/링크/서식의 **없음**도 보존한다. 별도 codec 커밋이다. **B3 Edge 재배포 필요:** `haedo-blog-publish/projection.mjs`가 이 codec을 직접 사용하므로 웹 코드와 같은 버전으로 배포해야 한다.
- `storage.js`: 새 `savePostTransition(workspaceId, input, baseRevision, {sourceId, sourceRevision, recoveryId})`만 추가한다. 저장 원문을 트랜잭션 안에서 다시 읽고, 최종 Markdown·원래 판의 복구 초안·인용 근거·영수증을 함께 쓴다. 기존 replacement의 원격 ID/수신 영수증/자료 결과 이관을 재사용한다. 실제 Blob/HEIC 보기 바이트까지 요청 해시에 넣으며 정확한 재시도만 재생한다. 명시 변환/저장 전용이고 autosave에서는 호출하면 안 된다.
- vendor의 기존 패키지에서 `closeHistory`, `TextSelection`, `EditorState`, `isHistoryTransaction` 네 export를 추가한다. 패키지 버전·의존성·lockfile은 그대로다. 번들 SHA-256: `d13bf6b8b13cd97800a56c356de7f7afda5b3a7eb8881b219593f0cf8f35f90d`.
- 저장 API의 기존 구조 목록에 `savePostTransition` 한 항목을 추가한다. 제품 HTML, CSS, SW, `photo-post-ui.js`, `photo-post.js`, editor bridge 연결은 이 PR에 없다.

저장 API의 동시성 검증은 **같은 저장소의 두 인스턴스 CAS** 범위다. 서로 독립된 두 기기에서 복구 사본이 하나로 합쳐진다는 보장은 미입증이다. UI의 실제 IndexedDB 전환 실패/성공 검증도 끝나지 않았다.

## UI 작업 보존 위치

브랜치 `codex/post-markdown-b2-ui-handoff`에 `docs/design-review/post-markdown-b2-ui-in-progress.patch`로 보존한다. 미완료 기능이나 실패하는 검사를 실행 파일로 활성화하지 않기 위해 **적용 전 패치**만 올린다. 이 패치는 준비 PR 위에 적용하는 작업 스냅샷이며 병합 대상이 아니다. 원래 로컬 작업트리 `/workspace/life-haedo-b2`도 그대로 보존했다.

후속 작업자는 준비 PR을 기준으로 새 worktree를 만든 뒤 해당 패치를 별도 파일로 꺼내 `git apply --check`부터 수행한다. 최신 A/C/E/F 변경과 충돌하면 각 담당 계약을 보존해 합친다. 패치의 전체 UI 통합 검사는 실패 상태이므로 그대로 제품에 연결하면 안 된다.

패치에 포함된 독립 구현:

- `PhotoPost.createMarkdownDraft`, `prepareMarkdownEdit`, `replaceBody`: v1/v2의 순수 변환 후보, 명시적 사진 문단 경계 보정, 밑줄·정렬·단독 NBSP 변경 안내, Markdown 본문 갱신.
- `PostMarkdownEditor.createBridge` 및 `find(element)`: PM 위치↔Delta 위치, 선택/서식/사진 조작, text-change, history, 조합 입력과 flush, 사진 inspector DOM 보존. `Quill`은 Delta 연산 객체에만 남기는 방향이다.
- 기존 D1 스타일 적용, HTML/prepare-site/SW 등록, UI 새 문서·편집·전환 저장 연결 초안과 신규 브라우저 검사. 밑줄·정렬은 새 도구에서 제외한다. CACHE 값은 변경하지 않았다.

## 확인된 미완료 사항과 다음 연결 순서

1. **읽기 오류:** `renderBody`의 `for (const op of value.ops)`와 목록 cover의 `value.ops.find`를 `PhotoPost.contentOps(value)`로 바꿔야 한다. 현재 새 Markdown 입력→자동 저장→명시 저장 뒤 reload→읽기에서 `value.ops is not iterable`이 재현된다.
2. **변환 취소/실패:** `open()`이 변환 확인 전에 doc/mode/dirtyTick를 바꾼다. 후보 준비 성공 뒤 상태를 반영하거나 catch에서 이전 상태를 복원해야 한다. 취소·quota 실패 뒤 목록 이동/재열기에서 v2 초안이 의도 없이 저장되지 않아야 한다.
3. **붙여넣기 원자성:** 현재 선택 영역 삭제와 삽입을 따로 수행한다. 한도를 넘는 삽입이 거절되면 선택 원문만 사라진다. 하나의 Delta update로 검증·적용하고, 거절 전후 본문/history/dirty와 AI 표시를 확인한다.
4. **IME 출력:** `outputSnapshot()`은 조합 종료 후 bridge의 30ms 반영 전에 호출될 수 있다. ZIP/HTML/새 사본 출력 전에 저장소 쓰기 없이 editor.flush를 기다려야 한다. 일반 persist와 modelOnly 경로도 조합 중 모델을 덮지 않는지 확인한다. 실제 Apple 한글 IME는 별도 미검증이다.
5. **전환 재시도:** API는 updatedAt을 포함한 정확한 payload를 요구한다. UI finish는 호출마다 시각을 새로 만들어 ACK 유실 후 같은 요청 재생을 보장하지 못한다. 승인된 저장 intent를 유지하고, 중간 입력이 바뀌면 조용히 성공 처리하지 않아야 한다.
6. **실제 전환 완주:** 문단 경계 안내→취소/명시 저장→원본 복구, 사진/HEIC/첨부/근거, 두 번째 쓰기 abort→재시도, 기존 초안 변환, ZIP 복원, 두 기기 수신, 선택 공개를 새 UI에서 끝까지 검증한다. 이번 UI 검사에서 이 뒤쪽 구간은 실행되지 않았다.
7. **출시 관문:** A #224의 구형 탭 version 방어, F의 과거 publishPending 복구, B3 운영 반영과 codec 재배포를 총괄이 확인해야 한다. C3/E의 저장·삭제·ACK 담당 코드를 임의로 변경하지 않는다.

독립 UI 검수가 1–4를 지적했다. 준비 PR의 codec/저장/vendor 범위에는 차단 결함을 발견하지 않았으나, 이것을 UI 완료 판정으로 확대하지 않는다.

## 검사 접점 13개 (이번에는 수정하지 않음)

다음 `tests/*.cjs`는 `Quill.find`, `.ql-editor`, 저장된 `doc.ops`를 전제한다:

- `photo-post-browser`, `photo-post-d1-browser`, `blog-autosave-browser`
- `blog-writing-completion-browser`, `account-blog-continuity-browser`, `blog-completion-browser`
- `integrated-release-browser`, `material-writing-browser`, `life-naver-capture-browser`
- `nine-board-image-browser`, `travel-writing-resume-browser`, `travel-writing-history-browser`, `ai-authorship-browser`

후속 승인 범위에서 `PostMarkdownEditor.find(element)` → bridge의 `getContents/updateContents/getSelection/setSelection/history`를 사용하고, 저장 문서는 `PhotoPost.contentOps(doc)`로 읽는다. 실제 입력 DOM은 `.post-markdown-editor`다. 기존 시나리오·단언·제한시간을 유지한다. 가짜 `.ql-editor`, Quill.find 교체, 제품 테스트 분기를 넣지 않는다. `writing-ai-browser`와 `writing-ai-toolbar-browser`는 A 담당 인계와 합친다.

## 결정적 recovery UUID와 두 기기 검증 계획

UI 초안은 `transitionId(source, token)`에서 원격 binding.remoteId(없으면 local ID), 제목/작성시각/수정시각/첨부, 본문의 사진 ID를 digest로 바꾼 ops, 로컬 ID를 뺀 사진 metadata를 SHA-256으로 해시한다. 앞 128bit에 UUID version/variant bit를 넣고 source ID/revision별로 재사용한다. **설계 후보이지 두 기기 보장의 근거가 아니다.**

남은 위험: 로컬 ID로 fallback한 양쪽 첫 연결, metadata/배열/객체 순서, 수신 시 ID 재배치, 서로 다른 source revision, 같은 recovery local ID여도 BlogSync가 별도의 remote ID를 만들 수 있는 점. 기존 `derivedId`/복구 사본 중복 판정/seedState와 함께 검토해야 한다. 새 서버 DDL이나 저장소 downgrade guard 완화는 승인된 범위가 아니다.

검증은 독립 browser context/IDB 두 개와 같은 합성 서버로 한다. 같은 원문을 두 기기에서 먼저 받고 동시에 첫 수정→명시 저장한 뒤 양방향 drain/reload를 반복해 원문·양쪽 변경·정확한 사진/보기/근거가 남는지, 복구 글이 전역 하나인지 단언한다. ACK 유실, 오프라인 재시도, 한쪽이 다시 편집한 경우도 확인한다. 같은 IDB의 두 탭 성공으로 대체하지 않는다.

별도 미해결: 더 최신인 원격 v2가 로컬 md와 충돌하면 현재 guard가 `photo_post_update_required`로 막아 수렴하지 않는다. 양쪽 원문은 남지만 복구 사본 생성까지 진행하지 못했다. md 우선으로 최신 시각 정책을 바꾸거나 downgrade 방어를 제거하면 안 된다. 후속 범위·담당을 총괄과 정해야 한다.

## 사전 실험 요약과 A 재현 방법

원본 증거는 로컬 `.local/b2-preflight/`에 있다. 과거 조사 메모의 권고보다 최신 총괄 결정이 우선한다. 특히 **A의 IDB version 방어는 필수**, **F는 정확한 HTTP400/SQLSTATE22023/`life_blog_markdown_publication_unavailable`만 확인한 뒤 같은 operationId·intent·copies에 documentFormat을 CAS로 보충**한다. 새 operationId 생성/대기 삭제 제안은 폐기됐다.

- `old-ui-blocked.cjs`: SHA 고정 옛 UI에서 실제 편집→새 탭의 revision 증가 전환→옛 명시 저장 충돌과 화면 입력/원본/복구 보존. 비협조 raw IDB 연결의 blocked와 늦은 upgrade도 확인했다.
- `revision-guard.cjs`: 정상 구형 초안은 정확한 옛 target revision을 지녀 전환 뒤 저장이 CAS로 거절됨을 확인했다. 모든 구형 경로를 막는다는 증명은 아니다.
- `version-fence.cjs`: 메모리에서만 DB_VERSION2로 바꾼 새 storage가 옛 연결을 닫고, 구형 재접속도 거절함을 확인했다. 기존 commitBlogSync의 실제 IDB 원자성 실험이며 새 savePostTransition UI 검증과 구분한다.
- `remote-downgrade.cjs`: 위 혼합 형식 충돌의 수렴 정지 재현.
- codec 실험: 사진 앞 미종결 문장은 명시 개행을 추가해야 하고, 단독 NBSP 문단은 빈 문단으로 바뀔 수 있다. 원래 판의 복구와 안내가 필요하다. 유효한 2,600줄의 기존 단일 op가 변환 시 5,200 ops로 늘던 문제는 이번 압축으로 해결했다.
- 서버 격리 실험 13개/공개 재시도 실험 14개는 SQL의 CAS·형식 퇴행 거절·영수증 우선 재생 범위를 확인했다. 운영 반영 증거는 아니다.

UI 인계 브랜치의 `docs/design-review/post-markdown-b2-preflight/`에 위 네 cjs와 당시 로그를 복사했다. A는 이를 저장소 루트의 `.local/b2-preflight/`로 복사한 뒤 `node .local/b2-preflight/old-ui-blocked.cjs` 등으로 실행할 수 있다. Playwright는 기존 `tests/unified-home-browser.cjs` helper, Chromium은 `/usr/bin/chromium`을 사용한다. 자체 route로 네트워크를 막으며 실제 계정은 사용하지 않는다. 구형 소스 SHA는 `tests/fixtures/post-markdown-old-client/provenance.json`으로 확인한다. 당시 main에서 얻은 결과이므로 A의 최종 head에서 다시 확인해야 한다.

## 검증 기록과 재실행

준비 범위 분리 후 실행:

```sh
npm run check
npm test
node --test tests/post-markdown-codec.test.cjs tests/post-markdown-capacity.test.cjs tests/photo-post-transition.test.cjs tests/structure-baseline.test.cjs
node tests/photo-post-transition-mutations.cjs
node tests/post-markdown-packing-browser.cjs
```

정적 검사와 전체 Node **2,223/2,223**, 집중 검사 48/48, 트랜잭션 분리/근거 복사 제거 변이 2/2 탐지, 실제 공개/비공개 DOM 4/4와 실제 Edge projection 바이트 2/2 통과. 새 worktree 최초 전체 실행의 3개 실패는 `cheerio/slim` 검사 의존성 누락이었으며 기존 fixture lockfile로 `npm ci` 후 전체를 다시 실행해 통과했다. 6,002→1,002 ops 사례의 Markdown 원문이 고정 main과 같다. vendor는 `cd vendor/tiptap && npm ci && npm run build` 두 번의 출력이 같았다.

분리 전 독립 검수 증거: B3 SQL 78/78, 전체 SQL 재생, 실제 Edge→격리 PG→익명 공개 브라우저 10/10. 준비 codec과 저장 코드는 동일하다. bridge 신규 12/12·기존 adapter 11/11, 모델 변환 검사와 무작위/대용량 codec 실험은 개별 성공했지만 UI 완주를 대신하지 않는다. UI 통합 실패 증거는 `.local/post-markdown-writing-second/`의 report/HTML/PNG에 있다. 후속 새 검사의 초과 붙여넣기/취소 이동 단언은 추가 후 아직 실행하지 않았다.

후속 UI 재현: 격리 PostgreSQL 및 로컬 dev server를 준비한 뒤 `BASE_URL=http://127.0.0.1:4256 BLOG_POSTGRES_CONTAINER=haedo-blog-postgres-2026110501 BLOG_POSTGRES_DATABASE=haedo_blog_qa_b2_writing_retry MARKDOWN_WRITING_WIDTHS=390 node tests/post-markdown-writing-browser.cjs --prepare-database`. 이 명령은 미완료 패치를 검토·적용한 별도 worktree에서만 실행한다.

다음 큰 묶음은 (1) 위 보존 결함과 검사 접점을 해결해 UI 편집·변환·백업을 완주, (2) A/F 관문 및 두 기기 복구/혼합 형식 수렴 검증, (3) 총괄의 B3 운영·같은 codec 재배포·실제 Apple 입력 확인이다. 각각의 완료 기준은 앞 절의 원문 보존과 전체 사용자 흐름 검증이며, 이번 준비 PR을 편집기 출시로 표시하지 않는다.
