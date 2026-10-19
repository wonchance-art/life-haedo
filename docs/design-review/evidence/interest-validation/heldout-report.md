# MODEL-02 held-out 비교 결과

판정: **기각 또는 미확립 조건으로 보류**. 사전등록 기준과 fixture를 변경하지 않았다.

| 지표 | baseline | candidate |
|---|---:|---:|
| semanticEvidencePrecision | 0.8462 | 0.9000 |
| macroPerTopicEvidenceRecall | 0.4400 | 0.2600 |
| goldQuestionClusterRecall | 0.5000 | 0.0000 |
| questionEvidencePrecision | 1.0000 | 0.0000 |
| sourceSHAOffsetAccuracy | 1.0000 | 1.0000 |

candidate 실패·미확립 조건:

- semanticEvidencePrecisionAtLeast95
- noForbiddenPositiveEvidence
- atLeastEightTopicsWithTwoValidBodies
- macroPerTopicRecallAtLeast50
- questionClusterRecallAtLeast75
- questionEvidencePrecisionAtLeast95
- longMiddleEvidenceFound
- relative: noTopicRecallRegression
- relative: noQuestionRecallRegression

잘못된 candidate 근거:

- topic-technology-science / h044: '다음은 과거 도구 사용 안내의 인용이다.'; forbidden=True, integrity=True.

source 동결의 실제 시간 순서, unknown/other 귀속 문구의 광범위한 언어적 정확성, 내부에서만 계산한 support는 기록과 별도 검토가 필요하다. 이 표본은 실제 사용자 자료의 대표성이 없다.
