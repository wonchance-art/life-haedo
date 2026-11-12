/* Read-only private home. Uses saved records and page selections; never publishes. */
(function (global) {
  'use strict';
  const life = global.HaedoLife = global.HaedoLife || {};
  function el(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  // Content of a post that a backup restore carries over unchanged. Identity,
  // revision, times and photo IDs are new in a copy, so they are left out;
  // photos are compared by their recorded digests, in order.
  function restoredContent(doc) {
    const order = new Map((doc.photos || []).map((photo, index) => [photo.id, index]));
    const ops = (life.PhotoPost.contentOps(doc) || []).map(op => op?.insert?.photo ? { ...op, insert: { photo: { ...op.insert.photo, id: order.get(op.insert.photo.id) ?? null } } } : op);
    const photos = (doc.photos || []).map(photo => [photo.name, photo.type, photo.width, photo.height, photo.size, photo.digest,
      photo.view ? [photo.view.type, photo.view.width, photo.view.height, photo.view.size, photo.view.digest] : null]);
    return JSON.stringify([doc.title, doc.status, doc.archived === true, ops, photos, doc.attachments || []]);
  }
  const indexKey = row => JSON.stringify([row.title, row.status, row.archived === true, row.body, row.photos, row.attachments || 0]);
  // Which listed posts are a backup restore's unchanged copy of a post that is
  // also listed. A copy (its restored-copy marker, never its title) is paired
  // with the workspace it names when that workspace is listed and eligible.
  // Posts pair one to one and only when their content is identical, so a post
  // changed after the backup, or deleted from the original, stays listed.
  // Each group of equal posts keeps one: the open library's, otherwise the one
  // nearest the original. A post is only ever left out for a listed equal one.
  //
  // Cost: only posts whose list row (title, state, text, counts) equals a row
  // on the other side are read, all of one workspace in one read
  // (`readDocs(ws, ids)` → docs or null, in order). `cache` (a Map kept by
  // the home view) holds each read post's content by ID, revision and update
  // time, so a later pass reads only posts that changed.
  async function restoredDuplicates(libraries, lists, workspaceId, readDocs, cache = new Map()) {
    const byId = new Map(libraries.map(item => [item.workspaceId, item]));
    const sourceOf = id => {
      const source = byId.get(id)?.restoredCopy?.sourceWorkspaceId;
      return source && source !== id && lists.has(source) && byId.get(source)?.eligible !== false ? source : null;
    };
    // A marker loop (A names B, B names A) ends at the first repeat.
    const depth = (id, seen = new Set()) => { const source = sourceOf(id); if (!source || seen.has(id)) return 0; seen.add(id); return 1 + depth(source, seen); };
    const parent = new Map(), key = (ws, id) => ws + '/' + id;
    const find = item => { while (parent.get(item) !== item) item = parent.get(item); return item; };
    const join = (a, b) => { for (const item of [a, b]) if (!parent.has(item)) parent.set(item, item); const x = find(a), y = find(b); if (x !== y) parent.set(x, y); };
    const version = (ws, row) => JSON.stringify([ws, row.id, row.revision, row.updatedAt]);
    // Rows of each pair whose list row has an equal on the other side.
    // `known` is this pass's own view, so another pass pruning the shared cache cannot change it.
    const pairs = [], wanted = new Map(), used = new Set(), known = new Map();
    for (const [copy, rows] of lists) {
      const source = sourceOf(copy); if (!source) continue;
      const free = new Map();
      for (const row of lists.get(source)) { const k = indexKey(row); if (!free.has(k)) free.set(k, []); free.get(k).push(row); }
      const want = (ws, row) => { const v = version(ws, row); used.add(v); if (cache.has(v)) { known.set(v, cache.get(v)); return; } if (!wanted.has(ws)) wanted.set(ws, new Map()); wanted.get(ws).set(row.id, v); };
      for (const row of rows) {
        const candidates = free.get(indexKey(row)); if (!candidates?.length) continue;
        want(copy, row); for (const candidate of candidates) want(source, candidate);
      }
      pairs.push({ copy, source, rows, free });
    }
    for (const [ws, rows] of wanted) {
      const ids = [...rows.keys()];
      let docs; try { docs = await readDocs(ws, ids); } catch (_) { docs = []; }
      ids.forEach((id, i) => {
        let value = null; try { value = docs?.[i] ? restoredContent(docs[i]) : null; } catch (_) { value = null; }
        // An unreadable post is not remembered, so it is read again next time.
        if (value !== null) { cache.set(rows.get(id), value); known.set(rows.get(id), value); }
      });
    }
    for (const item of [...cache.keys()]) if (!used.has(item)) cache.delete(item);
    const contentOf = (ws, row) => known.get(version(ws, row)) ?? null;
    for (const { copy, source, rows, free } of pairs) {
      for (const row of rows) {
        const candidates = free.get(indexKey(row)); if (!candidates?.length) continue;
        const mine = contentOf(copy, row); if (mine === null) continue;
        for (let i = 0; i < candidates.length; i++) {
          if (contentOf(source, candidates[i]) !== mine) continue;
          join(key(copy, row.id), key(source, candidates[i].id)); candidates.splice(i, 1); break;
        }
      }
    }
    const groups = new Map();
    for (const item of parent.keys()) { const root = find(item); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(item); }
    const order = [...lists.keys()], wsOf = item => item.slice(0, item.indexOf('/'));
    const rank = item => [wsOf(item) === workspaceId ? 0 : 1, depth(wsOf(item)), order.indexOf(wsOf(item))];
    const before = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
    const hidden = new Set();
    for (const members of groups.values()) {
      const keep = members.slice().sort(before)[0];
      // The open library's own posts are always listed.
      for (const item of members) if (item !== keep && wsOf(item) !== workspaceId) hidden.add(item);
    }
    return hidden;
  }
  // Posts and drafts of every library this account owns (2026-11-01: one
  // account, one blog). Each row keeps its own workspaceId. Without an account
  // scope only the open library is listed, as before. Recovery copies are left
  // out unless one is the open library. A backup restore's unchanged copy of a
  // listed post is listed once (see restoredDuplicates); this changes only the
  // list, never sync, backup or the copy itself. A library that cannot be read
  // is reported as `failed`; the readable ones are still listed.
  // Publication of every listed post as this device knows it (BlogSync's local record, no
  // request): ws/id -> 'public' | 'unknown'; a post not named is not public. A library whose
  // record cannot be read names nothing, and its posts keep the label they had before.
  async function publicationOf(storage, ids) {
    const known = new Map();
    if (typeof storage.listBlogSyncStates !== 'function') return known;
    const status = life.BlogSync?.publicationStatus || (state => state?.publication?.active === true ? 'public' : 'private');
    const lists = await Promise.allSettled(ids.map(id => Promise.resolve().then(() => storage.listBlogSyncStates(id))));
    lists.forEach((result, index) => {
      if (result.status !== 'fulfilled' || !Array.isArray(result.value?.states)) return;
      for (const entry of result.value.states) { const value = status(entry.state); if (value !== 'private') known.set(ids[index] + '/' + entry.localPostId, value); }
    });
    return known;
  }
  // Posts and drafts of one library are capped (storage writePhotoPost, `photo_post_limit`: a write
  // that would make a library's list longer than 200, for a post or draft started on this device).
  // From 190 on, the list says how many are left; at the cap, how many to delete and where they are.
  // The count is the library's whole list, as the cap counts it (hidden, empty and restored-copy rows too).
  const POST_LIMIT = 200, POST_LIMIT_NOTICE = 190;
  function postCapacity(count) {
    if (!Number.isSafeInteger(count) || count < POST_LIMIT_NOTICE) return null;
    return { count, limit: POST_LIMIT, remaining: Math.max(0, POST_LIMIT - count), full: count >= POST_LIMIT, toDelete: Math.max(0, count - POST_LIMIT + 1) };
  }
  // What the line says; `drafts`: how many of the counted rows are drafts (what to delete first).
  function limitText(capacity, drafts) {
    const head = '글·초안 ' + capacity.count + '/' + capacity.limit + '개 · ';
    if (!capacity.full) return head + capacity.remaining + '개 더 저장할 수 있어요.';
    const what = drafts >= capacity.toDelete ? '쓰지 않는 초안이나 복구 사본을' : drafts > 0 ? '초안 ' + drafts + '개와 쓰지 않는 글을 합쳐' : '쓰지 않는 글을';
    return head + '새 글을 저장하려면 ' + what + ' ' + capacity.toDelete + '개 지워 주세요.';
  }
  async function listAccountPosts(storage, workspaceId, { contentCache } = {}) {
    let ids = [workspaceId], libraries = [];
    if (typeof storage.listAccountLibraries === 'function') {
      try {
        libraries = await storage.listAccountLibraries();
        if (libraries.some(item => item.workspaceId === workspaceId)) ids = [...new Set([workspaceId, ...libraries.filter(item => item.eligible !== false).map(item => item.workspaceId)])];
        else libraries = [];
      } catch (error) { if (error?.code !== 'auth_scope_required') throw error; }
    }
    const lists = await Promise.allSettled(ids.map(id => storage.listPhotoPosts(id)));
    if (lists[0].status !== 'fulfilled') throw lists[0].reason;
    const read = new Map();
    lists.forEach((result, index) => { if (result.status === 'fulfilled' && Array.isArray(result.value)) read.set(ids[index], result.value); });
    let hidden = new Set();
    if (libraries.some(item => item.restoredCopy) && (typeof storage.readPhotoPosts === 'function' || typeof storage.readPhotoPost === 'function')) {
      const readDocs = typeof storage.readPhotoPosts === 'function' ? (ws, ids) => storage.readPhotoPosts(ws, ids)
        : (ws, ids) => Promise.all(ids.map(id => storage.readPhotoPost(ws, id).catch(() => null)));
      // An unexpected failure lists every post rather than hiding any.
      try { hidden = await restoredDuplicates(libraries, read, workspaceId, readDocs, contentCache); }
      catch (_) { hidden = new Set(); }
    }
    const posts = [], publication = await publicationOf(storage, [...read.keys()]);
    for (const [ws, rows] of read) posts.push(...rows.filter(post => !hidden.has(ws + '/' + post.id)).map(post => ({ ...post, workspaceId: ws, publication: publication.get(ws + '/' + post.id) || 'private' })));
    // counts: each read library's whole list, as the cap counts it (postCapacity).
    return { posts, failed: lists.some(result => result.status !== 'fulfilled' || !Array.isArray(result.value)), workspaces: ids,
      counts: Object.fromEntries([...read].map(([ws, rows]) => [ws, rows.length])),
      drafts: Object.fromEntries([...read].map(([ws, rows]) => [ws, rows.filter(row => row.status === 'draft').length])) };
  }
  // A row's date and its full form. Formatters are made once (2026-11-04: two new
  // Intl.DateTimeFormat per row were ~3% of the main thread while the first list was drawn);
  // the strings are the same as formatting with a new formatter each time.
  // A formatter keeps the time zone it was made in, so the cache is keyed by the device's zone. Asking
  // for the zone name costs about as much as a new formatter; it is asked again only when the current
  // UTC offset changes (an open PWA moved to another zone) or a minute has passed.
  const dateFormats = new Map();
  let zoneProbe = { offset: null, at: 0, zone: '' };
  function deviceZone() {
    const offset = new Date().getTimezoneOffset(), at = Date.now();
    if (offset !== zoneProbe.offset || !(at - zoneProbe.at < 60000)) zoneProbe = { offset, at, zone: new Intl.DateTimeFormat().resolvedOptions().timeZone || '' };
    return zoneProbe.zone;
  }
  function dateFormat(withYear) {
    const key = deviceZone() + '|' + withYear;
    if (!dateFormats.has(key)) dateFormats.set(key, new Intl.DateTimeFormat('ko-KR', withYear ? { year: 'numeric', month: 'long', day: 'numeric' } : { month: 'long', day: 'numeric' }));
    return dateFormats.get(key);
  }
  function dateLabels(value, prefix = '수정 ', now = new Date()) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return { text: prefix + dateFormat(date.getFullYear() !== now.getFullYear()).format(date), title: prefix + dateFormat(true).format(date) };
  }
  // 2026-11-08 일정 통합 정리 S3: the list is posts only. 프로필 편집 and 계정 보관 상태 live in the
  // heading's 글 메뉴, 글쓰기 in the global menu, and the former 자료 entry block in the global 자료.
  function create({ storage, core, host, getBundle, navigate, openSource, openPostInWorkspace = null, isDisposed = () => false, announce = () => {} }) {
    let disposed = false, generation = 0, visible = false;
    // Post contents compared for restore copies, by ID/revision/update time; this view's storage only.
    const contentCache = new Map();
    const mediaUrls = new Set();
    let mediaObserver = null, mediaGeneration = 0, stopWatch = null, watchTimer = null, stopPublic = null, publicTimer = null;
    // The server refused a deletion sent from this device (the post is public there: another device
    // published it before this one knew) and the post came back. Said once on this list, until 확인.
    let refusedDelete = false;
    const REFUSED_DELETE = '공개 중인 글이라 서버에서 삭제하지 않았어요. 다음 동기화에서 이 글을 다시 받아요. 공개를 철회한 뒤 삭제해 주세요.';
    // cap: only the rows the 200 cap counts (this library's posts and drafts), set by the cap notice's
    // buttons: true, or 'copies' (and only the recovery copies, while the search is the copies' words).
    // It holds only while the notice is shown (updateList clears it when the count drops below 190).
    let listState = { workspaceId: null, tab: 'posts', query: '', searchExpanded: false, limit: 20, cap: false };
    const ROW_LIMIT = 20;
    const TAB_LABELS = { posts: '글', drafts: '초안', archive: '숨긴 글' };
    // ≥761px the posts search is an always-visible field; ≤760 it opens from the tab row's icon.
    const wideSearch = global.matchMedia?.('(min-width: 761px)') || null;
    let wideListener = null, searchContext = null;
    const searchAlwaysShown = () => !!wideSearch?.matches;
    function captureState() { return { ...listState }; }
    function adoptState(workspaceId, incoming) {
      if (listState.workspaceId !== workspaceId) listState = { workspaceId, tab: 'posts', query: '', searchExpanded: false, limit: ROW_LIMIT, cap: false };
      if (incoming?.workspaceId !== workspaceId) return;
      listState = { workspaceId, tab: Object.hasOwn(TAB_LABELS, incoming.tab) ? incoming.tab : 'posts',
        query: typeof incoming.query === 'string' ? incoming.query.slice(0, 1000) : '',
        searchExpanded: incoming.searchExpanded === true || (typeof incoming.query === 'string' && !!incoming.query.trim()),
        limit: Number.isSafeInteger(incoming.limit) ? Math.max(ROW_LIMIT, Math.min(incoming.limit, 10000)) : ROW_LIMIT, cap: incoming.cap === true || incoming.cap === 'copies' ? incoming.cap : false };
    }
    function clearMedia() {
      mediaGeneration += 1; mediaObserver?.disconnect(); mediaObserver = null;
      mediaUrls.forEach(url => URL.revokeObjectURL(url)); mediaUrls.clear();
    }
    function initials(name) { return !name || name === '내 블로그' ? '나' : Array.from(String(name).replace(/\s+/g, '')).slice(0, 2).join(''); }
    function avatar(context) {
      const mark = el('span', initials(context.profile.name), 'home-avatar');
      mark.setAttribute('aria-hidden', 'true'); return mark;
    }
    const alive = () => !disposed && !isDisposed();
    const showing = context => alive() && visible && context.token === generation && getBundle()?.workspaceId === context.workspaceId && context.surface.parentNode === host;
    function action(context, label, task, className = '', { keepFocus = true } = {}) {
      const button = el('button', label, 'life-button' + (className ? ' ' + className : ''));
      button.type = 'button';
      let running = false;
      button.addEventListener('click', async () => {
        if (running || !showing(context) || !button.isConnected) return;
        running = true;
        // Navigation captures the focused entry before removing this view.
        // Native disabled would blur that button before its focus key is read.
        if (keepFocus) {
          button.focus({ preventScroll: true });
          button.setAttribute('aria-busy', 'true');
        }
        else button.disabled = true;
        try { await task(); }
        catch (_) {
          if (showing(context)) {
            context.error.hidden = false;
            context.error.textContent = '화면을 열지 못했습니다. 저장 상태를 확인한 뒤 다시 시도해 주세요.';
          }
        } finally { running = false; if (button.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); } }
      });
      return button;
    }
    function iconAction(context, label, glyph, task) {
      const button = action(context, '', task, 'life-icon-button');
      button.setAttribute('aria-label', label); button.title = label;
      button.append(life.Icons.create(glyph), el('span', label, 'life-tooltip'));
      return button;
    }
    function section(context, title, id) {
      const container = el('section', null, 'home-section'); container.id = id;
      const heading = el('div', null, 'home-section-heading');
      const name = el('h2', title); name.id = id + 'Title';
      name.tabIndex = -1;
      container.setAttribute('aria-labelledby', name.id);
      heading.append(name);
      container.append(heading);
      return container;
    }
    function sourceInfo(versionId, bundle = getBundle()) {
      const version = bundle?.sourceVersions.find(item => item.id === versionId);
      const source = version && bundle.sources.find(item => item.id === version.sourceId);
      return source && version ? { source, version } : null;
    }
    function snippet(text) {
      const normalized = String(text || '').replace(/\s+/g, ' ').trim();
      const characters = Array.from(normalized);
      return characters.length > 200 ? characters.slice(0, 200).join('') + '…' : normalized;
    }
    async function openVersion(context, versionId) {
      if (!showing(context)) return;
      const info = sourceInfo(versionId);
      if (!info) {
        announce('연결된 원문이 없습니다. 다른 버전으로 바꾸지 않았습니다.');
        return;
      }
      await openSource(info.source.id, info.version.id);
    }
    function profileHeader(context) {
      const header = el('div', null, 'home-profile-bar');
      const profile = el('div', null, 'home-profile-open');
      profile.append(avatar(context), el('h2', context.profile.name, 'home-author-name'));
      const copy = el('div', null, 'home-profile-copy');
      const intro = el('p', '', 'home-blog-description'); intro.hidden = true;
      copy.append(profile, intro);
      header.append(copy); return header;
    }
    function latestOwnPosts(bundle) {
      const rows = [];
      bundle.sources.filter(source => core.isSourceActive(bundle, source.id) && life.Writing?.isOwnSource(source, bundle)).forEach(source => {
        const version = life.Writing.latestVersion(bundle, source.id);
        if (version) rows.push({ id: source.id, kind: 'source', title: source.title, body: version.contentText, updatedAt: version.importedAt, versionId: version.id });
      });
      return rows;
    }
    function postCover(context, row, article, open) {
      // `article` is the row's content column (2026-11-02 일정 목록: time · icon · content).
      if (row.kind !== 'photo' || !row.photos) return;
      const epoch = mediaGeneration;
      const frame = action(context, '', open, 'home-post-media');
      frame.setAttribute('aria-label', '사진이 있는 글 열기'); frame.dataset.focusKey = 'home:photo:' + row.id;
      frame.setAttribute('aria-busy', 'true');
      const image = el('img', null, 'home-post-cover'); image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
      const status = el('span', '사진 불러오는 중…', 'life-meta home-photo-loading');
      frame.append(status); article.append(frame);
      const current = () => showing(context) && epoch === mediaGeneration && frame.isConnected;
      const removeCover = () => {
        if (!current()) return;
        frame.setAttribute('aria-busy', 'false');
        frame.replaceChildren(el('span', '사진을 표시하지 못했어요. 글을 열어 확인해 주세요.', 'life-meta home-photo-error'));
      };
      const readCover = async () => {
        if (!current()) return;
        try {
          const doc = await storage.readPhotoPost(row.workspaceId || context.workspaceId, row.id);
          if (!current()) return;
          if (doc.status !== 'saved' || doc.archived !== !!row.archived) throw new Error('post_changed');
          const embedded = life.PhotoPost.contentOps(doc).find(op => op.insert?.photo)?.insert.photo;
          const photo = doc.photos.find(item => item.id === embedded?.id);
          // HEIC originals are displayed through their JPEG view.
          const display = photo?.view?.blob ?? photo?.blob;
          if (!display) throw new Error('photo_missing');
          const url = URL.createObjectURL(display); mediaUrls.add(url);
          image.alt = embedded.alt || embedded.caption || '';
          image.addEventListener('load', () => { if (current()) frame.setAttribute('aria-busy', 'false'); }, { once: true });
          image.addEventListener('error', () => {
            removeCover(); URL.revokeObjectURL(url); mediaUrls.delete(url);
          }, { once: true });
          image.src = url; frame.replaceChildren(image);
        } catch (_) { removeCover(); }
      };
      if (typeof global.IntersectionObserver === 'function') {
        if (!mediaObserver) mediaObserver = new global.IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            mediaObserver?.unobserve(entry.target);
            const loadCover = entry.target._homeLoadCover;
            delete entry.target._homeLoadCover; loadCover?.();
          });
        }, { rootMargin: '320px 0px' });
        frame._homeLoadCover = readCover; mediaObserver.observe(frame);
      } else Promise.resolve().then(readCover);
    }
    function modifiedDate(value, prefix = '수정 ') {
      const labels = dateLabels(value, prefix);
      if (!labels) return null;
      const time = el('time', labels.text);
      time.dateTime = value;
      time.title = labels.title;
      return time;
    }
    // 일정 목록 rows: a time column and an icon column before the content (decision 2026-11-02).
    function rowTime(value) {
      const text = life.ScheduleData?.timeOf(value) || '';
      const time = el('span', text, 'home-row-time'); if (!text) time.setAttribute('aria-hidden', 'true');
      return time;
    }
    function rowMark(glyph) { const mark = el('span', null, 'home-row-mark'); mark.setAttribute('aria-hidden', 'true'); mark.append(life.Icons.create(glyph)); return mark; }
    function dayHeading(value) {
      const day = life.ScheduleData?.dayOf(value);
      if (!day) return el('h2', '날짜 미확인', 'home-day-heading');
      const heading = el('h2', life.ScheduleData.dayTitle(day), 'home-day-heading'); heading.dataset.day = day;
      return heading;
    }
    function blogPost(context, row) {
      const article = el('article', null, 'home-post'); article.dataset.homeKind = row.kind;
      const target = row.kind === 'photo' ? { photoPostId: row.id } : { postId: row.id };
      if (row.kind === 'photo') { article.dataset.photoPostId = row.id; article.dataset.workspaceId = row.workspaceId || context.workspaceId; }
      else if (row.kind === 'source') { article.dataset.sourceId = row.id; article.dataset.versionId = row.versionId; }
      else article.dataset.postId = row.id;
      const open = () => row.kind === 'source' ? openVersion(context, row.versionId) : row.kind === 'photo' ? openPhoto(context, row) : navigate('page', { blogContext: true, pagePreview: false, searchTarget: target });
      const meta = el('p', null, 'life-meta home-post-meta');
      const time = modifiedDate(row.updatedAt, row.kind === 'source' ? '저장 ' : '수정 ');
      if (time) meta.append(time, document.createTextNode(' · '));
      // A post's original always stays private; a public copy, when there is one, is named
      // next to it. An unanswered publish or withdrawal is said as not confirmed, never as private.
      const visibility = row.kind !== 'photo' ? (row.kind === 'source' ? '기록 글 · 비공개' : '첨부 글 · 비공개')
        : row.publication === 'public' ? '공개 중 · 원본은 비공개' : row.publication === 'unknown' ? '공개 확인 못 함 · 원본은 비공개' : '비공개 원본';
      const shownVisibility = el('span', visibility, 'home-post-visibility'); if (row.kind === 'photo') shownVisibility.dataset.publication = row.publication || 'private';
      meta.append(shownVisibility);
      const content = el('div', null, 'home-post-content'), heading = el('h3');
      const label = String(row.title || '').trim() || (snippet(row.body) || row.attachments?.[0]?.title || '사진이 있는 글');
      const button = action(context, label, open, 'home-post-open' + (row.kind === 'plain' || !String(row.title || '').trim() ? ' home-post-prose' : ''));
      button.dataset.focusKey = 'home:post:' + row.kind + ':' + row.id;
      heading.append(button); content.append(heading);
      if (row.kind !== 'plain' && String(row.title || '').trim() && row.body?.trim()) content.append(el('p', snippet(row.body), 'home-text home-post-excerpt'));
      if (row.kind === 'plain' && row.attachments?.length) {
        const attached = el('p', row.attachments.map(item => item.title).join(' · '), 'home-post-attachments');
        content.append(attached);
      }
      const body = el('div', null, 'home-post-body');
      body.append(content); postCover(context, row, body, open);
      const footer = el('div', null, 'home-post-footer');
      const read = action(context, '글 읽기', open, 'home-post-read'); read.dataset.focusKey = 'home:read:' + row.kind + ':' + row.id;
      read.append(life.Icons.create('arrow'));
      footer.append(meta, read); body.append(footer);
      article.append(rowTime(row.updatedAt), rowMark(row.kind === 'source' ? 'book' : 'edit'), body);
      return article;
    }
    // One account, one blog: a post kept in another library of this account
    // opens there, so editing, deleting and publishing use its own library.
    function openPhoto(context, row) {
      const target = { photoPostId: row.id };
      if (!row.workspaceId || row.workspaceId === context.workspaceId) return navigate('page', { blogContext: true, pagePreview: false, searchTarget: target });
      if (typeof openPostInWorkspace !== 'function') throw new Error('post_workspace_unavailable');
      return openPostInWorkspace(row.workspaceId, target);
    }
    function openRow(context, row) {
      if (row.kind === 'source-draft') return navigate('write', { writing: { stageId: row.id } });
      if (row.kind === 'plain-draft') return navigate('page', { blogContext: true, pageDraftId: row.id });
      return openPhoto(context, row);
    }
    function draftRow(context, row) {
      const article = el('article', null, 'home-draft');
      article.dataset.draftId = row.id; article.dataset.draftKind = row.kind;
      if (row.kind === 'photo-draft') article.dataset.workspaceId = row.workspaceId || context.workspaceId;
      const open = action(context, '', () => openRow(context, row), 'home-draft-open');
      open.dataset.focusKey = 'home:draft:' + row.kind + ':' + row.id;
      const copy = el('span', null, 'home-draft-copy');
      copy.append(el('span', row.editing === true ? '기존 글 수정 중' : row.editing === false ? '새 글 초안' : '작성 중인 글', 'life-meta'),
        el('strong', String(row.title || '').trim() || snippet(row.body) || '내용을 기다리는 초안'));
      if (row.title?.trim() && row.body?.trim()) copy.append(el('span', snippet(row.body), 'home-draft-excerpt'));
      const time = modifiedDate(row.updatedAt);
      if (time) { time.className = 'life-meta'; copy.append(time); }
      open.append(copy, el('span', '이어쓰기', 'home-draft-resume')); article.append(rowTime(row.updatedAt), rowMark('write'), open); return article;
    }
    function resultRows(context) {
      const rows = latestOwnPosts(getBundle()), errors = [];
      context.workbenchState = null;
      const { results } = context;
      const read = (key, label, use) => {
        const result = results[key];
        if (result?.status === 'fulfilled') { try { use(result.value); } catch (_) { errors.push({ key, label }); } }
        else errors.push({ key, label });
      };
      read('workbench', '기존 글', state => {
        if (state.workspaceId !== context.workspaceId) throw new Error('workspace_mismatch');
        life.Workbench.validate(state); context.workbenchState = state;
        rows.push(...(state.page.posts || []).filter(post => post.status === 'saved').map(post => ({ ...post, kind: 'plain', tab: 'posts' })));
        const title = String(state.page.title || '').trim();
        context.profile.name = title && title !== '내 페이지' ? title : '내 블로그';
        context.surface.querySelectorAll('.home-author-name').forEach(node => { node.textContent = context.profile.name; });
        context.surface.querySelectorAll('.home-avatar').forEach(node => { node.textContent = initials(context.profile.name); });
        const intro = context.surface.querySelector('.home-blog-description');
        intro.textContent = state.page.showIntro ? snippet(state.page.intro) : '';
        intro.hidden = !intro.textContent;
      });
      read('photo', '글·초안·숨긴 글', value => {
        if (!Array.isArray(value?.posts)) throw new Error('invalid_posts');
        // A draft with nothing in it is not something to resume: it is neither the 작성하던 글
        // strip nor a row of the 초안 tab (the editor removes it on closing; 글쓰기 reuses one left over).
        const blank = post => post.status === 'draft' && !post.archived && !String(post.title || '').trim() && !String(post.body || '').trim() && !post.photos && !post.attachments;
        rows.push(...value.posts.filter(post => !blank(post)).map(post => ({ ...post, kind: post.status === 'draft' ? 'photo-draft' : 'photo',
          tab: post.archived ? 'archive' : post.status === 'draft' ? 'drafts' : 'posts', editing: context.photoDrafts.get(post.workspaceId + ':' + post.id) })));
        if (value.failed) errors.push({ key: 'photo', label: '일부 자료공간의 글' });
      });
      read('plainDrafts', '첨부 글 초안', drafts => {
        life.PagePosts.validate(drafts.posts);
        rows.push(...drafts.posts.map(post => ({ ...post, kind: 'plain-draft', tab: 'drafts', editing: !!post.replaces })));
      });
      read('sourceDrafts', '기록 글 초안', stages => {
        rows.push(...stages.filter(stage => life.Writing?.isDraft(stage) && stage.state === 'draft').map(stage => ({ ...stage,
          id: stage.stageId, body: stage.text, kind: 'source-draft', tab: 'drafts', editing: !!stage.sourceId })));
      });
      context.profileStatus.hidden = !!context.workbenchState;
      rows.forEach(row => { if (!row.tab) row.tab = 'posts'; });
      const timestamp = row => Number.isFinite(Date.parse(row.updatedAt)) ? Date.parse(row.updatedAt) : 0;
      rows.sort((a, b) => timestamp(b) - timestamp(a) || (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id));
      return { rows, errors };
    }
    function listControls(context, area) {
      const controls = el('div', null, 'home-list-controls');
      const tabs = el('div', null, 'home-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '내 글 상태');
      for (const [key, label] of Object.entries(TAB_LABELS)) {
        const button = action(context, label, () => {
          listState.tab = key; listState.cap = false; listState.limit = ROW_LIMIT; updateList(context, true);
        }, 'home-tab');
        button.id = 'homeTab-' + key; button.dataset.homeTab = key; button.dataset.focusKey = 'home:tab:' + key;
        button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'homePostList');
        button.addEventListener('keydown', event => {
          const keys = Object.keys(TAB_LABELS), at = keys.indexOf(listState.tab);
          const next = event.key === 'ArrowRight' ? keys[(at + 1) % keys.length] : event.key === 'ArrowLeft' ? keys[(at + keys.length - 1) % keys.length] : event.key === 'Home' ? keys[0] : event.key === 'End' ? keys[keys.length - 1] : null;
          if (!next) return; event.preventDefault(); listState.tab = next; listState.cap = false; listState.limit = ROW_LIMIT; updateList(context, true); tabs.querySelector('[data-home-tab="' + next + '"]').focus({ preventScroll: true });
        });
        tabs.append(button);
      }
      const toolbar = el('div', null, 'home-list-toolbar');
      const toggle = iconAction(context, '내 글 검색 열기', 'search', () => {
        if (listState.query.trim()) {
          context.searchInput.focus({ preventScroll: true }); return;
        }
        listState.searchExpanded = !listState.searchExpanded;
        syncSearch(context);
        if (listState.searchExpanded) global.HaedoMotion?.enter(context.searchPanel, { kind: 'reveal' });
        (listState.searchExpanded ? context.searchInput : toggle).focus({ preventScroll: true });
      });
      toggle.classList.add('home-search-toggle'); toggle.dataset.focusKey = 'home:search-toggle';
      toggle.setAttribute('aria-controls', 'homeSearchPanel');
      toolbar.append(tabs, toggle);
      const panel = el('div', null, 'home-search-panel'); panel.id = 'homeSearchPanel';
      const search = el('div', null, 'home-search');
      const label = el('label', '내 글 찾기', 'life-sr-only'); label.htmlFor = 'homePostSearch';
      const input = el('input'); input.type = 'search'; input.id = 'homePostSearch'; input.placeholder = '내 글 검색'; input.maxLength = 1000;
      input.value = listState.query; input.dataset.focusKey = 'home:search'; input.autocomplete = 'off';
      let composing = false;
      const apply = () => {
        if (composing || !showing(context)) return;
        listState.query = input.value; listState.searchExpanded = true; listState.limit = ROW_LIMIT; updateList(context, true);
      };
      input.addEventListener('compositionstart', () => { composing = true; });
      input.addEventListener('compositionend', () => { composing = false; apply(); });
      input.addEventListener('input', apply);
      input.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || listState.query.trim() || composing || searchAlwaysShown()) return;
        event.preventDefault(); listState.searchExpanded = false; syncSearch(context); toggle.focus({ preventScroll: true });
      });
      const clear = action(context, '검색어 지우기', () => {
        listState.query = ''; listState.limit = ROW_LIMIT; input.value = ''; updateList(context, true);
        (context.controls.hidden ? context.list.querySelector('#homeFirstWrite') : input)?.focus({ preventScroll: true });
      }, 'home-search-clear'); clear.dataset.focusKey = 'home:search-clear';
      search.append(label, life.Icons.create('search'), input, clear);
      const scope = el('p', '', 'life-meta home-search-scope');
      panel.append(search); controls.append(toolbar, panel, scope); area.append(controls);
      context.tabs = tabs; context.controls = controls; context.searchPanel = panel; context.searchToggle = toggle;
      context.searchInput = input; context.searchScope = scope; context.searchClear = clear; syncSearch(context);
      searchContext = context;
      if (wideSearch && !wideListener) {
        wideListener = () => { if (searchContext && showing(searchContext)) syncSearch(searchContext); };
        wideSearch.addEventListener?.('change', wideListener);
      }
      context.list = el('div', null, 'home-post-list'); context.list.id = 'homePostList'; context.list.setAttribute('role', 'tabpanel'); context.list.tabIndex = -1;
      context.feedback = el('p', null, 'life-sr-only'); context.feedback.setAttribute('role', 'status'); context.feedback.setAttribute('aria-live', 'polite');
      area.append(context.list, context.feedback);
    }
    function syncSearch(context) {
      // Wide: the field sits in the tab row and is always shown, so the row has no second magnifier.
      const always = searchAlwaysShown();
      const expanded = always || listState.searchExpanded || !!listState.query.trim();
      context.controls.dataset.searchMode = always ? 'field' : 'toggle';
      context.searchPanel.hidden = !expanded;
      context.searchToggle.hidden = always;
      context.searchToggle.setAttribute('aria-expanded', String(expanded));
      const label = listState.query.trim() ? '검색어 수정' : expanded ? '내 글 검색 닫기' : '내 글 검색 열기';
      context.searchToggle.setAttribute('aria-label', label); context.searchToggle.title = label;
      context.searchToggle.querySelector('.life-tooltip').textContent = label;
      context.searchScope.textContent = TAB_LABELS[listState.tab] + ' 탭의 제목과 본문에서 찾습니다. 최근 수정·저장 순입니다.';
      // The scope line under an always-shown field appears only while a search is applied.
      context.searchScope.hidden = !expanded || always && !listState.query.trim();
      context.searchInput.placeholder = always ? '내 글 찾기' : TAB_LABELS[listState.tab] + '에서 검색';
      context.searchClear.hidden = !listState.query;
    }
    // A row the 200 cap counts: a post or draft of this library's post list (not 첨부 글·기록 글 drafts,
    // not another library's posts).
    const counted = (context, row) => (row.kind === 'photo' || row.kind === 'photo-draft') && (row.workspaceId || context.workspaceId) === context.workspaceId;
    const COPY_PREFIX = () => life.BlogSync?.CONFLICT_PREFIX || '복구 사본 · ', COPY_QUERY = () => COPY_PREFIX().replace(/[\s·]+$/, '');
    // A recovery copy a sync conflict kept: a draft of this library whose title starts with the prefix.
    const isCopy = (context, row) => row.tab === 'drafts' && counted(context, row) && String(row.title || '').startsWith(COPY_PREFIX());
    const capped = (context, row) => !listState.cap || counted(context, row) && (listState.cap !== 'copies' || listState.query !== COPY_QUERY() || isCopy(context, row));
    const shown = (context, row) => row.tab === listState.tab && matchesQuery(row) && capped(context, row);
    function matchesQuery(row, text = listState.query) {
      const query = text.trim().toLocaleLowerCase('ko-KR');
      return !query || [row.title, row.body, ...(Array.isArray(row.attachments) ? row.attachments.map(item => item.title) : [])]
        .filter(Boolean).join('\n').toLocaleLowerCase('ko-KR').includes(query);
    }
    function anchorRow(context, requested) {
      return [...context.list.querySelectorAll('.home-post')].find(node => node.dataset.homeKind === requested.kind &&
        (requested.kind === 'photo' ? node.dataset.photoPostId : requested.kind === 'plain' ? node.dataset.postId : node.dataset.sourceId) === requested.id);
    }
    function focusAnchor(context, requested) {
      const rows = resultRows(context).rows.filter(row => shown(context, row));
      const index = rows.findIndex(row => row.kind === requested.kind && row.id === requested.id);
      if (index >= listState.limit) { listState.limit = Math.ceil((index + 1) / ROW_LIMIT) * ROW_LIMIT; updateList(context); }
      const row = anchorRow(context, requested);
      if (!row) return false;
      row.querySelector('.home-post-open')?.focus({ preventScroll: true }); row.scrollIntoView({ block: 'start', behavior: 'instant' }); return true;
    }
    // The cap of the open library (where 글쓰기 starts a post), shown only near it. Its buttons go
    // to what can be deleted: the 초안 tab, and the recovery copies a sync conflict kept there.
    function limitNotice(context, rows) {
      const photo = context.results.photo?.status === 'fulfilled' ? context.results.photo.value : null;
      const capacity = postCapacity(photo?.counts?.[context.workspaceId]);
      if (!capacity) return null;
      // Drafts of this library's list as the cap counts them (empty ones too); the rest are posts.
      const drafts = photo?.drafts?.[context.workspaceId] || 0;
      const copyQuery = COPY_QUERY();
      // Counted as the button shows them (shown with cap 'copies'): this library's recovery copies.
      const copies = rows.filter(row => isCopy(context, row) && matchesQuery(row, copyQuery)).length;
      const notice = el('div', null, 'home-limit'); notice.dataset.homeLimit = capacity.full ? 'full' : 'near';
      notice.append(el('p', limitText(capacity, drafts), 'life-meta'));
      const show = (label, query, cap, key) => {
        const button = action(context, label, () => {
          listState.tab = 'drafts'; listState.cap = cap; listState.query = query; listState.searchExpanded = !!query; listState.limit = ROW_LIMIT;
          context.searchInput.value = query; updateList(context, true);
          context.list.querySelector('.home-draft-open')?.focus({ preventScroll: true });
        }, 'home-limit-action');
        button.dataset.focusKey = 'home:limit:' + key; return button;
      };
      const here = listState.tab === 'drafts' && listState.cap;
      const actions = el('div', null, 'home-limit-actions');
      if (drafts && !(here && listState.cap === true && !listState.query.trim())) actions.append(show('초안 보기', '', true, 'drafts'));
      if (copies && !(here && listState.cap === 'copies' && listState.query === copyQuery)) actions.append(show('복구 사본 ' + copies + '개 보기', copyQuery, 'copies', 'copies'));
      if (here) actions.append(show('모든 초안 보기', '', false, 'all-drafts'));
      if (actions.childElementCount) notice.append(actions);
      return notice;
    }
    function updateList(context, userAction = false) {
      if (!showing(context)) return;
      // Before the first read ends (the wide search field is usable from the first frame) a search
      // or tab choice is kept and applied when the list arrives; it never reads as a failed load.
      if (!Object.keys(context.results).length) {
        for (const button of context.tabs.children) { const selected = button.dataset.homeTab === listState.tab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; }
        syncSearch(context); return;
      }
      const previousTab = context.renderedTab;
      clearMedia();
      const { rows, errors } = resultRows(context), query = listState.query.trim().toLocaleLowerCase('ko-KR');
      if (!rows.length && !errors.length && !query) listState.tab = 'posts';
      context.controls.hidden = !rows.length && !errors.length && !query;
      syncSearch(context);
      context.resumeRow = rows.find(row => row.tab === 'drafts') || null;
      context.resume.hidden = !context.resumeRow || listState.tab !== 'posts' || !!query;
      if (context.resumeRow) context.resumeLabel.textContent = String(context.resumeRow.title || '').trim() || snippet(context.resumeRow.body) || '작성 중인 초안';
      // The filter of the cap notice holds only while the notice is shown.
      if (listState.cap && !postCapacity(context.results.photo?.status === 'fulfilled' ? context.results.photo.value?.counts?.[context.workspaceId] : undefined)) listState.cap = false;
      // A tab's count is what it lists without a search (with the notice's filter, the filtered rows).
      const counts = Object.fromEntries(Object.keys(TAB_LABELS).map(tab => [tab, rows.filter(row => row.tab === tab && capped(context, row)).length]));
      for (const button of context.tabs.children) {
        const tab = button.dataset.homeTab, selected = tab === listState.tab;
        button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
        button.textContent = TAB_LABELS[tab] + (counts[tab] && tab !== 'posts' ? ' ' + counts[tab] : '');
      }
      context.list.setAttribute('aria-labelledby', 'homeTab-' + listState.tab);
      const matched = rows.filter(row => shown(context, row));
      const fragment = document.createDocumentFragment();
      if (refusedDelete) {
        const refused = el('div', null, 'home-limit home-delete-refused'); refused.append(el('p', REFUSED_DELETE, 'life-meta'));
        const seen = action(context, '확인', () => { refusedDelete = false; updateList(context, true); context.list.focus({ preventScroll: true }); }, 'home-limit-action');
        seen.dataset.focusKey = 'home:delete-refused'; refused.append(seen); fragment.append(refused);
      }
      const limit = limitNotice(context, rows);
      if (limit) fragment.append(limit);
      if (listState.tab === 'archive') fragment.append(el('p', '글을 열어 목록에 다시 보이게 할 수 있어요.', 'life-meta home-archive-note'));
      const applicable = errors.filter(error => error.key === 'photo' || (listState.tab === 'posts' ? error.key === 'workbench' : listState.tab === 'drafts' ? ['plainDrafts', 'sourceDrafts'].includes(error.key) : false));
      if (applicable.length) {
        const error = el('div', null, 'home-posts-error home-load-error'); error.setAttribute('role', 'status');
        error.append(el('p', applicable.map(item => item.label).join(', ') + '을 불러오지 못했어요. 확인된 글만 표시합니다.', 'life-meta'),
          action(context, '다시 불러오기', async () => { await load(context, applicable.map(item => item.key)); })); fragment.append(error);
      }
      let previousDay;
      matched.slice(0, listState.limit).forEach(row => {
        const day = life.ScheduleData?.dayOf(row.updatedAt) || null;
        if (day !== previousDay) { fragment.append(dayHeading(row.updatedAt)); previousDay = day; }
        fragment.append(row.tab === 'drafts' || row.kind === 'photo-draft' ? draftRow(context, row) : blogPost(context, row));
      });
      if (!matched.length && !applicable.length) {
        const empty = el('div', null, 'home-first-post');
        const title = query ? '일치하는 내 글이 없어요.' : listState.tab === 'drafts' ? '작성 중인 초안이 없어요.' : listState.tab === 'archive' ? '숨긴 글이 없어요.' : '첫 글을 써보세요.';
        empty.append(el('h3', title), el('p', query ? '현재 탭의 제목과 본문에서 찾았어요. 검색어나 탭을 바꿔보세요.' : listState.tab === 'drafts' ? '작성 중 닫은 글은 여기에 남습니다.' : listState.tab === 'archive' ? '목록에서 숨기기를 지원하는 글만 여기에 표시됩니다.' : '한 문장부터 시작해도 좋아요. 먼저 비공개로 저장됩니다.', 'home-text'));
        if (query) empty.append(action(context, '검색어 지우기', () => { listState.query = ''; listState.limit = ROW_LIMIT; const input = context.surface.querySelector('#homePostSearch'); input.value = ''; updateList(context, true); (context.controls.hidden ? context.list.querySelector('#homeFirstWrite') : input)?.focus({ preventScroll: true }); }));
        else if (listState.tab === 'posts') {
          const start = action(context, '첫 글 쓰기', () => navigate('page', { blogContext: true, pageCompose: true }), 'life-primary'); start.id = 'homeFirstWrite'; start.dataset.homeDestination = 'write'; start.dataset.focusKey = 'home:action:write'; empty.append(start);
        }
        fragment.append(empty);
      }
      if (matched.length > listState.limit) {
        const more = action(context, '글 20개 더 보기', () => {
          const limit = listState.limit; listState.limit += ROW_LIMIT; updateList(context, true);
          const next = context.list.querySelectorAll('.home-post,.home-draft')[limit];
          next?.querySelector('.home-post-open,.home-draft-open')?.focus({ preventScroll: true });
        }, 'home-more'); more.dataset.focusKey = 'home:more'; fragment.append(more);
      }
      const focused = document.activeElement, focusKey = context.list.contains(focused) ? focused?.dataset.focusKey : null;
      context.list.replaceChildren(fragment);
      context.renderedTab = listState.tab;
      if (userAction && previousTab && previousTab !== listState.tab) global.HaedoMotion?.enter(context.list, { kind: 'tab' });
      const restored = focusKey && [...context.list.querySelectorAll('[data-focus-key]')].find(item => item.dataset.focusKey === focusKey);
      restored?.focus({ preventScroll: true });
      // A notice line's button that is gone with its line (the count dropped below 190 from another
      // tab or device, or 확인): focus goes to the shown tab rather than the page body.
      if (focusKey && !restored && focused?.closest?.('.home-limit')) context.tabs.querySelector('[data-home-tab="' + listState.tab + '"]')?.focus({ preventScroll: true });
      context.feedback.textContent = applicable.length ? '일부 목록을 확인하지 못했어요.' : TAB_LABELS[listState.tab] + ' ' + matched.length + '개' + (query ? ' 검색됨' : '');
      context.area.setAttribute('aria-busy', 'false');
      void enrichDrafts(context);
    }
    async function load(context, keys = ['workbench', 'photo', 'plainDrafts', 'sourceDrafts']) {
      const read = { workbench: () => storage.readWorkbench(context.workspaceId), photo: () => listAccountPosts(storage, context.workspaceId, { contentCache }),
        plainDrafts: () => storage.readPageDrafts(context.workspaceId), sourceDrafts: () => storage.listStages(context.workspaceId) };
      context.area.setAttribute('aria-busy', 'true');
      const results = await Promise.allSettled(keys.map(key => Promise.resolve().then(read[key])));
      if (!showing(context)) return;
      keys.forEach((key, index) => { context.results[key] = results[index]; });
      updateList(context);
    }
    async function enrichDrafts(context) {
      if (!showing(context) || listState.tab !== 'drafts' || context.draftLoading || context.results.photo?.status !== 'fulfilled' || !Array.isArray(context.results.photo.value?.posts)) return;
      const drafts = context.results.photo.value.posts.filter(item => item.status === 'draft' && !item.archived && !context.photoDrafts.has(item.workspaceId + ':' + item.id)).slice(0, listState.limit);
      if (!drafts.length) return;
      context.draftLoading = true;
      try {
        for (let offset = 0; offset < drafts.length; offset += 4) {
          if (!showing(context) || listState.tab !== 'drafts') return;
          const batch = drafts.slice(offset, offset + 4);
          const details = await Promise.allSettled(batch.map(row => storage.readPhotoPost(row.workspaceId || context.workspaceId, row.id)));
          if (!showing(context)) return;
          batch.forEach((row, index) => { context.photoDrafts.set(row.workspaceId + ':' + row.id, details[index].status === 'fulfilled' ? !!details[index].value.replaces : null); });
        }
        if (showing(context) && listState.tab === 'drafts') updateList(context);
      } finally { context.draftLoading = false; }
    }
    async function render(options = {}) {
      if (!alive()) return;
      const bundle = getBundle();
      if (!bundle) return;
      adoptState(bundle.workspaceId, options.homeState);
      clearMedia();
      const surface = el('div', null, 'life-home'); surface.id = 'lifeHome';
      const context = { token: ++generation, workspaceId: bundle.workspaceId, surface, profile: { name: '내 블로그' },
        results: {}, photoDrafts: new Map(), draftRead: 0, error: el('p', null, 'life-error home-error') };
      visible = true;
      context.error.hidden = true; context.error.setAttribute('role', 'alert');
      const lead = el('div', null, 'home-blog-lead');
      context.profileStatus = el('div', null, 'home-profile-status home-load-error'); context.profileStatus.hidden = true;
      context.profileStatus.setAttribute('role', 'status');
      context.profileStatus.append(el('p', '프로필과 기존 글 정보를 불러오지 못했어요.', 'life-meta'),
        action(context, '프로필 다시 불러오기', () => load(context, ['workbench'])));
      lead.append(profileHeader(context), context.profileStatus);
      context.resume = action(context, '', () => context.resumeRow && openRow(context, context.resumeRow), 'home-resume');
      context.resume.dataset.focusKey = 'home:resume'; context.resume.hidden = true;
      context.resumeLabel = el('span', null, 'home-resume-title');
      context.resume.append(el('span', '작성하던 글', 'life-meta'), context.resumeLabel, el('span', '이어쓰기', 'home-draft-resume'));
      lead.append(context.resume); surface.append(lead, context.error);
      const composition = el('div', null, 'home-composition'); composition.id = 'homeComposition'; composition.setAttribute('aria-busy', 'true');
      const posts = section(context, '내 글', 'homePosts'); posts.querySelector('.home-section-heading').classList.add('life-sr-only');
      context.area = posts; listControls(context, posts);
      const loading = el('p', '글과 초안을 불러오는 중…', 'life-meta home-loading'); loading.setAttribute('role', 'status'); context.list.append(loading);
      posts.setAttribute('aria-busy', 'true'); composition.append(posts);
      surface.append(composition); host.append(surface);
      watch(context);
      await load(context);
      if (!showing(context)) return;
      composition.setAttribute('aria-busy', 'false');
      const requested = options.homeAnchor;
      if (requested && ['photo', 'plain', 'source'].includes(requested.kind) && typeof requested.id === 'string') {
        if (!focusAnchor(context, requested) && requested.committed) {
          const saved = resultRows(context).rows.find(row => row.kind === requested.kind && row.id === requested.id);
          if (saved && (listState.query.trim() || listState.tab !== saved.tab)) {
            const notice = el('div', null, 'home-saved-filter-notice'); notice.setAttribute('role', 'status');
            notice.append(el('p', '저장한 글이 현재 검색 조건이나 탭에 포함되지 않아 보이지 않아요.', 'life-meta'),
              action(context, listState.query.trim() ? '검색어 지우고 저장한 글 보기' : '저장한 글에서 보기', () => {
                listState.tab = saved.tab; listState.query = ''; listState.cap = false; listState.limit = ROW_LIMIT;
                context.surface.querySelector('#homePostSearch').value = ''; updateList(context, true); notice.remove(); focusAnchor(context, requested);
              }));
            context.list.before(notice);
          }
        }
      }
    }
    function unwatch() { stopWatch?.(); stopWatch = null; stopPublic?.(); stopPublic = null; if (watchTimer) clearTimeout(watchTimer); watchTimer = null; if (publicTimer) clearTimeout(publicTimer); publicTimer = null; }
    // Publishing, withdrawing and settling change no post document, so no storage event follows
    // them. BlogSync reports the post; the list is read again only when a shown label differs.
    function watchPublication(context) {
      let sync = null;
      try { sync = life.BlogSync?.forStorage?.(storage) || null; } catch (_) { sync = null; }
      if (typeof sync?.subscribe !== 'function') return;
      stopPublic = sync.subscribe(event => {
        if (event?.type === 'delete_refused' && event.reason === 'published' && showing(context)) {
          const value = context.results.photo?.status === 'fulfilled' ? context.results.photo.value : null;
          if (!(value?.workspaces || [context.workspaceId]).includes(event.workspaceId)) return;
          refusedDelete = true; updateList(context); context.feedback.textContent = REFUSED_DELETE; return;
        }
        if (!event?.localPostId || !showing(context)) return;
        if (publicTimer) clearTimeout(publicTimer);
        publicTimer = setTimeout(async () => {
          publicTimer = null;
          const value = context.results.photo?.status === 'fulfilled' ? context.results.photo.value : null;
          if (!showing(context) || !Array.isArray(value?.posts)) return;
          let fresh; try { fresh = await publicationOf(storage, value.workspaces || [context.workspaceId]); } catch (_) { return; }
          if (!showing(context) || context.results.photo?.value !== value) return;
          if (value.posts.some(post => (fresh.get(post.workspaceId + '/' + post.id) || 'private') !== (post.publication || 'private'))) void load(context, ['photo']);
        }, 250);
      });
    }
    function watch(context) {
      unwatch();
      const listener = event => {
        // A restore-copy marker received from another device changes which libraries are listed.
        const restoredMark = event?.type === 'account_doc_applied' && typeof event.key === 'string' && event.key.startsWith('restored-copy:');
        if ((event?.type !== 'photo_posts_changed' && !restoredMark) || !showing(context)) return;
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => { watchTimer = null; if (showing(context)) { context.photoDrafts.clear(); void load(context, ['photo']); } }, 250);
      };
      // Posts arrive in any library of the account; without an account only
      // the open library is listed and watched.
      watchPublication(context);
      try { if (typeof storage.subscribeAll === 'function') { stopWatch = storage.subscribeAll(listener); return; } }
      catch (error) { if (error?.code !== 'auth_scope_required') { stopWatch = null; return; } }
      if (typeof storage.subscribe !== 'function') return;
      try { stopWatch = storage.subscribe(context.workspaceId, listener); } catch (_) { stopWatch = null; }
    }
    function leave() {
      unwatch();
      if (wideListener) { wideSearch?.removeEventListener?.('change', wideListener); wideListener = null; }
      searchContext = null;
      global.HaedoMotion?.cancel(host.querySelector('#homePostList'));
      global.HaedoMotion?.cancel(host.querySelector('#homeSearchPanel'));
      generation += 1; visible = false; clearMedia();
    }
    function dispose() { leave(); disposed = true; contentCache.clear(); }
    return Object.freeze({ render, leave, dispose, captureState });
  }
  life.HomeUI = Object.freeze({ create, listAccountPosts, restoredDuplicates, restoredContent, dateLabels, postCapacity, limitText, POST_LIMIT });
})(globalThis);
