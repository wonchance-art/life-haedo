/* Body-root selection adapted from sansoohan/naver-blog-to-markdown v1.5.1
 * commit 0bc8cc10200879c52f99585b429bb0fcec4fe5bc src/post-parser.js and
 * src/make-html.js. Copyright (c) 2026 Sansoo Han (한산수), MIT.
 * See THIRD_PARTY_NOTICES.txt. Networking, login, files and backup not imported.
 * load is an injected HTML parser; extraction itself never requests resources. */
import { failure, postIdentity } from './collector.mjs';
export const EXTRACTOR_VERSION = 'sansoohan-1.5.1-haedo-1';
export const EXTRACT_LIMITS = Object.freeze({ html: 4 * 1024 * 1024, text: 200000,
  title: 400, images: 100, links: 200, list: 30 });
const need = (value, code = 'invalid_extraction') => { if (!value) throw failure(code); };
const clean = value => String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, '').replace(/\u200b/g, '').trim();
const LOG = /^[1-9][0-9]{0,29}$/;
const utf8 = value => new TextEncoder().encode(value).length;
export async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}
function legacyRoot($) {
  const content = $('#postViewArea,.se3_view,.post-view,.post-view > .view,.view').first();
  if (content.length) { const post = content.closest('.post._post_wrap,.post').first(); return post.length ? post : content; }
  return $('.post._post_wrap,.post').first();
}
// Upstream selector order is retained, with explicit failure rather than OG
// description/full-page fallback. Our plain-text pass removes header chrome.
export function getPostRoot($, editorVersion) {
  if (editorVersion === 1 || editorVersion === 2) { const legacy = legacyRoot($); if (legacy.length) return legacy; }
  const smart = $('.se-viewer .se-main-container').first(); if (smart.length) return smart;
  const main = $('.se-main-container').first(); if (main.length) return main;
  if (editorVersion === 3) {
    const start = $('.se_doc_contents_start').first();
    if (start.length) { const area = start.nextAll('.__se_component_area').first(); if (area.length) return area; }
  }
  const legacy = legacyRoot($); if (legacy.length) return legacy;
  throw failure('body_unavailable');
}
function editorVersion($, html) {
  const explicit = $('[data-post-editor-version]').first().attr('data-post-editor-version');
  if (/^[1-4]$/.test(explicit || '')) return Number(explicit);
  const social = $('#socialPluginInfoJson').text().match(/\bsmartEditorVersion["']?\s*:\s*["']?(\d+)/i) || html.match(/\bsmartEditorVersion(?:&(?:quot|#034);|["'])?\s*:\s*["']?(\d+)/i);
  if (social && /^[1-4]$/.test(social[1])) return Number(social[1]);
  if ($('#postViewArea .post-view > .view').length) return 1;
  if ($('#postViewArea,.post-view,.se3_view,.view').length) return 2;
  if ($('.wrap_rabbit .se-viewer .se-main-container').length) return 4;
  if ($('.se-viewer .se-main-container,.se_doc_contents_start').length) return 3;
  return 0;
}
export function imageURL(raw) {
  need(typeof raw === 'string' && raw.length > 0 && raw.length <= 4096 && !/[\s\\\u0000-\u001f\u007f]/.test(raw), 'blocked_image');
  const url = new URL(raw);
  // Exact reviewed CDN names. Never an arbitrary *.pstatic.net or a supplied
  // proxy; query spelling is retained and no high-resolution claim is made.
  need(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
    ['blogfiles.pstatic.net', 'postfiles.pstatic.net', 'mblogthumb-phinf.pstatic.net', 'blogthumb.pstatic.net', 'post-phinf.pstatic.net'].includes(url.hostname), 'blocked_image');
  need(/^https:\/\/[^/?#]+\//.test(raw) && !/%(?:2f|5c|00)/i.test(url.pathname), 'blocked_image');
  return url.href;
}
export function parseInventory(raw, { blogId, page = 1, pageSize = 30, preserveCountMismatch = false } = {}) {
  need(typeof raw === 'string' && utf8(raw) <= 2 * 1024 * 1024, 'invalid_inventory');
  raw = raw.replace(/^\uFEFF/, '');
  need(Number.isSafeInteger(page) && page > 0 && Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= EXTRACT_LIMITS.list && typeof preserveCountMismatch === 'boolean', 'invalid_inventory');
  let value;
  try { value = JSON.parse(raw); }
  catch (_) {
    // Known endpoint quirk: only its final pagingHtml field is discarded.
    // No eval, partial regex extraction, or partial-list success fallback.
    const at = raw.indexOf(',"pagingHtml"'); need(at > 0 && raw.trimEnd().endsWith('}'), 'invalid_inventory');
    try { value = JSON.parse(raw.slice(0, at) + '}'); } catch (_) { throw failure('invalid_inventory'); }
  }
  const total = Number(value.totalCount), per = Number(value.countPerPage ?? pageSize);
  need(value && typeof value === 'object' && Array.isArray(value.postList) && value.postList.length <= pageSize &&
    Number.isSafeInteger(total) && total >= 0 && total <= 300000 && per === pageSize && page <= 10000, 'invalid_inventory');
  const seen = new Set();
  const entries = value.postList.map(item => {
    need(item && typeof item.logNo === 'string' && LOG.test(item.logNo) && !seen.has(item.logNo) && typeof item.title === 'string', 'invalid_inventory'); seen.add(item.logNo);
    let title; try { title = clean(decodeURIComponent(item.title.replace(/\+/g, ' '))); } catch (_) { throw failure('invalid_inventory'); }
    need(title && title.length <= EXTRACT_LIMITS.title, 'invalid_inventory');
    const identity = postIdentity('https://blog.naver.com/' + blogId + '/' + item.logNo, blogId);
    return { log_no: identity.logNo, title, url: identity.url };
  });
  const expected = Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize));
  const countConsistent = entries.length === expected;
  // A stale reported total must not discard valid extra terminal rows. This
  // opt-in preserves every validated entry while explicitly distrusting the
  // count; short pages, zero totals and clamped pages beyond the end still fail.
  need(countConsistent || preserveCountMismatch && expected > 0 && page === Math.ceil(total / pageSize) && entries.length > expected, 'incomplete_inventory');
  return { page, page_size: pageSize, total, entries, has_more: page * pageSize < total,
    ...(countConsistent ? {} : { count_consistent: false }) };
}
export async function extractHTML(html, { load, blogId, logNo, summary = false, titleFallback = '' } = {}) {
  need(typeof load === 'function' && typeof html === 'string' && utf8(html) <= EXTRACT_LIMITS.html);
  const identity = postIdentity('https://blog.naver.com/' + blogId + '/' + logNo, blogId);
  const $ = load(html), version = editorVersion($, html);
  const canonical = $('link[rel="canonical"]').first().attr('href');
  if (canonical) { const same = postIdentity(canonical, blogId); need(same.logNo === logNo); }
  const root = summary ? $('body').first() : getPostRoot($, version);
  const body = root.clone();
  body.find('script,style,noscript,iframe,object,embed,svg,math,template,.se-documentTitle,.htitle,.blog2_series,.se_publishDate,.nick,.blog_date').remove();
  const title = clean($('.se-title-text,.se_title,.tit_h3,.pcol1 .htitle,.htitle').first().text() || (summary ? titleFallback : ''));
  need(title && title.length <= EXTRACT_LIMITS.title, 'missing_title');
  const unsupported = new Set();
  const supported = new Set(['se-text', 'se-sectionTitle', 'se-quotation', 'se-image', 'se-imageGroup', 'se-imageStrip', 'se-horizontalLine', 'se-code', 'se-oglink', 'se-table']);
  body.find('.se-component').each((_, node) => {
    const type = ($(node).attr('class') || '').split(/\s+/).find(v => v.startsWith('se-') && v !== 'se-component' && !v.startsWith('se-l-'));
    if (type && !supported.has(type)) unsupported.add(type);
  });
  const omissions = new Set(['사진 원본 여부 미확인', '영상·댓글·첨부파일 미보관']);
  if (unsupported.size) omissions.add('지원하지 않는 본문 요소 있음');
  const images = [], seenImages = new Set();
  body.find('img').each((_, node) => {
    const element = $(node), raw = element.attr('data-lazy-src') || element.attr('src') || element.attr('data-src');
    if (!raw) { omissions.add('사진 주소 미확인'); return; }
    try {
      const url = imageURL(raw);
      if (!seenImages.has(url)) { seenImages.add(url); images.push({ url, alt: clean(element.attr('alt')).slice(0, 1000),
        caption: clean(element.closest('.se-image,.se-imageGroup,.se-imageStrip').find('.se-caption').first().text()).slice(0, 2000) }); }
    } catch (_) { omissions.add('허용하지 않는 사진 주소 미보관'); }
  });
  need(images.length <= EXTRACT_LIMITS.images, 'too_many_images');
  const links = [], seenLinks = new Set();
  body.find('a[href]').each((_, node) => {
    try {
      const url = new URL($(node).attr('href'));
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port) {
        if (!seenLinks.has(url.href)) { seenLinks.add(url.href); links.push(url.href); }
        if (clean($(node).text()) !== url.href) $(node).append(' (' + url.href + ')');
      }
    } catch (_) { /* no external request */ }
  });
  need(links.length <= EXTRACT_LIMITS.links, 'too_many_links');
  // Preserve paragraph order, line breaks and repeated text. No deduplication
  // by content: repeated passages may be intentional.
  body.find('br').replaceWith('\n');
  body.find('p,div,li,blockquote,tr,h1,h2,h3,h4,h5,h6').each((_, node) => { $(node).append('\n'); });
  const text = clean(body.text().replace(/\r\n?/g, '\n')).replace(/[\t ]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n');
  need(text.length <= EXTRACT_LIMITS.text, 'body_too_large');
  const summaryRequired = !summary && /_getSummaryContent/.test(html);
  if (summaryRequired) omissions.add('접힌 본문 추가 확인 필요');
  const date = $('meta[property="article:published_time"]').attr('content');
  const published = date && /^\d{4}-\d\d-\d\dT/.test(date) && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null;
  return { url: identity.url, title, content_text: text || null, content_hash: text ? await sha256(text) : null,
    published_at: published, editor_version: version, extractor_version: EXTRACTOR_VERSION,
    html_hash: await sha256(html), coverage: text ? 'partial' : 'link_only',
    summary_required: summaryRequired, unsupported: [...unsupported], omissions: [...omissions], images, links };
}
