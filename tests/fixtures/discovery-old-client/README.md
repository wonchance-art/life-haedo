# 뉴스 공개 목록 — 이전 판 화면 고정본

커밋 `c767df3`(2026-11-11 카드 피드 작업의 기준)의 **고치지 않은** 뉴스 화면 파일이다. gzip은 저장 용량만 줄인다. 저장소의 원본 파일과 같은 라이선스를 따른다.

| 고정본 | 원본 | 바이트 | SHA-256(압축을 푼 원문) |
| --- | --- | --- | --- |
| `discovery.js.gz` | `assets/life/discovery.js` | 24,208 | `ee284b29696fc6fdaadf8efc63cd2ebf4305030514411150e009fa2321ff234b` |
| `discovery-ui.js.gz` | `assets/life/discovery-ui.js` | 139,185 | `a03cd2f1bab7f63585897f0d121a386cc6468a3b678e239b4f0192d877b5870b` |
| `discovery.css.gz` | `assets/life/discovery.css` | 46,408 | `07a0fa3d5f27e2a418fa82e692bc8d76a8e26705168b6a6b054238eb61013127` |
| `discovery-settings.js.gz` | `assets/life/discovery-settings.js` | 5,006 | `f6d8f710d848b15ec4b9fa4f7df2b5e295fcac5a2d1b05aee4737110606708bc` |

서비스워커가 새 셸로 바뀌기 전까지 열려 있는 화면은 이 판의 검증기로 새 공개 목록을 읽는다. 이 판은 `sources`에 모르는 출처 ID가 하나라도 있으면 목록 전체를 거절한다. 그래서 공개 목록은 첫 등록부(9곳)를 `sources`·`articles`에 그대로 두고, 그 뒤에 더한 출처는 이 판이 읽지 않는 `extended`에 싣는다.

- `tests/discovery-card-feed.test.cjs`: 이 판의 `discovery.js`만 실행해 새 형식의 목록을 받아도 첫 등록부 9곳의 글을 그대로 돌려주는 것을 확인한다.
- `tests/news-card-feed-browser.cjs`: 카드 피드 작업이 고친 네 파일을 이 판으로 바꿔 띄운 화면(나머지 셸 파일은 이 작업이 바꾸지 않았다)이 새 형식의 목록을 받아도 글 목록을 보여 주는 것을 확인한다.

두 검사는 Git 기록이나 네트워크를 쓰지 않는다.

재생성(저장소 루트, 파일마다):

```sh
git show c767df3:assets/life/discovery.js | gzip -n -9 > tests/fixtures/discovery-old-client/discovery.js.gz
```
