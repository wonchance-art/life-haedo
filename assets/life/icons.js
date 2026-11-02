/* Shared UI SVGs: Lucide 1.51.0 geometry, copied from the local subset in vendor/lucide/
 * (ISC + Feather MIT; provenance and hashes in vendor/lucide/UPSTREAM.json). Each entry names its
 * upstream file and tests/icons.test.cjs keeps the geometry identical to that file.
 * 2026-11-02 soft redesign (decision 15): one stroke width 1.8, 20px for controls and 16px inside text,
 * one picture per concept: 자료 = book-open, 인용 = text-quote, 글쓰기 = pencil, 편집 = square-pen,
 * 웹 주소 = link, 일정 = calendar, 연표 = chart-gantt, 연간 계획 = chart-spline, AI 글 표시 = sparkle. No icon runtime, font or remote request.
 */
(function (root) {
  'use strict';
  const life = root.HaedoLife = root.HaedoLife || {};
  const glyphs = {
    disc: ['disc', '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/>'],
    play: ['square-play', '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z"/>'],
    up: ['chevron-up', '<path d="m18 15-6-6-6 6"/>'],
    // AI 글 표시 (PR #169): the unchanged vendor/lucide/icons/sparkle.svg.
    sparkle: ['sparkle', '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>'],
    book: ['book-open', '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>'],
    search: ['search', '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>'],
    bookmark: ['bookmark', '<path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>'],
    heart: ['heart', '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>'],
    more: ['ellipsis', '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'],
    trash: ['trash-2', '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'],
    globe: ['globe', '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'],
    quote: ['text-quote', '<path d="M17 5H3"/><path d="M21 12H8"/><path d="M21 19H8"/><path d="M3 12v7"/>'],
    edit: ['square-pen', '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>'],
    write: ['pencil', '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'],
    refresh: ['refresh-cw', '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'],
    plus: ['plus', '<path d="M5 12h14"/><path d="M12 5v14"/>'],
    folder: ['folder', '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'],
    back: ['chevron-left', '<path d="m15 18-6-6 6-6"/>'],
    arrow: ['arrow-right', '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'],
    info: ['info', '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'],
    filter: ['sliders-horizontal', '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>'],
    close: ['x', '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'],
    chevron: ['chevron-down', '<path d="m6 9 6 6 6-6"/>'],
    link: ['link', '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'],
    settings: ['settings', '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>'],
    download: ['download', '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>'],
    cloud: ['cloud', '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>'],
    home: ['house', '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'],
    news: ['newspaper', '<path d="M15 18h-5"/><path d="M18 14h-8"/><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="10" y="6" rx="1"/>'],
    user: ['user', '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'],
    timeline: ['chart-spline', '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 16c.5-2 1.5-7 4-7 2 0 2 3 4 3 2.5 0 4.5-5 5-7"/>'],
    map: ['map', '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>'],
    target: ['target', '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'],
    check: ['square-check', '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m16 9-5.5 5.5L8 12"/>'],
    workspace: ['layout-grid', '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>'],
    // 연표 (2026-11-02 review): period bars on a time axis; 연간 계획 keeps chart-spline ('timeline').
    chronology: ['chart-gantt', '<path d="M10 6h8"/><path d="M12 16h6"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 11h7"/>'],
    calendar: ['calendar', '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>']
  };
  const STROKE = 1.8;
  function create(name, { size = 20 } = {}) {
    const svg = root.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const glyph = Object.prototype.hasOwnProperty.call(glyphs, name) ? name : 'book';
    const dimension = Number.isFinite(size) && size > 0 ? size : 20;
    const attributes = {
      class: 'life-glyph', 'data-glyph': glyph, width: dimension, height: dimension,
      viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': STROKE,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false'
    };
    for (const [key, value] of Object.entries(attributes)) svg.setAttribute(key, String(value));
    // Only fixed local SVG paths are used; document content never enters this markup.
    svg.innerHTML = glyphs[glyph][1];
    return svg;
  }
  const sources = Object.freeze(Object.fromEntries(Object.entries(glyphs).map(([name, [file, geometry]]) => [name, Object.freeze({ file, geometry })])));
  life.Icons = Object.freeze({ create, sources, stroke: STROKE });
})(globalThis);
