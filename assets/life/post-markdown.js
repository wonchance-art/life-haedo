/* 글 저장 형식 D2 준비: 사진 글 v2(Quill Delta) → Markdown 정본(life-post-md-v1) 변환.
 * 순수 모듈이다(저장·네트워크·DOM 없음). 편집기 연결과 실제 이행은 D1 뒤에 따로 한다.
 * 규칙(2026-11-02 소유자 결정, docs/design-review/post-markdown-d2.md):
 * - 기존 글은 처음 고칠 때 이 변환으로 바꾸고 원래 v2 문서는 복구 사본으로 남긴다(호출하는 쪽 몫).
 * - 밑줄·정렬은 새 형식에 없다: 글자는 남기고 서식만 빼며, 뺀 개수를 돌려준다.
 * - 사진·AI 글 표시(author:"ai", `<span data-author="ai">`)·링크는 보존한다. 빈 문단은 `&nbsp;` 문단으로 남긴다.
 * - 굵게·기울임은 CommonMark가 그대로 읽을 수 있을 때만 `**`·`*`를 쓰고, 아니면 `<strong>`·`<em>`을 쓴다. */
(function (root, factory) {
  'use strict'; const api = factory(); (root.HaedoLife ||= {}).PostMarkdown = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function () {
  'use strict';
  const FORMAT = 'life-post-md-v1';
  const PHOTO_SCHEME = 'haedo-photo:';
  // AI-written spans keep the editor's own mark (span data-author="ai"). Not an HTML comment: a
  // line that starts with `<!--` is an HTML block in CommonMark, not a paragraph.
  const AI_OPEN = '<span data-author="ai">', AI_CLOSE = '</span>';
  // Inline marks in nesting order, outermost first: an inner mark is split at an outer boundary.
  const ORDER = ['ai', 'link', 'bold', 'italic'];

  // The flanking rules' character classes, as markdown-it 15 has them (isWhiteSpace): not JS \s,
  // which also counts U+2028, U+2029 and U+FEFF.
  const SPACE = /^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$/u;
  const isSpace = ch => ch === undefined || SPACE.test(ch);
  const isPunct = ch => ch !== undefined && /[\p{P}\p{S}]/u.test(ch);

  // Text escaping: inline specials anywhere, block starters at the start of a line.
  function escapeInline(text) {
    return text
      .replace(/[\\`*_[\]<>]/g, ch => '\\' + ch)
      .replace(/!(?=\\\[)/g, '\\!')
      .replace(/&(?=#?[0-9A-Za-z]+;)/g, '&amp;')
      // A literal ~~ or | stays literal under the common extensions too.
      .replace(/~/g, '\\~')
      // A carriage return is a line ending in Markdown: kept as the character itself.
      .replace(/\r/g, '&#13;');
  }
  // Line breaks inside one value (a photo's alt or caption) stay characters, not line endings.
  const breaks = text => text.replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');
  function escapeLineStart(text) {
    // A leading U+FEFF is dropped as a byte order mark by readers (source-markdown.js, Obsidian):
    // the line after it would start a heading, list or rule there. Written as a reference instead.
    if (text.startsWith('\ufeff')) return '&#xFEFF;' + text.slice(1);
    return text
      .replace(/^(#{1,6})(?=\s|$)/, '\\$1')
      .replace(/^([>+-])(?=\s|$)/, '\\$1')
      .replace(/^(=+|-+)$/, m => '\\' + m)
      .replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2');
  }
  // Leading spaces/tabs would become indentation (or a code block), trailing ones a hard break:
  // the outermost one is written as a character reference.
  const ref = ch => ch === '\t' ? '&#9;' : '&#32;';
  // Backslash escapes keep the URL as written: no entity (`&amp;`, `&copy;`) or escape is decoded
  // from it. Inside <…>, < and > are escaped the same way. A line ending cannot be inside a
  // destination; it is percent-encoded, as the parser's link normalisation would do anyway.
  function linkTarget(url) {
    const escaped = url.replace(/[\\&]/g, ch => '\\' + ch).replace(/[\n\r]/g, ch => encodeURIComponent(ch));
    return /[\s()<>]/.test(url) ? '<' + escaped.replace(/[<>]/g, ch => '\\' + ch) + '>' : escaped;
  }
  // A link title (the photo caption, a plain-text textarea shown with pre-wrap): every character
  // kept, line breaks included.
  const quote = text => '"' + breaks(String(text).replace(/[\\"&]/g, ch => '\\' + ch)) + '"';

  // Delta → lines: [{ runs: [{ text, attrs }], block: {header|list|blockquote|align}, photo }].
  // As the app reads a v2 body (blog-public-ui.js render, the editor's Quill): a photo is a block
  // embed of its own and takes no "\n"; text waiting before it ends as a plain paragraph; every
  // "\n" ends one line with its block attributes, an empty one included ([photo, "\n"] is a photo
  // and an empty paragraph).
  function linesOf(ops) {
    const lines = []; let runs = [];
    for (const op of ops) {
      if (typeof op.insert !== 'string') {
        if (runs.length) { lines.push({ runs, block: {}, photo: null }); runs = []; }
        // Quill's formatLine puts align on a photo embed too: counted as dropped, not a block format.
        lines.push({ runs: [], block: {}, photo: op.insert.photo, align: op.attributes?.align || null });
        continue;
      }
      const parts = op.insert.split('\n');
      parts.forEach((part, i) => {
        if (part) runs.push({ text: part, attrs: op.attributes || {} });
        if (i < parts.length - 1) { lines.push({ runs, block: op.attributes || {}, photo: null }); runs = []; }
      });
    }
    if (runs.length) lines.push({ runs, block: {}, photo: null });
    return lines;
  }
  const markOf = (attrs, key) => key === 'ai' ? attrs.author === 'ai' : key === 'link' ? attrs.link || null : attrs[key] === true;

  // One line's inline content as tokens: { t: 'text', s } | { t: 'open'|'close', key, value }.
  function inlineTokens(runs) {
    const tokens = [], stack = [];
    for (const run of runs) {
      const want = ORDER.map(key => [key, markOf(run.attrs, key)]).filter(([, v]) => v);
      let keep = 0;
      while (keep < stack.length && keep < want.length && stack[keep][0] === want[keep][0] && stack[keep][1] === want[keep][1]) keep++;
      while (stack.length > keep) { const [key, value] = stack.pop(); tokens.push({ t: 'close', key, value }); }
      for (const [key, value] of want.slice(keep)) { stack.push([key, value]); tokens.push({ t: 'open', key, value }); }
      tokens.push({ t: 'text', s: run.text });
    }
    while (stack.length) { const [key, value] = stack.pop(); tokens.push({ t: 'close', key, value }); }
    return tokens;
  }
  function render(tokens, html) {
    return tokens.map((token, i) => {
      if (token.t === 'text') return token.s;
      const { key, value } = token, open = token.t === 'open';
      if (key === 'ai') return open ? AI_OPEN : AI_CLOSE;
      if (key === 'link') return open ? '[' : '](' + linkTarget(value) + ')';
      if (html.has(i)) return key === 'bold' ? (open ? '<strong>' : '</strong>') : (open ? '<em>' : '</em>');
      return key === 'bold' ? '**' : '*';
    });
  }
  // Pairs each emphasis open with its close; marks pairs whose delimiters would not parse back.
  function emphasis(tokens) {
    const html = new Set(), pairs = [], open = [];
    tokens.forEach((token, i) => {
      if (token.t === 'open' && (token.key === 'bold' || token.key === 'italic')) open.push(i);
      if (token.t === 'close' && (token.key === 'bold' || token.key === 'italic')) pairs.push([open.pop(), i]);
    });
    for (let pass = 0; pass < 8; pass++) {
      const parts = render(tokens, html);
      // Characters next to each token in the rendered line.
      // Whole code points (an emoji is one character, and Unicode punctuation for CommonMark).
      const before = i => { for (let j = i - 1; j >= 0; j--) if (parts[j]) return Array.from(parts[j]).at(-1); return undefined; };
      const after = i => { for (let j = i + 1; j < parts.length; j++) if (parts[j]) return String.fromCodePoint(parts[j].codePointAt(0)); return undefined; };
      let changed = false;
      for (const [o, c] of pairs) {
        if (html.has(o)) continue;
        const prevO = before(o), nextO = after(o), prevC = before(c), nextC = after(c);
        const leftFlanking = !isSpace(nextO) && (!isPunct(nextO) || isSpace(prevO) || isPunct(prevO));
        const rightFlanking = !isSpace(prevC) && (!isPunct(prevC) || isSpace(nextC) || isPunct(nextC));
        // A delimiter touching another * delimiter would merge into one run (***, ****).
        const touches = prevO === '*' || nextO === '*' || prevC === '*' || nextC === '*';
        if (!leftFlanking || !rightFlanking || touches || o + 1 === c) { html.add(o); html.add(c); changed = true; }
      }
      if (!changed) break;
    }
    return html;
  }
  // Runs that differ only in what the new format drops (underline) become one run, so line-start
  // rules see the line's real beginning ("9" + ") …" is "9) …").
  function merged(runs) {
    const out = [];
    for (const run of runs) {
      const attrs = Object.fromEntries(Object.entries(run.attrs).filter(([key]) => key !== 'underline'));
      const last = out.at(-1);
      if (last && ORDER.every(key => markOf(last.attrs, key) === markOf(attrs, key))) last.text += run.text;
      else out.push({ text: run.text, attrs });
    }
    return out;
  }
  function inline(runs, lineStart, stats) {
    // Escape text first, then protect the line's leading and trailing spaces.
    const tokens = inlineTokens(merged(runs).map(run => ({ text: escapeInline(run.text), attrs: run.attrs })));
    const firstText = tokens.findIndex(token => token.t === 'text');
    if (lineStart && firstText >= 0 && tokens.slice(0, firstText).every(token => token.t === 'open' && token.key === 'ai'))
      tokens[firstText] = { t: 'text', s: escapeLineStart(tokens[firstText].s) };
    const texts = tokens.map((token, i) => token.t === 'text' ? i : -1).filter(i => i >= 0);
    if (texts.length) {
      tokens[texts[0]] = { t: 'text', s: tokens[texts[0]].s.replace(/^[ \t]/, ref) };
      const last = texts.at(-1); tokens[last] = { t: 'text', s: tokens[last].s.replace(/[ \t]$/, ref) };
    }
    const html = emphasis(tokens);
    stats.html += html.size / 2;
    const parts = render(tokens, html);
    // A text "!" right before a link's "[" would make it an image: escape that "!" (an even run of
    // backslashes before it means the "!" itself is not escaped yet).
    for (let i = 0; i < parts.length; i++) {
      const next = parts.slice(i + 1).find(Boolean);
      if (tokens[i].t === 'text' && next?.[0] === '[' && /(^|[^\\])(\\\\)*!$/.test(parts[i])) parts[i] = parts[i].slice(0, -1) + '\\!';
    }
    return parts.join('');
  }
  // v2 ops → Markdown. Returns the text, the photo IDs in order and what was dropped.
  function fromDelta(ops) {
    if (!Array.isArray(ops)) throw new TypeError('ops must be an array');
    const stats = { underline: 0, align: 0, html: 0 }, photos = [], blocks = [];
    let list = null, number = 0, alternate = false;
    for (const line of linesOf(ops)) {
      for (const run of line.runs) if (run.attrs.underline) stats.underline++;
      if (line.block.align || line.align) stats.align++;
      let text;
      if (line.photo) {
        photos.push(line.photo.id);
        const caption = line.photo.caption ? ' ' + quote(line.photo.caption) : '';
        text = '![' + breaks(escapeInline(line.photo.alt || '')) + '](' + PHOTO_SCHEME + line.photo.id + caption + ')';
      } else {
        const body = inline(line.runs, true, stats);
        text = body === '' ? '&nbsp;' : body;
      }
      const kind = line.block.list ? 'list:' + line.block.list : line.block.blockquote ? 'quote' : line.block.header ? 'h' : 'p';
      if (kind.startsWith('list:') && !line.photo) {
        if (list !== kind) {
          // A list right after another list of the same kind would merge: switch its marker.
          alternate = blocks.at(-1)?.kind === kind ? !alternate : false;
          number = 0; blocks.push({ kind, lines: [] }); list = kind;
        }
        number++;
        blocks.at(-1).lines.push((kind === 'list:ordered' ? number + (alternate ? ') ' : '. ') : alternate ? '* ' : '- ') + text);
        continue;
      }
      list = null;
      if (kind === 'quote' && !line.photo) {
        const prev = blocks.at(-1);
        if (prev?.kind === 'quote') prev.lines.push('>', '> ' + text); else blocks.push({ kind, lines: ['> ' + text] });
        continue;
      }
      if (kind === 'h' && !line.photo) {
        // A trailing run of # after a space would be read as the heading's optional closing sequence.
        blocks.push({ kind, lines: ['#'.repeat(line.block.header) + ' ' + text.replace(/(^|[ \t])(#+)$/, '$1\\$2')] }); continue;
      }
      blocks.push({ kind: 'p', lines: [text] });
    }
    return { markdown: blocks.map(block => block.lines.join('\n')).join('\n\n') + '\n', photos, dropped: { underline: stats.underline, align: stats.align }, htmlEmphasis: stats.html };
  }
  // A v2 document as a life-post-md-v1 document. Everything but the body is carried over as it
  // is (id, title, status, dates, photos with their bytes, attachments, archived, replaces);
  // the photo list keeps only photos the body still shows, in body order first.
  function fromV2(doc) {
    if (!doc || doc.format !== 'life-photo-post-v2') throw new TypeError('a life-photo-post-v2 document is required');
    const { ops, ...rest } = doc, result = fromDelta(ops);
    const byId = new Map((doc.photos || []).map(photo => [photo.id, photo]));
    const photos = result.photos.map(id => byId.get(id)).filter(Boolean);
    return { document: { ...structuredClone(rest), format: FORMAT, markdown: result.markdown, photos: structuredClone(photos) },
      dropped: result.dropped, htmlEmphasis: result.htmlEmphasis };
  }
  return Object.freeze({ FORMAT, PHOTO_SCHEME, AI_OPEN, AI_CLOSE, fromDelta, fromV2, escapeInline });
});
