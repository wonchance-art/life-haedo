const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const data = new Map([
    ['caeyeon_life_registry', JSON.stringify({ docs: [{ id: 'old', name: 'Unowned original' }] })],
    ['caeyeon_life_account_A_registry', JSON.stringify({ current: 'first', docs: [{ id: 'a/?#한글', name: 'A timeline' }] })],
    ['caeyeon_life_account_B_registry', JSON.stringify({ docs: [{ id: 'b', name: 'B timeline' }] })],
  ]);
  const reads = [];
  const context = vm.createContext({
    URL, location: { href: 'https://example.test/life-haedo/life.html' },
    HaedoAuth: { user: { id: 'A' }, config: { url: 'https://project.supabase.co' } },
    localStorage: { getItem(key) { reads.push(key); return data.get(key) ?? null; }, setItem() { throw new Error('Unexpected mutation'); } },
  });
  for (const path of ['assets/platform-data.js', 'assets/life/legacy.js']) vm.runInContext(readFileSync(path, 'utf8'), context);
  return { context, reads, reader: context.HaedoLife.Legacy.forAccount({ projectUrl: 'https://project.supabase.co', userId: 'A' }) };
}

test('timeline links read only the verified account registry and encode the exact document ID', () => {
  const { context, reads, reader } = fixture();
  assert.equal(reads.length, 0);
  assert.equal(context.HaedoLife.Legacy.listDocuments().length, 0);
  const documents = reader.listDocuments();
  assert.equal(documents.length, 1);
  assert.equal(documents[0].name, 'A timeline');
  const url = new URL(reader.open(documents[0]));
  assert.equal(url.pathname, '/life-haedo/timeline.html');
  assert.equal(url.searchParams.get('doc'), 'a/?#한글');
  assert.deepEqual([...new Set(reads)], ['caeyeon_life_account_A_registry']);
  assert.throws(() => reader.open({ legacyDocId: 'b' }));
});

test('account/project changes and read-only views cannot read or link former timelines', () => {
  for (const change of [c => { c.HaedoAuth.user = { id: 'B' }; }, c => { c.HaedoAuth.user = null; }, c => { c.HaedoAuth.config.url = 'https://other.supabase.co'; }, c => { c.VIEW_ONLY = true; }]) {
    const { context, reads, reader } = fixture();
    change(context);
    assert.equal(reader.listDocuments().length, 0);
    assert.throws(() => reader.open({ legacyDocId: 'a/?#한글' }));
    assert.equal(reads.length, 0);
  }
});
