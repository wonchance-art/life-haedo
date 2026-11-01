# 내 데이터 한 번에 지키기 (설정 → 백업·복원)

2026-11-01. 기준은 main `3ecc0f8`(haedo-v170)이고 이 변경의 SW 캐시는 `haedo-v171`이다. 마이그레이션·서버 쓰기·배포는 없다.

## 목표와 범위

소유자는 Mac·iPad·iPhone에서 한 계정을 쓴다. 이전에는 백업이 설정(자료·구성 백업, 내보내기·사본 복원, 컬렉션 백업·복구, 보관 범위·근거 파일), 연표 목록(연표·목표·습관 백업), 글 편집기(사진 글 ZIP·HTML), 근거 ZIP에 흩어져 있었다. 이번 변경으로 설정의 **백업·복원** 화면 하나에서 다음을 한다.

1. **모두 받기**: 계정의 모든 자료공간을 ZIP 하나로 받는다.
2. **복원**: 모두 받기 ZIP이나 기존 형식별 파일을 골라 내용을 확인한 뒤, 고른 형식만 새 자료공간 사본으로 복원한다.
3. **형식별 파일**: 기존 형식별 화면을 그대로 연다.

새 형식은 만들지 않았다. ZIP 안의 파일은 모두 기존 형식이다. 예외는 계정 문서 파일 하나로, 내보내기 형식이 원래 없어서 `haedo-account-documents-v1`을 추가했다. ZIP 자체도 형식 하나로 합치지 않는다. 형식별 파일을 담고 목록 파일 두 개(`README.txt`, `manifest.json`)를 더한 묶음이다.

## ZIP 구성

| 경로 | 종류 | 형식(기존 코드) | 개수 기록 |
| --- | --- | --- | --- |
| `README.txt` | 사람이 읽는 목록 | 텍스트 | 파일마다 형식·버전·개수·바이트·SHA-256, 빠진 항목 |
| `manifest.json` | 기계가 읽는 목록 | `haedo-full-backup-v1` | 아래 참조 |
| `workspaces/NN/library.json` | 자료·구성 | 폴더가 있으면 `life-material-library-backup-v1`(`SourceFolders.makeBackup`), 없으면 `life-workbench-backup-v1`(`Workbench.makeBackup`). 자료·구성 화면과 같은 선택 | 자료·원문 버전·발췌·묶음·페이지 항목·책·폴더 |
| `workspaces/NN/collection.json` | 컬렉션 | `life-collection-backup-v1`(`Collection.makeBackup`) | 항목·보관 |
| `workspaces/NN/nine-boards.json` | 9칸 구성 | `life-nine-board-backup-v1/v2`(`NineBoard.backup`) | 구성·항목 |
| `workspaces/NN/photo-posts/<글ID>.zip` | 사진 글(초안·보관 포함 전부) | `life-photo-post-backup-v1/v2`(`PhotoPost.backup`). 원본 바이트 그대로이며 HEIC는 `views/`에 보기용 JPEG를 함께 담는다 | 글·사진·HEIC 보기용·첨부 |
| `account-documents.json` | 계정 설정·기록 문서 | `haedo-account-documents-v1`(신규) | 문서 |
| `timeline-goals-habits.json` | 연표·목표·습관 | `haedo-platform-backup-v1`(`platform-store.backup()`과 같은 모양) | 연표·목표·습관 |

`manifest.json`에는 `format`, `version`, `createdAt`, `appVersion`(오프라인 캐시 이름), `complete`, `workspaces`가 들어간다. `workspaces`는 순번·로컬 ID·제목·복구 사본 여부다. `files`는 경로·종류·자료공간·형식·형식 버전·개수·바이트·SHA-256이다. 사진 글은 글 ID·제목·저장/초안·보관 여부도 함께 기록한다. `missing`에는 빠진 항목과 오류를 적는다. 계정 ID와 프로젝트 주소는 넣지 않는다.

계정 문서 파일은 `storage.listAccountDocs()`와 `readAccountDocRecord()`로 읽은 로컬 값이다. 항목은 `{prefix, workspaceId, postId?, value}`이며 계정 키는 빼고 저장한다. 대상은 읽던 위치, 관심, 연간 계획, 뉴스 프로필·설정·언어·반응·읽기 평가, 공개 표지 설정, 페이지 초안, 글별 인용 근거다. 연간 계획은 전용 `haedo-annual-plan` 파일 대신 이 파일에 들어간다. 전용 파일은 연간 계획 화면에서 계속 받을 수 있다.

**보관 범위·근거 파일은 모두 받기에 넣지 않는다.** 직접 고른 글 20편·256 MiB까지만 담는 선택 형식이고, 그 내용(글·사진·근거·9칸·정확 원문)은 위 파일들에 이미 들어 있기 때문이다. 이 파일은 형식별 화면에서 받고, 복원 화면은 이 파일을 인식해 기존 `Preservation.read/restore`로 복원한다.

연표·목표·습관은 이 기기의 `localStorage`에 내려받은 계정 사본으로 만든다. 연표 목록을 이 기기에서 연 적이 없으면 0개일 수 있다. 화면과 README에는 "이 기기에 내려받은 사본"으로 표시한다. 연표 목록이 서버에서 받는 최신본을 대신하지 않는다.

## 받기 동작

- 화면을 열면 먼저 형식별 목록과 개수, 자료공간 수, 예상 크기를 보여 준다(`#fbInventory`). 사진은 저장된 Blob 크기를 더해 계산하고 바이트는 읽지 않는다.
- 진행 막대와 상태 줄로 읽기와 ZIP 만들기를 각각 n/m으로 표시한다. 항목 사이마다 이벤트 루프에 양보한다.
- ZIP은 fflate `Zip`과 `ZipPassThrough`(무압축)로 스트리밍한다. 출력은 8 MiB마다 Blob 조각으로 넘긴다. 예상 크기가 1 GiB를 넘으면 경고한다. 3.5 GiB를 넘으면 ZIP32 한계 때문에 모두 받기를 막고 형식별 파일을 안내한다.
- 항목 하나라도 읽지 못하면 전체 ZIP을 만들지 않는다. 실패 목록을 보여 주고 두 가지를 고르게 한다.
  - **실패한 항목 다시 시도**: 실패한 항목만 다시 읽는다.
  - **빠진 항목을 표시한 일부 ZIP 받기**: 이 ZIP은 `complete: false`, `missing`, 파일명 `-partial`, README "빠진 항목"이 붙는다.
- 받은 뒤에는 형식별 파일 수·개수·형식 버전과 "하나의 형식이 아닙니다" 안내를 다시 보여 준다(`#fbDownloadResult`).

## 복원 규칙

1. **파일 판별**: ZIP과 JSON을 받는다.
   - ZIP은 중앙 디렉터리를 Blob 조각으로 읽는다. 무압축 항목만 받고, 중복·상위 경로를 거부하며, 로컬 헤더가 디렉터리와 맞는지 확인한다. 전체를 메모리에 올리지 않는다.
   - ZIP 안의 `manifest.json` 형식으로 종류를 정한다. 전체 백업, 사진 글 ZIP, 근거 ZIP을 구분한다.
   - JSON은 `format`으로 정한다. 자료(`life-tools-backup-v1`), 자료·구성(v1과 폴더 포함), 컬렉션, 9칸, 계정 문서, 연표·목표·습관, 연간 계획을 구분한다.
2. **전체 백업 검증**: 미리보기 전에 다음 중 하나라도 맞지 않으면 거부하고 아무것도 쓰지 않는다.
   - `manifest.json` CRC가 맞아야 한다.
   - 모르는 `haedo-full-backup-*` 형식이나 버전이면 `unsupported_version`으로 거부한다.
   - 목록 밖 파일이 있거나 목록의 파일이 빠졌으면 `tampered`로 거부한다.
   - 각 파일의 크기·SHA-256이 맞아야 한다. 다르면 `tampered`로 거부하고 해당 경로를 표시한다.
   - JSON 내부 형식이 목록과 같아야 한다.
   - 경로와 종류·자료공간이 맞아야 한다.
   - 크기는 3.5 GiB(ZIP), 64 MiB(JSON)까지다.
3. **미리보기**: 형식·버전·생성 시각·앱 버전·파일 수를 보여 준다. 형식별 체크박스에는 개수·자료공간 수·파일 형식/버전이 붙는다. 연표·목표·습관은 체크박스 없이 다음 두 가지만 제공한다. 이 화면에서는 복원하지 않는다.
   - "이 파일만 받기"
   - "연표 목록에서 복원" 링크(`workspace.html?section=manage#backupAll`)
4. **새 사본만 만든다**: 원래 자료공간마다 새 자료공간 하나를 만든다. 형식마다 기존 단일 트랜잭션 함수를 쓴다.
   - 자료·구성: `SourceFolders/Workbench/Core.restoreBackup`을 거쳐 `installLibraryCopy`·`installWorkbenchCopy`·`installWorkspace`로 설치한다.
   - 자료·구성을 고르지 않았으면 같은 제목의 빈 공간을 만든다(`createWorkspace`).
   - 컬렉션: 새 공간의 빈 컬렉션에 `Collection.appendBackup` 후 `saveCollection`.
   - 사진 글: `PhotoPost.readBackup`으로 크기·SHA-256·HEIC 보기용을 검증한다. 브라우저에서는 편집기 복원과 같은 디코딩 크기 검사도 거친다. 그다음 `savePhotoPost`로 저장하고, 근거가 있으면 `savePhotoPostWithEvidence`로 저장한다.
   - 9칸: `NineBoard.copies` 후 `saveNineBoardCopy`.
   - 계정 문서: `applyAccountDoc(key, {expectedHash: null})`로 쓴다. 로컬에 없을 때만 쓰므로 덮어쓰지 않는다.
5. **정확 버전 연결**: `Core.restoreBackup`은 컬렉션 순서를 유지한 채 새 ID를 준다. 그래서 순번으로 옛 ID→새 ID 표를 만들고, 같은 묶음 안 참조만 새 사본으로 옮긴다. 내용·해시는 바꾸지 않고 최신 버전으로 치환하지 않는다.
   - 옮기는 참조: 9칸 근거, 글 인용 근거, 계정 문서의 작업공간·원문 ID
   - 인용 근거는 `checkEvidenceTargets`가 정확한 구절을 다시 확인한다. 맞지 않으면 근거 없이 글만 저장하고 결과에 적는다.
6. **글 상태**: 전체 백업에서는 manifest에 기록한 저장/초안과 보관 상태로 복원한다. 사진 글 ZIP 하나만 고르면 편집기와 같이 새 초안이 된다.
7. **복원하지 않는 것**
   - 공개 표지 설정: 공개 상태와 묶여 있어 두 공간이 한 공개 페이지를 가리키게 될 수 있다.
   - 연표·목표·습관과 연간 계획 전용 파일: 각 화면에서 복원한다.
8. **실패 처리**
   - 자료·구성 복원이 실패하면 그 공간의 나머지 형식은 "건너뜀"으로 둔다. 참조가 끊긴 반쪽 사본을 만들지 않기 위해서다.
   - 결과는 형식·공간별로 복원함/실패/건너뜀과 개수, 메시지로 보여 준다.
   - "실패한 항목 다시 복원"은 같은 새 사본에 실패한 항목만 다시 넣는다.
9. **복원 뒤 상태**: 설치 함수는 새 공간을 활성으로 바꾸므로, 끝나면 원래 쓰던 공간을 다시 활성으로 둔다. 결과의 "… 열기"로 새 공간을 연다. 새 사본은 계정 자동 연동 규칙(2026-11-01)에 따라 다른 기기로 동기화된다. 공개는 하지 않는다.

## 메뉴와 기존 주소

- 설정 목록의 파일 항목 여섯 개를 **백업·복원**(`#lifeBackupOpen`, view `backup`, 대표 영역 manage) 하나로 바꿨다.
- 백업·복원 화면의 "형식별 파일"에 기존 행이 같은 이름·ID로 그대로 있다(`#lifePreservationOpen`, `#lifeBackupMaterials`, `#lifeBackupPlanning`). 그 행에서 연 화면은 백업·복원으로 돌아오고, 누른 행에 다시 초점을 둔다.
- 기존 직접 주소 `view=transfer|workbench-backup|preservation`은 기능 흐름 계약에 따라 정확한 화면을 그대로 연다. 뒤로 가면 백업·복원의 해당 행에 초점을 둔다.
- `section=manage#lifeBackupMaterials|Planning|Choices`는 백업·복원을 열고 형식별 파일 제목에 초점을 둔다.
- 연표 목록의 백업 화면에서 돌아가는 링크도 백업·복원을 가리킨다.

## 접근성·화면

- 섹션은 제목(h2)으로 구분한다. 복원 형식 선택은 `fieldset/legend`와 체크박스 라벨(44px)로 만든다. 진행 막대에는 `aria-label`을 단다. 상태 줄은 `role=status`이며, 결과·미리보기가 나오면 제목에 초점을 둔다.
- 받기·복원 중에는 화면의 조작을 잠근다. 계정이나 화면이 바뀌면 다음 단계를 멈춘다. 이미 만든 새 사본은 그대로 남는다.
- 390px·1440px에서 가로 넘침, 44px 미만 조작, 이름 없는 조작, 대비 실패가 없음을 브라우저 검사로 확인했다.

## 검증

- `tests/full-backup.test.cjs` 5개 시나리오는 실제 storage와 메모리 IndexedDB로 돌렸다.
  - 두 공간을 모두 받기 → 파일 목록과 SHA-256 → 각 파일이 기존 모듈로 복원되는지
  - 다른 계정에 새 사본으로 복원: 정확한 옛 버전, HEIC 원본·보기용 JPEG·JPEG 바이트 일치, 인용 근거·9칸 근거 연결, 뉴스 설정, 기존 공간 불변, 활성 공간 유지
  - 거부 사례: 1바이트 변조, 목록 밖 파일, 모르는 버전 2가지, 압축 ZIP, 크기 초과, 모르는 JSON
  - 일부 실패: 완전 ZIP 거부, 실패 항목만 재시도, 표시된 일부 ZIP
  - 형식별 단일 파일 판별과 복원
- `tests/full-backup-browser.cjs` 6개 검사는 실제 앱·SDK·IndexedDB와 합성 Auth/FakeCloud에서 돌렸다. 결과는 `.local/full-backup/`에 남는다.
  - 설정의 단일 항목과 받기 전 형식별 개수
  - 모두 받기 ZIP 바이트 검증
  - 기존 주소 복귀와 초점
  - 변조 ZIP 거부와 무변경
  - 빈 계정 B에 복원: 버전·바이트·디코딩 픽셀 일치, 기존 공간 불변
  - 결과에서 새 공간 열기
  - 390px·1440px 캡처도 함께 남긴다.
- 설정 행을 누르던 기존 브라우저 검사는 백업·복원을 거치도록 진입 단계만 바꿨다. 단언은 그대로다. 공통 도우미는 `openBackupCenter`(`tests/life-sync-browser.cjs`)다.

## 미검증·한계

- 실제 Apple 기기(iPad·iPhone Safari)에서 큰 ZIP의 메모리와 파일 저장(공유 시트)은 확인하지 않았다. 1 GiB 이상 경고는 보장이 아니다.
- 실제 Supabase 계정에서 복원한 사본이 동기화되는 것은 FakeCloud로만 확인했다.
- 연표·목표·습관은 이 기기 사본 기준이다. 서버 최신본과 다를 수 있다.
- 사진 글 ZIP 형식에는 글 상태가 없다. 그래서 단일 ZIP을 복원하면 초안이 되고, 전체 백업에서만 manifest의 상태를 쓴다.
- 9칸 항목 중 저장 글 참조는 새 글 ID로 옮기지만, 글 revision은 새 사본 기준이라 원래 revision과 다를 수 있다.
- 형식별로 나눠 받는 크기 분할, 예를 들어 공간별 ZIP은 아직 없다. 3.5 GiB를 넘는 계정은 형식별 화면을 써야 한다.
