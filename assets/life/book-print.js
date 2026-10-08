/* Private, isolated native printing. Input is a single Books.project result. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  root.HaedoLife ||= {}; root.HaedoLife.BookPrint = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const MAX_DOCUMENT_LENGTH = 16 * 1024 * 1024;
  const CSS = `
@page { size: A4; margin: 19mm 18mm 20mm; }
* { box-sizing: border-box; }
html { color: #171c19; background: #fff; }
body { margin: 0; font-family: "Noto Sans CJK KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  font-size: 10.5pt; line-height: 1.8; word-break: keep-all; overflow-wrap: anywhere; }
h1,h2,h3,h4,p { margin: 0; }
h1,h2,h3,h4 { line-height: 1.45; break-after: avoid; overflow-wrap: anywhere; }
h1 { font-size: 25pt; font-weight: 700; margin-bottom: 6mm; }
h2 { font-size: 18pt; font-weight: 700; margin-bottom: 7mm; }
h3 { font-size: 12pt; font-weight: 700; margin: 7mm 0 3mm; }
h4 { font-size: 10.5pt; font-weight: 700; margin: 5mm 0 2mm; }
.book-header { margin-bottom: 12mm; }
.period,.scope,.metadata,.empty { font-size: 8.5pt; color: #48514b; }
.scope { margin-top: 5mm; }
.text,.metadata,.empty { white-space: pre-wrap; orphans: 3; widows: 3; }
.prose { white-space: normal; }
.prose > p { white-space: pre-wrap; orphans: 3; widows: 3; }
.prose > p + p { margin-top: 1.8em; }
.question { margin-top: 4mm; }
.chapter + .chapter { break-before: page; page-break-before: always; }
.chapter-number { display: block; font-size: 9pt; color: #48514b; margin-bottom: 2mm; }
.source { margin-top: 5mm; }
.source-head { break-inside: avoid; break-after: avoid; }
.metadata { margin-top: 2mm; }
.source-body { margin-top: 3mm; font-size: 9.5pt; }
.insight { margin-top: 8mm; border-top: 0.3mm solid #b9c2bc; padding-top: 3mm; }
.uncertainty { margin-top: 3mm; }
.empty { margin-top: 3mm; }
@media screen { body { max-width: 174mm; margin: 12mm auto; padding: 0 5mm; } }
@media print { body { max-width: none; } }
`;
  const fault = (code, message) => Object.assign(new Error(message), { code });
  const fail = () => { throw fault('invalid_book_print', '인쇄할 책 내용을 확인해 주세요. 원고는 변경하지 않았습니다.'); };
  function str(value) { if (typeof value !== 'string') fail(); return value; }
  function list(value, max) { if (!Array.isArray(value) || value.length > max) fail(); return value; }
  function escape(value) { return str(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function reviewDocumentHtml(projection) {
    if (!projection || typeof projection !== 'object' || typeof projection.includeSources !== 'boolean') fail();
    const chapters = list(projection.chapters, 100), html = []; let length = 0;
    function add(value) {
      length += value.length;
      if (length > MAX_DOCUMENT_LENGTH) throw fault('book_print_too_large', '인쇄할 내용이 너무 큽니다. 원문 본문 포함을 끄거나 책을 나누어 다시 시도해 주세요. 원고는 유지했습니다.');
      html.push(value);
    }
    function text(tag, value, className = '') { add('<' + tag + (className ? ' class="' + className + '"' : '') + '>' + escape(value) + '</' + tag + '>'); }
    function prose(value, className) {
      // Paragraphs are plain text, never parsed Markdown. Preserve the exact
      // separator text in the DOM while letting print widows/orphans act per paragraph.
      add('<div class="prose ' + className + '">');
      str(value).split(/(\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*)/).forEach((part, index) => {
        if (index % 2) add(escape(part)); else text('p', part);
      });
      add('</div>');
    }
    function evidence(items, label, max) {
      list(items, max);
      text('h3', label);
      if (!items.length) { text('p', '연결한 원문이 없습니다.', 'empty'); return; }
      items.forEach((item, index) => {
        if (!item || typeof item.missing !== 'boolean') fail();
        str(item.versionId);
        add('<article class="source"><div class="source-head">');
        if (item.missing) {
          text('h4', '원문 ' + (index + 1));
          text('p', '연결된 원문 없음 · 다른 버전으로 대체하지 않았습니다.', 'metadata');
          add('</div></article>'); return;
        }
        const relation = { self: '내 기록', other: '다른 사람의 기록', unknown: '작성자 관계 미확인' };
        if (!item.originalAuthor || !Object.hasOwn(relation, item.originalAuthor.relation) || !item.coverage || typeof item.hasBody !== 'boolean' ||
          !Number.isInteger(item.versionNumber) || item.versionNumber < 1 || !Number.isInteger(item.versionTotal) || item.versionTotal < item.versionNumber) fail();
        text('h4', (index + 1) + '. ' + str(item.title));
        const lines = [
          '원 작성자: ' + (str(item.originalAuthor.label) || '미확인') + ' · ' + relation[item.originalAuthor.relation],
          '원문 작성일: ' + (item.originalCreatedAt == null ? '미확인' : str(item.originalCreatedAt)),
          '선택 버전: ' + item.versionNumber + '/' + item.versionTotal + ' · ' + item.versionId,
          '본문 확보 범위: ' + ({ full_text: '전체 본문', partial: '일부 본문', link_only: '링크만' }[str(item.coverage.status)] || item.coverage.status),
          '누락: ' + (list(item.coverage.omissions, 1000).map(str).join(' · ') || '확인한 누락 없음')
        ];
        if (item.url != null && str(item.url)) lines.push('출처: ' + item.url);
        if (!item.hasBody) lines.push('본문 미확보 · 링크만 보관했습니다.');
        text('p', lines.join('\n'), 'metadata'); add('</div>');
        if (projection.includeSources) {
          if (!Object.hasOwn(item, 'body') || !(item.body === null || typeof item.body === 'string')) fail();
          if (item.body !== null) prose(item.body, 'source-body');
        }
        add('</article>');
      });
    }
    add('<!doctype html><html lang="ko" data-haedo-print="v1"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">');
    add('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; font-src \'none\'; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">');
    text('title', projection.title); add('<style>' + CSS + '</style></head><body><main><header class="book-header">');
    text('h1', projection.title);
    const fromYear = str(projection.fromYear), toYear = str(projection.toYear);
    if (fromYear || toYear) text('p', (fromYear || '미지정') + ' ~ ' + (toYear || '미지정'), 'period');
    if (str(projection.question)) text('div', projection.question, 'text question');
    text('p', '비공개 책 원고 · ' + (projection.includeSources ? '선택한 원문 본문 포함' : '장 원고·생각·출처만 포함') + '\n원문 작성일은 경험 시기를 뜻하지 않습니다.', 'text scope');
    add('</header>');
    if (!chapters.length) text('p', '아직 구성한 장이 없습니다.', 'empty');
    chapters.forEach((chapter, index) => {
      if (!chapter || typeof chapter !== 'object') fail();
      add('<section class="chapter">');
      text('p', '장 ' + (index + 1), 'chapter-number'); text('h2', chapter.title);
      if (str(chapter.note)) prose(chapter.note, 'manuscript');
      else text('p', '아직 작성한 원고가 없습니다.', 'empty');
      evidence(chapter.evidence, '장의 근거', 1000);
      list(chapter.insights, 100).forEach((insight, at) => {
        if (!insight || typeof insight !== 'object') fail();
        add('<section class="insight">'); text('h3', '지금의 생각 ' + (at + 1));
        if (str(insight.statement)) text('div', insight.statement, 'text');
        else text('p', '아직 작성하지 않은 생각입니다.', 'empty');
        if (str(insight.uncertainty)) {
          text('h4', '아직 모르는 점'); text('div', insight.uncertainty, 'text uncertainty');
        }
        evidence(insight.supportEvidence, '생각과 연결한 근거', 100);
        evidence(insight.counterEvidence, '다른 관점', 100); add('</section>');
      });
      add('</section>');
    });
    add('</main></body></html>'); return html.join('');
  }

  function options(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Reflect.ownKeys(value).some(key => !['mode', 'paper', 'includeInsights'].includes(key))) fail();
    const mode = value.mode === undefined ? 'review' : value.mode;
    const paper = value.paper === undefined ? (mode === 'book' ? 'A5' : 'A4') : value.paper;
    const includeInsights = value.includeInsights === undefined ? mode === 'review' : value.includeInsights;
    if (!['review', 'book'].includes(mode) || !['A5', 'A4'].includes(paper) || typeof includeInsights !== 'boolean' ||
        mode === 'review' && (paper !== 'A4' || !includeInsights)) fail();
    return { mode, paper, includeInsights };
  }
  function bookDocumentHtml(projection, settings) {
    if (!projection || typeof projection !== 'object' || typeof projection.includeSources !== 'boolean') fail();
    const chapters = list(projection.chapters, 100), html = []; let length = 0;
    const css = `
@page { size: ${settings.paper}; margin: 16mm 14mm 18mm; }
* { box-sizing: border-box; }
html { color: #171c19; background: #fff; }
body { margin: 0; font-family: "Noto Sans CJK KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  font-size: 10.5pt; line-height: 1.8; word-break: keep-all; overflow-wrap: anywhere; }
h1,h2,h3,h4,p { margin: 0; }
h1,h2,h3,h4 { line-height: 1.45; break-after: avoid; overflow-wrap: anywhere; }
h1 { font-size: 27pt; font-weight: 700; }
h2 { font-size: 18pt; font-weight: 700; margin-bottom: 7mm; }
h3 { font-size: 12pt; font-weight: 700; margin: 7mm 0 3mm; }
h4 { font-size: 10.5pt; font-weight: 700; margin: 5mm 0 2mm; }
.book-cover { display: flex; justify-content: center; align-items: center; min-height: ${settings.paper === 'A5' ? '140mm' : '210mm'}; text-align: center; }
.book-cover h1 { min-width: 0; max-width: 100%; }
.book-toc,.chapter,.source-appendix { break-before: page; page-break-before: always; }
.book-toc ol { padding-left: 1.5em; }
.book-toc li + li { margin-top: 4mm; }
.book-toc a { color: inherit; text-decoration: none; }
.chapter-number,.metadata,.empty,.scope { font-size: 8.5pt; color: #48514b; }
.chapter-number { margin-bottom: 2mm; }
.text,.metadata,.empty { white-space: pre-wrap; orphans: 3; widows: 3; }
.prose { white-space: normal; }
.prose > p { white-space: pre-wrap; orphans: 3; widows: 3; break-inside: avoid; }
.prose > p + p { margin-top: 1.2em; }
.source { margin-top: 5mm; }
.source-head { break-inside: avoid; }
.metadata { margin-top: 2mm; }
.source-body { margin-top: 3mm; font-size: 9.5pt; }
.insight { margin-top: 8mm; border-top: 0.3mm solid #b9c2bc; padding-top: 3mm; }
.uncertainty,.empty { margin-top: 3mm; }
.appendix-chapter + .appendix-chapter { margin-top: 12mm; }
@media screen {
  body { width: 100%; max-width: ${settings.paper === 'A5' ? '148mm' : '210mm'}; margin: 0 auto; padding: 16px; font-size: 16px; line-height: 1.9; }
  .book-toc,.chapter,.source-appendix { margin-top: 48px; }
  .book-toc a { display: flex; align-items: center; min-height: 44px; }
  .book-toc a:focus-visible { outline: 2px solid #315846; outline-offset: 3px; border-radius: 3px; }
  .metadata,.empty,.scope,.chapter-number { font-size: 13px; }
}
@media print { body { max-width: none; } }
`;
    function add(value) {
      length += value.length;
      if (length > MAX_DOCUMENT_LENGTH) throw fault('book_print_too_large', '인쇄할 내용이 너무 큽니다. 원문 본문 포함을 끄거나 책을 나누어 다시 시도해 주세요. 원고는 유지했습니다.');
      html.push(value);
    }
    function text(tag, value, className = '') {
      add('<' + tag + (className ? ' class="' + className + '"' : '') + '>' + escape(value) + '</' + tag + '>');
    }
    function prose(value, className) {
      add('<div class="prose ' + className + '">');
      str(value).split(/(\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*)/).forEach((part, index) => {
        if (index % 2) add(escape(part)); else text('p', part);
      });
      add('</div>');
    }
    function insights(chapter) {
      return list(chapter.insights, 100).filter(insight => {
        if (!insight || typeof insight !== 'object' || insight.excluded) fail();
        return true;
      });
    }
    function evidence(items, label, max) {
      list(items, max); text('h4', label);
      if (!items.length) { text('p', '연결한 원문이 없습니다.', 'empty'); return; }
      items.forEach((item, index) => {
        if (!item || typeof item.missing !== 'boolean') fail();
        str(item.versionId); add('<article class="source"><div class="source-head">');
        if (item.missing) {
          text('h4', '원문 ' + (index + 1));
          text('p', '연결된 원문 없음 · 다른 버전으로 대체하지 않았습니다.\n선택한 원문 식별자: ' + item.versionId, 'metadata');
          add('</div></article>'); return;
        }
        const relation = { self: '내 기록', other: '다른 사람의 기록', unknown: '작성자 관계 미확인' };
        if (!item.originalAuthor || !Object.hasOwn(relation, item.originalAuthor.relation) || !item.coverage || typeof item.hasBody !== 'boolean' ||
            !Number.isInteger(item.versionNumber) || item.versionNumber < 1 || !Number.isInteger(item.versionTotal) || item.versionTotal < item.versionNumber) fail();
        text('h4', (index + 1) + '. ' + str(item.title));
        const lines = [
          '원 작성자: ' + (str(item.originalAuthor.label) || '미확인') + ' · ' + relation[item.originalAuthor.relation],
          '원문 작성일: ' + (item.originalCreatedAt == null ? '미확인' : str(item.originalCreatedAt)),
          '선택 버전: ' + item.versionNumber + '/' + item.versionTotal + ' · ' + item.versionId,
          '본문 확보 범위: ' + ({ full_text: '전체 본문', partial: '일부 본문', link_only: '링크만' }[str(item.coverage.status)] || item.coverage.status),
          '누락: ' + (list(item.coverage.omissions, 1000).map(str).join(' · ') || '확인한 누락 없음')
        ];
        if (item.url != null && str(item.url)) lines.push('출처: ' + item.url);
        if (!item.hasBody) lines.push('본문 미확보 · 링크만 보관했습니다.');
        text('p', lines.join('\n'), 'metadata'); add('</div>');
        if (projection.includeSources) {
          if (!Object.hasOwn(item, 'body') || !(item.body === null || typeof item.body === 'string')) fail();
          if (item.body !== null) prose(item.body, 'source-body');
        }
        add('</article>');
      });
    }
    add('<!doctype html><html lang="ko" data-haedo-print="v1" data-print-mode="book" data-print-paper="' + settings.paper + '"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">');
    add('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src \'none\'; font-src \'none\'; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">');
    text('title', projection.title); add('<style>' + css + '</style></head><body><main><header class="book-cover">');
    text('h1', projection.title); add('</header><nav class="book-toc" aria-label="책 목차">'); text('h2', '목차'); add('<ol>');
    chapters.forEach((chapter, index) => {
      if (!chapter || typeof chapter !== 'object' || chapter.archived) fail();
      add('<li><a href="#haedo-book-chapter-' + (index + 1) + '">' + escape(chapter.title) + '</a></li>');
    });
    add('</ol><p><a href="#haedo-book-sources">출처 부록</a></p></nav>');
    if (!chapters.length) text('p', '아직 구성한 장이 없습니다.', 'empty');
    chapters.forEach((chapter, index) => {
      add('<section class="chapter" id="haedo-book-chapter-' + (index + 1) + '">');
      text('p', '장 ' + (index + 1), 'chapter-number'); text('h2', chapter.title);
      if (str(chapter.note)) prose(chapter.note, 'manuscript'); else text('p', '아직 작성한 원고가 없습니다.', 'empty');
      if (settings.includeInsights) insights(chapter).forEach((insight, at) => {
        add('<section class="insight">'); text('h3', '지금의 생각 ' + (at + 1));
        if (str(insight.statement)) text('div', insight.statement, 'text'); else text('p', '아직 작성하지 않은 생각입니다.', 'empty');
        if (str(insight.uncertainty)) { text('h4', '아직 모르는 점'); text('div', insight.uncertainty, 'text uncertainty'); }
        add('</section>');
      });
      add('</section>');
    });
    add('<section class="source-appendix" id="haedo-book-sources">'); text('h2', '출처 부록');
    text('p', '원문 작성일은 경험 시기를 뜻하지 않습니다.\n' + (projection.includeSources ? '명시적으로 선택한 원문 본문을 포함했습니다.' : '출처 정보만 포함했으며 원문 본문은 제외했습니다.'), 'text scope');
    chapters.forEach((chapter, index) => {
      add('<section class="appendix-chapter">'); text('h3', '장 ' + (index + 1) + ' · ' + chapter.title);
      evidence(chapter.evidence, '장의 근거', 1000);
      if (settings.includeInsights) insights(chapter).forEach((insight, at) => {
        text('h4', '생각 ' + (at + 1) + '의 연결');
        evidence(insight.supportEvidence, '생각과 연결한 근거', 100);
        evidence(insight.counterEvidence, '다른 관점', 100);
      });
      add('</section>');
    });
    add('</section></main></body></html>'); return html.join('');
  }
  function documentHtml(projection, value) {
    const settings = options(value);
    return settings.mode === 'review' ? reviewDocumentHtml(projection) : bookDocumentHtml(projection, settings);
  }

  let active = null;
  function cancel() { active?.cancel(); }
  function print(projection, { isCurrent, mode, paper, includeInsights } = {}) {
    if (typeof isCurrent !== 'function') return Promise.reject(fault('invalid_book_print', '인쇄할 책의 현재 화면을 확인해 주세요.'));
    if (!root.document?.body) return Promise.reject(fault('book_print_unavailable', '이 브라우저에서 인쇄 화면을 열 수 없습니다.'));
    if (active && !active.started) return Promise.reject(fault('book_print_busy', '인쇄 화면을 준비 중입니다. 잠시 뒤 다시 시도해 주세요.'));
    if (active) cancel(); // A new explicit print action releases an older completed dialog's frame.
    let html;
    try {
      if (!isCurrent()) throw fault('book_print_cancelled', '책이나 계정이 바뀌어 인쇄 요청을 취소했습니다.');
      html = documentHtml(projection, { mode, paper, includeInsights });
    } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const frame = root.document.createElement('iframe'), previousFocus = root.document.activeElement;
      frame.title = '선택한 책 인쇄'; frame.dataset.bookPrint = 'true'; frame.tabIndex = -1;
      frame.setAttribute('aria-hidden', 'true'); frame.setAttribute('sandbox', 'allow-same-origin allow-modals'); frame.referrerPolicy = 'no-referrer';
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0;pointer-events:none;';
      let timer = null, finished = false, loading = false, objectUrl = null;
      const request = { frame, started: false, cancel: () => failRequest(fault('book_print_cancelled', '책이나 계정이 바뀌어 인쇄 요청을 취소했습니다.')) };
      active = request;
      function current() { try { return active === request && frame.isConnected && isCurrent(); } catch (_) { return false; } }
      function cleanup() {
        if (timer !== null) root.clearTimeout(timer);
        frame.removeEventListener('load', loaded); frame.contentWindow?.removeEventListener('afterprint', afterPrint);
        frame.remove();
        if (objectUrl !== null) { root.URL.revokeObjectURL(objectUrl); objectUrl = null; }
        if (active === request) active = null;
      }
      function failRequest(error) { cleanup(); if (!finished) { finished = true; reject(error); } }
      function afterPrint() {
        const restore = current(); cleanup();
        if (restore && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      }
      async function loaded() {
        if (loading || frame.contentDocument?.documentElement?.dataset.haedoPrint !== 'v1') return;
        loading = true;
        try {
          if (!current()) throw fault('book_print_cancelled', '책이나 계정이 바뀌어 인쇄 요청을 취소했습니다.');
          if (frame.contentDocument.fonts?.ready) await frame.contentDocument.fonts.ready;
          if (!current()) throw fault('book_print_cancelled', '책이나 계정이 바뀌어 인쇄 요청을 취소했습니다.');
          const win = frame.contentWindow;
          if (typeof win?.print !== 'function') throw fault('book_print_unavailable', '이 브라우저에서 인쇄 화면을 열 수 없습니다.');
          win.addEventListener('afterprint', afterPrint, { once: true });
          root.clearTimeout(timer); timer = null; win.focus();
          if (!current()) throw fault('book_print_cancelled', '책이나 계정이 바뀌어 인쇄 요청을 취소했습니다.');
          request.started = true; win.print();
          if (!finished) { finished = true; resolve({ requested: true }); }
          // Safari can return before the dialog closes. Keep the document until
          // afterprint, cancellation, or another explicit print; never claim saved.
        } catch (error) { failRequest(error); }
      }
      frame.addEventListener('load', loaded);
      timer = root.setTimeout(() => failRequest(fault('book_print_timeout', '인쇄 화면을 준비하지 못했습니다. 원고는 유지했습니다. 다시 시도해 주세요.')), 15000);
      try {
        if (typeof root.Blob !== 'function' || typeof root.URL?.createObjectURL !== 'function' || typeof root.URL?.revokeObjectURL !== 'function')
          throw fault('book_print_unavailable', '이 브라우저에서 인쇄 화면을 열 수 없습니다.');
        // A Blob document owns its fragment base. srcdoc would resolve TOC
        // fragments against the embedding app rather than the printed book.
        objectUrl = root.URL.createObjectURL(new root.Blob([html], { type: 'text/html;charset=utf-8' }));
        frame.src = objectUrl; root.document.body.append(frame);
      } catch (_) { failRequest(fault('book_print_unavailable', '이 브라우저에서 인쇄 화면을 열 수 없습니다.')); }
    });
  }
  return Object.freeze({ document: documentHtml, print, cancel, MAX_DOCUMENT_LENGTH });
});
