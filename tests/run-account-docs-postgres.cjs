/* Disposable local PostgreSQL cluster only. No endpoint, account, SQL, or credential options.
 * Uses the installed server binaries (/usr/lib/postgresql/<n>/bin) and the pinned
 * test-only `pg` client from tests/sql-ci (npm ci --prefix tests/sql-ci).
 * When run as root the cluster is owned by the `postgres` OS user.
 */
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const { execFileSync, spawn } = require('node:child_process');
if (process.argv.length !== 2) throw Error('No endpoint, account, SQL, or credential options are accepted.');
const versions = fs.existsSync('/usr/lib/postgresql') ? fs.readdirSync('/usr/lib/postgresql').filter(v => /^\d+$/.test(v)).sort((a, b) => b - a) : [];
if (!versions.length) { console.error('SKIP account documents SQL: no local PostgreSQL server binaries.'); process.exit(1); }
const bin = name => path.join('/usr/lib/postgresql', versions[0], 'bin', name);
const asRoot = process.getuid?.() === 0;
const run = (cmd, args, options = {}) => asRoot
  ? execFileSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { stdio: 'pipe', encoding: 'utf8', ...options })
  : execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...options });
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
async function main() {
  const modulePath = path.join(__dirname, 'sql-ci/node_modules/pg');
  if (!fs.existsSync(modulePath)) throw Error('Run npm ci --prefix tests/sql-ci first.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haedo-account-docs-pg-'));
  const data = path.join(dir, 'data'), socket = path.join(dir, 'socket');
  fs.mkdirSync(socket);
  if (asRoot) execFileSync('chown', ['-R', 'postgres', dir]);
  const port = await freePort();
  let started = false;
  try {
    run(bin('initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '--no-sync', '-E', 'UTF8', '--locale=C']);
    run(bin('pg_ctl'), ['-D', data, '-w', '-l', path.join(dir, 'server.log'), '-o', `-p ${port} -c listen_addresses=127.0.0.1 -k ${socket} -c fsync=off`, 'start']);
    started = true;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(__dirname, 'account-docs-sql.cjs')], {
        env: { PATH: process.env.PATH, ACCOUNT_DOCS_PG_PORT: String(port), PG_MODULE_PATH: modulePath }, stdio: ['ignore', 'inherit', 'inherit'] });
      const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(Error('Synthetic SQL tests exceeded 120 seconds.')); }, 120000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); resolve(code); });
    });
    if (result !== 0) throw Error('account-docs-sql.cjs failed');
  } finally {
    if (started) { try { run(bin('pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']); } catch (_) { /* best effort */ } }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error('FAIL account documents PostgreSQL: ' + error.message); process.exitCode = 1; });
