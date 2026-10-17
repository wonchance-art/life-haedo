"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fixture } = require("./fixtures/obsidian-decisions.cjs");
const { playwright, makeContext, ready, settle } = require("./unified-home-browser.cjs");
const { FakeCloud, accounts, cloud, base } = require("./life-sync-browser.cjs");
const { inspect } = require("../scripts/check-site-design.cjs");
const Core = require("../assets/life/core.js");
const { unzipSync } = require("../vendor/fflate/fflate.js");
const out = path.resolve(".local/obsidian-decisions");
const report = { checks: [], visual: [], errors: [], consoleErrors: [], external: [],
  scope: "Anonymous standalone local HTTP tool; real IndexedDB and mock Auth for restoration. No real private files or Apple device/Files proof." };
async function main() {
  await fs.mkdir(out, { recursive: true });
  const f = await fixture(), { renderDecisionTool } = await import("../scripts/lib/obsidian-decision-tool.mjs");
  await fs.writeFile(path.join(out, "review-tool.html"), await renderDecisionTool());
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const url = base + "/.local/obsidian-decisions/review-tool.html";
  await context.route("**/*", (route) => {
    if (route.request().url() === url) return route.fallback();
    report.external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on("dialog", (dialog) => dialog.accept());
  const observe = (p) => { p.on("pageerror", (e) => report.errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(m.text()); }); };
  observe(page);
  const files = (source) => Object.entries(source).map(([name, buffer]) => ({ name, mimeType: name.endsWith("json") ? "application/json" : "application/octet-stream", buffer: Buffer.from(buffer) }));
  const check = async (name, fn) => { await fn(); report.checks.push(name); console.log("PASS " + name); };
  const capture = async (scene, id) => {
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.locator(id).scrollIntoViewIfNeeded();
      const metrics = await page.evaluate(inspect); report.visual.push({ scene, width, metrics });
      assert.equal(metrics.horizontalOverflow, false);
      for (const k of ["smallTargets", "smallInputs", "unnamed", "contrastFailures"]) assert.deepEqual(metrics[k], [], scene + " " + k);
      await page.screenshot({ path: path.join(out, `${scene}-${width}.png`) });
    }
  };
  const download = async (id, name) => { const wait = page.waitForEvent("download"); await page.locator(id).click(); const d = await wait; const file = path.join(out, name); await d.saveAs(file); return fs.readFile(file); };
  const selectGroup = async (target) => {
    const value = await page.locator("#group option").evaluateAll((options, t) => options.find((o) => o.textContent.startsWith(t + " ·")).value, target);
    await page.locator("#group").selectOption(value);
  };
  let saved, zipFiles, appContext;
  try {
    await check("Local file validation shows candidates without auto-selecting or contacting any endpoint", async () => {
      await page.goto(url);
      assert.equal(await page.locator("#workspace").isVisible(), false);
      await page.locator("#package-files").setInputFiles(files(f.files));
      await page.getByText("원문 확인을 마쳤습니다.", { exact: false }).waitFor();
      assert.match(await page.locator("#selection-summary").innerText(), /0회 선택 · 4회 보류/);
      assert.equal(await page.locator("#choose").isDisabled(), true);
      await selectGroup("같음"); await page.locator("#candidate").selectOption("a/같음.md");
      assert.match(await page.locator("#candidate-excerpt").innerText(), /<script>/);
      assert.equal(await page.locator("#candidate-excerpt script").count(), 0);
      await selectGroup("이전/책"); await page.locator("#candidate").selectOption("책.md");
      await capture("compare", "#review-title");
      await page.locator("#choose").focus(); await page.keyboard.press("Space");
      assert.match(await page.locator("#selection-summary").innerText(), /1회 선택 · 3회 보류/);
      const second = await page.locator("#occurrence option").nth(1).getAttribute("value");
      await page.locator("#occurrence").selectOption(second);
      assert.equal(await page.locator("#candidate").inputValue(), "");
      assert.equal(await page.locator("#choose").isDisabled(), true);
    });
    await check("Exact heading selection repairs an existing document link; save/reopen and stale input preserve current choices", async () => {
      await selectGroup("대상#없는 제목"); await page.locator("#candidate").selectOption("대상.md");
      assert.equal(await page.locator("#choose").isDisabled(), true);
      assert.deepEqual(await page.locator("#anchor option").allTextContents(), ["제목·블록 선택", "# 실제 제목"]);
      await page.locator("#anchor").selectOption("1"); await page.locator("#choose").click();
      saved = await download("#save-selections", "decisions.json");
      const parsed = JSON.parse(saved); assert.equal(parsed.decisions.length, 2);
      await page.locator("#defer").click(); assert.match(await page.locator("#selection-summary").innerText(), /1회 선택/);
      await page.locator("#decisions-file").setInputFiles({ name: "decisions.json", mimeType: "application/json", buffer: saved });
      await page.getByText("선택 파일을 확인했습니다.", { exact: false }).waitFor();
      assert.match(await page.locator("#selection-summary").innerText(), /2회 선택 · 2회 보류/);
      parsed.ref = "b".repeat(40);
      await page.locator("#decisions-file").setInputFiles({ name: "stale.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(parsed)) });
      await page.getByText("선택 파일이 현재 원본과 다릅니다.", { exact: false }).waitFor();
      assert.match(await page.locator("#selection-summary").innerText(), /2회 선택 · 2회 보류/);
      await page.locator("#package-files").setInputFiles(files({ "notes.json": f.files["notes.json"] }));
      await page.getByText("파일을 확인할 수 없습니다.", { exact: false }).waitFor();
      assert.match(await page.locator("#selection-summary").innerText(), /2회 선택 · 2회 보류/);
    });
    await check("Preview exports only the chosen references with exact original auxiliary bytes and reusable decisions/history", async () => {
      await page.locator("#preview").click();
      assert.match(await page.locator("#preview-summary").innerText(), /연결 추가 1회 · 위치 보완 1회 · 이미 반영 0회 · 보류 2회/);
      await capture("preview", "#preview-title");
      await page.evaluate(() => { window.savedZip = fflate.zipSync; fflate.zipSync = () => { throw new Error("anonymous-write-failure"); }; });
      await page.locator("#export").click();
      await page.getByText("새 ZIP을 만들지 못했습니다.", { exact: false }).waitFor();
      assert.match(await page.locator("#selection-summary").innerText(), /2회 선택/);
      assert.equal(await page.locator("#export").isEnabled(), true);
      await page.evaluate(() => { fflate.zipSync = window.savedZip; delete window.savedZip; });
      const zip = await download("#export", "selected-copy.zip");
      zipFiles = unzipSync(zip);
      for (const name of Object.keys(f.files).filter((n) => n !== "notes.json")) assert.deepEqual(Buffer.from(zipFiles[name]), f.files[name]);
      assert.deepEqual(JSON.parse(Buffer.from(zipFiles["decisions.json"])), JSON.parse(saved));
      assert.equal(JSON.parse(Buffer.from(zipFiles["applications.json"]))[0].summary.located, 1);
      const restored = await Core.restoreBackup(Buffer.from(zipFiles["notes.json"]).toString());
      assert.equal(restored.links.length, 2);
      assert.deepEqual(restored.sourceVersions.map((v) => v.contentText), f.result.notesBackup.workspace.sourceVersions.map((v) => v.contentText));
      await page.locator("#package-files").setInputFiles({ name: "selected-copy.zip", mimeType: "application/zip", buffer: zip });
      await page.getByText("원문 확인을 마쳤습니다.", { exact: false }).waitFor();
      await page.locator("#decisions-file").setInputFiles({ name: "decisions.json", mimeType: "application/json", buffer: saved });
      await page.getByText("선택 파일을 확인했습니다.", { exact: false }).waitFor(); await page.locator("#preview").click();
      assert.match(await page.locator("#preview-summary").innerText(), /연결 추가 0회 · 위치 보완 0회 · 이미 반영 2회/);
      const secondZip = unzipSync(await download("#export", "second-copy.zip"));
      assert.equal(JSON.parse(Buffer.from(secondZip["applications.json"])).length, 2);
    });
    await check("Generated notes restore through the account UI as a new workspace; exact links/backlinks and a fresh backup retain original text", async () => {
      appContext = await makeContext(browser, new FakeCloud(), "obsidian-decisions-restore", accounts.a);
      await appContext.route("**/*", (route) => { const origin = new URL(route.request().url()).origin; if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push(origin); return route.abort(); });
      const app = await appContext.newPage(); observe(app);
      await app.goto(base + "/index.html?section=manage&view=transfer"); await ready(app); await settle(app);
      const previous = await app.evaluate(() => HaedoLife.Shell.storage.getActive());
      await app.locator("#lifeRestoreFile").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from(zipFiles["notes.json"]) });
      await app.getByRole("button", { name: "새 사본으로 복원", exact: true }).click();
      await app.getByRole("button", { name: "자료 읽기: 기록", exact: true }).waitFor();
      const data = await app.evaluate(async (previous) => {
        const s = HaedoLife.Shell.storage, c = HaedoLife.Core, b = await s.read(await s.getActive()), restored = await c.restoreBackup(c.makeBackup(b));
        return { newWorkspace: b.workspaceId !== previous, previousKept: !!await s.read(previous), links: b.links.length,
          bodyEqual: JSON.stringify(b.sourceVersions.map((v) => v.contentText)) === JSON.stringify(restored.sourceVersions.map((v) => v.contentText)) };
      }, previous);
      assert.deepEqual(data, { newWorkspace: true, previousKept: true, links: 2, bodyEqual: true });
      await app.getByRole("button", { name: "자료 읽기: 기록", exact: true }).click();
      assert.match(await app.locator("#lifeSourceText").innerText(), /\[\[이전\/책\]\]/);
      await app.locator(".life-obsidian-links > summary").click();
      const target = app.locator("[data-linked-version]").filter({ hasText: "대상" }); await target.click();
      await app.waitForFunction(() => document.querySelector(".life-reader-heading")?.textContent === "대상");
      await app.waitForFunction(() => getSelection()?.toString() === "# 실제 제목");
      const exact = await app.evaluate(() => { const s = getSelection(); return s?.toString(); });
      assert.equal(exact, "# 실제 제목");
      await app.locator(".life-obsidian-links > summary").click();
      assert.match(await app.locator(".life-obsidian-links").innerText(), /이 노트를 연결한 원문/);
      await app.locator("[data-linked-version]").click();
      await app.waitForFunction(() => document.querySelector(".life-reader-heading")?.textContent === "기록");
    });
    await check("Whole-scale anonymous 6,899-file review loads 60 groups/152 occurrences and exports a selected new copy without changing the audit", async () => {
      const { buildVault } = await import("../scripts/lib/obsidian-vault.mjs");
      const { renderReviewHTML } = await import("../scripts/lib/obsidian-review.mjs");
      const entries = Array.from({ length: 3479 }, (_, i) => ({ path: i === 0 ? "원문.md" : `notes/후보 ${i - 1}.md`, bytes: Buffer.from(i === 0 ? Array.from({ length: 152 }, (_, n) => `[[이전/후보 ${n % 60}]]`).join("\n") : `# 익명 제목 ${i}\n` + "익명 원문을 읽고 기록한다. ".repeat(24)) }));
      entries.push(...Array.from({ length: 3420 }, (_, i) => ({ path: `metadata/${i}.yaml`, bytes: Buffer.from("anonymous: true\n") })));
      const result = await buildVault(entries, { repositoryUrl: "https://github.com/example/anonymous", ref: "c".repeat(40) });
      const inputFiles = { "notes.json": JSON.stringify(result.notesBackup), "supporting-files.json": JSON.stringify(result.filesBackup), "private-audit.json": JSON.stringify(result.manifest), "review.json": JSON.stringify(result.review), "review.html": renderReviewHTML(result.review), "repository.bundle": f.files["repository.bundle"] };
      const start = Date.now();
      await page.locator("#package-files").setInputFiles(files(inputFiles));
      await page.getByText("원문 확인을 마쳤습니다.", { exact: false }).waitFor({ timeout: 60000 });
      report.wholeScale = { files: 6899, reviewGroups: 60, occurrences: 152, loadMs: Date.now() - start };
      assert.match(await page.locator("#package-summary").innerText(), /60묶음 · 152회 검토/);
      assert.equal(await page.locator("#group option").count(), 60);
      assert.equal(await page.locator("#choose").isDisabled(), true);
      await page.locator("#candidate").selectOption("notes/후보 0.md"); await page.locator("#choose").click(); await page.locator("#preview").click();
      assert.match(await page.locator("#preview-summary").innerText(), /보류 151회/);
      const largeZip = unzipSync(await download("#export", "anonymous-whole-copy.zip"));
      assert.deepEqual(Buffer.from(largeZip["private-audit.json"]), Buffer.from(inputFiles["private-audit.json"]));
      const restored = await Core.restoreBackup(Buffer.from(largeZip["notes.json"]).toString());
      assert.equal(restored.sources.length, 3479); assert.equal(restored.links.length, 1);
    });
    assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } finally { await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2)); await browser.close(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
