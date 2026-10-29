# 실행 명세: 같은 자료·사진·글·정확 근거를 다른 기기에서 이어 읽기

2026-10-29 KST. 설계 인계 문서이며 새로운 서버 형식이나 출시 완료를 선언하지 않는다. 배포 기준은 main `ab6aef594a2d6d0cabbaf89864e7994ce22a6fec`([PR139](https://github.com/wonchance-art/life-haedo/pull/139))다. `codex/source-photo-recovery-20261027`의 네이버 사진 복구는 별도의 미출시 구현 후보다. 실행 세션은 시작할 때 원격 main·인계 커밋·실행 중인 다른 PR을 대조하고, 이미 완료된 기능을 재구현하지 않는다.

## 1. 사용자 목표와 완료 결과

**A에서 원문과 사진을 보관하고 구절을 인용한 글을 저장 → B에서 같은 계정으로 글을 열기 → 그 인용의 정확한 원문 판과 사진을 확인 → 읽던 글·위치로 돌아오기 → 수정·저장·파일 복원 후에도 근거 유지**를 완주한다.

같은 제목이나 최신 본문을 여는 것으로 성공 처리하지 않는다. 원문 ID/판/본문 해시/UTF-16 구절과 실제 사진 바이트가 일치해야 한다. 읽기만 하고 끝나는 경로, 사진이 없는 원문, 원문·사진·근거 중 일부만 확보된 상태도 정상적으로 표현한다.

이번 설계는 두 내부 단위를 구분한다. A는 기존 사진 복구 후보를 완결하는 일이고, B는 일반 저장 글의 계정 재개에 정확 근거를 연결하는 후속이다. 사용자 결과는 연결하되 검증되지 않은 B를 A의 완료에 포함시키지 않는다.

## 2. 현행 구현 지도

| 경계 | 현재 동작·재사용 지점 | 남은 일 |
| --- | --- | --- |
| 원문·발췌·저장 구성 | [account-library.js](../../assets/life/account-library.js)의 `bootstrap/reconcile/getState`, 기존 Core/Composition/LibraryMeta 동기화 | 새로운 기본 자료 연동을 만들 필요 없음. 각 영역의 실제 반영 상태를 정확하게 조합 |
| 원본 첨부 ZIP | [original-attachments.js](../../assets/life/original-attachments.js), [library-originals-remote.js](../../assets/life/library-originals-remote.js)의 계정 원본 보관·검증 수신 | 사진 글·네이버 사진·일반 첨부 ZIP을 같은 파일 확보 상태로 취급하지 않음 |
| 저장 글·원본 사진 | [blog-sync.js](../../assets/life/blog-sync.js)의 `openRemote`, `receive`, `inspectRemote`; [blog.js](../../assets/life/blog.js)의 `pack/hydrate` | 일반 `openRemote`의 글·사진 수신에 구조화된 인용 근거는 포함되지 않음 |
| 정확 인용 모델 | [source-reference.js](../../assets/life/source-reference.js)의 `build/resolve/remap`; [storage.js](../../assets/life/storage.js)의 `readPostEvidence/savePostEvidence/savePhotoPostWithEvidence` | 일반 서버 글을 받았다는 사실만으로 `post-evidence`가 도착했다고 표시하지 않음 |
| 명시 연결한 작성 준비의 근거 | [material-continuity.js](../../assets/life/material-continuity.js)의 `outputRefs/needed/snapshot/verify/remap`; [material-continuity-sync.js](../../assets/life/material-continuity-sync.js), Storage `installMaterialContinuity/installMaterialPost` | **이미 선택한 준비의 완성 글 근거와 필요한 정확 원문을 함께 이동할 수 있음.** 이 예외를 일반 글의 근거 누락과 구분하고 기존 경로를 재사용 |
| 파일로 근거 이동 | [preservation-references.js](../../assets/life/preservation-references.js), [preservation-package.js](../../assets/life/preservation-package.js), Storage `readPreservationSnapshot/installPreservationCopy` | 선택한 글·글 사진·필요한 원문·근거를 새 ID로 복원하는 기존 경로를 보존 |
| 정확 네이버 사진 복구 후보 | [naver-capture-reference.js](../../assets/life/naver-capture-reference.js), [naver-capture-sync.js](../../assets/life/naver-capture-sync.js), [naver-capture-ui.js](../../assets/life/naver-capture-ui.js) | 핵심 A→B 통합 검수 미완료. 아래 A부터 재개 |

일반 글의 서버 형식은 `Blog.validateManifest`의 엄격한 필드 목록을 사용한다. 현행 manifest에 임의 `evidence` 필드를 추가하면 기존 JS·SQL·구클라이언트 호환을 깨뜨릴 수 있다. 일반 글의 보관 계약과 선택한 작성 준비의 별도 계약을 먼저 구분한다.

## 3. 반드시 유지할 계약

### 식별자와 소유권

- 글의 `remoteId`는 계정 서버 글의 논리적 ID다. B의 로컬 글·사진 ID는 새 사본 ID일 수 있다. 서버 CAS revision과 로컬 PhotoPost revision도 같은 숫자라고 가정하지 않는다.
- `SourceReference`는 workspace/source/sourceVersion·본문 hash·UTF-16 범위·인용문을 함께 검증한다. 링크 이름·URL·본문 유사도만으로 연결하지 않는다.
- B가 글을 받는 현재 작업공간과 A 원문의 작업공간이 다를 수 있다. 원격 원문 공간→현재 계정의 로컬 공간 매핑 또는 필요한 원문의 명시 사본 복원 중 어느 경로인지 고정하고, 정확 판 참조도 함께 재매핑한다. 사용자 작업공간을 조용히 바꾸거나 동명 원문을 덮지 않는다.
- 계정 키는 현재 검증된 프로젝트와 사용자 식별자를 사용한다. 이메일·제목·예전 세션으로 소유자를 추정하지 않는다. 다른 계정의 로컬 자료를 새 계정에 자동 이관하지 않는다.

### 포인터·파일·완료 표시

- 네이버 `naver_capture_reference`는 정확한 사진 판을 다시 찾는 포인터다. 서버 보관 영수증이나 사진 바이트가 아니다.
- 서버 조회 성공, 선언된 파일 목록, 파일 SHA/실제 디코딩 검증, 로컬 원자 설치, 서버 반영 확인은 서로 다른 사실이다. 필요한 경계가 확인되지 않았으면 전체 완료로 표시하지 않는다.
- 현재 Core 서버 RPC는 전체 JSON CAS다. 새 앱은 이미 알고 있는 사진 참조의 교체/삭제를 거절하지만 서버가 그 참조의 모든 변경 이력을 감사한다고 보증하지 않는다. 강한 역사적 불변성을 요구할 경우 별도 서버 계약이 필요하며 현재 후보가 제공한다고 주장하지 않는다.
- 사진을 검증해 받은 것과 작성자가 최초 업로드한 파일임을 증명한 것은 다르다. 현재 `originalStatus:unverified`를 유지한다.

### 파일·공개·초안

- 일반 Core/자료 JSON에는 네이버 사진 바이트가 없다. 포인터가 포함될 수 있어도 사진 백업 완료가 아니다.
- 기존 글별 사진 ZIP과 HTML은 구조화 원문 근거 전체를 보장하지 않는다. 선택 근거 ZIP은 필요한 원문 전체 본문을 포함할 수 있음을 안내하고 별도 검토·새 사본 복원한다.
- 네이버 전용 `haedo.naver.capture.v1` ZIP은 선택 원문 판·수집 명세·사진만 담는다. owner·서버 row ID·Storage 경로·개인 메모·다른 자료·공개 상태를 제외하고 `localOnly` 새 사본으로 복원한다. 이 사본을 서버 보관 완료로 승격하지 않는다.
- 계정 비공개 보관을 공개·새 네이버 수집·Cron·초안 전체 전송의 권한으로 해석하지 않는다. 작성 중 초안과 기존 보관 중지 상태를 조용히 변경하지 않는다.

## 4. 내부 단위 A: 기존 네이버 사진 복구 후보 완결

세부 계약은 [사진 복구 설계](../design-review/source-photo-recovery.md)를 따른다. 신규 모델/저장/API를 다시 만드는 대신 현재 구현을 확인한다.

1. 새 수집의 `commitNaverCapture`가 source/version·사진·참조를 한 트랜잭션으로 보관하고 기존 Core 동기화가 참조를 함께 전달한다.
2. B에서 `restoreSourcePhotos(workspaceId, { sourceId, sourceVersionId, expectedCaptureHash })`를 호출한다. 현재 참조를 저장소에서 다시 읽고 owner/blog/log/hash가 모두 일치하는 `life_naver_captures` 한 행만 받는다. 최신 수집·같은 본문으로 추정하지 않는다.
3. 비공개 파일을 signal과 함께 받아 SHA·형식·실제 픽셀을 확인한 뒤 `restoreNaverCapturePhotos`가 sidecar만 원자 설치한다. 기존 Core revision·원문·발췌는 그대로여야 한다.
4. 기존 원격 sidecar만 있는 자료는 `rememberSourcePhotos`→`rememberNaverCaptureReference`를 통해 새 서버 확인 뒤 명시적으로 참조를 보관한다. 읽기·부팅이 이 쓰기를 시작하지 않는다. 사진도 참조도 없는 과거 원문은 기존 수집 사본 검토로 남긴다.
5. UI는 사진 영역만 갱신하고 원문 Text 노드·선택·스크롤·복귀 맥락을 유지한다. 사진 글쓰기·다운로드 콜백은 사용자가 본 hash를 고정한다.

순차 재시도는 실제 기존 사진을 검증한 뒤 멱등 처리한다. 다른 탭이 사전 검증 이후 사진을 설치한 동시 요청은 새 blob을 검증하지 않은 채 같은 hash만 믿지 않고 무쓰기 충돌로 끝날 수 있다. 재확인 후 재시도를 제공한다.

부분 원문 투영(MaterialContinuity·Preservation 등)이 사진 참조를 생략하는 것은 기존 참조 삭제 명령이 아니다. 누락은 유지, 동일 ID/판의 상충하는 참조·kind 덮기·판 내용 변경은 거절하며 최종 병합 결과도 검사한다.

**현재 검수 상태:** 기존 단위·정적·PWA·시작 보존·수집 회귀 로그는 있으나 새 `tests/source-photo-recovery-browser.cjs`의 첫 A→B 흐름은 계정 반영 확인 대기에서 실패했다. 제품 원인인지 검사 관측 문제인지 미확정이다. 먼저 부모 인계의 증거 요약과 원본 실패를 읽고, 익명 마지막 로컬/원격 상태·정확 타깃·진행 작업 종료를 관찰한다. 단언이나 제한시간을 낮춰 통과시키지 않는다. 성공이 확인되지 않은 후속 흐름은 실행 완료로 계산하지 않는다.

## 5. 내부 단위 B: 일반 계정 글에서 정확 근거 재개

이 단위의 전송 schema/RPC는 아직 구현되지 않았다. 아래는 실행 세션이 확정할 계약과 권장 방향이다.

### 먼저 결정할 좁은 설계 문제

| 결정 | 권장 방향·판정 조건 |
| --- | --- |
| 기존 준비 경로로 충분한가 | 실제 목표가 선택한 작성 준비의 결과 글이면 기존 MaterialContinuity 완주를 우선한다. 일반 글까지 지원하기 위해 가짜 작성 준비를 자동 생성하지 않는다. 일반 `openRemote`만으로 근거를 기대하는 경우에만 범위를 확장한다. |
| 어떤 글 판의 근거인가 | 서버 글 `remoteId`·확정된 서버 revision·정확 manifest 식별과 근거 snapshot을 묶는다. 늦은 근거가 새 로컬 수정 글에 붙지 않아야 한다. 같은 서버 revision의 다른 manifest도 거절한다. |
| 원문을 어디서 받는가 | 동일 계정의 이미 연결된 정확 원문을 재사용한다. 없는 경우 필요한 정확 판만 제공하는 선택 closure를 검토한다. MaterialContinuity/Preservation의 최소 원문 추출·hash 확인·ID 재매핑을 재사용하고 무관한 발췌/메모/초안은 포함하지 않는다. |
| 별도 전송 계약인가 | 일반 Blog manifest를 그대로 유지하는 버전 있는 비공개 근거 계약을 우선 비교한다. 기존 준비 계약 재사용·새 선택 계약·기존 manifest 버전 확장 각각의 호환·운영·복구 비용을 기록한 뒤 선택한다. 별도 DB가 반드시 필요하다고 미리 단정하지 않는다. |
| 기존 자료를 어떻게 옮기는가 | 이미 저장된 글의 local evidence를 부팅 때 일괄 전송하지 않는다. 선택 글의 포함 범위를 검토하는 최초 연결·재시도 또는 명시 저장 정책을 정의한다. 근거가 없는 글과 근거 조회 실패는 구분한다. |

### 공통 상태 전이 계약

권장 순서는 **선택 snapshot 검토 → 필요한 정확 원문 준비/확인 → 글·사진의 정확 서버 판 확인 → 근거 전송/영수증 확인 → B의 원문·근거 검증 → 원자 연결 설치**다. 서로 다른 서버 도메인이 하나의 분산 트랜잭션이라고 약속하지 않는다.

- 로컬 작업에는 입력 hash와 작업 ID를 가진 영속 요청을 둔다. 동일 작업 재전송은 같은 결과를 반환하고, ACK 유실은 로컬 실패 표시만으로 새 글·새 근거를 중복 생성하지 않는다.
- 각 compare-and-swap(CAS)은 자신의 기대 revision을 사용한다. 원문이 선행되어야 하는 계약에서는 필요한 정확 판이 서버에 반영됐는지 확인한 뒤 참조를 전송한다.
- 사진/본문과 근거의 준비 상태가 다를 수 있다. 기존 글 읽기는 유지하면서 `근거 확인 필요`·재시도를 제공하고, 실제 검증 전에는 근거를 사용 가능으로 표시하지 않는다.
- 설치 직전에 계정·공간·화면 세대·현재 글/원문 판·활성 상태를 다시 확인한다. 계정 전환·공간 이동·화면 이탈·원문 휴지통 이동 뒤 늦은 응답은 쓰기를 취소한다.
- 글/근거를 함께 설치할 때는 문서·정확 관계·수신 영수증이 원자적으로 저장되어야 한다. 기존 글에 근거만 추가하는 경로도 현재 대상 판 검증과 단일 트랜잭션을 사용한다.
- 충돌은 어느 쪽이 최신일지 추정해 덮지 않는다. 선택하지 않은 글·원문·근거·미저장 입력을 복구 사본으로 남기고, 재진입 시 정확한 수신 영수증과 ID 매핑을 재사용한다.
- 관계 삭제·연결 해제·자료 휴지통·비공개 서버 보관 중지·공개 철회는 서로 다른 동작이다. 관계 해제로 원문·사진·다른 글을 삭제하지 않는다.

### 기존 구현에서 가져올 부분

- `SourceReference.resolve`의 정확 hash/UTF-16 검증과 `remap`을 재사용한다. 따로 느슨한 인용 모델을 만들지 않는다.
- MaterialContinuity의 `needed/snapshot/verify/remap`, 서버의 선택 준비·결과 글 영수증 패턴, Storage의 `installMaterialPost`를 먼저 읽는다. 현재 경로는 output의 서버 글 판과 `output.refs`를 함께 묶으며 필요한 원문을 원자 설치할 수 있다.
- 일반 글 재개는 `BlogSync.openRemote`와 Storage `installReceivedBlogPost`의 기존 사본 선택·원본 재검증·중복 수신 영수증을 유지한다. 기존 `receive`의 명시 새 사본 받기와 혼합하지 않는다.
- 서비스의 Auth 검증/epoch·generation·dispose, 원문 도착 순서, 오류 정규화·영속 요청·CAS는 기존 구현을 재사용한다. 계정 관리자 전체를 새 범용 동기화 엔진으로 교체하지 않는다.

## 6. 작업 순서와 파일 소유 분담

| 순서 | 담당 범위 | 선행·산출물 |
| --- | --- | --- |
| 1 | 통합 담당 | 원격 상태·인계 diff·검수 실패를 확인하고 A의 현재 계약을 동결. 새 SQL/운영 설치가 필요 없는 A와 B 설계를 분리 |
| 2 | 모델·저장 담당 / 원격·권한 담당 | A 통합 결함의 실제 원인만 교정. B는 schema·정확 판 연결·closure·ID 재매핑·영수증·구클라이언트 호환의 짧은 결정 기록과 반례를 먼저 합의 |
| 3 | 저장 담당 | native IDB 원자 설치·기존 객체 보존·수신 영수증·회복 사본. `storage.js` 편집자는 한 명으로 제한 |
| 4 | 원격 담당 / UI 담당 | 합의된 서비스 계약으로 독립 구현. 서버 변경이 필요한 경우 격리 DB와 RLS/동시 CAS 검수부터 수행. UI는 현재 원문·정확 글 문맥에서 최소 상태·복구만 제공 |
| 5 | 독립 검수 담당 | 실제 SDK·독립 IDB·필요한 격리 SQL의 전체 여정, 최초 실패/후속 교정 근거, 파일/3폭/기기 전환 검수 |
| 6 | 통합 담당 | 코드·검수·로드맵을 대조하고 정확 PR/main·배포 산출물 결과로 출시 판정. 인계용 draft 상태를 기능 출시 완료로 바꾸지 않음 |

공통 `ui.js`, `storage.js`, `sw.js`, Pages workflow에는 동시 편집자를 두지 않는다. 새 asset을 추가할 때 실제 HTML 로드 순서·배포 allowlist·SW 캐시·이전 실제 worker 업데이트를 함께 검수한다. 테스트에서 제품 전용 우회 분기를 만들지 않는다.

## 7. 검수와 인계 종료 기준

### 필수 사용자 여정

1. A의 같은 본문·다른 사진 판 두 개 중 옛 판을 인용한 글을 B에서 열고, 동일 판·동일 구절·동일 사진을 확인한다. 최신 판으로 조용히 바뀌지 않는다.
2. A/B의 현재 작업공간과 로컬 글 ID가 달라도 정확 매핑으로 왕복한다. 원문→글 복귀에서 검색·선택·스크롤·초점을 유지한다.
3. 네트워크/파일/검증 오류, 실제 IDB abort, 두 탭 동시 클릭, ACK 유실·재시도에서 부분 설치·중복 글·잘못된 완료 표시가 없다.
4. 계정·공간·화면 변경과 타깃 판 변경 뒤 늦은 응답은 쓰기 0이다. 진행 중 작업이 실제 끝났는지 관찰한 뒤 무쓰기 단언을 판정한다.
5. B의 로컬 수정·A의 원격 수정·근거 변경 충돌에서 양쪽 내용·근거·원본과 미저장 입력을 보존한다.
6. 검증된 로컬 원문·사진·근거는 오프라인에서 읽을 수 있다. 오프라인 새 기기의 서버 수신 성공까지 보장하지 않는다.
7. 일반 자료 JSON·글 사진 ZIP·네이버 ZIP·선택 근거 ZIP의 포함/제외 경계를 확인한다. 내보낸 ZIP의 entry/CRC·본문 hash·원본 사진 SHA와 새 사본의 참조 재매핑을 대조한다.
8. 참조 없는 과거 글, 서버에서 사라진 정확 판, localOnly 사본, 원문 휴지통을 서로 구분한다. 추정 복구·자동 공개·원본 삭제는 없어야 한다.

### 기존 검사 재사용

| 범위 | 시작할 검사 |
| --- | --- |
| 정확 참조·저장 계약 | `tests/source-reference.test.cjs`, `tests/naver-capture-reference.test.cjs`, `tests/naver-capture-recovery-sync.test.cjs`, `tests/life-storage.test.cjs`, `tests/material-continuity-storage.test.cjs` |
| 사진 후보 핵심 여정 | `tests/source-photo-recovery-browser.cjs`, `tests/life-naver-capture-browser.cjs`, `tests/naver-source-photo-status-browser.cjs` |
| 일반 글 재개·중복 설치 | `tests/account-blog-continuity-browser.cjs`, `tests/account-blog-receipt-browser.cjs`, `tests/account-blog-storage.test.cjs` |
| 기존 준비의 근거 이동 | `tests/material-continuity-browser.cjs`, `tests/material-continuity-backend.cjs`, `tests/material-continuity-sql-fixture.cjs` |
| 근거·파일 보존 | `tests/photo-post-evidence-browser.cjs`, `tests/preservation-browser.cjs`, `tests/preservation-references.test.cjs`, `tests/preservation-package.test.cjs` |

실행 명령·환경과 증거 위치는 인계 진입 문서의 최신 내용을 따른다. 전체 검사를 무의미하게 반복하지 말고 변경 범위와 미확정 경계에 맞게 실행한 뒤 필수 CI를 완료한다. 1440/820/390px의 실제 자료 화면, 44px 조작·16px 입력·키보드·한글 조합·오류 재시도·본문 노드/선택 보존을 확인한다. 화면 폭 모사와 합성 Auth를 실제 Apple 기기·Google 로그인 확인으로 표시하지 않는다.

**종료 보고:** 구현 범위, 정확 커밋, 처음 실패와 원인, 변경 근거, 실제 핵심 여정 결과, 남은 제한, 실제 배포 여부를 각각 남긴다. 코드 존재·단위 통과·핵심 여정 통과·출시·실사용 효과는 별도 판정이다.
