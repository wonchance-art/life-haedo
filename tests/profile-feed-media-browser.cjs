"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const {
  playwright,
  ready,
  makeContext,
} = require("./unified-home-browser.cjs");
const { FakeCloud, accounts, base, cloud } = require("./life-sync-browser.cjs");
const { inspect } = require("./life-workbench-browser.cjs");
const out = path.resolve(".local/profile-feed-media"),
  report = {
    checks: [],
    visual: [],
    errors: [],
    consoleErrors: [],
    providerRequests: [],
    scope:
      "Linux Chromium; anonymous local storage, mocked providers and Auth. Not real Apple hardware or real YouTube playback.",
  };
async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  report.browser = browser.version();
  const context = await makeContext(
    browser,
    new FakeCloud(),
    "profile-feed-media",
    accounts.a,
    { viewport: { width: 1440, height: 1000 }, hasTouch: true },
  );
  let failImage = false,
    holdImages = false,
    holdPlayer = false,
    releasePlayer = null,
    releaseImages = [];
  const svg = (book) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="${book ? 720 : 270}" viewBox="0 0 480 ${book ? 720 : 270}"><rect width="480" height="720" fill="${book ? "#dce5d5" : "#ddd6cf"}"/><circle cx="${book ? 280 : 355}" cy="${book ? 410 : 145}" r="105" fill="${book ? "#7c9179" : "#a77758"}"/><path d="M0 550 Q200 290 480 530 V720 H0" fill="#efeee4"/><text x="35" y="65" fill="#243a30" font-size="26" font-family="sans-serif">${book ? "느린 관찰의 기록" : "걷는 마음 · 익명 영상"}</text><text x="35" y="105" fill="#243a30" font-size="18" font-family="sans-serif">검증용 가상 이미지</text></svg>`;
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if ([new URL(base).origin, cloud].includes(u.origin))
      return route.fallback();
    report.providerRequests.push(u.origin + u.pathname);
    if (u.hostname === "www.youtube.com" && u.pathname === "/oembed")
      return route.fulfill({
        json: {
          title: "익명 영상",
          author_name: "익명 창작자",
          thumbnail_url: "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg",
        },
      });
    if (["covers.openlibrary.org", "i.ytimg.com"].includes(u.hostname)) {
      if (holdImages)
        await new Promise((resolve) => releaseImages.push(resolve));
      if (failImage) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({
        contentType: "image/svg+xml",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
        body: svg(u.hostname === "covers.openlibrary.org"),
      });
    }
    if (u.hostname === "www.youtube-nocookie.com") {
      if (holdPlayer) await new Promise((resolve) => (releasePlayer = resolve));
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body style="background:#eeedf2;font:18px sans-serif;padding:24px">익명 플레이어 대역 · 실제 재생 검증 아님<button>재생 대역</button></body></html>',
      });
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") report.consoleErrors.push(m.text());
  });
  const go = async () => {
    await page.goto(base + "/index.html?section=records&view=page");
    await ready(page);
    await page.locator(".pp-toolbar").waitFor();
  };
  const read = () =>
    page.evaluate(async () => {
      const s = HaedoLife.Shell.storage,
        w = await s.getActive();
      return {
        wb: await s.readWorkbench(w),
        bundle: await s.read(w),
        drafts: await s.readPageDrafts(w),
      };
    });
  const check = async (name, fn) => {
    await fn();
    report.checks.push(name);
    console.log("PASS " + name);
  };
  const snap = async (name, width) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: path.join(out, `${name}-${width}.png`) });
    const m = await page.evaluate(inspect);
    report.visual.push({ name, ...m });
    assert.deepEqual(m.overflow, []);
    assert.equal(m.horizontalOverflow, false);
    assert.deepEqual(m.smallTargets, []);
    assert.deepEqual(m.smallInputs, []);
    assert.deepEqual(m.contrastFailures, []);
  };
  const options = async () => {
    const d = page.locator(".pp-toolbar .pp-media-options");
    if (!(await d.evaluate((e) => e.open))) await d.locator("summary").click();
  };
  try {
    await go();
    await check(
      "Empty page stays clean and has no provider requests",
      async () => {
        for (const width of [1440, 820, 390]) await snap("empty", width);
        assert.equal(report.providerRequests.length, 0);
      },
    );
    await page.evaluate(async () => {
      const s = HaedoLife.Shell.storage,
        w = await s.getActive(),
        wb = await s.readWorkbench(w),
        M = HaedoLife.PagePosts;
      wb.page.posts ||= [];
      wb.page.title = "보고 듣고 오래 남긴 것들";
      wb.page.intro = "걷다가 만난 문장과 자주 돌아오는 음악.";
      for (let i = 7; i >= 0; i--) {
        const d = M.draft(
          wb.page.posts,
          HaedoLife.Core.id(),
          new Date(Date.UTC(2026, 9, 12, 12 - i)).toISOString(),
        );
        d.visibility = i === 0 ? "page" : "private";
        d.body =
          i === 0
            ? "비가 그친 뒤, 조금 더 천천히\n\n퇴근길에 같은 곡을 세 번 들었다. 빨리 지나쳤던 풍경이 오늘은 조금 다르게 보였다. 책에 접어 둔 문장과 함께 남겨 두고 싶다."
            : "작은 도구가 바꾸어 놓은 하루\n\n내가 자주 돌아오는 것들을 모으며 생각도 조금씩 선명해진다. ".repeat(
                i === 1 ? 20 : 1,
              );
        d.attachments =
          i === 0
            ? [
                M.attachment({
                  type: "music",
                  title: "걷는 마음",
                  creator: "익명 음악가",
                  url: "https://youtu.be/M7lc1UVf-VE",
                }),
                M.attachment({
                  type: "book",
                  title:
                    "느린 관찰의 기록 — 일상의 다른 표정을 발견하는 긴 산책",
                  creator: "익명 저자",
                  url: "https://openlibrary.org/isbn/9780140328721",
                }),
              ]
            : [
                M.attachment({
                  type: ["tool", "film", "person", "artwork"][i % 4],
                  title:
                    "오래 남기고 싶은 " +
                    ["도구", "영화", "사람", "작품"][i % 4],
                  creator: i % 4 === 2 ? "" : "익명 창작자",
                  url: "https://example.org/item/" + i,
                }),
              ];
        wb.page.posts = M.finish(
          wb.page.posts.concat(d),
          d.id,
          new Date().toISOString(),
        ).posts;
      }
      await s.saveWorkbench(w, wb, wb.revision);
    });
    await go();
    const before = await read();
    await page.evaluate(() => scrollTo(0, 0));
    await snap("profile", 1440);
    await check(
      "Many Korean posts retain body priority without fetching on hover or focus",
      async () => {
        await page.locator(".pp-video-open").first().hover();
        await page.locator(".pp-video-open").first().focus();
        assert.equal(report.providerRequests.length, 0);
        for (const width of [1440, 820, 390]) await snap("feed-off", width);
      },
    );
    await check(
      "Explicit images load exact-source covers and thumbnails without altering stored data",
      async () => {
        await options();
        await page
          .getByRole("button", { name: "외부 이미지 보기", exact: true })
          .click();
        // Images load only when their actual shape is visible. A toolbar click
        // can leave the second shape outside the viewport on CI Chromium.
        await page.locator(".pp-shape").nth(0).scrollIntoViewIfNeeded();
        await page.locator(".pp-shape img").first().waitFor();
        await page.locator(".pp-shape").nth(1).scrollIntoViewIfNeeded();
        await page.locator(".pp-shape img").nth(1).waitFor();
        await page.locator(".pp-media-options summary").click();
        for (const width of [1440, 820, 390]) {
          await page.locator(".pp-feed").scrollIntoViewIfNeeded();
          await snap("feed-images", width);
        }
        assert.deepEqual(await read(), before);
      },
    );
    await check(
      "Video opens only by click, closes on Escape and restores focus",
      async () => {
        assert.equal(await page.locator("iframe").count(), 0);
        const button = page.locator(".pp-video-open").first();
        await button.click();
        await page.locator("iframe").waitFor();
        const attrs = await page.locator("iframe").evaluate((e) => ({
          src: e.src,
          policy: e.referrerPolicy,
          allow: e.allow,
        }));
        assert.equal(
          attrs.src,
          "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?autoplay=0&playsinline=1&rel=0",
        );
        assert.equal(attrs.policy, "strict-origin-when-cross-origin");
        assert(!attrs.allow.includes("autoplay"));
        for (const width of [1440, 820, 390]) await snap("player", width);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("iframe").count(), 0);
        assert(await button.evaluate((e) => e === document.activeElement));
      },
    );
    await check(
      "Image failure preserves source, retry works, turning off clears loaded images",
      async () => {
        await options();
        await page
          .getByRole("button", { name: "외부 이미지 끄기", exact: true })
          .click();
        assert.equal(await page.locator(".pp-shape img").count(), 0);
        failImage = true;
        await go();
        await options();
        await page
          .getByRole("button", { name: "외부 이미지 보기", exact: true })
          .click();
        await page.locator(".pp-visual").first().scrollIntoViewIfNeeded();
        await page
          .locator(".pp-image-retry")
          .first()
          .waitFor({ state: "visible" });
        for (const width of [1440, 820, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          await page
            .locator(".pp-feed .pp-post")
            .first()
            .evaluate((e) => e.scrollIntoView());
          await snap("image-error", width);
        }
        failImage = false;
        await page.locator(".pp-image-retry").first().click();
        await page.locator(".pp-shape img").first().waitFor();
        assert.equal(
          await page.locator(".pp-attachment-title[href]").count(),
          9,
        );
      },
    );
    await check(
      "Leaving and remounting the page resets image permission",
      async () => {
        await page
          .getByRole("button", { name: "방문자 미리보기", exact: true })
          .click();
        assert.equal(await page.locator("#wbVisitor .pp-shape img").count(), 0);
        await page
          .getByRole("button", { name: "편집으로 돌아가기", exact: true })
          .click();
        await options();
        assert(
          await page
            .getByRole("button", { name: "외부 이미지 보기", exact: true })
            .isVisible(),
        );
        assert.equal(await page.locator(".pp-shape img").count(), 0);
      },
    );
    await check(
      "Long-body fold affects presentation only; public review preserves full content and never enables media",
      async () => {
        const more = page.locator(".pp-read-more").first();
        await more.click();
        assert.equal(await more.getAttribute("aria-expanded"), "true");
        await more.click();
        assert.equal(await more.getAttribute("aria-expanded"), "false");
        const value = await page.evaluate(async () => {
          const s = HaedoLife.Shell.storage,
            w = await s.getActive(),
            wb = await s.readWorkbench(w),
            snapshot = HaedoLife.Share.makeDraft(await s.read(w), wb).snapshot,
            el = HaedoLife.ShareView.render(snapshot, { review: true });
          return {
            text: el.textContent,
            media: el.querySelectorAll(
              "iframe,img,.pp-video-open,.pp-media-options",
            ).length,
            snapshot,
          };
        });
        assert.match(value.text, /비가 그친/);
        assert(!value.text.includes("작은 도구가"));
        assert.equal(value.media, 0);
        assert.deepEqual(await read(), before);
      },
    );
    await check(
      "Loading state cancels late images when the view closes",
      async () => {
        await page.locator(".pp-toolbar").scrollIntoViewIfNeeded();
        holdImages = true;
        await options();
        await page
          .getByRole("button", { name: "외부 이미지 보기", exact: true })
          .click();
        await page.locator(".pp-visual").first().scrollIntoViewIfNeeded();
        await page
          .locator('.pp-visual[data-media-state="loading"]')
          .first()
          .waitFor();
        for (const width of [1440, 820, 390]) await snap("loading", width);
        await page
          .getByRole("button", { name: "방문자 미리보기", exact: true })
          .click();
        holdImages = false;
        releaseImages.splice(0).forEach((resolve) => resolve());
        await page
          .getByRole("button", { name: "편집으로 돌아가기", exact: true })
          .click();
        assert.equal(await page.locator(".pp-shape img").count(), 0);
      },
    );
    await check(
      "Page hiding removes an open player and resets imagery",
      async () => {
        await page.locator(".pp-video-open").first().click();
        await page.evaluate(() => dispatchEvent(new Event("pagehide")));
        assert.equal(await page.locator("iframe").count(), 0);
        assert.equal(await page.locator("dialog").count(), 0);
        assert.equal(
          await page.evaluate(() => document.body.style.overflow),
          "",
        );
      },
    );
    await check(
      "Player timeout keeps source available and ignores a late load",
      async () => {
        holdPlayer = true;
        await page.evaluate(() => {
          window.__testMedia = HaedoLife.PageMedia.create({ timeout: 60 });
          const item = {
            type: "video",
            title: "응답 지연 검증",
            url: "https://youtu.be/M7lc1UVf-VE",
          };
          __testMedia.video(
            item,
            HaedoLife.PageMedia.describe(item),
            document.querySelector(".pp-video-open"),
          );
        });
        await page
          .getByRole("status")
          .filter({ hasText: "플레이어 연결을 확인하지 못했습니다." })
          .waitFor();
        assert.equal(await page.locator("iframe").count(), 0);
        assert(
          await page
            .getByRole("link", { name: "YouTube에서 열기", exact: true })
            .isVisible(),
        );
        holdPlayer = false;
        releasePlayer?.();
        await page.keyboard.press("Escape");
        await page.evaluate(() => {
          __testMedia.dispose();
          delete window.__testMedia;
        });
      },
    );
    assert.deepEqual(report.errors, []);
    report.expectedNetworkErrors = report.consoleErrors.filter((s) =>
      s.includes("404"),
    );
    assert.deepEqual(
      report.consoleErrors.filter((s) => !s.includes("404")),
      [],
    );
  } finally {
    holdImages = false;
    holdPlayer = false;
    releasePlayer?.();
    releaseImages.splice(0).forEach((resolve) => resolve());
    await browser.close();
    await fs.writeFile(
      path.join(out, "report.json"),
      JSON.stringify(report, null, 2),
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
