/* Read-only Markdown projection. Stored source strings and quote offsets stay raw. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  const life = root.HaedoLife = root.HaedoLife || {};
  life.SourceMarkdown = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const LIMITS = Object.freeze({ bytes: 1024 * 1024, tokens: 50000, depth: 20 });
  const TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'em', 'strong', 's', 'br', 'hr', 'a', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td'];
  const bound = (raw, value) => {
    if (!Number.isInteger(value)) return null;
    let offset = Math.max(0, Math.min(raw.length, value));
    if (offset > 0 && offset < raw.length && /[\uD800-\uDBFF]/.test(raw[offset - 1]) && /[\uDC00-\uDFFF]/.test(raw[offset])) offset--;
    return offset;
  };
  function lineStarts(raw) {
    const starts = [0];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '\r') { if (raw[i + 1] === '\n') i++; starts.push(i + 1); }
      else if (raw[i] === '\n') starts.push(i + 1);
    }
    return starts;
  }
  function safeLink(value) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return false;
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password; }
    catch (_) { return false; }
  }
  function prepare(raw) {
    if (typeof raw !== 'string') throw new TypeError('원문 문자열이 필요합니다.');
    if (raw.length > LIMITS.bytes || new TextEncoder().encode(raw).byteLength > LIMITS.bytes) return { formatted: false, reason: 'too_large' };
    const parser = root.markdownit || (typeof require === 'function' && require('../../vendor/markdown-it/markdown-it.umd.min.js'));
    if (typeof parser !== 'function') return { formatted: false, reason: 'unavailable' };
    try {
      // One spare parser level lets the guard detect clipping rather than
      // silently presenting a partially parsed excessively nested document.
      const md = parser({ html: false, linkify: false, typographer: false, maxNesting: LIMITS.depth + 1 });
      const lines = lineStarts(raw), env = {};
      if (lines.length > LIMITS.tokens / 2) return { formatted: false, reason: 'too_many_tokens' };
      const tokens = md.parse(raw[0] === '\uFEFF' ? raw.slice(1) : raw, env);
      let count = 0;
      const visit = (items, depth) => {
        if (depth > LIMITS.depth) throw new Error('too_deep');
        for (const token of items) {
          if (++count > LIMITS.tokens) throw new Error('too_many_tokens');
          if (token.level >= LIMITS.depth) throw new Error('too_deep');
          if (token.children) visit(token.children, depth + 1);
        }
      };
      visit(tokens, 0);
      const blocks = [];
      for (const token of tokens) {
        if (token.level !== 0 || token.hidden || !token.tag || token.nesting < 0 || !token.map) continue;
        const [begin, end] = token.map;
        if (!Number.isInteger(begin) || !Number.isInteger(end) || begin < 0 || end <= begin || begin >= lines.length || end > lines.length) throw new Error('mapping');
        const start = lines[begin], finish = end === lines.length ? raw.length : lines[end];
        if (blocks.length && start < blocks[blocks.length - 1].end) throw new Error('mapping');
        const index = blocks.length;
        token.attrSet('data-source-block', String(index));
        blocks.push({ start, end: finish });
      }
      const escape = md.utils.escapeHtml;
      // No image element is ever constructed, even before sanitization.
      md.renderer.rules.image = (items, index) => '[이미지: ' + escape(items[index].content || '설명 없음') + ']';
      const links = [];
      md.renderer.rules.link_open = (items, index) => {
        const href = items[index].attrGet('href'), allowed = safeLink(href); links.push(allowed);
        return allowed ? '<a href="' + escape(href) + '" target="_blank" rel="noopener noreferrer">' : '<span>';
      };
      md.renderer.rules.link_close = () => links.pop() ? '</a>' : '</span>';
      const code = (items, index) => {
        const token = items[index], anchor = token.attrGet('data-source-block');
        return '<pre' + (anchor === null ? '' : ' data-source-block="' + anchor + '"') + '><code>' + escape(token.content) + '</code></pre>\n';
      };
      md.renderer.rules.fence = md.renderer.rules.code_block = code;
      return { formatted: true, reason: null, html: md.renderer.render(tokens, md.options, env), blocks };
    } catch (error) { return { formatted: false, reason: ['too_deep', 'too_many_tokens', 'mapping'].includes(error?.message) ? error.message : 'parse_failed' }; }
  }
  function render(document, raw) {
    if (!document?.createElement || typeof raw !== 'string') throw new TypeError('문서와 원문 문자열이 필요합니다.');
    const element = document.createElement('div');
    element.tabIndex = 0; element.setAttribute('role', 'document'); element.setAttribute('aria-label', '보관한 원문');
    function fallback(reason) {
      element.className = 'life-source-text'; element.replaceChildren(document.createTextNode(raw));
      return Object.freeze({ element, formatted: false, reason, blocks: Object.freeze([]), adapter: null });
    }
    const plan = prepare(raw), purifier = root.DOMPurify;
    if (!plan.formatted) return fallback(plan.reason);
    if (!purifier?.sanitize || purifier.isSupported === false) return fallback('unavailable');
    try {
      const fragment = purifier.sanitize(plan.html, { RETURN_DOM_FRAGMENT: true, ALLOWED_TAGS: TAGS,
        ALLOWED_ATTR: ['href', 'target', 'rel', 'start', 'data-source-block'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
        FORBID_TAGS: ['img', 'svg', 'math', 'style', 'script', 'iframe', 'video', 'audio', 'source', 'input', 'form', 'template'],
        FORBID_ATTR: ['id', 'name', 'style'], SANITIZE_DOM: true });
      if (fragment?.nodeType !== 11) return fallback('sanitize_failed');
      element.className = 'source-markdown'; element.append(fragment);
      const anchors = [...element.querySelectorAll('[data-source-block]')];
      if (anchors.length !== plan.blocks.length) return fallback('mapping');
      const blocks = anchors.map((node, index) => {
        if (node.getAttribute('data-source-block') !== String(index)) throw new Error('mapping');
        return Object.freeze({ element: node, ...plan.blocks[index] });
      });
      const adapter = Object.freeze({ raw,
        clampOffset: value => bound(raw, value),
        visibleOffset() {
          const viewport = document.defaultView?.innerHeight || root.innerHeight;
          if (!element.isConnected || !Number.isFinite(viewport)) return null;
          const target = viewport / 3;
          // Top-level blocks follow document flow. Avoid measuring thousands of
          // offscreen paragraphs on each real reading scroll.
          let low = 0, high = blocks.length;
          while (low < high) {
            const mid = (low + high) >>> 1;
            if (blocks[mid].element.getBoundingClientRect().bottom <= 0) low = mid + 1;
            else high = mid;
          }
          let last = null;
          for (let i = low; i < blocks.length; i++) {
            const block = blocks[i], rect = block.element.getBoundingClientRect();
            if (rect.top >= viewport) break;
            last = block;
            if (rect.bottom > target) return block.start;
          }
          return last ? last.start : null;
        },
        scrollToOffset(value) {
          const offset = bound(raw, value); if (offset === null || !blocks.length) return false;
          const block = blocks.find(item => item.start <= offset && offset < item.end);
          // Definitions and blank gaps have no rendered source block. Keep the
          // raw reader instead of inventing a nearby paragraph for that point.
          if (!block) return false;
          block.element.scrollIntoView({ block: 'start', behavior: 'instant' }); return true;
        }
      });
      return Object.freeze({ element, formatted: true, reason: null, blocks: Object.freeze(blocks), adapter });
    } catch (_) { return fallback('mapping'); }
  }
  return Object.freeze({ render, prepare, lineStarts, safeLink, LIMITS });
});
