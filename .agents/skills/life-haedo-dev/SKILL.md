---
name: life-haedo-dev
description: life-haedo 정적 웹 앱의 기능 수정, 로컬 실행, SVG·저장·PWA 브라우저 검증에 사용한다. 문서만 수정하거나 다른 프로젝트를 작업할 때는 적용하지 않는다.
---

# life-haedo 개발

저장소 루트의 `AGENTS.md`를 따른다. 세부 설계는 `docs/architecture.md`에서 변경한 기능의 절만 읽는다.
이 스킬의 상대 프로젝트 경로와 명령은 저장소 루트 기준이다.

## 필요한 코드 찾기

`assets/app.js`를 통째로 반복해서 읽지 말고 `rg -n`으로 다음 이름을 찾는다.

| 작업 | 진입점 / 함께 확인할 부분 |
| --- | --- |
| 행복도 곡선·예정 | `prepare`, `maSeries`, `curveYAt`, `fut`, `exportSvgText` |
| 사건·기간·생각 편집 | `openPop`, `addAt`, `addThoughtAt`, `persist`, undo/redo |
| 표시·분야·레이블 | `SHOW`, `focusLayer`, `renderLayerBar`, `placeText`, `polishLabels` |
| 날짜·나이·격자 | `parseDateSmart`, `ageAt`, `gDay`, `gCellRange`; 한국 시간대의 날짜 경계 |
| 목록·백업·모달 | `assets/workspace.js`, `assets/data.js`; 가져오기는 새 문서 ID |
| 저장·다중 문서 | `REG_KEY`, `DOC_PREFIX`, `persist`, `histPush`; 기존 데이터 호환성 |
| DB 동기화 | `CLOUD_KEY`, `queueCloudPush`, `cloudPullAll`, `assets/sync.js`; 관련 Supabase 스킬이 있으면 적용 |
| 지도 | `whenMapSized`, `rebuildMapVector`, `MSHOW`, `MAP_FILTER` |
| 색·레이아웃 | `assets/app.css`, `html[data-theme=spring]`, `CHART_ROLE`, `resolvePal`, 모바일 720px 경계 |
| 오프라인·배포 | `sw.js`의 `CACHE`·`SHELL`, `manifest.webmanifest` |

## 실행과 검증

짧은 요청도 AGENTS.md에 따라 목표·범위·보존 조건·완료 기준으로 정리해 실행한다. 핵심 흐름은 실제 UI 진입부터 결과 재열기까지 검증한다. `node tests/core-experience-browser.cjs`는 가져오기 → 읽기 → 관련 기록 → 묶음/내 페이지 → 저장·복귀를 확인하며 CI 배포 조건에도 포함된다. 브라우저 검사 통과와 시각·추천 내용의 유용성, 실제 Apple 기기 체험을 서로 대신하지 않는다.

`npm run check`로 구문과 로컬 리소스를, `npm test`로 데이터·동기화·서비스워커 회귀 사례를 확인하고 `npm run dev`로 127.0.0.1:4173에서 실행한다. `scripts/dev-server.py`는 OAuth 코드·문서 URL을 요청 로그에 남기지 않는다.
앱 실행용 패키지 설치는 없다. 브라우저 CLI가 설치돼 있지 않으면 현재 사용 가능한 Codex 브라우저 도구를 써도 된다.
이 기기에서 검증한 CLI는 `npx --yes agent-browser@0.37.1`이다. 앱 의존성으로 추가하지 않는다.

별도 브라우저 세션을 사용한다. 예: `--session life-haedo-check`. 개인 Chrome 프로필이나 운영 DB 설정을 가져오지 않는다.
처음에는 `index.html` 공개 홈이 보인다. 개인 화면은 Google 공용 인증 뒤 계정별 자료를 연다.
자동 검증은 합성 계정의 모의 Auth HTTP와 실제 동봉 SDK를 사용하고 운영 세션을 복사하지 않는다.
모의 OAuth·계정 전환 검증을 실제 Google 제공자 로그인으로 보고하지 않는다. 과거 게이트 우회값을 현재 보호 페이지의 인증 대신 쓰지 않는다.

초기 구동 확인은 공개 홈 → 서버 계정 검증 → 기록 피드 진입으로 한다. 기록·도구·관리 이동과 로그인 복귀는 `node tests/unified-home-browser.cjs`, 3폭 시각 검토는 `node scripts/check-unified-home-design.cjs`로 확인한다. `life.html`의 기존 주소와 `workspace.html?section=manage`의 플랫폼 백업 진입도 보존한다. 연표 변경은 새 익명 연표 → 사건 편집·저장 → 새로고침 후 유지, 자료 변경은 텍스트 가져오기 → 발췌·출처 → 재열기 → JSON 사본 복원을 확인한다.
수정 작업에서는 영향받은 흐름만 추가한다. 실제 `console`과 `errors`를 읽고 스크린샷을 눈으로 확인한다.
설치되지 않은 `window.__consoleErrors` 배열의 빈 결과를 “콘솔 0”의 근거로 쓰지 않는다.

- UI: 데스크톱과 390px 모바일에서 도구 접근·겹침·가로 넘침을 확인한다.
- 저장: 임시 사건의 추가·수정·재로드, 필요하면 undo/redo를 확인한다. 데이터 출력은 개수·검증 결과로 제한한다.
- PWA: 변경했다면 재로드 후 캐시 버전과 오프라인 앱 셸을 확인한다. 기존 서비스워커를 지워서 업데이트 경로 검증을 대신하지 않는다.
- 지도: 지도나 CDN 연결을 바꿨을 때만 타일·확대·시간창 동기화를 확인한다.
- 색: 팔레트를 바꿨을 때 실제 표면색과 색각·대비를 측정한다. 이전 `dataviz` 검사기는 현재 없으므로 통과를 추정하지 않는다.

증거는 `.local/` 또는 임시 폴더에 보관한다. 확인용 브라우저는 종료하고,
사용자에게 보여줄 개발 서버는 주소와 종료 방법을 알려 준다.
완료 보고에는 로컬 검증 결과와 아직 확인하지 않은 외부 의존성을 짧게 구분한다.

## 배포가 요청됐을 때

로컬에서 먼저 점검한다. 허용된 브랜치·푸시 범위에서 배포하고, 공개 URL에서 새 변경과 콘솔을 확인한다.
첫 로드가 이전 서비스워커 문서면 한 번 더 새로고침한다. 변경을 확인하기 전까지 배포 완료로 보고하지 않는다.

직접 글쓰기는 `assets/life/writing.js`·`writing-ui.js`와 `ui.js`의 `write` 화면이다. 저장한 글은 기존 원천/불변 버전을 재사용하고 `kind=writing` 초안은 브라우저 전용이다. `node tests/life-writing-browser.cjs`로 입력·충돌·발췌·백업·계정/공간 경계와 세 폭을 확인한다. 원문 제목은 현재 값이며 버전별 제목 이력을 약속하지 않는다. 새 라이브러리·SQL 없이 기존 원자 저장·동기화 계약을 유지한다.
