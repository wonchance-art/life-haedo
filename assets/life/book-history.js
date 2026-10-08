/* Detached book-history operations. The caller commits the complete result with CAS. */
(function (root, factory) {
  'use strict';
  const api = factory(root); root.HaedoLife ||= {}; root.HaedoLife.BookHistory = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const fault = (code, message) => Object.assign(new Error(message), { code });
  function model() {
    const value = root.HaedoLife?.Workbench || (typeof require === 'function' ? require('./workbench.js') : null);
    if (!value?.validate) throw fault('dependency_unavailable', '책 저장 모듈을 불러오지 못했습니다.');
    return value;
  }
  function edit(state, bookId, task) {
    const workbench = model(); workbench.validate(state);
    const next = clone(state), book = (next.books || []).find(item => item.id === bookId);
    if (!book) throw fault('book_missing', '선택한 책을 찾을 수 없습니다. 다른 책으로 대체하지 않았습니다.');
    task(next, book, workbench); workbench.validate(next); return next;
  }
  function identities(state) {
    const used = new Set();
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (['id', 'workspaceId', 'versionId', 'seedSourceId', 'candidateSourceId'].includes(key)) used.add(item);
        if (key === 'versionIds' || key.endsWith('VersionIds')) item.forEach(id => used.add(id));
        if (item && typeof item === 'object') visit(item);
      }
    }
    visit(state);
    const core = root.HaedoLife?.Core || (typeof require === 'function' ? require('./core.js') : null);
    if (!core?.id) throw fault('dependency_unavailable', '개정본 식별자 모듈을 불러오지 못했습니다.');
    return () => {
      for (let attempt = 0; attempt < 1024; attempt++) { const id = core.id(); if (!used.has(id)) { used.add(id); return id; } }
      throw fault('id_collision', '개정본 식별자를 만들지 못했습니다. 원본은 유지했습니다.');
    };
  }
  function chapters(input, id) {
    const result = clone(input);
    for (const chapter of result) { chapter.id = id(); for (const insight of chapter.insights || []) insight.id = id(); }
    return result;
  }
  function content(book, id) {
    return { title: book.title, fromYear: book.fromYear, toYear: book.toYear, question: book.question, chapters: chapters(book.chapters, id) };
  }
  function append(book, label, createdAt, id, workbench) {
    if ((book.editions || []).length >= workbench.LIMITS.bookEditions)
      throw fault('book_editions_full', '개정본은 책마다 10개까지 보관할 수 있습니다. 기존 개정본을 확인한 뒤 직접 지워 주세요. 현재 원고는 유지했습니다.');
    const edition = { id: id(), label, createdAt, ...content(book, id) };
    book.editions = (book.editions || []).concat(edition);
  }
  function capture(state, bookId, label, { createdAt = new Date().toISOString() } = {}) {
    return edit(state, bookId, (next, book, workbench) => append(book, label, createdAt, identities(next), workbench));
  }
  function restore(state, bookId, editionId, { createdAt = new Date().toISOString() } = {}) {
    return edit(state, bookId, (next, book, workbench) => {
      const edition = (book.editions || []).find(item => item.id === editionId);
      if (!edition) throw fault('book_edition_missing', '선택한 개정본을 찾을 수 없습니다. 현재 원고는 유지했습니다.');
      const id = identities(next);
      append(book, '복원 전 원고', createdAt, id, workbench);
      // Preserve the target edition and the book's independent archive state.
      Object.assign(book, content(edition, id));
    });
  }
  function archiveBook(state, bookId, archived = true) {
    return edit(state, bookId, (_next, book) => { book.archived = archived; });
  }
  function archiveChapter(state, bookId, chapterId, archived = true) {
    return edit(state, bookId, (_next, book) => {
      const chapter = book.chapters.find(item => item.id === chapterId);
      if (!chapter) throw fault('book_chapter_missing', '선택한 장을 찾을 수 없습니다. 다른 장을 보관하지 않았습니다.');
      chapter.archived = archived;
    });
  }
  function deleteEdition(state, bookId, editionId) {
    return edit(state, bookId, (_next, book) => {
      if (!(book.editions || []).some(item => item.id === editionId)) throw fault('book_edition_missing', '선택한 개정본을 찾을 수 없습니다.');
      book.editions = book.editions.filter(item => item.id !== editionId);
    });
  }
  return Object.freeze({ capture, restore, archiveBook, archiveChapter, deleteEdition });
});
