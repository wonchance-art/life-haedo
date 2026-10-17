/* Standalone private-file UI. No fetch, storage, HTML injection or account access. */
(function () {
  "use strict";
  const D = globalThis.ObsidianDecisions, $ = (id) => document.getElementById(id);
  const required = ["notes.json", "supporting-files.json", "private-audit.json", "review.json", "review.html", "repository.bundle"];
  let handle = null, files = new Map(), selections = new Map(), preview = null, busy = false, dirty = false, applicationHistory = [];
  const urls = new Set();
  const text = (id, value) => { $(id).textContent = value; };
  const status = (message, error = false) => { text("status", message); $("status").classList.toggle("error", error); };
  const messages = {
    stale_decisions: "선택 파일이 현재 원본과 다릅니다. 같은 변환 폴더의 파일을 열어 주세요.",
    unknown_candidate: "선택 파일에 확인되지 않은 후보가 있습니다. 원문과 후보를 다시 선택해 주세요.",
    invalid_target_locator: "후보의 제목·블록 위치가 달라졌습니다. 위치를 다시 골라 주세요.",
    target_locator_required: "제목·블록 위치까지 골라 주세요.",
    conflicting_link: "이미 다른 연결이 있습니다. 새 사본의 연결을 확인해 주세요.",
    duplicate_decision: "같은 참조가 선택 파일에 중복되어 있습니다. 파일을 확인해 주세요.",
  };
  function error(e) { status(messages[e.code] || "파일을 확인할 수 없습니다. 같은 변환 폴더의 파일과 원본 백업을 다시 확인해 주세요. 기존 선택은 유지합니다.", true); }
  function option(select, value, label) { const o = document.createElement("option"); o.value = value; o.textContent = label; select.append(o); }
  function current() { return handle?.items.find((i) => i.id === $("occurrence").value); }
  function lock(value) {
    busy = value;
    for (const element of document.querySelectorAll("button,input,select")) element.disabled = value;
    if (!value) availability();
  }
  function availability() {
    if (busy || !handle) return;
    $("export").disabled = !preview;
    $("save-selections").disabled = !selections.size;
    $("preview").disabled = !selections.size;
    const item = current();
    $("defer").disabled = !item || !selections.has(item.id);
    $("candidate").disabled = !item?.candidatePaths.length;
    $("anchor").disabled = !$("candidate").value;
    $("choose").disabled = !item || !$("candidate").value || ((item.target.includes("#") || item.reason === "anchor_missing") && !$("anchor").value);
  }
  function invalidate() { preview = null; $("preview-section").hidden = true; availability(); }
  function selectionList() {
    text("selection-summary", `${selections.size}회 선택 · ${handle.items.length - selections.size}회 보류 · 보관 정보 ${handle.informationalOccurrences}회 유지`);
    const list = $("chosen-list"); list.replaceChildren();
    for (const selection of selections.values()) {
      const item = handle.items.find((i) => i.id === selection.id), li = document.createElement("li");
      li.textContent = `${item.path}의 ${item.target} → ${selection.targetPath}${selection.targetLocator ? " · " + selection.targetLocator.text : " · 문서 시작"}`;
      list.append(li);
    }
    availability();
  }
  function showCandidate() {
    const path = $("candidate").value, anchor = $("anchor"); anchor.replaceChildren();
    option(anchor, "", current()?.target.includes("#") || current()?.reason === "anchor_missing" ? "제목·블록 선택" : "문서 시작");
    text("candidate-excerpt", ""); $("candidate-full").querySelector("pre").textContent = ""; $("candidate-full").open = false;
    if (path) {
      const target = D.targetInfo(handle, path);
      for (const [index, a] of target.anchors.entries()) option(anchor, String(index + 1), a.text);
      text("candidate-excerpt", target.text.slice(0, 1200) || "빈 원본 파일입니다.");
    }
    availability();
  }
  function showTargetExcerpt() {
    const path = $("candidate").value, value = $("anchor").value;
    if (!path) return;
    const target = D.targetInfo(handle, path), anchor = value && target.anchors[Number(value) - 1];
    if (!anchor) { text("candidate-excerpt", target.text.slice(0, 1200) || "빈 원본 파일입니다."); return; }
    const mark = document.createElement("mark"); mark.textContent = anchor.text;
    $("candidate-excerpt").replaceChildren(document.createTextNode(target.text.slice(Math.max(0, anchor.start - 200), anchor.start)), mark, document.createTextNode(target.text.slice(anchor.end, anchor.end + 300)));
  }
  function showOccurrence() {
    const item = current(), select = $("candidate"); select.replaceChildren();
    option(select, "", "연결할 노트 선택");
    for (const path of item.candidatePaths) option(select, path, path);
    text("origin-path", item.path); text("original-target", "원래 링크: " + item.target);
    const origin = D.targetInfo(handle, item.path).text, start = Math.max(0, item.locator.start - 200), end = item.locator.end + 200;
    const mark = document.createElement("mark"); mark.textContent = item.token;
    $("origin-excerpt").replaceChildren(document.createTextNode(origin.slice(start, item.locator.start)), mark, document.createTextNode(origin.slice(item.locator.end, end)));
    $("origin-full").open = false; $("origin-full").querySelector("pre").textContent = "";
    $("no-candidate").hidden = !!item.candidatePaths.length;
    const selection = selections.get(item.id);
    if (selection) select.value = selection.targetPath;
    showCandidate();
    if (selection?.targetLocator) {
      const index = D.targetInfo(handle, selection.targetPath).anchors.findIndex((a) => a.start === selection.targetLocator.start && a.end === selection.targetLocator.end);
      $("anchor").value = String(index + 1);
    }
    showTargetExcerpt();
    availability();
  }
  function showGroup() {
    const group = handle.groups.find((g) => g.id === $("group").value), select = $("occurrence"); select.replaceChildren();
    for (const [index, id] of group.ids.entries()) { const item = handle.items.find((i) => i.id === id); option(select, id, `${item.path} · 참조 ${index + 1}`); }
    showOccurrence();
  }
  function decisions() { return D.makeDecisions(handle, [...selections.values()]); }
  function download(name, blob) {
    const url = URL.createObjectURL(blob), a = document.createElement("a"); urls.add(url);
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000);
  }
  function jsonBlob(value) { return new Blob([JSON.stringify(value)], { type: "application/json" }); }
  async function openFiles(event) {
    let chosen = [...event.target.files]; event.target.value = "";
    if (!chosen.length || (dirty && !confirm("기존 선택을 교체합니다. 선택 파일이나 ZIP을 보관했는지 확인하세요."))) return;
    lock(true); status("파일과 원문 해시를 확인하고 있습니다…");
    try {
      if (chosen.length === 1 && /\.zip$/i.test(chosen[0].name)) {
        const { unpacked } = await globalThis.HaedoLife.ObsidianPackage.unpack(chosen[0], { keepArchive: true });
        chosen = Object.entries(unpacked).map(([name, bytes]) => new File([bytes], name));
      }
      const next = new Map(); let bytes = 0;
      for (const file of chosen) {
        bytes += file.size;
        if (next.has(file.name) || file.size > 64 * 1024 * 1024 || bytes > 256 * 1024 * 1024) throw new Error("invalid_files");
        if ([...required, "applications.json", "decisions.json"].includes(file.name)) next.set(file.name, file);
      }
      if (required.some((name) => !next.has(name))) throw new Error("required_files");
      const nextHistory = next.has("applications.json") ? JSON.parse(await next.get("applications.json").text()) : [];
      if (!Array.isArray(nextHistory)) throw new Error("invalid_history");
      const opened = await D.openPackage({ notes: await next.get("notes.json").text(), supporting: await next.get("supporting-files.json").text(),
        audit: await next.get("private-audit.json").text(), review: await next.get("review.json").text() });
      // Commit only after every selected input has passed; a failed replacement keeps old work.
      handle = opened; files = next; applicationHistory = nextHistory; selections = new Map(); dirty = false; preview = null;
      const group = $("group"); group.replaceChildren();
      for (const g of handle.groups) option(group, g.id, `${g.target} · ${g.ids.length}회`);
      $("workspace").hidden = false; $("preview-section").hidden = true;
      $("review-section").hidden = !handle.groups.length; $("package-panel").open = false;
      text("package-summary", `변환 파일 6개 확인 · ${handle.groups.length}묶음 · ${handle.items.length}회 검토 · 보관 정보 ${handle.informationalOccurrences}회`);
      if (handle.groups.length) showGroup();
      else { $("occurrence").replaceChildren(); $("candidate").replaceChildren(); $("anchor").replaceChildren(); }
      selectionList(); status(handle.groups.length ? "원문 확인을 마쳤습니다. 연결할 참조와 후보를 선택하세요." : "원문 확인을 마쳤습니다. 검토할 노트 연결이 없습니다. 기존 파일을 그대로 보관하세요.");
    } catch (e) { error(e); }
    finally { lock(false); }
  }
  $("package-files").addEventListener("change", openFiles);
  $("group").addEventListener("change", showGroup);
  $("occurrence").addEventListener("change", showOccurrence);
  $("candidate").addEventListener("change", showCandidate);
  $("anchor").addEventListener("change", () => { showTargetExcerpt(); availability(); });
  $("origin-full").addEventListener("toggle", () => { if ($("origin-full").open) $("origin-full").querySelector("pre").textContent = D.targetInfo(handle, current().path).text; });
  $("candidate-full").addEventListener("toggle", () => { if ($("candidate-full").open && $("candidate").value) $("candidate-full").querySelector("pre").textContent = D.targetInfo(handle, $("candidate").value).text; });
  $("choose").addEventListener("click", () => {
    try {
      const item = current(), path = $("candidate").value, value = $("anchor").value;
      const selection = { id: item.id, targetPath: path, targetLocator: value ? D.targetInfo(handle, path).anchors[Number(value) - 1] : null };
      D.preview(handle, D.makeDecisions(handle, [selection]));
      selections.set(item.id, selection); dirty = true; invalidate(); selectionList(); status("이 참조를 선택 목록에 담았습니다. 아직 새 사본을 만들지 않았습니다.");
    } catch (e) { error(e); }
  });
  $("defer").addEventListener("click", () => { selections.delete(current().id); dirty = true; invalidate(); selectionList(); showOccurrence(); status("이 참조는 보류합니다. 원래 연결과 감사 기록은 유지합니다."); });
  $("save-selections").addEventListener("click", () => {
    try { download("decisions.json", jsonBlob(D.validateDecisions(handle, decisions()))); status("선택 파일 다운로드를 요청했습니다. 보관한 파일을 다시 열어 확인할 수 있습니다."); }
    catch (e) { error(e); }
  });
  $("decisions-file").addEventListener("change", async (event) => {
    const file = event.target.files[0]; event.target.value = ""; if (!file) return;
    if (dirty && !confirm("현재 선택을 파일의 선택 목록으로 교체할까요?")) return;
    lock(true);
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("file_too_large");
      const result = D.preview(handle, JSON.parse(await file.text()));
      const next = new Map();
      for (const d of result.decisions.decisions) next.set(d.occurrenceId, { id: d.occurrenceId, targetPath: d.targetPath, targetLocator: d.targetLocator });
      selections = next; dirty = true; invalidate(); selectionList(); if (handle.groups.length) showOccurrence(); status("선택 파일을 확인했습니다. 변경 미리보기에서 반영 범위를 확인하세요.");
    } catch (e) { error(e); } finally { lock(false); }
  });
  $("preview").addEventListener("click", () => {
    try {
      preview = D.preview(handle, decisions()); const s = preview.summary;
      text("preview-summary", `연결 추가 ${s.added}회 · 위치 보완 ${s.located}회 · 이미 반영 ${s.unchanged}회 · 보류 ${s.deferred}회 · 보관 정보 ${s.informational}회 유지`);
      $("preview-list").replaceChildren();
      for (const c of preview.changes) { const li = document.createElement("li"); li.textContent = `${c.path} → ${c.targetPath}${c.targetLocator ? " · " + c.targetLocator.text : " · 문서 시작"}`; $("preview-list").append(li); }
      $("preview-section").hidden = false; availability(); $("preview-title").focus(); status("선택한 연결만 반영합니다. 새 사본을 내려받아 확인하세요.");
    } catch (e) { error(e); }
  });
  $("export").addEventListener("click", async () => {
    if (!preview) return;
    const chosen = preview.decisions; lock(true); status("새 사본을 검증하고 ZIP으로 만들고 있습니다…");
    try {
      const applied = await D.apply(handle, chosen), output = {};
      for (const name of required) output[name] = new Uint8Array(await files.get(name).arrayBuffer());
      const encode = (v) => new TextEncoder().encode(JSON.stringify(v));
      output["notes.json"] = encode(applied.notesBackup); output["decisions.json"] = encode(applied.decisions);
      output["applications.json"] = encode([...applicationHistory, applied.history]);
      download("obsidian-selected-copy.zip", new Blob([globalThis.fflate.zipSync(output, { level: 0 })], { type: "application/zip" }));
      status("새 사본 ZIP 다운로드를 요청했습니다. 해도의 관리 → 내보내기·사본 복원으로 이동해 ‘Obsidian 패키지에서 복원’에 ZIP을 선택하세요.");
    } catch (e) {
      if (messages[e.code]) error(e);
      else status("새 ZIP을 만들지 못했습니다. 선택은 그대로입니다. 선택 파일을 보관한 뒤 다시 시도하세요.", true);
    } finally { lock(false); }
  });
  window.addEventListener("beforeunload", (event) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } });
  window.addEventListener("pagehide", () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); });
})();
