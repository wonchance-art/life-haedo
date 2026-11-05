import assert from 'node:assert/strict';
import { projectMarkdownOps } from '../supabase/functions/haedo-blog-publish/projection.mjs';

const { PhotoPost: Photo, PostMarkdown: Markdown, Blog } = globalThis.HaedoLife;
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
function fixture() {
  const manifest = Photo.create(() => '33333333-3333-4333-8333-333333333333', '2026-11-05T00:00:00.000Z');
  manifest.status = 'saved'; manifest.title = '저장된 제목';
  manifest.photos = ids.map((id, i) => ({ id, name: `비공개 이름 ${i}`, type: 'image/png', width: 8, height: 8, size: 40, digest: String(i + 1).repeat(64) }));
  // Metadata order intentionally opposes body order and selection order.
  const ops = [{ insert: '제목' }, { insert: '\n', attributes: { header: 1 } },
    { insert: '직접 ' }, { insert: 'AI 문장', attributes: { bold: true, italic: true, author: 'ai', link: 'https://example.org/a?x=&amp;' } }, { insert: '\n' },
    { insert: '<span data-author="ai">글자</span>\n' },
    { insert: { photo: { id: ids[1], caption: '두 번째\n설명', alt: '둘' } } },
    { insert: { photo: { id: ids[0], caption: '첫 설명', alt: '하나' } } },
    { insert: '끝' }, { insert: '\n', attributes: { blockquote: true } }];
  manifest.format = 'life-post-md-v1'; manifest.markdown = Markdown.fromDelta(ops).markdown; delete manifest.ops;
  manifest.attachments = [{ type: 'book', title: '책', creator: '저자', url: 'https://example.org/book' }];
  const copies = ids.map((id, i) => ({ id, type: 'image/png', size: 20, width: 4, height: 4, digest: String(i + 3).repeat(64) }));
  return { manifest, copies };
}
function browserDocument(manifest) {
  return { ...manifest, photos: manifest.photos.map(p => ({ ...p, blob: new Blob([new Uint8Array(p.size)], { type: p.type }),
    ...(p.view ? { view: { ...p.view, blob: new Blob([new Uint8Array(p.view.size)], { type: p.view.type }) } } : {}) })) };
}
export const cases = [
  ['actual shared browser projection bytes match after only generated photo-ID correspondence', () => {
    const { manifest, copies } = fixture(), before = structuredClone(manifest);
    for (const photoIds of [[], [ids[0]], [ids[1]], [ids[1], ids[0]]]) {
      const options = { photoIds, copies: copies.filter(p => photoIds.includes(p.id)), author: { name: '사람', intro: '소개' } };
      const browser = Blog.publicSnapshot(browserDocument(manifest), options);
      const selected = manifest.photos.filter(p => photoIds.includes(p.id));
      const mapping = new Map(browser.photos.map((p, i) => [p.id, selected[i].id]));
      for (const op of browser.ops) if (typeof op.insert !== 'string') op.insert.photo.id = mapping.get(op.insert.photo.id);
      assert.equal(JSON.stringify(projectMarkdownOps(manifest, options)), JSON.stringify(browser.ops));
      assert.deepEqual(browser.photos.map(p => p.digest), selected.map(p => copies.find(c => c.id === p.id).digest));
    }
    assert.deepEqual(manifest, before);
  }],
  ['default zero photos and AI removal retain text, links and literal escaped HTML', () => {
    const { manifest } = fixture(), ops = projectMarkdownOps(manifest);
    assert.ok(ops.every(op => typeof op.insert === 'string' && !Object.hasOwn(op.attributes || {}, 'author')));
    assert.ok(ops.some(op => op.insert.includes('AI 문장') && op.attributes.bold && op.attributes.italic && op.attributes.link));
    assert.ok(ops.some(op => op.insert.includes('<span data-author="ai">글자</span>')));
    assert.equal(JSON.stringify(ops).includes('비공개 이름'), false);
  }],
  ['empty public body and terminal photo keep established exact operation shapes', () => {
    const { manifest, copies } = fixture();
    manifest.markdown = Markdown.fromDelta([{ insert: { photo: { id: ids[0], caption: '끝', alt: '' } } }]).markdown;
    assert.deepEqual(projectMarkdownOps(manifest), []);
    assert.deepEqual(projectMarkdownOps(manifest, { photoIds: [ids[0]], copies: [copies[0]] }), [{ insert: { photo: { id: ids[0], caption: '끝', alt: '' } } }]);
  }],
  ['HEIC metadata placeholders validate original and view; only sanitized copy is eligible', () => {
    const { manifest, copies } = fixture(), p = manifest.photos[0];
    p.type = 'image/heic'; p.view = { type: 'image/jpeg', width: 8, height: 8, size: 30, digest: '8'.repeat(64) };
    assert.doesNotThrow(() => projectMarkdownOps(manifest, { photoIds: [p.id], copies: [copies[0]] }));
    assert.throws(() => projectMarkdownOps(manifest, { photoIds: [p.id], copies: [{ ...copies[0], digest: p.view.digest }] }));
    delete p.view;
    assert.throws(() => projectMarkdownOps(manifest));
  }],
  ['strict source validation rejects v2, draft, archive, extra fields and invalid attachments', () => {
    for (const change of [m => { m.format = 'life-photo-post-v2'; }, m => { m.status = 'draft'; }, m => { m.archived = true; },
      m => { m.ops = []; }, m => { m.attachments[0].url = 'javascript:alert(1)'; }, m => { m.photos[0].size = -1; },
      m => { m.photos[0].privateExtra = 'must not pass manifest validation'; },
      m => { m.photos[0].blob = 'transport manifests must contain metadata only'; }]) {
      const { manifest } = fixture(); change(manifest); assert.throws(() => projectMarkdownOps(manifest));
    }
  }],
  ['stored noncanonical Markdown, unsafe links and undeclared image references fail closed', () => {
    for (const markdown of ['__noncanonical bold__\n', '[x](javascript:alert%281%29)\n', '![x](https://example.org/a.png)\n',
      '![x](haedo-photo:99999999-9999-4999-8999-999999999999 "")\n', '```js\nalert(1)\n```\n']) {
      const { manifest } = fixture(); manifest.markdown = markdown; assert.throws(() => projectMarkdownOps(manifest));
    }
  }],
  ['selection and metadata-free copy constraints reject unknown, duplicate, missing and original copies', () => {
    const { manifest, copies } = fixture();
    for (const options of [{ photoIds: ['missing'] }, { photoIds: [ids[0], ids[0]], copies: [copies[0]] },
      { photoIds: [ids[0]] }, { copies: [copies[0]] }, { photoIds: [ids[0]], copies: null },
      { photoIds: [ids[0]], copies: [copies[0], copies[0]] },
      { photoIds: [ids[0]], copies: [{ ...copies[0], digest: manifest.photos[0].digest }] },
      { photoIds: [ids[0]], copies: [{ ...copies[0], width: 9 }] }]) assert.throws(() => projectMarkdownOps(manifest, options));
  }],
  ['existing text, operation, Markdown-byte, author and snapshot metadata caps remain enforced', () => {
    const { manifest } = fixture();
    for (const markdown of [Markdown.fromDelta([{ insert: 'a'.repeat(50000) + '\n' }]).markdown,
      Markdown.fromDelta(Array.from({ length: 5001 }, (_, i) => ({ insert: 'x', attributes: i % 2 ? { bold: true } : { italic: true } }))).markdown,
      'x'.repeat(1024 * 1024 + 1)]) assert.throws(() => projectMarkdownOps({ ...manifest, markdown }));
    assert.throws(() => projectMarkdownOps(manifest, { author: { name: 'a'.repeat(501), intro: '' } }));
    assert.throws(() => projectMarkdownOps({ ...manifest, title: 'a'.repeat(501) }));
    const valid = { ...manifest, markdown: Markdown.fromDelta([{ insert: '가\n'.repeat(25000) }]).markdown };
    assert.equal(projectMarkdownOps(valid).map(op => op.insert).join(''), '가\n'.repeat(25000));
  }],
];

if (globalThis.Deno) for (const [name, fn] of cases) Deno.test(name, fn);
