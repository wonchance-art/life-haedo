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
    let timer = null, writing = null, refreshing = null, refreshAgain = false, unsubscribe = null, unsubscribeEngine = null, watchedEngine = null, engineTimer = null, engineLooks = 0, accountRead = 0, composing = new Set();
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
    // Only this device failing to keep the input (IndexedDB) or an input that cannot be stored. A plan
    // changed in another tab or on another device is not a failure: see rebase().
    function fail(error) {
      if (!inScope() || !current) return;
      current.error = error?.code === 'annual_plan_unsaved' ? error.message
        : '저장하지 못했습니다. 입력은 유지됩니다. 설정을 확인하거나 다시 저장하세요.';
      clearTimeout(timer); timer = null; status();
    }
    // Two-step save state (2026-11-02 owner decision; 일정 통합 정리 S9). The plan is written on this
    // device first (IndexedDB, CAS); the account step is the automatic account-document sync of the
    // same row, so 계정에 올림 is said only when that row's last synced hash equals the stored one.
    const engine = () => root.HaedoLife?.Shell?.accountDocsSync || null;
    const accountDocKey = () => storage.account?.projectUrl && storage.account?.userId && workspaceId
      ? 'annualPlan:' + JSON.stringify([storage.account.projectUrl, storage.account.userId]) + ':' + workspaceId : null;
    // The shell creates (and on an account change replaces) the engine; follow the current one. A plan
    // opened directly renders just before the shell starts the engine: look again a bounded number of
    // times (250 ms … 8 s), then rely on the next save, storage notice, retry or return to the tab.
    const ENGINE_LOOKS = [250, 1000, 2000, 4000, 8000];
    function watchEngine() {
      const next = engine();
      if (next) engineLooks = ENGINE_LOOKS.length;
      else if (!engineTimer && engineLooks < ENGINE_LOOKS.length) engineTimer = root.setTimeout(() => { engineTimer = null; if (inScope()) readAccountState(); }, ENGINE_LOOKS[engineLooks++]);
      if (next === watchedEngine) return;
      unsubscribeEngine?.(); unsubscribeEngine = null; watchedEngine = next;
      if (next?.subscribe) unsubscribeEngine = next.subscribe(() => { if (inScope()) readAccountState(); });
    }
    function unwatchEngine() { unsubscribeEngine?.(); unsubscribeEngine = null; watchedEngine = null; clearTimeout(engineTimer); engineTimer = null; }
    // Account step of the stored plan: 'none' (no plan stored yet: nothing to say), 'ok' only once the
    // account confirmed this exact hash, 'error' for a real upload failure, else 'pending' (offline included).
    async function readAccountState() {
      if (!inScope() || !current) return;
      watchEngine();
      const token = generation, slot = current, sequence = ++accountRead, key = accountDocKey();
      let next = 'pending';
      try {
        if (key && typeof storage.readAccountDocRecord === 'function') {
          const record = await storage.readAccountDocRecord(key), state = engine()?.getStatus?.()?.state;
          const offline = root.navigator?.onLine === false, failed = record.sync?.error && !(offline && record.sync.error.code === 'network_error');
          next = !record.exists ? 'none' : record.sync && record.hash === record.sync.hash ? 'ok'
            : failed || ['error', 'unavailable'].includes(state) ? 'error' : 'pending';
        }
      } catch (_) { return; /* The shown state stays; the next save or sync notice reads it again. */ }
      if (!valid(token) || slot !== current || sequence !== accountRead) return;
      slot.account = next; status();
    }
    // This device did not keep the input (IDB write failure, invalid birth date): 저장하지 못함.
    // A message about an input that changed nothing keeps the account state.
    const localFailure = () => !!current.invalidBirth || (!!current.error && dirty());
    function saveText() {
      if (localFailure()) return '저장하지 못함';
      if (writing || changed() || composing.size) return '저장 중…';
      return { ok: '저장됨 · 계정에 올림', error: '계정에 올리지 못함', pending: '계정에 올리기 대기' }[current.account] || '';
    }
    async function retrySave() {
      if (writing) return;
      if (current.invalidBirth) {
        fail(fault('생년월일을 1900–2199년의 날짜로 확인해 주세요.'));
        const settings = surface.querySelector('#apSettings'); settings.open = true; current.settingsOpen = true;
        surface.querySelector('#apBirthDate').focus(); return;
      }
      if (current.error && dirty()) { current.error = ''; status(); await save(); return; }
      current.error = '';
      const token = generation, slot = current;
      slot.account = 'pending'; status();
      try { await engine()?.syncNow?.(); } catch (_) { /* The state below says what happened. */ }
      if (valid(token) && slot === current) await readAccountState();
    }
    function status() {
      if (!inScope() || !surface) return;
      const value = surface.querySelector('#apSaveStatus'), text = saveText(), local = localFailure();
      const retryable = local || text === '계정에 올리지 못함', retry = surface.querySelector('#apRetry');
      // Rewrite the live region only when its sentence changes, or it is read out again.
      const shown = retryable ? text + ' ·' : text;
      if (value.textContent !== shown) value.textContent = shown;
      const state = local || text === '계정에 올리지 못함' ? 'error' : text === '저장 중…' ? 'saving' : text ? current.account : 'none';
      surface.dataset.saveState = state;
      // Like goals·habits·연표: a settled 저장됨 · 계정에 올림 (or nothing to say) stays for screen readers only.
      value.parentElement.dataset.idle = String(state === 'ok' || state === 'none');
      surface.dataset.dirty = String(dirty()); surface.setAttribute('aria-busy', String(!!writing || !!current.reading));
      const error = surface.querySelector('#apError'); error.textContent = current.error || ''; error.hidden = !current.error;
      // A retry that worked hides its button: keep keyboard focus on the screen title, not the page.
      const retryFocused = root.document.activeElement === retry;
      retry.hidden = !retryable; retry.setAttribute('aria-disabled', String(!!writing));
      if (retryFocused && retry.hidden) root.document.querySelector('.life-page-title')?.focus({ preventScroll: true });
      surface.querySelector('#apImportApply').disabled = !!writing || !!current.reading;
    }
    function schedule() {
      clearTimeout(timer); timer = null; status();
      if (!inScope() || current.error || composing.size || !changed()) return;
      timer = root.setTimeout(() => { timer = null; save().catch(error => fail(error)); }, 350);
    }
    function edit(change) {
      if (!inScope() || !current?.saved) return;
      current.undo = null; drawUndo();
      change(current.draft); current.editRevision++;
      current.error = '';
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
      if (current.error) throw fault(current.error);
      const token = generation, slot = current, scope = workspaceId, snapshot = payload(slot.draft);
      let next;
      try { next = model().update(slot.saved, snapshot, { expectedRevision: slot.saved.revision }); }
      catch (error) { fail(error); throw error; }
      const operation = (async () => {
        // The losing side of a same-cell change is kept on this device before the write that replaces it.
        await keepRecovery(slot);
        if (!valid(token) || slot !== current) return;
        const result = await storage.saveAnnualPlan(scope, next, slot.saved.revision);
        if (!valid(token) || slot !== current) return;
        // Another tab or device stored first: put this input on top of that plan; the caller saves again.
        if (result.status !== 'stored') { rebase(result.profile); return; }
        slot.saved = result.profile; slot.error = ''; slot.account = 'pending';
        readAccountState();
      })();
      writing = operation; status();
      try { await operation; }
      catch (error) { if (valid(token) && slot === current) fail(error); throw error; }
      finally { if (writing === operation) writing = null; if (valid(token) && slot === current) { status(); if (!slot.error && changed()) schedule(); } }
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
      if (current.error) throw fault(current.error);
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
      input.addEventListener('compositionend', () => { if (owns()) { composing.delete(input); input.dataset.compositionEnded = String(Date.now()); onInput(input.value); resize(input); if (current.redraw && !composing.size) drawGrid(); schedule(); } });
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
    // The field being typed in keeps its own node through a redraw, so focus, caret and a Korean
    // composition survive a plan arriving from another tab or device. Everything around it is replaced.
    const sameField = (scope, input) => scope.querySelector(input.dataset.apAnnual ? '[data-ap-annual="' + input.dataset.apAnnual + '"]' : '[data-ap-entry="' + input.dataset.apEntry + '"]');
    const placeOf = input => input.closest('tr').dataset.apYear + ':' + input.closest('td').cellIndex;
    function settle(input, fresh) {
      input.setAttribute('aria-label', fresh.getAttribute('aria-label'));
      // A composition owns its text until it ends; compositionend then writes that text to the plan.
      if (composing.has(input) || input.value === fresh.value) return;
      const start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection, length = fresh.value.length;
      input.value = fresh.value;
      if (root.document.activeElement === input) input.setSelectionRange(Math.min(start, length), Math.min(end, length), direction);
    }
    // Children become `wanted` in order. A node already there is never moved or re-inserted (that would drop focus).
    function arrange(parent, wanted) {
      const stays = new Set(wanted);
      for (const child of [...parent.childNodes]) if (!stays.has(child)) child.remove();
      let cursor = parent.firstChild;
      for (const item of wanted) {
        if (item === cursor) cursor = cursor.nextSibling;
        else if (item.parentNode !== parent) parent.insertBefore(item, cursor);
      }
    }
    function graft(table, fresh, kept) {
      const holds = part => [...kept.keys()].some(input => part.contains(input));
      const twin = part => [...kept].find(([, other]) => part === other || part.contains?.(other))?.[0];
      for (const part of ['caption', 'colgroup', 'thead']) table.querySelector(':scope > ' + part).replaceWith(fresh.querySelector(':scope > ' + part));
      const rows = new Map([...table.tBodies[0].rows].map(row => [row.dataset.apYear, row]));
      arrange(table.tBodies[0], [...fresh.tBodies[0].rows].map(row => {
        const mine = rows.get(row.dataset.apYear);
        if (!mine || !holds(mine)) return row;
        const cells = [...mine.cells];
        [...row.cells].forEach((cell, at) => {
          if (!holds(cells[at])) { cells[at].replaceWith(cell); return; }
          cells[at].className = cell.className; if (cell.dataset.apMonth) cells[at].dataset.apMonth = cell.dataset.apMonth;
          arrange(cells[at], [...cell.childNodes].map(child => {
            const input = twin(child); if (!input) return child;
            const other = kept.get(input); settle(input, other);
            if (child === other) return input;                             // annual cell: the textarea itself
            input.parentNode.querySelector(':scope > button').replaceWith(child.querySelector(':scope > button'));
            return input.parentNode;                                       // month cell: the entry holding it
          }));
        });
        return mine;
      }));
    }
    function drawGrid() {
      if (!inScope() || !current?.saved) return;
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
      table.append(body);
      const shown = scroll.querySelector(':scope > table'), focused = root.document.activeElement;
      const typing = shown ? [...new Set([...composing, focused])].filter(input => input?.tagName === 'TEXTAREA' && shown.contains(input)) : [];
      const kept = new Map(typing.map(input => [input, sameField(table, input)]));
      if (typing.length && typing.every(input => kept.get(input) && placeOf(kept.get(input)) === placeOf(input))) graft(shown, table, kept);
      // A composing field that moves to another row (birthday basis changed elsewhere): redraw when the composition ends.
      else if (composing.size) { current.redraw = true; status(); return; }
      else {
        const mark = focused && shown?.contains(focused) ? ['apAnnual', 'apEntry', 'apAddMonth', 'apRemoveYear', 'apRemoveEntry'].find(name => focused.dataset[name]) : null;
        const selection = mark && focused.tagName === 'TEXTAREA' ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
        scroll.replaceChildren(table);
        // Keyboard focus follows the same control into the redrawn table.
        const next = mark && [...table.querySelectorAll('textarea,button')].find(item => item.dataset[mark] === focused.dataset[mark] && !item.disabled);
        if (next) { next.focus({ preventScroll: true }); if (selection) next.setSelectionRange(Math.min(selection[0], next.value.length), Math.min(selection[1], next.value.length), selection[2]); }
      }
      current.redraw = false; scroll.scrollLeft = previousScroll;
      scroll.querySelectorAll('textarea').forEach(resize);
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
    // The stored plan moved under this editor: another tab, or another device through account sync
    // (owner directive 2026-11-01: automatic, no choice to make). Nothing unsaved here: take it.
    // Unsaved input here: the same item-by-item 3-way merge the account sync uses, with this editor's
    // last stored plan as the base, so both sides' changes stay and the result is saved on top of the
    // newer plan. An item both changed keeps this unsaved input (the newest edit, and never replaced
    // under the person typing); the other side's version of that item becomes a recovery copy.
    function rebase(latest) {
      const slot = current, before = payload(slot.draft), base = payload(slot.saved), theirs = payload(latest);
      let next = theirs, lost = [];
      if (!equal(before, base) && !equal(before, theirs)) {
        const merged = root.HaedoLife.AccountDocsSync?.mergeDocument('annualPlan', base, before, theirs, true);
        next = before; lost = [{ why: 'plan', plan: theirs }];
        if (merged) try {
          const plan = payload(merged.value);
          // Settings merge one by one, so one side's birthday basis can meet the other side's cleared birth
          // date. As when the date is cleared on this screen, the plan then goes by calendar year.
          if (plan.basis === 'birthday' && !plan.birthDate) plan.basis = 'year';
          next = payload(model().update(latest, plan, { expectedRevision: latest.revision })); lost = merged.lost.map(item => ({ why: 'field', item }));
        } catch (_) { next = before; /* Above a storage limit together: this plan stays whole and the other plan is kept whole. */ }
      }
      // A composition that has not reached the plan yet still owns its field.
      for (const input of composing) {
        const item = input.dataset.apAnnual ? next.rows.find(row => String(row.year) === input.dataset.apAnnual) : next.entries.find(entry => entry.id === input.dataset.apEntry);
        if (item && item.text !== input.value) { lost.push({ why: 'field', item: copy(item) }); item.text = input.value; }
      }
      if (slot.undo && !equal(next, before)) {
        // A whole-plan undo from before this arrival would remove what just arrived, so it ends here.
        // What only that undo could still bring back is kept as a recovery copy.
        const gone = slot.undoLabel === '적용 되돌리기' ? [{ why: 'undo', plan: slot.undo }]
          : [...slot.undo.rows.filter(row => row.text && !next.rows.some(other => other.year === row.year)),
            ...slot.undo.entries.filter(entry => !next.entries.some(other => other.id === entry.id))].map(item => ({ why: 'undo', item }));
        if (gone.length) lost.push(...gone);
        slot.undo = null; drawUndo();
      }
      slot.saved = latest; slot.draft = next;
      if (lost.length) { slot.recovery.push(...lost); slot.kept.push(...lost); }
      syncSettings(before); drawGrid(); drawKept(); readAccountState();
      // Stored now when no save follows (nothing unsaved). A failure keeps them listed here and the next save tries again.
      if (lost.length) keepRecovery(slot).catch(() => {});
      schedule();   // Merged input is saved on top of the plan just taken (not while composing or after a real failure).
    }
    // Recovery copies go where the account sync keeps its own (bounded per document, on this device).
    // One writer at a time; a copy leaves the list only after it is stored.
    function keepRecovery(slot) {
      const run = (slot.keeping || Promise.resolve()).catch(() => {}).then(async () => {
        const key = accountDocKey();
        while (key && slot.recovery.length) {
          const batch = slot.recovery.slice();
          for (const why of ['field', 'undo']) {
            const items = batch.filter(row => row.why === why && row.item).map(row => row.item);
            if (items.length) await storage.saveAccountDocRecovery(key, { items }, why === 'undo' ? 'undo_discarded' : 'merge_conflict');
          }
          for (const row of batch) if (row.plan) await storage.saveAccountDocRecovery(key, row.plan, row.why === 'undo' ? 'undo_discarded' : 'conflict_remote');
          slot.recovery.splice(0, batch.length);
        }
      });
      slot.keeping = run; return run;
    }
    const KEPT_NOTES = [
      ['field', '같은 칸을 다른 탭이나 기기에서도 고쳤습니다. 이 화면의 입력을 남겼고, 다른 쪽 내용은 아래에 있습니다.'],
      ['plan', '두 쪽의 계획을 합친 결과가 보관 한도를 넘어 저장할 수 없습니다. 이 화면의 계획을 남겼고, 다른 쪽 계획 전체는 아래에 있습니다.'],
      ['undo', '다른 탭이나 기기의 변경을 받으면서 되돌리기를 닫았습니다. 되돌릴 수 있던 내용은 아래에 있습니다.']];
    const keptText = row => row.plan ? latestText(row.plan) : (Object.hasOwn(row.item, 'year') ? row.item.year + '년 연간 계획' : row.item.date) + '\n' + row.item.text;
    function drawKept() {
      if (!surface) return;
      const host = surface.querySelector('#apKept'), list = current.kept, body = host.querySelector('#apKeptText'); host.hidden = !list.length;
      body.replaceChildren();
      if (!list.length) { host.open = false; return; }
      host.querySelector('summary').textContent = '복구 사본 ' + list.length + '개';
      for (const [why, note] of KEPT_NOTES) {
        const rows = list.filter(row => row.why === why); if (!rows.length) continue;
        body.append(node('p', note, 'ap-meta'), node('pre', rows.map(keptText).join('\n\n'), 'ap-copy-text'));
      }
    }
    async function refresh() {
      if (!inScope() || !current?.saved) return;
      if (refreshing) { refreshAgain = true; return refreshing; }
      const token = generation, slot = current, scope = workspaceId;
      const run = (async () => {
        do {
          refreshAgain = false;
          if (writing) await writing.catch(() => {});
          let latest;
          // Reading can wait: the next save, storage notice or return to this tab reads again.
          try { latest = await storage.readAnnualPlan(scope); } catch (_) { return; }
          if (!valid(token) || slot !== current) return;
          if (writing) { refreshAgain = true; continue; }
          try { if (latest.revision > slot.saved.revision) rebase(latest); } catch (error) { fail(error); return; }
        } while (refreshAgain && valid(token) && slot === current);
      })();
      refreshing = run;
      try { await run; } finally { if (refreshing === run) refreshing = null; }
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
      if (!current.imported || writing) return;
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
    // `before` (a plan arriving from elsewhere): a control keeps what is being entered unless that setting changed.
    function syncSettings(before) {
      if (!current?.draft || !surface) return;
      const set = (id, key, field, value) => {
        if (before && (before[field] === current.draft[field] || field === 'birthDate' && current.invalidBirth)) return;
        surface.querySelector(id)[key] = value;
      };
      set('#apBirthDate', 'value', 'birthDate', current.invalidBirth ? current.invalidBirthValue : current.draft.birthDate);
      set('#apBasis', 'value', 'basis', current.draft.basis);
      set('#apAgeMode', 'value', 'ageMode', current.draft.ageMode);
      set('#apQuarters', 'checked', 'quarters', current.draft.quarters);
    }
    function build() {
      const mountedToken = generation, mountedSlot = current;
      const owns = target => valid(mountedToken) && mountedSlot === current && surface?.contains(target);
      surface = node('section', null, 'annual-plan'); surface.dataset.dirty = 'false';
      const toolbar = node('div', null, 'ap-toolbar'), saveLine = node('span', null, 'ap-meta ap-save-line'), saveStatus = node('span', ''); saveStatus.id = 'apSaveStatus'; saveStatus.setAttribute('role', 'status'); saveStatus.setAttribute('aria-live', 'polite');
      // "계정에 올리지 못함 · [다시 시도]": one retry, in the save state (local write or account upload).
      const retry = button('다시 시도', 'apRetry', retrySave, 'ap-button ap-retry'); retry.hidden = true;
      saveLine.append(saveStatus, ' ', retry);
      toolbar.append(button('다음 연도', 'apAddYear', () => addYear(nextYear())), saveLine); surface.append(toolbar);
      const recovery = node('div', null, 'ap-recovery'), error = node('p', '', 'ap-error'); error.id = 'apError'; error.setAttribute('role', 'alert'); error.hidden = true;
      // What an arriving plan could not keep in the plan itself (see rebase), readable here.
      const kept = node('details', null, 'ap-kept'); kept.id = 'apKept'; kept.hidden = true; kept.append(node('summary', '복구 사본'));
      const keptContent = node('div'); keptContent.id = 'apKeptText';
      kept.append(keptContent, button('닫기', 'apKeptClose', () => { current.kept = []; drawKept(); }));
      recovery.append(error, kept); surface.append(recovery);
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
      container.replaceChildren(surface); syncSettings(); drawGrid(); drawConfirmation(); drawUndo(); drawKept(); importPreview(); status();
    }
    async function render() {
      if (disposed || !isCurrent()) return;
      const nextWorkspace = getBundle()?.workspaceId; if (!nextWorkspace) return;
      const token = ++generation; active = true; workspaceId = nextWorkspace; composing.clear(); unsubscribe?.(); unsubscribe = null; unwatchEngine(); engineLooks = 0;
      current = sessions.get(workspaceId);
      if (!current) { current = { saved: null, draft: null, editRevision: 0, error: '', recovery: [], kept: [], keeping: null, redraw: false, reading: true, settingsOpen: false, imported: null, importSequence: 0, importError: '', undo: null, confirm: null, account: null }; sessions.set(workspaceId, current); }
      const slot = current;
      if (!slot.saved) {
        const loading = node('p', '연간 계획을 불러옵니다.', 'ap-meta'); container.replaceChildren(loading);
        try { const saved = await storage.readAnnualPlan(workspaceId); if (!valid(token) || slot !== current) return; slot.saved = saved; slot.draft = payload(saved); loading.remove(); }
        catch (_) { if (valid(token)) { loading.textContent = '연간 계획을 읽지 못했습니다. 다시 확인해 주세요.'; container.append(button('다시 확인', 'apReadRetry', render)); } return; }
      }
      if (!valid(token)) return;
      slot.reading = false; build();
      readAccountState();
      unsubscribe = storage.subscribe(workspaceId, event => {
        if (event.type !== 'annual_plan_changed' || !inScope() || !current.saved || event.revision <= current.saved.revision) return;
        if (event.local && writing && event.revision === current.saved.revision + 1) return; // this editor's own save
        refresh();
      });
      // The stored plan may have moved while this view was away (another tab, account sync).
      await refresh();
      if (valid(token) && !slot.error && changed()) schedule();
    }
    function leave() { clearTimeout(timer); timer = null; active = false; generation++; composing.clear(); refreshing = null; refreshAgain = false; unsubscribe?.(); unsubscribe = null; unwatchEngine(); }
    function onHidden() {
      if (!inScope()) return;
      if (root.document.visibilityState === 'visible') { readAccountState(); refresh(); return; }
      if (root.document.visibilityState === 'hidden' && !composing.size) flush().catch(() => {});
    }
    function pageHide() { if (inScope() && !composing.size) flush().catch(() => {}); }
    root.document.addEventListener('visibilitychange', onHidden); root.addEventListener('pagehide', pageHide);
    function dispose() { leave(); disposed = true; sessions.clear(); current = null; surface = null; root.document.removeEventListener('visibilitychange', onHidden); root.removeEventListener('pagehide', pageHide); }
    return Object.freeze({ render, flush, dirty, leave, dispose });
  }
  (root.HaedoLife ||= {}).AnnualPlanUI = Object.freeze({ create });
})(globalThis);
