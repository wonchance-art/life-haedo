#!/usr/bin/env node
'use strict';
// Relative markdown links in docs/ and the root *.md files must point at an existing
// file and, for a .md target, an existing GitHub-style heading anchor.
// Usage: node scripts/check-markdown-links.cjs [--json]
const fs = require('node:fs'), path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git']);

function listMarkdown(root = ROOT) {
  const files = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name);
  (function walk(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(rel);
    }
  })('docs');
  return files.sort();
}

// Lines outside fenced code blocks, with their 1-based line numbers.
function proseLines(text) {
  const out = []; let fence = null;
  text.split('\n').forEach((line, index) => {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) { if (match && match[1][0] === fence[0] && match[1].length >= fence.length && !line.slice(match[0].length).trim()) fence = null; return; }
    if (match) { fence = match[1]; return; }
    out.push({ line, number: index + 1 });
  });
  return out;
}

// github-slugger: lowercase, drop everything but letters, marks, numbers, connector
// punctuation, spaces and hyphens, then turn each space into a hyphen.
function slug(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
}

function headingText(raw) {
  return raw
    .replace(/\s+#+\s*$/, '')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?![\w*])/g, '$1$2')
    .trim();
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const anchors = new Set(), seen = new Map();
  const text = fs.readFileSync(file, 'utf8');
  for (const { line } of proseLines(text)) {
    const heading = line.match(/^ {0,3}#{1,6}\s+(.*)$/);
    if (heading) {
      const base = slug(headingText(heading[1]));
      const count = seen.get(base) || 0; seen.set(base, count + 1);
      anchors.add(count ? `${base}-${count}` : base);
    }
    for (const html of line.matchAll(/<a\s+[^>]*(?:id|name)=["']([^"']+)["']/gi)) anchors.add(html[1]);
  }
  anchorCache.set(file, anchors);
  return anchors;
}

function linksOf(text) {
  const links = [];
  for (const { line, number } of proseLines(text)) {
    const bare = line.replace(/`[^`]*`/g, match => ' '.repeat(match.length));
    for (const match of bare.matchAll(/!?\[(?:[^\[\]]|\[[^\]]*\])*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g)) links.push({ target: match[1], line: number });
    const ref = bare.match(/^ {0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/);
    if (ref) links.push({ target: ref[1], line: number });
  }
  return links;
}

function decode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function checkLink(fromRel, target, root = ROOT) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return null;
  const hashAt = target.indexOf('#');
  const filePart = decode(hashAt < 0 ? target : target.slice(0, hashAt)).replace(/\?.*$/, '');
  const anchor = hashAt < 0 ? '' : decode(target.slice(hashAt + 1));
  const resolved = !filePart ? path.join(root, fromRel)
    : filePart.startsWith('/') ? path.join(root, filePart)
      : path.join(root, path.dirname(fromRel), filePart);
  if (!fs.existsSync(resolved)) return 'missing file';
  if (!anchor || !resolved.endsWith('.md') || !fs.statSync(resolved).isFile()) return null;
  if (!anchorsOf(resolved).has(anchor.toLowerCase()) && !anchorsOf(resolved).has(anchor)) return 'missing anchor';
  return null;
}

function check(root = ROOT) {
  anchorCache.clear();
  const broken = [];
  for (const file of listMarkdown(root)) {
    for (const { target, line } of linksOf(fs.readFileSync(path.join(root, file), 'utf8'))) {
      const reason = checkLink(file, target, root);
      if (reason) broken.push({ file, line, target, reason });
    }
  }
  return broken;
}

// Allowlist entries are "file -> target" so that line moves do not invalidate them.
const keyOf = item => `${item.file} -> ${item.target}`;

module.exports = { check, slug, headingText, linksOf, keyOf, listMarkdown };

if (require.main === module) {
  const broken = check();
  if (process.argv.includes('--json')) console.log(JSON.stringify([...new Set(broken.map(keyOf))].sort(), null, 2));
  else {
    for (const item of broken) console.log(`${item.file}:${item.line} ${item.reason}: ${item.target}`);
    console.log(`${broken.length} broken relative markdown link(s) in ${listMarkdown().length} files`);
  }
}
