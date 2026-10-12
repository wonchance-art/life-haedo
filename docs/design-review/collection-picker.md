# 대상을 고르고 메모 이어 쓰기

2026-10-12 UTC. 컬렉션 추가를 긴 빈 양식에서 **찾기 → 선택 → 메모 → 명시 저장**으로 바꿨다. 실제 프로필 피드·글쓰기 첨부 기능과 구분한다. PR #68 위의 후속 변경이며 병합·배포는 Local이 맡는다.

## 직접 체험

`npm run dev` 후 로그인 → 기록 → 컬렉션 → `+`. 직접 경로는 `index.html?section=records&view=collection`이며 기존 `life.html?view=collection`도 유지한다.

1. 이름 입력은 **현재 계정·작업공간에 저장한 컬렉션**에서만 찾는다. 종류를 고르거나 긴 목록을 더 볼 수 있다. 보관한 항목은 상태를 표시한다.
2. YouTube 영상·GitHub 공개 저장소 링크는 **링크 확인**을 누를 때만 외부 조회한다. 응답을 고르면 제목·종류·출처가 들어간 새 입력으로 이어진다. 게시 채널·저장소 소유자는 아티스트·저자로 복사하지 않는다.
3. 이미 저장한 출처라면 원래 항목의 메모를 이어 쓴다. 새 항목으로 몰래 복제하지 않는다. 선택 후에는 메모가 먼저 보이고 `정보 수정`에서 제목·분류·출처 등을 펼친다.
4. 찾지 못한 대상은 `직접 입력`으로 이어진다. 이름 또는 주소와 선택한 종류를 넘기며 주소 조회 오류도 입력을 지우지 않는다. 마지막 `저장` 전에는 저장소를 바꾸지 않는다.

원본·발췌·버전·계정 범위·동기화·공개·백업 포맷은 변경하지 않았다. collection v1과 CAS 저장을 재사용한다. 새 SQL, 의존성, 자동 공개, 개인정보의 외부 검색 전송이 없다. 이미지 요청도 추가하지 않았으며 기존 별도 이미지 켜기 설정을 유지한다.

## 화면과 판단

모바일은 하단 선택창, 넓은 화면은 가운데 선택창이다. 검색/종류와 하단 직접 입력은 고정하고 결과만 스크롤한다. 긴 한글 제목은 잘라서 감추지 않고 줄바꿈한다. 제목·유형/창작자·상태만 두며 기존 항목에는 편집 아이콘, 외부 신규 후보에는 추가 아이콘을 사용한다. 기존 공통 아이콘과 연한 색상·44px 조작 영역을 재사용했다.

| 화면 | 1440px | 820px | 390px |
| --- | --- | --- | --- |
| 많은 자료 | [보기](evidence/collection-picker/many-items-1440.png) | [보기](evidence/collection-picker/many-items-820.png) | [보기](evidence/collection-picker/many-items-390.png) |
| 링크 선택 | [보기](evidence/collection-picker/link-choice-1440.png) | [보기](evidence/collection-picker/link-choice-820.png) | [보기](evidence/collection-picker/link-choice-390.png) |
| 메모 우선 편집 | [보기](evidence/collection-picker/note-first-1440.png) | [보기](evidence/collection-picker/note-first-820.png) | [보기](evidence/collection-picker/note-first-390.png) |

이미지는 실제 앱의 익명 한글 샘플과 모의 제공자 응답이다. 사진·표지가 실제 서비스에서 내려온 것처럼 표현하지 않는다. 빈 상태, 로딩, 오류를 포함한 17개 크기/상태의 측정은 [보고서](evidence/collection-picker/report.json)에 있다. 주관적 시각 검토에서는 검색·후보·직접 입력의 구분, 접힌 정보의 발견 가능성, 긴 목록에서 메모까지의 조작을 확인했다. 이 검토는 사용자 만족도 평가를 대신하지 않는다.

## 구현 선택과 참고

Instagram의 노래/장소 선택에 대한 사용자 제안에서 **대상을 먼저 고르는 순서**를 채택했다. Instagram 공식 API나 전체 음악 카탈로그를 연동했다고 주장하지 않는다.

[Radix Dialog 공식 소스](https://github.com/radix-ui/primitives/tree/main/packages/react/dialog), [MIT 라이선스](https://github.com/radix-ui/primitives/blob/main/LICENSE), npm 공식 레지스트리 `@radix-ui/react-dialog`의 배포 버전 **1.3.1**을 확인했다. 레지스트리 수정 시각과 해당 디렉터리 [최근 변경](https://github.com/radix-ui/primitives/commit/925c88b773bb32aecf1b52a296a1a21ba7a720b9)은 2026-10-12다. React 기반 구성요소를 이 정적 일반 JavaScript 앱에 추가하면 런타임과 빌드 유지 비용이 생긴다. 따라서 설치하지 않고, 브라우저의 [native dialog](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element), 기존 metadata adapter와 저장 모듈을 재사용했다. 새 패키지를 설치하지 않았으며 별도 패키지 보안 감사 통과를 주장하지 않는다.

선택창은 저장소를 모르며 선택값을 호출자에게 반환한다. native modal의 배경 비활성화·Escape를 사용하고 Tab 경계 순환/닫기 후 초점 복원을 명시 처리한다. 입력 변경·닫기·화면 이탈은 조회를 취소하고 늦은 응답을 무시한다. 모션 감소 환경에서는 진입 애니메이션을 끈다. 드래그로 닫기는 잘못된 취소와 접근성 비용 때문에 추가하지 않았다.

## 검증

- `npm test`: 412/412. 원문·버전·저장·동기화·백업 회귀.
- `npm run check`: HTML 18, JS 64, 참조 289, PWA 통과.
- `collection-picker-browser.cjs`: 8개 흐름, 17개 화면 상태. 선택 전 무요청, IME, 키보드 순환/닫기 복귀, 터치 선택, 기존 ID/메모, 중복 출처, 조회 실패/취소, 저장 실패, 접힌 필수 입력 복구, 종류 변경, 47개 긴 한글 항목, 보관 상태와 CAS 충돌 사본 확인.
- `collection-library-browser.cjs`: 12개 흐름. 계정/작업공간 경계, 실제 두 탭 충돌, 입력 보존, 다운로드·사본 복구 포함.
- `collection-metadata-browser.cjs`: 7개 흐름. 기존 부분 적용/개인 메모/창작자 보존.
- `collection-media-browser.cjs`: 9개 흐름. 이미지 opt-in·취소·지연·실패·백업 보존.
- `platform-life-browser.cjs`: 9개 통과. 익명 HTTP 인증, 원문·발췌·복구, 로그아웃 경계, 오프라인 저장, 실제 보존된 v93 산출물 → v94 서비스워커 교체와 모듈 해시/기존 데이터 보존.
- 픽커 검사에서 페이지 오류 0. 예상한 제공자 제한 응답(429) 콘솔 1건. 플랫폼의 의도된 전송/콜백 오류 3건은 별도 분류. 확인하지 않은 전체 CI 완료를 로컬 결과로 대체하지 않는다.
- 1440·820·390px에서 가로 넘침·이름 없는 조작·44px 미만 조작·16px 미만 입력 없음, 측정된 텍스트 최소 대비 5.56:1. 화면 캡처는 애니메이션 종료 뒤 수행.

Linux Chromium 151 / Playwright 1.63.0, 실제 IndexedDB와 합성 Auth/제공자 응답이다. 실제 Mac/iPad/iPhone·소프트 키보드·한국어 IME·화면 읽기 도구 검증은 남았다. 음악·장소의 외부 이름 검색, 실제 Google 로그인, YouTube 실서비스/표지 네트워크 확인을 이번 시험으로 증명하지 않는다.

## Local 인계와 다음 순서

1. 선행 #66 → #67 → #68 다음 이 PR을 검토한다. 스택을 중간에 retarget할 때 변경이 중복되지 않는지 비교한다. 이 브랜치만 먼저 main에 병합하지 않는다.
2. 설정/SQL 변경은 없다. 운영 DB 합성 검사도 실행하지 않는다. `npm test`, `npm run check` 후 실제 기기에서 선택창·한국어 검색·링크→메모→저장·뒤로 이동을 확인한다.
3. Local의 기존 병합·배포 절차 후 공개 산출물의 새 picker 파일과 SW v94(다른 Local 변경과 함께 버전 조정 가능)를 확인한다. 기존 컬렉션과 원문이 유지되는지, 이전 서비스워커에서 업데이트되는지 확인한다. Cloud에서는 병합·배포하지 않았다.
4. 다음 제품 작업은 **고른 항목을 글/내 페이지에 연결하고 비공개 피드에서 미리보기**다. 같은 선택창을 재사용하되 원본 컬렉션 편집과 글에 연결하기를 구분한다. 그 다음 음악·책·장소의 외부 이름 검색 제공자를 비용·라이선스·한국어 품질 기준으로 비교한다.
