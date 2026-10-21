# 원문 언어를 고정한 로컬 읽기 비교

2026-10-20 KST. 기존 [직접 읽기 비교 CLI](../../scripts/evaluate-discovery-field.cjs)에 뉴스의 원문 언어 조건을 연결했다. 최신순·관심순·개인 추천과 좋아요 신호 제거 진단이 같은 언어 선택을 사용한다. 과거 문서의 ‘CLI는 전체 언어만 지원’은 이 변경 전의 제한이다. 앱의 언어 설정이나 사용자 반응을 자동으로 읽지 않으며, 실제 사용자 선택·독서·효용을 새로 판정하지 않는다.

## 바로 실행하기

저장소 루트에서 다음 명령으로 **동봉된 공개 목록**의 영어 조건 양식을 만든다. 네트워크·로그인·브라우저 데이터는 사용하지 않는다.

```sh
node scripts/evaluate-discovery-field.cjs \
  --content-languages en \
  --now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --out .local/discovery-field/reading-en-01
```

`--out`은 새 하위 폴더여야 한다. 이미 있으면 다른 이름을 고르며 기존 답을 덮어쓰지 않는다. 결과는 `evaluation.md`의 중립 목록 A/B/C, `review-template.json`의 빈 읽기 양식, `evaluation.json`의 재현 조건·정확 문자열 근거다. 주제·반응을 지정하지 않은 위 명령은 최신순 후보만 있을 수 있으며, 개인 추천이 작동했다거나 평가를 마쳤다는 뜻이 아니다.

| `--content-languages` 값 | 의미 |
| --- | --- |
| 생략 또는 `all` | 전체 언어, 프로그램 API의 `null`과 같음 |
| `none` | 명시적인 선택 없음, API의 `[]`과 같음. 네 조건 모두 후보 없음 |
| `ko`, `en`, `ja`, `zh`, `es`, `fr`, `de` | 해당 기본 언어 |
| `ko,en` 등 쉼표 목록 | 정해진 언어를 복수 선택. 공백·중복 없이 입력 |
| `und`, `mul`, `other` | 언어 미확인·여러 언어·기타 언어 |

예를 들어 `--content-languages ko,en`으로 두 언어를 고른다. `en-US`는 필터 옵션으로 받지 않는다. 기사에 제공된 `en-US`는 앱과 동일하게 `en`으로 비교한다. `ko-KR`은 `ko`, `zh-Hant`는 `zh`이며 원래 메타데이터는 유지한다. 잘못된 값·중복·빈 토큰은 오류로 중단하고 전체 언어로 조용히 환원하지 않는다.

## 주제·반응을 직접 지정할 때

사용자가 정한 주제가 있을 때만 로컬 JSON `{ "schemaVersion": 1, "topic": "직접 고른 표현" }`을 만들고 `--topic-file FILE`로 지정한다. 없음이나 `topic:null`은 미선택이다. 예시 표현을 사용자의 실제 관심으로 기록하지 않는다.

전용 반응 사본은 명시적으로 사용할 파일만 `--actions FILE --actions-kind user_supplied`로 지정한다. 합성 조건은 `--actions-kind simulation`으로 구분한다. 파일 제공 자체는 실제 독서·만족이나 취향 확인 증거가 아니다. strict preview 후 평가용 메모리에만 재구성하며, 앱 import·개인 추천 opt-in·저장 상태는 바꾸지 않는다.

`--feed FILE`을 생략하면 동봉 공개 파일을 쓴다. **현재 뉴스 화면과 비교하려면 같은 공개 feed bytes·평가 시각·주제·활성 출처·언어·known/read/hide 제외 조건을 따로 고정해야 한다.** 이 CLI는 앱의 개인 설정·읽음/제외·보관 목록을 자동으로 가져오지 않는다. 아래 명시 조건 파일을 생략하면 기존대로 전체 출처·빈 피드백·명시 반응 사본의 과거 좋아요 URL을 사용한다. 화면의 조건을 지정하거나 확인하지 않았다면 동등하다고 주장하지 않는다. 수집이 갱신되면 새 폴더·새 비교로 구분하고 앞선 답을 새 글로 옮기지 않는다.

## 출처·보관 URL·읽음/제외 조건을 명시할 때

2026-10-21 UTC 보완. 필요할 때만 로컬 조건 파일을 직접 만들고 `--conditions-file FILE`을 추가한다. 공개 메타데이터 URL도 사용자의 보관·읽음/제외와 연결되면 비공개 입력이며, 저장소나 공개 산출물에 넣지 않는다. 다음은 **실제 사용자 설정이 아닌 빈 형식 예시**다.

```json
{
  "schemaVersion": 1,
  "disabledSourceIds": [],
  "knownUrls": [],
  "feedback": []
}
```

네 필드 모두 필수이며 추가 키는 거절한다. `disabledSourceIds`는 기존 승인 출처 ID의 중복 없는 목록이다. 현재 공급에서 잠시 사라진 승인 ID도 유지하며, 알려지지 않은 출처는 받지 않는다. 기존 `DiscoverySettings.update/filterFeed`로 출처와 기사를 함께 거른다. 후보·좋아요 근거·`inspectSignals`에 같은 활성 출처를 사용한다.

`knownUrls`는 최대500개의 서로 다른 **canonical HTTPS URL**이다. 기존 승인 출처의 정확한 호스트만 받으며 사설/임의 호스트, 사용자 정보·비표준 포트·HTTP·추적 query·fragment가 남은 URL은 거절한다. 먼저 정규화하라는 오류를 자동으로 전체 언어/출처 조건으로 바꾸지 않는다. 화면의 보관 원문 URL과 같은 정체성을 지정한다.

`feedback`은 최대500행이며 각 행은 정확히 `articleId`, `canonicalUrl`, `kind`, `updatedAt`을 갖는다. `articleId`는 기존 모델의1~128자 ID, `kind`는 `already_read` 또는 `not_relevant`, `updatedAt`은 고정 `--now` 이하의 유효한 UTC ISO 시각(소수초 없음 또는3자리)이다. 같은 canonical URL을 중복 기재하지 않는다. 기존 `DiscoveryProfile.validate`로 고립된 평가용 profile을 검증한다. 실제 읽음·관심 없음으로 추정하거나 좋아요 신호로 쓰지 않는다.

조건 파일은 최대256KiB의 strict UTF-8 JSON이다. 프로그램 API는 `prepare(feedBytes,{conditionsBytes,...})`, 파일 쓰기 API는 `writeEvaluation({conditionsFile,...})`로 전달한다. 입력의 계정·workspace·revision·메모·본문은 받지 않으며 실제 저장소/export를 확장하지 않았다. 원래 과거 좋아요 URL과 제공 `knownUrls`의 합집합을 네 비교군에 고정하고, 읽음/관련 없음과 비활성 출처도 신호 제거 뒤 그대로 유지한다. 동일한 전체 JSON의 관심순 fallback을 계속 확인한다.

조건을 지정하면 `evaluation.json.conditions.explicit`와 `review-template.json.explicitConditions`에 입력 해시·비활성/활성 출처·제공 URL·피드백을 비공개로 기록한다. 실제 화면 조건 일치 확인은 `actualUserConditionsConfirmed:null`이다. 파일 지정은 사용자의 실제 선택/읽기/효용 확인을 대신하지 않는다. 공개 feed 원래7출처의 실패/수집 상태는 `report.feed`에 보존하고, 실제 활성 출처는 각 모드 metadata와 explicit 조건에 구분한다.

예를 들어 위 빈 파일을 `.local/discovery-field/inputs/conditions.json`에 직접 만들었다면, 새 출력 이름으로 실행한다. 입력/출력 폴더는 예시이며 기존 폴더를 덮어쓰지 않는다.

```sh
node scripts/evaluate-discovery-field.cjs \
  --content-languages en \
  --conditions-file .local/discovery-field/inputs/conditions.json \
  --now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --out .local/discovery-field/reading-en-with-conditions-01
```

화면과 CLI의 조건을 사람이 확인해야 하는 점과 기본 비교의 개인 기준 `related`, 각 목록 상위2개(화면 상위5개와 구분), 모드별 고유 후보 규칙은 유지한다. 공급·주제 표현·언어만 같다고 개인 화면을 완전히 재현했다고 표시하지 않는다.

## 같은 조건으로 계산하는 방법

- 실제 공통 모듈인 `discovery-language-settings.js`의 strict 설정 검증과 `Discovery.languageAllowed`·`languageKey`를 재사용했다. 새 언어 파서·번역 SDK·모델·패키지를 추가하지 않았다. 기존 네이티브 Intl과 로컬 랭커를 연결하는 범위이므로 새 오픈소스 도입은 없다.
- `prepare(feedBytes,{now,contentLanguages})`와 `writeEvaluation({...,contentLanguages})`는 `null` 또는 정해진 코드 배열을 받는다. 생략은 `null`이다. UI 모델 검증은 고립된 메모리 설정으로만 수행하며 실제 `DiscoveryLanguageSettings` 저장소를 읽거나 갱신하지 않는다.
- 같은 `contentLanguages`를 네 arm의 rank options와 `Recommendations.inspectSignals`에 전달한다. 후보는 상위 개수 제한 전에 공통 후보 풀에서 걸러지고, 과거 좋아요 snapshot도 같은 조건으로 걸러진다. 같은 출처라는 이유로 다른 언어 좋아요가 근거로 남지 않는다. 출력 근거도 당시 snapshot과 후보의 실제 UTF-16 구간 및 언어 조건을 다시 대조한다.
- 원문 언어는 기사에 제공된 표기다. 출처의 언어로 미확인 값을 추정하지 않으며 제목·본문을 탐지하거나 번역하지 않는다. 지역 태그·미확인·혼합·기타의 분류는 뉴스와 같다. 번역 대상·관심 표현·별칭·점수 정책을 바꾸지 않는다.
- 원래 과거 좋아요 URL은 언어 선택과 관계없이 모든 arm에 같은 known 제외로 고정한다. 신호 제거는 `liked=false/likedAt=null`만 바꾸고 담기·제외·후보 조건을 유지한다. 결과 전체 JSON은 같은 언어 조건의 관심순과 정확히 같아야 한다. 개인 추천의 원래 미래 발행일 정책 등 모드별 선택 차이는 유지한다.
- 좋아요가 없거나 해당 언어의 신호가 부족하거나 표현이 겹치지 않으면 정확한 기준순서 fallback이다. 언어 때문에 신호가 제외된 경우 검사 진단의 `languageOff`가 이를 구분한다. 후보 수·적용 여부·목록 차이는 효용이나 학습 모델 개선 점수가 아니다.

조건은 `evaluation.json.conditions.contentLanguages`와 `review-template.json.contentLanguages`, 읽기용 Markdown에 기록한다. 원래 source 실패·lastSuccess·stale·기사 언어 표기·본문 확보 범위를 바꾸지 않는다. 코드 출처 해시에는 재사용 언어 설정 모듈도 포함한다.

## 보존과 확인한 범위

출력은 gitignored `.local/discovery-field/`의 새 하위 폴더에만 생성한다. 루트 밖·상위 심볼릭 링크·기존 경로를 거절하며 폴더700/파일600과 독점 생성을 유지한다. 입력 파일과 기존 사용자 답은 변경하지 않는다. stdout에는 공개 feed/코드 해시·고정 파일명·미평가 상태만 남기며 주제·반응·입력 경로·개인 입력 해시·언어 선택을 덤프하지 않는다. 오류도 입력 조각이나 파일 경로를 포함하지 않는 고정 메시지다.

집중 검사 `node --test tests/discovery-field-evaluation.test.cjs tests/discovery-evaluation.test.cjs` **23/23**과 구문·diff 검사를 통과했다. 합성 공개 메타데이터·합성 반응을 사용해 전체/한국어/영어/복수/선택 없음/미확인/혼합/기타, 지역 태그, 잘못된 옵션, 다른 언어 좋아요 제외, 빈 후보 풀, 출처 실패·stale, 원값 불변과 네 arm의 실제 랭커 결과 일치를 확인했다. 생략과 `null`의 전체 결과는 같고, 기존 공개9표본 CLI는 수정하지 않았다.

명시 조건 보완의 집중 검사는 **27/27**이다. 기존23개를 유지하며 UI의 실제 출처 투영·원래 네 랭커의 전체 JSON 해시/metadata 일치, 보관/읽음/관련 없음/출처 제외, 출처·언어별 좋아요 제외와 빈 공급, 부정확한 URL·중복·추가 키·미래/잘못된 날짜·용량 거절, CLI 입력 불변·기존 답 보존·출력/오류의 비공개 값 비노출을 추가했다. 조건 파일 미지정의 결과는 이전과 같고, 명시 빈 조건의 랭킹도 같다. 코드 해시는 새 CLI와 재사용 설정/피드백 모듈을 반영한다.

실제 사용자 선택·반응 확인·읽기 전 의향·이미 앎·원문 접근·읽은 범위·실독 후 도움·목록 선호는 계속 `null`이다. 검사가 사용자 평가를 대신하지 않는다. 다음 직접 사용은 같은 조건에서 사용자가 고른 한 글을 원문 또는 명시 번역으로 읽고, 확인한 범위와 도움 한 줄만 새 로컬 양식에 남기는 것이다. 실제 번역 성공·Apple/Google 실기·일반 추천 품질과 공개 배포 여부는 별도 근거를 따른다.
