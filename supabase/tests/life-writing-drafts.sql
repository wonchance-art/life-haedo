-- LOCAL DISPOSABLE DATABASE ONLY. NEVER run this synthetic-data suite in production.
-- Requires Supabase-compatible roles/auth.uid(), original/composition/writing migrations.
-- Sample originals, drafts and receipts are all rolled back.
begin;
do $test$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); w uuid := gen_random_uuid(); w2 uuid := gen_random_uuid();
  d uuid := 'ffffffff-ffff-4fff-bfff-ffffffffffff'; d2 uuid := gen_random_uuid(); op uuid := gen_random_uuid(); op2 uuid := gen_random_uuid();
  closed_op uuid := gen_random_uuid(); before_json jsonb; first_result jsonb;
  original jsonb; draft jsonb; linked jsonb; applied jsonb; bad jsonb; metadata jsonb; listed jsonb; remainder jsonb;
  item jsonb; field text; statement text; next_id uuid; n integer; passed integer := 0;
begin
  original := jsonb_build_object('schemaVersion',1,'workspaceId',w,'title','익명 원문',
    'sources','[{"id":"source_a"},{"id":"source_b"}]'::jsonb,
    'sourceVersions','[{"id":"version_a","sourceId":"source_a"},{"id":"version_b","sourceId":"source_b"}]'::jsonb);
  draft := jsonb_build_object('kind','writing','format','life-writing-draft-v1','stageId',d,'workspaceId',w,
    'revision',12,'state','draft','sourceId',null,'baseSourceRevision',null,'baseSourceVersionId',null,
    'title','자전거를 타며 생각한 것🌱','text',E'분산된 하루를 모아서\n다시 읽는다.','createdAt','2026-10-06T00:01:02.345Z','updatedAt','2026-10-06T01:02:03.456Z');
  linked := draft || '{"sourceId":"missing_source","baseSourceRevision":57,"baseSourceVersionId":"missing_version","baseChanged":true}';
  applied := draft || '{"state":"applied","appliedResult":{"sourceId":"source_a","sourceVersionId":"version_a"}}';
  if not public.life_writing_draft_valid(draft) or not public.life_writing_draft_valid(linked)
    or not public.life_writing_draft_valid(applied) then raise exception 'valid draft rejected'; end if;
  passed := passed+3;
  foreach field in array array['kind','format','stageId','workspaceId','revision','state','sourceId',
    'baseSourceRevision','baseSourceVersionId','title','text','createdAt','updatedAt'] loop
    if public.life_writing_draft_valid(linked-field) is not false
      or public.life_writing_draft_valid(jsonb_set(linked,array[field],'null')) is not false then
      raise exception 'required missing/null field accepted: %',field;
    end if;
    passed := passed+2;
  end loop;
  foreach bad in array array[
    null::jsonb,'null'::jsonb,'[]'::jsonb,'{}'::jsonb,draft || '{"extra":true}',draft || '{"kind":"import"}',
    draft || '{"format":"v2"}',draft || '{"stageId":"spaces forbidden"}',draft || '{"workspaceId":true}',
    draft || '{"revision":-1}',draft || '{"revision":0.5}',draft || '{"revision":9007199254740992}',
    draft || '{"revision":"1"}',draft || '{"state":"open"}',draft || '{"state":false}',
    draft || '{"title":1}',draft || '{"text":[]}',draft || '{"createdAt":"today"}',
    draft || '{"createdAt":"2026-99-30T00:00:00Z"}',draft || '{"updatedAt":"2026-10-06T99:00:00Z"}',
    draft || '{"updatedAt":"2026-10-06T"}',draft || '{"sourceId":1}',draft || '{"baseSourceRevision":1}',
    draft || '{"baseSourceVersionId":"version_a"}',draft || '{"baseChanged":true}',
    linked || '{"baseSourceRevision":0}',linked || '{"baseSourceRevision":0.5}',linked || '{"baseSourceRevision":9007199254740992}',
    linked || '{"baseSourceRevision":"1"}',linked || '{"baseSourceVersionId":""}',linked || '{"sourceId":""}',
    linked || '{"baseChanged":false}',linked || '{"baseChanged":null}',linked || '{"baseChanged":1}',
    draft || '{"appliedResult":null}',draft || '{"appliedResult":{"sourceId":"source_a","sourceVersionId":"version_a"}}',
    applied - 'appliedResult',applied || '{"appliedResult":null}',applied || '{"appliedResult":[]}',
    applied || '{"appliedResult":{"sourceId":"source_a"}}',
    applied || '{"appliedResult":{"sourceId":null,"sourceVersionId":"version_a"}}',
    applied || '{"appliedResult":{"sourceId":"source_a","sourceVersionId":null}}',
    applied || '{"appliedResult":{"sourceId":"source_a","sourceVersionId":"","extra":1}}',
    jsonb_set(draft,'{title}',to_jsonb(repeat('a',501))),jsonb_set(draft,'{title}',to_jsonb(repeat('🌱',251))),
    jsonb_set(draft,'{text}',to_jsonb(repeat('a',1048577))),jsonb_set(draft,'{text}',to_jsonb(repeat('한',349526))),
    jsonb_set(draft,'{text}',to_jsonb(repeat(E'\n',1048576)))
  ] loop
    if public.life_writing_draft_valid(bad) is not false then raise exception 'malformed snapshot accepted'; end if;
    passed := passed+1;
  end loop;
  if not public.life_writing_draft_valid(jsonb_set(draft,'{text}',to_jsonb(repeat('a',1048576))))
    or not public.life_writing_draft_valid(jsonb_set(draft,'{title}',to_jsonb(repeat('🌱',250))))
    or not public.life_writing_draft_valid(draft || '{"title":"","text":""}') then raise exception 'valid limit rejected'; end if;
  passed := passed+3;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  if public.life_writing_draft_get(w,d) is not null or public.life_writing_draft_list(w)<>'[]'::jsonb
    or public.life_writing_draft_put(w,d,0,op,1,draft)<>'{"status":"missing"}'::jsonb then raise exception 'draft without original'; end if;
  passed := passed+3;
  perform public.life_sync_put(w,0,gen_random_uuid(),original);
  if public.life_writing_draft_put(w,d,1,op,1,draft)<>'{"status":"missing"}'::jsonb then raise exception 'missing head recreated'; end if;
  begin perform public.life_writing_draft_put(w,d,0,op,2,draft); raise exception 'future source accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'life_writing_draft_source_not_ready' then raise; end if; passed:=passed+1;
  end;
  first_result := public.life_writing_draft_put(w,d,0,op,1,draft);
  if first_result<>'{"status":"stored","revision":1}'::jsonb
    or public.life_writing_draft_put(w,d,0,op,1,draft)<>first_result then raise exception 'initial/retry failed'; end if;
  metadata:=public.life_writing_draft_get(w,d);
  if metadata -> 'data' <> draft or metadata -> 'revision'<>'1'::jsonb or metadata -> 'source_revision'<>'1'::jsonb
    or metadata ->> 'workspace_id'<>w::text or metadata ->> 'draft_id'<>d::text or metadata ->> 'updated_at' is null
    or metadata-array['workspace_id','draft_id','revision','source_revision','data','updated_at']<>'{}'::jsonb then raise exception 'get changed local data or extra fields'; end if;
  if current_setting('response.headers')::jsonb<>'[{"Cache-Control":"no-store, max-age=0"}]'::jsonb then raise exception 'get no-store missing'; end if;
  listed:=public.life_writing_draft_list(w);
  if jsonb_array_length(listed)<>1 or listed #>> '{0,draft_id}'<>d::text
    or listed #> '{0,title}'<>draft -> 'title' or listed #>> '{0,state}'<>'draft'
    or (listed -> 0)-array['draft_id','title','state','revision','updated_at']<>'{}'::jsonb then raise exception 'list exposed body or changed metadata'; end if;
  passed:=passed+6;
  foreach statement in array array[
    'select * from public.life_writing_drafts','select * from public.life_writing_draft_receipts',
    'delete from public.life_writing_drafts','delete from public.life_writing_draft_receipts',
    'update public.life_writing_drafts set revision=99','update public.life_writing_draft_receipts set result=null',
    'insert into public.life_writing_drafts select * from public.life_writing_drafts',
    'select public.life_writing_draft_valid(null)'
  ] loop
    begin execute statement; raise exception 'private table/helper access';
    exception when insufficient_privilege then passed:=passed+1; end;
  end loop;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  if public.life_writing_draft_get(w,d) is not null or public.life_writing_draft_list(w)<>'[]'::jsonb
    or public.life_writing_draft_put(w,d,1,op,1,draft)<>'{"status":"missing"}'::jsonb then raise exception 'other owner read/write'; end if;
  perform public.life_sync_put(w,0,gen_random_uuid(),original);
  if public.life_writing_draft_put(w,d,0,op,1,draft)<>first_result then raise exception 'owner namespace not independent'; end if;
  passed:=passed+4;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  foreach statement in array array[
    format('select public.life_writing_draft_put(%L,%L,1,%L,1,%L)',w,d,op,draft),
    format('select public.life_writing_draft_put(%L,%L,0,%L,2,%L)',w,d,op,draft),
    format('select public.life_writing_draft_put(%L,%L,0,%L,1,%L)',w,d,op,draft || '{"title":"changed"}')
  ] loop
    begin execute statement; raise exception 'mismatched retry accepted';
    exception when invalid_parameter_value then
      if sqlerrm<>'life_writing_draft_operation_mismatch' then raise; end if; passed:=passed+1;
    end;
  end loop;
  if public.life_writing_draft_put(w,d,0,op2,1,linked)<>'{"status":"conflict","revision":1}'::jsonb
    or public.life_writing_draft_put(w,d,1,op2,1,linked)<>'{"status":"stored","revision":2}'::jsonb then raise exception 'CAS failed or conflict receipt retained'; end if;
  if public.life_writing_draft_get(w,d) -> 'data'<>linked then raise exception 'missing base reference silently changed'; end if;
  passed:=passed+3;
  perform public.life_sync_put(w,1,gen_random_uuid(),original);
  if public.life_writing_draft_put(w,d,2,gen_random_uuid(),2,linked)<>'{"status":"stored","revision":3}'::jsonb then raise exception 'source floor advance'; end if;
  begin perform public.life_writing_draft_put(w,d,3,gen_random_uuid(),1,linked); raise exception 'source floor regressed';
  exception when invalid_parameter_value then
    if sqlerrm<>'life_writing_draft_source_not_ready' then raise; end if; passed:=passed+1;
  end;
  -- Correct IDs separately do not prove the pair belongs together.
  foreach bad in array array[
    applied || '{"appliedResult":{"sourceId":"missing_source","sourceVersionId":"version_a"}}',
    applied || '{"appliedResult":{"sourceId":"source_a","sourceVersionId":"missing_version"}}',
    applied || '{"appliedResult":{"sourceId":"source_a","sourceVersionId":"version_b"}}'
  ] loop
    begin perform public.life_writing_draft_put(w,d,3,closed_op,2,bad); raise exception 'invalid applied source/version pair';
    exception when invalid_parameter_value then
      if sqlerrm<>'life_writing_draft_source_not_ready' then raise; end if; passed:=passed+1;
    end;
  end loop;
  if public.life_writing_draft_put(w,d,3,closed_op,2,applied)<>'{"status":"stored","revision":4}'::jsonb then raise exception 'exact source/version pair rejected'; end if;
  if public.life_writing_draft_put(w,d,4,gen_random_uuid(),2,draft)<>'{"status":"conflict","revision":4}'::jsonb
    or public.life_writing_draft_put(w,d,4,gen_random_uuid(),2,applied)<>'{"status":"conflict","revision":4}'::jsonb then raise exception 'terminal applied mutated'; end if;
  -- Even after the current original loses the pair, a durable successful receipt
  -- is historical evidence and is returned before source/terminal checks.
  perform public.life_sync_put(w,2,gen_random_uuid(),original || '{"sources":[],"sourceVersions":[]}');
  if public.life_writing_draft_put(w,d,3,closed_op,2,applied)<>'{"status":"stored","revision":4}'::jsonb
    or public.life_writing_draft_put(w,d,0,op,1,draft)<>first_result
    or public.life_writing_draft_get(w,d) -> 'data'<>applied then raise exception 'historical retry changed or rewrote terminal'; end if;
  passed:=passed+7;
  -- The pair still exists in B's original, but A's current original no longer
  -- contains it. A different owner's exact pair cannot close A's selected draft.
  begin perform public.life_writing_draft_put(w,d2,0,op,3,applied || jsonb_build_object('stageId',d2));
    raise exception 'another owner source/version pair used';
  exception when invalid_parameter_value then
    if sqlerrm<>'life_writing_draft_source_not_ready' then raise; end if; passed:=passed+1;
  end;
  -- Same operation UUID is independent in each selected draft and workspace.
  if public.life_writing_draft_put(w,d2,0,op,3,draft || jsonb_build_object('stageId',d2))<>first_result then raise exception 'operation leaked across drafts'; end if;
  perform public.life_sync_put(w2,0,gen_random_uuid(),original || jsonb_build_object('workspaceId',w2));
  if public.life_writing_draft_put(w2,d,0,op,1,draft || jsonb_build_object('workspaceId',w2))<>first_result then raise exception 'workspace namespace not independent'; end if;
  passed:=passed+2;
  foreach statement in array array[
    format('select public.life_writing_draft_get(null,%L)',d),format('select public.life_writing_draft_get(%L,null)',w),
    'select public.life_writing_draft_list(null)',
    format('select public.life_writing_draft_put(null,%L,0,%L,1,%L)',d,op,draft),
    format('select public.life_writing_draft_put(%L,null,0,%L,1,%L)',w,op,draft),
    format('select public.life_writing_draft_put(%L,%L,null,%L,1,%L)',w,d,op,draft),
    format('select public.life_writing_draft_put(%L,%L,-1,%L,1,%L)',w,d,op,draft),
    format('select public.life_writing_draft_put(%L,%L,9007199254740992,%L,1,%L)',w,d,op,draft),
    format('select public.life_writing_draft_put(%L,%L,0,null,1,%L)',w,d,draft),
    format('select public.life_writing_draft_put(%L,%L,0,%L,null,%L)',w,d,op,draft),
    format('select public.life_writing_draft_put(%L,%L,0,%L,0,%L)',w,d,op,draft),
    format('select public.life_writing_draft_put(%L,%L,0,%L,9007199254740992,%L)',w,d,op,draft)
  ] loop
    begin execute statement; raise exception 'invalid parameter accepted';
    exception when invalid_parameter_value then
      if sqlerrm<>'life_writing_draft_invalid_request' then raise; end if; passed:=passed+1;
    end;
  end loop;
  foreach bad in array array[draft || jsonb_build_object('stageId',d2),draft || jsonb_build_object('workspaceId',w2),draft || '{"kind":"import"}'] loop
    begin perform public.life_writing_draft_put(w,d,4,gen_random_uuid(),3,bad); raise exception 'invalid identity/schema accepted';
    exception when invalid_parameter_value then
      if sqlerrm<>'life_writing_draft_invalid_snapshot' then raise; end if; passed:=passed+1;
    end;
  end loop;
  -- Pagination is stable UUID order, never a body download. Exactly 100 per page.
  for n in 1..103 loop
    next_id:=('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
    perform public.life_writing_draft_put(w2,next_id,0,gen_random_uuid(),1,draft || jsonb_build_object('workspaceId',w2,'stageId',next_id));
  end loop;
  listed:=public.life_writing_draft_list(w2);
  remainder:=public.life_writing_draft_list(w2,(listed #>> '{99,draft_id}')::uuid);
  if jsonb_array_length(listed)<>100 or jsonb_array_length(remainder)<>4 then raise exception 'pagination incorrect'; end if;
  if public.life_writing_draft_list(w2,(remainder #>> '{3,draft_id}')::uuid)<>'[]'::jsonb then raise exception 'pagination terminal not empty'; end if;
  for item in select value from jsonb_array_elements(listed || remainder) loop
    if item-array['draft_id','title','state','revision','updated_at']<>'{}'::jsonb then raise exception 'list leaked body/internal IDs'; end if;
  end loop;
  if (select count(distinct value ->> 'draft_id') from jsonb_array_elements(listed || remainder))<>104 then raise exception 'pagination overlap'; end if;
  if current_setting('response.headers')::jsonb<>'[{"Cache-Control":"no-store, max-age=0"}]'::jsonb then raise exception 'list no-store missing'; end if;
  passed:=passed+5;
  -- A rolled-back write must roll back both head and durable receipt.
  before_json:=public.life_writing_draft_get(w,d2);
  op2:=gen_random_uuid();
  begin
    perform public.life_writing_draft_put(w,d2,1,op2,3,draft || jsonb_build_object('stageId',d2));
    raise exception using errcode='P0002',message='rollback fixture';
  exception when no_data_found then null; end;
  if public.life_writing_draft_get(w,d2)<>before_json
    or public.life_writing_draft_put(w,d2,1,op2,3,draft || jsonb_build_object('stageId',d2))<>'{"status":"stored","revision":2}'::jsonb then raise exception 'write/receipt transaction split'; end if;
  passed:=passed+2;
  -- The RPC rejects even authenticated callers if their server identity is absent.
  perform set_config('request.jwt.claims','{}',true);
  foreach statement in array array[
    format('select public.life_writing_draft_get(%L,%L)',w,d),format('select public.life_writing_draft_list(%L)',w),
    format('select public.life_writing_draft_put(%L,%L,4,%L,3,%L)',w,d,gen_random_uuid(),draft)
  ] loop
    begin execute statement; raise exception 'missing identity allowed';
    exception when insufficient_privilege then
      if sqlerrm<>'life_writing_draft_auth_required' then raise; end if; passed:=passed+1;
    end;
  end loop;
  execute 'reset role'; execute 'set local role anon';
  foreach statement in array array[
    format('select public.life_writing_draft_get(%L,%L)',w,d),format('select public.life_writing_draft_list(%L)',w),
    format('select public.life_writing_draft_put(%L,%L,4,%L,3,%L)',w,d,gen_random_uuid(),draft),
    'select * from public.life_writing_drafts','select * from public.life_writing_draft_receipts','select public.life_writing_draft_valid(null)'
  ] loop
    begin execute statement; raise exception 'anonymous access allowed';
    exception when insufficient_privilege then passed:=passed+1; end;
  end loop;
  execute 'reset role';
  -- Owner/workspace/draft foreign keys retain the other owner's same UUID rows.
  delete from public.life_workspaces where owner_id=a and id=w;
  if exists(select 1 from public.life_writing_drafts where owner_id=a and workspace_id=w)
    or exists(select 1 from public.life_writing_draft_receipts where owner_id=a and workspace_id=w)
    or not exists(select 1 from public.life_writing_drafts where owner_id=b and workspace_id=w and draft_id=d)
    or not exists(select 1 from public.life_writing_drafts where owner_id=a and workspace_id=w2 and draft_id=d) then raise exception 'cascade crossed owner/workspace'; end if;
  passed:=passed+4;
  -- Table checks protect administrator mistakes as well as RPC validation.
  begin insert into public.life_writing_drafts(owner_id,workspace_id,draft_id,revision,source_revision,data)
    values(a,w2,gen_random_uuid(),1,1,draft); raise exception 'table identity constraint absent';
  exception when check_violation then passed:=passed+1; end;
  update public.life_writing_drafts set revision=9007199254740991 where owner_id=a and workspace_id=w2 and draft_id=d;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  begin perform public.life_writing_draft_put(w2,d,9007199254740991,gen_random_uuid(),1,draft || jsonb_build_object('workspaceId',w2));
    raise exception 'revision limit exceeded';
  exception when numeric_value_out_of_range then
    if sqlerrm<>'life_writing_draft_revision_limit' then raise; end if; passed:=passed+1;
  end;
  execute 'reset role';
  raise notice 'writing draft role/RLS/RPC/schema/limits/terminal/source-pair checks passed: %',passed;
end;
$test$;
rollback;
