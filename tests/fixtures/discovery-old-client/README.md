# 뉴스 공개 목록 — 이전 판 화면 고정본

커밋 `c767df3`(2026-11-11 카드 피드 작업의 기준)의 **고치지 않은** 뉴스 화면 파일이다. gzip은 저장 용량만 줄인다. 저장소의 원본 파일과 같은 라이선스를 따른다.

| 고정본 | 원본 | 바이트 | SHA-256(압축을 푼 원문) |
| --- | --- | --- | --- |
| `discovery.js.gz` | `assets/life/discovery.js` | 24,208 | `ee284b29696fc6fdaadf8efc63cd2ebf4305030514411150e009fa2321ff234b` |
| `discovery-ui.js.gz` | `assets/life/discovery-ui.js` | 139,185 | `a03cd2f1bab7f63585897f0d121a386cc6468a3b678e239b4f0192d877b5870b` |
| `discovery.css.gz` | `assets/life/discovery.css` | 46,408 | `07a0fa3d5f27e2a418fa82e692bc8d76a8e26705168b6a6b054238eb61013127` |
| `discovery-settings.js.gz` | `assets/life/discovery-settings.js` | 5,006 | `f6d8f710d848b15ec4b9fa4f7df2b5e295fcac5a2d1b05aee4737110606708bc` |
| `storage.js.gz` | `assets/life/storage.js` | 468,583 | `6436add886ac555043a4f81fc0bfa31fe4ea5f763fcf2468e9d2709c3f76ace5` |
| `account-docs-sync.js.gz` | `assets/life/account-docs-sync.js` | 25,088 | `2ecc53d98add9a566f9da5148299d1720e7ff0d4daecd2066f5fab6f9bf51e00` |
| `full-backup.js.gz` | `assets/life/full-backup.js` | 80,496 | `8c0e5d698686466ba707c64e225e11af320c2c285c0ecbfa793475609c4828a4` |
| `discovery-actions.js.gz` | `assets/life/discovery-actions.js` | 11,240 | `cbae40cdaf96f221f2d160f126b6a5b31174fbb748117f4544b374aa3e1497d9` |
| `discovery-reading.js.gz` | `assets/life/discovery-reading.js` | 26,250 | `8b6c18f69c752ed971ffdd1d578ccd7d7927ba97dcee0906b5582469ff548028` |

아래 다섯 파일은 2026-11-11 검수 MAJOR-1(반응·읽기 비교를 두 계정 문서로 나눔)에서 더했다. 이 작업이 저장소·계정 동기화·백업·반응·읽기 비교 모델도 고쳤으므로, "이전 셸 기기"는 이 파일들까지 기준 커밋 그대로여야 이전 판과 같다.

서비스워커가 새 셸로 바뀌기 전까지 열려 있는 화면은 이 판의 검증기로 새 공개 목록을 읽는다. 이 판은 `sources`에 모르는 출처 ID가 하나라도 있으면 목록 전체를 거절한다. 그래서 공개 목록은 첫 등록부(9곳)를 `sources`·`articles`에 그대로 두고, 그 뒤에 더한 출처는 이 판이 읽지 않는 `extended`에 싣는다.

- `tests/discovery-card-feed.test.cjs`: 이 판의 `discovery.js`만 실행해 새 형식의 목록을 받아도 첫 등록부 9곳의 글을 그대로 돌려주는 것을 확인한다.
- `tests/news-card-feed-browser.cjs`: 카드 피드 작업이 고친 네 파일을 이 판으로 바꿔 띄운 화면(나머지 셸 파일은 이 작업이 바꾸지 않았다)이 새 형식의 목록을 받아도 글 목록을 보여 주는 것을 확인한다.

- `tests/news-old-shell-sync-browser.cjs`: 위 아홉 파일로 띄운 "이전 셸 기기"가 새 판 기기의 계정 문서(뉴스 설정의 예약 항목 옵션, 추가 출처·넓게 찾기 링크의 반응, 출처 20곳을 넘는 읽기 비교)를 받았을 때 뉴스가 열리는지, 그 기기가 반응을 남긴 뒤에도 새 판 기기의 반응이 계정과 새 판 화면에 남는지를 실제 동기화로 확인한다. `discovery-settings.js.gz`는 이전 판 설정 검증기다(모르는 필드는 거절, `disabledSourceIds`의 모르는 ID는 지킴). 이전 판 `storage.js`는 모르는 계정 문서 종류(`discoveryActionsExtended` 등)를 나열하지도 받지도 않는다(`account_doc_invalid_key` → 무시, 검사가 그 기기의 문서 종류·스키마 5를 단언).
- `tests/discovery-account-pair.test.cjs`: 이전 판 `discovery.js`·`discovery-actions.js`·`discovery-reading.js`를 자기 realm에서 돌려, 새 판이 쓰는 `discoveryActions`·`discoveryReading`이 언제나 그 검증기를 통과하는지 확인한다.

나머지 셸 파일(예: `index.html`이 새로 싣는 `discovery-wide-remote.js`)은 현재 판 그대로다. 이전 판 화면은 그 파일을 쓰지 않는다.

네 검사는 Git 기록이나 네트워크를 쓰지 않는다.

재생성(저장소 루트, 파일마다):

```sh
git show c767df3:assets/life/discovery.js | gzip -n -9 > tests/fixtures/discovery-old-client/discovery.js.gz
```
