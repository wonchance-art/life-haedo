/* A life-post-md-v1 post in the current (Quill) editor, before B2 (2026-11-24).
 * - Read view, HTML reading file, photo viewer and list cover of an md-v1 post draw what the v2
 *   post of the same content draws (photos, captions, attachments, AI marks).
 * - A post restored from an md-v1 ZIP is edited, autosaved and saved as md-v1 again, and reopens
 *   the same. Its editor offers no underline or alignment (the format has neither).
 * - A codec refusal (fault injected: the Quill editor cannot produce the refused shapes) stores
 *   nothing: the input stays in the editor and in this device's recovery copy, the stored post
 *   is unchanged and no v2 document is written for it.
 * Real app, synthetic Auth (FakeCloud), real IndexedDB, anonymous samples; Linux Chromium at
 * 1440 and 390px. Not an Apple device or production account check.
 * npm run dev; node tests/photo-post-markdown-edit-browser.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { playwright, makeContext, ready } = require('./unified-home-browser.cjs');
const { FakeCloud, accounts, cloud, base } = require('./life-sync-browser.cjs');
const { openPost } = require('./photo-post-entry.cjs');
const { openCompatibility } = require('./page-composer-entry.cjs');
const { unzipSync, strFromU8 } = require('../vendor/fflate/fflate.js');
const { awaitCondition } = require('./helpers/await-condition.cjs');
const out = path.resolve(process.env.PHOTO_POST_MARKDOWN_EDIT_OUTPUT || '.local/photo-post-markdown-edit');
// A restored copy gets new photo ids (readBackup remaps them); the body is otherwise the same.
const body = markdown => markdown.replace(/haedo-photo:[A-Za-z0-9_-]+/g, 'haedo-photo:ID');
const report = { scope: 'Linux Chromium; synthetic Auth, real IndexedDB, anonymous samples; no Apple device or production account', checks: [], consoleErrors: [], pageErrors: [], external: [] };

async function flow(browser, width) {
  const label = 'w' + width;
  const context = await makeContext(browser, new FakeCloud(), 'markdown-edit-' + width, accounts.a, { viewport: { width, height: 1000 }, hasTouch: width < 500 });
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if ([new URL(base).origin, cloud].includes(u.origin) || ['blob:', 'data:'].includes(u.protocol)) return route.fallback();
    report.external.push(u.origin); return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.pageErrors.push({ label, message: error.message }));
  page.on('console', event => { if (event.type() === 'error') report.consoleErrors.push({ label, message: event.text() }); });
  page.on('dialog', dialog => dialog.accept());
  const check = async (name, task) => {
    console.log('START ' + label + ': ' + name);
    try { await task(); report.checks.push({ label, name, pass: true }); console.log('PASS ' + label + ': ' + name); }
    catch (error) { report.checks.push({ label, name, pass: false, error: error.message }); await page.screenshot({ path: path.join(out, label + '-failure.png') }).catch(() => {}); throw error; }
  };
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const more = async name => {
    const menu = page.locator('.photo-more').first();
    if (!await menu.evaluate(n => n.open)) await menu.locator(':scope > summary').click();
    await click(name);
  };
  const go = async () => {
    await page.goto(base + '/index.html?section=records&view=page', { waitUntil: 'domcontentloaded' }); await ready(page);
    await openCompatibility(page);
    await page.getByRole('button', { name: '글쓰기', exact: true }).waitFor();
  };
  const docs = () => page.evaluate(async () => {
    const s = HaedoLife.Shell.storage, w = await s.getActive();
    return Promise.all((await s.listPhotoPosts(w)).map(async row => {
      const d = await s.readPhotoPost(w, row.id);
      return { id: d.id, format: d.format, status: d.status, archived: d.archived, revision: d.revision, replaces: d.replaces, title: d.title, markdown: d.markdown, ops: d.ops,
        photos: d.photos.map(p => p.digest), attachments: d.attachments };
    }));
  });
  const stored = () => page.waitForFunction(() => document.querySelector('.photo-commandbar .photo-status')?.textContent === '자동 저장됨');
  // The reading article without what differs between two stored posts: blob URLs, photo ids and the dated footer.
  const article = () => page.evaluate(() => {
    const a = document.querySelector('.photo-article').cloneNode(true);
    a.querySelector('footer')?.remove();
    a.querySelectorAll('img[src]').forEach(n => n.removeAttribute('src'));
    a.querySelectorAll('[data-photo-id]').forEach(n => n.removeAttribute('data-photo-id'));
    return a.innerHTML;
  });
  const downloadBytes = async action => {
    const pending = page.waitForEvent('download'); pending.catch(() => {});
    await action(); const file = await pending;
    return fs.readFile(await file.path());
  };
  const download = async action => (await downloadBytes(action)).toString('utf8');
  const exportHTML = () => download(async () => {
    await page.locator('.photo-read-actions .photo-more > summary').click();
    await click('HTML 읽기 파일 받기');
  });
  const editorText = () => page.evaluate(() => Quill.find(document.querySelector('.photo-quill')).getText());
  try {
    await go();
    // One v2 post and an md-v1 ZIP of the same content (PostMarkdown.fromV2 of it).
    const seed = await page.evaluate(async () => {
      const s = HaedoLife.Shell.storage, c = HaedoLife.Core, M = HaedoLife.PhotoPost, w = await s.getActive(), photos = [];
      for (const [x, y, color] of [[320, 200, '#9b2929'], [200, 300, '#276b4d']]) {
        const canvas = document.createElement('canvas'); canvas.width = x; canvas.height = y;
        const g = canvas.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, x, y);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        photos.push(await M.readPhoto(new File([blob], 'anonymous-' + x + '.png', { type: blob.type }), c.id));
      }
      const v2 = M.create(c.id, '2026-11-20T03:00:00.000Z');
      Object.assign(v2, { status: 'saved', title: '익명 Markdown 글', photos,
        attachments: [{ type: 'book', title: '익명 책', creator: '익명 저자', url: 'https://example.org/book' }],
        ops: [{ insert: '첫 문단 ' }, { insert: '굵게', attributes: { bold: true } }, { insert: ' 와 ' }, { insert: '기울임', attributes: { italic: true } },
          { insert: ' 그리고 ' }, { insert: '링크', attributes: { link: 'https://example.org/a?b=1&c=2' } }, { insert: '.\n' },
          { insert: '작은 제목' }, { insert: '\n', attributes: { header: 2 } },
          { insert: 'AI가 쓴 문장', attributes: { author: 'ai' } }, { insert: ' 뒤의 내 문장.\n' },
          { insert: '목록 하나' }, { insert: '\n', attributes: { list: 'bullet' } }, { insert: '목록 둘' }, { insert: '\n', attributes: { list: 'bullet' } },
          { insert: '인용 문장' }, { insert: '\n', attributes: { blockquote: true } },
          { insert: { photo: { id: photos[0].id, caption: '첫 사진 설명', alt: '익명 풍경 1' } } },
          { insert: '사진 사이 문단\n' },
          { insert: { photo: { id: photos[1].id, caption: '둘째 설명\n줄바꿈', alt: '익명 풍경 2' } } }, { insert: '\n' }] });
      M.validate(v2);
      const md = HaedoLife.PostMarkdown.fromV2(v2).document;
      M.validate(md);
      const saved = await s.savePhotoPost(w, v2, 0), zip = await M.backup(md);
      return { v2Id: saved.id, markdown: md.markdown, digests: photos.map(p => p.digest), zip: Array.from(new Uint8Array(await zip.arrayBuffer())) };
    });
    assert.match(seed.markdown, /<span data-author="ai">AI가 쓴 문장<\/span>/);
    let mdId;

    await check('an md-v1 ZIP restores into the editor; saving keeps md-v1 and the read view shows body and photos', async () => {
      await go();
      if (!await page.locator('.photo-files').evaluate(n => n.open)) await page.locator('.photo-files > summary').click();
      await page.getByLabel('사진 글 ZIP 백업', { exact: true }).setInputFiles({ name: 'markdown.zip', mimeType: 'application/zip', buffer: Buffer.from(seed.zip) });
      await click('새 초안으로 복원');
      await page.locator('.ql-editor').waitFor();
      assert.match(await editorText(), /첫 문단 굵게 와 기울임 그리고 링크\.\n작은 제목\nAI가 쓴 문장 뒤의 내 문장\./);
      assert.equal(await page.locator('.photo-quill .photo-block').count(), 2);
      assert.equal(await page.locator('.photo-toolbar .ql-underline, .photo-toolbar .ql-align').count(), 0, 'no underline or alignment for a Markdown post');
      const draft = (await docs()).find(d => d.id !== seed.v2Id);
      assert.equal(draft.format, 'life-post-md-v1'); assert.equal(draft.status, 'draft'); assert.equal(body(draft.markdown), body(seed.markdown));
      await page.screenshot({ path: path.join(out, label + '-editor.png') });
      await click('글 저장'); await page.locator('.photo-article').waitFor();
      const all = await docs(), post = all.find(d => d.id !== seed.v2Id);
      assert.equal(all.length, 2); assert.equal(post.format, 'life-post-md-v1'); assert.equal(post.status, 'saved');
      assert.equal(body(post.markdown), body(seed.markdown)); assert.deepEqual(post.photos, seed.digests);
      mdId = post.id;
      const text = await page.locator('.photo-article').innerText();
      for (const part of ['첫 문단', '작은 제목', 'AI가 쓴 문장', '목록 둘', '인용 문장', '첫 사진 설명', '사진 사이 문단', '익명 책'])
        assert(text.includes(part), 'read view shows ' + part);
      await page.waitForFunction(() => [...document.querySelectorAll('.photo-article img')].filter(i => i.complete && i.naturalWidth > 0).length === 2);
      await page.screenshot({ path: path.join(out, label + '-read.png'), fullPage: true });
    });

    await check('read view, HTML reading file, photo viewer and list cover of md-v1 match the v2 post of the same content', async () => {
      const mdArticle = await article();
      assert.equal(await page.locator('.photo-article .blog-ai-text').innerText(), 'AI가 쓴 문장');
      const mdHTML = await exportHTML();
      await page.locator('.photo-article .photo-expand').first().click();
      const viewer = page.locator('dialog.photo-viewer');
      await viewer.waitFor();
      assert.match(await viewer.locator('.photo-viewer-position').innerText(), /1\D+2/);
      assert.equal(await viewer.locator('h2').innerText(), '첫 사진 설명');
      await click('다음 사진');
      assert.match(await viewer.locator('h2').innerText(), /^둘째 설명/);
      await click('사진 닫기'); await viewer.waitFor({ state: 'detached' }).catch(() => viewer.waitFor({ state: 'hidden' }));
      await click('사진 글 목록');
      const cover = page.locator('[data-photo-post-id="' + mdId + '"] img.photo-entry-cover');
      await cover.scrollIntoViewIfNeeded();
      await page.waitForFunction(id => {
        const image = document.querySelector('[data-photo-post-id="' + id + '"] img.photo-entry-cover');
        return image?.getAttribute('src')?.startsWith('blob:') && image.complete && image.naturalWidth === 320;
      }, mdId);
      await openPost(page, seed.v2Id); await page.locator('.photo-article').waitFor();
      assert.equal(await article(), mdArticle, 'the md-v1 read view draws what the v2 one draws');
      const v2HTML = await exportHTML();
      assert.equal(mdHTML, v2HTML, 'the md-v1 HTML reading file is the v2 one');
      assert(mdHTML.includes('첫 사진 설명') && !mdHTML.includes('blob:') && !mdHTML.includes('data-author'), 'HTML file has captions, no runtime URLs or AI marks');
      await click('사진 글 목록');
    });

    await check('editing the md-v1 post autosaves an md-v1 draft and saves md-v1 again, which reopens the same', async () => {
      const source = (await docs()).find(d => d.id === mdId);
      await openPost(page, mdId); await page.locator('.photo-article').waitFor();
      await click('글 수정'); await page.locator('.ql-editor').waitFor();
      assert.equal(await page.locator('.photo-toolbar .ql-underline, .photo-toolbar .ql-align').count(), 0);
      await page.evaluate(() => { const q = Quill.find(document.querySelector('.photo-quill')); q.focus(); q.setSelection(q.getText().indexOf('.\n작은'), 0, 'user'); });
      await page.keyboard.type(' 덧붙인 말');
      await stored();
      const draft = (await docs()).find(d => d.status === 'draft');
      assert.equal(draft.format, 'life-post-md-v1'); assert.deepEqual(draft.replaces, { id: mdId, revision: source.revision });
      assert.match(draft.markdown, /\[링크\]\(https:\/\/example\.org\/a\?b=1\\&c=2\) 덧붙인 말\./);
      await page.screenshot({ path: path.join(out, label + '-edit.png') });
      await click('글 저장'); await page.locator('.photo-article').waitFor();
      const all = await docs(), post = all.find(d => d.id !== seed.v2Id);
      assert.equal(all.length, 2, 'the revision replaced the post');
      assert.equal(post.format, 'life-post-md-v1'); assert.equal(post.status, 'saved'); assert.equal(post.replaces, null);
      assert.equal(body(post.markdown), body(seed.markdown).replace('.\n\n## 작은', ' 덧붙인 말.\n\n## 작은'));
      assert.deepEqual(post.photos, seed.digests); assert.deepEqual(post.attachments, all.find(d => d.id === seed.v2Id).attachments);
      mdId = post.id;
      await go(); await openPost(page, mdId); await page.locator('.photo-article').waitFor();
      assert.match(await page.locator('.photo-article').innerText(), /링크 덧붙인 말\./);
      assert.equal(await page.locator('.photo-article .blog-ai-text').innerText(), 'AI가 쓴 문장');
      await click('글 수정'); await page.locator('.ql-editor').waitFor();
      assert.match(await editorText(), /링크 덧붙인 말\.\n작은 제목\n/);
      await click('닫기'); await page.locator('[data-photo-post-id="' + mdId + '"]').waitFor({ state: 'attached' });
      assert.equal((await docs()).length, 2, 'closing an unchanged revision leaves nothing');
    });

    await check('a codec refusal stores nothing, keeps the input and the device copy, and never writes v2 over md', async () => {
      const before = await docs();
      await openPost(page, mdId); await page.locator('.photo-article').waitFor();
      await click('글 수정'); await page.locator('.ql-editor').waitFor();
      await page.evaluate(() => {
        const original = HaedoLife.PostMarkdown;
        window.__restoreCodec = () => { HaedoLife.PostMarkdown = original; };
        HaedoLife.PostMarkdown = Object.freeze({ ...original, fromV2() {
          throw Object.assign(new Error('사진 앞 문단의 공개 모양을 그대로 옮길 수 없어 변환하지 않았습니다. 원래 글은 바뀌지 않았습니다.'), { code: 'post_markdown_conversion_boundary' });
        } });
      });
      await page.evaluate(() => { const q = Quill.find(document.querySelector('.photo-quill')); q.focus(); q.setSelection(0, 0, 'user'); });
      await page.keyboard.type('거부될 입력 ');
      await page.waitForFunction(() => document.querySelector('.photo-commandbar .photo-status')?.textContent.startsWith('이 기기에만 임시 보관 중'));
      assert.match(await page.locator('.photo-commandbar .photo-status').innerText(), /이 글의 형식으로 보관할 수 없습니다/);
      const copy = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('haedo_life_post_recovery_v1:')).map(k => localStorage.getItem(k)).find(v => v.includes('거부될 입력')) || null);
      assert(copy, 'the device recovery copy holds the input');
      assert.deepEqual(await docs(), before, 'nothing was stored');
      await click('글 저장');
      await page.locator('.photo-commandbar .photo-status[role=alert]').waitFor();
      assert.match(await page.locator('.photo-commandbar .photo-status').innerText(), /저장하지 못했습니다/);
      const recovery = page.locator('.photo-recovery-actions');
      assert.equal(await recovery.isVisible(), true);
      assert.match(await recovery.locator('.photo-recovery-reason').innerText(), /사진 앞 문장 끝에서 줄을 바꿔 주세요/);
      assert.equal(await recovery.getByRole('button', { name: '현재 입력 백업', exact: true }).isVisible(), true);
      assert.deepEqual(await docs(), before, 'the explicit save stored nothing');
      assert.match(await editorText(), /^거부될 입력 첫 문단/);
      await page.screenshot({ path: path.join(out, label + '-refusal.png') });
      await page.evaluate(() => window.__restoreCodec());
      await recovery.getByRole('button', { name: '다시 보관', exact: true }).click();
      await stored();
      const draft = (await docs()).find(d => d.status === 'draft');
      assert.equal(draft.format, 'life-post-md-v1'); assert.match(draft.markdown, /^거부될 입력 첫 문단/);
      await click('글 저장'); await page.locator('.photo-article').waitFor();
      const all = await docs();
      assert.equal(all.length, 2);
      assert.deepEqual(all.map(d => d.format).sort(), ['life-photo-post-v2', 'life-post-md-v1']);
      assert.equal(all.find(d => d.format === 'life-photo-post-v2').id, seed.v2Id, 'the only v2 document is the separate v2 post');
      assert.match(all.find(d => d.format === 'life-post-md-v1').markdown, /^거부될 입력 첫 문단/);
      mdId = all.find(d => d.format === 'life-post-md-v1').id;
    });

    // Opens the md post's revision in the editor (a draft left for it opens instead).
    const edit = async id => {
      await go(); await openPost(page, id); await page.locator('.photo-article').waitFor();
      await click('글 수정'); await page.locator('.ql-editor').waitFor();
    };
    const typeAt = async (where, text) => {
      await page.evaluate(where => { const q = Quill.find(document.querySelector('.photo-quill')); q.focus(); q.setSelection(where === 'end' ? q.getLength() - 1 : where, 0, 'user'); }, where);
      await page.keyboard.type(text);
    };
    const inject = () => page.evaluate(() => {
      const original = HaedoLife.PostMarkdown;
      window.__restoreCodec = () => { HaedoLife.PostMarkdown = original; };
      HaedoLife.PostMarkdown = Object.freeze({ ...original, fromV2() {
        throw Object.assign(new Error('본문이나 서식이 많아 이 글을 새 편집기로 바꿀 수 없습니다. 원래 글은 바뀌지 않았습니다.'), { code: 'post_markdown_conversion_limit' });
      } });
    });
    const deviceCopy = text => page.evaluate(text => Object.keys(localStorage).filter(k => k.startsWith('haedo_life_post_recovery_v1:')).some(k => localStorage.getItem(k).includes(text)), text);
    const note = () => page.locator('.photo-edit-note:not(.photo-ai-hint)').textContent();
    // An md post and a v2 revision draft an earlier app version left for it (stored directly).
    const legacy = (title, draftOps) => page.evaluate(async ([title, draftOps]) => {
      const s = HaedoLife.Shell.storage, c = HaedoLife.Core, M = HaedoLife.PhotoPost, w = await s.getActive();
      const v2 = M.create(c.id, '2026-11-20T03:00:00.000Z');
      Object.assign(v2, { status: 'saved', title, ops: [{ insert: '원래 글\n' }] });
      const post = await s.savePhotoPost(w, HaedoLife.PostMarkdown.fromV2(v2).document, 0);
      const draft = M.create(c.id, '2026-11-21T03:00:00.000Z');
      Object.assign(draft, { title, status: 'draft', replaces: { id: post.id, revision: post.revision }, ops: draftOps });
      return { postId: post.id, draftId: (await s.savePhotoPost(w, draft, 0)).id };
    }, [title, draftOps]);

    await check('an old v2 revision draft of an md post keeps its underline and alignment in one recovery copy, with a notice', async () => {
      const ids = await legacy('익명 옛 초안', [{ insert: '밑줄 글', attributes: { underline: true } }, { insert: ' 보통\n' }, { insert: '가운데' }, { insert: '\n', attributes: { align: 'center' } }]);
      await edit(ids.postId);
      assert.equal(await note(), '밑줄·정렬은 이 형식에 없어 저장할 때 빠집니다. 원래 판은 복구 사본으로 남깁니다.');
      assert.equal(await page.locator('.photo-toolbar .ql-underline, .photo-toolbar .ql-align').count(), 0);
      await typeAt('end', '덧'); await stored();
      assert.equal(await note(), '밑줄·정렬은 이 형식에 없어 빠집니다. 원래 판은 복구 사본으로 남겼습니다.');
      let all = await docs();
      const draft = all.find(d => d.id === ids.draftId), copies = all.filter(d => d.title === '복구 사본 · 익명 옛 초안');
      assert.equal(draft.format, 'life-post-md-v1'); assert.equal(draft.markdown, '밑줄 글 보통\n\n가운데덧\n');
      assert.equal(copies.length, 1); assert.equal(copies[0].format, 'life-photo-post-v2'); assert.equal(copies[0].replaces, null);
      assert.deepEqual(copies[0].ops, [{ insert: '밑줄 글', attributes: { underline: true } }, { insert: ' 보통\n' }, { insert: '가운데' }, { insert: '\n', attributes: { align: 'center' } }]);
      await typeAt('end', '말'); await stored();
      await click('글 저장'); await page.locator('.photo-article').waitFor();
      all = await docs();
      assert.equal(all.filter(d => d.title === '복구 사본 · 익명 옛 초안').length, 1, 'one copy, kept once');
      const post = all.find(d => d.title === '익명 옛 초안');
      assert.equal(post.format, 'life-post-md-v1'); assert.equal(post.status, 'saved'); assert.equal(post.markdown, '밑줄 글 보통\n\n가운데덧말\n');
      assert.equal(all.some(d => d.id === ids.postId), false, 'the revision replaced the post');
    });

    await check('an old v2 revision draft with nothing to drop is stored as md without a copy, also over a revision moved elsewhere', async () => {
      const ids = await legacy('익명 옛 보통 초안', [{ insert: '보통 글\n' }]);
      await edit(ids.postId);
      assert.equal(await note(), '');
      // Another tab stores the same v2 draft again (only its revision moves) while input waits
      // here: the input is stored over it and, holding nothing new, it is not kept.
      await page.evaluate(async id => {
        const q = Quill.find(document.querySelector('.photo-quill')); q.insertText(q.getLength() - 1, '가', 'user');
        const s = HaedoLife.Shell.storage, w = await s.getActive(), d = await s.readPhotoPost(w, id); await s.savePhotoPost(w, d, d.revision);
      }, ids.draftId);
      await stored();
      const all = await docs(), draft = all.find(d => d.id === ids.draftId);
      assert.equal(draft.format, 'life-post-md-v1'); assert.equal(draft.markdown, '보통 글가\n');
      assert.equal(all.filter(d => d.title.startsWith('복구 사본 · 익명 옛 보통')).length, 0, 'nothing to keep: no recovery copy');
      await click('글 저장'); await page.locator('.photo-article').waitFor();
      assert.equal((await docs()).find(d => d.title === '익명 옛 보통 초안').format, 'life-post-md-v1');
    });

    await check('typing and removing it again leaves no draft of the md post once the editor closes', async () => {
      const before = await docs();
      await edit(mdId);
      await typeAt(0, 'x'); await stored();
      assert.equal((await docs()).length, before.length + 1, 'the change was stored as a draft');
      await page.keyboard.press('Backspace'); await stored();
      await click('닫기'); await page.locator('[data-photo-post-id="' + mdId + '"]').waitFor({ state: 'attached' });
      // Leaving removes the draft (BlogSync's deletion record first): wait for the list to settle.
      await awaitCondition(page, async n => { const s = HaedoLife.Shell.storage; return (await s.listPhotoPosts(await s.getActive())).length === n; }, before.length, { timeout: 15000, label: 'the unchanged revision is removed' });
      assert.deepEqual(await docs(), before, 'a revision that holds what the post holds is not kept');
    });

    await check('an md draft from a ZIP: 사본으로 이어 쓰기 and 목록에서 숨기기 store md-v1; the editor backup is md', async () => {
      await go();
      if (!await page.locator('.photo-files').evaluate(n => n.open)) await page.locator('.photo-files > summary').click();
      await page.getByLabel('사진 글 ZIP 백업', { exact: true }).setInputFiles({ name: 'markdown.zip', mimeType: 'application/zip', buffer: Buffer.from(seed.zip) });
      await click('새 초안으로 복원'); await page.locator('.ql-editor').waitFor();
      const restored = (await docs()).find(d => d.status === 'draft' && d.title === '익명 Markdown 글');
      assert.equal(restored.format, 'life-post-md-v1');
      const zip = unzipSync(new Uint8Array(await downloadBytes(() => more('사진 포함 백업'))));
      const manifest = JSON.parse(strFromU8(zip['manifest.json']));
      assert.equal(manifest.format, 'life-post-md-backup-v1', 'the editor backup of an md draft is md');
      assert.equal(body(manifest.markdown), body(restored.markdown));
      const before = new Set((await docs()).map(d => d.id));
      await more('사본으로 이어 쓰기'); await page.locator('.ql-editor').waitFor();
      await page.waitForFunction(n => document.querySelectorAll('.photo-quill .photo-block').length === n, 2);
      const copy = (await docs()).find(d => !before.has(d.id));
      assert.equal(copy.format, 'life-post-md-v1', 'the copy keeps the format'); assert.equal(copy.status, 'draft');
      assert.equal(body(copy.markdown), body(restored.markdown));
      await more('목록에서 숨기기'); await page.locator('.photo-article').waitFor();
      const hidden = (await docs()).find(d => d.id === copy.id);
      assert.equal(hidden.format, 'life-post-md-v1'); assert.equal(hidden.archived, true);
    });

    await check('a refused input: 사본으로 이어 쓰기 keeps it as a new v2 draft and the md post stays as it was', async () => {
      const before = (await docs()).find(d => d.id === mdId);
      await edit(mdId); await inject();
      await typeAt(0, '사본 입력 ');
      await page.waitForFunction(() => document.querySelector('.photo-commandbar .photo-status')?.textContent.startsWith('이 기기에만 임시 보관 중'));
      const ids = new Set((await docs()).map(d => d.id));
      await more('사본으로 이어 쓰기'); await page.locator('.ql-editor').waitFor();
      const copy = (await docs()).find(d => !ids.has(d.id));
      assert.equal(copy.format, 'life-photo-post-v2'); assert.equal(copy.replaces, null);
      assert.match(copy.ops.map(op => typeof op.insert === 'string' ? op.insert : '').join(''), /^사본 입력 거부될 입력 첫 문단/);
      assert.deepEqual((await docs()).find(d => d.id === mdId), before, 'the md post is unchanged');
      await page.evaluate(() => window.__restoreCodec());
      await click('닫기');
    });

    await check('a refusal at 글 저장 after a stored draft keeps the input in this device copy', async () => {
      await edit(mdId);
      await typeAt(0, '저장 직전 '); await stored();
      assert.equal(await deviceCopy('저장 직전'), false, 'a stored draft leaves no device copy');
      const before = await docs();
      await inject();
      await click('글 저장');
      await page.locator('.photo-commandbar .photo-status[role=alert]').waitFor();
      assert.equal(await deviceCopy('저장 직전'), true, 'the refused save wrote the device copy');
      assert.deepEqual(await docs(), before, 'nothing stored');
      await page.evaluate(() => window.__restoreCodec());
      await click('글 저장'); await page.locator('.photo-article').waitFor();
      const post = (await docs()).find(d => d.id !== seed.v2Id && d.title === '익명 Markdown 글' && d.status === 'saved' && !d.archived);
      assert.equal(post.format, 'life-post-md-v1'); assert.match(post.markdown, /^저장 직전 /);
      mdId = post.id;
    });

    await check('an md version stored elsewhere reaches the open editor, which keeps storing md-v1', async () => {
      await edit(mdId);
      await typeAt('end', '가'); await stored();
      const draft = (await docs()).find(d => d.status === 'draft' && d.replaces?.id === mdId);
      const other = await context.newPage();
      await other.goto(base + '/index.html?section=records&view=page', { waitUntil: 'domcontentloaded' }); await ready(other);
      await other.evaluate(async id => {
        const s = HaedoLife.Shell.storage, w = await s.getActive(), d = await s.readPhotoPost(w, id);
        await s.savePhotoPost(w, { ...d, markdown: '다른 탭에서 바꾼 **글** 끝\n', photos: [], updatedAt: new Date().toISOString() }, d.revision);
      }, draft.id);
      await page.waitForFunction(() => Quill.find(document.querySelector('.photo-quill')).getText() === '다른 탭에서 바꾼 글 끝\n');
      assert.equal(await page.locator('.photo-toolbar .ql-underline').count(), 0, 'still the editor of a Markdown post');
      await other.close();
      await typeAt('end', '나'); await stored();
      const now = (await docs()).find(d => d.id === draft.id);
      assert.equal(now.format, 'life-post-md-v1'); assert.equal(now.markdown, '다른 탭에서 바꾼 **글** 끝나\n');
      await more('수정 취소'); await page.locator('.photo-article').waitFor();
    });
  } finally { await context.close(); }
}

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await playwright().chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  report.browser = browser.version();
  try {
    for (const width of [1440, 390]) await flow(browser, width);
    assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.external, []);
    report.pass = true;
  } finally {
    await browser.close();
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
