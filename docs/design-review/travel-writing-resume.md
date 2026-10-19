# 여행 글의 앱 전환·뒤로 가기 복귀

2026-10-19. 목표는 사진 몇 장을 붙여 쓰던 글에서 앱을 전환하거나 다른 페이지에 갔다 돌아와도, **같은 계정의 같은 편집기와 이미 받아들인 입력을 유지**하는 것이다. 기존 PhotoPost·IndexedDB·인증·작업공간 구조의 수명 처리를 고친다. 새 저장 형식·플랫폼·동기화 엔진·의존성을 추가하지 않는다. Photos의 HEIC 전달이나 Safari 다운로드를 추측으로 고치지 않는다.

## 확인한 손실과 범위

기준 `74eccb5`의 실제 앱·SDK·IndexedDB에서 본문과 사진 설명을 바꾼 직후, 같은 task에서 합성 `pagehide/pageshow(persisted=true)`를 발생시켰다. 본문은 약 85ms, 설명은 약 20ms 뒤였으며 자동 보관 지연 500ms보다 빨랐다. 두 경우 모두 새 입력이 사라지고 편집기 대신 글 피드로 돌아갔다. 저장 revision은 그대로였고 기존 PNG의 SHA-256·939바이트·160×120 크기는 보존됐다.

기존 `pagehide`의 즉시 dispose가 보관 timer·편집기·계정 scope를 버리고, 복귀 때 화면을 다시 만들던 경계다. 같은 실험에서 `Cannot read properties of null (reading 'history')` 오류도 잡혔다. 설명 blur의 `editor.history` 접근은 소스상 원인 후보이며, 당시 보고서는 메시지만 수집했으므로 stack으로 확정한 것으로 쓰지 않는다.

근거: `.local/travel-writing-resume/before/pagehide-report.json`, `review.md`, 본문·설명 전후 화면. 합성 lifecycle 재현은 실제 bfcache·OS 앱 전환·Apple 키보드 체험을 뜻하지 않는다. 이 최초 합성 재현과 아래 최종 제품의 실제 history 검증은 별도 근거다.

## 수정 계약

- **PhotoPost/Workbench:** `checkpoint()`는 기존 모델에 이미 수용된 변경만 같은 로컬 CAS 경로로 보관한다. 미확정 IME·첨부 입력·검증 중 사진을 DOM에서 억지로 확정하지 않는다. Workbench는 활성 사진 편집기에서 이 경로를 사용하고, 일반적인 명시 이동·저장은 기존 `flush()` 계약을 유지한다. 설명 blur는 폐기된 편집기의 history를 참조하지 않는다.
- **UI/Shell:** hidden에서 보관을 시도하고, pagehide에는 편집 DOM·메모리·해당 계정 scope를 숨긴 상태로 유지한다. scope를 닫아 진행 중 IndexedDB 저장을 스스로 중단하지 않는다. 문서·커서/선택·스크롤의 복귀 기준은 그 계정과 살아 있는 같은 편집 인스턴스다. 단순 복귀를 새 초안이나 피드 재진입으로 바꾸지 않는다.
- **Auth/Shell:** Auth는 `pagehide`에서 화면을 숨기기 전 `haedo:page-suspend`를 동기로 알린다. Shell은 이 순서에서 위치를 캡처하므로 별도 window listener의 순서를 가정하지 않는다. persisted 복귀에서 Auth는 취소 가능한 내부 이벤트 `haedo:page-resume`으로 한 담당자에게 위임한다. Shell이 담당하면 중복 일반 검증을 실행하지 않고, 서버의 현재 소유 계정을 새로 확인한 뒤에만 숨긴 편집기를 드러낸다. 이전 검증의 늦은 결과는 epoch·계정·suspension·인스턴스가 달라지면 무시한다. 이 이벤트 취소는 앱 내부 위임이며 브라우저 탐색 취소가 아니다.
- **강한 경계:** 실제 로그아웃·계정 변경·scope 폐기는 기존 dispose/clear 경계를 유지한다. 이전 계정의 DOM이나 입력을 새 계정에 보여 주거나 보관하지 않는다. 네트워크 문제로 소유 계정을 재확인하지 못하면 숨긴 상태와 재시도 안내를 유지하며, 캐시된 계정만으로 개인 화면을 다시 열지 않는다.

기존 구조를 재사용하면 문서·사진·목록·인용 근거의 기존 원자 저장과 충돌 복구를 유지하면서, 문제를 일으킨 화면 폐기 시점만 좁혀 바꿀 수 있다. 새 모델이나 lifecycle 라이브러리는 OS 저장 완료를 보장하지 못하고 수명 관리자를 더 만들므로 이번 수정에 도입하지 않는다.

## 보존·실패 복구

사진 원본 바이트·해상도·순서·설명, v1/v2와 기존 글·초안, 정확 원문·근거 연결은 기존 계약대로 유지한다. 저장 revision·CAS·영속 작업 영수증과 기존 실패 사본 경로를 우회하지 않는다. 이 수정으로 원격 전송·서버 보관·선택 공개 범위를 늘리거나 자동 게시하지 않는다. ZIP·HTML·기존 복원 형식과 다운로드 코드는 바꾸지 않는다.

checkpoint 실패는 보관 성공으로 표시하지 않는다. 페이지가 살아 있고 같은 계정이면 현재 편집 입력을 유지하고 기존 저장 재시도·충돌/사본 복구를 사용한다. 인증 재확인 실패는 연결 후 같은 복귀 확인을 다시 시도한다. 이전 작업공간을 초기화하거나 다른 초안을 최신이라는 이유로 대신 열지 않는다.

OS가 페이지를 discard하거나 프로세스를 종료하면 DOM은 남지 않을 수 있고, pagehide 자체가 없거나 비동기 저장이 끝나기 전에 중단될 수 있다. 이 경우 보장 범위는 마지막으로 **실제 커밋된** 로컬 사본이다. 종료 방지나 모든 미확정 입력의 영구 보존을 약속하지 않는다.

## 완료 기준·담당

| 경계 | 담당 | 최소 실험·판정 |
|---|---|---|
| 본문/설명 tail·한글 조합·처리 중 사진·실패 복구 | PhotoPost/Workbench: atomic, 합성 QA: receive | 기존 재현을 수정본에서 대조한다. 같은 편집기·입력·원본 PNG 유지, 부분 사진 저장 없음, CAS 실패 뒤 입력 보존과 재시도를 확인한다. 미확정 조합을 임의 확정하지 않는다. |
| 숨김·현재 계정 재검증·늦은 결과·위임 | Auth/Shell/UI: root | 확인 중 개인 화면 숨김, 동일 계정만 복귀, 로그아웃/다른 계정은 이전 화면 제거, 검증 실패 후 재시도를 확인한다. 복귀 자체의 원격 문서 쓰기는 없어야 한다. |
| 실제 브라우저 history | 독립 history QA(총괄 배정) | 자동화 기본 인자의 bfcache 비활성 여부를 구분한다. 실제 trusted pagehide/pageshow와 persisted 값·문서 동일성·편집 입력을 함께 관찰하고, 합성 이벤트와 별도 기록한다. |
| Mac/iPad 여행 글·Photos/Files | root가 사용자 기기 확인 후 공동 검수 | 작은 여행 글과 사진 두 장으로 입력 직후 앱 전환→복귀, 다른 페이지→뒤로 가기를 수행한다. OS·브라우저·탭/설치형·키보드·네트워크를 기록하고 같은 글/설명·커서·스크롤을 확인한다. ZIP/HTML의 실제 Files 저장·재선택은 기존 파일 계약의 실기 항목으로 별도 확인한다. |

## 최종 제품 검증

Linux Chromium 151의 실제 탐색·뒤로 가기에서 `isTrusted=true`와 `persisted=true`, 문서 UUID 동일성을 필수 단언했다. 기본 자동화의 bfcache 비활성 인자 하나만 제외했고 합성 이벤트나 skip으로 대체하지 않았다. 실제 `beforeunload` 확인창 한 번을 수락한 뒤 같은 작성기·사진 설명 DOM·저장 scope·글 ID·현재 소유 계정으로 돌아왔다. 설명 선택 `2..8 forward`, 스크롤 `[0,101]`, 한글 끝 문단과 설명의 IndexedDB 보관을 확인했다. 사진 두 장은 원본 SHA와 4032×3024·1200×1800을 유지했고 서버 계정 재확인은 정확히 한 번, 원격 본문 쓰기·콘솔/페이지/외부 요청 오류는 모두 0이었다. 영구 회귀는 `tests/travel-writing-history-browser.cjs`, 근거는 `.local/travel-writing-history/report.json`과 화면이다.

이 과정에서 확인창이 pagehide 전에 사진 설명에서 초점을 빼는 문제를 찾아 `beforeunload`에서 위치를 먼저 기억하도록 고쳤다. 또 window listener의 capture 옵션만으로 Auth의 숨김보다 먼저 실행된다고 가정할 수 없음을 실제 스크롤 20→0 진단으로 확인했다. 위의 명시적 suspend 통지가 그 순서를 고정한다. 로그아웃의 저장 실패가 인증 대기 중 늦게 도착해 개인 화면을 다시 드러내던 경로도 숨김·재확인으로 고쳤다.

별도의 합성 lifecycle·조합 회귀 `tests/travel-writing-resume-browser.cjs`는 8개 경계를 모두 통과했다. 자동 저장 지연 전 입력, 사진 검증 중 수용된 본문만 보관, 실제 커밋 뒤 응답 대기, 미확정 조합과 일반 이동 보호, IndexedDB abort 후 입력·재시도, 지연 로그아웃 실패 중 개인 화면 숨김, 오프라인 인증 재시도, 다른 계정 전환 시 이전 DOM·scope 차단을 확인했다. 로그아웃 race는 숨겨진 계정 버튼을 실제 사용 동선으로 가장하지 않고 합성 handler 호출로 주입했다. 1440·820·390px에서 수평 넘침 없이 입력 16px 이상과 설명 조작 영역 44px 이상을 확인하고 실제 화면을 검토했다. 원본 두 장의 SHA·실제 디코딩 픽셀·크기, 기존 v1·첨부 글·구성 자료를 대조했으며 원격 본문 쓰기와 예기치 않은 콘솔/페이지/외부 오류는 0이었다.

최종 제품 소스에서 단위 검사 849개, 정적 검사 22 HTML·133 JavaScript·581 로컬 참조, 실제 배포 기준 `38b4559`의 서비스워커 133→134 전환과 기존 데이터 보존 9개 흐름을 통과했다. PWA 검사에서 의도한 전송/콜백 실패 로그 3개는 실제 결과대로 별도 구분했다. 두 신규 브라우저 회귀는 기존 전체 CI에 추가했으며 배포/CI 결과는 해당 PR과 실행 기록에서 확인한다.

Apple 하드웨어·네이티브 IME·강제 종료 복구는 미검증이다. 네트워크 응답은 격리한 익명 합성 계정이며 실제 Google 계정·개인 기록을 사용하지 않았다. OS가 문서를 폐기한 뒤의 미커밋 입력 보존이나 실제 Photos/Files 동작을 이 결과로 보장하지 않는다.

## 공식 lifecycle 근거

공식 원문 확인 기록은 `.local/travel-lifecycle-sources/sources.json`, `review-ko.md`와 HTML 발췌에 있다. 2026-10-19 KST에 공개 원문을 확인했으며 새 의존성을 도입하지 않았다.

- [MDN pagehide 원문](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/window/pagehide_event/index.md): 모바일 종료 때 전달되지 않을 수 있으며 bfcache와 호환된다.
- [MDN pageshow 원문](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/window/pageshow_event/index.md): 초기 로드·동결/뒤로 가기 복귀 등에 발생하며 실제 visible과 동의어가 아니다.
- [MDN visibilitychange 원문](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/document/visibilitychange_event/index.md): hidden은 보관 시도의 기회이고 이벤트는 취소할 수 없다.
- [WHATWG HTML 원문](https://raw.githubusercontent.com/whatwg/html/main/source): page transition 이벤트는 역사적 이유로 cancelable이지만 취소해도 전환을 막지 않는다. persisted는 재사용 맥락이며 저장 완료나 OS 유지의 보증이 아니다.

기존 계약: [사진 글](photo-post-editor.md), [글 파일·보관](blog-writing-completion.md), [정확한 근거 파일](preservation-portability.md).
