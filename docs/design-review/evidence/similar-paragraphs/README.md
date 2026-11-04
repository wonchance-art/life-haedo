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
| `dev-report.json` | 개발 세트의 변형·τ 선택 결과 |
| `eval-output.json`, `eval-report.json` | 평가 세트 1회 실행의 벡터·비용과 채점 |
| `posthoc.cjs` → `posthoc.json` | 평가 정답을 본 뒤의 서술 분석. 판정에 쓰지 않는다. |

저장된 벡터로 다시 채점하는 데는 모델·네트워크가 필요 없다.

```sh
node evaluate.cjs --set heldout --freeze-sha 5c1b4ebd2926d1159e76d2bd664e31eb98b0c45e2c733d5e2bf92d89bf90e046
```

이 명령을 실행하면 `eval-report.json`을 다시 쓴다. 원본을 보존하려면 사본에서 실행한다.

### 저장소에서 뺀 원 출력 (2026-11-04)

판정 근거(`eval-output.json`·`eval-report.json`·`dev-report.json`·봉인·동결)는 그대로 둔다. 판정에 쓰지 않은 큰 원 출력 다섯 개는 저장소 크기를 줄이려고 뺐다. 기록은 SHA-256만 남긴다. `freeze.json`이 가리키는 `dev-output.json` SHA는 아래 값과 같다. 뺀 파일은 같은 실행기로 다시 만들 수 있지만, q8 배치 양자화 때문에 벡터가 바이트 단위로 같다는 보장은 없다.

| 파일 | 역할 | SHA-256 |
| --- | --- | --- |
| `dev-output.json` | 개발 세트 벡터(`evaluate.cjs --set dev` 입력) | `7442658268a4599e496217b22a111e8143f5506652e1c7dc6a0614f0c141b90c` |
| `evaldry-output.json` | 동결 전 평가 경로 점검(개발 자료) | `67f2b4a22317b600598b079c8114ba7d5a8aa97da0a1b1539856da83588bd183` |
| `dryrun-report.json` | 위 점검의 채점 | `777ac7aa3d4a3ed7ce95be9417a0e8d795d71e93d699eb2d955387c30047b167` |
| `smoke-cold-output.json` | 모델 다운로드·감속 확인 | `083770098f26a41f46eab696dde336bddc3919b031ab73da45b11a3c02e8130b` |
| `smoke-warm-output.json` | 캐시 있는 준비 확인 | `832e8b5d411c05953be4ce9491bae37363a4c0c6be98377fc42da54477930c86` |

평가 세트는 이미 한 번 실행했으므로 다시 실행하지 않는다. 실행기는 `eval-output.json`이 있으면 평가 실행을 거부한다.
