-- LOCAL DISPOSABLE TEST DATABASE ONLY. Never run these synthetic records in production.
-- Requires original/composition/books/insights/editions migrations. All rolled back.
begin;
do $test$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); w uuid := gen_random_uuid(); op uuid := gen_random_uuid();
  base jsonb; snapshot jsonb; edition jsonb; chapter jsonb; insight jsonb; bad jsonb; value jsonb; result jsonb;
  field text; statement text; n integer; passed integer := 0;
begin
  base := jsonb_build_object('format','life-workbench-v1','workspaceId',w,'revision',0,'groups','[]'::jsonb,
    'page','{"title":"내 페이지","intro":"","showIntro":true,"showRecent":true,"entries":[]}'::jsonb,
    'reflection','{"versionIds":[],"note":""}'::jsonb,
    'books','[{"id":"book_a","title":"지금의 책","fromYear":"","toYear":"","question":"","chapters":[{"id":"chapter_a","title":"지금의 장","note":"","versionIds":[],"insights":[{"id":"insight_a","statement":"","uncertainty":"","supportVersionIds":[],"counterVersionIds":[],"excluded":false}]}]}]'::jsonb);
  insight := '{"id":"saved_insight","statement":"관심을 넓혔던 선택이었다.","uncertainty":"다르게 읽을 여지도 있다.","supportVersionIds":["missing_support"],"counterVersionIds":["missing_support","missing_counter"],"excluded":true}'::jsonb;
  chapter := jsonb_build_object('id','saved_chapter','title','그때의 장','note','당시 남긴 메모','versionIds',jsonb_build_array('missing_version'),
    'archived',true,'insights',jsonb_build_array(insight));
  edition := jsonb_build_object('id','edition_a','label','첫 번째 정리🌱','createdAt','2026-10-08T12:34:56.789Z',
    'title','그때의 책','fromYear','2020','toYear','2026','question','나는 왜 그 길을 택했나?','chapters',jsonb_build_array(chapter));
  snapshot := jsonb_set(jsonb_set(jsonb_set(base,'{books,0,archived}','true'),'{books,0,chapters,0,archived}','true'),
    '{books,0,editions}',jsonb_build_array(edition));
  if public.life_composition_valid(base - 'books') is not true then raise exception 'old v1 rejected'; end if;
  if public.life_composition_valid(base) is not true then raise exception 'old books/insights rejected'; end if;
  if public.life_composition_valid(snapshot) is not true then raise exception 'valid archived snapshot rejected'; end if;
  if public.life_composition_valid(jsonb_set(snapshot,'{books,0,editions}','[]')) is not true then raise exception 'empty editions rejected'; end if;
  passed := passed+4;
  foreach field in array array['id','label','createdAt','title','fromYear','toYear','question','chapters'] loop
    if public.life_composition_valid(jsonb_set(snapshot,'{books,0,editions,0}',edition - field)) is not false
      or public.life_composition_valid(jsonb_set(snapshot,array['books','0','editions','0',field],'null')) is not false then raise exception 'edition missing/null key accepted: %',field; end if;
    passed := passed+2;
  end loop;
  foreach value in array array['null'::jsonb,'{}'::jsonb,'false'::jsonb,'1'::jsonb,'[null]'::jsonb,'[[]]'::jsonb,'[{}]'::jsonb] loop
    if public.life_composition_valid(jsonb_set(snapshot,'{books,0,editions}',value)) is not false then raise exception 'invalid editions container accepted'; end if;
    passed := passed+1;
  end loop;
  foreach value in array array['null'::jsonb,'"true"'::jsonb,'1'::jsonb,'[]'::jsonb,'{}'::jsonb] loop
    if public.life_composition_valid(jsonb_set(snapshot,'{books,0,archived}',value)) is not false
      or public.life_composition_valid(jsonb_set(snapshot,'{books,0,chapters,0,archived}',value)) is not false
      or public.life_composition_valid(jsonb_set(snapshot,'{books,0,editions,0,chapters,0,archived}',value)) is not false then raise exception 'invalid archive flag accepted'; end if;
    passed := passed+3;
  end loop;
  foreach bad in array array[
    jsonb_set(snapshot,'{books,0,editions,0,extra}','true'),jsonb_set(snapshot,'{books,0,editions,0,editions}','[]'),
    jsonb_set(snapshot,'{books,0,editions,0,archived}','true'),jsonb_set(snapshot,'{books,0,editions,0,id}','"bad id"'),
    jsonb_set(snapshot,'{books,0,editions,0,label}','""'),jsonb_set(snapshot,'{books,0,editions,0,label}',to_jsonb(U&'\00A0\FEFF'::text)),
    jsonb_set(snapshot,'{books,0,editions,0,title}','""'),jsonb_set(snapshot,'{books,0,editions,0,question}','false'),
    jsonb_set(snapshot,'{books,0,editions,0,fromYear}','"0000"'),jsonb_set(snapshot,'{books,0,editions,0,toYear}','"2019"'),
    jsonb_set(snapshot,'{books,0,editions,0,label}',to_jsonb(repeat('🌱',251))),
    jsonb_set(snapshot,'{books,0,editions,0,title}',to_jsonb(repeat('🌱',251))),
    jsonb_set(snapshot,'{books,0,editions,0,question}',to_jsonb(repeat('🌱',10001))),
    jsonb_set(snapshot,'{books,0,editions,0,chapters}','[null]'),
    jsonb_set(snapshot,'{books,0,editions,0,chapters,0,title}','""'),
    jsonb_set(snapshot,'{books,0,editions,0,chapters,0,editions}','[]'),
    jsonb_set(snapshot,'{books,0,editions,0,chapters,0,versionIds}','["same","same"]'),
    jsonb_set(snapshot,'{books,0,editions,0,chapters,0,insights,0,excluded}','null'),
    jsonb_set(snapshot,'{books,0,editions,0,chapters,0,insights,0,supportVersionIds}','["same","same"]')
  ] loop
    if public.life_composition_valid(bad) is not false then raise exception 'invalid edition shape accepted'; end if;
    passed := passed+1;
  end loop;
  foreach value in array array[
    '"0000-01-01T00:00:00.000Z"'::jsonb,'"+010000-01-01T00:00:00.000Z"'::jsonb,
    '"2026-02-29T00:00:00.000Z"'::jsonb,'"1900-02-29T00:00:00.000Z"'::jsonb,
    '"2026-04-31T00:00:00.000Z"'::jsonb,'"2026-00-01T00:00:00.000Z"'::jsonb,
    '"2026-13-01T00:00:00.000Z"'::jsonb,'"2026-01-00T00:00:00.000Z"'::jsonb,
    '"2026-01-01T24:00:00.000Z"'::jsonb,'"2026-01-01T23:60:00.000Z"'::jsonb,
    '"2026-01-01T23:59:60.000Z"'::jsonb,'"2026-01-01T00:00:00Z"'::jsonb,
    '"2026-01-01T00:00:00.00Z"'::jsonb,'"2026-01-01T00:00:00.0000Z"'::jsonb,
    '"2026-01-01T00:00:00.000+00:00"'::jsonb,'"2026-01-01t00:00:00.000z"'::jsonb,
    '" 2026-01-01T00:00:00.000Z"'::jsonb,'"2026-01-01T00:00:00.000Z "'::jsonb,
    '"2026-01-01"'::jsonb,'123'::jsonb
  ] loop
    if public.life_composition_valid(jsonb_set(snapshot,'{books,0,editions,0,createdAt}',value)) is not false then raise exception 'invalid edition timestamp accepted'; end if;
    passed := passed+1;
  end loop;
  foreach value in array array['"0001-01-01T00:00:00.000Z"'::jsonb,'"9999-12-31T23:59:59.999Z"'::jsonb,
    '"2000-02-29T00:00:00.000Z"'::jsonb,'"2024-02-29T23:59:59.123Z"'::jsonb] loop
    if public.life_composition_valid(jsonb_set(snapshot,'{books,0,editions,0,createdAt}',value)) is not true then raise exception 'valid calendar boundary rejected'; end if;
    passed := passed+1;
  end loop;
  perform set_config('TimeZone','Pacific/Auckland',true); perform set_config('DateStyle','SQL, DMY',true);
  if public.life_composition_valid(snapshot) is not true then raise exception 'timestamp depends on session timezone/date style'; end if;
  perform set_config('TimeZone','UTC',true); perform set_config('DateStyle','ISO, MDY',true);
  passed := passed+1;
  foreach bad in array array[
    jsonb_set(snapshot,'{books,0,archived}','false'),jsonb_set(snapshot,'{books,0,chapters,0,archived}','false'),
    snapshot #- '{books,0,editions,0,chapters,0,archived}',
    jsonb_set(snapshot,'{books,0,editions,0}',edition || '{"fromYear":"","toYear":"","question":"","chapters":[]}'),
    jsonb_set(snapshot,'{books,0,editions,0,label}',to_jsonb(repeat('🌱',250))),
    jsonb_set(snapshot,'{books,0,editions,0,title}',to_jsonb(repeat('🌱',250))),
    jsonb_set(snapshot,'{books,0,editions,0,question}',to_jsonb(repeat('🌱',10000)))
  ] loop
    if public.life_composition_valid(bad) is not true then raise exception 'valid edition boundary rejected'; end if;
    passed := passed+1;
  end loop;
  foreach bad in array array[
    jsonb_set(snapshot,'{books,0,editions,0,id}','"book_a"'),
    jsonb_set(snapshot,'{books,0,editions,0,id}','"chapter_a"'),
    jsonb_set(snapshot,'{books,0,editions,0,id}','"insight_a"'),
    jsonb_set(snapshot,'{books,0,editions,0,chapters,0,id}','"chapter_a"'),
    jsonb_set(snapshot,'{books,0,editions,0,chapters,0,id}','"edition_a"'),
    jsonb_set(snapshot,'{books,0,editions,0,chapters,0,insights,0,id}','"insight_a"'),
    jsonb_set(snapshot,'{books,0,editions,0,chapters,0,insights,0,id}','"saved_chapter"'),
    jsonb_set(snapshot,'{books,0,editions}',jsonb_build_array(edition,edition || '{"id":"edition_b"}')),
    snapshot || '{"groups":[{"id":"edition_a","title":"겹친 묶음","versionIds":[]}]}',
    jsonb_set(snapshot,'{page,entries}','[{"id":"saved_insight","title":"겹친 항목","parts":[],"note":"","pinned":false,"enabled":true,"showBody":true,"showNote":true}]')
  ] loop
    if public.life_composition_valid(bad) is not false then raise exception 'global snapshot ID collision accepted'; end if;
    passed := passed+1;
  end loop;
  select jsonb_set(snapshot,'{books,0,editions}',jsonb_agg(edition || jsonb_build_object('id','edition_' || i,'chapters','[]'::jsonb)))
    into bad from generate_series(1,11) i;
  if public.life_composition_valid(bad) is not false then raise exception '11 editions accepted'; end if;
  if public.life_composition_valid(jsonb_set(bad,'{books,0,editions}',(bad #> '{books,0,editions}') - 10)) is not true then raise exception '10 editions rejected'; end if;
  passed := passed+2;
  select jsonb_set(snapshot,'{books,0,editions,0,chapters}',jsonb_agg(chapter || jsonb_build_object('id','chapter_' || i,'insights','[]'::jsonb)))
    into bad from generate_series(1,101) i;
  if public.life_composition_valid(bad) is not false then raise exception '101 snapshot chapters accepted'; end if;
  if public.life_composition_valid(jsonb_set(bad,'{books,0,editions,0,chapters}',(bad #> '{books,0,editions,0,chapters}') - 100)) is not true then raise exception '100 snapshot chapters rejected'; end if;
  passed := passed+2;
  select jsonb_set(snapshot,'{books,0,editions,0,chapters,0,insights}',jsonb_agg(insight || jsonb_build_object('id','saved_' || i)))
    into bad from generate_series(1,101) i;
  if public.life_composition_valid(bad) is not false then raise exception '101 snapshot insights accepted'; end if;
  if public.life_composition_valid(jsonb_set(bad,'{books,0,editions,0,chapters,0,insights}',(bad #> '{books,0,editions,0,chapters,0,insights}') - 100)) is not true then raise exception '100 snapshot insights rejected'; end if;
  passed := passed+2;
  select jsonb_set(snapshot,'{books,0,editions,0,chapters}',jsonb_agg(chapter || jsonb_build_object('id','size_' || i,'note',repeat('가',10000),'insights','[]'::jsonb)))
    into bad from generate_series(1,69) i;
  bad := jsonb_set(bad,'{books,0,editions,0,question}','""');
  n := 2097152-public.life_composition_json_bytes(bad);
  if n < 0 or n > 40000 then raise exception 'invalid size fixture remainder %',n; end if;
  bad := jsonb_set(bad,'{books,0,editions,0,question}',to_jsonb(repeat('x',least(n,20000))));
  bad := jsonb_set(bad,'{page,intro}',to_jsonb(repeat('x',greatest(n-20000,0))));
  if public.life_composition_json_bytes(bad) <> 2097152 or public.life_composition_valid(bad) is not true then raise exception 'editions at 2 MiB rejected'; end if;
  if public.life_composition_valid(jsonb_set(bad,'{page,intro}',to_jsonb((bad #>> '{page,intro}') || 'x'))) is not false then raise exception 'editions over 2 MiB accepted'; end if;
  passed := passed+2;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  perform public.life_sync_put(w,0,gen_random_uuid(),jsonb_build_object('schemaVersion',1,'workspaceId',w,'title','익명 원문'));
  result := public.life_composition_put(w,0,op,1,snapshot);
  if result <> '{"status":"stored","revision":1}'::jsonb then raise exception 'edition RPC store failed'; end if;
  if public.life_composition_put(w,0,op,1,snapshot) <> result then raise exception 'edition retry receipt changed'; end if;
  if public.life_composition_get(w) -> 'data' <> snapshot then raise exception 'archived/excluded snapshot refs changed on round trip'; end if;
  passed := passed+3;
  begin perform public.life_composition_put(w,1,gen_random_uuid(),1,jsonb_set(snapshot,'{books,0,editions,0,createdAt}','"2026-02-29T00:00:00.000Z"')); raise exception 'RPC accepted impossible timestamp';
  exception when invalid_parameter_value then passed := passed+1; end;
  if public.life_composition_get(w) -> 'revision' <> '1'::jsonb then raise exception 'invalid edition changed head'; end if;
  passed := passed+1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  if public.life_composition_get(w) is not null then raise exception 'edition leaked to other account'; end if;
  passed := passed+1;
  foreach statement in array array['select public.life_composition_valid(null)','select * from public.life_compositions','select * from public.life_composition_receipts'] loop
    begin execute statement; raise exception 'authenticated privileges widened';
    exception when insufficient_privilege then passed := passed+1; end;
  end loop;
  execute 'set local role anon';
  foreach statement in array array[format('select public.life_composition_get(%L)',w),'select public.life_composition_valid(null)'] loop
    begin execute statement; raise exception 'anonymous privileges widened';
    exception when insufficient_privilege then passed := passed+1; end;
  end loop;
  execute 'reset role';
  raise notice 'PASS % local composition-editions validation/RPC/privilege checks; transaction will roll back',passed;
end;
$test$;
rollback;
