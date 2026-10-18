# MODEL-02 독립 held-out 사전등록

이 평가는 기존 MODEL-01 자료를 재사용하지 않은 합성 한국어 문서 48개로 시행한다. 문서 내용·정답은 구현 담당자와 총괄에게 후보 소스가 동결될 때까지 공개하지 않는다. 모델 출력이나 실패를 본 뒤 문서·정답·임계값을 바꾸지 않는다. 현재 후보가 실패하면 실패를 보고하고, 변경한 후속 후보에는 새 독립 평가가 필요하다.

fixture: `private-heldout.json`, schemaVersion 2. SHA256: `c7ac6d3c3978ed97acc0530ca63799cbff7a9af16504c18caa3d4324af360791`.

평가 단위는 선택한 자료의 주제와 반복 질문이다. 다른 사람이 쓴 자료도 자료의 주제는 보여 줄 수 있지만 사용자의 믿음이나 직접 던진 질문을 증명하지 않는다. 정확한 원문 인용과 의미상 올바른 근거를 각각 검사한다.

## 동결과 실행 계약

- baseline과 candidate의 실행 소스, 설정, 모델·런타임을 먼저 동결하고 SHA256을 기록한다. fixture는 동결 전 구현 담당자가 열람하지 않는다.
- runner에는 문서 `id`, 원문 `text`, `originalAuthor`만 전달한다. 정답, 태그, 질문 군집, 허용·금지 범위는 전달하지 않는다.
- 동일 입력·모델·런타임을 두 구현에 사용한다. 구현별 고정 설정 차이는 기록하고, 결과를 본 뒤 변경하지 않는다.
- 결과 파일은 `baseline-output.json`, `candidate-output.json`. 분석은 `result.analysis.interests`를 우선 사용하며 `analysis.interests` 또는 최상위 `interests`도 지원한다.
- 각 interest는 `kind: topic|question`, `id`, `label`, `support`, `evidence`를 가진다. topic ID는 기존 10개 ID 또는 `topic-` 접두사를 붙인 동일 ID를 사용한다. 질문에는 topic ID를 요구하지 않는다.
- evidence는 `sourceId`, `sourceVersionId`, `sha256`, `start`, `end`, `quote`. 기본 source/version ID는 `s-{documentId}` / `v-{documentId}`. 다르면 결과의 `sourceMap`에 명시한다.
- SHA256은 정규화하지 않은 원문 UTF-8, 범위는 원문 UTF-16 code unit의 `[start,end)`다. BOM·CRLF·이모지를 바꾸지 않는다.
- runner는 `bundleUnchanged`, 문서별 비절단 tokenizer 길이 `tokenCounts`, `sourceSHA256`, `model`, `runtime`, `config`를 기록한다. `frozen-sources.json`에는 baseline/candidate의 사전 동결 SHA256과 fixture SHA256을 기록한다. 출처·실행 증거가 없으면 통과로 간주하지 않는다.

## 절대 도입 조건

아래 조건을 **모두** 만족해야 한다. empty output은 recall 조건으로 실패한다. 점수는 확률이 아니다.

1. **의미상 근거 정확도 95% 이상.** 출력된 모든 topic/question evidence가 분모다. topic evidence는 해당 주제의 사전 허용 범위와 겹치며 금지 범위와 겹치지 않아야 한다. question evidence는 한 실제 반복 질문 군집의 순수한, 서로 다른 원문 해시 2개 이상으로 지지되어야 한다. 잘못된 질문 묶음의 모든 근거는 잘못된 근거로 센다.
2. **금지 근거 0개.** 부정된 주제, 문구 자체에 대한 메타 기록, 인용된 과거 명령·질문을 양의 관심/반복 질문 근거로 쓰지 않는다. 단어를 인용했거나 높은 유사도를 얻었다는 이유로 허용하지 않는다.
3. **주제 누락 방지.** 10개 주제 중 적어도 8개에 올바른 독립 본문 근거가 2개 이상 있어야 한다. 주제별 올바르게 출력한 문서-주제 근거 recall을 본문 SHA256으로 중복 제거한 뒤 10개 주제에서 macro 평균하여 **50% 이상**이어야 한다. 질문 evidence를 별도 topic evidence로 자동 가산하지 않는다.
4. **반복 질문.** 정답 반복 질문 군집의 적어도 **75%**를 서로 다른 원문 본문 2개 이상의 정확한 근거로 찾아야 한다. 출력 question evidence precision은 **95% 이상**이다. 다른 의미의 질문을 합치거나 단독 질문을 반복 질문으로 제시하는 군집은 **0개**여야 한다. 질문 라벨을 원문 그대로 쓰거나 바꿔 쓰는 것은 모두 허용하며, 의미 판단은 사전 군집의 원문 근거로 한다.
5. **보존·출처·저자.** 모든 근거의 source ID, 정확 버전, 원문 SHA256, UTF-16 start/end와 quote가 **100% 일치**해야 한다. 한 interest 안에 같은 본문 해시를 둘 이상의 독립 근거처럼 제시하지 않는다. 표시 support는 distinct evidence body 수 이상이며 전체 입력 distinct body 수 이하여야 한다. 정답에 있는 중복 본문 쌍을 함께 근거로 쓴 경우 지지 수가 부풀었는지 별도 보고한다. 입력 bundle이 변하지 않아야 한다. unknown/other가 self로 명시 변환된 경우는 **0개**여야 한다.
6. **장문.** 512 tokens를 넘는 원문에서 중간의 관련 대목을 정확한 topic evidence로 최소 1개 찾아야 한다. 비절단 tokenizer 길이를 runner가 기록하여 길이를 확인한다. 앞부분 절단으로 중간 근거를 잃으면 실패한다.

저자 판정의 자동 검사는 generated metadata의 `authorRelation`, `originalAuthor.relation`, `perspective`, `beliefOwner` 등에 명시된 self/user attribution과, 원문 quote를 제외한 앱 작성 문구의 분명한 사용자 믿음·관심·질문 단정을 검사한다. 단순한 “선택한 자료의 주제” 표시는 허용한다. 모호한 문구는 별도 검토 항목으로 남기고 검증 없이 저자 처리 전체 통과를 주장하지 않는다. 이 자동 검사가 실제 언어의 모든 귀속 표현을 포괄한다고 주장하지 않는다.

문서의 전체 허용 범위와 금지 범위는 문서별로 사전 기입했다. 장문은 의미 있는 중간 부분만 허용한다. 유효 topic quote는 최소한 한 허용 범위에서 전체 비공백 문자 길이의 50% 이상을 차지해야 하며, 금지 범위의 비공백 문자와 겹치면 금지 근거다. 이 규칙은 관련 단어 한 조각을 포함한 무관한 긴 창의 통과를 막는다. source quote가 원문과 다르면 의미상 점수가 맞더라도 integrity 조건은 실패한다.

## baseline 대비 조건

candidate는 baseline보다 전체 의미상 evidence precision, topic macro recall, 반복 질문 군집 recall이 낮아지면 안 된다. 세 지표 중 하나 이상은 엄격히 개선되어야 한다. baseline이 실패해도 위 절대 조건은 면제하지 않는다. baseline의 empty output precision은 0으로 정의하며 recall도 0이다.

## 보고와 한계

문서별·근거별 판정, 근거 인용, topic별 정답/출력 수, 질문 군집별 결과, 장문·중복·저자·출처 결과를 모두 보관한다. primary 원시 임베딩 순위 검사를 앱 출력의 대용으로 쓰지 않는다. baseline 복구 범위와 재구성 구간이 있으면 보고한다. source 동결·원문 보존·실제 실행에 관한 runner 자료가 없으면 해당 조건은 미확립으로 표시하고 도입을 보류한다.

합성 48개 문서는 통계적 대표 표본이 아니며 실제 기록의 오탐률·취향 만족도·장문 일반화·모든 저자 귀속 표현을 증명하지 않는다. Apple 실기기나 제품 사용성 검증을 수행했다고 보고하지 않는다.
