/* One ZIP for the account's workspaces. Each file inside keeps its existing
 * backup format; the bundle adds only README.txt and manifest.json (path,
 * format/version, counts, bytes, SHA-256, what is missing and what is not
 * included). Restore always creates new workspace copies through the existing
 * single-transaction install functions and never writes to an existing
 * workspace. No network except reading the account's own original
 * attachments through their existing service; no publication. */
(function (root, factory) {
  const api = factory(root);
  (root.HaedoLife ||= {}).FullBackup = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, function (root) {
  'use strict';
  // Version 1: first release (manifest/README first, no notIncluded).
  // Version 2: adds blog series, preparations, Naver captures, originals,
  // `notIncluded`, missing reasons; manifest/README are written last.
  // VERSION 3 (2026-11-11): the same files as 2; each post ZIP also carries the post's createdAt·updatedAt, which an
  // app before this change cannot read. It refuses version 3 up front (unsupported_version) instead of restoring
  // everything but the posts.
  const FORMAT = 'haedo-full-backup-v1', VERSION = 3, DOCS_FORMAT = 'haedo-account-documents-v1';
  const MiB = 1024 * 1024, GiB = 1024 * MiB;
  // ZIP32 without ZIP64: every offset must stay below 4 GiB. The same limit
  // applies to the whole file when it is written and when it is opened.
  const LIMITS = Object.freeze({ bundle: 3.5 * GiB, warn: 1 * GiB, files: 20000, manifest: 16 * MiB, json: 512 * MiB, chunk: 8 * MiB, receipts: 50 });
  const paths = { Core: './core.js', Workbench: './workbench.js', SourceFolders: './source-folders.js', Collection: './collection.js',
    NineBoard: './nine-board.js', PhotoPost: './photo-post.js', BlogSeriesPackage: './blog-series-package.js', MaterialWriting: './material-writing.js',
    NaverMedia: './naver-media.js', SourceReference: './source-reference.js' };
  const dep = name => root.HaedoLife?.[name] || (typeof require === 'function' && require(paths[name]));
  const zip = () => root.fflate || (typeof require === 'function' && require('../../vendor/fflate/fflate.js'));
  const fault = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
  const clone = value => structuredClone(value);
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const encoder = new TextEncoder();
  // Compact JSON: every existing restore parser reads it (JSON.parse); indentation only grows large libraries.
  const json = value => encoder.encode(JSON.stringify(value));
  const pretty = value => encoder.encode(JSON.stringify(value, null, 2));

  // Labels are functional names shown in the UI, README and restore report.
  const KINDS = Object.freeze({
    library: Object.freeze({ label: '자료·구성', detail: '원문·발췌·메모·출처, 자료 폴더·묶음·내 페이지·회고·책' }),
    collection: Object.freeze({ label: '컬렉션', detail: '컬렉션 항목·비공개 메모·숨김 상태' }),
    photoPosts: Object.freeze({ label: '사진 글', detail: '글별 ZIP · 원본 사진 바이트와 HEIC 보기용 JPEG' }),
    nineBoards: Object.freeze({ label: '9칸 구성', detail: '구성·영역·선택 이유·직접 담은 근거' }),
    blogSeries: Object.freeze({ label: '연재 모음', detail: '모음별 ZIP · 고정한 글과 원본 사진' }),
    materialWriting: Object.freeze({ label: '자료로 글쓰기 준비', detail: '질문·자료 메모·개요' }),
    naverCaptures: Object.freeze({ label: '네이버 원문 사진', detail: '원문 판별 ZIP · 원문과 사진 사본' }),
    accountDocuments: Object.freeze({ label: '계정 설정·기록 문서', detail: '뉴스 설정·관심·연간 계획·읽던 위치·페이지 초안·인용 근거' }),
    originals: Object.freeze({ label: '원본 첨부', detail: '원본 파트 ZIP' }),
    timeline: Object.freeze({ label: '연표·목표·습관·행복도', detail: '이 기기에 내려받은 사본 · 연표 목록 화면에서 복원' }),
    preservation: Object.freeze({ label: '보관 범위·근거 파일', detail: '선택한 글·9칸과 정확한 원문 근거' }),
    annualPlan: Object.freeze({ label: '연간 계획 파일', detail: '연간 계획 화면에서 복원' })
  });
  const ORDER = Object.freeze(['library', 'collection', 'photoPosts', 'nineBoards', 'blogSeries', 'materialWriting', 'naverCaptures', 'accountDocuments', 'originals', 'timeline']);
  const ACCOUNT_KINDS = Object.freeze(['accountDocuments', 'originals', 'timeline']);
  // Kinds without a file format, listed in the manifest, README and screen.
  const NOT_INCLUDED = Object.freeze({
    writingDrafts: { label: '글쓰기 초안', reason: '초안 전용 백업 형식이 없습니다.', whereToSave: '같은 계정으로 로그인한 기기에 자동 동기화됩니다. 파일이 필요하면 글쓰기 화면에서 TXT로 받으세요.' },
    importDrafts: { label: '가져오기 검토 초안', reason: '검토 중인 가져오기는 백업 형식이 없습니다.', whereToSave: '검토를 마쳐 자료로 저장하면 자료·구성 파일에 들어갑니다.' },
    sourceEditDrafts: { label: '자료 수정 초안', reason: '저장하지 않은 수정은 백업 형식이 없습니다.', whereToSave: '수정을 저장하면 새 원문 버전으로 자료·구성 파일에 들어갑니다.' },
    publication: { label: '공개 상태·서버 연결', reason: '새 사본은 공개하지 않고 원래 서버 연결을 옮기지 않습니다.', whereToSave: '공개본은 원래 공개 페이지에 그대로 있습니다. 필요하면 복원한 글을 다시 공개하세요.' },
    originals: { label: '원본 첨부', reason: '원본 첨부 보관함을 열 수 없습니다.', whereToSave: '자료 메뉴의 원본 첨부에서 파트 ZIP을 받으세요.' },
    originalsServer: { label: '서버에만 있는 원본 첨부 파트', reason: '이 기기에 내려받은 원본 파트만 담고, 서버에만 있는 파트는 확인하지 않았습니다.', whereToSave: '자료 메뉴의 원본 첨부를 열어 목록을 받은 뒤 다시 모두 받기를 하거나, 그 화면에서 파트 ZIP을 받으세요.' },
    accountDocRecoveries: { label: '설정 충돌 복구 사본', reason: '동기화 충돌 때 남긴 이전 설정 사본은 백업 형식이 없습니다.', whereToSave: '이 기기의 로컬 기록에 문서마다 최근 5개까지 남습니다.' }
  });
  // Account documents mirror storage.js ACCOUNT_DOC_*_PREFIXES. Keys of the
  // first group embed the account; the rest belong to an owned workspace.
  const ACCOUNT_PREFIXES = Object.freeze(['readingPosition', 'interestProfile', 'annualPlan', 'discoveryProfile', 'discoverySettings',
    'discoveryLanguageSettings', 'discoveryActions', 'discoveryReading']);
  const WORKSPACE_PREFIXES = Object.freeze(['public-cover', 'page-drafts', 'post-evidence']);
  // `restored-copy` describes how one workspace was made. It is not written to
  // the file: every restore marks its own new copies (see restoredCopyOf).
  const DOC_PREFIXES = new Set([...ACCOUNT_PREFIXES, ...WORKSPACE_PREFIXES]);
  // Public-cover state describes publication; restoring it into a copy could
  // pair two workspaces with one public page. It stays in the file, unrestored.
  const NOT_RESTORED = Object.freeze({ 'public-cover': '공개 표지 설정은 공개 상태와 연결돼 있어 새 사본에 복원하지 않습니다.' });
  const ID = /^[A-Za-z0-9_-]{1,128}$/;
  const WS = 'workspaces\\/\\d{2,4}\\/', IDP = '[A-Za-z0-9_-]{1,128}';
  const PATH_KIND = Object.freeze({
    library: new RegExp('^' + WS + 'library\\.json$'), collection: new RegExp('^' + WS + 'collection\\.json$'),
    nineBoards: new RegExp('^' + WS + 'nine-boards\\.json$'), photoPosts: new RegExp('^' + WS + 'photo-posts\\/' + IDP + '\\.zip$'),
    blogSeries: new RegExp('^' + WS + 'blog-series\\/' + IDP + '\\.zip$'), materialWriting: new RegExp('^' + WS + 'material-writing\\.json$'),
    naverCaptures: new RegExp('^' + WS + 'naver-captures\\/' + IDP + '\\.zip$'), accountDocuments: /^account-documents\.json$/,
    originals: new RegExp('^original-attachments\\/' + IDP + '\\.zip$'), timeline: /^timeline-goals-habits\.json$/ });
  const PHOTO_FORMATS = ['life-photo-post-backup-v1', 'life-photo-post-backup-v2', 'life-post-md-backup-v1'];
  const ZIP_FORMATS = Object.freeze({ photoPosts: PHOTO_FORMATS, blogSeries: ['life-blog-series-package-v1'], naverCaptures: ['haedo.naver.capture.v1'],
    originals: ['haedo-private-originals-part-v1'] });

  function versionOf(format, data) {
    if (plain(data) && Number.isSafeInteger(data.schemaVersion)) return data.schemaVersion;
    const match = /-v(\d+)$/.exec(format || '');
    return match ? Number(match[1]) : 1;
  }
  async function sha256(bytes) {
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function blobBytes(blob) { return new Uint8Array(await blob.arrayBuffer()); }
  const pause = () => new Promise(resolve => (root.setTimeout || setTimeout)(resolve, 0));
  const pad = index => String(index).padStart(2, '0');
  const message = error => (error && typeof error.message === 'string' && error.message) || '읽지 못했습니다.';

  // ---- Counts per existing format (shown before download and in the manifest) ----
  function libraryParts(data) {
    if (data?.format === 'life-tools-backup-v1') return { bundle: data.workspace, workbench: null, folders: null };
    if (data?.format === 'life-workbench-backup-v1') return { bundle: data.sourceBackup?.workspace, workbench: data.workbench, folders: null };
    if (data?.format === dep('SourceFolders').BACKUP_FORMAT) return { bundle: data.libraryBackup?.sourceBackup?.workspace, workbench: data.libraryBackup?.workbench, folders: data.sourceFolders };
    return null;
  }
  const COUNT = {
    library(data) {
      const { bundle, workbench, folders } = libraryParts(data) || {};
      return { sources: bundle?.sources?.length || 0, sourceVersions: bundle?.sourceVersions?.length || 0, records: bundle?.records?.length || 0,
        groups: workbench?.groups?.length || 0, pageEntries: workbench?.page?.entries?.length || 0, books: workbench?.books?.length || 0,
        folders: folders?.folders?.length || 0 };
    },
    collection: data => ({ items: data.items.length, archived: data.items.filter(item => item.archived).length }),
    nineBoards: data => ({ boards: data.boards.length, items: data.boards.reduce((sum, board) => sum + board.areas.reduce((n, area) => n + area.items.length, 0), 0) }),
    photoPosts: doc => ({ posts: 1, photos: doc.photos.length, views: doc.photos.filter(photo => photo.view).length, attachments: (doc.attachments || []).length }),
    blogSeries: snapshot => ({ series: 1, seriesPosts: snapshot.posts.length, photos: snapshot.posts.reduce((n, row) => n + row.doc.photos.length, 0) }),
    materialWriting: data => ({ plans: data.plans.length }),
    naverCaptures: attachment => ({ captures: 1, photos: attachment.photos.length }),
    accountDocuments: data => ({ documents: data.documents.length }),
    originals: part => ({ parts: 1, files: part.count || 0 }),
    timeline: data => ({ timelines: (data.docs || []).length, goals: (data.items || []).filter(item => item?.kind === 'goal').length,
      habits: (data.items || []).filter(item => item?.kind === 'habit').length, ...happinessCount(data) })
  };
  // 하루 행복도 기록일(값이 있는 날): only counted when the file carries happinessDays.
  function happinessCount(data) {
    const days = (Array.isArray(data?.happinessDays?.entries) ? data.happinessDays.entries : []).filter(entry => entry && entry.v !== null).length;
    return days ? { days } : {};
  }
  const COUNT_LABELS = { sources: '자료', sourceVersions: '원문 버전', records: '발췌', groups: '묶음', pageEntries: '페이지 항목', books: '책', folders: '폴더',
    items: '항목', archived: '보관', boards: '구성', posts: '글', photos: '사진', views: 'HEIC 보기용', attachments: '첨부', documents: '문서',
    series: '모음', seriesPosts: '모음 글', plans: '준비', captures: '원문', parts: '파트', files: '파일',
    timelines: '연표', goals: '목표', habits: '습관', days: '행복도 기록일', workspaces: '자료공간', drafts: '초안' };
  function countText(counts) {
    return Object.entries(counts || {}).filter(([key, value]) => value || ['sources', 'items', 'boards', 'posts', 'documents', 'timelines', 'plans'].includes(key))
      .map(([key, value]) => (COUNT_LABELS[key] || key) + ' ' + value).join(' · ');
  }
  function addCounts(target, counts) { for (const [key, value] of Object.entries(counts || {})) target[key] = (target[key] || 0) + value; return target; }

  // ---- Reading the account (export) ----
  const accountKeyOf = storage => JSON.stringify([storage.account.projectUrl, storage.account.userId]);
  function docKey(storage, prefix, workspaceId, postId) {
    if (ACCOUNT_PREFIXES.includes(prefix)) return prefix + ':' + accountKeyOf(storage) + ':' + workspaceId;
    return prefix + ':' + workspaceId + (prefix === 'post-evidence' ? ':' + postId : '');
  }
  function timelineSnapshot({ platformData, localStorage, uid, now = () => new Date().toISOString() }) {
    // Byte-for-byte the shape of platform-store backup(): local account copy only.
    const reg = platformData.registry(localStorage, uid), keys = platformData.keys(uid);
    // Losing sides of goal/habit conflicts (B2), kept with the items they belonged to. A value
    // that cannot be read is written as it is (recoveryDamaged), never blocking the backup.
    const parsed = key => { try { return { value: JSON.parse(localStorage.getItem(key)) }; } catch (_) { return null; } };
    const raw = localStorage.getItem(keys.recovery), list = raw === null ? { value: [] } : parsed(keys.recovery);
    const readable = Array.isArray(list?.value) && list.value.every(row => row && typeof row === 'object' && !Array.isArray(row));
    const held = parsed(keys.recoveryDamaged)?.value, damaged = [...(Array.isArray(held) ? held : []), ...(readable ? [] : [raw])];
    return { format: 'haedo-platform-backup-v1', exportedAt: now(),
      docs: reg.docs.map(doc => ({ id: doc.id, name: doc.name, data: JSON.parse(localStorage.getItem(keys.docs + doc.id)) })),
      items: clone(platformData.read(localStorage, keys.items, [])),
      recovery: readable ? clone(list.value) : [], ...(damaged.length ? { recoveryDamaged: damaged } : {}) };
  }
  function notIncluded(kind, count = null) { return { kind, ...NOT_INCLUDED[kind], ...(count === null ? {} : { count }) }; }
  // Each lister reads one list and returns its tasks and skipped rows. A list
  // that fails becomes one failed task; retrying it reads the list again.
  const LISTERS = {
    async photoPosts(storage, ws) {
      const base = 'workspaces/' + pad(ws.index) + '/', tasks = [], skipped = [];
      for (const row of await storage.listPhotoPosts(ws.workspaceId)) {
        if (ID.test(row.id)) tasks.push({ id: 'photoPosts:' + ws.index + ':' + row.id, kind: 'photoPosts', workspace: ws.index, postId: row.id,
          title: row.title || '', status: row.status, archived: row.archived === true, path: base + 'photo-posts/' + row.id + '.zip' });
        else skipped.push({ kind: 'photoPosts', workspace: ws.index, title: row.title || '', error: '글 식별자가 파일 경로 규칙과 맞지 않아 담지 않았습니다.' });
      }
      return { tasks, skipped };
    },
    async blogSeries(storage, ws) {
      const base = 'workspaces/' + pad(ws.index) + '/', tasks = [], skipped = [];
      if (!storage.readBlogSeries) return { tasks, skipped };
      for (const series of (await storage.readBlogSeries(ws.workspaceId)).series) {
        if (!ID.test(series.id)) skipped.push({ kind: 'blogSeries', workspace: ws.index, title: series.title || '', error: '모음 식별자가 파일 경로 규칙과 맞지 않아 담지 않았습니다.' });
        else if (!series.items.length) skipped.push({ kind: 'blogSeries', workspace: ws.index, title: series.title || '', error: '글이 없는 모음은 모음 ZIP 형식으로 담을 수 없습니다.' });
        else tasks.push({ id: 'blogSeries:' + ws.index + ':' + series.id, kind: 'blogSeries', workspace: ws.index, seriesId: series.id, title: series.title || '',
          path: base + 'blog-series/' + series.id + '.zip' });
      }
      return { tasks, skipped };
    },
    async naverCaptures(storage, ws) {
      const base = 'workspaces/' + pad(ws.index) + '/', tasks = [], skipped = [];
      // Counts from the stored rows only; each capture is validated when its file is written.
      let rows;
      if (storage.listNaverCaptures) rows = await storage.listNaverCaptures(ws.workspaceId);
      else if (storage.readNaverCapture) {
        const bundle = await storage.read(ws.workspaceId), naver = new Set(bundle.sources.filter(source => source.origin === 'naver_blog').map(source => source.id));
        rows = [];
        for (const version of bundle.sourceVersions.filter(row => naver.has(row.sourceId))) {
          const attachment = await storage.readNaverCapture(ws.workspaceId, version.id);
          if (attachment) rows.push({ sourceVersionId: version.id, photos: attachment.photos.length, bytes: attachment.photos.reduce((sum, photo) => sum + photo.blob.size, 0) });
        }
      } else rows = [];
      for (const row of rows) {
        if (ID.test(row.sourceVersionId)) tasks.push({ id: 'naverCaptures:' + ws.index + ':' + row.sourceVersionId, kind: 'naverCaptures', workspace: ws.index,
          versionId: row.sourceVersionId, title: '', path: base + 'naver-captures/' + row.sourceVersionId + '.zip',
          counts: { captures: 1, photos: row.photos }, estimate: row.bytes + 65536 });
        else skipped.push({ kind: 'naverCaptures', workspace: ws.index, error: '원문 버전 식별자가 파일 경로 규칙과 맞지 않아 담지 않았습니다.' });
      }
      return { tasks, skipped };
    },
    async originals(storage, ws, originals) {
      const tasks = [], skipped = [];
      for (const part of await originals.list({ cached: true })) { // Rows kept on this device; no catalog request.
        if (ID.test(part.id)) tasks.push({ id: 'originals:' + part.id, kind: 'originals', workspace: null, partId: part.id, count: part.count || 0,
          title: '파트 ' + part.part + '/' + part.partCount, path: 'original-attachments/' + part.id + '.zip' });
        else skipped.push({ kind: 'originals', workspace: null, error: '원본 파트 식별자가 파일 경로 규칙과 맞지 않아 담지 않았습니다.' });
      }
      return { tasks, skipped };
    }
  };
  async function list(kind, ws, context) {
    const { storage, originals = null } = context;
    return LISTERS[kind](storage, ws, originals);
  }
  const listTask = (kind, ws) => ({ id: kind + ':' + (ws ? ws.index : 'account') + ':list', kind, workspace: ws ? ws.index : null, path: null, relist: true,
    title: '목록', error: null });
  async function plan(context) {
    const { storage, timeline = null, originals = null, isCurrent = () => true } = context;
    if (!storage?.isAccountScoped || !storage.account) throw fault('auth_scope_required', '로그인한 계정에서 백업을 만들어 주세요.');
    const stop = () => { if (!isCurrent()) throw fault('backup_cancelled', '화면이 바뀌어 백업 준비를 멈췄습니다. 자료는 바뀌지 않았습니다.'); };
    const libraries = await storage.listAccountLibraries(); stop();
    const workspaces = libraries.map((row, i) => ({ index: i + 1, workspaceId: row.workspaceId, title: row.title || '제목 없는 자료공간', recovery: row.eligible === false }));
    const tasks = [], skipped = [], drafts = { writingDrafts: 0, importDrafts: 0, sourceEditDrafts: 0 };
    const listed = async (kind, ws) => {
      try { const value = await list(kind, ws, context); tasks.push(...value.tasks); skipped.push(...value.skipped); }
      catch (error) { tasks.push({ ...listTask(kind, ws), listError: message(error) }); }
    };
    for (const ws of workspaces) {
      const base = 'workspaces/' + pad(ws.index) + '/';
      tasks.push({ id: 'library:' + ws.index, kind: 'library', workspace: ws.index, path: base + 'library.json' },
        { id: 'collection:' + ws.index, kind: 'collection', workspace: ws.index, path: base + 'collection.json' },
        { id: 'nineBoards:' + ws.index, kind: 'nineBoards', workspace: ws.index, path: base + 'nine-boards.json' });
      await listed('photoPosts', ws);
      await listed('blogSeries', ws);
      if (storage.readMaterialWriting) tasks.push({ id: 'materialWriting:' + ws.index, kind: 'materialWriting', workspace: ws.index, path: base + 'material-writing.json' });
      if (storage.listNaverCaptures || storage.readNaverCapture) await listed('naverCaptures', ws);
      if (storage.listStages) try {
        for (const stage of await storage.listStages(ws.workspaceId)) {
          if (stage.state && stage.state !== 'draft') continue;
          drafts[stage.kind === 'writing' ? 'writingDrafts' : stage.kind === 'source-edit' ? 'sourceEditDrafts' : 'importDrafts']++;
        }
      } catch (_) { /* Counts only; the kinds stay listed as not included. */ }
      stop();
    }
    tasks.push({ id: 'accountDocuments', kind: 'accountDocuments', workspace: null, path: 'account-documents.json' });
    const excluded = Object.entries(drafts).map(([kind, count]) => notIncluded(kind, count));
    // Conflict recovery copies of account documents have no file format; they are counted, not written.
    if (storage.listAccountDocs && storage.listAccountDocRecoveries) try {
      const known = new Set(workspaces.map(row => row.workspaceId));
      let count = 0;
      for (const row of await storage.listAccountDocs()) if (DOC_PREFIXES.has(row.prefix) && known.has(row.workspaceId)) count += (await storage.listAccountDocRecoveries(row.key)).length;
      if (count) excluded.push(notIncluded('accountDocRecoveries', count));
    } catch (_) { excluded.push(notIncluded('accountDocRecoveries')); }
    if (originals) {
      await listed('originals', null);
      // Only parts already on this device are listed; parts kept only on the server are not checked here.
      excluded.push(notIncluded('originalsServer'));
    } else excluded.push(notIncluded('originals'));
    if (timeline) tasks.push({ id: 'timeline', kind: 'timeline', workspace: null, path: 'timeline-goals-habits.json' });
    excluded.push(notIncluded('publication'));
    stop();
    return { workspaces, tasks, skipped, notIncluded: excluded };
  }
  async function readPart(task, { storage, workspaces, timeline, originals }) {
    const ws = workspaces.find(row => row.index === task.workspace);
    if (task.kind === 'library') {
      const snapshot = await (storage.readLibraryBackupSnapshot ? storage.readLibraryBackupSnapshot(ws.workspaceId) : storage.readWorkbenchSnapshot(ws.workspaceId));
      const folders = snapshot.sourceFolders, nonempty = folders && (folders.folders.length || folders.assignments.length);
      // Same choice as the 자료·구성 screen: folders only when there is something to keep.
      return { value: nonempty ? dep('SourceFolders').makeBackup(snapshot.bundle, snapshot.workbench, folders) : dep('Workbench').makeBackup(snapshot.bundle, snapshot.workbench) };
    }
    if (task.kind === 'collection') return { value: dep('Collection').makeBackup(await storage.readCollection(ws.workspaceId)) };
    if (task.kind === 'nineBoards') return { value: dep('NineBoard').backup((await storage.readNineBoard(ws.workspaceId)).boards) };
    if (task.kind === 'materialWriting') return { value: await storage.readMaterialWriting(ws.workspaceId) };
    if (task.kind === 'photoPosts') {
      const doc = await storage.readPhotoPost(ws.workspaceId, task.postId);
      return { blob: await dep('PhotoPost').backup(doc), format: doc.format === 'life-post-md-v1' ? 'life-post-md-backup-v1' : doc.format === 'life-photo-post-v1' ? 'life-photo-post-backup-v1' : 'life-photo-post-backup-v2',
        counts: COUNT.photoPosts(doc), meta: { postId: task.postId, title: doc.title || '', status: doc.status, archived: doc.archived === true } };
    }
    if (task.kind === 'blogSeries') {
      const snapshot = await storage.readBlogSeriesSnapshot(ws.workspaceId, task.seriesId);
      return { blob: await dep('BlogSeriesPackage').pack(snapshot), format: dep('BlogSeriesPackage').FORMAT, counts: COUNT.blogSeries(snapshot),
        meta: { seriesId: task.seriesId, title: snapshot.series.title || '' } };
    }
    if (task.kind === 'naverCaptures') {
      const bundle = await storage.read(ws.workspaceId), attachment = await storage.readNaverCapture(ws.workspaceId, task.versionId);
      if (!attachment) throw fault('naver_capture_missing', '원문 사진 사본을 찾지 못했습니다.');
      return { blob: await dep('NaverMedia').pack({ bundle, attachment }), format: dep('NaverMedia').FORMAT, counts: COUNT.naverCaptures(attachment),
        meta: { versionId: task.versionId, title: task.title } };
    }
    if (task.kind === 'originals') {
      const part = await originals.archive(task.partId);
      return { blob: part.blob, format: 'haedo-private-originals-part-v1', counts: COUNT.originals({ count: task.count }), meta: { partId: task.partId, title: task.title } };
    }
    if (task.kind === 'accountDocuments') {
      const known = new Set(workspaces.map(row => row.workspaceId)), documents = [], others = new Map();
      for (const row of await storage.listAccountDocs()) {
        if (!DOC_PREFIXES.has(row.prefix)) continue;
        if (!known.has(row.workspaceId)) { others.set(row.workspaceId, (others.get(row.workspaceId) || 0) + 1); continue; }
        const record = await storage.readAccountDocRecord(row.key);
        if (!record.exists) continue;
        const postId = row.prefix === 'post-evidence' ? row.key.split(':')[2] : null;
        documents.push({ prefix: row.prefix, workspaceId: row.workspaceId, ...(postId ? { postId } : {}), value: record.value });
      }
      documents.sort((a, b) => (a.workspaceId + a.prefix + (a.postId || '')).localeCompare(b.workspaceId + b.prefix + (b.postId || '')));
      const count = [...others.values()].reduce((sum, n) => sum + n, 0);
      return { value: { format: DOCS_FORMAT, exportedAt: new Date().toISOString(), documents },
        skipped: count ? [{ kind: 'accountDocuments', workspace: null, error: '계정 자료공간 목록에 없는 공간(' + others.size + '개)의 문서 ' + count + '개는 복원할 곳이 없어 담지 않았습니다.' }] : [] };
    }
    if (task.kind === 'timeline') {
      // 하루 행복도(계정 문서 happinessDays)는 연표 부분의 필드로 담는다: account-documents.json과 ZIP 파일
      // 목록은 그대로라 옛 판도 이 ZIP을 연다(옛 판은 이 필드를 무시한다). 복원은 연표 가져오기가 한다.
      const value = await timeline(), skipped = [];
      if (typeof storage?.readHappinessDays === 'function') {
        // A 행복도 read failure (e.g. a newer app's format) never takes the timeline part down with it.
        try {
          const days = await storage.readHappinessDays();
          if (days.entries.length) value.happinessDays = { entries: days.entries };
        } catch (error) {
          skipped.push({ kind: 'timeline', workspace: null, error: '하루 행복도를 읽지 못해 이 파일에 담지 않았습니다. ' + message(error) });
        }
      }
      return { value, skipped };
    }
    throw fault('unknown_part', '알 수 없는 백업 항목입니다.');
  }
  // Light count pass shown before download. Photo bytes are summed from the
  // stored Blob sizes without reading them; ZIP kinds are not packed here.
  async function inventory(planned, context, { isCurrent = () => true } = {}) {
    const rows = [], { storage } = context;
    for (const task of planned.tasks) {
      if (!isCurrent()) throw fault('backup_cancelled', '화면이 바뀌어 목록 확인을 멈췄습니다.');
      try {
        const ws = planned.workspaces.find(row => row.index === task.workspace);
        if (task.relist) throw fault('list_failed', task.listError || '목록을 읽지 못했습니다.');
        if (task.kind === 'photoPosts') {
          const doc = await storage.readPhotoPost(ws.workspaceId, task.postId);
          rows.push({ id: task.id, kind: task.kind, workspace: task.workspace, status: 'ready', counts: { posts: 1, photos: doc.photos.length },
            estimate: doc.photos.reduce((sum, photo) => sum + photo.blob.size + (photo.view?.blob?.size || 0), 4096) });
        } else if (task.kind === 'blogSeries') {
          const snapshot = await storage.readBlogSeriesSnapshot(ws.workspaceId, task.seriesId);
          rows.push({ id: task.id, kind: task.kind, workspace: task.workspace, status: 'ready', counts: COUNT.blogSeries(snapshot),
            estimate: snapshot.posts.reduce((sum, row) => sum + row.doc.photos.reduce((n, photo) => n + photo.blob.size + (photo.view?.blob?.size || 0), 4096), 0) });
        } else if (task.kind === 'naverCaptures') {
          rows.push({ id: task.id, kind: task.kind, workspace: task.workspace, status: 'ready', counts: task.counts, estimate: task.estimate });
        } else if (task.kind === 'originals') {
          rows.push({ id: task.id, kind: task.kind, workspace: null, status: 'ready', counts: COUNT.originals({ count: task.count }), estimate: 0 });
        } else {
          const { value } = await readPart(task, { ...context, workspaces: planned.workspaces });
          rows.push({ id: task.id, kind: task.kind, workspace: task.workspace, status: 'ready', counts: COUNT[task.kind](value), estimate: JSON.stringify(value).length });
        }
      } catch (error) { rows.push({ id: task.id, kind: task.kind, workspace: task.workspace, status: 'failed', error: message(error) }); }
      await pause();
    }
    return summarizeRows(rows, planned);
  }
  function summarizeRows(rows, planned) {
    const kinds = {};
    for (const row of rows) {
      const entry = kinds[row.kind] ||= { kind: row.kind, label: KINDS[row.kind].label, files: 0, failed: 0, counts: {}, estimate: 0, workspaces: new Set() };
      if (row.status === 'failed') entry.failed++;
      else { entry.files++; addCounts(entry.counts, row.counts); entry.estimate += row.estimate || 0; }
      if (row.workspace) entry.workspaces.add(row.workspace);
    }
    const list = ORDER.filter(kind => kinds[kind]).map(kind => ({ ...kinds[kind], workspaces: kinds[kind].workspaces.size }));
    return { workspaces: planned.workspaces.length, kinds: list, rows, skipped: planned.skipped, notIncluded: planned.notIncluded,
      estimate: list.reduce((sum, row) => sum + row.estimate, 0) };
  }

  function readme(manifest) {
    const failures = manifest.missing.filter(item => item.reason !== 'skipped');
    const lines = ['해도 백업 ZIP', '', '만든 시각: ' + manifest.createdAt, '앱 버전: ' + (manifest.appVersion || '확인 불가'),
      '읽기 실패: ' + (failures.length ? failures.length + '개 · 아래 "빠진 항목"을 확인하세요' : '없음'),
      '이 ZIP에 넣지 않은 종류: ' + (manifest.notIncluded.length ? manifest.notIncluded.length + '개 · 아래 "담지 않은 것"을 확인하세요' : '없음'), '',
      '이 ZIP은 하나의 형식이 아닙니다. 아래 파일마다 기존 백업 형식을 그대로 담았습니다.',
      '복원: 해도 → 설정 → 백업·복원 → 복원에서 이 ZIP을 고르면 새 자료공간 사본으로 복원합니다. 기존 자료는 바뀌지 않습니다.',
      '각 파일은 원래 화면(자료·구성 백업, 컬렉션, 9칸, 사진 글, 연재 모음, 네이버 원문, 원본 첨부, 연표 목록)에서도 따로 복원할 수 있습니다.', '', '자료공간'];
    for (const ws of manifest.workspaces) lines.push('  ' + pad(ws.index) + ' ' + ws.title + (ws.recovery ? ' (복구 사본)' : ''));
    lines.push('', '파일 (경로 · 종류 · 형식/버전 · 개수 · 바이트 · SHA-256)');
    for (const file of manifest.files) lines.push('  ' + file.path, '    ' + KINDS[file.kind].label + ' · ' + file.format + ' v' + file.formatVersion + ' · ' + countText(file.counts) + ' · ' + file.bytes + ' · ' + file.sha256);
    if (manifest.missing.length) {
      lines.push('', '빠진 항목');
      for (const item of manifest.missing) lines.push('  ' + (item.reason === 'skipped' ? '[담지 않음] ' : '[읽기 실패] ') + KINDS[item.kind].label +
        (item.workspace ? ' · 자료공간 ' + pad(item.workspace) : '') + (item.title ? ' · ' + item.title : '') + ' · ' + item.error);
    }
    if (manifest.notIncluded.length) {
      lines.push('', '담지 않은 것 (종류 · 이유 · 보관 방법)');
      for (const item of manifest.notIncluded) lines.push('  ' + item.label + (Number.isSafeInteger(item.count) ? ' ' + item.count + '개' : '') + ' · ' + item.reason + ' · ' + item.whereToSave);
    }
    return lines.join('\n') + '\n';
  }

  // Single pass: each item is read, hashed and written into the open ZIP, and
  // its Blob is dropped before the next one. Output stays in 8 MiB Blob parts
  // until the file is finished. Failed items keep the ZIP open: `collect` can
  // retry only them and append; `finish({ partial: true })` records them as missing.
  function writer(planned, context, { appVersion = null, now = () => new Date().toISOString(), limit = LIMITS.bundle } = {}) {
    const F = zip(), parts = [], results = new Map(), skipped = [...planned.skipped];
    let pending = [], pendingBytes = 0, written = 0, error = null, finished = false;
    const flush = () => { if (pending.length) { parts.push(new Blob(pending)); pending = []; pendingBytes = 0; } };
    const archive = new F.Zip((cause, chunk) => {
      if (cause) { error = cause; return; }
      pending.push(chunk); pendingBytes += chunk.byteLength; written += chunk.byteLength;
      if (pendingBytes >= LIMITS.chunk) flush();
    });
    // Whole-file size as the reader sees it: local header (30 + name) + data +
    // descriptor (16), then every central entry (46 + name) and the 22-byte end record.
    let central = 0;
    function add(name, bytes) {
      const nameBytes = encoder.encode(name).byteLength;
      if (written + 30 + nameBytes + bytes.byteLength + 16 + central + 46 + nameBytes + 22 > limit) throw fault('backup_too_large', '백업이 3.5 GiB를 넘어 ZIP 하나로 만들 수 없습니다. 형식별로 나눠 받아 주세요.');
      central += 46 + nameBytes;
      const entry = new F.ZipPassThrough(name); archive.add(entry); entry.push(bytes, true); if (error) throw error;
    }
    async function collect({ only = null, onProgress = () => {}, isCurrent = () => true } = {}) {
      if (finished) throw fault('backup_finished', '이미 마친 백업입니다. 다시 받아 주세요.');
      const tasks = planned.tasks.filter(task => only ? only.has(task.id) : !results.has(task.id));
      let done = 0;
      for (let index = 0; index < tasks.length; index++) {
        const task = tasks[index];
        if (!isCurrent()) throw fault('backup_cancelled', '계정이나 화면이 바뀌어 백업을 멈췄습니다. 자료는 바뀌지 않았습니다.');
        onProgress({ phase: 'read', done, total: tasks.length, task });
        if (task.relist) {
          // A list that failed in plan stays failed until a retry reads it again.
          if (!only) results.set(task.id, { status: 'failed', error: task.listError || '목록을 읽지 못했습니다.' });
          else try {
            const ws = planned.workspaces.find(row => row.index === task.workspace) || null;
            const value = await list(task.kind, ws, context);
            planned.tasks.splice(planned.tasks.indexOf(task), 1, ...value.tasks);
            results.delete(task.id); skipped.push(...value.skipped); tasks.push(...value.tasks);
          } catch (cause) { results.set(task.id, { status: 'failed', error: message(cause) }); }
          done++; await pause(); continue;
        }
        let item = null;
        try {
          item = await readPart(task, { ...context, workspaces: planned.workspaces });
          const bytes = item.blob ? await blobBytes(item.blob) : json(item.value);
          if (!item.blob && bytes.byteLength > LIMITS.json) throw fault('part_too_large', KINDS[task.kind].label + ' 파일이 512 MiB를 넘습니다.');
          // Everything the manifest needs is computed first; nothing that can fail follows the write.
          const format = item.format || item.value.format || 'haedo-backup-v1', hash = await sha256(bytes);
          const result = { status: 'ok', size: bytes.byteLength, sha256: hash, format, formatVersion: versionOf(format, item.value),
            counts: item.counts || COUNT[task.kind](item.value), meta: item.meta || null };
          add(task.path, bytes);
          results.set(task.id, result);
          for (const row of item.skipped || []) skipped.push(row);
        } catch (cause) {
          if (cause?.code === 'backup_too_large' || cause === error) throw cause;
          results.set(task.id, { status: 'failed', error: message(cause) });
        }
        item = null; // Drop the Blob before reading the next item.
        done++; await pause();
      }
      onProgress({ phase: 'read', done, total: tasks.length });
      return failed();
    }
    const failed = () => planned.tasks.filter(task => results.get(task.id)?.status !== 'ok');
    function finish({ partial = false } = {}) {
      if (finished) throw fault('backup_finished', '이미 마친 백업입니다. 다시 받아 주세요.');
      const missingTasks = failed();
      if (missingTasks.length && !partial) throw fault('backup_incomplete', '일부 항목을 읽지 못해 ZIP을 마치지 않았습니다.', { failed: missingTasks.map(task => task.id) });
      const ok = planned.tasks.filter(task => results.get(task.id)?.status === 'ok');
      if (!ok.length) throw fault('backup_empty', '담을 수 있는 항목이 없습니다.');
      const files = ok.map(task => {
        const result = results.get(task.id);
        return { path: task.path, kind: task.kind, workspace: task.workspace, ...(result.meta || {}), format: result.format, formatVersion: result.formatVersion,
          counts: result.counts, bytes: result.size, sha256: result.sha256 };
      });
      const missing = missingTasks.map(task => ({ kind: task.kind, workspace: task.workspace, reason: 'read_failed', ...(task.relist ? { list: true } : {}),
        ...(task.postId ? { postId: task.postId } : {}), ...(task.title ? { title: task.title } : {}), error: results.get(task.id)?.error || '읽지 못했습니다.' }))
        .concat(skipped.map(row => ({ reason: 'skipped', ...row })));
      const manifest = { format: FORMAT, version: VERSION, createdAt: now(), appVersion, complete: !missingTasks.length,
        workspaces: planned.workspaces.map(ws => ({ index: ws.index, workspaceId: ws.workspaceId, title: ws.title, recovery: ws.recovery })),
        files, missing, notIncluded: planned.notIncluded };
      // The lists go last: they describe what was actually written. Readers use the central directory.
      add('README.txt', encoder.encode(readme(manifest)));
      add('manifest.json', pretty(manifest));
      archive.end(); if (error) throw error; flush(); finished = true;
      if (written > limit) throw fault('backup_too_large', '백업이 3.5 GiB를 넘어 ZIP 하나로 만들 수 없습니다. 형식별로 나눠 받아 주세요.');
      const stamp = manifest.createdAt.slice(0, 10);
      return { blob: new Blob(parts, { type: 'application/zip' }), manifest, bytes: written,
        fileName: 'haedo-backup-' + stamp + (missingTasks.length ? '-partial' : '') + '.zip' };
    }
    return { collect, finish, failed, results, get bytes() { return written; } };
  }

  // ---- Reading a ZIP lazily from its central directory (stored entries only) ----
  let crcTable;
  function crc32(bytes) {
    if (!crcTable) crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
      return value >>> 0;
    });
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
    return (crc ^ 0xffffffff) >>> 0;
  }
  async function zipEntries(file) {
    const bad = () => fault('invalid_zip', 'ZIP 파일 구조를 읽지 못했습니다. 원래 파일은 그대로 두었습니다.');
    if (file.size < 22) throw bad();
    const tailSize = Math.min(file.size, 22 + 65535), tailStart = file.size - tailSize;
    const tail = await blobBytes(file.slice(tailStart)), view = new DataView(tail.buffer);
    let end = -1;
    for (let at = tail.byteLength - 22; at >= 0; at--) if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
    if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw bad();
    const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
    if (count !== view.getUint16(end + 8, true) || count > LIMITS.files || offset + size !== tailStart + end || size > 64 * MiB) throw bad();
    const directory = await blobBytes(file.slice(offset, offset + size)), dir = new DataView(directory.buffer), decoder = new TextDecoder('utf-8', { fatal: true });
    const entries = new Map(); let at = 0;
    for (let index = 0; index < count; index++) {
      if (at + 46 > directory.byteLength || dir.getUint32(at, true) !== 0x02014b50) throw bad();
      const flags = dir.getUint16(at + 8, true), method = dir.getUint16(at + 10, true), crc = dir.getUint32(at + 16, true);
      const compressed = dir.getUint32(at + 20, true), length = dir.getUint32(at + 24, true), nameLength = dir.getUint16(at + 28, true);
      const extra = dir.getUint16(at + 30, true), comment = dir.getUint16(at + 32, true), local = dir.getUint32(at + 42, true);
      if (method !== 0 || compressed !== length || flags & ~0x0808 || at + 46 + nameLength + extra + comment > directory.byteLength) throw fault('invalid_zip', '압축하지 않은 해도 ZIP만 열 수 있습니다.');
      let name;
      try { name = decoder.decode(directory.subarray(at + 46, at + 46 + nameLength)); } catch (_) { throw bad(); }
      if (entries.has(name) || name.includes('..') || name.startsWith('/')) throw fault('invalid_zip', '중복되거나 허용하지 않는 ZIP 경로가 있습니다.');
      entries.set(name, { name, size: length, crc, local });
      at += 46 + nameLength + extra + comment;
    }
    if (at !== directory.byteLength) throw bad();
    // Local headers decide where each entry's bytes begin; they must agree with the directory.
    const sorted = [...entries.values()].sort((a, b) => a.local - b.local);
    let previousEnd = 0;
    for (const entry of sorted) {
      if (entry.local < previousEnd || entry.local + 30 > offset) throw bad();
      const header = await blobBytes(file.slice(entry.local, entry.local + 30)), h = new DataView(header.buffer);
      if (h.getUint32(0, true) !== 0x04034b50 || h.getUint16(8, true) !== 0) throw bad();
      const nameLength = h.getUint16(26, true), extra = h.getUint16(28, true), start = entry.local + 30 + nameLength + extra;
      const nameBytes = await blobBytes(file.slice(entry.local + 30, entry.local + 30 + nameLength));
      if (decoder.decode(nameBytes) !== entry.name || start + entry.size > offset) throw bad();
      entry.blob = file.slice(start, start + entry.size);
      previousEnd = start + entry.size;
    }
    return entries;
  }
  async function entryText(entry, limit) {
    if (entry.size > limit) throw fault('part_too_large', '백업 안의 파일이 너무 큽니다.');
    const bytes = await blobBytes(entry.blob);
    if (bytes.byteLength !== entry.size) throw fault('invalid_zip', 'ZIP 파일 크기가 기록과 다릅니다.');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_) { throw fault('invalid_backup', 'UTF-8 파일을 읽지 못했습니다.'); }
  }
  function parseJson(text, label) {
    try { return JSON.parse(text); } catch (_) { throw fault('invalid_backup', label + ' JSON을 읽지 못했습니다.'); }
  }

  // ---- Opening any supported file ----
  function detectJson(data) {
    if (!plain(data)) return null;
    const format = data.format;
    if (['life-tools-backup-v1', 'life-workbench-backup-v1', dep('SourceFolders').BACKUP_FORMAT].includes(format)) return 'library';
    if (format === 'life-collection-backup-v1') return 'collection';
    if (['life-nine-board-backup-v1', 'life-nine-board-backup-v2'].includes(format)) return 'nineBoards';
    if (format === 'life-material-writing-v1') return 'materialWriting';
    if (format === DOCS_FORMAT) return 'accountDocuments';
    if (['haedo-platform-backup-v1', 'haedo-backup-v1'].includes(format) || format === undefined && Array.isArray(data.docs)) return 'timeline';
    if (format === 'haedo-annual-plan') return 'annualPlan';
    return null;
  }
  function validateDocuments(data) {
    if (!plain(data) || data.format !== DOCS_FORMAT || !Array.isArray(data.documents) || typeof data.exportedAt !== 'string')
      throw fault('invalid_backup', '계정 설정·기록 문서 파일의 형식을 확인해 주세요.');
    for (const doc of data.documents) {
      if (!plain(doc) || ![...ACCOUNT_PREFIXES, ...WORKSPACE_PREFIXES].includes(doc.prefix) || !ID.test(doc.workspaceId || '') ||
        doc.prefix === 'post-evidence' && !ID.test(doc.postId || '') || !Object.hasOwn(doc, 'value'))
        throw fault('invalid_backup', '계정 설정·기록 문서의 항목을 확인해 주세요.');
    }
    return data;
  }
  function libraryTitle(data) { return libraryParts(data)?.bundle?.title || null; }
  async function open(file, { onProgress = () => {}, limit = LIMITS.bundle } = {}) {
    if (!file || !Number.isSafeInteger(file.size) || file.size < 2) throw fault('invalid_backup', '백업 파일을 골라 주세요.');
    const head = await blobBytes(file.slice(0, 4));
    if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4) {
      if (file.size > limit) throw fault('backup_too_large', '3.5 GiB 이하의 백업 ZIP을 골라 주세요.');
      const entries = await zipEntries(file), list = entries.get('manifest.json') || entries.get('series.json');
      if (!list) throw fault('unsupported_backup', '해도 백업 ZIP이 아닙니다. 목록 파일(manifest.json)이 없습니다.');
      const text = await entryText(list, LIMITS.manifest);
      const raw = encoder.encode(text);
      if (crc32(raw) !== list.crc) throw fault('tampered', '목록 파일이 손상됐습니다. 이 파일은 복원하지 않았습니다.');
      const manifest = parseJson(text, '목록'), fingerprint = await sha256(raw);
      if (manifest?.format === FORMAT) return { ...await verifyBundle(manifest, entries, onProgress), fingerprint, fileName: file.name || '' };
      if (typeof manifest?.format === 'string' && manifest.format.startsWith('haedo-full-backup-'))
        throw fault('unsupported_version', '이 앱이 모르는 전체 백업 버전입니다(' + manifest.format + '). 앱을 새로 고친 뒤 다시 시도해 주세요.');
      const single = (kind, title, counts, extra = {}) => ({ type: 'single', fileName: file.name || '', fingerprint, file,
        workspaces: [{ index: 1, workspaceId: null, title: title || '복원한 ' + KINDS[kind].label }],
        entries: [{ kind, workspace: 1, format: manifest.format, formatVersion: versionOf(manifest.format), blob: file, counts, title: title || '', ...extra }] });
      if (PHOTO_FORMATS.includes(manifest?.format)) {
        const photos = Array.isArray(manifest.photos) ? manifest.photos : [];
        return single('photoPosts', manifest.title, { posts: 1, photos: photos.length, views: photos.filter(photo => photo?.view).length });
      }
      if (manifest?.format === 'life-blog-series-package-v1')
        return single('blogSeries', manifest.series?.title, { series: 1, seriesPosts: Array.isArray(manifest.posts) ? manifest.posts.length : 0 });
      if (manifest?.format === 'haedo.naver.capture.v1') return single('naverCaptures', manifest.bundle?.sources?.[0]?.title,
        { captures: 1, photos: Array.isArray(manifest.attachment?.photos) ? manifest.attachment.photos.length : 0 });
      if (manifest?.format === 'life-preservation-package-v1') return { type: 'preservation', fileName: file.name || '', fingerprint, file, format: manifest.format, formatVersion: 1,
        counts: { posts: Array.isArray(manifest.posts) ? manifest.posts.length : 0, sources: manifest.bundle?.sources?.length || 0 } };
      throw fault('unsupported_backup', '지원하지 않는 ZIP 형식입니다. Obsidian ZIP은 내보내기·사본 복원, 원본 파트 ZIP은 원본 첨부 화면에서 복원해 주세요.');
    }
    if (file.size > LIMITS.json) throw fault('backup_too_large', '512 MiB 이하의 JSON 백업을 골라 주세요.');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await blobBytes(file)); } catch (_) { throw fault('invalid_backup', 'UTF-8 JSON 백업을 읽지 못했습니다.'); }
    const data = parseJson(text, '백업');
    const kind = detectJson(data);
    if (!kind) throw fault('unsupported_backup', '지원하지 않는 백업 형식입니다. 해도에서 받은 백업 파일을 골라 주세요.');
    const format = data.format || 'haedo-backup-v1';
    if (kind === 'timeline' || kind === 'annualPlan') return { type: 'external', kind, fileName: file.name || '', format, formatVersion: versionOf(format, data),
      counts: kind === 'timeline' ? COUNT.timeline(data) : {}, text };
    if (kind === 'accountDocuments') validateDocuments(data);
    const workspaces = kind === 'accountDocuments'
      ? [...new Set(data.documents.map(doc => doc.workspaceId))].map((workspaceId, i) => ({ index: i + 1, workspaceId, title: '복원한 설정 · ' + (i + 1) }))
      : [{ index: 1, workspaceId: libraryParts(data)?.bundle?.workspaceId || (kind === 'materialWriting' ? data.workspaceId : null), title: libraryTitle(data) || '복원한 ' + KINDS[kind].label }];
    let counts;
    try { counts = COUNT[kind](data); } catch (_) { throw fault('invalid_backup', KINDS[kind].label + ' 파일의 형식을 확인해 주세요.'); }
    return { type: 'single', fileName: file.name || '', fingerprint: await sha256(encoder.encode(text)), workspaces,
      entries: [{ kind, workspace: kind === 'accountDocuments' ? null : 1, format, formatVersion: versionOf(format, data), counts, data }] };
  }
  async function verifyBundle(manifest, entries, onProgress) {
    const invalid = text => fault('invalid_backup', text);
    if (!plain(manifest) || ![1, 2, 3].includes(manifest.version)) throw fault('unsupported_version', '이 앱이 모르는 전체 백업 버전입니다. 앱을 새로 고친 뒤 다시 시도해 주세요.');
    const v1 = manifest.version === 1;
    const keys = ['format', 'version', 'createdAt', 'appVersion', 'complete', 'workspaces', 'files', 'missing', ...(v1 ? [] : ['notIncluded'])];
    if (Object.keys(manifest).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(manifest, key))) throw invalid('전체 백업 목록의 항목을 확인해 주세요.');
    if (!Array.isArray(manifest.workspaces) || !Array.isArray(manifest.files) || !Array.isArray(manifest.missing) || typeof manifest.complete !== 'boolean' ||
      !Number.isFinite(Date.parse(manifest.createdAt)) || !v1 && !Array.isArray(manifest.notIncluded)) throw invalid('전체 백업 목록의 항목을 확인해 주세요.');
    // complete = no read failure. Version 1 had no skipped entries.
    const readFailures = manifest.missing.filter(item => v1 || item?.reason !== 'skipped');
    if (manifest.missing.some(item => !plain(item) || !KINDS[item.kind] || !v1 && !['read_failed', 'skipped'].includes(item.reason)) || manifest.complete !== !readFailures.length)
      throw invalid('빠진 항목 목록을 확인해 주세요.');
    if (!v1 && manifest.notIncluded.some(item => !plain(item) || typeof item.kind !== 'string' || typeof item.label !== 'string' || typeof item.reason !== 'string' || typeof item.whereToSave !== 'string'))
      throw invalid('담지 않은 종류 목록을 확인해 주세요.');
    const indexes = new Set();
    for (const ws of manifest.workspaces) {
      if (!plain(ws) || !Number.isSafeInteger(ws.index) || ws.index < 1 || indexes.has(ws.index) || typeof ws.title !== 'string' || !ID.test(ws.workspaceId || '')) throw invalid('자료공간 목록을 확인해 주세요.');
      indexes.add(ws.index);
    }
    const allowed = v1 ? ['library', 'collection', 'photoPosts', 'nineBoards', 'accountDocuments', 'timeline'] : ORDER;
    const expected = new Set(['README.txt', 'manifest.json']);
    for (const file of manifest.files) {
      if (!plain(file) || !allowed.includes(file.kind) || typeof file.path !== 'string' || !PATH_KIND[file.kind].test(file.path) || expected.has(file.path) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[0-9a-f]{64}$/.test(file.sha256 || '') || typeof file.format !== 'string' ||
        (file.workspace !== null && !indexes.has(file.workspace)) || (file.workspace === null) !== ACCOUNT_KINDS.includes(file.kind))
        throw invalid('파일 목록의 항목을 확인해 주세요.');
      if (file.workspace && !file.path.startsWith('workspaces/' + pad(file.workspace) + '/')) throw invalid('파일 경로와 자료공간이 맞지 않습니다.');
      if (file.kind === 'photoPosts' && (!ID.test(file.postId || '') || !['saved', 'draft'].includes(file.status) || typeof file.archived !== 'boolean' ||
        !file.path.endsWith('/' + file.postId + '.zip'))) throw invalid('사진 글 항목을 확인해 주세요.');
      if (ZIP_FORMATS[file.kind] && !ZIP_FORMATS[file.kind].includes(file.format)) throw invalid(file.path + '의 형식이 목록과 다릅니다.');
      expected.add(file.path);
    }
    if (entries.size !== expected.size || [...entries.keys()].some(name => !expected.has(name)))
      throw fault('tampered', 'ZIP 안의 파일이 목록과 다릅니다. 이 파일은 복원하지 않았습니다.');
    const result = [];
    let done = 0;
    for (const file of manifest.files) {
      onProgress({ phase: 'verify', done, total: manifest.files.length });
      const entry = entries.get(file.path), bytes = await blobBytes(entry.blob);
      if (bytes.byteLength !== file.bytes || await sha256(bytes) !== file.sha256)
        throw fault('tampered', file.path + '의 내용이 목록의 SHA-256과 다릅니다. 이 파일은 복원하지 않았습니다.');
      const item = { ...file, blob: entry.blob };
      if (file.path.endsWith('.json')) {
        const data = parseJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), KINDS[file.kind].label);
        if ((data.format || 'haedo-backup-v1') !== file.format || detectJson(data) !== file.kind) throw invalid(file.path + '의 형식이 목록과 다릅니다.');
        if (file.kind === 'accountDocuments') validateDocuments(data);
        item.data = data;
      }
      result.push(item); done++;
      await pause();
    }
    onProgress({ phase: 'verify', done, total: manifest.files.length });
    return { type: 'bundle', manifest, workspaces: clone(manifest.workspaces), entries: result };
  }
  function summarize(opened) {
    if (opened.type !== 'single' && opened.type !== 'bundle') return [];
    const kinds = {};
    for (const entry of opened.entries) {
      const row = kinds[entry.kind] ||= { kind: entry.kind, label: KINDS[entry.kind].label, files: 0, counts: {}, workspaces: new Set(), formats: new Set(), restorable: entry.kind !== 'timeline' };
      row.files++; addCounts(row.counts, entry.counts); row.formats.add(entry.format + ' v' + entry.formatVersion);
      if (entry.workspace) row.workspaces.add(entry.workspace);
      if (entry.kind === 'accountDocuments') for (const doc of entry.data.documents) {
        const ws = opened.workspaces.find(item => item.workspaceId === doc.workspaceId);
        if (ws) row.workspaces.add(ws.index);
      }
    }
    return ORDER.filter(kind => kinds[kind]).map(kind => ({ ...kinds[kind], workspaces: kinds[kind].workspaces.size, formats: [...kinds[kind].formats] }));
  }

  // ---- Local receipts: which backups this account already restored ----
  function receipts(storage, localStorage) {
    const key = 'haedo-full-backup-restored:' + accountKeyOf(storage);
    const read = () => { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; } catch (_) { return []; } };
    return Object.freeze({
      find(fingerprint) { return fingerprint ? read().filter(row => row.fingerprint === fingerprint).at(-1) || null : null; },
      record(row) {
        if (!row.fingerprint) return;
        const rows = read().concat({ fingerprint: row.fingerprint, createdAt: row.createdAt || null, fileName: row.fileName || '', restoredAt: new Date().toISOString(), copies: row.copies || 0 });
        try { localStorage.setItem(key, JSON.stringify(rows.slice(-LIMITS.receipts))); } catch (_) { /* The warning is a convenience; restore already committed. */ }
      }
    });
  }

  // ---- Restore: one new workspace copy per original workspace ----
  function remap(value, map) {
    if (typeof value === 'string') return map.has(value) ? map.get(value) : value;
    if (Array.isArray(value)) return value.map(item => remap(item, map));
    if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item, map)]));
    return value;
  }
  function libraryMapping(original, restored) {
    // Core.restoreBackup keeps each collection's order while issuing new IDs.
    const map = new Map([[original.workspaceId, restored.workspaceId]]);
    for (const name of ['sources', 'sourceVersions', 'records', 'links', 'resumeHints', 'tombstones']) {
      const before = original[name] || [], after = restored[name] || [];
      if (before.length !== after.length) throw fault('restore_mapping', '복원한 자료의 순서를 확인하지 못했습니다.');
      before.forEach((item, index) => map.set(item.id, after[index].id));
    }
    return map;
  }
  // A restored copy gets the original title with the restore date, e.g.
  // "내 자료 (11-02 복원)"; a second copy made the same day is "(11-02 복원 2)".
  // The title is only a label: the copy is identified by its restored-copy
  // marker, never by this text, since the person may rename it.
  function restoredTitle(base, taken, date) {
    const day = String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    const name = String(base || '').trim() || '복원한 자료공간';
    for (let n = 1; ; n++) {
      const suffix = ' (' + day + ' 복원' + (n > 1 ? ' ' + n : '') + ')';
      // Titles are limited to 500 UTF-16 units; cut whole characters only.
      let head = '';
      for (const char of name) { if (head.length + char.length + suffix.length > 500) break; head += char; }
      const title = head + suffix;
      if (!taken.has(title)) { taken.add(title); return title; }
    }
  }
  async function installLibrary(storage, data, { title, restoredCopy } = {}) {
    const options = restoredCopy ? { restoredCopy } : undefined;
    if (data.format === 'life-tools-backup-v1') {
      const bundle = await dep('Core').restoreBackup(clone(data));
      if (title) bundle.title = title;
      const installed = await storage.installWorkspace(bundle, options);
      return { bundle: installed, map: libraryMapping(data.workspace, installed) };
    }
    const material = data.format === dep('SourceFolders').BACKUP_FORMAT;
    const candidate = material ? await dep('SourceFolders').restoreBackup(clone(data)) : await dep('Workbench').restoreBackup(clone(data));
    if (title) candidate.bundle.title = title;
    // Same choice as the 자료·구성 screen: folders and library commit together.
    const installed = candidate.sourceFolders && storage.installLibraryCopy ? await storage.installLibraryCopy(candidate, options) : await storage.installWorkbenchCopy({ bundle: candidate.bundle, workbench: candidate.workbench }, options);
    const original = material ? data.libraryBackup.sourceBackup.workspace : data.sourceBackup.workspace;
    return { bundle: installed.bundle, map: libraryMapping(original, installed.bundle) };
  }
  function defaultVerifyPhoto() {
    if (!root.document || typeof root.File !== 'function') return null;
    // Same check as the photo editor's ZIP restore: the displayed image must decode at its recorded size.
    return async candidate => {
      const P = dep('PhotoPost');
      for (const p of candidate.photos) {
        const shown = p.view || p;
        const checked = await P.readPhoto(new root.File([shown.blob], p.name, { type: shown.type }), () => p.id);
        if (checked.width !== shown.width || checked.height !== shown.height) throw fault('photo_mismatch', '사진 해상도 정보가 실제 원본과 다릅니다.');
      }
    };
  }
  async function entryData(entry) {
    if (entry.data !== undefined) return entry.data;
    return parseJson(await entryText(entry, LIMITS.json), KINDS[entry.kind].label);
  }
  // A reference survives only when its exact target came along into this copy.
  function keepReference(reference, target) {
    const value = reference?.value;
    if (!value || value.workspaceId !== target.workspaceId) return false;
    if (reference.kind === 'source') return target.library;
    if (reference.kind === 'post') return [...target.posts.values()].includes(value.postId);
    return false;
  }
  // `select(kind, workspaceIndex, entry)` decides what to restore; `targets`
  // carries copies made by an earlier run so a retry fills the same new copy.
  async function restore(opened, { storage, kinds, select = null, targets = new Map(), makeId = () => dep('Core').id(), originals = null,
    verifyPhoto = defaultVerifyPhoto(), onProgress = () => {}, isCurrent = () => true, now = () => new Date() } = {}) {
    if (!storage?.isAccountScoped || !storage.account) throw fault('auth_scope_required', '로그인한 계정에서 복원해 주세요.');
    if (opened.type !== 'bundle' && opened.type !== 'single') throw fault('unsupported_backup', '이 화면에서 복원할 수 없는 파일입니다.');
    const wanted = (kind, ws, entry) => kinds.has(kind) && (!select || select(kind, ws, entry));
    const guard = () => { if (!isCurrent()) throw fault('restore_cancelled', '계정이나 화면이 바뀌어 복원을 멈췄습니다. 이미 만든 새 사본은 그대로 있습니다.'); };
    const docsEntry = opened.entries.find(entry => entry.kind === 'accountDocuments');
    const documents = docsEntry ? (await entryData(docsEntry)).documents : [];
    const previousActive = await storage.getActive().catch(() => null);
    const report = { workspaces: [], items: [], extraCopies: [] };
    // Titles already in use on this device, so a copy never shares a name.
    const taken = new Set((storage.listWorkspaces ? await storage.listWorkspaces() : []).map(row => row.title));
    const startedAt = now(), restoredAt = startedAt.toISOString();
    // The marker names the original workspace (when the file says which one), so the
    // home can leave the copy out while that original is in this account.
    const restoredCopyOf = workspaceId => ({ sourceWorkspaceId: ID.test(workspaceId || '') ? workspaceId : null, restoredAt });
    const record = (kind, ws, status, details = {}) => { const item = { kind, label: KINDS[kind].label, workspace: ws.index, workspaceTitle: ws.title, status, ...details }; report.items.push(item); return item; };
    const work = opened.workspaces.map(ws => {
      const own = opened.entries.filter(entry => entry.workspace === ws.index && wanted(entry.kind, ws.index, entry));
      const docs = wanted('accountDocuments', ws.index, null) ? documents.filter(doc => doc.workspaceId === ws.workspaceId && doc.prefix !== 'post-evidence') : [];
      return { ws, own, docs };
    }).filter(item => item.own.length || item.docs.length);
    const accountParts = opened.entries.filter(entry => entry.kind === 'originals' && wanted('originals', null, entry));
    const total = work.reduce((sum, item) => sum + item.own.length + (item.docs.length ? 1 : 0), 0) + accountParts.length;
    let done = 0;
    const step = label => onProgress({ phase: 'restore', done: done++, total, label });
    try {
      for (const { ws, own, docs } of work) {
        guard();
        const target = targets.get(ws.index) || { workspaceId: null, title: ws.title, map: new Map(), posts: new Map(), postDocs: new Map(), library: false, appliedDocs: new Set() };
        targets.set(ws.index, target);
        // One planned name per copy, chosen when the copy is made; a retry keeps it.
        const copyTitle = () => (target.copyTitle ||= restoredTitle(ws.title, taken, startedAt));
        const summary = { index: ws.index, title: ws.title, targetId: target.workspaceId, targetTitle: target.title };
        report.workspaces.push(summary);
        const library = own.find(entry => entry.kind === 'library');
        if (library) {
          step(KINDS.library.label);
          try {
            const data = await entryData(library); guard();
            const installed = await installLibrary(storage, data, { title: copyTitle(), restoredCopy: restoredCopyOf(ws.workspaceId) });
            target.workspaceId = installed.bundle.workspaceId; target.title = installed.bundle.title;
            for (const [from, to] of installed.map) target.map.set(from, to);
            target.library = true;
            if (ws.workspaceId) target.map.set(ws.workspaceId, target.workspaceId);
            record('library', ws, 'restored', { targetId: target.workspaceId, counts: COUNT.library(data) });
          } catch (error) {
            if (error?.code === 'restore_cancelled') throw error;
            record('library', ws, 'failed', { message: message(error) });
            // Without the library, references of the other parts would point nowhere.
            for (const entry of own.filter(item => item !== library)) record(entry.kind, ws, 'skipped', { postId: entry.postId, title: entry.title,
              message: '자료·구성 복원이 실패해 이 자료공간의 나머지 형식도 복원하지 않았습니다.' });
            if (docs.length) record('accountDocuments', ws, 'skipped', { message: '자료·구성 복원이 실패해 설정 문서도 복원하지 않았습니다.' });
            summary.status = 'failed';
            continue;
          }
        }
        // A lone capture file restores into its own new workspace; captures from a ZIP need the library copy.
        const nonCopy = own.every(entry => entry.kind === 'naverCaptures') && !docs.length;
        if (!target.workspaceId && !nonCopy) {
          const created = await storage.createWorkspace(copyTitle(), { restoredCopy: restoredCopyOf(ws.workspaceId) });
          target.workspaceId = created.workspaceId; target.title = created.title;
          if (ws.workspaceId) target.map.set(ws.workspaceId, target.workspaceId);
        }
        summary.targetId = target.workspaceId; summary.targetTitle = target.title;
        const id = target.workspaceId;
        for (const entry of own.filter(item => item.kind === 'collection')) {
          step(KINDS.collection.label); guard();
          try {
            const data = await entryData(entry), C = dep('Collection'), state = await storage.readCollection(id);
            const next = C.appendBackup(state, data, makeId);
            await storage.saveCollection(id, next, state.revision);
            record('collection', ws, 'restored', { targetId: id, counts: COUNT.collection(data) });
          } catch (error) { if (error?.code === 'restore_cancelled') throw error; record('collection', ws, 'failed', { message: message(error) }); }
        }
        for (const entry of own.filter(item => item.kind === 'photoPosts')) {
          step(KINDS.photoPosts.label); guard();
          try {
            const P = dep('PhotoPost'), candidate = await P.readBackup(entry.blob, makeId);
            // The legacy ZIP reader intentionally upgrades v1 to a v2 draft.
            // Compare the Markdown boundary, not that restored legacy version.
            if ((entry.format === 'life-post-md-backup-v1') !== (candidate.format === 'life-post-md-v1'))
              throw fault('invalid_backup', '백업 목록과 글 ZIP의 문서 형식이 다릅니다.');
            if (verifyPhoto) await verifyPhoto(candidate);
            // The bundle's manifest keeps each post's state; the ZIP alone restores a draft as before.
            if (entry.status === 'saved') candidate.status = 'saved';
            if (entry.archived === true && ['life-photo-post-v2', 'life-post-md-v1'].includes(candidate.format)) candidate.archived = true;
            const evidence = entry.postId && documents.find(doc => doc.prefix === 'post-evidence' && doc.workspaceId === ws.workspaceId && doc.postId === entry.postId);
            let saved, evidenceNote = null;
            if (evidence?.value?.refs?.length && target.library) {
              const refs = remap(evidence.value.refs, target.map);
              try { saved = await storage.savePhotoPostWithEvidence(id, candidate, 0, refs, 0); }
              catch (error) { evidenceNote = '인용 근거 ' + refs.length + '개는 원문과 맞지 않아 연결하지 않았습니다.'; }
            } else if (evidence?.value?.refs?.length) evidenceNote = '자료·구성을 함께 복원하지 않아 인용 근거 ' + evidence.value.refs.length + '개를 연결하지 않았습니다.';
            if (!saved) saved = await storage.savePhotoPost(id, candidate, 0);
            if (entry.postId) { target.posts.set(entry.postId, saved.id); target.map.set(entry.postId, saved.id); target.postDocs.set(saved.id, saved); }
            // times: 'kept' | 'missing' (a backup without the post's times: the restore time) | 'adjusted' (a time later than now).
            record('photoPosts', ws, 'restored', { targetId: id, postId: entry.postId, newPostId: saved.id, title: saved.title, postStatus: saved.status,
              times: P.backupTimes?.(candidate) || 'missing', counts: entry.counts, ...(evidenceNote ? { message: evidenceNote } : {}) });
          } catch (error) { if (error?.code === 'restore_cancelled') throw error; record('photoPosts', ws, 'failed', { postId: entry.postId, title: entry.title, message: message(error) }); }
        }
        for (const entry of own.filter(item => item.kind === 'nineBoards')) {
          step(KINDS.nineBoards.label); guard();
          try {
            const N = dep('NineBoard'), incoming = remap(N.readBackup(await entryData(entry)), target.map);
            // Exact source versions point to their copies when they came along; otherwise the reference is dropped.
            let dropped = 0;
            for (const board of incoming) for (const area of board.areas) for (const item of area.items) {
              if (Object.hasOwn(item, 'reference') && !keepReference(item.reference, target)) { delete item.reference; dropped++; }
              else if (item.reference?.kind === 'post') {
                // The restored post starts at a new revision. Follow it only when its body is the referenced one.
                const post = target.postDocs.get(item.reference.value.postId);
                if (post && post.revision !== item.reference.value.postRevision) {
                  const current = await dep('SourceReference').buildPost({ workspaceId: target.workspaceId, post });
                  if (current.contentHash === item.reference.value.contentHash) item.reference.value = { ...item.reference.value, postRevision: post.revision };
                }
              }
            }
            const added = N.copies(incoming, makeId), state = await storage.readNineBoard(id);
            const next = { ...state, format: N.hasReferences(state.boards.concat(added)) ? 'life-nine-board-v2' : state.format, boards: state.boards.concat(added) };
            N.validate(next);
            if (added.length) await storage.saveNineBoardCopy(id, next, next.revision);
            record('nineBoards', ws, 'restored', { targetId: id, counts: COUNT.nineBoards({ boards: added }),
              ...(dropped ? { message: '함께 복원하지 않은 원문·글을 가리키던 근거 ' + dropped + '개는 연결하지 않았습니다. 선택 이유와 제목은 남겼습니다.' } : {}) });
          } catch (error) { if (error?.code === 'restore_cancelled') throw error; record('nineBoards', ws, 'failed', { message: message(error) }); }
        }
        for (const entry of own.filter(item => item.kind === 'blogSeries')) {
          step(KINDS.blogSeries.label); guard();
          try {
            const candidate = await dep('BlogSeriesPackage').read(entry.blob);
            await storage.installBlogSeriesCopy(id, candidate);
            record('blogSeries', ws, 'restored', { targetId: id, title: candidate.series.title, counts: entry.counts });
          } catch (error) { if (error?.code === 'restore_cancelled') throw error; record('blogSeries', ws, 'failed', { title: entry.title, message: message(error) }); }
        }
        for (const entry of own.filter(item => item.kind === 'materialWriting')) {
          step(KINDS.materialWriting.label); guard();
          try {
            const M = dep('MaterialWriting'), data = M.validate(clone(await entryData(entry)));
            if (!data.plans.length) { record('materialWriting', ws, 'restored', { targetId: id, counts: { plans: 0 } }); continue; }
            if (!target.library) { record('materialWriting', ws, 'skipped', { message: '준비는 정확한 원문 버전을 가리키므로 자료·구성을 함께 복원할 때만 복원합니다.' }); continue; }
            // Exact versions move to their copies; each plan gets a new identity and no post link.
            const linked = data.plans.filter(plan => plan.output !== null).length;
            const plans = remap(data.plans, target.map).map(plan => ({ ...plan, id: makeId(), output: null }));
            const state = await storage.readMaterialWriting(id), next = { ...state, plans: state.plans.concat(plans) };
            M.validate(next);
            await storage.saveMaterialWriting(id, next, state.revision);
            record('materialWriting', ws, 'restored', { targetId: id, counts: { plans: plans.length },
              ...(linked ? { message: '글과 연결돼 있던 준비 ' + linked + '개는 연결 없이 복원했습니다. 글은 사진 글로 따로 복원됩니다.' } : {}) });
          } catch (error) { if (error?.code === 'restore_cancelled') throw error; record('materialWriting', ws, 'failed', { message: message(error) }); }
        }
        for (const entry of own.filter(item => item.kind === 'naverCaptures')) {
          step(KINDS.naverCaptures.label); guard();
          try {
            const Media = dep('NaverMedia'), snapshot = await Media.read(entry.blob);
            if (opened.type === 'single') {
              // A single capture file: the existing restore makes one new workspace with its version and photos.
              const installed = await storage.installNaverCaptureCopy(await Media.copy(snapshot, { title: restoredTitle(snapshot.bundle.title, taken, startedAt) }),
                { isCurrent, restoredCopy: restoredCopyOf(null) });
              report.extraCopies.push({ workspaceId: installed.bundle.workspaceId, title: installed.bundle.title });
              record('naverCaptures', ws, 'restored', { targetId: installed.bundle.workspaceId, title: installed.bundle.title, counts: entry.counts });
              continue;
            }
            // From a backup ZIP the photos join the same exact version in this workspace's restored library copy.
            const sourceId = target.library && target.map.get(snapshot.attachment.sourceId), versionId = target.library && target.map.get(snapshot.attachment.sourceVersionId);
            if (!sourceId || !versionId) {
              record('naverCaptures', ws, 'skipped', { title: snapshot.bundle.sources[0]?.title || entry.title, counts: entry.counts,
                message: '원문 사진은 자료·구성과 함께 복원하세요. 사진을 붙일 같은 원문 버전이 이 복원에 없습니다.' });
              continue;
            }
            await storage.attachNaverCaptureCopy(id, { ...snapshot.attachment, sourceId, sourceVersionId: versionId }, { isCurrent });
            record('naverCaptures', ws, 'restored', { targetId: id, title: snapshot.bundle.sources[0]?.title || entry.title, counts: entry.counts });
          } catch (error) { if (error?.code === 'restore_cancelled') throw error; record('naverCaptures', ws, 'failed', { title: entry.title, message: message(error) }); }
        }
        if (docs.length) {
          step(KINDS.accountDocuments.label); guard();
          let applied = 0, skipped = 0, rejected = 0; const notes = new Set();
          for (const doc of docs) {
            const docId = doc.prefix + ':' + (doc.postId || '');
            if (target.appliedDocs.has(docId)) continue; // Applied by an earlier run of this restore.
            if (NOT_RESTORED[doc.prefix]) { skipped++; notes.add(NOT_RESTORED[doc.prefix]); continue; }
            try {
              const result = await storage.applyAccountDoc(docKey(storage, doc.prefix, id), { value: remap(doc.value, target.map), expectedHash: null });
              if (result.status === 'applied') { applied++; target.appliedDocs.add(docId); }
              else if (result.status === 'changed') { skipped++; notes.add('새 사본에 이미 있던 문서는 덮어쓰지 않았습니다.'); }
              else { rejected++; notes.add(result.error?.message || '형식을 확인하지 못한 문서가 있습니다.'); }
            } catch (error) { rejected++; notes.add(message(error)); }
          }
          // A partly rejected set stays retryable: only the rejected ones run again.
          record('accountDocuments', ws, rejected ? 'failed' : 'restored', { targetId: id, counts: { documents: applied }, skipped, rejected,
            ...(notes.size ? { message: (rejected ? '복원하지 못한 문서 ' + rejected + '개. ' : '') + [...notes].join(' ') } : {}) });
        }
      }
      for (const entry of accountParts) {
        step(KINDS.originals.label); guard();
        const account = { index: 0, title: '계정' };
        try {
          if (!originals) throw fault('originals_unavailable', '원본 첨부 보관함을 열 수 없어 복원하지 않았습니다.');
          const prepared = await originals.prepare(entry.blob);
          await originals.install(prepared.ticket);
          record('originals', account, 'restored', { title: entry.title, partId: entry.partId, counts: entry.counts });
        } catch (error) { if (error?.code === 'restore_cancelled') throw error; record('originals', account, 'failed', { title: entry.title, partId: entry.partId, message: message(error) }); }
      }
    } catch (error) {
      // Cancelled: what was already created stays; the caller lists it.
      error.report = report; throw error;
    } finally {
      // Installing a copy marks it active; keep the workspace the person was using.
      if (previousActive) await storage.setActive(previousActive).catch(() => {});
      onProgress({ phase: 'restore', done: total, total });
    }
    return report;
  }
  async function appVersion() {
    try {
      const keys = await root.caches?.keys?.();
      const versions = (keys || []).map(key => /^haedo-v(\d+)$/.exec(key)?.[1]).filter(Boolean).map(Number);
      return versions.length ? 'haedo-v' + Math.max(...versions) : null;
    } catch (_) { return null; }
  }
  return Object.freeze({ FORMAT, VERSION, DOCS_FORMAT, LIMITS, KINDS, ORDER, NOT_INCLUDED, plan, inventory, writer, open, summarize, restore, receipts,
    timelineSnapshot, countText, appVersion, zipEntries, docKey, sha256 });
});
