# 오픈소스 검토와 재사용 결정

확인일: 2026-10-03 UTC. 공식 저장소·태그별 LICENSE·릴리스·문서를 읽은 초기 비교다.
라이브러리 설치나 앱 통합·성능 검증은 아직 하지 않았다. 구현 단계마다 최신 상태를 다시 확인한다.
최신 R1은 새 기록 입력보다 기존 기록의 가져오기·발췌·검토·통합·원문 추적이다. 아래 저장 후보는 유지하고 import 후보/원천 경로를 추가 조사했다.

## 작업 원칙

새 기능을 만들기 전에 기존 코드와 관련 오픈소스에서 이미 해결한 부분을 찾는다.
**직접 도입 → 필요한 부분의 재사용 → 설계 참고 → 자체 구현**을 비교하고, 요구에 맞는 가장 유지하기 쉬운 방식을 선택한다.
최신 버전이라는 이유만으로 도입하지 않고 안정판·유지보수·라이선스·보안 권고·실제 API와 현재 앱의 적합성을 확인한다.
공개 저장소의 존재는 오픈소스 라이선스나 자유로운 코드 재사용의 증거가 아니다. 설계 참고와 코드 복사를 구분한다.

각 단계의 담당자는 후보·확인일·정확한 버전·출처·선택 이유를 남긴다. 도입할 때는 다음을 함께 확인한다.

- 요구: 실제 필요한 기능과 실패/복구 조건을 충족하는가. 이미 앱에 있는 라이브러리로 해결할 수 있는가.
- 유지보수: 공식 안정 릴리스와 기본 브랜치의 차이, 변경 이력·관련 미해결 문제·보안 수정·보관 처리 여부. 별 개수만으로 판단하지 않는다.
- 배포: 일반 JavaScript·브라우저·PWA·오프라인 동작, 전이 의존성·파일 크기·서버/빌드 요구·업데이트 부담.
- 라이선스: 사용할 버전의 LICENSE·NOTICE·하위 구성요소를 확인하고 고지·소스 제공 등 필요한 조건을 적용한다.
- 교체: adapter 안에 사용을 제한하고 데이터 내보내기·마이그레이션·의존성 제거 경로를 유지한다.

자체 구현을 선택한다면 후보가 충족하지 못하는 요구와 직접 유지할 범위를 짧게 적는다.
큰 기반 모듈을 다 만든 뒤 라이브러리를 찾아보는 순서로 진행하지 않는다. 해당 단계의 소수 후보와 작은 실행 검증으로 결정을 내린다.

## R1 저장 계층: 우선 비교한 후보

버전·날짜는 조회 시 공식 안정 배포 정보다. idb는 GitHub Releases 게시물 대신 태그와 npm 게시 정보를 확인했다.
세 후보 모두 npm `latest`와 대조했으며, 최신 배포일만으로 유지보수 중단 여부를 단정하지 않는다.

| 후보 | 확인한 안정판·게시일 | 태그의 라이선스 | 우리 요구와의 적합성 | 현재 판단 |
| --- | --- | --- | --- | --- |
| [idb](https://github.com/jakearchibald/idb/tree/v8.0.3) | 8.0.3 · 2025-05-07 | [ISC](https://github.com/jakearchibald/idb/blob/v8.0.3/LICENSE) | 일반 script/ESM, 다중 저장소 트랜잭션·`tx.done`·upgrade/blocked/blocking. 현재 bundle+operations 원자 커밋과 맞음 | **우선 도입 후보**, 작은 브라우저 검증 후 확정 |
| [Dexie.js](https://github.com/dexie/Dexie.js/releases/tag/v4.4.6) | 4.4.6 · 2026-09-10 | [Apache-2.0](https://github.com/dexie/Dexie.js/blob/v4.4.6/LICENSE) | 일반 script/ESM, 다중 테이블 트랜잭션·선언적 스키마·버전 이전. 조회·마이그레이션 요구가 커질 때 유리 | idb와 비교할 대안 |
| [localForage](https://github.com/localForage/localForage/releases/tag/1.10.0) | 1.10.0 · 2021-08-18 | [Apache-2.0](https://github.com/localForage/localForage/blob/1.10.0/LICENSE) | 간단한 비동기 key-value API. 공개 API에 여러 저장소를 묶는 트랜잭션·사용자 정의 upgrade callback이 없음 | 핵심 원자 저장에는 부적합, 단순 캐시 용도로만 별도 판단 |

idb에서는 개별 `put()`이 아닌 `tx.done` 성공, Dexie에서는 최상위 `db.transaction()` Promise 성공을 `stored`의 경계로 삼는다.
트랜잭션 내부에서 fetch·AI 같은 무관한 비동기 작업을 기다리지 않는다. 원격 요청은 커밋 이후 별도 adapter가 처리한다.
localForage의 IndexedDB `setItem()`도 단일 트랜잭션 완료를 기다리지만 여러 `setItem()`을 하나의 원자적 커밋으로 묶어주지는 않는다.
revision 비교·성공 영수증·활동의 의미·공유 권한은 앱의 규칙이다. 라이브러리가 자동 제공하는 보장으로 오인하지 않는다.

공식 근거: [idb API·완료/트랜잭션 주의사항](https://github.com/jakearchibald/idb/blob/v8.0.3/README.md), [idb 태그](https://github.com/jakearchibald/idb/tags), [idb npm 게시 정보](https://registry.npmjs.org/idb), [Dexie 트랜잭션 공식 문서 원본](https://github.com/dexie/dexie-website/blob/master/docs/Dexie/Dexie.transaction%28%29.md), [Dexie 버전 이전 공식 문서 원본](https://github.com/dexie/dexie-website/blob/master/docs/Version/Version.upgrade%28%29.md), [localForage API](https://github.com/localForage/localForage/blob/1.10.0/docs/api.md), [localForage 저장 구현](https://github.com/localForage/localForage/blob/1.10.0/src/drivers/indexeddb.js).

[idb](https://github.com/jakearchibald/idb/security/advisories), [Dexie](https://github.com/dexie/Dexie.js/security/advisories), [localForage](https://github.com/localForage/localForage/security/advisories)의 공개 보안 권고 페이지는 확인일에 게시된 권고가 없다고 표시했다.
이는 취약점 부재나 전이 의존성 감사 완료를 뜻하지 않는다. 실제 도입 버전과 배포 파일을 정한 뒤 관련 권고를 다시 확인한다.

R1의 적합성 검증은 bundle+operations 동시 성공/중단, quota 오류, 두 탭 revision 경합, 다른 탭이 열린 상태의 업그레이드, 새로고침·PWA 오프라인 재시작이다.
통과한 후보를 버전 고정해 배포하고 라이선스 고지를 보존한다. 런타임에서 이동하는 `latest` URL에 의존하지 않는다.

## 분야 도구와 화면: 설계 참고 후보

아래는 기능·데이터 구조의 참고 후보다. 전체 제품 도입·코드 재사용 결정은 별도로 한다.

| 프로젝트 | 확인한 안정 릴리스·발행일 | 태그의 라이선스 | 참고할 부분 | 현재 앱과의 차이 |
| --- | --- | --- | --- | --- |
| [SilverBullet](https://github.com/silverbulletmd/silverbullet/releases/tag/2.11.1) | 2.11.1 · 2026-09-22 | [MIT](https://github.com/silverbulletmd/silverbullet/blob/2.11.1/LICENSE.md) | Markdown·양방향 링크·작업/자료 연결·선택적 템플릿. 같은 기록 재사용과 반복 입력 감소 | 해당 버전은 Rust 서버와 TypeScript/CodeMirror 6/Preact/ESBuild 구조. 전체 도입 시 실행·빌드 구성이 달라짐 |
| [Monica](https://github.com/monicahq/monica/releases/tag/v4.1.2) | v4.1.2 · 2024-05-04 | [GNU AGPL v3](https://github.com/monicahq/monica/blob/v4.1.2/LICENSE.md) | 사용자가 직접 남긴 사람 메모·공동 활동·대화·다음 약속·내보내기 | 안정판 PHP/Laravel·Composer·MySQL 기반. main은 개발 중 베타, 안정 4.x와 구분 필요 |
| [BookWyrm](https://github.com/bookwyrm-social/bookwyrm/releases/tag/v0.9.3) | v0.9.3 · 2026-09-09 | [Anti-Capitalist Software License v1.4](https://github.com/bookwyrm-social/bookwyrm/blob/v0.9.3/LICENSE.md) | 작품/판본·독서 회차·진도 이력·리뷰/인용/공유 범위 구분 | Django·PostgreSQL·Celery·Redis·ActivityPub. 사용 주체 조건이 있는 공개 소스 참고 대상으로 구분하고 자유로운 코드 재사용을 전제하지 않음 |

BookWyrm의 페이지/퍼센트 진도만으로 우리의 실제 읽은 구간·재독·이해 계약을 대체하지 않는다.
SilverBullet을 과거 Deno 서버 구조로 설명하거나 BookWyrm을 과거 라이선스 기억으로 분류하지 않는다.
Monica의 오래된 안정판 날짜만으로 현재 개발 활동을 판단하지 않고, 실제 적용 단계에 안정 4.x와 개발 버전 상태를 다시 대조한다.

공식 근거: [SilverBullet 해당 버전 구조](https://github.com/silverbulletmd/silverbullet/blob/2.11.1/README.md), [Monica 안정판 기능·실행 요구](https://github.com/monicahq/monica/blob/v4.1.2/README.md), [Monica main 베타 안내](https://github.com/monicahq/monica/blob/main/README.md), [BookWyrm 작품/판본 모델](https://github.com/bookwyrm-social/bookwyrm/blob/v0.9.3/bookwyrm/models/book.py), [독서 회차·진도 모델](https://github.com/bookwyrm-social/bookwyrm/blob/v0.9.3/bookwyrm/models/readthrough.py).

## 설계와 작업 배치에 반영한 결정

1. IndexedDB라는 저장 방식은 유지하되 원시 API 래퍼 자체 구현을 기본값으로 두지 않는다. idb를 우선 비교하고 Dexie를 대안으로 검증한다.
2. `assets/life/`는 adapter와 앱 고유 규칙의 경계다. 오픈소스를 그 안에서 재사용할 수 있고, 모듈마다 기능을 새로 작성할 필요는 없다.
3. 이미 사용 중인 daisyUI·Leaflet의 적용 범위를 먼저 확인해 화면·지도 기능의 중복 구현을 피한다. 이번 조사에서 이들의 최신판 업데이트를 결정한 것은 아니다.
4. 분야 담당은 책·노트·관계의 구체적 사용 흐름을 위 후보와 비교한다. 코드 재사용 시에는 실제 범위의 라이선스 조건을 따로 적용한다.
5. 새 동기화·검색·날짜·편집·AI/공유도 해당 단계에서 공식 근거와 작은 적합성 검증으로 후보를 선택한다. 이번 여섯 후보를 전체 기술 선정 완료로 취급하지 않는다.

인계에 남길 최소 기록: `해결할 요구 / 후보·버전·확인일 / 공식 출처·라이선스 / 직접 도입·부분 재사용·설계 참고·자체 구현 / 이유 / 실제 검증·미검증 / 재확인 조건`.
릴리스 변경·보안 권고·라이선스 변경·현재 요구를 깨는 API 변경·새 구현 단계 착수 시 해당 기록을 갱신한다.

## 네 원천과 iPad Chrome 입력 경로

확인일: 2026-10-03 UTC. 공식 문서 확인과 실제 기기 검증을 구분한다. **실제 iPad에서 아래 경로를 실행하지 않았다.**
공식 Obsidian 도움말은 그 팀이 운영하는 GitHub 원본을 확인했다. Apple·네이버·Meta 도움말은 현재 환경의 프록시에서 HTTP 403으로 차단됐다.
차단은 해당 서비스나 export 기능이 없다는 증거가 아니다. 확인하지 못한 메뉴·형식·버전 조건을 기억으로 채우지 않는다.

| 원천 | 공식 근거로 확인한 범위 | R1에 제안하는 입력 | 미확인·기기 실험 범위 |
| --- | --- | --- | --- |
| Apple 메모 | Obsidian 공식 도움말/Importer 소스는 Apple Notes 이동을 **macOS 전용, iOS 미지원**이라고 명시 | 사용자가 제공한 선택 본문을 붙여넣거나 실제 받은 `.txt/.md`를 선택. Apple 자체 export 형식이라고 단정하지 않음 | Apple 기본 앱의 iPad 보내기/복사/Markdown·PDF export 메뉴와 iPadOS 버전별 조건은 공식 확인 미완료. Mac 경로를 iPad 지원으로 확대하지 않음 |
| Obsidian | vault는 로컬 폴더의 평문 `.md`; iCloud vault는 `iCloud Drive/Obsidian/[vault]`, Files 앱에서 위치 확인 공식 안내 | 접근 가능한 선택 `.md` 파일 또는 본문을 제공. 첨부·`[[링크]]`·YAML은 원문 보존하며 자동 해석/수집하지 않음 | Chrome 파일 선택에서 로컬/동기화 vault 실제 접근, 미다운로드 파일, 파일명/경로, 첨부 누락, 개별 note 외부앱 재열기를 기기로 확인 |
| 네이버 블로그 | 공식 도움말 접근 차단으로 export/복사 지원 형식과 공개 본문 API는 미확인 | 사용자가 적법하게 제공한 선택 본문+원문 URL, 또는 URL만 등록 | 공개 URL 방문 가능과 다른 origin 앱의 fetch/CORS 허용은 별개. 실제 서버 CORS·비공개 글·삭제/수정·본문/사진 수신 범위를 미확인으로 둠 |
| 인스타그램 | Meta 공식 도움말 접근 차단으로 계정 export 형식/신청 메뉴/기기 조건은 미확인 | 사용자가 제공한 자기 기록/허용된 발췌+게시물 URL, 또는 URL만 등록 | 본인 계정 export와 타인 게시물의 저장 목록/본문/미디어 접근권한은 구분. 저장한 타인 콘텐츠의 전체 본문/미디어가 export에 담긴다고 약속하지 않음 |

R1의 앱 입력은 **본문 붙여넣기 / 접근 가능한 UTF-8 `.txt/.md` 파일 선택 / 링크 보관**이다.
서비스별 iPad 메뉴를 성공 경로로 확정한 것이 아니다. 본문을 얻지 못하면 `coverage.status=link_only`, `contentText:null`로 보관한다.
수신한 일부 본문은 `partial`, 전체라는 근거가 있는 수신은 `full_text`, 범위를 판단할 수 없으면 `unknown`이다.
사용자 계정 로그인·자동 크롤링·ZIP 계정 export parser·사진 OCR을 첫 기본 경로에 포함하지 않는다.
업로드된 ZIP은 이번 설계의 참고자료이며 서비스 연동·전체 수집·외부 전송의 허가로 해석하지 않는다.

Obsidian의 native Share Sheet는 공식 문서상 **iOS/iPadOS 18+와 Obsidian 1.13.0+**가 필요하다.
다른 앱의 Share → Obsidian → 위치 선택 → 본문 검토 → Save 경로이며 URL만/Full Text 옵션이 있다.
이는 다른 앱에서 **Obsidian으로** 보내는 경로다. 우리 정적 웹앱이 iPad Chrome의 공유 수신 대상이 된다는 근거가 아니다.
Obsidian Web Clipper 문서는 Safari의 iOS/iPadOS 확장을 안내한다. 데스크톱 Chrome 확장이 iPad Chrome에서 된다고 확대하지 않는다.
원천 앱 재열기·URL 방문이 실패해도 이미 받은 SourceVersion은 그대로 읽는다. 삭제/비공개 원문을 재수집하려고 권한을 우회하지 않는다.

공식 확인 자료:

- [Obsidian 데이터 저장](https://github.com/obsidianmd/obsidian-help/blob/master/en/Files%20and%20folders/How%20Obsidian%20stores%20data.md), [iCloud·iPad vault 위치](https://github.com/obsidianmd/obsidian-help/blob/master/en/Getting%20started/Sync%20your%20notes%20across%20devices.md)
- [Obsidian iOS/iPadOS Share Sheet](https://github.com/obsidianmd/obsidian-help/blob/master/en/Obsidian/Obsidian%20for%20iOS%20and%20iPadOS.md), [Web Clipper 지원 브라우저](https://github.com/obsidianmd/obsidian-help/blob/master/en/Obsidian%20Web%20Clipper/Introduction%20to%20Obsidian%20Web%20Clipper.md)
- [Apple Notes Importer macOS 제한](https://github.com/obsidianmd/obsidian-help/blob/master/en/Import%20notes/Import%20from%20Apple%20Notes.md), [해당 버전의 플랫폼 검사](https://github.com/obsidianmd/obsidian-importer/blob/3.1.11/src/formats/apple-notes.ts)
- 확인 시도했으나 차단된 공식 대상: [Apple iPad 사용 설명서](https://support.apple.com/guide/ipad/welcome/ipados), [네이버 블로그 도움말](https://help.naver.com/service/5593), [Instagram 정보 다운로드 도움말](https://www.facebook.com/help/instagram/181231772500920). 본문/현재 메뉴를 확인한 출처로 인용하지 않는다.

## 가져오기·읽기 추출: 두 후보와 내장 API

아래 두 후보는 소스/태그/라이선스를 읽었으며 설치·실행·실제 입력 적합성은 검증하지 않았다.

| 후보 | 최신 안정 버전·날짜와 라이선스 | 유지관리·실제 경계 | 판단 |
| --- | --- | --- | --- |
| [Obsidian Importer](https://github.com/obsidianmd/obsidian-importer/releases/tag/3.1.11) | **3.1.11 · 2026-10-02 UTC**, [MIT](https://github.com/obsidianmd/obsidian-importer/blob/3.1.11/LICENSE) | 최신 release/manifest 일치, min Obsidian 1.13.0. README는 community-led이며 Obsidian 팀이 새 import 능력을 적극 추가하는 주체는 아니라고 명시. Apple importer는 macOS 파일시스템/SQLite 사용 | **설계 참고**: 원천별 변환·선택·미리보기·파일 fixture 비교. 전체 플러그인을 vanilla 웹앱에 직접 넣지 않음. `isDesktopOnly:false`가 Apple Notes의 iPad 지원을 뜻하지 않음 |
| [Mozilla Readability](https://github.com/mozilla/readability/tree/0.6.0) | **0.6.0 · 2025-03-03 UTC**, [Apache-2.0](https://github.com/mozilla/readability/blob/0.6.0/LICENSE.md) | 공식 tag와 npm latest 게시일 일치. 브라우저 script로 받은 DOM에서 기사 본문·title/byline을 후보 추출. 네트워크/CORS·로그인·허가를 해결하지 않음 | **후속 HTML 입력의 부분 도입 후보**. R1 평문/Markdown에는 불필요. 받은 원문과 추출 결과를 분리하고 누락을 검토해야 함 |

Readability는 sanitization 도구가 아니다. [해당 버전 README](https://github.com/mozilla/readability/blob/0.6.0/README.md)는 HTML 출력 표시 시 sanitizer/CSP를 별도로 권고한다.
[공식 보안 권고 GHSA-3p6v-hrg8-8qj7](https://github.com/mozilla/readability/security/advisories/GHSA-3p6v-hrg8-8qj7)는 특수 title의 정규식 과도 연산을 설명하며 영향 `<0.6.0`, 수정 `0.6.0`이다.
따라서 과거 버전 복사를 하지 않는다. HTML을 도입할 때 입력 크기·시간·실행/리소스 로딩·출력 표시를 다시 검증한다.
[Importer 공개 권고 페이지](https://github.com/obsidianmd/obsidian-importer/security/advisories)는 확인일에 게시된 권고 없음으로 표시했다. 의존성 감사 완료는 아니다.
Importer의 [manifest](https://github.com/obsidianmd/obsidian-importer/blob/3.1.11/manifest.json), [실행 의존성](https://github.com/obsidianmd/obsidian-importer/blob/3.1.11/package.json), [README](https://github.com/obsidianmd/obsidian-importer/blob/3.1.11/README.md)를 함께 봤다.
Readability는 [태그](https://github.com/mozilla/readability/tags)와 [npm 게시 정보](https://registry.npmjs.org/@mozilla%2Freadability)를 대조했다. 최신 배포일이 오래됐다는 이유만으로 유지관리 중단을 단정하지 않는다.

R1 기본 처리는 브라우저 `File/Blob.arrayBuffer()` + `TextDecoder('utf-8',{fatal:true})`와 문자열 선택이다.
별도 Markdown parser 없이 문자열 원문과 UTF-16 locator를 보존하면 앱 요구를 충족한다. 이는 범용 parser를 새로 작성하는 선택이 아니다.
`Blob.text()`는 UTF-8을 가정한다. 잘못된 인코딩·BOM·줄바꿈을 미리보기에서 확인하고 조용한 문자 교체로 원문을 바꾸지 않는다.
공식 MDN 문서 원본: [TextDecoder](https://github.com/mdn/content/blob/main/files/en-us/web/api/textdecoder/index.md), [Blob.text](https://github.com/mdn/content/blob/main/files/en-us/web/api/blob/text/index.md), [CORS](https://github.com/mdn/content/blob/main/files/en-us/web/http/guides/cors/index.md).
읽기 추출 라이브러리나 service worker는 다른 origin의 공개 페이지를 읽을 권한을 새로 주지 않는다. 네이버의 실제 CORS 응답은 이번에 검사하지 않았다.

R1 선택 가설: 내장 텍스트 수신 + 수동 발췌 + 좁은 결정적 규칙이 입력 부담과 추적 정확도를 충족하면 그대로 유지한다.
다른 선택으로 바꿀 조건: 실제 소량 샘플에서 반복된 HTML 입력 요구·원문 누락·첨부 연결 요구가 확인될 때만 해당 parser를 비교한다.
최소 실험은 iPad Chrome에서 네 원천의 제공 가능한 입력 한 건씩 → 수신 범위 확인 → 발췌 → 원문 구간 재열기 → 내보낸 파일 재선택이다.
Apple/Naver/Meta 공식 경로 확인은 기술 담당의 다음 자료 조사, 실제 메뉴/파일 수신/재열기는 경험·검증 담당의 기기 실험에서 확정한다.
이 조사를 완료했다는 이유로 서비스 연동·원문 전체 확보·자동 통합·외부 전송이 구현됐다고 보고하지 않는다.

## 개인 동기화 구현: Supabase SDK 고정 도입

확인일 **2026-10-03 UTC**. 공식 npm의 `latest`와 GitHub 안정 릴리스를 대조했다. `@supabase/supabase-js` **2.117.2**는 npm 게시 **2026-09-25 10:08:51 UTC**, GitHub 릴리스 **2026-09-25 10:05:55 UTC**이며 실제 배포 tarball LICENSE는 **MIT**다. next/beta/canary는 선택하지 않았다. 공식 저장소에 최근 안정 배포와 문서 갱신이 있으며 유지관리 중단의 근거가 없다. 공식 security advisories 페이지는 확인일에 게시된 권고 없음으로 표시했다. 이것을 전체 의존성 감사나 무취약성 보증으로 표현하지 않는다.

| 대안 | 실제 요구와 비용 | 이번 결정 |
| --- | --- | --- |
| 기존 앱의 fetch REST 경로 확장 | 전송 자체는 작지만 기존 charts의 연결·세션 상태와 새 자료의 권한을 분리해야 하고, 토큰 갱신·동시 갱신·여러 탭·로그아웃 처리를 또 유지해야 함 | 기존 charts 코드는 유지. 새 모델의 Auth 재사용 기반으로 선택하지 않음 |
| 공식 supabase-js 안정판 UMD | Auth의 refresh·session coordination·이벤트·REST를 재사용하고 별도 adapter에서 원문 해시·크기·CAS 결과·연결 세대를 검증. 약 218 KB 원본 배포물 | **고정 도입**. 프레임워크·앱 빌드·CDN 런타임 의존 추가 없음 |
| CRDT·로컬 우선 전체 전환 | 문서별 자동 병합·실시간 공동 편집이 현재 요구가 아니며 새 데이터형·서버·운영 검증이 필요 | 이번 범위에 넣지 않음. 개인 스냅샷 CAS와 충돌 사본 보존으로 요구를 검증 |

원본 `package/dist/umd/supabase.js`와 LICENSE, upstream README를 `vendor/supabase/`에 그대로 동봉했다. 전역은 `supabase.createClient`다. 공식 registry의 tarball SHA-512 integrity와 내려받은 tarball을 대조했고 UMD SHA-256도 기록했다. 앱 패키지에 npm 실행 의존성을 설치하지 않았다.

- [공식 릴리스 2.117.2](https://github.com/supabase/supabase-js/releases/tag/v2.117.2)
- [npm 전체 게시 정보·dist-tags](https://registry.npmjs.org/@supabase%2Fsupabase-js), [고정 버전 metadata](https://registry.npmjs.org/@supabase%2Fsupabase-js/2.117.2)
- [원본 tarball](https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-2.117.2.tgz), [동봉 출처·integrity·UMD hash](../../vendor/supabase/README.md), [실제 MIT 고지](../../vendor/supabase/LICENSE)
- [고정 태그의 README](https://github.com/supabase/supabase-js/blob/v2.117.2/README.md), [공식 공개 보안 권고](https://github.com/supabase/supabase-js/security/advisories)

SDK 2.117.2는 기본으로 Web Locks를 새로 설정하지 않는다. 공식 [lockless coordination 설명](https://github.com/supabase/supabase-js/blob/v2.117.2/packages/core/auth-js/migrations/lockless-coordination.md)에 따라 같은 탭 refresh는 single-flight, 여러 탭은 서버의 refresh 처리와 storage commit guard를 사용한다. 이전 `lock` 옵션은 지정할 때만 호환되며 deprecated다. 이번 구현은 SDK의 기본 coordination을 재사용한다. `onAuthStateChange`의 callback은 동기 상태 수집만 하고 앱 알림은 다음 이벤트 순서로 넘겨 재귀 refresh를 피한다.

[고정 태그 GoTrueClient](https://github.com/supabase/supabase-js/blob/v2.117.2/packages/core/auth-js/src/GoTrueClient.ts)의 `_signOut`은 정상 유효 세션의 `/logout` 실패에도 로컬 세션을 제거하고 `SIGNED_OUT`을 방송한다. 실제 동봉 SDK+모의 503 서버 시험에서 이 경로를 확인했다. 다만 만료 세션의 `_useSession`에서 refresh가 먼저 실패하면 조기 반환할 수 있어, 명시 로그아웃은 manager의 연결 설정 제거와 함께 새로고침 자동 재개를 차단한다. SDK private 메서드나 BroadcastChannel 메시지를 직접 호출하지 않는다. 공개 `auth.dispose()`로 refresh·visibility listener·채널을 정리하고 adapter의 abort/세대 검사·storage 쓰기 guard로 폐기된 인스턴스의 늦은 응답을 막는다. 전용 auth storageKey는 프로젝트별 `life_tools_sync_auth_v1:` 접두를 쓰며 기존 charts 설정·세션은 읽지 않는다.

수신/송신은 Core 구조와 모든 받은 본문의 WebCrypto SHA-256, 작업공간 ID, 최대 16 MiB JSON을 확인한다. 서버 JSONB 직렬화에는 공백 등 크기 차이가 있으므로 클라이언트 통과 후 서버가 크기를 거절할 수 있다. 고정 SQL 오류 식별자만 안전한 `payload_too_large`/`operation_mismatch` 등으로 바꾸고 raw error·본문·토큰·비밀번호는 제품이나 로그에 내보내지 않는다. 실제 서버 설치·권한 검사는 SQL 담당과 총괄의 별도 결과이며, fixture adapter 통과를 실서비스 RLS 검증으로 표현하지 않는다.

SQL 담당의 시험 전용 도구는 **@electric-sql/pglite 0.5.8**, npm latest/게시 **2026-08-26 18:40:08 UTC**, **Apache-2.0**다. [공식 npm 정보](https://registry.npmjs.org/@electric-sql%2Fpglite), [공식 저장소](https://github.com/electric-sql/pglite), `/tmp/life-pglite-check/node_modules/@electric-sql/pglite/LICENSE` 실제 파일을 확인했다. SQL 담당은 임시 폴더 설치·audit 0·SQL/RLS 17개 통과를 보고했다. 앱 런타임·배포물에는 넣지 않으며 실제 Supabase 권한·설치 검사를 대체하지 않는다.

## 공용 인증 통합: 기존 모듈 재사용

2026-10-03 같은 날 확인한 SDK 2.117.2와 idb 8.0.3을 유지했다. PR #17의 Google PKCE·플랫폼 화면·저장 코드와 Cloud 원문·발췌·CAS를 통합하며 새 프레임워크나 인증 라이브러리를 도입하지 않았다. 단일 SDK 경로와 공용 세션을 사용하고, 앞 절의 별도 `life_tools_sync_auth_v1:` 세션은 독립 어댑터 검증용에만 남는다. 제품 `life.html`에서는 공용 `HaedoAuth` SDK를 빌려 쓰며 신규 독립 세션을 만들지 않는다. 같은 버전의 배포 원본·라이선스·해시 고정을 재사용했다.

## R2 다중 TXT·Markdown 가져오기 재확인

**2026-10-03 09:58 UTC**에 공식 자료를 다시 조회했다. 결정은 **새 라이브러리 없이**, 사용자가 선택한 `.txt/.md` 파일을 내장 API로 받고 기존 idb·파일별 staging·원자 저장을 재사용하는 것이다.

| 후보·기능 | 실제 확인 근거·한계 | 선택 |
| --- | --- | --- |
| idb **8.0.3 · ISC** | [npm latest](https://registry.npmjs.org/idb), 게시 **2025-05-07 08:12:54 UTC**; [태그 LICENSE](https://github.com/jakearchibald/idb/blob/v8.0.3/LICENSE) 실제 확인. [README](https://github.com/jakearchibald/idb/blob/v8.0.3/README.md)의 여러 store 트랜잭션·`tx.done`과 트랜잭션 중 외부 `await` 금지를 확인 | 동봉 버전 유지. 파일 읽기·해시는 트랜잭션 밖에서 하고, 기존 `saveStage`/`commitLocal` 경계 사용 |
| Obsidian Importer **3.1.11 · MIT** | [최신 릴리스](https://github.com/obsidianmd/obsidian-importer/releases/tag/3.1.11) **2026-10-02 23:06:10 UTC**, [실제 LICENSE](https://github.com/obsidianmd/obsidian-importer/blob/3.1.11/LICENSE), manifest 최소 Obsidian 1.13.0 확인. [README](https://github.com/obsidianmd/obsidian-importer/blob/3.1.11/README.md)는 MD/TXT 가져오기 안내와 community-led 유지관리·Obsidian 팀의 새 기능 추가 비활성을 명시 | 선택·검토·fixture 비교의 설계 참고. Obsidian 플러그인 전체를 웹앱에 넣지 않음. 이번 재확인에서는 MD/TXT 변환 소스를 직접 읽거나 설치·실행하지 않았으므로 변환 동작 검증으로 표현하지 않음 |
| 내장 File·TextDecoder | [multiple](https://github.com/mdn/content/blob/main/files/en-us/web/html/reference/attributes/multiple/index.md), [File](https://github.com/mdn/content/blob/main/files/en-us/web/api/file/index.md), [Blob.arrayBuffer](https://github.com/mdn/content/blob/main/files/en-us/web/api/blob/arraybuffer/index.md), [TextDecoder 생성자](https://github.com/mdn/content/blob/main/files/en-us/web/api/textdecoder/textdecoder/index.md) 공식 MDN 원본 확인. FileList의 여러 File, Promise 읽기 실패, `fatal:true`의 잘못된 UTF-8 거절 지원 | 기존 브라우저 기능 재사용. 새 실행 패키지·라이선스 동봉 없음. 기본 `ignoreBOM:false`는 BOM을 출력에서 제외하므로 원래 파일 바이트의 완전 보존을 주장하지 않음 |

idb와 [Importer](https://github.com/obsidianmd/obsidian-importer/security/advisories)의 공개 security advisories는 확인일에 게시된 권고 없음으로 표시했다([idb 페이지](https://github.com/jakearchibald/idb/security/advisories)). 전체 의존성 감사는 아니다. idb의 GitHub `releases/latest`는 릴리스 목록으로 이동했고 별도 릴리스 날짜·최근 commit 날짜는 확정하지 못했으므로 npm 게시일을 사용하며 유지관리 활성을 단정하지 않는다. 조회는 허용된 공식 npm/GitHub 경로로 했고 새 패키지를 설치하지 않았다.

[Obsidian 공식 도움말](https://github.com/obsidianmd/obsidian-help/blob/master/en/Files%20and%20folders/How%20Obsidian%20stores%20data.md)은 vault note가 평문 Markdown임을 확인해 준다. 이번 범위는 선택 파일의 본문을 그대로 받는 것이며 폴더·vault 탐색, ZIP, frontmatter·wiki 링크 해석, 첨부 미디어 수집은 포함하지 않는다. 파일마다 검토·중복 선택·명시 저장을 하고, 다음 항목의 실패나 취소가 앞서 저장한 자료를 되돌리지 않는다.

iPad Chrome의 실제 다중 선택·Files 제공자 다운로드는 문서 확인으로 증명하지 않았다. 실제 기기에서 읽기 실패·중복·부분 성공·재개를 확인한다. TXT/MD 샘플에서 반복되는 변환·첨부·폴더 요구가 확인되거나 idb의 보안 권고·지원 환경이 바뀔 때만 라이브러리 선택을 재검토한다.

## R2 검색 결과의 원문 버전·구절 복귀

**2026-10-03 UTC**에 공식 npm/GitHub의 안정 버전·실제 배포 LICENSE·공개 권고를 재확인했다. 이번 문제는 여러 버전 중 일치한 본문과 위치 대신 최신 버전을 여는 것이다. 결정은 **새 검색 라이브러리 없이 기존 문자열 검색을 재사용**하고, 결과에 실제 `sourceVersionId`와 원문 UTF-16 locator를 연결하는 것이다. fuzzy·순위·tokenizer·영속 검색 인덱스는 도입하지 않는다.

| 후보 | 최신 안정판·유지관리·라이선스 확인 | 이번 요구와 비교 |
| --- | --- | --- |
| Fuse.js **7.5.0 · Apache-2.0** | [npm](https://registry.npmjs.org/fuse.js) 게시 **2026-07-13 17:23:36 UTC**, [GitHub 릴리스](https://github.com/krisk/Fuse/releases/tag/v7.5.0) **17:19:30 UTC**. [공식 tarball](https://registry.npmjs.org/fuse.js/-/fuse.js-7.5.0.tgz)의 `package/LICENSE` 확인. [공식 commit 조회](https://api.github.com/repos/krisk/Fuse/commits?per_page=1)는 최근 **2026-08-09** | [README](https://github.com/krisk/Fuse/blob/v7.5.0/README.md)의 작은·중간 규모 브라우저 fuzzy 검색과 `includeMatches`는 적합한 후속 후보. 정확한 부분 문자열·원문 추적에는 fuzzy 결과 해석과 위치 변환이 추가되어 이번 도입은 불필요 |
| MiniSearch **7.2.0 · MIT** | [npm](https://registry.npmjs.org/minisearch) 게시 **2025-09-16 12:42:12 UTC**, [고정 태그](https://github.com/lucaong/minisearch/tree/v7.2.0) 일치. [공식 tarball](https://registry.npmjs.org/minisearch/-/minisearch-7.2.0.tgz)의 `package/LICENSE.txt` 확인. [공식 commit 조회](https://api.github.com/repos/lucaong/minisearch/commits?per_page=1)는 최근 **2025-09-16**. `releases/latest` API는 404여서 GitHub 릴리스 게시일은 확정하지 못함 | [README](https://github.com/lucaong/minisearch/blob/v7.2.0/README.md)의 기본 Unicode 공백·구두점 토큰 분리, prefix·fuzzy·필드 순위는 전체 텍스트 검색용. 현재 substring 동작·정확한 원문 구절 locator를 대체하지 않음 |

두 패키지의 해당 npm 버전은 runtime dependencies가 없고, 확인일의 [Fuse](https://github.com/krisk/Fuse/security/advisories)/[MiniSearch](https://github.com/lucaong/minisearch/security/advisories) 공개 advisories는 게시된 권고 없음으로 표시했다. 이것은 전체 보안 감사가 아니다. beta는 선택하지 않았고, 마지막 배포·commit 시각만으로 장기 지원 여부를 단정하지 않는다.

작은 실제 API 비교는 `/tmp/life-search-oss/probe.cjs`에서만 실행했다. 공식 tarball을 registry SHA-512 integrity와 대조한 뒤 원본 배포 파일을 사용했으며 앱 설치·vendor 추가·제품 코드 변경은 하지 않았다. 익명 본문 `🌱 JavaScript 기록`의 `Script` 검색은 native `indexOf`가 옛 버전과 **[7,13)**을 반환했고, Fuse는 **[7,12]** 일치 구간을 반환했다. MiniSearch 기본 토큰 검색에는 결과가 없었다. 오타 `JavaScrpt`는 native 결과가 없지만 Fuse는 fuzzy 결과를 반환했다. 최신 버전으로 잘못 여는 문제는 어느 엔진에서도 버전 연결을 별도로 고쳐야 한다.

locator는 받은 원문에서 계산한다. `İ abc 🌱`는 원문에서 `abc` 시작이 2지만 `toLowerCase()` 후에는 3이므로, 변환 문자열의 index를 원문 위치로 그대로 사용하지 않는다. 대소문자 정책을 정하고 원문 `indexOf` 또는 escape한 literal의 원문 정규식 결과에서 UTF-16 시작·실제 일치 길이를 얻는다. 제목만 일치하거나 본문 미확보이면 본문 구절을 찾았다고 표시하지 않는다.

실제 사용에서 오타 허용·여러 단어 관련도·큰 자료의 검색 지연이 확인될 때만 두 후보를 다시 비교한다. 현재 작은 로컬 bundle에서는 원문 버전·일치 위치·줄바꿈/emoji·옛 버전 일치·본문 없는 링크·대소문자 경계를 먼저 검증한다. 이번 임시 Node API 비교는 실제 Apple 기기나 사용자의 검색 평가가 아니다.

## 네이버 블로그·Instagram 글과 출처 입력 개선

확인일 **2026-10-05 UTC**. 사용자는 다음 입력 개선의 우선 원천으로 네이버 블로그와 Instagram을 선택했다. 이번 조사 범위는 사용자가 가져온 글과 URL을 검토·저장하는 부담을 줄이는 것이다. 서비스 계정 연결, 자동 수집, HTML/계정 ZIP 해석은 별도 요구다.

| 대안 | 이번에 확인한 공식 근거 | 이번 범위의 선택 |
| --- | --- | --- |
| 브라우저 `URL`과 기존 평문 입력·검토·저장 | [MDN URL 원본](https://github.com/mdn/content/blob/main/files/en-us/web/api/url/index.md)은 URL 구성요소 파싱과 `protocol`·`username`·`password`·`searchParams`를 설명한다. [paste 원본](https://github.com/mdn/content/blob/main/files/en-us/web/api/element/paste_event/index.md)은 사용자가 시작한 붙여넣기와 textarea의 기본 삽입을 구분한다. | **기존 구현 재사용**. URL에서 제한적으로 원천을 제안하고, 사용자가 제공한 평문·포함 범위·원문 URL을 기존 staging에서 검토한다. 새 실행 패키지·범용 parser·빌드 단계가 필요하지 않다. |
| Mozilla Readability **0.6.0 · Apache-2.0** | [공식 npm](https://registry.npmjs.org/@mozilla%2Freadability)의 latest는 0.6.0, 게시일 **2025-03-03 21:50:47 UTC**. [태그 LICENSE](https://github.com/mozilla/readability/blob/0.6.0/LICENSE.md)와 [README](https://github.com/mozilla/readability/blob/0.6.0/README.md)를 재확인했다. [main commit 조회](https://api.github.com/repos/mozilla/readability/commits?per_page=1)의 최신 commit은 **2026-07-09**였다. | **후속 HTML 입력 후보로 유지**, 이번에는 도입하지 않는다. 이미 확보한 DOM에서 본문 후보를 추출하므로 URL만으로 원격 본문을 얻는 문제를 해결하지 않는다. 평문을 그대로 보존하는 현재 요구에는 추출·정제·위치 매핑 비용만 추가한다. |
| 네이버 공식 검색 API·Meta Instagram API/oEmbed | 아래 공식 사이트의 현재 문서는 모두 프록시 HTTP 403으로 읽지 못했다. 현행 권한·응답 범위·지원 계정·요금·반출 메뉴를 이번 조사에서 확정하지 않았다. | **도입 보류**. 확인하지 못한 API를 일반 게시물 본문 수집 API로 간주하지 않는다. 계정 연결·서버·비밀값 관리가 필요한지까지 공식 조건과 실제 샘플로 확인한 뒤 별도 비교한다. |

Readability의 GitHub `releases/latest` API는 **404**였으므로 GitHub 릴리스 게시일을 새로 확인했다고 쓰지 않는다. npm 게시 정보와 고정 태그를 기준으로 했다. [공식 공개 보안 권고 API](https://api.github.com/repos/mozilla/readability/security-advisories)에는 [GHSA-3p6v-hrg8-8qj7](https://github.com/mozilla/readability/security/advisories/GHSA-3p6v-hrg8-8qj7)가 있으며 영향 `<0.6.0`, 수정 `0.6.0`을 재확인했다. 해당 README는 Readability가 sanitizer가 아니며 비신뢰 HTML 출력에 sanitizer와 CSP를 권고한다. 이번에는 설치·실행·의존성 전체 감사를 하지 않았다. 최근 commit이나 권고 한 건의 확인을 무취약성 보증으로 표현하지 않는다.

직접 읽지 못한 공식 경로는 [네이버 블로그 검색 API](https://developers.naver.com/docs/serviceapi/search/blog/blog.md), [네이버 블로그 도움말](https://help.naver.com/service/5593), [Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login), [Instagram oEmbed](https://developers.facebook.com/docs/instagram-platform/oembed), [Instagram 정보 다운로드 도움말](https://www.facebook.com/help/instagram/181231772500920)이다. 모두 TLS 검증을 유지한 요청에서 프록시 연결 403으로 실패했다. 이를 서비스 장애나 해당 기능의 부재로 해석하지 않는다. 허용 경로를 우회하거나 사용자 계정·게시물을 조회하지 않았다.

### 원문 URL 보존과 제한적인 제안

URL은 원문 재추적 자료다. **저장된 원문 URL을 조용히 고쳐 쓰지 않는다.** 입력 중 원천 제안과 저장할 출처 값은 구분한다. `URL` 파싱은 문자열 정규식으로 호스트를 추측하는 일을 줄일 뿐, 주소의 실제 존재·게시물 공개 여부·본문 일치를 증명하지 않는다.

- HTTP(S)와 정확한 호스트를 구분한다. `blog.naver.com`·`m.blog.naver.com`, `instagram.com`·`www.instagram.com`을 확인하며 유사 도메인, 다른 suffix, 사용자명/비밀번호가 들어간 주소에 출처 제안을 표시하지 않는다.
- 네이버 `/{blogId}/{숫자}`와 `/PostView.naver?blogId=…&logNo=…`, Instagram `/p/{shortcode}`와 `/reel/{shortcode}` 같은 형태의 분류는 **이번에 채택하지 않은 후속 후보**다. 현재 구현은 호스트로 원천만 제안하며 게시물 경로를 판정하지 않는다. 이번 공식 문서 접근으로 영속 식별자 계약을 확인한 것은 아니다. 이 형태만으로 새 원문 ID·중복 병합 기준을 만들지 않는다.
- 네이버 `blogId`·`logNo`와 모르는 query/hash를 보존한다. Instagram의 공유 query도 자동 삭제하지 않는다. 추적값으로 보이는 값이 있어도 원형 보존이 기본이며, 향후 정리 기능은 원래 URL을 보존하고 사용자가 확인하는 별도 제안이어야 한다.
- `naver.me`, Instagram 공유·프로필·미확인 경로는 URL 그대로 받을 수 있어도 게시물 주소로 자동 확장하지 않는다. 리다이렉트 확인이나 본문 조회를 위해 외부 요청을 추가하지 않는다. 가져온 본문을 그대로 두고 제목·출처·포함 범위만 사용자가 검토한다.
- URL만 받으면 본문 미확보 상태를 유지한다. 텍스트가 있다고 자동으로 전체 본문이라고 판단하지 않는다. 사용자가 이미 고친 제목·원천·포함 범위를 뒤늦은 URL 제안이 덮어쓰지 않게 한다.

[MDN CORS 공식 원본](https://github.com/mdn/content/blob/main/files/en-us/web/http/guides/cors/index.md)은 다른 origin의 응답을 script가 읽으려면 서버가 허용하는 CORS 헤더가 필요하다고 설명한다. service worker·Readability·붙여넣기 개선이 이 권한을 대신하지 않는다. 이번 조사에서는 네이버·Instagram 실제 게시물 응답의 CORS, URL 리다이렉트, 실제 Apple 기기의 복사 메뉴를 검사하지 않았다.

반대 검토: 원천 추론이 잘못되면 수동 수정 가능하고 기존 평문 입력으로 끝낼 수 있어야 한다. 더 단순한 기본 경로인 글+URL 직접 입력을 남긴다. 실제 iPad/iPhone에서 복사한 한 건의 본문·출처 대조와 링크 다시 열기를 다음 기기 체험에서 확인하며, 반복되는 누락·HTML 입력·공식 export 요구가 확인될 때만 parser/API 연결을 다시 비교한다. 이번 문서 조사는 기능·브라우저·기기 검증 결과를 대신하지 않는다.

## 활동·내 페이지·돌아보기의 최소 로컬 구성

**2026-10-05 UTC**에 공식 npm registry와 GitHub를 실제로 조회했다. 이번 요구는 보관한 원문의 특정 버전을 활동으로 묶고, 별도로 구성한 내 페이지와 돌아보기를 같은 계정·작업공간에서 다시 여는 것이다. **기존 idb 8.0.3, native DOM과 `Core.searchSources()`를 재사용**한다. 구성 전용 revision과 원자적인 통합 사본 복원을 추가하는 범위이며, 새 에디터·라우터·저장 라이브러리는 도입하지 않는다.

### 배포·유지관리·라이선스 비교

| 후보 | 이번 실제 조회 결과 | 요구와 비교·선택 |
| --- | --- | --- |
| **idb 8.0.3 · ISC** | [npm latest](https://registry.npmjs.org/idb)는 **8.0.3**, 게시 **2025-05-07 08:12:54 UTC**. [공식 태그](https://github.com/jakearchibald/idb/tree/v8.0.3) 존재와 [배포 tarball](https://registry.npmjs.org/idb/-/idb-8.0.3.tgz)의 `package/LICENSE`를 확인했다. [최근 기본 브랜치 commit](https://github.com/jakearchibald/idb/commit/77dd8bebf3669bbce9628e470a021ff63eb4acaf)은 **2025-05-07 08:10:45 UTC**이며 저장소는 archived/disabled가 모두 false였다. | **동봉판 그대로 사용**. 기존 여러 store 트랜잭션과 `tx.done` 경계를 확장할 수 있다. 작은 래퍼를 새로 만들거나 이미 검증한 저장 경계를 교체할 필요가 없다. 마지막 commit 시각만으로 장기 지원이나 활발한 유지관리를 보장하지 않는다. |
| **Dexie 4.4.6 · Apache-2.0** | [npm latest](https://registry.npmjs.org/dexie)는 **4.4.6**, 게시 **2026-09-10 13:26:36 UTC**. [공식 안정 릴리스](https://github.com/dexie/Dexie.js/releases/tag/v4.4.6)는 같은 날 **13:45:16 UTC**이며 prerelease가 아니다. [태그](https://github.com/dexie/Dexie.js/tree/v4.4.6)와 [배포 tarball](https://registry.npmjs.org/dexie/-/dexie-4.4.6.tgz)의 `package/LICENSE`를 확인했다. [최근 commit](https://github.com/dexie/Dexie.js/commit/9282725a40bb659dca8e5971970243ef48238811)은 **2026-09-28 07:30:55 UTC**이며 archived/disabled가 모두 false였다. | **대안으로 검토하고 이번에는 도입하지 않음**. 선언적 스키마·인덱스 조회·버전 이전·여러 테이블 트랜잭션은 유용하지만, 이번 구성은 기존 `meta` store와 bundle을 함께 다루면 된다. 저장 API 교체와 회귀 검증 부담에 비해 현재 필요한 추가 기능이 없다. Dexie Cloud도 도입하지 않는다. |
| 브라우저 native DOM·기존 검색/저장 모듈 | 현재 `assets/life/ui.js`의 `createElement`·`textContent`·입력 컨트롤과 `Core.searchSources()`의 원문 버전별 검색 계약을 확인했다. | **기존 코드 재사용**. 선택·제목·메모·표시/정렬 구성에는 서식 에디터나 새 라우터가 필요하지 않다. 검색 결과의 버전·구절을 그대로 전달하고, HTML 변환·새 검색 인덱스·원시 IndexedDB 래퍼 자체 구현을 추가하지 않는다. |

두 tarball은 npm metadata의 SHA-512 integrity와 실제 내려받은 바이트가 일치했다. idb의 `package/build/umd.js`와 LICENSE는 현재 동봉 파일과 바이트가 같고, UMD SHA-256은 `ff4b3763d5b8e7981f606cb3d46df37ac5b7fc1d4b4eca34da129b47219edd59`다. 기존 [배포 고지](../../vendor/idb/README.md)와 [ISC LICENSE](../../vendor/idb/LICENSE)를 유지한다. npm package 설치·vendor 교체·배포 코드 실행은 하지 않았다. 해당 두 버전의 npm metadata에는 runtime dependencies가 없었다.

idb의 [GitHub `releases/latest`](https://api.github.com/repos/jakearchibald/idb/releases/latest)는 HTTP 404였으므로 GitHub 릴리스 게시일을 확인했다고 쓰지 않는다. npm 게시 정보·태그·실제 배포 파일을 근거로 했다. [idb 공개 보안 권고 API](https://api.github.com/repos/jakearchibald/idb/security-advisories)와 [Dexie 공개 보안 권고 API](https://api.github.com/repos/dexie/Dexie.js/security-advisories)는 조회 시 모두 빈 배열을 반환했다. 이는 해당 저장소에 공개된 권고를 조회한 결과이며, 미공개 문제·전체 취약점 데이터베이스·모든 의존성을 감사했거나 취약점이 없다는 보증이 아니다.

### 저장 계약에 적용할 경계

[idb 8.0.3 README](https://github.com/jakearchibald/idb/blob/v8.0.3/README.md)는 `tx.done`을 전체 트랜잭션의 성공 커밋 신호로 설명한다. 개별 `put()` 성공을 구성 저장 완료로 표시하지 않는다. 파일 읽기·해시 등 다른 비동기 작업은 트랜잭션 전에 끝내고, 내부에서는 IndexedDB 요청만 이어 간다. [Dexie 트랜잭션 문서](https://github.com/dexie/dexie-website/blob/master/docs/Dexie/Dexie.transaction%28%29.md)도 최상위 transaction Promise의 완료와 외부 비동기 대기 시 자동 커밋 문제를 명시한다. 따라서 라이브러리를 바꿔도 계정 검사·revision 충돌·복원 범위의 제품 계약은 별도로 필요하다.

- **계정·작업공간:** 기존 저장소의 계정 범위 검사와 bundle 소유권 확인을 재사용한다. IndexedDB 라이브러리가 인증이나 계정 격리를 제공한다고 가정하지 않는다. 계정이 바뀌어 닫힌 화면의 늦은 저장·읽기 결과도 기존 scope 경계에서 다룬다.
- **활동과 페이지:** 활동은 선택한 `sourceVersionId`를 고정 참조한다. 내 페이지의 선택·순서·표시 설정은 활동 배열과 별도 사본으로 편집하되 원문 버전은 계속 추적한다. 참조가 사라지면 누락으로 표시하고 최신 버전으로 조용히 바꾸지 않는다. 검색은 `Core.searchSources()`의 일치 버전·위치를 재사용한다.
- **독립 revision:** 구성은 기존 `meta` store에서 별도 revision으로 저장한다. 같은 readwrite 트랜잭션에서 소유권과 기준 revision을 확인하고 다음 revision을 확정한다. 구성 변경만으로 원문 bundle revision이나 기존 동기화 큐를 갱신하지 않는다. 이번에는 구성의 기기 간 자동 동기화를 지원한다고 표시하지 않는다.
- **통합 사본 복원:** 기존 원문 백업 검증과 새 구성 검증·ID 참조 재연결을 먼저 끝낸 뒤, 새 bundle·구성·소유권·활성 작업공간을 한 트랜잭션으로 설치한다. 부분 성공으로 한쪽만 남기지 않고 기존 작업공간은 보존한다. 기존 자료 전용 백업과 구성 포함 백업은 구분한다.
- **변경 범위:** 기존 IndexedDB의 store/DB schema version, Core bundle 형식, Supabase SQL·원격 동기화 형식을 바꾸는 근거로 이 조사를 사용하지 않는다. 새 로컬 구성 계약의 허용 필드·실패 복구·원자성 검증은 앱 구현에서 별도로 수행한다.

반대 검토: 페이지를 구성하려고 원문을 다시 복사·편집하거나 동기화 형식 전체를 확장하면 현재 필요보다 변경 범위가 커진다. 기존 자료를 읽고 선택한 버전을 참조하는 작은 로컬 구성으로 먼저 완결한다. 실제 사용에서 복잡한 인덱스 조회·반응형 구독·반복되는 스키마 이전 문제가 확인되거나 보안 권고·지원 환경이 달라지면 Dexie를 다시 비교한다. 이번 공식 문서·배포 파일 확인은 앱의 계정 전환·동시 탭 충돌·용량 부족·사본 복원 테스트 및 실제 Apple 기기 검증을 대신하지 않는다.

## 선택한 사본의 공개 게시 — 기존 Supabase와 별도 CMS 비교

**2026-10-05 UTC**에 공식 GitHub API·고정 릴리스 태그·npm registry를 다시 확인했다. 이번 사용 장면은 내 페이지의 표시 설정과 선택한 본문을 확인한 뒤 **공개 사본 한 개를 게시하고, 같은 주소에서 명시적으로 갱신하거나 철회**하는 것이다. 철회 후 재게시는 새 주소를 받아 이전 주소를 계속 차단한다. 개인 작업공간·백업 전체를 익명으로 읽게 하거나 SNS 원본에 쓰는 기능은 포함하지 않는다. 아래는 도입 판단과 검증할 설계이며 실제 SQL 설치·운영 게시 완료 보고가 아니다.

### 공식 배포·유지보수와 적합성

| 후보 | 확인한 안정판·라이선스·유지보수 | 해도의 이번 요구와 결정 |
| --- | --- | --- |
| **Supabase JS 2.117.2 · MIT** + 기존 관리형 Supabase | [공식 릴리스](https://github.com/supabase/supabase-js/releases/tag/v2.117.2) **2026-09-25 10:05:55 UTC**, [npm latest](https://registry.npmjs.org/@supabase%2Fsupabase-js) 같은 버전·게시 **10:08:51 UTC**. [고정 태그 LICENSE](https://github.com/supabase/supabase-js/blob/v2.117.2/LICENSE) 본문 확인. [기본 브랜치 최근 commit](https://github.com/supabase/supabase-js/commit/cb7682857665fd9e83cfae4212f8d1550370b41c)은 **2026-10-02**. | **기존 동봉판과 검증된 공용 인증을 재사용**한다. 소유자는 기존 계정으로 전용 RPC에 선택 사본만 보낸다. 방문자는 공개 사본 조회만 수행하며 개인 계정 저장소를 열지 않는다. 새 CMS·별도 SDK·두 번째 로그인 세션을 추가할 이유가 없다. |
| **PostgREST 16.4 · MIT** | [공식 안정 릴리스](https://github.com/PostgREST/postgrest/releases/tag/v16.4) **2026-09-24 05:31:39 UTC**, [고정 태그 LICENSE](https://github.com/PostgREST/postgrest/blob/v16.4/LICENSE) 확인. [최근 commit](https://github.com/PostgREST/postgrest/commit/d42ae9d55d12989cdc2f0fda8d551b07af4e6ab5)은 **2026-10-04**. | **Supabase의 기존 PostgreSQL/RPC 경로를 이용하는 설계 근거**다. 별도 서버를 설치하거나 업그레이드하지 않는다. 이 버전은 upstream 최신 조회이며, 현재 해도 프로젝트가 실행하는 관리형 PostgREST 버전을 확인한 결과가 아니다. |
| **Ghost 6.67.0 · MIT** | [공식 안정 릴리스](https://github.com/TryGhost/Ghost/releases/tag/v6.67.0) **2026-09-29 17:23:19 UTC**, [npm](https://registry.npmjs.org/ghost) 게시 **17:40:56 UTC**. [고정 태그 LICENSE](https://github.com/TryGhost/Ghost/blob/v6.67.0/LICENSE)·[README](https://github.com/TryGhost/Ghost/blob/v6.67.0/README.md) 확인. [최근 commit](https://github.com/TryGhost/Ghost/commit/43e2122dcb50efb34c870f93c08b399ddeda29d7)은 **2026-10-05**. | **도입하지 않음.** 완성된 발행·편집 제품은 장점이지만, 이번 작은 공유 사본에 별도 Node 서버·배포·업데이트·CMS 계정과 콘텐츠 저장 경계를 더한다. Ghost 편집 데이터와 해도의 불변 원문/선택 구성 사이의 변환·동기화도 필요하다. 독립 출판 서비스·회원/뉴스레터 운영이 실제 요구가 되면 재검토한다. |
| **Decap CMS 3.16.3 · MIT** | [공식 안정 릴리스](https://github.com/decaporg/decap-cms/releases/tag/decap-cms%403.16.3) **2026-09-22 12:51:56 UTC**, [npm](https://registry.npmjs.org/decap-cms) 게시 **12:49:24 UTC**. [고정 태그 LICENSE](https://github.com/decaporg/decap-cms/blob/decap-cms%403.16.3/LICENSE)·[README](https://github.com/decaporg/decap-cms/blob/decap-cms%403.16.3/README.md) 확인. [최근 commit](https://github.com/decaporg/decap-cms/commit/1d5868347d3d8648d7d5f7f59fc1b46595881b29)은 **2026-09-22**. | **도입하지 않음.** Git 저장소의 콘텐츠를 편집하는 정적 사이트 CMS다. 해도의 계정별 자료에서 고른 공유 사본을 위해 Git 인증·커밋·사이트 재배포와 별도 편집 화면을 추가하게 된다. 공개 Git 이력에 사본을 넣으면 현재 DB 조회를 차단하는 철회와 보존/삭제 모델도 달라진다. Git을 원본 콘텐츠 저장소로 운영할 별도 요구가 생길 때 재검토한다. |

조회한 네 저장소는 모두 `archived=false`, `disabled=false`였다. 최근 commit과 안정판 존재는 확인 사실이며 장기 지원이나 모든 배포의 안전을 보증하지 않는다. 설치하지 않은 Ghost/Decap의 전체 의존성 감사를 수행한 것으로 보고하지 않는다. Supabase 동봉 파일의 기존 무결성 기록은 [vendor 안내](../../vendor/supabase/README.md)에 있다. 이번에는 앱 런타임 의존성을 추가하지 않는다.

### 공개 보안 권고와 재사용 경계

[Supabase JS](https://api.github.com/repos/supabase/supabase-js/security-advisories)와 [PostgREST](https://api.github.com/repos/PostgREST/postgrest/security-advisories)의 해당 저장소 공개 보안 권고 API는 조회 시 빈 배열을 반환했다. 미공개 문제·다른 데이터베이스·전체 전이 의존성까지 검사했거나 취약점이 없다는 뜻은 아니다.

[Ghost 공개 권고](https://github.com/TryGhost/Ghost/security/advisories)에서 2026-10-01 공개된 가져오기 SVG의 저장형 XSS([GHSA-hqq2-xqr2-fmx2](https://github.com/TryGhost/Ghost/security/advisories/GHSA-hqq2-xqr2-fmx2), 영향 `>=4.0.0,<6.67.0`)와 embed 미리보기 XSS([GHSA-69qc-f5m6-889c](https://github.com/TryGhost/Ghost/security/advisories/GHSA-69qc-f5m6-889c), 영향 `>=6.34.0,<6.67.0`)를 확인했으며 두 권고의 수정 버전은 **6.67.0**이다. 이는 Ghost를 위험한 제품으로 분류하는 근거가 아니라, 미디어·embed·HTML 가져오기를 추가할 때 함께 생기는 유지관리 범위를 보여준다. 해도의 첫 공개 사본은 평문을 DOM `textContent`로 표시하고 원격 미디어·embed·비신뢰 HTML을 실행하지 않는 범위로 한정한다.

[Decap 공개 권고](https://github.com/decaporg/decap-cms/security/advisories)에는 Bitbucket OAuth refresh token의 URL 노출([GHSA-jm5q-pq3r-26g9](https://github.com/decaporg/decap-cms/security/advisories/GHSA-jm5q-pq3r-26g9), `decap-cms <=3.15.1` 영향, **3.16.0** 수정)과 별도 `decap-server`의 저장소 경계 path traversal([GHSA-5rrq-v82w-qpfr](https://github.com/decaporg/decap-cms/security/advisories/GHSA-5rrq-v82w-qpfr), `<=3.10.0` 영향, **3.11.0** 수정)이 있었다. 이번에 Decap 인증·로컬 서버를 추가하지 않으며 두 패키지를 동일한 버전으로 취급하지 않는다.

### 채택한 설계와 검증해야 할 비용

공개 기능 자체를 새 CMS로 만들지 않고 **기존 인증·저장·RPC 기반을 재사용하며 해도에 필요한 선택 사본과 게시 경계만 구현**한다. 별도 서버 운영과 편집 데이터 이중화를 줄이는 대신, 아래 앱 고유 계약의 구현·회귀 검증을 직접 유지해야 한다.

- **개인 자료와 공개 사본을 분리한다.** 전송 스키마는 페이지 제목·허용한 소개·표시할 항목·선택 본문/구절·페이지용 코멘트·출처 정보만 허용한다. 계정·작업공간·내부 원문/버전 ID, 원문 hash, 개인 기록의 메모와 회고, 미선택 항목을 제외한다. 정확한 버전을 찾을 수 없는 선택 항목은 다른 버전으로 대체하거나 일부만 조용히 게시하지 않는다.
- **익명 사용자는 공개 식별자 한 개로 사본만 읽는다.** 개인 원문 테이블, 소유자 상태, 공개 사본 목록을 조회할 권한을 주지 않는다. 소유자 RPC는 서버의 `auth.uid()`에서 계정을 정하며 클라이언트의 소유자 주장을 받지 않는다. 소유자에게만 공개본의 관리용 목록을 제공하여 원래 로컬 구성을 잃어도 철회할 수 있게 한다. 이 복구 경로는 공개 본문/개인 초안 동기화와 별개다. 함수의 기본 실행 권한과 직접 테이블 권한을 함께 막아야 한다. [Supabase 공식 함수 지침](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/database/functions.mdx)은 기본 `security invoker`를 권하며, 필요한 `security definer`에는 제한한 `search_path`와 스키마 명시, `PUBLIC`/역할별 `EXECUTE` 철회를 설명한다. 이번 목적을 위해 기존 앱 함수 전체 권한을 일괄 변경하지 않는다.
- **재시도·동시 수정과 철회를 함께 다룬다.** 서버 revision 비교와 operation ID/요청 내용 일치 검사로 중복 쓰기를 막는다. 응답을 받지 못한 요청은 같은 ID·같은 선택 사본으로 다시 확인한다. 과거 게시 요청의 영수증을 재생해도 철회 후 사본이 되살아나면 안 된다. 이미 처리된 과거 응답과 현재 서버 상태가 다를 수 있으므로 사용자에게 완료를 표시할 때 현재 게시 상태를 다시 확인한다.
- **캐시가 철회를 뒤집지 않도록 한다.** 공개 데이터 응답과 클라이언트 요청의 캐시를 금지하고 서비스워커의 공개 사본 저장을 제외한다. [PostgREST 공식 응답 헤더 지침](https://github.com/PostgREST/postgrest/blob/v16.4/docs/references/transactions.rst#response-headers)의 `response.headers`와 `Cache-Control: no-cache, no-store, must-revalidate`를 검토 근거로 쓴다. 실제 관리형 HTTP 응답 헤더·철회 뒤 재접속은 별도로 검증해야 한다. 방문자가 이미 읽거나 외부에 저장한 사본까지 회수할 수 있다고 표현하지 않는다.
- **게시 전 실제 전송 내용을 보여준다.** 본문을 선택하지 않아도 제목·URL·작성자 표시는 공개 사본에 포함될 수 있다. 원문 URL의 쿼리를 조용히 바꾸는 대신 공개할 출처 주소를 확인할 수 있게 하고, 방문자 외부 링크는 `noopener noreferrer` 등으로 공개 페이지 주소의 불필요한 전달을 줄인다. 자동 가져오기·로컬 표시 변경을 실제 게시/갱신 승인으로 취급하지 않는다.

확인·자료 수집은 상속된 프록시와 TLS 검증을 유지한 공식 GitHub/npm HTTPS 요청으로 수행했다. 운영 DB·실제 계정·개인 자료는 이 조사에 사용하지 않았다. 로컬 모델/SQL/브라우저 검사와 관리형 Supabase의 실제 설치·HTTP 권한 검사, 공개 배포는 각각 별도 완료 조건이다.

## 직접 글쓰기 — 기본 textarea와 편집기 비교

확인일 **2026-10-05 UTC**. 이번 시작 조건은 로그인한 사용자가 현재 작업공간에서 제목·평문 본문을 쓰고, 초안을 다시 열거나 기록으로 저장하는 것이다. 저장한 글은 기존 읽기·검색·원문 버전·발췌·백업 흐름에 연결하며, 글쓰기만으로 공개 사본을 게시하거나 SNS에 전송하지 않는다. 서식 편집·공동 편집·Markdown 미리보기는 이번 요구가 아니다. 아래는 구현 선택과 검증할 계약이며 직접 글쓰기 구현 완료 보고가 아니다.

**결정: 기존 공통 필드와 native `<textarea>`를 재사용하고 편집기 패키지는 추가하지 않는다.** `assets/life/ui.js`의 `field()`와 본문 입력·원문 선택에 이미 textarea가 있다. 편집 화면을 새로 구성하더라도 브라우저 기본 편집·선택 기능 위에 해도의 초안·불변 저장본 연결만 구현한다. 이 선택이 한글 IME·초안 복구·계정 분리까지 자동으로 해결한다는 뜻은 아니다.

### 공식 배포·라이선스·유지관리

공식 npm의 `latest`와 배포 시각, 실제 tarball의 LICENSE·README·가능한 CHANGELOG를 읽었다. 세 tarball 모두 registry의 SHA-512 integrity와 대조했으며 설치·실행·전역 설정·런타임 의존성 추가는 하지 않았다. CodeMirror 6과 ProseMirror는 모듈마다 버전이 다르므로 아래 숫자는 비교한 **DOM 편집 모듈**의 버전이다.

| 대안 | 확인한 공식 배포와 유지관리 | 해도와의 적합성·선택 |
| --- | --- | --- |
| **브라우저 `<textarea>` + 기존 필드** | [MDN 공식 원본](https://github.com/mdn/content/blob/main/files/en-us/web/html/reference/elements/textarea/index.md), [WHATWG HTML 원본](https://github.com/whatwg/html/blob/main/source)의 textarea API 값·선택 규칙 확인. 별도 패키지 라이선스나 배포 버전을 추가하지 않으며 사용자의 브라우저 업데이트와 실제 기기 검증을 따른다. | **재사용.** 평문 작성·기본 선택·붙여넣기·키보드 입력에 맞고 기존 UI 토큰·레이블·계정별 저장을 유지한다. 입력 중 전체 DOM 교체와 `.value` 재설정을 피한다. 초안 저장·충돌·이탈·재개는 앱에서 별도로 구현·검증한다. |
| **CodeMirror 6 — `@codemirror/view` 6.43.13 · MIT** | [npm](https://registry.npmjs.org/@codemirror%2Fview) 게시 **2026-09-22 07:16:47 UTC**, [배포 tarball](https://registry.npmjs.org/@codemirror/view/-/view-6.43.13.tgz)의 `LICENSE`·`CHANGELOG.md` 확인. 6.43.12는 조합 중 DOM·Firefox composition·VoiceOver 보완, 6.43.11은 iOS Enter/Backspace 처리를 기록한다. [기존 GitHub README](https://github.com/codemirror/view/blob/fbff59ba004d80d8c914f64c42586387b08706ac/README.md)는 `code.haverbeke.berlin/codemirror/view`로 이전했음을 명시한다. | **현재 제외, 고급 평문/Markdown 편집의 후속 후보.** 일반 JS에서 사용할 수 있고 텍스트 편집에 더 가까운 선택이다. 다만 DOM view 외에도 state·스타일·키 처리 모듈을 추가하고 번들 또는 동봉 배포를 관리해야 한다. 지금 필요하지 않은 코드 편집·확장 구조의 비용을 먼저 부담할 이유가 없다. |
| **Tiptap Core 3.31.4 · MIT** | [npm](https://registry.npmjs.org/@tiptap%2Fcore) 게시 **2026-09-30 13:16:54 UTC**, [GitHub 릴리스](https://github.com/ueberdosis/tiptap/releases/tag/v3.31.4) **12:56:57 UTC**. [tarball](https://registry.npmjs.org/@tiptap/core/-/core-3.31.4.tgz)의 `LICENSE.md` 확인. [최근 commit](https://github.com/ueberdosis/tiptap/commit/13675ea215a33dfc39819fd42a5f87e3118b13f2)은 **2026-10-02**이며 저장소는 archived/disabled 모두 false다. | **현재 제외.** [공식 README](https://github.com/ueberdosis/tiptap/blob/v3.31.4/README.md)대로 일반 JS도 지원하므로 React가 필수여서 제외하는 것은 아니다. ProseMirror 기반 문서 스키마·확장·HTML/Markdown 변환과 `@tiptap/pm` peer를 관리할 필요가 생긴다. 서식 없는 글을 기존 불변 평문에 연결하는 첫 단위에는 추가 이득이 작다. |
| **ProseMirror View 1.42.6 · MIT** | [npm](https://registry.npmjs.org/prosemirror-view) 게시 **2026-09-25 17:10:10 UTC**, [tarball](https://registry.npmjs.org/prosemirror-view/-/prosemirror-view-1.42.6.tgz)의 `LICENSE`·`CHANGELOG.md` 확인. 1.42.6은 Safari/Firefox 커서 위치, 1.42.4는 선택 구간에서 시작한 composition 수정을 기록한다. [기존 GitHub README](https://github.com/ProseMirror/prosemirror-view/blob/ca4c78e9b56f1b164c0b3758b59d8748f11b7534/README.md)는 `code.haverbeke.berlin/prosemirror/prosemirror-view/`로 이전했음을 명시한다. | **현재 제외.** 일반 JS로 직접 통합할 수 있는 문서 스키마·트랜잭션·contentEditable 기반 편집 도구다. `prosemirror-model/state/transform`과 스키마·키맵·직렬화 설계를 앱에서 관리해야 한다. 구조화된 서식 문서의 위치를 기존 평문 UTF-16 구간으로 바꾸는 계약도 별도로 필요하다. |

CodeMirror/ProseMirror의 기존 GitHub 저장소는 `archived=true`였고 `releases/latest`는 각각 404였다. 이를 유지관리 중단이나 최신 배포 없음으로 해석하지 않았다. **이전 안내와 2026년 9월 npm 배포·배포 CHANGELOG**를 근거로 했으며, 옮긴 서버의 최신 commit·전체 이슈 상태까지 조회한 것은 아니다. Tiptap과 ProseMirror는 독립적인 세 가지 문서 엔진 중 둘이 아니라 상위 편집 도구와 그 기반 도구의 비교다. 최근 배포가 있다고 해도의 한글 입력·저장 계약까지 검증된 것은 아니다.

### 보안 권고를 읽은 범위

- **CodeMirror:** [기존 view 저장소 공개 권고](https://api.github.com/repos/codemirror/view/security-advisories)와 GitHub 공식 전체 권고의 [`@codemirror/view`](https://api.github.com/advisories?ecosystem=npm&affects=%40codemirror%2Fview&per_page=100)·[`@codemirror/state`](https://api.github.com/advisories?ecosystem=npm&affects=%40codemirror%2Fstate&per_page=100) 조회는 빈 목록이었다. 패키지명으로 확인한 공개 권고 범위이며, 이전한 서버의 모든 보안 정보·전이 의존성·미공개 문제의 감사는 아니다.
- **ProseMirror View:** [GHSA-c8x8-7fp4-3x9w](https://github.com/ProseMirror/prosemirror-view/security/advisories/GHSA-c8x8-7fp4-3x9w)는 **2026-08-25** 공개된 붙여넣기 HTML의 XSS다. 영향 `<1.42.3`, 수정 **1.42.3**으로 명시되며 실제 1.42.3 CHANGELOG에도 clipboard slice context의 속성 검증 추가가 기록돼 있다. 조사한 최신 버전은 1.42.6이다. 이는 편집기 전체를 위험하다고 분류하는 근거가 아니라 HTML 붙여넣기·스키마·속성 검증을 채택하면 함께 관리할 경계를 보여준다.
- **Tiptap Core:** 공식 [GHSA-cp6q-959q-f8rh](https://github.com/ueberdosis/tiptap/security/advisories/GHSA-cp6q-959q-f8rh)는 비신뢰 속성 병합과 DOM 속성 처리, [GHSA-j95f-988m-3j2f](https://github.com/ueberdosis/tiptap/security/advisories/GHSA-j95f-988m-3j2f)는 Markdown 속성 parser의 ReDoS를 다룬다. API의 `patched_versions`는 각각 **3.30.4**, **3.30.5**다. 다만 같은 권고의 영향 범위에는 상한이 없고 설명 일부는 발견 당시의 미수정 상태를 담고 있어, 이 조회만으로 현행 모든 경로의 안전을 보증하지 않는다. 별도 [CollaborationCaret 권고](https://github.com/ueberdosis/tiptap/security/advisories/GHSA-pmh9-4rj3-c67g)는 `@tiptap/extension-collaboration-caret <=3.31.2`, 수정 `>=3.31.3`이며 Core 단독과 구분했다. 이번에는 해당 편집기·Markdown 해석·공동 편집 확장을 도입하지 않는다.

해도의 새 평문 입력은 `.value`로 읽고 원문 표시는 기존 `Text`/`textContent` 경로를 따른다. 입력을 `innerHTML`·Markdown HTML로 해석하거나 외부 embed를 실행하지 않는다. 그렇더라도 계정 경계·저장 유효성·본문 크기·복원 검사는 별도로 필요하다. 이번 조사는 패키지를 설치한 전체 의존성 감사나 실제 취약점 재현 검사가 아니다.

### textarea를 선택해도 직접 지켜야 하는 계약

1. **초안과 불변 원문 버전을 구분한다.** 미완성 입력을 초안에 보관하고, 명시적 기록 저장은 그때 확정한 문자열의 새 버전을 만든다. 수정으로 예전 버전·이미 저장한 발췌 위치·페이지 사본을 덮어쓰지 않는다. 기본 편집기의 undo가 앱 저장 이력·백업·충돌 복구를 대신하지 않는다.
2. **줄바꿈과 UTF-16 기준을 섞지 않는다.** WHATWG 원문의 textarea API 값은 줄바꿈을 LF로 정규화하며 선택 위치는 해당 값의 code unit을 기준으로 한다. 새 직접 작성본은 저장 때 확정한 `textarea.value`를 기준으로 하고, 저장 뒤 공백 trim·Unicode 정규화·HTML/Markdown 왕복 변환을 추가하지 않는다. `trim()`은 빈 입력 여부 판단에만 사용할 수 있다. 기존 가져온 CRLF 원문을 textarea에 넣었다는 이유로 다시 직렬화하거나, 정규화한 초안의 선택 위치를 옛 원문의 위치로 재사용하지 않는다.
3. **한글 조합 중 화면과 값을 재설정하지 않는다.** [InputEvent.isComposing](https://github.com/mdn/content/blob/main/files/en-us/web/api/inputevent/iscomposing/index.md)·[KeyboardEvent.isComposing](https://github.com/mdn/content/blob/main/files/en-us/web/api/keyboardevent/iscomposing/index.md)와 composition 시작/종료를 고려한다. Enter는 본문 줄바꿈이며 조합 확정과 저장 단축키를 혼동하지 않는다. 조합 중 저장 버튼·이동·자동 초안 저장이 겹칠 때 마지막 글자가 사라지지 않는지 검증한다. 값 변화마다 textarea를 새로 만들거나 앱이 선택 구간을 되돌리는 방식을 피한다.
4. **초안은 계정·작업공간에 묶는다.** 저장 실패면 현재 입력을 유지하고 성공한 것처럼 닫지 않는다. 늦은 저장/읽기 응답이 새 계정·새 작업공간·다른 초안을 덮지 않게 한다. 새 글과 기존 글 수정의 충돌·중복 클릭·용량 부족·재열기·사본 복원 결과를 구별한다. 로컬 저장 완료와 원격 동기화 완료도 구분한다.
5. **브라우저 기본 편집을 실제 입력으로 확인한다.** 한글 조합·선택 후 교체·붙여넣기·되돌리기·emoji/결합 문자·빈 줄·긴 본문, 조합 중 저장/이탈을 대표 사례로 삼는다. Mac/iPad/iPhone의 IME·소프트 키보드·선택 손잡이·앱 복귀는 자동 Chromium 폭 검사나 synthetic composition 이벤트만으로 통과라고 보고하지 않는다. 조사 담당은 편집기 실행·브라우저·실기 검사를 수행하지 않았으며 구현 담당이 이 계약을 검증한다.

실제 사용에서 긴 문서의 편집 지연, Markdown 구문 이동·접기, 필요한 서식·블록 편집처럼 **native 입력으로 해결하지 못한 요구가 관찰될 때** 후보를 다시 비교한다. CodeMirror는 고급 평문 편집, Tiptap/ProseMirror는 구조화된 서식 문서 요구에서 검토한다. 그때도 기존 저장본과 발췌 위치를 보존하는 변환·백업·업데이트 비용을 작은 한글 샘플 실험으로 먼저 확인한다. 이번 선택은 새 기반을 먼저 만들기보다 이미 쓰는 브라우저 입력과 앱 저장 경계를 재사용하는 것이다.

## 기록 재발견 — 근거가 보이는 로컬 연결과 검색 도구 비교

확인일 **2026-10-05 UTC**. 사용 장면은 현재 작업공간에서 기준 원문 버전 하나를 골라 **다시 읽을 다른 기록을 최대 3개** 보고, 표시된 이유를 확인한 뒤 해당 원문을 여는 것이다. 외부 콘텐츠 검색·의미 임베딩·AI 분석·개인 본문 전송은 포함하지 않는다. 기존 정확 검색을 대체하는 것도 아니다. 앞의 R2 비교는 검색어와 원문 구절의 복귀 문제였고, 이번에는 검색어 없이 기준 기록과의 연결 이유를 정하는 문제다.

**결정: 새 검색 패키지 없이 기존 자료·토픽·묶음 참조를 재사용하고, 근거에 따라 후보를 정렬하는 작은 순수 JS 모듈을 둔다.** 명시적 연결·같은 토픽을 먼저 보고 공통어는 제한된 보조 근거로 사용한다. 일반 검색엔진의 relevance 점수를 사용자의 관심·신념·지식 성장으로 표현하지 않는다. 아래는 도입 판단과 구현 계약이며 재발견 기능의 검증 완료 보고가 아니다.

### 최신 공식 배포와 선택 근거

세 후보의 공식 npm `latest`, GitHub 릴리스/최근 commit/공개 권고를 재조회했다. 실제 npm tarball의 LICENSE·README를 읽고 registry의 SHA-512 integrity와 대조했다. 설치·패키지 실행·CDN 연결·전역 설정 변경은 하지 않았다.

| 후보 | 확인한 배포·라이선스·유지관리 | 이번 요구와 비교 |
| --- | --- | --- |
| **Fuse.js 7.5.0 · Apache-2.0** | [npm](https://registry.npmjs.org/fuse.js) 게시 **2026-07-13 17:23:36 UTC**, [GitHub 릴리스](https://github.com/krisk/Fuse/releases/tag/v7.5.0) **17:19:30 UTC**. [tarball](https://registry.npmjs.org/fuse.js/-/fuse.js-7.5.0.tgz)의 `package/LICENSE` 확인. [최근 commit](https://github.com/krisk/Fuse/commit/edf2fb608eca0461508d1d71317e6e58309ffada)은 **2026-08-09**. | [공식 README](https://github.com/krisk/Fuse/blob/v7.5.0/README.md)의 작은·중간 자료군 fuzzy/token 검색은 오타·여러 검색어 입력의 후속 후보다. **현재 도입하지 않음.** 기준 기록을 검색어로 바꾸는 규칙과 토픽/명시적 연결 우선순위는 별도로 필요하다. 특히 7.5.0 릴리스는 필드 길이 정규화·가중치 등 수정으로 **점수와 결과 순위가 바뀜**을 명시한다. 엔진 점수를 연결 사실의 근거로 쓰지 않는다. |
| **MiniSearch 7.2.0 · MIT** | [npm](https://registry.npmjs.org/minisearch) 게시 **2025-09-16 12:42:12 UTC**, [고정 태그](https://github.com/lucaong/minisearch/tree/v7.2.0)와 [tarball](https://registry.npmjs.org/minisearch/-/minisearch-7.2.0.tgz)의 `package/LICENSE.txt` 확인. [최근 commit](https://github.com/lucaong/minisearch/commit/3d239d1c3ae7aef1bf5d8945dd7b5f0709f646f5)은 **2025-09-16**. `releases/latest`는 이번에도 404였다. | [공식 README](https://github.com/lucaong/minisearch/blob/v7.2.0/README.md)는 메모리 full-text index, 필드 가중치, prefix/fuzzy, 사용자 tokenizer를 제공한다. 기본 토큰은 Unicode 공백·구두점에서 나눈다. **현재 도입하지 않음.** 반복 검색량이 많아 인덱스가 필요할 때 적합하지만, 지금은 최신 후보·정확한 버전의 연결 근거·제외 상태를 직접 확인해야 한다. 인덱스 갱신·폐기 경계를 추가해도 이 계약은 남는다. |
| **FlexSearch 0.8.212 · Apache-2.0** | [npm](https://registry.npmjs.org/flexsearch) 게시 **2025-09-06 23:41:14 UTC**, [tarball](https://registry.npmjs.org/flexsearch/-/flexsearch-0.8.212.tgz)의 `package/LICENSE`·README 확인. [최근 commit](https://github.com/nextapps-de/flexsearch/commit/f7ed963096a0792da7b2fd63bb7114b3fbac55ed)은 **2026-05-29**. GitHub의 [최신 release 0.8.2](https://github.com/nextapps-de/flexsearch/releases/tag/0.8.2)는 **2025-05-21**로, npm 최신 번호·게시일과 구분했다. | [배포 원본 README](https://github.com/nextapps-de/flexsearch/blob/20b36c243c4f65a6dc6f97f64d4dcfc12934aa92/README.md)의 CJK charset·문서/태그 검색·worker·영속 인덱스는 자료량이 커졌을 때 비교할 후보다. **현재 도입하지 않음.** 대규모 인덱스·비동기 작업·캐시 수명 관리를 먼저 추가할 필요가 없고, 정확한 버전 참조와 연결 이유는 별도 구현해야 한다. CJK 지원이나 README의 성능 수치를 해도의 한글 의미 이해·실측 성능으로 간주하지 않는다. |

세 패키지의 해당 npm 버전에는 runtime dependencies 선언이 없거나 빈 객체였고, 세 GitHub 저장소는 `archived=false`, `disabled=false`였다. 확인일의 [Fuse](https://api.github.com/repos/krisk/Fuse/security-advisories?per_page=100)·[MiniSearch](https://api.github.com/repos/lucaong/minisearch/security-advisories?per_page=100)·[FlexSearch](https://api.github.com/repos/nextapps-de/flexsearch/security-advisories?per_page=100) 공개 권고 API는 모두 빈 목록이었다. 이것은 해당 저장소의 공개 권고 확인이며 전체 보안 감사·장기 지원·미공개 취약점 없음의 보증이 아니다. 이 절에서 새 라이브러리 벤치마크나 이전 R2 API 비교를 다시 실행하지 않았다.

### 자체 정렬의 범위와 정확한 근거

자체 구현은 검색엔진·한국어 형태소 분석기를 새로 만드는 범위가 아니다. 기존 자료의 고정 참조를 확인하고 제한된 후보에 **실제로 확인한 연결 이유**를 붙이는 앱 고유 규칙이다. 새 엔진 도입 비용을 줄이는 대신 아래 정책과 회귀 사례를 직접 유지해야 한다.

- **기준 버전과 후보 버전을 구별한다.** 기준은 사용자가 고른 정확한 버전이며 이전 버전도 가능하다. 후보는 각 source의 배열상 마지막, 즉 기존 앱이 사용하는 최신 버전만 허용한다. 기준과 같은 source의 다른 버전은 모두 제외하고 결과도 source별 한 개, 최대 3개다. 옛 후보 버전에만 있는 연결·토픽·문장을 최신 후보에 승계하지 않는다. 근거가 부족하면 결과 수를 억지로 채우지 않는다.
- **연결은 실제 참조에서 확인한다.** 저장한 문장·토픽의 `sourceRefs`, 묶음의 `versionIds` 등을 사용할 때 기준/후보의 정확한 버전 ID를 확인한다. 같은 제목이나 같은 source라는 이유만으로 연결을 만들지 않는다. 설명은 해당 연결·토픽·공통어를 표시하며 실제 본문을 확보하지 못한 링크를 읽은 글처럼 표현하지 않는다. 저장 사실을 동의나 사용자의 신념으로 해석하지 않는다.
- **공통어 비교의 한계를 표시한다.** 제목·본문 등 승인된 범위에서 제한된 어휘 일치를 비교하며, 공통어만으로 추천하려면 서로 다른 일치어 최소 2개를 요구한다. 본문 비교는 버전마다 앞 **16,000 UTF-16 code unit**으로 제한하는 계약이다. 한글 조사·활용형·띄어쓰기·동의어·의미까지 이해했다고 주장하지 않는다. 잘린 범위 밖에 근거가 없다고 단정하지 않으며 이 범위를 사용자 설명과 코드의 LIMITS에 함께 둔다.
- **비교용 정규화와 원문을 분리한다.** 정규화한 토큰은 공통어 비교 키로만 쓴다. 원문 표시용 근거는 실제 문자열에서 얻고, 정규화 문자열의 위치를 원문 UTF-16 위치로 재사용하지 않는다. 이번 API는 근거 snippet을 제공하며 새로운 발췌 offset 계약을 만들지 않는다. 원문 열기는 선택한 후보 버전 ID를 유지한다. 기존 source 제목은 현재 메타데이터이므로 과거 기준 버전의 제목 이력이 보존된 것처럼 표현하지 않는다.
- **결과 계산은 개인 자료를 바꾸지 않는다.** 현재 계정·작업공간의 자료만 읽고 원문·토픽·묶음·공개 사본을 자동 수정하지 않는다. 제외 기능은 추천 표시의 선택으로 다루며 원문 삭제·공개 철회와 구분한다. 계정/작업공간 전환 뒤 늦은 계산·저장 응답이 다른 공간의 목록에 적용되지 않게 한다. 외부 서버·임베딩 API·원격 로그에 개인 본문을 보내지 않는다.

검증은 연결된 정확한 버전과 같은 토픽, 옛 버전에만 있는 근거, 같은 source의 중복 버전, 본문 없는 링크, 공통어 한 개/두 개 경계, 긴 본문의 비교 범위, 동점 순서·제외/다시 표시·원문 복귀를 중심으로 한다. 자료량·길이 증가로 실제 지연이 확인되거나 오타 허용·검색어 기반 순위가 필요해질 때 MiniSearch/Fuse/FlexSearch를 해당 한글 샘플과 비교한다. 먼저 계정/작업공간별 인덱스 수명·원문 버전 참조·캐시 폐기·백업 복원 후 재생성을 정하고, worker나 영속 인덱스는 측정된 문제를 해결하는 범위에서만 도입한다.

## 핵심 사용 흐름 CI — 브라우저 도구와 배포 전 검사

확인일 **2026-10-05 UTC**. 기존 CI는 정적 검사와 Node 회귀만 실행했다. 실제 공용 진입·계정 경계·기록 읽기·내 페이지와 관련 기록의 화면 동작을 배포 전에 검사하기 위해 기존 Node 기반 브라우저 스크립트를 재사용한다. **앱의 production dependency는 추가하지 않고**, `tests/browser-ci/package.json`과 lockfile에 Playwright만 테스트용으로 고정한다. 새 테스트 프레임워크나 제품 내 SDK를 도입하는 변경은 아니다.

### 공식 배포·라이선스·보안 확인

| 도구 | 확인한 최신 공식 배포와 라이선스 | 채택 범위 |
| --- | --- | --- |
| **Playwright 1.63.0 · Apache-2.0** | [공식 npm](https://registry.npmjs.org/playwright) 게시 **2026-09-04 22:45:21 UTC**, [GitHub 릴리스](https://github.com/microsoft/playwright/releases/tag/v1.63.0) **22:40:31 UTC**. [배포 tarball](https://registry.npmjs.org/playwright/-/playwright-1.63.0.tgz)의 LICENSE·NOTICE와 registry SHA-512 integrity를 확인했다. [최근 commit](https://github.com/microsoft/playwright/commit/2a8ba77a33a5a39a52372c42f12d254506296c76)은 **2026-10-05**. 패키지의 Node 요구는 `>=20`이다. | `playwright`·`playwright-core`를 **1.63.0**으로 lock한다. 기존 `chromium.launch`·context·locator 기반 검사와 fake Auth/IndexedDB helper를 재사용한다. `@playwright/test`를 추가해 기존 runner를 다시 만들 필요는 없다. 테스트 작업의 Node는 기존 CI와 같은 **22**로 유지한다. |
| **actions/checkout v7.0.1 · MIT** | [릴리스](https://github.com/actions/checkout/releases/tag/v7.0.1) **2026-07-20**, [LICENSE](https://github.com/actions/checkout/blob/v7.0.1/LICENSE), [action.yml](https://github.com/actions/checkout/blob/v7.0.1/action.yml). | 검증한 태그의 commit `3d3c42e5aac5ba805825da76410c181273ba90b1`로 고정하고 checkout 자격 증명을 작업 디렉터리에 지속하지 않는다. |
| **actions/setup-node v7.0.0 · MIT** | [릴리스](https://github.com/actions/setup-node/releases/tag/v7.0.0) **2026-07-14**, [LICENSE](https://github.com/actions/setup-node/blob/v7.0.0/LICENSE), [README](https://github.com/actions/setup-node/blob/v7.0.0/README.md). | commit `820762786026740c76f36085b0efc47a31fe5020`로 고정한다. 브라우저 작업만 전용 lockfile 기준 npm cache를 사용하고 check/build의 불필요한 자동 cache는 끈다. |
| **actions/upload-artifact v7.0.1 · MIT** | [릴리스](https://github.com/actions/upload-artifact/releases/tag/v7.0.1) **2026-04-10**, [LICENSE](https://github.com/actions/upload-artifact/blob/v7.0.1/LICENSE), [action.yml](https://github.com/actions/upload-artifact/blob/v7.0.1/action.yml). | commit `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`로 고정한다. 성공·실패 보고서와 익명 샘플 스크린샷만 지정 경로에서 **7일** 보관한다. 저장소 전체·환경 파일을 artifact로 올리지 않는다. |

세 Action의 실행 runtime은 Node **24**이며, 이것은 앱 검사에 선택한 Node **22**와 별개다. 공식 README의 runner 최소 버전 **2.327.1** 요구에 맞춰 GitHub 호스팅 Ubuntu runner에서 사용한다. 새 browser 작업은 `ubuntu-24.04`로 두고, 기존 Pages 전용 configure/upload/deploy Action은 이 변경에서 교체하지 않는다.

Playwright의 저장소 공개 권고가 비어 있다는 사실만으로 끝내지 않고 [GitHub 전역 npm 권고](https://api.github.com/advisories?ecosystem=npm&affects=playwright&per_page=100)를 확인했다. [GHSA-7mvr-c777-76hp](https://github.com/advisories/GHSA-7mvr-c777-76hp)는 브라우저 다운로드의 TLS 인증서 검증 문제이며, 영향 범위 **`<1.55.1`**, 첫 수정 **`1.55.1`**이다. 선택한 1.63.0은 해당 영향 범위 밖이다. `playwright-core`·`@playwright/test` 전역 npm 조회와 세 Action 저장소의 공개 권고 API는 확인 당시 빈 목록이었다. `npm audit --prefix tests/browser-ci --audit-level=high`도 **0건**을 반환했다. 이는 해당 시점에 공개된 권고 확인이며 미공개 문제 없음이나 전체 보안 감사 결과를 뜻하지 않는다. TLS·다운로드 무결성 검증을 끄거나 임의 미러로 바꾸지 않는다.

### 실행과 실패 자료의 계약

- **브라우저도 패키지와 함께 선택한다.** [1.63.0 공식 browsers.json](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-core/browsers.json)의 Chromium은 **153.0.8010.12, revision 1243**이다. `npm ci --prefix tests/browser-ci --ignore-scripts` 뒤 해당 패키지 CLI의 `install --with-deps chromium`을 사용한다. `chromium.executablePath()`가 반환한 실제 파일을 확인해 `CHROMIUM_PATH`로 전달하며 runner의 임의 시스템 Chromium에 의존하지 않는다. 한글 렌더링용 `fonts-noto-cjk`도 설치한다.
- **캐시는 설치를 대신하지 않는다.** [공식 CI 지침](https://github.com/microsoft/playwright/blob/v1.63.0/docs/src/ci.md#caching-browsers)에 따라 브라우저 바이너리 cache를 만들지 않는다. npm cache는 lockfile의 integrity 검증과 `npm ci`를 거쳐 사용한다. 브라우저·OS 의존성 설치 실패를 통과로 바꾸지 않는다.
- **실제 앱과 익명 자료로 검사한다.** OAuth 쿼리를 로그에 쓰지 않는 `scripts/dev-server.py --port 4184`를 시작하고, 제한 시간 내 HTTP 200과 앱 셸 내용을 확인한 뒤 실행한다. 고정 시간 sleep만으로 준비 완료를 판단하지 않는다. `tests/unified-home-browser.cjs`와 `tests/core-experience-browser.cjs`는 합성 계정·자료와 가짜 Auth HTTP를 사용하며 운영 Supabase 자격 증명을 받지 않는다. 공개 빌드는 `check`와 `browser` **둘 다 성공해야** 시작한다.
- **한 검사의 실패가 다음 진단을 막지 않는다.** 서버가 준비됐다면 두 스크립트를 각각 실행하고 실패 exit code를 유지한다. 서버는 종료 단계에서 정리하며, 항상 보고서 수집을 시도한다. `.local/core-experience/`, `.local/unified-home/`, `.local/quality-audit/after/`와 요청 내용을 기록하지 않는 서버 로그만 업로드한다. `.local`을 포함하기 위해 `include-hidden-files`를 켜되 전체 `.local`을 수집하지 않는다.
- **검증 환경을 구분한다.** 이번 클라우드의 기존 브라우저 도구는 Playwright **1.57.0**이었으며 새 전용 lock과 섞어 보고하지 않는다. 새 1.63.0의 `npm ci`와 audit, 워크플로 YAML·Bash 구문·build 의존 관계 검사는 통과했다. 고정 Chromium의 로컬 다운로드는 `cdn.playwright.dev`에 대한 환경 네트워크 **403 Domain forbidden**으로 중단됐다. 따라서 기존 시스템 Chromium을 사용한 로컬 실행과 새 고정 Chromium을 내려받는 GitHub Actions 실행 결과를 구분해 후속 검증한다. 실제 GitHub CI·Apple 기기·한글 실물 IME 검증은 이 문서의 설치/구문 확인으로 대체하지 않는다.

## 기기 간 구성 이어쓰기 — CRDT·복제 엔진과 기존 CAS 비교

확인일 **2026-10-06 KST**. 사용 장면은 같은 계정의 A 기기에서 저장한 묶음·내 페이지 코멘트/순서/표시를 B 기기에서 이어 쓰고, 양쪽이 오프라인에서 편집했을 때 어느 쪽도 조용히 잃지 않는 것이다. 글쓰기·가져오기 초안, 공동 편집, 원문 수정, 공개 페이지 자동 갱신은 이번 범위가 아니다. [구현 전 계약](device-continuity.md)의 별도 구성 revision·명시 동의·정확 버전 참조를 기준으로 비교했다.

**결정: 기존 Supabase RPC와 IndexedDB의 CAS·operation ID 영수증 계약을 구성에 별도로 적용한다. 새 동기화 라이브러리는 도입하지 않는다.** 이는 CAS가 자동 병합보다 우월하다는 주장이 아니다. 현재 사용 장면에서는 완결된 구성 한 건의 충돌을 감지하고 양쪽 사본을 복구할 수 있으면 된다. 새 엔진의 데이터 모델·저장 이력·전송 경로로 이전하는 비용을 추가해도 계정·동의·참조·공개 경계는 앱에서 별도로 책임져야 한다. 이 절은 선택 근거이며 운영 SQL 설치나 실제 기기 검증 완료의 증거가 아니다.

### 최신 공식 배포와 적합성

npm의 `latest`, GitHub의 최신 안정 릴리스, 해당 태그의 실제 라이선스 원문을 대조했다. prerelease 태그는 안정판으로 선택하지 않았다. 비교를 위해 패키지를 설치·실행하거나 앱 의존성을 바꾸지는 않았다.

| 후보 | 확인한 안정판·라이선스·관리 상태 | 해도에 적용할 때의 이익과 비용 |
| --- | --- | --- |
| **Yjs 13.6.33 · MIT** | [npm](https://registry.npmjs.org/yjs), [공식 릴리스](https://github.com/yjs/yjs/releases/tag/v13.6.33), [태그 LICENSE](https://github.com/yjs/yjs/blob/v13.6.33/LICENSE). npm 게시 **2026-09-24 KST**. 최신 릴리스는 deep event observer의 `currentTarget` 수정이다. 저장소는 비보관 상태이며 10월에도 push가 있다. | [공식 README의 provider 계약](https://github.com/yjs/yjs/blob/v13.6.33/README.md#providers)은 네트워크와 영속 저장을 분리하며, 브라우저에서는 `y-indexeddb`와 네트워크 provider를 조합한다. 문자 단위 공동 편집에는 유력하지만 현재 JSON 구성을 Y.Map/Y.Array/Y.Text로 모델링하고, 인증된 update 전송·압축/보관·기존 JSON 백업 변환을 추가해야 한다. **설계 참고만**: 오프라인 영속성과 전송 수명을 분리한다. |
| **Automerge JS 3.5.0 · MIT** | [npm](https://registry.npmjs.org/@automerge%2Fautomerge), [공식 릴리스](https://github.com/automerge/automerge/releases/tag/js/automerge-3.5.0), [태그 LICENSE](https://github.com/automerge/automerge/blob/js/automerge-3.5.0/LICENSE). npm 게시 **2026-09-16 KST**. 3.5.0은 변경 author metadata 추가와 큰 목록·rich text patch 복구, `__proto__` 할당 거부 등을 포함한다. 저장소는 비보관 상태이며 10월에도 push가 있다. | 오프라인 변경의 병합과 이력이 장점이다. [충돌 값 구현](https://github.com/automerge/automerge/blob/js/automerge-3.5.0/javascript/src/conflicts.ts)은 같은 속성의 여러 값을 조회할 수 있게 하므로, 충돌 없는 수렴이 사용자의 의도까지 자동 결정한다는 뜻은 아니다. Rust/WASM 기반 JS 배포의 로딩·PWA 캐시·구성 모델 이전·저장 이력/백업 정책을 새로 검증해야 한다. **설계 참고만**: 충돌하는 값을 숨겨 버리지 말고 복구 가능하게 노출한다. |
| **RxDB 17.6.0 · Apache-2.0 core** | [npm](https://registry.npmjs.org/rxdb), [공식 릴리스](https://github.com/pubkey/rxdb/releases/tag/17.6.0), [태그 LICENSE](https://github.com/pubkey/rxdb/blob/17.6.0/LICENSE.txt). npm 게시 **2026-10-06 KST**. 이 릴리스는 replication 재시작·취소 후 쓰기·다중 탭 migration 정지 등 복구 수정도 포함한다. 저장소는 비보관 상태다. | [공식 Supabase 플러그인](https://github.com/pubkey/rxdb/blob/17.6.0/docs-src/docs/replication-supabase.md)은 optimistic push, checkpoint pull, Realtime을 제공해 세 후보 중 현재 인프라와 가장 가깝다. 그러나 현재의 RPC 전용 권한·JSON 스냅샷/영수증을 그대로 꽂는 어댑터는 아니다. 테이블 모델·삭제 표식·checkpoint/권한·로컬 컬렉션 이전이 필요하다. [기본 충돌 처리](https://github.com/pubkey/rxdb/blob/17.6.0/src/replication-protocol/default-conflict-handler.ts)는 master를 남기고 fork를 버리므로 해도의 양쪽 보존과 다르다. **설계 참고만**: 원자적 revision 검사와 실패 후 재개. [무료 Dexie 저장소와 Premium IndexedDB](https://github.com/pubkey/rxdb/blob/17.6.0/docs-src/docs/rx-storage-dexie.md)의 이용 범위도 구별한다. |

Yjs 저장소의 현재 HEAD에 대한 GitHub 라이선스 요약은 `NOASSERTION`이었다. 따라서 라이선스 판단에는 이를 추측해서 쓰지 않고 **13.6.33 태그의 MIT 원문**을 사용했다. 14 prerelease나 이후 배포본의 조건을 이번 확인으로 보증하지 않는다. RxDB core의 Apache-2.0 확인도 Premium 제품 전체의 이용 허락을 뜻하지 않는다.

보안은 세 저장소의 공개 권고 API([Yjs](https://api.github.com/repos/yjs/yjs/security-advisories?per_page=100)·[Automerge](https://api.github.com/repos/automerge/automerge/security-advisories?per_page=100)·[RxDB](https://api.github.com/repos/pubkey/rxdb/security-advisories?per_page=100))와 GitHub 전역 npm 권고([yjs](https://api.github.com/advisories?ecosystem=npm&affects=yjs&per_page=100)·[@automerge/automerge](https://api.github.com/advisories?ecosystem=npm&affects=%40automerge%2Fautomerge&per_page=100)·[rxdb](https://api.github.com/advisories?ecosystem=npm&affects=rxdb&per_page=100))를 조회했다. 모두 **HTTP 200, 빈 목록**이었다. Yjs의 runtime dependency `lib0`에 대한 [전역 npm 조회](https://api.github.com/advisories?ecosystem=npm&affects=lib0&per_page=100)도 빈 목록이었다. 전체 전이 의존성의 설치·audit를 실행한 것은 아니며 미공개 취약점 없음의 보증이 아니다.

### 선택을 성립시키는 세 가지 복구 계약

1. **충돌 감지 뒤 실제로 양쪽을 다시 열 수 있어야 한다.** 구성 한 건을 CAS로 저장하면 서로 다른 항목의 변경도 충돌할 수 있다. 기본 해결은 선택한 쪽을 남기되 선택하지 않은 쪽을 영속 사본으로 보존하는 것이다. 코멘트·순서·표시·제외 쌍까지 함께 보관하고, 비교 뒤 revision이 바뀌면 다시 선택하게 한다. 입력 중인 DOM 값과 한글 조합을 원격 응답으로 덮지 않는다. 현재 원문 동기화의 `core.makeBackup`/`restoreBackup`만 재사용하면 구성은 사본에 들어가지 않는다. 자료·구성의 같은 시점 스냅샷과 `Workbench.restoreBackup`의 참조 재매핑을 이용하거나, 원래 공간·버전 참조를 유지하는 별도 구성 사본을 내보내고 복구하는 경로가 필요하다. 사본 저장 실패 시 최신 구성 적용도 함께 실패해야 한다.
2. **별도 revision은 원문과 구성 사이의 분산 트랜잭션이 아니다.** 구성의 source version이 B 기기에 아직 없거나 원문 업로드와 구성 업로드 사이 연결이 끊길 수 있다. 정확한 참조를 유지하고 미도착 상태를 표시하며, 원문을 받은 뒤 같은 버전으로 해소한다. 최신 버전으로 대체하거나 누락 항목을 제거하지 않는다. 원문 동기화가 충돌/중지/미완료이면 구성까지 모두 이어졌다고 표시하지 않는다. 서버가 요구하는 원문 revision/참조 검증과 클라이언트의 수신 순서를 정의하고, 오래된 응답·같은 revision의 다른 내용·계정 전환을 차단한다. 이런 경계는 CRDT로 바꾸어도 남는다.
3. **구성 연결 동의는 원문 연결·로그인에서 자동 승계하지 않는다.** 기존 연결은 원문·발췌 범위였다. 추가 연결 화면에서 묶음, 페이지 코멘트와 표시 선택, 회고, 관련 기록 제외가 개인 서버로 전송됨을 알려야 한다. 초안·가져오기 파일 바이트·읽기 행동·공개 사본은 자동 포함하지 않는다. 오프라인의 ‘연결’ 클릭을 구현한다면 그 동의 범위와 계정/공간 binding을 영속화하고 재연결 시 서버 충돌부터 확인한다. 이번 UI가 최초 연결을 온라인에서만 허용한다면 실패 후 대기 업로드가 생긴 것처럼 표현하지 않는다. 중지는 이후 전송을 멈추는 동작이며 이미 보낸 서버 사본 삭제/공개 철회와 구별한다.

검증 담당은 이번 구성 동기화의 구현·QA 담당자다. 최소 실험은 **두 독립 브라우저의 같은 기준 revision → 각각 오프라인 편집 → 연결 복귀 → 충돌 비교/양쪽 복구**, 성공 응답 유실 뒤 같은 operation ID 재시도, 로컬 사본 저장 실패, 원문 미도착, 중지·계정 전환 후 늦은 응답이다. 운영 설치 확인과 HTTP 검증, 브라우저 모의 기기 전환, 실제 Mac/iPad/iPhone 사용을 서로 대체하지 않는다.

### 다시 선택할 조건

같은 페이지를 자주 동시에 편집해 문서 단위 충돌이 실제 사용을 방해하면 먼저 항목 단위 revision이나 공통 조상 기반의 보수적 병합을 비교한다. 문자 단위 공동 편집·자동 이력 병합이 제품 요구가 되면 Yjs/Automerge를 익명 한글 편집·IME·삭제/재삽입·백업 변환 사례로 실험한다. 자료량이 커져 전체 스냅샷 전송·조회 지연이 측정되면 RxDB의 증분 복제를 실제 migration/권한 비용과 비교한다. 지금 유지하는 자체 CAS의 비용은 상태 기계·정합성·영수증·복구 UI의 회귀 검사이며, 비슷한 엔진을 무제한 복제하지 않고 공통 계약을 유지해야 한다.

## 선택한 글쓰기 초안 이어쓰기 — 같은 비교를 재사용하는 범위

결정일 **2026-10-06 KST**. 같은 날 위 절에서 확인한 **Yjs 13.6.33·Automerge JS 3.5.0·RxDB 17.6.0**의 공식 배포·라이선스·공개 보안 권고 결과를 재사용한다. 초안 기능을 이유로 이를 다시 조회하거나 새 패키지를 설치하지 않았으며, 추가 보안 검사를 수행한 것으로 보고하지 않는다. 이번 사용 장면은 A에서 쓰던 **선택한 초안 한 건**을 B에서 받고 이어 쓰는 것이다. 문자 단위 공동 편집·실시간 커서 공유·가져오기 파일 전송은 포함하지 않는다.

**결정: 기존 JSON 글쓰기 모델과 계정별 CAS·영수증 계약을 유지한다. 새 편집기·복제 라이브러리는 도입하지 않는다.** 기존 `Writing.validateDraft`의 `life-writing-draft-v1`에는 제목·본문·정확한 원문 기준과 `draft`/`applied` 상태가 이미 있다. 이를 CRDT 문서나 RxDB 컬렉션으로 옮기면 데이터 변환·PWA 배포·백업 호환성을 새로 검증해야 하지만, 명시 전송 동의와 기록 저장 이후의 종료 처리는 여전히 앱에서 해결해야 한다. 이번에는 초안 한 건의 충돌을 비교하고 선택하지 않은 입력을 다시 열 수 있으면 사용 장면을 충족한다.

재사용과 분리의 기준은 다음과 같다.

- **인증·모델을 재사용한다.** 공용 Auth가 검증한 SDK를 기존 제한 어댑터에서 빌리고, 글쓰기 전용 RPC 범위만 허용한다. 별도 로그인·세션 복사·SDK를 추가하지 않는다. `kind: writing`만 대상이며 가져오기 검토 초안은 전송하지 않는다. 본문 UTF-8 1 MiB 제한과 원문 수정 기준을 유지한다.
- **저장 계약을 재사용하고 전송 단위는 분리한다.** 계정·작업공간·초안 ID를 고정한 독립 revision, 변경할 수 없는 outbox, operation ID 영수증, 계정/연결 세대 검사, 원문 선행 동기화를 사용한다. 기존 원문이나 구성 연결에서 모든 초안의 전송 동의를 자동 승계하지 않는다. 재시도·중지 후 재개·늦은 응답 차단의 검증 기준도 구성 이어쓰기와 공유한다. 공통 수명·인증 처리는 재사용하되 초안의 종료 규칙을 구성의 일반 JSON 교체와 같게 취급하지 않는다.
- **충돌 사본은 기존 글쓰기에서 다시 연다.** 양쪽이 초안이면 선택하지 않은 쪽의 제목·본문·원문 기준을 새 미연결 초안으로 같은 로컬 트랜잭션에 보관한다. 기존 초안 목록·TXT 내보내기를 이용하며, 본문을 빠뜨리는 구성 백업에 초안을 억지로 넣지 않는다. 복구 사본 보관이 실패하면 선택 적용도 중단한다.
- **기록 저장은 종료 상태와 정확한 원문을 연결한다.** 기존 원문 저장·초안 `applied`·로컬 영수증의 원자성을 유지한다. 서버의 `applied` 쓰기와 기기의 종료 상태 적용에는 원문 revision 도착뿐 아니라 `appliedResult`의 정확한 source/version 쌍 확인을 요구한다. 같은 초안 ID를 다시 `draft`로 만들지 않으며, 종료된 초안과 충돌한 입력은 새 미연결 초안으로 보존한다. 원문이 나중에 없어지면 자동으로 다른 버전에 연결하지 않고 보존 오류로 남긴다.

이 계약은 **전역에서 한 번만 기록을 저장한다는 보장이 아니다.** A/B가 오프라인에서 각각 명시 저장하면 서로 다른 로컬 원문이 생길 수 있다. 기존 원문 CAS 충돌을 먼저 해결하고 양쪽 자료를 보존하며, 두 원문을 자동 합치거나 삭제하지 않는다. 종료 표시의 정확한 원문을 확인하지 못하면 동기화 완료로 표시하지 않는다. 전역 단일 저장이 제품 요구가 되면 서버의 저장 직렬화·원문과 초안의 원자적 확정 계약을 별도로 설계해야 한다. CRDT를 추가하는 것만으로 이 경계가 해결되지는 않는다.

원격 변경으로 편집 DOM을 다시 만들지 않는 것도 도입 판단의 조건이다. 한글 조합·커서·저장 중 추가 입력을 보존하고, 새 서버 내용은 알린 뒤 명시적으로 다시 열거나 비교한다. 최소 검증은 두 기기의 오프라인 편집/동시 기록 저장, 종료 표시와 원문 도착 순서, 입력 중 원격 갱신, 영수증 응답 유실, 사본 저장 공간 부족, 계정·작업공간 전환이다. 잦은 문서 단위 충돌이 실제 글쓰기를 방해하거나 문자 단위 공동 편집이 필요해질 때 위 CRDT 비교를 다시 연다. 이 절은 채택 계약의 근거이며 구현 검사·운영 SQL 설치·실제 Apple 기기 검증의 완료 보고가 아니다.

## 기억나는 한글 문구 찾기 — 검색 계약을 보존하는 작은 개선

확인일 **2026-10-08 KST**(공식 조회 2026-10-07 15:42 UTC 이후). 이번 목표는 **기억나는 글자를 입력해 보관한 원문의 실제 버전·구간을 다시 여는 것**이다. 검색어 없이 관련 기록을 고르는 재발견의 의미·유용성 평가와 구분한다. [재발견 품질 평가](../design-review/rediscovery-quality.md)의 상투어 오탐을 검색 라이브러리 교체로 해결했다고 주장하지 않는다.

**이번 선택: literal 검색을 기본으로 유지한다. 사용자가 선택한 경우에만 한글 음절 사이의 수평 공백을 유연하게 찾는 native 정규식 방식을 검증하고, 많은 결과의 UI는 40개씩 더보기로 나눈다. 새 runtime 검색 패키지는 도입하지 않는다.** 공백 유연 검색은 원문을 정규화한 별도 문자열에서 위치를 계산하지 않고 원문 자체에서 `match.index`와 실제 일치 문자열을 얻는 조건이다. 이는 구현·회귀 검증 전제의 선택이며 이 절만으로 기능 완료를 선언하지 않는다. 결과 40개씩 표시는 DOM 표시량에 대한 선택이고, 검색 계산 자체가 빨라졌다는 증거는 아니다.

### 공식 배포 재확인과 적합성

세 npm `latest`와 GitHub 최신 릴리스·기본 브랜치 commit·공개 보안 권고를 새로 조회했다. 실제 npm tarball의 SHA-512를 registry `dist.integrity`와 대조한 뒤 README·LICENSE를 읽었다. 패키지 설치·실행·앱 의존성 추가는 하지 않았다. 아래 링크의 이전 조사 버전과 같아도 이번 조회 결과와 과거 관찰을 구분한다.

| 후보 | 이번에 확인한 배포·라이선스·유지관리 | 원문 검색에 맞는 부분과 도입하지 않는 이유 |
| --- | --- | --- |
| **Fuse.js 7.5.0 · Apache-2.0** | [npm](https://registry.npmjs.org/fuse.js/7.5.0) 게시 2026-07-13 17:23 UTC, [GitHub v7.5.0](https://github.com/krisk/Fuse/releases/tag/v7.5.0) 같은 날. 기본 브랜치 [최근 commit](https://github.com/krisk/Fuse/commit/edf2fb608eca0461508d1d71317e6e58309ffada)은 2026-08-09. [배포 LICENSE·README](https://github.com/krisk/Fuse/tree/457fe762c6418357896d78311f7def8c937a64f8)와 공식 tarball 확인. | 여러 단어를 기억하는 검색·오타 허용의 후속 비교에 적합하다. 7.5.0 README의 `useTokenSearch`, `tokenMatch: 'all'`, `includeMatches`를 작은 실험에 사용할 수 있다. 기본 token 방식의 `'any'`는 일부 단어만 일치해도 결과를 내므로 요구를 구분해야 한다. fuzzy의 여러 match 범위를 기존 단일 정확 locator로 그대로 바꿀 수 없고, 최신 릴리스 자체도 점수·순위 변경을 명시한다. **이번 공백 유연 검색에는 제외.** |
| **MiniSearch 7.2.0 · MIT** | [npm](https://registry.npmjs.org/minisearch/7.2.0) 게시 2025-09-16. [최근 commit](https://github.com/lucaong/minisearch/commit/3d239d1c3ae7aef1bf5d8945dd7b5f0709f646f5)도 같은 날. GitHub `releases/latest`는 404여서 별도 최신 GitHub release 번호를 만들지 않는다. [태그의 README·LICENSE.txt](https://github.com/lucaong/minisearch/tree/v7.2.0)와 배포본 확인. | token/prefix/fuzzy와 필드 가중치가 있는 메모리 인덱스다. 기본 tokenizer는 Unicode 공백·구두점 분리이며 `tokenize`·`processTerm`을 바꿀 수 있다. 원문 버전별 ID를 인덱싱할 수 있지만 반환된 단어·필드 정보가 원문 UTF-16 구간을 대신하지 않는다. 현재의 작은 요구에는 인덱스 갱신·계정 전환 폐기·정확 구간 재탐색 부담이 추가된다. **이번에는 제외, 반복 질의·자료량 문제의 후속 비교 후보.** |
| **FlexSearch 0.8.212 · Apache-2.0** | [npm](https://registry.npmjs.org/flexsearch/0.8.212) 게시 2025-09-06. GitHub 최신 [release 0.8.2](https://github.com/nextapps-de/flexsearch/releases/tag/0.8.2)는 2025-05-21로 npm 버전과 다르다. [최근 commit](https://github.com/nextapps-de/flexsearch/commit/f7ed963096a0792da7b2fd63bb7114b3fbac55ed)은 2026-05-29. [배포 commit의 README·LICENSE](https://github.com/nextapps-de/flexsearch/tree/20b36c243c4f65a6dc6f97f64d4dcfc12934aa92)와 tarball 확인. | CJK charset/encoder, 부분 검색, 문서 필드·worker·하이라이트 기능을 제공한다. CJK 지원을 한국어 조사·띄어쓰기·의미 이해 또는 정확 offset 보장의 증거로 취급하지 않는다. encoder/토큰화·인덱스 수명을 정하고 원문 좌표를 별도로 검증해야 한다. **이번에는 제외.** 대량 자료에서 실제 지연을 측정한 뒤 비교한다. |

세 저장소는 조회 시 `archived=false`, `disabled=false`였고 해당 npm 버전의 runtime dependencies는 빈 객체 또는 미선언이었다. [Fuse 공개 권고](https://api.github.com/repos/krisk/Fuse/security-advisories?per_page=100), [MiniSearch 공개 권고](https://api.github.com/repos/lucaong/minisearch/security-advisories?per_page=100), [FlexSearch 공개 권고](https://api.github.com/repos/nextapps-de/flexsearch/security-advisories?per_page=100)는 모두 빈 목록이었다. 이는 해당 GitHub 저장소의 공개 목록 조회 결과이며 전체 취약점 부재·장기 지원의 보증이 아니다. SHA-512 무결성 대조를 패키지 서명 검증으로 표현하지 않는다. 공식 GitHub API·npm 접근은 성공했고 허용 정책을 우회하지 않았다. 조회 JSON과 읽은 배포 문서는 `.local/korean-search-review/`에 보관했다.

### `Core.searchSources()`와의 공통 계약

기존 함수는 검색어 양끝만 trim하고 메타문자를 escape한 native `iu` 정규식을 **변경하지 않은 원문**에서 실행한다. 본문에 처음 일치한 raw UTF-16 `[start,end)`와 `quote`를 반환한다. 한 원문의 이전 버전도 각각 찾고, 제목만 일치하면 현재 제목의 최신 버전만 연다. 본문 없는 링크는 `locator/quote/snippet=null`이다. UI의 내 메모 일치는 별도 경로로 정확한 `sourceRef`를 유지하며 내 메모 단어를 원문 위치로 꾸미지 않는다.

어떤 후속 엔진도 아래 조건을 대신하지 못한다.

- 인덱스의 단위와 결과 ID는 **원문 버전**이어야 한다. 같은 source의 여러 버전을 합쳐 문구를 만들거나 일치한 옛 버전을 최신으로 치환하지 않는다. 원문 제목에는 별도 버전 이력이 없다는 한계를 유지한다.
- 정확 검색의 quote는 `original.slice(start,end)`와 같아야 한다. lowercase·NFC/NFD·공백 제거·형태소 분석을 거친 문자열의 offset을 raw 원문에 적용하지 않는다. fuzzy/다중어의 떨어진 구간을 한 문장처럼 합치지 않는다.
- 공백 유연 옵션은 **한글 음절 사이 수평 공백**으로 제한하고 허용 문자의 범위를 테스트에 명시한다. 줄바꿈·문단·구두점·단어순서를 마음대로 건너뛰는 `.*` 검색으로 확대하지 않는다. NFD 정규화·조사 제거·동의어 이해·초성 검색은 별도 요구다.
- 계정/작업공간·원천 필터·검색어/스크롤 복귀·한글 조합 완료 시점·기존 발췌 위치를 보존한다. 더보기는 검색 결과의 일부 표시일 뿐 검색 대상 버전이나 보관 데이터를 줄이지 않는다.

직접 구현 선택의 유지 비용은 수평 공백의 경계, UTF-16·surrogate·CRLF·이전 버전 검증이다. 현재 native matcher와 locator 검증을 재사용할 수 있으므로 이 작은 요구에서는 검색 인덱스 도입 비용보다 작다. 여러 단어의 독립적 일치·오타·순위가 사용 장면에서 필요해지면 Fuse token search와 MiniSearch를 동일 자료로 비교한다. 그때도 literal 결과와 approximate 결과의 뜻을 구분하고 원문 대조를 유지한다.

### 실측하기 좋은 작은 한글 질의셋

아래는 **제안하는 검색 평가 입력**이며 세 엔진에서 실행한 벤치마크 결과가 아니다. query가 없는 재발견 후보 평가와 합산하지 않는다. 각 사례의 원문·버전 ID·예상 raw 구간을 미리 고정하고, 반환 결과에서 정답을 다시 만들어 검사하지 않는다.

| 원문/상태 → 입력 질의 | 구분 | 확인할 기대 |
| --- | --- | --- |
| `빛과 나무의 간격이 눈에 들어왔다.` → `나무의 간격` | literal | 기본 검색에서 같은 버전과 정확 구간 |
| `천천히 걸었다.` → `천천히걸었다` | 공백 유연 | 기본은 불일치, 옵션에서만 실제 공백을 포함한 quote |
| `천천히걸었다.` → `천천히 걸었다` | 공백 유연 역방향 | 옵션 정책에 맞게 공백 없는 실제 quote, 원문 불변 |
| `정원  산책`, `정원\t산책`, `정원\n산책` → `정원산책` | 수평/수직 경계 | 허용한 수평 공백만 연결하고 줄바꿈을 넘기지 않음 |
| `정원의 산책은 조용했다.` → `정원 산책` | 조사 | 공백 옵션만으로 해결됐다고 주장하지 않음. 후속 어형 비교의 별도 항목 |
| `빛과 나무의 간격` → `빛 간격`, `간격 나무` | 떨어진 다중어/순서 | 이번 literal·공백 옵션의 성공 조건으로 넣지 않음. 후속 token 방식의 별도 목표 |
| `젖은 나뭇잎을 보았다.` → `나뭇입` | 오타 | 이번에는 불일치. fuzzy 후속 비교에서 무관 결과 증가도 함께 측정 |
| NFC `산책` → 같은 글자의 NFD 입력 | Unicode 정규화 | 이번에는 동등 처리하지 않음. 후속 정규화는 raw 좌표 매핑을 별도 검증 |
| `봄, a.b [기억]` → `봄`, `a.b`, `[기억]` | 짧은 한글/메타문자 | 1음절 검색과 문자 그대로의 검색 보존; 엔진 연산자로 해석하지 않음 |
| raw `İ\r\n🌱AbC abc\r\n끝` → `aBc` | UTF-16/대소문자 | 첫 `AbC`의 raw `[5,8)`, quote 그대로. 반쪽 surrogate 검색 불가 |
| 옛 버전 `기억할 구절`, 최신 `다른 내용` → `기억할` | 이전 버전 | 옛 버전 열기, 최신으로 대체하지 않음 |
| 링크 제목 `박물관 예약 안내` → `박물관 예약`; 내 메모 `다음엔 북문` → 같은 질의 | 제목/메모 전용 | 각각 확보된 필드의 근거만 표시, 원문 본문 locator를 만들지 않음 |

성능 실험은 동일 원문 세트를 100/1,000/10,000개 버전 규모로 고정하고 최초 준비시간·질의 p50/p95·메모리·반환 버전 수·40개 표시/더보기 시간을 분리한다. 같은 문자열 복제만으로 의미 정확도를 평가하지 않는다. 이전 버전·공백·CRLF·짧은 질의·잘못된 후보가 섞인 고정 사례에서 결과 정확성을 먼저 확인하고, 실제 기기 검증 없이 iPad/iPhone 성능 수치를 약속하지 않는다.

## 책 프로젝트·목차·원고 — 기존 편집과 출처 모델 위에 구성 추가

확인일 **2026-10-08 KST**. 이번 목표는 ‘20대’ 또는 나이와 무관한 특정 주제의 책을 만들고, 장의 순서·원고·근거를 보관한 뒤 책별 Markdown을 꺼내는 것이다. [회고와 책 설계](reflection-book.md)의 다음 구현 단위다. 자동 자기 분석·리치 편집·PDF 조판·공개 출판을 완료하는 범위가 아니다.

**선택: mdBook과 novelWriter의 목차·자료 분리·선택 출력 설계를 참고하고, 새 의존성 없이 기존 textarea·Workbench 구성 저장·Reflection 원고 변환을 확장한다.** 외부 프로젝트 파일을 읽는 importer, 출판 엔진의 브라우저 내 실행, 소스 코드·아이콘·서식의 복사는 하지 않는다. 비교 도구를 설치·실행한 결과가 아니라 공식 배포·문서·설정 파일을 읽고 내린 결정이다.

### 공식 배포·라이선스·유지관리

두 저장소의 GitHub API에서 `releases/latest`, 저장소 상태, 기본 브랜치 최근 commit, 공개 보안 권고를 조회했다. 최신 안정 릴리스의 tree와 실제 `LICENSE`·README·패키지 설정·관련 가이드를 Contents API로 읽었다. 현재 브랜치의 라이선스 배지나 과거 기억만으로 태그의 배포 조건을 대신하지 않았다.

| 후보 | 이번에 확인한 공식 배포·라이선스·유지관리 | 장/목차/원고에서 참고할 부분과 도입 판단 |
| --- | --- | --- |
| **mdBook v0.5.4 · MPL-2.0** | [최신 안정 릴리스](https://github.com/rust-lang/mdBook/releases/tag/v0.5.4) 게시 **2026-07-06 15:28 UTC**, 태그 tree `2ea30c00f00647d2b3f4c0f79b3e0e1eabc0b66d`. [LICENSE](https://github.com/rust-lang/mdBook/blob/v0.5.4/LICENSE)·[README](https://github.com/rust-lang/mdBook/blob/v0.5.4/README.md)·[Cargo.toml](https://github.com/rust-lang/mdBook/blob/v0.5.4/Cargo.toml)이 MPL-2.0으로 일치한다. 기본 브랜치 [최근 commit](https://github.com/rust-lang/mdBook/commit/d4658998d44112e873c90049767d7eb002169a2d)은 **2026-10-05**다. | [`SUMMARY.md` 가이드](https://github.com/rust-lang/mdBook/blob/v0.5.4/guide/src/format/summary.md)는 포함할 장·순서·계층·파일 위치를 별도 목차에 명시한다. 해도에는 **장 배열이 명시적 목차 순서**라는 원칙을 참고한다. 전체 도입은 Rust 도구와 Markdown 파일 기반 build를 추가하며, 계정별 편집·불변 원문 버전·근거 선택 저장은 별도로 필요하다. 태그는 Rust 1.88.0 이상을 명시한다. 이번 정적 앱 런타임에 도입하지 않음. |
| **novelWriter v26.2.1 · GPL-3.0-or-later 및 동봉 자산 조건** | [최신 안정 릴리스](https://github.com/saga-soft/novelWriter/releases/tag/v26.2.1) 게시 **2026-09-26 17:37 UTC**, 태그 tree `99b0f48d923c80ed0301f690f5253795cfbfc466`. 기존 `vkbo/novelWriter` API가 공식 현재 저장소 **`saga-soft/novelWriter`**로 연결됨을 확인했다. [LICENSE.md](https://github.com/saga-soft/novelWriter/blob/v26.2.1/LICENSE.md)는 GPL v3 전문이며, [pyproject.toml](https://github.com/saga-soft/novelWriter/blob/v26.2.1/pyproject.toml)의 배포 라이선스 표현은 **`GPL-3.0-or-later AND Apache-2.0 AND CC-BY-4.0 AND ISC`**다. 동봉 자산을 GPL 하나로 뭉뚱그리지 않는다. 기본 브랜치 [최근 commit](https://github.com/saga-soft/novelWriter/commit/3ea0240bcca17e214ed772293f1ff932dbfe98a8)은 **2026-10-07**다. | [프로젝트 정리](https://github.com/saga-soft/novelWriter/blob/v26.2.1/docs/source/usage/organising_project.rst)는 원고 문서와 참고 노트를 구분하며, 일반 폴더 자체보다 **문서 순서**가 원고 구성에 쓰인다고 설명한다. [Manuscript Build](https://github.com/saga-soft/novelWriter/blob/v26.2.1/docs/source/user_interface/manuscript.rst)는 문서 선택과 문서 안에 포함할 내용 선택을 구분한다. 해도에는 **장 원고와 근거 원문 분리, 원문 본문의 명시적 출력 선택**을 참고한다. Python 3.11+·Qt6/PyQt6 데스크톱 앱이므로 iPad 브라우저 편집기의 직접 대체가 아니다. 독자 문법·프로젝트 파서·앱 전체를 도입하지 않음. |

두 저장소는 조회 시 `archived=false`, `disabled=false`였고 최신 릴리스는 prerelease·draft가 아니었다. 최근 commit과 배포가 있다는 사실은 지속 지원이나 해도의 한글 입력·기기 적합성을 보증하지 않는다. novelWriter가 평문을 쓰더라도 README는 **Markdown에서 영감을 받은 문법과 별도 메타데이터**라고 설명한다. 일반 Markdown 내보내기가 novelWriter 프로젝트 형식과 곧바로 호환된다는 주장은 하지 않는다.

### 보안 권고와 확인 한계

[mdBook 공개 권고](https://api.github.com/repos/rust-lang/mdBook/security-advisories?per_page=100)는 **1건**이었다. [GHSA-gx5w-rrhp-f436 / CVE-2020-26297](https://github.com/rust-lang/mdBook/security/advisories/GHSA-gx5w-rrhp-f436)는 검색 질의의 XSS와 수정 버전 **0.4.5**를 명시한다. API의 영향 범위 문자열은 `>= 0.1.4`로 상한이 없으므로 그 문자열만 보고 이번 0.5.4가 같은 문제에 취약하다고 단정하지 않는다. HTML 검색 화면을 도입하면 생성물 갱신과 escape 경계를 관리해야 한다는 참고 근거다.

[novelWriter 공개 권고](https://api.github.com/repos/saga-soft/novelWriter/security-advisories?per_page=100)는 조회에서 **0건**이었다. 이는 해당 GitHub 공개 목록만 확인한 결과이며 Python/Qt·Rust 전이 의존성 감사, 미공개 취약점 부재, 배포 바이너리 서명 검증을 뜻하지 않는다. 라이선스·문서 확인은 코드나 자산을 가져온 사실과도 구분한다.

클라우드 런타임·네트워크 스킬, 현재 환경 상태와 정책 파일을 읽고 허용된 공식 GitHub API만 사용했다. 상속된 프록시와 TLS 검증을 유지했고 차단 목적지 재요청·중계·우회, 실제 계정 자료 수집·전송은 하지 않았다. 공개 응답과 읽은 태그 파일은 이번 작업의 임시 조사 경로 `/tmp/haedo-book-review-20261008/`에 보관했다. 이 임시 경로의 영구 보존을 약속하지 않으며 검토 근거는 위의 고정 버전 링크로 남긴다.

### 해도에서 재사용할 경계

1. **목차는 내용과 별도인 명시적 순서다.** optional `books`의 각 `chapters` 배열 순서를 사용한다. 날짜나 제목이 바뀌었다고 장을 자동 재배치하지 않는다. 프로젝트 기간은 설명용 메타데이터이며 근거 선택을 몰래 제한하는 필터가 아니다.
2. **원고와 근거는 독립적으로 둔다.** 장의 `note`는 사용자가 지금 쓰는 원고이고, `versionIds`는 이미 보관한 정확 버전의 참조다. 같은 버전을 여러 장에서 사용해도 원문은 복제하지 않는다. 원문·현재 원고·타인 인용·후속 AI 제안을 한 본문으로 합쳐 저장하지 않는다.
3. **기존 회고에서 복사해 시작한다.** 단일 `reflection`은 유지하며 사용자가 선택한 경우에만 새 책의 장에 선택 목록과 메모를 복사한다. 이후 책 편집이 기존 회고에 자동 전파되지 않는다.
4. **출력 범위를 명시한다.** 책별 Markdown은 책 질문·장 원고·근거 출처가 기본이고, 원문 본문은 명시적으로 선택할 때만 포함한다. mdBook의 HTML renderer나 novelWriter의 Manuscript Build를 실행하지 않으며 이 파일을 PDF·인쇄본·두 도구의 프로젝트 백업으로 표시하지 않는다.
5. **새 구조도 기존 보존 계약을 통과해야 한다.** 계정/공간 경계, CAS 충돌, 초안 입력 보존, 정확 버전, JSON 새 사본 복원의 ID 재매핑을 확장한다. SQL validator의 additive 갱신은 Local 설치·확인 대상이며 파일 작성만으로 서버가 책 구성을 받는다고 보고하지 않는다.

장별 리치 서식, 여러 단계의 목차, 쪽나눔·각주·이미지·폰트 포함이 실제 원고 편집에서 필요해지면 이 도구들의 출력과 별도 조판 후보를 한글 샘플로 다시 비교한다. 지금은 기존 입력과 저장 경계를 재사용하는 비용이 새 데스크톱·Rust 기반을 연결하는 비용보다 작다. **책 모델·UI·브라우저·서버 검증은 구현 담당의 별도 결과를 기다리며, 이번 공식 조사로 통과를 대신하지 않는다.**
