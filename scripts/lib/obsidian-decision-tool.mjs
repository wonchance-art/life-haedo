import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../../", import.meta.url);
export async function renderDecisionTool() {
  const sources = [];
  for (const path of ["assets/life/core.js", "vendor/fflate/fflate.js", "scripts/lib/obsidian-decisions.js", "scripts/lib/obsidian-decision-ui.js"]) {
    const license = path === "vendor/fflate/fflate.js" ? "/*\n" + await readFile(new URL("vendor/fflate/LICENSE", root), "utf8") + "\n*/\n" : "";
    sources.push((license + await readFile(new URL(path, root), "utf8")).replace(/<\/script/gi, "<\\/script"));
  }
  const css = await readFile(new URL("scripts/lib/obsidian-decision-tool.css", root), "utf8");
  const hash = (s) => "'sha256-" + createHash("sha256").update(s).digest("base64") + "'";
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${sources.map(hash).join(" ")}; style-src ${hash(css)}; base-uri 'none'; form-action 'none'"><title>노트 연결 선택</title><style>${css}</style></head>
<body><main><header><h1>노트 연결 선택</h1><p>원문을 대조하고 필요한 연결만 새 비공개 사본에 담습니다.</p></header>
<section aria-labelledby="files-title"><h2 id="files-title">가져온 파일</h2><details id="package-panel" open><summary>파일 선택·바꾸기</summary><p>같은 변환 폴더의 아래 6개 파일을 함께 선택하세요. 파일은 이 화면에서만 읽습니다.</p><details><summary>선택할 파일과 보관 범위</summary><p>notes.json · supporting-files.json · private-audit.json · review.json · review.html · repository.bundle</p><p>이전에 선택을 반영한 폴더라면 applications.json도 함께 고르세요. 새 ZIP에는 원본 감사·보고서·보조 파일·Git 이력과 선택/반영 이력을 보관합니다. 원래 폴더와 로그인한 작업공간은 바뀌지 않습니다.</p></details><label for="package-files">변환 파일 선택</label><input id="package-files" type="file" multiple accept=".json,.html,.bundle"></details><p id="package-summary" class="meta"></p></section>
<p id="status" role="status" aria-live="polite"></p>
<div id="workspace" hidden><section id="review-section" aria-labelledby="review-title"><h2 id="review-title">연결 대조</h2><div class="selectors"><div><label for="group">검토할 묶음</label><select id="group"></select></div><div><label for="occurrence">참조한 노트</label><select id="occurrence"></select></div></div>
<div class="comparison"><section aria-labelledby="origin-title"><h3 id="origin-title">참조 원문</h3><p id="origin-path" class="meta"></p><p id="original-target"></p><pre id="origin-excerpt"></pre><details id="origin-full"><summary>원문 전체 읽기</summary><pre></pre></details></section>
<section aria-labelledby="candidate-title"><h3 id="candidate-title">연결할 노트</h3><label for="candidate">후보 경로</label><select id="candidate"></select><p id="no-candidate" class="meta" hidden>확인된 후보가 없습니다. 원본 링크와 경로를 확인할 때까지 보류합니다.</p><label for="anchor">이동할 위치</label><select id="anchor"></select><pre id="candidate-excerpt"></pre><details id="candidate-full"><summary>후보 전체 읽기</summary><pre></pre></details></section></div>
<div class="actions"><button id="choose">이 참조 선택</button><button id="defer" class="secondary">이 참조 보류</button></div><p class="meta">같은 묶음의 다른 참조는 따로 선택합니다. 제목·블록을 가리킨 링크는 위치까지 확인해야 합니다.</p></section>
<section aria-labelledby="selection-title"><h2 id="selection-title">선택한 연결</h2><p id="selection-summary"></p><div class="actions"><button id="save-selections" class="secondary">선택 파일 내려받기</button><button id="preview">변경 미리보기</button></div><label for="decisions-file">저장한 선택 파일 열기</label><input id="decisions-file" type="file" accept=".json"><details id="chosen-details"><summary>선택 목록 보기</summary><ul id="chosen-list"></ul></details></section>
<section id="preview-section" aria-labelledby="preview-title" hidden><h2 id="preview-title" tabindex="-1">변경 미리보기</h2><p id="preview-summary"></p><ul id="preview-list"></ul><p>새 사본은 처음 가져온 패키지를 기준으로 만듭니다. 이미 앱에 복원한 뒤 편집한 내용과 합치지 않습니다. 미선택 참조와 원래 감사 기록은 그대로 남습니다.</p><button id="export">새 사본 ZIP 내려받기</button><details><summary>다시 열기와 복원</summary><p>ZIP을 새 폴더에 풀고 notes.json을 해도의 관리 → 내보내기·사본 복원에서 새 작업공간으로 복원하세요. supporting-files.json은 보조 파일의 별도 작업공간입니다. 기존 작업공간은 유지합니다.</p><p>다음 검토는 ZIP 안의 변환 파일과 applications.json을 함께 선택하세요. 브라우저 다운로드/ZIP 해제 위치의 파일 권한은 운영체제에서 확인하세요. 원본 패키지도 계속 보관하세요.</p></details></section></div>
<footer><p>네트워크 요청·자동 공개·원본 저장소 쓰기 없이 동작합니다. 창을 닫기 전에 선택 파일이나 새 ZIP을 보관하세요.</p><p class="meta">ZIP: fflate 0.8.3 (MIT). 데이터 검증: 해도 Core. 실제 Apple Files 체험은 별도 확인 대상입니다.</p></footer></main>${sources.map((s) => `<script>${s}</script>`).join("")}</body></html>`;
}
