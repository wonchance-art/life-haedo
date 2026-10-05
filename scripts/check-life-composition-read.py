#!/usr/bin/env python3
"""Read-only deployment permissions probe; no login, private read or synthetic data.

Uses only SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY with inherited proxy and TLS trust.
Authenticated RPC behavior needs separate SQL/owner tests; a public key cannot prove it.
Never prints URL, key, response text, personal data or identifiers.
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

    def denied(name, path, payload=None):
        headers = {'apikey': key, 'Cache-Control': 'no-store'}
        data = None
        if payload is not None:
            headers['Content-Type'] = 'application/json'
            data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(base + path, data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                result = {'check': name, 'http': response.status, 'passed': False}
        except urllib.error.HTTPError as error:
            try:
                code = json.load(error).get('code')
            except (ValueError, AttributeError):
                code = None
            result = {'check': name, 'http': error.code, 'code': code,
                      'passed': error.code in (401, 403) and code == '42501'}
        except (urllib.error.URLError, TimeoutError):
            result = {'check': name, 'passed': False, 'error': 'connection_failed'}
        checks.append(result)

    # Intentionally do not call put, even with invalid values. This is strictly
    # a read-only probe. EXECUTE on put is checked by installation metadata SQL.
    denied('anonymous composition get denied', '/rest/v1/rpc/life_composition_get',
           {'p_workspace_id': '00000000-0000-4000-8000-000000000000'})
    denied('anonymous composition table denied', '/rest/v1/life_compositions?select=workspace_id&limit=0')
    denied('anonymous composition receipts denied', '/rest/v1/life_composition_receipts?select=operation_id&limit=0')
    print(json.dumps({'scope': 'read-only anonymous deployed HTTP; authenticated get/put not exercised',
                      'checks': checks}, indent=2))
    return 0 if all(check['passed'] for check in checks) else 1


if __name__ == '__main__':
    raise SystemExit(main())
