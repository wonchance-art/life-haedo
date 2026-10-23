'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Plan = require('../assets/life/annual-plan.js');
const at = '2026-10-23T03:00:00.000Z';
const options = revision => ({ expectedRevision: revision, now: at });
const empty = () => Plan.empty('annual-workspace', { year: 2026 });
const change = (value, patch) => Plan.update(value, patch, options(value.revision));
const invalid = run => assert.throws(run, { code: 'annual_plan_invalid' });
function dated(date, text = '고정 날짜 계획', id = 'entry') { return { id, date, text }; }
function withBirth(birthDate = '1998-05-15', patch = {}) { return change(empty(), { birthDate, ...patch }); }

test('browser and CommonJS expose the same pure planning API and default to the KST civil year', () => {
  const context = vm.createContext({ structuredClone, TextEncoder, Date });
  vm.runInContext(fs.readFileSync(require.resolve('../assets/life/annual-plan.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.HaedoLife.AnnualPlan), Object.keys(Plan));
  const value = vm.runInContext("HaedoLife.AnnualPlan.empty('annual-workspace', { year: 2026 })", context);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), empty());
  const same = empty(); assert.equal(Plan.validate(same), same);
  assert.equal(Plan.empty('workspace', { now: '2026-12-31T14:59:59Z' }).rows[0].year, 2026);
  assert.equal(Plan.empty('workspace', { now: '2026-12-31T15:00:00Z' }).rows[0].year, 2027);
  assert.equal(Plan.empty('workspace', { now: () => '2026-12-31T15:00:00Z' }).rows[0].year, 2027);
  assert.ok(Object.isFrozen(Plan));
});

test('an explicit year permits deterministic reopening without consulting the current clock', () => {
  const value = empty();
  assert.equal(value.revision, 0); assert.equal(value.updatedAt, null);
  assert.deepEqual(value.rows, [{ year: 2026, text: '' }]); assert.deepEqual(value.entries, []);
  assert.equal(value.birthDate, ''); assert.equal(value.basis, 'year'); assert.equal(value.ageMode, 'international'); assert.equal(value.quarters, true);
  assert.equal(Plan.ageLabel(value, 2026), '—');
  for (const year of [1899, 2200, NaN, Infinity, '2026', 2026.5]) invalid(() => Plan.empty('workspace', { year }));
  invalid(() => Plan.empty('unsafe workspace', { year: 2026 }));
});

test('calendar projection always retains twelve contiguous slots and fixed quarter positions', () => {
  const spans = Plan.periods(empty(), 2026);
  assert.equal(spans.length, 12);
  assert.equal(spans[0].start, '2026-01-01'); assert.equal(spans[11].end, '2027-01-01');
  assert.deepEqual(spans.map(p => p.label), Array.from({ length: 12 }, (_, n) => n + 1 + '월'));
  assert.deepEqual(spans.map(p => p.quarter), [1,1,1,2,2,2,3,3,3,4,4,4]);
  assert.ok(spans.every(p => p.editable));
  for (let n = 0; n < 11; n++) assert.equal(spans[n].end, spans[n + 1].start);
});

test('birthday slots clamp each month from the original day without cumulative end-of-month drift', () => {
  const value = withBirth('1998-01-31', { basis: 'birthday' });
  const spans = Plan.periods(value, 2027);
  assert.deepEqual(spans.slice(0, 4).map(p => p.start), ['2027-01-31','2027-02-28','2027-03-31','2027-04-30']);
  assert.equal(spans[0].end, '2027-02-28'); assert.equal(spans[0].label, '1/31–2/27');
  assert.equal(spans[11].end, '2028-01-31');
  for (let n = 0; n < 11; n++) assert.equal(spans[n].end, spans[n + 1].start);
  assert.equal(Plan.periods(value, 2028)[1].start, '2028-02-29');
});

test('leap-day anniversary is Feb28 in common years and returns to Feb29 in leap years', () => {
  const value = withBirth('2000-02-29', { basis: 'birthday' });
  assert.equal(Plan.periods(value, 2027)[0].start, '2027-02-28');
  assert.equal(Plan.periods(value, 2027)[1].start, '2027-03-29');
  assert.equal(Plan.periods(value, 2027)[11].end, '2028-02-29');
  assert.equal(Plan.periods(value, 2028)[0].start, '2028-02-29');
  assert.equal(Plan.ageLabel(value, 2027), '만 27세');
});

test('every dated plan appears in exactly one half-open birthday interval including boundary days', () => {
  const value = withBirth('1998-05-15', { basis: 'birthday', entries: [dated('2026-05-14', '앞 행', 'before'), dated('2026-05-15', '현재 행', 'start'), dated('2026-06-14', '첫 달 끝', 'last'), dated('2026-06-15', '둘째 달 시작', 'next'), dated('2027-05-14', '연말', 'year-end'), dated('2027-05-15', '다음 행', 'year-start')] });
  assert.deepEqual(Plan.years(value), [2025,2026,2027]);
  for (const entry of value.entries) {
    const matches = Plan.years(value).flatMap(year => Plan.periods(value, year).filter(p => entry.date >= p.start && entry.date < p.end).map(p => ({year,index:p.index})));
    assert.equal(matches.length, 1, entry.date);
    if (entry.id === 'before') assert.deepEqual(matches[0], { year:2025,index:11 });
    if (entry.id === 'next') assert.deepEqual(matches[0], { year:2026,index:1 });
    if (entry.id === 'year-start') assert.deepEqual(matches[0], { year:2027,index:0 });
  }
});

test('display basis and birthday changes preserve original dated entries, IDs and annual row text', () => {
  const initial = withBirth('1998-05-15', { rows:[{year:2026,text:'그 해의 연간 계획\n원래 문장'}], entries:[dated('2026-01-08','한글 😀\r\nCafe\u0301','first'),dated('2027-02-15','다음해 계획','second')] });
  const raw = structuredClone(initial);
  const birthday = change(initial, { basis:'birthday', quarters:false, ageMode:'both' });
  assert.deepEqual(birthday.entries, initial.entries); assert.deepEqual(birthday.rows, initial.rows);
  assert.deepEqual(Plan.years(birthday), [2025,2026]);
  const moved = change(birthday, { birthDate:'1998-12-31' });
  assert.deepEqual(moved.entries, initial.entries); assert.deepEqual(moved.rows, initial.rows);
  const calendar = change(moved, { basis:'year' });
  assert.deepEqual(calendar.entries, initial.entries); assert.deepEqual(Plan.years(calendar), [2026,2027]);
  assert.deepEqual(initial, raw);
});

test('international and old Korean ages describe their actual interval rather than a single guessed age', () => {
  const value = withBirth('1998-05-15');
  assert.equal(Plan.ageLabel(value,2026),'만 27→28세');
  assert.equal(Plan.ageLabel(change(value,{ageMode:'korean'}),2026),'한국나이 29세');
  assert.equal(Plan.ageLabel(change(value,{ageMode:'both'}),2026),'만 27→28세 · 한국나이 29세');
  assert.equal(Plan.ageLabel(change(value,{basis:'birthday',ageMode:'both'}),2026),'만 28세 · 한국나이 29→30세');
  const jan = withBirth('1998-01-01',{ageMode:'both'});
  assert.equal(Plan.ageLabel(jan,2026),'만 28세 · 한국나이 29세');
});

test('no-birthday and prebirth rows have no negative or fabricated age', () => {
  assert.equal(Plan.ageLabel(empty(),2026),'—');
  const value = withBirth('2026-10-23',{ageMode:'both'});
  assert.equal(Plan.ageLabel(value,2025),'출생 전');
  assert.equal(Plan.ageLabel(value,2026),'출생 전→만 0세 · 출생 전→한국나이 1세');
  assert.equal(Plan.ageLabel(change(value,{basis:'birthday'}),2026),'만 0세 · 한국나이 1→2세');
  invalid(() => change(empty(),{basis:'birthday'}));
  invalid(() => change(change(value,{basis:'birthday'}),{birthDate:''}));
});

test('valid civil dates follow Gregorian century/leap rules and are not normalized by Date parsing', () => {
  for (const value of ['1900-02-28','2000-02-29','2024-02-29','2199-12-31']) assert.equal(Plan.validDate(value),true,value);
  for (const value of ['1900-02-29','2100-02-29','2026-02-30','2026-04-31','2026-00-01','2026-13-01','2026-1-01','2026-01-00','2026-01-01T00:00:00Z','1899-12-31','2200-01-01','0000-01-01',null]) assert.equal(Plan.validDate(value),false,String(value));
  for (const birthDate of ['1900-02-29','2026-02-30','2026-01','bad']) invalid(() => change(empty(),{birthDate}));
});

test('supported endpoint years retain early plans in a derived 1899 row and disable out-of-range new cell dates', () => {
  const value = withBirth('1900-06-30',{basis:'birthday', rows:[{year:1900,text:''},{year:2199,text:''}], entries:[dated('1900-01-01'),dated('2199-12-31','끝','end')]});
  assert.deepEqual(Plan.years(value),[1899,1900,2199]);
  const early = Plan.periods(value,1899), late = Plan.periods(value,2199);
  assert.equal(early[0].editable,false); assert.equal(early[7].editable,true);
  assert.equal(late[6].start,'2199-12-30'); assert.equal(late[7].start,'2200-01-30'); assert.equal(late[7].editable,false);
  assert.equal(early.filter(p=>'1900-01-01'>=p.start&&'1900-01-01'<p.end).length,1);
  invalid(() => change(value,{rows:[{year:1899,text:'행 저장은 범위 밖'}]}));
  invalid(() => change(value,{entries:[dated('2200-01-01')]}));
  invalid(() => Plan.periods(value,1898)); invalid(() => Plan.periods(value,2200));
});

test('an update detaches caller arrays, canonically sorts dates and preserves same-date order', () => {
  const initial=empty(),patch={rows:[{year:2028,text:'나중'},{year:2025,text:'먼저'}],entries:[dated('2028-01-01','나중','last'),dated('2025-01-01','같은 날짜 A','a'),dated('2025-01-01','같은 날짜 B','b')]};
  const value=change(initial,patch);
  assert.deepEqual(value.rows.map(x=>x.year),[2025,2028]); assert.deepEqual(value.entries.map(x=>x.id),['a','b','last']);
  patch.rows[0].text='외부 변경';patch.entries[1].text='외부 변경';
  assert.equal(value.rows[1].text,'나중');assert.equal(value.entries[0].text,'같은 날짜 A');assert.deepEqual(initial,empty());
  assert.equal(value.revision,1);assert.equal(value.updatedAt,at);
});

test('stale revision and overflow are refused without changing the prior plan', () => {
  const value=withBirth(),before=structuredClone(value);
  assert.throws(()=>Plan.update(value,{quarters:false},options(0)),{code:'annual_plan_conflict'});
  assert.throws(()=>Plan.update(value,{},{}),{code:'annual_plan_conflict'});
  assert.throws(()=>Plan.update({...value,revision:Number.MAX_SAFE_INTEGER},{},options(Number.MAX_SAFE_INTEGER)),{code:'annual_plan_conflict'});
  assert.deepEqual(value,before);
  invalid(()=>Plan.update(value,{}, {...options(value.revision), force:true}));
  invalid(()=>Plan.update(value,{workspaceId:'different'},options(value.revision)));
});

test('strict profiles reject malformed dates, unknown fields, duplicate IDs/rows, sparse arrays and bad metadata', () => {
  const value=withBirth(),badRows=[{year:2026,text:'A'},{year:2026,text:'B'}];
  const variants=[null,{}, {...value,body:'private'}, {...value,schemaVersion:2}, {...value,workspaceId:'space id'}, {...value,revision:-1}, {...value,revision:0,updatedAt:at}, {...value,updatedAt:'2026-02-30T03:00:00Z'}, {...value,updatedAt:'2026-10-23T12:00:00+09:00'}, {...value,basis:'fiscal'}, {...value,ageMode:'estimated'}, {...value,quarters:1}, {...value,rows:badRows}, {...value,rows:[{year:2027,text:''},{year:2026,text:''}]}, {...value,rows:Array(1)}, {...value,rows:[{year:2026,text:null}]}, {...value,entries:[dated('2026-01-01'),dated('2026-02-01')]}, {...value,entries:[dated('2026-02-01','','a'),dated('2026-01-01','','b')]}, {...value,entries:[{...dated('2026-01-01'),sourceId:'private'}]}, {...value,entries:Array(1)}];
  for(const variant of variants) invalid(()=>Plan.validate(variant));
  const missing=structuredClone(value);delete missing.birthDate;invalid(()=>Plan.validate(missing));
  invalid(()=>change(value,{entries:[dated('2026-02-30')]}));
  invalid(()=>change(value,{rows:badRows}));
});

test('data objects cannot supply accessors, inherited configuration, hidden keys or unexpected prototypes', () => {
  const value=empty();let executed=false;
  const accessor={};Object.defineProperty(accessor,'birthDate',{enumerable:true,get(){executed=true;return '1998-05-15';}});
  invalid(()=>change(value,accessor));assert.equal(executed,false);
  const row={year:2026};Object.defineProperty(row,'text',{enumerable:true,get(){executed=true;return 'x';}});
  invalid(()=>change(value,{rows:[row]}));assert.equal(executed,false);
  invalid(()=>change(value,Object.create({birthDate:'1998-05-15'})));
  const hidden={birthDate:'1998-05-15'};Object.defineProperty(hidden,'secret',{value:true});invalid(()=>change(value,hidden));
  invalid(()=>change(value,{[Symbol('metadata')]:true}));
  const rows=[{year:2026,text:''}];rows.extra=true;invalid(()=>change(value,{rows}));
  const nullPatch=Object.assign(Object.create(null),{birthDate:'1998-05-15'});assert.equal(change(value,nullPatch).birthDate,'1998-05-15');
});

test('per-field, row, entry and total UTF8 limits refuse growth without truncation or silent eviction', () => {
  const value=empty();
  invalid(()=>change(value,{rows:[{year:2026,text:'가'.repeat(Plan.MAX_TEXT+1)}]}));
  invalid(()=>change(value,{rows:Array.from({length:Plan.MAX_ROWS+1},(_,n)=>({year:1900+n,text:''}))}));
  invalid(()=>change(value,{entries:Array.from({length:Plan.MAX_ENTRIES+1},(_,n)=>dated('2026-01-01','','e-'+n))}));
  const longEntries=Array.from({length:100},(_,n)=>dated('2026-01-01','가'.repeat(10000),'entry-'+n));
  assert.throws(()=>change(value,{entries:longEntries}),{code:'annual_plan_too_large'});
  assert.deepEqual(value,empty());
  const fit=change(value,{entries:Array.from({length:Plan.MAX_ENTRIES},(_,n)=>dated('2026-01-01','','entry-'+n))});
  assert.equal(fit.entries.length,Plan.MAX_ENTRIES);
});

test('portable backup roundtrip carries original civil dates/text and excludes account/workspace/revision', () => {
  const original=withBirth('1998-05-15',{basis:'birthday',ageMode:'both',rows:[{year:2026,text:'연간\r\n원문 😀'}],entries:[dated('2026-01-01','\ufeff원문\r\nCafe\u0301😀','unchanged')]});
  const envelope=Plan.exportBackup(original,{now:at}),raw=JSON.stringify(envelope),parsed=Plan.parseBackup(raw);
  assert.deepEqual(parsed,envelope);assert.deepEqual(Object.keys(envelope),['format','schemaVersion','exportedAt','plan']);
  for(const forbidden of ['workspaceId','revision','annual-workspace','userId','projectUrl'])assert.equal(raw.includes(forbidden),false,forbidden);
  const destination=Plan.empty('different-workspace',{year:2027}),restored=Plan.importBackup(destination,parsed,options(0));
  assert.equal(restored.workspaceId,'different-workspace');assert.equal(restored.revision,1);assert.deepEqual(Plan.exportBackup(restored,{now:at}),envelope);
  envelope.plan.entries[0].text='밖에서 바꿈';assert.equal(restored.entries[0].text,'\ufeff원문\r\nCafe\u0301😀');assert.equal(original.entries[0].text,restored.entries[0].text);
});

test('malicious, unrelated, corrupted and oversized backups are rejected before any import mutation', () => {
  const base=empty(),valid=Plan.exportBackup(base,{now:at});
  const candidates=['','{','null','[]',JSON.stringify({...valid,format:'life-tools'}),JSON.stringify({...valid,schemaVersion:2}),JSON.stringify({...valid,workspaceId:'elsewhere'}),JSON.stringify({...valid,exportedAt:'2026-02-30T03:00:00Z'}),JSON.stringify({...valid,plan:{...valid.plan,accountId:'private'}}),JSON.stringify({...valid,plan:{...valid.plan,entries:[dated('2026-02-30')]}}),'{"format":"haedo-annual-plan","schemaVersion":1,"exportedAt":"2026-10-23T03:00:00.000Z","__proto__":{"polluted":true},"plan":{}}'];
  for(const raw of candidates)invalid(()=>Plan.parseBackup(raw));
  assert.throws(()=>Plan.parseBackup(' '.repeat(Plan.MAX_BYTES+1)),{code:'annual_plan_too_large'});
  invalid(()=>Plan.importBackup(base,{...valid,plan:{...valid.plan,bodyText:'unrelated'}},options(0)));
  assert.deepEqual(base,empty());assert.equal({}.polluted,undefined);
});

test('a stale explicit restore cannot overwrite a newer saved plan and leaves the envelope untouched', () => {
  const old=empty(),saved=change(old,{rows:[{year:2026,text:'새 계획'}]}),envelope=Plan.exportBackup(old,{now:at}),before=structuredClone(envelope);
  assert.throws(()=>Plan.importBackup(saved,envelope,options(0)),{code:'annual_plan_conflict'});
  assert.equal(saved.rows[0].text,'새 계획');assert.deepEqual(envelope,before);
});

test('near-limit Korean plans reserve portable framing and roundtrip into the longest supported workspace', () => {
  const measure=value=>new TextEncoder().encode(JSON.stringify(value)).length;
  const base=Plan.empty('a',{year:2026}),entries=Array.from({length:100},(_,n)=>dated('2026-01-01','','near-'+n));
  const seed=change(base,{entries}),planKeys=['birthDate','basis','ageMode','quarters','rows','entries'];
  const planOf=value=>Object.fromEntries(planKeys.map(key=>[key,value[key]]));
  let remaining=Plan.MAX_BYTES-512-measure(planOf(seed));
  for(const entry of entries){
    const count=Math.min(Plan.MAX_TEXT,Math.floor(remaining/3));entry.text='가'.repeat(count);remaining-=count*3;
    if(remaining<3&&entry.text.length<Plan.MAX_TEXT){entry.text+='a'.repeat(remaining);remaining=0;}
  }
  assert.equal(remaining,0);
  const profile=change(base,{entries});assert.ok(measure(profile)>Plan.MAX_BYTES-512&&measure(profile)<Plan.MAX_BYTES);
  const envelope=Plan.exportBackup(profile,{now:at}),compact=JSON.stringify(envelope);
  assert.ok(new TextEncoder().encode(compact).length<=Plan.MAX_BYTES);
  const destination=Plan.update(Plan.empty('w'.repeat(128),{year:2026}),{},options(0));
  const longestRevision={...destination,revision:Number.MAX_SAFE_INTEGER-1};
  const restored=Plan.importBackup(longestRevision,Plan.parseBackup(compact),options(longestRevision.revision));
  assert.equal(restored.revision,Number.MAX_SAFE_INTEGER);assert.ok(measure(restored)<=Plan.MAX_BYTES);
  assert.deepEqual(restored.entries,profile.entries);assert.deepEqual(restored.rows,profile.rows);
  assert.equal(JSON.stringify(Plan.exportBackup(restored,{now:at})),compact);
  const excessive=structuredClone(entries);excessive.at(-1).text+='a';
  assert.throws(()=>change(base,{entries:excessive}),{code:'annual_plan_too_large'});
  assert.deepEqual(base,Plan.empty('a',{year:2026}));
});
