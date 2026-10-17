# Obsidian 선택 갱신 사본

확인일: 2026-10-18. 구현: `assets/life/obsidian-update.js`, `assets/life/obsidian-update-ui.js`.

## 체험과 범위

관리 → Obsidian 갱신 → 이전 변환 ZIP/자료 JSON/갱신 사본 JSON과 새 변환 ZIP 선택 → 파일 비교 → 원문 비교 펼치기 → 추가·수정 선택 → 새 사본 준비 → JSON 받기 또는 현재 계정에 새 사본 복원.

ZIP은 기존 `ObsidianPackage.read`를 재사용해 원문·SHA-256·감사 경로·커밋 출처·검토 목록을 검증한다. JSON은 `Core.restoreBackup`으로 모든 본문 해시와 정확 버전 참조를 검증한다. 동일 저장소의 경로 단위로만 대조한다. Core 자료 JSON 한 파일은 원문 작업공간 한 개로 취급하며, 관련 보조 파일 작업공간까지 함께 보존하려면 이전 ZIP 또는 두 작업공간이 든 갱신 사본 JSON을 사용한다.

변경 파일은 새 source + immutable sourceVersion으로 보관한다. source의 기존 URL이 불변이므로 새 커밋 본문을 옛 URL 아래에 추가하지 않는다. `obsidian_update` 연결은 같은 경로의 이전·새 정확 버전을 함께 가리킨다. 누락 파일은 보존한다. 동일 내용/이름의 경로 이동은 후보로만 표시하며 선택해도 이전 경로를 삭제하거나 바꾸지 않는다. 같은 경로에 명시 연결되지 않은 후보가 여러 개이거나 source에 버전이 여러 개인 입력은 안전하게 거절한다.

원래 발췌·주제·메모·구절 위치·연결·재개 정보·삭제 표시는 사본 전체 그래프와 함께 보존한다. 선택한 새 원문의 Obsidian 연결은 선택한 새 정확 버전 또는 내용·확보 범위·작성자 정보가 일치하는 기존 정확 버전에만 다시 연결한다. 변경했지만 선택하지 않은 대상의 새 본문을 옛 본문 위치로 바꾸지 않는다. 이런 새 연결은 제외 개수를 표시한다. 원래 연결은 유지한다. 이전 발췌를 새 버전에 자동 재정렬하지 않는다.

출력은 `life-obsidian-update-v1` JSON이며 내부에 기존 `life-tools-backup-v1` 작업공간 사본들을 넣는다. 원래 ZIP의 감사 자료/검토 파일/저장소 bundle을 다시 생성한 ZIP으로 오인시키지 않는다. 다시 이전 입력으로 읽을 수 있다. 책·구성·초안·사진·바이너리 첨부는 이번 원문 사본 밖이다. 기존 계정 작업공간을 병합·덮어쓰지 않으므로 이미 계정에만 있는 최신 편집은 그 작업공간에 유지되며, 새 사본에 담으려면 그 최신 자료 JSON을 이전 입력으로 선택해야 한다.

복원은 서버에서 확인된 계정으로 생성한 `storage.isAccountScoped` 저장소에서만 허용한다. `storage.account`와 `isCurrent()`를 비동기 검증 후 재확인하고 실제 소유자 지정·직렬화·중단은 기존 scoped `installWorkspaces`의 단일 IndexedDB 트랜잭션을 사용한다. 기존 자료를 수정하지 않아 오래된 revision 덮어쓰기/CAS 갱신을 발생시키지 않는다. 새로운 사본을 원격 저장했다고 표시하지 않는다. 저장 실패는 후보를 유지해 재시도하고, 복원 성공 후 화면 갱신 실패는 다시 설치하지 않는다.

## 연결 계약

`ObsidianPackage` 뒤에 `obsidian-update.js`, `obsidian-update-ui.js`를 로드한다. 별도 CSS 불필요.

```js
const pane = HaedoLife.ObsidianUpdateUI.create({ storage, isCurrent, onRestored });
pane.mount(host);
// 이동 전 await pane.flush(); 종료 시 pane.dispose();
```

`onRestored(copies)`는 새 작업공간 목록을 갱신할 수 있다. 파일 처리가 진행 중일 때만 `dirty()`가 참이며 `flush()`는 이동을 막는다. 계정 검증 자체는 기존 앱 인증 셸의 책임이다. 이 기능은 OAuth/서버 RLS를 재구현하거나 설정하지 않는다.

## 오픈소스 선택과 반대 검토

2026-10-18 공식 저장소 확인: [jsdiff v9.0.0 태그](https://github.com/kpdecker/jsdiff/releases/tag/v9.0.0), [BSD-3-Clause](https://github.com/kpdecker/jsdiff/blob/master/LICENSE), [패치 파서 DoS 권고](https://github.com/kpdecker/jsdiff/security/advisories/GHSA-73rr-hh4g-fpgx). GitHub latest-release API는 릴리스 객체가 없어 404였으며 tags API의 첫 태그 v9.0.0 / ed13aca를 확인했다. jsdiff는 유지 중인 텍스트 차이 도구지만 본문 자동 패치/줄 단위 병합이 이 기능의 정확 버전 보존 요구는 아니다. 권고의 취약 API를 도입할 이유도 없다. [google/diff-match-patch](https://github.com/google/diff-match-patch)는 Apache-2.0이며 2024-08-05 archived 상태다. 가장 작은 선택은 기존 앱의 ZIP 검증·불변 sourceVersion·SHA-256·사본 복원을 재사용하고, 경로/정확 본문 비교와 선택 UI만 추가하는 것이다. 새 의존성은 없다.

불확실성: 아주 큰 사본의 iPad 메모리·Files 공유 경험, 실제 Google 인증, 실제 계정의 현재 원문 선택, 서버 동기화, 원문 여러 버전/경로 충돌의 자동 해소는 미검증 또는 범위 밖이다. 담당은 다음 실사용 검증자이며 첫 최소 실험은 본인 원문의 소규모 사본 2개로 선택 갱신 후 다시 다운로드/재입력하는 것이다. 향후 줄별 차이 보기 요구가 생기면 패치 적용 없이 최신 jsdiff의 순수 diff만 별도 검토한다.

## 검증

- `node --test tests/obsidian-update.test.cjs`: 원문·누락 보존, 정확 UTF-16 앵커, 미선택 변경 대상 연결 제외, 반복 갱신 중복 없음, 발췌/주제/메모 보존, 위조 해시/다른 저장소/삭제 선택 거절, 계정 전환/취소/저장 재시도/동시 요청 차단.
- `BASE_URL=http://127.0.0.1:4200 PW_MODULE_PATH=... CHROMIUM_PATH=... node tests/obsidian-update-browser.cjs`: 익명 인증 시뮬레이터와 실제 Chrome·IndexedDB. 1440·820·390px 비교/선택/JSON 다운로드/실패 재시도/사본 복원/반복 비교/계정 전환 확인. 실제 Apple 기기 검증을 뜻하지 않는다.
- 개인 자료·운영 DB 행·키·실제 원격 쓰기는 사용하지 않는다. 익명 증거는 `.local/obsidian-update/`에만 보관한다.
