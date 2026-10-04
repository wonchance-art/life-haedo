# 해도 — life-haedo

기존 메모·글의 자료 모아보기와 개인 연표·목표·습관을 함께 사용하는 생활 도구.
한 홈에서 기록·도구·관리를 오가며, 빌드 없이 정적 호스팅에서 실행한다.

[배포 사이트](https://wonchance-art.github.io/life-haedo/) · 로컬 변경은 배포 전까지 사이트에 반영되지 않는다.

전체 화면의 최신 디자인은 [Life 기준 사이트 재구성](docs/design-review/life-design-site.md)을 따른다.

앞선 [통합 홈과 검증](docs/design-review/unified-home.md)은 자료·연표를 기록에 묶고 목표·습관은 도구, 계정·동기화·백업은 관리에 배치한다.

자료 화면은 승인된 본문 중심 한 열과 A 인용 아이콘을 [실제 검색·원문·발췌 저장](docs/design-review/integration.md)에 연결했다. 후속으로 [가져오기·내 발췌·주제 모음](docs/design-review/collections-integration.md)도 정리하고 로컬 검증을 마쳤다. 최신 [피드 마감과 검증](docs/design-review/feed-refinement.md), [PR #20의 공개 적용 결과](https://github.com/wonchance-art/life-haedo/pull/20)를 함께 확인한다. `social-sample.html`과 `design-sample.html`은 저장 기능에 연결하지 않은 [이전 비교 시안](docs/design-review/README.md)이며 후속 화면 개발은 [DESIGN.md](DESIGN.md)를 따른다.

## 사용

1. 홈에서 Google 로그인하면 기록 피드가 열린다. 기록 상단의 연표 아이콘 → 연표 목록 → `새 연표`에서 이름과 기준 날짜를 입력한다. 목표·습관은 도구, 계정·백업·동기화는 관리에서 연다.
2. `＋ 추가`로 사건·기간·생각을 추가한다. 입력을 마치거나 `완료`를 누르면 기기에 저장된다.
3. `기록`에서 제목·내용·날짜와 종류로 찾고 편집한다. `⌘/Ctrl+K`로 전체 검색도 가능하다.
4. `파일 → 전체 문서 백업`으로 JSON을 보관한다. 가져오기는 항상 **새 사본**을 만든다.

- 행복도는 −1~+1. 같은 달의 사건·명시적 값은 평균을 내고, 기록이 없는 달은 기간 값으로 채운다.
- 연표에서 드래그·확대·기간 조절, 실행 취소/다시 실행, 지도·생애 격자, PNG/SVG 내보내기를 지원한다.
- 데이터는 브라우저 localStorage에 저장된다. 저장 상태는 상단에 표시된다. 브라우저 데이터 삭제에 대비해 파일 백업을 보관한다.
- 로그인은 공용 Supabase SDK의 Google OAuth·PKCE를 사용한다. 사용자가 별도 DB 키나 비밀번호를 입력하지 않는다. 운영 Google 제공자·콜백 등록과 Mac Comet에서의 실제 로그인·개인 화면 복귀를 확인했다. 공용 인증 PR #17은 병합되었으며 사용자의 정상 작동 확인을 받은 기반이다. 이번 디자인 검증과 이전 인증 검증은 구분한다.
- 계정 간 서버 접근은 RLS, 기기 자료 노출은 계정별 저장과 화면 보호로 제한한다. 기존 무소유 연표는 원본 백업·본인 확인 후 새 계정 사본으로 연결한다.

## 자료 모아보기

기존 메모·글을 가져와 필요한 구절과 출처를 주제로 모으는 개인 도구다. [통합 홈](index.html)의 기록에서 연다. 기존 [life.html](life.html) 주소도 유지한다.

1. `가져오기`에서 Apple 메모·Obsidian·네이버 블로그·인스타그램 등 원천을 고르고 본문, UTF-8 `.txt`/`.md` 파일 또는 링크를 제공한다.
2. 받은 원문과 누락 범위를 확인한다. `자료만 보관`으로 끝내거나 필요한 구절을 선택해 주제와 보완 메모를 붙인다.
3. 모음에서 발췌를 열면 보관한 원문 구간을 확인할 수 있다. 링크만 있는 자료는 본문 미확보로 남는다.
4. JSON 백업에는 보관한 원문·발췌·출처를 포함한다. 복원은 새 작업공간 사본을 만든다. Markdown 내보내기는 읽기·재사용용이다.

- 선택한 여러 텍스트·Markdown 파일의 검토 단위는 로컬 구현·검증을 완료했다. `가져오기 → 여러 텍스트 파일 가져오기`에서 최대 10개·파일당 1 MiB·선택 합계 5 MiB를 로컬 초안으로 받고 한 파일씩 확인·확정한다. 파일 선택만으로 원문을 확정하거나 동기화를 새로 시작하지 않는다. [이번 단위의 흐름·실패 재개·직접 확인](docs/life-tools-design/r2-implementation.md)을 따른다.
- 일치한 원문 버전을 열고 발췌한 뒤 검색 목록으로 돌아오는 단위도 로컬 구현·검증을 완료했다. `원천 기록`에서 검색하면 버전별 문맥을 확인해 `자료 읽기`로 열고, `검색 결과로 돌아가기`로 조건을 유지한다. 과거 버전에만 있는 구절을 최신 버전으로 대신 열지 않으며 제목 일치와 본문 일치를 구분한다. [검색 체험·지원 한계·검증 결과](docs/life-tools-design/r2-search.md)를 참고한다.
- 새 자료는 이 브라우저의 IndexedDB에 저장된다. 기존 연표 localStorage·Supabase `charts`와 별도다.
- Mac·iPad·iPhone에서 이어 쓰려면 `기기 간 동기화`에서 올릴 작업공간의 동기화를 시작한다. 다른 기기는 같은 계정의 서버 목록에서 받는다. 공용 로그인만으로 미연결 자료를 올리지 않는다. 해도 프로젝트의 [SQL 설치와 HTTP 검증](docs/life-tools-design/local-handoff-verification.md)은 완료했다.
- 계정이 달라지면 이전 계정의 목록·본문·초안을 닫는다. 기존 무소유 자료는 직접 선택해 새 ID의 계정 사본으로 가져오며 원본을 유지한다. 계정 연결 정보는 백업에 넣지 않는다.
- 양쪽 변경이 충돌하면 비교 후 선택하고 다른 쪽은 새 로컬 사본으로 보관한다. 오프라인 편집과 전송 대기는 브라우저에 남으므로 데이터 삭제 전 JSON 백업이 필요하다. 백업 파일 복원은 새 사본이며 기존 공간과 자동 연결하지 않는다.
- 미디어·PDF·OCR·계정 전체 내보내기·자동 웹 수집·AI 추출은 현재 입력 지원 범위에 포함하지 않는다. 텍스트 파일은 한 건당 1 MiB까지 받는다.
- Apple 메모의 공식 파일 내보내기 지원을 뜻하지 않는다. Obsidian YAML·위키 링크·미디어 참조는 문자로 보관하며 해석·연결·첨부 수집을 실행하지 않는다. 파일 수정 시각을 원작성일로 대신하지 않는다.
- 개인 브라우저 프로필에서 사용한다. 로컬 저장은 암호화·기기 잠금이나 별도 백업을 뜻하지 않는다. 브라우저 데이터를 지우기 전에 실제 백업 파일을 보관한다.
- 새 자료 화면은 연표 편집 엔진과 외부 지도를 로드하지 않는다. 파일 내용·Markdown은 실행하지 않고 받은 텍스트로 표시한다.
- 개인 공간의 `연표·목표·습관 백업`과 자료 화면의 `자료 JSON 백업`은 별도 형식이다. 각 화면에서 복원하며 서로의 자료를 포함한다고 표시하지 않는다.
- 자료 백업·읽기용 Markdown에는 확정한 자료만 들어가며 검토 초안·파일 선택 목록·실패/미읽기 항목·전송 대기 요청·계정 연결은 제외된다. 새로고침으로 재개할 수 있는 것은 같은 브라우저·계정·작업공간에 저장된 검토와 결과이며, 저장되지 않은 파일은 다시 선택해야 한다.

현재 화면·인증·자료 경계는 [공용 인증·자료 통합 기록](docs/supabase-integration.md)을 따른다. 이전 단계의 구현·검증은 [R1 로컬 구현](docs/life-tools-design/r1-implementation.md)과 [R3 개인 동기화](docs/life-tools-design/r3-implementation.md)에 남아 있다.

## 로컬 실행과 검사

Node.js 20 이상과 Python 3이 필요하다. 앱용 패키지 설치와 빌드는 없다.

```sh
npm run check
npm test
npm run dev
```

`http://127.0.0.1:4173`에서 확인한다. 서버 종료는 실행 터미널에서 `Ctrl+C`.
Node 없이 화면만 실행하려면 `python3 scripts/dev-server.py`. 이 서버는 OAuth 콜백 쿼리를 로그에 남기지 않는다.
공개 홈은 설정 없이 열린다. 개인 화면은 [공용 인증 설정](docs/platform.md)이 필요하며, 저장소의 빈 설정을 실제 연결 완료로 취급하지 않는다.

로컬 주소와 배포 사이트는 저장 공간이 다르다. 개발 시 익명 샘플을 사용하며 개인 기록·DB 설정은 자동으로 옮겨오지 않는다.
지도·장소 검색·폰트는 외부 서비스에 의존한다. 이미 검증해 열린 화면은 오프라인 편집을 보존한다. 개인 화면을 처음 열거나 새로고침하면 서버에서 계정을 다시 확인해야 한다.

- `npm run check`: JavaScript 구문, 로컬 리소스와 PWA 셸.
- `npm test`: 날짜·데이터 보존·동기화 충돌·서비스워커 회귀 검사.
- 실제 편집과 모바일 화면은 프로젝트 스킬의 격리 브라우저 절차로 검증한다.
- 이전 기능 통합 검사에서 여러 파일 검토와 정확한 원문 검색을 포함해 Node 181개·브라우저 60개가 통과했다. 별도 관리자 검증에서 실제 Mac Comet의 Google 로그인·개인 공간 새로고침·자료 화면 진입을 확인했다. iPad/iPhone·한글 IME·Files 제공자는 미검증이다. 해당 기능 PR #17/#19는 병합되었으며 이번 디자인 변경의 검증과 적용 상태는 [최신 기록](docs/design-review/feed-refinement.md)을 따른다. [통합 검증의 환경과 한계](docs/supabase-integration.md#실제-로그인-확인과-남은-외부-항목), [검색 단위의 검사별 결과와 한계](docs/life-tools-design/r2-search.md#검증-상태)를 참고한다.
- `main` 푸시는 GitHub Pages 배포로 이어진다.

## 코드와 작업 지침

| 경로 | 역할 |
| --- | --- |
| `index.html`, `login.html`, `workspace.html` | 통합 홈·Google 로그인·연표 목록/관리 |
| `assets/haedo-navigation.js`, `assets/haedo-shell.css` | 기록·도구·관리 공통 탐색과 화면 스타일 |
| `timeline.html`, `goals.html`, `habits.html` | 계정별 연표·목표·습관 |
| `assets/platform-*.js` | 공용 인증·계정 저장·플랫폼 화면·자료 원격 어댑터 |
| `assets/app.css` | 테마·그래프·반응형 레이아웃 |
| `assets/app.js` | 연표 계산·렌더링·편집·로컬 저장·지도·클라우드 연결 |
| `assets/data.js` | 달력 검증·데이터 정규화·안전한 가져오기 |
| `assets/sync.js` | 문서별 전송 큐·조건부 원격 쓰기 |
| `assets/workspace.js` | 기록 보기·파일 메뉴·모달 포커스 |
| `life.html`, `assets/life/` | 자료 가져오기·원문/발췌·모음·새 로컬 저장·백업 사본 복원 |
| `vendor/idb/` | 버전 고정한 IndexedDB 래퍼와 ISC 고지 |
| `vendor/supabase/` | 버전 고정한 공식 Supabase SDK와 MIT 고지 |
| `supabase/migrations/` | 새 생활 자료의 소유자 권한·CAS 동기화 SQL |
| `sw.js` | 버전별 오프라인 앱 셸 |
| `tests/` | Node 표준 테스트 러너를 사용하는 회귀 검사 |

- [AGENTS.md](AGENTS.md): Claude/Codex 공통 규칙
- [프로젝트 스킬](.agents/skills/life-haedo-dev/SKILL.md): 실행·검증 절차
- [현재 구조와 과거 설계](docs/architecture.md)
- [GPT-6 설정 조사](docs/codex-setup.md)
- [이번 리뷰와 변경 기록](docs/review-update.md)

스크러버·검색 등 일부 UX 패턴은 [Timelines Studio](https://github.com/sreegjl/timelines)(GPL-3.0)에서 착안해 독자 구현했다.
