# 비슷한 문단 실험 증거

결과와 판정은 [실험 문서](../../similar-paragraphs-experiment.md)에 있다. 이 폴더의 말뭉치는 이 실험을 위해 새로 쓴 합성 자료이며, 개인 기록이나 실제 계정 데이터가 아니다.

| 파일 | 역할 |
| --- | --- |
| `preregistration.md` | 사전등록. `seal.json`으로 봉인했다. |
| `build-corpus.py` → `dev-corpus.json`, `eval-corpus.json` | 합성 말뭉치 |
| `build-gold.py` → `dev-gold.json`, `eval-gold.json` | 관련 문단 정답. 실행기는 읽지 않는다. |
| `seal.json` | 모델 실행 전 봉인(사전등록·말뭉치·gold·생성기·제품 파일 SHA) |
| `candidate.js` | 후보 규칙. 브라우저와 Node가 함께 쓴다. |
| `harness.html`, `worker-host.html` | 실행면. 제품 로더·워커를 수정 없이 불러오고, 감속 측정용으로 워커 소스를 iframe 주 스레드에서 실행한다. |
| `run-experiment.cjs` | 실행기. 모드는 `smoke`·`dev`·`evaldry`(개발 자료로 평가 경로 점검)·`heldout`(평가 1회). |
| `evaluate.cjs` | 평가기. 모드는 `dev`(변형·τ 선택)·`dryrun`(채점 경로 점검)·`heldout`. 기반선은 제품 `rediscovery.js`를 그대로 쓴다. |
| `make-seal.cjs` | `seal.json`·`freeze.json` 생성. 덮어쓰기는 거부한다. |
| `freeze.json` | 평가 전 동결. `freeze-superseded-1.json`은 CLI 이름 변경 전의 첫 동결이다(평가 미실행 상태에서 대체). |
| `smoke-cold-output.json`, `smoke-warm-output.json` | 모델 다운로드·준비·감속 확인. 말뭉치를 쓰지 않는다. |
| `dev-output.json`, `dev-report.json` | 개발 벡터와 선택 결과 |
| `evaldry-output.json`, `dryrun-report.json` | 동결 전 경로 점검. 개발 자료로만 만들었으며 판정 근거가 아니다. |
| `eval-output.json`, `eval-report.json` | 평가 세트 1회 실행의 벡터·비용과 채점 |
| `posthoc.cjs` → `posthoc.json` | 평가 정답을 본 뒤의 서술 분석. 판정에 쓰지 않는다. |

저장된 벡터로 다시 채점하는 데는 모델·네트워크가 필요 없다.

```sh
node evaluate.cjs --set heldout --freeze-sha 5c1b4ebd2926d1159e76d2bd664e31eb98b0c45e2c733d5e2bf92d89bf90e046
```

이 명령을 실행하면 `eval-report.json`을 다시 쓴다. 원본을 보존하려면 사본에서 실행한다.
