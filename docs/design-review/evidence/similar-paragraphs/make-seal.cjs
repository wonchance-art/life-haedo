/* 봉인 파일을 만든다. node make-seal.cjs seal  → seal.json (사전등록·말뭉치·gold, 개발 실행 전)
 * node make-seal.cjs freeze --variant P --threshold 0.5 → freeze.json (개발 선택값·코드, 평가 실행 전)
 * 이미 있는 봉인은 덮어쓰지 않는다. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const HERE = __dirname, REPO = path.resolve(HERE, '../../../..');
const shaFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const PRODUCT_FILES = ['assets/life/interest-model-worker.js', 'assets/life/interest-model-loader.js', 'assets/life/rediscovery.js', 'assets/life/core.js', 'sw.js', 'manifest.webmanifest'];
const kind = process.argv[2];
const option = name => { const index = process.argv.indexOf('--' + name); return index > 0 ? process.argv[index + 1] : undefined; };
const target = path.join(HERE, kind + '.json');
if (!['seal', 'freeze'].includes(kind)) throw new Error('seal|freeze');
if (fs.existsSync(target)) throw new Error(kind + '.json이 이미 있습니다. 봉인은 다시 만들지 않습니다.');
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
const common = { createdAtUTC: new Date().toISOString(), gitHead: git('rev-parse', 'HEAD'),
  productGitStatus: git('status', '--porcelain', '--', ...PRODUCT_FILES) || 'clean' };
let value;
if (kind === 'seal') {
  const names = ['preregistration.md', 'dev-corpus.json', 'dev-gold.json', 'eval-corpus.json', 'eval-gold.json', 'build-corpus.py', 'build-gold.py'];
  value = { schemaVersion: 1, status: 'sealed_before_any_model_run_on_corpus', ...common,
    files: Object.fromEntries(names.map(name => [name, shaFile(path.join(HERE, name))])),
    product: Object.fromEntries(PRODUCT_FILES.map(name => [name, shaFile(path.join(REPO, name))])) };
} else {
  const variant = option('variant'), threshold = Number(option('threshold'));
  if (!['P', 'TP', 'W2'].includes(variant) || !(threshold >= 0.2 && threshold <= 0.95)) throw new Error('--variant P|TP|W2 --threshold 0.20~0.95');
  const report = JSON.parse(fs.readFileSync(path.join(HERE, 'dev-report.json'), 'utf8'));
  if (report.chosen.variant !== variant || report.chosen.threshold !== threshold) throw new Error('개발 보고의 선택값과 다릅니다');
  const names = ['seal.json', 'preregistration.md', 'candidate.js', 'run-experiment.cjs', 'evaluate.cjs', 'harness.html', 'worker-host.html', 'dev-output.json', 'dev-report.json'];
  value = { schemaVersion: 1, status: 'frozen_before_eval_run', ...common, parameters: { variant, threshold },
    files: Object.fromEntries(names.map(name => [name, shaFile(path.join(HERE, name))])),
    product: Object.fromEntries(PRODUCT_FILES.map(name => [name, shaFile(path.join(REPO, name))])) };
}
fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
console.log(target, shaFile(target));
