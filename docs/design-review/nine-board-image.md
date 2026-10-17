# 9칸 구성의 영역 PNG

확인일: 2026-10-18. 기존 9칸 저장 형식·계정 소유권·원문·공개 범위를 바꾸지 않는다.

## 사용

기록 → 내 페이지 → 9칸 구성 → 파일 보관·가져오기 → 이미지로 받을 영역 선택 → 선택 영역 PNG 받기.

- 고른 한 영역을 3×3, **1800×2100 PNG**로 받는다. 빈 칸도 유지한다.
- 구성 제목·영역 제목·항목 제목·만든 사람·종류·출처 주소만 그린다. 사진, 소개, 영역 메모, 선택 이유, 인용 근거는 자동 포함하지 않는다.
- 긴 한글은 글자 단위로 줄을 나누고, 공간을 넘으면 `…`로 표시한다. 원본은 자르지 않는다. URL도 그림 속 글자이며 클릭 링크가 아니다.
- PNG는 보기용이다. 전체 내용과 선택 이유·인용·정확 버전의 편집 가능한 사본은 기존 JSON에 보관한다. HTML은 전체 내용의 독립 보기 파일이다. **사본 복원은 JSON**으로 한다.
- 글 작성기에 PNG를 직접 첨부하고 설명과 출처를 편집할 수 있다. 자동 첨부·자동 게시·공개 범위 변경은 하지 않는다. 게시 시 이미지 설명을 직접 확인한다. 기존 HTML/JSON을 텍스트 대안으로 함께 보관할 수 있다.
- 이미지 생성 실패는 원래 저장 상태를 바꾸지 않는다. 다시 받거나 JSON/HTML을 이용할 수 있다.

## 구현 선택

기존 NineBoard의 검증·출처 스냅샷·다운로드·파일 복원 계약을 재사용했다. 새 SQL, 라이브러리, 외부 이미지 요청, 공개 전송은 없다.

비교한 [html2canvas 공식 저장소](https://github.com/niklasvh/html2canvas)는 MIT, 최신 공식 릴리스 v1.4.1(2022-01-22), 마지막 저장소 갱신 2024-07-18이며 2026-10-18 조회 시 보관 상태가 아니었다. DOM 화면 전체 캡처 대신 제한된 제목·출처만 선택해 그리므로 브라우저 Canvas를 사용했다. 설치 의존성과 외부 이미지/CORS 처리를 늘리지 않고 출력 범위를 코드로 고정할 수 있다. 라이브러리 보안 감사를 수행했다는 뜻은 아니다.

공식 API 근거: [Canvas toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob), [measureText](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/measureText). PNG Blob 생성 실패를 처리하고 실제 글꼴 폭으로 한글 줄바꿈을 계산한다.

## 검증

- `node --test tests/nine-board.test.cjs tests/nine-board-image.test.cjs`: 8개 통과.
- `tests/nine-board-image-browser.cjs`: 실제 Mac Chrome 155.0.8059.80, 익명 Auth 모사·실제 IndexedDB·Canvas. 두 번째 영역 선택 후 실제 다운로드 파일의 PNG 서명과 1800×2100 크기 확인. 원본·다른 저장소 무변경, JSON/HTML의 전체 내용 보존, JSON 새 사본 복원, 생성 실패 후 재시도 확인.
- 1440·820·390px 화면 모사에서 가로 넘침 없음, PNG 컨트롤 44px 이상. 페이지 오류·console error·외부 요청 0.
- 기존 `tests/nine-board-browser.cjs`: Mac Chrome 경로·reduced motion 실행 어댑터에서 전체 8개 기능 흐름 통과. 원래 저장/복원, 원문 정확 버전, IME 중 입력 보존, 실패 재시도, 실제 두 탭 충돌과 사본 복구, 지연 저장 응답의 회귀를 포함한다. 페이지 오류·console error·외부 요청 0.
- `.local/nine-board-image/selected-area.png`를 직접 열어 한글, 긴 제목, 띄어쓰기 없는 제목, 줄바꿈, 출처 없는 항목, 빈 칸, 범위 안내가 겹치지 않는지 확인했다. 같은 폴더의 `controls-*.png`에 화면 증거를 둔다. 모두 익명 합성 자료다.
- 실기 iPhone/iPad의 Files·터치·소프트 키보드·한글 IME, 실제 계정·운영 게시 검증은 포함하지 않는다.

초기 브라우저 fixture는 자료 종류를 `movie`로 잘못 지정해 앱 검증에 거부됐다. 지원 종류 `film`으로 바로잡은 뒤 같은 경로가 통과했다. Canvas·한글·다운로드 결함은 아니었다. 저장 검증이나 종류 허용 범위를 완화하지 않았다. 오래된 fablize 2.0.0 문서 경로는 존재하지 않아 설치된 2.1.1 조사 절차를 읽었다.

기존 `nine-board-browser.cjs`는 Linux `/usr/bin/chromium`을 고정하므로 별도 임시 실행 어댑터에서 Mac Chrome 경로를 지정했다. 기본 motion 실행은 미완료 입력을 차단한 후 버튼의 click 안정성 대기에서 시간초과했다. 오류 화면에 기대한 입력 차단 메시지가 나타났으며 저장 변경·JS 오류는 없었다. 앱 코드나 기존 검사 조건을 바꾸지 않고 `reducedMotion: 'reduce'` 컨텍스트로 동일한 기능 검사를 실행했다. 기본 motion의 전체 기존 회귀 통과로 해석하지 않는다. PNG 전용 검사는 기본 motion에서 통과했다.
