# Anonymous browser transport fixtures

`life-sync-browser.cjs` exports the existing workspace/blog FakeCloud wrapped by
`library-cloud.cjs`. Existing browser suites receive an explicit older backend:
`life_library_capabilities` returns HTTP 200 with all three versions set to zero.
That preserves the original opt-in source/composition contracts, assertions and
zero-write boundaries. It does not disable account storage in product code.

`account-library-browser.cjs` instead creates
`new CompositionCloud().enableAccountLibrary()`. All three capabilities are one.
Each context starts signed out, uses the real bundled SDK and normal fixture
Google login, and automatically opens the account library. The suite never calls
manual sync enable, download or syncNow. Source and saved Workbench still use the
original CAS/receipt HTTP simulator. New RPC and immutable chunk handling are
additive, owner scoped fixtures, not evidence of deployed SQL/RLS enforcement.

`requests` retains the old source/composition ledger. `libraryRequests` records
every new capability/default/catalog/metadata/original RPC separately, including
capability probes. `libraryAssetCalls` records original chunk HTTP calls. The new
suite inspects all of them and blocks external origins and noncontract writes.
No real account, vault, provider, production endpoint or live database is used.

The only static replacement is the existing anonymous platform configuration.
Capability one is never enabled globally. Core raw bytes, IDs and references use
the actual models; saved profile fixture edits use the actual storage API and are
explicitly identified. Failures operate at HTTP boundaries, preserving actual SDK,
durable IndexedDB outboxes and production replication engines.

The folder-availability regression also mounts the real component with synthetic
in-memory Core models and a read-only snapshot adapter. It checks legitimate
missing references, a stale bundle and count-cache invalidation, writes no actual
storage and disposes its temporary host before completion. The main A/B flow
separately checks the actual stored assignments and normal latest-content action.

Run protocol tests without a server: `node --test tests/library-cloud.test.cjs`.
Run the new browser suite only against a loopback development server with
`BASE_URL=... ACCOUNT_LIBRARY_OUTPUT=<fresh-directory> node tests/account-library-browser.cjs`.
Its 15-second timeouts match the existing material browser journeys. CSS viewport
captures are browser evidence, not real mobile-device or OS file-save tests.
