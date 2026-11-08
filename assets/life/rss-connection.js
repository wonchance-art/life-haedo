/* Private RSS inbox transport. Feed text is preserved verbatim; no remote media or public writes. */
(function (root, factory) {
  'use strict';
  // Settings and the account shell can request this lazy module together.
  // Reuse the browser instance; CommonJS fixtures still get their own factory.
  const commonJS = typeof module === 'object' && module.exports;
  const api = !commonJS && root.HaedoLife?.RssConnection?.createReflection ? root.HaedoLife.RssConnection : factory(root);
  (root.HaedoLife ||= {}).RssConnection = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const HASH = /^[a-f\d]{64}$/;
  const STATES = ['pending', 'preview', 'active', 'paused', 'disconnected'];
  const permanentErrors = new Set(['rss_invalid_data', 'rss_invalid_item', 'rss_invalid_hash', 'rss_invalid_result', 'rss_text_limit']);
  const verificationClients = new WeakMap(); let verifierId = 0;
  const messages = {
    rss_cancelled: '계정이나 화면이 바뀌어 이전 작업을 중지했습니다.',
    rss_auth_required: '로그인을 확인한 뒤 다시 시도해 주세요.',
    rss_invalid_data: '받은 자료를 확인하지 못했습니다. 기존 자료는 유지됩니다.',
    rss_invalid_item: '피드 항목 형식을 확인하지 못해 자동 확인을 멈췄습니다. 받은 자료는 유지됩니다.',
    rss_invalid_hash: '피드 본문 검증에 실패해 자동 확인을 멈췄습니다. 받은 자료는 유지됩니다.',
    rss_invalid_result: '수집 결과 형식을 확인하지 못해 자동 확인을 멈췄습니다. 받은 자료는 유지됩니다.',
    rss_text_limit: '수집한 본문이 용량 한도를 넘어 자동 확인을 멈췄습니다. 받은 자료는 유지됩니다.',
    rss_conflict: '다른 화면에서 연결이 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
    rss_network_error: '연결을 완료하지 못했습니다. 입력과 기존 자료는 유지됩니다.',
    network_error: '피드에 일시적으로 연결하지 못했습니다. 받은 자료는 유지됩니다.',
    server_error: '서버에서 수집 처리를 마치지 못했습니다. 상태를 새로고침해 주세요. 받은 자료는 유지됩니다.',
    rate_limited: '피드의 요청 한도에 도달했습니다. 받은 자료는 유지됩니다.',
    rss_setup_required: 'RSS 연결을 준비 중입니다. 피드 주소가 확정되면 연결할 수 있습니다.',
    rss_host_not_allowed: '아직 연결할 수 없는 피드입니다. 확정된 피드 주소를 확인해 주세요.',
    rss_busy: '현재 수집 중입니다. 잠시 뒤 상태를 확인해 주세요.',
    rss_not_due: '다음 확인 시간이 되면 새 글을 확인할 수 있습니다.',
    rss_stale: '연결 상태가 바뀌어 이번 확인 결과를 반영하지 않았습니다. 상태를 새로고침해 주세요.',
    rss_retry_limit: '다시 시도는 1시간에 2회까지 할 수 있습니다. 다음 확인 시간을 기다려 주세요.',
    rss_retry_unavailable: '현재 상태에서는 다시 시도할 수 없습니다. 연결 상태와 피드 범위를 확인해 주세요. 받은 자료는 유지됩니다.',
    rss_invalid_feed: 'RSS/Atom 피드를 읽지 못했습니다. 피드 주소와 형식을 확인해 주세요.',
    rss_connection_exists: '이미 연결된 RSS 피드가 있습니다. 기존 연결의 자료공간에서 상태를 확인해 주세요.',
    rss_not_found: '이 자료공간에서 해당 RSS 연결을 찾지 못했습니다. 연결된 자료공간을 확인해 주세요.',
    baseline_page_limit: '기준 목록이 50쪽 한도에 도달해 자동 확인을 멈췄습니다. 피드 범위를 확인해 주세요.',
    catchup_page_limit: '남은 새 글 확인이 50쪽 한도에 도달해 자동 확인을 멈췄습니다. 받은 자료는 유지됩니다. 피드 범위를 확인해 주세요.',
    baseline_stalled: '새 항목이 없는 빈 쪽이나 반복되는 쪽을 만나 기준 목록 확인을 멈췄습니다. 다시 시도하면 첫 쪽부터 확인합니다. 이미 받은 기준 목록과 자료는 유지됩니다.',
    rss_receive_conflict: '자료 보관을 마치지 못했습니다. 기존 자료는 유지되며 다시 시도할 수 있습니다.',
    rss_unexpected_response: '서버 응답 형식을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요. 받은 자료는 유지됩니다.'
  };
  const fault = code => Object.assign(new Error(messages[code] || messages.rss_network_error), { code });
  function need(ok, code = 'rss_invalid_data') { if (!ok) throw fault(code); }
  // A whole response that is not the inbox envelope (an HTML 200 from a proxy,
  // an empty or reordered page) says nothing about one feed item: retry it
  // with the ordinary backoff. Item and connection data stay permanent.
  const envelope = ok => need(ok, 'rss_unexpected_response');
  // finish stamps fetched_at when it starts; its rows become visible at commit.
  // The worker lease is two minutes, but SQL sets no lock or statement timeout,
  // so a commit can lag its stamp longer. Reread each ACK's lease window every
  // interval for one lease (concurrent finishes), then once after SETTLE_MS
  // before trusting the exact cursor. A later commit than that is not covered.
  const LEASE_MS = 120000, SETTLE_MS = 600000, UNAVAILABLE_AFTER = 5;
  const keyOf = cursor => cursor ? cursor.fetched_at + '|' + cursor.id : null;
  function clean(error) {
    let code = error?.code || error?.error;
    if (typeof code === 'string' && code.startsWith('life_')) code = code.slice(5);
    if (code === 'setup_required' || code === 'not_configured') code = 'rss_setup_required';
    if (code === 'unauthorized') code = 'rss_auth_required';
    code = ({ blocked_url: 'rss_host_not_allowed', revision_conflict: 'rss_conflict', not_due: 'rss_not_due',
      invalid_feed: 'rss_invalid_feed', feed_too_large: 'rss_invalid_data' })[code] || code;
    if (!Object.hasOwn(messages, code) && /^rss_invalid_[a-z_]+$/.test(code || '')) code = 'rss_invalid_result';
    return fault(Object.hasOwn(messages, code) ? code : 'rss_network_error');
  }
  function url(value) {
    need(typeof value === 'string' && value.length <= 8192 && !/[\s\u0000-\u001f\\]/.test(value));
    let parsed; try { parsed = new URL(value); } catch (_) { throw fault('rss_invalid_data'); }
    need(['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password);
    return value;
  }
  const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
  async function hash(text) {
    const bytes = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
  }
  const cursorFor = row => ({ fetched_at: row.fetched_at, id: row.id });
  function cursorTime(value) {
    // PostgreSQL keeps microseconds. Date.parse alone would collapse distinct
    // feed batches in the same millisecond and misorder their UUID tie-breaks.
    const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(value || '');
    need(match && timestamp(value));
    return BigInt(Date.parse(match[1] + match[3])) * 1000n + BigInt((match[2] || '').padEnd(6, '0'));
  }
  function compareCursor(a, b) {
    need(a && b && UUID.test(a.id || '') && UUID.test(b.id || ''));
    const left = cursorTime(a.fetched_at), right = cursorTime(b.fetched_at);
    if (left !== right) return left < right ? -1 : 1;
    const x = a.id.toLowerCase(), y = b.id.toLowerCase(); return x === y ? 0 : x < y ? -1 : 1;
  }
  function overlapCursor(cursor) {
    // finish records its start time, not its commit time. An earlier finish can
    // become visible after a later one: revisit at least the two-minute lease.
    // Round down and include the boundary millisecond regardless of UUID order.
    return cursor ? { fetched_at: new Date(Number(cursorTime(cursor.fetched_at) / 1000n) - LEASE_MS - 1).toISOString(),
      id: '00000000-0000-0000-0000-000000000000' } : null;
  }
  function mergeReceipts(before, received, failedCursor) {
    const result = []; let left = 0, right = 0;
    while (left < before.length || right < received.length) {
      const receipt = right === received.length || left < before.length && compareCursor(before[left].cursor, received[right].cursor) < 0
        ? before[left++] : received[right++];
      // A newly visible failure can precede the old ACK. Keep only the proven
      // prefix; the material itself survives and is deduplicated when retried.
      if (failedCursor && compareCursor(receipt.cursor, failedCursor) >= 0) break;
      result.push(receipt);
    }
    return result;
  }
  function registered(workspaceId, account) {
    if (typeof root.CustomEvent === 'function') root.document?.dispatchEvent?.(new root.CustomEvent('haedo:rss-registered', {
      detail: { workspaceId, projectUrl: account.projectUrl, userId: account.userId }
    }));
  }
  const monotonic = typeof root.performance?.now === 'function' ? () => root.performance.now() : () => Date.now();
  function create({ storage, auth = root.HaedoAuth, core = root.HaedoLife?.Core, workspaceId, isCurrent = () => true,
    clientFactory = root.supabase?.createClient, now = monotonic } = {}) {
    need(storage?.isAccountScoped && storage.account && auth?.verify && auth?.client?.functions?.invoke && core && UUID.test(workspaceId || ''), 'rss_auth_required');
    const owner = { ...storage.account }, client = auth.client, openingEpoch = auth.epoch;
    let disposed = false, generation = 0, reflecting = null, verifier = null;
    // ACKs this open page has seen: key -> { cursor, seenAt, final }. seenAt is
    // this page's monotonic time, never the device clock: server time had already
    // passed the ACK row when the page saw it, so elapsed time bounds commits.
    const watched = new Map();
    function watch(cursor) {
      const key = keyOf(cursor);
      if (key && !watched.has(key)) watched.set(key, { cursor: { fetched_at: cursor.fetched_at, id: cursor.id }, seenAt: now(), final: false });
    }
    function plan(progress) {
      const key = keyOf(progress.cursor);
      for (const [other, entry] of watched) {
        // A rolled-back or restored ACK no longer covers later rows: the exact scan rereads them.
        if (other !== key && (entry.final || !key || compareCursor(entry.cursor, progress.cursor) > 0)) watched.delete(other);
      }
      if (!key) return { scanCursor: null, settling: [] };
      watch(progress.cursor);
      const at = now(), settling = []; let anchor = progress.needsRepair ? progress.cursor : null;
      for (const [other, entry] of watched) {
        if (entry.final) continue;
        const age = at - entry.seenAt;
        if (age > LEASE_MS && age <= SETTLE_MS) continue;
        if (age > SETTLE_MS) settling.push(other);
        if (!anchor || compareCursor(entry.cursor, anchor) < 0) anchor = entry.cursor;
      }
      return { scanCursor: anchor ? overlapCursor(anchor) : { fetched_at: progress.cursor.fetched_at, id: progress.cursor.id }, settling };
    }
    const controllers = new Set();
    const cancel = () => { generation++; controllers.forEach(controller => controller.abort()); controllers.clear(); };
    const unlisten = auth.onAccountChange?.(() => {
      const account = auth.getAccount?.();
      if (auth.epoch !== openingEpoch || account?.userId !== owner.userId || account?.projectUrl !== owner.projectUrl) cancel();
    });
    function guard(token) {
      const account = auth.getAccount?.();
      need(!disposed && token.generation === generation && token.epoch === auth.epoch && isCurrent() &&
        auth.user?.id === owner.userId && account?.userId === owner.userId && account?.projectUrl === owner.projectUrl &&
        (!token.automatic || token.accessToken === undefined || auth.session?.access_token === token.accessToken), 'rss_cancelled');
    }
    const token = () => ({ generation, epoch: auth.epoch });
    async function session(context) {
      guard(context);
      let result;
      try { result = await client.auth.getSession(); }
      catch (error) { guard(context); throw clean(error); }
      guard(context);
      const value = result?.data?.session;
      need(!result?.error && value?.user?.id === owner.userId && typeof value.access_token === 'string' && value.access_token, 'rss_auth_required');
      need(context.accessToken === undefined || context.accessToken === value.access_token, 'rss_cancelled');
      return value.access_token;
    }
    async function step(context, action) {
      guard(context);
      if (context.automatic && context.accessToken !== undefined) await session(context);
      try {
        const result = await action(); guard(context);
        if (context.automatic && context.accessToken !== undefined) await session(context);
        return result;
      } catch (error) {
        guard(context);
        if (context.automatic && context.accessToken !== undefined) await session(context);
        throw error;
      }
    }
    async function verify(context) {
      if (!context.automatic) { need((await step(context, () => auth.verify()))?.id === owner.userId, 'rss_auth_required'); return; }
      if (context.verified) { await session(context); return; }
      context.accessToken = await session(context);
      if (!verifier) {
        need(typeof clientFactory === 'function' && typeof client.supabaseKey === 'string' && client.supabaseKey, 'rss_auth_required');
        // The SDK removes its session on session_not_found, even with an explicit
        // JWT. Keep that side effect in memory, away from the shared Auth store,
        // subscribers and broadcast channel. Manual settings still use verify().
        verifier = verificationClients.get(client);
        if (!verifier) {
          const values = new Map();
          verifier = clientFactory(owner.projectUrl, client.supabaseKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
              storageKey: 'haedo-rss-verifier-' + ++verifierId,
              storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } } }
          });
          verificationClients.set(client, verifier);
        }
      }
      guard(context);
      let result;
      try { result = await verifier.auth.getUser(context.accessToken); }
      catch (error) { guard(context); await session(context); throw clean(error); }
      guard(context); await session(context);
      need(!result?.error && result?.data?.user?.id === owner.userId, 'rss_auth_required');
      context.verified = true;
    }
    function connection(value, elsewhere = false) {
      need(value && UUID.test(value.id || '') && UUID.test(value.workspace_id || '') && (elsewhere ? value.workspace_id !== workspaceId : value.workspace_id === workspaceId) && STATES.includes(value.status) &&
        Number.isSafeInteger(value.revision) && value.revision > 0 && Number.isSafeInteger(value.baseline_count) && value.baseline_count >= 0);
      need(value.failure_count === undefined || Number.isSafeInteger(value.failure_count) && value.failure_count >= 0 && value.failure_count <= 3);
      need(value.auto_retry === undefined || typeof value.auto_retry === 'boolean');
      if (value.auto_retry === true) need(['pending', 'active'].includes(value.status) && ['network_error', 'rate_limited'].includes(value.last_error) &&
        Number.isSafeInteger(value.failure_count) && value.failure_count < 3);
      url(value.feed_url); return { ...value };
    }
    async function snapshot(context, value) {
      envelope(value && typeof value === 'object' && typeof value.configured === 'boolean' && Array.isArray(value.connections) && value.connections.length <= 1000 &&
        Array.isArray(value.items) && value.items.length <= 100);
      const connections = value.connections.map(conn => connection(conn));
      envelope(value.other_connections === undefined || Array.isArray(value.other_connections) && value.other_connections.length <= 1);
      const otherConnections = (value.other_connections || []).map(conn => connection(conn, true));
      let execution = null;
      if (value.execution !== undefined && value.execution !== null) {
        const executionStatus = value.execution.status;
        envelope(['stored', 'partial', 'error', 'stale', 'not_due', 'already_finished', 'busy'].includes(executionStatus));
        execution = { status: executionStatus, ...(value.execution.error ? { error: clean({ error: value.execution.error }).code } : {}) };
      }
      const ids = new Set();
      const items = [];
      for (const row of value.items) {
        need(row && UUID.test(row.id || '') && !ids.has(row.id) && row.owner_id === owner.userId && connections.some(conn => conn.id === row.connection_id) &&
          ['stored', 'held'].includes(row.disposition) && typeof row.identity === 'string' && row.identity.length > 0 && row.identity.length <= 8192 &&
          typeof row.title === 'string' && row.title.length <= 500 && timestamp(row.fetched_at));
        ids.add(row.id);
        if (row.disposition === 'stored') {
          if (row.url !== null) url(row.url);
          need(typeof row.content_text === 'string' && row.content_text.length > 0 && new TextEncoder().encode(row.content_text).length <= 1024 * 1024 &&
            HASH.test(row.content_hash || '') && timestamp(row.published_at));
          need(await step(context, () => hash(row.content_text)) === row.content_hash);
        }
        items.push({ ...row });
      }
      if (value.has_more === true) envelope(value.next_cursor && timestamp(value.next_cursor.fetched_at) && UUID.test(value.next_cursor.id || ''));
      return { configured: value.configured, connections, otherConnections, execution, items, hasMore: value.has_more === true,
        nextCursor: value.has_more === true ? { fetched_at: value.next_cursor.fetched_at, id: value.next_cursor.id } : null };
    }
    async function request(context, action, input = {}) {
      await verify(context);
      const controller = new AbortController(); controllers.add(controller);
      try {
        const response = await step(context, () => client.functions.invoke('haedo-rss', { body: { action, workspaceId, ...input }, signal: controller.signal }));
        if (response.data?.error) throw clean(response.data);
        if (response.error) {
          // FunctionsHttpError carries the response body separately. Only accept known error codes.
          let body; try { body = await step(context, () => response.error.context?.json?.()); } catch (_) { /* retain safe generic message */ }
          // An undeployed Edge function is a setup state, not a feed/network
          // failure to retry every minute. Do not infer it from arbitrary text.
          if (response.error.context?.status === 404 && body?.code === 'NOT_FOUND') throw fault('rss_setup_required');
          throw clean(body || response.error);
        }
        return await step(context, () => snapshot(context, response.data));
      } catch (error) { guard(context); throw clean(error); }
      finally { controllers.delete(controller); }
    }
    async function receive(context, row) {
      const identity = await step(context, () => hash(JSON.stringify([row.connection_id, row.identity])));
      const sourceId = 'rss_' + identity, versionId = 'rssv_' + row.id;
      const sourceKey = 'haedo-rss/' + row.connection_id + '/' + identity + '.txt';
      for (let attempt = 0; attempt < 3; attempt++) {
        const bundle = await step(context, () => storage.read(workspaceId));
        const existing = bundle.sources.find(source => source.id === sourceId);
        if (existing) {
          const version = bundle.sourceVersions.find(value => value.id === versionId && value.sourceId === sourceId);
          need(existing.origin === 'other' && existing.sourceKey === sourceKey);
          if (version) {
            need(version.contentHash === row.content_hash && version.contentText === row.content_text);
            return { sourceId, sourceVersionId: versionId, alreadyReceived: true, bundleRevision: bundle.revision };
          }
          // A new feed revision never restores a source the owner put in the trash.
          if (!core.isSourceActive(bundle, sourceId)) {
            const state = core.sourceState(bundle, sourceId);
            return { materialStatus: 'trashed', sourceId, trashLinkId: state.link.id, trashLinkRevision: state.revision, bundleRevision: bundle.revision };
          }
        }
        const prepared = await step(context, () => core.prepareImport({ origin: 'other', title: row.title || '제목 없는 RSS 글', text: row.content_text,
          ...(row.url === null ? {} : { url: row.url }), fileName: sourceKey, originalCreatedAt: row.published_at, authorRelation: 'unknown', forceSeparate: true,
          coverage: { status: 'partial', omissions: ['피드가 제공한 본문만 보관', '원문 전체·사진·영상·댓글 미확인'] } }, bundle));
        prepared.source.id = sourceId; prepared.source.createdAt = prepared.source.updatedAt = row.fetched_at;
        prepared.version.id = versionId; prepared.version.sourceId = sourceId; prepared.version.importedAt = row.fetched_at;
        if (existing) {
          // Keep the owner's title/metadata and every previous body. Only append this exact feed version.
          prepared.source = { ...existing, revision: existing.revision + 1, updatedAt: existing.updatedAt > row.fetched_at ? existing.updatedAt : row.fetched_at };
          prepared.match = { kind: 'new_revision', sourceId };
        }
        const changes = core.buildImportChanges(bundle, prepared);
        await verify(context);
        const result = await step(context, () => storage.commitLocal({ workspaceId, baseRevision: bundle.revision, operationId: root.crypto.randomUUID(), changes },
          { isCurrent: () => { try { guard(context); return true; } catch (_) { return false; } } }));
        if (result.status === 'conflict') continue;
        need(result.status === 'stored', 'rss_receive_conflict');
        return { sourceId, sourceVersionId: versionId, alreadyReceived: false, bundleRevision: result.revision ?? bundle.revision + 1 };
      }
      throw fault('rss_receive_conflict');
    }
    async function apply(context, page) {
      const items = [], errors = [];
      for (const row of page.items) {
        // Stopping collection never hides already archived items from another device.
        if (row.disposition !== 'stored') { items.push(row); continue; }
        try {
          const result = await receive(context, row);
          items.push({ ...row, ...(result.materialStatus === 'trashed' ? { materialStatus: 'trashed' } : result) });
        }
        catch (error) { guard(context); errors.push(clean(error).message); items.push(row); }
      }
      return { ...page, items, receiveError: errors[0] || null };
    }
    async function run(action, input = {}, onProgress) {
      const context = token();
      // An explicit settings page may display/project that page, but is not
      // proof of a contiguous inbox prefix. In particular, More never ACKs.
      const page = await apply(context, await request(context, action, input));
      onProgress?.(page.items.length);
      return { ...page, checkedItems: page.items.length };
    }
    async function reflectInbox(onProgress) {
      need(typeof storage.readRssInboxProgress === 'function' && typeof storage.saveRssInboxProgress === 'function', 'rss_receive_conflict');
      const context = { ...token(), automatic: true };
      await verify(context);
      let checkedItems = 0, appliedItems = 0, conflicts = 0, restarts = 0, pages = 0, scanCursor, settling = [], expected = null;
      while (true) {
        const progress = await step(context, () => storage.readRssInboxProgress(workspaceId));
        // Another tab may truncate or a restore may invalidate the ACK between
        // pages. Continuing after it would merge later rows across the gap.
        if (scanCursor !== undefined && (progress.revision !== expected.revision || progress.needsRepair || keyOf(progress.cursor) !== expected.key)) {
          if (++restarts > 3) throw fault('rss_receive_conflict');
          scanCursor = undefined;
        }
        if (scanCursor === undefined) ({ scanCursor, settling } = plan(progress));
        expected = { revision: progress.revision, key: keyOf(progress.cursor) };
        const page = await request(context, 'list', scanCursor ? { before: scanCursor } : {});
        const summary = () => ({ configured: page.configured, connections: page.connections, otherConnections: page.otherConnections,
          checkedItems, appliedItems, receiveError: null });
        // Runtime configuration controls future collection, not ownership of
        // archived items. Finish this initial drain even when collection is off;
        // the scheduler then parks until an explicit registration wakes it.
        // p_before is the historical wire name: the SQL list is ASC and >.
        // Validate the whole page before writing any part of this prefix.
        let previous = scanCursor;
        for (const row of page.items) {
          const cursor = cursorFor(row); cursorTime(cursor.fetched_at);
          if (previous) envelope(compareCursor(previous, cursor) < 0);
          previous = cursor;
        }
        if (page.hasMore) envelope(previous && page.items.length > 0 && compareCursor(previous, page.nextCursor) === 0);
        const known = new Map(progress.receipts.map(receipt => [receipt.itemId, receipt]));
        const received = []; let receiveError = null, receiveErrorCode = null, failedCursor = null, blockedItemTitle = null;
        for (const row of page.items) {
          guard(context); checkedItems++;
          try {
            const existing = known.get(row.id);
            if (existing) {
              need(compareCursor(existing.cursor, cursorFor(row)) === 0 &&
                (existing.kind === 'held' ? row.disposition === 'held' : row.disposition === 'stored') &&
                (existing.kind !== 'stored' || existing.contentHash === row.content_hash));
              continue;
            }
            const receipt = { cursor: cursorFor(row), itemId: row.id };
            if (row.disposition === 'held') received.push({ ...receipt, kind: 'held' });
            else {
              const result = await receive(context, row);
              if (result.materialStatus === 'trashed') received.push({ ...receipt, kind: 'trashed', sourceId: result.sourceId,
                trashLinkId: result.trashLinkId, trashLinkRevision: result.trashLinkRevision });
              else {
                received.push({ ...receipt, kind: 'stored', sourceId: result.sourceId, sourceVersionId: result.sourceVersionId, contentHash: row.content_hash });
                if (!result.alreadyReceived) appliedItems++;
              }
            }
          } catch (error) {
            guard(context); const safe = clean(error); receiveError = safe.message; receiveErrorCode = safe.code; failedCursor = cursorFor(row);
            if (permanentErrors.has(safe.code)) blockedItemTitle = row.title;
            break;
          }
        }
        const receipts = mergeReceipts(progress.receipts, received, failedCursor), cursor = receipts.at(-1)?.cursor || null;
        if (received.length || progress.needsRepair || receipts.length !== progress.receipts.length) {
          // Successful material commits precede this separate ACK. A crash or
          // failed ACK only causes deterministic re-receipt, never a skipped row.
          const bundle = await step(context, () => storage.read(workspaceId));
          const saved = await step(context, () => storage.saveRssInboxProgress(workspaceId, { cursor, receipts }, progress.revision,
            { expectedBundleRevision: bundle.revision, isCurrent: () => { try { guard(context); return true; } catch (_) { return false; } } }));
          if (saved.status === 'conflict') {
            if (++conflicts >= 3) throw fault('rss_receive_conflict');
            scanCursor = undefined;
            continue;
          }
          need(saved.status === 'stored', 'rss_receive_conflict'); conflicts = 0;
          expected = { revision: Number.isSafeInteger(saved.revision) ? saved.revision : progress.revision + 1, key: keyOf(cursor) };
        }
        onProgress?.(checkedItems);
        if (!receiveError && !page.hasMore) {
          // This scan began after each settling ACK's margin and read past it.
          for (const key of settling) { const entry = watched.get(key); if (entry) entry.final = true; }
          watch(cursor);
        }
        if (receiveError || !page.hasMore) return { ...summary(), receiveError, receiveErrorCode,
          blockedItemId: permanentErrors.has(receiveErrorCode) ? failedCursor?.id || null : null, blockedItemTitle };
        scanCursor = page.nextCursor;
        if (++pages % 5 === 0) await step(context, () => new Promise(resolve => root.setTimeout(resolve, 0)));
      }
    }
    function reflect(onProgress) {
      if (reflecting) return reflecting;
      const pending = reflectInbox(onProgress); reflecting = pending;
      pending.then(() => { if (reflecting === pending) reflecting = null; }, () => { if (reflecting === pending) reflecting = null; });
      return pending;
    }
    return Object.freeze({
      reflect,
      list: onProgress => run('list', {}, onProgress),
      more: (before, onProgress) => { need(before && timestamp(before.fetched_at) && UUID.test(before.id || '')); return run('list', { before: { fetched_at: before.fetched_at, id: before.id } }, onProgress); },
      register: (value, onProgress) => { url(value); need(new URL(value).protocol === 'https:'); return run('register', { url: value }, onProgress).then(page => { registered(workspaceId, owner); return page; }); },
      action: (action, conn, onProgress) => {
        need(['preview', 'poll', 'activate', 'pause', 'resume', 'retry', 'disconnect'].includes(action));
        need(UUID.test(conn?.id || '') && Number.isSafeInteger(conn.revision) && conn.revision > 0);
        const input = { connectionId: conn.id };
        if (!['preview', 'poll'].includes(action)) input.expectedRevision = conn.revision;
        return run(action, input, onProgress);
      },
      dispose() { disposed = true; cancel(); unlisten?.(); }
    });
  }
  function createReflection({ storage, auth = root.HaedoAuth, core = root.HaedoLife?.Core, isCurrent = () => true, clientFactory = root.supabase?.createClient,
    intervalMs = 60000, polling = true, host = root, now = () => Date.now(), onStatus = () => {} } = {}) {
    need(storage?.isAccountScoped && storage.account && auth?.verify && core, 'rss_auth_required');
    const owner = { ...storage.account }; let openingEpoch = auth.epoch;
    const lifecycle = root.HaedoLife?.SyncLifecycle || (typeof require === 'function' ? require('./sync-lifecycle.js') : null);
    const services = new Map(), targets = new Set();
    let disposed = false, started = false, suspended = false, parked = false, stopped = false, resumePending = false, generation = 0, running = null, wiring = null;
    let nextRetryAt = 0, status = { state: 'idle', checkedItems: 0, receiveError: null };
    // No connection (or only disconnected ones) or collection turned off parks
    // the timer. A connection registered or collection enabled elsewhere is
    // found by a returning wake (page-ready, visible, online), at most once per
    // interval; the timer runs such a wake late but never starts a check itself.
    let idleSince = null, recheckRequested = false;
    // Consecutive temporary failures; the shell shows a non-blocking notice
    // after UNAVAILABLE_AFTER of them (about five minutes) until one succeeds.
    let failureStreak = 0;
    const leaseClock = typeof host.performance?.now === 'function' ? () => host.performance.now() : now;
    function current() {
      const account = auth.getAccount?.();
      return !disposed && !suspended && !parked && isCurrent() && auth.epoch === openingEpoch && auth.user?.id === owner.userId &&
        account?.userId === owner.userId && account?.projectUrl === owner.projectUrl;
    }
    function guard(token) { need(current() && token === generation, 'rss_cancelled'); }
    function publish(token) {
      try { guard(token); Promise.resolve(onStatus({ ...status })).catch(() => {}); }
      catch (_) { /* A status consumer cannot fail or restart collection. */ }
    }
    function cancel() { generation++; for (const service of services.values()) service.dispose(); services.clear(); }
    const unlisten = auth.onAccountChange?.(() => { if (!current()) cancel(); });
    function serviceFor(workspaceId) {
      if (!services.has(workspaceId)) services.set(workspaceId, create({ storage, auth, core, workspaceId, isCurrent: current, clientFactory, now: leaseClock }));
      return services.get(workspaceId);
    }
    function syncNow(workspaceId, { recheck = false } = {}) {
      if (workspaceId !== undefined) { need(UUID.test(workspaceId || '')); targets.add(workspaceId); }
      if (targets.size) { stopped = false; nextRetryAt = 0; idleSince = null; recheckRequested = false; }
      if (running) return running;
      if (!current() || host.navigator?.onLine === false || host.document?.visibilityState === 'hidden') return Promise.resolve({ ...status });
      if (recheck && stopped && idleSince !== null) recheckRequested = true;
      const due = stopped && idleSince !== null && recheckRequested && now() >= idleSince + intervalMs;
      if (stopped && !due || now() < nextRetryAt) return Promise.resolve({ ...status });
      if (due) recheckRequested = false;
      const context = generation, startedAt = now();
      const pending = (async () => {
        let publishable = true;
        // Consume this wake before any await. A failed verification must wait
        // for the next timer/event rather than requeueing itself in finally.
        const requested = [...targets]; targets.clear();
        try {
          // Each inbox request verifies the owner immediately before HTTP.
          // Avoid a second verification just to read local workspace metadata.
          guard(context);
          const active = requested.length ? null : await storage.getActive(); guard(context);
          const queue = requested.length ? requested : active ? [active] : [];
          const seen = new Set(); let connected = false, configured = true, checkedItems = 0, receiveError = null, receiveErrorCode = null, blockedItemId = null, blockedItemTitle = null;
          status = { state: 'reflecting', checkedItems, receiveError, receiveErrorCode, blockedItemId, blockedItemTitle };
          for (let index = 0; index < queue.length; index++) {
            const id = queue[index]; if (seen.has(id)) continue; seen.add(id); guard(context);
            // Server metadata may point at another workspace. The scoped store
            // must prove local ownership before that workspace receives anything.
            await storage.read(id); guard(context);
            const result = await serviceFor(id).reflect(); guard(context);
            checkedItems += result.checkedItems;
            if (result.receiveError && (!receiveError || permanentErrors.has(result.receiveErrorCode) && !permanentErrors.has(receiveErrorCode))) {
              receiveError = result.receiveError; receiveErrorCode = result.receiveErrorCode; blockedItemId = result.blockedItemId; blockedItemTitle = result.blockedItemTitle;
            }
            configured = configured && result.configured;
            // A disabled collector can still own archived items in its actual
            // workspace; finish that one initial receive before parking.
            connected ||= result.connections.some(connection => connection.status !== 'disconnected');
            for (const conn of result.otherConnections) {
              if (!seen.has(conn.workspace_id)) queue.push(conn.workspace_id);
            }
          }
          const blocked = permanentErrors.has(receiveErrorCode);
          stopped = blocked || !configured || !connected && !receiveError;
          nextRetryAt = receiveError && !stopped ? startedAt + intervalMs : 0;
          idleSince = stopped && !blocked ? startedAt : null;
          failureStreak = receiveError && !blocked ? failureStreak + 1 : 0;
          status = { state: blocked ? 'blocked' : stopped ? 'stopped' : receiveError ? 'error' : 'idle', checkedItems, receiveError, receiveErrorCode, blockedItemId, blockedItemTitle,
            unavailable: failureStreak >= UNAVAILABLE_AFTER };
        } catch (error) {
          if (current() && context === generation && error?.code !== 'rss_cancelled') {
            const errorInfo = clean(error);
            const blocked = permanentErrors.has(errorInfo.code);
            // An undeployed or misconfigured service, like a blocked item, waits
            // for an explicit registration or reload rather than returning wakes.
            if (errorInfo.code === 'rss_setup_required' || blocked) { stopped = true; idleSince = null; failureStreak = 0; }
            else {
              nextRetryAt = startedAt + intervalMs; failureStreak++;
              // A recheck that failed temporarily is repeated once on the next due tick.
              if (stopped && idleSince !== null) { idleSince = startedAt; recheckRequested = true; }
            }
            status = { ...status, state: blocked ? 'blocked' : failureStreak ? 'error' : 'stopped', receiveError: errorInfo.message,
              receiveErrorCode: errorInfo.code, blockedItemId: null, blockedItemTitle: null, unavailable: failureStreak >= UNAVAILABLE_AFTER };
          } else publishable = false;
        }
        if (publishable) publish(context); return { ...status };
      })();
      running = pending;
      pending.finally(() => {
        if (running === pending) running = null;
        if ((targets.size || resumePending) && current()) { const recheck = resumePending; resumePending = false; syncNow(undefined, { recheck }); }
      });
      return pending;
    }
    const wake = () => { if (!stopped) syncNow(); };
    // Returning to the page may follow a registration on another device.
    const recheck = () => { syncNow(undefined, { recheck: true }); };
    // The interval only performs a recheck an earlier returning wake asked for.
    const tick = () => { syncNow(); };
    const suspend = () => { suspended = true; cancel(); status = { ...status, state: 'paused' }; };
    const ready = () => {
      const account = auth.getAccount?.();
      // The shell emits ready only after a fresh account verification. A bfcache
      // return advances Auth's epoch even for the same owner; adopt that epoch
      // here, never from an arbitrary account-change notification.
      if (disposed || !isCurrent() || auth.user?.id !== owner.userId || account?.userId !== owner.userId || account?.projectUrl !== owner.projectUrl) return;
      openingEpoch = auth.epoch; suspended = false; parked = false;
      if (running) resumePending = true; else recheck();
    };
    const pagehide = event => { if (event?.persisted) { parked = true; cancel(); } };
    const onRegistered = event => {
      const detail = event?.detail;
      if (detail?.projectUrl !== owner.projectUrl || detail.userId !== owner.userId || !UUID.test(detail.workspaceId || '')) return;
      syncNow(detail.workspaceId);
    };
    function start() {
      if (disposed || started) return; started = true;
      wiring = lifecycle?.attach(host, {
        listen: [['window', 'online', recheck], ['window', 'focus', wake], ['document', 'visibilitychange', recheck],
          ['document', 'haedo:page-suspend', suspend], ['document', 'haedo:page-ready', ready],
          ['document', 'haedo:rss-registered', onRegistered], ['window', 'pagehide', pagehide]],
        poll: polling ? [intervalMs, tick] : null,
      }) || null;
      syncNow();
    }
    function dispose() { if (disposed) return; disposed = true; cancel(); targets.clear(); wiring?.detach(); wiring = null; unlisten?.(); }
    return Object.freeze({ start, syncNow, getStatus: () => ({ ...status }), dispose });
  }
  return Object.freeze({ create, createReflection, fault, messages, messageFor: code => clean({ error: code }).message });
});
