"use strict";
const fs = require("node:fs/promises"), path = require("node:path"), assert = require("node:assert/strict"), { randomUUID } = require("node:crypto");
const { playwright } = require("./unified-home-browser.cjs"), { inspect } = require("../scripts/check-site-design.cjs");
const Photo = require("../assets/life/photo-post.js"), Blog = require("../assets/life/blog.js");
(async () => {
  const out = path.resolve(".local/blog-public"), base = process.env.BASE_URL || "http://127.0.0.1:4173", origin = new URL(base).origin; await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
  const report = { checks: [], visual: [], errors: [], consoleErrors: [], external: [], scope: "Anonymous HTTP mocks, real local public HTML/renderer; no account/DB/Apple device." };
  try {
    const png = Buffer.from(await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 1600; c.height = 1200; const g = c.getContext("2d"); g.fillStyle = "#c5decf"; g.fillRect(0,0,1600,1200); return c.toDataURL("image/png").split(",")[1]; }), "base64");
    const d = Photo.create(randomUUID), blob = new Blob([png], { type: "image/png" });
    const p = { id: randomUUID(), name: "익명사진.png", type: blob.type, width: 1600, height: 1200, size: blob.size, digest: await Photo.digest(blob), blob };
    d.status = "saved"; d.title = "여행의 생각과 사진을 남기는 글"; d.photos = [p];
    d.ops = [{ insert: "서울에서 시작한 익명의 여행과 생각\n", attributes: { bold: true } }, { insert: { photo: { id: p.id, caption: "여행에서 본 풍경", alt: "익명의 초록 풍경" } } }, { insert: "<script>실행하지 않는 본문</script>\n" }];
    const post = randomUUID(), author = randomUUID(), snapshot = Blog.publicSnapshot(d, { photoIds: [p.id], author: { name: "익명 여행자", intro: "글과 사진을 남깁니다." } });
    let result = { token: post, blogToken: author, revision: 1, createdAt: "2026-10-17T01:00:00.000Z", updatedAt: "2026-10-17T01:00:00.000Z", snapshot }, empty = false, photoBroken = false, rpcReads = 0;
    await context.addInitScript(() => { for (const key of ["indexedDB", "localStorage", "sessionStorage"]) Object.defineProperty(window, key, { get() { throw new Error("private storage forbidden: " + key); } }); });
    await context.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (u.origin === origin) {
        if (u.pathname === "/assets/platform-config.js") return route.fulfill({ contentType: "text/javascript", body: 'window.HAEDO_CONFIG={url:"https://anonymous.supabase.co",key:"sb_publishable_fixture"};' });
        return route.fallback();
      }
      if (u.origin !== "https://anonymous.supabase.co") { report.external.push(u.href); return route.abort(); }
      if (u.pathname.endsWith("/life_blog_public_read")) { rpcReads++; return route.fulfill({ contentType: "application/json", body: JSON.stringify(result), headers: { "access-control-allow-origin": "*" } }); }
      if (u.pathname.endsWith("/life_blog_public_list")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ blogToken: author, author: empty ? { name: "", intro: "" } : snapshot.author,
        posts: empty ? [] : [{ token: post, revision: result?.revision || 1, title: snapshot.title, createdAt: "2026-10-17T01:00:00.000Z", updatedAt: "2026-10-17T01:00:00.000Z", excerpt: "여행의 본문", cover: null }], nextCursor: null }), headers: { "access-control-allow-origin": "*" } });
      if (u.pathname.endsWith("/haedo-blog-media")) return route.fulfill({ contentType: "image/png", body: photoBroken ? Buffer.from("unreadable anonymous photo") : png, headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } });
      report.external.push(u.href); return route.abort();
    });
    page.on("pageerror", (e) => report.errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(m.text()); });
    await page.goto(base + "/blog.html?post=" + post); await page.locator(".blog-title").waitFor();
    await page.waitForFunction(() => document.querySelector(".blog-photo img")?.naturalWidth === 1600);
    assert.equal(await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some(font => font.family.replaceAll('"', '') === "Pretendard Variable" && font.status === "loaded"); }), true, "Public article loads the same self-hosted Korean font under its actual CSP");
    assert.equal(await page.locator(".blog-document script").count(), 0); assert.match(await page.locator(".blog-document").innerText(), /<script>/);
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: 1000 }); const metrics = await page.evaluate(inspect); report.visual.push({ width, metrics });
      assert.equal(metrics.horizontalOverflow, false); for (const key of ["smallTargets", "smallInputs", "unnamed", "contrastFailures"]) assert.deepEqual(metrics[key], []);
      await page.screenshot({ path: path.join(out, "post-" + width + ".png") });
    }
    await page.getByRole("button", { name: "사진 원본 크기로 보기" }).click(); assert.equal(await page.locator(".blog-photo img").evaluate((i) => Math.round(i.getBoundingClientRect().width)), 1600);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); report.checks.push("Public photo original bytes/dimensions, safe text, three widths and bounded original-size scrolling");
    photoBroken = true; await page.reload(); await page.locator(".blog-photo-error").waitFor({ state: "visible" });
    assert.equal(await page.getByRole("button", { name: "사진 원본 크기로 보기" }).isDisabled(), true);
    assert.match(await page.locator(".blog-document").innerText(), /익명의 여행/);
    photoBroken = false; await page.reload(); await page.waitForFunction(() => document.querySelector(".blog-photo img")?.naturalWidth === 1600);
    report.checks.push("An undecodable photo retains the article and shows a readable recovery state");
    await page.locator("#blogBack").click(); await page.getByText("익명 여행자의 블로그", { exact: true }).waitFor();
    await page.locator(".blog-post-link").click(); await page.locator(".blog-title").waitFor(); assert(new URL(page.url()).searchParams.get("post") === post);
    report.checks.push("Anonymous blog list to stable post and back, with private storage APIs forbidden");
    await context.setOffline(true); await page.getByText("인터넷 연결 후 공개 상태를 다시 확인해 주세요.").waitFor();
    assert.equal(await page.locator("#blogContent").innerText(), "");
    await context.setOffline(false); await page.locator(".blog-title").waitFor();
    report.checks.push("Offline transition removes previously rendered public content and online rechecks it");
    result.revision = 2; result.updatedAt = "2026-10-17T02:00:00.000Z"; result.snapshot.title = "갱신한 같은 주소의 글";
    await page.locator("#blogRefresh").click(); await page.getByText("갱신한 같은 주소의 글", { exact: true }).waitFor();
    result = null; await page.locator("#blogRefresh").click(); await page.getByText("공개된 글이 없습니다.", { exact: false }).waitFor(); assert.equal(await page.locator("#blogContent").innerText(), ""); report.checks.push("Same URL explicit update and revoked post removes all rendered text/photos");
    empty = true; await page.goto(base + "/blog.html?blog=" + author); await page.getByText("아직 공개한 글이 없습니다.").waitFor();
    const beforeInvalid = rpcReads;
    await page.goto(base + "/blog.html?post=invalid"); await page.getByText("블로그 주소를 확인해 주세요.").waitFor(); assert.equal(rpcReads, beforeInvalid);
    await page.goto(base + "/blog.html?post=" + post + "&post=" + post); await page.getByText("블로그 주소를 확인해 주세요.").waitFor(); assert.equal(rpcReads, beforeInvalid);
    report.checks.push("Empty blog and invalid/duplicate addresses without a public read request");
    report.expectedConsoleErrors = report.consoleErrors.filter((message) => message === "Failed to load resource: net::ERR_INTERNET_DISCONNECTED");
    report.unexpectedConsoleErrors = report.consoleErrors.filter((message) => message !== "Failed to load resource: net::ERR_INTERNET_DISCONNECTED");
    assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpectedConsoleErrors, []); assert.deepEqual(report.external, []);
    report.pass = true; await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ pass: true, checks: report.checks.length, visual: report.visual.length, errors: report.errors.length, consoleErrors: report.consoleErrors.length, expectedOfflineErrors: report.expectedConsoleErrors.length }));
  } catch (error) { report.pass = false; report.failure = error.message; await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2)); throw error; }
  finally { await context.close(); await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
