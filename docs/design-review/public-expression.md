# B안: 공개 전 검토와 공개 방문 화면

2026-10-08 KST. [비공개 페이지 적용](page-expression-integration.md) 다음 단위다. 실제 게시할 사본과 익명 방문 화면을 같은 `ShareView`로 표시한다. root가 디자인 통합을, 독립 에이전트가 공개 경계 검토·브라우저 검증·원천 비교를 맡았다.

## 변경과 보존

700px 읽기 열, 작은 출처·원문 작성일, 16px/1.8 본문, 얇은 구분선과 민트 코멘트를 사용한다. 타인 글·부분 본문·누락·본문 미공개는 접힌 상태에서도 드러낸다. 날짜는 원값을 표시하며 가져온 날짜로 대체하지 않는다. 기존 공식 참고와 선택 이유는 [표현 화면 참고](expression-references.md)를 재사용한다. 새 라이브러리 없이 네이티브 버튼·pre와 기존 토큰으로 충분하다.

긴 본문은 원문 앞부분과 ‘본문 펼치기’를 제공한다. 모든 폭에서 같은 150 UTF-16 단위 기준을 사용하고 단어·문단·surrogate·CRLF 경계를 보존한다. 폭 변경으로 문자열을 바꾸지 않아 선택 중인 구절이 유지된다. 짧은 글과 선택한 발췌는 자르지 않는다. 펼치면 본문에 초점을 옮기며 접으면 버튼으로 복귀한다.

화면 접힘은 공개 범위가 아니다. 소유자 검토에는 **‘접힌 본문도 전체가 공개됩니다.’**를 표시한다. 공개 payload·동의·SQL·저장·동기화·백업 형식은 바꾸지 않는다. 공개 사본에 들어 있는 문자열만 표시하며 비공개 원문 ID나 버전을 조회하지 않는다. 화면 식별자는 렌더/항목/출처 순번으로만 만든다. 외부 출처 링크의 noopener/noreferrer·referrer 차단은 유지한다.

같은 revision의 주기적 확인은 펼침·DOM·구절 선택을 유지한다. 다른 revision·철회·조회 실패·오프라인에는 기존 공개 내용이 닫힌다. 늦은 응답이 철회한 본문을 다시 표시하지 않는 기존 경계를 검증했다. 수동 재확인에서 읽기 상태가 유지된다고 주장하지 않는다.

회귀 중 키보드로 선택 도구를 연 직후 체크하면 비동기 `details.toggle`보다 재렌더가 먼저 발생해 도구가 닫히는 문제를 재현했다. 선택 변경 직전에 실제 열린 상태를 읽어 기존 상태에 반영한다. 공개 선택·동의 조건은 그대로 유지한다.

## 기능 검사와 시각 검토

실제 앱·SDK·IndexedDB와 **합성 HTTP**를 사용했다. 운영 계정·개인 기록·SQL은 사용하지 않았다.

- 정적 검사: HTML 18 / JS 54 / 참조 259 / PWA 통과.
- 단위 검사: 311/311 통과.
- 기존 게시 검사: 최초 16/17, 실패한 키보드 경로를 재현·수정한 뒤 해당 1/1 통과. 로컬에서 전체 17개를 재실행한 것으로 합산하지 않는다. [최초 보고](evidence/public-expression/publication-initial.json), [수정 후 집중 검사](evidence/public-expression/publication-keyboard-fixed.json). CI에는 전체 게시 검사를 추가했다.
- 새 공개 검사: [4/4 경로·11개 상태](evidence/public-expression/combined-report.json) 통과. owner 검토→게시→별도 익명 context, 본문/발췌/미공개, 원문 전체 payload와 동의 보존, 키보드·터치·폭 변경·철회·오류 복구를 확인했다. 초기 모의 서버가 익명 요청에 계정 Authorization을 요구한 오류는 테스트에서 수정하고 [초기 기록](evidence/public-expression/initial-harness-failure.json)을 보존했다.
- 1440·820·390px에서 가로 넘침·44px 조작·16px 입력·접근 이름·대비 위반 0, 최소 글자 대비 6.05:1. 실제 콘솔/페이지 오류·외부 요청 0. 익명 읽기의 Auth/Storage/IndexedDB/Cache 접근 0.
- root와 QA가 캡처를 별도로 검토했다. 한글 줄바꿈, 출처 간 구분, 코멘트 구분은 유지했다. 모바일은 출처·누락 정보를 숨겨 본문을 억지로 위로 올리지 않았다. 개인용 탐색은 공개 화면에 추가하지 않았다.
- 합성 설정으로 공개 산출물 생성 통과. 선행 결과와 각각 70개 파일, 추가/삭제 없음. 변경은 share-view JS/CSS·workbench-ui·서비스워커 및 합성 설정값 차이다. 실제 설정값을 조회하지 않았다.

새 집중 검사는 `BASE_URL=http://127.0.0.1:4173 node tests/public-expression-browser.cjs`, 기존 게시 검사는 `node tests/life-share-browser.cjs`다. `npm run dev`로 로컬 서버를 먼저 실행한다. CI 최종 결과는 PR의 정확한 HEAD/실행 링크로 기록한다.

## 화면

| 폭 | 공개 전 검토 | 공개 방문 |
| --- | --- | --- |
| 1440px | [검토](evidence/public-expression/review-1440.png) | [방문](evidence/public-expression/public-1440.png) |
| 820px | [검토](evidence/public-expression/review-820.png) | [방문](evidence/public-expression/public-820.png) |
| 390px | [검토](evidence/public-expression/review-390.png) | [방문](evidence/public-expression/public-390.png) |

[390px 첫 화면](evidence/public-expression/public-390-viewport.png), [로딩](evidence/public-expression/loading-390.png), [오류](evidence/public-expression/error-390.png), [오프라인](evidence/public-expression/offline-390.png), [철회](evidence/public-expression/revoked-390.png), [빈 내용](evidence/public-expression/empty-390.png).

직접 확인은 내 페이지→공개 사본 검토→명시적 본문 선택→펼침/접기→동의 후 게시→별도 익명 창에서 링크 열기→공개 갱신/철회 순서다. 개인 자료를 공개하지 않도록 체험 자료로 확인한다.

## 인계

PR #42 다음에 검토·병합할 후속 변경이다. SQL 설치 없음, 서비스워커 v76. Local이 선행 변경과 병합 순서를 확인해 배포하고 라이브 로그인·공개 갱신·철회를 확인한다. 실제 Apple 기기·IME·Files·VoiceOver 검증 및 공개 배포는 이번 Chromium 폭 검사와 별개이며 미완료다. 되돌릴 때는 구현 커밋을 역순으로 되돌리고 배포 캐시 번호를 새 번호로 올린다.

다음 수집 단위의 [공식 경로 비교](../life-tools-design/source-intake-next.md)는 별도 조사다. 이번 변경이 SNS 자동 연결·계정 수집을 구현한 것은 아니다.
