// Import the browser's actual maintained codec and validators. These static
// dependencies are bundled by `supabase functions deploy --use-api`; do not
// copy them into the function or load source files at request time.
import '../../../vendor/markdown-it/markdown-it.umd.min.js';
import '../../../assets/life/post-markdown.js';
import '../../../assets/life/collection.js';
import '../../../assets/life/share.js';
import '../../../assets/life/page-posts.js';
import '../../../assets/life/photo-post.js';
import '../../../assets/life/blog.js';

const Blog = globalThis.HaedoLife.Blog;
const invalid = () => Object.assign(new Error('Invalid Markdown publication input'), { code: 'invalid_blog_document' });

// The handler supplies the owner-scoped stored manifest, never a client body.
// Return private photo IDs only to the trusted commit RPC, which assigns fresh
// public IDs and reconstructs all other fields from its locked stored source.
// `attachments` (2026-11-16): the chosen attachment positions, or undefined for a request
// without a choice. Attachments never enter the ops; the choice is validated here against the
// stored list, and the commit RPC copies exactly those attachments.
export function projectMarkdownOps(manifest, { photoIds = [], author = { name: '', intro: '' }, copies = [], attachments } = {}) {
  if (manifest?.format !== 'life-post-md-v1') throw invalid();
  if (!Array.isArray(copies) || new Set(copies.map(copy => copy?.id)).size !== copies.length) throw invalid();
  const snapshot = Blog.publicSnapshotFromManifest(manifest, { photoIds, author, copies, ...(attachments === undefined ? {} : { attachments }) });
  const selected = new Set(photoIds), selectedPhotos = manifest.photos.filter(photo => selected.has(photo.id));
  const originalIds = new Map(snapshot.photos.map((photo, index) => [photo.id, selectedPhotos[index].id]));
  return snapshot.ops.map(op => typeof op.insert === 'string' ? op : {
    ...op, insert: { photo: { ...op.insert.photo, id: originalIds.get(op.insert.photo.id) } },
  });
}
