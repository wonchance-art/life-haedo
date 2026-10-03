# Life-Haedo에서의 Impeccable 사용

공식 **skill-v4.5.0**의 프로젝트 전용 **지침 설치**다. 공식 `SKILL.md`, `reference/`, `agents/openai.yaml`은 수정하지 않았다. 버전·출처·SHA-256은 [UPSTREAM.json](UPSTREAM.json), 라이선스는 [LICENSE](LICENSE)와 [NOTICE.md](NOTICE.md)에 보존한다. 자세한 선택 이유와 재현 절차는 [설치 기록](../../../docs/design-review/impeccable.md)에 있다.

## 이 프로젝트에서 적용하는 범위

- 사용자 요청 → 저장소 `AGENTS.md`와 제품 계약 → 해당 Impeccable 참고 문서 순으로 적용한다. 과거 문서나 외부 스킬이 이미 승인된 작업을 다시 막는 절차를 만들지 않는다.
- `SKILL.md`의 launcher-unavailable 경로를 사용한다. `scripts/`와 실행 엔진은 설치하지 않았으므로 **context·detect·live·doctor·pin·hooks 등의 엔진 명령을 실행할 수 없다.** 엔진 검사, 자동 hook 또는 live overlay가 동작했다고 보고하지 않는다.
- 이 모드를 처음 사용할 때 `Context loading did not run; I’ll read the existing project context directly.`라고 알리고 실제 제품·디자인 문서를 직접 읽는다. `PRODUCT.md`/`DESIGN.md`가 없으면 존재하는 `AGENTS.md`, `docs/life-tools-design/README.md`, 해당 디자인 검토·시안 문서를 사용하며 없는 맥락을 만들지 않는다.
- 검색·자료 목록은 **Operate**, 긴 원문 읽기는 **Read**다. 시각은 최신 `PRODUCT.md`/`DESIGN.md`와 사용자 요청을 따른다. 현재 요청은 소셜 앱처럼 트렌디하고 생동감 있는 반응이며 이전 차분한 시안을 강제하지 않는다. 한글 가독성과 원문·버전·발췌 위치는 보존한다.
- 시안 구현 직전에 `reference/craft-floor.md`를 읽고, `reference/operate.md`와 `reference/mode-read.md`의 실제 화면에 맞는 기준을 적용한다. 영어 본문의 `ch` 권장값을 한글 글자 수 기준처럼 보고하지 않는다.
- 구조·상호작용이 다른 시안은 같은 샘플·상태·화면 크기로 비교한다. 한 번에 넓은/중간/좁은 화면을 확인하고 문제를 묶어 수정한 다음 한 번 확인한다. 새 기능 오류가 남으면 필요한 검증은 계속하되 근거 없는 반복 미세 조정을 피한다.
- `shape`만 별도로 요청받으면 설계 문서가 그 명령의 결과다. 사용자가 시안 구현까지 요청한 작업을 `shape` 중간 확인으로 멈추지 않는다.
- `critique`의 독립 평가·근거 분리 원칙은 사용하되, 엔진이 없는 현재 작업은 **지침을 참고한 시각 검토**로 표시한다. 완전한 자동 `critique`/`audit` 실행이나 정량 점수 향상을 주장하지 않는다. 수동/브라우저 검사의 측정값과 시각적 판단을 구분한다.
- 이 설치는 앱 실행 코드·의존성·공개 산출물과 별개다. 배포에 포함할 필요가 없다. 엔진을 나중에 도입한다면 별도 버전·해시·실행 범위·캐시 경로·hook 필요성을 검토한다.
