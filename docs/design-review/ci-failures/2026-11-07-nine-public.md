# CI 미해결 실패: nine-public-browser 방문자 상태 시간 초과 (2026-11-07)

- 실행: GitHub Actions run 42385120007, job `blog`(128440752469), PR #239 head `6effccb`(main `b78f5dd`와 병합한 ref)
- 판정: 재현 안 됨, 미해결. 변화분은 `taste.html`·`assets/life/nine-public-view.js`와 그 스크립트를 바꾸지 않았다.
- 같은 검사가 통과한 실행: main push `b78f5dd`(run 42381729779), #239 `cf44934`(run 42386437679), #240 `5c485b9`·`de18433`. 로컬 PG16 4/4 통과.
- 관찰: 검사 시작(15:15:36.97) 뒤 `visitor.goto`에 약 17초, 이어 `publicState('published')` 25초 시간 초과. 방문자 화면이 로드 자체부터 느렸다.
- 다시 나오면: CI 산출물 `.local/nine-public`의 방문자 상태 문구(`#ninePublicStatus` data-state), `life_public_page_read` 응답 시각, 서버 로그(`.local/browser-ci/server.log`)를 먼저 본다.

## 로그 발췌

```text
2026-11-07T15:15:29.1727791Z ##[group]Run node tests/nine-public-browser.cjs
2026-11-07T15:15:29.1728331Z node tests/nine-public-browser.cjs
2026-11-07T15:15:29.1747144Z shell: /usr/bin/bash -e {0}
2026-11-07T15:15:29.1747517Z env:
2026-11-07T15:15:29.1747781Z   CI: true
2026-11-07T15:15:29.1748096Z   BASE_URL: http://127.0.0.1:4184
2026-11-07T15:15:29.1748785Z   PW_MODULE_PATH: /home/runner/work/life-haedo/life-haedo/tests/browser-ci/node_modules/playwright
2026-11-07T15:15:29.1749725Z   CHROMIUM_PATH: /home/runner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome
2026-11-07T15:15:29.1750347Z   HAEDO_CI_SERVER_PID: 3124
2026-11-07T15:15:29.1750822Z   BLOG_POSTGRES_CONTAINER: haedo-blog-postgres-17940643019013128
2026-11-07T15:15:29.1751342Z   BLOG_POSTGRES_DATABASE: haedo_blog_qa_ci
2026-11-07T15:15:29.1751740Z ##[endgroup]
2026-11-07T15:15:33.7005440Z START A selected saved area is fully reviewed without private metadata, then explicitly published with exact lost-response receipt replay
2026-11-07T15:15:36.9693894Z PASS A selected saved area is fully reviewed without private metadata, then explicitly published with exact lost-response receipt replay
2026-11-07T15:15:36.9694933Z START An anonymous visitor reads all nine ordered items, full details and explicit source without opening personal storage or external media automatically
2026-11-07T15:16:19.1147988Z page.waitForFunction: Timeout 25000ms exceeded.
2026-11-07T15:16:19.1148840Z     at publicState (/home/runner/work/life-haedo/life-haedo/tests/nine-public-browser.cjs:70:40)
2026-11-07T15:16:19.1149698Z     at /home/runner/work/life-haedo/life-haedo/tests/nine-public-browser.cjs:205:44
2026-11-07T15:16:19.1150640Z     at async check (/home/runner/work/life-haedo/life-haedo/tests/nine-public-browser.cjs:120:11)
2026-11-07T15:16:19.1151520Z     at async main (/home/runner/work/life-haedo/life-haedo/tests/nine-public-browser.cjs:204:5)
2026-11-07T15:16:19.1276554Z ##[error]Process completed with exit code 1.
2026-11-07T15:16:19.1322027Z ##[group]Run BLOG_POSTGRES_DATABASE="${BLOG_POSTGRES_DATABASE}_material" node tests/material-writing-browser.cjs --prepare-database
```
