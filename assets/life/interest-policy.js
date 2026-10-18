/* Independent quality gate; changing this requires a new recorded evaluation. */
(function (root) {
  'use strict';
  root.HaedoLife ||= {};
  root.HaedoLife.InterestPolicy = Object.freeze({
    analysisEnabled: false,
    reason: '자동 분석이 품질 기준을 충족하지 못했습니다. 관심을 직접 입력해 보관할 수 있습니다.',
    evaluation: 'MODEL-02',
  });
})(globalThis);
