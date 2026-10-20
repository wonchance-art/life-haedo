# 뉴스 왕복 검사의 화면 전환 완료 경계

2026-10-20 KST. 제품 PR112의 head22b24ad는 필수8개를 통과했다. 같은 tree인 main900c7bd의 [push39361306314](https://github.com/wonchance-art/life-haedo/actions/runs/39361306314)는 새 뉴스 검사의 네 번째 history 왕복에서 약20초 뒤 실패해 build/deploy를 생략했다. 나머지 기본6개 job은 성공했고 browser 집계도 실패했다. 운영은 SW138을 유지하며 이 실패를 배포 성공으로 바꾸지 않는다.

## 원본 증거와 한계

[검수 증거](evidence/news-navigation/history-readiness.json)에 실제 job·artifact SHA와 비교 결과를 기록했다. 원본 job 로그와10.9MB archive는 ignored 로컬에 보관했다. 총괄이 새 검사를 CI에 넣을 때 `.local/news-navigation/`을 artifact path에 추가하지 않아 원본 뉴스 report/HTML/PNG가 archive204개에 없다. 로그에도 catch가 stack을 출력하지 않아 세부 wait 위치는 알 수 없다. 이번 수정은 보고서 경로와 stack·실패 당시 path/section/mode/두 busy 상태/활성 메뉴 출력을 함께 추가한다. 사후 로컬 화면을 원본 CI 실패 화면으로 표시하지 않는다.

## 경계 비교와 최소 수정

검사의 `assertNews`는 내부 목록의 aria-busy만 확인했다. 캐시된 목록은 새 프로필 읽기가 끝나기 전에 그려질 수 있으며 이때 바깥 Shell은 아직 guarded navigation 처리 중이다. 그 경계에서 다음 forward를 보내면 기존 busy guard가 popstate를 건너뛰어 URL은 홈인데 뉴스 DOM이 남을 수 있다.

동일 코드/원래 조건의 계측 반복12회는 모두6개 성공해 자연 재현되지 않았다. 별도 비교에서 back의 readInterestProfile만400ms 지연했다. 원형은 inner=false/outer=true 상태에서 forward popstate를 보내 네 번째의 review 제거 wait가 기존20초 상한으로 실패했다. `assertNews`에 기존 `settle(page)` 한 번을 추가한 후보는 read 완료와 바깥 guard 해제 후 forward를 보내6개 모두 통과했다. 양쪽 제품 해시는 전후 같고 기존 URL·메뉴·자료/반응/언어·history assertion과 시간 상한은 유지했다. 실제 수정 runner도6개를 통과했다.

이 비교는 검사의 준비 경계를 증명한다. 원본 CI의 세부 report가 없어 정확히 같은 substage였다고 확정하지 않는다. 앱의 busy 중 연속 native history 처리 정책을 고친 것으로 주장하지 않으며, 완료된 화면 사이의 왕복을 검사한다. 제품·SQL·SW·저장 형식은 변경하지 않았다. 실패 실행을 blind rerun하지 않고 구체적인 검사 수정의 새 HEAD를 검증한다.
