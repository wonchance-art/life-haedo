/* Private RSS inbox transport. Feed text is preserved verbatim; no remote media or public writes. */
(function (root, factory) {
  'use strict';
  const api = factory(root); (root.HaedoLife ||= {}).RssConnection = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const HASH = /^[a-f\d]{64}$/;
  const STATES = ['pending', 'preview', 'active', 'paused', 'disconnected'];
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
    rss_receive_conflict: '자료 보관을 마치지 못했습니다. 기존 자료는 유지되며 다시 시도할 수 있습니다.'
  };
  const fault = code => Object.assign(new Error(messages[code] || messages.rss_network_error), { code });
  function need(ok, code = 'rss_invalid_data') { if (!ok) throw fault(code); }
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
  function create({ storage, auth = root.HaedoAuth, core = root.HaedoLife?.Core, workspaceId, isCurrent = () => true } = {}) {
    need(storage?.isAccountScoped && storage.account && auth?.verify && auth?.client?.functions?.invoke && core && UUID.test(workspaceId || ''), 'rss_auth_required');
    const owner = { ...storage.account }, client = auth.client, openingEpoch = auth.epoch;
    let disposed = false, generation = 0;
    const controllers = new Set();
    const cancel = () => { generation++; controllers.forEach(controller => controller.abort()); controllers.clear(); };
    const unlisten = auth.onAccountChange?.(() => {
      const account = auth.getAccount?.();
      if (auth.epoch !== openingEpoch || account?.userId !== owner.userId || account?.projectUrl !== owner.projectUrl) cancel();
    });
    function guard(token) {
      const account = auth.getAccount?.();
      need(!disposed && token.generation === generation && token.epoch === auth.epoch && isCurrent() &&
        auth.user?.id === owner.userId && account?.userId === owner.userId && account?.projectUrl === owner.projectUrl, 'rss_cancelled');
    }
    const token = () => ({ generation, epoch: auth.epoch });
    async function step(context, action) { guard(context); const result = await action(); guard(context); return result; }
    async function verify(context) { need((await step(context, () => auth.verify()))?.id === owner.userId, 'rss_auth_required'); }
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
      need(value && typeof value.configured === 'boolean' && Array.isArray(value.connections) && value.connections.length <= 1000 &&
        Array.isArray(value.items) && value.items.length <= 100);
      const connections = value.connections.map(conn => connection(conn));
      need(value.other_connections === undefined || Array.isArray(value.other_connections) && value.other_connections.length <= 1);
      const otherConnections = (value.other_connections || []).map(conn => connection(conn, true));
      let execution = null;
      if (value.execution !== undefined && value.execution !== null) {
        const executionStatus = value.execution.status;
        need(['stored', 'partial', 'error', 'stale', 'not_due', 'already_finished', 'busy'].includes(executionStatus));
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
      if (value.has_more === true) need(value.next_cursor && timestamp(value.next_cursor.fetched_at) && UUID.test(value.next_cursor.id || ''));
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
          let body; try { body = await response.error.context?.json?.(); } catch (_) { /* retain safe generic message */ }
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
            return { sourceId, sourceVersionId: versionId, alreadyReceived: true };
          }
          // A new feed revision never restores a source the owner put in the trash.
          if (!core.isSourceActive(bundle, sourceId)) return { materialStatus: 'trashed' };
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
        return { sourceId, sourceVersionId: versionId, alreadyReceived: false };
      }
      throw fault('rss_receive_conflict');
    }
    async function apply(context, page) {
      const items = [], errors = [];
      for (const row of page.items) {
        // Stopping collection never hides already archived items from another device.
        if (row.disposition !== 'stored') { items.push(row); continue; }
        try { items.push({ ...row, ...await receive(context, row) }); }
        catch (error) { guard(context); errors.push(clean(error).message); items.push(row); }
      }
      return { ...page, items, receiveError: errors[0] || null };
    }
    async function run(action, input = {}, onProgress) {
      const context = token();
      const first = await apply(context, await request(context, action, input));
      let page = first, count = first.items.length, pages = 1;
      const cursors = new Set();
      // Keep only the visible page. Drain the server inbox in bounded pages so
      // the 101st item reaches materials/search without a separate user action.
      while (page.hasMore && !page.receiveError) {
        guard(context);
        const key = JSON.stringify(page.nextCursor); need(!cursors.has(key)); cursors.add(key);
        onProgress?.(count);
        if (pages % 5 === 0) await step(context, () => new Promise(resolve => setTimeout(resolve, 0)));
        page = await apply(context, await request(context, 'list', { before: page.nextCursor }));
        count += page.items.length; pages++;
      }
      // Never persist a cursor after a failed projection. Refresh replays the
      // immutable inbox and deterministic source/version IDs safely.
      return { ...first, receiveError: page.receiveError || first.receiveError, checkedItems: count };
    }
    return Object.freeze({
      list: onProgress => run('list', {}, onProgress),
      more: (before, onProgress) => { need(before && timestamp(before.fetched_at) && UUID.test(before.id || '')); return run('list', { before: { fetched_at: before.fetched_at, id: before.id } }, onProgress); },
      register: (value, onProgress) => { url(value); need(new URL(value).protocol === 'https:'); return run('register', { url: value }, onProgress); },
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
  return Object.freeze({ create, fault, messages, messageFor: code => clean({ error: code }).message });
});
