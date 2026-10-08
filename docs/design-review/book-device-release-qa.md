# A안 Local 통합 검증

2026-10-09 KST · Codex · 공개 배포 전 확인

## 기준과 보존

Cloud 인계 `8afd77c033e404ba23ec8f3038e5a61fda8453a3`와 PR #55를 대조했다. PR #35–#55는 모두 미병합이며 의존 순서대로 쌓였다. 당시 main `0c4bae182b16d4b61a74080ac012ad57bb44e983`는 그 조상이다. 기존 Documents 작업 폴더와 미커밋 변경을 보존하고 별도의 관리 worktree에서 확인했다. 오래된 다른 PR은 이번 통합 범위에 넣지 않는다.

익명 네 장 [백업](evidence/book-edition/reader-book-backup.json)을 실제 앱의 **새 사본으로 복원**으로 설치했다. 운영 기록을 읽거나 샘플로 덮어쓰지 않았다. 격리된 기기 체험 환경은 합성 계정과 별도 출처를 사용하고 운영 쓰기를 차단한다. 이 환경의 로그인은 실제 Google 인증 증거가 아니다.

## 발견과 수정

- Mac의 임시 폴더가 심볼릭 링크를 포함해 사이트 준비 테스트 한 개가 실패했다. 테스트가 실제 임시 경로를 사용하도록 수정했다. 운영 준비기의 심볼릭 링크 거부 규칙은 유지했다. Node 398/398 통과.
- Mac Chromium의 좌표 입력 검사에서 글꼴·자동 높이·네이티브 커서 배치가 끝나기 전에 다음 동작을 보내 화면 이동을 입력에 잘못 귀속했다. 글꼴 준비와 좌표 입력 전 배치가 안정됐는지 확인하고, 준비용 스크롤을 즉시 이동으로 명시했다. 입력 후 화면 이동 <2px, 커서 이동, 저장 후 위치, 읽기 복귀 <3px의 기존 기준은 유지했다. 조합 중 값 계약과 실제 앱 구현은 변경하지 않았다.
- 기본 움직임 설정에서는 목차 이동 직후 집필을 누르면 스크롤 애니메이션 중 앞 장을 고르는 결함을 추가 재현했다. 원래 런타임을 격리된 브라우저에만 전달한 820px 검사는 정확한 장 선택에서 실패했고, 수정 후 390·820·1440px는 3/3 통과했다. 책의 명시 탐색·읽던 위치 복원을 즉시 이동으로 바꿨다. CI에도 기본 움직임 설정의 동일 회귀를 추가했다. [수정 전](evidence/book-device-release/mac-chromium-default-motion-before.json), [수정 후](evidence/book-device-release/mac-chromium-default-motion.json).
- 자동 높이 계산을 바꾸는 실험은 문제를 해결하지 못해 폐기했다. 승인된 A 디자인, 원문·버전·발췌·저장·동기화·백업·공개 모델을 보존한다. 최종 런타임 수정에 맞춰 서비스워커 캐시는 **v89**로 갱신한다.
- 별도 기기 체험 브라우저에서 `ResizeObserver loop completed with undelivered notifications.` 오류 이벤트 한 개를 수집했다. 관찰 콜백에서 즉시 높이를 바꾸던 코드를 다음 화면 갱신으로 옮기고 화면을 닫으면 예약을 취소한다. [MDN의 관찰 오류 설명](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver#observation_errors)을 참고했다(2026-10-09 확인). 기본 움직임에서 폭 변경 후 원고·선택·높이와 네이티브 window 오류 이벤트까지 검사했다. Chromium·WebKit 각 3/3 통과: [Chromium](evidence/book-device-release/mac-chromium-resize.json), [WebKit](evidence/book-device-release/mac-webkit-resize.json). 이 수정은 최종 통합 PR에서 추가한다.

## 기기와 대체 근거

| 환경 | 실제 확인 | 한계 |
| --- | --- | --- |
| MacBookAir10,1 / macOS 26.3.1(a) / Chrome(설치본 155.0.8059.39, 실행 세션 버전 미확정) | 실제 파일 선택 → 새 사본 복원 → 두 번째 장 집필 → 한글 선택·붙여넣기 → 저장 → 전체 읽기 → 목차 이동 | 자동 키 전송은 두벌식에서 개별 자모를 입력해 실제 연속 조합을 증명하지 못했다. 한글 IME 완료로 집계하지 않는다. 실행 중인 기존 Chrome 프레임워크는 154.0.8037.98이며 설치본과 달라 실제 실행 버전으로 단정하지 않는다. 사용자 조작으로 추가 자동 제어가 중단됐다. |
| 같은 Mac / Chromium 153.0.8010.12, 390·820·1440px | 장문 제목·본문 중간 입력, 저장, 읽기/목차/해당 장 복귀, 근거 토글, 격리 저장 실패와 재시도 3/3 | 화면 크기·터치 모사. 실제 iPad/iPhone이 아니다. |
| 같은 Mac / Playwright WebKit 26.6, 390·820·1440px | 같은 장문 입력·저장·복귀·실패/재시도 검사 3/3 | Mac의 자동화 WebKit이며 실제 Safari 또는 Apple 모바일 기기 확인이 아니다. |
| iPhone | Mac의 미러링 연결을 시도했으나 연결이 끊겼다 | 실제 기기 검사 미완료. |
| iPad Chrome | 같은 Wi-Fi에서 접근 가능한 익명 체험 환경과 파일·체험 절차를 전달했다 | 사용자 조작 결과 미수신. IME·소프트 키보드·회전·분할 화면·Files 미완료. |

[Mac 실제 Chrome 화면](evidence/book-device-release/mac-chrome-manuscript.jpg), [Chromium 결과](evidence/book-device-release/mac-chromium-layout.json), [WebKit 결과](evidence/book-device-release/mac-webkit-layout.json). 화면은 익명 원고이며 개인 브라우저 상단을 제외했다. 에이전트 검사를 사용자 사용 평가로 표현하지 않는다.

Mac 검증용 앱에서 실제 받은 Markdown은 14,774바이트이며 네 장과 수정한 한글을 포함했다. 같은 앱의 Codex 내장 브라우저에서는 Blob 책자 미리보기가 지연돼 HTML/네이티브 PDF 저장을 완료하지 못했다. Mac의 독립 WebKit에서는 동일한 익명 새 사본의 네 장 원고 4,353자를 그대로 읽고, 책자 목차로 2장 이동 및 HTML 17,410바이트 다운로드를 확인했다. 다만 자동 프레임 검사 중 sandbox가 스크립트 실행을 차단했다는 콘솔 기록 12개가 있어 원래 전체 결과 `pass=false`를 유지한다. 생성 HTML에 script 태그는 없으며, 도구 주입 시도라는 해석은 추정이다. 기능 성공과 콘솔 무오류를 합산하지 않고 sandbox/CSP도 완화하지 않았다. [결과와 제한](evidence/book-device-release/webkit-booklet-summary.json), [WebKit 책자 화면](evidence/book-device-release/webkit-booklet.png).

추가 Mac Chromium 검사에서 읽기 6개·책 재진입 4개·저장 복구 3개·새 사본 진입이 통과했다. 개정본 검사는 처음 6/7 뒤 로딩 시간 초과 사례 한 개만 다시 확인해 통과했다. 책자/PDF 검사는 1440·820px에서 출력 5개를 만들고 한글·포함 범위를 확인했지만 390px 및 실패 복구 사례의 후속 실행은 로딩/클릭 시간 초과가 남아 있어 Mac 전체 통과로 표시하지 않는다. 해당 범위는 PR #55 최신 전체 Chromium CI에서도 별도로 실행돼 통과했다. 최종 통합 커밋에서 같은 CI를 다시 확인한다.

Apple 모바일의 키보드 가림·다운로드 동작은 아직 판단할 수 없다. 계정·자료 보존과 입력·실패 복구는 독립 회귀로 확인하고, 모바일 IME는 합성 조합 이벤트를 대체 근거로만 사용한다. 이 한계가 통과로 바뀌지 않으며 최초 iPad 체험에서 입력 손실·저장/파일 불능이 발견되면 추가 공개 변경을 중단하고 수정 또는 되돌린다.

## 선행 운영 준비

A안 자체에는 신규 SQL이 없다. 선행 구성·집필·책·생각·개정본 기능의 미설치 SQL 5개를 원본 그대로 순서대로 설치했다. 기존 공개 페이지 SQL은 재설치하지 않았다.

| 설치 | 읽기 전용 설치 점검 |
| --- | --- |
| life_compositions | 11/11 |
| life_writing_drafts | 9/9 |
| life_composition_books | 12/12 |
| life_composition_insights | 13/13 |
| life_composition_editions | 16/16 |

합계 **61/61 passed=true**. 전후 기존 7개 테이블과 기존 RPC의 구조·권한·RLS 비교 지문이 같다. Auth 설정을 변경하지 않았다. 개인 행 조회, 테스트 계정/자료 삽입, 합성 소유자 쓰기는 운영에서 실행하지 않았다. [설치 메타데이터](evidence/book-device-release/database-installation.json).

운영의 익명 HTTP 읽기 점검도 구성 3/3, 집필 4/4, 기존 공개 범위 5/5 통과했다. 사적 테이블/RPC는 401·42501로 거부되며 공개 페이지는 정확 ID 조회와 no-store 계약을 유지한다. 실제 소유자의 get/put·다른 기기 동기화·게시/취소는 이 결과만으로 증명하지 않는다. [구성](evidence/book-device-release/http-composition.json), [집필](evidence/book-device-release/http-writing-draft.json), [공개](evidence/book-device-release/http-share.json).

보안 advisor는 직접 테이블 접근을 막고 RPC로만 저장하는 RLS 테이블 7개와 의도된 SECURITY DEFINER 실행 권한(익명 공개 조회 1개, 인증 RPC 10개)을 알렸다. 설치 검사의 소유자·권한·CAS 확인과 함께 해석하며 정책을 임의로 추가하지 않는다. 기존 유출 비밀번호 방지 비활성 경고도 남아 있고 Auth 설정은 그대로다. 안내: [RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [익명 RPC](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [인증 RPC](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [비밀번호](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## 통합과 공개 확인의 완료 경계

선행 PR을 순서대로 통합 브랜치에 병합한 뒤 전체 앱의 동일한 최종 tree를 main으로 한 번 병합한다. 최종 통합 CI와 Pages 배포가 끝난 뒤 공개 URL·병합 SHA·배포 SHA·서비스워커·실제 Google 앱 복귀·새 사본의 저장/새로고침·파일 결과를 PR 인계와 최종 보고에 별도 기록한다. 이 문서의 로컬·운영 메타데이터 점검은 공개 배포 완료를 뜻하지 않는다.

다음 우선순위는 실제 iPad Chrome의 연속 한글 조합·키보드 가림·회전/분할 화면·Files 체험과, 두 실제 기기 사이의 명시 동기화다.
