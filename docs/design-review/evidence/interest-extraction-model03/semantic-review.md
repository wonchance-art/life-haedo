# MODEL-03 독립 의미·단계 검토

현재 동결 후보는 **도입 기각**이다. 이 새 평가에서 질문 검출은18/18, 정답 주제 후보 검색은50/51에 도달했지만, 의미 검증 단계가 모든 후보에 기권하여 주제와 반복 질문을 하나도 제안하지 못했다. 실제 모델 실행과 원문 보존에 관한 성공을 의미 품질 합격으로 합산하지 않는다.

| 평가 | 결과 | 사전 기준 |
|---|---:|---:|
| topic 양의 근거 | 0개 | precision ≥95% |
| question 양의 근거 | 0개 | precision ≥95% |
| topic macro 문서 recall | 0% | ≥70% |
| 반복 질문 군집 recall | 0/6 | ≥70% |
| source 질문 검출 | 18/18 | ≥70% |
| 물음표 없는 문장형 검출 | 9/9 | ≥70% |
| gold와 start/end까지 같은 검출 | 18/18 | 별도 기술 지표 |
| forbidden 양의 근거 | 0개 | 0개 |
| 처음·중간·끝 장문 양의 근거 | 0/3 | 3/3 |

양의 출력이 없기 때문에 precision은 사전 empty-head 규약상 0이다. 관측한 false positive도 0개지만 경험적 precision·오탐률·Wilson 구간을 추정할 예측 표본이 없다. “정확한 관심 제안 100%”나 “잘못된 인용 0%”로 부르면 안 된다. 원문 출처 정확도도 최종 출력에서는 검사할 인용 자체가 없으며, scorer의0/0 규약이 인용 변조를 관측했다는 뜻은 아니다.

## 실제 실패 단계

- 주제: 정답 독립 본문-주제 51개 중 50개가 top-three shortlist에 들어갔고 NLI까지 계측됐다. 통과 0개, 최종 출력 0개다. 정답 주제 NLI 최대는0.2467, 모든 주제 후보의 최대도0.2867로 동결 문턱0.55 미만이다.
- 단일 검색 누락: b012의 치실·구강 위생 자료는 두 문장 모두 health-life가 top-three에 없었다. 나머지50개의 최종 누락은 단순히 검색 단계에서 사라진 것으로 설명할 수 없다.
- 질문: gold18개 모두 정확히 추출됐고 반복된 gold6쌍도 모두 nearest-five shortlist에 있었다. 하지만 raw 질문 후보19개의 questionhood 점수가 모두0.55 미만(최대0.3126)이어서 이후 양방향 pair NLI는 **0회 실행**됐다. 따라서 이 실행만으로 양방향 질문 동치 모델이 오답을 냈다고 주장할 수 없다.

원문과 근거 명제를 독립 재독했다. 쌍 여섯 개는 같은 조건·목표·해결 문제를 묻고, 같은 주제의 단독 질문 여섯 개는 해결 문제가 다르다. 나머지 raw 질문 하나는 인용된 과거 명령 속 물음이다. raw19개 중18개가 실제 질문이라는 사실은 최종 관심 근거 precision과 다른 지표다.

범용 주제·questionhood 가설에서 고정 NLI 점수가 낮아 기권한 위치는 확인됐다. 모델 가중치, 가설 표현, calibration 중 무엇이 근본 원인인지는 이 trace만으로 분리하지 않는다. 이전 짧은 NLI12쌍 통과를 완성 관심 파이프라인의 성공으로 일반화할 수 없다는 실제 반례다.

## 원문·범위·실행

171개 passage와19개 question candidate의 source ID, 정확 버전, rawSHA, UTF-16 인용, authorRelation 190개를 독립 대조해 모두 일치했다. 입력은 변하지 않았고, 후보·runner·fixture·평가기·사전등록·input-only 동결 해시 여섯 개도 일치한다. unknown/other의 현재 사용자 승격은 관측하지 않았으나 최종 양의 출력이 없어 향후 제안의 귀속 정확성까지 증명하지는 않는다.

전체60개 원문을 순회·임베딩했다. 원문 전체가 실제 NLI input 범위로 덮인 문서는57개이며, 장문3개는 긴 문장의 scope-abstention을 명시했다. scan100%를 NLI100%로 표시하지 않았다. 장문 전체 길이는3098/3095/3099 tokens이며 처음·중간·끝의 관련 대목은 모두 후보 검색과 NLI에 도달했지만 양의 출력으로 채택되지 않았다. 실제 모델 input 최대는182 tokens이며, 무음 절단·overflow·기한/호출 예산 누락은 없었다.

실제 Linux Chromium WASM/q8 1스레드 실행은168.846초였다. 모델 준비는 임베딩17.761초/NLI40.173초, 실제 추론은 임베딩6.138초/NLI101.497초다. 고유 실추론은 임베딩144개/NLI479개였고 NLI 요청506개 중27개는 같은 text pair 캐시 재사용이었다. 관측 sampled summed RSS는683,806,720 bytes였다. 이는 공유 페이지 중복 합산과 sampling의 한계가 있는 값이며 고유 peak RAM이나 Apple 실기기 결과가 아니다. 오류·외부 body 전송·가변 revision 요청·network violation·절단은0건이다.

## 래퍼 정규화와 재현

봉인 scorer는 whole-document token counts를 직접 list/id-map으로 기대했지만 runner는 `{rows:[...],elapsedMs}`로 기록했다. 원본 runtime·원본 채점·원본 보고서는 그대로 보존했다. 별도 정규화 사본에서는 `wholeDocumentTokenCounts.embedding` 안의 rows를 문서 ID 키로 옮기고 각 행·숫자·elapsedMs는 그대로 유지했다. 다른 runtime 필드가 deep-equal임을 assert했다. 동일 bytes의 봉인 scorer를 별도 디렉터리에서 실행했으므로 scorer·가설·문턱·gold는 바뀌지 않았다.

유일한 gate 차이는 “장문3개 전체가512tokens 이상임을 확인”이 미확립에서 통과로 바뀐 것이다. 모든 품질 metric과 기각 결론은 동일하다. 원본/정규화 파일 해시와 변환기록은 runtime-normalization-audit.json에 있다.

재현 명령: `python /workspace/model-03-validation/evaluate-normalized-wrapper.py`

## 다음 완료 조건

1. 제품의 자동 분석 비활성 상태를 유지하고 이번 기각을 이전48문서·NLI12쌍 결과와 나란히 기록한다.
2. 공개 개발 자료에서 실제 주제/질문 판정과 맞는 검증 표현을 선택한다. 이번 held-out에 맞춰 문턱을 내린 재실행을 독립 합격으로 부르지 않는다.
3. 수정한 전체 파이프라인을 동결한 후 새 비공개 자료에서 동일한 precision·topic/question recall·forbidden·원문/coverage 조건을 충족해야 한다.
4. 의미 품질을 통과한 뒤 사용자 교정·근거 왕복과 실제 기기 메모리·대기 시간을 별도로 검수한다.

이 합성60문서는 실제 사용자 유용성이나 정확도의 대표 표본이 아니다. 제품 활성화·배포는 이번 실험에 포함되지 않았다.
