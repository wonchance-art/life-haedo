#!/usr/bin/env python3
"""Read-only deployment probe. No login, personal row read or synthetic publication.

Uses SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY via the inherited proxy/trust.
Never prints their values, response bodies, account IDs or private data.
"""
import json
import os
import re
import urllib.error
import urllib.request


def main():
    base = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_PUBLISHABLE_KEY', '')
    if not re.fullmatch(r'https://[a-z0-9-]+\.supabase\.co', base) or not key:
        raise SystemExit('BLOCKED: project URL and publishable-key bindings are required.')
    checks = []

    def request(name, path, payload=None, allowed=False):
        headers = {'apikey': key, 'Cache-Control': 'no-store'}
        data = None
        if payload is not None:
            headers['Content-Type'] = 'application/json'
            data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(base + path, data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                body = json.load(response)
                passed = allowed and response.status == 200 and body == {'status': 'missing'} and 'no-store' in response.headers.get('Cache-Control', '').lower()
                result = {'check': name, 'http': response.status, 'passed': passed}
        except urllib.error.HTTPError as error:
            try:
                code = json.load(error).get('code')
            except (ValueError, AttributeError):
                code = None
            result = {'check': name, 'http': error.code, 'code': code,
                      'passed': not allowed and error.code in (401, 403) and code == '42501'}
        except (urllib.error.URLError, TimeoutError):
            result = {'check': name, 'passed': False, 'error': 'connection_failed'}
        checks.append(result)

    request('anonymous exact-ID lookup and no-store', '/rest/v1/rpc/life_public_page_read',
            {'p_public_id': '00000000-0000-4000-8000-000000000000'}, allowed=True)
    request('anonymous owner listing denied', '/rest/v1/rpc/life_public_page_list', {'p_after': None})
    request('anonymous owner status denied', '/rest/v1/rpc/life_public_page_get',
            {'p_workspace_id': '00000000-0000-4000-8000-000000000000'})
    request('anonymous base table denied', '/rest/v1/life_public_pages?select=public_id&limit=0')
    request('anonymous receipts denied', '/rest/v1/life_public_page_receipts?select=operation_id&limit=0')
    print(json.dumps({'scope': 'read-only deployed HTTP; no real owner publish/revoke or Google login', 'checks': checks}, indent=2))
    return 0 if all(check['passed'] for check in checks) else 1


if __name__ == '__main__':
    raise SystemExit(main())
