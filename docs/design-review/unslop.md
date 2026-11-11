# unslop 도입 기록

확인일: **2026-11-11 KST**. 소유자 지시("unslop skill 도입해")로 화면의 AI 티를 점검하고 걷어 내는 지침을 저장소에 설치했다. 스크립트·참고 이미지·이미지 생성 연결은 설치하지 않았다. 앱 실행 코드와 배포 산출물은 바뀌지 않는다.

## 어느 unslop인가

같은 이름의 스킬이 여러 개 있다. 확인 시점 GitHub 저장소 검색 결과는 다음과 같다. 별 수는 인기 지표로만 본다.

| 후보 | 확인한 내용 | 결정 |
| --- | --- | --- |
| [heydamir/unslop](https://github.com/heydamir/unslop) | 화면(UI)용. 약 13.9k stars, CC BY 4.0, 마지막 푸시 2026-11-08. 점검 → 방향 → 9단계(간격·색·아이콘·문구·글꼴·배치·세부·화면 그림·움직임) | **도입.** 해도의 디자인 작업에 맞고 가장 널리 쓰인다. |
| [theclaymethod/unslop](https://github.com/theclaymethod/unslop) | 글(문장)용. 약 1.0k stars, 라이선스 파일 없음 | 도입하지 않음. 라이선스가 없어 복사할 근거가 없다. |
| [MohamedAbdallah-14/unslop](https://github.com/MohamedAbdallah-14/unslop) | 글용 플러그인. MIT, 약 185 stars | 도입하지 않음. 영어 문장 정리 도구이고 이번 요청 맥락(화면)과 다르다. |
| [mshumer/unslop](https://github.com/mshumer/unslop) | MIT, 약 564 stars, 설명 없음, 마지막 푸시 2026-03 | 도입하지 않음. |
| cursor/plugins의 `unslop` | 웹 검색 결과로만 확인. 저장소를 직접 열어 보지 않음 | 검토하지 않음. |

소유자가 글용 unslop을 뜻했다면 이 기록의 선택을 바꾼다. 그 경우에도 한글 문장을 다루는지와 라이선스를 먼저 확인한다.

## 버전·출처·라이선스

| 항목 | 확인 결과 |
| --- | --- |
| 저장소 | [heydamir/unslop](https://github.com/heydamir/unslop), 만든 사람 Damir Sokolovsky ([@heydamir](https://x.com/heydamir)) |
| 릴리스 | 확인 시점에 GitHub 릴리스와 git 태그가 없다. 버전 번호도 없다 |
| 고정한 커밋 | [`97daa3eb365670ea3f87ed85356cbfcee18105a5`](https://github.com/heydamir/unslop/tree/97daa3eb365670ea3f87ed85356cbfcee18105a5) (main, 2026-11-09T02:16:22+05:00) |
| 저장소 나이 | 첫 커밋 2026-10-28, 커밋 29개. 2주 된 저장소다 |
| 받은 방법 | 공개 저장소를 HTTPS로 `git clone`. 설치한 파일을 체크아웃과 바이트 단위로 대조 |
| 라이선스 | CC BY 4.0. [전문](../../.agents/skills/unslop/LICENSE) 보존. 저작자 표시와 변경 사실 표기가 조건이다 |
| 보안 공개 정보 | 저장소의 [공개 advisory 화면](https://github.com/heydamir/unslop/security/advisories)에 게시된 항목 0개. 포괄적인 취약점 검사를 뜻하지 않는다 |

설치한 파일의 원본 경로·바이트 수·SHA-256·git blob과 설치하지 않은 파일의 해시는 [UPSTREAM.json](../../.agents/skills/unslop/UPSTREAM.json)에 있다.

Impeccable과 다른 점: 고정할 릴리스가 없어 main 커밋을 고정했다. 서명이나 릴리스 자산 해시로 대조할 대상이 없다.

## 설치 범위

- **포함(원본 그대로, 8개):** `SKILL.md`, `references/` 문서 5개(`signs`·`tokens`·`visuals`·`effects`·`refs`), `agents/openai.yaml`, `LICENSE`.
- **해도가 덧붙인 것:** [INSTALLATION.md](../../.agents/skills/unslop/INSTALLATION.md)(적용 범위), `UPSTREAM.json`, Claude 세션용 안내 스킬 [`.claude/skills/unslop/SKILL.md`](../../.claude/skills/unslop/SKILL.md).
- **제외:**
  - `scripts/snapshot.mjs`: Playwright로 라이브 페이지를 저장하고 원격 스타일시트·이미지를 받아 온다.
  - `scripts/story.mjs`: Playwright와 ffmpeg로 스토리 영상을 만든다.
  - `references/refs/*.webp` 5장(약 1.3MB): 랜딩 히어로·영상 참고 이미지다.
  - `examples/`, `test/`, `README.md`, `CITATION.cff`.
- **미변경:** 전역 설정, 사용자 홈 디렉터리, 앱 의존성, 인증·데이터 코드, 배포 파일 목록(`scripts/prepare-site.mjs`는 명시 목록만 배포한다).

### 스크립트와 이미지를 뺀 이유

- 해도의 화면 확인은 이미 익명 샘플을 쓰는 브라우저 검사로 한다. 라이브 페이지 저장 스크립트를 따로 둘 이유가 없고, 로그인한 화면을 저장하면 개인 기록이 파일로 남을 수 있다.
- 스토리 영상은 화면을 SNS에 올릴 때 쓰는 기능이다. 해도의 작업에 필요하지 않다.
- 참고 이미지는 랜딩 히어로와 영상용이다. 앱 화면 점검에는 문서만으로 충분하고, 필요하면 고정 커밋의 원본에서 볼 수 있다. 저장소 이력에 1.3MB 이진 파일을 남기지 않았다.
- 원본 문서의 이미지 링크 5개는 이 저장소에서 열리지 않는다. 원본을 고치지 않는 원칙을 지키려고 그대로 두었다.

## 해도 규칙과 다른 부분

원본 지침을 그대로 따르면 소유자 결정과 어긋나는 부분이 있다. 처리 방법은 [INSTALLATION.md](../../.agents/skills/unslop/INSTALLATION.md)에 단계별로 적었다. 요점은 다음과 같다.

| unslop 원본 | 해도 |
| --- | --- |
| 방향을 새로 쓰고 사용자 답을 기다린다 | 방향은 `PRODUCT.md`·`DESIGN.md`에서 가져온다. 이미 맡긴 작업은 멈추지 않는다 |
| 글꼴 표(Geist·Inter 등)에서 고른다 | Pretendard 유지. 표는 한글을 다루지 않는다 |
| lucide 16~18px, 선 1.5 | 기존 Lucide 1.51.0 부분집합, 선 1.8, 20px·16px 유지 |
| 개수·메타에 고정폭 글꼴 | 따르지 않는다. 2026-11-02 시안 점검에서 뺀 항목이다 |
| 탐색 줄 32~36px | 조작 영역 44px 우선 |
| 영어 문구 규칙(문장형, 끝 마침표) | 뜻만 가져온다. 소유자가 정한 상태 문구는 바꾸지 않는다 |
| 이미지 생성 서비스 연결을 제안 | 연결하지 않는다. 외부 전송·비용은 소유자 승인 사항이다 |
| 스냅샷·스토리 영상 | 스크립트가 없어 실행할 수 없다 |

Impeccable과의 역할 구분: Impeccable은 화면 설계·검토 전반의 기준이고, unslop은 "AI가 만든 티" 목록으로 화면을 훑고 정해진 순서로 다듬는 점검표다. 둘 다 `DESIGN.md`보다 아래에 둔다.

## 첫 정적 신호 (2026-11-11)

지침이 이 저장소에서 쓸 만한지 보려고 `references/signs.md`의 항목 일부를 배포 스타일시트 33개(`assets/*.css`, `assets/life/*.css`)에서 문자열로 세었다. **화면을 보고 내린 판단이 아니며 결함 목록도 아니다.** 실제 점검은 브라우저 화면에서 한다.

| 신호 | 개수 | 위치·메모 |
| --- | --- | --- |
| `transition: all` | 2 | `assets/app.css:57`, `:222` (연표 편집기) |
| 굵기 800~900 | 1 | `assets/app.css:46` (연표 제목, Noto Serif KR 900) |
| 대문자 + 넓은 자간 라벨 | 1 | `assets/app.css:374` |
| 서로 다른 굵기 값 | 11가지 | 650(54회)·600(51)·700(35)·750(28)·550(18)·400(10)·500(9) 등. unslop 기준(400·500, 드물게 600)보다 굵고 가짓수가 많다 |
| 음수 자간 | 63 | 작은 글자에 쓰였는지는 화면에서 확인해야 한다 |
| 그라디언트 | 선형 4, 원형 5 | 색에서 색으로 가는지 같은 중립 안의 단계인지는 화면에서 확인해야 한다 |
| 무한 반복 애니메이션, 그라디언트 글자, 기울임 강조 | 0 | |

눈에 띄는 점은 두 가지다. 신호가 모인 곳은 다른 틀을 쓰는 연표 편집기(`assets/app.css`)다. 그리고 굵기 가짓수가 많다. 한글 화면에서 굵기 400·500이 맞는지는 Pretendard 실제 화면으로 판단할 일이며, 이 숫자만으로 바꾸지 않는다.

## 검증

저장소 루트에서 표준 Python만으로 설치 파일을 기록된 해시와 대조한다. 네트워크를 쓰지 않는다.

```sh
python3 - <<'PYCODE'
import hashlib, json
from pathlib import Path
root = Path('.agents/skills/unslop')
manifest = json.loads((root / 'UPSTREAM.json').read_text())
for entry in manifest['files']:
    data = (root / entry['path']).read_bytes()
    assert len(data) == entry['bytes'], entry['path']
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['path']
print(f"Verified {len(manifest['files'])} upstream files")
PYCODE
```

같은 설치를 다시 만들려면 원본 저장소를 받아 고정 커밋을 체크아웃하고, `UPSTREAM.json`의 `upstream_path`에 적힌 8개 파일만 같은 이름으로 복사한 뒤 위 검증을 돌린다.

## 확인하지 않은 것

- 새 Claude 세션에서 `/unslop`이 목록에 뜨는지. 안내 스킬은 이번 세션 시작 뒤에 만들어졌다.
- Codex에서 `$unslop`이 프로젝트 경로로 발견되는지. 원본 README의 설명만 확인했다.
- 원본 스크립트의 동작. 표면(가져오는 모듈, 원격 요청, ffmpeg 실행)만 읽었고 실행하지 않았다.
- 이 지침으로 실제 화면을 다듬은 결과. 위 정적 신호가 전부다.

## 업데이트

원본에 릴리스가 생기면 릴리스로 고정을 옮긴다. 그때까지는 새 커밋을 자동으로 따라가지 않는다. 올릴 때는 고정 커밋 사이의 diff, 라이선스 변경, 새로 요구하는 실행 파일이나 외부 연결, advisory를 확인하고 `UPSTREAM.json`의 커밋과 해시를 함께 바꾼다. 2주 된 저장소라 내용이 빠르게 바뀔 수 있다. [주간 기술 동향 점검](../life-tools-design/weekly-tech-review.md)에서 변동을 본다.
