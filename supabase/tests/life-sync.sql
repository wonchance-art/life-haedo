-- Execute against Supabase with a database administrator connection.
-- Synthetic JWT claims exercise real roles/RLS/RPC, not an OAuth login.
-- Every synthetic snapshot and receipt is rolled back.
begin;
do $test$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  w uuid := gen_random_uuid(); op uuid := gen_random_uuid();
  snapshot jsonb; result jsonb; n integer; passed integer := 0;
begin
  snapshot := jsonb_build_object('schemaVersion',1,'workspaceId',w::text,
    'title','Anonymous integration check','sourceVersions','[]'::jsonb);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  result := public.life_sync_put(w,0,op,snapshot);
  if result <> '{"status":"stored","revision":1}'::jsonb then raise exception 'create failed'; end if;
  passed := passed + 1;
  if public.life_sync_put(w,0,op,snapshot) <> result then raise exception 'retry failed'; end if;
  passed := passed + 1;
  select count(*) into n from public.life_workspaces where id=w;
  if n <> 1 then raise exception 'owner read failed'; end if;
  passed := passed + 1;
  begin
    insert into public.life_workspaces(owner_id,id,title,revision,data) values(a,w,'blocked',1,snapshot);
    raise exception 'direct insert allowed';
  exception when insufficient_privilege then passed := passed + 1; end;
  begin
    update public.life_workspaces set revision=5 where id=w;
    raise exception 'direct update allowed';
  exception when insufficient_privilege then passed := passed + 1; end;
  begin
    delete from public.life_workspaces where id=w;
    raise exception 'direct delete allowed';
  exception when insufficient_privilege then passed := passed + 1; end;
  begin
    perform 1 from public.life_sync_receipts;
    raise exception 'receipts exposed';
  exception when insufficient_privilege then passed := passed + 1; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  select count(*) into n from public.life_workspaces where id=w;
  if n <> 0 then raise exception 'other owner can read'; end if;
  passed := passed + 1;
  if public.life_sync_put(w,1,gen_random_uuid(),snapshot) <> '{"status":"missing"}'::jsonb then raise exception 'other owner revision leak'; end if;
  passed := passed + 1;
  if public.life_sync_put(w,0,op,snapshot) <> result then raise exception 'owner namespace collision'; end if;
  passed := passed + 1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  begin
    perform public.life_sync_put(w,0,op,snapshot || '{"title":"changed"}'::jsonb);
    raise exception 'operation identity ignored';
  exception when invalid_parameter_value then passed := passed + 1; end;
  if public.life_sync_put(w,0,gen_random_uuid(),snapshot) <> '{"status":"conflict","revision":1}'::jsonb then raise exception 'stale create overwrote'; end if;
  passed := passed + 1;
  if public.life_sync_put(w,1,gen_random_uuid(),snapshot) <> '{"status":"stored","revision":2}'::jsonb then raise exception 'update failed'; end if;
  passed := passed + 1;
  if public.life_sync_put(w,1,gen_random_uuid(),snapshot) <> '{"status":"conflict","revision":2}'::jsonb then raise exception 'stale update overwrote'; end if;
  passed := passed + 1;
  begin
    perform public.life_sync_put(w,2,gen_random_uuid(),snapshot || '{"schemaVersion":"1"}'::jsonb);
    raise exception 'invalid snapshot accepted';
  exception when invalid_parameter_value then passed := passed + 1; end;
  begin
    perform public.life_sync_put(w,2,gen_random_uuid(),snapshot || jsonb_build_object('extra',repeat('x',16777216)));
    raise exception 'oversize snapshot accepted';
  exception when string_data_right_truncation then passed := passed + 1; end;
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  begin
    perform public.life_sync_put(w,0,gen_random_uuid(),snapshot);
    raise exception 'unauthenticated RPC allowed';
  exception when insufficient_privilege then passed := passed + 1; end;
  execute 'set local role anon';
  begin
    perform 1 from public.life_workspaces;
    raise exception 'anonymous read allowed';
  exception when insufficient_privilege then passed := passed + 1; end;
  begin
    perform public.life_sync_put(w,0,gen_random_uuid(),snapshot);
    raise exception 'anonymous RPC allowed';
  exception when insufficient_privilege then passed := passed + 1; end;
  execute 'reset role';
  perform set_config('haedo.test.passed',passed::text,true);
end;
$test$;
select current_setting('haedo.test.passed')::integer as passed,
  'real database roles, RLS and RPC; synthetic claims; all changes rolled back' as scope;
rollback;
