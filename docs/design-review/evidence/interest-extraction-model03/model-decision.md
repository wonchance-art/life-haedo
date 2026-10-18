# MODEL-03 모델과 설계의 독립 판정

확인일: 2026-10-19 KST. 역할은 모델·설계 검토다. 제품 코드를 바꾸거나 새 모델 실험을 추가하지 않았다. MODEL-03/기존 비공개 평가 fixture 본문을 열지 않고, 기존 모델 카드·실행 결과의 집계 보고와 공개 런타임 소스를 재사용했다. 네트워크 상태는 `unrestricted/enforced`, `observations_current:true`였다. 기본 프록시와 TLS 검증을 유지했다.

**판정: 후보 생성과 NLI 검증을 분리한 MODEL-03의 독립 평가는 진행할 근거가 있다. 현재 모델을 사용자 관심·질문 추출에 채택할 근거는 아직 없다.** 주제 발견, 질문 검출·묶기, 정확 근거 선택은 별도의 실패 지점이며 NLI가 누락된 후보를 복구하지 않는다. 새 평가가 끝나기 전 자동 분석 비활성 상태와 MODEL-02 기각을 유지한다.

## 모델·런타임의 실제 근거

| 항목 | 확인 결과와 의미 |
| --- | --- |
| NLI 모델 | `onnx-community/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7-ONNX`, revision `cdc8277b4682665e2f2e87cd83da7da07b153d75`, 2026-05-26 변환 |
| 원본·권리 | `MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7`, revision `b5113eb38ab63efdd7f280f8c144ea8b13f978ce`. 변환·원본 카드 모두 MIT. 출처·고지 보존 필요 |
| 한국어 근거 | 카드가 `ko`를 명시하며 한국어 번역 NLI 105,000쌍을 포함한 27개 언어 학습. 한국어 원어민 평가·임의 생활 기록 품질을 입증한 결과는 아님 |
| 크기 | q8 ONNX 338,341,610 bytes, tokenizer JSON 16,316,225 bytes. 설정 파일을 합친 고정 5개 자산은 354,661,218 bytes. 런타임/WASM·임베딩 자산은 별도 |
| 무결성 | q8 SHA-256 `f1920d10296efd121a601b2161e8de9fa0c934a6c0331cd1764fd09a06a83041`; tokenizer `ac9bd80d04d21b4df95917bdf7c750cbea28acc30a4462c76ca2b9c86d371863`. MODEL-02 manifest와 실제 실행 산출물을 재사용 |
| 타입·한도 | `deberta-v2` / `DebertaV2ForSequenceClassification`, `DebertaV2Tokenizer`, 문장쌍 최대 512 tokens. 기존 실험은 256 한도에 실제 41–72 tokens라 절단이 없었음 |
| 라벨 | `0=entailment`, `1=neutral`, `2=contradiction`. 임의 라벨 순서 가정 금지 |
| 라이브러리 | Transformers.js 4.3.1, Apache-2.0. 공식 registry에 해당 모델 타입·tokenizer 및 WASM/q8 지원이 있고 MODEL-02가 실제 실행됨 |

기존 12쌍은 12/12 정답이었고 부정과 과거 명령 인용 범주를 모두 통과했다. 이것은 짧게 주어진 원문·가설의 관계에 대한 제한된 가능성 근거다. 12/12를 관심 추출 정확도, 한국어 전체 품질, 확률 보정 또는 장문 성능으로 표현하면 안 된다. raw-logit 최상위와 차상위의 최소 차이는 약 0.111로 보고되어 있으며 결과에 맞춰 새 임계값을 추가할 근거도 아니다.

관측 준비 시간은 약 49.37초, 12쌍 총 추론은 약 3.72초, 쌍별 약 0.18–0.52초였다. 관측 JS heap 441,121,690 bytes는 전체 RAM·peak 메모리가 아니다. Linux 브라우저 한 번의 측정이며 실제 Mac/iPad/iPhone이나 사용자 사용 평가가 아니다.

## 최신 공식 배포와 보안 확인

2026-10-19 KST에 공식 npm registry와 GitHub API를 다시 조회했다.

- `@huggingface/transformers` npm 최신은 **4.3.1**(2026-10-06 UTC 게시), 공식 GitHub 최신 release도 **4.3.1**(2026-10-07 UTC)이다. 기존 고정 버전은 현재 최신과 같다.
- ONNX Runtime **core GitHub** 최신 release는 **v1.31.0**(2026-10-09 UTC)이지만 **onnxruntime-web npm stable**은 **1.30.0**(2026-09-14 UTC)이다. 두 배포 경로를 같은 버전으로 간주하면 안 된다.
- Transformers.js 4.3.1의 실제 공식 `package.json`은 browser 의존성을 `onnxruntime-web:1.31.0-dev.20260914-8d85527a0`로 고정한다. 최신 core 번호만 보고 web WASM을 임의 교체하지 않는다. JS·WASM과 실제 동결 bundle의 의존 버전을 함께 보존한다.
- 공식 GitHub의 `huggingface/transformers.js` 및 `microsoft/onnxruntime` 공개 security-advisories 조회는 각각 `[]`였다. npm 공식 bulk advisories에 Transformers 4.3.1, 위 ORT web/common 버전, Jinja 0.5.10, Tokenizers 0.2.0을 질의한 결과는 `{}`였다. 이는 **조회한 다섯 패키지·버전에 보고된 권고가 없었다**는 결과이며 전체 transitive dependency 감사나 취약점 부재의 증명은 아니다.
- `onnxruntime-web/common`·Jinja는 MIT, Tokenizers는 Apache-2.0이다. 이 검토에서 패키지나 런타임을 새로 도입·업그레이드하지 않았다.

## 동결 전에 필요한 설계 구분

**주제 관련성과 사용자의 선호를 구분한다.** `이 자료는 X를 다룬다`의 지지와 `사용자는 X를 좋아한다/믿는다`의 지지는 다르다. 자료가 불호·비판을 담거나 다른 사람의 글이어도 X라는 주제는 존재할 수 있다. 이때 관련 주제를 개인적 호감이나 신념으로 표시하면 안 된다. 사용자의 현재 관심은 명시적인 확인 결과이며 NLI의 점수가 이를 대신하지 않는다. 저자 미상은 미상으로 남기고, 타인 인용을 사용자의 주장으로 승격하지 않는 metadata 규칙을 모델 앞뒤에서 지킨다.

**질문은 답을 단정하는 문장이 아니다.** 의문문 Q와 바꿔 쓴 의문문 Q′를 NLI에 넣어 entailment를 얻더라도, 질문의 전제를 실제 사실로 입증하거나 질문이 답해졌다는 뜻은 아니다. NLI 학습은 주로 서술형 명제의 관계이며 의문문의 의미 보존은 별도 평가가 필요하다. 질문 결과는 실제 의문 범위·조건·부정·주체를 보존한 정확 원문 구간을 우선한다. 서술형 검증 가설을 쓴다면 `이 자료에는 조건 C에서 Q에 대한 질문이 제기되어 있다` 같은 **질문 존재 주장**까지만 다룬다. 이 template도 새로 검증할 가설이며 12쌍 성공에서 일반화하지 않는다. 작성자가 불명확하면 `사용자가 궁금해한다`로 바꾸지 않는다.

**후보 생성, 검색, 판정의 누락을 각각 기록한다.** 자료 순회·질문 검출 → 개방된 주제/질문 후보 → 후보별 원문 구간 → 실제 NLI의 순서를 구분한다. 정답 후보가 생성되지 않았는지, 원문을 못 찾았는지, NLI가 틀리게 버렸는지 별도 수치가 필요하다. 고정 관심사 목록이나 개발 예제의 특정 어휘만 생성 가능한 방식은 임의 생활 자료의 주제 발견을 충족하지 못한다. 반복 질문은 서로 다른 본문 SHA의 실제 질문이 같은 조건·대상을 가리킨다는 근거를 가져야 하며, 같은 본문의 복제·재가져오기를 지지 두 개로 세지 않는다.

**NLI 앞에 출처·구간 검증을 둔다.** 선택된 실제 raw body에서 UTF-16 offset·quote·SHA가 일치하는지 확인한 뒤 그 문맥과 후보 가설을 전달한다. 입력 문맥 안에 부정·인용의 경계나 질문 조건이 빠지면 정확한 NLI도 잘못된 검증을 하게 된다. 긴 원문 앞부분만 조용히 잘라 넣지 않는다. 전체 원문 순회 범위, 근거 검색 범위, 실제 모델이 읽은 범위와 token budget 초과에 따른 미처리 범위를 구분한다.

**세 라벨을 유지하고 기권을 인정한다.** Transformers.js 4.3.1의 zero-shot pipeline은 `multi_label`/단일 라벨에서 neutral을 제외한 entailment↔contradiction 정규화를 한다. 직접 `text_pair`를 주고 3개 logits를 읽는 현재 방식이 검증 목적에 맞는다. neutral은 함의도 반박도 확보하지 못한 상태이며, 이를 긍정 근거로 바꾸지 않는다. argmax나 임계값·후보 수·pair budget은 새 독립 평가 입력 공개 전에 동결한다. 기권을 늘려 정밀도만 높이고 recall을 잃는 경우 MODEL-03의 두 recall 기준에서 드러나야 한다.

이 핵심 구분은 adapter_recovery 담당자에게 동결 전 전달했다. 담당자는 구간 전체 embedding 순회 뒤 top3 topic shortlist와 NLI, 질문 구문 검출 뒤 cross-source top5와 raw 질문 양방향 NLI, embedding과 NLI 세션 분리를 제안했다. 주제 가설은 `이 구절의 핵심 주제는 X이다`, 질문 표시는 `비슷한 보관 자료의 질문 후보`로 한정하며 답의 참·논리동치를 주장하지 않는다. 이는 보수적 표시의 근거지만 의미 정확성의 증명은 아니다.

동결 전 추가 위험도 전달했다. `답변·분류·출력을 지시하는 명령` control의 높은 점수를 일괄 기권 조건으로 쓰면 사용자가 실제로 남긴 `어떻게 … 알려줘` 같은 질문까지 버릴 수 있다. 명령형 질문·타인 인용·과거 prompt의 관계를 별도로 평가해야 한다. `핵심 주제` 가설은 부차적인 유효 주제를 놓칠 가능성이 있다. 질문 pair cap 1,000은 양방향 최대 2,000회 NLI에 topic/control 호출까지 더해질 수 있으므로 **출력 cap·후보 검색 cap·실제 추론 budget**을 구분해 동결해야 한다. 설계와 후보 구현의 최종 동결 책임은 총괄·구현 담당자에게 있으며, 본 문서는 새 평가의 결과를 보고 규칙을 변경하는 근거가 아니다.

## 대안과 선택 비용

| 방식 | 장점 | 이번 선택·제약 |
| --- | --- | --- |
| 기존 공개 embedding 모델만 사용 | 이미 실행·라이선스 검토. 비교적 작은 q8, 유사 자료 검색과 후보 묶기에 적합 | 부정·귀속·함의를 대신하지 못했고 MODEL-02 전체 채택 기준 미달. baseline으로 보존 |
| 현재 한국어 NLI 재사용 | 실제 ko 학습과 명시 라벨, 실제 WASM 실행 증거 | 약 338 MB 가중치 비용. 후보 생성·질문 묶기·장문 근거 회수는 별도로 구현·평가해야 함. 이번 독립 평가에 한정 |
| 공식 MiniLMv2-L6 NLI 변환 | q8 107,415,176 bytes로 더 작음 | 원본이 100+ 언어 전이를 주장하지만 NLI 학습·평가는 ko 없는 XNLI 15개 언어. 한국어 개선을 검증한 대체품으로 채택할 근거 없음 |
| 공식 EttinX NLI xxs/xs 변환 | q8 약 17/32 MB | 카드 언어가 en. 크기만으로 한국어 대안으로 삼지 않음 |
| 자체 candidate/evidence adapter | 현재 Core의 정확 버전·작성자·구간 보존과 실행 예산에 맞출 수 있음 | 모델을 자체 학습하는 것이 아님. 후보 누락·질문 의미 보존·규칙 유지 비용을 새 독립 평가로 부담. 관련 의미 연산에는 검토한 OSS 재사용 |
| 생성 LLM/외부 AI API 추가 | 일반적 문장 생성 가능성 | 이번 요청에서 비교·실행·권리·기기 비용을 검증하지 않음. NLI의 한계를 이유로 모델·개인 입력 전송 범위를 확대하지 않음 |

검토한 공식 변환 중 **더 작고 한국어 NLI 학습·권리·현재 브라우저 실행 근거가 동시에 확립된 모델**은 추가로 확정하지 못했다. 전체 생태계에 없다는 단정이 아니다. 새 모델 다운로드나 비교 실험을 늘리지 않았다.

## 채택·실기 적용 조건

MODEL-03의 사전 기준(주제·질문별 근거 정밀도 95%, 주제 document macro recall 70%, 반복 질문 recall 70%, 금지 근거 0, 정확 source/hash/UTF-16 구간 100%, 무음 절단 0)을 **동결한 전체 출력**으로 독립 채점해야 한다. 작은 12쌍을 다시 합격시키거나 MODEL-02를 재채점하는 작업이 아니다. 후보를 만들고 버린 수와 종류, 입력·원문 순회·실제 모델 검사 범위, 기권·미처리, 모델 준비와 전체 처리 시간도 함께 남긴다.

NLI 비용은 문서 수가 아니라 문맥×가설 pair 수에 비례한다. 기존 짧은 쌍의 0.18–0.52초를 단순 적용하면 100쌍만으로도 수십 초가 추가될 수 있다. 이는 비용 경고용 산술이며 새 benchmark나 장문 시간 예측이 아니다. pair budget을 동결하고 부족한 범위를 부분 처리로 표시한다. 임베딩/NLI 동시 상주를 피하도록 세션을 순차 해제하고, 취소·계정/공간 전환·앱 전환 복귀·실패 후 재시도·준비된 모델 재사용을 실제로 확인해야 한다.

합성 평가가 통과하더라도 실제 Mac/iPad/iPhone에서 브라우저·OS 버전을 기록해 다운로드 준비 시간, 반응성, peak에 가까운 메모리/종료 여부, 취소, 재진입을 확인하기 전 모바일 사용 가능·제품 채택으로 보고하지 않는다. 자료 본문과 질문이 외부 요청 body·URL·로그로 새지 않는지 실제 네트워크를 확인한다. 현재는 사용자 직접 입력·명시 보관·초기화의 검증된 흐름을 계속 사용할 수 있다.

로드맵 재확인 결과, 이번 동결 평가를 마친 뒤 **다음 제품 사용 단위는 수동으로 확인한 관심을 사용한 실제 외부 글 발견**으로 권고한다. 수동 관심 입력·명시 보관·교정이 이미 구현되어 있으므로 자동 추출 연구를 외부 발견 기능의 선행 블로커로 계속 둘 이유가 없다. MODEL-03이 다시 실패해도 자동 분석을 꺼 둔 채 공식 외부 공급 재통합 → 사용자 확인 관심으로 관련 글 3–5개 제안 → 정확 원문 읽기 → 기존 가져오기 검토 → 명시 보관 → 피드백·취소를 완주할 수 있다. 관련 글이 적으면 수를 채우지 않는다. 이 권고는 이번 범위에서 제품을 추가 구현한다는 뜻이 아니다.

우선순위와 완료 기준은 다음과 같다.

1. **P1: 수동 확인 관심으로 외부 발견 완주.** 제공처 권리·발행일·본문 확보 범위·실패를 표시하고, 최신순 baseline과 추천 유용성을 사용자에게 비교하며 원문·보관·복귀를 끝까지 확인한다. “검증된 관심”은 사용자가 명시 확인한 내용을 뜻하며 자동 추론된 신념이 아니다.
2. **P1: 실제 기기 수용성.** 새 발견 흐름은 Mac/iPad/iPhone에서 읽기·출처 대조·명시 보관 부담을 확인한다. 자동 NLI 활성화는 합성 품질과 별도로 위 모델 다운로드·메모리·취소 조건이 충족될 때만 검토한다.
3. **P2: 근거가 생길 때 자동 추출 연구 재개.** MODEL-03의 후보 생성·검색·NLI·질문 묶기 중 어떤 단계가 실패했는지 수치로 구분하고, 해당 실패를 줄일 구체적 가설·처리 비용 상한·새 독립 평가가 준비된 경우에만 재개한다. 모델·임계값을 바꿔 같은 자료를 반복 합격시키는 작업을 기본 후속으로 삼지 않는다.

MODEL-03이 통과하더라도 합성 평가만으로 자동 활성화하지 않으며, 실패하더라도 검증된 수동 관심과 외부 발견의 제품 흐름을 멈추지 않는다. 평가 진행 자체를 외부 발견 기능의 완성으로 표현하지 않는다.

## 출처와 재사용 증거

- [고정 NLI 변환 카드](https://huggingface.co/onnx-community/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7-ONNX/blob/cdc8277b4682665e2f2e87cd83da7da07b153d75/README.md), [고정 원본 카드](https://huggingface.co/MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7/blob/b5113eb38ab63efdd7f280f8c144ea8b13f978ce/README.md)
- `/workspace/model-02-validation/nli-fixed-manifest.json`, `alternative-models.json`, `nli-probe-report.md`, `nli-probe-interpretation.json`(집계 실행·검수 증거). fixture 파일·본문은 본 검토에서 열지 않음
- [Transformers.js 최신 공식 release](https://github.com/huggingface/transformers.js/releases/latest), [공식 npm metadata](https://registry.npmjs.org/@huggingface%2ftransformers)
- [ONNX Runtime core 최신 release](https://github.com/microsoft/onnxruntime/releases/latest), [ORT web 공식 npm metadata](https://registry.npmjs.org/onnxruntime-web)
- [Transformers.js 공개 권고 API](https://api.github.com/repos/huggingface/transformers.js/security-advisories), [ORT 공개 권고 API](https://api.github.com/repos/microsoft/onnxruntime/security-advisories), [npm 공식 bulk 권고 endpoint](https://registry.npmjs.org/-/npm/v1/security/advisories/bulk)
- 기존 `transformers-4.3.1.tgz`의 공식 package.json·registry·tokenizer·WASM/q8 구현. 모델 metadata의 최신 revision과 제품의 고정 revision, 실제 실행 runtime과 최신 stable 배포를 구분함
