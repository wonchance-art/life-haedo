/* Document tools and a searchable, keyboard accessible alternative to the chart. */
(() => {
  let view = 'timeline', toastTimer;
  const byId = id => document.getElementById(id);
  window.showToast = message => {
    const toast = byId('toastMessage'); toast.textContent = message; toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
  };
  const element = (tag, cls, text) => {
    const node = document.createElement(tag); node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  function renderRecords() {
    const query = byId('recordQuery').value.trim().toLocaleLowerCase(), kind = byId('recordKind').value;
    const all = [
      ...DATA.events.map(item => ({ item, kind: 'event', date: item.date, title: item.title, desc: item.desc })),
      ...DATA.spans.map(item => ({ item, kind: 'span', date: item.start, title: item.title, desc: item.desc })),
      ...DATA.thoughts.map(item => ({ item, kind: 'thought', date: item.date, title: item.text, desc: '' }))
    ];
    const rows = all.filter(row => (kind === 'all' || row.kind === kind) &&
      [row.title, row.desc, row.date, row.item.end].join(' ').toLocaleLowerCase().includes(query))
      .sort((a, b) => b.date.localeCompare(a.date));
    byId('recordCount').textContent = `${all.length}개 중 ${rows.length}개 · ${RO ? '읽기 전용' : '눌러서 편집'}`;
    const fragment = document.createDocumentFragment(); let year;
    for (const row of rows) {
      if (year !== row.date.slice(0, 4)) {
        year = row.date.slice(0, 4); fragment.append(element('h3', 'record-year', year));
      }
      const button = element('button', 'record-row'); button.type = 'button';
      const date = element('span', 'record-date', fmtD(row.date));
      if (row.kind === 'span') date.append(element('small', '', row.item.end ? `— ${fmtD(row.item.end)}` : '— 진행 중'));
      const badge = element('span', `record-badge ${row.kind}`, { event: '사건', span: '기간', thought: '생각' }[row.kind]);
      const copy = element('span', 'record-copy'); copy.append(element('strong', '', row.title || '제목 없음'));
      if (row.desc) copy.append(element('span', '', row.desc));
      const happiness = row.item.happiness;
      const value = element('span', 'record-value', happiness == null ? '' : `${happiness > 0 ? '+' : ''}${happiness.toFixed(1)}`);
      value.setAttribute('aria-label', happiness == null ? '행복도 없음' : `행복도 ${happiness}`);
      if (happiness < 0) value.classList.add('negative');
      button.append(date, badge, copy, value, element('span', 'record-arrow', '↗'));
      button.onclick = event => {
        event.stopPropagation();
        if (RO) { setView('timeline'); jumpToItem(row.item); return; }
        const rect = button.getBoundingClientRect();
        if (row.kind === 'thought') openPopThought(row.item, rect.right - 350, rect.top);
        else openPop(row.item, rect.right - 350, rect.top);
      };
      fragment.append(button);
    }
    if (!rows.length) fragment.append(element('p', 'record-empty', all.length ? '검색 결과가 없어요. 다른 단어나 기록 종류를 선택해보세요.' : '아직 기록이 없어요. 기록 추가로 시작해보세요.'));
    byId('recordRows').replaceChildren(fragment);
  }
  function setView(next) {
    closePop(); closeCtx(); view = next;
    const records = view === 'records';
    byId('recordsView').hidden = !records; byId('chartView').hidden = records;
    byId('layerBar').hidden = records; document.querySelector('.tl-controls').hidden = records;
    for (const [id, active] of [['btnTimeline', !records], ['btnRecords', records]]) {
      byId(id).classList.toggle('on', active); byId(id).setAttribute('aria-pressed', String(active));
    }
    if (records) renderRecords();
    else { prepare(); render(); rebuildScrubber(); if (MAP_OPEN) whenMapSized(() => map.invalidateSize()); }
  }
  window.showTimeline = () => setView('timeline');
  window.refreshWorkspace = () => { if (view === 'records') renderRecords(); };
  byId('btnTimeline').onclick = () => setView('timeline');
  byId('btnRecords').onclick = () => setView('records');
  byId('recordQuery').oninput = renderRecords; byId('recordKind').onchange = renderRecords;
  byId('workspaceDate').textContent = `${fmtD(HaedoData.localDate())} 오늘`;
  byId('btnToday').onclick = () => setScale('5', document.querySelector('.scale[data-y="5"]'));
  byId('btnNewDoc').onclick = () => openNewDoc();
  byId('btnAdd').addEventListener('click', () => { if (view === 'records') setView('timeline'); }, true);
  byId('btnSearch').addEventListener('click', () => { if (view === 'records') setView('timeline'); }, true);

  function backup() {
    const docs = [], unreadable = [], ids = new Set(REG.docs.map(entry => entry.id));
    for (const entry of REG.docs) {
      const data = entry.id === curDocId ? DATA : loadDoc(entry.id);
      if (data) docs.push({ ...entry, data });
      else unreadable.push({ id: entry.id, raw: localStorage.getItem(DOC_PREFIX + entry.id) });
    }
    // Recover orphaned document keys without including tokens or connection settings.
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(DOC_PREFIX) && !ids.has(key.slice(DOC_PREFIX.length))) {
        const id = key.slice(DOC_PREFIX.length), data = loadDoc(id);
        if (data) docs.push({ id, name: data.profile.name, data });
        else unreadable.push({ id, raw: localStorage.getItem(key) });
      }
    }
    saveBlob(new Blob([JSON.stringify({ format: 'haedo-backup-v1', at: new Date().toISOString(), docs, unreadable, recoveredRegistry: REG.recoveredRegistry }, null, 2)],
      { type: 'application/json' }), `인생연표-백업-${HaedoData.localDate()}.json`);
    showToast(`${docs.length}개 문서를 백업했습니다.${unreadable.length ? ` 읽을 수 없는 원본 ${unreadable.length}개도 포함했습니다.` : ''}`);
  }
  byId('btnFile').onclick = event => {
    event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect();
    const options = RO ? [] : [
      ['전체 문서 백업 · JSON', '', backup],
      ['JSON 가져오기 · 새 사본', '', () => byId('fileRestore').click()],
      ['텍스트 한꺼번에 추가', '', () => openFill()]
    ];
    openPick(rect.left, rect.bottom + 8, [...options,
      ['이미지 저장 · PNG', '', () => { setView('timeline'); exportPNG(); }],
      ['벡터 이미지 저장 · SVG', '', () => { setView('timeline'); exportSVG(); }]
    ]);
  };
  byId('fileRestore').onchange = async event => {
    const file = event.target.files[0]; if (!file || RO) return;
    let previous; const staged = [];
    try {
      const input = JSON.parse(await file.text());
      const entries = HaedoData.prepareImport(input, newDocId, migrateScale);
      previous = structuredClone(REG);
      for (const entry of entries) {
        localStorage.setItem(DOC_PREFIX + entry.id, JSON.stringify(entry.data)); staged.push(entry.id);
      }
      const updated = new Date().toISOString();
      REG.docs.push(...entries.map(({ id, name }) => ({ id, name, updated })));
      if (!saveRegistry()) throw new Error('저장 공간이 부족합니다.');
      switchDoc(entries[0].id);
      for (const entry of entries) if (CLOUD) cloudQueue.schedule(entry.id);
      showToast(`${entries.length}개 문서를 새 사본으로 가져왔습니다. 기존 문서는 그대로 있습니다.`);
    } catch (error) {
      if (previous) REG = previous;
      for (const id of staged) { try { localStorage.removeItem(DOC_PREFIX + id); } catch (_) {} }
      saveRegistry(); refreshDocSel();
      showToast(`가져오지 못했습니다. ${error instanceof SyntaxError ? 'JSON 파일 형식을 확인하세요.' : error.message}`);
    } finally { event.target.value = ''; updateSaveState(); }
  };

  const dialogs = [...document.querySelectorAll('.search-bd'), byId('gateBd')];
  let activeDialog = null, previousFocus;
  const focusable = node => [...node.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')]
    .filter(el => !el.disabled && el.getClientRects().length);
  byId('gateBd').setAttribute('role', 'dialog'); byId('gateBd').setAttribute('aria-modal', 'true'); byId('gateBd').setAttribute('aria-label', '입장');
  function syncDialog() {
    const current = dialogs.find(node => !node.hidden) || null;
    if (current === activeDialog) return;
    if (current) { previousFocus = document.activeElement; requestAnimationFrame(() => focusable(current)[0]?.focus()); }
    else if (previousFocus?.isConnected) previousFocus.focus();
    activeDialog = current;
    document.querySelectorAll('body > nav, body > header, body > main').forEach(el => { el.inert = !!current; });
  }
  const observer = new MutationObserver(syncDialog);
  dialogs.forEach(node => observer.observe(node, { attributes: true, attributeFilter: ['hidden'] }));
  document.addEventListener('keydown', event => {
    if (!activeDialog || event.key !== 'Tab') return;
    const items = focusable(activeDialog), first = items[0], last = items.at(-1);
    if (event.shiftKey && (document.activeElement === first || !activeDialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !activeDialog.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
  });
  for (const id of ['btnMap', 'btnGrid']) {
    const button = byId(id);
    new MutationObserver(() => button.setAttribute('aria-pressed', String(button.classList.contains('on'))))
      .observe(button, { attributes: true, attributeFilter: ['class'] });
  }
  syncDialog();
  if (window.bootWarning) showToast(window.bootWarning);
})();
