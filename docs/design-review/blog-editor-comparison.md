# 블로그 편집기 비교와 사진 글 재검토

확인일: **2026-10-15 KST**. 사용자의 “오픈소스나 대표적인 블로그 에디터와 우리 조건을 대조” 요청에 대한 조사다. 공식 제품 문서·저장소·태그의 LICENSE/package.json·npm latest·공개 보안 권고를 확인했다. 외부 제품을 설치하거나 로그인하여 동일 글을 작성한 비교 실험은 하지 않았다. 해도는 현재 코드와 [390px/1440px 편집 캡처](photo-post-editor.md#검증과-체험)를 직접 검토했다. 아래 적합성·우선순위는 이 근거에 대한 설계 판단이다.

비교의 해도 상태는 #90 `ac3444b` 기준이다. 이후 기본 진입·공통 목록·사진 아래 설명·상단 저장 개선은 [후속 구현](blog-editor-flow.md)에 별도로 기록한다.

## 판단

**글·사진 편집 경험은 Ghost와 SmartEditor ONE을 주로 참고하고, 지금은 Quill을 유지하면서 작성 흐름을 먼저 개선한다. 엔진 교체의 우선 비교 대상은 Tiptap이다.** 기존 Quill 선정은 배포·저장 보존에는 근거가 있었지만, 대표 제품의 글쓰기 경험 비교가 부족했다. 현재 구현을 “네이버 블로그처럼 편하게 쓰기까지 완성”으로 평가하지 않는다.

Quill의 마지막 안정 릴리스가 2024년인 점은 유지보수 위험이다. 다만 지금 확인한 큰 불편은 두 작성 진입점과 사진 조작 패널 등 앱이 만든 UI에 있다. 이 문제를 엔진 교체로 해결할 수 있다고 가정하지 않는다. 신규 채택이라면 유지보수가 활발하고 이미지·블록 확장 API가 있는 Tiptap도 먼저 실험할 가치가 있다. 이미 저장·복원 가능한 Delta가 있는 현재 상태에서는 전환 비용과 실제 개선을 함께 입증해야 한다.

## 우리 조건

| 조건 | 실제 필요한 결과 | 현재 해도 |
| --- | --- | --- |
| 소량의 여행·사진 기록 | 하나의 글에서 문장 사이 사진 삽입, 설명 작성, 순서 조정 | 구현. 일반 글과 사진 글의 진입·목록은 분리됨 |
| 선명한 사진 | 전달받은 원본 바이트 보존, 작은 이미지를 확대하지 않는 본문, 원본 확대·다운로드 | 구현·샘플 해시/픽셀 검증. OS가 전달 전에 바꾼 파일까지 보장하지 않음 |
| 편한 쓰기와 읽기 | 작성 화면에서 결과를 예측하고 긴 글에서도 사진·저장 조작을 쉽게 찾기 | 기본 서식/읽기 구현. 큰 사진 패널·하단 저장 조작 개선 필요 |
| 한글과 Apple 기기 | 조합 중 서식/사진 삽입·실행 취소·화면 이동, 소프트 키보드와 터치 | Chromium 검증. 실제 Mac/iPad/iPhone IME·Photos/Files·VoiceOver 미검증 |
| 기존 데이터와 실패 복구 | 원래 글·첨부 보존, 저장 실패/경합에도 입력 보존, 사진 포함 복원 | 로컬 구현·회귀 검증. 일반 JSON·동기화·공개에 사진 글은 미포함 |
| 현재 앱 구조 | 일반 JS·정적 배포·오프라인, 외부 CDN에 의존하지 않기 | Quill/fflate 고정 vendor 사용. 다른 엔진도 로컬 배포 가능성을 비교해야 함 |

원본 보존은 편집기 공통 기본 기능이 아니다. 파일 수신 → 원본 저장 → 본문 표시 → 확대 → 백업 전체의 계약이다. 고해상도 원본을 그대로 표시하는 현재 방식도 모바일 메모리·디코딩 비용은 남는다. 표시용 사본이 필요해지면 원본을 별도로 유지하고, 화면 폭·화면 배율에 충분한 파생본과 원본 확대를 구분하는 방식으로 검토한다. 파생본 사용 자체를 화질 손실과 동일시하지 않는다.

## 대표 제품·엔진 대조

| 후보 | 우리에게 유용한 부분 | 직접 도입 때 남는 일·차이 | 판단 |
| --- | --- | --- | --- |
| **Ghost / Koenig** | 본문 중간 카드 삽입, 사진 바로 아래 설명, 선택한 사진의 조작, 카드 순서 변경. 소량 사진을 포함한 글의 좋은 기준 | 독립 실행·UMD 배포도 가능하므로 CMS 전체 설치가 필수인 것은 아님. Ghost 전용 노드·콜백·스타일, 로컬 원본/CAS/ZIP과의 연결은 별도. 제품은 이미지 최적화를 하므로 바이트 보존을 그대로 승계할 수 없음 | **사용 흐름 참고 1순위**. 편집기만 재사용하는 대안도 배제하지 않되 이번에 교체하지 않음 |
| **네이버 SmartEditor ONE** | 익숙한 상단 도구, 글·사진·설명 편집, 그룹 이미지 등 여행 글 표현의 기준 | 공식 소개와 예시를 확인한 범위. 현재 블로그 실사용·화질 정책은 검증하지 않음. 공개 SmartEditor2와 다른 제품이며 ONE을 곧바로 설치할 공식 오픈소스 배포는 이번 조사에서 확인하지 못함 | **친숙함의 참고 기준**. 모든 글꼴·템플릿·스티커를 가져올 필요는 없음 |
| **WordPress / Gutenberg** | 이미지·갤러리 블록, 설명·대체 텍스트, 블록 가까운 도구와 이동, 클릭 확대 | 편집기 패키지는 React 및 다수 WordPress 패키지에 의존. CMS 없이도 사용 가능하지만 현재 앱과의 통합·저장 어댑터 비용이 큼. WordPress 미디어 처리와 편집기 패키지는 별개 | 블록 선택·이동·읽기 동작 **참고**. 현재 규모에서 전체 도입 우선순위 낮음 |
| **Tiptap / ProseMirror** | 확장 가능한 문서 노드와 선택/이동 API, 이미지 크기 조절 옵션, 필요한 UI만 구성 | 일반 JavaScript 지원. React·앱 전체 빌드 전환이 필수라는 기존 설명은 잘못됨. Image는 표시 기능이며 파일 보관/업로드는 별도. 로컬 배포할 의존성 묶음, caption 노드·Blob ID·검증·Delta 이관·읽기·ZIP 연결 필요 | **엔진 교체 비교 1순위**. 반복되는 이미지 블록 제약이나 Apple 입력 문제가 입증되면 작은 실험으로 비교 |
| **Editor.js + Image Tool** | 블록 JSON, 사진 설명과 블록 조작이 가까운 구성, 일반 script 사용 가능 | 기본 Image Tool은 URL/업로드 응답 중심. custom uploader로 로컬 처리 가능하지만 영속 ID/Blob 재연결·검증·읽기 렌더러·백업이 필요. core와 개별 도구의 버전·라이선스·history 동작을 함께 검토해야 함 | 블록 UX **참고**, 대안 후보. 현재 범위에서 이관 이득은 입증 안 됨 |
| **Quill — 현재** | 일반 script와 오프라인 배포, Delta·selection·history, 현재 저장/검색/ZIP의 검증 자산 | Snow UI는 완성된 블로그 제품이 아님. 사진 UI는 자체 구현이며 설명 편집 시 embed 교체로 history를 쓰므로 캡션 입력 후 undo 감각도 확인 필요. 릴리스 간격이 김 | **단기 유지 조건부 추천**. 앱 UI 개선 후 실기 결과로 재판단 |
| **Lexical** | 커스텀 노드·명령·문서 상태 기반. Ghost가 그 위에 실제 블로그 경험을 구현 | 엔진만 도입하면 사진 UI·문서 형식·안전한 렌더러·파일 보관을 다시 연결해야 함. 프레임워크 독립 core와 React 연동을 구분해야 함 | Ghost 내부 구조 참고. 현재 요구에서 엔진 단독 교체 우선순위는 Tiptap보다 낮음 |
| **TOAST UI Editor / SmartEditor2** | 각각 Markdown/WYSIWYG 전환·한국어 UI, 전통적인 네이버형 툴바를 참고 가능 | TOAST 저장소 보관 상태. SmartEditor2는 오랜 릴리스 공백·Jindo 기반이며 현재 ONE과 다른 제품 | **신규 직접 도입 비추천**. 오래된 한국어 제품이라는 이유로 현재 기기 입력 품질을 보장하지 않음 |

제품의 다양한 기능이 모두 우리 요구인 것은 아니다. 소량 사진을 위해 CMS·미디어 라이브러리·실시간 공동 편집·AI·대량 업로드를 먼저 추가할 근거는 없다. 사진 두 장 나란히 배치도 유용한 후속 후보지만, 현재 입력·저장 흐름보다 우선하지 않는다.

## 버전·유지보수·라이선스 확인

날짜는 UTC 원자료의 일자다. `pushed_at`은 저장소 관찰값이며 기본 브랜치의 마지막 실질 수정이나 장기 지원 약속을 뜻하지 않는다. 제품·플러그인·npm 하위 패키지 버전은 서로 구분했다.

| 대상 | 확인한 최신 배포 | 저장소 상태 / 최근 push | 확인한 라이선스 |
| --- | --- | --- | --- |
| Quill | [v2.0.3](https://github.com/slab/quill/releases/tag/v2.0.3), 2024-11-30 | 활성 / 2025-07-25 | BSD-3-Clause, 기존 vendor LICENSE |
| Ghost / Koenig | [Ghost v6.70.0](https://github.com/TryGhost/Ghost/releases/tag/v6.70.0), 2026-10-13. [koenig-lexical 1.12.0](https://registry.npmjs.org/@tryghost/koenig-lexical/1.12.0), 같은 날 | Ghost 활성 / 2026-10-15. 옛 Koenig 저장소는 보관 후 **Ghost/koenig로 이동** | [MIT](https://github.com/TryGhost/Ghost/blob/v6.70.0/LICENSE) |
| Gutenberg | [v24.2.0](https://github.com/WordPress/gutenberg/releases/tag/v24.2.0), 2026-10-14. [block-editor 18.1.0](https://registry.npmjs.org/@wordpress/block-editor/18.1.0), 2026-10-07 | 활성 / 2026-10-15 | [프로젝트 GPL-2.0-or-later](https://github.com/WordPress/gutenberg/blob/v24.2.0/LICENSE.md). 2021-04-15 이후 기여의 GPL/MPL 이중 조건과 프로젝트 전체 라이선스를 구분 |
| Tiptap core | [v3.32.0](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0), 2026-10-13 | 활성 / 2026-10-14 | [오픈소스 core MIT](https://github.com/ueberdosis/tiptap/blob/v3.32.0/LICENSE.md). 별도 상용 기능·서비스 조건과 구분 |
| Editor.js | [v2.31.7](https://github.com/codex-team/editor.js/releases/tag/v2.31.7), 2026-09-17. [Image Tool 2.10.3](https://registry.npmjs.org/@editorjs/image/2.10.3), 2025-07-01 | core 활성 / 2026-09-17 | [core Apache-2.0](https://github.com/codex-team/editor.js/blob/v2.31.7/LICENSE), [Image Tool MIT](https://github.com/editor-js/image/blob/master/LICENSE) |
| Lexical | [v0.52.0](https://github.com/facebook/lexical/releases/tag/v0.52.0), 2026-09-28 | 활성 / 2026-10-14 | [MIT](https://github.com/facebook/lexical/blob/v0.52.0/LICENSE) |
| TOAST UI Editor | [editor@3.2.2](https://github.com/nhn/tui.editor/releases/tag/editor%403.2.2), GitHub 2023-02-24 / npm 2023-02-17 | **보관 상태** / 2024-08-01 | [MIT](https://github.com/nhn/tui.editor/blob/master/LICENSE) |
| SmartEditor2 | [v2.10.0](https://github.com/naver/smarteditor2/releases/tag/v2.10.0), 2019-08-10 | 미보관 / 2020-12-08 | [LGPL-2.1-or-later](https://github.com/naver/smarteditor2/blob/v2.10.0/LICENSE.md) |

위의 “활성”은 `archived=false`라는 뜻이다. npm 최신 버전과 배포일은 각 공식 registry, 상태는 각 GitHub `/repos/{owner}/{repo}`로 대조했다. 새 패키지를 설치하거나 라이브러리 코드를 복사하지 않았다.

공개 저장소 보안 권고도 조회했다. Quill·Gutenberg·Editor.js core·Lexical·TOAST·SmartEditor2·옛 Koenig의 목록은 각각 0개였다. 이것은 취약점 부재·하위 의존성 감사 결과가 아니다. Ghost는 80개 공개 권고가 있었고 최신 6.70.0보다 이전에 패치된 사례를 포함한다. 서버·가져오기·인증 등 CMS 범위가 섞이므로 이 수를 Koenig와 비교하는 안전 점수로 사용하지 않는다.

Tiptap은 공개 권고 3개를 확인했다. core [속성 병합](https://github.com/ueberdosis/tiptap/security/advisories/GHSA-cp6q-959q-f8rh)은 patched 3.30.4, [Markdown 정규식](https://github.com/ueberdosis/tiptap/security/advisories/GHSA-j95f-988m-3j2f)은 3.30.5, 별도 [CollaborationCaret](https://github.com/ueberdosis/tiptap/security/advisories/GHSA-pmh9-4rj3-c67g)은 3.31.3 이상으로 기재돼 있다. 3.32.0은 해당 패치 버전보다 이후다. 교체 실험 때 최신 권고·사용 확장·실제 번들 전체를 다시 확인하며, 이번 조회를 의존성 전체의 보안 인증으로 표현하지 않는다.

## 먼저 바꿀 사용 흐름과 완료 기준

1. **하나의 글쓰기 진입과 일관된 목록.** 사용자가 사진 여부로 작성기를 먼저 고르지 않게 한다. 기존 글·첨부·초안·공개/동기화 형식을 몰래 이관하지 않고 읽기/수정 호환성을 먼저 설계한다. 기존 일반 글 열기 → 수정 → 저장/재열기와 새 글 → 사진 추가를 같은 진입에서 완료해야 한다. 자동 전송 범위를 넓히지 않는다.
2. **사진 가까이에서 설명 쓰기.** 현재 390px 캡처의 고정 패널이 사진과 뒤 문장을 크게 가린다. 설명은 사진 아래에서 편집하고 대체 텍스트·이동·빼기는 선택 시 작은 조작으로 드러내는 안을 먼저 검토한다. 사진 → 설명 → 다음 문장으로 키보드·터치 모두 자연스럽게 이동하고, undo가 문장/설명을 예측 가능한 단위로 복원해야 한다.
3. **긴 글의 저장과 읽기.** 저장 상태와 주 동작을 찾기 쉬운 공통 상단에 두고 백업·복구는 보조 조작으로 정돈한다. 작성/읽기의 본문 폭·사진 크기·설명·목록을 대조하고, 목록에서도 제목·대표 사진으로 글을 식별하게 한다. 긴 글에서 저장하러 끝까지 내려갈 필요가 없어야 한다.
4. **실제 Apple 입력 검수.** 소프트 키보드가 열린 상태의 사진 설명, 한글 조합 중 서식·사진 삽입, 삭제/undo, Files/Photos 선택과 앱 복귀를 확인한다. 자동 검사 담당은 Codex, 실제 기기 검수는 기기 접근 가능한 Local/사용자와 후속 구현 검수 시점에 진행한다. 기기 검수가 끝나기 전 “네이버 수준으로 쓰기 편함”을 확정하지 않는다.

다음 구현의 작은 실험은 동일한 익명 여행 글(문단 3개·가로/세로 사진 각 1장·설명·링크)로 `삽입 → 설명 → 다음 문장 → 이동 → undo → 저장 → 읽기 → ZIP 복원`을 수행하는 것이다. 앱 UI 개선으로 끝나는지 먼저 확인하고, Quill의 선택·embed/history 문제로 반복 우회가 필요하면 같은 자료로 Tiptap을 비교한다. 엔진 전환은 기존 Delta/ZIP의 의미·원본 해시·제한 필드·실패 복구를 모두 유지하고 새 구현이 실제 조작을 줄일 때 채택한다.

## 기능 근거와 확인 한계

- Ghost: [사진·갤러리 카드](https://ghost.org/help/cards/), [편집기 소개](https://ghost.org/help/using-the-editor/), [Koenig 이동 안내](https://github.com/TryGhost/Koenig), [현재 독립 실행·배포 문서](https://github.com/TryGhost/Ghost/blob/v6.70.0/koenig/koenig-lexical/README.md). 원본 보존과 제품의 표시 최적화는 분리해 판단했다.
- 네이버: [SmartEditor ONE 공식 기능 소개](https://smarteditor.naver.com/desktop/features.html), [SmartEditor2](https://github.com/naver/smarteditor2), [2020년 ONE 외부 제공 보류 답변](https://github.com/naver/smarteditor2/issues/195). 오래된 답변만으로 2026년의 모든 상용 제공 가능성을 부정하지 않는다. 이번에 확인 가능한 공개 배포가 없다는 범위다.
- WordPress: [이미지 블록](https://wordpress.org/documentation/article/image-block/), [갤러리 블록](https://wordpress.org/documentation/article/gallery-block/), [미디어 처리 구조](https://developer.wordpress.org/block-editor/explanations/architecture/client-side-media-architecture/). 기본 2560px 큰 이미지 처리와 원본을 구분하는 사례이며, 전체 CMS의 정책을 독립 block-editor 패키지의 고정 동작으로 보지 않는다.
- Tiptap: [Vanilla JavaScript](https://tiptap.dev/docs/editor/getting-started/install/vanilla-javascript), [Image의 표시·resize 설정](https://tiptap.dev/docs/editor/extensions/nodes/image), [FileHandler의 저장/업로드 비포함 범위](https://tiptap.dev/docs/editor/extensions/functionality/filehandler).
- Editor.js: [저장 JSON](https://editorjs.io/saving-data/), [Image Tool·custom uploader·캡션](https://github.com/editor-js/image). JSON 형식이 HTML 출력보다 자동으로 안전하다는 보장은 하지 않는다.
- Quill: [테마·모듈·custom blot](https://quilljs.com/docs/customization). Snow에 UI가 고정되는 엔진이 아니므로 앱의 사진 패널 문제를 Quill 자체 제약으로 오인하지 않는다. Lexical: [core 소개](https://lexical.dev/docs/intro). TOAST: [공식 저장소·WYSIWYG/Markdown](https://github.com/nhn/tui.editor).

이번에는 비교 기록과 이전 선정 이유만 보완했다. 런타임·저장 형식·vendor는 변경하지 않았다. 기존 사진 글 PR #90의 구현 HEAD `ac3444b`는 check/browser CI 모두 통과했고 build/deploy는 건너뛰었다. 이 사실은 외부 제품 비교 실험이나 Apple 실기 검증을 대신하지 않는다.
