/* Read one validated, account-scoped article snapshot without leaving news. */
(function (root) {
  'use strict';
  const node = (tag, text, className) => { const el = root.document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; };
  function create({ article, sourceName, published, backButton, originalLink, loading = false }) {
    const imageUrls = new Set(); let disposed = false;
    function release(address) { if (imageUrls.delete(address)) root.URL.revokeObjectURL(address); }
    function externalLink(text, address) {
      const link = node('a', text); link.href = address; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer'; return link;
    }
    function figure(image) {
      // The account reader validates type and byte budgets before rendering.
      // Only supplied bytes are decoded; the browser never fetches a publisher image.
      try {
        const bytes = Uint8Array.from(root.atob(image.dataBase64), value => value.charCodeAt(0));
        const address = root.URL.createObjectURL(new Blob([bytes], { type: image.mimeType })); imageUrls.add(address);
        const element = node('figure', null, 'discovery-reader-figure'), picture = node('img');
        picture.alt = image.alt; picture.loading = 'lazy'; picture.decoding = 'async'; picture.referrerPolicy = 'no-referrer';
        picture.addEventListener('load', () => release(address), { once: true });
        picture.addEventListener('error', () => { release(address); if (!disposed) element.hidden = true; }, { once: true });
        picture.src = address; element.append(picture);
        const caption = node('figcaption');
        if (image.caption) caption.append(node('p', image.caption));
        const attribution = node('p', null, 'discovery-reader-credit');
        attribution.append(externalLink(image.credit || '이미지 출처', image.sourceUrl));
        if (image.license?.label) attribution.append(node('span', ' · '), image.license.url ? externalLink(image.license.label, image.license.url) : node('span', image.license.label));
        caption.append(attribution); element.append(caption); return element;
      } catch (_) { return null; }
    }
    const element = node('article', null, 'discovery-reader'); element.id = 'discoveryReader';
    element.dataset.discoveryId = article.id; element.dataset.discoveryUrl = article.canonicalUrl;
    element.setAttribute('aria-labelledby', 'discoveryReaderTitle');
    const navigation = node('div', null, 'discovery-reader-navigation'); navigation.append(backButton, originalLink);
    const heading = node('h2', article.title, 'discovery-reader-title'); heading.id = 'discoveryReaderTitle'; heading.tabIndex = -1;
    const meta = node('p', null, 'discovery-reader-meta'); meta.append(node('span', sourceName));
    if (published) { const time = node('time', published); time.dateTime = article.publishedAt; meta.append(time); }
    if (article.author) meta.append(node('span', article.author));
    const statusHost = node('div', null, 'discovery-reader-status');
    const content = node('div', null, 'discovery-reader-content'); content.id = 'discoveryReaderContent';
    function setContent(selected) {
      if (disposed) return;
      imageUrls.forEach(address => root.URL.revokeObjectURL(address)); imageUrls.clear(); content.replaceChildren();
      const text = selected.coverage === 'full_text' ? selected.bodyText : selected.coverage === 'summary' ? selected.summary : '';
      if (selected.coverage === 'summary') content.append(node('p', '요약', 'discovery-reader-coverage'));
      if (text) {
        // Source text is plain text. Never treat source markup as trusted HTML.
        const body = node('div', null, 'discovery-reader-text'); if (selected.language && selected.language !== 'und') body.lang = selected.language;
        const paragraphs = text.split(/(\n[ \t]*\n)/), images = selected.images || [];
        for (let index = 0; index < paragraphs.length; index += 2) {
          body.append(root.document.createTextNode(paragraphs[index]));
          for (const image of images.filter(item => item.afterParagraph === index / 2)) { const picture = figure(image); if (picture) body.append(picture); }
          if (paragraphs[index + 1]) body.append(root.document.createTextNode(paragraphs[index + 1]));
        }
        content.append(body);
        for (const image of images.filter(item => item.afterParagraph === undefined)) { const picture = figure(image); if (picture) content.append(picture); }
      } else content.append(node('p', '아직 확보한 본문이 없습니다.', 'discovery-reader-empty'));
      if (selected.privateReceipt?.stale && selected.acquisition?.fetchedAt) {
        const saved = node('p', selected.coverage === 'summary' ? '이전 보관 요약 · 수집 ' : '이전 보관 본문 · 수집 ', 'discovery-reader-stale');
        const time = node('time', new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(selected.acquisition.fetchedAt)));
        time.dateTime = selected.acquisition.fetchedAt; time.title = selected.acquisition.fetchedAt; saved.append(time); content.append(saved);
      }
      if (text && selected.rights?.label) {
        const rights = node('p', null, 'discovery-reader-rights');
        if (selected.author) rights.append(node('span', selected.author + ' · '));
        rights.append(selected.rights.url ? externalLink(selected.rights.label, selected.rights.url) : node('span', selected.rights.label));
        rights.append(node('span', ' · 원문 서식을 단순화했습니다.')); content.append(rights);
      }
    }
    function setState({ loading = false, error = '', retryButton = null } = {}) {
      if (disposed) return;
      element.dataset.readerState = loading ? 'loading' : error ? 'error' : 'ready';
      content.setAttribute('aria-busy', String(loading)); statusHost.replaceChildren();
      content.querySelector('.discovery-reader-empty')?.toggleAttribute('hidden', loading || !!error);
      if (loading || error) {
        const status = node('p', loading ? '본문을 불러오는 중입니다.' : error, error ? 'life-error' : 'discovery-reader-loading');
        status.id = 'discoveryReaderStatus'; status.setAttribute('role', error ? 'alert' : 'status'); statusHost.append(status);
        if (retryButton) { retryButton.disabled = loading; statusHost.append(retryButton); }
      }
    }
    const controlsHost = node('div', null, 'discovery-reader-controls'), recoveryHost = node('div', null, 'discovery-reader-recovery');
    element.append(navigation, heading, meta, statusHost, content, controlsHost, recoveryHost);
    setContent(article); setState({ loading });
    function dispose() { disposed = true; imageUrls.forEach(address => root.URL.revokeObjectURL(address)); imageUrls.clear(); element.remove(); }
    return Object.freeze({ element, controlsHost, recoveryHost, heading, setContent, setState, dispose });
  }
  root.HaedoLife ||= {}; root.HaedoLife.DiscoveryReaderUI = Object.freeze({ create });
})(globalThis);
