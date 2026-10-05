# 네이버 블로그·Instagram 글과 출처 가져오기

2026-10-05 · 사용자가 선택한 다음 원천의 입력 편의를 개선했다. 비교 기준은 PR #23 병합본 `c74e8ed` / 서비스워커 v59다. 이번 단위는 **링크와 사용자가 복사한 본문을 함께 검토·보관**하는 흐름이다. 외부 게시물 자동 수집·사진 저장·계정 연결은 포함하지 않는다.

## 실제 흐름과 보존

가져오기 → 원문 링크 붙여넣기 → ‘네이버 블로그로 설정’ 또는 ‘Instagram으로 설정’ → 제목·복사한 본문 → 포함 범위 → 원문·출처 확인 → 자료 또는 발췌 보관.

- 링크를 본문 앞에 두었다. 정확한 네 호스트(`blog.naver.com`, `m.blog.naver.com`, `instagram.com`, `www.instagram.com`)만 출처를 제안한다. 원천은 명시적으로 누를 때만 바뀌며 기존 제목·본문·작성자·범위는 유지한다. 제안 적용 뒤 초점은 원천 선택으로 돌아간다.
- 주소의 실제 존재·게시물 공개 여부·본문 일치를 확인한 제안은 아니다. 단축 링크를 확장하거나 다른 서비스로 요청하지 않는다. URL의 query/hash·대소문자는 기존 저장 규칙에 따라 양끝 공백만 제외하고 보존한다. 원문 읽기와 검토의 접힌 출처에는 실제 URL 문자열도 표시한다.
- 소셜 글에 본문이 있으면 포함 범위를 접힌 상세 밖에서 확인한다. 붙여넣었다고 전체 글로 자동 확정하지 않는다. 본문이 없으면 링크만 보관하며 본문·해시를 만들지 않는다. 사진·영상 미보관은 입력과 검토에 표시하고 작성자·날짜·누락 항목은 필요할 때 펼친다.
- 가져오는 방법은 접힌 도움말로 아래에 둔다. 복사할 수 없는 게시물은 링크만 보관하는 기존 경로로 마칠 수 있다. 제목·작성자·작성 시각을 주소나 본문에서 추정해 채우지 않는다.
- 원문 텍스트·CRLF 파일·emoji·UTF-16 구절, 기존 검토 초안·원문 버전·JSON 사본 복원·계정 격리를 유지한다. URL 제안은 초안 입력 편의이며 자료 확정이나 동기화 시작이 아니다. 연표 값·계산·저장 엔진·SQL은 변경하지 않았다.

## 디자인과 근거

root가 디자인·UI·통합을 맡고 source_research가 공식 근거, import_contract가 저장 계약을 독립 검토했다. social_tests는 브라우저 기능 검사를, social_visual은 시각 검토를 맡았다. 기존 한 열·공통 폼·details·아이콘·버튼을 재사용하며 새 라이브러리는 추가하지 않았다. [Impeccable 4.5.0 프로젝트 지침](impeccable.md)의 Operate 기준과 [공통 디자인](../../DESIGN.md)을 따른다.

[공식 도구·오픈소스 비교](../life-tools-design/open-source-review.md#네이버-블로그instagram-글과-출처-입력-개선)에서 native URL과 기존 평문 흐름을 선택했다. Readability 0.6.0의 라이선스·게시 정보·보안 권고를 재확인했지만 이미 확보한 HTML의 추출 도구라 이번에 추가하지 않았다. 네이버·Meta 공식 API·도움말은 이 환경의 프록시 403으로 현행 조건을 확인하지 못했다. 접근 실패를 기능 부재로 해석하거나 URL만으로 수집할 수 있다고 가정하지 않는다.

## 검증

같은 익명 한글 글·긴 제목·예시 링크로 전후 화면을 비교했다. 1440·820·390px에서 빈 입력, 부분 본문, 링크만, 검토, 출처 상세, 잘못된 URL, 저장중과 접힌 도움말을 확인했다. 최신 UI **30장면·162항목 통과**, 최소 텍스트 대비 6.05:1, 초점 3px·7.286:1이다. 가로 넘침·44px 미만 조작·16px 미만 입력·이름 없는 조작은 0개다. 직접 이미지 검토에서 본문 앞 도움말을 아래로 옮기고 긴 URL 줄바꿈을 확인했다. 이전 v59의 27장면·141항목과 변경 후 30장면의 검사는 별도 집계한다.

| 장면 | 이전 | 변경 후 |
| --- | --- | --- |
| 블로그 본문 · 1440px | [이전](evidence/social-import/before-partial-desktop.png) | [변경](evidence/social-import/after-partial-desktop.png) |
| 블로그 본문 · 820px | [이전](evidence/social-import/before-partial-tablet.png) | [변경](evidence/social-import/after-partial-tablet.png) |
| 블로그 본문 · 390px | [이전](evidence/social-import/before-partial-phone.png) | [변경](evidence/social-import/after-partial-phone.png) |
| 포함 범위 · 390px | [이전](evidence/social-import/before-scope-phone.png) | [변경](evidence/social-import/after-scope-phone.png) |
| Instagram 링크만 · 390px | [이전](evidence/social-import/before-link-phone.png) | [변경](evidence/social-import/after-link-phone.png) |
| 검토 · 1440px | [이전](evidence/social-import/before-review-desktop.png) | [변경](evidence/social-import/after-review-desktop.png) |
| 출처 주소 대조 · 390px | [이전](evidence/social-import/before-review-details-phone.png) | [변경](evidence/social-import/after-review-details-phone.png) |
| URL 오류 · 390px | [이전](evidence/social-import/before-invalid-phone.png) | [변경](evidence/social-import/after-invalid-phone.png) |

기능 검사는 익명 Auth HTTP, 실제 동봉 SDK·DOM·IndexedDB를 사용했다. 원격 게시물 요청과 운영 Supabase 쓰기는 0건이다.

| 검사 | 결과 |
| --- | --- |
| 정적 | HTML 16 / JS 34 / 참조 186 / PWA 통과 |
| Node | 188/188 통과 |
| 새 소셜 입력 | 9/9 통과. 호스트·유사 주소·명시 적용·수동 선택·오류 복구·정확한 발췌·JSON 복원·초안 재개 |
| 기존 자료 / 여러 파일 / 모음 입력 | 23/23 · 8/8 · 6/6 통과 |
| 공용 SDK·PWA | 9/9 통과. v59 → v60의 원자 업데이트와 기존 자료·초안 보존 포함 |
| 브라우저 합계 | 55개, 중복 재실행을 합산하지 않음. 예기치 않은 console/pageerror 0 |

재현: `npm run check`, `npm test`, `node tests/life-social-import-browser.cjs`, `node scripts/check-life-social-design.cjs`. 로컬 개발 서버와 설치된 Playwright/Chromium을 사용하며 실제 운영 자격 증명을 사용하지 않는다. 새 검사에서 발견한 ‘네이버 블로그으로’ 조사 오류를 고쳤다. 저장중 장면의 frozen API 대입이 무시되는 검사기 문제는 실제 IDB put 지연으로 수정했으며 앱 오류나 통과로 계산하지 않았다.

실제 Mac·iPad·iPhone의 복사 메뉴·한글 IME·선택 손잡이·앱 전환·Files는 미검증이다. 화면 폭과 터치 모사는 실제 기기 검증이 아니다. 실제 게시물 본문이나 Google 로그인도 이번에 검증하지 않았다.

직접 체험: [해도](https://wonchance-art.github.io/life-haedo/)에서 가져오기를 열고 게시물 링크·복사 가능한 짧은 본문을 넣는다. 출처·포함 범위를 확인해 발췌한 뒤 원문과 JSON 사본을 대조한다. 실제 복사가 막히거나 이미지 글자·전체 글 수집이 필요했던 사례를 다음 형식/API 검토의 기준으로 삼는다. LPE 연결은 계속 보류한다.
