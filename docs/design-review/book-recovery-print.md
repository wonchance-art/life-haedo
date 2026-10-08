# 원고 개정본·책과 장 복구·PDF 출력

2026-10-08 KST. [책 전체 읽기](book-reading.md) 다음 단위다. 목표는 **이름 붙인 원고 보관 → 수정 → 이전 원고 복원 → 복원 전 원고 재확인 → 책/장 보관·복구 → 같은 범위의 PDF 출력**이다. root가 화면 통합을 맡으며 모델, SQL, 동기화 보존, 독립 QA, 인쇄 검증을 나눴다. 구현과 운영 적용은 별개이며 병합·배포·운영 SQL은 Local 담당이다.

## 개정본 계약

기존 `life-workbench-v1`에서 책의 `editions`와 `archived`, 장의 `archived`를 선택 필드로 추가한다. 과거 형식은 그대로 수용한다. 개정본은 명시적 `현재 원고 보관` 시점의 책 제목·기간·질문과 모든 장·해석·정확 원문 참조를 보관한다. 제외한 해석과 보관한 장도 포함한다. 원문 본문을 복제하거나 원문 제목 이력을 새로 만들지 않는다. 출처 제목은 기존 현재 제목 표시 계약이다.

책마다 최대 10개, 전체 구성 2 MiB 제한을 함께 적용한다. 유효성·용량을 확인한 독립 후보만 현재 초안에 적용한다. 초과하면 현재 내용과 이전 개정본을 변경하지 않는다. 시간은 밀리초 포함 UTC 표준 형식이며 UI는 한국 시간으로 표시한다.

복원은 **현재 내용을 `복원 전 원고` 개정본으로 추가한 뒤** 선택한 개정본의 내용으로 현재 책을 바꾼다. 대상 개정본을 없애지 않는다. 새 장·해석 식별자를 만들고 정확한 원문 버전 참조는 보존한다. 10개가 차면 복원도 차단한다. 이름 없는 자동 이력을 무한히 만들거나 가장 오래된 것을 조용히 버리지 않는다.

개정본 삭제는 별도 명시 동작과 확인을 거친다. 현재 원고·원문은 유지되지만 삭제한 개정본은 JSON 백업이 없으면 복구할 수 없다. 공간이 부족할 때 먼저 자료·구성 JSON을 보관하고 필요 없는 개정본을 고르는 흐름을 안내한다. 한도 도달을 이유로 데이터를 자동 삭제하지 않는다.

## 책과 장 보관함

책·장을 없애는 대신 보관 상태를 바꾼다. 보관한 책은 활성 목록에서 빠지고 보관한 책에서 복구한다. 보관한 장은 목차와 현재 미리보기·Markdown·인쇄에서 빠지며 복구하면 배열의 기존 위치에 돌아온다. 보관함도 기존 책/장 한도에 포함된다.

원문·발췌·기존 회고·다른 책을 지우지 않는다. 개정본을 복원하면 그 개정본에 있던 장 보관 상태도 되돌아온다. 책 자체의 보관 상태는 원고 개정본과 독립적이다. 보관은 동기화 제외나 이미 공유한 별도 공개 사본의 철회를 뜻하지 않는다.

## 저장·동기화·백업

작업 전 기존 입력을 저장하고, 검증된 전체 후보를 기존 CAS 저장 경로로 적용한다. I/O 실패 시 저장된 상태와 현재 초안을 구분하고 오류·재시도·초안 JSON을 유지한다. CAS 충돌 비교에는 책/장 보관 상태와 모든 개정본의 원고·해석·근거를 표시한다. 복원 작업 자체가 저장에 실패한 경우도 복원 전 원고를 담은 후보 초안이 남으며 성공으로 안내하지 않는다.

자료·구성 JSON의 새 사본 복원은 현재 책과 개정본의 모든 식별자·정확 원문 참조를 함께 재매핑한다. 공통 누락 참조도 하나의 매핑을 재사용한다. 보관한 책/장과 제외한 해석을 복원 대상에서 빼지 않는다. 서버가 새 선택 필드를 거절하면 데이터를 제거해 다시 보내지 않는다.

## 인쇄와 PDF

현재 책의 `Books.project()`를 사용해 미리보기·Markdown과 같은 활성 장·해석·출처 범위를 인쇄한다. 원문 본문은 동일한 명시 포함 옵션을 따른다. 개정본과 보관한 장, 선택 밖 책, 계정·탐색·백업 UI는 인쇄하지 않는다.

원고는 안전한 평문으로 넣으며 HTML/Markdown을 실행하지 않는다. 인쇄 전 저장을 마치고, 별도 문서와 글꼴 준비 뒤에도 계정·작업공간·현재 화면이 같은지 확인한다. 계정/화면 변경은 대기 중인 인쇄를 취소한다. 브라우저 인쇄 창에서 PDF 또는 프린터를 고르며 앱은 파일 저장 성공을 확인할 수 없으므로 `다운로드 완료`를 표시하지 않는다. 원문은 외부 변환 서버에 보내지 않는다.

PDF는 현재 원고의 읽기용 출력이며 JSON 복원 파일·공개 게시·원고 개정 이력 전체가 아니다. 원고의 Markdown 문법은 글자 그대로 출력한다. 인쇄 HTML이 16 Mi UTF-16 단위를 넘으면 자르지 않고 원문 본문 제외 또는 책 나누기를 안내한다. 이는 기존 저장 한도와 별도다. [공식 후보 비교](../life-tools-design/open-source-review.md#원고-개정본복구와-한글-pdf--2026-10-08-kst)에 native print 채택·Paged.js/pdf-lib 보류 이유를 남겼다. 양면 책자 배치·재단선·출판용 전문 조판은 이번 범위가 아니다. 실제 Mac/iPad/iPhone의 인쇄·Files 동작은 브라우저 모사와 구분한다.

## 검증 상태

- 정적 점검 HTML 18/JS 58/참조 271/PWA와 단위 376개 통과. 단위에는 신규 개정본 11개·인쇄 8개가 포함된다.
- [복구 브라우저](evidence/book-recovery-print/history-combined-report.json): 7/7 흐름, 키보드로 개정본 내용 펼치기 추가 후 해당 흐름 1/1 재확인. 1440·820·390px, 10개 화면 상태. 실제 IDB 오류·CAS 충돌, 10개/2 MiB 거절, 개정본·보관함 백업 새 사본, 계정/공간 격리.
- [구성 이어쓰기](evidence/book-recovery-print/sync-report.json): 9/9·21캡처, 버린 쪽 JSON과 공유/개정본 전용 누락 참조 재매핑. [최종 충돌 제목](evidence/book-recovery-print/sync-heading-report.json)은 관련 흐름만 재검사해 3폭 모두 14px 제목·콘솔/페이지 오류 0을 확인했다.
- 이전 전체 원고 읽기 `book-preview-browser.cjs` 6/6를 이번 코드에서 재실행했다. 이전 PR의 결과를 재사용한 것이 아니다.
- [SQL 격리 증거](evidence/book-recovery-print/sql-report.json): 운영 설치와 별개다.
- [개정본 1440](evidence/book-recovery-print/editions-1440.png) · [820](evidence/book-recovery-print/editions-820.png) · [390](evidence/book-recovery-print/editions-390.png) · [빈 이력](evidence/book-recovery-print/empty-history-390.png) · [충돌의 개정본](evidence/book-recovery-print/sync-edition-390.png). [저장 오류](evidence/book-recovery-print/save-error-390.png) · [개정본 한도](evidence/book-recovery-print/capacity-error-390.png). root와 독립 QA가 실제 이미지를 검토했다.
- 익명 샘플만 사용했다. 화면 폭 모사를 실제 Mac/iPad/iPhone·IME·Files·VoiceOver·사용자 원고 체험으로 보고하지 않는다. PDF 최종 결과는 아래와 같다.

### 실제 PDF 검증

[인쇄 브라우저 보고서](evidence/book-recovery-print/print-report.json)의 3/3이 통과했다. Linux Chromium 151에서 생성한 [익명 검증 PDF](evidence/book-recovery-print/anonymous-book.pdf)는 **7쪽 A4**이며 한글 선택·텍스트 추출, 모든 60문단, 정확한 과거 원문과 장 2의 새 페이지(7쪽)를 확인했다. 짧은 문단의 첫 줄만 앞쪽에 남던 배치를 고쳐 각 짧은 문단이 같은 페이지에 들어가는 회귀를 추가했다. 원고 텍스트·Markdown은 바꾸지 않았다.

[첫 페이지](evidence/book-recovery-print/pdf-first-page.png) · [다음 장](evidence/book-recovery-print/pdf-next-chapter.png) · [앱 인쇄 조작 390px](evidence/book-recovery-print/app-print-preview-390.png). PDF는 HTML 비실행 확인용 문자열도 포함하는 합성 테스트 파일이며 사용자의 개인 원고가 아니다. root가 페이지 이미지를 직접 검토하고 문단 시작 간격의 일관성도 PDF 좌표로 확인했다.

실제 sandbox iframe의 native `window.print()` 요청과 앱 버튼의 키보드/터치 조작을 구분해 검사했다. 앱에서는 기본 원문 본문 제외 → 명시 포함, 선택 책·고정 버전만 전달, 저장 변경과 원격 쓰기 0을 확인했다. 실제 사용자가 OS 인쇄 창에서 파일 저장을 완료한 결과나 Apple 실기 결과는 아니다.

Poppler PNG 생성 중 Type3 이모지 glyph 경계 경고가 나왔으며 보고서에 별도 기록했다. 종료 코드는 0이고 한글·이모지 텍스트 추출은 통과했다. 이를 브라우저 오류나 사용자 기기 글꼴 완전성 검증으로 바꾸어 보고하지 않는다.

합성 공개 설정으로 `scripts/prepare-site.mjs`를 실행해 변경 런타임 11개 원본/산출물 일치와 서비스워커 v82를 확인했다. 운영 설정·개인 자료·공개 배포를 사용한 검증이 아니다.

## Local 인계

선행 PR #46/#47/#48의 적용 상태를 확인한 뒤 이번 새 validator migration을 설치한다. 이미 설치한 선행 SQL을 반복하지 않는다. PR #47의 insights validator까지 설치됐다면 이번 `supabase/migrations/20261008030000_life_composition_editions.sql`만 적용하고 `supabase/tests/life-composition-editions-installation.sql`의 **16조건**을 읽기 전용으로 확인한다. 선행 미설치라면 books → insights → editions 순서다. 최신 validator 설치 후 과거 migration을 다시 실행하면 기능을 되돌릴 수 있으므로 과거 SQL을 재설치하지 않는다.

- migration SHA-256: `cb09fcce8301d1f65c524ddbe443a8859cdca4af8d8fd7886fe79f4a946bd1b8`
- 설치 검사 SHA-256: `ab27a58695b9e01a52abf3ea8cda106e2a544d132f33e07a896aa2861cf7fc24`
- 격리 PostgreSQL 17.11에서 기존 352 + 신규 122 조건, 기존 설치 36 + 신규 16, JS/SQL 차등 232사례 통과. 기존 행·함수 OID·권한 보존. 이는 운영 설치·실제 사용자 왕복 검사 결과가 아니다.

 운영 DB에 합성 SQL 테스트를 실행하지 않는다. Cloud는 운영 설치·개인 자료 검사·병합·배포를 수행하지 않는다.

다음 사용 검증은 실제 20대 원고 한 권에서 개정본 두 개를 비교하고 복원한 뒤 PDF를 읽는 것이다. 이후 개선은 그 체험에서 드러난 읽기·편집 문제를 우선하며 자동 AI 분석이나 전문 조판을 이번 기능으로 표시하지 않는다.
