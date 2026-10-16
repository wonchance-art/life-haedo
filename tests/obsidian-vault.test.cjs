"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const Core = require("../assets/life/core.js");
const load = () => import("../scripts/lib/obsidian-vault.mjs");
const options = {
  repositoryUrl: "https://github.com/example/private-vault",
  ref: "a".repeat(40),
  title: "익명 보관함",
};
const entry = (p, text) => ({ path: p, bytes: Buffer.from(text) });

test("vault preserves every input byte/path including BOM/CRLF, empty files, scripts and raw YAML without executing or inventing authors/excerpts", async () => {
  const { buildVault } = await load();
  const entries = [
    entry("notes/첫 기록.md", "\ufeff# 첫 기록\r\n😀 같은 문장\r\n"),
    entry("empty.md", ""),
    entry("_extracts/raw.yaml", "extracts:\n  - text: 원본에 없는 추론\n"),
    entry(".obsidian/plugin.js", 'throw new Error("must not execute")'),
    entry("diagram.canvas", "{}"),
  ];
  const result = await buildVault(entries, options),
    backups = [result.notesBackup, result.filesBackup];
  assert.equal(result.manifest.files.length, entries.length);
  assert.equal(backups[0].workspace.sources.length, 2);
  assert.equal(backups[1].workspace.sources.length, 3);
  for (const backup of backups) {
    const restored = await Core.restoreBackup(JSON.stringify(backup));
    assert.notEqual(restored.workspaceId, backup.workspace.workspaceId);
    assert.equal(restored.records.length, 0);
    for (const source of restored.sources) {
      const input = entries.find((e) => e.path === source.sourceKey),
        version = restored.sourceVersions.find((v) => v.sourceId === source.id);
      assert.deepEqual(Buffer.from(version.contentText || ""), input.bytes);
      assert.equal(version.originalAuthor.relation, "unknown");
      assert.equal(version.originalCreatedAt, null);
      assert.equal(source.origin, "obsidian");
      assert(
        source.url.startsWith(
          options.repositoryUrl + "/blob/" + options.ref + "/",
        ),
      );
      if (input.bytes.length)
        assert.equal(
          version.contentHash,
          createHash("sha256").update(input.bytes).digest("hex"),
        );
      else assert.equal(version.coverage.status, "link_only");
    }
  }
});

test("internal links resolve exact, relative, percent-encoded, heading, block and unique basename references with exact UTF-16 ranges", async () => {
  const { buildVault } = await load();
  const body =
    "😀 [[둘째#제목|표시]]\n[경로](../other/%EC%85%8B.md#^block)\n[[고유]]\n[[#현재]]\n# 현재\n";
  const entries = [
    entry("notes/첫째.md", body),
    entry("notes/둘째.md", "# 제목\n본문"),
    entry("other/셋.md", "단락 ^block\n"),
    entry("else/고유.md", "고유 원문"),
  ];
  const { notesBackup, manifest } = await buildVault(entries, options);
  assert.equal(manifest.references.resolved, 4);
  const b = await Core.restoreBackup(notesBackup);
  assert.equal(b.links.length, 4);
  for (const link of b.links) {
    const [from, to] = link.sourceRefs,
      v = b.sourceVersions.find((v) => v.id === from.sourceVersionId);
    assert.equal(
      (await load()).references(
        v.contentText.slice(from.locator.start, from.locator.end),
      )[0].target,
      link.note,
    );
    const target = b.sourceVersions.find((v) => v.id === to.sourceVersionId);
    assert.equal(target.sourceId, to.sourceId);
  }
  assert(
    b.links.some(
      (l) =>
        b.sourceVersions
          .find((v) => v.id === l.sourceRefs[1].sourceVersionId)
          .contentText.slice(
            l.sourceRefs[1].locator?.start,
            l.sourceRefs[1].locator?.end,
          ) === "단락 ^block",
    ),
  );
});

test("ambiguous/missing/invalid links stay raw, code and external references never become fabricated connections", async () => {
  const { buildVault, references } = await load();
  const text =
    "[[같은]] [[없는 노트]] [잘못된 인코딩](bad%ZZ)\n`[[인라인]]`\n~~~md\n[[코드]]\n~~~\n[외부](https://example.org) %% [[주석]] %% \\[[이스케이프]]";
  assert.equal(references(text).length, 3);
  const r = await buildVault(
    [entry("index.md", text), entry("a/같은.md", "A"), entry("b/같은.md", "B")],
    options,
  );
  assert.equal(r.notesBackup.workspace.links.length, 0);
  assert.equal(r.manifest.unresolvedReferences.length, 3);
  assert.deepEqual(r.manifest.references, {
    resolved: 0,
    missing: 1,
    ambiguous: 1,
    invalid: 1,
    unresolvedAnchors: 0,
  });
  assert.equal(r.notesBackup.workspace.sourceVersions[0].contentText, text);
});

test("vault rejects duplicate/traversal paths, invalid UTF-8, binary text, oversized files and credential URLs", async () => {
  const { buildVault } = await load();
  for (const entries of [
    [entry("../x.md", "x")],
    [entry("/x.md", "x")],
    [entry("x.md", "a"), entry("x.md", "b")],
    [{ path: "x.md", bytes: Buffer.from([0xff]) }],
    [entry("x.md", "\0")],
    [entry("x.md", "a".repeat(Core.MAX_IMPORT_BYTES + 1))],
  ])
    await assert.rejects(buildVault(entries, options));
  await assert.rejects(
    buildVault([], {
      ...options,
      repositoryUrl: "https://user:pass@github.com/a/b",
    }),
  );
});

test("CLI exports outside the app, pins a clean Git tree and refuses symlinks, dirty snapshots and replacement", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "haedo-vault-")),
    vault = path.join(root, "vault"),
    output = path.join(root, "private");
  await fs.mkdir(vault);
  await fs.writeFile(path.join(vault, "note.md"), "# 익명 기록\n");
  const git = (...args) =>
    execFileSync("git", ["-C", vault, ...args], { stdio: "pipe" });
  const cli = (target) =>
    execFileSync(
      process.execPath,
      [
        "scripts/import-obsidian-vault.mjs",
        "--vault",
        vault,
        "--output",
        target,
        "--repository",
        options.repositoryUrl,
      ],
      { cwd: path.resolve(__dirname, ".."), encoding: "utf8", stdio: "pipe" },
    );
  try {
    git("init", "-q");
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "fixture",
    );
    const summary = JSON.parse(cli(output));
    assert.equal(summary.files, 1);
    assert.equal(summary.verified, true);
    const review = JSON.parse(
      await fs.readFile(path.join(output, "review.json"), "utf8"),
    );
    assert.equal(review.summary.reviewGroups, 0);
    const html = await fs.readFile(path.join(output, "review.html"), "utf8");
    assert(html.includes("노트 연결 검토"));
    for (const name of ["review.json", "review.html"])
      assert.equal(
        (await fs.stat(path.join(output, name))).mode & 0o777,
        0o600,
      );
    assert(!JSON.stringify(summary).includes("익명 기록"));
    const snapshot = await fs.readFile(path.join(output, "notes.json"));
    assert.throws(() => cli(output));
    assert.deepEqual(
      await fs.readFile(path.join(output, "notes.json")),
      snapshot,
    );
    assert.throws(() =>
      cli(path.resolve(__dirname, "../.local/private-vault-forbidden")),
    );
    git("bundle", "verify", path.join(output, "repository.bundle"));
    await fs.writeFile(path.join(vault, "note.md"), "changed");
    assert.throws(() => cli(path.join(root, "dirty")));
    git("checkout", "--", "note.md");
    await fs.symlink(path.join(root, "outside"), path.join(vault, "escape"));
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "symlink",
    );
    assert.throws(() => cli(path.join(root, "symlink")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Wikilinks keep literal percent characters and prefer the local note over an unrelated root basename", async () => {
  const { buildVault } = await load();
  const r = await buildVault(
    [
      entry("folder/start.md", "[[100%]] [[index]]"),
      entry("folder/100%.md", "percent"),
      entry("folder/index.md", "local"),
      entry("index.md", "root"),
    ],
    options,
  );
  assert.equal(r.manifest.references.resolved, 2);
  const b = r.notesBackup.workspace;
  const targets = b.links.map(
    (l) =>
      b.sourceVersions.find((v) => v.id === l.sourceRefs[1].sourceVersionId)
        .contentText,
  );
  assert.deepEqual(targets, ["percent", "local"]);
});
