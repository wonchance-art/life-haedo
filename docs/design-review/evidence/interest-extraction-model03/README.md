# MODEL-03 합성 검증 증거

이 폴더의 문서는 새로 작성한 합성 자료다. `private-heldout.json`의 private는 구현 담당자에게 추론 전 비공개로 봉인했다는 뜻이며 개인 자료가 아니다. 새 정답은 runner에 전달하지 않았고 `input-only.json`에는 id·text·저자 관계만 포함한다. 큰 결과 JSON·실행 로그·캐시는 `raw-results.zip`에 원본 바이트 그대로 보관했다. 소스·설계·사전등록·판정 문서는 압축 없이 읽을 수 있으며, 파일별 SHA와 보관 위치는 `artifact-manifest.json`에 있다.

## 재대조

원 증거를 보존하려면 이 폴더의 사본에서 실행한다. Python 3 표준 라이브러리만 사용하며 모델 다운로드·네트워크·앱 실행은 없다.

```sh
cp -a docs/design-review/evidence/interest-extraction-model03 /tmp/haedo-model03-review
python3 -m zipfile -e /tmp/haedo-model03-review/raw-results.zip /tmp/haedo-model03-review
python3 /tmp/haedo-model03-review/evaluate-heldout.py
python3 /tmp/haedo-model03-review/evaluate-normalized-wrapper.py
python3 /tmp/haedo-model03-review/stage-funnel.py
```

평가기와 사전등록·fixture는 동결 SHA를 검사한다. `heldout-output.json`, `heldout-runtime.json`, `heldout-coverage.json`, `seal.json`으로 점수를 재계산하고 사본 안에 결과와 보고서를 쓴다. 두 번째 명령은 토큰 수의 rows wrapper만 손실 없이 펴고 동일한 봉인 평가기를 별도 폴더에서 실행한다. 원본 수치·파일·모든 품질 지표와 기각 결론이 불변임을 검사한다. 세 번째 명령은 고정 정답·후보 단계 기록·캐시의 실제 NLI 점수를 연결해 누락 단계를 재구성한다. 정확한 인용과 의미의 정확성은 별도이며 독립 의미 재독 기록도 함께 읽는다.

실제 모델 재실행은 동결한 `run-experiment.cjs`의 머리말과 `seal.json`의 세 입력 해시를 따른다. `--runner-sha`, `--candidate-sha`, `--input-sha`가 필수이며 원 증거와 다른 `--name`을 사용한다. 실행기 위치에 결과가 기록되므로 사본을 사용한다. Playwright·`/usr/bin/chromium`, 정상 프록시/TLS, 127.0.0.1:4173의 프로젝트 개발 서버가 필요하다. NLI·embedding 가중치만 약 457MB이며 tokenizer·런타임·WASM은 별도다. 이 실행을 자동 CI나 앱 자산에 연결하지 않았다.

## 동결과 한계

- `candidate-freeze.json`과 `seal.json`: 후보·실행기·평가기·자료·기준과 입력 전용 export의 동결 해시.
- `candidate.mjs`, `candidate.test.mjs`, `design.json`, `dev-report.md`: 새 후보의 실제 소스와 공개 개발 2라운드의 선택 이유. 모의 어댑터 검사는 의미 품질 검사와 합산하지 않는다.
- `public-calibration-*`, `public-template-comparison-*`: 공개 16/32쌍의 원점수와 당시 실행 메타데이터. 당시 runner 해시는 보존했으나 변경 전 소스 사본은 남기지 않아 그 소스 바이트의 정확 재현은 미보존이다. 최종 heldout runner는 실제 소스 바이트를 보존했다.
- `product-before.json`: 원본 저장소와 실험 시작 시 제품 파일 상태. 앱의 자동 분석 비활성과 기존 저장·백업·PWA 형식을 유지한다.

Linux headless Chromium의 CPU 측정이며 실제 Google 계정·Apple 기기·운영 데이터·사용자 유용성·배포 검증이 아니다. RSS 표본 합계는 공유 메모리를 중복 계산할 수 있고 표본 사이의 최대치를 놓칠 수 있다. 실제 q8 바이너리 SHA를 직접 계산한 증거와 공식 metadata에 선언된 LFS SHA를 구분한다.
