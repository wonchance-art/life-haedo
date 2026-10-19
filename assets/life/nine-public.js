/* One explicitly selected area as public metadata. No storage, network or private evidence. */
(function (root, factory) {
  'use strict'; const api = factory(root); (root.HaedoLife ||= {}).NinePublic = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const dependency = (name, file) => root.HaedoLife?.[name] || require('./' + file);
  const clone = value => structuredClone(value);
  const fail = message => { throw Object.assign(new Error(message), { code: 'invalid_nine_public' }); };
  const plain = value => value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  function fields(value, allowed, required = allowed) {
    if (!plain(value) || Reflect.ownKeys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail('공개할 9칸의 형식을 확인해 주세요.');
  }
  function dense(values) {
    if (!Array.isArray(values) || Reflect.ownKeys(values).some(key => key !== 'length' &&
      !(typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < values.length))) fail('공개할 항목의 순서를 확인해 주세요.');
    for (let index = 0; index < values.length; index++) if (!Object.hasOwn(values, index)) fail('빈 칸 사이에 숨은 항목을 넣을 수 없습니다.');
  }
  function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value;
  }
  function parse(snapshot) {
    dependency('Share', 'share.js').validate(snapshot);
    if (snapshot.entries.length !== 1) fail('공개 9칸은 한 영역만 포함해야 합니다.');
    const entry = snapshot.entries[0];
    if (entry.pinned !== false || entry.note !== null || entry.parts.length !== 0 ||
      !Array.isArray(entry.attachments) || entry.attachments.length < 1 || entry.attachments.length > 9) fail('선택한 영역의 항목 정보만 공개할 수 있습니다.');
    dense(entry.attachments);
    const value = clone(snapshot);
    return freeze({ title: value.title, intro: value.intro, areaTitle: value.entries[0].title,
      items: Array.from({ length: 9 }, (_, index) => value.entries[0].attachments[index] || null) });
  }
  function project(state, options) {
    fields(options, ['boardId', 'areaId', 'title', 'intro'], ['boardId', 'areaId', 'title']);
    const nine = dependency('NineBoard', 'nine-board.js'); nine.validate(state);
    const owned = clone(state), selected = clone(options), board = owned.boards.find(value => value.id === selected.boardId);
    if (!board || !board.areas.some(value => value.id === selected.areaId)) fail('공개할 구성과 영역을 다시 골라 주세요.');
    const content = nine.imageContent(board, selected.areaId), attachments = content.items.filter(value => value !== null);
    if (!attachments.length) fail('공개할 항목이 있는 영역을 골라 주세요.');
    const snapshot = { format: 'life-share-v1', title: selected.title, intro: selected.intro === undefined ? null : selected.intro,
      entries: [{ title: content.areaTitle, pinned: false, note: null, parts: [], attachments }] };
    parse(snapshot);
    return freeze({ workspaceId: owned.workspaceId, localRevision: owned.revision, boardId: board.id, areaId: selected.areaId, snapshot });
  }
  return Object.freeze({ project, parse });
});
