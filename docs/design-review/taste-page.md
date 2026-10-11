# 취향 페이지 시각 개편과 커스터마이징

2026-10-11 · 디자인/구현 책임 root. [PR #65](https://github.com/wonchance-art/life-haedo/pull/65)의 후속 독립 시안. 운영 앱 미연결, 병합·배포는 Local 담당.

## 실제 참고에서 가져온 것

앞선 조사에서는 네트워크 403으로 공식 화면을 보지 못했다. 이번 재요청은 공식 홈페이지 HTTP 200과 브라우저 렌더링을 확인했다. 단, 아래처럼 일부 CDN 이미지·동영상은 미로딩이었다. 가입/로그인/제품 내부 기능을 체험한 검증으로 확대하지 않는다.

| 공식 출처 | 실제 확인 | 이번 적용 |
| --- | --- | --- |
| [Are.na](https://www.are.na/) / [About](https://www.are.na/about) | 홈페이지·About 본문, Capture/Arrange/Connect 및 공개·비공개 채널 설명. [홈 화면](evidence/taste-page/references/arena.png). 소개 이미지 CDN은 미로딩 | 절제된 틀과 텍스트/이미지/링크의 구분. 컬렉션으로 맥락을 연결한다는 구조 참고. 채널 격자 전체를 이번에 직접 검증했다고 주장하지 않음 |
| [Cosmos](https://www.cosmos.so/) | 탐색·Sequence·Shop의 짧은 탐색, 큰 제목/검색, 이미지와 설명을 분리한 기능 소개. [부분 로딩 화면](evidence/taste-page/references/cosmos-collections.png). 같은 호스트의 일부 예시 이미지는 로드, cdn.cosmos.so 이미지 등은 미로딩 | 작은 탐색, 강한 제목 위계, 이미지 비중과 캡션 분리. 실제 전체 무드보드/개인 계정 검증은 아님 |
| [Apartamento](https://www.apartamentomagazine.com/) | [Latest releases](evidence/taste-page/references/apartamento-releases.png)의 실제 표지·서로 다른 폭·흰 여백·얇은 구분선. 첫 영상은 미로딩 | 책을 같은 회색 카드에 넣지 않고 자연스러운 세로 비율로 놓기. 큰 대표 항목과 조용한 아래 목록의 차이 |
| [Literal](https://literal.club/) | [공식 책장/피드 소개 화면](evidence/taste-page/references/literal.png)과 책장·메모·임베드 설명. 소개용 이미지이며 로그인한 제품 검증은 아님 | 작은 책 표지+제목/저자, 물건과 사용자의 글을 구분하는 방식 |
| [mmm.page](https://mmm.page/) | 홈페이지의 드래그 편집·개인 캔버스·반응형 설명. 외부 장식 이미지 다수 미로딩 | 화면에서 배치와 표현을 바꾸는 경험을 참고하되 이번에는 반응형이 유지되는 제한된 배치 3종으로 구현 |

공식 사이트의 로고·이미지·코드는 앱에 복사하지 않았다. 위 스크린샷은 비평·참고 근거로만 문서에 보존한다. 커버 아트는 [별도 출처](../prototypes/taste-page/media/README.md)의 AI 생성 가상 자료다. 새 라이브러리는 없으며 기존 아이콘·기본 CSS와 native dialog/폼을 재사용한다. 관련 오픈소스의 버전·라이선스 확인은 [이전 선택 기록](../life-tools-design/open-source-review.md)의 Linkwarden/Ryot 조사와 구분한다. 상용 화면을 참고했다는 이유로 오픈소스라고 부르지 않는다.

## 이전 시안의 문제와 변경

이전 [A 보관함](evidence/collection-space/gallery-1440.png)은 표지마다 같은 회색 둥근 상자가 반복되고, 모든 항목에 같은 무게가 실렸다. 파스텔 가상 표지가 화면의 개성까지 미리 결정했다. 정보 찾기용 보관함으로는 쓸 수 있으나 개인 페이지를 표현하기에 부족했다.

- 별도 큰 카드 배경을 걷고 표지·흰 여백·얇은 구분선으로 정리했다.
- 대표 앨범 / 작은 세로 책 / 내 문장 / 작은 앱 아이콘을 다른 크기로 배치했다.
- 페이지 제목과 소개를 사용자가 편집하고 3가지 배치를 고를 수 있게 했다.
- ‘전시’는 표지를 먼저, ‘글 중심’은 선택 이유를 먼저, ‘보관함’은 밀도와 균등 정렬을 우선한다.
- 강조색·바탕·제목 글꼴·여백, 대표 앨범, 문장/저자/섹션 표시, 섹션 순서, 되돌리기를 넣었다.
- 페이지 편집기는 좁은 화면에서 하단 시트가 된다. 미리보기에서는 편집 chrome을 감추고 비공개 상태와 복귀 버튼을 남긴다.

기존 가상 자료의 이름·작성자·메모를 재사용했으나 새 개인 페이지는 그중 대표 항목만 골라 보여준다. 보관함과 동일한 항목 수의 전후 실험은 아니다. 시각 개선에는 새 가상 표지의 영향도 있으며 배치만으로 품질이 좋아졌다고 분리해 증명한 것은 아니다.

## 직접 보기

[실행·체험 순서](../prototypes/taste-page/README.md). 경로 `/docs/prototypes/taste-page/`.

| 화면 | 1440px | 820px | 390px |
| --- | --- | --- | --- |
| 전시 | [화면](evidence/taste-page/gallery-1440.png) | [화면](evidence/taste-page/gallery-820.png) | [화면](evidence/taste-page/gallery-390.png) |
| 글 중심 | [화면](evidence/taste-page/editorial-1440.png) | [화면](evidence/taste-page/editorial-820.png) | [화면](evidence/taste-page/editorial-390.png) |
| 보관함 | [화면](evidence/taste-page/archive-1440.png) | [화면](evidence/taste-page/archive-820.png) | [화면](evidence/taste-page/archive-390.png) |
| 편집 | [화면](evidence/taste-page/editor-1440.png) | [화면](evidence/taste-page/editor-820.png) | [화면](evidence/taste-page/editor-390.png) |

[수정 후 비공개 미리보기](evidence/taste-page/custom-preview-390.png) · [모든 섹션 숨김의 복구 안내](evidence/taste-page/empty-390.png).

## 검증·보존

최종 Linux Chromium 151에서 신규 **23개 확인**, 기존 컬렉션 **31개 확인**을 통과했다. 세 배치 × 1440/820/390px, 편집기 세 폭, 빈 화면 복구와 수정 후 미리보기의 14장면을 캡처하고 대표 7장면을 직접 검토했다. 가로 넘침·표지 영역 초과 없음, 책 2:3 유지, 조작 높이 44px 이상, 입력 16px 이상, 계측 텍스트 최소 대비 5.27:1을 확인했다. 외부 요청·console/pageerror·영속 저장소 생성은 0이다. `npm run check`는 HTML 18 / JS 59 / 참조 271 / PWA 통과이며 docs 안의 새 JS/검사 파일은 별도 구문 검사했다. 공개 산출물에서 시안과 생성 이미지가 제외됨을 재확인했다. 기존 전체 운영 기능 회귀를 반복한 것으로 보고하지 않는다.

실행 결과는 [report.json](evidence/taste-page/report.json)에 기록한다. 가상 원문으로 생성된 페이지 메모리만 바꾸며 운영 HTML·JS·CSS, Auth, SQL, IndexedDB, 서비스워커, 백업·공개 계약은 바꾸지 않았다. CSP의 connect/frame/form 차단도 유지한다. 외부 표지 자동 조회나 외부 AI 전송을 앱에 연결하지 않았다.

검토 중 발견한 브랜드 구분자의 대비 부족, 편집기를 열었을 때 표지가 제목을 덮는 문제, 보관함 배치의 책 비율 변화와 작은 표지의 저자 잘림은 수정 후 해당 계측을 추가했다. 단순 문서 가로 넘침 외에 실제 이미지 영역 경계와 책 2:3 비율을 확인한다. 이미지의 글자는 원문 데이터 대신 안전한 DOM 텍스트로 만든다. 페이지 입력을 HTML로 해석하지 않는다.

한글 명조는 설치된 글꼴을 사용하므로 기기별 모양이 같다고 보장하지 않는다. 실제 앱 반영 시 글꼴 배포 여부를 별도로 결정한다.

실제 Apple 기기·IME·VoiceOver·개인 자료·저장 실패·동기화·공개 검증은 이번 범위가 아니다. 편집/리셋 되돌리기는 최근 40개 변경의 페이지 세션에만 적용된다. 새로고침과 다른 페이지 이동 시 초기화되며 영구 저장 완료로 표현하지 않는다. 숨김은 공개 권한 변경이 아니다.

## Local 인계와 다음 우선순위

PR #65는 계속 초안이며 기존 컬렉션 시안도 비교용으로 보존한다. 새 시안은 기존 화면에서 ‘내 페이지 꾸미기’로 들어간다. 운영 allowlist에 docs를 추가하지 않고, SQL·Secrets·캐시 버전은 바꾸지 않는다. `.github/workflows/collection-prototype.yml`은 두 독립 시안을 각각 검사한다.

1. 사용자 시각 피드백으로 기본 배치와 허용 커스터마이징 범위를 확정한다. 어두운/강한 취향과 실제 커버로도 적합성을 확인해야 한다.
2. 최신 Local 통합 기준에서 컬렉션 대상과 기존 내 페이지/글의 참조·백업 복원 계약을 구현한다. 시안 배열을 localStorage에 넣는 것으로 대체하지 않는다.
3. 계정별 편집 초안·실패/충돌 복구·공개할 필드의 명시 선택을 연결하고, 개인 메모 자동 공개를 차단한다.
4. 자동 정보 후보 조회와 YouTube 클릭 재생은 공식 API/표지 이용 조건을 확인한 뒤 별도 단계로 연결한다.
