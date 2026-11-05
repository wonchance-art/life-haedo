/* D2 editor adapter. No storage, account access, or automatic v2 migration.
 * Markdown is serialized through the same restricted codec as storage. */
(function (root, factory) {
  'use strict';
  const api = factory(root); (root.HaedoLife ||= {}).PostMarkdownEditor = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const codec = () => root.HaedoLife?.PostMarkdown || (typeof require === 'function' && require('./post-markdown.js'));
  const error = (message, code = 'invalid_editor_document') => Object.assign(new Error(message), { code });
  function safeLink(value) {
    return typeof value === 'string' && value.length <= 2048 && codec().safeLink(value);
  }
  function marks(attributes = {}) {
    return [attributes.author === 'ai' && { type: 'ai' }, attributes.link && { type: 'link', attrs: { href: attributes.link } },
      attributes.bold && { type: 'bold' }, attributes.italic && { type: 'italic' }].filter(Boolean);
  }
  function toJSON(markdown) {
    const ops = codec().toDelta(markdown), content = []; let inline = [];
    function line(attrs = {}) {
      const paragraph = { type: attrs.header ? 'heading' : 'paragraph', ...(attrs.header ? { attrs: { level: attrs.header } } : {}), ...(inline.length ? { content: inline } : {}) };
      inline = [];
      const container = attrs.list ? (attrs.list === 'ordered' ? 'orderedList' : 'bulletList') : attrs.blockquote ? 'blockquote' : null;
      if (!container) { content.push(paragraph); return; }
      const child = attrs.list ? { type: 'listItem', content: [paragraph] } : paragraph;
      if (content.at(-1)?.type === container) content.at(-1).content.push(child);
      else content.push({ type: container, content: [child] });
    }
    for (const op of ops) {
      if (typeof op.insert !== 'string') {
        if (inline.length) line();
        content.push({ type: 'photo', attrs: { ...op.insert.photo } }); continue;
      }
      const parts = op.insert.split('\n');
      parts.forEach((text, i) => {
        if (text) { const markList = marks(op.attributes); inline.push({ type: 'text', text, ...(markList.length ? { marks: markList } : {}) }); }
        if (i < parts.length - 1) line(op.attributes);
      });
    }
    if (inline.length) line();
    return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
  }
  function fromJSON(document) {
    if (document?.type !== 'doc' || !Array.isArray(document.content) || !document.content.length) throw error('본문 형식을 확인해 주세요.');
    const ops = [];
    function line(node, attributes = {}) {
      for (const child of node.content || []) {
        if (child.type !== 'text' || typeof child.text !== 'string' || /\n/.test(child.text)) throw error('지원하지 않는 본문 요소입니다.');
        const attrs = {};
        for (const mark of child.marks || []) {
          if (mark.type === 'bold' || mark.type === 'italic') attrs[mark.type] = true;
          else if (mark.type === 'ai') attrs.author = 'ai';
          else if (mark.type === 'link' && safeLink(mark.attrs?.href)) attrs.link = mark.attrs.href;
          else throw error('지원하지 않는 글자 서식입니다.');
        }
        ops.push({ insert: child.text, ...(Object.keys(attrs).length ? { attributes: attrs } : {}) });
      }
      ops.push({ insert: '\n', ...(Object.keys(attributes).length ? { attributes } : {}) });
    }
    for (const node of document.content) {
      if (node.type === 'paragraph') line(node);
      else if (node.type === 'heading' && [1, 2].includes(node.attrs?.level)) line(node, { header: node.attrs.level });
      else if (node.type === 'photo') {
        const { id, caption = '', alt = '' } = node.attrs || {};
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || typeof caption !== 'string' || typeof alt !== 'string') throw error('사진 정보를 확인해 주세요.');
        ops.push({ insert: { photo: { id, caption, alt } } });
      } else if (['bulletList', 'orderedList', 'blockquote'].includes(node.type)) {
        if (!node.content?.length) throw error('빈 묶음은 본문으로 저장할 수 없습니다.');
        if (node.type === 'orderedList' && ((node.attrs?.start !== undefined && node.attrs.start !== 1) || (node.attrs?.type != null && node.attrs.type !== '1'))) throw error('번호 목록은 1부터 시작합니다.');
        for (const item of node.content) {
          if (node.type === 'blockquote') {
            if (item.type !== 'paragraph') throw error('인용 안에는 문단만 쓸 수 있습니다.');
            line(item, { blockquote: true });
          } else {
            if (item.type !== 'listItem' || item.content?.length !== 1 || item.content[0].type !== 'paragraph') throw error('중첩 목록은 지원하지 않습니다.');
            line(item.content[0], { list: node.type === 'orderedList' ? 'ordered' : 'bullet' });
          }
        }
      } else throw error('지원하지 않는 본문 블록입니다.');
    }
    // Parse again to validate references, limits and permitted grammar before returning a snapshot.
    return codec().canonicalize(codec().fromDelta(ops).markdown);
  }
  function create(options = {}) {
    const T = root.HaedoTiptap;
    if (!T?.Editor || !options.element) throw error('편집기를 불러오지 못했습니다. 새로고침해 주세요.', 'editor_unavailable');
    const selections = new WeakSet();
    let errorElement = null;
    let composing = false, disposed = false, timer = null, generation = 0, last = codec().canonicalize(options.markdown ?? '&nbsp;\n');
    const Photo = T.Node.create({ name: 'photo', group: 'block', atom: true, draggable: true,
      addAttributes: () => ({ id: { default: null }, caption: { default: '' }, alt: { default: '' } }),
      // Clipboard HTML cannot manufacture references to private photo records.
      parseHTML: () => [],
      renderHTML: ({ node }) => ['figure', { 'data-haedo-photo': node.attrs.id }, ['figcaption', {}, node.attrs.caption || node.attrs.alt || '사진']],
      addNodeView() { return ({ node }) => {
        const dom = root.document.createElement('figure'); dom.dataset.haedoPhoto = node.attrs.id;
        const source = options.resolvePhoto?.(node.attrs.id);
        if (typeof source === 'string' && source.startsWith('blob:')) {
          const img = root.document.createElement('img'); img.src = source; img.alt = node.attrs.alt; img.style.maxWidth = '100%'; dom.append(img);
        } else { const label = root.document.createElement('span'); label.textContent = node.attrs.alt || '사진'; dom.append(label); }
        const caption = root.document.createElement('figcaption'); caption.textContent = node.attrs.caption; caption.style.whiteSpace = 'pre-wrap'; dom.append(caption);
        return { dom };
      }; }
    });
    const AI = T.Mark.create({ name: 'ai', parseHTML: () => [{ tag: 'span[data-author="ai"]' }], renderHTML: () => ['span', { 'data-author': 'ai' }, 0] });
    const Link = T.Mark.create({ name: 'link', inclusive: false,
      addAttributes: () => ({ href: { default: null } }),
      parseHTML: () => [{ tag: 'a[href]', getAttrs: element => safeLink(element.getAttribute('href')) ? { href: element.getAttribute('href') } : false }],
      renderHTML: ({ mark }) => ['a', { href: safeLink(mark.attrs.href) ? mark.attrs.href : undefined, rel: 'noopener noreferrer', tabindex: '-1' }, 0]
    });
    function reportError(problem) {
      if (!errorElement) {
        errorElement = root.document.createElement('p');
        errorElement.className = 'post-markdown-error'; errorElement.setAttribute('role', 'alert');
        options.element.append(errorElement);
      }
      errorElement.textContent = problem.message + ' 입력 내용은 바꾸지 않았습니다.';
      options.onError?.(problem);
    }
    const SupportedDocument = T.Extension.create({ name: 'supportedPostMarkdown',
      addProseMirrorPlugins() { return [new T.Plugin({ filterTransaction(transaction) {
        if (!transaction.docChanged) return true;
        try { fromJSON(transaction.doc.toJSON()); return true; }
        catch (problem) { reportError(problem); return false; }
      } })]; }
    });
    const OrderedList = T.OrderedList.extend({
      // A literal `2. ` is text. Upstream's any-number rule would create a
      // start=2 list that the persisted grammar cannot represent.
      addInputRules() { return [T.wrappingInputRule({ find: /^(1)\.\s$/, type: this.type,
        getAttributes: () => ({ start: 1 }), joinPredicate: () => false })]; }
    });
    function emit() {
      if (disposed || composing || editor.view.composing) return;
      const markdown = fromJSON(editor.getJSON());
      if (markdown !== last) { last = markdown; options.onChange?.(markdown); }
    }
    function composition(value) {
      composing = value; options.onCompositionChange?.(value);
      if (!value) { clearTimeout(timer); timer = setTimeout(() => { timer = null; emit(); }, 30); }
    }
    function unsupportedClipboardList(event) {
      const html = event.clipboardData?.getData('text/html');
      if (!html) return false;
      // An inert template is never attached: inspect numbering before
      // ProseMirror unwraps a one-item list into the current paragraph.
      const template = root.document.createElement('template'); template.innerHTML = html;
      for (const list of template.content.querySelectorAll('ol')) {
        const start = list.getAttribute('start'), type = list.getAttribute('type');
        const style = list.style.getPropertyValue('list-style-type');
        if (list.hasAttribute('reversed') || (start !== null && start !== '1') || (type !== null && type !== '1') || (style && style !== 'decimal')) return true;
        for (const item of list.querySelectorAll('li')) {
          const itemStyle = item.style.getPropertyValue('list-style-type');
          if (item.hasAttribute('value') || (item.hasAttribute('type') && item.getAttribute('type') !== '1') || (itemStyle && itemStyle !== 'decimal')) return true;
        }
      }
      return false;
    }
    const editor = new T.Editor({ element: options.element, content: toJSON(last), injectCSS: false,
      extensions: [T.Document, T.Paragraph, T.Text, T.Heading.configure({ levels: [1, 2] }), T.Bold, T.Italic,
        T.Blockquote.extend({ content: 'paragraph+' }), T.BulletList, OrderedList,
        T.ListItem.extend({ content: 'paragraph' }), T.UndoRedo, Photo, AI, Link, SupportedDocument],
      editorProps: {
        handlePaste: (_view, event) => {
          if (!unsupportedClipboardList(event)) return false;
          reportError(error('번호 목록은 1부터 시작하는 기본 번호만 붙여넣을 수 있습니다.')); return true;
        },
        attributes: { class: 'post-markdown-editor', role: 'textbox', 'aria-label': options.label || '글 본문', 'aria-multiline': 'true' },
        handleDOMEvents: { compositionstart: () => { composition(true); return false; }, compositionend: () => { composition(false); return false; },
          click: (_view, event) => !!event.target.closest?.('a') } },
      onUpdate: () => { generation++; if (errorElement) { errorElement.remove(); errorElement = null; } emit(); },
      onSelectionUpdate: () => { generation++; }
    });
    function guard() {
      if (disposed) throw error('닫힌 편집기입니다.', 'editor_disposed');
      if (composing || editor.view.composing) throw error('한글 입력을 마친 뒤 다시 시도해 주세요.', 'composition_active');
    }
    return Object.freeze({ editor,
      isComposing: () => composing || (!disposed && editor.view.composing),
      getMarkdown() { guard(); return fromJSON(editor.getJSON()); },
      getCommittedMarkdown: () => last,
      setMarkdown(markdown) { guard(); const content = toJSON(markdown); editor.commands.setContent(content); return fromJSON(editor.getJSON()); },
      selection() { guard(); const { from, to } = editor.state.selection; const snapshot = Object.freeze({ from, to, generation }); selections.add(snapshot); return snapshot; },
      replaceSelection(snapshot, text, { ai = false } = {}) {
        guard(); const { from, to } = editor.state.selection;
        if (!snapshot || !selections.has(snapshot) || snapshot.generation !== generation || snapshot.from !== from || snapshot.to !== to) throw error('본문이나 선택 범위가 바뀌었습니다.', 'stale_selection');
        if (typeof text !== 'string' || /[\r\n]/.test(text)) throw error('선택 영역에는 한 문단을 넣어 주세요.');
        if (!text) return editor.commands.deleteSelection();
        return editor.commands.insertContentAt({ from, to }, { type: 'text', text, ...(ai ? { marks: [{ type: 'ai' }] } : {}) });
      },
      dispose() { if (disposed) return; disposed = true; clearTimeout(timer); errorElement?.remove(); editor.destroy(); }
    });
  }
  return Object.freeze({ toJSON, fromJSON, create });
});
