# MODEL-02 관심 확인: 제품·구조 독립 검토

검토일 2026-10-19 KST. `/workspace/haedo-discovery`의 현행 UI·Core·storage를 읽고 작성했다. 앱 파일은 수정하지 않았다. 프로젝트의 개발·디자인 스킬, 현재 DESIGN.md와 craft-floor를 적용했다. 아래는 구현 제안이며 아직 브라우저 통과나 시각 승인 결과가 아니다.

## 이번 완료 단위

로그인한 사용자가 **도구 → 관심 확인 → 보관한 자료 선택 → 모델 준비/분석의 명시 실행 → 정확한 근거 확인 → 관심 수정·선택 확정 또는 직접 입력 → 저장 → 새로고침 후 재열기**를 수행할 수 있으면 작은 제품 흐름이 완결된다. 외부 글 추천·수집·자동 갱신은 이번 단위에 필요하지 않다. 홈은 계속 글쓰기·내 글·초안에 집중하고, 기존 다시 찾기·글쓰기·네 가지 상위 메뉴를 보존한다.

모델의 의미 품질이 실패한 상태에서는 자동 관심 후보가 제품 기능으로 성공했다고 표시하면 안 된다. 실제 추론 가능 여부와 후보의 품질 상태를 구분하고, 직접 입력·기존 확인 관심 읽기/수정은 이용할 수 있어야 한다.

## 기존 코드의 정확한 진입점

| 대상 | 현행 코드/선택자 | 최소 연결 |
|---|---|---|
| 도구 목록 | `assets/life/ui.js:renderTools()` → `.life-destinations`, `actionRow()` | `actionRow('관심 확인', '보관한 자료의 근거를 보고 직접 정리', 'search', () => navigate('interests'))` 한 행 추가. 기존 `discover`는 ‘다시 찾기’이므로 덮어쓰지 않음 |
| 라우팅 | `sectionFor()`, `routeMode()`, `writeRoute()` | `interests`를 tools 하위와 허용 view에 추가. 정규 주소 `index.html?section=tools&view=interests`. `workbenchModes`에 넣지 않고 독립 렌더러로 연결 |
| 제목/복귀 | `subviewTitles`, `parentViews`, `renderHeader()` | 제목 ‘관심 확인’, 도구로 돌아가기. `parentViews` 포함으로 원문 이동 시 복귀 context 지원 |
| 렌더 분기 | `render()`의 collection/write/workbench 분기 직전 | `interests.open()`의 promise를 `mainRenderPromise`로 연결. 렌더 실패를 기존 `failure()`로 처리 |
| 정확한 원문 열기 | `openResult(mode, key, ref)` | `openResult('interests', stableFocusKey, { sourceId, sourceVersionId, locator })`; 실제 old version을 최신으로 바꾸지 않음 |
| 원문에서 복귀 | `returnToResults()`, `searchReturnButton()`의 labels | ‘관심 확인으로 돌아가기’. 비동기 interest 렌더 후 해당 `data-focus-key`로 초점/스크롤 복원 |
| 작업 종료/계정 전환 | `navigate()`의 flush 구간 및 UI dispose/workspace generation | 분석 취소/세대 차단. 입력을 임의 저장하지 않으며 원문 왕복 중 미확정 입력은 메모리에 보존. 실패한 명시 저장 때문에 입력을 지우지 않음 |
| 홈 보존 | `home.js:composeActions()`, `library()`, `#homePostList`, `#homePostSearch`, `[data-home-tab]` | 새 홈 hero나 상시 분석 패널을 추가하지 않음. 홈 진입이 추가로 필요하면 접힌 ‘자료실과 도구’ 한 조작만 고려하되 도구 진입이 우선 |

권장 안정 선택자(새로 정의할 계약): `#lifeInterestView`, `#lifeInterestMaterials`, `#lifeInterestPrepare`, `#lifeInterestAnalyze`, `#lifeInterestCancel`, `#lifeInterestManual`, `#lifeInterestSave`, `#lifeInterestStatus`. 근거 버튼에는 `data-focus-key="interest:evidence:<stable-id>"`, 자료 checkbox에는 `data-interest-version="<version-id>"`를 둔다. 이 이름은 현재 존재하는 코드라고 주장하지 않는다.

## 선택·분석·근거의 제품 계약

- 선택 목록은 보관한 **정확 버전**의 제목·본문 확보 범위·작성 관계를 보여준다. 최대 N건/길이 제한을 걸면 선택/실제 분석/누락 개수를 실행 전에 보여준다. `link_only`·본문 null은 ‘본문이 없어 제외’이고 성공 분석 건수가 아니다.
- 최근 일부를 자동 샘플링한다면 ‘선택 자료 전체’라고 쓰지 않는다. 모든 자료를 선택한 것과 전체 본문을 분석한 것은 다르다. 긴 글의 앞부분만 처리한 경우 누락 위치/문자 수를 안내하고 ‘전체 글을 읽음’으로 표시하지 않는다.
- 작성자가 `unknown`/`other`이면 ‘내가 반복해서 하는 생각/활동’의 근거로 승격하지 않는다. 필요하면 ‘보관한 자료에 나타난 주제 후보’로 제시하며 확인 전까지 관심으로 확정하지 않는다. 자료를 선택했다는 사실만으로 동의·신념·작성자 관계를 변경하지 않는다.
- 인용 근거는 `{sourceId, sourceVersionId, contentHash, locator:{start,end}, quote}`를 보존한다. UTF-16 `[start,end)`에서 `contentText.slice(start,end) === quote`, surrogate 경계, 실제 SHA를 확인한다. Core의 `locator`·`sourceRefs` 규칙과 동등해야 한다. 모델 입력 전처리 문자열의 위치를 원문 위치로 사용하지 않는다.
- 근거는 생성 요약보다 실제 원문 구절을 우선하고, 모델이 만든 해석은 ‘후보’로 표시한다. 같은 본문 계산을 재사용해도 서로 다른 작성 관계·버전·출처의 근거를 잃지 않는다.
- 각 후보를 사용자가 고르고 제목을 수정한 뒤 명시 저장한다. 분석 완료만으로 저장하지 않는다. 직접 입력은 근거 없이도 가능하되 출처를 ‘직접 입력’으로 구분한다. 사용자 수정 제목을 모델이 자동으로 다시 덮지 않는다.
- 준비와 분석은 서로 다른 행동이다. 준비는 모델 파일 다운로드/캐시이며, 분석은 선택한 텍스트의 기기 내 실행이다. 외부 요청에는 모델 자산 URL만 허용하고 개인 본문·관심은 포함하지 않는다. 페이지 열기나 checkbox 선택만으로 모델을 다운로드하지 않는다.

## 상태 문구의 기준

| 상태 | 문구 예 | 피할 주장 |
|---|---|---|
| 준비 전 | ‘모델 파일을 받은 뒤 이 기기에서 실행합니다. 자료 본문은 전송하지 않습니다.’ + 확인된 총 크기 | ONNX 하나의 크기를 총 다운로드 크기로 표시 |
| 부분 입력 | ‘선택 12건 중 본문이 있는 9건을 분석합니다. 긴 자료 2건은 일부만 포함합니다.’ | 전체 보관함/모든 글을 분석함 |
| unknown/other | ‘작성자 미상 자료의 주제 후보 · 직접 확인해 주세요.’ | 당신의 신념·활동·반복 질문으로 확정 |
| 품질 기준 실패 | ‘현재 모델은 한국어 관심 후보의 품질 기준을 충족하지 못했습니다. 관심은 직접 적어 보관할 수 있습니다.’ | 자동 분석 완료·성향 파악 성공 |
| 빈 결과 | ‘확인할 후보를 찾지 못했습니다. 자료를 바꾸거나 직접 입력해 주세요.’ | 관심이 없음·취향이 없음 |
| 오류/취소 | ‘분석을 마치지 못했습니다. 선택과 작성 내용은 남아 있습니다.’ | 빈 후보를 성공 결과로 저장 |
| 확인 저장 | ‘이 브라우저의 현재 계정·작업공간에 저장했습니다.’ | 계정 서버 동기화·기기 간 보관 완료 |

정확한 준비 용량·지원 상태는 모델 manifest와 실제 runtime 요청을 근거로 써야 한다. 성격/성장 점수, 성공을 암시하는 가짜 confidence %, 취향 확정 어조는 필요 없다.

## 저장 구조

`storage.js`의 `readReadingPosition()/writeReadingPosition()` 패턴이 적합하다. `interestProfile:${accountKey}:${workspaceId}`의 독립 meta row로 두고 다음을 유지한다.

1. accountKey는 이미 `JSON.stringify([account.projectUrl, account.userId])`로 만들어진다. UI가 전달한 임의 계정 문자열을 소유 증거로 사용하지 않는다. `scopeGuard()`와 `checkedBundle()`을 readonly/readwrite transaction 안에서 호출한다.
2. profile은 format/workspaceId/revision과 명시 확인한 interests를 저장한다. 새 저장은 baseRevision CAS, 초기화는 revision을 남긴 tombstone으로 늦은 탭의 부활을 막는다. 충돌 때 미확정 입력은 남고 최신 내용을 별도로 확인한다.
3. 모델 ID/revision·실제 처리 범위·근거는 결과 provenance다. 원문/sourceVersion/workbench revision, 기존 record·발췌·작성자 관계를 바꾸지 않는다. existing backup/sync/public payload에 새 profile을 자동 포함하지 않는다.
4. 새 저장 시 현재 정확 버전·해시·인용 구간을 transaction의 bundle에 대조한다. 과거 저장 profile을 읽을 때 근거가 없어졌으면 ‘확인 불가’를 표시하고 사용자의 직접 확인한 관심은 보존한다. 최신 버전으로 대체해 근거를 꾸미지 않는다.
5. 런타임 embedding 전체와 모델 handle을 profile에 저장할 필요는 없다. 임시 후보·분석 진행률·돌아갈 초점은 메모리 상태로 분리한다. 모델 파일 캐시는 개인 profile 메타데이터와 별도 수명주기를 둔다.
6. dispose/계정·작업공간 변경 시 pending 분석 세대를 무효화하고 결과/오류/진행률 적용을 차단한다. 입력과 profile은 account+workspace로 격리되며 다른 계정으로 복사하지 않는다.

## 최소 검수 범위

- 실제 앱 로그인 화면 이후 도구 행을 눌러 진입; 정확 버전 선택, 명시 준비, 분석, 근거 원문·이전 버전 왕복, 후보 수정/직접 입력, 명시 저장, reload 후 재열기.
- unknown/other/link-only, 긴 글 일부, 실제 빈 결과, 준비/추론 실패, 취소 후 늦은 응답, retry, 계정/공간 변경, 두 탭 CAS와 초기화 후 늦은 저장을 포함한다.
- 모델 자산만 외부 요청하고 개인 입력 전송이 0인지 요청 로그로 확인한다. 원문·workbench 전후 SHA/revision, 기존 backup과 작성 흐름을 보존한다.
- 1440/820/390px 실제 캡처에서 한글 긴 제목·근거·폼, overflow·44px 버튼·16px 입력·초점/복귀·status를 검토한다. 불필요한 카드/큰 소개 면·통계 수치를 늘리지 않는다.
- 실제 모델 경로와 합성 fixture 경로의 결과를 따로 보고한다. Linux Chromium의 화면 폭 모사를 Apple 실기·성능으로 보고하지 않는다. 자동 관심 품질이 실패하면 그 상태와 직접 입력 흐름을 제품에서도 명확히 보여준다.

브라우저·스크린샷 독립 검토는 구현과 실제 증거가 나온 뒤 추가한다. 이 문서의 제안만으로 기능·시각 검수가 완료된 것은 아니다.

## 독립 브라우저 검수 결과

2026-10-19 KST, `tests/life-interest-browser.cjs`를 작성하고 실제 로컬 앱·동봉 SDK·IndexedDB·FakeCloud 익명 Auth HTTP에서 실행했다. 운영 계정·모델 가중치·외부 추천 피드·개인 자료는 사용하지 않았다. 합성 분석 케이스는 실제 `InterestAnalysis` factory에 명시 `embed` 벡터를 주입하고 policy를 검사용으로 열었다. 실제 모델 의미 품질을 평가하는 검사가 아니다.

첫 전체 실행은 10개 기준 중 8개 통과였다. 실제 로그인 복귀 allowlist에 `interests`가 없어 관심 화면으로 돌아오지 못하는 결함, 근거 버튼이 export되지 않은 `core.sha256`을 호출해 열리지 않는 결함을 발견하여 구현 담당에게 전달했다. 구현 담당이 두 결함을 수정한 뒤 실패 2개와 취소/시각 영향 범위를 집중 재실행해 6/6 통과했다. 따라서 10개 기준은 최초 결과와 집중 재검수 조합으로 확인했으며, 단일 최종 전체 10개 실행으로 표현하지 않는다.

확인한 범위: 도구 실제 진입, policy 차단 상태의 수동 관심 명시 저장·새로고침·초기화, IDB 실패 뒤 입력 보존·재시도, 두 탭 CAS/최신 재조회/초기화 tombstone, 작업공간·계정 격리, 합성 분석의 실제 원문 SHA/UTF-16 구절, 정확 reader 왕복·수동 작성 내용·초점 복귀, 후보 명시 확인, 합성 추론 실패·빈 결과, 지연 추론 중 이동 취소·재시도. 원문/workbench 불변을 비교했고 모든 검사에서 실제 서버 쓰기 0건이다. 두 실행 모두 예상 밖 console/page 오류·외부 요청·모델 요청 0건이다.

390/820/1440px의 최종 실제 policy 화면을 직접 보았고 한글 긴 제목·작성 관계·입력·선택 목록이 읽히며 가로 넘침이 없음을 확인했다. 입력 폰트 16px 이상, 표시된 버튼 44px 이상을 실측했다. 고정 하단 탐색은 전체 페이지 캡처 중간에 보일 수 있어 그 캡처를 모든 스크롤 위치의 비겹침 증거로 사용하지 않았다. Apple 실기·IME·메모리·모델 속도·사용자 유용성·배포 검수는 포함하지 않았다.

증거: `/workspace/haedo-discovery/.local/interest-browser/report.json`, `/workspace/haedo-discovery/.local/interest-browser-recheck/report.json`, 후자의 `interest-manual-390.png`, `interest-manual-820.png`, `interest-manual-1440.png`. 테스트 파일은 `node --check`와 해당 파일 diff 공백 검사를 통과했다.

최종 stale-UI 보완 후 별도 회귀 3개도 집중 실행해 3/3 통과했다(`.local/interest-browser-regression/report.json`). 수정하지 않은 두 번째 탭의 ‘최신 관심 확인’ 이후 다시 저장해도 새 수동 관심을 되돌리지 않으며, 수정하지 않은 후보 선택은 다른 탭의 확인/해제 후 재진입 시 최신 값을 따른다. 실제 checkbox를 바꾼 미확정 선택은 앱 밖 목표 화면 이동·작업공간 선택·실제 로그아웃을 모두 막고 선택을 보존했다. 명시 후보 확인 후 외부 이동, 입력 되돌리기 후 작업공간 전환은 허용됐다. 이 세 회귀 실행도 예상 밖 console/page 오류·외부 요청·모델 요청·실제 서버 쓰기 0건이며 관련 없는 이전 10개 흐름은 재실행하지 않았다.
