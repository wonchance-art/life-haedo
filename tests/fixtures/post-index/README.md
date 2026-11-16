# 글 목록 재구성 검사의 이전 판 고정본

글마다 목록 행을 두기 직전 판(main `c76e693af8208ab7ca5576d05c66a5ffbef600ed`, 앱 판 `haedo-v220`)을 검사에서 쓰기 위한 고정본이다. 검사는 Git 기록·네트워크 없이 이 파일들만 읽는다(CI는 커밋 하나만 받는다). 개인 자료는 들어 있지 않다.

## `c76e693/*.js.gz` — 그 커밋의 앱 파일

`assets/life/<이름>`의 전체 원본을 수정 없이 gzip으로 압축한 것이다. 원본 파일과 같은 라이선스다. 배포물에는 들어가지 않는다(`scripts/prepare-site.mjs`는 `tests/`를 복사하지 않는다).

| 원본 경로 (`c76e693`) | 고정본 | 바이트 | SHA-256 |
|---|---|---:|---|
| `assets/life/storage.js` | `c76e693/storage.js.gz` | 511,856 | `78ff0bd9769b1b1c100a20be1171707764e70ae9fc9468245cd7e30a0aafa6b9` |
| `assets/life/home.js` | `c76e693/home.js.gz` | 59,766 | `be262673ac5d3112bec63c1f8e3c35203e3441c225e90e6497285e032faff494` |
| `assets/life/schedule-ui.js` | `c76e693/schedule-ui.js.gz` | 52,417 | `a99355cccbafdc63427d8b46d9cec4b67485093fa8fb5b0f79766f50af807e1a` |

- 글 목록 작업이 바꾼 앱 파일 세 개다. 나머지 모듈은 이 고정본을 만들 때 그 커밋과 같았다.
- 읽는 곳은 `tests/helpers/post-index-previous.cjs` 하나다. 읽을 때마다 압축을 푼 바이트의 길이와 SHA-256을 위 값(도우미의 상수)과 대조한다.
- 쓰는 검사
  - `tests/post-index.test.cjs`: 이전 판 `storage.js`를 Node에서 같은 기기 DB에 열어, 새 판이 쓴 목록을 이전 판이 빠짐없이 읽는지, 이전 판이 쓴 글을 새 판이 다시 읽는지 본다.
  - `tests/post-limit-notice-browser.cjs`: 한 탭에 세 파일을 이전 판으로 서빙해(이전 판 탭) 200개가 넘는 계정을 연다.
- 한계: 브라우저 검사는 이 세 파일만 이전 판이고 나머지는 현재 판이다. 다른 모듈이 크게 바뀌어 이전 파일과 맞지 않게 되면 그 브라우저 검사는 접고 Node 검사를 남긴다. 다음 판에서 이전 판 호환용 전체 목록 행을 없앨 때 이 고정본과 검사도 함께 정리한다.

재생성(저장소 루트, Python 3, 전체 Git 기록 필요):

```python
import gzip, hashlib, pathlib, subprocess
commit = 'c76e693af8208ab7ca5576d05c66a5ffbef600ed'
for name in ['storage', 'home', 'schedule-ui']:
    raw = subprocess.check_output(['git', 'show', commit + ':assets/life/' + name + '.js'])
    print(name, len(raw), hashlib.sha256(raw).hexdigest())
    pathlib.Path('tests/fixtures/post-index/c76e693/' + name + '.js.gz').write_bytes(gzip.compress(raw, mtime=0))
```
