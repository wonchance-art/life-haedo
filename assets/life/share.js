/* Explicit public copies. Private workspace identities and notes never enter the snapshot. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  root.HaedoLife ||= {}; root.HaedoLife.Share = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const LIMITS = Object.freeze({ bytes: 1024 * 1024, entries: 100, parts: 100, totalParts: 200,
    title: 500, text: 50000, url: 2048, author: 200, date: 200, omissions: 20, omission: 300 });
  const ORIGINS = ['apple_notes', 'obsidian', 'naver_blog', 'instagram', 'other'];
  const RELATIONS = ['self', 'other', 'unknown'];
  const COVERAGE = ['full_text', 'partial', 'link_only', 'unknown'];
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  function fail(code, message) { throw Object.assign(new Error(message), { code }); }
  function assert(value, message = '공개 사본의 항목과 형식을 확인해 주세요.') { if (!value) fail('invalid_snapshot', message); }
  function fields(value, names, required = names) {
    assert(plain(value) && Reflect.ownKeys(value).every(key => names.includes(key)) && required.every(key => Object.hasOwn(value, key)));
  }
  function text(value, max, nonempty = false) {
    assert(typeof value === 'string' && value.length <= max && (!nonempty || value.trim().length > 0));
    assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), '공개할 글의 제어 문자를 확인해 주세요.');
    for (let index = 0; index < value.length; index++) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++index); assert(next >= 0xdc00 && next <= 0xdfff);
      } else assert(unit < 0xdc00 || unit > 0xdfff);
    }
  }
  function nullableText(value, max) { if (value !== null) text(value, max); }
  function list(value, max) {
    assert(Array.isArray(value) && value.length <= max && Reflect.ownKeys(value).every(key => key === 'length' ||
      typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length));
    for (let index = 0; index < value.length; index++) assert(Object.hasOwn(value, index));
  }
  function identifier(value) { assert(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)); }
  function safeURL(value) {
    if (value === null || value === '') return null;
    let url;
    if (typeof value !== 'string' || value.length > LIMITS.url || !/^https?:\/\//i.test(value) || /[\s\u0000-\u001f\u007f\\]/.test(value))
      fail('unsafe_url', '공개할 출처는 접속 정보가 없는 http 또는 https 주소여야 합니다.');
    try { url = new URL(value); } catch (_) { fail('unsafe_url', '공개할 출처 주소를 확인해 주세요.'); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || /@/.test(value.split('/')[2]))
      fail('unsafe_url', '공개할 출처 주소에 접속 정보를 넣을 수 없습니다.');
    return value;
  }
  function bytes(value) {
    let serialized;
    try { serialized = JSON.stringify(value); } catch (_) { fail('invalid_snapshot', '공개 사본을 JSON으로 읽을 수 없습니다.'); }
    if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).length > LIMITS.bytes)
      fail('snapshot_too_large', '공개 사본은 1 MiB까지입니다. 게시할 항목을 줄여 주세요.');
  }
  function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  function validate(snapshot) {
    fields(snapshot, ['format', 'title', 'intro', 'entries']);
    assert(snapshot.format === 'life-share-v1'); text(snapshot.title, LIMITS.title, true); nullableText(snapshot.intro, LIMITS.text);
    list(snapshot.entries, LIMITS.entries);
    let total = 0;
    for (const entry of snapshot.entries) {
      fields(entry, ['title', 'pinned', 'note', 'parts']); text(entry.title, LIMITS.title, true);
      assert(typeof entry.pinned === 'boolean'); nullableText(entry.note, LIMITS.text); list(entry.parts, LIMITS.parts);
      total += entry.parts.length; assert(total <= LIMITS.totalParts, '공개할 원문은 전체 200개까지 선택해 주세요.');
      for (const part of entry.parts) {
        fields(part, ['title', 'origin', 'url', 'author', 'originalCreatedAt', 'coverage', 'text', 'textKind']);
        text(part.title, LIMITS.title, true); assert(ORIGINS.includes(part.origin));
        assert(part.url !== ''); safeURL(part.url);
        fields(part.author, ['label', 'relation']); text(part.author.label, LIMITS.author); assert(RELATIONS.includes(part.author.relation));
        nullableText(part.originalCreatedAt, LIMITS.date);
        fields(part.coverage, ['status', 'omissions']); assert(COVERAGE.includes(part.coverage.status));
        list(part.coverage.omissions, LIMITS.omissions); part.coverage.omissions.forEach(value => text(value, LIMITS.omission));
        assert(['none', 'body', 'excerpt'].includes(part.textKind));
        if (part.textKind === 'none') assert(part.text === null);
        else { text(part.text, LIMITS.text, true); assert(part.coverage.status !== 'link_only'); }
      }
    }
    bytes(snapshot); return true;
  }
  function models() {
    const core = root.HaedoLife?.Core || (typeof require === 'function' ? require('./core.js') : null);
    const workbench = root.HaedoLife?.Workbench || (typeof require === 'function' ? require('./workbench.js') : null);
    if (!core?.validateWorkspace || !workbench?.validate) fail('dependency_unavailable', '원문과 페이지 모듈을 불러오지 못했습니다.');
    return { core, workbench };
  }
  function makeDraft(bundle, state, choices = {}) {
    const { core, workbench } = models(); core.validateWorkspace(bundle); workbench.validate(state);
    assert(bundle.workspaceId === state.workspaceId, '원문과 내 페이지의 작업공간이 다릅니다.');
    fields(choices, ['bodyVersionIds', 'excerpts'], []);
    const bodies = Object.hasOwn(choices, 'bodyVersionIds') ? choices.bodyVersionIds : [];
    const excerpts = Object.hasOwn(choices, 'excerpts') ? choices.excerpts : [];
    list(bodies, LIMITS.totalParts); list(excerpts, LIMITS.totalParts);
    const selected = new Set(), quotes = new Map();
    for (const id of bodies) { identifier(id); assert(!selected.has(id), '같은 원문을 두 번 선택할 수 없습니다.'); selected.add(id); }
    for (const excerpt of excerpts) {
      fields(excerpt, ['versionId', 'start', 'end']); identifier(excerpt.versionId);
      assert(!selected.has(excerpt.versionId) && !quotes.has(excerpt.versionId), '한 원문에서는 전체 본문 또는 한 인용 구간을 선택해 주세요.');
      assert(Number.isSafeInteger(excerpt.start) && Number.isSafeInteger(excerpt.end) && excerpt.start >= 0 && excerpt.end > excerpt.start);
      quotes.set(excerpt.versionId, excerpt);
    }
    const sourceMap = new Map(bundle.sources.map(source => [source.id, source]));
    const versionMap = new Map(bundle.sourceVersions.map(version => [version.id, version]));
    const rows = new Map();
    const entries = state.page.entries.filter(entry => entry.enabled && (entry.pinned || state.page.showRecent))
      .slice().sort((a, b) => Number(b.pinned) - Number(a.pinned)).map(entry => ({
        title: entry.title, pinned: entry.pinned, note: entry.showNote && entry.note ? entry.note : null,
        parts: entry.parts.filter(part => part.enabled).map(part => {
          const version = versionMap.get(part.versionId), source = version && sourceMap.get(version.sourceId);
          if (!version || !source) fail('missing_reference', '표시할 항목에 연결된 원문이 없습니다. 내 페이지에서 확인해 주세요.');
          const meta = { title: source.title, origin: source.origin, url: safeURL(source.url || null),
            author: { label: version.originalAuthor.label, relation: version.originalAuthor.relation },
            originalCreatedAt: version.originalCreatedAt,
            coverage: { status: version.coverage.status, omissions: version.coverage.omissions.slice() } };
          const available = entry.showBody && version.contentText !== null;
          const previous = rows.get(version.id);
          rows.set(version.id, { versionId: version.id, ...meta, text: version.contentText,
            canIncludeBody: available || !!previous?.canIncludeBody });
          let value = null, textKind = 'none';
          if (available && selected.has(version.id)) { value = version.contentText; textKind = 'body'; }
          if (available && quotes.has(version.id)) {
            const quote = quotes.get(version.id);
            assert(quote.end <= version.contentText.length, '인용할 구간이 보관한 원문을 벗어났습니다.');
            value = version.contentText.slice(quote.start, quote.end); textKind = 'excerpt';
            text(value, LIMITS.text, true); // Also rejects a boundary through a UTF-16 surrogate pair.
          }
          return { ...meta, text: value, textKind };
        })
      }));
    for (const id of [...selected, ...quotes.keys()]) assert(rows.get(id)?.canIncludeBody,
      '지금 표시할 수 있는 본문만 선택해 주세요. 숨긴 항목이나 링크만 보관한 원문은 게시하지 않습니다.');
    const snapshot = { format: 'life-share-v1', title: state.page.title,
      intro: state.page.showIntro && state.page.intro ? state.page.intro : null, entries };
    validate(snapshot);
    return freeze({ snapshot, reviewRows: [...rows.values()] });
  }
  return Object.freeze({ LIMITS, safeURL, validate, makeDraft });
});
