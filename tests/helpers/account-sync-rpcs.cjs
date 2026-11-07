/* Background account sync traffic (owner directive 2026-11-01).
 *
 * Everything the owner creates now syncs to their own private account storage
 * automatically. Browser suites that used to assert "no server request at all"
 * must still prove that nothing is PUBLISHED, nothing reaches another account
 * and anonymous readers see nothing private. They exclude exactly this list of
 * owner-scoped private sync calls from their "unexpected request" audits, and
 * keep every other assertion. Keep the list in one place so suites cannot drift
 * into broader exemptions. Publication RPCs (life_blog_publish,
 * life_public_page_put, nine/series/cover public calls) are never listed here.
 */
'use strict';

const reads = new Set([
  'life_blog_sync_list', 'life_blog_read', 'life_blog_list',
  'life_material_list', 'life_material_get', 'life_material_capabilities',
  'life_writing_draft_list', 'life_writing_draft_get',
  'life_composition_get',
  'life_library_meta_get', 'life_library_catalog', 'life_library_capabilities',
  'life_library_originals_list', 'life_library_original_get',
  'life_account_document_changes',
]);
const writes = new Set([
  // Deletions are never exempt: a suite that expects one asserts it explicitly.
  'life_blog_save', 'life_blog_prepare_asset',
  'life_material_put',
  'life_writing_draft_put',
  'life_composition_put',
  'life_library_meta_put', 'life_library_original_put', 'life_library_open',
  'life_sync_put',
  'life_account_document_put',
]);
const publication = /^life_(blog_publish|blog_withdraw|public_page_|nine_public_|blog_series_public|public_cover)/;

function rpcName(url) {
  const match = String(url).match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/);
  return match ? match[1] : null;
}
// Private blog originals are uploaded to the owner's own folder in the private bucket.
function isPrivateOriginalUpload(url) {
  return /\/storage\/v1\/object\/(?:authenticated\/)?haedo-blog-originals\//.test(String(url));
}
function isBackgroundSync(url) {
  const name = rpcName(url);
  if (name) return !publication.test(name) && (reads.has(name) || writes.has(name));
  return isPrivateOriginalUpload(url);
}
function isBackgroundSyncWrite(url) {
  const name = rpcName(url);
  if (name) return !publication.test(name) && writes.has(name);
  return isPrivateOriginalUpload(url);
}

// These no-RSS fixtures permit one initial inbox read, never collection or
// control actions. Keep this request-aware exception separate from URL lists.
function isRssInboxRead(request, { cloud, server, ownerId, workspaceId } = {}) {
  try {
    const url = new URL(request.url());
    if (request.method() !== 'POST' || url.origin !== cloud || url.pathname !== '/functions/v1/haedo-rss' ||
        url.search || url.hash || url.username || url.password) return false;
    const authorization = request.headers().authorization;
    if (typeof authorization !== 'string' || !/^Bearer \S+$/i.test(authorization)) return false;
    const owner = server.libraryOwner(request);
    if (!owner || (ownerId && owner !== ownerId)) return false;
    const raw = request.postData();
    if (typeof raw !== 'string') return false;
    const body = JSON.parse(raw);
    return body !== null && !Array.isArray(body) && typeof body === 'object' &&
      Object.keys(body).sort().join(',') === 'action,workspaceId' && body.action === 'list' &&
      typeof body.workspaceId === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(body.workspaceId) &&
      (!workspaceId || body.workspaceId === workspaceId);
  } catch (_) { return false; }
}

module.exports = { reads, writes, rpcName, isBackgroundSync, isBackgroundSyncWrite, isPrivateOriginalUpload, isRssInboxRead };
