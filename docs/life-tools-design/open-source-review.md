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
