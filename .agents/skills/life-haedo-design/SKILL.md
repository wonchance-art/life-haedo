---
name: life-haedo-design
description: 해도의 화면 추가·수정·디자인 검토에 사용한다. 공통 시각 기준, 한글/기기 검증, 원문과 발췌 보존 계약을 적용한다. 백엔드 전용 변경에는 적용하지 않는다.
---

# 해도 화면 작업

경로는 저장소 루트 기준이다. [AGENTS.md](../../../AGENTS.md), [PRODUCT.md](../../../PRODUCT.md), [DESIGN.md](../../../DESIGN.md)를 읽고 현재 요청에 해당하는 화면만 다룬다. 현재 실제 자료 화면 통합과 이전 본문 중심 시안 03·소셜 스타일 02·종이색 01을 구분한다. 승인된 실제 UI와 비교 시안의 동작, 로컬 완료와 공개 배포를 혼동하지 않는다.

공식 Impeccable 지침은 `../impeccable/SKILL.md`와 `../impeccable/INSTALLATION.md`를 따른다. 현재는 프로젝트 내부 지침 배포본이며 바이너리·launcher·자동 hook을 설치하지 않았다. 컨텍스트를 직접 읽는 지원된 fallback을 사용하고 엔진 검사 결과를 만들어내지 않는다. 외부 스킬의 일반적인 확인 질문보다 현재 사용자의 명시 요청·기존 합의가 우선한다.

## 시작

- 사용자의 짧은 지시는 AGENTS.md의 실행 지시 변환 원칙으로 구체화한다. 먼저 실제 자료에서 얻을 결과와 실패 후 복구를 정하고, 동일한 익명 한글 자료로 전후를 비교한다. 제목 반복·본문 등장 위치·중간 재선택·읽던 위치 복귀를 확인하되 수치나 테스트 통과를 미적 품질·유용성의 증명으로 쓰지 않는다. 현재 기준 흐름은 `docs/design-review/core-experience.md`다.
- 검색·가져오기는 Operate, 긴 원문은 Read 모드다. 실제 코드와 최신 스크린샷을 보고 수정 범위를 정한다.
- 동일한 컴포넌트를 찾고 재사용한다. 실제 자료 화면은 `index.html`/`life.html`, `assets/life/ui.css`, `assets/life/icons.js`, `assets/life/ui.js`가 기준이다. 승인한 A 인용 아이콘과 본문 중심 한 열을 사용한다. `social-sample.html`과 `assets/design-social/`는 설계 비교, 이전 `design-sample.html`은 초기 이력이다. 검색·원문은 `docs/design-review/integration.md`, 후속 가져오기·발췌·주제는 `docs/design-review/collections-integration.md`에서 실제 UI와 저장 경계를 확인한다.
- 새로운 라이브러리는 최신 공식 버전·라이선스·유지관리·적합성을 조사하고 [참고 기록](../../../docs/design-review/references.md)에 채택/참고/제외를 구분한다. 작은 기능마다 전체 후보를 재조사하지 않는다.
- UI 편집 직전에 Impeccable `reference/craft-floor.md`를 읽고 최신 사용자 시각 방향과 실제 작업 목적을 우선한다. 본문을 앞세우고 메뉴·프레임은 최소화한다. 아이콘 탐색에는 접근 가능한 이름·초점/hover 도움말을 붙인다. 선택·저장 반응은 짧게 유지한다. 모션은 사용자 행동의 상태를 보여주며 reduced-motion을 제공한다.
- 목록은 원문별 피드를 구분하고 그 안에 저장한 문장·메모를 함께 놓는다. 본문 이외의 반복 텍스트는 줄이고 원문/정보/관리는 기존 공통 도형을 재사용한다. 20px 도형·44px 조작 영역의 정렬을 유지하고, 접힌 출처에서도 정확한 버전·목록 복귀 초점을 보존한다. 필요 정보는 눌러 펼칠 수 있어야 하며 모바일에서 hover를 요구하지 않는다.

전역 메뉴는 홈·기록·도구·관리 네 개이며 `assets/haedo-navigation.js`/`assets/haedo-shell.css`를 재사용한다. 첫 진입 홈은 저장한 책·최근 기록·묶음·내 페이지 요약을 읽기 전용으로 보여준다. 책은 활성 항목과 실제 장 수만 표시하고, 목차에서 정확한 장으로 이동한다. 없는 편집 날짜·완료율을 추정하지 않는다. 자료·문장·메모·연표는 기록에 묶고 발췌·활동을 별도 상위 탭으로 만들지 않는다. [첫 접속 홈](../../../docs/design-review/home-entry-proposal.md)을 따른다. [통합 홈 기록](../../../docs/design-review/unified-home.md)의 라우팅·계정 경계를 따른다.

묶음·내 페이지·다시 찾기·회고의 최소 화면은 `assets/life/workbench-ui.js`/`workbench.css`와 [영역별 동작](../../../docs/life-tools-design/working-sections.md)을 따른다. 기능 밖 반복 설명은 접고, 선택·원문·내 코멘트를 먼저 보여준다. 영역 이동·미리보기 전 저장 실패로 입력이 사라지지 않는지 확인하며, 계정별 로컬 구성과 실제 공개·기기 간 동기화를 구분한다.

전체 사이트는 `life.html`의 시각 기준을 따르고 최신 계약은 `DESIGN.md`를 따른다. 2026-10-05의 앱 표면은 흰 본문·옅은 라벤더 바탕·작은 민트/스카이 조작, 작은 rail/dock와 모바일 native dialog 하단 시트를 쓴다. 새 기능도 기존 토큰·44px 조작·안전 영역을 재사용하며 본문 등장 모션이나 동작 없는 스와이프 손잡이를 추가하지 않는다. 플랫폼 CSS는 연표 테마에 기대지 않는다. 전체 표면 변경은 `node scripts/check-site-design.cjs`의 익명 샘플로 기존 피드와 도구·연표·폼을 함께 검토한다.

## 구현과 확인

대표 내용은 `assets/design-review/sample-data.js`의 익명 한글 자료를 사용할 수 있다. 실제 개인 기록이나 Auth 세션을 복사하지 않는다. 동일한 자료로 전후/변형을 비교하되 현재 감사 자료와 시안 샘플은 다른 세트라는 한계를 명시한다.

1440·820·390px에서 긴 제목·본문·여러 출처·부분/링크·이전 버전과 빈/로딩/오류를 확인한다. 본문 위계, 가로 넘침, 최소 44px 조작, 키보드 초점, 16px 입력, 실제 표면에서 작은 글자 4.5:1 대비를 검토한다. 대비 계산과 수동 이미지 검토는 별개다. 별도 이미지 캡처/수정 루프를 무한히 돌리지 않는다.

공통 토큰/컴포넌트 수정은 디자인 책임자 한 명이 통합한다. 스크린샷·근거·미검증 부분을 해당 변경 문서에 남긴다. 기능 회귀는 `.agents/skills/life-haedo-dev/SKILL.md`를 따른다. 원문·버전·UTF-16 위치·검색 복귀·계정별 저장·백업 형식을 시각 개선 때문에 변경하지 않는다.

## 실행

`npm run dev` 후 검색·원문은 `node scripts/check-life-design.cjs`, 가져오기·발췌·주제는 `node scripts/check-life-collections-design.cjs`로 모의 Auth·익명 자료를 사용해 검토한다. 후속 UX 회귀는 `node tests/life-collections-browser.cjs`이며 기존 기능 검사는 변경 흐름에 맞는 `tests/life-*-browser.cjs`를 실행한다. 같은 화면을 다른 검사 이름으로 반복 캡처하지 않는다. `node scripts/check-social-preview.cjs`는 비교 시안용, `node scripts/check-design-preview.cjs`는 초기 시안용이다. 실제 Supabase에는 접근하지 않는다. 실제 UI의 최신 검증 범위는 `docs/design-review/collections-integration.md`, 첫 통합은 `docs/design-review/integration.md`, 과거 시안 검사는 `docs/design-review/minimal-verification.md`에서 구분한다. 숨긴 필터·출처·발췌를 실제로 열고 닫기/초점 복귀도 확인한다. 시안 검사 전체를 작은 운영 UI 수정의 필수 검사로 과도하게 확장하지 않는다.

보고는 이번에 수행한 기능 검사 / 시각 검토 / 실제 기기 체험 / 배포를 구분한다. 장치 폭만 바꾼 Chromium 결과를 Apple 실기 검증으로 쓰지 않는다.

피드의 간결한 표시와 접힌 출처·관리는 `docs/design-review/feed-refinement.md`와 `node scripts/check-life-feed-design.cjs`를 따른다. 이 집중 검사는 기존 전체 화면 감사와 실행 범위를 구분한다.

앱 표면의 전후 비교는 `docs/design-review/app-feel.md`, 현대 CSS와 오픈소스 선택 근거는 `app-feel-references.md`를 따른다(두 문서는 `docs/design-review/` 아래). 집중 검사는 `node scripts/check-app-feel-design.cjs`와 `node tests/app-feel-browser.cjs`를 사용한다. 플랫폼 검사는 `SITE_DESIGN_OUTPUT`을 새 `.local/` 경로로 지정해 이전 감사 증거를 보존한다. 연표의 공간 표식은 일반 메뉴·폼의 44px 기준과 구분해 실측 및 대체 목록 경로를 남긴다.

직접 글쓰기의 화면 기준은 `docs/design-review/direct-writing.md`다. 제목·본문·작은 저장 조작에 집중하고 글쓰기 중 기록 보조 메뉴를 접는다. 기본 textarea를 재사용하며 입력 중 DOM/value를 다시 설정하지 않는다. 초안 보관과 기록 저장·동기화·공개를 상태 문구에서 구분하고, 초기 로딩·실패·충돌에도 입력과 복구 조작을 보존한다.

재발견은 `docs/design-review/rediscovery.md`를 따른다. 기준·관련 원문·연결 근거를 한 열로 구분하고, 근거 없는 결과를 채우지 않는다. 기존 검색과 exact version 복귀를 유지하며 제외 범위와 복원을 설명한다. 표면 검사는 `node tests/life-rediscovery-browser.cjs`의 익명 한글 자료로 수행한다.

선택 초안의 기기 전환은 `docs/design-review/writing-continuity.md`를 따른다. 이어쓰기 조작은 본문 아래 접고, 원격 알림의 늦은 도착이 현재 stage·입력·초점을 바꾸지 않게 검증한다. 중지한 뒤 기록으로 저장한 글에도 완료 상태 재개 경로를 남긴다. `tests/writing-sync-browser.cjs`와 입력 경합 회귀를 기능/시각 검토에 구분해 사용한다.

로컬 이어 읽기는 [읽기 위치](../../../docs/design-review/reading-resume.md)를 따른다. 홈·기록의 한 행에서만 명시적으로 열고 본문에 추가 상시 UI를 만들지 않는다. `이 브라우저`·이전 버전·없는 버전의 복구 상태를 보존하고, 프로그램 스크롤을 실제 읽기 입력으로 간주하지 않는다.

표현 페이지의 A/B는 `expression-sample.html`과 [비교 결과](../../../docs/design-review/expression-page-comparison.md)에 둔다. 동일 익명 글의 독립 시안이며 운영 기본 배치가 아니다. B의 출처 구분·원문 작성일·본문 펼침은 [실제 비공개 페이지·미리보기](../../../docs/design-review/page-expression-integration.md)에 연결했다. 작성일은 기존 자유 문자열까지 원값을 보존하고 펼침은 항목/버전별 session 메모리에만 둔다. 화면 접힘과 공개 사본 포함 범위를 혼동하지 않고, 펼친 뒤 읽기 영역이 실제 viewport와 교차하는지와 접기 초점 복귀를 확인한다.

공개 화면은 [B 공개 읽기](../../../docs/design-review/public-expression.md)를 따른다. 공유된 문자열만 사용하고 본문 펼침과 공개 동의를 구분한다. 발췌를 다시 자르지 않는다. 출처·작성 관계·누락을 접힘 밖에 두며 같은 revision 재조회·폭 변경의 구절 선택 보존과 철회/실패 시 이전 내용 제거를 함께 검증한다.

기존 출처에 본문을 보완할 때는 [재가져오기](../../../docs/design-review/source-reimport.md)의 입력/검토를 재사용한다. 기존 메모 보관 실패 시 초안을 교체하지 않고, 새 본문의 범위를 이전 full_text에서 승계하지 않는다. 주소·원천·파일 식별 변경과 본문 편집을 구분하고, 자유 형식 날짜가 표시되지 않은 채 저장되지 않도록 확인한다.

회고·책 원고는 [글의 흐름 읽기](../../../docs/design-review/reflection-reading.md)와 [책 설계](../../../docs/life-tools-design/reflection-book.md)를 따른다. 빈 해를 평가하지 않고 작성 시기 미확인과 타인 글을 구분한다. 선택 범위·표시 필터·내보내기 범위를 분리하고 정확 버전·현재 메모·초점 복귀를 보존한다. 아직 없는 AI 분석이나 장별 편집을 완성된 기능처럼 표시하지 않는다.

책 프로젝트의 목차·장 원고는 [책 편집 검토](../../../docs/design-review/book-projects.md)를 따른다. 현재 장만 편집하며 입력 중 DOM을 다시 만들지 않는다. 접힌 목차와 정확 원문 복귀의 초점을 보존하고, 책 기간 메타데이터를 자동 필터로 오인시키지 않는다. 회고·책/장 원고·원문·공개 사본은 별도 의미를 유지한다.

장별 해석은 [생각과 근거](../../../docs/design-review/book-insights.md)를 따른다. 원고와 구분한 사용자 해석이며 AI 결과처럼 표시하지 않는다. 역할별 정확 버전·작성자·확보 범위를 유지하고 제외를 자료 삭제나 전역 분석 제외로 표현하지 않는다. 더보기 뒤 원문 복귀와 한글 조합 중 편집 대상을 바꾸지 않는지 확인한다.

책 전체 읽기는 [읽기·편집 복귀](../../../docs/design-review/book-reading.md)를 따른다. Books.project의 같은 선택 범위를 미리보기와 Markdown에 사용하며 화면은 안전한 평문이다. 본문 옵션과 해석 제외를 보존하고, 저장 실패 때 읽기로 전환하지 않는다. 읽던 문단·펼친 출처·편집 초점은 계정/작업공간의 화면 세션에만 보관하며 영속 독서 이력이나 원고 개정본으로 표시하지 않는다.

[개정본·보관함·인쇄](../../../docs/design-review/book-recovery-print.md)는 본문 밖 접힌 관리에서 조작한다. 복원 전 자동 사본과 용량 거절을 설명하고 보관을 삭제·공개 철회로 표현하지 않는다. 충돌 비교에는 모든 개정본·보관 상태를 포함한다. 인쇄/PDF는 현재 선택 범위만 별도 평문 문서로 만들고 계정 변경 시 취소하며, 대화상자 요청을 파일 저장 성공으로 보고하지 않는다.

[첫 책 작업실](../../../docs/design-review/book-workshop.md)은 회고의 연도/묶음 후보에서 사용자가 명시한 목차로 이어진다. 발췌 주제와 원문 묶음을 합쳐 표시하지 않는다. 후보는 임시, 책은 명시 저장임을 구분하고 원고 점검은 현재 출력 범위의 사실만 보여준다. 여러 시기의 실제 가져오기 UI에서 네 장·개정·복원·PDF까지 이어지는 체험으로 품질을 확인한다.

[독자용 책자](../../../docs/design-review/book-edition.md)는 본문과 끝의 출처 부록을 분리한다. 책자 옵션은 검토용 원문 옵션에서 승계하지 않으며, 해석을 넣으면 불확실성과 역할별 근거도 함께 넣는다. 동일한 HTML로 미리보기·다운로드·인쇄를 만들고, 화면 내용 미리보기와 최종 쪽나눔을 구분한다. Blob 내부 목차·세 화면 폭·선택 가능한 한글 PDF와 장 편집 왕복을 실제 브라우저에서 확인한다.

[장별 자료 가져오기](../../../docs/design-review/book-import-return.md)는 자료 보관과 장 연결을 구분한다. 후보는 기본 미선택이며 대상 장과 정확 버전을 확인한 뒤 명시 연결한다. 저장 실패 시 원문을 다시 가져오거나 삭제하지 않고 연결 초안을 보존한다. 같은 화면에 일반 원문 선택기와 새 연결 검토를 중복 노출하지 않는다.
