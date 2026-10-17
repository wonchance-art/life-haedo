/* Readable offline reports use anonymous data only. No actual vault files enter the server. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { playwright } = require("./unified-home-browser.cjs");
const { base } = require("./life-sync-browser.cjs");
const { inspect } = require("../scripts/check-site-design.cjs");
const out = path.resolve(".local/obsidian-review");
const report = {
  checks: [],
  visual: [],
  errors: [],
  consoleErrors: [],
  external: [],
  scope:
    "Anonymous standalone report reopened over local HTTP; real private report stays outside the app. Chromium viewport simulation, no Apple Files/device proof.",
};
async function main() {
  await fs.mkdir(out, { recursive: true });
  const { buildVault } = await import("../scripts/lib/obsidian-vault.mjs");
  const { renderReviewHTML } = await import(
    "../scripts/lib/obsidian-review.mjs"
  );
  const entries = [
    [
      "notes/여행.md",
      "[[이동/책]] [[같은 이름]] [[대상#없는 제목]] [[없는 노트]] [[없는 노트]] [사진](사진.jpg) [표](목록.csv) [블로그](/PostList.naver?blogId=anonymous) [보조](../drawing.svg)",
    ],
    ["책.md", "책의 익명 원문"],
    ["a/같은 이름.md", "A"],
    ["b/같은 이름.md", "B"],
    ["대상.md", "# 실제 제목"],
    ["drawing.svg", "<svg/>"],
  ].map(([path, text]) => ({ path, bytes: Buffer.from(text) }));
  const result = await buildVault(entries, {
    repositoryUrl: "https://github.com/example/anonymous",
    ref: "a".repeat(40),
  });
  const html = renderReviewHTML(result.review);
  await fs.writeFile(path.join(out, "anonymous-review.html"), html);
  const browser = await playwright().chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  report.browser = browser.version();
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    url = base + "/.local/obsidian-review/anonymous-review.html";
  await context.route("**/*", (route) => {
    if (route.request().url() === url) return route.fallback();
    report.external.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") report.consoleErrors.push(m.text());
  });
  const capture = async (scene) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const metrics = await page.evaluate(inspect);
      report.visual.push({ scene, width, metrics });
      assert.equal(metrics.horizontalOverflow, false);
      for (const key of [
        "smallTargets",
        "smallInputs",
        "unnamed",
        "contrastFailures",
      ])
        assert.deepEqual(metrics[key], [], scene + " " + key);
      await page.screenshot({
        path: path.join(out, scene + "-" + width + ".png"),
      });
    }
  };
  try {
    await page.goto(url);
    assert.equal(await page.locator("script,img,iframe,link").count(), 0);
    assert.equal(await page.locator("h1").innerText(), "노트 연결 검토");
    assert.match(await page.locator("main").innerText(), /4개 묶음/);
    assert.equal(await page.locator("table tbody tr").count(), 6);
    await capture("summary");
    report.checks.push(
      "Self-contained report separates manual groups and informational categories, with no scripts or external resources",
    );
    const group = page
      .locator("details")
      .filter({ has: page.locator("summary").filter({ hasText: "이동/책" }) });
    await group.locator("summary").click();
    assert.match(await group.innerText(), /동일한 파일명/);
    assert.match(await group.innerText(), /책.md/);
    assert.match(await group.innerText(), /notes\/여행.md/);
    await group.scrollIntoViewIfNeeded();
    await capture("candidate");
    report.checks.push(
      "Native details shows the unchanged target, exact basename candidate and source occurrences without applying a link",
    );
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.consoleErrors, []);
    assert.deepEqual(report.external, []);
    report.pass = true;
    console.log("Obsidian review: 2/2, visual 4, console/page/external 0.");
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
