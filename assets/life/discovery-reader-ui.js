/* Read the validated public catalog snapshot without leaving the news view. */
(function (root) {
  'use strict';
  const node = (tag, text, className) => { const el = root.document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; };
  function create({ article, sourceName, published, backButton, originalLink }) {
    const imageUrls = new Set(); let disposed = false;
    function release(address) { if (imageUrls.delete(address)) root.URL.revokeObjectURL(address); }
    function externalLink(text, address) {
      const link = node('a', text); link.href = address; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer'; return link;
    }
    function figure(image) {
      // validateFeed has already checked type, byte budget and image rights.
      // Only embedded catalog bytes are decoded; the browser never fetches a publisher image.
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
        attribution.append(externalLink(image.credit, image.sourceUrl), node('span', ' · '), externalLink(image.license.label, image.license.url));
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
    const content = node('div', null, 'discovery-reader-content'); content.id = 'discoveryReaderContent';
    const text = article.coverage === 'full_text' ? article.bodyText : article.coverage === 'summary' ? article.summary : '';
    if (article.coverage === 'summary') content.append(node('p', '요약', 'discovery-reader-coverage'));
    if (text) {
      // Catalog text is plain text. Never treat source markup as trusted HTML.
      const body = node('div', null, 'discovery-reader-text'); if (article.language && article.language !== 'und') body.lang = article.language;
      const paragraphs = text.split(/(\n[ \t]*\n)/), images = article.images || [];
      for (let index = 0; index < paragraphs.length; index += 2) {
        body.append(root.document.createTextNode(paragraphs[index]));
        for (const image of images.filter(item => item.afterParagraph === index / 2)) { const picture = figure(image); if (picture) body.append(picture); }
        if (paragraphs[index + 1]) body.append(root.document.createTextNode(paragraphs[index + 1]));
      }
      content.append(body);
      for (const image of images.filter(item => item.afterParagraph === undefined)) { const picture = figure(image); if (picture) content.append(picture); }
    } else content.append(node('p', '아직 확보한 본문이 없습니다.', 'discovery-reader-empty'));
    if (text && article.rights?.label) {
      const rights = node('p', null, 'discovery-reader-rights');
      if (article.author) rights.append(node('span', article.author + ' · '));
      rights.append(article.rights.url ? externalLink(article.rights.label, article.rights.url) : node('span', article.rights.label));
      rights.append(node('span', ' · 원문 서식을 단순화했습니다.')); content.append(rights);
    }
    const controlsHost = node('div', null, 'discovery-reader-controls'), recoveryHost = node('div', null, 'discovery-reader-recovery');
    element.append(navigation, heading, meta, content, controlsHost, recoveryHost);
    function dispose() { disposed = true; imageUrls.forEach(address => root.URL.revokeObjectURL(address)); imageUrls.clear(); element.remove(); }
    return Object.freeze({ element, controlsHost, recoveryHost, heading, dispose });
  }
  root.HaedoLife ||= {}; root.HaedoLife.DiscoveryReaderUI = Object.freeze({ create });
})(globalThis);
