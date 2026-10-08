-- LOCAL DISPOSABLE TEST DATABASE ONLY. Never run synthetic-data checks in production.
-- Apply original, composition and composition-books migrations first. All rolled back.
begin;
do $test$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); w uuid := gen_random_uuid(); op uuid := gen_random_uuid();
  base jsonb; snapshot jsonb; book jsonb; chapter jsonb; bad jsonb; value jsonb; result jsonb;
  field text; statement text; n integer; passed integer := 0;
begin
  base := jsonb_build_object('format','life-workbench-v1','workspaceId',w,'revision',0,'groups','[]'::jsonb,
    'page','{"title":"내 페이지","intro":"","showIntro":true,"showRecent":true,"entries":[]}'::jsonb,
    'reflection','{"versionIds":[],"note":""}'::jsonb);
  chapter := '{"id":"chapter_a","title":"다른 길을 고른 날","note":"그 선택의 이유를 돌아본다.","versionIds":["fixed_old_version","missing_version"]}'::jsonb;
  book := jsonb_build_object('id','book_a','title','나를 바꾼 선택들🌱','fromYear','2020','toYear','2026',
    'question','나는 어떤 선택을 반복했을까?','chapters',jsonb_build_array(chapter));
  snapshot := base || jsonb_build_object('books',jsonb_build_array(book));
  if public.life_composition_valid(base) is not true then raise exception 'old v1 rejected'; end if;
  if public.life_composition_valid(base || '{"books":[]}') is not true then raise exception 'empty books rejected'; end if;
  if public.life_composition_valid(snapshot) is not true then raise exception 'valid book with missing references rejected'; end if;
  passed := passed+3;
  -- NULL and absent keys are distinct cases; every nested required key fails closed.
  foreach field in array array['id','title','fromYear','toYear','question','chapters'] loop
    if public.life_composition_valid(jsonb_set(snapshot,'{books,0}',book - field)) is not false
      or public.life_composition_valid(jsonb_set(snapshot,array['books','0',field],'null')) is not false then raise exception 'book missing/null key accepted: %',field; end if;
    passed := passed+2;
  end loop;
  foreach field in array array['id','title','note','versionIds'] loop
    if public.life_composition_valid(jsonb_set(snapshot,'{books,0,chapters,0}',chapter - field)) is not false
      or public.life_composition_valid(jsonb_set(snapshot,array['books','0','chapters','0',field],'null')) is not false then raise exception 'chapter missing/null key accepted: %',field; end if;
    passed := passed+2;
  end loop;
  foreach bad in array array[
    base || '{"books":null}',base || '{"books":{}}',base || '{"books":[null]}',base || '{"books":[[]]}',
    jsonb_set(snapshot,'{books,0,extra}','true'),jsonb_set(snapshot,'{books,0,title}','""'),
    jsonb_set(snapshot,'{books,0,title}',to_jsonb(U&'\00A0\FEFF'::text)),jsonb_set(snapshot,'{books,0,question}','3'),
    jsonb_set(snapshot,'{books,0,id}','"not an id"'),jsonb_set(snapshot,'{books,0,id}','""'),
    jsonb_set(snapshot,'{books,0,chapters}','{}'),jsonb_set(snapshot,'{books,0,chapters}','[null]'),
    jsonb_set(snapshot,'{books,0,chapters,0,extra}','true'),jsonb_set(snapshot,'{books,0,chapters,0,title}','""'),
    jsonb_set(snapshot,'{books,0,chapters,0,title}',to_jsonb(E' \t\r\n'::text)),
    jsonb_set(snapshot,'{books,0,chapters,0,id}','"not an id"'),jsonb_set(snapshot,'{books,0,chapters,0,note}','false'),
    jsonb_set(snapshot,'{books,0,chapters,0,versionIds}','[null]'),
    jsonb_set(snapshot,'{books,0,chapters,0,versionIds}','["bad id"]'),
    jsonb_set(snapshot,'{books,0,chapters,0,versionIds}','["same","same"]'),
    jsonb_set(snapshot,'{books,0,title}',to_jsonb(repeat('🌱',251))),
    jsonb_set(snapshot,'{books,0,question}',to_jsonb(repeat('🌱',10001))),
    jsonb_set(snapshot,'{books,0,chapters,0,title}',to_jsonb(repeat('🌱',251))),
    jsonb_set(snapshot,'{books,0,chapters,0,note}',to_jsonb(repeat('🌱',10001)))
  ] loop
    if public.life_composition_valid(bad) is not false then raise exception 'invalid nested book shape accepted'; end if;
    passed := passed+1;
  end loop;
  foreach value in array array['null'::jsonb,'true'::jsonb,'2024'::jsonb,'"0000"'::jsonb,'"1"'::jsonb,
    '"10000"'::jsonb,'" 2024"'::jsonb,'"2024 "'::jsonb,'"2024-01-01"'::jsonb,'"٢٠٢٤"'::jsonb] loop
    foreach field in array array['fromYear','toYear'] loop
      if public.life_composition_valid(jsonb_set(snapshot,array['books','0',field],value)) is not false then raise exception 'invalid year accepted'; end if;
      passed := passed+1;
    end loop;
  end loop;
  if public.life_composition_valid(jsonb_set(snapshot,'{books,0,fromYear}','"2027"')) is not false then raise exception 'reversed year period accepted'; end if;
  passed := passed+1;
  foreach bad in array array[
    jsonb_set(snapshot,'{books,0}',book || '{"fromYear":"","toYear":""}'),
    jsonb_set(snapshot,'{books,0}',book || '{"fromYear":"0001","toYear":"9999"}'),
    jsonb_set(snapshot,'{books,0}',book || '{"fromYear":"2026","toYear":"2026"}'),
    jsonb_set(snapshot,'{books,0}',book || '{"fromYear":"","toYear":"0001"}'),
    jsonb_set(snapshot,'{books,0}',book || '{"fromYear":"9999","toYear":""}'),
    jsonb_set(snapshot,'{books,0}',book || '{"question":"","chapters":[]}'),
    jsonb_set(snapshot,'{books,0,chapters,0}',chapter || '{"note":"","versionIds":[]}'),
    jsonb_set(snapshot,'{books,0,title}',to_jsonb(repeat('🌱',250))),
    jsonb_set(snapshot,'{books,0,question}',to_jsonb(repeat('🌱',10000))),
    jsonb_set(snapshot,'{books,0,chapters,0,title}',to_jsonb(repeat('🌱',250))),
    jsonb_set(snapshot,'{books,0,chapters,0,note}',to_jsonb(repeat('🌱',10000))),
    jsonb_set(snapshot,'{books,0,chapters}',jsonb_build_array(chapter,chapter || '{"id":"chapter_b"}'))
  ] loop
    if public.life_composition_valid(bad) is not true then raise exception 'valid book boundary rejected'; end if;
    passed := passed+1;
  end loop;
  -- Book/chapter/group/page-entry IDs share one namespace; exact versions may be
  -- reused in distinct chapters and keep their order without copying originals.
  foreach bad in array array[
    jsonb_set(snapshot,'{books}',jsonb_build_array(book,book)),
    jsonb_set(snapshot,'{books,0,chapters,0,id}','"book_a"'),
    jsonb_set(snapshot,'{books,0,chapters}',jsonb_build_array(chapter,chapter)),
    jsonb_set(snapshot,'{books}',jsonb_build_array(book,book || '{"id":"book_b"}')),
    jsonb_set(snapshot,'{books}',jsonb_build_array(book,book || '{"id":"chapter_a","chapters":[]}')),
    snapshot || '{"groups":[{"id":"book_a","title":"겹치는 묶음","versionIds":[]}]}',
    snapshot || '{"groups":[{"id":"chapter_a","title":"겹치는 묶음","versionIds":[]}]}',
    jsonb_set(snapshot,'{page,entries}','[{"id":"book_a","title":"겹치는 항목","parts":[],"note":"","pinned":false,"enabled":true,"showBody":true,"showNote":true}]'),
    jsonb_set(snapshot,'{page,entries}','[{"id":"chapter_a","title":"겹치는 항목","parts":[],"note":"","pinned":false,"enabled":true,"showBody":true,"showNote":true}]')
  ] loop
    if public.life_composition_valid(bad) is not false then raise exception 'duplicate global composition ID accepted'; end if;
    passed := passed+1;
  end loop;
  select jsonb_set(snapshot,'{books}',jsonb_agg(book || jsonb_build_object('id','book_' || i,'chapters','[]'::jsonb)))
    into bad from generate_series(1,21) i;
  if public.life_composition_valid(bad) is not false then raise exception '21 books accepted'; end if;
  if public.life_composition_valid(jsonb_set(bad,'{books}',(bad -> 'books') - 20)) is not true then raise exception '20 books rejected'; end if;
  passed := passed+2;
  select jsonb_set(snapshot,'{books,0,chapters}',jsonb_agg(chapter || jsonb_build_object('id','chapter_' || i)))
    into bad from generate_series(1,101) i;
  if public.life_composition_valid(bad) is not false then raise exception '101 chapters accepted'; end if;
  if public.life_composition_valid(jsonb_set(bad,'{books,0,chapters}',(bad #> '{books,0,chapters}') - 100)) is not true then raise exception '100 chapters rejected'; end if;
  passed := passed+2;
  select jsonb_set(snapshot,'{books,0,chapters,0,versionIds}',jsonb_agg('v_' || i)) into bad from generate_series(1,1001) i;
  if public.life_composition_valid(bad) is not false then raise exception '1001 chapter references accepted'; end if;
  if public.life_composition_valid(jsonb_set(bad,'{books,0,chapters,0,versionIds}',(bad #> '{books,0,chapters,0,versionIds}') - 1000)) is not true then raise exception '1000 chapter references rejected'; end if;
  passed := passed+2;
  -- The same 2 MiB compact-UTF-8 envelope includes book notes and all other data.
  select jsonb_set(snapshot,'{books,0,chapters}',jsonb_agg(chapter || jsonb_build_object('id','size_' || i,'note',repeat('가',10000))))
    into bad from generate_series(1,69) i;
  bad := jsonb_set(bad,'{books,0,question}','""');
  n := 2097152-public.life_composition_json_bytes(bad);
  if n < 0 or n > 40000 then raise exception 'invalid size fixture remainder %',n; end if;
  bad := jsonb_set(bad,'{books,0,question}',to_jsonb(repeat('x',least(n,20000))));
  bad := jsonb_set(bad,'{page,intro}',to_jsonb(repeat('x',greatest(n-20000,0))));
  if public.life_composition_json_bytes(bad) <> 2097152 or public.life_composition_valid(bad) is not true then raise exception 'book at 2 MiB rejected'; end if;
  if public.life_composition_valid(jsonb_set(bad,'{page,intro}',to_jsonb((bad #>> '{page,intro}') || 'x'))) is not false then raise exception 'book over 2 MiB accepted'; end if;
  passed := passed+2;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  perform public.life_sync_put(w,0,gen_random_uuid(),jsonb_build_object('schemaVersion',1,'workspaceId',w,'title','익명 원문'));
  result := public.life_composition_put(w,0,op,1,snapshot);
  if result <> '{"status":"stored","revision":1}'::jsonb then raise exception 'book RPC store failed'; end if;
  if public.life_composition_put(w,0,op,1,snapshot) <> result then raise exception 'book receipt retry changed'; end if;
  if public.life_composition_get(w) -> 'data' <> snapshot then raise exception 'books or missing fixed references changed on round trip'; end if;
  passed := passed+3;
  begin perform public.life_composition_put(w,1,gen_random_uuid(),1,jsonb_set(snapshot,'{books,0,fromYear}','"0000"')); raise exception 'RPC accepted invalid book';
  exception when invalid_parameter_value then passed := passed+1; end;
  if public.life_composition_get(w) -> 'revision' <> '1'::jsonb then raise exception 'rejected book changed head'; end if;
  passed := passed+1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  if public.life_composition_get(w) is not null then raise exception 'book leaked to other account'; end if;
  passed := passed+1;
  foreach statement in array array['select public.life_composition_valid(null)','select * from public.life_compositions','select * from public.life_composition_receipts'] loop
    begin execute statement; raise exception 'authenticated helper/table privilege widened';
    exception when insufficient_privilege then passed := passed+1; end;
  end loop;
  execute 'set local role anon';
  foreach statement in array array[format('select public.life_composition_get(%L)',w),'select public.life_composition_valid(null)','select * from public.life_compositions'] loop
    begin execute statement; raise exception 'anonymous privilege widened';
    exception when insufficient_privilege then passed := passed+1; end;
  end loop;
  execute 'reset role';
  raise notice 'PASS % local composition-books validation/RPC/privilege checks; transaction will roll back',passed;
end;
$test$;
rollback;
