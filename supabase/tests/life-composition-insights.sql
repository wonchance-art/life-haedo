-- LOCAL DISPOSABLE TEST DATABASE ONLY. Never run synthetic-data checks in production.
-- Requires original, composition, books and insights migrations. All rolled back.
begin;
do $test$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); w uuid := gen_random_uuid(); op uuid := gen_random_uuid();
  base jsonb; snapshot jsonb; insight jsonb; bad jsonb; value jsonb; result jsonb;
  field text; statement text; n integer; passed integer := 0;
begin
  base := jsonb_build_object('format','life-workbench-v1','workspaceId',w,'revision',0,'groups','[]'::jsonb,
    'page','{"title":"내 페이지","intro":"","showIntro":true,"showRecent":true,"entries":[]}'::jsonb,
    'reflection','{"versionIds":[],"note":""}'::jsonb,
    'books','[{"id":"book_a","title":"나를 바꾼 선택","fromYear":"","toYear":"","question":"","chapters":[{"id":"chapter_a","title":"선택의 이유","note":"","versionIds":[]}]}]'::jsonb);
  insight := '{"id":"insight_a","statement":"새로운 환경에서 관심이 넓어졌던 것 같다.🌱","uncertainty":"당시의 기록이 충분하지 않다.","supportVersionIds":["old_fixed_version","missing_support"],"counterVersionIds":["old_fixed_version","missing_counter"],"excluded":true}'::jsonb;
  snapshot := jsonb_set(base,'{books,0,chapters,0,insights}',jsonb_build_array(insight));
  if public.life_composition_valid(base - 'books') is not true then raise exception 'old v1 rejected'; end if;
  if public.life_composition_valid(base) is not true then raise exception 'books without insights rejected'; end if;
  if public.life_composition_valid(snapshot) is not true then raise exception 'insights with missing refs/cross-role reuse rejected'; end if;
  if public.life_composition_valid(jsonb_set(snapshot,'{books,0,chapters,0,insights}','[]')) is not true then raise exception 'empty insights rejected'; end if;
  passed := passed+4;
  foreach field in array array['id','statement','uncertainty','supportVersionIds','counterVersionIds','excluded'] loop
    if public.life_composition_valid(jsonb_set(snapshot,'{books,0,chapters,0,insights,0}',insight - field)) is not false
      or public.life_composition_valid(jsonb_set(snapshot,array['books','0','chapters','0','insights','0',field],'null')) is not false then raise exception 'insight missing/null key accepted: %',field; end if;
    passed := passed+2;
  end loop;
  foreach value in array array['null'::jsonb,'{}'::jsonb,'false'::jsonb,'1'::jsonb,'[null]'::jsonb,'[[]]'::jsonb,'[{}]'::jsonb] loop
    if public.life_composition_valid(jsonb_set(snapshot,'{books,0,chapters,0,insights}',value)) is not false then raise exception 'invalid insight container accepted'; end if;
    passed := passed+1;
  end loop;
  foreach bad in array array[
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,extra}','true'),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,id}','"bad id"'),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,id}','""'),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,statement}','true'),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,statement}','{}'),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,uncertainty}','3'),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,excluded}','0'),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,excluded}','"true"'),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,statement}',to_jsonb(repeat('🌱',10001))),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,uncertainty}',to_jsonb(repeat('🌱',10001)))
  ] loop
    if public.life_composition_valid(bad) is not false then raise exception 'invalid insight shape accepted'; end if;
    passed := passed+1;
  end loop;
  foreach field in array array['supportVersionIds','counterVersionIds'] loop
    foreach value in array array['{}'::jsonb,'"version"'::jsonb,'[null]'::jsonb,'[3]'::jsonb,'["bad id"]'::jsonb,'["same","same"]'::jsonb] loop
      if public.life_composition_valid(jsonb_set(snapshot,array['books','0','chapters','0','insights','0',field],value)) is not false then raise exception 'invalid insight role references accepted'; end if;
      passed := passed+1;
    end loop;
    select jsonb_set(snapshot,array['books','0','chapters','0','insights','0',field],jsonb_agg('v_' || i)) into bad from generate_series(1,101) i;
    if public.life_composition_valid(bad) is not false then raise exception '101 role references accepted'; end if;
    if public.life_composition_valid(jsonb_set(bad,array['books','0','chapters','0','insights','0',field],
      (bad #> array['books','0','chapters','0','insights','0',field]) - 100)) is not true then raise exception '100 role references rejected'; end if;
    passed := passed+2;
  end loop;
  foreach bad in array array[
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,statement}','""'),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,statement}',to_jsonb(U&'\00A0\FEFF'::text)),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,uncertainty}','""'),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,supportVersionIds}','[]'),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,counterVersionIds}','[]'),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,excluded}','false'),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,statement}',to_jsonb(repeat('🌱',10000))),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,uncertainty}',to_jsonb(repeat('🌱',10000))),
    jsonb_set(snapshot,'{books,0,chapters,0,insights}',jsonb_build_array(insight,insight || '{"id":"insight_b"}'))
  ] loop
    if public.life_composition_valid(bad) is not true then raise exception 'valid insight boundary/reference reuse rejected'; end if;
    passed := passed+1;
  end loop;
  foreach bad in array array[
    jsonb_set(snapshot,'{books,0,chapters,0,insights}',jsonb_build_array(insight,insight)),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,id}','"book_a"'),
    jsonb_set(snapshot,'{books,0,chapters,0,insights,0,id}','"chapter_a"'),
    snapshot || '{"groups":[{"id":"insight_a","title":"겹친 묶음","versionIds":[]}]}',
    jsonb_set(snapshot,'{page,entries}','[{"id":"insight_a","title":"겹친 항목","parts":[],"note":"","pinned":false,"enabled":true,"showBody":true,"showNote":true}]'),
    jsonb_set(snapshot,'{books,0,chapters}',jsonb_build_array(snapshot #> '{books,0,chapters,0}',(snapshot #> '{books,0,chapters,0}') || '{"id":"chapter_b"}')),
    jsonb_set(snapshot,'{books}',jsonb_build_array(snapshot #> '{books,0}',(base #> '{books,0}') || '{"id":"insight_a","chapters":[]}'))
  ] loop
    if public.life_composition_valid(bad) is not false then raise exception 'global insight ID collision accepted'; end if;
    passed := passed+1;
  end loop;
  select jsonb_set(snapshot,'{books,0,chapters,0,insights}',jsonb_agg(insight || jsonb_build_object('id','insight_' || i)))
    into bad from generate_series(1,101) i;
  if public.life_composition_valid(bad) is not false then raise exception '101 insights accepted'; end if;
  if public.life_composition_valid(jsonb_set(bad,'{books,0,chapters,0,insights}',(bad #> '{books,0,chapters,0,insights}') - 100)) is not true then raise exception '100 insights rejected'; end if;
  passed := passed+2;
  select jsonb_set(snapshot,'{books,0,chapters,0,insights}',jsonb_agg(insight || jsonb_build_object('id','size_' || i,'statement',repeat('가',10000),'uncertainty','')))
    into bad from generate_series(1,69) i;
  n := 2097152-public.life_composition_json_bytes(bad);
  if n < 0 or n > 40000 then raise exception 'invalid size fixture remainder %',n; end if;
  bad := jsonb_set(bad,'{books,0,chapters,0,insights,0,uncertainty}',to_jsonb(repeat('x',least(n,20000))));
  bad := jsonb_set(bad,'{page,intro}',to_jsonb(repeat('x',greatest(n-20000,0))));
  if public.life_composition_json_bytes(bad) <> 2097152 or public.life_composition_valid(bad) is not true then raise exception 'insights at 2 MiB rejected'; end if;
  if public.life_composition_valid(jsonb_set(bad,'{page,intro}',to_jsonb((bad #>> '{page,intro}') || 'x'))) is not false then raise exception 'insights over 2 MiB accepted'; end if;
  passed := passed+2;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  perform public.life_sync_put(w,0,gen_random_uuid(),jsonb_build_object('schemaVersion',1,'workspaceId',w,'title','익명 원문'));
  result := public.life_composition_put(w,0,op,1,snapshot);
  if result <> '{"status":"stored","revision":1}'::jsonb then raise exception 'insight RPC store failed'; end if;
  if public.life_composition_put(w,0,op,1,snapshot) <> result then raise exception 'insight retry receipt changed'; end if;
  if public.life_composition_get(w) -> 'data' <> snapshot then raise exception 'excluded insight or role references changed on round trip'; end if;
  passed := passed+3;
  begin perform public.life_composition_put(w,1,gen_random_uuid(),1,jsonb_set(snapshot,'{books,0,chapters,0,insights,0,excluded}','null')); raise exception 'RPC accepted invalid insight';
  exception when invalid_parameter_value then passed := passed+1; end;
  if public.life_composition_get(w) -> 'revision' <> '1'::jsonb then raise exception 'invalid insight changed head'; end if;
  passed := passed+1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  if public.life_composition_get(w) is not null then raise exception 'insight leaked to other account'; end if;
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
  raise notice 'PASS % local composition-insights validation/RPC/privilege checks; transaction will roll back',passed;
end;
$test$;
rollback;
