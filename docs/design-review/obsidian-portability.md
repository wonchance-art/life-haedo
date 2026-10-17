# Obsidian 오프라인 변환·선택·복원 왕복

2026-10-17 KST. [수신·읽기 품질 묶음](obsidian-hardening.md) 다음 작업이다. 다른 세션이 블로그 메인과 작성 진입을 진행하므로 별도 worktree·브랜치에서 오프라인 파일 경로만 수정했다. 여섯 담당이 원문 스캐너, 개인 파일 경계, Git 변환 CLI, 선택 적용 CLI, 보고서, 독립 통합 검수를 나눴다.

## 사용 흐름과 결과

**Git 원본 → 변환 패키지 → 명시 연결 선택 → 새 ZIP → 기존 앱 복원**을 한 흐름으로 검증한다. 두 CLI는 계정/DB/네트워크를 사용하지 않으며, 개인 원문과 기존 출력은 덮어쓰지 않는다.

```sh
node scripts/import-obsidian-vault.mjs \
  --vault /private/path/to/git-vault \
  --output /private/path/to/new-original-package \
  --repository https://github.com/OWNER/REPO

node scripts/apply-obsidian-decisions.mjs \
  --input /private/path/to/new-original-package \
  --decisions /private/path/to/decisions.json --preview

node scripts/apply-obsidian-decisions.mjs \
  --input /private/path/to/new-original-package \
  --decisions /private/path/to/decisions.json \
  --output /private/path/to/new-reviewed-package
```

선택 파일은 기존 단독 검토 도구에서 참조별로 명시 선택해 만든다. 두 출력 폴더의 `vault-package.zip` 모두 앱의 관리 → 내보내기·사본 복원 → Obsidian 패키지에서 복원에 직접 제공할 수 있다. 새 사본이며 현재 공간을 갱신하거나 계정에 자동 설치하지 않는다. 예시 경로는 실제 개인 자료가 아니다.

변환 결과는 필수 여섯 파일과 검토 도구·ZIP이다. 선택 적용 결과는 이 파일들에 `decisions.json`, `applications.json`이 추가된 총 열 파일이며, ZIP 내부는 ZIP 자신을 제외한 아홉 파일이다. 재적용은 기존 연결을 중복하지 않고 별도 이력을 남긴다. 원래 여섯 파일만 있는 패키지도 지원하며 없던 단독 도구는 기존 생성기로 만든다. 이미 있는 도구·보고서·Git bundle은 실행하지 않고 불투명한 바이트로 보존한다.

## 재현된 문제와 수정

| 경계 | 재현과 수정 |
| --- | --- |
| Git 원본 고정 | 이전에는 clean 확인 후 checkout을 읽어 ignored 파일과 중간 checkout 변경이 섞였다. 이제 처음 고정한 commit의 tree/blob을 읽는다. 상속 `GIT_*`가 다른 저장소를 선택하지 못하게 격리한다. Git 루트 하위 폴더 입력은 범위를 넓히지 않고 거부한다. |
| Git 이력 | 모든 refs의 bundle과 처음 고정한 commit을 함께 보존한다. detached HEAD가 중간에 다른 이력으로 바뀌어 원래 commit이 refs에서 사라져도 bundle에서 복구할 수 있다. 원본 refs·index·본문은 쓰지 않는다. |
| 큰 경로 목록 | Git tree는 NUL 구분과 엄격 UTF-8로 읽고 앞 BOM도 유지한다. 64MiB 목록 한도를 명시하며 각 blob은 읽기 전에 기존 1MiB 파일 한도를 검사한다. blob은 한 번의 batch로 읽는다. |
| 출력 실패 | bundle·JSON·ZIP을 준비한 뒤 새 출력만 소유해 저장한다. 늦은 파일 쓰기가 실패해도 그 출력만 정리한다. 기존 빈 폴더도 덮어쓰지 않으며, 다른 프로세스가 대체한 폴더는 삭제하지 않는다. |
| 개인 경로 | 현재 앱뿐 아니라 같은 Git 저장소의 다른 worktree도 출력에서 제외한다. 원본 입력 경계는 최종 쓰기 때 다시 확인한다. 변환 도중 출력 부모 symlink가 원본 안으로 바뀐 경우도 거부한다. |
| 파일 읽기 | inode·크기·수정 시각을 확인하고 읽는 동안 커져도 제한보다 최대 한 바이트만 더 읽어 거부한다. symlink·읽기 중 교체/변경·잘못된 제한값을 거부한다. 새 파일 0600/출력 폴더 0700과 기존 부모 권한을 유지한다. |
| 연결 해석 | 코드·주석의 가짜 링크/제목·블록, 백틱/이스케이프, 마스킹으로 변형된 목적지, 잘린 괄호/래퍼가 다른 노트에 자동 연결되는 반례를 차단한다. 표시 이름·별칭과 원래 UTF-16 범위는 보존한다. |
| 보고서 | 같은 폴더와 루트에 동명 보조 파일이 있으면 보고서가 잘못된 루트 경로를 보여줬다. 기존 노트 resolver와 같은 경로 우선순위를 사용한다. |
| 선택 결과 이동 | CLI 결과에도 앱에서 직접 읽는 ZIP을 만들고 공유 앱 리더로 검증한 뒤 저장한다. 원문·보조 파일·최초 감사·보고서·Git bundle은 유지하고 새 연결 메타데이터/선택/이력만 추가한다. |

Git 원본은 commit에 저장된 바이트를 뜻한다. checkout의 줄바꿈/필터 결과나 Git이 무시하는 로컬 파일을 pinned Git 출처로 표시하지 않는다. 기존 UTF-8/파일 크기/심볼릭 링크 제한은 유지한다. 사용자 계정에 이미 설치한 원문이나 과거 패키지의 감사·연결은 재작성하지 않았다.

## 검증

- 전체 `npm test`: 551/551, 실패 0. 새 Git CLI·개인 파일·선택 CLI·왕복과 기존 저장·동기화·원격·원문 회귀를 포함한다.
- `npm run check`: HTML 18개·JS 90개·로컬 참조 356개·PWA 셸 통과. 수정 스크립트와 새 검사 구문·diff도 확인했다.
- [독립 실제 CLI 왕복](obsidian-portability/integration-report.json): 합성 노트 6개·보조 3개, Git 두 커밋·태그, BOM/CRLF/emoji/빈 파일, 선택 2회·보류 2회. ZIP/단독 파일 전체 바이트·SHA, 정확 원문/위치와 새 ID 매핑, stale/덮어쓰기 실패·같은 경로 재시도·재적용 멱등을 확인했다.
- [전체 규모 실제 CLI 왕복](obsidian-portability/scale-report.json): 합성 6,899개(노트 3,479/보조 3,420), 원문 합계 14,635,235바이트. 긴 한국어 경로의 Git 목록은 1,818,990바이트다. 두 CLI를 실행한 뒤 앱 리더의 모든 본문 바이트/SHA·경로와 원래 입력을 전수 대조했다. 선택 연결 1개를 추가한 3,478개 연결과 원래 도구·보고서·보조·Git bundle도 보존했다. import 약 9.3초/apply 약 24.6초는 이 환경의 관찰이며 실제 개인 본문·기기 성능 보장은 아니다.
- [검증 집계와 이번 변경 경계](obsidian-portability/verification.json).

첫 독립 검수 초안은 빈 파일의 `null` 본문/hash를 일반 본문처럼 가정해 실패했다. 기존 Core의 빈 파일 계약을 유지한 채 비교 방식을 바로잡았다. 변환/파일 경계의 수정 전 실패 로그와 최종 검사 로그는 `.local/`에 보존한다. 실제 계정·개인 원문이나 Auth 세션은 시험에 사용하지 않았다.

## 통합 경계와 남은 조건

기반은 PR #93의 `7b78a05`다. 별도 브랜치 `codex/obsidian-portability-20261017`에서 `scripts/import-obsidian-vault.mjs`, `scripts/apply-obsidian-decisions.mjs`, `scripts/lib/obsidian-vault.mjs`, `obsidian-review.mjs`, `private-vault-files.mjs`와 관련 검사만 수정했다. 이 문서와 익명 증거도 새 경로에만 추가했다.

다른 세션이 쓰는 `assets/`, 홈/작성 화면, 공통 CSS, `index.html`, `sw.js`, workflow, `AGENTS.md`, `PRODUCT.md`, `README.md`, 공통 로드맵은 수정하지 않았다. 원래 checkout의 HEAD와 작업 상태도 유지했다. 병합 순서는 공유 기반 이후 두 후속을 각각 검토하면 되며 이 작업이 블로그 화면 작업을 대체하지 않는다. 앱 런타임·PWA 셸 변경이 없어 캐시 번호를 올리거나 새 배포를 하지 않았다.

새 Markdown 엔진을 도입하지 않았다. 기존 [오픈소스 비교와 원문 보존 결정](../life-tools-design/open-source-review.md), Git tree/blob/bundle, Node 표준 파일 API, 기존 Core/Decisions/Package 검증기와 MIT fflate를 재사용한다. bounded scanner가 확실히 해석하지 못하는 목적지는 원문과 함께 검토로 남긴다. 특히 Markdown 파일명의 `%23`와 원시 괄호 등은 새 의미를 추정하지 않는다. 전체 CommonMark/Obsidian 플러그인 호환을 약속하지 않는다.

동시 파일 변경은 읽기/쓰기 경계에서 감지하지만, OS 전체의 악의적 파일시스템 경쟁이나 디렉터리 rename의 완전한 원자성을 새로 보장하지 않는다. 화면/브라우저/PWA를 새로 검증했다고 보고하지 않으며 이번 근거는 실제 CLI와 앱 공유 데이터 리더다. Apple Files·실제 기기, 사용자 브라우저에서 새 파일 받기, main 통합과 운영 배포는 별도다.
