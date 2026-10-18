# 비공개 NLI 12쌍 가능성 검사 사전등록

목적은 한국어 근거 검증에 NLI를 후속 연구할 실익이 있는지 확인하는 작은 실제 모델 실행이다. 현재 기능 도입 조건을 대체하지 않으며 실패한 MODEL-02 48문서 결과를 뒤집지 않는다.

- fixture: `private-nli-probe.json`, 12쌍, SHA256 `ac01222b172847a154dfa209a5f9aadd9b5cca73e5bd300a459995cf2b8c4863`.
- 모델: `onnx-community/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7-ONNX`, revision `cdc8277b4682665e2f2e87cd83da7da07b153d75`, q8. runtime/API는 입력 공개·추론 전에 동결한다.
- 입력: premise와 hypothesis를 tokenizer의 직접 text pair로 넣는다. template, 생성 prompt, label별 가설 추가, 문서 속 명령 실행은 하지 않는다. runner에는 id/premise/hypothesis만 전달한다.
- 변환·원본 config의 label mapping은 `0=entailment`, `1=neutral`, `2=contradiction`이다.
- 정답은 긍정 함의 4쌍, 명시 부정 3쌍, 과거 명령 인용 3쌍, 기타 정보 부재 2쌍으로 추론 전 고정한다. 질문 바꿔 쓰기와 질문에서 알 수 없는 사실을 포함한다. 이전 48문서 원문을 재사용하지 않는다.
- 예측은 모든 3개 raw logits의 argmax다. 최댓값의 정확한 동점은 실패로 센다. 사후 threshold·정답·문구·라벨 순서 조정은 하지 않는다.
- **가능성 기준: 12개 중 최소 10개 정답이며, 부정 3개와 과거 명령 인용 3개는 모두 정답이어야 한다.** 전체 실행·3-logit 출력·pinned 모델 및 mapping이 확인되어야 한다.
- runtime 실패, 출력 누락, mapping 불일치면 가능성 미확립이다. 모델이 실행되지 않은 결과를 한국어 모델 정확도 실패라고 보고하지 않는다.
- 모든 pair와 정답/예측/logits/오류를 보고한다. 통과해도 다음 독립 실험을 조사할 근거일 뿐, 제품 도입이나 실제 사용자 자료 품질을 증명하지 않는다. 같은 12쌍으로 튜닝한 후 통과를 일반화하지 않는다.

이전 fixture, 평가기, 사전등록, 후보 출력은 변경하지 않는다.
