-- Isolated local PostgreSQL only. Synthetic anonymous owners; everything is rolled back.
-- Monthly AI cap (20261104090000_life_ai_usage.sql): reserve -> settle/release, the $10 cap
-- counting open reservations, duplicate and busy guards, stale expiry charged at the maximum,
-- service_role-only writes, owner-only reads (RLS) and no anon access. Concurrency (two
-- sessions racing for the last budget) runs in tests/run-sql-replay-postgres.cjs.
-- Sets both JWT settings so it runs on the replay stub (tests/helpers/supabase-pg-stub.cjs).
begin;
create temporary table ai_usage_results(label text primary key);
create function pg_temp.ai_ok(ok boolean,label text) returns void language plpgsql security definer set search_path=pg_catalog as $$
begin if ok is distinct from true then raise exception 'AI usage assertion failed: %',label; end if;
 insert into pg_temp.ai_usage_results values(label); end $$;
-- Runs a statement as the CURRENT role and returns the SQLSTATE it raised ('' when none).
create function pg_temp.ai_state(stmt text) returns text language plpgsql set search_path=pg_catalog as $$
begin execute stmt; return ''; exception when others then return sqlstate; end $$;
-- Administrator reads (service_role has no table grants, only the RPCs).
create function pg_temp.ai_row(o uuid, mo date) returns haedo_ai_private.usage language sql security definer set search_path=pg_catalog as $$
 select * from haedo_ai_private.usage where owner_id=o and month=mo $$;
create function pg_temp.ai_n(stmt text) returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare n bigint; begin execute stmt into n; return n; end $$;
create function pg_temp.ai_as(role_name text, owner uuid) returns void language plpgsql set search_path=pg_catalog as $$
begin
 execute format('set local role %I', role_name);
 perform set_config('request.jwt.claims', case when owner is null then jsonb_build_object('role',role_name) else jsonb_build_object('sub',owner,'role',role_name) end::text, true);
 perform set_config('request.jwt.claim.sub', coalesce(owner::text,''), true);
 perform set_config('request.jwt.claim.role', role_name, true);
end $$;
do $tests$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid();
 r1 uuid:=gen_random_uuid(); r2 uuid:=gen_random_uuid(); r3 uuid:=gen_random_uuid(); r4 uuid:=gen_random_uuid(); r5 uuid:=gen_random_uuid();
 x jsonb; u haedo_ai_private.usage; stale uuid; m date:=date_trunc('month', clock_timestamp() at time zone 'UTC')::date; n integer;
begin
 insert into auth.users(id) values(a),(b),(c);

 -- Prices (micro-USD): Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10 per MTok, rounded up.
 perform pg_temp.ai_ok(haedo_ai_private.cost_micro_usd('claude-haiku-5-5',1000000,0)=100000 and haedo_ai_private.cost_micro_usd('claude-haiku-5-5',0,1000000)=500000,'Haiku 5.5 prices');
 perform pg_temp.ai_ok(haedo_ai_private.cost_micro_usd('claude-sonnet-5-5',1000000,0)=2000000 and haedo_ai_private.cost_micro_usd('claude-sonnet-5-5',0,1000000)=10000000,'Sonnet 5.5 prices');
 perform pg_temp.ai_ok(haedo_ai_private.cost_micro_usd('claude-haiku-5-5',1,0)=1 and haedo_ai_private.cost_micro_usd('claude-haiku-5-5',0,0)=0,'a partial micro-USD rounds up, zero stays zero');
 perform pg_temp.ai_ok(haedo_ai_private.cost_micro_usd('claude-opus-5-5',1,1) is null,'an unpriced model has no cost');
 perform pg_temp.ai_ok(haedo_ai_private.monthly_limit_micro_usd()=10000000,'the cap is $10');

 -- Privileges: only service_role reserves/settles/releases; anon has nothing.
 perform pg_temp.ai_ok(not has_function_privilege('anon','public.life_ai_reserve(uuid,uuid,text,integer,integer)','execute')
  and not has_function_privilege('anon','public.life_ai_settle(uuid,uuid,bigint,bigint)','execute')
  and not has_function_privilege('anon','public.life_ai_release(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.life_ai_usage()','execute'),'anon executes no AI usage function');
 perform pg_temp.ai_ok(not has_function_privilege('authenticated','public.life_ai_reserve(uuid,uuid,text,integer,integer)','execute')
  and not has_function_privilege('authenticated','public.life_ai_settle(uuid,uuid,bigint,bigint)','execute')
  and not has_function_privilege('authenticated','public.life_ai_release(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','haedo_ai_private.reserve(uuid,uuid,text,integer,integer)','execute')
  and not has_function_privilege('authenticated','haedo_ai_private.expire_stale(uuid)','execute'),'a signed-in user cannot reserve, settle or release');
 perform pg_temp.ai_ok(has_function_privilege('service_role','public.life_ai_reserve(uuid,uuid,text,integer,integer)','execute')
  and has_function_privilege('service_role','public.life_ai_settle(uuid,uuid,bigint,bigint)','execute')
  and has_function_privilege('service_role','public.life_ai_release(uuid,uuid)','execute')
  and has_function_privilege('authenticated','public.life_ai_usage()','execute'),'service_role writes and the owner reads');
 perform pg_temp.ai_ok((select bool_and(prosecdef and proconfig @> array['search_path=pg_catalog']) from pg_proc
  where pronamespace='haedo_ai_private'::regnamespace and proname in ('reserve','settle','release','expire_stale')),'writers are security definer with a fixed search_path');
 perform pg_temp.ai_ok((select relrowsecurity from pg_class where oid='haedo_ai_private.usage'::regclass)
  and (select relrowsecurity from pg_class where oid='haedo_ai_private.reservations'::regclass),'RLS is on for both tables');

 -- Reserve -> settle.
 perform pg_temp.ai_as('service_role',null);
 x:=public.life_ai_reserve(a,r1,'claude-haiku-5-5',1000,1000);
 perform pg_temp.ai_ok(x->>'status'='reserved' and (x->>'reserved_micro_usd')::bigint=600 and (x->>'remaining_micro_usd')::bigint=10000000-600 and (x->>'month')::date=m,'a reservation holds the worst-case cost of the request');
 u:=pg_temp.ai_row(a,m);
 perform pg_temp.ai_ok(u.reserved_micro_usd=600 and u.cost_micro_usd=0 and u.requests=0,'the open reservation is counted before the call');
 perform pg_temp.ai_ok(public.life_ai_reserve(a,r1,'claude-haiku-5-5',1000,1000)->>'status'='duplicate','the same request ID cannot be reserved twice');
 x:=public.life_ai_settle(a,r1,500,200);
 perform pg_temp.ai_ok(x->>'status'='settled' and (x->>'cost_micro_usd')::bigint=150 and (x->>'remaining_micro_usd')::bigint=10000000-150,'settling records the real cost');
 u:=pg_temp.ai_row(a,m);
 perform pg_temp.ai_ok(u.reserved_micro_usd=0 and u.cost_micro_usd=150 and u.input_tokens=500 and u.output_tokens=200 and u.requests=1,'the reservation is replaced by the real usage');
 perform pg_temp.ai_ok(public.life_ai_settle(a,r1,999999,999999)->>'status'='already_finished','a second settle changes nothing');
 perform pg_temp.ai_ok(public.life_ai_release(a,r1)->>'status'='already_finished','a settled request cannot be released');
 u:=pg_temp.ai_row(a,m);
 perform pg_temp.ai_ok(u.cost_micro_usd=150 and u.requests=1,'totals are unchanged after the repeated calls');

 -- Reserve -> release (provider refused the request: not billed).
 x:=public.life_ai_reserve(a,r2,'claude-sonnet-5-5',3000,6000);
 perform pg_temp.ai_ok(x->>'status'='reserved' and (x->>'reserved_micro_usd')::bigint=66000,'a Sonnet reservation uses Sonnet prices');
 perform pg_temp.ai_ok(public.life_ai_release(a,r2)->>'status'='released','a reservation can be returned');
 u:=pg_temp.ai_row(a,m);
 perform pg_temp.ai_ok(u.reserved_micro_usd=0 and u.cost_micro_usd=150 and u.requests=1,'a returned reservation costs nothing');
 perform pg_temp.ai_ok(public.life_ai_settle(a,r2,10,10)->>'status'='already_finished','a released request cannot be settled later');

 -- The cap counts settled cost plus open reservations; the boundary is inclusive.
 execute 'reset role';
 update haedo_ai_private.usage set cost_micro_usd=10000000-1200 where owner_id=a and month=m;
 perform pg_temp.ai_as('service_role',null);
 x:=public.life_ai_reserve(a,r3,'claude-sonnet-5-5',100,101);
 perform pg_temp.ai_ok(x->>'status'='limit' and (x->>'used_micro_usd')::bigint=10000000-1200 and (x->>'limit_micro_usd')::bigint=10000000,'a request whose maximum would pass the cap is refused before any call');
 perform pg_temp.ai_ok(pg_temp.ai_n(format('select count(*) from haedo_ai_private.reservations where owner_id=%L and request_id=%L',a,r3))=0,'a refused request leaves no reservation');
 x:=public.life_ai_reserve(a,r3,'claude-sonnet-5-5',100,100);
 perform pg_temp.ai_ok(x->>'status'='reserved' and (x->>'remaining_micro_usd')::bigint=0,'a request that reaches the cap exactly is allowed');
 perform pg_temp.ai_ok(public.life_ai_reserve(a,r4,'claude-haiku-5-5',1,1)->>'status'='limit','an open reservation blocks the next request at the cap');
 perform public.life_ai_settle(a,r3,10,10);
 perform pg_temp.ai_ok(public.life_ai_reserve(a,r4,'claude-haiku-5-5',1,1)->>'status'='reserved','settling for less than the maximum frees the difference');
 perform public.life_ai_release(a,r4);

 -- Busy: at most four open reservations per owner.
 for n in 1..4 loop perform pg_temp.ai_ok(public.life_ai_reserve(b,gen_random_uuid(),'claude-haiku-5-5',10,10)->>'status'='reserved','open reservation '||n); end loop;
 perform pg_temp.ai_ok(public.life_ai_reserve(b,r5,'claude-haiku-5-5',10,10)->>'status'='busy','a fifth concurrent request is refused');
 perform pg_temp.ai_ok(public.life_ai_reserve(c,r5,'claude-haiku-5-5',10,10)->>'status'='reserved','another owner is not affected and request IDs are per owner');

 -- Stale reservations (never settled) expire and are charged at their maximum.
 execute 'reset role';
 update haedo_ai_private.reservations set created_at=clock_timestamp()-interval '11 minutes' where owner_id=b;
 perform pg_temp.ai_as('service_role',null);
 x:=public.life_ai_reserve(b,r5,'claude-haiku-5-5',10,10);
 perform pg_temp.ai_ok(x->>'status'='reserved','expired reservations no longer count as open');
 u:=pg_temp.ai_row(b,m);
 perform pg_temp.ai_ok(u.cost_micro_usd=4*6 and u.reserved_micro_usd=6 and u.requests=4,'expired reservations are charged at their reserved maximum');
 perform pg_temp.ai_ok(pg_temp.ai_n(format('select count(*) from haedo_ai_private.reservations where owner_id=%L and status=''expired''',b))=4,'expired reservations are marked expired');
 execute 'reset role';
 select request_id into stale from haedo_ai_private.reservations where owner_id=b and status='expired' limit 1;
 perform pg_temp.ai_as('service_role',null);
 perform pg_temp.ai_ok(public.life_ai_settle(b,stale,1,1)->>'state'='expired','a late settle of an expired request changes nothing');
 u:=pg_temp.ai_row(b,m);
 perform pg_temp.ai_ok(u.cost_micro_usd=24,'the expired charge is not changed by the late settle');

 -- Invalid input raises.
 perform pg_temp.ai_ok(pg_temp.ai_state(format('select public.life_ai_reserve(%L,%L,%L,10,10)',a,gen_random_uuid(),'claude-opus-5-5'))='22023','an unpriced model is rejected');
 perform pg_temp.ai_ok(pg_temp.ai_state(format('select public.life_ai_reserve(%L,%L,%L,0,10)',a,gen_random_uuid(),'claude-haiku-5-5'))='22023','zero input tokens are rejected');
 perform pg_temp.ai_ok(pg_temp.ai_state(format('select public.life_ai_reserve(%L,%L,%L,100001,10)',a,gen_random_uuid(),'claude-haiku-5-5'))='22023','input above the Haiku 100K price tier is rejected');
 perform pg_temp.ai_ok(pg_temp.ai_state(format('select public.life_ai_reserve(%L,%L,%L,10,16001)',a,gen_random_uuid(),'claude-haiku-5-5'))='22023','output above 16,000 tokens is rejected');
 perform pg_temp.ai_ok(pg_temp.ai_state(format('select public.life_ai_reserve(%L,%L,%L,10,10)',stranger,gen_random_uuid(),'claude-haiku-5-5'))='22023','an unknown owner is rejected');
 perform pg_temp.ai_ok(pg_temp.ai_state(format('select public.life_ai_settle(%L,%L,1,1)',a,gen_random_uuid()))='22023','settling an unknown request is rejected');
 perform pg_temp.ai_ok(pg_temp.ai_state(format('select public.life_ai_settle(%L,%L,-1,1)',a,r1))='22023','negative usage is rejected');
 perform pg_temp.ai_ok(pg_temp.ai_state(format('select public.life_ai_release(%L,%L)',b,gen_random_uuid()))='22023','releasing an unknown request is rejected');

 -- A signed-in user: reads only their own row, writes nothing.
 perform pg_temp.ai_as('authenticated',a);
 perform pg_temp.ai_ok(pg_temp.ai_state(format('select public.life_ai_reserve(%L,%L,%L,10,10)',a,gen_random_uuid(),'claude-haiku-5-5'))='42501','the owner cannot reserve directly');
 perform pg_temp.ai_ok(pg_temp.ai_state(format('select public.life_ai_settle(%L,%L,0,0)',a,r4))='42501','the owner cannot settle directly');
 perform pg_temp.ai_ok(pg_temp.ai_state(format('select public.life_ai_release(%L,%L)',a,r4))='42501','the owner cannot release directly');
 perform pg_temp.ai_ok(pg_temp.ai_state(format('select haedo_ai_private.settle(%L,%L,0,0)',a,r4))='42501','the owner cannot call the private writer');
 perform pg_temp.ai_ok(pg_temp.ai_state(format('update haedo_ai_private.usage set cost_micro_usd=0 where owner_id=%L',a))='42501','the owner cannot lower their total');
 perform pg_temp.ai_ok(pg_temp.ai_state(format('insert into haedo_ai_private.usage(owner_id,month) values(%L,%L)',a,(m - interval '1 month')::date))='42501','the owner cannot insert a usage row');
 perform pg_temp.ai_ok(pg_temp.ai_state(format('delete from haedo_ai_private.usage where owner_id=%L',a))='42501','the owner cannot delete a usage row');
 perform pg_temp.ai_ok(pg_temp.ai_state('select count(*) from haedo_ai_private.reservations')='42501','reservations are not readable');
 perform pg_temp.ai_ok((select count(*) from haedo_ai_private.usage)=1 and (select owner_id from haedo_ai_private.usage)=a,'RLS shows only the owner''s own row');
 x:=public.life_ai_usage();
 perform pg_temp.ai_ok((x->>'cost_micro_usd')::bigint=10000000-1200+120
  and (x->>'reserved_micro_usd')::bigint=0 and (x->>'limit_micro_usd')::bigint=10000000 and (x->>'month')::date=m,'life_ai_usage returns the owner''s current month');
 perform pg_temp.ai_as('authenticated',b);
 x:=public.life_ai_usage();
 perform pg_temp.ai_ok((x->>'cost_micro_usd')::bigint=24 and (x->>'requests')::int=4,'another owner sees only their own totals');
 perform pg_temp.ai_as('authenticated',stranger);
 x:=public.life_ai_usage();
 perform pg_temp.ai_ok((x->>'cost_micro_usd')::bigint=0 and (x->>'requests')::int=0,'an owner without usage sees zeros');

 -- anon: nothing.
 perform pg_temp.ai_as('anon',null);
 perform pg_temp.ai_ok(pg_temp.ai_state('select public.life_ai_usage()')='42501','anon cannot read usage');
 perform pg_temp.ai_ok(pg_temp.ai_state('select count(*) from haedo_ai_private.usage')='42501','anon cannot read the usage table');
 perform pg_temp.ai_ok(pg_temp.ai_state(format('select public.life_ai_reserve(%L,%L,%L,10,10)',a,gen_random_uuid(),'claude-haiku-5-5'))='42501','anon cannot reserve');
 execute 'reset role';
end $tests$;
select jsonb_build_object('passed',count(*),'failures',0,'scope','isolated PostgreSQL: AI monthly cap reserve/settle/release, privileges and RLS') as result from ai_usage_results;
rollback;
