/* Shared UI SVGs. Lucide 1.51.0 geometry: vendor/lucide/ (ISC + Feather MIT).
 * quote: Haedo's approved A. settings/download/cloud/home/user/workspace/timeline/target/check/map:
 * locally authored conventional UI geometry; no added library or remote asset.
 */
(function (root) {
  'use strict';
  const life = root.HaedoLife = root.HaedoLife || {};
  const paths = {
    book: '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>',
    search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
    bookmark: '<path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>',
    quote: '<path d="M10 12H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v8a6 6 0 0 1-6 6M21 12h-5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v8a6 6 0 0 1-6 6"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    filter: '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    settings: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    cloud: '<path d="M7 19a5 5 0 0 1-.8-9.9 6.5 6.5 0 0 1 12.6 1.6A4.2 4.2 0 0 1 18 19Z"/>',
    home: '<path d="m3 10 9-7 9 7M5 9v10a2 2 0 0 0 2 2h3v-7h4v7h3a2 2 0 0 0 2-2V9"/>',
    user: '<circle cx="12" cy="7.5" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/>',
    timeline: '<path d="M4 20h16M5 15l5-6 5 3 4-7"/><circle cx="10" cy="9" r="2"/><circle cx="15" cy="12" r="2"/>',
    map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>',
    check: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
    workspace: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'
  };
  function create(name, { size = 20 } = {}) {
    const svg = root.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const glyph = Object.prototype.hasOwnProperty.call(paths, name) ? name : 'book';
    const dimension = Number.isFinite(size) && size > 0 ? size : 20;
    const attributes = {
      class: 'life-glyph', 'data-glyph': glyph, width: dimension, height: dimension,
      viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false'
    };
    for (const [key, value] of Object.entries(attributes)) svg.setAttribute(key, String(value));
    // Only fixed local SVG paths are used; document content never enters this markup.
    svg.innerHTML = paths[glyph];
    return svg;
  }
  life.Icons = Object.freeze({ create });
})(globalThis);
