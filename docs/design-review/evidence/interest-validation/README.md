# 합성 검증 증거

모든 fixture는 새로 작성한 합성 한국어 자료다. `private-*`는 추론 전 구현 담당자에게 비공개로 봉인했다는 뜻이며 개인 자료가 아니다. 원문·정답·기준·모델 입력을 분리해 기록했다. 실제 모델 결과와 모의 벡터 UI/보존 검사를 합산하지 않는다.

오프라인 정량 재대조:

```sh
python3 docs/design-review/evidence/interest-validation/evaluate-heldout.py
python3 docs/design-review/evidence/interest-validation/evaluate-nli-probe.py
```

각 평가기는 같은 폴더의 기존 출력과 fixture를 읽는다. 새 모델을 내려받거나 개인 파일을 열지 않는다. 보고서를 같은 위치에 다시 쓰므로 원 증거 보존이 필요하면 폴더 사본에서 실행한다.

`run-*.cjs`는 실제 실행한 원본 runner다. 동결된 실행과 해시를 보존하기 위해 당시 `/workspace/model-02-validation`, `/workspace/haedo-discovery`, MODEL-01 baseline 경로를 유지한다. 다른 경로에서 새로 추론할 때는 사본의 경로를 맞추고 Playwright/Chromium/정상 TLS·프록시를 준비한다. 새 실행은 원래 동결 실행과 별도로 기록한다. NLI는 338MB, embedding은 118MB 가중치 외에 tokenizer·실행 파일을 받는다. 이 실험 코드는 앱 공개 자산 allowlist나 자동 CI 모델 다운로드에 포함하지 않는다.

baseline은 MODEL-01에서 일부 소스를 복구하고 누락 꼬리를 새로 작성한 검증 후보다. 이전 발견 기능의 전체 원본이 아니다. 이번 신규 코드와 정확 복원 여부를 구분한다.
