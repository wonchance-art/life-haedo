/* Render only the verified body of one private article; the news shell owns navigation. */
(function (root) {
  'use strict';
  const node = (tag, text, className) => { const element = root.document.createElement(tag); if (text != null) element.textContent = text; if (className) element.className = className; return element; };
  function create({ article }) {
    const imageUrls = new Set(); let disposed = false;
    const element = node('div', null, 'discovery-reader-content'); element.id = 'discoveryReaderContent'; element.tabIndex = 0;
    element.setAttribute('aria-label', article.coverage === 'summary' ? '초록' : '본문');
    function release(address) { if (imageUrls.delete(address)) root.URL.revokeObjectURL(address); }
    function link(text, value) {
      const address = new URL(value); if (address.protocol !== 'https:' || address.username || address.password) return node('span', text);
      const result = node('a', text); result.href = address.href; result.target = '_blank'; result.rel = 'noopener noreferrer'; result.referrerPolicy = 'no-referrer'; return result;
    }
    function figure(image) {
      // The private client checks MIME, signature, dimensions, byte budget and source URL first.
      // Decoding these bytes makes no request to the publisher's image server.
      try {
        const bytes = Uint8Array.from(root.atob(image.dataBase64), value => value.charCodeAt(0));
        const address = root.URL.createObjectURL(new Blob([bytes], { type: image.mimeType })); imageUrls.add(address);
        const frame = node('figure', null, 'discovery-reader-figure'), picture = node('img', null, 'discovery-reader-image');
        picture.alt = image.alt; picture.loading = 'lazy'; picture.decoding = 'async'; picture.referrerPolicy = 'no-referrer';
        picture.addEventListener('load', () => release(address), { once: true });
        picture.addEventListener('error', () => { release(address); if (!disposed) frame.hidden = true; }, { once: true });
        picture.src = address; frame.append(picture);
        const caption = node('figcaption'); if (image.caption) caption.append(node('p', image.caption));
        const credit = node('p', null, 'discovery-reader-credit'); credit.append(link(image.credit || '이미지 출처', image.sourceUrl));
        if (image.license?.label) credit.append(node('span', ' · '), image.license.url ? link(image.license.label, image.license.url) : node('span', image.license.label));
        caption.append(credit); frame.append(caption); return frame;
      } catch (_) { return null; }
    }
    const text = article.coverage === 'full_text' ? article.bodyText : article.coverage === 'summary' ? article.summary : '';
    const body = node('div', null, 'discovery-reader-text'); if (article.language && article.language !== 'und') body.lang = article.language;
    const parts = (text || '').split(/(\r?\n[ \t]*\r?\n)/), images = article.images || [];
    for (let index = 0; index < parts.length; index += 2) {
      body.append(root.document.createTextNode(parts[index]));
      for (const image of images.filter(item => item.afterParagraph === index / 2)) { const rendered = figure(image); if (rendered) body.append(rendered); }
      if (parts[index + 1]) body.append(root.document.createTextNode(parts[index + 1]));
    }
    element.append(body);
    for (const image of images.filter(item => item.afterParagraph === undefined)) { const rendered = figure(image); if (rendered) element.append(rendered); }
    if (article.privateReceipt?.stale && article.acquisition?.fetchedAt) {
      const stale = node('p', '이전 수집본 · ', 'discovery-reader-stale');
      const time = node('time', new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(article.acquisition.fetchedAt)));
      time.dateTime = article.acquisition.fetchedAt; time.title = article.acquisition.fetchedAt; stale.append(time); element.append(stale);
    }
    function dispose() { disposed = true; imageUrls.forEach(address => root.URL.revokeObjectURL(address)); imageUrls.clear(); element.remove(); }
    return Object.freeze({ element, dispose });
  }
  root.HaedoLife ||= {}; root.HaedoLife.DiscoveryReaderUI = Object.freeze({ create });
})(globalThis);
