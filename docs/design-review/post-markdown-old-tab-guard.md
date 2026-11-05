# Markdown 전환 전 구형 탭 저장소 차단

기준 main `5fcaa3f`(2026-11-05). [A 담당 배정](https://github.com/wonchance-art/life-haedo/pull/212#issuecomment-6658403177)과 [방식·검사 접점 승인](https://github.com/wonchance-art/life-haedo/pull/212#issuecomment-6658462747)에 따른 B2 관문 (a)다. 편집기 본체는 B, 공개 대기 복구는 F가 맡는다. 운영·CACHE·workflow·로드맵은 변경하지 않는다.

## 문제와 선택

고정한 구형 `2eebd27`의 저장 코드는 Markdown 직접 읽기·쓰기를 거절하지만, 이미 남아 있는 v2 교체 초안을 저장할 때 대상 형식을 읽지 않고 원본을 지운다. 원격에서 받은 Markdown 원본과 구형 초안의 대상 revision이 같으면 revision 검사만으로 막히지 않는다. `photo-post-old-client.test.cjs`의 역사적 실패 경로는 그대로 보존한다. 이 검사의 메모리 IDB는 버전 협상을 구현하지 않으므로 새 관문의 증명으로 사용하지 않는다.

| 대안 | 판단 |
| --- | --- |
| 같은 DB의 버전 1 → 2 | 채택. 구형 코드에 이미 있는 versionchange 처리와 브라우저의 버전 협상을 사용한다. 모든 기존 행과 저장소 이름을 유지한다. |
| 별도 DB로 복사 | 구형 쓰기는 계속되며 정본이 둘이 된다. 복사·동기화·복구 경계를 추가해야 하므로 채택하지 않는다. |
| 탭 사이 협력 메시지 | 이미 배포된 구형 코드가 새 메시지를 이해하지 못하므로 강제 장벽이 되지 않는다. |
| 문서 revision만 증가 | 정상 구형 UI의 일부 충돌은 막지만, 같은 revision을 가진 다른 기기 원본과 모든 쓰기 경로를 차단하지 못한다. |

## 저장과 연결의 순서

제품 변경은 `storage.js`의 `DB_VERSION = 2`와 그 이유를 설명하는 주석뿐이다. DB 이름 `life-tools-v1`, store·index·row 형식, 계정별 키는 유지한다. 기존 upgrade가 없는 store만 만드는 동작도 유지한다.

새 판의 첫 `open()`이 버전 협상을 수행한다. 구형 연결은 기존 `blocking()`에서 진행 중 트랜잭션을 abort하고 연결을 닫은 뒤 `storage_version_changed` 오류를 유지한다. 새 `open()`은 이 연결과 트랜잭션이 끝난 다음에만 성공하므로 Markdown의 첫 쓰기보다 장벽이 먼저 완료된다. 이미 완료된 구형 저장은 그대로 남고, 진행 중 저장은 전체 롤백된다. 구형 코드가 다시 버전 1로 열려고 해도 `VersionError`로 거절된다.

탭 창 자체를 강제로 닫지는 않는다. 입력을 보존한 채 저장소 연결을 차단한다. 다른 탭이 연결을 놓지 않으면 새 판은 기존 `storage_blocked` 안내로 즉시 거절한다. 나중에 업그레이드가 끝나도 실패한 인스턴스의 늦은 연결은 닫으며, 그 인스턴스가 몰래 저장을 재개하지 않는다. 사용자가 연결을 막는 탭을 닫고 새 화면에서 다시 연다.

계정·무계정 저장소는 같은 물리 DB를 쓰므로 버전 협상은 모두에 적용된다. 이 장벽은 같은 origin·브라우저 DB의 로컬 접근을 보호한다. 다른 기기에서 이미 나간 서버 요청이나 상향 이전에 완료된 손실까지 취소·복구한다고 주장하지 않는다. 서버의 형식·CAS 보호와 B2의 md 초안 계약은 별도로 유지해야 한다.

## 검증

구형 모델·저장소 원본은 기존 gzip·SHA-256 fixture를 그대로 사용한다. 새 네이티브 검사는 실제 Chromium IndexedDB를 사용하고 HTTP·운영 계정에는 접근하지 않는다.

| 검사 | 결과 |
| --- | --- |
| `npm test` | 2,199/2,199 |
| `npm run check` | 통과 |
| `node tests/post-markdown-old-tab-browser.cjs` | 3/3. 첫 open 뒤 5개 store 전체 행 보존, 구형 교체·재접속 거부, blocker 유지 중 즉시 오류·Markdown 쓰기 0, 새 탭 두 개 동시 열기 확인 |
| `POST_MARKDOWN_OLD_TAB_MUTATION=no-version-bump node tests/post-markdown-old-tab-browser.cjs` | 실패(exit 1). 구형 교체가 실제 Markdown 원본을 삭제하고, blocker가 있어도 Markdown 쓰기가 진행되는 변이를 검출 |
| `node tests/post-markdown-old-tab-input-browser.cjs` | 2/2. 실제 pinned PhotoPostUI/model/storage에서 미저장 제목·본문·조합 DOM 유지, 실제 put 성공 뒤 진행 tx abort·전체 롤백, 저장 실패와 새로고침 문구 확인 |
| 기존 `life-browser` | 23/23 |
| 기존 `writing-sync-storage-browser` | 17/17 |
| 기존 `composition-storage-browser` | 14/14 |
| 기존 `reading-position-storage-browser` | 13/13 |
| 익명 prepared-site의 `platform-life-browser` | 8/8. 이전 판 SW fixture는 미지정 |

기존 검사 5개 파일은 raw 조회의 버전 1 인수만 제거했다. 강제 versionchange 검사는 조회한 실제 버전 + 1로 바꿨고 기존 오류·행 보존 단언을 유지했다. 과거 fixture의 버전 1은 바꾸지 않았다.

네이티브 정상/변이 보고서는 `.local/post-markdown-old-tab/{baseline,no-version-bump}/report.json`에 보존한다. 위 3개 검사의 textarea는 저장소 수준의 입력 보존 관찰이며 실제 구형 편집기의 입력 검사를 대신하지 않는다.

별도 실제 UI 검사는 `2eebd27`의 PhotoPostUI/model/storage 원본 3개를 그대로 사용한다. 새 UI gzip의 크기와 SHA-256은 `tests/fixtures/post-markdown-old-client/ui-provenance.json`으로 확인한다. 나머지는 현재 shell·SDK·Quill과 익명 Auth fixture이므로 전체 과거 앱이나 Apple 입력기 검증으로 표시하지 않는다. 실제 편집기에 미저장 제목·본문을 넣고 조합 이벤트를 시작한 다음 다른 탭의 새 저장소를 연다. 저장 중 시나리오는 실제 IDB put 성공 뒤 연속 get으로 트랜잭션을 유지하며 구형 코드 자체의 abort 처리를 확인한다.

최종 결과는 `.local/post-markdown-old-tab-input/2026-11-05T13-20-44-533Z/report.json`이다. 두 시나리오 모두 입력·DOM 노드·마지막으로 커밋한 행이 보존된다. 구형 UI는 “저장이 중단되었습니다. 입력을 확인하고 다시 저장하세요.” 또는 “다른 탭에서 저장소 버전이 바뀌었습니다. 입력을 보존하고 새로고침하세요.”를 표시한다. 조합 종료 뒤에도 새로고침 안내와 입력이 남는다. 최초 문구 정규식 오기로 실패한 기록도 보존했다. 예상 밖 콘솔·페이지 오류와 외부 요청은 0이다.

독립 검수에서 구형 gzip 3개를 해당 git blob과 직접 대조했고, 제품 장벽·기존 단언·실제 삭제 변이·진행 tx 롤백과 입력 보존을 확인했다. 블로커·메이저는 없었다. 기존 구형 코드를 소급 변경하지 않았다.

## 남은 통합 조건

- 실제 iPad/iPhone PWA의 백그라운드 중단·한글 입력기는 별도 확인이 필요하다. 네이티브 blocker 검사를 실기기 검증으로 표시하지 않는다.
- B의 Tiptap 편집기에서 AI 제안 등록·부분 수락·실행 취소·Markdown 저장/재열기·사진·늦은 응답 검사는 B의 시험 가능한 head 위에서 실행한다. 기존 Quill 검사 통과를 새 편집기 통과로 대체하지 않는다.
- B2 본체의 병합은 총괄이 정한 B3 운영 반영 관문을 따른다. 이 저장소 장벽은 Markdown 활성화 전에 먼저 병합할 수 있다.
