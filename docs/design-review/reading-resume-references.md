# 읽던 위치 다시 열기 — 공식 구현 참고와 독립 UX 검토

2026-10-07 UTC. 대상은 `074e35d` 이후의 계정·작업공간별 **로컬 읽기 위치 1개**다. 새 렌더러·서버·동기화·백업 형식을 도입하지 않는다. 기존 [원문 위치·검색 계약](../life-tools-design/open-source-review.md)과 [읽기 화면 참고](references.md)를 유지한다. 아래는 공식 코드·메타데이터를 읽은 결과이며 타 제품을 직접 실행한 사용성 평가가 아니다.

## 결정

기존 원문 버전·UTF-16 위치와 공통 UI를 재사용한다. 원문·발췌 bundle 밖에 작은 로컬 메타데이터만 둔다. 본문 문자열·검색어·선택한 원문 문자열을 복제하거나 로그로 남기지 않는다. EPUB CFI/XPath·서버 진행도·읽음 판정이 없는 현재 평문 리더에는 전용 라이브러리 도입 비용이 문제 규모보다 크다. 자체 코드는 위치 검증·저장·복원에 한정하고 기존 계정·작업공간 격리를 재사용한다.

## 확인한 공식 사례

| 후보·공식 근거 | 확인한 패턴 | 이번 선택 |
| --- | --- | --- |
| **Zotero reader** [고정 소스](https://github.com/zotero/reader/blob/692c28989629acf920fadb683747e18e5506b214/src/common/reader.js), [COPYING](https://github.com/zotero/reader/blob/692c28989629acf920fadb683747e18e5506b214/COPYING) | `primaryViewState`를 받아 view를 만들고, `onChangeViewState`는 debounce 후 외부 callback에 전달한다. 원문·주석과 화면 상태를 구분한다. | **설계 참고.** view 상태와 본문 데이터의 분리, 잦은 변경의 묶음 저장을 참고한다. React·PDF/EPUB/HTML 리더 전체나 코드 조각을 복사하지 않는다. |
| **Kavita** [읽기 구현](https://github.com/Kareadita/Kavita/blob/f75863cb77c0f6aa26e0794a1848294e63c9d07d/UI/Web/src/app/book-reader/_components/book-reader/book-reader.component.ts), [사용자 진행도 모델](https://github.com/Kareadita/Kavita/blob/f75863cb77c0f6aa26e0794a1848294e63c9d07d/Kavita.Models/Entities/Progress/AppUserProgress.cs) | `handleScrollEvent()`는 초기·지연 복원 스크롤 중간값 저장을 미룬다. 첫 가시 요소의 XPath를 구하고 사용자/장별 `BookScrollId`에 보관한다. | **설계 참고.** 복원 과정의 프로그램 스크롤이 기존 위치를 덮어쓰지 않게 한다. 단순 페이지 픽셀 대신 정확한 원문 버전의 문자 위치를 사용한다. 서버 진행도·통계·책갈피 목록은 도입하지 않는다. |
| **epub.js** [공식 위치 예제](https://github.com/futurepress/epub.js/blob/eee359d0790002115a1156a9833c54f4bcd44c1d/examples/locations.html), [README](https://github.com/futurepress/epub.js/blob/eee359d0790002115a1156a9833c54f4bcd44c1d/README.md) | 예제는 문서별 location 목록을 로컬에 보관하고, 현재 CFI·`relocated` 이벤트·CFI 위치 열기를 사용한다. | **개념 참고, 의존성 제외.** 위치를 화면 픽셀과 구분하는 점만 참고한다. 위치 목록의 저장을 마지막 읽던 위치 저장과 혼동하지 않는다. EPUB이 아닌 현재 평문에 CFI·페이지 분할·진도 슬라이더를 추가하지 않는다. |
| **Readwise Reader** [공식 문서 진입](https://docs.readwise.io/reader) | 이 환경의 허용 목록에는 공식 문서 호스트가 없어 이번에는 문서 본문을 확인하지 않았다. | 후보만 기록한다. 검증하지 않은 자동 복귀·동기화 동작을 이번 설계의 근거로 삼지 않는다. |

### 릴리스·유지관리·라이선스·공개 권고

2026-10-07 공식 GitHub API와 npm registry를 조회했다. Zotero `reader`의 최신 릴리스 API는 404였으므로 별도 안정 릴리스 번호를 만들지 않는다. 조회한 HEAD `692c289…`의 commit 날짜는 2026-10-01이며 `COPYING`은 **AGPLv3**를 명시한다. 저장소는 보관 처리되지 않았다.

Kavita 공식 최신 릴리스는 [v0.9.1.4](https://github.com/Kareadita/Kavita/releases/tag/v0.9.1.4), 게시일 2026-09-02다. 조회한 기본 브랜치 HEAD `f75863c…`는 2026-10-03이며 [LICENSE](https://github.com/Kareadita/Kavita/blob/f75863cb77c0f6aa26e0794a1848294e63c9d07d/LICENSE)는 **GPL-3.0**다. 참고한 코드의 commit과 릴리스 버전이 같다고 주장하지 않는다.

epub.js의 GitHub 최신 릴리스는 [v0.3.88](https://github.com/futurepress/epub.js/releases/tag/v0.3.88), 2020-07-01이다. 반면 [npm 공식 최신 배포](https://registry.npmjs.org/epubjs/0.3.93)는 **0.3.93**, 게시일 2022-02-16이다. 조회한 HEAD `eee359d…`는 2026-03-24이며 [실제 license](https://github.com/futurepress/epub.js/blob/eee359d0790002115a1156a9833c54f4bcd44c1d/license)와 npm은 **BSD-2-Clause**를 확인한다. 최신 commit이 최신 패키지 배포를 뜻하지 않는다.

공식 공개 security-advisories endpoint 조회 결과 Zotero reader와 epub.js는 각각 빈 목록, Kavita는 12건이었다. Kavita에는 [주석 읽기 접근검사 권고](https://github.com/Kareadita/Kavita/security/advisories/GHSA-gjx7-m655-3grw) 같은 계정 경계 항목이 포함된다. 이는 조회 가능한 해당 저장소의 공개 목록이며 전체 취약점 부재·현재 릴리스 영향·수정 완료를 판정한 결과가 아니다. 이번에 어떤 후보도 설치·배포하지 않는다. 조회 원본과 확인한 코드 사본은 `.local/reading-resume-review/`에 둔다.

## 가장 작은 화면 계약

- 홈과 기록에 마지막 위치 **한 행**만 표시한다. `이어 읽기`는 명시적인 행동 문구로 남기고, 원문 제목과 필요한 이전 버전 표식을 보여준다. 페이지에 들어왔다는 이유로 자동 이동하지 않는다. 본문 화면에 새로운 상시 패널·진도바·진행률은 추가하지 않는다.
- 기존 공통 버튼·도형을 사용한다. 제목은 한글 단어 단위로 자연스럽게 줄바꿈하고 좁은 화면에서도 조작은 44px를 유지한다. 제목이 매우 길 때 행의 높이를 어떻게 제한할지는 최종 이미지에서 판단하며, 제목을 알아볼 수 없을 만큼 줄이지 않는다.
- 위치 삭제의 접근 가능한 이름은 `이어 읽기 위치 지우기`처럼 원문 삭제와 구분한다. 삭제 뒤 프로그램 이동만으로 행이 즉시 다시 생겨서는 안 된다. 새 실제 읽기 상호작용 이후 다시 기록할 수 있다.
- `이 브라우저` 범위는 짧게 드러낸다. 계정 전체의 기기 간 이어읽기나 백업 대상이라고 표현하지 않는다.

## 위치·선택의 우선순위와 복구

1. 사용자가 누른 검색 결과·저장 문장의 정확한 locator는 그 행동의 목적지다. 영속 위치가 이를 덮어쓰지 않는다.
2. 관련 기록에서 돌아오는 기존 세션의 정확한 버전·선택·스크롤 복귀 계약은 그대로 유지한다.
3. 저장한 위치는 명시적인 `이어 읽기`로만 적용한다. 일반 원문 열기는 현재 계약대로 처음부터 연다.
4. 실제 읽기 스크롤·선택이 새 위치를 만든다. 단순 열기, resize, 초기 렌더링, 복원으로 생긴 scroll 이벤트가 최근 기록을 새로 만들거나 바꾸지 않는다. 복원 도중 저장을 억제한다.
5. 버전·원문·작업공간이 사라지거나 offset이 유효하지 않으면 최신 버전으로 추측 이동하지 않는다. 유효성 검증 뒤 위치를 정리하거나 짧은 실패 안내와 지우기 경로를 제공한다. 위치 저장 실패가 읽기·선택·발췌를 막아서는 안 된다.

필수 체험은 긴 한글 원문의 중간 → 새로고침 → 홈/기록의 명시적 이어 읽기 → 같은 이전 버전·구간, 검색 locator와 세션 복귀의 우선, 위치 지우기·없는 버전·계정/공간 전환이다. 1440/820/390px에서 같은 자료를 검토하며 실제 Apple 기기나 장기 사용 검증으로 표현하지 않는다.
