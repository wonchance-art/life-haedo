'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const model = require('../assets/life/obsidian-link-candidates.js');
const UI = require('../assets/life/obsidian-link-candidates-ui.js');
class Node {
  constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.listeners = {}; this.dataset = {}; this.attributes = {}; this.disabled = false; this.hidden = false; this._text = ''; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this._text = ''; this.append(...nodes); }
  set textContent(v) { this.replaceChildren(); this._text = String(v); }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
  set innerHTML(_) { throw Error('Unsafe HTML rendering'); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); }
  emit(k) { for (const fn of this.listeners[k] || []) fn({ target: this }); }
  async click() { for (const fn of this.listeners.click || []) await fn({ target: this }); }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
}
function doc() { const d = { createElement: tag => new Node(tag, d) }; d.body = new Node('body', d); return d; }
const all = (n, predicate) => [n, ...n.children.flatMap(v => all(v, predicate))].filter(predicate);
const buttons = n => all(n, v => v.tagName === 'button');
const named = (n, name) => buttons(n).filter(v => v.textContent === name);
const note = (path, id, text = '# 절\n내용') => ({ path, sourceId: 'source-' + id, sourceVersionId: 'version-' + id, origin: 'obsidian', title: '제목 ' + id, url: 'obsidian://vault/' + id, importedAt: '2026-10-26T09:10:11.000Z', text });
function fixture(options = {}) {
  const document = doc(), host = document.createElement('main'), calls = []; document.body.append(host);
  let current = true;
  const ui = UI.create({ document, model, text: '😀 [[같은#절|표시]]', fromPath: 'folder/현재.md',
    notes: [note('folder/같은.md', 'a', '# 절\n하나\n# 절\n둘'), note('else/같은.md', 'b')],
    fromSourceId: 'origin', fromSourceVersionId: 'origin-version',
    onOpenNote: v => calls.push(['open', v]), onConnectNote: v => calls.push(['connect', v]),
    onOpenAttachment: v => calls.push(['attachment', v]), isCurrent: () => current, ...options });
  ui.mount(host); host.children[0].open = true; host.children[0].emit('toggle');
  return { document, host, calls, ui, setCurrent: v => { current = v; } };
}
test('explicit selection preserves UTF-16 token and disambiguates paths, vault labels and repeated headings', async () => {
  const f = fixture(); assert.equal(f.calls.length, 0); assert.match(f.host.textContent, /후보 여러 개/); assert.match(f.host.textContent, /후보 1/); assert.match(f.host.textContent, /후보 2/); assert.ok(!f.host.textContent.includes('source-a')); assert.ok(!f.host.textContent.includes('version-a'));
  assert.match(f.host.textContent, /obsidian:\/\/vault\/a/); const locations = buttons(f.host).filter(v => !v.hidden && v.textContent.startsWith('일치 위치'));
  assert.equal(locations.length, 3); await locations[1].click(); assert.equal(f.calls.length, 1);
  const selected = f.calls[0][1]; assert.equal(selected.occurrence.token, '[[같은#절|표시]]'); assert.equal(selected.occurrence.start, 3); assert.equal(selected.candidate.sourceId, 'source-a'); assert.deepEqual(selected.locator, { start: 7, end: 10 });
});
test('confirmed linking blocks duplicate and conflicting choices; previously linked occurrences cannot be overwritten', async () => {
  const f = fixture(); const connect = named(f.host, '이 위치를 연결'); assert.equal(connect.length, 3); await connect[0].click(); await connect[0].click(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], 'connect'); assert.ok(connect.every(x => x.disabled));
  assert.equal(connect[0].textContent, '이미 연결됨'); assert.equal(connect[1].textContent, '다른 대상이 이미 연결됨');
  const linked = { kind: 'obsidian_link', sourceRefs: [{ sourceId: 'origin', sourceVersionId: 'origin-version', locator: { start: 3, end: 14 } }, { sourceId: 'source-a', sourceVersionId: 'version-a', locator: { start: 0, end: 3 } }] };
  const g = fixture({ existingLinks: [linked] }); assert.equal(named(g.host, '이미 연결됨').length, 1); assert.equal(named(g.host, '다른 대상이 이미 연결됨').length, 2); assert.equal(named(g.host, '이 위치를 연결').length, 0);
});
test('missing anchors are never silently connected; unresolved attachments and invalid references remain distinct', async () => {
  const f = fixture({ text: '[[같은#없는]] ![[사진.png]] [[../../탈출]]', notes: [note('folder/같은.md', 'a')], attachments: null });
  assert.match(f.host.textContent, /요청한 위치를 찾지 못했습니다/); assert.match(f.host.textContent, /첨부 목록을 아직 확인하지 않았습니다/); assert.match(f.host.textContent, /해석할 수 없는 대상/);
  assert.equal(named(f.host, '이 위치를 연결').length, 0); assert.equal(named(f.host, '첨부 후보 열기').length, 0);
  await named(f.host, '문서만 열기 · 위치 미확인')[0].click(); assert.equal(f.calls[0][1].locator, null);
});
test('attachment candidates need an explicitly provided scope and click, including duplicate copy identifiers', async () => {
  const file = { path: 'folder/사진.png', copyId: 'one', snapshotPath: 'private/사진.png', sha256: 'a'.repeat(64), mime: 'image/png', bytes: 12 };
  const f = fixture({ text: '![[사진.png]]', attachments: [file, { ...file, copyId: 'two' }] });
  assert.match(f.host.textContent, /후보 여러 개/); assert.deepEqual(all(f.host, n => n.dataset.copyId).map(n => n.dataset.copyId), ['one', 'two']); assert.equal(f.calls.length, 0);
  await named(f.host, '첨부 후보 열기')[1].click(); assert.equal(f.calls[0][1].candidate.copyId, 'two');
});
test('stale scope and repeated clicks cannot cause callbacks; failures leave retry available', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; }); let count = 0;
  const f = fixture({ text: '[[같은]]', notes: [note('folder/같은.md', 'a')], onConnectNote: async () => { count++; await wait; } });
  const b = named(f.host, '이 위치를 연결')[0]; const first = b.click(); await b.click(); assert.equal(count, 1); f.setCurrent(false); release(); await first; await b.click(); assert.equal(count, 1);
  let retries = 0; const g = fixture({ text: '[[같은]]', notes: [note('folder/같은.md', 'a')], onConnectNote: () => { retries++; throw Error('failed'); } });
  const retry = named(g.host, '이 위치를 연결')[0]; await retry.click(); assert.match(g.host.textContent, /원래 자료는 유지/); assert.equal(retry.disabled, false); await retry.click(); assert.equal(retries, 2);
});
test('untrusted text stays literal, input snapshots are stable, and long link lists are bounded', async () => {
  const target = note('folder/같은.md', 'a'); target.title = '<img src=x onerror=alert(1)>'; const notes = [target];
  const f = fixture({ text: Array.from({ length: 21 }, () => '[[같은]]').join(' '), notes }); target.title = '변조'; target.sourceId = 'changed';
  assert.ok(f.host.textContent.includes('<img src=x onerror=alert(1)>')); assert.ok(!f.host.textContent.includes('변조')); assert.equal(all(f.host, v => v.tagName === 'article').length, 20);
  await named(f.host, '링크 20개 더 보기')[0].click(); assert.equal(all(f.host, v => v.tagName === 'article').length, 21);
  await named(f.host, '문서 전체 열기')[0].click(); assert.equal(f.calls[0][1].candidate.sourceId, 'source-a'); f.ui.dispose(); assert.equal(f.host.children.length, 0);
});

test('ambiguous note versus attachment requires explicit type choice before opening any target', async () => {
  const file = { path: 'folder/계획.v2', copyId: 'copy', snapshotPath: 'vault/계획.v2', sha256: 'a'.repeat(64), mime: 'application/octet-stream', bytes: 7 };
  const f = fixture({ text: '[[계획.v2]]', notes: [note('folder/계획.v2.md', 'd')], attachments: [file] });
  assert.match(f.host.textContent, /노트와 첨부가 모두/); assert.equal(f.calls.length, 0); assert.equal(named(f.host, '문서 전체 열기').length, 0);
  await named(f.host, '노트 후보 확인')[0].click(); assert.equal(f.calls.length, 0); await named(f.host, '문서 전체 열기')[0].click(); assert.equal(f.calls[0][1].candidate.sourceId, 'source-d');
  const g = fixture({ text: '[[계획.v2]]', notes: [note('folder/계획.v2.md', 'd')], attachments: [file] });
  await named(g.host, '첨부 후보 확인')[0].click(); assert.equal(g.calls.length, 0); await named(g.host, '첨부 후보 열기')[0].click(); assert.equal(g.calls[0][1].candidate.copyId, 'copy');
});
test('excessive and malformed candidates never become actionable silent selections', () => {
  const many = Array.from({ length: 201 }, (_, i) => note('p' + i + '/반복.md', String(i)));
  const f = fixture({ text: '[[반복]]', notes: many }); assert.match(f.host.textContent, /후보가 너무 많습니다/); assert.equal(named(f.host, '문서 전체 열기').length, 0);
  const unsafe = { ...model, resolve: () => ({ status: 'candidate', kind: 'note', candidates: [{ path: 'folder/같은.md', anchorStatus: 'document' }] }) };
  const g = fixture({ text: '[[같은]]', model: unsafe });
  assert.match(g.host.textContent, /원문 식별 정보가 부족/); assert.equal(named(g.host, '문서 전체 열기').length, 0);
});

test('unreadable or oversized scope reports uncertainty without breaking the reader', () => {
  const f = fixture({ fromPath: '../unsafe.md' }); assert.match(f.host.textContent, /원문 경로나 확인 범위를 해석하지 못했습니다/); assert.equal(f.calls.length, 0);
  const g = fixture({ text: 'x'.repeat(1024 * 1024 + 1) }); assert.match(g.host.textContent, /링크 후보 확인 불가/); assert.match(g.host.textContent, /원문은 그대로 유지/); assert.equal(g.calls.length, 0);
});

test('duplicate headings show each exact version’s neighboring text without changing UTF-16 ranges or executing markup', async () => {
  const raw = '# 절\n' + '가'.repeat(78) + '😀<img src=x onerror=alert(1)>\n# 절\n둘째 문맥';
  const f = fixture({ notes: [note('folder/같은.md', 'a', raw)] });
  const before = f.host.textContent; assert.equal(f.calls.length, 0); assert.ok(before.includes('<img src=x onerror=alert(1)>'));
  const contextRows = all(f.host, n => n.tagName === 'p' && n.textContent.startsWith('뒤: '));
  assert.equal(contextRows.length, 2); assert.ok(contextRows[0].textContent.includes('😀')); assert.ok(contextRows[1].textContent.includes('둘째 문맥'));
  assert.notEqual(contextRows[0].textContent, contextRows[1].textContent);
  const locations = buttons(f.host).filter(v => !v.hidden && v.textContent.startsWith('일치 위치'));
  await locations[1].click(); const { occurrence, candidate, locator } = f.calls[0][1];
  assert.equal(raw.slice(locator.start, locator.end), '# 절'); assert.equal(locator.start, raw.lastIndexOf('# 절'));
  assert.equal(occurrence.token, '[[같은#절|표시]]'); assert.equal(candidate.sourceVersionId, 'version-a');
});

test('a very long heading remains bounded on screen while its full exact target range is retained', async () => {
  const raw = '# 절' + ' '.repeat(50000) + '\n다음';
  const f = fixture({ notes: [note('folder/같은.md', 'a', raw)] });
  const line = all(f.host, n => n.tagName === 'p' && n.textContent.startsWith('위치: '))[0];
  assert.ok(line.textContent.length < 180); assert.ok(line.textContent.endsWith('…'));
  await buttons(f.host).find(v => !v.hidden && v.textContent.startsWith('일치 위치')).click();
  assert.deepEqual(f.calls[0][1].locator, { start: 0, end: 50003 });
});

test('closed reader defers scanning and ignores unrelated focus keys', () => {
  const document = doc(), host = document.createElement('main'); document.body.append(host); let scans = 0, resolves = 0;
  const counted = { scan: text => { scans++; return model.scan(text); }, resolve: options => { resolves++; return model.resolve(options); } };
  const ui = UI.create({ document, model: counted, text: '[[같은]]', fromPath: 'folder/현재.md', notes: [note('folder/같은.md', 'a')] });
  ui.mount(host); assert.equal(scans, 0); assert.equal(resolves, 0); assert.equal(ui.revealFocus('ordinary-source-return'), null); assert.equal(scans, 0); assert.equal(host.children[0].open, undefined);
  host.children[0].open = true; host.children[0].emit('toggle'); assert.equal(scans, 1); assert.equal(resolves, 1);
});
test('exact return restores later occurrence, candidate and heading pages without callbacks', () => {
  const text = Array.from({ length: 21 }, () => '[[대상#절]]').join(' ');
  const notes = Array.from({ length: 25 }, (_, i) => note('p' + i + '/대상.md', String(i), Array.from({ length: 21 }, (_, j) => '# 절\n문맥 ' + j).join('\n')));
  const occurrence = model.scan(text)[20], target = model.anchors(notes[24].text, '절')[20], document = doc(), host = document.createElement('main'); document.body.append(host);
  let opened = 0, connected = 0;
  const ui = UI.create({ document, model, text, fromPath: 'folder/현재.md', notes, fromSourceId: 'origin', fromSourceVersionId: 'origin-version', onOpenNote: () => opened++, onConnectNote: () => connected++ });
  ui.mount(host); const key = 'obsidian-candidate:' + occurrence.start + ':version-24:' + target.start;
  const focused = ui.revealFocus(key); assert.ok(focused); assert.equal(focused.dataset.obsidianFocus, key + ':open'); assert.equal(document.activeElement, focused); assert.equal(host.children[0].open, true);
  assert.equal(opened, 0); assert.equal(connected, 0); assert.equal(ui.revealFocus(key + ':open'), focused);
  assert.equal(ui.revealFocus('obsidian-candidate:' + occurrence.start + ':missing:' + target.start), null);
  assert.equal(opened, 0); assert.equal(connected, 0);
});

test('restoring an explicitly opened note disambiguates type without opening or connecting it', () => {
  const file = { path: 'folder/계획.v2', copyId: 'copy', snapshotPath: 'vault/계획.v2', sha256: 'a'.repeat(64), mime: 'application/octet-stream', bytes: 7 };
  const document = doc(), host = document.createElement('main'); document.body.append(host); let called = 0;
  const ui = UI.create({ document, model, text: '[[계획.v2]]', fromPath: 'folder/현재.md', notes: [note('folder/계획.v2.md', 'd')], attachments: [file], onOpenNote: () => called++, onOpenAttachment: () => called++ });
  ui.mount(host); const target = ui.revealFocus('obsidian-candidate:0:version-d:document:open');
  assert.ok(target); assert.equal(document.activeElement, target); assert.equal(called, 0); assert.equal(host.children[0].open, true);
});

test('repeated targets reuse only resolution within the same scoped snapshot and retain each original occurrence', async () => {
  let calls = 0; const counted = { scan: model.scan, resolve: options => { calls++; return model.resolve(options); } };
  const notes = Array.from({ length: 3479 }, (_, i) => i < 50 ? note('p' + i + '/같은.md', String(i), '# 절\n' + '본문'.repeat(6000)) : note('p' + i + '/다른' + i + '.md', String(i), '다른 본문'));
  const text = Array.from({ length: 20 }, () => '[[같은#절]]').join(' ');
  const f = fixture({ text, notes, model: counted }); assert.equal(calls, 1); assert.equal(f.calls.length, 0);
  const rows = all(f.host, n => n.tagName === 'article'); assert.equal(rows.length, 20);
  const first = buttons(rows[0]).find(b => !b.hidden && b.textContent.startsWith('일치 위치'));
  const last = buttons(rows[19]).find(b => !b.hidden && b.textContent.startsWith('일치 위치'));
  await first.click(); await last.click(); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0][1].occurrence.start, model.scan(text)[0].start); assert.equal(f.calls[1][1].occurrence.start, model.scan(text)[19].start);
  assert.equal(f.calls[0][1].candidate.sourceVersionId, 'version-0'); assert.equal(f.calls[1][1].candidate.sourceVersionId, 'version-0');
  const second = fixture({ text: '[[같은#절]]', notes: [note('x/같은.md', 'other')], model: counted });
  assert.equal(calls, 2); await buttons(second.host).find(b => !b.hidden && b.textContent.startsWith('일치 위치')).click();
  assert.equal(second.calls[0][1].candidate.sourceVersionId, 'version-other');
});
test('cache keys distinguish invalid tokens and explicit target kinds', async () => {
  const file = { path: 'folder/계획.v2', copyId: 'copy', snapshotPath: 'vault/계획.v2', sha256: 'a'.repeat(64), mime: 'application/octet-stream', bytes: 7 };
  let calls = 0; const counted = { scan: text => model.scan(text).map((v, i) => ({ ...v, invalid: i === 1 })), resolve: options => { calls++; return model.resolve(options); } };
  const f = fixture({ text: '[[계획.v2]] [[계획.v2]] [[계획.v2]]', notes: [note('folder/계획.v2.md', 'd')], attachments: [file], model: counted });
  assert.equal(calls, 2); assert.match(f.host.textContent, /해석할 수 없는 대상/);
  await named(f.host, '노트 후보 확인')[0].click(); assert.equal(calls, 3); assert.equal(named(f.host, '문서 전체 열기').length, 1);
  await named(f.host, '첨부 후보 확인')[0].click(); assert.equal(calls, 4); assert.equal(named(f.host, '첨부 후보 열기').length, 1); assert.equal(f.calls.length, 0);
});
test('cache evicts oldest entries at 200 and does not retain excessively large locator arrays', async () => {
  let calls = 0; const counted = { scan: model.scan, resolve: options => { calls++; return model.resolve(options); } };
  const text = [...Array.from({ length: 201 }, (_, i) => '[[항목' + i + ']]'), '[[항목0]]'].join(' ');
  const f = fixture({ text, notes: [], model: counted });
  for (let i = 0; i < 10; i++) await named(f.host, '링크 20개 더 보기')[0].click();
  assert.equal(calls, 202); assert.equal(f.calls.length, 0);
  let hugeCalls = 0; const huge = { scan: model.scan, resolve: () => { hugeCalls++; return { status: 'candidate', kind: 'note', candidates: [{ path: 'x.md', sourceId: 'x', sourceVersionId: 'v', anchorStatus: 'text_missing', locators: Array(20001).fill({ start: 0, end: 1 }) }] }; } };
  fixture({ text: '[[x#y]] [[x#y]]', notes: [], model: huge }); assert.equal(hugeCalls, 2);
});

test('same-named versions show human-readable evidence and candidate numbers without exposing IDs as text', async () => {
  const first = { ...note('folder/같은.md', 'same-one'), title: '같은 제목', url: 'obsidian://same/source', importedAt: '2026-10-26T09:10:11.000Z' };
  const second = { ...note('folder/같은.md', 'same-two'), title: first.title, url: first.url, importedAt: first.importedAt };
  const f = fixture({ text: '[[같은]]', notes: [first, second] });
  assert.match(f.host.textContent, /후보 1/); assert.match(f.host.textContent, /후보 2/); assert.match(f.host.textContent, /같은 제목/); assert.match(f.host.textContent, /obsidian:\/\/same\/source/); assert.match(f.host.textContent, /보관 2026/);
  for (const id of [first.sourceId, first.sourceVersionId, second.sourceId, second.sourceVersionId]) assert.ok(!f.host.textContent.includes(id));
  const items = all(f.host, n => n.tagName === 'section' && n.dataset.versionId);
  assert.deepEqual(items.map(n => [n.dataset.sourceId, n.dataset.versionId]), [[first.sourceId, first.sourceVersionId], [second.sourceId, second.sourceVersionId]]);
  await named(f.host, '문서 전체 열기')[1].click(); assert.equal(f.calls[0][1].candidate.sourceId, second.sourceId); assert.equal(f.calls[0][1].candidate.sourceVersionId, second.sourceVersionId);
});

test('the error alert is hidden until a real failure and hidden again as soon as retry starts', async () => {
  let attempts = 0, release;
  const f = fixture({ text: '[[같은]]', notes: [note('folder/같은.md', 'a')], onConnectNote: () => {
    if (++attempts === 1) throw Error('synthetic failure');
    return new Promise(resolve => { release = resolve; });
  } });
  const alert = all(f.host, n => n.attributes.role === 'alert')[0], action = named(f.host, '이 위치를 연결')[0];
  assert.equal(alert.hidden, true); assert.equal(alert.textContent, '');
  await action.click(); assert.equal(alert.hidden, false); assert.match(alert.textContent, /원래 자료는 유지/);
  const retry = action.click(); assert.equal(alert.hidden, true); assert.equal(alert.textContent, ''); release(); await retry;
  assert.equal(alert.hidden, true); assert.equal(action.disabled, true);
});
test('a late rejected action cannot reveal an error in a stale account or screen', async () => {
  let reject;
  const f = fixture({ text: '[[같은]]', notes: [note('folder/같은.md', 'a')], onConnectNote: () => new Promise((_, fail) => { reject = fail; }) });
  const alert = all(f.host, n => n.attributes.role === 'alert')[0], action = named(f.host, '이 위치를 연결')[0];
  const pending = action.click(); f.setCurrent(false); reject(Error('late failure')); await pending;
  assert.equal(alert.hidden, true); assert.equal(alert.textContent, '');
});
test('scan failure shows its own error instead of presenting a false empty result', () => {
  const f = fixture({ text: 'x'.repeat(1024 * 1024 + 1) });
  const alert = all(f.host, n => n.attributes.role === 'alert')[0]; assert.equal(alert.hidden, false); assert.match(alert.textContent, /링크 후보를 확인하지 못했습니다/);
});
