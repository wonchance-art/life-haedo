# 검사 경합: purpose-workflow-browser의 `/icon.svg` 응답 본문 (2026-11-11)

- 실행: 로컬(브라우저 검사 묶음 3개 동시 실행 중) 1회. `staticErrors`에 `/icon.svg`의 `Response body is not available for a response that was navigated away from`이 남아 종료 코드 1. 단독 재실행은 0.
- 판정: **원인 기전은 재현했고, 검사 자체의 실패는 재현하지 못했다**(독립 검수 19회, 이후 실행에서도 재현 안 됨).
- 원인 기전:
  - Chromium은 `<link rel="icon">`을 load 이벤트 4~48ms 뒤에 스스로 한 번 더 받는다(리소스 종류 `other`).
  - `drainStatic()`의 조건(load 완료, 진행 중인 정적 요청 0, 본문 검증 0)은 그 요청이 시작되기 전에 이미 참이다.
  - 조건이 참이 된 직후 화면을 이동하면 그 응답의 본문을 읽을 수 없다.
  - 같은 조건을 흉내 낸 탐침에서 이전 규칙은 40회 중 6회·7회 실패했고, 300ms 뒤 이동은 0회였다.
- 고친 것(검사만): 브라우저가 스스로 받는 아이콘 응답은 화면 응답의 본문 대신 `context.request.get`으로 받아 같은 해시 단언을 한다. 화면 이동이 끊을 수 없다. 그 요청이 이동으로 취소돼도 정적 오류로 세지 않는다(아이콘 바이트는 위 경로와 화면 안 `<img>` 응답으로 계속 검증한다).
- 확인: 같은 탐침에 새 규칙을 넣으면 40회씩 두 번 모두 0회다. 검사 자체는 고친 뒤 실행에서 종료 코드 0이다.
- `drainStatic` 형태를 쓰는 검사는 `tests/purpose-workflow-browser.cjs` 하나다(2026-11-11 `grep`).
