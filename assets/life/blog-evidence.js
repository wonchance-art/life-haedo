/* Explicit evidence selection; only quoted source text and a separate thought enter rich-text ops. */
(function (root, factory) {
  const api = factory(root); (root.HaedoLife ||= {}).BlogEvidence = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const reference = () => root.HaedoLife?.SourceReference || require('./source-reference.js');
  const model = () => root.HaedoLife?.PhotoPost || require('./photo-post.js');
  const core = () => root.HaedoLife?.Core || require('./core.js');
  const normalized = text => text.replace(/\r\n?/g, '\n');
  function rawOffset(text, offset) {
    let index = 0, shown = 0;
    while (index < text.length && shown < offset) { if (text[index] === '\r' && text[index + 1] === '\n') index++; index++; shown++; }
    return index;
  }
  function draft(ref, thought = '') {
    reference().validate(ref);
    if (typeof thought !== 'string') throw new Error('내 생각을 확인해 주세요.');
    const ops = [];
    for (const line of normalized(ref.quote).split('\n')) {
      if (line) ops.push({ insert: line });
      ops.push({ insert: '\n', attributes: { blockquote: true } });
    }
    ops.push({ insert: '출처: ' + ref.title + '\n' });
    if (ref.url) ops.push({ insert: ref.url, attributes: { link: ref.url } }, { insert: '\n' });
    ops.push({ insert: '\n' + normalized(thought) + '\n' });
    const doc = model().create(() => 'evidence-validation'); doc.ops = ops; model().validate(doc);
    return { reference: ref, ops, title: '' };
  }
  function create({ host, getBundle, isCurrent = () => true, onApply, onCancel = () => {}, heading = '원문에서 글 쓰기', applyLabel = '인용으로 새 글 쓰기', includeThought = true }) {
    const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
    let epoch = 0, pending = false, busy = false, form = null, stopped = false;
    const valid = token => !stopped && token === epoch && isCurrent() && host.isConnected;
    async function open(seed = {}) {
      const token = ++epoch; stopped = false;
      const bundle = await getBundle(); if (!valid(token)) return;
      const section = el('section', null, 'life-evidence'); section.setAttribute('aria-label', '원문을 인용해 글 쓰기');
      const error = el('p', '', 'life-error'); error.setAttribute('role', 'alert'); error.hidden = true;
      const field = (name, input) => { const label = el('label', null, 'life-field'); label.append(el('span', name), input); section.append(label); return input; };
      section.append(el('h2', heading, 'life-heading'));
      section.append(el('p', includeThought ? '직접 선택한 구절만 인용합니다. 아래에는 내 생각을 따로 적습니다.' : '직접 선택한 구절과 출처만 담습니다. 선택 이유는 다음 화면에서 적습니다.', 'life-help'));
      const activeSources = bundle.sources.filter(item => core().isSourceActive(bundle, item.id));
      if (!activeSources.length) section.append(el('p', '기록에 원문을 보관한 뒤 인용할 수 있습니다.', 'life-empty'));
      const source = field('원문', el('select')), version = field('원문 버전', el('select'));
      source.id = 'blogEvidenceSource'; version.id = 'blogEvidenceVersion';
      const blank = el('option', '원문을 선택하세요'); blank.value = ''; source.append(blank);
      source.disabled = !activeSources.length;
      for (const item of activeSources) { const option = el('option', item.title || '제목 없는 원문'); option.value = item.id; source.append(option); }
      const body = field('인용할 구절 선택', el('textarea')); body.id = 'blogEvidenceText'; body.readOnly = true; body.rows = 8;
      const quote = el('blockquote', '', 'life-quote'); quote.id = 'blogEvidenceQuote'; section.append(quote);
      const thought = field('내 생각', el('textarea')); thought.id = 'blogEvidenceThought'; thought.rows = 4; thought.maxLength = 50000;
      if (!includeThought) thought.closest('label').hidden = true;
      const actions = el('div', null, 'life-actions'), apply = el('button', applyLabel, 'life-button life-primary'), cancel = el('button', '취소', 'life-button');
      apply.type = cancel.type = 'button'; actions.append(apply, cancel); section.append(error, actions); host.replaceChildren(section); form = section;
      let raw = '', locator = null, composing = false;
      const selection = () => {
        locator = body.selectionEnd > body.selectionStart ? { start: rawOffset(raw, body.selectionStart), end: rawOffset(raw, body.selectionEnd) } : null;
        quote.textContent = locator ? raw.slice(locator.start, locator.end) : '원문에서 인용할 구절을 선택해 주세요.';
        apply.disabled = !locator || composing || busy; pending = !!locator || !!thought.value;
      };
      const show = () => {
        const item = bundle.sourceVersions.find(value => value.id === version.value && value.sourceId === source.value);
        raw = item?.contentText || ''; body.value = normalized(raw); body.disabled = !raw; locator = null; selection();
      };
      const choose = () => {
        version.replaceChildren();
        for (const [index, item] of bundle.sourceVersions.filter(value => value.sourceId === source.value).entries()) {
          const option = el('option', '버전 ' + (index + 1)); option.value = item.id; version.append(option);
        }
        if (version.options.length) version.selectedIndex = version.options.length - 1;
        version.disabled = !version.options.length;
        show();
      };
      source.addEventListener('change', choose); version.addEventListener('change', show);
      for (const name of ['select', 'keyup', 'pointerup']) body.addEventListener(name, selection);
      thought.addEventListener('input', () => { pending = !!locator || !!thought.value; });
      thought.addEventListener('compositionstart', () => { composing = true; apply.disabled = true; });
      thought.addEventListener('compositionend', () => { composing = false; selection(); });
      apply.addEventListener('click', async () => {
        if (!valid(token) || busy || composing || !locator) return;
        busy = true; source.disabled = version.disabled = body.disabled = thought.disabled = cancel.disabled = apply.disabled = true; error.hidden = true;
        let applied = false;
        try {
          const fresh = await getBundle(); if (!valid(token)) return;
          if (!core().isSourceActive(fresh, source.value)) throw new Error('휴지통에 있는 자료입니다. 선택한 구절은 유지됩니다. 복원한 뒤 인용해 주세요.');
          const ref = await reference().build({ bundle, sourceId: source.value, versionId: version.value, locator });
          await reference().resolve(fresh, ref); if (!valid(token)) return;
          await onApply(includeThought ? draft(ref, thought.value) : { reference: ref }); applied = true; pending = false; if (!valid(token)) return;
        } catch (cause) { if (valid(token)) { error.textContent = cause.message || '새 글을 만들지 못했습니다. 입력을 유지했습니다.'; error.hidden = false; } }
        finally { busy = false; if (valid(token) && section.isConnected) { source.disabled = version.disabled = body.disabled = thought.disabled = cancel.disabled = false; if (!applied) selection(); } }
      });
      cancel.addEventListener('click', async () => { if (!valid(token) || busy || composing) return; await onCancel(); pending = false; epoch++; section.remove(); form = null; });
      if (seed.sourceId) { source.value = seed.sourceId; choose(); if (seed.versionId) { version.value = seed.versionId; show(); } }
      else choose();
      if (seed.locator && raw) { body.setSelectionRange(normalized(raw.slice(0, seed.locator.start)).length, normalized(raw.slice(0, seed.locator.end)).length); selection(); }
      else selection();
      source.focus();
    }
    return Object.freeze({ open, dirty: () => pending || busy,
      async flush() { if (pending || busy) throw new Error('인용 글쓰기를 마치거나 취소해 주세요. 입력은 유지됩니다.'); },
      detach() { epoch++; form?.remove(); form = null; }, dispose() { stopped = true; epoch++; form?.remove(); form = null; } });
  }
  return Object.freeze({ create, draft, rawOffset });
});
