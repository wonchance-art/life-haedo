/* Local, read-only metadata. A title or a cached contentHash never proves identity. */
(function (root, factory) {
  const api = factory(root.crypto || (typeof require === 'function' && require('node:crypto').webcrypto));
  root.HaedoLife ||= {};
  root.HaedoLife.SourceClassification = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (crypto) {
  'use strict';
  const FORMAT = 'life-source-classification-v1';
  const MAX_BYTES = 32 * 1024 * 1024, MAX_RECORDS = 10000;
  const encoder = new TextEncoder();
  const controls = /[\u0000-\u001f\u007f-\u009f]/;
  const fail = (large = false) => {
    throw Object.assign(new Error(large ? '분류 파일은 32MiB와 자료 10,000개 이내로 선택해 주세요.' :
      '분류 파일의 형식이나 원문 식별 정보를 확인해 주세요.'), {
      code: large ? 'source_classification_too_large' : 'source_classification_invalid',
    });
  };
  const check = (value) => { if (!value) fail(); };
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
  // Inspect descriptors before serializing: getters, custom prototypes, cycles,
  // sparse arrays and non-JSON values must never execute or disappear silently.
  function jsonTree(value) {
    const ancestors = new WeakSet();
    let nodes = 0;
    function visit(item, depth) {
      if (++nodes > 1000000 || depth > 64) fail(true);
      if (item === null || typeof item === 'boolean' || typeof item === 'string') return;
      if (typeof item === 'number') { check(Number.isFinite(item)); return; }
      check(typeof item === 'object');
      const array = Array.isArray(item);
      check(array ? Object.getPrototypeOf(item) === Array.prototype : plain(item));
      check(!ancestors.has(item) && !Object.getOwnPropertySymbols(item).length);
      if (array && item.length > 100000) fail(true);
      const descriptors = Object.getOwnPropertyDescriptors(item);
      if (array) check(Object.keys(descriptors).length === item.length + 1);
      ancestors.add(item);
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (array && key === 'length') continue;
        check(Object.hasOwn(descriptor, 'value') && descriptor.enumerable &&
          !['__proto__', 'prototype', 'constructor'].includes(key));
        if (key === 'label') string(descriptor.value, 160, true);
        if (array) check(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < item.length);
        visit(descriptor.value, depth + 1);
      }
      ancestors.delete(item);
    }
    visit(value, 0);
  }
  function sized(value) {
    if (value.length > MAX_BYTES || encoder.encode(value).byteLength > MAX_BYTES) fail(true);
  }
  function string(value, maximum, empty = false) {
    check(typeof value === 'string' && value.length <= maximum && (empty || value.length > 0) && !controls.test(value));
    // Preserve Unicode spelling, including decomposed filenames. Reject only
    // malformed surrogate sequences which cannot identify original UTF-8 bytes.
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = value.charCodeAt(++i);
        check(next >= 0xdc00 && next <= 0xdfff);
      } else check(c < 0xdc00 || c > 0xdfff);
    }
    return value;
  }
  function identifier(value) {
    string(value, 80);
    check(/^[A-Za-z0-9][A-Za-z0-9_/-]*$/.test(value));
    return value;
  }
  function path(value) {
    string(value, 2000);
    check(!/^(?:\/|[A-Za-z]:)/.test(value) && !value.includes('\\') &&
      value.split('/').every(part => part && part !== '.' && part !== '..'));
    return value;
  }
  function descriptor(value) {
    check(plain(value));
    return { id: identifier(value.id), label: string(value.label, 160) };
  }
  function input(value) {
    if (typeof value === 'string') {
      sized(value);
      try { value = JSON.parse(value.replace(/^\ufeff/, '')); } catch (_) { fail(); }
    }
    jsonTree(value);
    sized(JSON.stringify(value));
    check(plain(value));
    return value;
  }
  function normalize(value, normalizedOnly) {
    const data = input(value), normalized = data.format === FORMAT;
    check(normalized || !normalizedOnly && data.schemaVersion === 1);
    check(typeof data.sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(data.sourceCommit));
    check(Array.isArray(data.taxonomy) && data.taxonomy.length > 0 && data.taxonomy.length <= 200);
    const taxonomy = data.taxonomy.map(descriptor), topicIDs = new Set(taxonomy.map(t => t.id));
    check(topicIDs.size === taxonomy.length && !topicIDs.has('unclassified') && !topicIDs.has('not_applicable'));
    check(Array.isArray(data.records));
    if (data.records.length > MAX_RECORDS) fail(true);
    const paths = new Set();
    const records = data.records.map(row => {
      check(plain(row));
      const originalPath = path(row.path);
      check(!paths.has(originalPath)); paths.add(originalPath);
      check(typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256) && typeof row.isContent === 'boolean');
      const source = descriptor(row.source), kind = descriptor(row.kind);
      const topics = normalized ? row.topicIds : row.topics;
      check(Array.isArray(topics) && topics.length <= taxonomy.length);
      const topicIds = topics.map(topic => identifier(normalized ? topic : plain(topic) ? topic.id : topic));
      check(new Set(topicIds).size === topicIds.length && topicIds.every(id => topicIDs.has(id)));
      const primaryTopic = identifier(row.primaryTopic);
      check(topicIDs.has(primaryTopic) ? topicIds.includes(primaryTopic) : ['unclassified', 'not_applicable'].includes(primaryTopic));
      check(Array.isArray(row.reviewReasons) && row.reviewReasons.length <= 100);
      const reviewReasons = row.reviewReasons.map(reason => string(reason, 500));
      return { path: originalPath, sha256: row.sha256, isContent: row.isContent,
        source, kind, topicIds, primaryTopic, reviewReasons };
    });
    return { format: FORMAT, sourceCommit: data.sourceCommit, taxonomy, records };
  }
  const parse = (value) => normalize(value, false);
  const validate = (value) => normalize(value, true);
  function identity(source, commit) {
    if (source.origin !== 'obsidian' || typeof source.sourceKey !== 'string' || typeof source.url !== 'string' ||
      source.url.length > 8192 || controls.test(source.url)) return null;
    try {
      path(source.sourceKey);
      const url = new URL(source.url);
      if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash) return null;
      const parts = source.url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/([a-f0-9]{40})\/(.+)$/);
      if (!parts || parts[3] !== commit || [parts[1], parts[2]].some(part => part === '.' || part === '..')) return null;
      if (url.pathname !== '/' + parts[1] + '/' + parts[2] + '/blob/' + commit + '/' + parts[4]) return null;
      const decoded = parts[4].split('/').map(part => {
        const value = decodeURIComponent(part);
        if (value.includes('/') || value.includes('\\')) throw new Error();
        return value;
      }).join('/');
      if (path(decoded) !== source.sourceKey) return null;
      return { path: source.sourceKey, repository: (parts[1] + '/' + parts[2]).toLowerCase() };
    } catch (_) { return null; }
  }
  async function hash(text) {
    check(crypto?.subtle);
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))),
      byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function project(bundle, manifest) {
    const data = validate(manifest);
    check(plain(bundle) && Array.isArray(bundle.sources) && Array.isArray(bundle.sourceVersions));
    check(bundle.sources.length <= MAX_RECORDS && bundle.sourceVersions.length <= 50000);
    const candidates = new Map(data.records.map(row => [row.path, { row, repositories: new Set(), versions: [] }]));
    const sourceIDs = new Set(), versionIDs = new Set(), sources = new Map();
    for (const source of bundle.sources) {
      check(plain(source)); string(source.id, 200);
      check(!sourceIDs.has(source.id)); sourceIDs.add(source.id);
      const found = identity(source, data.sourceCommit), candidate = found && candidates.get(found.path);
      if (candidate) { candidate.repositories.add(found.repository); sources.set(source.id, candidate); }
    }
    for (const version of bundle.sourceVersions) {
      check(plain(version)); string(version.id, 200); string(version.sourceId, 200);
      check(!versionIDs.has(version.id)); versionIDs.add(version.id);
      const candidate = sources.get(version.sourceId);
      if (candidate) {
        check(version.contentText === null || typeof version.contentText === 'string');
        candidate.versions.push(version);
      }
    }
    const byVersion = new Map(), staleVersionIds = new Set(), hashes = new Map(), jobs = [];
    let matched = 0, unmatched = 0, stale = 0, ambiguous = 0;
    for (const candidate of candidates.values()) {
      if (!candidate.repositories.size) { unmatched++; continue; }
      if (candidate.repositories.size > 1) { ambiguous++; continue; }
      jobs.push(candidate);
    }
    let next = 0;
    async function worker() {
      while (next < jobs.length) {
        const candidate = jobs[next++]; let count = 0;
        for (const version of candidate.versions) {
          // null means unavailable, including an empty-file import represented
          // as link_only. It cannot prove the original bytes, so leave it unbound.
          if (version.contentText === null) { staleVersionIds.add(version.id); continue; }
          if (!hashes.has(version.contentText)) hashes.set(version.contentText, hash(version.contentText));
          if (await hashes.get(version.contentText) !== candidate.row.sha256) {
            staleVersionIds.add(version.id); continue;
          }
          byVersion.set(version.id, candidate.row); count++;
        }
        if (count) matched++; else stale++;
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, worker));
    return { byVersion, matched, unmatched, stale, ambiguous, staleVersionIds };
  }
  return Object.freeze({ FORMAT, MAX_BYTES, MAX_RECORDS, parse, validate, project });
});
