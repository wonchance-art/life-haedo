/* 자료 목록의 행 표시 도우미 (2026-11-03 부드러운 판 묶음 C).
 * 읽기 전용 표시만 만든다. 저장·동기화·검색 규칙은 ui.js와 core.js에 남는다. */
(function (root) {
  'use strict';
  const KINDS = Object.freeze([['all', '전체'], ['original', '원문'], ['excerpt', '발췌'], ['article', '기사']]);
  const KIND_IDS = new Set(KINDS.map(([id]) => id));
  // A saved news link or another web page kept under '기타' is an article; every
  // other source (notes, Obsidian, blog posts, own writing) is an original.
  function isArticle(source) {
    return !!source && source.origin === 'other' && typeof source.url === 'string' && /^https?:\/\//i.test(source.url);
  }
  function kindAllows(kind, source) {
    if (kind === 'article') return isArticle(source);
    if (kind === 'original') return !!source && !isArticle(source);
    return true;
  }
  function validKind(kind) { return KIND_IDS.has(kind) ? kind : 'all'; }
  const pad = value => String(value).padStart(2, '0');
  // Local calendar date and time; earlier years keep their year so old notes read correctly.
  function stamp(value, now = new Date()) {
    const time = typeof value === 'string' ? Date.parse(value) : NaN;
    if (!Number.isFinite(time)) return null;
    const date = new Date(time);
    const sameYear = date.getFullYear() === now.getFullYear();
    return {
      day: (sameYear ? '' : date.getFullYear() + '.') + (date.getMonth() + 1) + '.' + date.getDate(),
      time: pad(date.getHours()) + ':' + pad(date.getMinutes()),
      label: date.getFullYear() + '년 ' + (date.getMonth() + 1) + '월 ' + date.getDate() + '일 ' + pad(date.getHours()) + ':' + pad(date.getMinutes()),
      iso: date.toISOString()
    };
  }
  function element(document, tag, text, cls) {
    const value = document.createElement(tag);
    if (text != null) value.textContent = text;
    if (cls) value.className = cls;
    return value;
  }
  function when(document, value, now) {
    const parts = stamp(value, now), cell = element(document, parts ? 'time' : 'span', null, 'records-when');
    if (!parts) { cell.append(element(document, 'span', '날짜 없음', 'records-day')); return cell; }
    cell.dateTime = parts.iso; cell.title = parts.label;
    cell.append(element(document, 'span', parts.day, 'records-day'), element(document, 'span', parts.time, 'records-time'));
    return cell;
  }
  function badges(document, values) {
    const row = element(document, 'p', null, 'records-badges');
    for (const value of values.filter(Boolean)) row.append(element(document, 'span', value, 'records-badge'));
    return row;
  }
  // Text tabs over one result list. Arrow keys move between tabs; the list stays the same element.
  function tabs(document, { current, counts = {}, onSelect, controls }) {
    const list = element(document, 'div', null, 'records-tabs');
    list.setAttribute('role', 'tablist'); list.setAttribute('aria-label', '종류');
    const buttons = KINDS.map(([id, label]) => {
      const tab = element(document, 'button', null, 'records-tab');
      tab.type = 'button'; tab.id = 'lifeRecordKind-' + id; tab.dataset.recordKind = id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(id === current));
      tab.tabIndex = id === current ? 0 : -1;
      if (controls) tab.setAttribute('aria-controls', controls);
      tab.append(element(document, 'span', label));
      if (id === current && Number.isInteger(counts[id])) tab.append(element(document, 'span', ' ' + counts[id], 'records-tab-count'));
      tab.addEventListener('click', () => { if (id !== current) onSelect(id); });
      return tab;
    });
    list.addEventListener('keydown', event => {
      const index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index - 1 + buttons.length) % buttons.length :
        event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); buttons[next].focus(); onSelect(buttons[next].dataset.recordKind, { focus: true });
    });
    list.append(...buttons);
    return list;
  }
  // Literal matches of the list query in one exact version's text, as UTF-16 ranges.
  function matches(core, text, query, options = {}, limit = 500) {
    const result = [];
    if (typeof text !== 'string' || !query.trim()) return result;
    let offset = 0;
    while (offset <= text.length && result.length < limit) {
      const found = core.findSearchText(text.slice(offset), query, options);
      if (!found) break;
      const start = offset + found.start, end = offset + found.end;
      result.push({ start, end });
      offset = end > start ? end : end + 1;
    }
    return result;
  }
  // Custom highlights paint ranges without splitting the reader's single text node,
  // so selection offsets keep pointing at the original UTF-16 text.
  function paint(name, ranges) {
    const registry = root.CSS?.highlights, Highlight = root.Highlight;
    if (!registry || typeof Highlight !== 'function') return () => {};
    if (!ranges.length) { registry.delete(name); return () => {}; }
    const highlight = new Highlight(...ranges); registry.set(name, highlight);
    return () => { if (registry.get(name) === highlight) registry.delete(name); };
  }
  root.HaedoLife ||= {};
  root.HaedoLife.RecordsList = Object.freeze({ KINDS, isArticle, kindAllows, validKind, stamp, when, badges, tabs, matches, paint });
})(globalThis);
