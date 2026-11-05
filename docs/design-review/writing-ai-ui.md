# AI 제안 화면 연결 — A 작업자 검수 (2026-11-05 KST)

기준 main `2eebd27`. [총괄 지시](https://github.com/wonchance-art/life-haedo/pull/212#issuecomment-6650230384)와 [접점·범위 확정](https://github.com/wonchance-art/life-haedo/pull/212#issuecomment-6650355874)에 따라 기존 [서버·기기 모듈 계약](writing-ai-suggestions.md)을 화면에 연결했다. 운영 SQL·Edge·비밀값·실제 계정 쓰기·병합·배포는 하지 않았다.

## 사용 흐름

- 글쓰기 본문 선택 → 도구 막대 `AI 제안` → 다듬기·줄이기·이어 쓰기·직접 요청 → `보낼 내용 확인` → `보내기` → 구간별 수락 → `선택한 제안 적용` → 기존 저장·재열기.
- 자료로 글쓰기 → 자료에서 구절을 골라 개요에 담기 → `AI 제안` → 보낼 발췌를 명시 선택 → 자료에 묻기·개요 제안 → 전송 검토 → 결과와 정확 인용 대조. 선택하지 않은 자료·질문·메모는 보내지 않는다.
- 처음 전송할 때를 포함해 검토 화면에 공급자·전송 내용·보존 조건·이번 달 잔액을 표시한다. 요청마다 지침은 기본 꺼짐이며 직접 입력해 켠 경우만 보낸다. 지침은 계정 설정에 저장하지 않는다.
- 자료 결과는 읽기 전용이다. 준비 블록에 AI 작성 속성이 없어 결과를 바로 넣으면 작성 주체를 잃기 때문이다. 편집기에서 수락한 새 글자에만 기존 `author:"ai"`를 붙인다.
- `ai_not_configured`는 안내만 표시한다. 글쓰기·임시저장·명시 저장은 계속 쓸 수 있다. 전송 중 닫기는 결과 사용을 중지하며 이미 전송한 요청의 비용 취소를 보장하지 않는다.

## 연결·보존 계약

새 `writing-ai-ui.js`는 기존 `WritingAI.prepare/send/apply/verifyCitations`를 사용한다. 새 공급자·SDK·저장 형식은 추가하지 않는다. 기존 [오픈소스·공급자 검토](../life-tools-design/writing-ai-review.md)를 재사용한다. 2026-11-05 Supabase [changelog](https://supabase.com/changelog.md)와 [함수 인증 문서](https://supabase.com/docs/guides/functions/auth)를 대조했다. 기존 `HaedoAuth.verify`와 SDK 세션 조회, 사용자 JWT·공개 키 전송 계약을 유지한다.

`WritingAIUI.open({selectionText, sources:[{text,label}], tasks, isCurrent, onApply, onClose})`는 `{dispose()}`를 반환한다. 내부 AI 토큰은 계정·프로젝트·Auth 세대와 화면 현재성을 검사한다. 인증·세션 조회의 각 비동기 단계 뒤에도 대조한다. 제목·문서 ID·사진·계정 ID를 요청 본문에 넣지 않는다. 결과·오류·인용은 HTML로 해석하지 않고 글자로 표시한다.

### B 편집기 교체 시 유지할 접점

- `photo-post-ui.js`의 도구 등록 목록에 `['ai', suggest]` 한 항목을 둔다. adapter는 선택 문자열·범위·글 객체·편집기 객체·세대·편집 횟수를 캡처한다. `cleanup()`의 패널 `dispose()` 한 줄을 유지한다.
- 적용 직전 조합·선택 범위·편집 횟수·대상을 다시 검사한다. 선택 앞쪽의 편집으로 위치가 밀린 경우도 오래된 제안을 적용하지 않는다. 사진과 마지막 문서 줄바꿈을 포함한 선택은 전송 전에 거부한다.
- `onApply(result, accepted, {apply})`의 `apply(ops, options)`는 현재 토큰에 묶인 기존 검증기다. 결과 문서 검증 뒤 `aiInserting` guard 안에서 Delta 차이를 `updateContents(..., 'user')`로 적용한다. 앞뒤 `history.cutoff()`로 한 번의 실행 취소를 보존한다. 저장은 기존 자동 임시저장·명시 저장 경로다.
- 기존 링크 버튼은 추가 서식 메뉴로 옮겨 모바일 도구 막대의 44px 조작 영역을 유지했다. 다른 편집기 본체는 재구성하지 않았다.
- `material-writing-ui.js`는 채택 인용의 원문 해시·정확 위치를 먼저 대조한다. 준비·자료 변경과 detach에서 패널을 폐기한다. E 담당의 `renderOutput` 구간은 변경하지 않았다.
- 두 HTML, SW 셸 목록, `prepare-site.mjs`에 모듈 두 개와 CSS를 등록했다. CACHE 이름은 변경하지 않았다. 총괄이 병합 순서에 맞춰 판올림하고 새 브라우저 검사를 CI에 등록한다.

## 실제 검증

Linux Chromium에서 익명 Auth·AI·사용량 HTTP만 사용하는 검증이다. 실제 공급자 호출이나 Apple 기기 검증이 아니다.

| 검사 | 결과 |
| --- | --- |
| `node --test tests/writing-ai.test.cjs` | 19/19 |
| `npm test` | 1,932개 통과, 두 파일은 fixture 의존성 `cheerio/slim` 누락으로 시작 실패. 잠금파일대로 의존성 설치 뒤 해당 두 파일 42/42 통과 |
| `npm run check` | HTML 22, JS 192, 로컬 참조 779, 오프라인·배포 모듈 534 통과 |
| `node tests/writing-ai-browser.cjs` | 편집기 전송·부분 수락·AI 표시·저장 재열기, undo/redo·조합·원문 변경·취소·계정 전환, 지침 켬/끔, 유료 오류 뒤 잔액, 사진 선택 거부 검사 통과 |
| `node tests/material-writing-ai-browser.cjs` | 8/8: 질문·개요·인용 확인/미확인·읽기 전용·조합·준비/원문/계정 변경·1440/390 결과 가시성과 배경 스크롤 보존 |
| `BASE_URL=http://127.0.0.1:4173 node tests/ai-authorship-browser.cjs` | 기존 AI 표시·지우기·IME·실행 취소·저장/공개 제외 회귀 통과 |

브라우저에서 예상 밖 콘솔 오류·페이지 오류·외부 요청은 0이다. 503·422·429 실패 주입은 따로 기록했다. 데스크톱/390px 미리보기·비교·자료 결과 이미지를 직접 검토했다. 초기 검사 helper의 timeout 인자 및 자료 fixture 형식 오류는 고친 뒤 재검사했고 최초 로그도 `.local/writing-ai/`, `.local/material-writing-ai/`에 보존했다. 기존 `material-writing-browser.cjs`는 격리 PostgreSQL fixture가 없어 시작하지 못했으며 새 자료 AI 브라우저 결과로 이를 통과했다고 표시하지 않는다.

독립 코드 검수에서 실패 후 남은 금액이 이전 값으로 남는 P2를 찾았다. 요청 시작 때 이전 잔액·진행 조회를 무효화하고 모든 오류에서 새 사용량을 조회하도록 고친 뒤 재검수했다. 추가 블로커·메이저는 발견되지 않았다. 결과·오류는 패널 내부만 스크롤해 배경 글 위치를 보존한다.

## 남은 조건과 후속

1. **총괄 출시·첫 사용:** CI 등록·캐시 판올림·최종 검수와 비밀값 준비가 선행이다. 운영에서 소유자 요청·다른 계정 거부·실제 비용·한국어 제안 품질을 확인해야 첫 사용 완료다. 비밀값 상태는 이 작업자가 새로 조회하지 않았다.
2. **B 편집기 이행:** 새 편집기에서도 위 adapter/dispose·작성 주체·한 단계 실행 취소·사진 보존을 유지해야 한다. B3 운영 선행 및 B2 병합 조건은 총괄 결정을 따른다.
3. **지침·자료 결과 채택:** 계정 지침 자동 동기화와 준비 블록 AI 작성 속성은 후속이다. 저장·기기 동기화·백업에서도 작성 주체를 보존하는 계약을 먼저 정한 뒤 구현한다. 실제 iPhone/iPad의 한글 입력·키보드·선택 동작은 별도로 확인한다.
