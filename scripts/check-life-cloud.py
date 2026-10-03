#!/usr/bin/env python3
"""Isolated live checks for an already installed life_sync migration.

Required environment: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
HAEDO_TEST_A_EMAIL/PASSWORD, HAEDO_TEST_B_EMAIL/PASSWORD.
Inherited HTTP(S)_PROXY and CA trust are retained. Credentials/tokens never go to
stdout, files, command arguments or exception reports. Only generated anonymous
workspaces are read/written. Existing charts are never accessed.

python3 scripts/check-life-cloud.py --schema-only
python3 scripts/check-life-cloud.py --auth-settings-only
python3 scripts/check-life-cloud.py --cleanup-sql /tmp/life-cloud-cleanup.sql

The full check creates isolated test rows and writes administrator cleanup SQL.
It never grants DELETE to application roles or runs administrator cleanup itself.
"""
import argparse
import concurrent.futures
import datetime
import json
import os
from pathlib import Path
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


class CheckFailure(Exception):
    """Messages contain only fixed labels, HTTP statuses and safe error codes."""


def require(condition, label):
    if not condition:
        raise CheckFailure(label)


def env(name):
    value = os.environ.get(name)
    if not value:
        raise CheckFailure("Missing environment variable: " + name)
    return value


class Client:
    def __init__(self, base, key):
        self.base, self.key = base, key
        # Do not override the proxy or disable certificate checks. Python honors
        # SSL_CERT_FILE/SSL_CERT_DIR in create_default_context().
        self.context = ssl.create_default_context()
        self.last_response_metadata = None

    def request(self, path, token=None, method="GET", data=None, *, serialized=None):
        self.last_response_metadata = None
        headers = {"apikey": self.key, "Accept": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        require(data is None or serialized is None, "Specify only one request encoding.")
        body = serialized
        if data is not None:
            body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base + path, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, context=self.context, timeout=45) as response:
                status, raw, response_headers = response.status, response.read(), response.headers
        except urllib.error.HTTPError as error:
            status, raw, response_headers = error.code, error.read(), error.headers
        except (urllib.error.URLError, TimeoutError, OSError):
            raise CheckFailure("Network request failed; inspect proxy/CA access without exposing credentials.") from None
        try:
            result = json.loads(raw) if raw else None
        except (ValueError, UnicodeDecodeError):
            result = None
        media_type = response_headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        # Never retain/print raw headers, URLs, body text, identifiers or tokens.
        # Presence of a proxy/server header cannot attribute a response by itself.
        self.last_response_metadata = {
            "status": status, "request_bytes": len(body) if body else 0,
            "response_bytes": len(raw), "json_response": result is not None,
            "media_type": media_type if media_type in ("application/json", "text/html", "text/plain") else "other",
            "via_header_present": "Via" in response_headers,
            "www_authenticate_present": "WWW-Authenticate" in response_headers,
        }
        return status, result

    def login(self, label):
        status, response = self.request("/auth/v1/token?grant_type=password", method="POST", data={
            "email": env("HAEDO_TEST_" + label + "_EMAIL"),
            "password": env("HAEDO_TEST_" + label + "_PASSWORD"),
        })
        require(status == 200 and isinstance(response, dict) and response.get("access_token"),
                "Test account " + label + " authentication failed (HTTP " + str(status) + ").")
        token = response["access_token"]
        owner = response.get("user", {}).get("id")
        try:
            uuid.UUID(owner)
        except (ValueError, TypeError, AttributeError):
            raise CheckFailure("Test account response has no valid owner identity.") from None
        return token, owner

    def put(self, token, wid, expected, operation, bundle):
        return self.request("/rest/v1/rpc/life_sync_put", token, "POST", {
            "p_workspace_id": wid, "p_expected_revision": expected,
            "p_operation_id": operation, "p_data": bundle,
        })

    def read(self, token, wid):
        return self.request("/rest/v1/life_workspaces?select=id,title,revision,data&id=eq." + wid, token)

    def put_oversized_jsonb(self, token, wid, bundle):
        # PostgreSQL expands finite JSON numeric exponents when storing JSONB.
        # 18,000 * 1e1000 is >18 MB as JSONB, but ~126 KB on the wire. This
        # reaches the SQL size guard even when a gateway limits HTTP bodies.
        marker = "LIFE_OVERSIZE_NUMERIC_FIXTURE"
        encoded = json.dumps({
            "p_workspace_id": wid, "p_expected_revision": 0,
            "p_operation_id": str(uuid.uuid4()), "p_data": {**bundle, "extra": marker},
        }, ensure_ascii=False, separators=(",", ":"))
        require(encoded.count(json.dumps(marker)) == 1, "Unexpected size-fixture marker.")
        encoded = encoded.replace(json.dumps(marker), "[" + ",".join(["1e1000"] * 18000) + "]")
        return self.request("/rest/v1/rpc/life_sync_put", token, "POST", serialized=encoded.encode("utf-8"))


class Run:
    def __init__(self, cleanup):
        self.run_id = str(uuid.uuid4())
        self.cleanup = Path(cleanup or ("/tmp/life-cloud-cleanup-" + self.run_id + ".sql"))
        require(not self.cleanup.exists(), "Cleanup SQL already exists; choose a new path to preserve earlier test IDs.")
        self.ids = []
        self.count = 0

    def new_id(self):
        wid = str(uuid.uuid4())
        self.ids.append(wid)
        # Persist only generated test IDs, before attempting the write. No owner
        # identity or credential is needed for this precisely scoped cleanup.
        rows = ",\n  ".join("'" + value + "'::uuid" for value in self.ids)
        content = ("-- Only anonymous rows generated by this check. Run as administrator.\n"
                   "-- Receipt rows are removed by the migration's cascading foreign key.\n"
                   "begin;\ndelete from public.life_workspaces\nwhere id in (\n  " + rows +
                   "\n) and title like '익명 동기화 검사 " + self.run_id + "%';\ncommit;\n")
        try:
            with self.cleanup.open("w", encoding="utf-8") as handle:
                handle.write(content)
            self.cleanup.chmod(0o600)
        except OSError:
            raise CheckFailure("Cannot write the anonymous-row cleanup SQL file.") from None
        return wid

    def bundle(self, wid, suffix=""):
        now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
        return {"schemaVersion": 1, "workspaceId": wid,
                "title": "익명 동기화 검사 " + self.run_id + suffix,
                "revision": 0, "createdAt": now, "updatedAt": now,
                "sources": [], "sourceVersions": [], "records": [], "links": [],
                "resumeHints": [], "tombstones": []}

    def passed(self, label):
        self.count += 1
        print("PASS " + label)


def denied(response):
    return response[0] in (401, 403)


def rpc_result(response, result, label):
    require(response[0] == 200 and response[1] == result, label + " failed (HTTP " + str(response[0]) + ").")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    read_only = parser.add_mutually_exclusive_group()
    read_only.add_argument("--schema-only", action="store_true", help="Authenticate and check schema; create no rows.")
    read_only.add_argument("--auth-settings-only", action="store_true", help="Read only the Google provider enabled flag; no login or rows.")
    parser.add_argument("--cleanup-sql", help="New administrator cleanup file for generated rows only (default: unique /tmp path).")
    parser.add_argument("--wire-size-check", action="store_true", help="Also probe a >16 MiB HTTP body; gateways may reject it before SQL.")
    args = parser.parse_args()
    base = env("SUPABASE_URL").rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    require(parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password
            and not parsed.path and not parsed.query and not parsed.fragment,
            "SUPABASE_URL must be an HTTPS project origin.")
    client = Client(base, env("SUPABASE_PUBLISHABLE_KEY"))
    if args.auth_settings_only:
        status, settings = client.request("/auth/v1/settings")
        google = settings.get("external", {}).get("google") if isinstance(settings, dict) else None
        require(status == 200 and isinstance(google, bool),
                "Google provider readiness could not be read (HTTP " + str(status) + ").")
        print(json.dumps({"status": status, "google_enabled": google}))
        return 0
    token_a, owner_a = client.login("A")
    token_b, owner_b = client.login("B")
    require(owner_a != owner_b, "Test A and B must be distinct accounts.")
    print("PASS two distinct test accounts authenticated")
    status, result = client.request("/rest/v1/life_workspaces?select=id&limit=0", token_a)
    if status == 404:
        print("BLOCKED schema_missing: install supabase/migrations/20261003085426_life_sync_workspaces.sql before live checks.")
        return 2
    require(status == 200 and result == [], "Schema readiness check failed (HTTP " + str(status) + ").")
    print("PASS life_workspaces SELECT endpoint is installed")
    if args.schema_only:
        print("No test rows created. RPC/RLS/CAS execution has not been checked.")
        return 0

    run = Run(args.cleanup_sql)
    wid = run.new_id()
    data = run.bundle(wid, " A")
    first_op = str(uuid.uuid4())
    try:
        rpc_result(client.put(token_a, wid, 0, first_op, data), {"status": "stored", "revision": 1}, "Initial create")
        rpc_result(client.put(token_a, wid, 0, first_op, data), {"status": "stored", "revision": 1}, "Lost response replay")
        run.passed("create and identical lost-response replay")

        status, rows = client.read(token_b, wid)
        require(status == 200 and rows == [], "Other owner saw the generated private row.")
        require(denied(client.read(None, wid)), "Anonymous SELECT unexpectedly allowed.")
        require(denied(client.put(None, wid, 0, str(uuid.uuid4()), data)), "Anonymous RPC unexpectedly allowed.")
        run.passed("other-account and anonymous isolation")

        for token in (token_a, token_b, None):
            require(denied(client.request("/rest/v1/life_sync_receipts?select=operation_id&limit=0", token)),
                    "Receipt table unexpectedly readable.")
        run.passed("receipt access denied to every application role")

        direct_id = run.new_id()
        direct_data = run.bundle(direct_id, " direct")
        require(denied(client.request("/rest/v1/life_workspaces", token_a, "POST", {
            "owner_id": owner_a, "id": direct_id, "title": direct_data["title"],
            "revision": 1, "data": direct_data,
        })), "Direct INSERT unexpectedly allowed.")
        require(denied(client.request("/rest/v1/life_workspaces?id=eq." + wid, token_a, "PATCH", {"revision": 999})),
                "Direct UPDATE unexpectedly allowed.")
        require(denied(client.request("/rest/v1/life_workspaces?id=eq." + wid, token_a, "DELETE")),
                "Direct DELETE unexpectedly allowed.")
        run.passed("direct INSERT UPDATE DELETE denied")

        changed = {**data, "title": data["title"] + " changed"}
        for expected, payload in ((0, changed), (1, data)):
            status, error = client.put(token_a, wid, expected, first_op, payload)
            require(status == 400 and isinstance(error, dict) and error.get("code") == "22023",
                    "Successful operation ID accepted a changed request.")
        run.passed("operation ID payload and base misuse rejected")

        rpc_result(client.put(token_b, wid, 2, str(uuid.uuid4()), data), {"status": "missing"}, "Hidden-owner missing")
        data_b = run.bundle(wid, " B")
        rpc_result(client.put(token_b, wid, 0, first_op, data_b), {"status": "stored", "revision": 1}, "Owner-scoped ID")
        for token, expected in ((token_a, data["title"]), (token_b, data_b["title"])):
            status, rows = client.read(token, wid)
            require(status == 200 and len(rows) == 1 and rows[0]["title"] == expected, "Owner-scoped same UUID leaked data.")
        run.passed("same workspace UUID and operation isolated by owner")

        missing = run.new_id()
        rpc_result(client.put(token_a, missing, 7, str(uuid.uuid4()), run.bundle(missing)), {"status": "missing"}, "Missing nonzero base")
        require(client.read(token_a, missing) == (200, []), "Missing workspace was recreated.")
        run.passed("nonzero missing base cannot recreate a workspace")

        # Independent HTTP requests exercise separate PostgreSQL transactions.
        race_id = run.new_id()
        race_data = run.bundle(race_id, " race")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            pending = [pool.submit(client.put, token_a, race_id, 0, str(uuid.uuid4()), race_data) for _ in range(2)]
            outcomes = [future.result() for future in pending]
        require(all(status == 200 for status, _ in outcomes), "Concurrent initial create returned an HTTP error.")
        require(sorted(value["status"] for _, value in outcomes) == ["conflict", "stored"]
                and all(value["revision"] == 1 for _, value in outcomes), "Concurrent initial create did not serialize.")
        run.passed("concurrent first create serializes to one winner")

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            pending = [pool.submit(client.put, token_a, race_id, 1, str(uuid.uuid4()), race_data) for _ in range(2)]
            outcomes = [future.result() for future in pending]
        require(all(status == 200 for status, _ in outcomes)
                and sorted(value["status"] for _, value in outcomes) == ["conflict", "stored"]
                and all(value["revision"] == 2 for _, value in outcomes), "Concurrent CAS update did not serialize.")
        run.passed("concurrent existing-row CAS has one winner")

        replay_id, replay_op = run.new_id(), str(uuid.uuid4())
        replay_data = run.bundle(replay_id, " duplicate request")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            pending = [pool.submit(client.put, token_a, replay_id, 0, replay_op, replay_data) for _ in range(2)]
            for future in pending:
                rpc_result(future.result(), {"status": "stored", "revision": 1}, "Concurrent identical retry")
        run.passed("concurrent identical request rechecks durable receipt")

        large_id = run.new_id()
        large_data = run.bundle(large_id, " large")
        status, error = client.put_oversized_jsonb(token_a, large_id, large_data)
        require(status == 400 and isinstance(error, dict) and error.get("code") == "22001"
                and error.get("message") == "life_snapshot_too_large",
                "SQL size guard not confirmed (HTTP " + str(status) + ").")
        require(client.read(token_a, large_id) == (200, []), "Oversized snapshot left a row.")
        run.passed("server-side 16 MiB JSONB defense through bounded HTTP input")
        if args.wire_size_check:
            status, error = client.put(token_a, large_id, 0, str(uuid.uuid4()),
                                       {**large_data, "extra": "x" * (16 * 1024 * 1024)})
            print("HTTP size response metadata: " + json.dumps(client.last_response_metadata, sort_keys=True))
            require(client.read(token_a, large_id) == (200, []), "Oversized HTTP request left a row.")
            require(status == 413 or status == 400 and isinstance(error, dict) and error.get("code") == "22001",
                    "Oversized HTTP transport rejection is inconclusive (HTTP " + str(status) + ").")
            run.passed("oversized HTTP transport rejection")
        print(str(run.count) + " live checks passed. No existing user rows or charts were read or changed.")
        print("Deletion-after-admin-removal is checked locally; this script does not grant or perform privileged DELETE.")
        return 0
    finally:
        print("Generated anonymous rows only: cleanup SQL is at " + str(run.cleanup))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except CheckFailure as error:
        print("FAIL " + str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        # Do not dump request objects, response bodies, env values or tracebacks.
        print("FAIL unexpected checker error; no credentials or server body were printed.", file=sys.stderr)
        sys.exit(1)
