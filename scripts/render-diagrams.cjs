/* Render documentation diagrams using an isolated Mermaid installation.
 * npm --prefix .local/diagram-render install --ignore-scripts --save-exact mermaid@12.1.0
 * MERMAID_MODULE_DIR=.local/diagram-render/node_modules/mermaid node scripts/render-diagrams.cjs
 * Explicit v3/v4/v5/v6/v7 source: node scripts/render-diagrams.cjs activity_hub_v4.mmd
 * Default renders v3 only; explicit calls write a separate source/set-specific report.
 * Optional: PLAYWRIGHT_MODULE, CHROMIUM_PATH. No application dependency or external fetch.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'docs/diagrams');
const outputDir = path.join(sourceDir, 'rendered');
const evidenceDir = path.join(root, '.local/diagram-render/evidence');
const moduleDir = path.resolve(root, process.env.MERMAID_MODULE_DIR || '.local/diagram-render/node_modules/mermaid');
const playwright = require(process.env.PLAYWRIGHT_MODULE || '/opt/codex/cua_node/lib/node_modules/playwright');

async function main() {
  const packageInfo = JSON.parse(await fs.readFile(path.join(moduleDir, 'package.json'), 'utf8'));
  assert.equal(packageInfo.name, 'mermaid', 'MERMAID_MODULE_DIR must point to the Mermaid package');
  const names = process.argv.length > 2 ? process.argv.slice(2).map(name => path.basename(name))
    : (await fs.readdir(sourceDir)).filter(name => /_v3\.mmd$/.test(name)).sort();
  assert(names.length, 'No diagram sources found');
  assert(names.every(name => /^[a-z0-9_-]+_v[34567]\.mmd$/.test(name)), 'Only v3/v4/v5/v6/v7 documentation diagrams are rendered');
  const reportName = process.argv.length <= 2 ? 'report.json' : names.length === 1
    ? names[0].replace(/\.mmd$/, '.report.json')
    : 'report-' + createHash('sha256').update([...names].sort().join('\n')).digest('hex').slice(0, 16) + '.json';
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(evidenceDir, { recursive: true });
  const report = { renderer: { name: packageInfo.name, version: packageInfo.version, license: packageInfo.license },
    capturedAt: new Date().toISOString(), font: 'Noto Sans CJK KR', environment: 'Linux Chromium; documentation render, not an Apple device test',
    completed: false, diagrams: [], consoleErrors: [], pageErrors: [], externalRequests: [] };
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html lang="ko"><meta charset="utf-8"><title>해도 설계 도식 검증</title><link rel="icon" href="data:,"><style>body{margin:0;background:white;font-family:"Noto Sans CJK KR",sans-serif}#diagram{display:inline-block;padding:16px}svg{display:block}</style><main id="diagram"></main><script type="module">import mermaid from "/mermaid/dist/mermaid.esm.min.mjs";window.mermaid=mermaid;</script></html>');
      return;
    }
    if (!pathname.startsWith('/mermaid/dist/')) { response.writeHead(404); response.end(); return; }
    const file = path.resolve(moduleDir, decodeURIComponent(pathname.slice('/mermaid/'.length)));
    if (!file.startsWith(path.join(moduleDir, 'dist') + path.sep)) { response.writeHead(403); response.end(); return; }
    try {
      const data = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); response.end(data);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    report.browser = browser.version();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      report.externalRequests.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    page.on('pageerror', error => report.pageErrors.push(error.message));
    await page.goto(origin); await page.waitForFunction(() => !!window.mermaid);
    for (const name of names) {
      const source = await fs.readFile(path.join(sourceDir, name), 'utf8');
      const basename = name.slice(0, -4);
      assert(/accTitle\s*:/.test(source) && /accDescr\s*[:{]/.test(source), `${name}: add accessible title and description`);
      const result = await page.evaluate(async ({ source, basename }) => {
        document.querySelector('#diagram').replaceChildren();
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', look: 'classic', htmlLabels: false,
          deterministicIds: true, deterministicIDSeed: basename,
          fontFamily: '"Noto Sans CJK KR", sans-serif',
          themeVariables: { fontFamily: '"Noto Sans CJK KR", sans-serif', fontSize: '16px',
            primaryColor: '#f4f5f7', primaryTextColor: '#20252b', primaryBorderColor: '#616b76',
            lineColor: '#616b76', secondaryColor: '#eaf4ee', tertiaryColor: '#fdf2df',
            clusterBkg: '#ffffff', clusterBorder: '#a2aab2', edgeLabelBackground: '#ffffff' },
          flowchart: { htmlLabels: false, useMaxWidth: false, wrappingWidth: 340, curve: 'basis', padding: 18, nodeSpacing: 36, rankSpacing: 54 } });
        await mermaid.parse(source);
        const rendered = await mermaid.render('diagram-' + basename, source);
        document.querySelector('#diagram').innerHTML = rendered.svg;
        await document.fonts.ready;
        const svg = document.querySelector('#diagram > svg');
        const viewBox = svg.viewBox.baseVal;
        svg.style.maxWidth = 'none';
        svg.setAttribute('width', String(Math.ceil(viewBox.width)));
        svg.setAttribute('height', String(Math.ceil(viewBox.height)));
        const outOfBounds = [], clippedLabels = [];
        for (const text of svg.querySelectorAll('text')) {
          const rect = text.getBBox(), matrix = svg.getScreenCTM().inverse().multiply(text.getScreenCTM());
          const corners = [[rect.x,rect.y], [rect.x+rect.width,rect.y+rect.height]].map(([x,y]) => new DOMPoint(x,y).matrixTransform(matrix));
          if (corners[0].x < viewBox.x - 1 || corners[0].y < viewBox.y - 1 || corners[1].x > viewBox.x + viewBox.width + 1 || corners[1].y > viewBox.y + viewBox.height + 1) outOfBounds.push(text.textContent);
        }
        for (const node of svg.querySelectorAll('.node')) {
          const shape = node.querySelector(':scope > .label-container'), label = node.querySelector(':scope > .label');
          if (!shape || !label) continue;
          const box = shape.getBoundingClientRect(), text = label.getBoundingClientRect();
          if (text.left < box.left - 1 || text.top < box.top - 1 || text.right > box.right + 1 || text.bottom > box.bottom + 1) clippedLabels.push(label.textContent);
        }
        const externalReferences = [...svg.querySelectorAll('[href],[xlink\\:href],image')].map(el => el.getAttribute('href') || el.getAttribute('xlink:href') || '').filter(value => value && !value.startsWith('#'));
        return { svg: new XMLSerializer().serializeToString(svg), title: svg.querySelector('title')?.textContent,
          description: svg.querySelector('desc')?.textContent, width: viewBox.width, height: viewBox.height,
          nodes: svg.querySelectorAll('.node').length, edges: svg.querySelectorAll('.flowchart-link').length,
          textElements: svg.querySelectorAll('text').length, koreanText: /[가-힣]/.test(svg.textContent),
          koreanFontReady: document.fonts.check('16px "Noto Sans CJK KR"', '한글 해도'),
          outOfBounds, clippedLabels, externalReferences, foreignObjects: svg.querySelectorAll('foreignObject').length };
      }, { source, basename });
      assert(result.title && result.description, `${name}: missing SVG accessible text`);
      assert(result.koreanText && result.koreanFontReady, `${name}: Korean text/font missing`);
      assert(result.width > 0 && result.height > 0 && result.textElements > 0, `${name}: empty rendering`);
      assert.equal(result.foreignObjects, 0, `${name}: keep exported diagrams native SVG`);
      assert.deepEqual(result.outOfBounds, [], `${name}: text outside SVG bounds`);
      assert.deepEqual(result.clippedLabels, [], `${name}: text outside node bounds`);
      assert.deepEqual(result.externalReferences, [], `${name}: external SVG resource`);
      await fs.writeFile(path.join(outputDir, basename + '.svg'), result.svg + '\n');
      await page.locator('#diagram').screenshot({ path: path.join(evidenceDir, basename + '.png') });
      const { svg, ...metrics } = result;
      report.diagrams.push({ source: name, sourceSha256: createHash('sha256').update(source).digest('hex'),
        svgSha256: createHash('sha256').update(svg + '\n').digest('hex'), ...metrics });
      console.log(`${name}: ${result.nodes} nodes, ${result.edges} edges; ${Math.ceil(result.width)} × ${Math.ceil(result.height)}; accessible Korean SVG written`);
    }
    assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
    report.completed = true;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    await fs.writeFile(path.join(evidenceDir, reportName), JSON.stringify(report, null, 2) + '\n');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
