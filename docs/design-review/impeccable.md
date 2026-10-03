# Impeccable 도입 기록

확인일: **2026-10-04 KST / 2026-10-03 UTC**. 공식 배포의 디자인 지침을 Life-Haedo 저장소에 설치했다. 실행 엔진과 자동 hook은 활성화하지 않았다.

## 버전·출처·라이선스

| 항목 | 확인 결과 |
| --- | --- |
| 공식 저장소 | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) |
| 고정한 배포 | [skill-v4.5.0](https://github.com/pbakaus/impeccable/releases/tag/skill-v4.5.0) — 확인 시점 GitHub latest release |
| 배포 태그의 commit | `508d7e8955de3b3caf2d8676e85206723d41a887` |
| 확인 시점 main | `e103efe779e2dd01274dabae83531fef00bf2563`; 배포되지 않은 main을 추적 설치하지 않음 |
| 실제 받은 산출물 | [공식 universal.zip](https://github.com/pbakaus/impeccable/releases/download/skill-v4.5.0/universal.zip), GitHub asset ID `604641942` |
| ZIP SHA-256 | `a6877c158ec90c63560728553d2e737081afa8a79b86c507fa8d15a81fffd475` |
| 확인 방법 | 받은 ZIP의 SHA-256이 공식 GitHub release API `digest`와 일치. 별도 `.sig.json` 서명 검증은 수행하지 않음 |
| 본체 라이선스 | [Apache-2.0 원문](../../.agents/skills/impeccable/LICENSE), [공식 NOTICE](../../.agents/skills/impeccable/NOTICE.md) 보존 |
| 파생 콘텐츠 | iOS/Android 참고 문서의 원천 `ehmo/platform-design-skills`, MIT. NOTICE와 [MIT 전문](../../.agents/skills/impeccable/licenses/platform-design-skills.LICENSE) 보존 |
| 보안 공개 정보 | GitHub의 [공개 repository advisory API](https://api.github.com/repos/pbakaus/impeccable/security-advisories?per_page=100) 응답 0개. 포괄적 취약점 검사나 무결점 보장을 뜻하지 않음 |

공식 파일은 수정하지 않았다. 모든 설치 파일의 출처·바이트 수·SHA-256, 실제 확인 시각, 제외한 파일은 [UPSTREAM.json](../../.agents/skills/impeccable/UPSTREAM.json)에 기록했다. Life-Haedo 사용 범위는 공식 파일을 고치는 대신 [INSTALLATION.md](../../.agents/skills/impeccable/INSTALLATION.md)에 구분했다.

## Codex 호환성과 설치 범위

[고정 버전의 공식 README](https://github.com/pbakaus/impeccable/blob/508d7e8955de3b3caf2d8676e85206723d41a887/README.md)는 Codex 프로젝트 설치 위치를 `.agents/skills/`로 설명하며 `$impeccable` 또는 `/skills` 사용과 새 설치 후 도구 재시작 가능성을 명시한다. 공식 ZIP에도 `.agents/skills/impeccable/SKILL.md`와 `agents/openai.yaml`이 있다.

이번 설치는 다음과 같다.

- **포함:** 공식 `SKILL.md`, 전체 45개 `reference/` 문서, Codex 표시용 `agents/openai.yaml`, 라이선스·NOTICE·파일별 출처 기록.
- **제외:** launcher와 browser injection script 등 `scripts/`, 엔진, 자동 역할 설정 `agents/*.toml`, 다른 도구의 중복 skill 사본, `.codex/hooks.json`.
- **미변경:** 전역 설정, 사용자 홈 디렉터리, 앱 의존성, 인증·데이터 코드.

SKILL의 YAML frontmatter(`name: impeccable`, `version: 4.5.0`)와 Codex 표시 메타데이터, 공식 ZIP 내용의 일치, 파일별 해시는 확인했다. 현재 세션은 파일을 직접 읽어 적용한다. **새 세션의 `$impeccable` 목록 자동 발견/명령 UI는 아직 실제 확인하지 않았다.** 공식 지원 및 파일 배치 확인과 현재 실행 환경의 명령 UI 검증은 구분한다.

## 엔진·hook을 켜지 않은 이유

공식 launcher를 읽어 확인한 결과, skill 4.5.0과 별개의 **engine 0.1.11**을 실행한다. 로컬 바이너리·지정 경로·사용자 캐시·PATH를 찾고, 없으면 GitHub에서 바이너리와 SHA-256 sidecar를 받아 사용자 캐시에 저장한 뒤 실행한다. 네이티브 hook은 UI 편집/종료 때 이 경로를 자동 호출한다.

지금 필요한 것은 실제 브라우저의 화면 비교와 지속 가능한 디자인 규칙이다. 기존 브라우저 검사 도구로 진행할 수 있으므로 자동 실행 계층을 추가하지 않았다. 공식 SKILL의 **Launcher unavailable** 절은 엔진 실패·사용 거절 시 기존 프로젝트 맥락을 직접 읽고 허용된 도구로 계속하도록 명시한다. 이 경로를 적용한다.

따라서 `impeccable context`, `detect`, `live`, `doctor` 등의 실행 결과는 없다. 자동 디자인 탐지 61개 규칙, overlay, engine 전용 snapshot/추세 점수 기능을 사용했다고 주장하지 않는다. hook trust 요청도 발생시키지 않았다. 엔진 도입을 나중에 결정하면 설치 경로와 실행 범위를 다시 검토하고 프로젝트 내부 캐시/명시 실행부터 검증한다.

## 해도에 적용하는 방법

| 참고 | 적용할 내용 |
| --- | --- |
| [SKILL](../../.agents/skills/impeccable/SKILL.md) | 사용자 요구와 제품 사실 보존, 화면마다 Operate/Read 역할 구분, 근거 있는 제한된 검토 반복 |
| [shape](../../.agents/skills/impeccable/reference/shape.md) | 목적·입력·성공 결과·상태·경계를 먼저 명시. 이미 제공된 답을 반복 질문하지 않음 |
| [critique](../../.agents/skills/impeccable/reference/critique.md) | 디자인 판단과 측정 근거를 독립 검토, 정보 우선순위·인지 부담·실패 회복의 영향 기록 |
| [audit](../../.agents/skills/impeccable/reference/audit.md) | 대비·키보드·터치·반응형·토큰 일관성 측정. 실제 수행하지 않은 자동 검사를 통과로 표시하지 않음 |
| [craft-floor](../../.agents/skills/impeccable/reference/craft-floor.md) | 실제 문구·상태·대비·간격·초점 검사. 무의미한 카드 반복과 장식 배제 |
| [operate](../../.agents/skills/impeccable/reference/operate.md) / [read](../../.agents/skills/impeccable/reference/mode-read.md) | 익숙한 조작과 절제된 화면, 원문 읽기 폭·문단·주변 탐색 구조 비교 |

스킬의 일반적 미학은 사용자 요구를 대체하지 않는다. 해도의 목적은 기존 기록을 읽고 찾고 발췌하고 연결하는 것이며, 따뜻하고 차분한 한글 화면이 우선이다. 검색 결과에서는 자료를 고르는 속도를, 원문에서는 읽기와 근거 확인을 개선한다. 예를 들어 영어 본문 65–75ch 지침을 한글 65–75자 요구로 해석하지 않고 실제 한글 샘플로 검토한다. 플랫폼의 익숙한 입력·선택·스크롤을 불필요하게 재구현하지 않는다.

이번 사용자는 비교 시안과 구현까지 명시했으므로 독립적인 `shape` 명령의 “확인 후 정지”를 전체 작업의 중단 근거로 사용하지 않는다. 향후 `shape`만 명시적으로 요청받으면 해당 설계 결과만 반환한다. 이미 승인된 범위를 재확인하는 절차를 늘리지 않는다.

## 재현·업데이트

현재 설치 검증은 저장소 루트에서 아래 표준 Python만으로 수행할 수 있다. 네트워크 접속이나 외부 프로그램 실행 없이 설치 파일을 기록된 해시와 대조한다.

```sh
python - <<'PYCODE'
import hashlib, json
from pathlib import Path
root = Path('.agents/skills/impeccable')
manifest = json.loads((root / 'UPSTREAM.json').read_text())
for entry in manifest['files']:
    data = (root / entry['path']).read_bytes()
    assert len(data) == entry['bytes'], entry['path']
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['path']
print(f"Verified {len(manifest['files'])} upstream files")
PYCODE
```

정확히 같은 설치를 재현하려면 다음 순서를 따른다.

1. 위 release asset URL의 ZIP을 받고 기록된 전체 SHA-256을 대조한다. 불일치하면 중단하고 원인을 확인한다.
2. ZIP에서 `.agents/skills/impeccable/SKILL.md`, `reference/` 전체, `agents/openai.yaml`만 경로를 그대로 보존해 복사한다. 다른 provider 설정과 실행 파일은 복사하지 않는다.
3. 고정 commit의 `LICENSE`, `NOTICE.md`를 보존한다. `UPSTREAM.json`에 기록한 `ehmo/platform-design-skills` commit `dc2be825d8b439caea78e9eaa8fb3ac23b0ff3e9`의 `LICENSE`를 `licenses/platform-design-skills.LICENSE`로 보존한다.
4. 위 파일별 검증을 실행한다. 프로젝트용 `INSTALLATION.md`와 이 도입 기록은 공식 파일과 구분해 유지한다.

업데이트 시에는 새 공식 release의 라이선스·diff·공개 advisory·Codex 경로와 추가 실행 요구를 검토한다. 새 태그만 바꾸거나 최신 main을 자동 복사하지 않는다. 검토한 ZIP 해시와 immutable commit, 변경 파일 해시를 함께 갱신하고 디자인 작업에 미치는 변경을 기록한다.
