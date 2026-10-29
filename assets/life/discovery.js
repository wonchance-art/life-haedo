/* Explicit manual interests -> inspectable public lexical matches.
 * No model, private text upload, storage writes or request on module import. */
(function (root, factory) {
  'use strict';
  const api = factory(root); (root.HaedoLife ||= {}).Discovery = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const ALLOWED_SOURCES = Object.freeze({
    'naver-d2': Object.freeze(['d2.naver.com']),
    'seoul-culture': Object.freeze(['news.seoul.go.kr']),
    'woowahan-tech': Object.freeze(['techblog.woowahan.com']),
    'readersnews-books': Object.freeze(['www.readersnews.com']),
    'seoul-environment': Object.freeze(['news.seoul.go.kr']),
    'arxiv-cs-cl': Object.freeze(['arxiv.org', 'rss.arxiv.org']),
    'mit-linguistics': Object.freeze(['news.mit.edu']),
    'llt-journal': Object.freeze(['www.lltjournal.org']),
    'frontiers-psychology': Object.freeze(['www.frontiersin.org'])
  });
  // Small, public and inspectable equivalences. No broader topic inference.
  const ALIASES = Object.freeze([
    ['인공지능', '인공 지능', 'artificial intelligence', 'AI'],
    ['기계학습', '기계 학습', 'machine learning'],
    ['기후 변화', '기후변화', 'climate change'],
    ['독서', '책 읽기', 'book reading'],
    ['글쓰기', '글 쓰기'],
    ['개인정보', '개인 정보', 'personal information'],
    ['접근성', 'accessibility'],
    ['언어학', 'linguistics'],
    ['언어 학습', '언어학습', 'language learning'],
    ['언어 교육', '언어교육', 'language education'],
    ['외국어 학습', '외국어학습', 'foreign language learning'],
    ['그릿', 'grit']
  ].map(row => Object.freeze(row)));
  // Directional discovery aids, not equivalences or personalization features.
  // Only the explicitly supplied label can reach these phrases, in titles.
  const RELATED_TERMS = Object.freeze(Object.fromEntries([
    ['외국어 학습', ['EFL/ESL learning', 'ESL learning', 'foreign language learning', 'second language learning']],
    ['외국어학습', ['EFL/ESL learning', 'ESL learning', 'foreign language learning', 'second language learning']],
    ['독서', ['reading comprehension']],
    ['책 읽기', ['reading comprehension']],
    ['집중력', ['sustained attention', 'mind wandering', 'minds wander']]
  ].map(([label, values]) => [label, Object.freeze(values)])));
  const LIMITS = Object.freeze({ articles: 500, sources: 20, manual: 40, matches: 5, feedBytes: 4 * 1024 * 1024,
    imagesPerArticle: 2, imageBytes: 256 * 1024, feedImageBytes: 768 * 1024, imageSide: 4096, imagePixels: 16 * 1024 * 1024 });
  const CONTENT_LANGUAGE_CODES = Object.freeze(['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'und', 'mul', 'other']);
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const fail = code => Object.assign(new Error({ discovery_feed_invalid: '공개 목록의 형식과 출처를 확인하지 못했습니다.', discovery_unavailable: '공개 목록을 불러오지 못했습니다.', discovery_profile_invalid: '저장한 관심과 추천 조정을 다시 확인해 주세요.' }[code] || '공개 목록을 확인해 주세요.'), { code });
  const check = (condition, code = 'discovery_feed_invalid') => { if (!condition) throw fail(code); };
  // Compare publisher-provided tags without changing the stored metadata or
  // inferring an article's language from its title or publisher's language.
  function languageKey(value) {
    if (typeof value !== 'string' || !value.trim()) return 'und';
    const raw = value.trim();
    if (raw.toLowerCase() === 'unknown') return 'und';
    if (raw.toLowerCase() === 'mixed') return 'mul';
    try {
      const primary = Intl.getCanonicalLocales(raw)[0].split('-')[0].toLowerCase();
      return CONTENT_LANGUAGE_CODES.includes(primary) ? primary : 'other';
    } catch (_) { return 'und'; }
  }
  function languageSelection(value) {
    if (value === undefined || value === null) return null;
    check(Array.isArray(value) && value.length <= CONTENT_LANGUAGE_CODES.length &&
      Array.from(value).every(code => CONTENT_LANGUAGE_CODES.includes(code)) && new Set(value).size === value.length, 'discovery_profile_invalid');
    return [...value];
  }
  function languageAllowed(value, contentLanguages) {
    const selection = languageSelection(contentLanguages);
    return selection === null || selection.includes(languageKey(value));
  }
  function text(value, maximum, allowEmpty = false) {
    if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return false;
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
      else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    }
    return true;
  }
  function canonicalUrl(value) {
    if (typeof value !== 'string' || !value || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') return null;
      url.hash = '';
      // Remove only known tracking keys. Keep the raw spelling/order of
      // identity query parts (%20 versus +, duplicate keys and signatures).
      const parts = url.search ? url.search.slice(1).split('&') : [];
      const kept = parts.filter(part => {
        let key = part.split('=', 1)[0];
        try { key = decodeURIComponent(key.replace(/\+/g, ' ')); } catch (_) {}
        return !(/^utm_/i.test(key) || /^(?:fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|_hsenc|_hsmi)$/i.test(key));
      });
      if (kept.length !== parts.length) url.search = kept.length ? '?' + kept.join('&') : '';
      return url.href;
    } catch (_) { return null; }
  }
  function iso(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
    const stamp = Date.parse(value); if (!Number.isFinite(stamp)) return null;
    const normalized = new Date(stamp).toISOString(); return normalized.slice(0, 19) === value.slice(0, 19) ? normalized : null;
  }
  function nowValue(value) {
    const result = typeof value === 'function' ? value() : value;
    const stamp = result === undefined ? Date.now() : typeof result === 'number' ? result : Date.parse(result);
    check(Number.isFinite(stamp)); return stamp;
  }
  function publicUrl(value, hosts) {
    const normalized = canonicalUrl(value); if (!normalized) return false;
    return !hosts || hosts.includes(new URL(normalized).hostname);
  }
  function rights(value) {
    check(plain(value) && text(value.label, 500) && ['metadata_only', 'summary_allowed', 'full_text_allowed'].includes(value.mode));
    check(value.url === null || publicUrl(value.url));
    return { label: value.label, url: value.url, mode: value.mode };
  }
  // Read raster headers before any browser decode. The existing photo decoder
  // is asynchronous; feed validation must stay synchronous and perform no I/O.
  function imageDimensions(bytes, mimeType) {
    const byte = offset => bytes.charCodeAt(offset);
    const be = (offset, size) => { let value = 0; for (let i = 0; i < size; i++) value = value * 256 + byte(offset + i); return value; };
    const le = (offset, size) => { let value = 0; for (let i = size - 1; i >= 0; i--) value = value * 256 + byte(offset + i); return value; };
    if (mimeType === 'image/png' && bytes.length >= 33 && bytes.startsWith('\x89PNG\r\n\x1a\n') &&
        be(8, 4) === 13 && bytes.slice(12, 16) === 'IHDR') return [be(16, 4), be(20, 4)];
    if (mimeType === 'image/webp' && bytes.length >= 20 && bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP' && le(4, 4) + 8 === bytes.length) {
      const chunk = bytes.slice(12, 16), size = le(16, 4);
      if (size > bytes.length - 20) return null;
      if (chunk === 'VP8X' && size >= 10 && bytes.length >= 30) return [le(24, 3) + 1, le(27, 3) + 1];
      if (chunk === 'VP8 ' && size >= 10 && bytes.length >= 30 && bytes.slice(23, 26) === '\x9d\x01\x2a') return [le(26, 2) & 0x3fff, le(28, 2) & 0x3fff];
      if (chunk === 'VP8L' && size >= 5 && bytes.length >= 25 && byte(20) === 0x2f) {
        const bits = le(21, 4); return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
      }
    }
    if (mimeType === 'image/jpeg' && bytes.startsWith('\xff\xd8\xff') && bytes.endsWith('\xff\xd9')) {
      let cursor = 2;
      while (cursor + 4 <= bytes.length) {
        if (byte(cursor) !== 0xff) break;
        while (cursor < bytes.length && byte(cursor) === 0xff) cursor++;
        if (cursor >= bytes.length) break;
        const marker = byte(cursor++);
        if (marker === 0x01 || marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7) continue;
        if (marker === 0xd9 || marker === 0xda || cursor + 2 > bytes.length) break;
        const length = be(cursor, 2);
        if (length < 2 || cursor + length > bytes.length) break;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) return [be(cursor + 5, 2), be(cursor + 3, 2)];
        cursor += length;
      }
    }
    return null;
  }
  // Images travel with the bounded public feed. No publisher URL becomes an
  // image request, and optional image failures never discard a readable body.
  function images(values, hosts, paragraphText, budget) {
    if (!Array.isArray(values) || values.length > LIMITS.imagesPerArticle) return [];
    const result = [], required = ['mimeType', 'dataBase64', 'alt', 'caption', 'credit', 'license', 'sourceUrl'];
    for (const value of values) {
      try {
        check(plain(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, 'afterParagraph'].includes(key)));
        check(['image/png', 'image/jpeg', 'image/webp'].includes(value.mimeType));
        check(text(value.alt, 1000, true) && text(value.caption, 4000, true) && text(value.credit, 1000));
        check(plain(value.license) && Object.keys(value.license).length === 2 && text(value.license.label, 200) &&
          ['https://creativecommons.org/licenses/by/4.0/', 'https://creativecommons.org/licenses/by/4.0'].includes(value.license.url));
        const sourceUrl = canonicalUrl(value.sourceUrl);
        check(sourceUrl === value.sourceUrl && publicUrl(sourceUrl, hosts));
        if (Object.hasOwn(value, 'afterParagraph')) check(Number.isInteger(value.afterParagraph) && value.afterParagraph >= 0 &&
          paragraphText.trim() && value.afterParagraph < paragraphText.split(/\n[ \t]*\n/).length);
        const encoded = value.dataBase64;
        check(typeof encoded === 'string' && encoded.length > 0 && encoded.length <= Math.ceil(LIMITS.imageBytes / 3) * 4 &&
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded));
        const bytes = root.atob(encoded);
        check(bytes.length <= LIMITS.imageBytes && root.btoa(bytes) === encoded);
        const size = imageDimensions(bytes, value.mimeType);
        check(size && size.every(value => Number.isInteger(value) && value > 0 && value <= LIMITS.imageSide) &&
          size[0] * size[1] <= LIMITS.imagePixels && budget.bytes + bytes.length <= LIMITS.feedImageBytes);
        budget.bytes += bytes.length;
        result.push({ mimeType: value.mimeType, dataBase64: encoded, alt: value.alt, caption: value.caption, credit: value.credit,
          license: { label: value.license.label, url: 'https://creativecommons.org/licenses/by/4.0/' }, sourceUrl,
          ...(Object.hasOwn(value, 'afterParagraph') ? { afterParagraph: value.afterParagraph } : {}) });
      } catch (_) { /* Keep valid public text when an optional picture is unusable. */ }
    }
    return result;
  }
  function validateFeed(input, options = {}) {
    check(plain(input) && input.schemaVersion === 1 && iso(input.generatedAt) && Array.isArray(input.sources) && input.sources.length <= LIMITS.sources && Array.isArray(input.articles) && input.articles.length <= LIMITS.articles);
    check(new TextEncoder().encode(JSON.stringify(input)).length <= LIMITS.feedBytes);
    const allowed = options.allowedSources || ALLOWED_SOURCES, now = nowValue(options.now), ids = new Set(), sources = [];
    check(plain(allowed) && Date.parse(input.generatedAt) <= now + 300000);
    for (const source of input.sources) {
      check(plain(source) && validId(source.id) && !ids.has(source.id) && Array.isArray(allowed[source.id]) && allowed[source.id].length > 0);
      const hosts = allowed[source.id]; check(hosts.every(host => typeof host === 'string' && /^[a-z0-9.-]+$/.test(host)));
      check(text(source.name, 200) && publicUrl(source.url, hosts) && publicUrl(source.feedUrl, hosts));
      check(text(source.language, 30) && ['ok', 'error', 'never_fetched'].includes(source.status) && typeof source.stale === 'boolean');
      const lastSuccessAt = source.lastSuccessAt === null ? null : iso(source.lastSuccessAt), lastAttemptAt = source.lastAttemptAt === null ? null : iso(source.lastAttemptAt);
      check((source.lastSuccessAt === null || lastSuccessAt) && (source.lastAttemptAt === null || lastAttemptAt));
      check(source.error === null || text(source.error, 1000));
      if (source.status === 'ok') check(lastSuccessAt && lastAttemptAt && source.error === null);
      if (source.status === 'error') check(lastAttemptAt && source.error !== null);
      if (lastSuccessAt && lastAttemptAt) check(Date.parse(lastSuccessAt) <= Date.parse(lastAttemptAt));
      const freshnessMaxAgeDays = source.freshnessMaxAgeDays ?? 7;
      check(Number.isInteger(freshnessMaxAgeDays) && freshnessMaxAgeDays >= 1 && freshnessMaxAgeDays <= 31);
      check(!lastAttemptAt || Date.parse(lastAttemptAt) <= now + 300000);
      ids.add(source.id); sources.push({ id: source.id, name: source.name, url: source.url, feedUrl: source.feedUrl, language: source.language,
        rights: rights(source.rights), status: source.status, lastSuccessAt, lastAttemptAt, error: source.error, freshnessMaxAgeDays,
        stale: source.stale || source.status !== 'ok' || !lastSuccessAt || now - Date.parse(lastSuccessAt) > freshnessMaxAgeDays * 86400000 });
    }
    const bySource = new Map(sources.map(source => [source.id, source])), articleIds = new Set(), articles = [], invalid = [], imageBudget = { bytes: 0 };
    if (plain(input.validation) && Array.isArray(input.validation.invalid)) for (const row of input.validation.invalid.slice(0, LIMITS.articles)) if (plain(row) && row.reason === 'invalid_article' && (row.id === null || validId(row.id))) invalid.push({ id: row.id, reason: row.reason });
    for (const article of input.articles) {
      try {
        check(plain(article) && validId(article.id) && !articleIds.has(article.id) && bySource.has(article.sourceId));
        const source = bySource.get(article.sourceId); check(source.status !== 'never_fetched');
        check(publicUrl(article.url, allowed[article.sourceId]) && text(article.title, 500));
        check(article.author === null || text(article.author, 200)); check(text(article.language, 30));
        check(['link_only', 'summary', 'full_text'].includes(article.coverage) && text(article.summary, 50000, true));
        const permission = rights(article.rights), bodyText = article.bodyText === undefined ? '' : article.bodyText;
        check(text(bodyText, 200000, true));
        if (article.coverage === 'link_only') check(article.summary === '' && bodyText === '');
        if (article.coverage === 'summary') check(permission.mode !== 'metadata_only' && article.summary.trim() && bodyText === '');
        if (article.coverage === 'full_text') check(permission.mode === 'full_text_allowed' && bodyText.trim());
        const fetchedAt = iso(article.fetchedAt); check(fetchedAt && Date.parse(fetchedAt) <= now + 300000);
        const tags = article.tags === undefined ? [] : article.tags;
        check(Array.isArray(tags) && tags.length <= 50 && tags.every(tag => text(tag, 200)));
        const publishedAt = article.publishedAt === null ? null : iso(article.publishedAt);
        const dateStatus = article.dateStatus === 'invalid' && article.publishedAt === null ? 'invalid' : article.publishedAt === null ? 'unknown' : !publishedAt ? 'invalid' : Date.parse(publishedAt) > now + 300000 ? 'future' : 'valid';
        const updatedAt = article.updatedAt === undefined || article.updatedAt === null ? null : iso(article.updatedAt);
        const usablePublished = dateStatus === 'valid' ? publishedAt : null, usableUpdated = updatedAt && Date.parse(updatedAt) <= now + 300000 ? updatedAt : null;
        const sortDate = usablePublished || usableUpdated, dateBasis = usablePublished ? 'published' : usableUpdated ? 'updated' : 'unknown';
        const pictures = images(article.images, allowed[article.sourceId], bodyText || article.summary, imageBudget);
        articleIds.add(article.id); articles.push({ id: article.id, sourceId: article.sourceId, url: article.url, canonicalUrl: canonicalUrl(article.url), title: article.title,
          publishedAt, dateStatus, updatedAt, dateBasis, sortDate, author: article.author, language: article.language, summary: article.summary,
          ...(bodyText ? { bodyText } : {}), ...(pictures.length ? { images: pictures } : {}), coverage: article.coverage, rights: permission, fetchedAt, tags: [...new Set(tags)] });
      } catch (cause) { if (cause.code !== 'discovery_feed_invalid') throw cause; invalid.push({ id: validId(article?.id) ? article.id : null, reason: 'invalid_article' }); }
    }
    return { schemaVersion: 1, generatedAt: iso(input.generatedAt), stale: sources.some(source => source.stale) || now - Date.parse(input.generatedAt) > 7 * 86400000, sources, articles, validation: { invalid, suppliedArticles: input.articles.length } };
  }
  const fold = value => value.replace(/[A-Z]/g, character => character.toLowerCase());
  function terms(label) {
    const normalized = fold(label.trim()); const group = ALIASES.find(row => row.some(value => fold(value) === normalized));
    const equivalent = [...new Set([label.trim(), ...(group || [])])].map(value => ({ value, via: fold(value) === normalized ? 'exact' : 'alias' }));
    const known = new Set(equivalent.map(term => fold(term.value)));
    const related = Object.hasOwn(RELATED_TERMS, label.trim()) ? RELATED_TERMS[label.trim()] : [];
    return [...equivalent, ...related.filter(value => !known.has(fold(value)))
      .map(value => ({ value, via: 'related' })).sort((a, b) => b.value.length - a.value.length)];
  }
  const word = value => !!value && /[\p{L}\p{N}_]/u.test(value);
  const pointAt = (value, index) => index < value.length ? String.fromCodePoint(value.codePointAt(index)) : '';
  function pointBefore(value, index) {
    const low = value.charCodeAt(index - 1), high = value.charCodeAt(index - 2);
    return value.slice(low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? index - 2 : Math.max(0, index - 1), index);
  }
  function endBoundary(value, end, term) {
    if (!word(pointBefore(term, term.length)) || !word(pointAt(value, end))) return true;
    // Korean particles also attach to Latin terms (AI가, AI에게). The suffix
    // must finish at a real boundary; arbitrary continuations remain excluded.
    return /^(?:(?:으로|에서|에게|부터|까지|보다|처럼|와|과|은|는|이|가|을|를|의|에|로|도|만)){1,3}(?=$|[^\p{L}\p{N}_])/u.test(value.slice(end));
  }
  function spans(value, term) {
    const haystack = fold(value), needle = fold(term); const result = []; let start = 0;
    while (start <= haystack.length - needle.length) {
      const found = haystack.indexOf(needle, start); if (found < 0) break;
      const end = found + needle.length;
      if ((!word(pointAt(term, 0)) || !word(pointBefore(value, found))) && endBoundary(value, end, term)) result.push({ start: found, end, quote: value.slice(found, end) });
      start = found + Math.max(needle.length, 1);
    }
    return result;
  }
  function manual(profile) {
    if (profile == null || profile.deleted) return [];
    check(plain(profile) && Array.isArray(profile.manual) && profile.manual.length <= LIMITS.manual, 'discovery_profile_invalid');
    const ids = new Set();
    return profile.manual.map(item => {
      check(plain(item) && validId(item.id) && !ids.has(item.id) && text(item.label, 200), 'discovery_profile_invalid'); ids.add(item.id);
      return { id: item.id, label: item.label, terms: terms(item.label) };
    });
  }
  function feedbackUrls(input) {
    const rows = input == null || input.deleted ? [] : Array.isArray(input) ? input : input.feedback;
    check(Array.isArray(rows) && rows.length <= 500, 'discovery_profile_invalid');
    return new Set(rows.map(row => { check(plain(row) && ['not_relevant', 'already_read'].includes(row.kind) && canonicalUrl(row.canonicalUrl), 'discovery_profile_invalid'); return canonicalUrl(row.canonicalUrl); }));
  }
  function reasonsFor(article, interests) {
    const result = [], fields = [['title', article.title, 8], ...article.tags.map((value, tagIndex) => ['tags', value, 6, tagIndex]),
      ...(article.coverage !== 'link_only' ? [['summary', article.summary, 3]] : []), ...(article.coverage === 'full_text' ? [['bodyText', article.bodyText, 1]] : [])];
    for (const interest of interests) {
      const seen = new Set(), titleSpans = [];
      for (const [field, value, weight, tagIndex] of fields) for (const term of interest.terms) {
        if (term.via === 'related' && field !== 'title') continue;
        for (const span of spans(value, term.value)) {
          // Exact/alias terms run first; overlapping related phrases explain a
          // single title occurrence once, preferring the longer related phrase.
          if (term.via === 'related' && titleSpans.some(previous => span.start < previous.end && previous.start < span.end)) continue;
          const key = `${field}:${tagIndex ?? ''}:${span.start}:${span.end}`; if (seen.has(key)) continue; seen.add(key);
          if (field === 'title') titleSpans.push(span);
          result.push({ interestId: interest.id, interestLabel: interest.label, field, ...(tagIndex === undefined ? {} : { tagIndex }), ...span,
            matchedTerm: term.value, via: term.via, weight: term.via === 'related' ? 4 : weight });
        }
      }
    }
    return result;
  }
  // Shared validated full pool. Consumers must preserve these hard exclusions.
  function candidatePool(input, options = {}) {
    const feed = validateFeed(input, options), interests = manual(options.profile), feedback = feedbackUrls(options.feedback);
    const contentLanguages = languageSelection(options.contentLanguages);
    check(options.knownUrls === undefined || Array.isArray(options.knownUrls), 'discovery_profile_invalid');
    const known = new Set((options.knownUrls || []).map(canonicalUrl).filter(Boolean));
    const mode = options.mode || 'related'; check(['related', 'latest'].includes(mode));
    const limit = options.limit === undefined ? 5 : options.limit; check(Number.isInteger(limit) && limit >= 1 && limit <= LIMITS.matches);
    const seen = new Set(), excluded = { known: 0, feedback: 0, duplicate: 0, invalid: (feed.validation?.invalid || []).length }, pool = [];
    if (contentLanguages !== null) excluded.language = 0;
    for (const article of feed.articles) {
      // Apply before URL deduplication and top-K, so a disallowed language row
      // cannot hide an allowed alternative for the same canonical original.
      if (contentLanguages !== null && !contentLanguages.includes(languageKey(article.language))) { excluded.language++; continue; }
      if (seen.has(article.canonicalUrl)) { excluded.duplicate++; continue; } seen.add(article.canonicalUrl);
      if (known.has(article.canonicalUrl)) { excluded.known++; continue; }
      if (feedback.has(article.canonicalUrl)) { excluded.feedback++; continue; }
      const reasons = reasonsFor(article, interests), strength = reasons.reduce((maximum, reason) => Math.max(maximum, reason.weight), 0);
      pool.push({ article, reasons, strength, interests: new Set(reasons.map(reason => reason.interestId)).size });
    }
    const coverage = { linkOnly: 0, summary: 0, fullText: 0 }; for (const article of feed.articles) coverage[{ link_only: 'linkOnly', summary: 'summary', full_text: 'fullText' }[article.coverage]]++;
    return { feed, pool, excluded, coverage, mode, limit, contentLanguages };
  }
  function rankPool(prepared) {
    const { feed, pool, excluded, coverage, mode, limit } = prepared;
    const date = row => row.article.sortDate ? Date.parse(row.article.sortDate) : -Infinity;
    const compareLatest = (a, b) => date(b) - date(a) || a.article.canonicalUrl.localeCompare(b.article.canonicalUrl);
    const candidates = mode === 'related' ? pool.filter(row => row.reasons.length).sort((a, b) => b.strength - a.strength || b.interests - a.interests || compareLatest(a, b)) : [...pool].sort(compareLatest);
    const items = candidates.slice(0, limit).map(({ article, reasons }) => ({ article, reasons: reasons.map(({ weight, ...reason }) => reason) }));
    return { items, eligibleCount: candidates.length, poolCount: pool.length, metadata: { generatedAt: feed.generatedAt,
      stale: feed.stale, sources: feed.sources, coverage, excluded, mode,
      limitation: '명시적으로 일치한 표현을 찾은 결과입니다. 같은 단어라도 문맥은 다를 수 있습니다.' } };
  }
  function rank(input, options = {}) { return rankPool(candidatePool(input, options)); }
  function toImportInput(article) {
    check(plain(article) && text(article.title, 500) && publicUrl(article.url) && (article.author === null || article.author === undefined || text(article.author, 200)));
    let content = '', status = 'link_only';
    if (article.coverage === 'full_text') {
      check(rights(article.rights).mode === 'full_text_allowed' && text(article.bodyText, 200000));
      content = article.bodyText; status = 'full_text';
    } else if (article.coverage === 'summary') {
      check(rights(article.rights).mode !== 'metadata_only' && text(article.summary, 50000));
      content = article.summary; status = 'partial';
    }
    // Keep the supplied text at offset zero. Attribution is an explicit Haedo
    // appendix, so saved/exported copies retain the license without new schema.
    if (content) {
      const line = value => value.replace(/[\r\n]+/g, ' ');
      content += '\n\n[해도 출처 정보]\n' +
        '아래는 해도가 덧붙인 출처 정보이며 원문 본문에 포함되지 않습니다.\n' +
        '제목: ' + line(article.title) + '\n원저자: ' + line(article.author || '미확인') +
        '\n원문 URL: ' + article.url + '\n권리: ' + line(article.rights.label) +
        '\n권리 URL: ' + (article.rights.url || '미제공') +
        '\n보관 범위: ' + (status === 'full_text' ? '제공된 본문 전체' : '공개 요약 · 원문 전체 미확보') +
        '\n변경 사항: 서식을 평문으로 단순화했습니다. 사진·영상은 보관하지 않았습니다.';
    }
    return { origin: 'other', title: article.title, url: article.url, text: content, format: 'text/plain', author: article.author || '',
      authorRelation: article.author ? 'other' : 'unknown', originalCreatedAt: iso(article.publishedAt) || '',
      coverage: { status, omissions: [...(status === 'full_text' ? [] : ['원문 전체 미확보']), '사진·영상 미보관'] } };
  }
  function create(options = {}) {
    check(plain(options)); let epoch = 0, disposed = false, active = null, prior = null, priorFetchedAt = null;
    const base = root.document?.baseURI || root.location?.href || 'https://local.invalid/';
    const fixed = new URL('assets/life/discovery-feed.json', base), url = new URL(options.feedUrl || fixed.href, base);
    check(url.origin === fixed.origin && url.pathname === fixed.pathname && !url.search && !url.hash && !url.username && !url.password);
    const fetcher = options.fetch || root.fetch?.bind(root), clock = options.now || (() => new Date().toISOString());
    function cancel() { epoch++; active?.abort(); active = null; }
    async function load(settings = {}) {
      check(!disposed && typeof fetcher === 'function', 'discovery_unavailable'); cancel();
      const token = epoch, controller = new AbortController(); active = controller;
      const abort = () => controller.abort(); settings.signal?.addEventListener('abort', abort, { once: true }); if (settings.signal?.aborted) abort();
      const guard = () => { if (disposed || token !== epoch || controller.signal.aborted) throw Object.assign(new Error('목록 갱신을 취소했습니다.'), { name: 'AbortError' }); };
      try {
        guard(); const response = await fetcher(url.href, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', mode: 'same-origin', redirect: 'error', signal: controller.signal }); guard();
        check(response.ok, 'discovery_unavailable'); const raw = await response.json(); guard();
        const feed = validateFeed(raw, { allowedSources: options.allowedSources, now: clock }); guard();
        const browserFetchedAt = iso(response.headers?.get?.('X-Haedo-Discovery-Fetched-At')) || iso(clock());
        const stale = response.headers?.get?.('X-Haedo-Discovery-Cache') === 'stale' || feed.stale;
        prior = feed; priorFetchedAt = browserFetchedAt;
        return { status: 'ready', feed: JSON.parse(JSON.stringify(feed)), stale, error: null, browserFetchedAt, lastSuccessAt: browserFetchedAt };
      } catch (cause) {
        guard();
        return { status: prior ? 'ready' : 'error', feed: prior ? JSON.parse(JSON.stringify(prior)) : null, stale: !!prior, error: fail('discovery_unavailable').message,
          browserFetchedAt: priorFetchedAt, lastSuccessAt: priorFetchedAt };
      } finally { settings.signal?.removeEventListener('abort', abort); if (active === controller) active = null; }
    }
    function dispose() { disposed = true; cancel(); prior = null; priorFetchedAt = null; }
    return { load, rank, cancel, dispose };
  }
  return Object.freeze({ ALLOWED_SOURCES, ALIASES, RELATED_TERMS, LIMITS, CONTENT_LANGUAGE_CODES, languageKey, languageAllowed, canonicalUrl, validateFeed, candidatePool, rankPool, rank, toImportInput, create });
});
