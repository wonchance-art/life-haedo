# MODEL-03 평가방법·제품 적합성 독립 검토

확인일: 2026-10-19 KST. 검토 담당은 `/workspace/haedo-discovery/AGENTS.md`, 현행 PRODUCT.md와 로드맵을 읽었다. 제품 앱은 수정하지 않는다. 이 문서 작성 초기에는 MODEL-03 새 heldout의 본문·정답을 열람하지 않았다. 평가/구현 담당과 문항 내용 없이 설계·분모·예산만 협의한다.

## 판정 원칙

실제 모델 로드·생성·NLI 실행 성공, 정확한 원문 인용, 의미상 올바른 관심/질문 후보, 사용자에게 유용한 제안은 서로 다른 증거다. 정확한 quote/SHA/UTF-16 범위를 갖췄어도 그 구절이 후보를 지지하지 않으면 의미 precision에서는 실패다. NLI 점수가 높다는 사실은 독립적인 의미 정답이 아니다.

해도는 글과 개인 자료를 비공개로 보관하고 근거를 확인하며 활용하는 블로그다. 저장한 타인 글·작성자 미상 글을 사용자의 신념으로 바꿀 수 없다. 평가가 통과하더라도 ‘선택한 보관 자료의 주제·질문 후보’에 대한 제한된 채택만 검토할 수 있다. 실제 사용자 성향 추론·실기 성능·전체 보관함 분석·외부 추천 통합·배포 완료를 선언할 수 없다. MODEL-02 품질 실패와 수동 관심의 현재 사용 흐름은 새 실험과 분리해 보존한다.

## 사전등록 검토

평가 담당이 본문/정답 없이 공유한 초안은 새 합성 약 60문서, 10개 주제, 반복 질문 6개 gold cluster(각 독립 본문 SHA 2개), 같은 주제의 서로 다른 질문 negative, 부정/인용/과거/명령 negative, 긴 글의 앞/중간/끝, 중복을 포함한다. 주제 precision과 질문 precision 각각 95% 이상, 10주제의 올바른 문서-SHA 근거 recall macro 70% 이상, 6개 질문 cluster recall 70% 이상(5/6), 질문 원문 검출 recall 70% 이상, 금지 의미 오류/혼합·단독 질문 cluster 0, quote/source/SHA/UTF-16 100%, coverage accounting 정확·silent truncation 0을 권고했다. 아직 최종 사전등록·동결 결과를 확인하지 않았으므로 이를 확정 기준이나 통과 결과로 쓰지 않는다.

동결 전에 다음을 고정해야 한다.

- **분모와 귀속 단위:** 문서=source가 아니라 정확 본문 SHA 기준의 독립 지지. 복제·한 문서 여러 window를 반복 support로 세지 않는다. topic recall은 각 topic의 gold positive 문서-SHA 중 올바른 근거로 회수한 비율의 macro 평균이며, query는 gold cluster 회수와 원문 질문 검출을 별도로 계산한다. topic/query head를 합쳐 precision을 희석하지 않는다.
- **실패·abstention:** 전체 positive 평가에서 빈 출력은 precision 0/recall 0으로 처리한다. negative-only 항목의 올바른 무응답은 correct abstention으로 별도 집계한다. timeout/파싱실패/생성실패/모델 예산 초과 문서를 분모에서 빼지 않는다. 근거가 2개 미만인 질문을 abstain하는 것은 허용하되 놓친 gold는 FN이다.
- **후보 수 cap의 실현 가능성:** 현재 실험이 주제+질문 총 8개 cap을 유지한다면 주제 10개에서 macro recall 70%와 질문 6개 중 5개 회수를 동시에 달성하기 어렵거나 불가능할 수 있다. 동일 단위로 주제 7개와 질문 5개가 필요하면 최소 12개의 출력 자리가 필요하다. 평가 전 head별 cap/독립 실행 또는 충분한 총 cap을 정해 구조상 불합격을 유도하지 않아야 한다. 이 위험을 평가·구현 담당에게 전달했다.
- **의미 판정:** 질문은 같은 topic이나 같은 물체가 아니라 해결하려는 문제의 조건·행동·목표가 같을 때 같은 cluster다. 출력 label의 문자 일치는 요구하지 않는다. 혼합 label을 넓게 써서 서로 다른 질문들을 한 군으로 감추면 실패다. 단어 주제만 같은 지원 구절은 반복 질문 support가 아니다.
- **귀무/부정 항목:** 문장 속 부정, 과거 관심 중단, 타인의 인용, 기록 안의 명령을 긍정 관심으로 승격하면 실패다. 원문 지시를 따르지 않는 것은 필요하지만, 명령문이 있다는 이유로 문서의 나머지 적법한 지지를 전부 조용히 버리는지도 coverage/recall로 드러나야 한다.
- **precision 근거:** 정답/전체의 원수, head/stratum별 수, false positive 사례와 Wilson 구간을 함께 보고한다. 작은 합성 집합의 점추정 95%는 일반 한국어/사용자 자료 전체의 95% 보장이 아니다.

## 동결과 개발 자료 분리

공개 개발 fixture는 구현·prompt·NLI threshold·동의어/부정 규칙을 정하는 데 사용해도 된다. 그 fixture를 새 이름으로 복사하거나 어휘만 바꾼 자료는 genuinely fresh heldout로 보고하지 않는다. 새로운 heldout은 구현 담당에게 본문·정답을 숨긴 독립 작성 자료여야 한다. 작성자와 검토자 사이의 학습된 예시 영향은 구성 이력에 남긴다.

최종 사전등록 문서, scorer/rubric, corpus, answer key, adapter/runtime/프롬프트/후처리/모델 manifest/seed·decoding·NLI threshold·caps를 각각 SHA-256으로 연결한다. 동결 시각과 그 파일 목록을 기록한 뒤 실행한다. 출력 JSON과 요청/처리량/시간 로그도 실행 종료 직후 해시를 남긴다. 동결 후 본문·정답·출력을 보고 고친 설정은 새로운 후보이며 새 heldout을 요구한다. 실패 실행을 삭제하거나 성공 재시도만 채택하지 않는다. 단순 운영 복구 재시도도 이유와 원래 실패를 남긴다.

판정 전 정답을 열어볼 수 있는 담당과 열어보면 안 되는 담당을 구분한다. 검토자는 freeze 전에 문항 내용 없이 설계를 검토하고, freeze·출력 고정 이후에 실제 semantic support를 독립 감사한다. 정답이나 후보 생성의 자기평가 모델을 그대로 scorer로 재사용하지 않는다.

## CPU 시간·입력 coverage의 공정성

예산은 첫 준비/다운로드와 warm 추론, 생성과 NLI를 분리해 정한다. 모델별 ID/revision/양자화/runtime/thread/토큰화/max input·new tokens/문서 window 수/후보 cap/샘플링 또는 greedy 설정을 고정한다. 문서당·전체 wall-clock 상한, 완료하지 못한 경우의 timeout 상태와 품질 분모 처리도 입력 열람 전에 정한다. 이 검토는 임의의 성능 수치를 사실로 만들지 않으며 런타임 담당이 제공하는 실제 CPU 예산을 확인할 예정이다.

긴 문서는 실제 모델이 받은 원문 구간의 union, 총 원문 문자/토큰, 겹친 처리량, 미처리 구간·이유를 기록한다. tokenizer truncation 전에 분할한 문자열 길이만 ‘처리 완료’로 세면 안 된다. 전처리에서 앞부분만 남기는지, middle/tail의 의미 있는 지지가 window cap 때문에 빠지는지 strata별로 드러나야 한다. 생성 입력 cap과 NLI premise cap 둘 다 적용된다. 문서 전체를 prompt에 넣었다고 해도 runtime tokenization에서 잘린 부분은 분석 범위가 아니다.

새 corpus의 문서 길이·앞/중간/끝 strata가 한 모델의 context cap에 맞춰 사후 바뀌지 않아야 한다. 예산 때문에 일부만 처리하는 후보는 부분 처리임을 명시하고, 동일 입력/예산의 비교에서 장단점을 보고한다. 지원하지 않는 긴 자료를 분모에서 제외해 성능이 좋아진 것처럼 표현하지 않는다.

## 네트워크·자료 경계

이 실험에는 새 익명 합성 자료만 허용된다. 공개 모델 가중치·tokenizer/runtime 다운로드와 개인 본문 전송은 다르다. 모델 다운로드 URL만 외부로 요청하고 생성/NLI는 실제 CPU에서 로컬 실행해야 한다. 원자료/prompt/정답이 API 요청·원격 telemetry·오류 수집에 실리지 않는지 실행 방식과 요청 로그/오프라인 실행으로 확인한다. 현재 문서 작성 시에는 이 경계를 실제 실행 로그로 확인하지 않았으므로 ‘외부 전송 0’은 아직 검증 결과가 아니다.

## 채택 판단 대기

MODEL-03 frozen manifest·출력·정답·metric·실제 시간/coverage가 나오기 전에는 채택을 권고하지 않는다. 통과하면 질문별 두 독립 원문이 실제로 같은 문제를 지지하는지와 사용자가 quote를 열어 교정할 수 있는 설명 단위를 검사한다. 기준 실패·동결 위반·처리량 누락이 있으면 자동 분석 활성화를 기각하고 수동 관심 흐름을 유지한다. 평가 후 독립 의미 감사와 최종 권고를 이 문서에 추가한다.

## 동결 전 협의에서 확인한 변경

`EXPERIMENT.md`와 `design.json`을 읽었다(본문/정답 열람 아님). 실험은 **자유 생성 모델이 아닌 추출 기반 후보 생성 + 독립 NLI**로 명시됐다. topic 출력 10개와 question pair 출력 1000개를 따로 두어 합산 UI cap 문제를 제거했다. 전체 문장/개행 순회 → 240 UTF-16 구간 → 전수 embedding → topic top3와 control NLI, 문장형 질문 전수 추출 → 독립 source/SHA의 nearest5 질문 pair → 양방향 NLI 구조다. cosine 검색 누락과 NLI 거절을 별도로 진단한다.

예산 초안은 100문서·문서당 20만 문자·총 200만 문자·2만 passage·1만 NLI pair·전체 15분이며 embedding/NLI batch 각각16, 모델 입력 한도512 tokens다. 최초 초안의 10만 NLI 상한은 실제 CPU 비용 검토 뒤 1만으로 조정됐다. tokenizer truncation은 꺼 두고 overflow·timeout을 explicit incomplete로 처리한다. 이 수치는 아직 최종 freeze manifest를 대체하지 않는다.

240문자보다 긴 문장의 fragment는 전수 순회/검색 진단에 포함하지만 full-sentence scope가 없으면 positive support를 기권한다. 부정/조건 문맥을 잘린 구절에서 임의로 지우는 위험을 줄이며 해당 누락은 recall FN으로 남긴다. 240문자 이내 문장도 앞 문장의 대명사·전제조건을 놓칠 가능성은 있어 최종 의미 감사에서 확인해야 한다.

평가 ontology는 `material_subject`(실질 설명/활동/방법/문제)이고 사용자의 현재 신념이 아니다. 단순 부정으로 표현된 실제 방법·경험은 자동 금지하지 않으며 메타 문구/개인 관심 부인만/과거 명령만은 positive 관심으로 세지 않는다고 평가 담당이 공유했다. 질문 원문 검출 recall의 대상은 반복쌍 12개 source와 같은 주제·다른 질문 singleton 6개 source 총18개이며, pair recall의 대상6개와 다르다. 문장형 subset9개를 별도로 평가한다. 원문 quote의 정확성과 gold가 정한 문장 경계의 문자 일치를 혼동하지 않도록 검출 matching 규칙의 동결을 요청했다.

동결 전 총괄의 추가 검토에서 15분 설정은 초기 구현상 NLI score loop에서만 검사하고 추출/embedding guard에는 적용되지 않음을 확인했다. 따라서 현 초안을 ‘전체 wall-clock hard cap’으로 표현하면 안 된다. 구현·런타임 담당에게 전체 deadline의 적용 지점, 모델 준비 시간 포함 여부, 호출 중 즉시 중단 가능 여부, 재개 시 누적 budget을 일치시키도록 전달했다. 최종 코드가 batch 사이에만 중지한다면 ‘각 호출 종료 후 예산 확인, 진행 중 호출은 초과할 수 있음’으로 보고해야 한다. timeout 자료를 품질 분모에서 제외하지 않는 원칙은 유지한다.

최종 사전등록 문서(`preregistration.md`)의 분모·질문 경계 matching·장문 3위치 hard gate·incomplete 기각·독립 의미 재독 규칙을 읽고 방법상 수용 가능하다고 판단했다. 평가 담당이 전달한 사전등록 SHA는 `ec8b2640527c5cf995ef691576ea1ac056f192523f2ce67fac01a8d5deb56511`, 평가기 SHA는 `0f03792c9dff7f905cd88c525fe2d2ad2e9c3adfa8acb09ab2456d9b13a3808d`다. 이 시점에도 fixture 본문·정답·생성 script는 열람하지 않았으며 candidate/runner 최종 동결을 기다리고 있다. 가짜 oracle 배선 통과는 의미 모델 품질 검증이 아니다.

## 공식 동결 확인

`seal.json`의 공식 봉인 시각은 2026-10-19 01:28:57 KST다. 후보 SHA `a9424f1996df1844b4baec8ae8beaa3d160577fd553ec724603529fffc7d3075`, runner SHA `8ad9ded2b878bfe3e056828ef522a682d31038055efae5a87bd03a9dc7012802`, evaluator SHA `0f03792c9dff7f905cd88c525fe2d2ad2e9c3adfa8acb09ab2456d9b13a3808d`, input-only SHA `4e1caab4d96ac542c776f60c92ee4188c4afaaff6e9a9feb1b7e371de66e0a8b`로 분리됐다. runner 입력에는 id/text/author relation만 있고 정답·tag·질문 cluster는 내보내지 않았다고 봉인에 명시돼 있다. `candidate-freeze.json`의 11개 소스·공개 개발 증거 파일 실해시를 직접 계산해 모두 일치함을 확인했다.

최종 공개 개발은 16쌍과 32쌍 두 라운드이며 threshold는 positive .55, control 기권 .45로 동결됐다. `dev-report.md`는 공개 예시부터 주제/질문 회수가 낮을 가능성을 인정하며 neutral 우세 점수까지 낮춰 맞추지 않았다고 설명한다. 이 자료는 신선한 heldout 성능이 아니다. ‘3-label softmax 점수와 공개 개발에서 고른 threshold’로 표현하고 통계적으로 보정된 신뢰확률이라 부르지 않는 것이 적절하다.

15분은 최종 개발 기록에서 추출/embedding/NLI 호출 전후 guard로 확인하는 호출 사이 예산으로 정정됐다. 실행 중 호출을 정각에 중지하는 hard deadline 주장은 하지 않는다. runtime은 runnerSHA 필수 대조·최종 재대조, cache record와 JSONL 해시, 최초 attempt부터 누적 wall/준비/추론 비용 보존을 보강한다고 공유했다. 이 동결 확인 시점에도 새 heldout 본문·정답은 열람하지 않았고 실제 결과 audit는 원출력 고정 이후로 남겨 두었다.

## 실제 실행 후 독립 감사와 최종 권고

**권고: 현재 MODEL-03 고정 후보의 제품 채택을 기각한다. 자동 분석 비활성 상태와 수동 관심 확인 흐름을 유지한다.** 실제 CPU 추론은 완료했지만 제안된 주제와 반복 질문이 모두 0개여서 제품 목적을 달성하지 못했다. 이를 ‘오탐이 없는 안전한 자동 분석’이나 ‘모델 준비만 남은 상태’로 해석할 수 없다. 이 결론은 현재 모델·가설·후보 생성/검증 조합의 판정이며 NLI 또는 한국어 자동 분석 전체의 불가능을 뜻하지 않는다.

평가 담당이 원출력·coverage·runtime 고정을 알린 뒤 `input-only.json`, `heldout-output.json`, `heldout-runtime.json`, `heldout-coverage.json`을 읽고 독립 재계산했다. 그 전까지 heldout 본문/정답은 보지 않았다. 이 감사 단계에서 `private-heldout.json`과 생성 script는 아직 열지 않았다.

| 항목 | 확인 결과 | 제품상 의미 |
|---|---|---|
| 최종 주제/질문 | topic 0, question 0 | 사용자가 검토·교정할 자동 후보가 없음 |
| 주제/질문 precision | 각각 0/0, 사전등록은 positive head의 빈 출력을 0으로 판정 | 100% 정확도 또는 오탐률 0의 품질 보장으로 보고할 수 없음 |
| 주제 macro recall / 반복 질문 | 고정 scorer는 0%, 0/6 | 채택 문턱 70% 미달 |
| 질문 원문 검출 | 고정 scorer 18/18, 문장형 9/9 | 구문 후보 발견 성공이며 반복 질문 추론 성공과 다름 |
| 실제 raw 질문 후보 | 19개, source/version/SHA/UTF-16/author 직접 재대조 오류 0 | 원문 구간 보존의 증거; 의미 지지 precision의 증거가 아님 |
| 출력 근거 integrity | 긍정 출력 0개, 고정 scorer 0/0·미확립 | 없는 인용을 ‘근거 정확성 100%’로 만들지 않음 |

실제 source를 재독했다. b031/b032의 주장·근거 구별, b033/b034의 간헐 오류 재현, b035/b036의 통증을 되풀이하지 않는 보행량, b037/b038의 금리 상승 예산 여유, b039/b040의 발언 독점 완화, b041/b042의 이로운 곤충을 보존하는 해충 피해 감소는 각각 같은 조건/목표의 문제를 바꿔 표현한 쌍으로 판단했다. 반면 b043–b048은 비슷한 큰 주제를 다루어도 고치려는 대상과 판단 기준이 다른 단독 질문이다. b055의 인용된 옛 질문은 현재 고민으로 보지 않았다. 원문 구문 추출은 그 인용 구간도 후보로 잡고 quoted provenance를 남겼지만 최종 긍정 출력은 없었다. 이 독립 source 재독은 비공개 정답을 보고 만든 판정이 아니다.

실패 단계도 구분했다. 실제 topic NLI 결정 351개의 entailment 최대값은 약 **.2867**로 동결 문턱 .55보다 낮았다. questionhood 19개의 최대값은 약 **.3126**으로 0개가 통과했다. 그래서 64개의 검색된 질문 pair가 있었어도 **질문 pair 양방향 의미 NLI는 0회**였다. ‘의미가 같은 질문을 양방향 검사했지만 모두 다르다고 판정했다’는 설명은 틀리다. 이 실행은 질문 존재를 확인하는 가설 단계에서 전부 기권했고 pair 의미 판정 성능은 관측하지 못했다. 정확한 raw quote와 syntax 검출 성공을 이 누락의 복구로 합산할 수 없다.

60개 원문의 UTF-8 SHA·UTF-16 길이·author relation을 결과 metadata 및 coverage와 직접 대조해 오류 0개였다. 모든 stage의 범위 union과 uncovered 비공백 단위도 독립 계산과 일치했다. 원문 비공백의 extraction/embedding 누락은 0이고 passage 171/171개가 embedding됐다. 실제 NLI에는 **비공백 UTF-16 단위 9,410개가 전달되지 않았으며**, 장문 fragment의 full-sentence scope 기권으로 기록됐다. 따라서 ‘전체 원문 NLI 검증’이 아니다. 세 긴 본문은 embedding tokenizer에서 각각 3098/3095/3099 tokens였지만 이는 길이 측정이며 whole-body 추론이 아니다. 실제 호출 최대 입력은 embedding 182, NLI 72 tokens이고 무음 절단은 0이었다.

실제 runtime은 오류·network violation·본문 포함 요청·절단 0건, 고정 공식 모델/라이브러리 자산과 그 CDN redirect의 GET 31건을 기록했다. source 및 요청 제한 코드를 함께 보아 합성 원자료가 모델 API로 전송된 정황이 없고 실제 계정/개인 문서/운영 DB도 사용하지 않았다. 모델 ONNX는 고정 공식 LFS metadata의 크기·SHA와 대조했고 실제 수신 weight byte stream 및 WASM 바이너리의 독립 SHA를 재계산한 것은 아니다. JSON/tokenizer/runtime script의 실수신 해시는 별도 보존됐다. 그 무결성 근거의 한계를 유지한다.

단일 시도 누적 약 **169.2초**, embedding 준비 약17.8초/추론6.14초, NLI 준비40.2초/추론101.50초였다. NLI 506요청은 27캐시 재사용+479고유 추론으로 계량된다. embedding 210요청과 60캐시+144고유 추론 간 6개 차이는 동일 batch 중복 재사용일 가능성이 있어 runtime 담당에게 별도 회계 설명을 요청했다. runtime의 관측 최대 합산 RSS 약684 MB는 공유 페이지 중복과 짧은 peak 누락이 있는 Linux 브라우저 process-tree 표본이며 Apple 실기나 고유 메모리 peak로 일반화하지 않는다.

실행 후 candidate/runner/scorer/input-only 해시를 공식 seal과 직접 대조해 모두 일치했다. raw scorer가 whole-document token count의 `{rows:[...],elapsedMs}` wrapper를 읽지 못한 표시 문제는 별도 normalized runtime에서 embedding 한 container만 id map으로 풀어 해결했다. 원자료 60행·wrapper metadata와 나머지 모든 runtime 필드가 동일함을 독립 deep-compare로 확인했다. 기존 출력/기준/평가기·원본 report는 보존됐고 정밀도/recall·기각 결정은 바뀌지 않았다. 이 normalization은 의미 점수나 실패 결과를 고친 것이 아니다.

로드맵의 다음 제품 단위는 수동으로 확인한 관심을 사용한 실제 외부 글 발견 → 출처와 본문 범위 확인 → 정확 읽기/복귀 → 기존 가져오기 검토 → 명시 보관·피드백으로 권고한다. 완료 기준은 관련 글 3–5개를 억지로 채우지 않고 최신순 baseline과 실제 사용자 유용성을 비교하며 원문·계정/공간·취소를 보존하는 것이다. 자동 추출 연구 재개는 실패한 questionhood/주제 가설에 대한 새 근거·구체적 비용 상한·새 독립 heldout이 생겼을 때 별도로 판단한다. 동일 60개를 보고 threshold를 내려 재합격시키는 작업을 후속 기본값으로 두지 않는다.

평가 담당이 원출력 고정 뒤 비공개 정답 열람을 허용한 후 마지막 분모 검증도 수행했다. raw SHA와 topic ID로 독립 집계한 gold는 **51개 body-topic**이고 질문은 **18개 source/문장형9개/6개의 두 독립 SHA 쌍**이었다. 질문 18개 모두 gold의 정확 start/end와 raw quote로 검출됐으며 여섯 진짜 pair 모두 nearest5의 검색 목록에 있었다. 정답 열람 전의 자체 source 재독으로 분류한 여섯 동등 문제와 여섯 단독 문제는 봉인된 cluster와 일치했다. 단계 trace는 topic gold 50/51개가 shortlist/NLI에 도달했으나 0개 통과, 나머지 하나(b012 구강 위생)는 health-life 후보 검색에서 누락된 것으로 기록한다. 최종 출력 0의 주원인은 모든 올바른 topic/질문성 가설이 동결 문턱을 통과하지 못한 것이며, 질문은 이미 검색된 여섯 쌍도 questionhood 0 때문에 양방향 비교 단계에 들어가지 못했다. 이 결과를 단순 ‘질문을 못 찾음’ 또는 ‘문서가 처리되지 않음’이라고 줄이면 실패 원인이 왜곡된다.

최종 독립 결론은 **실행·보존·처리 범위 회계는 확인, 자동 주제/반복 질문 제안의 의미 품질은 채택 기각**이다. raw quote 보존과 전체 embedding 순회를 확인했어도 의미적으로 검증된 긍정 support는 0개이며 사용자가 교정할 자동 제안 자체가 없다. 해당 실행에서는 오류·무음 절단·원자료 외부 전송의 관측 위반이 없었고 합성 자료 외 실제 자료는 사용하지 않았다. ONNX weight/WASM stream SHA 미측정, Linux 표본 메모리와 Apple 실기·사용자 유용성 미확인 제한을 남긴다. 제품 원본/앱 코드·기존 MODEL-01/02 증거·새 heldout·후보/runner/scorer는 이 검토에서 수정하지 않았다. 검토 문서 외의 원자료나 평가기 변경 없이 채택 기각과 수동 관심 기반 외부 발견의 다음 사용 단위를 권고한다.
