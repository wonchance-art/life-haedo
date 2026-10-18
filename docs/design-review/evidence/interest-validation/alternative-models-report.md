# 한국어 로컬 NLI 대안의 제한된 실행 가능성 검토

2026-10-19 KST. 공개 Hugging Face 공식 API·고정 모델 카드·설정과 보존된 공식 Transformers.js 4.3.1 npm 소스를 확인했다. 모델 바이너리·개인 자료·비공개 heldout fixture를 다운로드하거나 열지 않았다. 앱 코드는 수정하지 않았다.

**한국어로 학습한 실제 ONNX NLI 모델 하나에 한정해 독립 실험할 근거가 있다. 제품 적용이나 품질 개선은 아직 입증되지 않았다.**

| 후보 | 한국어 근거 | q8 ONNX 크기 | 판단 |
| --- | --- | ---: | --- |
| `onnx-community/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7-ONNX` | 한국어 포함 27개 언어 NLI 학습, 한국어 번역쌍 105,000개 | 338,341,610 bytes, 약 322.67 MiB | 독립 CPU/WASM 실험 하나 권고 |
| `onnx-community/multilingual-MiniLMv2-L6-mnli-xnli-ONNX` | 100+ 언어 전이 지원 주장. NLI 학습·평가는 한국어 없는 XNLI 15개 언어 | 107,415,176 bytes, 약 102.44 MiB | 한국어 NLI 확인 모델로 채택하지 않음 |

## 선택 후보의 확인값

- 변환 revision: `cdc8277b4682665e2f2e87cd83da7da07b153d75`, 마지막 수정 2026-05-26.
- 원본: `MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7`, 고정 revision `b5113eb38ab63efdd7f280f8c144ea8b13f978ce`.
- 라이선스: 변환·원본 카드 모두 MIT. 언어 목록에 `ko`가 직접 있다. 다만 한국어 NLI 데이터는 기계 번역이며 별도 한국어 원어민 평가 결과는 카드에서 확인하지 못했다.
- 파일: `onnx/model_quantized.onnx`, LFS SHA-256 `f1920d10296efd121a601b2161e8de9fa0c934a6c0331cd1764fd09a06a83041`.
- tokenizer JSON: 16,316,225 bytes. 전체 다운로드는 ONNX 파일보다 크다.
- 모델 타입: `deberta-v2`, `DebertaV2ForSequenceClassification`, tokenizer `DebertaV2Tokenizer`, 문장쌍 최대 길이 512 tokens.
- 라벨: `0=entailment`, `1=neutral`, `2=contradiction`. 후보별로 이 설정을 읽어야 하며 일반적인 라벨 순서를 가정하면 안 된다.

Transformers.js 4.3.1 공식 소스에는 위 모델·tokenizer 등록, q8→`_quantized` 파일명, WASM CPU 실행이 존재한다. 브라우저의 장치는 `wasm`, Node native CPU의 장치는 `cpu`다. 모델 카드도 Transformers.js zero-shot 사용을 안내한다. 이것은 **라이브러리 수준 실행 가능성 근거**이며 이 고정 ONNX 그래프의 실제 브라우저 세션 생성·모든 연산자 실행은 미검증이다.

## 메모리와 작은 실험의 범위

q8 가중치만 약 323 MiB다. tokenizer·모델 입력 버퍼·ORT 세션·activation 및 일시적 복사가 추가되므로 실제 메모리는 이보다 높다. 파일 크기만 보고 Apple 기기에서 불가능하거나 가능하다고 단정할 수 없다. 기존 embedding 세션을 먼저 해제하고, 새 모델 한 개만 batch 1·WASM thread 1로 준비하는 독립 실험이 적절하다. 현재 단계에서는 바이너리를 받지 않았다.

실험은 새로 만든 익명 한국어 문장쌍 12–16개로 직접 주장·부정·불확실성·타인 인용·질문과 단정의 구분을 확인한다. 최대 512 tokens에 특수 토큰을 포함해 들어가도록 짧게 작성하고, 실제 3개 라벨의 logits/확률을 모두 기록한다. 다운로드 bytes·실제 SHA-256·초기 로딩·쌍별 추론 시간·프로세스 메모리·요청 로그·dispose를 함께 기록한다. 초기화 실패·메모리 종료·기초 부정/긍정 구분 실패 시 중단한다. 이 단계에서 앱에 연결하거나 heldout 기준으로 임계값을 조정하지 않는다. 기초 실험을 통과한 경우에만 별도 평가자가 고정 기준으로 기존 비공개 suite를 평가한다.

Transformers.js 4.3.1의 zero-shot pipeline은 `multi_label:true`나 라벨 한 개에서 entailment와 contradiction만 정규화한다. **neutral을 제외하므로 근거가 불충분한 문장도 상대 점수가 높을 수 있다.** 검증기 실험에는 `AutoTokenizer`의 `text_pair`와 `AutoModelForSequenceClassification`으로 세 라벨을 확인해야 한다. 모델 점수가 출처·작성자 관계를 대체하지 않는다.

NLI는 주어진 문장쌍의 관계를 검증한다. 관심사나 질문 후보를 새로 생성하지 않으므로 누락된 질문 후보와 질문 recall 0%가 자동 해결된다고 볼 수 없다. 현재 embedding 대비 질문 추출 개선을 주장하려면 후보 생성과 검증을 포함한 전체 경로를 독립 평가해야 한다.

## 제외하거나 선택하지 않은 결과

기존 Xenova의 동일 한국어 원본 변환도 실제로 존재한다. 그러나 q8 파일이 338,679,132 bytes이고 더 오래되어 현재 onnx-community 변환을 우선했다. `Xenova/mDeBERTa-v3-base-mnli-xnli`라는 확인되지 않은 ID를 만들어 사용하지 않았다.

공식 변환의 `EttinX-nli-xxs`(약 17 MB), `EttinX-nli-xs`(약 32 MB)는 작지만 카드가 `en`만 명시하여 한국어 지원 근거가 없다. `multilingual-nli-bert-ONNX`는 변환 카드에 한국어 학습·라이선스 근거가 없어 이번 두 후보보다 우선하지 않았다. 제한된 공식 검색에서 소형 한국어 전용 KLUE NLI의 유지되는 공식 브라우저 변환을 추가로 확정하지 못했으며, 전체 생태계에 모델이 없다는 의미는 아니다.

## 출처

- [한국어 학습 모델의 고정 변환 카드](https://huggingface.co/onnx-community/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7-ONNX/blob/cdc8277b4682665e2f2e87cd83da7da07b153d75/README.md)
- [한국어 포함 학습 데이터 설명이 있는 고정 원본 카드](https://huggingface.co/MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7/blob/b5113eb38ab63efdd7f280f8c144ea8b13f978ce/README.md)
- [소형 비교 후보의 고정 변환 카드](https://huggingface.co/onnx-community/multilingual-MiniLMv2-L6-mnli-xnli-ONNX/blob/ca5daf3d11b6c4b3143b1f4602a2edfb64c3ad7e/README.md)
- [소형 후보의 고정 원본 카드](https://huggingface.co/MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli/blob/0a71e92a985b6e1ad1828cf67ce9c459639c1dca/README.md)
- [Transformers.js 4.3.1 공식 npm 배포](https://www.npmjs.com/package/@huggingface/transformers/v/4.3.1)

정확한 설정·bytes·SHA-256·판단은 `alternative-models.json`, 공식 응답과 npm 소스 발췌는 `alternative-model-evidence/`에 보존했다. 모델 hash는 공식 LFS metadata이며 아직 실제 바이너리를 검산한 값이 아니다.
