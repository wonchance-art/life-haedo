# 연재 계정 전환 검사의 준비 완료 경계

2026-10-19 KST. 출시 main `14a9cb1`의 [push39260729215](https://github.com/wonchance-art/life-haedo/actions/runs/39260729215)에서 기존 연재 검사만 실패했다. 필수6개 성공·해당 그룹과 종합2개 실패·build/deploy 생략으로 운영본은 바뀌지 않았다. 앞선 서버 연결 대기열 문제와 별도로 [원본 실패](evidence/discovery-release/series-ci-failure.json)를 보존한다.

`blog-series-browser.cjs`는 다른 계정의 인증과 `Shell.storage.account.userId`가 맞으면 즉시 전체 로컬 상태를 읽었다. 하지만 Shell은 새 계정의 storage를 먼저 노출하고 `await UI.mount` 안에서 최초 작업공간 생성·활성화를 수행한다. 이 사이 `getActive()`는 정상적으로 null일 수 있다. 첫 네 흐름은 통과했고 다섯 번째 계정 전환 검사에서 새 계정의 workspace ID를 얻기 전에 `listPhotoPosts(null)`을 호출해 실패했다. 이전 계정 읽기의 해제·노출 방지 assertion에는 아직 도달하지 않았다.

수정은 B 계정 전환과 A 계정 복귀 때 기존 소유자 확인 뒤 공통 `ready(page)`를 기다리는 두 줄이다. 이 helper는 `#lifeApp.hidden=false`를 기다린다. Shell은 실제 UI.mount 완료 후 현재 계정·generation을 다시 확인하고 화면을 reveal하므로, 단순 인증 성공보다 뒤의 정확한 준비 경계다. `Shell.ready` 자체는 최초 start promise여서 계정 전환 완료의 근거로 삼지 않는다.

기존 실제로 완료된 A 읽기의 보류/해제, B 전체 snapshot 불변, 비공개 문구 미노출, A 복귀 후 원문·사진·연재 전체 불변, 원격 쓰기0 assertion과 시간 제한은 유지한다. 제품·인증·저장소 코드와 공개 배포 파일은 수정하지 않는다.

수정한 기존 전체 연재 브라우저 검사6개가 실제 SDK/IndexedDB·원본 사진/다운로드 ZIP·두 탭 충돌·계정 전환·가져오기 보존을 통과했다. 콘솔/페이지 오류·외부 요청·원격 쓰기는0이다. 독립 담당의 소스 검토도 storage 노출과 reveal 사이의 같은 경계를 확인했다. 새 HEAD의 전체 CI 및 최종 main 수집·배포 결과는 [운영 검증 로드맵](../life-tools-design/roadmap.md)에 별도로 연결한다. 이 로컬 검사를 실제 OAuth/운영 DB·Apple 기기·독서 유용성 검증으로 표시하지 않는다.
