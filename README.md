# 해도 — life-haedo

내 생각과 일상을 글로 쓰고, 기록과 취향을 모으는 개인 블로그.
메인은 실제 프로필·짧은 글쓰기·사진과 본문이 이어지는 SNS형 피드를 보여주고, 기존 메모·연표·목표·습관은 자료실과 도구에서 이어 쓴다. 빌드 없이 정적 호스팅에서 실행한다.

[사용 흐름 중심 개편·검수](docs/design-review/blog-user-journeys.md) · [SNS형 UX·UI 설계와 검수](docs/design-review/sns-blog-experience.md) · [블로그 중심 방향과 공개 후속](docs/life-tools-design/blog-platform-direction.md) · [메인 구현·검수](docs/design-review/blog-platform-home.md). 새 글·사진의 브라우저 비공개 보관과 기존 선택 내용의 공개 사본은 다른 범위다.

[글 관리·원본 사진·선택 공개](docs/life-tools-design/blog-completion.md)를 연결했습니다. **설정 → 글 관리**에서 저장 글·초안을 찾고, 한 글씩 내 계정 서버에 비공개 보관하거나 공개할 사진을 골라 게시·갱신·철회합니다. 방문자는 별도 블로그 주소에서 목록과 글을 읽습니다. 원문에서 선택한 구절은 인용 글이나 9칸 구성으로 연결하며 정확한 버전으로 돌아갑니다. 새 인용의 구조화된 근거는 현재 브라우저에 별도로 보관하므로 사진 ZIP·글별 서버 보관에는 포함되지 않습니다.

서버의 비공개 버킷·RPC·원본 사진 Edge는 설치·권한 확인을 마쳤습니다. 이 브랜치의 프런트엔드는 아직 Pages에 배포하지 않았으며, 개인 자료를 시험 게시하지 않았습니다. [운영 설치 기록](docs/life-tools-design/blog-installation.md).

[보관 범위·정확한 근거 파일](docs/design-review/preservation-portability.md): **관리 → 보관 범위·근거 파일**에서 자료별 브라우저·서버·파일 범위를 확인하고, 선택한 저장 글·원본 사진·9칸·필요한 정확 원문 버전을 비공개 ZIP으로 옮깁니다. 파일 내용을 확인한 뒤 현재 로그인한 계정의 새 작업공간에 복원하면 같은 옛 원문 구절과 저장 글 근거를 다시 열 수 있습니다. 계정 미연결 공간의 선택 자료도 원본을 보존한 새 사본으로 가져옵니다. 이 전용 파일은 기존 사진 ZIP·전체 자료 백업·글별 서버 보관과 구분하며 서버 연결·공개를 자동 시작하지 않습니다.

[글 이어쓰기·9칸 초안](docs/design-review/blog-continuity-usability.md): **내 페이지 → 9칸 구성 → 영역 선택 → 선택 영역으로 글쓰기 검토**에서 이미지와 전체 설명·출처를 확인하고 새 비공개 글 초안을 만듭니다. 원래 구성과 개인 메모·인용 근거는 그대로 두며, 서버 보관과 공개는 글에서 따로 선택합니다. 기기 간 글 충돌은 최신 비교를 다시 확인한 뒤 양쪽 사본을 보존하는 방식으로 해결합니다.


[통합 릴리스·여행 글 검수와 배포 준비](docs/life-tools-design/blog-release-integration.md): 완료된 홈·작성기·시각 개편과 원본 보관·선택 공개·정확한 근거 파일을 한 후보에서 검수합니다. 이후 진행 중인 애니메이션은 별도이며, main 병합·서비스 배포·실제 Google/Apple 기기 체험과 구분합니다.

[배포 사이트](https://wonchance-art.github.io/life-haedo/) · 로컬 변경은 배포 전까지 사이트에 반영되지 않는다.

[핵심 경험 품질 기준](docs/design-review/core-experience.md): 읽던 원문에서 `함께 읽을 기록`을 바로 열고 같은 버전·위치로 돌아온다. 내 페이지는 본문·코멘트를 먼저 보여주며 설정은 펼쳐 편집한다. 짧은 지시도 목표·범위·보존·완료 기준으로 구체화하고, 기능 검사·사용 흐름·시각 검토를 나눠 확인한다. 후속 [구성 이어쓰기](docs/life-tools-design/device-continuity.md)는 명시 연결·양쪽 비교·복구 사본까지 구현했다. **신규 운영 SQL 설치와 배포는 대기 중**이며 [관리자 인계](docs/life-tools-design/composition-installation.md)를 따른다. 후속 [선택한 글쓰기 초안 이어쓰기](docs/design-review/writing-continuity.md)도 구현·검증했으며, 두 단계의 [Local 일괄 설치 순서](docs/life-tools-design/continuity-batch-installation.md)를 함께 준비했다.

[첫 책 작업실](docs/design-review/book-workshop.md): 기록 선택 → 회고 → 연도/묶음별 목차 → 장별 집필·개정 → 전체 점검 → PDF로 이어집니다. 선행 기능과 함께 Local 병합·운영 적용을 기다리는 브랜치 구현이며, 배포 사이트의 현재 기능으로 단정하지 않습니다.

[원고 중심 A안](docs/design-review/book-design-reset-integration.md): 비교 후 선택한 디자인을 실제 책 목록·집필·읽기에 적용했습니다. 원고를 앞세우고 목차·근거·관리는 펼쳐 사용합니다. 실제 앱 화면·기능 검증과 Local 인계는 연결 문서에서 확인할 수 있으며, 병합·배포와는 구분합니다.

[회고에서 목차로](docs/design-review/reflection-to-outline.md): 선택한 글의 앞부분을 읽고 현재 생각을 쓰며, 읽던 자료와 목차 후보로 돌아오는 흐름을 같은 A안으로 연결했습니다. 별도 후속 브랜치이며 Local의 통합·배포를 기다립니다.

[독자용 책자](docs/design-review/book-edition.md): 책 전체를 표지·목차·본문·출처 부록으로 읽고, 장을 고쳐 다시 확인한 뒤 A5/A4 HTML·PDF로 받습니다. 기존 검토용 출력은 유지하며 해석과 원문 본문은 각각 선택합니다.

[저장한 책으로 돌아오기](docs/design-review/book-completion.md): 홈에서 책과 목차를 찾고 원하는 장으로 바로 들어가 수정·출력합니다. 복원 전 책·장·개정본도 확인합니다.

[장에 자료 가져오기](docs/design-review/book-import-return.md): 집필 중 자료를 가져와 정확한 원문 버전을 고르고, 같은 장에 명시 연결한 뒤 원고로 돌아옵니다. 자료 보관과 장 연결은 별도 저장입니다.

[복원한 책으로 이어가기](docs/design-review/book-restore-entry.md): 통합 백업의 책 목록을 바로 열어 장을 선택하고 수정·출력합니다. 보관한 책과 기존 작업공간은 그대로 유지합니다.

전체 화면의 최신 디자인은 [Life 기준 사이트 재구성](docs/design-review/life-design-site.md)을 따른다.

후속 [자료 보관·복원·동기화](docs/design-review/life-management.md)는 JSON 내용 미리보기·새 사본 복원·이전 공간 복귀, 상태별 동기화 행동과 실패 복구를 정리한다. 연표 값과 계산은 유지한다.

[웹 글·출처 가져오기](docs/design-review/social-import.md)는 네이버 블로그·Instagram 링크의 원천 설정 제안, 복사한 본문·포함 범위 검토, 출처 주소 대조를 제공한다. 링크만으로 본문·사진·영상을 수집하지 않는다.

[첫 접속 홈과 기록 통합](docs/design-review/home-entry-proposal.md)은 최근 기록·묶음·내 페이지 요약을 현재 작업공간에서 보여준다. 묶음과 페이지 구성의 저장·이어쓰기·선택 공개는 글별 서버 보관과 별도다.

[기록 정리](docs/design-review/record-to-page.md): 기록의 체크 아이콘으로 여러 원문을 고른 뒤 묶음/내 페이지에 담는다. 읽던 원문은 연결 아이콘으로 바로 전달한다. 다음 화면에서 버전과 담을 곳을 확인하며 선택·취소만으로 저장하지 않는다.

앞선 [통합 홈과 검증](docs/design-review/unified-home.md)은 자료·연표를 기록에 묶고 목표·습관은 도구, 계정·동기화·백업은 관리에 배치한다.

자료 화면은 승인된 본문 중심 한 열과 A 인용 아이콘을 [실제 검색·원문·발췌 저장](docs/design-review/integration.md)에 연결했다. 후속으로 [가져오기·내 발췌·주제 모음](docs/design-review/collections-integration.md)도 정리하고 로컬 검증을 마쳤다. 최신 [피드 마감과 검증](docs/design-review/feed-refinement.md), [PR #20의 공개 적용 결과](https://github.com/wonchance-art/life-haedo/pull/20)를 함께 확인한다. `social-sample.html`과 `design-sample.html`은 저장 기능에 연결하지 않은 [이전 비교 시안](docs/design-review/README.md)이며 후속 화면 개발은 [DESIGN.md](DESIGN.md)를 따른다.

## 사용

1. 홈에서 Google 로그인하면 최근 기록과 각 기능 진입이 보인다. 기록을 누르면 원문과 저장한 문장·메모를 함께 볼 수 있다. 기록 상단의 연표 아이콘 → 연표 목록 → `새 연표`에서 이름과 기준 날짜를 입력한다. 목표·습관은 도구, 계정·백업·동기화는 관리에서 연다.
2. `＋ 추가`로 사건·기간·생각을 추가한다. 입력을 마치거나 `완료`를 누르면 기기에 저장된다.
3. `기록`에서 제목·내용·날짜와 종류로 찾고 편집한다. `⌘/Ctrl+K`로 전체 검색도 가능하다.
4. `파일 → 전체 문서 백업`으로 JSON을 보관한다. 가져오기는 항상 **새 사본**을 만든다.

- 행복도는 −1~+1. 같은 달의 사건·명시적 값은 평균을 내고, 기록이 없는 달은 기간 값으로 채운다.
- 연표에서 드래그·확대·기간 조절, 실행 취소/다시 실행, 지도·생애 격자, PNG/SVG 내보내기를 지원한다.
- 데이터는 브라우저 localStorage에 저장된다. 저장 상태는 상단에 표시된다. 브라우저 데이터 삭제에 대비해 파일 백업을 보관한다.
- 로그인은 공용 Supabase SDK의 Google OAuth·PKCE를 사용한다. 사용자가 별도 DB 키나 비밀번호를 입력하지 않는다. 운영 Google 제공자·콜백 등록과 Mac Comet에서의 실제 로그인·개인 화면 복귀를 확인했다. 공용 인증 PR #17은 병합되었으며 사용자의 정상 작동 확인을 받은 기반이다. 이번 디자인 검증과 이전 인증 검증은 구분한다.
- 계정 간 서버 접근은 RLS, 기기 자료 노출은 계정별 저장과 화면 보호로 제한한다. 기존 무소유 연표는 원본 백업·본인 확인 후 새 계정 사본으로 연결한다.
- [기존 연표 찾기·연결 재시도](docs/timeline-recovery.md): 빈 목록에서 기기 원본 연결과 JSON 백업 가져오기를 찾고, 서버 저장 실패 뒤 같은 사본으로 재시도한다. 실제 개인 연표의 복구 여부와 앱 개선을 구분한다.

## 자료 모아보기

기존 메모·글을 가져와 필요한 구절과 출처를 주제로 모으는 개인 도구다. [통합 홈](index.html)의 기록에서 연다. 기존 [life.html](life.html) 주소도 유지한다.

[직접 글쓰기](docs/design-review/direct-writing.md): 홈·기록의 연필 아이콘에서 제목과 본문을 쓰고 기록으로 저장한다. 초안은 이 브라우저에서 이어 쓰며, 저장한 글은 검색·발췌·묶음·내 페이지 선택에 사용할 수 있다. 수정은 새 본문 버전을 만들고 기존 발췌를 보존한다. 초안은 TXT로, 저장한 글은 기존 자료 백업으로 옮긴다.

[앱 표면 개선](docs/design-review/app-feel.md)은 옅은 색상·공통 탐색·검색 조작과 모바일 하단 편집 시트를 적용한다. 본문·원문 출처와 기존 기능은 유지하며 화면 크기 검증과 실제 기기 체험을 구분한다.

[선택한 페이지 공개](docs/design-review/page-publication.md)는 별도 사본의 게시·갱신·철회와 로그인 없는 방문 화면, 다른 기기에서도 접근하는 소유자 관리 목록을 구현한다. 운영 설치·배포 상태는 해당 기록을 따른다. 구성 동기화와 공개 게시를 구분하며, 초안 편집만으로 공개본을 바꾸지 않는다.

[영역별 최소 동작](docs/life-tools-design/working-sections.md): 기록의 `묶음`에서 원문을 묶고, `내 페이지`에서 보여줄 부분과 메모를 골라 비공개로 미리 본다. 도구의 [다시 찾기](docs/design-review/rediscovery.md)는 정확 검색과 기준 기록의 관련 자료 최대 3개·근거·제외/복원을 제공한다. 선택 자료 `회고`도 유지한다. 새 구성은 우선 이 브라우저·계정·작업공간에 저장된다. 기존 원문 동기화와 별개로 연결하는 [구성 이어쓰기](docs/life-tools-design/device-continuity.md)의 운영 준비 전에는 관리의 `자료·구성 백업`으로 다른 기기에 새 사본을 옮긴다. SNS 자동 연결·공개 게시·AI 분석 기능은 아니다.

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
| `assets/haedo-navigation.js`, `assets/haedo-shell.css` | 홈·기록·도구·관리 공통 탐색과 화면 스타일 |
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

### 컬렉션 보관함

로그인 후 기록 → 컬렉션, 또는 `index.html?section=records&view=collection`에서 직접 입력·검색·수정·보관·전용 백업/사본 복구를 사용합니다. 이 브라우저의 계정·작업공간별 저장이며 자동 동기화·공개는 미연결입니다. [검증 증거와 Local 인계](docs/design-review/collection-library.md).

컬렉션 출처 주소의 **주소로 정보 확인**에서 GitHub 저장소/YouTube 영상의 후보를 검토하고 선택한 제목·주소·종류만 입력에 적용할 수 있습니다. 저장은 별도이며 개인 메모·만든 사람은 자동 변경하지 않습니다. GitHub는 실제 브라우저 조회 확인, YouTube는 환경 네트워크 제한으로 모의 응답 검증까지입니다. [검증·Local 인계](docs/design-review/collection-metadata.md)를 참고하세요. 표지·임베드·기기 간 동기화는 이번 범위가 아닙니다.

컬렉션의 **외부 이미지 보기**는 책(Open Library ISBN/edition)·영상(YouTube)의 표지/썸네일을 선택적으로 표시합니다. 책 편집의 **표지·썸네일**에서 ISBN을 출처로 연결할 수 있으며 저장·백업 형식은 그대로입니다. 외부 이미지는 기본 꺼짐이고 파일로 백업하지 않습니다. [검증 화면·제공자 접속 제한·Local 인계](docs/design-review/collection-covers.md). 현재 Cloud 검증은 이미지 응답 fixture 기준이며 실제 제공자 접속은 네트워크 설정 또는 Local 검증이 필요합니다.

컬렉션 `+`는 **찾기 → 선택 → 메모 → 저장**으로 이어집니다. 이름은 내 컬렉션에서 찾고, YouTube·GitHub는 링크를 명시 조회합니다. 기존 항목은 메모를 이어 쓰고 신규 후보는 정보를 확인한 뒤 저장합니다. [화면·검증·Local 인계](docs/design-review/collection-picker.md). 외부 음악/장소 이름 검색과 글·프로필 첨부는 후속입니다.

### Obsidian 보관함 전체 가져오기

깨끗한 Git 보관함은 `node scripts/import-obsidian-vault.mjs --vault /private/vault --output /private/new-export --repository https://github.com/OWNER/REPO`로 변환합니다. 모든 Markdown과 보조 파일을 각각 `notes.json`·`supporting-files.json`에 보존하고, 전체 Git 이력·해시/미해결 참조 목록도 남깁니다. `review.html`·`review.json`은 판단할 노트와 첨부/외부 주소/보조 파일 안내를 구분하고 중복 참조를 묶습니다. 개인 출력은 앱 저장소 밖에만 생성합니다. 로그인 후 관리의 내보내기·사본 복원에서 JSON을 새 작업공간으로 복원하세요. [범위·보존·사용 순서·한계](docs/design-review/obsidian-vault-integration.md).

`review-tool.html`에서는 같은 폴더의 변환 파일 6개를 선택해 원문/후보를 비교하고, 참조별 선택 저장·재열기 → 변경 미리보기 → 새 사본 ZIP을 사용할 수 있습니다. 기존 패키지에는 `node scripts/create-obsidian-review-tool.mjs --output /private/review-tool.html`로 도구만 추가하세요. CLI의 `node scripts/apply-obsidian-decisions.mjs --input PATH --decisions FILE --preview`는 검증·집계만, `--output NEW_PRIVATE_PATH`는 별도 새 패키지를 만듭니다. 실제 연결은 명시 선택만 반영하며 원문과 기존 작업공간을 유지합니다. [사용 순서·보존·검수](docs/design-review/obsidian-decisions.md).

변환기는 `vault-package.zip`도 만듭니다. 관리 → 내보내기·사본 복원의 **Obsidian 패키지에서 복원**에서 이 ZIP 또는 검토 도구의 새 사본 ZIP을 그대로 선택하세요. 노트와 선택한 보조 파일 공간을 한 번에 새 사본으로 복원하며 저장 실패 시 둘 다 반영하지 않습니다. 검토 도구도 ZIP 직접 열기를 지원합니다. [ZIP 검토·동시 복원·기존 공간 보존](docs/design-review/obsidian-package.md). [서버 받기·정확 위치·검색 복귀 품질 검수](docs/design-review/obsidian-hardening.md). 로컬 브라우저 검사는 `BASE_URL=http://127.0.0.1:4173`을 명시하면 `npm run dev`와 주소를 맞출 수 있습니다.
