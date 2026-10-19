# MODEL-03 독립 보존·코드 검수

검수 경계: `/workspace/haedo-discovery/AGENTS.md`를 읽었다. 실험 후보·runner의 공개 코드와 보존 계약만 검토한다. 독립 held-out 본문·정답은 열람하지 않는다. 제품 파일·기존 MODEL-01·원본 저장소는 수정하지 않는다. 이 파일이 유일한 검수 산출물이다.

## 동결 전 필수 계약 제안

### 원문과 정확 근거

- 모델 입력을 만들 때 원문을 변경하지 않는다. BOM·CRLF·연속 공백·NFC/NFD·emoji를 포함한 원래 문자열을 그대로 보관하고 SHA-256은 그 문자열의 UTF-8 바이트로 계산한다. 모델용 전처리는 별도 파생 값이어야 한다.
- 각 evidence는 정확한 `{sourceId, sourceVersionId, sha256, start, end, quote}`이며 UTF-16 `[start,end)`를 사용한다. `raw.slice(start,end) === quote`, 범위 경계가 surrogate pair를 나누지 않음, 실제 raw SHA와 선언 hash 일치를 모두 검사한다. 없는 옛 버전을 최신 버전으로 치환하지 않는다.
- 비동기 처리 시작 전 선택 전체의 원문·버전·작성자 관계·확보 범위를 snapshot으로 잡는다. 반환 직전에 같은 선택이 여전히 존재하고 raw 문자열·hash·sourceId가 같음을 확인한다. 집계 dedup으로 제외한 선택도 이 stale 검사에서 빠지면 안 된다.
- 실행 성공·실패·취소·재시도 전후 bundle을 deep equality로 비교한다. 분석 결과를 원문·발췌·사용자 메모·저장/공개 형식에 쓰는 경로는 허용하지 않는다.

### 화자·인용·현재성·부정

- `self`, `other`, `unknown`을 명시적으로 보존한다. `unknown`을 self로 추정하지 않으며 작성자 이름이 비어 있거나 원작성일이 null인 경우도 그대로 유지한다. 다른 사람의 글을 보관한 행동이 그 글의 신념·활동을 사용자에게 귀속시키지 않는다.
- 전체 결과와 주제/질문 후보를 `saved_material` 범위로 한정한다. self로 표시된 글도 과거·가정·인용·반박을 포함할 수 있으므로 현재 신념/실제 활동 확정으로 승격하지 않는다.
- 인용 구간, 대화의 타인 발화, 과거에 적힌 명령, 출력/분류를 지시하는 자료 본문은 현재의 실행 지시로 해석하지 않는다. 인용/명령/부정/과거성 제외는 진단상 서로 구분하고, 제외한 구절을 반대 의미의 긍정 근거로 사용하지 않는다.
- 부정문이더라도 반박 대상 주제의 어휘는 나타날 수 있다. 주제 연관성과 긍정 선호를 별도로 둔다. 대조문은 원문에서 정확히 남아 있는 긍정 절만 별도 evidence로 쓸 수 있으며, 부정 어휘 삭제나 재서술한 문장을 raw 인용으로 만들면 안 된다.

### 반복 질문과 본문 중복

- 같은 source의 여러 버전은 독립 지지로 합산하지 않는다. 다른 source ID라도 같은 raw body SHA이면 한 번만 센다. distinct raw SHA는 서로 다른 보관 본문이라는 뜻이며 독립 저작·사용자 신념의 증거가 아니다.
- 반복 질문은 서로 다른 본문 최소 2개에서 각각 실제 질문 범위가 있어야 한다. 같은 문장의 반복·동일 본문 복사·한 본문 안의 여러 물음표로 support를 늘리지 않는다. 서로 관련된 주제라는 사실만으로 서로 다른 질문의 내용/조건/답변 대상을 같다고 판정하지 않는다.
- 질문 쌍 의미판정의 모델·입력 템플릿·threshold·contradiction/entailment margin을 동결한다. 타인의 인용 질문을 사용자가 현재 반복해서 묻는 질문으로 표시하지 않는다. 보류는 질문 없음 또는 확정적 불일치와 구분한다.

### coverage와 abstain

- raw UTF-16 처리 범위의 합집합으로 스캔 coverage를 계산한다. 겹치는 window를 더해 100% 이상으로 만들지 않고 제외/미처리/실패 구간을 구분한다. `fullcoverage`는 모든 대상 문자가 검사 과정에 들어갔다는 처리 범위이며 전체 의미를 정확히 이해했다는 선언이 아니다.
- tokenizer 길이는 실제 premise+hypothesis+special tokens의 pair 길이로 확인한다. `truncation:false`여도 backend가 최대 길이를 넘겨 버리거나 실패한 window는 성공 coverage로 집계하지 않는다. 분할 시 모든 model-visible passage가 raw 범위로 되돌아가야 한다.
- fullcoverage와 abstain은 별도 축이다. 전 범위를 처리해도 모델이 모르면 abstain해야 하며, 부분 처리에서 확신 높은 후보가 나왔다고 전체 본문 확인으로 표시하면 안 된다. 정책상 제외 구간이 많다는 사실과 모델 추론의 오류/보류도 다른 진단이다.

### 재현성과 동결

- candidate/runner 파일 SHA, 모델과 tokenizer의 고정 revision 및 파일 SHA, runtime 버전/파일 SHA, dtype·backend·thread 수·실제 tokenizer 길이 정책, NLI label mapping, 모든 hypothesis 템플릿·threshold·margin·budget을 평가 전에 manifest로 고정한다.
- score 배열에서 entailment/contradiction 인덱스는 config.id2label/label2id와 대조한다. label 순서를 모델명으로 추정하지 않는다. 모델의 일반 entailment를 '사용자가 믿는다'는 허가로 쓰지 않는다.
- held-out 본문/정답을 읽은 뒤 hypothesis/threshold/후처리를 바꾼 실행은 기존 동결 후보의 결과로 합치지 않는다. 새 후보와 새 평가 경계를 명시해야 한다. 검수자는 공개 코드·집계 결과와 동결 hash만 대조한다.

## 시작 시 보존 상태

기록 시점은 실행 환경의 wall clock이 아니라 이 작업의 동결 전 baseline이다.

| 대상 | 시작 상태 |
|---|---|
| 원본 `/workspace/life-haedo` | HEAD `88ccfe5e381a37818a46e7abdaabfc48cff58c56`, `git status --porcelain` 출력 없음 |
| 제품 clone `/workspace/haedo-discovery` | HEAD `5137e52b7e510be5102347268a286a32538bef46`, 작업 변경은 `AGENTS.md`만 존재 |
| 앱 분석 정책 | `analysisEnabled:false`, evaluation `MODEL-02` |
| 앱 policy SHA-256 | `30714a08141a84b6afdc8916d95be032d5fc8c09398d3ded7d712c3b8c33a352` |
| 앱 분석 코드 SHA-256 | `d52a7236fa046e892f849662c654cc5c57b071b479e1df10aa3e9b21a2335c01` |
| 앱 Core SHA-256 | `6ad03c873ea3411dc7f8a432e7637502d1ce59271253db04e229429f99308ff4` |
| MODEL-01 immutable partial SHA-256 | `8040f51136496f2c9b5858d0d83a2fd5ed7990ea791a72b58c02c9d3df552191` |

## 현재 검증 상태

공개 candidate/runner 소스는 아직 작성 중이다. 위 내용은 동결 전 검수 계약 제안이며 구현 통과 결과가 아니다. adapter 담당과 runner 담당에게 전달했다. runner 담당은 raw/tokenizer overflow fail closed, 고정 모델/runtime hash, 실제 main/body 요청 0, bundle 불변·coverage 증거를 제출할 예정이라고 알렸다. 모델/러너 준비 후 소스 검토와 동결 hash 대조를 이 문서에 추가한다.

## 공개 사전설계·runner 1차 검토

`EXPERIMENT.md`, `design.json`, `run-experiment.cjs`의 공개 코드만 읽었다. 사전설계는 문서 전체 quote/code/transcript provenance를 chunk에 carry하고, 240 UTF-16을 넘는 문장 fragment를 scopeLimited로 표시해 긍정 지지에서는 abstain한다. 이 보류를 처리 incomplete와 분리하고 평가 recall의 false negative에 그대로 남긴다는 계약은 위 제안에 맞는다. 질문은 양방향 NLI의 실험적 유사성으로만 표현하고, 서로 다른 source+raw body SHA를 함께 요구한다. 의미 정확도는 아직 검증 결과가 아니다.

runner는 실제 NLI tokenizer의 premise+hypothesis tensor 길이를 검사하고 truncation:false/512 초과 오류를 사용한다. config.id2label을 `0 entailment / 1 neutral / 2 contradiction`과 대조하며, NLI는 세 logits 전체 softmax의 entailment 값을 반환한다. 입력 source freeze hash 확인, 실행 전후 입력 JSON 동일 검사, 실제 GET/body 및 mutable main 요청 집계를 둔다.

담당에게 전달한 동결 전 정정·주의:

1. design의 `calibrated` softmax 표현은 확률 보정이 입증되지 않았으므로 raw full-three-way softmax score로 바꿔야 한다. 공개 개발 자료에서 threshold를 정하는 일과 확률 calibration은 다르다.
2. 첫 runner의 asset hash 목록은 JSON과 runtime bundle fetch bytes만 실제로 계산한다. ONNX는 고정 metadata의 LFS SHA와 기대값 대조이고 WASM은 고정 URL 실행이다. 실제 받은 ONNX/WASM bytes를 별도 해시하지 않는다면 실제 bytes digest 검증이라고 보고하지 말아야 한다. 대형 모델 복제로 메모리 조건을 바꾸기보다 provenance 방법을 정확히 기록해도 된다.
3. 설계와 최초 구두 메시지의 NLI pair 상한은 달랐으나 동결 전인 현재는 후보 최종 CONFIG와 manifest에서 하나로 정하면 된다. 최종값을 동결 후 바꿔 같은 결과로 표시하지 않아야 한다.

모두 공개 설계/코드에서 확인한 사항이다. public calibration 본문·독립 held-out 본문·정답은 읽지 않았다.

## 후보 초안의 구체 반례와 동결 전 전달

후보 초안 `candidate.mjs`의 공개 `extractDocuments()`만 Node에서 호출해 직접 만든 아래 세 사례를 확인했다. 실제 모델·평가 자료는 사용하지 않았다.

| 공개 보존 사례 | 초안에서 실제 확인한 결과 | 필요한 경계 |
|---|---|---|
| `책과 글쓰기를 좋아하고 독서모임을 찾는다는\n주장은 사실이 아니며 문법 표현만 검토했다.` | 원래 한 문장에 있는 부정절이 hard line 분리로 앞 절과 떨어지고 두 passage 모두 scopeLimited:false | NLI가 받는 문맥이 원래 문장 범위를 유지해야 한다. 전체 문장이 길면 fragment 모두 scopeLimited로 보류해야 함 |
| ASCII 쌍따옴표로 감싼 세 줄 인용 | 첫/끝 줄은 quoted:true이나 인용 안의 중간 줄이 quoted:false | 문서 전체 provenance를 carry한다는 계약에 맞게 ASCII multiline 인용 상태도 유지 |
| lone high surrogate `\ud800` | 입력을 허용하고 UTF-8 hash를 계산 | TextEncoder의 U+FFFD 치환 전에 Core와 같이 잘못된 surrogate/NUL을 거부해 raw hash 정의를 유지 |

세 결과를 구현 담당과 root에게 동결 전에 전달했다. 이는 정답을 보고 규칙을 조정한 것이 아니라 공개 인터페이스의 원문·문맥·provenance 보존 검사다. 구현 담당의 수정 여부와 수정 후 공개 사례 결과는 후속 기록한다.

runner 담당은 위 1차 검토를 반영해 provenanceMethod에 ONNX metadata LFS SHA / WASM pinned URL / JSON·runtime actual bytes SHA를 구분했다고 알렸다. 실제 네트워크의 blocked/allowlist violation 0 최종 gate, cache record/output SHA 및 누적 attempt ledger, heldout 실행 전 외부 runnerSHA 필수/종료 후 자체 소스 hash 대조도 보강 중이다. 아직 최종 동결 후 불변 검사는 아니다.

### 동결 전 수정 후 직접 재확인

같은 공개 세 사례를 수정된 `extractDocuments()`에 다시 전달했다. (1) 부정절이 이어지는 newline을 포함한 전체 문장이 하나의 raw passage로 유지됨, (2) ASCII multiline 인용의 첫·중간·끝 passage 모두 quoted:true, (3) lone surrogate가 `CANDIDATE_INPUT_INVALID`로 거부됨을 직접 확인했다. 세 보존 반례는 해소됐다. 수정된 후보는 extraction/embedding/topic shortlist/topic NLI/question NLI의 정확 raw 범위와 passage registry, 미처리 사유를 출력하며 wall-clock guard도 extraction/embedding/NLI 단계에 둔다.

이 시점의 protected-files 대조에서 `product-before.json`의 앱 9개 파일은 전부 시작 SHA와 동일했다. 원본 저장소 HEAD도 `88ccfe5e381a37818a46e7abdaabfc48cff58c56`로 동일하고 status는 clean이었다. 앱 분석 정책 false와 MODEL-02 기각은 유지된다. 최종 freeze/실행 후 대조와 의미 정확도 판정은 아직 별도다.

## 동결 직전 runner 재검토

검토한 runner SHA-256은 `aa389c0945516b5bdbfc311f0504799d598c3acec9f0c5275cf242101834254b`다. 외부 runner/candidate/input 3개 SHA 검증, config·taxonomy·전체 hypothesis template manifest, 실제 NLI pair tensor 길이, 3-way label mapping, 모델별 whole-document tokenization-only 길이, 실제 model callback의 exact text와 frozen extractor 범위 연결을 확인했다. full scan/embedding/NLI premise/NLI any-input coverage는 구분하며 중첩 범위 합집합은 평가자가 독립 대조할 수 있다.

같은 fingerprint의 재시도 누적 15분, 외부 Node timer의 Chromium 종료, 중단 시 partial coverage/cache SHA/attempt ledger, 종료 후 runner source 불변 검사, blocked/허용 외 네트워크 0 gate도 있다. 토큰 길이 측정만 한 원문을 전체 model inference로 표시하지 않는다. 실제 ONNX bytes digest나 실제 Apple peak RAM을 검증했다고 주장하지 않는 한 **이 runner에 보존·재현성 측면의 추가 동결 차단 문제는 찾지 못했다.**

동결 manifest가 확정되면 이 source SHA·candidate source SHA·CONFIG/template/평가 gate 고정값을 대조해야 한다. 동결 후 실행 결과에 맞춘 threshold 변경 여부와 최종 채택/기각은 root 및 독립 평가의 책임이며 이 정적 검토를 의미 정확도 통과로 대신하지 않는다.

## 후보 동결 manifest 대조

`candidate-freeze.json`의 candidate SHA `a9424f1996df1844b4baec8ae8beaa3d160577fd553ec724603529fffc7d3075`와 실제 source가 일치했다. focused test source도 manifest의 `19bf0f237bc39add0183d51954f1ddffe6c4ce00cd2f61f9898fe30df9f06f75`와 일치했다. 구현 담당은 focused 10/10을 보고했으며 본 검수자는 그 전체 검사를 중복 실행하지 않았다.

고정 CONFIG의 주제 entailment `0.55`, possible-instruction abstention `0.45`, questionhood `0.55`, 질문 양방향 entailment `0.55`를 manifest와 대조했다. public development 16쌍·32쌍 이후 결정한 값이며 새 held-out 입력 공개 전 동결이라고 manifest에 명시돼 있다. 240 UTF-16 passage, topic shortlist 3, cross-source question neighbours 5, NLI pair 10,000, question candidates 2,000, wall-clock 900,000ms도 source에 고정돼 있다. 검수자는 이 threshold를 결정하거나 새 평가 결과에 맞춰 변경하지 않았다.

최종 후보는 topic support를 source/body 최대 matching으로 선택해 같은 source 여러 버전과 같은 raw body를 중복 지지로 세지 않는다. 모든 evidence에 raw SHA/UTF-16 slice/authorRelation/quote provenance를 남기며 출력 scope는 saved_material이다. 원작성자 identity label은 이 독립 실험 입력 계약의 범위가 아니고 관계값만 검증·보존한다는 한계는 구현 담당과 확인했다.

현재 runner 실제 SHA는 `8ad9ded2b878bfe3e056828ef522a682d31038055efae5a87bd03a9dc7012802`로 앞의 aa389c 검토본 이후 변경됐다. runner 담당에게 마지막 변경점과 최종 manifest 값을 요청했다. 이를 동결 후 변경으로 단정하지 않으며 최종 runner 동결값과 구분해 기록한다.

runner 담당은 **최종 확정값이 8ad9ded2…12802**라고 회신했고, aa389c 이후 변경은 이전 runtime 보고서를 원바이트 SHA 파일명으로 보관하고 같은 fingerprint의 원문 tokenizer 길이·관측 peak를 보존하는 14줄이라고 설명했다. 해당 source 구간을 직접 읽어 모델·threshold·품질·추론·예산 로직 변경이 아님을 확인했다. 최종 candidate/runner 실제 파일 SHA를 다시 계산해 위 확정값과 일치함을 확인했다. 원본 저장소 status도 계속 clean이다.

최종 판정: 동결 전 공개 보존 반례 3개가 수정됐고, 위 candidate와 runner를 고정한 새 독립 실행에 **추가 보존·코드 검수 차단 문제는 없다.** 앱 활성화 허가는 아니며, 최종 실행 후 source SHA 불변·무음 절단 0·실제 원문/근거 정확도·독립 채점 문턱 판정은 실행 결과와 함께 root가 재대조해야 한다. 본 검수는 독립 held-out 본문·정답을 읽거나 제품 파일을 바꾸지 않았다.
