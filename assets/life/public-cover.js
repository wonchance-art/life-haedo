/* Explicit public URL pointers only. No target content, identities or network. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).PublicCover = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const FORMAT = 'life-public-cover-v1';
  const LIMITS = Object.freeze({ covers: 20, items: 20, title: 200, intro: 2000, json: 512 * 1024 });
  const destinations = Object.freeze({ post: ['blog.html', 'post', '글'], series: ['series.html', 'series', '연재'], nine: ['taste.html', 'nine', '9칸'] });
  const clone = value => structuredClone(value);
  const dependency = (name, file) => root.HaedoLife?.[name] || (typeof require === 'function' && require('./' + file));
  const fail = message => { throw Object.assign(new Error(message || '공개 표지의 형식과 선택한 항목을 확인해 주세요.'), { code: 'invalid_public_cover' }); };
  const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  function fields(value, allowed) {
    if (!plain(value) || Reflect.ownKeys(value).length !== allowed.length || allowed.some(key => !Object.hasOwn(value, key))) fail();
  }
  function uuid(value) {
    if (typeof value !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) fail('표지와 공개 항목의 식별자를 확인해 주세요.');
    return value.toLowerCase();
  }
  function text(value, limit) {
    if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(value)) fail('제목·소개의 길이와 문자를 확인해 주세요.');
  }
  function list(value, limit) {
    if (!Array.isArray(value) || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) fail('표지와 항목의 개수·순서를 확인해 주세요.');
    for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) fail('빠진 항목이 있는 표지는 보관하지 않았습니다.');
  }
  function unique(value, used) { const key = uuid(value); if (used.has(key)) fail('표지와 항목의 식별자가 중복됐습니다.'); used.add(key); }
  function validateItem(value) {
    fields(value, ['id', 'kind', 'publicId']); uuid(value.id); uuid(value.publicId);
    if (!Object.hasOwn(destinations, value.kind)) fail('공개 글·연재·9칸만 표지에 담을 수 있습니다.');
  }
  function validate(cover) {
    fields(cover, ['format', 'id', 'title', 'intro', 'items']);
    if (cover.format !== FORMAT) fail('지원하지 않는 표지 형식입니다.');
    uuid(cover.id); text(cover.title, LIMITS.title); text(cover.intro, LIMITS.intro); list(cover.items, LIMITS.items);
    const ids = new Set([uuid(cover.id)]), targets = new Set();
    for (const item of cover.items) {
      validateItem(item); unique(item.id, ids); const key = item.kind + ':' + uuid(item.publicId);
      if (targets.has(key)) fail('같은 공개 항목을 두 번 담을 수 없습니다.'); targets.add(key);
    }
    return cover;
  }
  function empty(workspaceId) {
    if (typeof workspaceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)) fail('표지를 보관할 작업공간을 확인해 주세요.');
    return { workspaceId, revision: 0, covers: [] };
  }
  function validateState(state) {
    fields(state, ['workspaceId', 'revision', 'covers']); empty(state.workspaceId);
    if (!Number.isSafeInteger(state.revision) || state.revision < 0) fail('표지의 저장 기준을 확인해 주세요.');
    list(state.covers, LIMITS.covers); const ids = new Set();
    for (const cover of state.covers) { validate(cover); for (const value of [cover.id, ...cover.items.map(item => item.id)]) unique(value, ids); }
    if (new TextEncoder().encode(JSON.stringify(state)).length > LIMITS.json) fail('표지 입력이 너무 큽니다. 내용을 줄인 뒤 다시 보관해 주세요.');
    return state;
  }
  function fresh() { return dependency('Core', 'core.js').id(); }
  function create(idFn = fresh) {
    if (typeof idFn !== 'function') fail();
    const value = { format: FORMAT, id: uuid(idFn()), title: '', intro: '', items: [] }; validate(value); return value;
  }
  function item(kind, publicId, idFn = fresh) {
    if (typeof idFn !== 'function') fail();
    const value = { id: uuid(idFn()), kind, publicId: uuid(publicId) }; validateItem(value); return value;
  }
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  function address(kind, publicId, baseURL) {
    try {
      const source = new URL(baseURL || root.location?.href);
      if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) fail('표지를 읽는 사이트의 주소를 확인해 주세요.');
      const [file, parameter] = destinations[kind], url = new URL(file, source); url.searchParams.set(parameter, uuid(publicId)); return url.href;
    } catch (error) { if (error.code === 'invalid_public_cover') throw error; fail('표지를 읽는 사이트의 주소를 확인해 주세요.'); }
  }
  const label = (kind, index) => `${index + 1}. ${destinations[kind][2]}`;
  function project(cover, baseURL) {
    validate(cover);
    if (!cover.title.trim() || !cover.items.length) fail('공개 제목과 대표 항목을 하나 이상 선택해 주세요.');
    const snapshot = { format: 'life-share-v1', title: cover.title, intro: cover.intro || null,
      entries: cover.items.map((item, index) => ({ title: label(item.kind, index), pinned: false, note: null, parts: [],
        attachments: [{ type: 'article', title: label(item.kind, index), creator: '', url: address(item.kind, item.publicId, baseURL) }] })) };
    parse(snapshot, baseURL); return freeze(snapshot);
  }
  function parse(snapshot, baseURL) {
    dependency('Share', 'share.js').validate(snapshot); text(snapshot.title, LIMITS.title);
    if (snapshot.intro !== null) text(snapshot.intro, LIMITS.intro);
    list(snapshot.entries, LIMITS.items); if (!snapshot.entries.length) fail('대표 항목이 없는 공개 표지입니다.');
    const items = [], targets = new Set();
    for (const [index, entry] of snapshot.entries.entries()) {
      if (entry.pinned !== false || entry.note !== null || entry.parts.length !== 0 || entry.attachments?.length !== 1) fail('표지에는 공개 주소만 담을 수 있습니다.');
      const attachment = entry.attachments[0]; if (attachment.type !== 'article' || attachment.creator !== '') fail();
      let selected = null;
      for (const [kind, [, parameter]] of Object.entries(destinations)) {
        let publicId;
        try { publicId = uuid(new URL(attachment.url).searchParams.get(parameter)); } catch (_) { continue; }
        if (attachment.url === address(kind, publicId, baseURL)) selected = { kind, publicId };
      }
      if (!selected || entry.title !== label(selected.kind, index) || attachment.title !== entry.title) fail('정해진 사이트의 공개 글·연재·9칸 주소만 열 수 있습니다.');
      const key = selected.kind + ':' + selected.publicId; if (targets.has(key)) fail('공개 항목이 중복됐습니다.'); targets.add(key); items.push(selected);
    }
    return freeze(clone({ title: snapshot.title, intro: snapshot.intro, items }));
  }
  return Object.freeze({ FORMAT, LIMITS, empty, create, item, validate, validateState, project, parse });
});
