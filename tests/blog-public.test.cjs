"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const Public = require("../assets/life/blog-public.js"), Blog = require("../assets/life/blog.js"), Photo = require("../assets/life/photo-post.js");
const { randomUUID } = require("node:crypto");
const config = { url: "https://anonymous.supabase.co", key: "sb_publishable_anonymousfixture" };
const postToken = randomUUID(), blogToken = randomUUID(), time = "2026-10-17T00:00:00.000Z";
function fixture() {
  const doc = Photo.create(randomUUID); doc.status = "saved"; doc.title = "공개한 익명 글"; doc.ops = [{ insert: "본문과 <script>도 평문입니다.\n" }];
  return { token: postToken, blogToken, revision: 1, createdAt: time, updatedAt: time, snapshot: Blog.publicSnapshot(doc) };
}
function listing() {
  return { blogToken, author: { name: "익명 작성자", intro: "선택한 소개" }, posts: [{ token: postToken, revision: 1, title: "공개한 글", createdAt: time, updatedAt: time, excerpt: "공개된 본문 일부", cover: null }], nextCursor: null };
}
test("anonymous read/list use only public RPCs with no cookies, session, authorization, cache or referrer", async () => {
  const calls = [], values = [fixture(), listing()];
  const reader = Public.createReader({ config, fetch: async (url, options) => { calls.push({ url, options }); return Response.json(values.shift()); } });
  assert.equal((await reader.read(postToken)).snapshot.title, "공개한 익명 글");
  assert.equal((await reader.list(blogToken)).posts.length, 1);
  assert.deepEqual(calls.map((c) => c.url), [config.url + "/rest/v1/rpc/life_blog_public_read", config.url + "/rest/v1/rpc/life_blog_public_list"]);
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_token: postToken });
  assert.deepEqual(JSON.parse(calls[1].options.body), { p_blog_token: blogToken, p_limit: 40, p_before: null });
  for (const { options } of calls) {
    assert.equal(options.credentials, "omit"); assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error"); assert.equal(options.referrerPolicy, "no-referrer");
    assert.deepEqual(Object.keys(options.headers).sort(), ["Cache-Control", "Content-Type", "apikey"]);
    assert.equal(options.headers.apikey, config.key);
  }
  const image = new URL(reader.photoURL(postToken, randomUUID()));
  assert.equal(image.pathname, "/functions/v1/haedo-blog-media"); assert.equal(image.searchParams.get("token"), postToken);
  assert.deepEqual([...image.searchParams.keys()], ["token", "photo"]); assert(!image.href.includes(config.key));
  reader.dispose();
});
test("public response validation rejects private fields, wrong tokens, unsafe ops, unreferenced photos and broken list cursors", async () => {
  for (const mutate of [
    (x) => x.ownerId = randomUUID(), (x) => x.token = randomUUID(), (x) => x.revision = 0,
    (x) => x.snapshot.workspaceId = randomUUID(), (x) => x.snapshot.author.email = "hidden@example.invalid",
    (x) => x.snapshot.ops[0].attributes = { link: "javascript:alert(1)" }, (x) => x.createdAt = "not a date",
  ]) {
    const value = fixture(); mutate(value); const reader = Public.createReader({ config, fetch: async () => Response.json(value) });
    await assert.rejects(reader.read(postToken), { code: "invalid_remote_data" }); reader.dispose();
  }
  for (const mutate of [
    (x) => x.blogToken = randomUUID(), (x) => x.author.email = "hidden@example.invalid", (x) => x.posts.push(structuredClone(x.posts[0])),
    (x) => x.posts[0].privatePostId = randomUUID(), (x) => x.posts[0].cover = { id: randomUUID(), type: "image/svg+xml", width: 1, height: 1 },
    (x) => x.nextCursor = { updatedAt: time, token: randomUUID() },
  ]) {
    const value = listing(); mutate(value); const reader = Public.createReader({ config, fetch: async () => Response.json(value) });
    await assert.rejects(reader.list(blogToken), { code: "invalid_remote_data" }); reader.dispose();
  }
});
test("a missing public post and empty author blog are distinct valid outcomes; tied timestamps retain token cursors", async () => {
  let value = null; const calls = [], reader = Public.createReader({ config, fetch: async (_url, options) => { calls.push(JSON.parse(options.body)); return Response.json(value); } });
  assert.equal(await reader.read(postToken), null);
  value = { blogToken, author: { name: "", intro: "" }, posts: [], nextCursor: null };
  assert.deepEqual(await reader.list(blogToken), value);
  value = listing(); value.nextCursor = { updatedAt: time, token: postToken };
  assert.equal((await reader.list(blogToken)).nextCursor.token, postToken);
  value = listing(); value.posts[0].token = randomUUID();
  await reader.list(blogToken, { before: { updatedAt: time, token: postToken } });
  assert.deepEqual(calls.at(-1).p_before, { updatedAt: time, token: postToken }); reader.dispose();
});
test("invalid addresses and secret keys reject before any request and disposed readers suppress late results", async () => {
  let calls = 0;
  const reader = Public.createReader({ config, fetch: async () => { calls++; return Response.json(fixture()); } });
  await assert.rejects(reader.read("private/name"), { code: "invalid_request" });
  await assert.rejects(reader.list(blogToken, { limit: 1000 }), { code: "invalid_request" });
  assert.throws(() => reader.photoURL(postToken, "../file"), { code: "invalid_request" }); assert.equal(calls, 0);
  for (const bad of [{ ...config, key: "sb_secret_forbidden" }, { ...config, url: "http://anonymous.supabase.co" },
    { ...config, key: "a." + Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url") + ".b" }])
    assert.throws(() => Public.createReader({ config: bad }), { code: "invalid_config" });
  let release, signal;
  const waiting = Public.createReader({ config, fetch: (_url, options) => { signal = options.signal; return new Promise((resolve) => { release = resolve; }); } });
  const pending = waiting.read(postToken); waiting.dispose(); assert.equal(signal.aborted, true); release(Response.json(fixture()));
  await assert.rejects(pending, { code: "request_cancelled" }); reader.dispose();
});
test("bounded streaming cancels oversized bodies and malformed JSON never reaches the public renderer", async () => {
  let cancelled = false, chunks = 0;
  const reader = Public.createReader({ config, fetch: async () => new Response(new ReadableStream({
    pull(controller) { chunks++; controller.enqueue(new Uint8Array(64 * 1024).fill(32)); }, cancel() { cancelled = true; },
  })) });
  await assert.rejects(reader.read(postToken), { code: "invalid_remote_data" }); assert.equal(cancelled, true); assert(chunks < 40); reader.dispose();
  const malformed = Public.createReader({ config, fetch: async () => new Response("not json") });
  await assert.rejects(malformed.read(postToken), { code: "invalid_remote_data" }); malformed.dispose();
});
