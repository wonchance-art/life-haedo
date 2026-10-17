/* Disposable PostgreSQL + real Edge-handler checks. No account/project config,
 * credentials, host ports, or remote database connection is accepted. */
import { execFile, execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
const run = promisify(execFile), root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const image = "postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3";
const container = `haedo-blog-postgres-${Date.now()}${process.pid}`;
const migration = "supabase/migrations/20261017143539_life_blog_originals.sql";
let owns = false;
const keep = process.argv.slice(2).includes("--keep");
if (process.argv.slice(2).some((arg) => arg !== "--keep")) throw new Error("Only --keep is supported");
const dockerEnv = { ...process.env };
for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete dockerEnv[key];
const localDocker = ["--host=unix:///var/run/docker.sock"];
function docker(args, input) {
 return execFileSync("docker", [...localDocker, ...args], { input, env: dockerEnv, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
}
function sql(input) { return docker(["exec", "-i", container, "psql", "-U", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], input); }
async function fixture(file) { return sql(await readFile(resolve(root, file), "utf8")); }
const parsed = (text) => JSON.parse(text.trim() || "null");
const claim = (owner) => `set local role authenticated; select set_config('request.jwt.claims','${JSON.stringify({ sub: owner, role: "authenticated" })}',true);`;
const literal = (value) => "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
async function concurrent(input) {
 const child = execFile("docker", [...localDocker, "exec", "-i", container, "psql", "-U", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], { env: dockerEnv, maxBuffer: 1024 * 1024 });
 let stdout = "", stderr = "";
 child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
 const result = new Promise((yes, no) => child.on("error", no).on("exit", (status) => status ? no(new Error("isolated SQL concurrency check failed: " + stderr)) : yes(stdout)));
 child.stdin.end(input); return result;
}
async function concurrency() {
 const owner = randomUUID(), post = randomUUID(), workspace = randomUUID();
 const data = { format: "life-photo-post-v2", id: post, revision: 1, title: "Anonymous concurrency fixture", status: "saved", replaces: null,
  createdAt: "2026-10-17T00:00:00.000Z", updatedAt: "2026-10-17T00:00:00.000Z", ops: [{ insert: "Preserve this original\n" }], photos: [], attachments: [], archived: false };
 const save = () => `begin; ${claim(owner)} select public.life_blog_save('${workspace}','${post}',0,'${randomUUID()}',${literal(data)}); commit;`;
 const results = (await Promise.all([concurrent(save()), concurrent(save())])).map((out) => out.trim().split("\n").map((line) => { try { return JSON.parse(line); } catch (_) { return null; } }).find((r) => r?.status));
 assert.deepEqual(results.map((r) => r.status).sort(), ["conflict", "stored"]);
 const publish = (intro) => `begin; ${claim(owner)} select public.life_blog_publish('${post}',1,'${randomUUID()}','{}',${literal({ name: "Anonymous", intro })},0); commit;`;
 const published = (await Promise.all([concurrent(publish("First selection")), concurrent(publish("Second selection"))])).map((out) => out.trim().split("\n").map((line) => { try { return JSON.parse(line); } catch (_) { return null; } }).find((r) => r?.status));
 assert.deepEqual(published.map((r) => r.status).sort(), ["conflict", "stored"]);
 const current = published.find((r) => r.status === "stored");
 const receipt = randomUUID();
 const withdraw = `begin; ${claim(owner)} select public.life_blog_unpublish('${post}',1,'${receipt}'); commit;`;
 const withdrawn = (await Promise.all([concurrent(withdraw), concurrent(withdraw)])).map((out) => out.trim().split("\n").map((line) => { try { return JSON.parse(line); } catch (_) { return null; } }).find((r) => r?.status));
 assert.deepEqual(withdrawn, [{ status: "stored", revision: 2 }, { status: "stored", revision: 2 }]);
 assert.equal(parsed(sql(`set role anon; select public.life_blog_public_read('${current.token}');`) || "null"), null);
 return 4;
}
async function edge() {
 const source = await readFile(resolve(root, "supabase/functions/haedo-blog-media/index.ts"), "utf8");
 const { createHandler } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64"));
 const owner = randomUUID(), post = randomUUID(), token = randomUUID(), photo = randomUUID();
 const original = Buffer.from("Original image transport bytes\r\n\0\xff", "latin1"), digest = createHash("sha256").update(original).digest("hex");
 const media = { bucket: "haedo-blog-originals", path: `${owner}/${post}/private-photo-id/${digest}`, type: "image/png", size: original.length, digest };
 let active = true, reads = 0, storageReads = 0, revokeOnStorage = false, returnedSize = original.length;
 const secret = "synthetic-server-only-secret";
 const handler = createHandler({ environment: (key) => key === "SUPABASE_URL" ? "https://anonymous-blog.example.invalid" : secret,
  fetcher: async (url, options) => {
   assert.equal(options.headers.Authorization, "Bearer " + secret); assert.equal(options.redirect, "error");
   if (url.includes("/rpc/")) { reads++; assert.deepEqual(JSON.parse(options.body), { p_token: token, p_photo_id: photo }); return Response.json(active ? media : null); }
   storageReads++; assert.ok(url.endsWith(media.path)); assert.equal(options.cache, "no-store");
   if (revokeOnStorage) active = false;
   return new Response(original, { headers: { "Content-Type": "image/png", "Content-Length": String(returnedSize) } });
  },
 });
 const request = () => new Request(`https://anonymous-edge.example.invalid/?token=${token}&photo=${photo}`);
 let response = await handler(request());
 assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
 assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0"); assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
 assert.equal(response.headers.get("Location"), null); assert.equal([...response.headers.values()].some((value) => value.includes(secret) || value.includes(owner)), false);
 assert.equal(reads, 2); assert.equal(storageReads, 1);
 active = false; response = await handler(request()); assert.equal(response.status, 404); assert.equal(storageReads, 1);
 active = true; revokeOnStorage = true; response = await handler(request()); assert.equal(response.status, 404);
 active = true; revokeOnStorage = false; returnedSize++; response = await handler(request()); assert.equal(response.status, 502);
 response = await handler(new Request("https://anonymous-edge.example.invalid/?token=invalid&photo=invalid")); assert.equal(response.status, 404);
 response = await handler(new Request(request(), { method: "POST" })); assert.equal(response.status, 405);
 response = await handler(new Request(request(), { method: "OPTIONS" })); assert.equal(response.status, 204);
 return 7;
}
try {
 try { docker(["image", "inspect", image]); } catch (_) { docker(["pull", image]); }
 docker(["run", "--detach", "--name", container, "--network", "none", "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", image]); owns = true;
 let ready = false;
 for (let i = 0; i < 100; i++) {
  // The image first starts a temporary socket-only initialization server.
  // TCP becomes ready only after that server stops and the final one starts.
  try { docker(["exec", container, "pg_isready", "--host=127.0.0.1", "-U", "postgres", "--quiet"]); ready = true; break; }
  catch (_) { await new Promise((done) => setTimeout(done, 100)); }
 }
 if (!ready) throw new Error("isolated PostgreSQL did not start");
 const isolation = JSON.parse(docker(["inspect", container, "--format", "{{json .HostConfig}}"]));
 assert.equal(isolation.NetworkMode, "none"); assert.equal(Object.keys(isolation.PortBindings || {}).length, 0);
 await fixture("supabase/tests/blog-bootstrap.sql"); await fixture(migration);
 const sqlChecks = parsed(await fixture("supabase/tests/blog-originals.sql")); assert.equal(sqlChecks.failures, 0);
 const installed = parsed(await fixture("supabase/tests/blog-installation.sql")); assert.equal(Object.values(installed).every((v) => v === true), true);
 await fixture(migration); assert.deepEqual(parsed(await fixture("supabase/tests/blog-installation.sql")), installed);
 const simultaneous = await concurrency(), streams = await edge();
 const report = { pass: true, postgres: docker(["exec", container, "postgres", "--version"]).trim(),
  sqlAssertions: sqlChecks.passed, installationAssertions: Object.keys(installed).length, concurrencyAssertions: simultaneous, edgeAssertions: streams,
  network: "none", publishedHostPorts: 0, migrationReinstallPreserved: true, realStorageHttp: false, remoteDatabaseAccess: false,
  ...(keep ? { container, database: "postgres" } : {}) };
 if (keep) {
  await mkdir(resolve(root, ".local/blog-backend"), { recursive: true });
  await writeFile(resolve(root, ".local/blog-backend/report.json"), JSON.stringify(report));
  owns = false; // Explicit caller-owned follow-up; CI must remove this container.
 }
 console.log(JSON.stringify(report));
} finally { if (owns) docker(["rm", "--force", "--volumes", container]); }
