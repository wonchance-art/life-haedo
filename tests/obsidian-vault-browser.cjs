/* Whole-vault scale with anonymous notes only; actual private vault never enters browser logs/screenshots. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  playwright,
  makeContext,
  ready,
  settle,
} = require("./unified-home-browser.cjs");
const { FakeCloud, accounts, cloud, base } = require("./life-sync-browser.cjs");
const { inspect } = require("../scripts/check-site-design.cjs");
const out = path.resolve(".local/obsidian-vault");
const report = {
  checks: [],
  visual: [],
  errors: [],
  consoleErrors: [],
  external: [],
  scope:
    "Anonymous Auth and 6,899 synthetic files. Actual private notes remain outside the app repository. Chromium viewport simulation; no Apple device proof.",
};
async function main() {
  await fs.mkdir(out, { recursive: true });
  const { buildVault } = await import("../scripts/lib/obsidian-vault.mjs");
  const entries = Array.from({ length: 3479 }, (_, i) => ({
    path: "notes/익명 노트 " + i + ".md",
    bytes: Buffer.from(
      "# 익명 노트 " +
        i +
        "\n" +
        (i === 0 ? "[[익명 노트 1#목적지]]\n" : i === 1 ? "## 목적지\n" : "") +
        "안전한 합성 자료를 읽고 생각을 남긴다. ".repeat(70),
    ),
  }));
  entries.push(
    ...Array.from({ length: 3420 }, (_, i) => ({
      path: "_extracts/anonymous-" + i + ".yaml",
      bytes: Buffer.from("extracts:\n  - 익명 보조 원본\n"),
    })),
  );
  const fixture = await buildVault(entries, {
    repositoryUrl: "https://github.com/example/anonymous-vault",
    ref: "a".repeat(40),
    title: "익명 노트 전체",
  });
  const browser = await playwright().chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  report.browser = browser.version();
  const context = await makeContext(
    browser,
    new FakeCloud(),
    "obsidian-vault",
    accounts.a,
    { viewport: { width: 1440, height: 1000 }, hasTouch: true },
  );
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if ([new URL(base).origin, cloud].includes(u.origin))
      return route.fallback();
    report.external.push(u.origin);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") report.consoleErrors.push(m.text());
  });
  const click = (name) =>
    page.getByRole("button", { name, exact: true }).click();
  const check = async (name, task) => {
    await task();
    report.checks.push(name);
    console.log("PASS " + name);
  };
  const go = async (view) => {
    await page.goto(base + "/index.html?section=manage&view=" + view);
    await ready(page);
    await settle(page);
  };
  const read = () =>
    page.evaluate(async () => {
      const s = HaedoLife.Shell.storage,
        b = await s.read(await s.getActive());
      return {
        id: b.workspaceId,
        sources: b.sources.length,
        links: b.links.length,
        records: b.records.length,
      };
    });
  const capture = async (scene) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(inspect);
      report.visual.push({ scene, width, metrics });
      assert.equal(metrics.horizontalOverflow, false);
      for (const k of [
        "smallTargets",
        "smallInputs",
        "unnamed",
        "contrastFailures",
      ])
        assert.deepEqual(metrics[k], [], scene + " " + k);
      await page.screenshot({
        path: path.join(out, scene + "-" + width + ".png"),
      });
    }
  };
  let previous, installed;
  try {
    await go("transfer");
    previous = await read();
    await check(
      "Whole-vault restore validates every note before installation; collapsed review renders 40 at a time and cancellation keeps the prior workspace",
      async () => {
        await page
          .locator("#lifeRestoreFile")
          .setInputFiles({
            name: "anonymous-vault.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(fixture.notesBackup)),
          });
        await page
          .getByRole("button", { name: "새 사본으로 복원", exact: true })
          .waitFor();
        assert.equal((await read()).id, previous.id);
        assert.equal(
          await page
            .locator(".life-backup-contents .life-backup-source")
            .count(),
          0,
        );
        await page.locator("#lifeRestorePreview").scrollIntoViewIfNeeded();
        await capture("restore-review");
        await page.locator(".life-backup-contents > summary").click();
        await page
          .locator(".life-backup-contents .life-backup-source")
          .nth(39)
          .waitFor();
        assert.equal(
          await page
            .locator(".life-backup-contents .life-backup-source")
            .count(),
          40,
        );
        await click("백업 원문 더 보기");
        assert.equal(
          await page
            .locator(".life-backup-contents .life-backup-source")
            .count(),
          80,
        );
        await click("복원 취소");
        assert.equal((await read()).id, previous.id);
        await page
          .locator("#lifeRestoreFile")
          .setInputFiles({
            name: "anonymous-vault.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(fixture.notesBackup)),
          });
        await page
          .getByRole("button", { name: "새 사본으로 복원", exact: true })
          .waitFor();
        await page.evaluate(() => {
          window.__put = IDBObjectStore.prototype.add;
          IDBObjectStore.prototype.add = function (...args) {
            const r = __put.apply(this, args);
            if (this.name === "bundles") this.transaction.abort();
            return r;
          };
        });
        await click("새 사본으로 복원");
        await page.waitForFunction(
          () =>
            document.querySelector("#lifeStatus")?.getAttribute("role") ===
              "alert" || document.querySelector("[role=alert]"),
        );
        assert.equal((await read()).id, previous.id);
        assert.equal(
          await page
            .getByRole("button", { name: "새 사본으로 복원", exact: true })
            .count(),
          1,
        );
        await page.evaluate(() => (IDBObjectStore.prototype.add = __put));
        await click("새 사본으로 복원");
        await page
          .locator("#lifeSearchResults .life-source-open")
          .first()
          .waitFor();
        installed = await read();
        assert.equal(installed.sources, 3479);
        assert.equal(installed.records, 0);
        assert.equal(installed.links, 1);
        assert.equal(await page.locator("#lifeSearchResults > *").count(), 40);
      },
    );
    await check(
      "Exact pinned note links and backlinks open preserved text and heading positions; source path is visible and reload preserves all 3,479 notes",
      async () => {
        await page
          .getByRole("button", { name: "자료 읽기: 익명 노트 0", exact: true })
          .click();
        await page.locator("#lifeSourceText").waitFor();
        assert.match(
          await page.locator("#lifeSourceText").innerText(),
          /\[\[익명 노트 1#목적지\]\]/,
        );
        await page.locator(".life-obsidian-links > summary").click();
        await page.locator("[data-linked-version]").waitFor();
        await capture("note-links");
        await page.locator("[data-linked-version]").click();
        await page.waitForFunction(
          () =>
            document.querySelector(".life-reader-heading")?.textContent ===
            "익명 노트 1",
        );
        assert.match(
          await page.locator("#lifeSourceText").innerText(),
          /## 목적지/,
        );
        await page.locator(".life-obsidian-links > summary").click();
        await page.locator("[data-linked-version]").waitFor();
        assert.match(
          await page.locator(".life-obsidian-links").innerText(),
          /이 노트를 연결한 원문/,
        );
        await page.locator("[data-linked-version]").click();
        await page.waitForFunction(
          () =>
            document.querySelector(".life-reader-heading")?.textContent ===
            "익명 노트 0",
        );
        await click("출처 정보");
        assert.match(
          await page.locator("#lifeSourceDetails").innerText(),
          /notes\/익명 노트 0.md/,
        );
        await capture("note-source");
        await page.reload();
        await ready(page);
        assert.equal((await read()).sources, 3479);
      },
    );
    await check(
      "A new JSON backup restores exact bodies/paths/link references under new IDs and excludes all drafts and private source connections",
      async () => {
        const result = await page.evaluate(async () => {
          const s = HaedoLife.Shell.storage,
            c = HaedoLife.Core,
            b = await s.read(await s.getActive()),
            backup = c.makeBackup(b),
            copy = await c.restoreBackup(backup);
          return {
            sources: copy.sources.length,
            links: copy.links.length,
            bodyEqual:
              JSON.stringify(copy.sourceVersions.map((v) => v.contentText)) ===
              JSON.stringify(b.sourceVersions.map((v) => v.contentText)),
            pathsEqual:
              JSON.stringify(copy.sources.map((v) => v.sourceKey)) ===
              JSON.stringify(b.sources.map((v) => v.sourceKey)),
            newId: copy.workspaceId !== b.workspaceId,
            keys: Object.keys(backup),
          };
        });
        assert.equal(result.sources, 3479);
        assert.equal(result.links, 1);
        assert(result.bodyEqual && result.pathsEqual && result.newId);
        assert.deepEqual(result.keys, [
          "format",
          "schemaVersion",
          "exportedAt",
          "workspace",
          "manifest",
        ]);
      },
    );
    await check(
      "All 3,420 auxiliary files restore independently as plain text without excerpts or execution, keeping both earlier workspaces",
      async () => {
        await go("transfer");
        await page
          .locator("#lifeRestoreFile")
          .setInputFiles({
            name: "auxiliary.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(fixture.filesBackup)),
          });
        await page
          .getByRole("button", { name: "새 사본으로 복원", exact: true })
          .waitFor();
        await click("새 사본으로 복원");
        await page
          .locator("#lifeSearchResults .life-source-open")
          .first()
          .waitFor();
        const data = await read();
        assert.equal(data.sources, 3420);
        assert.equal(data.records, 0);
        const result = await page.evaluate(
          async (ids) => {
            const s = HaedoLife.Shell.storage;
            return Promise.all(
              ids.map(async (id) => (await s.read(id)).sources.length),
            );
          },
          [previous.id, installed.id],
        );
        assert.deepEqual(result, [previous.sources, 3479]);
      },
    );
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.consoleErrors, []);
    assert.deepEqual(report.external, []);
    report.pass = true;
  } catch (e) {
    await page
      .screenshot({ path: path.join(out, "failure.png"), fullPage: true })
      .catch(() => {});
    throw e;
  } finally {
    await fs.writeFile(
      path.join(out, "report.json"),
      JSON.stringify(report, null, 2),
    );
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
