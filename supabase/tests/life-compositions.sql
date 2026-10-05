-- LOCAL DISPOSABLE TEST DATABASE ONLY. NEVER run this synthetic-data suite in production.
-- Requires Supabase-compatible roles/auth.uid() and the original + composition migrations.
-- All sample originals, configurations and receipts are rolled back.
begin;
do $test$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); w uuid := gen_random_uuid(); missing_w uuid := gen_random_uuid();
  op uuid := gen_random_uuid(); changed_op uuid := gen_random_uuid();
  original jsonb; snapshot jsonb; changed jsonb; bad jsonb; result jsonb; first_result jsonb; metadata jsonb;
  entry jsonb; group_value jsonb; pair_value jsonb; statement text; field text; n integer; passed integer := 0;
begin
  original := jsonb_build_object('schemaVersion',1,'workspaceId',w,'title','익명 원문');
  group_value := '{"id":"group_a","title":"원문 버전 연결","versionIds":["missing_version","version_a"]}'::jsonb;
  entry := '{"id":"entry_a","title":"익명 구성🌱","parts":[{"versionId":"missing_version","enabled":false},{"versionId":"version_a","enabled":true}],"note":"내 코멘트","pinned":true,"enabled":true,"showBody":true,"showNote":false}'::jsonb;
  pair_value := '{"seedSourceId":"source_a","candidateSourceId":"missing_source"}'::jsonb;
  snapshot := jsonb_build_object('format','life-workbench-v1','workspaceId',w,'revision',57,
    'groups',jsonb_build_array(group_value),
    'page',jsonb_build_object('title','내 페이지','intro','비공개 소개','showIntro',false,'showRecent',true,'entries',jsonb_build_array(entry)),
    'reflection',jsonb_build_object('versionIds',jsonb_build_array('missing_version','version_a'),'note','읽으며 생각한 점'),
    'discovery',jsonb_build_object('excludedPairs',jsonb_build_array(pair_value)));
  if public.life_composition_valid(snapshot) is not true then raise exception 'valid fixture rejected'; end if;
  if public.life_composition_valid(snapshot - 'discovery') is not true then raise exception 'legacy v1 rejected'; end if;
  passed := passed+2;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  if public.life_composition_get(w) is not null then raise exception 'initial metadata leak'; end if;
  if public.life_composition_put(w,0,op,1,snapshot) <> '{"status":"missing"}'::jsonb then raise exception 'composition created without original'; end if;
  passed := passed+2;
  perform public.life_sync_put(w,0,gen_random_uuid(),original);
  begin perform public.life_composition_put(w,0,op,2,snapshot); raise exception 'unavailable source revision accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'life_composition_source_not_ready' then raise; end if;
    passed := passed+1;
  end;
  if public.life_composition_get(w) is not null then raise exception 'failed source check wrote state'; end if;
  first_result := public.life_composition_put(w,0,op,1,snapshot);
  if first_result <> '{"status":"stored","revision":1}'::jsonb then raise exception 'first composition failed'; end if;
  if public.life_composition_put(w,0,op,1,snapshot) <> first_result then raise exception 'retry changed response'; end if;
  passed := passed+3;
  metadata := public.life_composition_get(w);
  if metadata -> 'data' <> snapshot or metadata -> 'revision' <> '1'::jsonb or metadata -> 'source_revision' <> '1'::jsonb
    or metadata ->> 'workspace_id' <> w::text or metadata ->> 'updated_at' is null
    or metadata - array['workspace_id','revision','source_revision','data','updated_at'] <> '{}'::jsonb then
    raise exception 'metadata/fixed missing references/local revision changed';
  end if;
  if current_setting('response.headers')::jsonb <> '[{"Cache-Control":"no-store, max-age=0"}]'::jsonb then raise exception 'no-store missing'; end if;
  passed := passed+2;
  foreach statement in array array[
    'select * from public.life_compositions','select * from public.life_composition_receipts',
    'delete from public.life_compositions','delete from public.life_composition_receipts',
    'update public.life_compositions set revision=99','update public.life_composition_receipts set result=null',
    'insert into public.life_compositions select * from public.life_compositions',
    'select public.life_composition_text_valid(null,10,false)','select public.life_composition_ids_valid(null,10)',
    'select public.life_composition_json_bytes(null)','select public.life_composition_valid(null)'] loop
    begin execute statement; raise exception 'private table/helper access allowed';
    exception when insufficient_privilege then passed := passed+1; end;
  end loop;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  if public.life_composition_get(w) is not null then raise exception 'other account read composition'; end if;
  if public.life_composition_put(w,1,op,1,snapshot) <> '{"status":"missing"}'::jsonb then raise exception 'other account detected revision'; end if;
  if public.life_composition_put(w,0,op,1,snapshot) <> '{"status":"missing"}'::jsonb then raise exception 'other account used original'; end if;
  passed := passed+3;
  perform public.life_sync_put(w,0,gen_random_uuid(),original || '{"title":"다른 계정 원문"}');
  if public.life_composition_put(w,0,op,1,snapshot) <> first_result then raise exception 'owner namespaces not independent'; end if;
  passed := passed+1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  begin perform public.life_composition_put(w,1,op,1,snapshot); raise exception 'retry changed CAS accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'life_composition_operation_mismatch' then raise; end if; passed := passed+1;
  end;
  begin perform public.life_composition_put(w,0,op,2,snapshot); raise exception 'retry changed source revision accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'life_composition_operation_mismatch' then raise; end if; passed := passed+1;
  end;
  begin perform public.life_composition_put(w,0,op,1,jsonb_set(snapshot,'{page,title}','"변경된 제목"')); raise exception 'retry changed data accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'life_composition_operation_mismatch' then raise; end if; passed := passed+1;
  end;
  if public.life_composition_put(w,0,changed_op,1,snapshot) <> '{"status":"conflict","revision":1}'::jsonb then raise exception 'CAS overwrite'; end if;
  changed := jsonb_set(snapshot,'{page,title}','"새 기기에서 편집"');
  if public.life_composition_put(w,1,changed_op,1,changed) <> '{"status":"stored","revision":2}'::jsonb then raise exception 'conflict incorrectly retained receipt'; end if;
  if public.life_composition_put(w,1,gen_random_uuid(),1,snapshot) <> '{"status":"conflict","revision":2}'::jsonb then raise exception 'stale update succeeded'; end if;
  if public.life_composition_put(w,0,op,1,snapshot) <> first_result then raise exception 'old successful receipt changed'; end if;
  if public.life_composition_get(w) -> 'data' <> changed then raise exception 'old retry overwrote head'; end if;
  if (select data from public.life_workspaces where id=w) <> original then raise exception 'composition changed original'; end if;
  passed := passed+6;
  -- Exact source revision is a lower bound; newer originals are permitted.
  perform public.life_sync_put(w,1,gen_random_uuid(),original || '{"title":"원문만 새 버전"}');
  if public.life_composition_put(w,2,gen_random_uuid(),1,changed) <> '{"status":"stored","revision":3}'::jsonb then raise exception 'newer original blocked'; end if;
  if public.life_composition_get(w) -> 'source_revision' <> '1'::jsonb then raise exception 'source lower bound silently changed'; end if;
  passed := passed+2;
  foreach statement in array array[
    format('select public.life_composition_get(null)'),
    format('select public.life_composition_put(null,0,%L,1,%L)',gen_random_uuid(),snapshot),
    format('select public.life_composition_put(%L,0,null,1,%L)',w,snapshot),
    format('select public.life_composition_put(%L,null,%L,1,%L)',w,gen_random_uuid(),snapshot),
    format('select public.life_composition_put(%L,-1,%L,1,%L)',w,gen_random_uuid(),snapshot),
    format('select public.life_composition_put(%L,9007199254740992,%L,1,%L)',w,gen_random_uuid(),snapshot),
    format('select public.life_composition_put(%L,3,%L,null,%L)',w,gen_random_uuid(),snapshot),
    format('select public.life_composition_put(%L,3,%L,0,%L)',w,gen_random_uuid(),snapshot),
    format('select public.life_composition_put(%L,3,%L,9007199254740992,%L)',w,gen_random_uuid(),snapshot)
  ] loop
    begin execute statement; raise exception 'invalid RPC parameter accepted';
    exception when invalid_parameter_value then passed := passed+1; end;
  end loop;
  begin perform public.life_composition_put(missing_w,0,gen_random_uuid(),1,snapshot); raise exception 'wrong workspace identity accepted';
  exception when invalid_parameter_value then passed := passed+1; end;
  -- Missing and JSON null are separate attack cases. Every required key and type
  -- must fail closed instead of falling through a SQL NULL conditional.
  execute 'reset role';
  foreach field in array array['format','workspaceId','revision','groups','page','reflection'] loop
    if public.life_composition_valid(snapshot - field) is not false
      or public.life_composition_valid(jsonb_set(snapshot,array[field],'null')) is not false then raise exception 'top-level missing/null key accepted: %',field; end if;
    passed := passed+2;
  end loop;
  foreach field in array array['title','intro','showIntro','showRecent','entries'] loop
    if public.life_composition_valid(jsonb_set(snapshot,'{page}',(snapshot -> 'page') - field)) is not false
      or public.life_composition_valid(jsonb_set(snapshot,array['page',field],'null')) is not false then raise exception 'page missing/null key accepted: %',field; end if;
    passed := passed+2;
  end loop;
  foreach field in array array['id','title','parts','note','pinned','enabled','showBody','showNote'] loop
    if public.life_composition_valid(jsonb_set(snapshot,'{page,entries,0}',entry - field)) is not false
      or public.life_composition_valid(jsonb_set(snapshot,array['page','entries','0',field],'null')) is not false then raise exception 'entry missing/null key accepted: %',field; end if;
    passed := passed+2;
  end loop;
  foreach bad in array array[
    null::jsonb,'null'::jsonb,'{}'::jsonb,'[]'::jsonb,snapshot || '{"owner_id":"unexpected"}',
    snapshot || '{"format":"unknown"}',snapshot || '{"workspaceId":"space forbidden"}',
    snapshot || '{"revision":-1}',snapshot || '{"revision":0.5}',snapshot || '{"revision":9007199254740992}',
    jsonb_set(snapshot,'{groups,0}',group_value - 'title'),jsonb_set(snapshot,'{groups,0,id}','null'),
    jsonb_set(snapshot,'{groups,0,versionIds}','["duplicate","duplicate"]'),
    jsonb_set(snapshot,'{groups,0,versionIds}','[null]'),jsonb_set(snapshot,'{groups,0,extra}','true'),
    jsonb_set(snapshot,'{groups}',jsonb_build_array(group_value,group_value)),
    jsonb_set(snapshot,'{page,entries,0,id}','"group_a"'),jsonb_set(snapshot,'{page,entries}',jsonb_build_array(entry,entry)),
    jsonb_set(snapshot,'{page,entries,0,parts}','[{"versionId":"same","enabled":true},{"versionId":"same","enabled":false}]'),
    jsonb_set(snapshot,'{page,entries,0,parts}','[{"versionId":"missing_version"}]'),
    jsonb_set(snapshot,'{page,entries,0,parts}','[{"versionId":null,"enabled":true}]'),
    jsonb_set(snapshot,'{page,entries,0,parts}','[{"versionId":"missing_version","enabled":null}]'),
    jsonb_set(snapshot,'{page,entries,0,parts}','[{"versionId":"missing_version","enabled":true,"extra":1}]'),
    jsonb_set(snapshot,'{page,title}','""'),jsonb_set(snapshot,'{page,title}',to_jsonb(E'\t\n'::text)),
    jsonb_set(snapshot,'{page,title}',to_jsonb(U&'\00A0\FEFF'::text)),
    jsonb_set(snapshot,'{page,title}',to_jsonb(repeat('🌱',251))),
    jsonb_set(snapshot,'{page,intro}',to_jsonb(repeat('가',20001))),
    jsonb_set(snapshot,'{page,showIntro}','1'),jsonb_set(snapshot,'{page,showRecent}','"true"'),
    jsonb_set(snapshot,'{reflection}','{"versionIds":[]}'),jsonb_set(snapshot,'{reflection,versionIds}','["same","same"]'),
    jsonb_set(snapshot,'{reflection,note}','null'),jsonb_set(snapshot,'{reflection,extra}','true'),
    snapshot || '{"discovery":null}',snapshot || '{"discovery":{}}',
    snapshot || '{"discovery":{"excludedPairs":null}}',snapshot || '{"discovery":{"excludedPairs":[],"extra":1}}',
    jsonb_set(snapshot,'{discovery,excludedPairs}',jsonb_build_array(pair_value,pair_value)),
    jsonb_set(snapshot,'{discovery,excludedPairs}','[{"seedSourceId":"same","candidateSourceId":"same"}]'),
    jsonb_set(snapshot,'{discovery,excludedPairs}','[{"seedSourceId":"a"}]'),
    jsonb_set(snapshot,'{discovery,excludedPairs}','[{"seedSourceId":null,"candidateSourceId":"b"}]'),
    jsonb_set(snapshot,'{discovery,excludedPairs}','[{"seedSourceId":"a","candidateSourceId":"b","extra":true}]')
  ] loop
    if public.life_composition_valid(bad) is not false then raise exception 'invalid nested format accepted'; end if;
    execute 'set local role authenticated';
    begin perform public.life_composition_put(w,3,gen_random_uuid(),1,bad); raise exception 'invalid snapshot accepted by RPC';
    exception when invalid_parameter_value then passed := passed+1; end;
    execute 'reset role';
  end loop;
  if not public.life_composition_valid(jsonb_set(snapshot,'{page,title}',to_jsonb(repeat('🌱',250)))) then raise exception '500 UTF-16 units rejected'; end if;
  if not public.life_composition_valid(jsonb_set(snapshot,'{page,intro}',to_jsonb(chr(1)))) then raise exception 'valid Workbench control character mismatch'; end if;
  if public.life_composition_json_bytes('{"a":"🌱","b":[true,null,"\n"]}') <> 33 then raise exception 'compact JSON byte count mismatch'; end if;
  passed := passed+3;
  -- Collection boundaries and UTF-8 size use realistic, uniquely identified rows.
  select jsonb_set(snapshot,'{groups}',jsonb_agg(group_value || jsonb_build_object('id','g_' || i))) into bad from generate_series(1,101) i;
  if public.life_composition_valid(bad) then raise exception '101 groups accepted'; end if;
  if not public.life_composition_valid(jsonb_set(bad,'{groups}',(bad -> 'groups') - 100)) then raise exception '100 groups rejected'; end if;
  passed := passed+2;
  select jsonb_set(snapshot,'{page,entries}',jsonb_agg(entry || jsonb_build_object('id','e_' || i))) into bad from generate_series(1,201) i;
  if public.life_composition_valid(bad) then raise exception '201 entries accepted'; end if;
  if not public.life_composition_valid(jsonb_set(bad,'{page,entries}',(bad #> '{page,entries}') - 200)) then raise exception '200 entries rejected'; end if;
  passed := passed+2;
  select jsonb_set(snapshot,'{page,entries,0,parts}',jsonb_agg(jsonb_build_object('versionId','v_' || i,'enabled',true))) into bad from generate_series(1,101) i;
  if public.life_composition_valid(bad) then raise exception '101 parts accepted'; end if;
  if not public.life_composition_valid(jsonb_set(bad,'{page,entries,0,parts}',(bad #> '{page,entries,0,parts}') - 100)) then raise exception '100 parts rejected'; end if;
  passed := passed+2;
  select jsonb_set(snapshot,'{reflection,versionIds}',jsonb_agg('v_' || i)) into bad from generate_series(1,1001) i;
  if public.life_composition_valid(bad) then raise exception '1001 reflection references accepted'; end if;
  if not public.life_composition_valid(jsonb_set(bad,'{reflection,versionIds}',(bad #> '{reflection,versionIds}') - 1000)) then raise exception '1000 reflection references rejected'; end if;
  passed := passed+2;
  select jsonb_set(snapshot,'{groups,0,versionIds}',jsonb_agg('v_' || i)) into bad from generate_series(1,1001) i;
  if public.life_composition_valid(bad) then raise exception '1001 group references accepted'; end if;
  if not public.life_composition_valid(jsonb_set(bad,'{groups,0,versionIds}',(bad #> '{groups,0,versionIds}') - 1000)) then raise exception '1000 group references rejected'; end if;
  passed := passed+2;
  select jsonb_set(snapshot,'{discovery,excludedPairs}',jsonb_agg(jsonb_build_object('seedSourceId','source_a','candidateSourceId','c_' || i))) into bad from generate_series(1,1001) i;
  if public.life_composition_valid(bad) then raise exception '1001 exclusions accepted'; end if;
  if not public.life_composition_valid(jsonb_set(bad,'{discovery,excludedPairs}',(bad #> '{discovery,excludedPairs}') - 1000)) then raise exception '1000 exclusions rejected'; end if;
  passed := passed+2;
  -- Build a structurally valid payload exactly at 2 MiB; JSONB display spacing
  -- must not reject it. One extra UTF-8 byte must fail without writing anything.
  select jsonb_set(snapshot,'{page,entries}',jsonb_agg(entry || jsonb_build_object('id','size_' || i,'note',repeat('가',10000))))
    into bad from generate_series(1,69) i;
  n := 2097152-public.life_composition_json_bytes(bad);
  if n < 0 or n > 20000 then raise exception 'invalid size fixture remainder %',n; end if;
  bad := jsonb_set(bad,'{page,intro}',to_jsonb(repeat('x',n+octet_length(convert_to(bad #>> '{page,intro}','UTF8')))));
  if public.life_composition_json_bytes(bad) <> 2097152 or not public.life_composition_valid(bad) then raise exception '2 MiB boundary rejected'; end if;
  if public.life_composition_valid(jsonb_set(bad,'{page,intro}',to_jsonb((bad #>> '{page,intro}') || 'x'))) then raise exception '2 MiB + 1 accepted'; end if;
  passed := passed+2;
  execute 'set local role authenticated';
  if public.life_composition_get(w) -> 'revision' <> '3'::jsonb then raise exception 'validation changed stored head'; end if;
  perform set_config('request.jwt.claims','{}',true);
  begin perform public.life_composition_get(w); raise exception 'claimless authenticated read allowed';
  exception when insufficient_privilege then passed := passed+1; end;
  begin perform public.life_composition_put(w,0,gen_random_uuid(),1,snapshot); raise exception 'claimless authenticated write allowed';
  exception when insufficient_privilege then passed := passed+1; end;
  execute 'set local role anon';
  foreach statement in array array[
    format('select public.life_composition_get(%L)',w),
    format('select public.life_composition_put(%L,0,%L,1,%L)',w,gen_random_uuid(),snapshot),
    'select * from public.life_compositions','select * from public.life_composition_receipts',
    'select public.life_composition_valid(null)'] loop
    begin execute statement; raise exception 'anonymous access allowed';
    exception when insufficient_privilege then passed := passed+1; end;
  end loop;
  execute 'reset role';
  if (select count(*) from public.life_composition_receipts where owner_id=a and workspace_id=w) <> 3 then raise exception 'failed requests created receipts'; end if;
  passed := passed+1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  if public.life_composition_put(w,3,gen_random_uuid(),2,changed) <> '{"status":"stored","revision":4}'::jsonb then raise exception 'source floor advance failed'; end if;
  passed := passed+1;
  begin perform public.life_composition_put(w,4,gen_random_uuid(),1,snapshot); raise exception 'source floor regressed';
  exception when invalid_parameter_value then
    if sqlerrm <> 'life_composition_source_not_ready' then raise; end if; passed := passed+1;
  end;
  if public.life_composition_get(w) -> 'source_revision' <> '2'::jsonb
    or public.life_composition_get(w) -> 'revision' <> '4'::jsonb then raise exception 'rejected floor regression changed head'; end if;
  if public.life_composition_put(w,0,op,1,snapshot) <> first_result then raise exception 'historical receipt blocked by newer floor'; end if;
  passed := passed+2;
  execute 'reset role';
  update public.life_compositions set revision=9007199254740991 where owner_id=a and workspace_id=w;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  begin perform public.life_composition_put(w,9007199254740991,gen_random_uuid(),2,snapshot); raise exception 'revision exceeded safe integer';
  exception when numeric_value_out_of_range then
    if sqlerrm <> 'life_composition_revision_limit' then raise; end if;
    passed := passed+1;
  end;
  if public.life_composition_get(w) -> 'revision' <> '9007199254740991'::jsonb then raise exception 'failed overflow changed state'; end if;
  passed := passed+1;
  execute 'reset role';
  -- Composite FK prevents deletion of account A originals from deleting B's
  -- same-UUID configuration, while A's receipts disappear with its configuration.
  delete from public.life_workspaces where owner_id=a and id=w;
  if exists(select 1 from public.life_compositions where owner_id=a and workspace_id=w)
    or exists(select 1 from public.life_composition_receipts where owner_id=a and workspace_id=w) then raise exception 'cascade failed'; end if;
  if (select count(*) from public.life_compositions where owner_id=b and workspace_id=w) <> 1
    or (select count(*) from public.life_composition_receipts where owner_id=b and workspace_id=w) <> 1 then raise exception 'cascade crossed account boundary'; end if;
  passed := passed+2;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  if public.life_composition_get(w) is not null then raise exception 'removed composition still visible'; end if;
  if public.life_composition_put(w,3,gen_random_uuid(),1,snapshot) <> '{"status":"missing"}'::jsonb then raise exception 'removed parent resurrected'; end if;
  perform public.life_sync_put(w,0,gen_random_uuid(),original);
  if public.life_composition_put(w,3,gen_random_uuid(),1,snapshot) <> '{"status":"missing"}'::jsonb then raise exception 'nonzero CAS recreated removed composition'; end if;
  passed := passed+3;
  execute 'reset role';
  raise notice 'PASS % local composition role/RLS/RPC/validation checks; transaction will roll back',passed;
end;
$test$;
rollback;
