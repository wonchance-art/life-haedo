/* D2 phase 1: the real vendored editor in an isolated document, without app wiring.
 * node tests/post-markdown-editor-browser.cjs
 * Synthetic composition events exercise DOM/model boundaries, not a native Korean IME.
 * No real account, remote service, or production editor integration is used. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright } = require('./unified-home-browser.cjs');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.POST_MARKDOWN_EDITOR_OUTPUT || path.join(root, '.local/post-markdown-editor'));
const origin = 'http://post-markdown.fixture';
const assets = [
  'vendor/markdown-it/markdown-it.umd.min.js',
  'vendor/tiptap/tiptap.umd.min.js',
  'assets/life/post-markdown.js',
  'assets/life/post-markdown-editor.js',
];
const report = { scope: 'standalone editor adapter; not PhotoPostUI integration or native IME', checks: [], consoleErrors: [], pageErrors: [], externalRequests: [] };
const sample = [
  { insert: '가을 기록' }, { insert: '\n', attributes: { header: 1 } },
  { insert: '천천히 ', attributes: { bold: true } },
  { insert: '걷고', attributes: { italic: true } }, { insert: ' 읽었습니다.\n' },
  { insert: '첫 항목' }, { insert: '\n', attributes: { list: 'bullet' } },
  { insert: '둘째 항목' }, { insert: '\n', attributes: { list: 'bullet' } },
  { insert: '인용 문장' }, { insert: '\n', attributes: { blockquote: true } },
  { insert: '자료', attributes: { link: 'https://example.com/read?q=%zz&word=한글' } }, { insert: '\n' },
  { insert: '공백 주소', attributes: { link: 'https://example.com/a b' } }, { insert: '\n' },
  { insert: '역슬래시 주소', attributes: { link: 'https://example.com/a\\b' } }, { insert: '\n' },
  { insert: { photo: { id: 'photo_one', alt: '가을 잎', caption: '공원\n걷던 길' } } },
  { insert: { photo: { id: 'photo_two', alt: '책', caption: '두 번째 사진' } } },
  { insert: 'AI의 제안', attributes: { author: 'ai', bold: true } }, { insert: '\n' },
];
async function main() {
  await fs.mkdir(output, { recursive: true });
  const scripts = new Map(await Promise.all(assets.map(async file => ['/' + file, await fs.readFile(path.join(root, file))])));
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  async function scenario(name, width, run) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { report.externalRequests.push(url.origin); return route.abort(); }
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>D2 editor fixture</title><style>body{margin:24px;font:16px/1.7 sans-serif;color:#203c35}main{max-width:720px;margin:auto}.ProseMirror{white-space:pre-wrap;overflow-wrap:anywhere;outline:1px solid #b8cac2;padding:16px;min-height:160px}img{max-width:100%}figure{margin:16px 0}figcaption{white-space:pre-wrap}span[data-author="ai"]{background:#e7eee8}</style><main><div id="editor"></div></main>${assets.map(file => '<script src="/' + file + '"></script>').join('')}</html>` });
      const body = scripts.get(url.pathname);
      return route.fulfill({ status: body ? 200 : 404, contentType: body ? 'text/javascript' : 'text/plain', body: body || 'not found' });
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push({ name, message: error.message }));
    page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ name, message: event.text() }); });
    page.setDefaultTimeout(10000);
    try {
      await page.goto(origin);
      await page.waitForFunction(() => !!HaedoLife.PostMarkdownEditor);
      await page.evaluate(ops => {
        window.changes = [];
        window.compositions = [];
        window.sampleMarkdown = HaedoLife.PostMarkdown.fromDelta(ops).markdown;
        window.openEditor = markdown => {
          window.adapter?.dispose();
          window.adapter = HaedoLife.PostMarkdownEditor.create({
            element: document.querySelector('#editor'), markdown,
            onChange: value => changes.push(value),
            onCompositionChange: value => compositions.push(value),
          });
        };
        openEditor(sampleMarkdown);
      }, sample);
      await run(page);
      report.checks.push({ name, pass: true }); console.log('PASS ' + name);
    } catch (error) {
      report.checks.push({ name, pass: false, error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack);
      await page.screenshot({ path: path.join(output, 'failure-' + report.checks.length + '.png'), fullPage: true }).catch(() => {});
    } finally { await context.close(); }
  }
  try {
    for (const width of [390, 1440]) {
      await scenario(width + ': formatting, AI, consecutive photos, serialization and reopen preserve the canonical body', width, async page => {
        const actual = await page.evaluate(() => ({ markdown: adapter.getMarkdown(), expected: sampleMarkdown, text: adapter.editor.getText(), photos: adapter.editor.getJSON().content.filter(n => n.type === 'photo').map(n => n.attrs) }));
        assert.equal(actual.markdown, actual.expected);
        assert.match(actual.text, /가을 기록/);
        assert.equal(actual.photos.length, 2);
        assert.equal(actual.photos[0].caption, '공원\n걷던 길');
        await page.evaluate(() => { localStorage.setItem('fixture-markdown', adapter.getMarkdown()); openEditor(localStorage.getItem('fixture-markdown')); });
        assert.equal(await page.evaluate(() => adapter.getMarkdown()), actual.expected);
        assert.equal(await page.locator('[data-author="ai"]').count(), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await page.screenshot({ path: path.join(output, 'editor-' + width + '.png'), fullPage: true });
      });
      await scenario(width + ': 500-character Korean paste, undo and redo survive recreation', width, async page => {
        await page.evaluate(() => openEditor('&nbsp;\n'));
        const value = '가나다라마바사아자차'.repeat(50);
        await page.locator('.ProseMirror').click();
        await page.evaluate(value => {
          const data = new DataTransfer(); data.setData('text/plain', value);
          document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        }, value);
        assert.equal(await page.evaluate(() => adapter.editor.getText()), value);
        const saved = await page.evaluate(() => adapter.getMarkdown());
        await page.evaluate(() => adapter.editor.commands.undo());
        assert.equal(await page.evaluate(() => adapter.editor.getText()), '');
        await page.evaluate(() => adapter.editor.commands.redo());
        assert.equal(await page.evaluate(() => adapter.editor.getText()), value);
        await page.evaluate(saved => openEditor(saved), saved);
        assert.equal(await page.evaluate(() => adapter.editor.getText()), value);
      });
      await scenario(width + ': composition blocks replacement and publishes the final Korean text', width, async page => {
        await page.evaluate(() => openEditor('입력\n'));
        await page.locator('.ProseMirror').click();
        await page.evaluate(() => {
          const node = document.querySelector('.ProseMirror');
          window.beforeComposition = changes.length;
          node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
          node.querySelector('p').firstChild.textContent = '입력ㅎ';
          node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: 'ㅎ' }));
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        const during = await page.evaluate(() => {
          let rejected = false;
          try { adapter.setMarkdown('늦은 응답\n'); } catch (_) { rejected = true; }
          return { rejected, composing: adapter.isComposing(), text: document.querySelector('.ProseMirror').innerText, published: changes.length - beforeComposition };
        });
        assert.equal(during.rejected, true, 'programmatic replacement must be refused during composition');
        assert.equal(during.composing, true);
        assert.match(during.text, /입력ㅎ/);
        assert.equal(during.published, 0, 'partial composition must not be emitted as committed content');
        await page.evaluate(() => {
          const node = document.querySelector('.ProseMirror');
          node.querySelector('p').firstChild.textContent = '입력한글';
          node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText', data: '한글' }));
          node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '한글' }));
        });
        await page.waitForFunction(() => !adapter.isComposing() && adapter.editor.getText() === '입력한글');
        await page.waitForFunction(() => changes.length > beforeComposition);
        assert.equal(await page.evaluate(() => adapter.getMarkdown()), '입력한글\n');
        assert.deepEqual(await page.evaluate(() => compositions.slice(-2)), [true, false]);
      });
    }
    await scenario('stale AI selection is refused; accepted text is marked and survives undo', 390, async page => {
      await page.evaluate(() => {
        openEditor('처음 문장\n');
        adapter.editor.commands.setTextSelection({ from: 1, to: 3 });
        window.selected = adapter.selection();
        adapter.editor.commands.setTextSelection({ from: 4, to: 6 });
      });
      const refused = await page.evaluate(() => {
        try { adapter.replaceSelection(selected, '바뀐 문장', { ai: true }); return false; }
        catch (error) { return error.code === 'stale_selection'; }
      });
      assert.equal(refused, true);
      assert.equal(await page.evaluate(() => adapter.getMarkdown()), '처음 문장\n');
      await page.evaluate(() => adapter.replaceSelection(adapter.selection(), '제안', { ai: true }));
      assert.equal(await page.locator('[data-author="ai"]').innerText(), '제안');
      const saved = await page.evaluate(() => adapter.getMarkdown());
      await page.evaluate(() => adapter.editor.commands.undo());
      assert.equal(await page.evaluate(() => adapter.getMarkdown()), '처음 문장\n');
      await page.evaluate(saved => openEditor(saved), saved);
      assert.equal(await page.locator('[data-author="ai"]').innerText(), '제안');
    });
    await scenario('rich paste does not create external images or unsafe links', 1440, async page => {
      await page.evaluate(() => openEditor('&nbsp;\n'));
      await page.locator('.ProseMirror').click();
      await page.evaluate(() => {
        const data = new DataTransfer();
        data.setData('text/html', '<p><b>보존할 글자</b><a href="javascript:alert(1)">안전한 글자</a><img src="https://external.example/private.png"><span data-author="ai">AI 표시</span></p>');
        data.setData('text/plain', '보존할 글자안전한 글자AI 표시');
        document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      });
      assert.equal(await page.locator('.ProseMirror img').count(), 0);
      assert.equal(await page.locator('.ProseMirror a').count(), 0);
      assert.match(await page.evaluate(() => adapter.editor.getText()), /보존할 글자안전한 글자AI 표시/);
      assert.equal(await page.locator('.ProseMirror strong').innerText(), '보존할 글자');
      assert.doesNotMatch(await page.evaluate(() => adapter.getMarkdown()), /javascript:|external\.example/);
    });
    for (const width of [390, 1440]) await scenario(width + ': typing a non-one list start and pasting ordered lists stay serializable', width, async page => {
      await page.evaluate(() => openEditor('&nbsp;\n'));
      await page.locator('.ProseMirror').click();
      await page.locator('.ProseMirror').pressSequentially('2. 항목');
      const typed = await page.evaluate(() => ({ markdown: adapter.getMarkdown(), text: adapter.editor.getText() }));
      assert.equal(typed.text, '2. 항목', 'unsupported numbering stays literal while typing');
      await page.evaluate(saved => openEditor(saved), typed.markdown);
      assert.equal(await page.evaluate(() => adapter.getMarkdown()), typed.markdown);
      await page.evaluate(() => openEditor('보존할 문장\n'));
      await page.locator('.ProseMirror').click();
      for (const html of [
        '<ol start="2"><li>붙인 항목</li><li>다음 항목</li></ol>',
        '<ol start="5"><li>다섯째</li></ol>',
        '<ol type="a"><li>알파벳 번호</li></ol>',
        '<ol reversed><li>거꾸로 번호</li></ol>',
        '<ol><li type="a">항목의 문자 번호</li></ol>',
      ]) {
        await page.evaluate(html => {
          const data = new DataTransfer();
          data.setData('text/html', html); data.setData('text/plain', '지원하지 않는 번호 항목');
          document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        }, html);
        assert.equal(await page.evaluate(() => adapter.editor.getText()), '보존할 문장', 'unsupported pasted numbering must not replace the existing content: ' + html);
        assert.ok((await page.getByRole('alert').innerText()).trim(), 'rejected paste must be explained');
      }
      const pasted = await page.evaluate(() => ({ markdown: adapter.getMarkdown(), text: adapter.editor.getText() }));
      assert.equal(await page.evaluate(() => adapter.getCommittedMarkdown()), pasted.markdown);
      await page.evaluate(saved => openEditor(saved), pasted.markdown);
      assert.equal(await page.evaluate(() => adapter.getMarkdown()), pasted.markdown);
      await page.evaluate(() => adapter.editor.commands.setContent({ type: 'doc', content: [{ type: 'orderedList', attrs: { start: 2 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '잘못된 적용' }] }] }] }] }));
      assert.equal(await page.evaluate(() => adapter.getMarkdown()), pasted.markdown, 'an unsupported programmatic document must be rejected before mutation');
      await page.evaluate(() => openEditor('&nbsp;\n'));
      await page.locator('.ProseMirror').click();
      await page.locator('.ProseMirror').pressSequentially('1. 항목');
      assert.equal(await page.evaluate(() => adapter.getMarkdown()), '1. 항목\n');
    });
    await scenario('a selection from a disposed editor cannot replace text in a new editor', 390, async page => {
      await page.evaluate(() => {
        openEditor('이전 문장\n');
        adapter.editor.commands.setTextSelection({ from: 1, to: 3 });
        window.oldEditorSelection = adapter.selection();
        openEditor('다음 문장\n');
        adapter.editor.commands.setTextSelection({ from: 1, to: 3 });
      });
      const rejected = await page.evaluate(() => {
        try { adapter.replaceSelection(oldEditorSelection, '늦은 AI 응답', { ai: true }); return false; }
        catch (error) { return error.code === 'stale_selection'; }
      });
      assert.equal(rejected, true, 'a snapshot belongs only to the editor that issued it');
      assert.equal(await page.evaluate(() => adapter.getMarkdown()), '다음 문장\n');
      assert.equal(await page.locator('[data-author="ai"]').count(), 0);
    });
    assert.deepEqual(report.pageErrors, [], 'no page errors');
    assert.deepEqual(report.consoleErrors, [], 'no console errors');
    assert.deepEqual(report.externalRequests, [], 'no external media requests');
  } finally {
    await browser.close();
    report.pass = report.checks.length === 11 && report.checks.every(check => check.pass) && !report.pageErrors.length && !report.consoleErrors.length && !report.externalRequests.length;
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  if (!report.pass) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
