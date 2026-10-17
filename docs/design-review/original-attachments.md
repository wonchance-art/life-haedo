# 원본 첨부 보관

확인일: 2026-10-18. 관리 화면의 `원본 첨부 보관`은 기존 자료 공간과 분리된 원본 보관 화면이다. 사진·PDF·노트 저장본과 작업본의 정확한 바이트, 원천 상대 경로, SHA-256, 역할과 Git 버전을 유지한다. 기존 자료를 수정하거나 서버·공개 범위를 바꾸지 않는다.

## 사용과 종료 결과

로그인한 계정에서 관리 → 원본 첨부 보관 → 파트 ZIP 하나 선택 → 포함 범위 확인 → `이 계정에 새 원본 사본 보관` 순서로 진행한다. 새 사본을 닫고 다시 열어 원본 목록을 조회할 수 있다. 파일별 원본 또는 파트 ZIP 전체를 내려받는다. 내려받은 ZIP을 다시 열면 기존 사본을 보존하는 새 사본으로 복원한다. 복원 전 확인과 취소는 저장하지 않는다.

노트는 Git 저장본과 로컬 작업본을 별도 역할로 표시하고 원문을 텍스트로 읽는다. 기존 자료의 원천 경로와 정확한 contentHash가 일치하는 버전만 연결 후보로 표시한다. 최신 버전으로 대신 열거나 경로만으로 연결하지 않는다. 호출자가 `onOpenSource`를 제공하면 해당 버전으로 이동할 수 있다. 첨부를 기존 노트에 자동 삽입하거나 기존 링크를 재작성하지 않는다.

사진 JPEG·PNG·HEIC와 PDF는 원본 다운로드를 지원한다. 미리보기·변환·HTML 삽입·PDF 실행은 지원하지 않는다. 임의 HTML과 스크립트도 실행하지 않는다. Markdown 원문 미리보기는 1 MiB 이하이며 더 큰 노트도 원본 다운로드로 유지한다. 이 텍스트 미리보기 한도는 원본 보관 한도가 아니다.

## 형식과 한도

`haedo-private-originals-part-v1` ZIP은 ZIP_STORED만 받는다. 각 파트는 128 MiB, 개별 파일은 64 MiB, 영수증은 1 MiB, 파일은 500개 이하이다. 여러 파트는 한 개씩 반복 처리한다. 약 489 MB 전체를 한 번에 메모리에 읽지 않는다. 큰 개별 파일은 경고 후 해당 파트 설치를 거부하며 사용자가 가진 원본 ZIP은 유지한다.

각 ZIP은 `part-receipt.json`과 영수증의 `snapshotPath`에 해당하는 파일을 담는다. 영수증은 format, part, partCount, sourceHead와 entries를 가진다. 각 entry는 sourceRelativePath, snapshotPath, role, mime, bytes, sha256 및 Git 저장본의 sourceGitCommit을 선언한다. 역할은 git-excluded-attachment, git-note-version, working-note-version이다. 실제 경로는 역할에 따라 snapshot/attachments/, snapshot/git-version/, snapshot/working-version/ 아래의 원천 상대 경로와 같아야 한다.

ZIP Blob을 그대로 보관하므로 영수증의 원래 정밀도와 추가 원본 메타데이터도 다운로드에서 보존된다. 경로를 추출·실행하지 않는다. 경로의 꺾쇠 제목 문자는 textContent로 표시하며 실행 태그 형태·절대 경로·제어 문자·역슬래시·빈 경로 요소·dot traversal을 거부한다. ZIP 중복·심볼릭 링크·범위 겹침·압축·추가 멤버와 크기/MIME/역할 불일치를 거부한다. 헤더와 중앙 목록을 대조하고 각 파일의 CRC32와 SHA-256을 모두 검사한다. SHA는 바이트 일치 증거이며 외부 발행자 서명은 아니다.

## 저장과 계정

별도 IndexedDB `life-original-attachments-v1` v1의 copies 저장소를 사용한다. 기존 앱 DB 버전·형식·localStorage 키는 바꾸지 않는다. 한 사본에 원래 ZIP Blob 하나와 파일별 offset/크기/CRC/해시를 저장하므로 같은 사본의 원문 Blob을 중복 저장하지 않는다. 원본 읽기는 Blob.slice로 파일 하나씩 검증한다. 브라우저 용량 부족·중단된 트랜잭션에서는 기존 사본을 유지하고 재시도할 수 있다.

계정은 기존 HaedoAuth의 서버 확인된 projectUrl+userId를 사용한다. 이메일·사용자 표시 정보로 소유자를 추정하지 않는다. 조회/가져오기/내려받기에서 현재 계정을 확인하고 비동기 해시 이후 다시 확인한다. 계정이 바뀌면 진행 중 트랜잭션을 중단하고 UI와 저장소 핸들을 닫는다. 다른 계정은 알고 있는 사본 ID나 원천 경로로 조회할 수 없다.

이는 이 브라우저의 계정별 보관이다. 같은 컴퓨터의 프로필 사용자에 대한 암호화 저장소나 서버 동기화는 제공하지 않는다. 내보낸 ZIP은 연결·로그인 토큰 없이 원본과 영수증을 담으며 사용자가 별도로 안전하게 보관해야 한다.

## 연결 API

- `HaedoLife.OriginalAttachments.readPart(blob, {signal,onProgress})`: 파일별 CRC/SHA 검증. IDB·계정·네트워크 접근 없음.
- `HaedoLife.OriginalAttachments.create()`: 현재 HaedoAuth 계정의 보관 서비스. prepare → install로 새 사본을 저장하고 list/entries/file/archive/matchSource를 제공한다. dispose로 종료한다.
- `LifeOriginalAttachmentsUI.open({auth,storage,onOpenSource})`: Promise로 `{dispose,dirty,flush,refresh}` 반환. HaedoAuth·Shell.storage가 기본값이다. dispose는 모달과 진행 중 처리를 닫는다. onOpenSource는 workspaceId/versionId/title/sourceRelativePath를 받는다.

공용 HTML에는 original-attachments.js → original-attachments-ui.js 순서와 original-attachments.css를 연결한다. 서비스워커와 Pages 준비 allowlist에도 세 자산을 포함해야 한다.

## 구현 선택

2026-10-18 공식 GitHub 릴리스/API에서 [fflate v0.8.3](https://github.com/101arrowz/fflate/releases/tag/v0.8.3), [MIT 라이선스](https://github.com/101arrowz/fflate/blob/master/LICENSE), 공개 보안 권고 및 유지보수 상태를 확인했다. 기존 앱도 fflate와 Blob·IndexedDB를 사용한다. 기존 텍스트 중심 Obsidian ZIP 형식은 Git 제외 바이너리·작업본을 담지 못한다.

fflate.unzipSync로 파트 전체를 펼치는 대신 Blob.slice 기반의 제한된 ZIP_STORED 목록·CRC 검사를 구현했다. 압축/ZIP64/임의 ZIP 호환성은 제공하지 않는다. 이 차이로 새 의존성 없이 원본 패키지 계약을 읽고 큰 파트의 전체 복사를 피한다. 한도나 포맷을 확장하기 전에는 실제 사용 장면에서 더 큰 파일의 실패·복구와 메모리를 다시 확인해야 한다.

## 검증과 제약

`node --test tests/original-attachments.test.cjs`는 익명 ZIP의 정확한 바이트·경로·노트 버전, 취소·한도·해시/MIME/역할/추가 멤버, traversal·중복·손상·압축 거부를 확인한다.

`BASE_URL=http://127.0.0.1:4201 PW_MODULE_PATH=... CHROMIUM_PATH=... node tests/original-attachments-browser.cjs`는 실제 앱과 IndexedDB·모의 서버 인증을 사용한다. 취소, 저장 중단 후 재시도, 원본/ZIP 다운로드, 새 사본 복원, 새로고침, 정확 버전 연결, 계정 전환과 다른 계정 접근 거부를 확인한다. 1440·820·390px 화면의 모달 오버플로·이름 없는 버튼·작은 조작 영역과 익명 스크린샷을 확인한다.

실제 원본 5파트는 브라우저·서버에 넣지 않고 로컬 readPart로 순차 검증했다. 첨부 103개와 노트 저장본/작업본 2개의 총 489,204,980바이트가 모두 CRC·SHA 검사를 통과했다. 이 결과는 원본 패키지와 앱 파서의 호환 증거이다. 실제 사용자 계정 설치·서버 업로드·실제 Apple 기기/Files 사용의 증거는 아니다. 개인 경로·원문·계정 정보는 이 문서와 공개 테스트에 넣지 않았다.
