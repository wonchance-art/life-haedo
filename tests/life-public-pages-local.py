#!/usr/bin/env python3
"""Isolated PostgreSQL integration checks; no production database or credentials.

Requires the managed local Docker daemon. Pull postgres:17-alpine first through
its configured proxy. Each run has no network, no published ports and is removed.
"""
import json
import os
from pathlib import Path
import subprocess
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24'
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
ENV = {k: v for k, v in os.environ.items() if k not in
       {'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'}}
NAME = 'life-public-test-' + uuid4().hex[:12]
PSQL = DOCKER + ['exec', '-i', NAME, 'psql', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres']

def command(args, content=None):
    result = subprocess.run(args, input=content, text=True, capture_output=True, env=ENV, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'Local database command failed')
    return result.stdout.strip()

def sql(content):
    return command(PSQL, content)

def literal(value):
    return "'" + str(value).replace("'", "''") + "'"

OWNER = str(uuid4())
SNAPSHOT = {'format': 'life-share-v1', 'title': 'Anonymous concurrency page', 'intro': None, 'entries': []}

def put(workspace, revision=0, operation=None, action='publish'):
    payload = 'null' if action == 'revoke' else literal(json.dumps(SNAPSHOT)) + '::jsonb'
    return 'select public.life_public_page_put(%s,%d,%s,%s,%s);' % (
        literal(workspace), revision, literal(operation or uuid4()), literal(action), payload)

def authenticated(query):
    # SET JWT only for this transaction, exactly as the HTTP database role uses it.
    claims = json.dumps({'sub': OWNER, 'role': 'authenticated'})
    return 'begin; set local role authenticated; set local "request.jwt.claims" = ' + literal(claims) + ';' + query + 'commit;'

def hold(query):
    # psql emits the mutation result before pg_sleep while holding its transaction.
    # The second connection starts only after that result, proving an actual race.
    process = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, env=ENV)
    process.stdin.write(authenticated(query + 'select pg_sleep(0.4);'))
    process.stdin.close()
    process.stdin = None
    line = process.stdout.readline().strip()
    if not line:
        _, error = process.communicate(timeout=15)
        raise RuntimeError(error or 'Concurrent transaction failed before holding the lock')
    return process, json.loads(line)

def finish(process):
    _, error = process.communicate(timeout=15)
    if process.returncode:
        raise RuntimeError(error)

def main():
    started = False
    try:
        command(DOCKER + ['run', '--rm', '-d', '--name', NAME, '--network', 'none',
                          '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE])
        started = True
        for attempt in range(100):
            # The entrypoint's temporary initialization server also answers
            # pg_isready. Wait until PID 1 is the final postgres process.
            pid = subprocess.run(DOCKER + ['exec', NAME, 'cat', '/proc/1/comm'],
                                 capture_output=True, text=True, env=ENV, timeout=5)
            ready = subprocess.run(DOCKER + ['exec', NAME, 'pg_isready', '-U', 'postgres'],
                                   capture_output=True, env=ENV, timeout=5)
            if pid.stdout.strip() == 'postgres' and ready.returncode == 0:
                break
            time.sleep(0.2)
        else:
            raise RuntimeError('Local PostgreSQL did not become ready')
        sql('''create role anon nologin; create role authenticated nologin; create schema auth;
          create table auth.users(id uuid primary key);
          create function auth.uid() returns uuid language sql stable as $$
            select nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub','')::uuid $$;
          grant usage on schema auth to anon,authenticated;
          create table public.charts(sentinel text); insert into public.charts values('untouched');
          create table public.life_workspaces(sentinel text); insert into public.life_workspaces values('untouched');''')
        migration = (ROOT / 'supabase/migrations/20261005120000_life_public_pages.sql').read_text()
        sql(migration)
        sql(migration)
        checks = sql((ROOT / 'supabase/tests/life-public-pages-installation.sql').read_text())
        assert checks and all(line.endswith('|t') for line in checks.splitlines()), checks
        print('PASS repeatable migration and %d installation metadata checks' % len(checks.splitlines()))
        result = sql((ROOT / 'supabase/tests/life-public-pages.sql').read_text())
        print('PASS ' + result)
        assert sql('select count(*) from auth.users;') == '0', 'Transactional fixtures were not rolled back'
        sql('insert into auth.users(id) values(' + literal(OWNER) + ');')
        workspace = str(uuid4())
        process, first = hold(put(workspace))
        second = json.loads(sql(authenticated(put(workspace))))
        finish(process)
        assert first['revision'] == 1 and second == {'status': 'conflict', 'revision': 1}
        print('PASS concurrent initial publishes: exactly one stored, one CAS conflict')
        workspace, operation = str(uuid4()), str(uuid4())
        process, first = hold(put(workspace, operation=operation))
        second = json.loads(sql(authenticated(put(workspace, operation=operation))))
        finish(process)
        assert first == second and first['revision'] == 1
        assert sql('select count(*) from public.life_public_page_receipts where workspace_id=' + literal(workspace)) == '1'
        print('PASS concurrent identical retries return one durable receipt and one revision')
        workspace, operation = str(uuid4()), str(uuid4())
        initial = json.loads(sql(authenticated(put(workspace, operation=operation))))
        process, revoked = hold(put(workspace, 1, action='revoke'))
        stale = json.loads(sql(authenticated(put(workspace, 1))))
        finish(process)
        assert revoked['publicId'] is None and stale == {'status': 'conflict', 'revision': 2}
        assert json.loads(sql(authenticated(put(workspace, operation=operation)))) == initial
        current = json.loads(sql(authenticated('select public.life_public_page_get(' + literal(workspace) + ');')))
        assert current['status'] == 'revoked' and current['revision'] == 2
        public = json.loads(sql('begin; set local role anon; select public.life_public_page_read(' + literal(initial['publicId']) + '); commit;'))
        assert public == {'status': 'missing'}
        print('PASS concurrent revoke wins; stale update and old successful retry cannot restore its URL')
        for table in ['charts', 'life_workspaces']:
            assert sql('select sentinel from public.' + table) == 'untouched'
        print('PASS existing private/platform table sentinels unchanged')
        print('PostgreSQL ' + sql("select current_setting('server_version');") + '; real local engine, roles and sessions; no live Supabase writes.')
    finally:
        if started:
            command(DOCKER + ['rm', '-f', NAME])

if __name__ == '__main__':
    main()
