/* 2026-11-11 자료 `내 사본 수정` 초안: 입력 전에는 초안을 만들지 않고, 초안이 자료의 현재 판과 어긋나면
 * 고를 수 있는 길(최신 판에서 다시 시작 / 내 입력을 최신 판 위에 새 판으로 저장 / 초안 버리기 / 입력 파일 받기)을 보인다.
 * 휴지통 왕복은 본문과 무관하므로 충돌이 아니다. 휴지통에 있는 동안의 저장은 계속 거절한다.
 * npm run dev; node tests/source-edit-draft-browser.cjs
 * Actual application bytes, synthetic Auth and anonymous fixtures. "Another device" is a second write through the
 * same storage API, not a real second device. Chromium only. */
'use strict';
const fs = require('node:fs/promises');
const R = require('./helpers/records-reader.cjs');
const { assert, settle, frames } = R;
const S = R.suite('source-edit-draft', 'Local Chromium, synthetic Auth, anonymous records. Source-copy edit drafts against a moved, trashed or unchanged material.');
const original = '첫 문단입니다.\n\n둘째 문단입니다. 발췌한 구절이 여기 있습니다.\n\n셋째 문단입니다.';
const excerpt = { start: original.indexOf('발췌한 구절'), end: original.indexOf('발췌한 구절') + '발췌한 구절'.length, topic: '보존', note: '이전 판 메모' };
const typed = original + '\n\n내가 덧붙인 문단.';
const remote = '다른 기기에서 고친 최신 본문입니다.';

async function fixture(options = {}) {
  const opened = await S.open(options);
  const ids = await R.seed(opened.page, [{ title: '수정 초안 실험', text: original, excerpts: [excerpt] }]);
  return { ...opened, ...ids[0] };
}
async function openEditor(page) {
  // Returning from the editor reopens 출처 정보 when it was open before; press the toggle only when it is closed.
  await frames(page);
  if (await page.locator('#lifeSourceDetails').isHidden()) await page.locator('#lifeSourceInfoToggle').click();
  await page.locator('#lifeSourceEdit').click(); await settle(page);
  await page.locator('#lifeMain[data-mode="source-edit"] #lifeSourceEdit[aria-busy="false"]').waitFor();
}
async function readerEdit(page, versionId) { await R.list(page); await R.openSource(page, versionId); await openEditor(page); }
// Type as a person does and wait until the draft is kept (the editor's own status).
async function type(page, text) {
  await page.locator('#lifeSourceEditText').fill(text);
  await page.waitForFunction(() => document.querySelector('#lifeSourceEditStatus')?.dataset.state === 'draft');
}
const drafts = async page => (await R.stages(page)).filter(stage => stage.state === 'draft');
const listSummary = async page => { await R.list(page); return await page.locator('#lifeImportDrafts summary').count() ? page.locator('#lifeImportDrafts summary').textContent() : null; };
const editorState = page => page.evaluate(() => ({
  editor: !!document.querySelector('#lifeSourceEditText'), panel: document.querySelector('#lifeSourceEditBase')?.dataset.state || null,
  text: document.querySelector('#lifeSourceEditText')?.value ?? null, status: document.querySelector('#lifeSourceEditStatus')?.textContent || '',
  error: document.querySelector('#lifeSourceEditError')?.hidden === false ? document.querySelector('#lifeSourceEditError').textContent : null,
  buttons: [...document.querySelectorAll('#lifeSourceEditBase button')].map(button => button.id) }));
const trashRoundTrip = (page, sourceId) => page.evaluate(async sourceId => {
  const storage = HaedoLife.Shell.storage, core = HaedoLife.Core;
  for (const status of ['trash', 'active']) {
    const bundle = await storage.read(await storage.getActive());
    const stored = await storage.commitLocal({ operationId: core.id(), workspaceId: bundle.workspaceId, baseRevision: bundle.revision, changes: core.buildSourceStateChanges(bundle, sourceId, status) });
    if (stored.status !== 'stored') throw new Error('source state fixture failed');
  }
}, sourceId);
const trash = (page, sourceId) => page.evaluate(async sourceId => {
  const storage = HaedoLife.Shell.storage, core = HaedoLife.Core, bundle = await storage.read(await storage.getActive());
  const stored = await storage.commitLocal({ operationId: core.id(), workspaceId: bundle.workspaceId, baseRevision: bundle.revision, changes: core.buildSourceStateChanges(bundle, sourceId, 'trash') });
  if (stored.status !== 'stored') throw new Error('source state fixture failed');
}, sourceId);
// What the previous build stored the moment the editor opened: a draft with no input of the person's.
const legacyUntouchedDraft = (page, sourceId) => page.evaluate(async sourceId => {
  const storage = HaedoLife.Shell.storage, bundle = await storage.read(await storage.getActive());
  return (await storage.saveStage(HaedoLife.SourceEdit.begin(bundle, sourceId))).stageId;
}, sourceId);
const versions = async (page, sourceId) => (await R.bundle(page)).sourceVersions.filter(version => version.sourceId === sourceId);
const accept = page => page.once('dialog', dialog => dialog.accept());
const dismiss = page => page.once('dialog', dialog => dialog.dismiss());
async function preserved(page, f, count) {
  const bundle = await R.bundle(page), rows = bundle.sourceVersions.filter(version => version.sourceId === f.sourceId);
  assert.equal(rows.length, count, 'version count');
  assert.equal(rows[0].id, f.versionId); assert.equal(rows[0].contentText, original, 'the first version is unchanged');
  const record = bundle.records.find(item => item.sourceRefs.some(ref => ref.sourceVersionId === f.versionId));
  assert.equal(record.text, '발췌한 구절'); assert.deepEqual(record.sourceRefs[0].locator, { start: excerpt.start, end: excerpt.end }); assert.equal(record.note, '이전 판 메모');
  return { bundle, rows };
}

async function main() {
  await S.start();
  try {
    await S.check('opening and leaving the editor without input keeps no draft', async () => {
      const f = await fixture();
      await R.openSource(f.page, f.versionId); await openEditor(f.page);
      let state = await editorState(f.page);
      assert.equal(state.text, original); assert.equal(state.status, '변경 없음');
      assert.equal(await f.page.locator('#lifeSourceEditDiscard').isDisabled(), true, 'nothing to discard yet');
      await f.page.waitForTimeout(700); // longer than the 400ms draft debounce
      assert.deepEqual(await R.stages(f.page), [], 'no stage row before the first input');
      // Focus, caret movement and a composition that ends unchanged are not input either.
      await f.page.locator('#lifeSourceEditText').focus(); await f.page.keyboard.press('End'); await f.page.keyboard.press('ArrowLeft');
      await f.page.locator('#lifeSourceEditText').evaluate(element => { element.dispatchEvent(new CompositionEvent('compositionstart')); element.dispatchEvent(new CompositionEvent('compositionend')); });
      await f.page.waitForTimeout(700);
      assert.deepEqual(await R.stages(f.page), []);
      await f.page.locator('#lifeSourceEditClose').click(); await settle(f.page); await f.page.locator('#lifeSourceText').waitFor();
      assert.equal(await listSummary(f.page), null, 'the list offers nothing to review');
      assert.deepEqual(await R.stages(f.page), []);
      await f.context.close();
    });

    await S.check('V1 trash round trip: the kept draft opens in the editor and saves as a new version', async () => {
      const f = await fixture();
      await R.openSource(f.page, f.versionId); await openEditor(f.page); await type(f.page, typed);
      await f.page.locator('#lifeSourceEditClose').click(); await settle(f.page); await f.page.locator('#lifeSourceText').waitFor();
      assert.match(await listSummary(f.page), /검토 중 1개/);
      // The person's own trash and restore, through the screen.
      await R.openSource(f.page, f.versionId);
      await f.page.locator('#lifeSourceInfoToggle').click(); await f.page.locator('#lifeSourceTrash').click(); await f.page.locator('#lifeSourceTrashConfirm').click(); await settle(f.page);
      await f.page.goto(R.base + '/index.html?section=records&view=source-trash'); await R.ready(f.page); await settle(f.page);
      await f.page.locator('[data-source-restore]').first().click(); await settle(f.page); await f.page.locator('#lifeSourceText').waitFor();
      await readerEdit(f.page, f.versionId);
      let state = await editorState(f.page);
      assert.equal(state.panel, null, 'a trash round trip is not a conflict'); assert.equal(state.text, typed); assert.equal(state.error, null);
      await f.page.locator('#lifeSourceEditSave').click(); await settle(f.page); await f.page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor();
      assert.equal(await f.page.locator('#lifeSourceText').textContent(), typed);
      const { rows, bundle } = await preserved(f.page, f, 2);
      assert.equal(rows[1].contentText, typed);
      assert(bundle.links.some(link => link.kind === 'source_edit_base' && link.entityRefs[0].entityId === f.versionId && link.entityRefs[1].entityId === rows[1].id));
      assert.deepEqual(await drafts(f.page), []);
      await f.context.close();
    });

    await S.check('V1 with a draft the previous build stored on open: it is not listed, and editing and saving work', async () => {
      const f = await fixture();
      await legacyUntouchedDraft(f.page, f.sourceId); await trashRoundTrip(f.page, f.sourceId);
      assert.equal(await listSummary(f.page), null, 'an untouched draft is not something to review');
      await R.openSource(f.page, f.versionId); await openEditor(f.page);
      let state = await editorState(f.page);
      assert.equal(state.panel, null); assert.equal(state.text, original); assert.equal(state.status, '변경 없음');
      assert.deepEqual(await R.stages(f.page), [], 'the untouched draft was removed');
      await type(f.page, typed);
      await f.page.locator('#lifeSourceEditSave').click(); await settle(f.page); await f.page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor();
      assert.equal((await preserved(f.page, f, 2)).rows[1].contentText, typed);
      await f.context.close();
    });

    await S.check('V2 newer version with an untouched draft: the editor opens on the latest version without a warning', async () => {
      const f = await fixture();
      await legacyUntouchedDraft(f.page, f.sourceId);
      const head = await R.addVersion(f.page, f.sourceId, remote);
      await readerEdit(f.page, head);
      const state = await editorState(f.page);
      assert.equal(state.panel, null); assert.equal(state.text, remote, 'not the old body'); assert.equal(state.error, null);
      assert.deepEqual(await R.stages(f.page), []);
      await type(f.page, remote + '\n\n이어서 고침.');
      await f.page.locator('#lifeSourceEditSave').click(); await settle(f.page); await f.page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor();
      const { rows } = await preserved(f.page, f, 3);
      assert.equal(rows[1].contentText, remote); assert.equal(rows[2].contentText, remote + '\n\n이어서 고침.');
      await f.context.close();
    });

    // A typed draft, then a newer version from elsewhere. Each way out, from the same starting point.
    async function moved(options) {
      const f = await fixture(options);
      await R.openSource(f.page, f.versionId); await openEditor(f.page); await type(f.page, typed);
      await f.page.locator('#lifeSourceEditClose').click(); await settle(f.page); await f.page.locator('#lifeSourceText').waitFor();
      f.head = await R.addVersion(f.page, f.sourceId, remote);
      await readerEdit(f.page, f.head);
      const state = await editorState(f.page);
      assert.equal(state.panel, 'moved'); assert.equal(state.editor, false, 'no editor on the old body');
      assert.deepEqual(state.buttons, ['lifeSourceEditRestart', 'lifeSourceEditRebase', 'lifeSourceEditDownload', 'lifeSourceEditDiscard']);
      assert.equal(await f.page.evaluate(() => document.activeElement?.id), 'lifeSourceEditBaseTitle');
      await f.page.locator('#lifeSourceEditMine summary').click();
      assert.equal(await f.page.locator('.life-source-edit-mine-text').textContent(), typed, 'the input is shown as typed');
      return f;
    }
    await S.check('V2 choice: 입력 파일 받기 gives the exact input, and the draft stays', async () => {
      const f = await moved();
      const [download] = await Promise.all([f.page.waitForEvent('download'), f.page.locator('#lifeSourceEditDownload').click()]);
      assert.equal(await fs.readFile(await download.path(), 'utf8'), typed);
      assert.equal((await drafts(f.page)).length, 1); assert.equal((await editorState(f.page)).panel, 'moved');
      await f.context.close();
    });
    await S.check('V2 choice: 최신 판에서 다시 시작 removes the draft after a confirmation and opens the latest version', async () => {
      const f = await moved();
      dismiss(f.page); await f.page.locator('#lifeSourceEditRestart').click(); await frames(f.page);
      assert.equal((await editorState(f.page)).panel, 'moved', 'declined: nothing changes'); assert.equal((await drafts(f.page))[0].text, typed);
      accept(f.page); await f.page.locator('#lifeSourceEditRestart').click(); await f.page.locator('#lifeSourceEditText').waitFor();
      const state = await editorState(f.page);
      assert.equal(state.panel, null); assert.equal(state.text, remote); assert.equal(state.status, '변경 없음');
      assert.deepEqual(await R.stages(f.page), []);
      await preserved(f.page, f, 2);
      await f.context.close();
    });
    for (const width of [1440, 390]) await S.check('V2 choice: 내 입력을 최신 판 위에 새 판으로 저장 at ' + width, async () => {
      const f = await moved(width === 390 ? { width: 390, height: 844, touch: true } : {});
      await S.capture(f.page, 'draft-moved-' + width);
      const sizes = await f.page.evaluate(() => [...document.querySelectorAll('#lifeSourceEdit button')].map(button => { const box = button.getBoundingClientRect(); return [button.id, Math.round(box.width), Math.round(box.height)]; }));
      for (const [id, w, h] of sizes) assert(w >= 44 && h >= 44, id + ' is at least 44px: ' + w + 'x' + h);
      await f.page.locator('#lifeSourceEditRebase').click(); await settle(f.page); await f.page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor();
      assert.equal(await f.page.locator('#lifeSourceText').textContent(), typed);
      assert.match(await f.page.locator('.life-reader-meta').nth(1).textContent(), /버전 3\/3 · 해도에서 수정한 사본/);
      const { rows, bundle } = await preserved(f.page, f, 3);
      assert.equal(rows[1].id, f.head); assert.equal(rows[1].contentText, remote, 'the newer version is kept'); assert.equal(rows[2].contentText, typed);
      assert(bundle.links.some(link => link.kind === 'source_edit_base' && link.entityRefs[0].entityId === f.head && link.entityRefs[1].entityId === rows[2].id), 'saved on top of the latest version');
      assert.deepEqual(await drafts(f.page), []); assert.equal(await listSummary(f.page), null);
      await f.context.close();
    });
    await S.check('V2 choice: 초안 버리기 removes only the draft', async () => {
      const f = await moved();
      dismiss(f.page); await f.page.locator('#lifeSourceEditDiscard').click(); await frames(f.page);
      assert.equal((await drafts(f.page)).length, 1, 'declined: the draft stays');
      accept(f.page); await f.page.locator('#lifeSourceEditDiscard').click(); await settle(f.page); await f.page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor();
      assert.equal(await f.page.locator('#lifeSourceText').textContent(), remote, 'back on the material as it is');
      assert.deepEqual(await R.stages(f.page), []); await preserved(f.page, f, 2);
      assert.equal(await listSummary(f.page), null);
      await f.context.close();
    });

    await S.check('a newer version arriving while the editor is open: 저장 shows the choices and keeps the input', async () => {
      const f = await fixture();
      await R.openSource(f.page, f.versionId); await openEditor(f.page); await type(f.page, typed);
      const head = await R.addVersion(f.page, f.sourceId, remote);
      await f.page.locator('#lifeSourceEditSave').click(); await f.page.locator('#lifeSourceEditBase').waitFor();
      assert.equal((await editorState(f.page)).panel, 'moved'); assert.equal((await versions(f.page, f.sourceId)).length, 2, 'nothing was saved over the newer version');
      assert.equal((await drafts(f.page))[0].text, typed);
      await f.page.locator('#lifeSourceEditRebase').click(); await settle(f.page); await f.page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor();
      const { rows } = await preserved(f.page, f, 3);
      assert.equal(rows[1].id, head); assert.equal(rows[2].contentText, typed);
      await f.context.close();
    });

    await S.check('while the material is in the trash a save is refused, the input stays and can be taken or discarded', async () => {
      const f = await fixture();
      await R.openSource(f.page, f.versionId); await openEditor(f.page); await type(f.page, typed);
      await trash(f.page, f.sourceId);
      await f.page.locator('#lifeSourceEditSave').click(); await f.page.locator('#lifeSourceEditError:not([hidden])').waitFor(); await f.page.waitForTimeout(300);
      let state = await editorState(f.page);
      // The editor stays (the material can be restored): the message, 다시 저장 and 입력 파일 받기, and the input as typed.
      assert.equal(state.panel, null); assert.equal(state.text, typed); assert.match(state.error, /휴지통의 자료는 복원한 뒤 수정해 주세요/);
      assert.deepEqual(await f.page.locator('#lifeSourceEditError button').evaluateAll(buttons => buttons.map(button => button.id)), ['lifeSourceEditRetry', 'lifeSourceEditDownload']);
      assert.equal(await f.page.locator('#lifeSourceEditDiscard').isDisabled(), false);
      assert.equal((await versions(f.page, f.sourceId)).length, 1, 'no version was saved into a trashed material');
      assert.equal((await drafts(f.page))[0].text, typed);
      await f.page.locator('#lifeSourceEditRetry').click(); await f.page.waitForTimeout(300);
      assert.equal((await versions(f.page, f.sourceId)).length, 1, 'still refused while it is in the trash'); assert.equal((await editorState(f.page)).text, typed);
      // Opened again from the list of drafts: the same explanation, not an editor that cannot save.
      await R.list(f.page); await f.page.locator('#lifeImportDrafts summary').click(); await f.page.locator('[data-source-edit-stage-id]').click(); await f.page.locator('#lifeSourceEditBase').waitFor();
      state = await editorState(f.page); assert.equal(state.panel, 'trashed'); assert.equal(state.editor, false);
      accept(f.page); await f.page.locator('#lifeSourceEditDiscard').click(); await settle(f.page);
      await f.page.waitForFunction(() => document.querySelector('#lifeMain')?.dataset.mode !== 'source-edit');
      assert.deepEqual(await R.stages(f.page), []); await preserved(f.page, f, 1);
      await f.context.close();
    });

    await S.check('초안 버리기 in the editor and in the list of drafts', async () => {
      const f = await fixture();
      await R.openSource(f.page, f.versionId); await openEditor(f.page); await type(f.page, typed);
      assert.equal(await f.page.locator('#lifeSourceEditDiscard').isDisabled(), false);
      dismiss(f.page); await f.page.locator('#lifeSourceEditDiscard').click(); await frames(f.page);
      assert.equal((await editorState(f.page)).text, typed, 'declined: the input stays'); assert.equal((await drafts(f.page)).length, 1);
      accept(f.page); await f.page.locator('#lifeSourceEditDiscard').click(); await settle(f.page); await f.page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor();
      assert.equal(await f.page.locator('#lifeSourceText').textContent(), original); assert.deepEqual(await R.stages(f.page), []);
      // Discarded for good: editing again starts from the material, not from the old input.
      await openEditor(f.page); assert.equal((await editorState(f.page)).text, original);
      await type(f.page, typed + ' 다시.');
      await f.page.locator('#lifeSourceEditClose').click(); await settle(f.page); await f.page.locator('#lifeSourceText').waitFor();
      // The list, without a reload: the draft made in this session is offered and can be discarded there.
      await f.page.locator('#lifeSearchReturn').click(); await settle(f.page); await f.page.locator('#lifeMain[data-mode="sources"]').waitFor();
      await f.page.locator('#lifeImportDrafts summary').click();
      const discard = f.page.locator('[data-source-edit-discard]');
      assert.match(await discard.getAttribute('aria-label'), /초안 버리기: 수정 초안 실험/);
      const box = await discard.boundingBox(); assert(box.height >= 44 && box.width >= 44);
      dismiss(f.page); await discard.click(); await frames(f.page); assert.equal((await drafts(f.page)).length, 1);
      accept(f.page); await discard.click(); await settle(f.page);
      await f.page.waitForFunction(() => !document.querySelector('#lifeImportDrafts'));
      assert.deepEqual(await R.stages(f.page), []);
      await R.openSource(f.page, f.versionId); await openEditor(f.page);
      assert.equal((await editorState(f.page)).text, original, 'no live session keeps the discarded input');
      await preserved(f.page, f, 1);
      await f.context.close();
    });

    // 2026-11-11 독립 검수: 버리기가 저장소 오류로 실패한 뒤에도 그 초안은 이 화면의 초안이다. (이전에는 실패해도
    // 버린 것으로 표시해, 그 뒤의 입력이 보관되지 않고 떠날 때 묻지도 않아 조용히 사라졌다.)
    await S.check('초안 버리기 that fails in storage: the message shows, and input typed afterwards is still kept and guarded', async () => {
      const f = await fixture();
      await R.openSource(f.page, f.versionId); await openEditor(f.page); await type(f.page, typed);
      // One failing removal of the draft row, as a storage error would cause.
      await f.page.evaluate(() => {
        const real = IDBObjectStore.prototype.delete; window.__failedDeletes = 0;
        IDBObjectStore.prototype.delete = function (...args) { if (this.name === 'staging' && !window.__failedDeletes) { window.__failedDeletes = 1; throw new DOMException('주입한 삭제 실패', 'UnknownError'); } return real.apply(this, args); };
      });
      accept(f.page); await f.page.locator('#lifeSourceEditDiscard').click(); await f.page.locator('#lifeSourceEditError:not([hidden])').waitFor(); await frames(f.page);
      assert.equal(await f.page.evaluate(() => window.__failedDeletes), 1, 'the removal really failed');
      let state = await editorState(f.page);
      assert.equal(state.text, typed, 'the input stays on screen'); assert(state.error, 'the failure is told');
      assert.equal((await drafts(f.page))[0].text, typed, 'the draft row is still there');
      // Typed after the failed discard: kept like any other input.
      const later = typed + '\n\n버리기 실패 뒤에 쓴 문장.';
      await f.page.locator('#lifeSourceEditText').fill(later);
      assert.equal(await f.page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), true, 'leaving before it is kept asks first');
      await f.page.waitForFunction(() => document.querySelector('#lifeSourceEditStatus')?.dataset.state === 'draft');
      state = await editorState(f.page); assert.equal(state.error, null);
      const rows = await drafts(f.page); assert.equal(rows.length, 1); assert.equal(rows[0].text, later, 'the later sentence is in the kept draft');
      await f.page.locator('#lifeSourceEditClose').click(); await settle(f.page); await f.page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor();
      await openEditor(f.page);
      assert.equal((await editorState(f.page)).text, later, 'reopened with the later sentence');
      // A discard that succeeds is still a discard.
      accept(f.page); await f.page.locator('#lifeSourceEditDiscard').click(); await settle(f.page); await f.page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor();
      assert.deepEqual(await R.stages(f.page), []);
      await openEditor(f.page); assert.equal((await editorState(f.page)).text, original);
      await preserved(f.page, f, 1);
      await f.context.close();
    });

    // 2026-11-11 독립 검수: 다른 탭이 목록에서 이 초안을 버리면, 열려 있던 편집기의 입력은 새 초안으로 다시 보관할 수 있다.
    // (이전에는 `다시 저장`이 계속 실패하고 `입력 파일 받기`만 남았다.)
    async function discardedElsewhere() {
      const f = await fixture();
      await R.openSource(f.page, f.versionId); await openEditor(f.page); await type(f.page, typed);
      f.first = (await drafts(f.page))[0].stageId;
      const other = await f.context.newPage(); other.setDefaultTimeout(15000);
      await R.list(other); await other.locator('#lifeImportDrafts summary').click();
      other.once('dialog', dialog => dialog.accept()); await other.locator('[data-source-edit-discard]').click(); await settle(other);
      await other.waitForFunction(() => !document.querySelector('#lifeImportDrafts'));
      assert.deepEqual(await R.stages(other), [], 'the other tab removed the draft'); await other.close();
      await f.page.bringToFront();
      f.later = typed + '\n\n다른 탭이 버린 뒤에 쓴 문장.';
      await f.page.locator('#lifeSourceEditText').fill(f.later); await f.page.locator('#lifeSourceEditError:not([hidden])').waitFor();
      const state = await editorState(f.page);
      assert.match(state.error, /다른 탭에서 수정 초안이 바뀌었습니다/); assert.equal(state.text, f.later);
      return f;
    }
    await S.check('the draft was discarded in another tab: 다시 저장 saves this screen\'s input as a new version', async () => {
      const f = await discardedElsewhere();
      await f.page.locator('#lifeSourceEditRetry').click(); await settle(f.page); await f.page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor();
      assert.equal(await f.page.locator('#lifeSourceText').textContent(), f.later);
      assert.equal((await preserved(f.page, f, 2)).rows[1].contentText, f.later); assert.deepEqual(await drafts(f.page), []);
      await f.context.close();
    });
    await S.check('the draft was discarded in another tab: leaving the editor keeps this screen\'s input as a new draft', async () => {
      const f = await discardedElsewhere();
      await f.page.locator('#lifeSourceEditClose').click(); await settle(f.page); await f.page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor();
      const rows = await drafts(f.page);
      assert.equal(rows.length, 1); assert.equal(rows[0].text, f.later); assert.notEqual(rows[0].stageId, f.first, 'a new draft, not the discarded one');
      await openEditor(f.page);
      const state = await editorState(f.page); assert.equal(state.text, f.later); assert.equal(state.error, null);
      await preserved(f.page, f, 1);
      await f.context.close();
    });
    await S.check('a draft changed (not discarded) in another tab stays a conflict: nothing is overwritten', async () => {
      const f = await fixture();
      await R.openSource(f.page, f.versionId); await openEditor(f.page); await type(f.page, typed);
      const elsewhere = typed + ' 다른 탭의 입력.';
      await f.page.evaluate(async text => {
        const storage = HaedoLife.Shell.storage, row = (await storage.listStages(await storage.getActive())).find(stage => stage.kind === 'source-edit');
        await storage.saveStage(HaedoLife.SourceEdit.edit(row, { text }));
      }, elsewhere);
      await f.page.locator('#lifeSourceEditText').fill(typed + ' 이 탭의 입력.'); await f.page.locator('#lifeSourceEditError:not([hidden])').waitFor();
      await f.page.locator('#lifeSourceEditRetry').click(); await f.page.waitForTimeout(400);
      const state = await editorState(f.page);
      assert.match(state.error, /다른 탭에서 수정 초안이 바뀌었습니다/); assert.equal(state.text, typed + ' 이 탭의 입력.');
      const rows = await drafts(f.page); assert.equal(rows.length, 1); assert.equal(rows[0].text, elsewhere, 'the other tab\'s draft is not replaced');
      await preserved(f.page, f, 1);
      await f.context.close();
    });

    await S.check('이 버전으로 복원 still saves without any typing, and an unchanged 저장 makes no version', async () => {
      const f = await fixture();
      const head = await R.addVersion(f.page, f.sourceId, remote);
      await R.list(f.page); await R.openSource(f.page, head);
      await f.page.locator('#lifeVersion').selectOption(f.versionId); await settle(f.page); await frames(f.page);
      await f.page.locator('#lifeSourceInfoToggle').click(); await f.page.locator('#lifeSourceRestoreVersion').click(); await settle(f.page); await f.page.locator('#lifeSourceEditText').waitFor();
      assert.equal((await editorState(f.page)).text, original); assert.deepEqual(await R.stages(f.page), []);
      await f.page.locator('#lifeSourceEditSave').click(); await settle(f.page); await f.page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor();
      let { rows } = await preserved(f.page, f, 3);
      assert.equal(rows[2].contentText, original); assert.notEqual(rows[2].id, f.versionId, 'a fresh latest version');
      await openEditor(f.page); await f.page.locator('#lifeSourceEditSave').click(); await settle(f.page); await f.page.locator('#lifeMain[data-mode="source"] #lifeSourceText').waitFor();
      ({ rows } = await preserved(f.page, f, 3));
      await f.context.close();
    });
  } finally { await S.finish(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
