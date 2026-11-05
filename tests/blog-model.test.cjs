"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const Blog = require("../assets/life/blog.js"), Photo = require("../assets/life/photo-post.js");
const crypto = require("node:crypto").webcrypto;
async function fixture() {
  const doc = Photo.create(() => crypto.randomUUID());
  const make = async (name, byte) => {
    const blob = new Blob([Uint8Array.from([137,80,78,71,13,10,26,10,byte,2,3])], { type: "image/png" });
    return { id: crypto.randomUUID(), name, type: blob.type, width: 4032, height: 3024, size: blob.size, digest: await Photo.digest(blob), blob };
  };
  doc.title = "산책과 여행 😀"; doc.status = "saved";
  doc.photos = [await make("개인 파일명.png", 1), await make("공개하지 않을 사진.png", 2)];
  doc.ops = [{ insert: "\ufeff첫 문단\r\n", attributes: { bold: true } },
    { insert: { photo: { id: doc.photos[0].id, caption: "보여줄 풍경", alt: "산책길" } } },
    { insert: "중간 생각\n", attributes: { blockquote: true } },
    { insert: { photo: { id: doc.photos[1].id, caption: "비공개 사진 설명", alt: "비공개 대체 텍스트" } } }, { insert: "끝\n" }];
  doc.attachments = [{ type: "book", title: "여행 중 읽은 책", creator: "익명 작가", url: "https://example.org/book" }];
  return doc;
}
test("private manifests round-trip original v1/v2 documents, paths, metadata and bytes without ID changes", async () => {
  for (const version of [1, 2]) {
    const doc = await fixture();
    if (version === 1) { doc.format = "life-photo-post-v1"; delete doc.attachments; delete doc.archived; }
    const before = structuredClone(doc), manifest = Blog.pack(doc);
    assert.equal(manifest.format, doc.format); assert(!manifest.photos.some((p) => Object.hasOwn(p, "blob")));
    assert.equal(Blog.validateManifest(JSON.parse(JSON.stringify(manifest))).id, doc.id);
    const restored = await Blog.hydrate(JSON.parse(JSON.stringify(manifest)), new Map(doc.photos.map((p) => [p.id, p.blob])));
    assert.deepEqual(restored, before); assert.deepEqual(doc, before);
    for (let i = 0; i < doc.photos.length; i++) assert.deepEqual(await restored.photos[i].blob.arrayBuffer(), await doc.photos[i].blob.arrayBuffer());
    manifest.title = "caller changed only its manifest"; assert.equal(doc.title, before.title);
  }
});
test("hydration refuses extra/missing/duplicate media, wrong types, byte hashes, signatures and leaked Blob fields", async () => {
  const doc = await fixture(), manifest = Blog.pack(doc), originals = doc.photos.map((p) => ({ id: p.id, blob: p.blob }));
  for (const bad of [[], originals.slice(0, 1), [...originals, originals[0]], [...originals, { id: "foreign", blob: originals[0].blob }],
    [{ id: originals[0].id, blob: new Blob([await originals[0].blob.arrayBuffer()], { type: "image/jpeg" }) }, originals[1]]])
    await assert.rejects(Blog.hydrate(manifest, bad), { code: "invalid_blog_photo" });
  const changed = structuredClone(originals), bytes = new Uint8Array(await changed[0].blob.arrayBuffer()); bytes[10]++;
  changed[0].blob = new Blob([bytes], { type: "image/png" });
  await assert.rejects(Blog.hydrate(manifest, changed), { code: "invalid_blog_photo" });
  const fake = structuredClone(doc); fake.photos[0].blob = new Blob([new Uint8Array(fake.photos[0].size)], { type: "image/png" }); fake.photos[0].digest = await Photo.digest(fake.photos[0].blob);
  await assert.rejects(Blog.hydrate(Blog.pack(fake), fake.photos), { code: "invalid_blog_photo" });
  const leaked = Blog.pack(doc); leaked.photos[0].blob = doc.photos[0].blob;
  assert.throws(() => Blog.validateManifest(leaked), { code: "invalid_blog_document" });
});
test("public snapshots default to no photos and contain only selected remapped metadata and explicit author text", async () => {
  const doc = await fixture(), before = structuredClone(doc), noPhotos = Blog.publicSnapshot(doc);
  assert.deepEqual(noPhotos.photos, []); assert.deepEqual(noPhotos.author, { name: "", intro: "" });
  assert(!JSON.stringify(noPhotos).includes("비공개 사진 설명")); assert(!JSON.stringify(noPhotos).includes("개인 파일명"));
  const selected = Blog.publicSnapshot(doc, { photoIds: [doc.photos[0].id], author: { name: "직접 고른 이름", intro: "직접 쓴 소개" } });
  assert.equal(selected.photos.length, 1); assert.notEqual(selected.photos[0].id, doc.photos[0].id);
  assert.equal(selected.ops.find((op) => typeof op.insert !== "string").insert.photo.id, selected.photos[0].id);
  assert.equal(selected.photos[0].digest, doc.photos[0].digest); assert.equal(selected.photos[0].width, 4032);
  assert.deepEqual(selected.attachments, doc.attachments); assert.equal(selected.ops[0].insert, doc.ops[0].insert);
  for (const value of [doc.id, doc.photos[0].id, doc.photos[1].id, "개인 파일명", "비공개 사진 설명", "createdAt", "replaces", "blob"])
    assert(!JSON.stringify(selected).includes(value), value + " remains private");
  selected.ops[0].insert = "caller edit"; assert.deepEqual(doc, before);
  assert.throws(() => Blog.publicSnapshot(doc, { photoIds: ["foreign"] }), { code: "invalid_blog_selection" });
  assert.throws(() => Blog.publicSnapshot(doc, { photoIds: [doc.photos[0].id, doc.photos[0].id] }), { code: "invalid_blog_selection" });
});
test("public validators reject private IDs/fields, unknown formats and unsafe rich content while supporting text-only new posts", async () => {
  const doc = Photo.create(() => crypto.randomUUID()); doc.status = "saved"; doc.ops = [{ insert: "사진 없는 새 글\n" }];
  const valid = Blog.publicSnapshot(doc); assert.equal(Blog.validateSnapshot(valid), valid);
  for (const mutate of [
    (x) => x.workspaceId = crypto.randomUUID(), (x) => x.author.email = "private@example.invalid",
    (x) => x.ops.unshift({ insert: { image: "https://example.org/unselected.png" } }),
    (x) => x.ops[0].attributes = { link: "javascript:alert(1)" },
    (x) => x.ops[0].attributes = { html: "<script>bad()</script>" }, (x) => x.format = "future-format",
    (x) => x.attachments.push({ type: "book", title: "x", creator: "", url: "", note: "private" }),
  ]) { const bad = structuredClone(valid); mutate(bad); assert.throws(() => Blog.validateSnapshot(bad), { code: "invalid_blog_snapshot" }); }
  const photo = await fixture(), snapshot = Blog.publicSnapshot(photo, { photoIds: [photo.photos[0].id] });
  const unreferenced = structuredClone(snapshot); unreferenced.ops = [{ insert: "other\n" }];
  assert.throws(() => Blog.validateSnapshot(unreferenced), { code: "invalid_blog_snapshot" });
  snapshot.photos[0].name = "private.png"; assert.throws(() => Blog.validateSnapshot(snapshot), { code: "invalid_blog_snapshot" });
  doc.status = "draft"; assert.throws(() => Blog.publicSnapshot(doc), { code: "blog_post_not_saved" });
  doc.status = "saved"; doc.archived = true; assert.throws(() => Blog.publicSnapshot(doc), { code: "blog_post_not_saved" });
});
