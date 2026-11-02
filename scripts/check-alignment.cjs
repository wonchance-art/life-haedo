#!/usr/bin/env node
/* 화면 정렬 검사 — 시안·앱 화면의 "보이는 시작점"이 몇 개의 정렬선에 모이는지 잰다.
 * 사용: node scripts/check-alignment.cjs <HTML 파일 또는 http://127.0.0.1 주소>:<폭>:<높이> ...
 *   예) node scripts/check-alignment.cjs docs/x.html:1440:960 http://127.0.0.1:4173/index.html:390:844
 * 기준과 해석은 docs/design-review/expert-design-brief.md 「정렬 기준」. 파일을 쓰거나 외부로 보내지 않는다.
 * 측정 영역: <main> → [data-align-root] → 첫 화면 틀(x-dc > div) → body 순서로 찾는다.
 * Playwright는 기존 설치를 쓴다(PW_MODULE_PATH 또는 전역 설치).
 */
'use strict';
const path = require('node:path');
function playwright() {
  for (const name of [process.env.PW_MODULE_PATH, 'playwright', 'playwright-core'].filter(Boolean)) {
    try { return require(name); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('기존 Playwright 설치를 PW_MODULE_PATH로 지정하세요.');
}
const toUrl = (target) => (/^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target));
(async () => {
  const specs = process.argv.slice(2);
  if (!specs.length) { console.error('사용: node scripts/check-alignment.cjs <파일|주소>:<폭>:<높이> ...'); process.exit(2); }
  const { chromium } = playwright();
  const browser = await chromium.launch();
  for (const spec of specs) {
    const m = spec.match(/^(.*):(\d+):(\d+)$/); if (!m) { console.error('형식 오류: ' + spec); process.exitCode = 2; continue; }
    const [, target, w, h] = m; const name = target;
    const page = await browser.newPage({ viewport: { width: +w, height: +h } });
    await page.goto(toUrl(target));
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const root = document.querySelector('main') || document.querySelector('[data-align-root]') || document.querySelector('x-dc > div') || document.body;
      const rr = root.getBoundingClientRect();
      const skipZone = (el) => el.closest('[role="menu"],[role="dialog"],[role="status"],[aria-hidden="true"],nav[aria-label="주 메뉴"]');
      const shaped = (el) => { const cs = getComputedStyle(el); const bg = cs.backgroundColor; return (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') || (cs.boxShadow !== 'none' && !/inset 0px -/.test(cs.boxShadow)) || parseFloat(cs.borderLeftWidth) > 0; };
      const vis = (b) => b.width >= 1 && b.height >= 1 && b.top < innerHeight && b.bottom > rr.top;
      const items = []; const done = new Set();
      const add = (el, b, x) => { el.querySelectorAll('*').forEach((c) => done.add(c)); done.add(el); items.push({ x, xr: b.right, y: b.top, yb: b.bottom, t: (el.getAttribute('aria-label') || el.textContent.trim()).slice(0, 14) }); };
      root.querySelectorAll('[role="toolbar"], [role="radiogroup"], [role="tablist"], nav[aria-label="보기 단위"]').forEach((el) => { if (skipZone(el) || done.has(el)) return; const b = el.getBoundingClientRect(); if (!vis(b)) return; let x = b.left; if (!shaped(el)) { const f = [...el.querySelectorAll('svg, button, a, [role="img"]')].map((c) => c.getBoundingClientRect()).filter(vis); const tw2 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); while (tw2.nextNode()) { if (!tw2.currentNode.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(tw2.currentNode); const rc = rg.getClientRects()[0]; if (rc) f.push(rc); } const firstShaped = [...el.querySelectorAll('button, a')].find((c) => shaped(c)); x = Math.min(...f.map((q) => q.left)); } add(el, b, x); });
      root.querySelectorAll('button, a, input, label, [role="img"]').forEach((el) => {
        if (skipZone(el) || done.has(el)) return;
        const b = el.getBoundingClientRect(); if (!vis(b) || b.height > 80 || el.querySelector('h1,h2,h3,p,div,article')) return;
        if (shaped(el) || el.matches('[role="img"], input')) return add(el, b, b.left);
        const ls = [], rs = [];
        el.querySelectorAll('svg, [role="img"]').forEach((s) => { const sb = s.getBoundingClientRect(); if (vis(sb)) { ls.push(sb.left); rs.push(sb.right); } });
        const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (tw.nextNode()) { if (!tw.currentNode.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(tw.currentNode); for (const rc of rg.getClientRects()) if (vis(rc)) { ls.push(rc.left); rs.push(rc.right); } }
        if (ls.length) add(el, { ...b.toJSON(), right: Math.max(...rs) }, Math.min(...ls));
      });
      root.querySelectorAll('span, kbd').forEach((el) => {
        if (skipZone(el) || done.has(el) || el.closest('svg')) return;
        const b = el.getBoundingClientRect(); if (!vis(b) || b.height > 32 || b.height < 6 || !shaped(el)) return;
        add(el, b, b.left);
      });
      const sizes = {};
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (tw.nextNode()) {
        const n = tw.currentNode; if (!n.textContent.trim()) continue; const el = n.parentElement;
        if (!el || skipZone(el) || el.closest('svg')) continue;
        const rg = document.createRange(); rg.selectNodeContents(n); const rcs = [...rg.getClientRects()].filter(vis); if (!rcs.length) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize); sizes[fs] = (sizes[fs] || 0) + 1;
        if (done.has(el)) continue;
        for (const rc of rcs) items.push({ x: rc.left, xr: rc.right, y: rc.top, yb: rc.bottom, t: n.textContent.trim().slice(0, 14) });
      }
      const pr = parseFloat(getComputedStyle(root).paddingRight) || 0; return { items, left: rr.left, right: rr.right - pr, sizes };
    });
    const its = r.items.map((i) => ({ ...i, x: Math.round(i.x - r.left), xr: Math.round(i.xr - r.left), y: Math.round(i.y), yb: Math.round(i.yb) }));
    // 덩어리: 세로로 겹치고 가로 24px 안으로 이어지는 요소 묶음
    const groups = []; const used = new Set();
    for (const a of its.sort((p, q) => p.x - q.x)) {
      if (used.has(a)) continue; const g = [a]; used.add(a); let grew = true;
      while (grew) { grew = false; for (const b of its) { if (used.has(b)) continue; if (g.some((m) => b.y < m.yb - 2 && b.yb > m.y + 2 && b.x - m.xr <= 24 && m.x - b.xr <= 24)) { g.push(b); used.add(b); grew = true; } } }
      groups.push({ x: Math.min(...g.map((m) => m.x)), xr: Math.max(...g.map((m) => m.xr)), y: Math.min(...g.map((m) => m.y)), t: g.sort((p, q) => p.x - q.x)[0].t });
    }
    const cluster = (vals) => { const c = []; for (const v of vals.sort((a, b) => a.v - b.v)) { const k = c.find((k) => Math.abs(k.v - v.v) <= 1); if (k) k.n.push(v); else c.push({ v: v.v, n: [v] }); } return c; };
    const rights = cluster(groups.map((g) => ({ v: g.xr, g })));
    const rightLines = rights.filter((c) => c.n.length >= 2);
    const contentRight = Math.round(r.right - r.left);
    const isRightGroup = (g) => (rightLines.some((c) => Math.abs(c.v - g.xr) <= 1) || contentRight - g.xr <= 24) && !groups.some((o) => o !== g && Math.abs(o.x - g.x) <= 1);
    const lefts = cluster(groups.filter((g) => !isRightGroup(g)).map((g) => ({ v: g.x, g })));
    const lines = lefts.filter((c) => c.n.length >= 2), single = lefts.filter((c) => c.n.length === 1);
    const near = []; const all = lefts.map((c) => c.v); for (let i = 1; i < all.length; i++) { const d = all[i] - all[i - 1]; if (d >= 2 && d <= 8) near.push(`${all[i - 1]}↔${all[i]}`); }
    console.log(`\n== ${name} (${w}px): 왼쪽 정렬선 ${lines.length} · 줄 밖 ${single.length} · 거의 맞음 ${near.length} · 오른쪽 끝선 ${rightLines.length} · 글자 크기 ${Object.keys(r.sizes).length}종`);
    console.log('  왼쪽 선 x(덩어리 수):', lines.map((c) => `${c.v}(${c.n.length})`).join(' '));
    if (single.length) console.log('  줄 밖:', single.map((c) => `${c.v}「${c.n[0].g.t}」y${c.n[0].g.y}`).join(' '));
    if (near.length) console.log('  거의 맞음:', near.join(' '));
    console.log('  오른쪽 선:', rightLines.map((c) => `${c.v}(${c.n.length})`).join(' '));
    console.log('  글자 크기:', Object.entries(r.sizes).sort((a, b) => a[0] - b[0]).map(([s, n]) => `${s}×${n}`).join(' '));
    await page.close();
  }
  await browser.close();
})();
