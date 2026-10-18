# MODEL-03 독립 held-out 평가

판정: **reject_or_withhold**. fixture·정답·사전 기준은 변경하지 않았다.

- topic 근거 0/0 (0.0%); question 근거 0/0 (0.0%).
- topic macro document recall 0.0%; 질문 source 검출 18/18; 문장형 9/9; 반복 군집 0/6.
- forbidden 양의 근거 0개; source/SHA/offset/author 0/0.

실패·미확립 gate:

- topicEvidencePrecisionAtLeast95
- questionEvidencePrecisionAtLeast95
- topicMacroDocumentRecallAtLeast70
- repeatedQuestionClusterRecallAtLeast70
- allSourceSHAOffsetsAndAuthorRelationsCorrect
- allLongBeginningMiddleEndEvidenceFound
- allThreeWholeBodiesConfirmedOver512Tokens

잘못된 양의 근거:


원문 scan, embedding, shortlist, 실제 NLI source 범위를 구분했다. 단일 합성 평가를 사용자 유용성이나 Apple 기기 성능으로 일반화하지 않는다. 최종 의미 재독은 별도 기록한다.
