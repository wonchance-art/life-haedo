# 원문 자동 병합 검사의 이전 판 고정본

원문 자동 병합이 들어가기 직전 판(main `a4237731833b4b2669ead4a99fc5135ec46f21a3`, 줄여서 `a423773`)을 검사에서 쓰기 위한 고정본이다. 검사는 Git 기록·네트워크 없이 이 파일들만 읽는다(CI는 커밋 하나만 받는다). 익명 표본 글만 들어 있다.

## `a423773/*.js.gz` — 그 커밋의 앱 파일

`assets/life/<이름>`의 전체 원본을 수정 없이 gzip으로 압축한 것이다. 원본 파일과 같은 라이선스다. 배포물에는 들어가지 않는다(`scripts/prepare-site.mjs`는 `tests/`를 복사하지 않는다).

| 원본 경로 (`a423773`) | 고정본 | 바이트 | SHA-256 |
|---|---|---:|---|
| `assets/life/account-library.js` | `a423773/account-library.js.gz` | 23,863 | `11b0b3c7e2a7d177e38664d2f501dbd5e5c60782aa113e995d1b281044d65d1e` |
| `assets/life/composition-sync.js` | `a423773/composition-sync.js.gz` | 21,831 | `7eb62a98d237099037d1e90c7d90cd139d8df3a55052336ab843e41293e0698f` |
| `assets/life/storage.js` | `a423773/storage.js.gz` | 468,583 | `6436add886ac555043a4f81fc0bfa31fe4ea5f763fcf2468e9d2709c3f76ace5` |
| `assets/life/sync-common.js` | `a423773/sync-common.js.gz` | 1,331 | `5519260cefbecc9efbc2796c74e97c48ac9d37fd6c96c27cb505c49d002e754b` |
| `assets/life/sync.js` | `a423773/sync.js.gz` | 32,443 | `840c256be98315b0a84a8a4dd091b50c6b6f9b2af45213a46e003f962a68bf08` |
| `assets/life/sync-lifecycle.js` | `a423773/sync-lifecycle.js.gz` | 2,121 | `f27e00439c2a877f5b8441a5215d05f0b78c7978fb54ec0e4767bd36a39165c2` |
| `assets/life/ui.js` | `a423773/ui.js.gz` | 434,285 | `235222e5c20e139cd78997d78a91c221d781139aea0ce90f28d3245425e2da29` |
| `assets/life/writing-sync.js` | `a423773/writing-sync.js.gz` | 19,264 | `0fe00d2d2cb27d79208d3e61a98cd6329fec9c3de5817e5c9550a8539aeb2f43` |

- 병합 작업이 바꾼 파일 일곱 개와, 엔진이 함께 읽는 `sync-lifecycle.js`다. 나머지 모듈과 `index.html`은 이 고정본을 만들 때 그 커밋과 같았다.
- 읽는 곳은 `tests/helpers/previous-version.cjs` 하나다. 읽을 때마다 압축을 푼 바이트의 길이와 SHA-256을 위 값(도우미의 상수)과 대조한다. `tests/source-merge-devices.test.cjs`가 여덟 파일을 모두 읽어 고정한다.
- 쓰는 검사
  - `tests/source-merge-browser.cjs`: 한 기기에 이 파일들을 서빙해 실제 이전 판으로 자료를 갈라뜨린 뒤 새 판으로 연다. 수동 비교 검사는 `sync-common.js`만 이전 것으로 서빙한다.
  - `tests/life-sync-browser.cjs`, `tests/life-management-browser.cjs`: 수동 비교 화면 검사에서 `sync-common.js`만 이전 것으로 서빙한다.
  - `tests/source-merge-devices.test.cjs`: 이전 `sync-common.js`를 쓰는 페이지(새 모듈과 섞인 캐시).
- 한계: 브라우저 검사는 이 여덟 파일만 이전 판이고 나머지는 현재 판이다. 다른 모듈이 크게 바뀌어 이전 `storage.js`·`ui.js`와 맞지 않게 되면 그 브라우저 검사는 접고, 아래 기기 DB 고정본 검사를 남긴다.

재생성(저장소 루트, Python 3, 전체 Git 기록 필요):

```python
import gzip, hashlib, pathlib, subprocess
commit = 'a4237731833b4b2669ead4a99fc5135ec46f21a3'
for name in ['account-library', 'composition-sync', 'storage', 'sync-common', 'sync', 'sync-lifecycle', 'ui', 'writing-sync']:
    raw = subprocess.check_output(['git', 'show', commit + ':assets/life/' + name + '.js'])
    print(name, len(raw), hashlib.sha256(raw).hexdigest())
    pathlib.Path('tests/fixtures/source-merge/a423773/' + name + '.js.gz').write_bytes(gzip.compress(raw, mtime=0))
```

## `previous-version-device.json` — 이전 판이 쓴 기기 DB

이전 판의 `storage.js`·`sync.js`를 실제로 돌려, 자료를 바꾼 뒤 충돌을 기록하고 멈춘 기기의 IndexedDB 내용(동기화 기록, 저장 영수증 포함)과 그때의 서버 행을 담았다. `tests/source-merge-devices.test.cjs`가 새 판으로 열어 병합 결과를 대조한다. 경우는 다음과 같다.

- `apart`: 두 기기가 서로 다른 발췌만 바꿨다.
- `mixed`: 같은 발췌 수정, 삭제, 추가가 섞였다.
- `same-number-*` 넷: 두 기기가 같은 항목을 같은 번호에서 고쳤다(서버에 "같은 번호, 다른 내용"). 다시 고침, 다시 고친 뒤 삭제, 삭제만, 자료 제목. 이 넷에서 Mac은 현재 판으로 돌려 서버 묶음을 만들고, 고정본에는 이전 판 iPad의 DB와 그 서버 묶음이 들어간다.

다시 만들기(Git 기록 불필요, 식별자와 시각은 매번 새로 생긴다):

```
node tests/fixtures/source-merge/make-previous-version-device.cjs
```
