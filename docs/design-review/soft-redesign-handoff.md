# 부드러운 판 디자인 적용 — 총괄 인계

2026-11-02. 소유자 지시: "디자인 적용 ㄱㄱ, 오케스트레이션 세션에 전달".
이 문서는 시안 세션이 총괄 세션에 넘기는 인계서다. 작업 분할, 작업 지시서, 병합·배포, 운영 DB는 [`AGENTS.md`](../../AGENTS.md)의 운영 체계대로 총괄이 맡는다. 시안 세션은 앱 코드를 바꾸지 않았다.

## 근거 자료

- **디자인 캔버스(비공개, 소유자 계정):** https://claude.ai/artifact/3UtLmeQKbyqVCV1Sb64LDx
  - 「부드러운 판」 보드(`soft-*`)가 적용 대상이다. `c1*`·`c2*`·`c3*`는 이전 비교안이라 적용하지 않는다.
- **기준과 결정:** [`expert-design-brief.md`](expert-design-brief.md). 이 문서에서 볼 곳은 다음과 같다.
  - 정렬 기준 3-1절과 측정 스크립트 [`scripts/check-alignment.cjs`](../../scripts/check-alignment.cjs)
  - Apple HIG 질문
  - **사용자 결정 기록 표:** 소유자 결정 16건. 검수에서 위반으로 올리지 않는다.
- **화면별 근거:**
  - 뉴스: [`news-redesign-research.md`](news-redesign-research.md)
  - 글쓰기·읽기: [`write-read-redesign.md`](write-read-redesign.md). 이 문서에는 다음이 함께 들어 있다.
    - 저장 형식 실험, 편집 엔진 실험
    - 독립 검수 3회 기록
    - 「총괄·소유자가 정할 것」 7가지
- **운영 DB 개수 SQL:** [`supabase/operations/photo-post-format-count.sql`](../../supabase/operations/photo-post-format-count.sql). 읽기 전용이고 개수만 센다. 격리 PostgreSQL에서 검증했고, 실행은 총괄 세션이 한다.

## 목표 → 범위 → 보존 → 완료 기준

- **목표:** 앱의 화면 틀과 핵심 화면을 「부드러운 판」 시안으로 바꾼다. Mac·iPad·iPhone에서 기록 → 일정 → 글쓰기·읽기 → 공개의 한 흐름이 시안대로 동작해야 한다.
- **범위(소유자 결정):**
  - 전역 메뉴 `뉴스·일정·자료·설정`
  - 계획을 일정 안으로
  - 일정 `목록·Y·Q·M·W·D`(iPhone은 연→월→일)
  - 자료 목록
  - 뉴스(주제 왼쪽 칸, 앱 안 원문)
  - 글쓰기·읽기(제목 먼저, 공개 알약, 블록 편집)
  - 설정
  - 공통 아이콘·글자 크기·정렬
- **보존:**
  - [`feature-contracts.md`](../agents/feature-contracts.md)의 모든 계약을 지킨다.
  - 2026-11-01 자동 동기화 규칙(미저장 입력·한글 조합 보호, 충돌 복구 사본), 공개·사진 공개 기본 0장, HEIC 원본 보존을 지킨다.
  - `caeyeon_life_*` 키와 기존 주소(`index.html?section=…`, `timeline.html`, `workspace.html`, `life.html`)는 새 화면으로 이어지게 남긴다.
  - 데이터 형식은 별도 결정 전까지 바꾸지 않는다.
- **완료 기준(묶음마다):**
  - 로컬 검사(`npm run check`, `npm test`)를 통과한다.
  - 1440·820·390에서 브라우저로 확인하고, 콘솔 오류 0이다.
  - `check-alignment.cjs`의 줄 밖 0이다. 단 기준 문서에 적은 예외는 허용한다.
  - 독립 검수를 통과하고, 현재 head의 CI가 녹색이다.
  - 실제 기기 확인과 직접 쓰기 평가는 소유자 몫으로 따로 표시한다.

## 먼저 정할 것 (구현 착수 전)

1. **전역 메뉴 계약 변경**
   - `AGENTS.md`(현재 `홈·뉴스·자료실·계획·설정`, home/news/records/tools/manage)와 `DESIGN.md`를 소유자 결정(`뉴스·일정·자료·설정`)에 맞춘다. 이 수정은 총괄만 할 수 있다.
   - `홈` 섹션은 일정 목록으로 바뀐다. 현재 내부 ID와 `?section=` 주소를 새 섹션에 어떻게 대응시킬지 정한다. 예: home·tools → 일정, records → 자료.
2. **글 저장 형식**
   - `write-read-redesign.md` 「총괄·소유자가 정할 것」의 1·2·4·7번이다.
   - 새 블록(체크·코드·자료 인용·`[[연결]]`)은 지금의 `life-photo-post-v2`로 저장할 수 없다. 그래서 v3 형식·서버 검증을 만들지, Markdown 정본으로 갈지를 먼저 정해야 글쓰기 묶음을 시작할 수 있다.
   - 판단 근거로 개수 SQL을 실행한다.
3. **공개 사진:** JPEG·PNG를 원본(촬영·위치 정보 포함)으로 공개하는 현재 방식을 유지할지 정한다(같은 문서 3번).
4. **상태 문구:** 앱의 `모든 기기에 저장됨`을 `계정에 올림` 계열로 바꿀지 정한다(같은 문서 5번).

## 작업 묶음 제안 (의존 순서)

| 묶음 | 내용 | 주 파일(예상) | 선행 |
| --- | --- | --- | --- |
| A. 공통 틀 | 전역 메뉴 4개(데스크톱 왼쪽 라벨 메뉴 + `+ 글쓰기`, iPhone 하단 탭 + 오른쪽 위 연필), 기존 주소 연결, 아이콘(Lucide 1.51.0 모양, 조작 20/글 안 16, 굵기 1.8), 글자 크기 단계, 4의 배수 간격 | `assets/haedo-navigation.js`, `assets/life/ui.js`, `assets/platform.css`, `assets/life/ui.css`, `vendor/lucide`, `index.html`, `sw.js` | 먼저 정할 것 1 |
| B. 일정 | 목록·Y·Q·M·W·D 단계 막대, 계획(목표 막대·네모 체크·습관)을 일정 안으로, D의 행복도, iPhone 연→월→일 | `timeline.html`과 연표 렌더, 연간 계획(`assets/life/annual-plan*`), `goals.html`·`habits.html` | A |
| C. 자료·뉴스 | 자료: 공간 효율 목록, 날짜·시간 왼쪽 칸. 뉴스: 주제 왼쪽 칸, 담기·좋아요 아이콘, 앱 안 원문(권리 단계별, 출처마다 `frame-ancestors` 확인), 빈 탭·갱신 중 | 자료실 화면, `discovery-reading*` | A |
| D. 글쓰기·읽기 | 제목 먼저 + 공개 알약 + 글 정보, 읽기 끝 날짜·태그, 블록 편집(`/`·손잡이·`[[`), iPhone 떠 있는 도구 막대, 저장 상태 두 단계, 공개하기 대화상자 | `photo-post*`, `writing*`, `blog-*`, `material-writing*` | A, 먼저 정할 것 2·3·4 |
| E. 설정 | 설정 화면 정리 | 설정·백업 화면 | A |

- B·C·E는 A가 끝난 뒤 병렬로 진행할 수 있다.
- D는 저장 형식 결정 뒤에 착수한다. 편집 엔진을 바꾸면 [`open-source-review.md`](../life-tools-design/open-source-review.md)의 Tiptap 채택 조건 5가지와 번들 기록을 따른다.
- 묶음마다 서비스워커 캐시를 판올림하고 PWA 업데이트를 확인한다.

## 시안 세션에서 확인한 것과 하지 않은 것

- **확인:**
  - 보드별 정렬 측정
  - 편집↔읽기 세로 위치 일치(1440·390)
  - 긴 제목, iPhone 터치 영역 44px
  - 독립 검수 3회(화면, 데이터 계약, 재검수)의 블로커·메이저 반영
- **하지 않음:**
  - 앱 코드 변경
  - 실제 기기 확인
  - 실제 한글 입력기 확인
  - 운영 DB 실행
  - 뉴스 출처별 앱 안 보기 허용 여부 확인
- **PR #160:** 문서·정렬 스크립트·읽기 전용 SQL만 바꾼다(초안).
  - 8c81b02의 `blog` 검사에서 `tests/integrated-release-browser.cjs`의 `#mwContinue` 대기 시간 초과가 한 번 났다.
  - 이 PR의 변경과 관계없는 흐름이고, main(PR #166 포함)은 녹색이다.
  - 최신 head의 재실행 결과로 재현 여부를 확인한다.
