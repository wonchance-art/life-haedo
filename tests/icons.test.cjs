'use strict';
// Shared icons stay the local Lucide 1.51.0 files: same geometry, recorded hash, one stroke width.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function load() {
  const made = [];
  const document = { createElementNS: () => { const svg = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }; made.push(svg); return svg; } };
  const context = { document };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/life/icons.js'), 'utf8'), context);
  return { icons: context.HaedoLife.Icons, made };
}
const elements = text => [...text.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*?\s*\/>/g)].map(match => match[0].replace(/\s*\/>$/, '/>'));

test('every shared glyph is the unchanged geometry of a recorded local Lucide 1.51.0 file', () => {
  const { icons } = load();
  const upstream = JSON.parse(fs.readFileSync(path.join(root, 'vendor/lucide/UPSTREAM.json'), 'utf8'));
  assert.equal(upstream.version, '1.51.0'); assert.equal(upstream.npm_subset.version, '1.51.0');
  const recorded = new Map([...upstream.files, ...upstream.npm_subset.files].map(entry => [entry.path, entry.sha256]));
  const names = Object.keys(icons.sources);
  assert.ok(names.length >= 35);
  for (const name of names) {
    const { file, geometry } = icons.sources[name];
    const svgPath = path.join(root, 'vendor/lucide/icons', file + '.svg');
    const text = fs.readFileSync(svgPath, 'utf8');
    assert.equal(crypto.createHash('sha256').update(text).digest('hex'), recorded.get('icons/' + file + '.svg'), file + ' hash');
    assert.equal(geometry, elements(text).join(''), name + ' geometry');
    assert.doesNotMatch(geometry, /https?:|<script|on[a-z]+=/i);
  }
});

test('one concept keeps one picture and icons draw with stroke 1.8 at 20px or the requested inline size', () => {
  const { icons, made } = load();
  const file = name => icons.sources[name].file;
  // Decision 15 (docs/design-review/write-read-redesign.md).
  assert.equal(file('book'), 'book-open'); assert.equal(file('quote'), 'text-quote'); assert.equal(file('link'), 'link');
  assert.equal(file('write'), 'pencil'); assert.equal(file('edit'), 'square-pen'); assert.equal(file('calendar'), 'calendar');
  assert.notEqual(file('write'), file('edit'));
  const used = new Map();
  for (const name of Object.keys(icons.sources)) {
    assert.equal(used.has(file(name)), false, file(name) + ' names two glyphs: ' + used.get(file(name)) + ', ' + name);
    used.set(file(name), name);
  }
  icons.create('write'); icons.create('quote', { size: 16 }); icons.create('unknown-name');
  assert.deepEqual(made.map(svg => [svg.attributes['data-glyph'], svg.attributes.width, svg.attributes['stroke-width'], svg.attributes['aria-hidden']]),
    [['write', '20', '1.8', 'true'], ['quote', '16', '1.8', 'true'], ['book', '20', '1.8', 'true']]);
});
