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
  const PROPERTY_LIMITS = Object.freeze({ bytes: 64 * 1024, properties: 100, values: 1000, events: 4096, depth: 8 });
  const TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'em', 'strong', 's', 'br', 'hr', 'a', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'details', 'summary', 'dl', 'dt', 'dd'];
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
  function propertyIntent(content) {
    // Error classification only, not a YAML parser. A rejected Markdown phrase
    // such as **emphasis**, [link](url), `code` or > quote must retain its normal
    // rendering. Actual property data is accepted only by the maintained parser.
    const first = content.split(/\r\n|\r|\n/).find(line => line.trim() && !/^[ \t]*#/.test(line));
    if (first === undefined) return false;
    const text = first.replace(/^[ \t]*/, '');
    if (/^(?:[-+*][ \t]|\d+[.)][ \t]|[>#`~\[\]!?&*|%@<])/.test(text)) return false;
    const key = '(?:"(?:[^"\\\\]|\\\\.){0,1024}"|\'(?:[^\']|\'\'){0,1024}\'|[^:"\'{}\\[\\],\\r\\n]{1,1024})';
    if (text[0] === '{') return /^\{[ \t]*$/.test(text) || new RegExp('^\\{[ \\t]*' + key + ':').test(text);
    return new RegExp('^' + key + ':(?:[ \\t]|$)').test(text);
  }
  function propertyHeader(raw, lines) {
    const line = index => raw.slice(lines[index], index + 1 < lines.length ? lines[index + 1] : raw.length).replace(/(?:\r\n|\r|\n)$/, '');
    if (line(0).replace(/^\uFEFF/, '') !== '---' || lines.length < 2) return null;
    let closing = 1;
    while (closing < lines.length && line(closing) !== '---') closing++;
    if (closing === lines.length) return null;
    const end = closing + 1 < lines.length ? lines[closing + 1] : raw.length;
    const content = raw.slice(lines[1], lines[closing]);
    if (!content.trim()) return null;
    const intent = propertyIntent(content);
    const result = { start: 0, end, kind: 'raw', reason: 'invalid_or_unsupported', entries: null };
    if (new TextEncoder().encode(raw.slice(0, end)).byteLength > PROPERTY_LIMITS.bytes) return intent ? { ...result, reason: 'too_large' } : null;
    try {
      const yaml = root.jsyaml || (typeof require === 'function' && require('../../vendor/js-yaml/js-yaml.umd.min.js'));
      if (!yaml?.load || !yaml?.parseEvents || typeof yaml.JSON_SCHEMA?.withTags !== 'function' || !yaml.realMapTag) return intent ? { ...result, reason: 'unavailable' } : null;
      const options = { schema: yaml.JSON_SCHEMA.withTags(yaml.realMapTag), maxAliases: 0, maxDepth: PROPERTY_LIMITS.depth,
        maxTotalMergeKeys: 0, json: false, onWarning() { throw new Error('yaml_warning'); } };
      // Inspect the maintained parser's own events, never a handwritten YAML
      // grammar. Anchors/tags/directives are unnecessary in read-only properties.
      const events = yaml.parseEvents(content, options);
      if (Array.isArray(events) && !events.length) return null;
      if (!Array.isArray(events) || events.length > PROPERTY_LIMITS.events || events.some(event =>
        event.type === yaml.EVENT_ALIAS || event.anchorStart >= 0 || event.tagStart >= 0 || event.directives?.length || event.explicitStart || event.explicitEnd)) return intent ? result : null;
      const value = yaml.load(content, options);
      // realMapTag retains key types; the ordinary JS-object mapping tag would
      // silently stringify ambiguous scalar or complex keys before validation.
      // A valid scalar/list between two thematic breaks is ordinary Markdown,
      // not a property block. Keep the incumbent rendering in that case.
      if (!(value instanceof Map)) return null;
      if (!value.size || value.size > PROPERTY_LIMITS.properties) return result;
      const textSafe = text => typeof text === 'string' && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
      const scalar = item => item === null || typeof item === 'boolean' || textSafe(item) ||
        typeof item === 'number' && Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item));
      const entries = [];
      let count = 0;
      for (const [key, item] of value) {
        if (!textSafe(key) || !key.length || key.length > 1024 || /[\r\n\t]/.test(key) || key === '<<') return result;
        if (Array.isArray(item)) {
          count += item.length;
          if (!item.every(scalar)) return result;
        } else { count++; if (!scalar(item)) return result; }
        if (count > PROPERTY_LIMITS.values) return result;
        entries.push([key, item]);
      }
      return { ...result, kind: 'properties', reason: null, entries };
    } catch (_) { return intent ? result : null; }
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
      const header = propertyHeader(raw, lines);
      // Keep every original CR/LF and UTF-16 code unit in its original position.
      // Only the parser's display input is masked; raw and all maps stay exact.
      const display = header ? raw.slice(0, header.end).replace(/[^\r\n]/g, ' ') + raw.slice(header.end) : raw;
      const tokens = md.parse(display[0] === '\uFEFF' ? display.slice(1) : display, env);
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
      const blocks = header ? [{ start: 0, end: header.end }] : [];
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
      let properties = '';
      if (header) {
        if (header.kind === 'properties') {
          const scalarText = value => Object.is(value, -0) ? '-0' : String(value);
          properties = '<details class="source-properties" data-source-block="0"><summary>속성</summary><dl>' +
            header.entries.map(([key, value]) => '<dt>' + escape(key) + '</dt><dd>' + (Array.isArray(value)
              ? '<ul>' + value.map(item => '<li>' + escape(scalarText(item)) + '</li>').join('') + '</ul>'
              : escape(scalarText(value))) + '</dd>').join('') + '</dl></details>\n';
        } else {
          // Numeric line-ending references avoid HTML preprocessing collapsing
          // CRLF/CR before the raw header becomes a DOM text node.
          const literal = escape(raw.slice(0, header.end)).replace(/\r/g, '&#13;').replace(/\n/g, '&#10;');
          properties = '<pre class="source-properties-raw" data-source-block="0"><code>' + literal + '</code></pre>\n';
        }
      }
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
      return { formatted: true, reason: null, html: properties + md.renderer.render(tokens, md.options, env), blocks,
        frontmatter: header ? { start: 0, end: header.end, kind: header.kind, reason: header.reason } : null };
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
        if (index === 0 && plan.frontmatter) {
          const properties = plan.frontmatter.kind === 'properties';
          if (node.tagName.toLowerCase() !== (properties ? 'details' : 'pre')) throw new Error('mapping');
          // Class is deliberately NOT sanitizer-allowlisted. Only these fixed
          // app-owned values are assigned after the raw data was sanitized.
          node.className = properties ? 'source-properties' : 'source-properties-raw';
          if (!properties) {
            const code = node.querySelector('code'); if (!code) throw new Error('mapping');
            code.textContent = raw.slice(plan.frontmatter.start, plan.frontmatter.end);
          }
        }
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
          if (block.element.tagName.toLowerCase() === 'details') block.element.open = true;
          block.element.scrollIntoView({ block: 'start', behavior: 'instant' }); return true;
        }
      });
      return Object.freeze({ element, formatted: true, reason: null, blocks: Object.freeze(blocks), adapter });
    } catch (_) { return fallback('mapping'); }
  }
  return Object.freeze({ render, prepare, lineStarts, safeLink, LIMITS });
});
