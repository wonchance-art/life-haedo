'use strict';
// D2 preparation: life-photo-post-v2 (Quill Delta) → life-post-md-v1 Markdown. Every result is
// parsed back with the app's own markdown-it 15 (vendor/) and compared with the original Delta:
// same blocks, same text and the same bold/italic/link/AI ranges. Underline and alignment are the
// only things the new format drops (2026-11-02 owner decision), and they are counted.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/life/post-markdown.js');
const markdownIt = require('../vendor/markdown-it/markdown-it.umd.min.js');
const parser = markdownIt({ html: true });

// Markdown → [{ kind, runs: [{ text, bold, italic, link, ai }], photo }]
function readBack(markdown) {
  const tokens = parser.parse(markdown, {}), lines = [];
  let kind = 'p', listKind = null, quote = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'bullet_list_open') listKind = 'list:bullet';
    else if (token.type === 'ordered_list_open') listKind = 'list:ordered';
    else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') listKind = null;
    else if (token.type === 'blockquote_open') quote = true;
    else if (token.type === 'blockquote_close') quote = false;
    else if (token.type === 'heading_open') kind = 'h' + token.tag.slice(1);
    else if (token.type === 'paragraph_open') kind = listKind || (quote ? 'quote' : 'p');
    else if (token.type === 'inline') {
      const runs = [], state = { bold: false, italic: false, link: null, ai: false }; let photo = null;
      for (const child of token.children) {
        if (child.type === 'text' && child.content === '') continue; // left behind by delimiter processing
        if (child.type === 'text' || child.type === 'code_inline') {
          const last = runs.at(-1), attrs = { ...state };
          if (last && ['bold', 'italic', 'link', 'ai'].every(key => last[key] === attrs[key])) last.text += child.content;
          else runs.push({ text: child.content, ...attrs });
        } else if (child.type === 'strong_open') state.bold = true; else if (child.type === 'strong_close') state.bold = false;
        else if (child.type === 'em_open') state.italic = true; else if (child.type === 'em_close') state.italic = false;
        else if (child.type === 'link_open') state.link = child.attrGet('href'); else if (child.type === 'link_close') state.link = null;
        else if (child.type === 'html_inline') {
          const tag = child.content;
          if (tag === '<strong>') state.bold = true; else if (tag === '</strong>') state.bold = false;
          else if (tag === '<em>') state.italic = true; else if (tag === '</em>') state.italic = false;
          else if (tag === M.AI_OPEN) state.ai = true; else if (tag === M.AI_CLOSE) state.ai = false;
          else throw new Error('unexpected inline HTML ' + tag);
        } else if (child.type === 'image') photo = { src: child.attrGet('src'), alt: (child.children || []).map(c => c.content).join(''), title: child.attrGet('title') || '' };
        else if (child.type === 'softbreak' || child.type === 'hardbreak') throw new Error('unexpected line break in ' + JSON.stringify(markdown));
        else throw new Error('unexpected token ' + child.type);
      }
      const text = runs.map(run => run.text).join('');
      lines.push(photo ? { kind: 'photo', photo } : { kind, runs: text === ' ' ? [] : runs });
    } else if (!/_close$|_open$/.test(token.type)) throw new Error('unexpected block ' + token.type + ' in ' + JSON.stringify(markdown));
  }
  return lines;
}
// Delta → the same shape, without underline and alignment.
function expected(ops) {
  const lines = []; let runs = [], photo = null;
  const push = (text, a) => {
    const attrs = { bold: a.bold === true, italic: a.italic === true, link: a.link || null, ai: a.author === 'ai' }, last = runs.at(-1);
    if (last && ['bold', 'italic', 'link', 'ai'].every(key => last[key] === attrs[key])) last.text += text; else runs.push({ text, ...attrs });
  };
  for (const op of ops) {
    if (typeof op.insert !== 'string') { photo = op.insert.photo; continue; }
    const parts = op.insert.split('\n');
    parts.forEach((part, i) => {
      if (part) push(part, op.attributes || {});
      if (i < parts.length - 1) {
        const b = op.attributes || {};
        lines.push(photo ? { kind: 'photo', photo: { src: M.PHOTO_SCHEME + photo.id, alt: photo.alt || '', title: (photo.caption || '').replace(/\n/g, ' ') } }
          : { kind: b.header ? 'h' + b.header : b.list ? 'list:' + b.list : b.blockquote ? 'quote' : 'p', runs });
        runs = []; photo = null;
      }
    });
  }
  return lines;
}
const check = (ops, label) => {
  const result = M.fromDelta(ops);
  assert.deepEqual(readBack(result.markdown), expected(ops), (label || '') + '\n' + result.markdown);
  assert.equal(M.fromDelta(ops).markdown, result.markdown, 'deterministic');
  return result;
};

test('blocks: headings, lists (numbered, separated), quotes, photos and empty paragraphs', () => {
  const r = check([
    { insert: '월요일 아침' }, { insert: '\n', attributes: { header: 1 } },
    { insert: '반납하는 길' }, { insert: '\n', attributes: { header: 2 } },
    { insert: '\n' },
    { insert: '하나' }, { insert: '\n', attributes: { list: 'ordered' } }, { insert: '둘' }, { insert: '\n', attributes: { list: 'ordered' } },
    { insert: '점' }, { insert: '\n', attributes: { list: 'bullet' } }, { insert: '점2' }, { insert: '\n', attributes: { list: 'bullet' } },
    { insert: { photo: { id: 'p1', alt: '은행잎 [가을]', caption: '반납함 옆 "은행잎"\\' } } }, { insert: '\n' },
    { insert: '인용 하나' }, { insert: '\n', attributes: { blockquote: true } }, { insert: '인용 둘' }, { insert: '\n', attributes: { blockquote: true } },
    { insert: '끝\n' }
  ]);
  assert.match(r.markdown, /^# 월요일 아침\n\n## 반납하는 길\n\n&nbsp;\n\n1\. 하나\n2\. 둘\n\n- 점\n- 점2\n\n!\[/);
  assert.deepEqual(r.photos, ['p1']);
});

test('two lists of the same kind in a row stay two lists (alternate markers, no HTML)', () => {
  const ops = [{ insert: 'a' }, { insert: '\n', attributes: { list: 'bullet' } }, { insert: { photo: { id: 'p', alt: '', caption: '' } } }, { insert: '\n' },
    { insert: 'b' }, { insert: '\n', attributes: { list: 'bullet' } }, { insert: 'c' }, { insert: '\n', attributes: { list: 'ordered' } }];
  check(ops);
  const back = [{ insert: 'a' }, { insert: '\n', attributes: { list: 'ordered' } }, { insert: '\n' }, { insert: 'b' }, { insert: '\n', attributes: { list: 'ordered' } }];
  check(back);
});

test('inline: nested and overlapping bold/italic, links, AI spans; Korean right after punctuation falls back to tags', () => {
  const r = check([
    { insert: '아주 ' }, { insert: '굵고', attributes: { bold: true } }, { insert: ' 기울', attributes: { bold: true, italic: true } }, { insert: '임', attributes: { italic: true } },
    { insert: ' ' }, { insert: '"천천히"', attributes: { bold: true } }, { insert: '라고 썼다. ' },
    { insert: 'AI가 쓴 ', attributes: { author: 'ai' } }, { insert: '굵은 AI', attributes: { author: 'ai', bold: true } },
    { insert: ' 링크', attributes: { link: 'https://example.org/a_(b)?q=1&x=2' } }, { insert: '와 ', attributes: {} },
    { insert: '굵은 링크', attributes: { link: 'https://example.org/', bold: true } }, { insert: '\n' }
  ]);
  assert.ok(r.htmlEmphasis >= 1); assert.match(r.markdown, /<strong>"천천히"<\/strong>라고/);
  assert.match(r.markdown, /<span data-author="ai">AI가 쓴 /);
});

test('text is escaped so nothing turns into Markdown by accident', () => {
  for (const text of ['# 제목 아님', '- 목록 아님', '+ 아님', '> 인용 아님', '1. 번호 아님', '12) 번호 아님', '---', '===', '*별* _밑줄_ `코드`', '[[목요일 저녁 산책]]',
    '![사진 아님](x)', '<b>태그</b> <!-- 주석 -->', '&nbsp; &amp; &#32;', '\\ 역슬래시', '~~취소~~', '  앞뒤 공백  ', '\t탭으로 시작', '    코드 아님', '끝에 두 칸  ', '| 표 | 아님 |'])
    check([{ insert: text + '\n' }], text);
});

test('underline and alignment are dropped (text kept) and counted; AI marks and links are kept', () => {
  const r = M.fromDelta([{ insert: '밑줄', attributes: { underline: true } }, { insert: ' 그리고 ' }, { insert: '둘', attributes: { underline: true, bold: true } },
    { insert: '\n', attributes: { align: 'center' } }, { insert: { photo: { id: 'p', alt: 'a', caption: '' } } }, { insert: '\n', attributes: { align: 'right' } }]);
  assert.deepEqual(r.dropped, { underline: 2, align: 2 });
  assert.equal(r.markdown, '밑줄 그리고 **둘**\n\n![a](haedo-photo:p)\n');
});

test('fromV2 keeps every field but the body, and only the photos the body shows (in body order)', () => {
  const photo = id => ({ id, name: id + '.jpg', type: 'image/jpeg', width: 10, height: 10, size: 3, digest: 'd'.repeat(64) });
  const doc = { format: 'life-photo-post-v2', id: 'post', revision: 3, title: '제목', status: 'saved', replaces: null, createdAt: 'c', updatedAt: 'u',
    ops: [{ insert: { photo: { id: 'b', alt: '', caption: '' } } }, { insert: '\n' }, { insert: { photo: { id: 'a', alt: '', caption: '' } } }, { insert: '\n' }],
    photos: [photo('a'), photo('b'), photo('unused')], attachments: [{ type: 'book', title: '낮은 창', creator: '', url: '' }], archived: false };
  const { document } = M.fromV2(doc);
  assert.equal(document.format, 'life-post-md-v1'); assert.equal('ops' in document, false);
  assert.deepEqual(document.photos.map(p => p.id), ['b', 'a']);
  for (const key of ['id', 'revision', 'title', 'status', 'replaces', 'createdAt', 'updatedAt', 'attachments', 'archived']) assert.deepEqual(document[key], doc[key], key);
  assert.equal(doc.ops.length, 4, 'the v2 document is not modified');
  assert.throws(() => M.fromV2({ ...doc, format: 'life-photo-post-v1' }), TypeError);
});

// POST_MARKDOWN_FUZZ=20000 runs a longer local pass (same seed sequence).
const FUZZ = Number(process.env.POST_MARKDOWN_FUZZ || 1500);
test(FUZZ.toLocaleString('en-US') + ' random v2 documents read back as the same blocks and inline marks', () => {
  let seed = Number(process.env.POST_MARKDOWN_SEED || 20261104);
  const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = list => list[Math.floor(rand() * list.length)];
  const chars = [...'가나다라 마바사 한글 강조 하늘 abcXYZ 012 9 !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~ “”‘’…·—🌱 \t'];
  const word = () => Array.from({ length: 1 + Math.floor(rand() * 7) }, () => pick(chars)).join('');
  const links = ['https://example.org/', 'https://example.org/a_(b)', 'https://example.org/?q=1&x=*', 'http://ex.invalid/path#frag'];
  for (let n = 0; n < FUZZ; n++) {
    const ops = [];
    for (let line = 0; line < 1 + Math.floor(rand() * 5); line++) {
      if (rand() < 0.1) { ops.push({ insert: { photo: { id: 'p' + n + '_' + line, alt: rand() < 0.5 ? word() : '', caption: rand() < 0.5 ? word() : '' } } }, { insert: '\n' }); continue; }
      for (let run = 0; run < Math.floor(rand() * 4); run++) {
        const attributes = {};
        if (rand() < 0.3) attributes.bold = true; if (rand() < 0.3) attributes.italic = true; if (rand() < 0.15) attributes.underline = true;
        if (rand() < 0.15) attributes.link = pick(links); if (rand() < 0.15) attributes.author = 'ai';
        ops.push(Object.keys(attributes).length ? { insert: word(), attributes } : { insert: word() });
      }
      const block = pick([{}, {}, {}, { header: 1 }, { header: 2 }, { list: 'bullet' }, { list: 'ordered' }, { blockquote: true }, { align: 'center' }]);
      ops.push(Object.keys(block).length ? { insert: '\n', attributes: block } : { insert: '\n' });
    }
    check(ops, 'random document ' + n);
  }
});
