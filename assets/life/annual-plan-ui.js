/* Account/workspace-local annual planning. Dates and text stay in the model;
 * changing a view never rewrites a monthly plan's civil date. */
(function (root) {
  'use strict';
  const copy = value => structuredClone(value);
  const fields = ['birthDate', 'basis', 'ageMode', 'quarters', 'rows', 'entries'];
  const node = (tag, text, cls) => {
    const value = root.document.createElement(tag);
    if (text != null) value.textContent = text;
    if (cls) value.className = cls;
    return value;
  };
  function payload(value) {
    const result = Object.fromEntries(fields.map(key => [key, copy(value[key])]));
    result.rows.sort((a, b) => a.year - b.year);
    result.entries.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }
  const equal = (a, b) => JSON.stringify(payload(a)) === JSON.stringify(payload(b));
  function create({ container, storage, getBundle, isCurrent }) {
    const model = () => root.HaedoLife.AnnualPlan;
    const sessions = new Map();
    let active = false, disposed = false, generation = 0, workspaceId = null, current = null, surface = null;
    let timer = null, writing = null, unsubscribe = null, composing = new Set();
    const inScope = () => !disposed && active && isCurrent() && getBundle()?.workspaceId === workspaceId;
    const valid = token => token === generation && inScope();
    const changed = () => !!current?.saved && !equal(current.draft, current.saved);
    const dirty = () => changed() || composing.size > 0 || !!current?.invalidBirth;
    const fault = text => Object.assign(new Error(text), { code: 'annual_plan_unsaved' });
    function button(text, id, action, cls = 'ap-button') {
      const value = node('button', text, cls); value.type = 'button';
      const mountedToken = generation, mountedSlot = current;
      if (id) value.id = id;
      value.addEventListener('click', () => {
        if (!valid(mountedToken) || mountedSlot !== current || !container.contains(value)) return;
        const token = mountedToken, slot = mountedSlot;
        Promise.resolve().then(() => { if (valid(token) && slot === current && container.contains(value)) return action(); }).catch(error => { if (valid(token) && slot === current) fail(error); });
      });
      return value;
    }
    function icon(name, label, action) {
      const value = button(null, null, action, 'ap-icon');
      value.title = label; value.setAttribute('aria-label', label);
      if (root.HaedoLife.Icons) value.append(root.HaedoLife.Icons.create(name));
      else value.textContent = label;
      return value;
    }
    function fail(error, conflict = false) {
      if (!inScope() || !current) return;
      current.error = conflict || /conflict/.test(error?.code || '')
        ? '다른 탭에서 계획이 바뀌었습니다. 최신 계획을 확인한 뒤 내 입력을 다시 적용하세요.'
        : error?.code === 'annual_plan_unsaved' ? error.message
          : '저장하지 못했습니다. 입력은 유지됩니다. 설정을 확인하거나 다시 저장하세요.';
      if (conflict || /conflict/.test(error?.code || '')) current.conflict = true;
      clearTimeout(timer); timer = null; status();
    }
    function status() {
      if (!inScope() || !surface) return;
      const value = surface.querySelector('#apSaveStatus');
      value.textContent = current.conflict ? '변경 확인 필요' : current.error ? '저장 실패' : writing ? '저장 중' : changed() ? '미저장' : '저장됨';
      surface.dataset.dirty = String(dirty()); surface.setAttribute('aria-busy', String(!!writing || !!current.reading));
      const error = surface.querySelector('#apError'); error.textContent = current.error || ''; error.hidden = !current.error;
      surface.querySelector('#apRetry').hidden = !current.error || current.conflict;
      surface.querySelector('#apReload').hidden = !current.conflict;
      surface.querySelector('#apReapply').hidden = !current.latest;
      surface.querySelector('#apReapply').disabled = !!writing || !!current.reading;
      surface.querySelector('#apLatest').hidden = !current.latest;
      surface.querySelector('#apImportApply').disabled = !!writing || current.conflict || !!current.reading;
    }
    function schedule() {
      clearTimeout(timer); timer = null; status();
      if (!inScope() || current.error || current.conflict || composing.size || !changed()) return;
      timer = root.setTimeout(() => { timer = null; save().catch(error => fail(error)); }, 350);
    }
    function edit(change) {
      if (!inScope() || !current?.saved) return;
      current.undo = null; drawUndo();
      change(current.draft); current.editRevision++;
      if (!current.conflict) current.error = '';
      current.confirm = null; drawConfirmation(); schedule();
    }
    async function save() {
      clearTimeout(timer); timer = null;
      if (!current?.saved || !changed()) return;
      const enteredToken = generation, enteredSlot = current;
      if (writing) {
        await writing;
        if (!valid(enteredToken) || enteredSlot !== current) throw fault('계정 또는 작업공간이 바뀌어 저장을 멈췄습니다.');
        if (changed()) return save(); return;
      }
      if (composing.size) throw fault('한글 입력을 마친 뒤 다시 이동하세요.');
      if (current.invalidBirth) throw fault('생년월일을 1900–2199년의 날짜로 확인해 주세요.');
      if (!inScope()) throw fault('계정 또는 작업공간이 바뀌어 저장을 멈췄습니다.');
      if (current.conflict) throw fault('최신 계획을 확인한 뒤 내 입력을 다시 적용하세요.');
      if (current.error) throw fault(current.error);
      const token = generation, slot = current, scope = workspaceId, snapshot = payload(slot.draft);
      let next;
      try { next = model().update(slot.saved, snapshot, { expectedRevision: slot.saved.revision }); }
      catch (error) { fail(error); throw error; }
      const operation = (async () => {
        const result = await storage.saveAnnualPlan(scope, next, slot.saved.revision);
        if (!valid(token) || slot !== current) return;
        if (result.status !== 'stored') { fail(null, true); throw fault('다른 탭의 계획을 확인해 주세요.'); }
        slot.saved = result.profile; slot.error = ''; slot.latest = null;
      })();
      writing = operation; status();
      try { await operation; }
      catch (error) { if (valid(token) && slot === current) fail(error); throw error; }
      finally { if (writing === operation) writing = null; if (valid(token) && slot === current) { status(); if (!slot.error && !slot.conflict && changed()) schedule(); } }
    }
    async function flush() {
      clearTimeout(timer); timer = null;
      if (disposed) return;
      const token = generation, slot = current;
      if (composing.size) throw fault('한글 입력을 마친 뒤 다시 이동하세요.');
      if (current?.invalidBirth) throw fault('생년월일을 1900–2199년의 날짜로 확인해 주세요.');
      if (!writing && !changed()) return;
      if (writing) await writing;
      if (current && (!valid(token) || slot !== current)) throw fault('계정 또는 작업공간이 바뀌어 저장을 멈췄습니다.');
      if (!current?.saved || !changed()) return;
      if (current.error || current.conflict) throw fault(current.error || '저장하지 못한 입력을 확인해 주세요.');
      await save();
      if (changed()) return flush();
    }
    function resize(input) {
      input.style.height = 'auto'; input.style.height = Math.min(240, Math.max(64, input.scrollHeight)) + 'px';
    }
    function textArea(text, label, onInput) {
      const input = node('textarea'); input.rows = 2; input.value = text; input.maxLength = model().MAX_TEXT || 10000;
      const token = generation, slot = current, owns = () => valid(token) && slot === current && surface?.contains(input);
      input.setAttribute('aria-label', label); input.spellcheck = false;
      input.addEventListener('compositionstart', () => { if (owns()) { composing.add(input); clearTimeout(timer); status(); } });
      input.addEventListener('compositionend', () => { if (owns()) { composing.delete(input); input.dataset.compositionEnded = String(Date.now()); onInput(input.value); resize(input); schedule(); } });
      input.addEventListener('input', () => { if (owns()) { onInput(input.value); resize(input); } });
      return input;
    }
    function displayProfile() {
      return { ...current.saved, ...payload(current.draft), basis: current.draft.basis === 'birthday' && !current.draft.birthDate ? 'year' : current.draft.basis };
    }
    function focusAnnual(year) {
      const target = surface.querySelector('[data-ap-annual="' + year + '"]');
      target?.focus(); target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function addYear(year) {
      if (year < model().YEAR_MIN || year > model().YEAR_MAX) throw fault('추가할 수 있는 연도는 1900–2199년입니다.');
      if (!current.draft.rows.some(row => row.year === year) && current.draft.rows.length >= model().MAX_ROWS) throw fault('연도는 최대 200개까지 보관할 수 있습니다. 현재 입력은 유지됩니다.');
      if (!current.draft.rows.some(row => row.year === year)) edit(plan => { plan.rows.push({ year, text: '' }); });
      drawGrid(); focusAnnual(year);
    }
    function nextYear() {
      const years = model().years(displayProfile()).filter(year => year >= model().YEAR_MIN);
      return years.length ? Math.max(...years) + 1 : Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date()));
    }
    function drawGrid() {
      if (!inScope() || !current?.saved || composing.size) return;
      const scroll = surface.querySelector('#apGrid'), previousScroll = scroll.scrollLeft;
      const profile = displayProfile(), years = model().years(profile), table = node('table', null, 'ap-table');
      const caption = node('caption', '연도별 연간·월 계획', 'life-sr-only'); table.append(caption);
      const columns = node('colgroup');
      columns.append(node('col', null, 'ap-year-column'), node('col', null, 'ap-annual-column'));
      for (let i = 0; i < 12; i++) columns.append(node('col', null, 'ap-month-column'));
      table.append(columns);
      const head = node('thead');
      if (profile.quarters) {
        const quarterRow = node('tr', null, 'ap-quarter-row'), spacer = node('th'); spacer.colSpan = 2; spacer.setAttribute('aria-hidden', 'true'); quarterRow.append(spacer);
        for (let quarter = 1; quarter <= 4; quarter++) { const th = node('th', quarter + '분기'); th.colSpan = 3; th.scope = 'colgroup'; quarterRow.append(th); }
        head.append(quarterRow);
      }
      const titles = node('tr');
      for (const label of ['연도 · 나이', '연간 계획']) { const th = node('th', label); th.scope = 'col'; titles.append(th); }
      for (let month = 0; month < 12; month++) { const th = node('th', profile.basis === 'year' ? month + 1 + '월' : month + 1 + '개월차'); th.scope = 'col'; if (profile.quarters && month % 3 === 0) th.className = 'ap-quarter-start'; titles.append(th); }
      head.append(titles); table.append(head);
      const body = node('tbody');
      for (const year of years) {
        const periods = model().periods(profile, year), tr = node('tr'); tr.dataset.apYear = String(year);
        const heading = node('th', null, 'ap-year'); heading.scope = 'row';
        heading.append(node('span', String(year), 'ap-year-number'), node('span', model().ageLabel(profile, year), 'ap-age'));
        const editable = year >= model().YEAR_MIN && year <= model().YEAR_MAX;
        const remove = icon('close', year + '년 연간 계획 삭제', () => { current.confirm = { kind: 'year', year }; drawConfirmation(); }); remove.dataset.apRemoveYear = String(year); remove.disabled = !current.draft.rows.some(row => row.year === year); heading.append(remove); tr.append(heading);
        const annual = node('td', null, 'ap-annual-cell'), row = current.draft.rows.find(value => value.year === year);
        const input = textArea(row?.text || '', year + '년 연간 계획', value => edit(plan => {
          const target = plan.rows.find(item => item.year === year);
          if (target) target.text = value; else plan.rows.push({ year, text: value });
        }));
        input.dataset.apAnnual = String(year); input.placeholder = '계획'; input.disabled = !editable;
        input.addEventListener('keydown', event => {
          if (!inScope() || !surface?.contains(input)) return;
          if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229 || composing.has(input) || Date.now() - Number(input.dataset.compositionEnded || 0) < 80) return;
          event.preventDefault(); try { addYear(year + 1); } catch (error) { fail(error); }
        });
        annual.append(input); tr.append(annual);
        for (const period of periods) {
          const cell = node('td', null, 'ap-month-cell'); cell.dataset.apMonth = period.start;
          if (profile.quarters && period.index % 3 === 0) cell.classList.add('ap-quarter-start');
          if (profile.basis === 'birthday') cell.append(node('span', period.label, 'ap-period'));
          const entries = current.draft.entries.filter(entry => entry.date >= period.start && entry.date < period.end);
          for (const entry of entries) {
            const item = node('div', null, 'ap-entry'); item.dataset.apEntryItem = entry.id;
            const field = textArea(entry.text, year + '년 ' + period.label + ' 계획 · ' + entry.date, value => edit(plan => { const target = plan.entries.find(value => value.id === entry.id); if (target) target.text = value; }));
            field.dataset.apEntry = entry.id;
            const removeEntry = icon('close', entry.date + ' 계획 삭제', () => { current.confirm = { kind: 'entry', id: entry.id, date: entry.date }; drawConfirmation(); }); removeEntry.dataset.apRemoveEntry = entry.id;
            item.append(field, removeEntry); cell.append(item);
          }
          const add = button(entries.length ? '계획 추가' : '추가', null, () => {
            if (period.editable === false) return;
            if (current.draft.entries.length >= model().MAX_ENTRIES) throw fault('월 계획은 최대 2,400개까지 보관할 수 있습니다. 현재 입력은 유지됩니다.');
            const id = 'ap-' + root.crypto.randomUUID();
            edit(plan => { plan.entries.push({ id, date: period.start, text: '' }); }); drawGrid();
            surface.querySelector('[data-ap-entry="' + id + '"]')?.focus();
          }, 'ap-add-month');
          add.dataset.apAddMonth = period.start; add.disabled = period.editable === false;
          add.setAttribute('aria-label', year + '년 ' + period.label + ' 계획 추가'); cell.append(add); tr.append(cell);
        }
        body.append(tr);
      }
      table.append(body); scroll.replaceChildren(table); scroll.scrollLeft = previousScroll;
      table.querySelectorAll('textarea').forEach(resize);
      surface.querySelector('#apAddYear').disabled = nextYear() > model().YEAR_MAX;
      surface.querySelector('#apAddYear').textContent = years.length ? '다음 연도' : '연도 추가';
      surface.querySelector('#apGridHelp').hidden = scroll.scrollWidth <= scroll.clientWidth;
      status();
    }
    function drawConfirmation() {
      if (!surface) return;
      const host = surface.querySelector('#apConfirmation'); host.replaceChildren(); host.hidden = !current.confirm;
      if (!current.confirm) return;
      const target = copy(current.confirm);
      host.append(node('span', target.kind === 'year' ? target.year + '년의 연간 계획만 삭제할까요? 월 계획은 유지됩니다.' : target.date + ' 계획을 삭제할까요?'));
      host.append(button('삭제', null, () => {
        if (JSON.stringify(current.confirm) !== JSON.stringify(target)) return;
        const before = payload(current.draft);
        edit(plan => {
          if (target.kind === 'entry') plan.entries = plan.entries.filter(entry => entry.id !== target.id);
          else plan.rows = plan.rows.filter(row => row.year !== target.year);
        });
        current.undo = before; current.undoLabel = '삭제 되돌리기'; drawGrid(); drawUndo();
      }), button('취소', null, () => { current.confirm = null; drawConfirmation(); }));
    }
    function drawUndo() {
      const host = surface.querySelector('#apUndo'); host.replaceChildren(); host.hidden = !current.undo;
      if (current.undo) host.append(button(current.undoLabel || '삭제 되돌리기', null, () => { const before = current.undo; current.undo = null; edit(plan => { Object.assign(plan, before); }); syncSettings(); drawGrid(); drawUndo(); }));
    }
    function download() {
      const profile = { ...current.saved, ...payload(current.draft) };
      const envelope = model().exportBackup(profile), blob = new Blob([JSON.stringify(envelope)], { type: 'application/json;charset=utf-8' });
      const url = root.URL.createObjectURL(blob), link = node('a'); link.href = url; link.download = 'haedo-annual-plan-' + new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) + '.json';
      root.document.body.append(link); link.click(); link.remove(); root.setTimeout(() => root.URL.revokeObjectURL(url), 1000);
    }
    function latestText(profile) {
      return [profile.birthDate ? '생년월일 ' + profile.birthDate : '생년월일 없음', profile.basis === 'birthday' ? '생일 기준' : '연도 기준',
        '나이 표시: ' + ({ international: '만 나이', korean: '한국 나이', both: '둘 다' }[profile.ageMode]), profile.quarters ? '분기 구분 켜짐' : '분기 구분 꺼짐',
        ...profile.rows.map(row => row.year + '년\n' + row.text), ...profile.entries.map(entry => entry.date + '\n' + entry.text)].join('\n\n');
    }
    async function reload() {
      if (writing || current.reading) return;
      const token = generation, slot = current; slot.reading = true; status();
      try {
        const latest = await storage.readAnnualPlan(workspaceId);
        if (!valid(token) || slot !== current) return;
        slot.latest = latest; slot.conflict = true;
        surface.querySelector('#apLatestText').textContent = latestText(latest);
        surface.querySelector('#apLatest').open = true;
        slot.error = '최신 계획을 확인했습니다. 내 입력을 다시 적용하면 위의 현재 입력으로 교체합니다. 백업도 먼저 내려받을 수 있습니다.';
      } catch (error) { if (valid(token)) fail(error); }
      finally { if (valid(token) && slot === current) { slot.reading = false; status(); } }
    }
    async function reapply() {
      if (!current.latest || writing) return;
      current.saved = current.latest; current.latest = null; current.conflict = false; current.error = '';
      status(); await save();
    }
    function importPreview() {
      const host = surface.querySelector('#apImportPreview'); host.replaceChildren(); host.hidden = !current.imported;
      if (!current.imported) return;
      const plan = current.imported.plan;
      host.append(node('p', plan.rows.length + '개 연도 · ' + plan.entries.length + '개 월 계획'));
      host.append(node('p', '적용하면 현재 연간 계획만 교체합니다. 현재 입력을 먼저 백업할 수 있습니다.', 'ap-meta'));
      const preview = node('pre', latestText(plan), 'ap-copy-text'); host.append(preview);
    }
    async function importFile(file) {
      if (!file || !inScope()) return;
      const token = generation, slot = current, sequence = ++slot.importSequence;
      try {
        if (file.size > (model().MAX_BYTES || 2 * 1024 * 1024)) throw fault('백업 파일이 2 MiB를 넘었습니다.');
        const bytes = await file.arrayBuffer(); if (!valid(token) || slot !== current || sequence !== slot.importSequence) return;
        slot.imported = model().parseBackup(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        slot.importError = ''; importPreview();
      } catch (_) { if (valid(token) && sequence === slot.importSequence) { slot.imported = null; slot.importError = '백업을 읽을 수 없습니다. 파일 형식·크기를 확인하세요. 현재 계획은 유지했습니다.'; importPreview(); } }
      if (valid(token) && slot === current) { const error = surface.querySelector('#apImportError'); error.textContent = slot.importError; error.hidden = !slot.importError; surface.querySelector('#apImportApply').hidden = surface.querySelector('#apImportCancel').hidden = !slot.imported; status(); }
    }
    async function applyImport() {
      if (!current.imported || current.conflict || writing) return;
      const token = generation, slot = current, sequence = current.importSequence, editRevision = current.editRevision, importedEnvelope = copy(current.imported);
      await flush();
      if (!valid(token) || slot !== current || !slot.imported) return;
      if (sequence !== slot.importSequence || editRevision !== slot.editRevision) {
        slot.importError = '파일 또는 입력이 바뀌어 적용을 멈췄습니다. 미리보기를 확인한 뒤 다시 적용하세요.';
        const error = surface.querySelector('#apImportError'); error.textContent = slot.importError; error.hidden = false; return;
      }
      const imported = model().importBackup(slot.saved, importedEnvelope, { expectedRevision: slot.saved.revision }), before = payload(slot.draft);
      edit(plan => { Object.assign(plan, payload(imported)); });
      current.undo = before; current.undoLabel = '적용 되돌리기';
      current.imported = null; importPreview(); surface.querySelector('#apImportApply').hidden = surface.querySelector('#apImportCancel').hidden = true;
      syncSettings(); drawGrid(); drawUndo(); await save();
    }
    function syncSettings() {
      if (!current?.draft || !surface) return;
      surface.querySelector('#apBirthDate').value = current.invalidBirth ? current.invalidBirthValue : current.draft.birthDate;
      surface.querySelector('#apBasis').value = current.draft.basis;
      surface.querySelector('#apAgeMode').value = current.draft.ageMode;
      surface.querySelector('#apQuarters').checked = current.draft.quarters;
    }
    function build() {
      const mountedToken = generation, mountedSlot = current;
      const owns = target => valid(mountedToken) && mountedSlot === current && surface?.contains(target);
      surface = node('section', null, 'annual-plan'); surface.dataset.dirty = 'false';
      const toolbar = node('div', null, 'ap-toolbar'), saveStatus = node('span', '', 'ap-meta'); saveStatus.id = 'apSaveStatus'; saveStatus.setAttribute('role', 'status'); saveStatus.setAttribute('aria-live', 'polite');
      toolbar.append(button('다음 연도', 'apAddYear', () => addYear(nextYear())), saveStatus); surface.append(toolbar);
      const recovery = node('div', null, 'ap-recovery'), error = node('p', '', 'ap-error'); error.id = 'apError'; error.setAttribute('role', 'alert'); error.hidden = true;
      recovery.append(error, button('다시 저장', 'apRetry', async () => { current.error = ''; status(); await save(); }), button('최신 계획 확인', 'apReload', reload), button('내 입력 다시 적용', 'apReapply', reapply));
      const latest = node('details', null, 'ap-latest'); latest.id = 'apLatest'; latest.hidden = true; latest.append(node('summary', '다른 탭의 계획'));
      const latestContent = node('pre', '', 'ap-copy-text'); latestContent.id = 'apLatestText'; latest.append(latestContent); recovery.append(latest); surface.append(recovery);
      const confirm = node('div', null, 'ap-confirm'); confirm.id = 'apConfirmation'; confirm.hidden = true; confirm.setAttribute('role', 'group'); confirm.setAttribute('aria-label', '계획 삭제 확인'); surface.append(confirm);
      const undo = node('div'); undo.id = 'apUndo'; undo.hidden = true; surface.append(undo);
      const grid = node('div', null, 'ap-grid'); grid.id = 'apGrid'; grid.tabIndex = 0; grid.setAttribute('role', 'region'); grid.setAttribute('aria-label', '연간 계획 표, 좌우로 스크롤');
      const help = node('p', '좌우로 스크롤', 'ap-scroll-hint'); help.id = 'apGridHelp'; grid.setAttribute('aria-describedby', help.id); surface.append(grid, help);
      const settings = node('details', null, 'ap-settings'); settings.id = 'apSettings'; settings.open = current.settingsOpen; settings.append(node('summary', '설정 · 백업'));
      settings.addEventListener('toggle', () => { if (owns(settings)) current.settingsOpen = settings.open; });
      const inputs = node('div', null, 'ap-options');
      const birthLabel = node('label', '생년월일'), birth = node('input'); birth.id = 'apBirthDate'; birth.type = 'date'; birth.min = '1900-01-01'; birth.max = '2199-12-31'; birthLabel.append(birth);
      const basisLabel = node('label', '계획 기준'), basis = node('select'); basis.id = 'apBasis';
      for (const [value, label] of [['year', '연도'], ['birthday', '생일']]) { const option = node('option', label); option.value = value; basis.append(option); } basisLabel.append(basis);
      const ageLabel = node('label', '나이 표시'), age = node('select'); age.id = 'apAgeMode';
      for (const [value, label] of [['international', '만 나이'], ['korean', '한국 나이'], ['both', '둘 다']]) { const option = node('option', label); option.value = value; age.append(option); } ageLabel.append(age);
      const quarterLabel = node('label', null, 'ap-check'), quarters = node('input'); quarters.id = 'apQuarters'; quarters.type = 'checkbox'; quarterLabel.append(quarters, node('span', '분기 구분')); inputs.append(birthLabel, basisLabel, ageLabel, quarterLabel);
      birth.addEventListener('change', () => {
        if (!owns(birth)) return;
        if (birth.value && !model().validDate(birth.value)) { current.invalidBirth = true; current.invalidBirthValue = birth.value; fail(fault('생년월일을 1900–2199년의 날짜로 확인해 주세요.')); return; }
        current.invalidBirth = false; current.invalidBirthValue = '';
        edit(plan => { plan.birthDate = birth.value; if (!birth.value && plan.basis === 'birthday') plan.basis = 'year'; });
        basis.value = current.draft.basis; drawGrid();
      });
      basis.addEventListener('change', () => {
        if (!owns(basis)) return;
        if (basis.value === 'birthday' && !current.draft.birthDate) { basis.value = current.draft.basis; fail(fault('생일 기준을 사용하려면 생년월일을 입력하세요.')); birth.focus(); return; }
        edit(plan => { plan.basis = basis.value; }); drawGrid();
      });
      age.addEventListener('change', () => { if (owns(age)) { edit(plan => { plan.ageMode = age.value; }); drawGrid(); } });
      quarters.addEventListener('change', () => { if (owns(quarters)) { edit(plan => { plan.quarters = quarters.checked; }); drawGrid(); } });
      settings.append(inputs, node('p', 'Enter 다음 연도 · Shift+Enter 줄바꿈', 'ap-meta'), node('p', '생일 기준에서도 월 계획의 날짜는 유지됩니다. 2월 29일은 평년에 2월 28일을 경계로 표시합니다.', 'ap-meta'), node('p', '이 브라우저 · 전용 백업', 'ap-meta'), node('p', '백업에는 생년월일과 모든 연간·월 계획이 포함됩니다.', 'ap-meta'));
      const files = node('div', null, 'ap-file-controls'); files.append(button('현재 입력 백업', 'apExport', download));
      const fileLabel = node('label', '백업 불러오기', 'ap-file-label'), file = node('input'); file.id = 'apImport'; file.type = 'file'; file.accept = '.json,application/json'; file.addEventListener('change', () => { if (!owns(file)) return; const chosen = file.files?.[0]; file.value = ''; importFile(chosen); }); fileLabel.append(file); files.append(fileLabel); settings.append(files);
      const importError = node('p', '', 'ap-error'); importError.id = 'apImportError'; importError.setAttribute('role', 'alert'); importError.hidden = true;
      const preview = node('div', null, 'ap-import-preview'); preview.id = 'apImportPreview'; preview.hidden = true;
      settings.append(importError, preview, button('현재 계획에 적용', 'apImportApply', applyImport), button('불러오기 취소', 'apImportCancel', () => { current.imported = null; current.importSequence++; importPreview(); surface.querySelector('#apImportApply').hidden = surface.querySelector('#apImportCancel').hidden = true; })); surface.append(settings);
      surface.querySelector('#apImportApply').hidden = surface.querySelector('#apImportCancel').hidden = true;
      container.replaceChildren(surface); syncSettings(); drawGrid(); drawConfirmation(); drawUndo(); importPreview(); status();
    }
    async function render() {
      if (disposed || !isCurrent()) return;
      const nextWorkspace = getBundle()?.workspaceId; if (!nextWorkspace) return;
      const token = ++generation; active = true; workspaceId = nextWorkspace; composing.clear(); unsubscribe?.(); unsubscribe = null;
      current = sessions.get(workspaceId);
      if (!current) { current = { saved: null, draft: null, editRevision: 0, error: '', conflict: false, latest: null, reading: true, settingsOpen: false, imported: null, importSequence: 0, importError: '', undo: null, confirm: null }; sessions.set(workspaceId, current); }
      const slot = current, version = slot.editRevision;
      if (!slot.saved) {
        const loading = node('p', '연간 계획을 불러옵니다.', 'ap-meta'); container.replaceChildren(loading);
        try { const saved = await storage.readAnnualPlan(workspaceId); if (!valid(token) || slot !== current) return; slot.saved = saved; slot.draft = payload(saved); loading.remove(); }
        catch (_) { if (valid(token)) { loading.textContent = '연간 계획을 읽지 못했습니다. 다시 확인해 주세요.'; container.append(button('다시 확인', 'apReadRetry', render)); } return; }
      }
      if (!valid(token)) return;
      slot.reading = false; build();
      unsubscribe = storage.subscribe(workspaceId, event => {
        if (event.type !== 'annual_plan_changed' || !inScope() || !current.saved || event.revision <= current.saved.revision || event.local && writing) return;
        fail(null, true);
      });
      try {
        const latest = await storage.readAnnualPlan(workspaceId);
        if (!valid(token) || slot !== current) return;
        if (latest.revision !== slot.saved.revision) {
          if (changed() || slot.editRevision !== version || writing) fail(null, true);
          else { slot.saved = latest; slot.draft = payload(latest); slot.conflict = false; slot.error = ''; slot.latest = null; syncSettings(); drawGrid(); }
        }
      } catch (error) { if (valid(token)) fail(error); }
      if (valid(token) && !slot.error && changed()) schedule();
    }
    function leave() { clearTimeout(timer); timer = null; active = false; generation++; composing.clear(); unsubscribe?.(); unsubscribe = null; }
    function onHidden() { if (root.document.visibilityState === 'hidden' && inScope() && !composing.size) flush().catch(() => {}); }
    function pageHide() { if (inScope() && !composing.size) flush().catch(() => {}); }
    root.document.addEventListener('visibilitychange', onHidden); root.addEventListener('pagehide', pageHide);
    function dispose() { leave(); disposed = true; sessions.clear(); current = null; surface = null; root.document.removeEventListener('visibilitychange', onHidden); root.removeEventListener('pagehide', pageHide); }
    return Object.freeze({ render, flush, dirty, leave, dispose });
  }
  (root.HaedoLife ||= {}).AnnualPlanUI = Object.freeze({ create });
})(globalThis);
