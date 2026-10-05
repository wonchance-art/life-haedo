-- LOCAL TEST DATABASE ONLY. Do not recreate synthetic users/pages in production.
-- Real PostgreSQL roles, RLS and RPC, with synthetic Auth claims; all rolled back.
begin;
do $test$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); w uuid := gen_random_uuid();
  op uuid := gen_random_uuid(); revoke_op uuid := gen_random_uuid(); empty_w uuid := gen_random_uuid();
  snapshot jsonb; result jsonb; first_result jsonb; metadata jsonb; changed jsonb; bad jsonb;
  item jsonb; part jsonb; public_id uuid; new_public_id uuid; b_public_id uuid; cursor_id uuid;
  n integer; passed integer := 0; statement text;
begin
  insert into auth.users(id) values(a),(b);
  part := jsonb_build_object('title','보관한 글','origin','other','url','https://example.invalid/original',
    'author',jsonb_build_object('label','익명 작성자','relation','self'),'originalCreatedAt','지난 봄',
    'coverage',jsonb_build_object('status','partial','omissions',jsonb_build_array('사진 미포함')),
    'text','선택한 공개 본문🌱','textKind','excerpt');
  item := jsonb_build_object('title','선택한 기록','pinned',true,'note','내가 공개한 코멘트','parts',jsonb_build_array(part));
  snapshot := jsonb_build_object('format','life-share-v1','title','익명 페이지','intro',null,'entries',jsonb_build_array(item));
  if not public.life_public_page_valid(snapshot) then raise exception 'valid fixture rejected'; end if;
  passed := passed+1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  metadata := public.life_public_page_get(w);
  if metadata <> '{"status":"missing","revision":0,"publicId":null,"updatedAt":null,"lastOperationId":null}'::jsonb then raise exception 'initial metadata failed'; end if;
  passed := passed+1;
  first_result := public.life_public_page_put(w,0,op,'publish',snapshot);
  public_id := (first_result ->> 'publicId')::uuid;
  if first_result ->> 'status' <> 'stored' or first_result -> 'revision' <> '1'::jsonb or first_result -> 'published' <> 'true'::jsonb
    or public_id is null or public_id in(a,w) then raise exception 'publish failed'; end if;
  passed := passed+1;
  if public.life_public_page_put(w,0,op,'publish',snapshot) <> first_result then raise exception 'identical retry failed'; end if;
  passed := passed+1;
  metadata := public.life_public_page_get(w);
  if metadata ->> 'status' <> 'published' or metadata ->> 'lastOperationId' <> op::text
    or metadata ?| array['ownerId','workspaceId','snapshot'] then raise exception 'owner metadata failed'; end if;
  passed := passed+1;
  if current_setting('response.headers')::jsonb <> '[{"Cache-Control":"no-store, max-age=0"}]'::jsonb then raise exception 'no-store missing'; end if;
  passed := passed+1;
  foreach statement in array array[
    'select 1 from public.life_public_pages','select 1 from public.life_public_page_receipts',
    'delete from public.life_public_pages','update public.life_public_pages set published=false',
    'insert into public.life_public_pages select * from public.life_public_pages',
    'select public.life_public_page_valid(null)',
    'select public.life_public_page_text_valid(null,10,false)',
    'select public.life_public_page_json_bytes(null)'] loop
    begin execute statement; raise exception 'private direct access allowed';
    exception when insufficient_privilege then passed := passed+1; end;
  end loop;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  if public.life_public_page_get(w) ->> 'status' <> 'missing' then raise exception 'owner B metadata leak'; end if;
  if public.life_public_page_list(null) <> '{"pages":[],"nextCursor":null}'::jsonb then raise exception 'owner B list leak'; end if;
  if public.life_public_page_put(w,1,gen_random_uuid(),'publish',snapshot) <> '{"status":"missing"}'::jsonb then raise exception 'owner B revision leak'; end if;
  passed := passed+2;
  result := public.life_public_page_put(w,0,op,'publish',snapshot);
  b_public_id := (result ->> 'publicId')::uuid;
  if result ->> 'status' <> 'stored' or b_public_id=public_id then raise exception 'owner namespace collision'; end if;
  passed := passed+1;
  if public.life_public_page_read(public_id) -> 'snapshot' <> snapshot then raise exception 'signed-in visitor cannot read exact public page'; end if;
  passed := passed+1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  begin perform public.life_public_page_put(w,0,op,'publish',snapshot || '{"title":"changed"}'); raise exception 'retry changed payload accepted';
  exception when invalid_parameter_value then passed := passed+1; end;
  begin perform public.life_public_page_put(w,1,op,'publish',snapshot); raise exception 'retry changed base accepted';
  exception when invalid_parameter_value then passed := passed+1; end;
  begin perform public.life_public_page_put(w,0,op,'revoke',null); raise exception 'retry changed action accepted';
  exception when invalid_parameter_value then passed := passed+1; end;
  if public.life_public_page_put(w,0,gen_random_uuid(),'publish',snapshot) <> '{"status":"conflict","revision":1}'::jsonb then raise exception 'stale creation overwrote'; end if;
  passed := passed+1;
  changed := snapshot || '{"title":"갱신한 페이지"}';
  result := public.life_public_page_put(w,1,gen_random_uuid(),'publish',changed);
  if result ->> 'publicId' <> public_id::text or result -> 'revision' <> '2'::jsonb then raise exception 'published update changed URL'; end if;
  if public.life_public_page_read(public_id) -> 'snapshot' <> changed then raise exception 'published update not visible'; end if;
  passed := passed+2;
  result := public.life_public_page_put(w,2,revoke_op,'revoke',null);
  if result -> 'published' <> 'false'::jsonb or result -> 'revision' <> '3'::jsonb or result -> 'publicId' <> 'null'::jsonb then raise exception 'revoke failed'; end if;
  if public.life_public_page_get(w) -> 'publicId' <> 'null'::jsonb then raise exception 'revoked metadata retained old public URL'; end if;
  if public.life_public_page_put(w,2,revoke_op,'revoke',null) <> result then raise exception 'revoke replay failed'; end if;
  if public.life_public_page_read(public_id) <> '{"status":"missing"}'::jsonb then raise exception 'revoked page exposed'; end if;
  passed := passed+3;
  if public.life_public_page_put(w,0,op,'publish',snapshot) <> first_result then raise exception 'historical retry receipt changed'; end if;
  if public.life_public_page_get(w) ->> 'status' <> 'revoked' or public.life_public_page_read(public_id) <> '{"status":"missing"}'::jsonb then raise exception 'old successful publish resurrected revoked page'; end if;
  passed := passed+2;
  result := public.life_public_page_put(w,3,gen_random_uuid(),'publish',snapshot);
  new_public_id := (result ->> 'publicId')::uuid;
  if new_public_id is null or new_public_id=public_id then raise exception 'republish reused revoked URL'; end if;
  if public.life_public_page_read(public_id) <> '{"status":"missing"}'::jsonb or public.life_public_page_read(new_public_id) -> 'snapshot' <> snapshot then raise exception 'public URL rotation failed'; end if;
  passed := passed+2;
  if public.life_public_page_put(w,2,revoke_op,'revoke',null) -> 'published' <> 'false'::jsonb
    or public.life_public_page_get(w) ->> 'status' <> 'published' then raise exception 'old revoke receipt changed current head'; end if;
  passed := passed+1;
  result := public.life_public_page_put(empty_w,0,gen_random_uuid(),'revoke',null);
  if result -> 'publicId' <> 'null'::jsonb or result -> 'revision' <> '1'::jsonb then raise exception 'initial revoke tombstone failed'; end if;
  if public.life_public_page_put(empty_w,0,gen_random_uuid(),'publish',snapshot) <> '{"status":"conflict","revision":1}'::jsonb then raise exception 'queued initial publish bypassed revoke'; end if;
  passed := passed+2;
  -- Rejected payloads must not change the revision, snapshot or receipts.
  foreach bad in array array[
    'null'::jsonb,'[]'::jsonb,'{}'::jsonb,snapshot || '{"ownerId":"private"}', snapshot - 'intro',
    snapshot || '{"title":""}',snapshot || '{"title":null}',snapshot || '{"format":"unknown"}',
    jsonb_set(snapshot,'{entries,0,workspaceId}','"private"'),jsonb_set(snapshot,'{entries,0,pinned}','1'),
    jsonb_set(snapshot,'{entries,0,parts,0,sourceVersionId}','"private"'),
    jsonb_set(snapshot,'{entries,0,parts,0,author,secret}','"private"'),
    jsonb_set(snapshot,'{entries,0,parts,0,coverage,secret}','"private"'),
    jsonb_set(snapshot,'{entries,0,parts,0,origin}','"invented"'),
    jsonb_set(snapshot,'{entries,0,parts,0,textKind}','"none"'),
    jsonb_set(snapshot,'{entries,0,parts,0,text}','null'),
    jsonb_set(snapshot,'{entries,0,parts,0,text}','""'),
    jsonb_set(snapshot,'{entries,0,parts,0,coverage,status}','"link_only"'),
    jsonb_set(snapshot,'{entries,0,parts,0,url}','"javascript:alert(1)"'),
    jsonb_set(snapshot,'{entries,0,parts,0,url}','"https://private@example.invalid/"'),
    jsonb_set(snapshot,'{entries,0,parts,0,url}','"https://host:bad"'),
    jsonb_set(snapshot,'{entries,0,parts,0,url}','"https://[broken"'),
    jsonb_set(snapshot,'{entries,0,parts,0,url}','"https://host:65536"'),
    jsonb_set(snapshot,'{title}',to_jsonb(repeat('🌱',251))),
    jsonb_set(snapshot,'{title}',to_jsonb(E'\t\n'::text)),
    jsonb_set(snapshot,'{entries,0,parts,0,text}',to_jsonb(chr(1))),
    jsonb_set(snapshot,'{entries,0,parts,0,url}',to_jsonb(E'https://example.invalid/\nprivate'::text)),
    jsonb_set(snapshot,'{entries,0,parts,0,url}',to_jsonb('https:' || chr(92) || chr(92) || 'example.invalid')),
    jsonb_set(snapshot,'{title}',to_jsonb(repeat('x',501))),
    jsonb_set(snapshot,'{entries,0,parts,0,text}',to_jsonb(repeat('x',50001))),
    jsonb_set(snapshot,'{entries,0,parts,0,originalCreatedAt}',to_jsonb(repeat('x',201))),
    jsonb_set(snapshot,'{entries,0,parts,0,url}',to_jsonb('https://example.invalid/' || repeat('x',2048)))
  ] loop
    begin perform public.life_public_page_put(w,4,gen_random_uuid(),'publish',bad); raise exception 'invalid snapshot accepted';
    exception when invalid_parameter_value then passed := passed+1; end;
  end loop;
  foreach statement in array array[
    format('select public.life_public_page_put(%L,-1,%L,''publish'',%L)',w,gen_random_uuid(),snapshot),
    format('select public.life_public_page_put(%L,null,%L,''publish'',%L)',w,gen_random_uuid(),snapshot),
    format('select public.life_public_page_put(%L,9007199254740992,%L,''publish'',%L)',w,gen_random_uuid(),snapshot),
    format('select public.life_public_page_put(%L,4,%L,''remove'',null)',w,gen_random_uuid()),
    format('select public.life_public_page_put(%L,4,%L,''revoke'',%L)',w,gen_random_uuid(),snapshot)
  ] loop
    begin execute statement; raise exception 'invalid request accepted';
    exception when invalid_parameter_value then passed := passed+1; end;
  end loop;
  if public.life_public_page_get(w) -> 'revision' <> '4'::jsonb then raise exception 'invalid call changed head'; end if;
  passed := passed+1;
  -- Collection and total-byte limits are separate from individual text limits.
  execute 'reset role';
  if public.life_public_page_json_bytes('{"a": "b"}') <> 9 then raise exception 'compact JSON bytes failed'; end if;
  passed := passed+1;
  select snapshot || jsonb_build_object('entries',jsonb_agg(item)) into bad from generate_series(1,100);
  if not public.life_public_page_valid(bad) then raise exception '100 entries rejected'; end if;
  passed := passed+1;
  select snapshot || jsonb_build_object('entries',jsonb_agg(item)) into bad from generate_series(1,101);
  if public.life_public_page_valid(bad) then raise exception '101 entries accepted'; end if;
  passed := passed+1;
  select jsonb_set(item,'{parts}',jsonb_agg(part)) into changed from generate_series(1,100);
  bad := snapshot || jsonb_build_object('entries',jsonb_build_array(changed,changed));
  if not public.life_public_page_valid(bad) then raise exception '200 total parts rejected'; end if;
  passed := passed+1;
  bad := snapshot || jsonb_build_object('entries',jsonb_build_array(changed,changed,item));
  if public.life_public_page_valid(bad) then raise exception '201 total parts accepted'; end if;
  passed := passed+1;
  select jsonb_set(item,'{parts}',jsonb_agg(part)) into changed from generate_series(1,101);
  if public.life_public_page_valid(snapshot || jsonb_build_object('entries',jsonb_build_array(changed))) then raise exception '101 parts in entry accepted'; end if;
  passed := passed+1;
  bad := jsonb_set(snapshot,'{entries,0,parts,0,text}',to_jsonb(repeat('x',50000)));
  if not public.life_public_page_valid(bad) then raise exception '50000 text boundary rejected'; end if;
  passed := passed+1;
  changed := jsonb_set(item,'{note}',to_jsonb(repeat('가',50000)));
  select snapshot || jsonb_build_object('entries',jsonb_agg(changed)) into bad from generate_series(1,8);
  if public.life_public_page_valid(bad) then raise exception 'one MiB UTF-8 limit bypassed'; end if;
  passed := passed+1;
  changed := part || '{"text":null,"textKind":"none","url":null,"originalCreatedAt":null,"coverage":{"status":"link_only","omissions":[]}}';
  if not public.life_public_page_valid(snapshot || jsonb_build_object('entries',jsonb_build_array(item || jsonb_build_object('parts',jsonb_build_array(changed))))) then raise exception 'metadata-only publication rejected'; end if;
  passed := passed+1;
  execute 'set local role authenticated';
  -- An operation belongs to this owner/workspace pair, not to a global namespace.
  result := public.life_public_page_put(gen_random_uuid(),0,op,'publish',snapshot);
  if result ->> 'status' <> 'stored' or result -> 'revision' <> '1'::jsonb then raise exception 'same owner different workspace operation collided'; end if;
  passed := passed+1;
  metadata := public.life_public_page_list(null);
  if jsonb_array_length(metadata -> 'pages') <> 2 or metadata -> 'nextCursor' <> 'null'::jsonb
    or exists(select 1 from jsonb_array_elements(metadata -> 'pages') page where page - array['workspaceId','title','revision','publicId','updatedAt','lastOperationId'] <> '{}'::jsonb)
    or exists(select 1 from jsonb_array_elements(metadata -> 'pages') page where page ->> 'publicId'=b_public_id::text)
    then raise exception 'owner-only publication list failed'; end if;
  passed := passed+1;
  for n in 1..50 loop perform public.life_public_page_put(gen_random_uuid(),0,gen_random_uuid(),'publish',snapshot); end loop;
  metadata := public.life_public_page_list(null);
  cursor_id := (metadata ->> 'nextCursor')::uuid;
  if jsonb_array_length(metadata -> 'pages')<>50 or cursor_id is null or cursor_id::text<>metadata #>> '{pages,49,workspaceId}' then raise exception 'list first page cursor failed'; end if;
  result := public.life_public_page_list(cursor_id);
  if jsonb_array_length(result -> 'pages')<>2 or result -> 'nextCursor' <> 'null'::jsonb
    or exists(select 1 from jsonb_array_elements(result -> 'pages') page where (page ->> 'workspaceId')::uuid<=cursor_id)
    then raise exception 'list second page cursor failed'; end if;
  passed := passed+2;
  -- RLS also denies rows if an administrator accidentally grants table SELECT.
  execute 'reset role';
  if (select page.snapshot from public.life_public_pages page where page.owner_id=a and page.workspace_id=empty_w) is not null then raise exception 'revoked payload retained'; end if;
  passed := passed+1;
  execute 'grant select on public.life_public_pages, public.life_public_page_receipts to authenticated';
  execute 'set local role authenticated';
  select count(*) into n from public.life_public_pages; if n<>0 then raise exception 'RLS permits private rows'; end if;
  select count(*) into n from public.life_public_page_receipts; if n<>0 then raise exception 'RLS permits receipt rows'; end if;
  passed := passed+2;
  execute 'reset role';
  execute 'revoke select on public.life_public_pages, public.life_public_page_receipts from authenticated';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  begin perform public.life_public_page_get(w); raise exception 'missing Auth accepted';
  exception when insufficient_privilege then passed := passed+1; end;
  begin perform public.life_public_page_list(null); raise exception 'missing Auth list accepted';
  exception when insufficient_privilege then passed := passed+1; end;
  begin perform public.life_public_page_put(w,4,gen_random_uuid(),'revoke',null); raise exception 'missing Auth write accepted';
  exception when insufficient_privilege then passed := passed+1; end;
  execute 'set local role anon';
  result := public.life_public_page_read(new_public_id);
  if result -> 'snapshot' <> snapshot or result - array['status','publicId','revision','updatedAt','snapshot'] <> '{}'::jsonb then raise exception 'anonymous snapshot envelope invalid'; end if;
  if result::text like '%' || a::text || '%' or result::text like '%' || w::text || '%' then raise exception 'private identifier exposed'; end if;
  passed := passed+2;
  if public.life_public_page_read(null) <> '{"status":"missing"}'::jsonb or public.life_public_page_read(gen_random_uuid()) <> '{"status":"missing"}'::jsonb
    or public.life_public_page_read(w) <> '{"status":"missing"}'::jsonb then raise exception 'anonymous lookup leaked private/missing state'; end if;
  passed := passed+1;
  foreach statement in array array['select 1 from public.life_public_pages','select 1 from public.life_public_page_receipts',
    format('select public.life_public_page_get(%L)',w),format('select public.life_public_page_put(%L,0,%L,''revoke'',null)',w,gen_random_uuid()),
    'select public.life_public_page_valid(null)','select public.life_public_page_list(null)',
    'select public.life_public_page_text_valid(null,10,false)','select public.life_public_page_json_bytes(null)'] loop
    begin execute statement; raise exception 'anonymous private RPC/table allowed';
    exception when insufficient_privilege then passed := passed+1; end;
  end loop;
  execute 'reset role';
  -- A removed account cannot leave its public page or its receipts orphaned.
  delete from auth.users where id=a;
  if exists(select 1 from public.life_public_pages where owner_id=a) or exists(select 1 from public.life_public_page_receipts where owner_id=a)
    or public.life_public_page_read(new_public_id) <> '{"status":"missing"}'::jsonb then raise exception 'deleted account left public copy'; end if;
  passed := passed+1;
  if not exists(select 1 from public.life_public_pages where owner_id=b) then raise exception 'owner deletion affected other owner'; end if;
  passed := passed+1;
  perform set_config('haedo.public_test.passed',passed::text,true);
end;
$test$;
select current_setting('haedo.public_test.passed')::integer as passed,
  'local PostgreSQL real roles/RLS/RPC; synthetic claims; transaction rolled back' as scope;
rollback;
