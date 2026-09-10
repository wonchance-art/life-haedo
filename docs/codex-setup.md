# GPT-6 / Codex 설정

2026-09-10 확인. 이 앱을 개발하는 에이전트 설정이며, 앱 자체에 OpenAI API를 추가하는 설정이 아니다.

## 적용한 기본값

`.codex/config.toml`:

```toml
model = "gpt-6-astra"
model_reasoning_effort = "xhigh"
```

현재 기기의 기존 선택이 GPT-6 Astra / xhigh이므로 그대로 유지했다. 기존 단일 HTML에 계산·저장·SVG 조작이 함께 있어,
이관 첫 기준선은 품질을 유지하는 편으로 정했다. 이것이 모든 작업에서 가장 빠르거나 저렴하다는 의미는 아니다.
단순 문구 작업을 빠르게 처리할 때는 작업별로 `medium`을 선택할 수 있다.
CLI에서 한 번만 바꾸려면 `codex -c model_reasoning_effort=medium`을 사용한다.

신뢰한 프로젝트의 `.codex/config.toml`은 사용자 기본값보다 우선하지만, 명시적인 실행 설정이나 관리 정책이 우선할 수 있다.
이미 열린 작업의 모델 선택을 파일 수정만으로 바꿨다고 간주하지 않는다. 다음 작업 시작 시 모델 선택을 확인한다.
이 기기에서는 프로젝트가 이미 trusted로 등록돼 있었다. 전역 모델·권한·플러그인 설정은 수정하지 않았다.
[설정 적용 순서](https://learn.chatgpt.com/docs/config-file/config-basic),
[설정 키](https://learn.chatgpt.com/docs/config-file/config-reference)

API 전용 `temperature`·토큰 예산·캐시 옵션이나 추측한 컨텍스트 크기는 넣지 않았다.
출력 길이는 한국어·간결한 결과 보고 지침으로 조정하고, 모델의 기본 verbosity를 사용한다.

## GPT-6에 맞춘 지침 정리

GPT-6 공식 가이드는 파일·스킬 지침의 충돌, 불필요한 확인 질문, 과한 검증, 응답 스타일을 점검하도록 설명한다.
이 프로젝트에서는 다음과 같이 반영했다.

- `AGENTS.md`에 현재 제품 규칙과 완료 기준을 모으고, 실행 요청은 필요한 로컬 작업까지 이어가도록 했다.
- 25KB였던 `CLAUDE.md`의 상세 설계는 `docs/architecture.md`로 옮겼다. Claude의 진입 파일도 같은 공통 지침을 참조한다.
- 문서 변경·코드 변경·실제 배포의 검증 범위를 구분했다. 기존의 “완료하려면 먼저 푸시” 절차와 Claude 고정 커밋 서명을 제거했다.
- `life-haedo-dev` 스킬은 실행·수정·브라우저 검증 때만 선택한다. 작은 변경에 병렬 에이전트나 반복 테스트를 강제하지 않는다.

이는 공식 가이드에 근거한 프로젝트별 판단이며 성능 벤치마크 결과는 아니다.
[GPT-6 Astra 가이드](https://developers.openai.com/api/docs/guides/latest-model)

Codex는 `AGENTS.md`를 기본 지침으로 읽고, 스킬은 이름·설명으로 선택한 뒤 본문을 읽는다.
따라서 핵심 규칙과 상세 참고 문서를 나눴다.
[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[스킬과 프로젝트 검색 경로](https://learn.chatgpt.com/docs/build-skills)

## 스킬 점검 결과

| 항목 | 처리 |
| --- | --- |
| 기존 저장소 | `README.md`, `CLAUDE.md`만 존재. 프로젝트 전용 스킬·실행 설정 없음 |
| `life-haedo-dev` | `.agents/skills/`에 추가. 현재 프로젝트에만 적용 |
| `openai-docs`, `skill-creator` | 이번 설정 조사·작성에 사용 |
| `agent-browser` 및 검증 지침 | 초기 브라우저 실행 점검에 사용. npm 임시 도구이며 앱 의존성에 추가하지 않음 |
| 기존 `dataviz` / `validate_palette.js` | 저장소와 확인한 로컬 스킬 경로에서 찾지 못함. 과거 측정 기록은 보존하고 없는 실행 명령은 정정 |
| Supabase | DB 작업을 할 때만 관련 스킬 사용. 최초 실행에는 원격 DB 접근 불필요 |
| Vercel / Next.js / React | 현재 앱은 GitHub Pages의 일반 HTML이므로 해당 프레임워크로 전환하는 지침을 적용하지 않음 |

새 스킬은 일반적인 자동 선택을 허용한다. 스킬 목록에서 보이지 않으면 새 작업이나 앱 재시작 후 확인한다.
기존 Claude의 개인 메모리 전체를 가져오지 않고 저장소에 남은 프로젝트 맥락을 이관했다.

## 검증 범위

`npm run check`는 네트워크나 DB 없이 HTML 인라인 스크립트·프로젝트 JS 구문과 로컬 리소스·PWA 셸을 점검한다.
브라우저에서는 별도 로컬 세션의 익명 샘플로 초기 렌더·편집·새로고침 후 저장을 확인한다.
프로덕션 DB 동기화와 배포 완료 여부는 이 초기 설정 검증에 포함하지 않는다.

2026-09-10 초기 설정 시점의 확인 결과 (앱 개편 전):

- Codex CLI 0.153.4의 `debug prompt-input`에서 프로젝트 `AGENTS.md`와 `life-haedo-dev` 검색을 확인했다. 상세 설계 전체는 자동 로딩되지 않았다.
- 공통 진입 지침 4,802 bytes, Claude 진입점 354 bytes. 기존 Claude 문서는 25,253 bytes였다.
- Node 25.8.1 / Python 3.14.2에서 `npm run check` 통과: HTML 6개, JS 블록·파일 9개, 로컬 리소스 참조 14개.
- 격리된 임시 복사본에 JS 구문 오류·누락 아이콘을 넣었을 때 점검 명령이 각각 실패하는 것을 확인했다.
- agent-browser 0.37.1의 별도 세션에서 익명 사건을 UI로 추가·편집하고 재로드 후 보존을 확인했다.
- 1440×1000 및 390×844 화면을 확인했다. 모바일 문서 폭 390px, 실제 콘솔·페이지 오류 0건.
- 자동 검증의 게이트는 localhost 테스트 저장소에 통과 상태를 설정했다. 비밀번호 입력 흐름은 이 결과에 포함하지 않는다.
- 스킬 검증기, 로컬 Markdown 링크, `git diff --check` 통과. 앱 HTML·CSS·서비스워커 코드는 수정하지 않았다.
