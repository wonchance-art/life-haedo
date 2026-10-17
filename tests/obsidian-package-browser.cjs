"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path");
const { fixture, input } = require("./fixtures/obsidian-decisions.cjs");
const { zipSync } = require("../vendor/fflate/fflate.js");
const D = require("../assets/life/obsidian-decisions.js");
const { playwright, makeContext, ready, settle } = require("./unified-home-browser.cjs");
const { FakeCloud, accounts, cloud, base } = require("./life-sync-browser.cjs");
const { inspect } = require("../scripts/check-site-design.cjs");
const out = path.resolve(".local/obsidian-package"), report = { checks: [], visual: [], consoleErrors: [], errors: [], external: [],
  scope: "Anonymous package ZIP and mock Auth; real IndexedDB transactions. No personal vault data, production account or Apple Files/device proof." };
const zip = (files) => Buffer.from(zipSync(files, { level: 0 }));
async function main() {
  await fs.mkdir(out, { recursive: true });
  const f = await fixture(), h = await D.openPackage(input(f.files));
  const item = h.items.find(i => i.target === "이전/책"), anchor = h.items.find(i => i.reason === "anchor_missing");
  const applied = await D.apply(h, D.makeDecisions(h, [{ id: item.id, targetPath: "책.md", targetLocator: null }, { id: anchor.id, targetPath: "대상.md", targetLocator: D.targetInfo(h, "대상.md").anchors[0] }]));
  const content = zip({ ...f.files, "notes.json": Buffer.from(JSON.stringify(applied.notesBackup)), "applications.json": Buffer.from(JSON.stringify([applied.history])) });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
  report.browser = browser.version();
  const context = await makeContext(browser, new FakeCloud(), "obsidian-package", accounts.a, { viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", (route) => { const origin = new URL(route.request().url()).origin; if ([new URL(base).origin, cloud].includes(origin)) return route.fallback(); report.external.push(origin); return route.abort(); });
  await context.route("**/assets/life/storage.js", async (route) => {
    const response = await route.fetch();
    const hook = `;(()=>{const original=HaedoLife.Storage;HaedoLife.Storage={...original,forAccount(...args){const actual=original.forAccount(...args);return Object.freeze({...actual,
      async installWorkspaces(...args){const result=await actual.installWorkspaces(...args);if(window.__failAfterPair){window.__failAfterPair=false;window.__failPairList=true;}return result;},
      async listWorkspaces(...args){if(window.__failPairList){window.__failPairList=false;throw new Error('익명 복원 목록 읽기 실패');}return actual.listWorkspaces(...args);}});}};})();`;
    await route.fulfill({ response, body: await response.text() + hook });
  });
  const page = await context.newPage(); page.setDefaultTimeout(60000);
  page.on("pageerror", e => report.errors.push(e.message)); page.on("console", m => { if (m.type() === "error") report.consoleErrors.push(m.text()); });
  const check = async (name, fn) => { await fn(); report.checks.push(name); console.log("PASS " + name); };
  const go = async () => { await page.goto(base + "/index.html?section=manage&view=transfer"); await ready(page); await settle(page); };
  const load = async (buffer = content) => {
    await page.locator("#lifeObsidianFile").setInputFiles({ name: "private-vault.zip", mimeType: "application/zip", buffer });
    await page.getByRole("button", { name: "Obsidian 새 사본으로 복원", exact: true }).waitFor();
  };
  const active = () => page.evaluate(async () => { const s = HaedoLife.Shell.storage, id = await s.getActive(), b = await s.read(id); return { id, title: b.title, sources: b.sources.length, links: b.links.length, spaces: (await s.listWorkspaces()).length }; });
  const capture = async (scene) => {
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.locator("#lifeObsidianPreview").scrollIntoViewIfNeeded();
      const metrics = await page.evaluate(inspect); report.visual.push({ scene, width, metrics });
      assert.equal(metrics.horizontalOverflow, false); for (const k of ["smallTargets", "smallInputs", "unnamed", "contrastFailures"]) assert.deepEqual(metrics[k], [], scene + " " + k);
      await page.screenshot({ path: path.join(out, scene + "-" + width + ".png") });
    }
  };
  let original, notesId, filesId;
  try {
    await go(); original = await active();
    await check("ZIP preview verifies notes/supporting files and preserves the old workspace on cancellation or invalid input", async () => {
      await load(); assert.deepEqual(await active(), original);
      assert.match(await page.locator("#lifeObsidianPreview").innerText(), /노트 5개 · 보조 파일 1개 · 노트 연결 2개/);
      assert.equal(await page.locator("#lifeObsidianIncludeFiles").isChecked(), true);
      await capture("review");
      await page.getByRole("button", { name: "Obsidian 복원 취소", exact: true }).click();
      assert.deepEqual(await active(), original);
      await page.locator("#lifeObsidianFile").setInputFiles({ name: "wrong.zip", mimeType: "application/zip", buffer: zip({ "manifest.json": Buffer.from("{}") }) });
      await page.getByRole("alert").waitFor(); assert.deepEqual(await active(), original);
      assert.equal(await page.getByRole("button", { name: "Obsidian 새 사본으로 복원", exact: true }).count(), 0);
    });
    await check("Aborting the second IndexedDB insert rolls back both copies; retry installs exactly two owned unsynced workspaces", async () => {
      await load();
      await page.evaluate(() => {
        const add = IDBObjectStore.prototype.add; window.__pairAdd = add; let count = 0;
        IDBObjectStore.prototype.add = function (...args) { const r = add.apply(this, args); if (this.name === "bundles" && ++count === 2) this.transaction.abort(); return r; };
      });
      await page.getByRole("button", { name: "Obsidian 새 사본으로 복원", exact: true }).click();
      await page.getByRole("alert").waitFor(); assert.deepEqual(await active(), original);
      await page.evaluate(() => { IDBObjectStore.prototype.add = window.__pairAdd; delete window.__pairAdd; });
      await page.getByRole("button", { name: "Obsidian 새 사본으로 복원", exact: true }).click();
      await page.locator("#lifeRestoreResult").waitFor(); const current = await active(); notesId = current.id;
      assert.equal(current.sources, 5); assert.equal(current.links, 2); assert.equal(current.spaces, original.spaces + 2);
      const all = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, rows = await s.listWorkspaces(); return Promise.all(rows.map(async row => ({ ...row, sync: await s.getSyncState(row.workspaceId) }))); });
      filesId = all.find(row => row.title.includes("보조 파일")).workspaceId;
      for (const row of all) assert.equal(row.sync, null);
    });
    await check("Restored notes open exact chosen targets and backlinks; support/source switching and fresh backups retain original bytes", async () => {
      await page.getByRole("button", { name: "함께 복원한 공간 열기: 익명 검토 · 보조 파일", exact: true }).click();
      assert.equal((await active()).id, filesId);
      const body = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, b = await s.read(await s.getActive()); return { text: b.sourceVersions[0].contentText, records: b.records.length }; });
      assert.deepEqual(body, { text: "private: anonymous", records: 0 });
      await page.getByRole("button", { name: "함께 복원한 공간 열기: 익명 검토", exact: true }).click();
      assert.equal((await active()).id, notesId);
      await page.locator("#lifeSearch").fill("이전/책");
      await page.waitForFunction(() => document.querySelectorAll('.life-source-card').length === 1);
      await page.getByRole("button", { name: "자료 읽기: 기록", exact: true }).click();
      await page.locator("#lifeSearchReturn").click();
      assert.equal(await page.locator("#lifeSearch").inputValue(), "이전/책");
      await page.getByRole("button", { name: "자료 읽기: 기록", exact: true }).click();
      await page.locator(".life-obsidian-links > summary").click();
      await page.locator("[data-linked-version]").filter({ hasText: "대상" }).click();
      await page.waitForFunction(() => getSelection()?.toString() === "# 실제 제목");
      await page.locator(".life-obsidian-links > summary").click(); assert.match(await page.locator(".life-obsidian-links").innerText(), /이 노트를 연결한 원문/);
      const roundtrip = await page.evaluate(async () => { const s = HaedoLife.Shell.storage, c = HaedoLife.Core, b = await s.read(await s.getActive()), copy = await c.restoreBackup(c.makeBackup(b)); return { texts: copy.sourceVersions.map(v => v.contentText), links: copy.links.length }; });
      assert.deepEqual(roundtrip.texts, f.result.notesBackup.workspace.sourceVersions.map(v => v.contentText)); assert.equal(roundtrip.links, 2);
      await page.reload(); await ready(page); assert.equal((await active()).id, notesId);
    });
    await check("Notes-only selection creates one copy; a postcommit refresh failure keeps saved copies and removes installation actions", async () => {
      await go(); const before = await active(); await load(); await page.locator("#lifeObsidianIncludeFiles").uncheck();
      await page.evaluate(() => { window.__failAfterPair = true; });
      await page.getByRole("button", { name: "Obsidian 새 사본으로 복원", exact: true }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(await page.locator("#lifeObsidianFile").count(), 0);
      assert.equal(await page.getByRole("button", { name: "Obsidian 새 사본으로 복원", exact: true }).count(), 0);
      const after = await active(); assert.equal(after.spaces, before.spaces + 1); assert.equal(after.sources, 5);
      await page.getByRole("button", { name: "이전 작업공간으로 돌아가기", exact: true }).click(); assert.equal((await active()).id, before.id);
    });
    await check("A full 6,899-file anonymous ZIP restores two workspaces atomically, with lazy review and no data loss", async () => {
      const { buildVault } = await import("../scripts/lib/obsidian-vault.mjs"), { renderReviewHTML } = await import("../scripts/lib/obsidian-review.mjs");
      const entries = Array.from({ length: 3479 }, (_, i) => ({ path: "notes/익명 " + i + ".md", bytes: Buffer.from("# 익명 " + i + "\n" + (i === 0 ? "[[익명 1]]\n" : "") + "원문 보존을 확인하는 합성 문장. ".repeat(25)) }));
      entries.push(...Array.from({ length: 3420 }, (_, i) => ({ path: "metadata/" + i + ".yaml", bytes: Buffer.from("anonymous: true\n") })));
      const data = await buildVault(entries, { repositoryUrl: "https://github.com/example/anonymous", ref: "b".repeat(40) });
      const files = { "notes.json": Buffer.from(JSON.stringify(data.notesBackup)), "supporting-files.json": Buffer.from(JSON.stringify(data.filesBackup)), "private-audit.json": Buffer.from(JSON.stringify(data.manifest)), "review.json": Buffer.from(JSON.stringify(data.review)), "review.html": Buffer.from(renderReviewHTML(data.review)), "repository.bundle": f.files["repository.bundle"] };
      await go(); const before = await active(), start = Date.now(); await load(zip(files));
      assert.match(await page.locator("#lifeObsidianPreview").innerText(), /노트 3479개 · 보조 파일 3420개/);
      assert.equal(await page.locator("#lifeObsidianPreview .life-backup-source").count(), 0);
      await page.locator("#lifeObsidianPreview .life-backup-contents").first().locator("summary").click();
      await page.locator("#lifeObsidianPreview .life-backup-source").nth(39).waitFor();
      assert.equal(await page.locator("#lifeObsidianPreview .life-backup-source").count(), 40);
      await page.getByRole("button", { name: "백업 원문 더 보기", exact: true }).first().click();
      await page.locator("#lifeObsidianPreview .life-backup-source").nth(79).waitFor();
      assert.equal(await page.locator("#lifeObsidianPreview .life-backup-source").count(), 80);
      await page.getByRole("button", { name: "Obsidian 새 사본으로 복원", exact: true }).click(); await page.locator("#lifeRestoreResult").waitFor();
      const after = await active(); assert.equal(after.sources, 3479); assert.equal(after.spaces, before.spaces + 2);
      report.wholeScale = { files: 6899, notes: 3479, supporting: 3420, elapsedMs: Date.now() - start };
    });
    assert.deepEqual(report.errors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []); report.pass = true;
  } finally { await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2)); await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
