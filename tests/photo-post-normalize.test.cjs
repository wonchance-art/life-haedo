'use strict';
// Storing a draft never depends on the editor having produced only supported
// input (2026-11-11): normalization, input cleaning, link completion and the
// device-only recovery copy. Editor-independent, so it holds for the next editor too.
const test = require('node:test'), assert = require('node:assert/strict');
const M = require('../assets/life/photo-post.js'), core = require('../assets/life/core.js');
const doc = (ops, extra = {}) => ({ ...M.create(core.id), ops, ...extra });
const png = () => new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], { type: 'image/png' });
async function photo() { const blob = png(); return { id: core.id(), name: '사진.png', type: blob.type, width: 4, height: 3, size: blob.size, digest: await M.digest(blob), blob }; }
function memory() {
  const map = new Map();
  return { map, setItem: (k, v) => { map.set(k, String(v)); }, getItem: k => map.has(k) ? map.get(k) : null, removeItem: k => { map.delete(k); }, get length() { return map.size; }, key: i => [...map.keys()][i] ?? null };
}

test('text cleaning keeps every ordinary character and maps only what a post cannot hold', () => {
  assert.equal(M.cleanText('가나다 abc\t탭\n줄 😀 한글'), '가나다 abc\t탭\n줄 😀 한글');
  assert.equal(M.cleanText('첫 줄\u000b둘째\u000c셋째'), '첫 줄\n둘째\n셋째');
  assert.equal(M.cleanText('제목\u000b조각', false), '제목 조각');
  assert.equal(M.cleanText('a\u0000b\u0008c\u000ed\u001fe\u007ff'), 'abcdef');
  assert.equal(M.cleanText('짝 없는 \uD83C 과 \uDE00 그리고 온전한 😀'), '짝 없는  과  그리고 온전한 😀');
  assert.equal(M.cleanText(undefined), '');
  for (const value of ['가\u000b', '\u0001', '\uD800', '끝\u007f']) {
    const cleaned = doc([{ insert: M.cleanText(value) + '\n' }], { title: M.cleanText(value, false) });
    assert.doesNotThrow(() => M.validate(cleaned));
  }
});

test('links: a scheme-less address is https; anything that is not an http(s) address is refused', () => {
  const accepted = { 'naver.com': 'https://naver.com', ' example.org/a?b=1#c ': 'https://example.org/a?b=1#c', 'http://example.org': 'http://example.org', 'HTTPS://Example.org/x': 'HTTPS://Example.org/x',
    'localhost:8080/x': 'https://localhost:8080/x', 'example.org:8443': 'https://example.org:8443', '//cdn.example.org/a': 'https://cdn.example.org/a', '한글.kr/길': 'https://한글.kr/길' };
  for (const [input, expected] of Object.entries(accepted)) {
    assert.equal(M.safeLink(input), expected, input);
    assert.doesNotThrow(() => M.validate(doc([{ insert: '글', attributes: { link: expected } }, { insert: '\n' }])), expected);
  }
  for (const refused of ['mailto:a@example.org', 'tel:0101234', 'sms:010', 'javascript:alert(1)', 'data:text/html,x', 'ftp://example.org', 'file:///etc/passwd', 'hello', '', '   ', 'a b.com', 'user:pw@example.org', 'https://user:pw@example.org', 'https://exa mple.org', 'http://', null, 7, 'https://' + 'a'.repeat(2050) + '.org'])
    assert.equal(M.safeLink(refused), null, String(refused));
});

test('normalization maps every unsupported format to the nearest supported one and reports it', async () => {
  const p = await photo();
  const input = doc([
    { insert: '굵게', attributes: { bold: true, strike: true, color: '#f00' } },
    { insert: '\n', attributes: { list: 'unchecked', indent: 2 } },
    { insert: '한 일' }, { insert: '\n', attributes: { list: 'checked' } },
    { insert: '제목' }, { insert: '\n', attributes: { header: 5 } },
    { insert: '링크', attributes: { link: 'example.org' } }, { insert: '편지', attributes: { link: 'mailto:a@example.org' } },
    { insert: '문\u000b자\u0001', attributes: { author: 'ai' } }, { insert: '\n', attributes: { align: 'left', blockquote: 1 } },
    { insert: { photo: { id: p.id, caption: '설명\u000b둘째', alt: '대체\u000b글' } }, attributes: { author: 'ai' } },
    { insert: { image: 'https://example.org/x.png' } }, { insert: { photo: { id: 'missing', caption: '', alt: '' } } },
    { insert: { photo: { id: p.id, caption: '', alt: '' } } },
    { retain: 3 }, { insert: '끝' },
  ], { title: '제\u000b목\uD83C', photos: [p, { ...p, id: core.id() }] });
  const before = structuredClone(input), result = M.normalize(input);
  assert.deepEqual(input, before, 'the input is not mutated');
  assert.doesNotThrow(() => M.validate(result.doc));
  assert.deepEqual(result.doc.ops, [
    { insert: '굵게', attributes: { bold: true } }, { insert: '\n', attributes: { list: 'bullet' } },
    { insert: '한 일' }, { insert: '\n', attributes: { list: 'bullet' } },
    { insert: '제목' }, { insert: '\n', attributes: { header: 2 } },
    { insert: '링크', attributes: { link: 'https://example.org' } }, { insert: '편지' },
    { insert: '문\n자', attributes: { author: 'ai' } }, { insert: '\n', attributes: { blockquote: true } },
    { insert: { photo: { id: p.id, caption: '설명\n둘째', alt: '대체 글' } } },
    { insert: '끝\n' },
  ]);
  assert.equal(result.doc.title, '제 목');
  assert.deepEqual(result.doc.photos.map(item => item.id), [p.id], 'photos the body does not use are left out');
  assert.equal(input.photos.length, 2, 'the editor keeps them for undo');
  assert.deepEqual([...result.changes].sort(), ['chars', 'checklist', 'embed', 'format', 'link']);
  assert.equal(result.changed, true);
  assert.equal(M.describeChanges(['checklist']), '체크 목록은 글머리 목록으로 바꿨어요');
  assert.equal(M.describeChanges(['chars']), '쓸 수 없는 문자를 뺐어요');
  assert.equal(M.describeChanges(['link']), '주소가 아닌 링크는 풀었어요');
  assert.equal(M.describeChanges(result.changes), '지원하지 않는 서식·문자를 정리했어요');
  assert.equal(M.describeChanges([]), '');
});

test('a supported document is returned with the same content and no reported change', async () => {
  const p = await photo();
  const ops = [{ insert: '본문 ' }, { insert: '굵게', attributes: { bold: true, italic: true, underline: true, link: 'https://example.org/', author: 'ai' } },
    { insert: '\n', attributes: { header: 1 } }, { insert: '인용' }, { insert: '\n', attributes: { blockquote: true, align: 'center' } },
    { insert: '하나' }, { insert: '\n', attributes: { list: 'ordered' } }, { insert: '둘' }, { insert: '\n', attributes: { list: 'bullet', align: 'justify' } },
    { insert: { photo: { id: p.id, caption: '설명', alt: '대체' } } }, { insert: '\n' }];
  const input = doc(ops, { title: '온전한 글', photos: [p] }), result = M.normalize(input);
  assert.equal(result.changed, false);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.doc.ops, ops);
  assert.equal(result.doc.title, input.title);
  assert.equal(result.doc.photos[0].blob, p.blob, 'original bytes are the same object, not a copy');
  assert.equal(M.contentKey(input), M.contentKey(result.doc));
  // Idempotent on its own result, also for a mapped document.
  const mapped = M.normalize(doc([{ insert: '줄' }, { insert: '\n', attributes: { list: 'checked' } }])).doc;
  assert.deepEqual(M.normalize(mapped).doc.ops, mapped.ops);
  assert.equal(M.normalize(mapped).changed, false);
});

test('lengths are never cut: a document over a limit stays whole and says what to fix', () => {
  const long = doc([{ insert: '가'.repeat(50001) + '\n' }]), result = M.normalize(long);
  assert.equal(result.doc.ops[0].insert.length, 50002);
  assert.throws(() => M.validate(result.doc), /본문은 50,000자까지 쓸 수 있습니다\. 지금 50,002자입니다\. 줄여 주세요\./);
  // The same message whether one op or many carry the text (it used to depend on the op).
  assert.throws(() => M.validate(doc([{ insert: '가'.repeat(30000) }, { insert: '나'.repeat(30000), attributes: { bold: true } }, { insert: '\n' }])), /본문은 50,000자까지 쓸 수 있습니다\. 지금 60,001자입니다/);
  assert.throws(() => M.validate(doc([{ insert: '끝 줄바꿈 없음' }])), /지원하지 않는 본문 형식/);
  assert.throws(() => M.validate(doc([{ insert: '\n' }], { title: '가'.repeat(501) })), /제목은 500자까지/);
});

test('emptiness and content comparison ignore what normalization changes only in form', async () => {
  const p = await photo();
  assert.equal(M.isEmpty(M.create(core.id)), true);
  assert.equal(M.isEmpty(doc([{ insert: ' \n\t\n' }], { title: '  ' })), true);
  assert.equal(M.isEmpty(doc([{ insert: '글\n' }])), false);
  assert.equal(M.isEmpty(doc([{ insert: '\n' }], { title: '제목' })), false);
  assert.equal(M.isEmpty(doc([{ insert: { photo: { id: p.id, caption: '', alt: '' } } }, { insert: '\n' }], { photos: [p] })), false);
  assert.equal(M.isEmpty(doc([{ insert: '\n' }], { attachments: [{ type: 'book', title: '책', creator: '', url: 'https://example.org/b' }] })), false);
  const a = doc([{ insert: '같은 글\n' }], { title: '제목' }), b = { ...structuredClone(a), id: core.id(), revision: 7, updatedAt: '2026-11-11T00:00:00.000Z' };
  assert.equal(M.contentKey(a), M.contentKey(b));
  b.ops = [{ insert: '다른 글\n' }];
  assert.notEqual(M.contentKey(a), M.contentKey(b));
});

test('the lenient backup writes input that cannot be stored; the strict restore still refuses it', async () => {
  const zip = require('../vendor/fflate/fflate.js');
  const long = doc([{ insert: '가'.repeat(50001) + '\n꼬리\n', attributes: { list: 'checked' } }], { title: '긴 글' });
  await assert.rejects(M.backup(long), /목록 서식|50,000자/);
  const archive = await M.backup(long, { lenient: true });
  const manifest = JSON.parse(zip.strFromU8(zip.unzipSync(new Uint8Array(await archive.arrayBuffer()))['manifest.json']));
  assert.equal(manifest.ops.map(op => op.insert).join('').length, 50001 + 4);
  assert.equal(manifest.ops[0].attributes.list, 'bullet');
  await assert.rejects(M.readBackup(archive, core.id), /본문은 50,000자까지/);
});

test('recovery copies: device-only, per workspace and draft, exact content, no photo bytes', async () => {
  const store = memory(), recovery = M.recovery(store), p = await photo();
  const draft = doc([{ insert: '보관하지 못한 글 ' + '가'.repeat(60000), attributes: { list: 'unchecked' } }, { insert: { photo: { id: p.id, caption: '설명', alt: '', src: 'blob:x' } } }, { insert: '\n' }],
    { title: '제목\u000b', photos: [p], revision: 4, replaces: { id: 'saved-1', revision: 2 }, attachments: [{ type: 'book', title: '책', creator: '', url: 'https://example.org/b' }] });
  assert.equal(recovery.write('ws-a', draft), true);
  const copy = recovery.read('ws-a', draft.id);
  assert.equal(copy.title, draft.title, 'kept without validation or cleaning');
  assert.equal(copy.ops[0].insert, draft.ops[0].insert);
  assert.deepEqual(copy.ops[1], { insert: { photo: { id: p.id, caption: '설명', alt: '' } } }, 'photo references only');
  assert.deepEqual([copy.revision, copy.replaces, copy.attachments.length], [4, { id: 'saved-1', revision: 2 }, 1]);
  assert(!JSON.stringify([...store.map.values()]).includes('blob'), 'no photo bytes or object URLs in localStorage');
  assert.deepEqual([...store.map.keys()], ['haedo_life_post_recovery_v1:ws-a:' + draft.id]);
  // Another workspace (another account's workspaces are other ids) and another draft see nothing.
  assert.equal(recovery.read('ws-b', draft.id), null);
  assert.equal(recovery.read('ws-a', 'other'), null);
  assert.deepEqual(recovery.list('ws-b'), []);
  assert.deepEqual(recovery.list('ws-a').map(item => item.id), [draft.id]);
  // A copy filed under another key, or damaged, is not trusted.
  store.setItem('haedo_life_post_recovery_v1:ws-b:' + draft.id, store.getItem('haedo_life_post_recovery_v1:ws-a:' + draft.id));
  store.setItem('haedo_life_post_recovery_v1:ws-a:broken', '{not json');
  assert.equal(recovery.read('ws-b', draft.id), null);
  assert.equal(recovery.read('ws-a', 'broken'), null);
  assert.deepEqual(recovery.list('ws-a').map(item => item.id), [draft.id]);
  recovery.clear('ws-a', draft.id);
  assert.equal(recovery.read('ws-a', draft.id), null);
  // A full or unavailable store reports failure instead of throwing.
  const full = M.recovery({ ...memory(), setItem() { throw new DOMException('full', 'QuotaExceededError'); } });
  assert.equal(full.write('ws-a', draft), false);
  const none = M.recovery(null);
  assert.equal(none.write('ws-a', draft), false);
  assert.equal(none.read('ws-a', draft.id), null);
  assert.deepEqual(none.list('ws-a'), []);
  assert.equal(recovery.write('ws:a', draft), false, 'identifiers that could cross a key boundary are refused');
});

test('moved posts: an id replaced by a saved revision resolves to the post that took its place', () => {
  const store = memory(), moved = M.moved(store);
  assert.equal(moved.resolve('ws-a', 'a'), null);
  moved.record('ws-a', 'a', 'b'); moved.record('ws-a', 'b', 'c'); moved.record('ws-b', 'a', 'z');
  assert.equal(moved.resolve('ws-a', 'a'), 'c');
  assert.equal(moved.resolve('ws-a', 'b'), 'c');
  assert.equal(moved.resolve('ws-a', 'c'), null);
  assert.equal(moved.resolve('ws-b', 'a'), 'z');
  assert.equal(moved.resolve('ws-c', 'a'), null);
  moved.record('ws-a', 'c', 'a');
  assert.doesNotThrow(() => moved.resolve('ws-a', 'a'), 'a cycle ends');
  assert(!/[가-힣]/.test(JSON.stringify([...store.map.entries()])), 'identifiers only');
  for (let i = 0; i < 400; i++) moved.record('ws-d', 'from' + i, 'to' + i);
  assert.equal(Object.keys(JSON.parse(store.getItem('haedo_life_post_moved_v1:ws-d'))).length, 300, 'bounded');
  assert.equal(moved.resolve('ws-d', 'from399'), 'to399');
});
