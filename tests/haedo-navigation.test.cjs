'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(search = '') {
  const moves = [];
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.isConnected = true; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    append(...children) { this.children.push(...children); }
    addEventListener(name, listener) { this.listeners[name] = listener; }
  }
  const document = { body: { dataset: { page: 'home', haedoSection: 'schedule' } }, querySelectorAll: () => [], addEventListener() {}, createElement: tag => new Element(tag) };
  const context = { document, location: { pathname: '/index.html', search, assign: href => moves.push(href) }, URLSearchParams, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/haedo-navigation.js'), 'utf8'), context);
  return { api: context.HaedoNavigation, document, moves };
}
function event(overrides = {}) {
  return { button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...overrides };
}
const click = (link, value = event()) => link.listeners.click(value);

test('legacy feature links select their current section and unknown views cannot name a section', () => {
  // 2026-11-02 menu: 뉴스·일정·자료·설정; public cover/pages moved to 설정, the plan into 일정.
  for (const [query, expected] of [['?section=tools&view=books', 'records'], ['?section=manage&view=public-pages', 'manage'],
    ['?section=home&view=public-cover', 'manage'], ['?section=tools&view=interests', 'news'], ['?section=manage&view=source-trash', 'records'],
    ['?section=tools&view=annual-plan', 'schedule'], ['?section=schedule&view=tools', 'schedule']]) {
    assert.equal(fixture(query).document.body.dataset.haedoSection, expected, query);
  }
  assert.equal(fixture('?view=page&compose=1').document.body.dataset.haedoSection, 'schedule');
  const { api } = fixture();
  for (const value of ['__proto__', 'constructor', 'toString', 'books-extra', null]) assert.equal(api.getSectionForView(value), null);
});

test('old section addresses open the new sections and only the four menu IDs or their aliases are accepted', () => {
  // Every former ?section= value lands on its new section (home/tools are aliases of schedule).
  for (const [query, expected] of [['', 'schedule'], ['?section=home', 'schedule'], ['?section=tools', 'schedule'], ['?section=schedule', 'schedule'],
    ['?section=records', 'records'], ['?section=manage', 'manage'], ['?section=news', 'news'], ['?section=unknown', 'schedule'], ['?section=__proto__', 'schedule']]) {
    assert.equal(fixture(query).document.body.dataset.haedoSection, expected, query || '(none)');
  }
  const { api } = fixture();
  assert.deepEqual([...api.sections], ['news', 'schedule', 'records', 'manage']);
  for (const [id, expected] of [['home', 'schedule'], ['tools', 'schedule'], ['schedule', 'schedule'], ['news', 'news'], ['records', 'records'],
    ['manage', 'manage'], ['compose', null], ['hasOwnProperty', null], ['__proto__', null], [undefined, null]]) assert.equal(api.normalizeSection(id), expected, String(id));
  for (const [view, expected] of [['home', 'schedule'], ['blog', 'schedule'], ['account-blog', 'schedule'], ['tools', 'schedule'], ['annual-plan', 'schedule'],
    ['public-cover', 'manage'], ['public-pages', 'manage'], ['sources', 'records'], ['time', 'records'], ['backup', 'manage'], ['external-discovery', 'news']]) assert.equal(api.getSectionForView(view), expected, view);
});

test('planning links wait for saved input, suppress duplicate clicks and navigate once', async () => {
  const { api, moves } = fixture(); let release, calls = 0;
  const saved = new Promise(resolve => { release = resolve; });
  const nav = api.createPlanningNavigation({ current: 'annual-plan', beforeNavigate: async ({ id, href }) => {
    calls++; assert.equal(id, 'goals'); assert.equal(href, 'goals.html'); await saved;
  }, onError: assert.fail });
  const first = click(nav.children[1]);
  assert.equal(nav.attributes['aria-busy'], 'true'); assert.deepEqual(moves, []);
  await click(nav.children[2]); assert.equal(calls, 1);
  release(); await first;
  assert.deepEqual(moves, ['goals.html']); assert.equal(nav.attributes['aria-busy'], undefined);
});

test('failed saves, explicit cancellation and an obsolete view never leave the current page', async () => {
  const { api, moves } = fixture(); const errors = []; const cause = new Error('save failed');
  for (const beforeNavigate of [async () => false, async () => { throw cause; }]) {
    const nav = api.createPlanningNavigation({ current: 'annual-plan', beforeNavigate, onError: error => errors.push(error) });
    await click(nav.children[1]); assert.equal(nav.attributes['aria-busy'], undefined);
  }
  let release; const saved = new Promise(resolve => { release = resolve; });
  const nav = api.createPlanningNavigation({ current: 'annual-plan', beforeNavigate: () => saved, onError: assert.fail });
  const pending = click(nav.children[1]); nav.isConnected = false; release(); await pending;
  assert.deepEqual(moves, []); assert.deepEqual(errors, [cause]);
});

test('planning navigation preserves native new-tab actions and never reloads the active editor', async () => {
  const { api, moves } = fixture(); let calls = 0;
  const nav = api.createPlanningNavigation({ current: 'annual-plan', beforeNavigate: async () => { calls++; }, onError: assert.fail });
  const active = event(); await click(nav.children[0], active);
  assert.equal(active.defaultPrevented, true); assert.equal(nav.children[0].attributes['aria-current'], 'page');
  for (const override of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const native = event(override); await click(nav.children[1], native); assert.equal(native.defaultPrevented, false);
  }
  assert.equal(calls, 0); assert.deepEqual(moves, []);
  const nativeNav = api.createPlanningNavigation({ current: 'goals' }); const normal = event();
  await click(nativeNav.children[2], normal); assert.equal(normal.defaultPrevented, false);
});
