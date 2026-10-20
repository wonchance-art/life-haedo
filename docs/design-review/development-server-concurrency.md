# 로컬 검사 서버의 동시 연결 보완

2026-10-19 KST. 발견·반응·언어 기능 출시 중 main push [39256747829](https://github.com/wonchance-art/life-haedo/actions/runs/39256747829)의 첫 실행에서 기존 글쓰기 통합 검사만 실패했다. 나머지 필수7개는 성공했고 build/deploy는 생략되어 운영본은 바뀌지 않았다. [최초 실패](evidence/discovery-release/initial-ci-failure.json)를 유지한다.

`integrated-release-browser.cjs`의 9칸 진입 전 `page.goto`가 기본 load 조건의 25초 제한에 도달했다. 앞선 두 연결 흐름은 성공했으나 마지막 탐색의 JavaScript100개 중10개 응답이 오지 않아 HTML 파서와 앱 시작이 멈췄다. route/console/page 오류는0이었고 종료 때에만 대기 요청10개가 취소됐다. 앱이 준비된 채 load만 늦었다고 판단하거나 검사 조건·제한 시간을 완화하지 않았다.

## 재현·원인·변경

Python3.12의 `ThreadingHTTPServer` 기본 연결 대기열은5다. 실제 source-hash interceptor는 약100개의 로컬 스크립트를 동시에 요청한다. 로컬 기본 서버에서도 같은 goto/ready/화면 표시 검사를6회 통과한 뒤7회째 응답 대기로 실패했다.

독립 담당이 같은 앱·Chromium153·FakeCloud·실제 sourceRouting·25초 제한과12회 상한으로 서버 대기열만 바꿨다. [비교 결과](evidence/discovery-release/transport-comparison.json):

| 서버 대기열 | 같은 탐색 검사 | 해당 포트 최대 accept 대기열 / SYN_SENT | 호스트 ListenOverflows / ListenDrops 증가 |
| --- | --- | --- | --- |
| 5 | 5회 성공 뒤6회째25초 실패, 종료 대기3개 | 6 / 73 | 672 / 672 |
| 128 | 12/12 성공, 348–544ms, 종료 대기0개 | 79 / 1 | 0 / 0 |

호스트 전체 TCP 카운터만으로 원인을 단정하지 않고 해당 포트의 큐·소켓 상태와 요청 단계 시각을 함께 대조했다. 작은 대기열의 연결 손실과 재전송 대기가 검사 정지를 재현하며,128개 대기열에서는 동일 부하를 수용했다. 비교 중 보호한8개 파일의 해시는 전후 같았다.

변경은 `scripts/dev-server.py`의 `ThreadingHTTPServer` 하위 클래스에 `request_queue_size=128`을 지정하고 기존 생성자에 적용하는 것이다. loopback 바인딩·포트·요청 로그 비공개·HTTP handler는 유지한다. 대기열은 동시 실행 스레드의 상한이 아니며, 서버를 외부 서비스로 전환하지 않는다. 실제 수정한 서버로 총괄이 별도12회 검사도 수행해 모두321–532ms에 성공했고 route/console/page 오류와 종료 대기는0이었다.

앱 HTML/JS/CSS/vendor·서비스 워커·SQL·개인 자료 형식과 제품 검사 assertion은 바꾸지 않는다. 제품 및 준비 사이트 입력 파일의 바이트는 기존 검증 후보와 같다. 수집기·외부 제공처·실제 OAuth·운영 DB·Google 번역을 이 진단에 사용하지 않았다.

## 출시 확인 조건

최초 main 실패는 성공으로 덮거나 숨기지 않는다. 새 수정 HEAD의 필수 CI를 통과한 뒤 병합하고 새 main 실행의 검사→수집→install→배포 결과와 공개 파일 해시를 별도로 확인한다. 부분 수집 실패·정기 schedule event·실제 기기·사용자 독서 효용은 이 로컬 전송 진단의 성공으로 대신하지 않는다. 미확인 전송 문제에 대한 단순 반복 재실행은 하지 않았다.
