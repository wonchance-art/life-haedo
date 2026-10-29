import { failure } from './collector.mjs';
import { extractHTML, parseInventory, sha256, imageURL } from './extractor.mjs';
import { createNetwork, imageMetadata, readBytes, MEDIA_MAX_BYTES } from './harvest-network.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const need = (ok, code = 'invalid_job') => { if (!ok) throw failure(code); };
const copy = value => structuredClone(value);
const text = result => { try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.bytes); } catch (_) { throw failure('invalid_encoding'); } };
const knownErrors = new Set(['blocked','unavailable','network_error','invalid_encoding','response_too_large','incomplete_response',
  'body_unavailable','missing_title','invalid_extraction','too_many_images','too_many_links','body_too_large','invalid_inventory','incomplete_inventory','invalid_image','blocked_image','deadline']);
const code = error => knownErrors.has(error?.code) ? error.code : 'network_error';
function identity(claim, { owner, subscriptionId, jobId, inventory }) {
  need(claim && UUID.test(claim.owner_id || '') && UUID.test(claim.subscription_id || '') && UUID.test(claim.lease_token || '') &&
    /^[A-Za-z0-9_-]{1,50}$/.test(claim.blog_id || '') && Number.isSafeInteger(claim.revision) && claim.revision > 0 &&
    Number.isFinite(Date.parse(claim.lease_until)) && Date.parse(claim.lease_until) > Date.now() &&
    (!owner || claim.owner_id === owner) && (!subscriptionId || claim.subscription_id === subscriptionId));
  if (inventory) need(Number.isSafeInteger(claim.page) && claim.page > 0 && claim.page_size === 30 &&
    (claim.baseline_method === undefined || claim.baseline_method === null || ['count_exact', 'observed_set'].includes(claim.baseline_method)));
  else need(UUID.test(claim.job_id || '') && (!jobId || claim.job_id === jobId) && /^[1-9][0-9]{0,29}$/.test(claim.log_no || ''));
}
function blankPhoto(index, candidate, error) {
  return { index, url: candidate.url, storagePath: null, sha256: null, mimeType: null, width: null, height: null,
    bytes: null, alt: candidate.alt || '', caption: candidate.caption || '', status: 'failed', error, originalStatus: 'unverified' };
}
export function createHarvestWorker({ rpc, fetcher = fetch, load, model, origin, key, signal, deadline = Date.now() + 80000 } = {}) {
  need(typeof rpc === 'function' && typeof fetcher === 'function' && typeof load === 'function' && model?.verifyPayload && model?.fingerprint);
  const network = createNetwork({ fetcher, signal, deadline });
  async function finishInventory(claim) {
    const args = { p_subscription_id: claim.subscription_id, p_lease_token: claim.lease_token, p_revision: claim.revision,
      p_page: claim.page, p_entries: [], p_total: null, p_next_page: null, p_error: null, p_probe: null };
    let countMismatch = false, requiredProbe = false, probeFailed = false, sourceDiagnostic = null;
    const diagnostic = error => {
      const value = error?.sourceFailure;
      if (value && ['robots','inventory','body','image'].includes(value.stage) &&
        ['http_status','robots_disallowed','response_mismatch'].includes(value.reason) &&
        (value.httpStatus === null || Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599)) return {
        stage: value.stage, reason: value.reason, httpStatus: value.httpStatus,
        retryAfterSeconds: Number.isSafeInteger(value.retryAfterSeconds) && value.retryAfterSeconds >= 0 && value.retryAfterSeconds <= 86400 ? value.retryAfterSeconds : null
      };
      return null;
    };
    const inventoryURL = page => 'https://blog.naver.com/PostTitleListAsync.naver?' + new URLSearchParams({ blogId: claim.blog_id,
      currentPage: String(page), categoryNo: '0', countPerPage: '30' });
    try {
      const page = parseInventory(text(await network.resource(inventoryURL(claim.page), 'html', 2 * 1024 * 1024)), { blogId: claim.blog_id, page: claim.page, preserveCountMismatch: true });
      args.p_entries = page.entries.map(entry => ({ logNo: entry.log_no, title: entry.title, publishedAt: null }));
      countMismatch = page.count_consistent === false;
      // The observed wrapper retains the reported total as evidence and fences
      // the old count-based completion gate when that count is inconsistent.
      args.p_total = page.total; args.p_next_page = page.has_more ? page.page + 1 : null;
      requiredProbe = !page.has_more && (countMismatch || claim.baseline_method === 'observed_set');
      if (requiredProbe) {
        probeFailed = true;
        try {
          // Four bounded HTTP requests (each page's robots + body), then the
          // finish RPC and overhead, must fit the existing 80-second deadline.
          need(network.remaining() > 55000, 'deadline');
          const head = parseInventory(text(await network.resource(inventoryURL(1), 'html', 2 * 1024 * 1024)), { blogId: claim.blog_id, preserveCountMismatch: true });
          need(head.total === page.total, 'incomplete_inventory');
          const tailRaw = text(await network.resource(inventoryURL(page.page + 1), 'html', 2 * 1024 * 1024));
          // Only this explicit clamp check parses a next-page response as the
          // known terminal page. Ordinary beyond-end parsing stays strict.
          const tail = parseInventory(tailRaw, { blogId: claim.blog_id, page: page.page, preserveCountMismatch: true });
          const logNos = value => value.entries.map(entry => entry.log_no);
          need(tail.total === page.total && JSON.stringify(logNos(tail)) === JSON.stringify(logNos(page)), 'incomplete_inventory');
          args.p_probe = { head: { total: head.total, logNos: logNos(head) }, tail: { total: tail.total, logNos: logNos(tail) } };
          probeFailed = false;
        } catch (error) { sourceDiagnostic = diagnostic(error); /* Preserve validated entries; missing proof cannot promote a baseline. */ }
      }
    } catch (error) { args.p_error = code(error); sourceDiagnostic = diagnostic(error); }
    const result = await rpc('life_naver_inventory_finish_observed', args);
    need(result && ['stored','stale'].includes(result.status));
    const observedComplete = result.inventory?.status === 'complete' && result.inventory?.baseline_method === 'observed_set' && result.observed_verified === true;
    return { status: result.status === 'stale' ? 'busy' : 'checked', stage: 'inventory',
      failed: args.p_error !== null || probeFailed || requiredProbe && result.observed_verified !== true || result.inventory?.status === 'partial' || countMismatch && !observedComplete,
      ...(countMismatch ? { countConsistent: false } : {}), ...(sourceDiagnostic ? { sourceFailure: sourceDiagnostic } : {}) };
  }
  async function upload(claim, bytes, metadata) {
    const digest = await sha256(bytes), path = claim.owner_id + '/naver/' + claim.blog_id + '/' + claim.log_no + '/' + digest;
    const url = origin + '/storage/v1/object/haedo-naver-originals/' + path.split('/').map(encodeURIComponent).join('/');
    const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': metadata.mimeType, 'x-upsert': 'false' };
    const result = await fetcher(url, { method: 'POST', redirect: 'error', signal: network.timeout(), headers, body: bytes });
    if (!result.ok) {
      await result.body?.cancel();
      // Storage versions may report duplicates as 400 or 409; an interrupted
      // acknowledgement can also be ambiguous. Never trust an error label:
      // reuse only after reading this exact owner/hash object and proving bytes.
      const previous = await fetcher(origin + '/storage/v1/object/authenticated/haedo-naver-originals/' + path.split('/').map(encodeURIComponent).join('/'), {
        redirect: 'error', signal: network.timeout(), headers: { apikey: key, Authorization: 'Bearer ' + key, 'Accept-Encoding': 'identity' } });
      if (!previous.ok) { await previous.body?.cancel(); throw failure('network_error'); }
      const old = await readBytes(previous, MEDIA_MAX_BYTES);
      need(old.length === bytes.length && await sha256(old) === digest && (previous.headers.get('content-type') || '').split(';')[0] === metadata.mimeType, 'invalid_image');
    } else await result.body?.cancel();
    return { storagePath: path, sha256: digest };
  }
  async function newProgress(claim) {
    const url = 'https://blog.naver.com/PostView.naver?' + new URLSearchParams({ blogId: claim.blog_id, logNo: claim.log_no });
    const html = text(await network.resource(url, 'html', 4 * 1024 * 1024));
    let extracted = await extractHTML(html, { load, blogId: claim.blog_id, logNo: claim.log_no });
    if (extracted.summary_required && network.remaining() > 25000) {
      try {
        const summaryURL = 'https://blog.naver.com/SummaryContentFetch.naver?' + new URLSearchParams({ blogId: claim.blog_id, logNo: claim.log_no });
        const summaryXML = text(await network.resource(summaryURL, 'html', 4 * 1024 * 1024));
        // This endpoint's single CDATA is read without DTD/entity processing.
        need(!/<!DOCTYPE|<!ENTITY/i.test(summaryXML), 'invalid_extraction');
        const blocks = [...summaryXML.matchAll(/<summaryContent>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/summaryContent>/g)];
        need(blocks.length === 1, 'body_unavailable');
        const full = await extractHTML(blocks[0][1], { load, blogId: claim.blog_id, logNo: claim.log_no, summary: true, titleFallback: extracted.title });
        full.published_at = extracted.published_at; extracted = full;
      } catch (_) { extracted.omissions.push('접힌 본문 추가 확인 실패'); }
    }
    const images = extracted.images.slice(0, 20);
    if (extracted.images.length > 20) extracted.omissions.push('사진 20개 상한으로 일부 사진 미보관');
    const payload = { version: 1, blogId: claim.blog_id, logNo: claim.log_no, url: extracted.url, title: extracted.title,
      format: 'text/plain', body: extracted.content_text, bodyHash: extracted.content_hash, htmlHash: extracted.html_hash,
      coverage: extracted.coverage, omissions: extracted.omissions, publishedAt: extracted.published_at, author: '',
      extractedAt: new Date().toISOString(), extractor: extracted.extractor_version, photos: [] };
    return { version: 1, payload, images, nextImage: 0 };
  }
  async function verifiedProgress(claim) {
    if (!claim.progress) return newProgress(claim);
    const progress = copy(claim.progress);
    need(progress.version === 1 && Array.isArray(progress.images) && progress.images.length <= 20 &&
      Number.isSafeInteger(progress.nextImage) && progress.nextImage >= 0 && progress.nextImage <= progress.images.length &&
      progress.payload?.blogId === claim.blog_id && progress.payload?.logNo === claim.log_no && progress.payload?.photos?.length === progress.nextImage);
    progress.payload = await model.verifyPayload(progress.payload, { ownerId: claim.owner_id });
    for (const candidate of progress.images) {
      need(candidate && typeof candidate.alt === 'string' && candidate.alt.length <= 2000 &&
        (candidate.caption === undefined || typeof candidate.caption === 'string' && candidate.caption.length <= 2000)); imageURL(candidate.url);
    }
    for (const photo of progress.payload.photos) {
      need(photo.url === progress.images[photo.index].url);
      if (photo.status === 'stored') need(photo.storagePath === claim.owner_id + '/naver/' + claim.blog_id + '/' + claim.log_no + '/' + photo.sha256);
    }
    return progress;
  }
  async function finishCapture(claim) {
    let progress, finalizing = false;
    try {
      progress = await verifiedProgress(claim);
      let processed = 0;
      while (progress.nextImage < progress.images.length && processed < 2 && network.remaining() > 45000) {
        const index = progress.nextImage, candidate = progress.images[index]; let photo;
        try {
          const resource = await network.resource(candidate.url, 'image', MEDIA_MAX_BYTES);
          const metadata = imageMetadata(resource.bytes, resource.type);
          need(progress.payload.photos.reduce((sum, item) => sum + (item.bytes || 0), 0) + metadata.bytes <= 256 * 1024 * 1024, 'response_too_large');
          const stored = await upload(claim, resource.bytes, metadata);
          photo = { index, url: candidate.url, ...stored, ...metadata, alt: candidate.alt || '', caption: candidate.caption || '', status: 'stored', error: null, originalStatus: 'unverified' };
        } catch (error) {
          // A transport interruption may have uploaded immutable bytes. Keep the
          // same index pending; its next upload verifies any existing object.
          if (['network_error','deadline'].includes(code(error))) break;
          photo = blankPhoto(index, candidate, code(error)); progress.payload.omissions.push('사진 일부 미보관');
        }
        progress.payload.photos.push(photo); progress.nextImage++; processed++;
      }
      progress.payload = await model.verifyPayload(progress.payload, { ownerId: claim.owner_id });
      if (progress.nextImage < progress.images.length) {
        need(new TextEncoder().encode(JSON.stringify(progress)).length <= 2 * 1024 * 1024);
        finalizing = true;
        const result = await rpc('life_naver_capture_checkpoint', { p_job_id: claim.job_id, p_lease_token: claim.lease_token, p_revision: claim.revision, p_progress: progress });
        need(result && ['pending','stale'].includes(result.status));
        return { status: result.status === 'stale' ? 'busy' : 'checked', stage: 'capture', pending: result.status === 'pending' };
      }
      const fingerprint = await model.fingerprint(progress.payload, { ownerId: claim.owner_id });
      finalizing = true;
      const result = await rpc('life_naver_capture_finish', { p_job_id: claim.job_id, p_lease_token: claim.lease_token, p_revision: claim.revision,
        p_payload: progress.payload, p_capture_hash: fingerprint, p_error: null });
      need(result && ['stored','stale'].includes(result.status));
      return { status: result.status === 'stale' ? 'busy' : 'checked', stage: 'capture', pending: false };
    } catch (error) {
      if (finalizing) throw error; // Unknown ACK must never be replaced by an error operation.
      const result = await rpc('life_naver_capture_finish', { p_job_id: claim.job_id, p_lease_token: claim.lease_token, p_revision: claim.revision,
        p_payload: null, p_capture_hash: null, p_error: code(error) });
      need(result && ['stored','stale'].includes(result.status));
      return { status: result.status === 'stale' ? 'busy' : 'checked', stage: 'capture', failed: true };
    }
  }
  async function capture({ owner, subscriptionId, jobId }) {
    const claims = await rpc('life_naver_capture_claim', { p_limit: 1, p_job_id: jobId, p_owner_id: owner, p_subscription_id: subscriptionId });
    need(Array.isArray(claims) && claims.length <= 1);
    if (!claims.length) return null;
    identity(claims[0], { owner, subscriptionId, jobId }); return finishCapture(claims[0]);
  }
  async function inventory({ owner, subscriptionId }) {
      const claims = await rpc('life_naver_inventory_claim', { p_limit: 1, p_subscription_id: subscriptionId, p_owner_id: owner });
      need(Array.isArray(claims) && claims.length <= 1);
      if (!claims.length) return null;
      identity(claims[0], { owner, subscriptionId, inventory: true }); return finishInventory(claims[0]);
  }
  return {
    async execute({ action, owner = null, subscriptionId = null, jobId = null }) {
      const context = { owner, subscriptionId, jobId };
      if (action === 'capture') return await capture(context) || { status: 'busy' };
      if (action === 'inventory') return await inventory(context) || { status: 'busy' };
      // A capture backlog must not indefinitely postpone a due inventory page.
      // Each run gives inventory one bounded opportunity, then claims at most
      // one capture only if the shared deadline still reserves claim (10s),
      // robots (10s), body (10s) and finish/checkpoint (10s) plus overhead.
      // Slow inventory can consume that reserve; it does not promise progress
      // in both lanes on every invocation or start a fresh capture lease then.
      const page = await inventory(context);
      if (network.remaining() <= 45000) return page || { status: 'busy' };
      return await capture(context) || page || { status: 'busy' };
    },
  };
}
