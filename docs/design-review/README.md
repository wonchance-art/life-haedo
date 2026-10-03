# 자료 화면 디자인 비교

**현재 비교는 03 · 본문 중심입니다.** 최신 요청에 따라 흰 바탕, 작은 아이콘 탐색, 필요할 때 여는 필터·출처·발췌로 화면 틀을 줄였습니다. 이전 02 소셜 스타일과 01 종이색·명조 비교는 증거와 함께 보존합니다. 운영 적용이나 사용자 선호 확정은 아직 아닙니다.

## 최신 시안 03

| 콘셉트 | 1440px 목록 | 390px 목록 | 820px 원문 |
| --- | --- | --- | --- |
| A · 넓은 목록 | [큰 화면](evidence/minimal/color-feed-desktop.png) | [휴대전화 폭](evidence/minimal/color-feed-phone.png) | [읽기](evidence/minimal/color-reader-tablet.png) |
| **B · 문장 피드 — 추천** | [큰 화면](evidence/minimal/thread-feed-desktop.png) | [휴대전화 폭](evidence/minimal/thread-feed-phone.png) | [읽기](evidence/minimal/thread-reader-tablet.png) |
| C · 빠른 탐색 | [큰 화면](evidence/minimal/pulse-feed-desktop.png) | [휴대전화 폭](evidence/minimal/pulse-feed-phone.png) | [읽기](evidence/minimal/pulse-reader-tablet.png) |

소개·링·컬러 타일·상시 옆 패널·중복 탭을 없애고 세 안의 차이는 목록 폭과 밀도로 줄였습니다. **본문을 한 열로 따라 읽는 이번 목적에는 B를 우선 추천**합니다. A는 넓은 화면의 2열 선택, C는 조밀한 탐색이 강점이며 원문은 모두 최대 700px의 한 열입니다.

`npm run dev` 후 `social-sample.html`을 엽니다. 접힌 **시안 비교**에서 A/B/C를 고르고, 검색 옆 **필터 아이콘 → 제목으로 원문 열기 → 인용 아이콘으로 발췌 → 닫고 읽던 위치로 복귀**를 비교합니다. 담기·발췌는 메모리에만 남고 새로고침하면 초기화됩니다. 실제 계정·저장·동기화와 연결하지 않았습니다.

- [현재 구성과 추천 근거](minimal-concepts.md)
- [최신 캡처·자동 검사·실제 기기 한계](minimal-verification.md)
- [현재 디자인 기준](../../DESIGN.md)

## 이전 비교 02 — 기록

아래는 색과 반응이 통통 튀는 소셜 스타일을 요청했을 때의 비교입니다. 당시 A 추천과 `evidence/social/`은 보존하지만 현재 `social-sample.html`의 화면과 다릅니다.

| 콘셉트 | 1440px 피드 | 390px 피드 | 820px 원문 |
| --- | --- | --- | --- |
| **A · 컬러 모음 — 추천** | [큰 화면](evidence/social/color-feed-desktop.png) | [휴대전화 폭](evidence/social/color-feed-phone.png) | [읽기](evidence/social/color-reader-tablet.png) |
| B · 문장 피드 | [큰 화면](evidence/social/thread-feed-desktop.png) | [휴대전화 폭](evidence/social/thread-feed-phone.png) | [읽기](evidence/social/thread-reader-tablet.png) |
| C · 빠른 탐색 | [큰 화면](evidence/social/pulse-feed-desktop.png) | [휴대전화 폭](evidence/social/pulse-feed-phone.png) | [읽기](evidence/social/pulse-reader-tablet.png) |

A는 원형 주제 선택과 실제 문장이 들어간 컬러 타일, B는 원문과 내 발췌가 이어지는 피드, C는 조밀한 목록과 데스크톱의 선택 자료 미리보기입니다. **이번의 활기 있는 스타일 요청에는 A부터 추천합니다.** 텍스트를 오래 읽는 흐름을 더 선호하면 B, 많은 자료를 빠르게 고르려면 C가 맞습니다.

B의 [발췌와 내 생각을 연결한 화면](evidence/social/thread-connected-phone.png)에서는 직접 추가한 구절이 원문 아래에 이어지는 모습을 볼 수 있습니다.

- [콘셉트·반응·비용 상세](social-concepts.md)
- [참고 출처와 최신 화면 접근 한계](social-references.md)
- [새 브라우저 검증과 모션·접근성](social-verification.md)
- [현재 디자인 기준](../../DESIGN.md)

02의 상단 비교 탭·주제 링·범위 탭·옆 미리보기는 당시 구성입니다. 현재 직접 체험은 위 03 순서를 사용합니다. 세 서비스의 최신 로그인 후 실제 UI는 접근 제한으로 직접 검증하지 못했으며 공식 제품 복제 대신 패턴에서 영감을 얻은 제안이었습니다.

## 이전 비교 01 — 기록

아래의 A/B/C는 종이색·명조 중심의 첫 비교이며 **최신 03과 다른 시안**입니다. 현재 스타일 선택에는 위 03을 사용합니다.

이번 결과는 **현재 화면 감사 → 같은 한글 자료를 쓰는 시안 3개 → 공통 UI 기준 → 브라우저 확인**이다. 기존 운영 UI 교체나 디자인 선호 확정을 뜻하지 않는다. 디자인 책임은 root가 맡았고, 현황 감사·오픈소스 조사·스킬 도입·샘플·브라우저 검증을 별도 에이전트가 담당했다. 공통 CSS와 시안 구현은 책임자 한 명이 통합했다.

## 먼저 볼 화면

| 방향 | 1440px 검색 | 820px 읽기 | 390px 검색 / 읽기 |
| --- | --- | --- | --- |
| **A · 목록과 읽기 — 추천** | [검색](evidence/after/a-search-desktop.png) | [원문](evidence/after/a-reader-tablet.png) | [검색](evidence/after/a-search-phone.png) / [원문](evidence/after/a-reader-phone.png) |
| B · 조사 작업 | [검색](evidence/after/b-search-desktop.png) | [원문](evidence/after/b-reader-tablet.png) | [검색](evidence/after/b-search-phone.png) / [원문](evidence/after/b-reader-phone.png) |
| C · 넓은 보관함 | [검색](evidence/after/c-search-desktop.png) | [원문](evidence/after/c-reader-tablet.png) | [검색](evidence/after/c-search-phone.png) / [원문](evidence/after/c-reader-phone.png) |

추천은 **A의 단순한 목록과 읽기 흐름**이다. B는 더 많은 결과와 다른 자료를 동시에 살피기에 좋지만 본문 폭을 빼앗는다. C는 명조와 여백이 읽는 느낌을 강화하지만 같은 화면에 보이는 자료가 줄어든다. 사용자에게 가장 자주 필요한 일은 많은 버튼 조작보다 이미 남긴 문장을 찾고 문맥을 다시 읽는 일이므로 A를 기본 후보로 삼았다. 선택이 달라지면 동작 계약과 공통 UI 기준은 유지하고 구성만 조정한다.

세 방향은 같은 12건의 샘플, 같은 검색어와 긴 제목·본문을 쓴다. 사진·실제 기록·추정 통계로 한 시안만 더 좋아 보이게 만들지 않았다. 많은 자료 상태는 12건을 이름에 **예시 복제 번호**를 붙여 반복한 밀도 실험이다. 결과 개수는 필터에 따라 바뀐다.

## 직접 조작하기

저장소 루트에서 `npm run dev`를 실행한 뒤 서버의 `design-sample.html`을 연다. 기본 화면은 A안이다. 상단 **방향 / 화면 / 상태**를 바꾸면 같은 자료로 비교할 수 있다. 종료는 개발 서버 터미널에서 `Ctrl+C`.

1. `기록` 검색 → 출처 필터 → 긴 제목의 결과 열기 → 검색 결과로 돌아오기. 검색어·필터·목록 위치·초점이 유지되는지 본다.
2. 원문에서 문장을 선택 → 발췌 패널 → 주제 없이 또는 주제와 내 생각을 입력 → 발췌 추가. **이 시안의 메모리에만** 담기고 새로고침하면 사라진다.
3. 상태를 빈 상태·불러오는 중·오류로 바꿔 문구와 복구 행동을 확인한다. 화면에서 UI 기준을 고르면 공통 버튼·입력·한글 제목·상태 예제를 볼 수 있다.
4. 출처 상세를 펼쳐 일부 본문과 알려진 누락, 미상 날짜, 이전 버전을 살핀다. 링크 전용 자료에는 원문/발췌 행동이 없다.

상단 비교 도구는 제품 UI가 아닌 검토 도구다. 가져오기·발췌 목록 전체 화면은 이번 시안의 대상 밖이므로 버튼은 그 범위를 명시한 안내를 제공한다. Auth·localStorage·IndexedDB·서비스워커·외부 요청은 사용하지 않는다. 보호 화면의 운영 데이터와 결합한 기능으로 해석하지 않는다.

## 근거와 재사용

- [현재 화면 감사와 스크린샷](current-audit.md)
- [최신 오픈소스·실제 제품 화면 비교](references.md)
- [공식 Impeccable 4.5.0 배포본·라이선스·고정 출처](impeccable.md)
- [공통 익명 한글 자료와 사례](sample-content.md)
- [브라우저 검증 결과·재현·실기 한계](verification.md)
- [제품 사실](../../PRODUCT.md) / [공통 디자인 기준](../../DESIGN.md)
- [후속 개발용 디자인 스킬](../../.agents/skills/life-haedo-design/SKILL.md)
- [실행 가능한 시안](../../design-sample.html)

Impeccable의 공식 지침 파일과 출처·라이선스를 프로젝트에 도입했다. 자동 엔진·launcher·hook은 활성화하지 않았다. 이번 결과는 지침을 적용한 프로젝트 검토이며 Impeccable 자동 detector/audit/critique 명령 완료가 아니다. 새 런타임 패키지나 프레임워크를 추가하지 않았다.

## 운영 통합 때 남은 일

- 작업공간 선택·동기화·사본 복원·계정의 관리 행동을 접근 가능한 별도 공간에 배치해야 한다. 이번 시안에서 빠진 기능의 공간도 줄었으므로 결과 시작 위치만으로 동일 기능을 보존한 개선율을 계산하지 않는다.
- 현재 감사는 4건, 시안은 12건의 서로 다른 익명 자료다. A/B/C끼리의 동일 자료 비교는 가능하지만 전후 검색 밀도·사용 시간의 정량 성능 비교는 아니다.
- 원문 article/DOM 선택을 운영 앱의 raw UTF-16 위치·CRLF·버전·출처 참조에 연결하는 작업은 남았다. 원문 렌더러 교체 전에 기존 회귀 사례로 검증한다.
- 앱 전체 공통 탐색과 스타일 연결, 공개 산출물/서비스워커 변경, 실제 iPad·iPhone의 선택 핸들·한글 IME·Files 확인은 운영 통합 단계의 일이다. 화면 폭 모사를 실기 성공으로 보고하지 않는다.

현 단계의 선택 대상은 **A/B/C의 정보 배치와 읽는 느낌**이다. 합의한 방향을 운영 검색/원문 한 흐름에 먼저 적용한 뒤 다른 기능에도 공통 규칙을 확장한다.
