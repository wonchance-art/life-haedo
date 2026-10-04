# 자료 보관·복원·동기화의 다음 행동

2026-10-04 · [전체 사이트 디자인](life-design-site.md)에 이어 [기존 로드맵 B](../life-tools-design/roadmap.md)의 관리 하위 흐름을 개선했다. 비교 기준은 `5b2befe`다. 연표의 값·계산·집계·저장 코드, 자료 저장 스키마와 백업 형식, SQL은 변경하지 않았다.

## 사용 흐름

**복원:** 관리 → 자료 백업·복원 → JSON 선택 → 파일명·작업공간 이름·자료/원문 버전/발췌 개수·본문 확보 범위 확인 → 취소 또는 새 사본 생성 → 사본 읽기 → 이전 작업공간으로 돌아가기.

파일 선택과 검증은 사본 설치가 아니다. 실제 해시·참조 검증에 성공한 후보만 확정할 수 있다. 링크만 있거나 본문 일부만 있는 원문도 미리보기에서 구분한다. 원문 목록은 필요할 때 펼친다. 다른 파일 선택·검증 실패·취소 때는 이전 후보를 폐기한다. 복원 후에는 새 피드 위의 완료 안내에서 이전 작업공간으로 돌아가거나 안내만 닫을 수 있다. 이 바로가기 안내는 현재 UI 세션에만 남으며 새로운 백업 이력 저장소를 만들지 않는다.

기존 작업공간을 덮어쓰지 않고 모든 ID와 내부 참조를 새 사본으로 재발급한다. 복원 사본에는 자동 동기화 연결이 없다. 이전 공간 복귀는 파일에 담긴 원래 기기로 이동한다는 뜻이 아니라, 복원 직전에 이 브라우저에서 열고 있던 작업공간을 여는 행동이다. 사본과 이전 공간은 모두 보존한다.

**동기화:** 관리 → 기기 간 동기화 → 현재 상태·다음 행동 → 필요한 경우 계정·연결 정보 또는 서버 목록 펼치기.

| 현재 상태 | 먼저 제공하는 행동·의미 |
| --- | --- |
| 상태 확인 중 / 확인 실패 | 전송 시작을 제시하지 않음. 실패하면 기존 연결을 유지하고 상태 재확인 |
| 미연결 | 현재 작업공간의 동기화를 명시적으로 시작. 로그인만으로 업로드하지 않음 |
| 중지 | 기존 연결과 자료를 보존하고 다시 시작. 남은 충돌은 재시작 후 비교 |
| 대기 / 전송 중 | 로컬 보관과 전송을 구분. 전송 중에는 중복 ‘지금 동기화’ 비활성 |
| 서버와 동기화됨 | 같은 계정의 다른 기기에서 작업공간을 받을 수 있음. 다른 기기에서 열었는지는 확인하지 않음 |
| 전송 실패 | 로컬 자료를 보존하고 오류·재시도 제공 |
| 계정 불일치 | 전송 시작·충돌 확정 차단. 계정 확인 또는 백업 사본 이동 |
| 충돌 | 양쪽 변경 비교를 먼저 제공. 선택하지 않은 쪽의 로컬 사본 보존 명시 |

계정·프로젝트·revision은 접힌 상세에 두고 동기화 설정 SQL 도움말은 화면 끝에 둔다. 서버 목록의 제목과 저장 날짜는 바로 읽히며 기술적 버전 정보는 펼쳐 확인한다. 갱신 중에도 계정 상세·서버 정보의 펼침 상태와 키보드 초점을 유지한다. 충돌 비교는 서버 목록보다 앞에 있고, 두 선택 행동의 시각적 비중을 같게 했다.

## 오류 복구와 보존 경계

독립 검토에서 기존 UI 결함을 실제 IndexedDB·익명 어댑터로 재현한 뒤 수정했다.

- **설치 후 조회 실패:** `installWorkspace()`는 이미 사본·소유권·활성 포인터를 커밋했는데 후속 읽기가 실패하면 기존 화면에 ‘새 사본으로 복원’이 남았다. 재시도는 중복 ID 오류로 막혔다. 이제 설치 반환을 성공 경계로 삼아 사본과 완료 안내를 먼저 보여주고, 후속 목록 오류는 ‘사본 보관 완료·목록 갱신 실패’로 구분한다.
- **비교 후 서버 변경:** 엔진은 오래된 비교를 정상 거부했으나 화면에 이전 비교와 확정 버튼이 남았다. 서버 재변경·삭제·연결 중지·계정 변경 때는 낡은 비교를 폐기하고 최신 상태에서 다시 시작한다. 데이터 병합 알고리즘은 바꾸지 않았다.
- **작업공간 전환 중 초안:** 복원과 이전 공간 복귀 전에 원문 읽기의 미확정 주제·메모까지 현재 공간에 보관한다. 저장이 실패하면 전환하지 않는다. 성공한 뒤에만 이전 공간의 편집 캐시를 정리해 다른 공간의 원문 ID가 로그아웃·이동을 막지 않게 한다.
- **이전 공간 복귀 후 조회 실패:** 활성 공간과 실제 화면을 먼저 일치시키고 목록 조회 실패를 따로 표시한다. 원본과 복원 사본을 모두 유지한다.

충돌 해결이 로컬 선택·복구 사본을 저장한 뒤 서버 전송에서만 실패한 경우도 별도로 표시한다. 다운로드 요청을 Files에 실제 보관한 사실로 표현하지 않는다. 원문 버전·출처·UTF-16 발췌 위치, 기존 계정 격리·조건부 서버 쓰기·초안의 기기별 보관 계약은 유지한다.

## 디자인과 재사용

Life의 한 열, 흰 바탕, 얇은 구분선, 공통 SVG·버튼·details를 재사용한다. 새로운 라이브러리·백엔드·파일 형식은 없다. 기존 [오픈소스 검토](references.md)와 [Impeccable 4.5.0 지침](impeccable.md)의 Operate 원칙을 적용했다. 새 diff 엔진이나 백업 이력 DB 없이 기존 검증·복원·동기화 API의 결과를 명확히 보여주는 범위다.

root가 UI·CSS·배포를 담당했고 management_plan이 보존 계약과 오류 경계를 독립 검토했다. sequence_review는 기능·시각 검증을 담당했다. 계정·파일·원문은 모두 익명 합성 자료다.

| 장면 | 이전 | 변경 후 |
| --- | --- | --- |
| 복원 미리보기 · 1440px | [이전](evidence/life-management/before-restore-preview-desktop.png) | [변경](evidence/life-management/after-restore-preview-desktop.png) |
| 복원 미리보기 · 390px | [이전](evidence/life-management/before-restore-preview-phone.png) | [변경](evidence/life-management/after-restore-preview-phone.png) |
| 복원 완료 · 390px | [이전](evidence/life-management/before-restore-complete-phone.png) | [변경](evidence/life-management/after-restore-complete-phone.png) |
| 미연결 · 390px | [이전](evidence/life-management/before-sync-unbound-phone.png) | [변경](evidence/life-management/after-sync-unbound-phone.png) |
| 계정 상세 · 390px | [이전](evidence/life-management/before-sync-details-phone.png) | [변경](evidence/life-management/after-sync-details-phone.png) |
| 전송 실패 · 390px | [이전](evidence/life-management/before-sync-error-phone.png) | [변경](evidence/life-management/after-sync-error-phone.png) |
| 충돌 비교 · 1440px | [이전](evidence/life-management/before-sync-conflict-desktop.png) | [변경](evidence/life-management/after-sync-conflict-desktop.png) |
| 양쪽 원문 펼침 · 820px | [이전](evidence/life-management/before-sync-conflict-open-tablet.png) | [변경](evidence/life-management/after-sync-conflict-open-tablet.png) |

## 검증과 한계

재현 명령은 `npm run check`, `npm test`, `node tests/life-management-browser.cjs`, `node scripts/check-life-management-design.cjs`다. 브라우저 검사에는 `npm run dev`의 로컬 서버와 환경의 Playwright/Chromium을 사용한다. 공개 산출물·서비스워커는 별도의 익명 SDK/HTTP 검사로 확인한다.

| 검사 | 이번 결과 |
| --- | --- |
| 정적 검사 | HTML 16개·JavaScript 34개·로컬 참조 186개·PWA 통과 |
| Node 회귀 | 188/188 통과 |
| 새 관리 흐름·복구 경계 | 14/14 통과. 파일 교체·취소·해시/참조·새 ID·이전 공간·초안 실패·설치/복귀 후 조회 실패·서버 재변경/삭제/중지 포함 |
| 기존 자료 / 동기화 / 공용 SDK·PWA | 23/23 · 14/14 · 9/9 통과. 새 관리와 합쳐 브라우저 60개 |
| 시각 검사 | 36장면·185항목 통과. 최종 수정 영향 장면만 부분 재확인했으며 반복 항목을 합산하지 않음 |
| 읽기·조작 | 측정한 최소 텍스트 대비 6.05:1, 초점 3px·7.286:1. 가로 넘침·이름 없는 조작·44px 미만 조작·16px 미만 입력 0 |
| 오류·운영 접근 | 예기치 않은 console/pageerror 0, 실제 Supabase 쓰기 0. 의도한 오프라인 오류는 별도 집계 |
| 문서 | 수정한 문서의 로컬 링크 140개 및 diff 확인 |

이전·이후 같은 원문 7개·버전 8개·발췌 12개를 사용한다. 긴 한글 제목, 본문 전체·부분·링크만 보관한 자료, 오래된 버전에 연결된 발췌를 포함한다. 1440·820·390px의 복원·오류·미연결·대기·동기화·중지·충돌을 실제 Chromium에서 확인한다. 비동기 상태 전이는 Promise 자체가 참으로 평가되는 검사를 피하고, 반환된 boolean을 확인할 때까지 기다린다.

서비스워커 v58 → v59 업데이트에서 기존 자료와 미적용 초안을 보존했다. 원천·동기화 엔진과 연표 파일은 이번 변경에서 수정하지 않았다. 기능 회귀, 화면 캡처·직접 검토, 공개 파일 배포 확인은 각각 구분한다.

실제 Mac·iPad·iPhone의 한글 IME·선택 손잡이·Files 저장·VoiceOver와 실제 Google 재로그인은 이번 검증 범위에 포함하지 않는다. 운영 Supabase 행을 만들거나 개인 기록을 조회하지 않았다. 클라우드 Chromium의 라이브 인증서 제한과 HTTPS 공개 파일 확인도 구분한다.

직접 체험: [해도](https://wonchance-art.github.io/life-haedo/) → 관리 → 자료 백업·복원에서 본인 JSON의 제목·개수·확보 범위를 확인하고 새 사본을 열어 본다. 이전 작업공간 복귀 후 사본도 목록에 남는지 확인할 수 있다. 실제 기기 체험 결과에 따라 다음 원천 입력 편의 개선을 정한다. LPE 통합은 계속 보류한다.
