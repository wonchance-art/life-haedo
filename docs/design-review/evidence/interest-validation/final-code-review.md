# MODEL-02 최종 독립 코드 검토

검토 대상: `/workspace/haedo-discovery/assets/life/interest-ui.js`, `ui.js`의 관심 화면 연결, `storage.js`의 계정·작업공간별 metadata CAS, `platform-auth.js` 변경. 읽기 전용 검토이며 제품 코드·MODEL-01·held-out 자료를 수정하지 않았다. 기존 검사를 반복하지 않았으며 아래는 직접 실행했다고 주장하지 않는 코드 경로 검토 결과다.

## 확인한 수정 필요 사항

### P2 · 최신 관심 읽기에서 수정하지 않은 옛 수동 관심이 새 revision의 초안으로 남음

위치: `assets/life/interest-ui.js:178`–`181` (`interestReload` 동작).

재현 경로: 두 탭이 같은 수동 관심 `책`을 읽음 → B가 `영화`로 변경해 저장 → A는 아무 입력도 하지 않은 채 변경 알림을 받고 `최신 관심 확인`을 누름. 이 핸들러는 `current.saved`와 `baseManualText`만 새 값으로 바꾸고 `manualText`는 무조건 이전 값 `책`으로 유지한다. 따라서 최신 정보를 읽었는데도 입력에는 옛 값이 표시되고, 바로 `관심 보관`을 누르면 최신 revision을 기준으로 B의 `영화`를 `책`으로 덮어쓴다. CAS는 오래된 내용이 의도된 새 초안으로 바뀐 이후라 이를 막지 못한다.

수정 방향: 최신 읽기 **전** `manualText === baseManualText`를 캡처하고, 실제 미저장 입력이 없던 경우 새 `baseManualText`로 `manualText`도 갱신한다. 실제 입력이 있었던 경우에만 보존한다. `render()`의 196행에는 이미 같은 untouched 분기가 있다.

### P2 · 후보 선택 초안의 수정 여부가 종료 보호와 최신 읽기에 반영되지 않음

위치: `assets/life/interest-ui.js:38`, `66`–`69`, `156`–`160`, `173`–`175`, `190`–`197`.

`confirmedDraft`는 화면을 그릴 때 저장된 확인 목록에서 만들어진 Set이고 체크박스 변경은 이 Set에만 반영된다. 그러나 `dirty()`는 수동 입력과 pendingResult만 검사한다. 후보 체크를 바꾼 뒤 저장하지 않고 로그아웃·다른 작업공간·외부 페이지로 이동하면 `flush()`가 통과하며, 최종 dispose에서 sessions가 지워져 선택이 소실된다. beforeUnload도 같은 dirty() 결과를 사용하므로 페이지 종료 경고가 없다.

또한 `render()`는 재진입 시 최신 saved를 읽어도 기존 `confirmedDraft`를 유지한다. A에서 후보 체크를 전혀 수정하지 않고 나간 뒤 B가 confirmedIds를 변경하면, A 재진입 화면은 예전 체크를 보여 주면서 저장 revision은 B의 최신 값을 사용한다. 이 상태에서 `선택한 후보 확인`을 누르면 B의 확인 목록을 예전 Set으로 덮어쓸 수 있다. `analysisEnabled:false`는 분석 버튼만 막으며 이미 보관된 분석 후보·확인 UI는 계속 렌더되므로 이 경계와 별개다.

수정 방향: saved.confirmedIds와 draft의 Set 차이를 추적한다. 실제 변경은 dirty/flush/beforeUnload에 포함하고, 수정하지 않은 draft는 최신 saved를 읽을 때 새 확인 목록으로 갱신한다. 새 분석 결과와 기존 확인 목록이 바뀔 때 유효하지 않은 후보 ID를 보존하지 않는다.

## 추가 차단 문제를 찾지 않은 경계

- Storage는 계정 고정 scope + workspace 소유 검사 + metadata 독립 revision CAS를 사용한다. 비동기 SHA 검증 전후 raw 자료 snapshot을 비교하고 write transaction에서 selected source/version을 재대조한다.
- Clear는 revision을 남기는 tombstone이며 늦은 저장이 이전 revision으로 부활시키지 못한다.
- 분석 취소는 소유한 analyzer/owner를 캡처해 새 실행의 리소스를 정리하지 않도록 수정되어 있다.
- 원문 열기는 정확 source/version/hash/quote 및 실제 WebCrypto SHA를 확인하고, 비동기 응답 이후 navigation/disposed 경계를 다시 검사한다.
- 수동 입력은 화면 내 일반 탐색에서 메모리로 보존되며 실제 미저장 수동 입력의 logout/공간 이동은 flush에서 차단한다.

위 두 항목 외에 이 변경 집합에서 구체적인 계정 간 자료 노출·원문 덮어쓰기·저장소 CAS 우회 경로는 찾지 못했다. 실제 Apple 기기·브라우저 실행의 보증으로 해석하지 않는다.
