# MODEL-03 독립 held-out 사전등록

목적은 선택 자료의 실질적인 주제와 여러 독립 본문에서 반복된 해결 질문을 원문 근거와 함께 제안하는 후보를 평가하는 것이다. 원시 임베딩 순위, 공개 개발 fixture의 결과, 짧은 NLI 가능성 검사를 완성 파이프라인의 품질로 대신하지 않는다.

비공개 fixture는 `private-heldout.json`, schemaVersion 3, 합성 문서 60개다. SHA256은 `b56296da7ac356cbc9918b5b80026536f00ffbca7bf9a1f9d74c73756e9e46cf`다. 이전 48문서·12 NLI쌍과 같은 원문을 쓰지 않았으며 연속 24문자 공유도 검사했다. 실제 사람·계정·개인 문서·외부 URL은 없다.

## 독립성과 입력

후보 구현자는 공개 개발 자료만 사용한다. 후보 코드·모델·런타임·예산·임계값을 동결하고 평가기와 이 사전등록을 봉인한 뒤에만 `input-only.json`을 내보낸다. runner는 id/text/originalAuthor만 읽는다. topic gold, 질문 범위·군집, 태그, 금지 범위는 전달하지 않는다. 동결 후 같은 held-out을 보고 알고리즘·임계값·문서를 바꿔 재합격시키지 않는다.

입력 구조는 `{schemaVersion:1, documents:[{id,text,originalAuthor:{relation:self|unknown|other}}]}`다. 원문은 정규화하지 않는다. evidence source/version은 기본 `s-{id}`/`v-{id}`이며 다르면 sourceMap을 명시한다. SHA256은 UTF-8 원문, 범위는 UTF-16 code unit의 `[start,end)`다. BOM·CRLF·이모지도 그대로 보존한다.

관측 출력은 `analysis.interests`의 topic/question, label, support, evidence다. evidence는 source ID, 버전 ID, SHA256, start/end, quote, authorRelation, quoteProvenance를 포함한다. 질문 검출은 `diagnostics.questionCandidates`에 의미 검증 전의 정확한 추출 범위를 전수 보관한다. source stage 범위와 실제 모델 호출을 대조할 coverage trace, 전체/실제 tokenizer 길이, 절단 여부, 불완전 사유, 입력 불변 증거를 함께 보관한다. 출력 필드의 사전 합의된 래퍼·동일 의미 키 별칭만 해석하며 점수나 내용을 고치지 않는다.

## ontology와 정답

주제 relation은 **material_subject**다. 자료가 해당 주제의 실제 활동·방법·경험·설명·해결 문제를 실질적으로 다룬다는 뜻이며 작성자 또는 사용자의 현재 신념·선호라는 뜻이 아니다. 실패한 실험, 통증을 피하는 방법, 다투지 않는 방법 같은 일반 부정문도 실질 주제를 지지할 수 있다.

단어 모양만 다룬 기록, 주제 관심이나 경험을 부인하기만 하는 문장, 과거 명령을 인용하기만 한 기록을 긍정 관심 근거로 쓰지 않는다. 독서를 싫어한다는 말만 한 기록과 독서 강요의 사회 제도를 실질적으로 분석한 기록은 다르다. unknown/other가 쓴 자료의 주제는 허용하지만 이를 현재 사용자의 직접 작성·보편 신념·개인적 질문으로 승격하면 critical 실패다.

10개 주제 ID는 기존 ontology 그대로 고정했다. 질문 정답은 여섯 의미쌍(각기 다른 본문 두 개), 같은 주제지만 다른 여섯 단독 질문을 포함한다. 전체 gold question source는 18개이며 그중 9개는 물음표 없는 문장형이다. 같은 주제나 키워드만으로 같은 질문이 되지 않는다. 해결하려는 조건·목표·행동 문제가 같아야 같은 군집이다. 문서별 topic과 문장별 question gold는 개발자 비공개다.

## 근거 판정

source ID와 정확 버전, raw body SHA256, UTF-16 범위의 원문 quote가 모두 일치해야 integrity 정답이다. 원문과 다른 quote는 의미가 그럴듯해도 실패다.

topic evidence는 해당 주제의 gold 허용 범위가 quote의 비공백 문자 중 최소 50%를 차지하며 금지 범위의 비공백 문자와 겹치지 않아야 한다. 문서 안 관련 문장 하나를 포함한 무관한 긴 창이 통과하지 않도록 한 규칙이다. 출력 후 모든 근거를 독립적으로 재독하여 source 단위 annotation의 한계와 실제 의미 오류를 기록한다.

질문에서 source 범위의 정확성과 gold의 특정 문장부호 경계 동일성을 구별한다. 올바른 검출은 다음을 모두 만족한다.

- source/hash/UTF-16 quote가 정확하다.
- gold question의 모든 Unicode 문자·숫자가 predicted 원문 범위에 포함된다. 공백·문장부호만의 경계 차이는 허용한다.
- gold question 밖 extra 비공백 문자는 gold question 비공백 길이 이하이다.
- 금지 대목이나 별개 gold question을 함께 포함하지 않는다.

따라서 짧은 앞 문맥이나 끝 문장부호 차이만으로 의미 질문 검출을 실패로 만들지 않는다. gold start/end까지 동일한 **boundary exact** 지표는 별도로 보고한다. 위 질문 명제 보존 규칙은 questionCandidates와 최종 question evidence에 동일하게 적용한다.

올바른 반복 질문 출력은 두 개 이상의 서로 다른 source ID와 whole-body SHA256에서 나온 질문 근거가 같은 gold 군집에 속해야 한다. 군집이 섞이거나 단독 질문을 반복이라고 제시하거나 같은 본문 사본 두 개를 독립 지지로 세면 잘못된 출력이다. 같은 정답 군집의 여러 pair 출력은 recall에서 한 번만 센다. 라벨의 문자 일치는 요구하지 않지만 새 의미·조건을 만들어 냈는지 독립 재독한다.

## 절대 채택 조건

다음을 모두 만족해야 한다. 누락·예산 초과·기권 때문에 정답 분모를 줄이지 않는다.

1. **topic evidence precision ≥95%**와 **question evidence precision ≥95%**를 각각 충족한다. valid/total 원수와 Wilson 95% 구간을 함께 보고하되 사전 문턱은 point estimate에 적용한다. 각 head는 gold positive가 있으므로 empty output precision은 0, recall도 0이다. 개별 negative-only에서 출력이 없는 올바른 기권을 precision 0이라고 부르지 않는다.
2. **topic macro document recall ≥70%**. (본문 raw SHA256, topic ID)를 단위로, 주제마다 올바르게 출력한 독립 본문 수 / 해당 주제 gold 독립 본문 수를 구하고 10개 주제 전체에서 macro 평균한다. 같은 본문 사본은 한 번만 센다. 주제와 질문의 output cap은 분리한다.
3. **질문 source 검출 recall ≥70%**, **문장형 source 검출 recall ≥70%**. 의미 검증 전 questionCandidates에서 위의 source-정확 명제 보존 규칙으로 각각 18개 전체 / 9개 문장형 gold를 채점한다. raw candidate precision은 별도 기술 통계이며 금지 출력 기준은 의미 검증 후 양의 출력에 적용한다.
4. **반복 질문 군집 recall ≥70%**. 여섯 gold 군집 중 최소 다섯 군집을 정확한 두 독립 본문으로 찾아야 한다. 혼합·단독·중복 본문을 반복으로 주장한 출력은 0개여야 한다.
5. **양의 forbidden evidence 0개**. 부정된 관심만의 기록, 메타 문구, 인용된 과거 명령·질문, 장문 길이 채우기용 무의미 부분을 양의 관심/반복 질문 근거로 쓰지 않는다. 일반 부정 표현 자체를 forbidden으로 묶지 않는다.
6. **모든 출력의 source/SHA/UTF-16 quote 일치 100%**, authorRelation 원본 일치, 한 interest 안 본문 중복 지지 0, 표시 support와 visible distinct body 수·계약의 일치, 입력 원문 불변을 충족한다. scope는 saved_material이며 unknown/other 또는 과거 인용을 현재 사용자 믿음·저작·개인 질문으로 명시 승격한 경우는 0개여야 한다.
7. **처음·중간·끝 장문 세 개 모두**에서 gold 관련 부분을 올바른 topic evidence로 찾아야 한다. 각 whole-body의 비절단 tokenizer 길이가 512를 넘었는지 실제 tokenizer로 기록한다. 짧은 부분만 처리하고 장문 전체를 검증했다고 하지 않는다.
8. **coverage accounting 정확 / 무음 절단 0**. 아래 단계별 계약과 실제 callback trace가 일치하며 누락이 숨겨지지 않아야 한다. 결과가 incomplete이면 도입은 기각/보류이며 missing gold는 FN으로 그대로 센다.
9. 후보·모델·런타임·입력·평가기의 동결 해시와 실행 순서가 확인되어야 한다. 실제 모델이 실행되지 않았다면 의미 품질 실패와 실행 미확립을 구별하되 채택하지 않는다.

## coverage와 계산 예산

scan, extraction, embedding, topic shortlist, topic NLI, question NLI를 각각 다른 단계로 보고한다. 원문 scan 100%를 NLI 검증 100%로 합쳐 표시하지 않는다. source별 stage range union과 처리하지 않은 부분·이유를 기록한다. 실제 모델에 전달된 source 범위는 callback 입력·raw text hash·passage registry로 재구성 가능해야 한다. whitespace-only 경계 제외는 허용하되 누락을 의미 검증으로 표시하지 않는다.

원문 비공백 UTF-16 단위는 scan/extraction에서 빠짐없이 순회되고 embedding되거나 명시 제외/재사용으로 계량되어야 한다. 동일 raw body의 캐시 재사용은 원문 SHA와 범위가 같은 경우에만 실제 처리와 동등하게 인정한다. shortlist와 NLI는 전수일 필요가 없으며 그 범위를 정확히 보고해야 한다. semantic abstention과 검색 후보 누락, token overflow, 기한 초과를 구별한다.

모든 모델 호출에서 비절단 token 길이와 실제 input 길이, truncation:false 여부를 기록한다. 실제 input이 짧아진 항목, 미보고 context 제거, source scope가 빠진 가설을 정상 검증으로 계산하면 실패다. token ceiling 초과는 fail closed와 명시 incomplete를 허용하지만 채택 통과는 아니다.

동결 전 협의한 상한은 문서 100개, 전체 2,000,000 UTF-16 chars, 240-char sentence fragments 전수, 20,000 passages, NLI 10,000 pairs, wall clock 15분, topic 출력 10개·question pair 출력 1,000개 독립 cap, evidence 전수다. 후보 구현자가 최종 동결한 설정을 함께 보존한다. evaluator는 이 상한을 넘도록 fixture를 억지로 키우지 않았다. 시간 초과나 cap 누락은 명시하고 FN에 포함한다.

모델 준비와 cold/warm 여부, 단계별 wall time, 모델 호출 수·pair 수, 관측 heap과 그 한계를 보관한다. 이 단일 브라우저 실행을 Apple 실기기 성능으로 표현하지 않는다.

## 결과와 후속 판단

baseline 비교가 제공되면 기술 통계로 병기하되 이전 실패를 이 새 후보의 합격으로 대신하지 않는다. 우선 판단은 위 절대 gate다. 후보 생성 누락, shortlist 미포함, NLI 기권, 최종 출력 탈락을 trace가 허용하는 한 나눠 보고하며 원인을 모를 때 점수 수준의 원인을 지어내지 않는다.

출력 전체를 독립 의미 검토한다. 모호한 사용자 귀속 문구는 별도 검토 항목으로 남기고 포괄적 안전을 주장하지 않는다. 합성 60문서는 실제 사용자 유용성·오탐률·주제 ontology 전체·장문 일반화의 대표 표본이 아니다. 통과해도 자동 제품 활성화·배포를 뜻하지 않으며 실제 사용성·장치 성능·보존 검수가 별도로 필요하다. 기각도 그대로 보고하고 같은 held-out으로 개선한 후보에는 새 독립 평가가 필요하다.
