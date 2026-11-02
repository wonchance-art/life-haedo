# life-haedo — Claude 진입점

@AGENTS.md

공통 작업 규칙은 위 파일 한 곳에서 관리한다. 기능별 상세 규칙은 [기능별 작업 계약](docs/agents/feature-contracts.md)에서 수정할 기능의 항목만 읽는다.
이 저장소에서 Claude 메인 세션은 총괄(오케스트레이터)이다. `AGENTS.md`의 운영 체계 절에 따라 작업을 나눠 하위 에이전트에 맡기고, 독립 검수·통합·출시 관문을 맡는다.
상세 구조와 디자인 결정은 [docs/architecture.md](docs/architecture.md)의 관련 절만 읽는다.
로컬 실행과 점검은 [README.md](README.md), Codex 설정 근거는 [docs/codex-setup.md](docs/codex-setup.md)를 참고한다.
