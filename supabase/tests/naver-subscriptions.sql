-- Synthetic RLS, lease fencing, new-item-only and rollback tests. Never user data.
begin;
do $$begin
 if current_database() !~ '^haedo_naver_' or to_regclass('public.haedo_naver_test_isolation') is null then raise exception 'Disposable Naver test bootstrap is required';end if;
end$$;
create function pg_temp.check_it(ok boolean,label text) returns text language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'FAIL %',label;end if;return 'PASS '||label;end$$;
create temp table fixture(key text primary key,value jsonb);
grant all on fixture to anon,authenticated,service_role;
select pg_temp.check_it((select not ready from haedo_naver_private.runtime),'runtime starts disabled');
select pg_temp.check_it(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'life_naver_%' and p.prosecdef),'public wrappers are invokers');
select pg_temp.check_it(not has_table_privilege('authenticated','life_naver_subscriptions','INSERT') and not has_table_privilege('authenticated','life_naver_items','UPDATE'),'clients cannot insert subscriptions or mutate collected items');
select pg_temp.check_it(not has_table_privilege('anon','life_naver_items','SELECT'),'anonymous inbox read denied');
select pg_temp.check_it(not has_function_privilege('authenticated','public.life_naver_claim(integer,uuid,uuid)','EXECUTE') and not has_function_privilege('authenticated','public.life_naver_finish(uuid,uuid,bigint,jsonb,text)','EXECUTE'),'worker APIs service only');
select pg_temp.check_it(not has_function_privilege('anon','public.life_naver_save(uuid,text,bigint,boolean)','EXECUTE') and not has_function_privilege('anon','public.life_naver_list(uuid,integer,jsonb)','EXECUTE'),'owner APIs anonymous denied');
select pg_temp.check_it((select bool_and(relrowsecurity) from pg_class where oid in ('public.life_naver_subscriptions'::regclass,'public.life_naver_items'::regclass,'haedo_naver_private.runtime'::regclass,'haedo_naver_private.receipts'::regclass)),'all four tables enable RLS');
set local role service_role;
select pg_temp.check_it(not public.life_naver_ready(),'worker readiness is explicit false');
select pg_temp.check_it(public.life_naver_claim()='[]','disabled runtime grants no leases');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);
do $$begin
 begin perform public.life_naver_save('11111111-1111-4111-8111-111111111111','alpha',0,true);raise exception 'Enable must be gated';
 exception when invalid_parameter_value then if sqlerrm<>'life_naver_setup_required' then raise;end if;end;
end$$;
select pg_temp.check_it((public.life_naver_list('11111111-1111-4111-8111-111111111111')->>'ready')::boolean=false,'owner sees setup state without false active label');
insert into fixture values('a',public.life_naver_save('11111111-1111-4111-8111-111111111111','alpha',0,false));
insert into fixture values('other_workspace',public.life_naver_save('22222222-2222-4222-8222-222222222222','alpha',0,false));
select pg_temp.check_it((select value->>'blog_id'='alpha' and value->>'enabled'='false' and not(value?'owner_id') and not(value?'lease_token') from fixture where key='a'),'save preserves chosen blog identity and conceals worker lease');
insert into fixture values('case_variant',public.life_naver_save('11111111-1111-4111-8111-111111111111','Alpha',0,false));
select pg_temp.check_it((select value->>'blog_id'='Alpha' from fixture where key='case_variant') and (select value->>'id' from fixture where key='case_variant')<>(select value->>'id' from fixture where key='a'),'unverified blog path case is preserved rather than silently merged');
do $$begin
 begin perform public.life_naver_save('11111111-1111-4111-8111-111111111111','alpha',0,false);raise exception 'Stale subscription CAS must fail';exception when sqlstate 'PT409' then null;end;
 begin perform public.life_naver_save('11111111-1111-4111-8111-111111111111','https://evil.invalid',0,false);raise exception 'Arbitrary URL must fail';exception when invalid_parameter_value then null;end;
 begin update public.life_naver_subscriptions set enabled=true;raise exception 'Client direct write must fail';exception when insufficient_privilege then null;end;
end$$;
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}',true);
insert into fixture values('b',public.life_naver_save('11111111-1111-4111-8111-111111111111','beta',0,false));
select pg_temp.check_it((select count(*)=1 from public.life_naver_subscriptions),'owner B sees only B subscription through direct RLS');
select pg_temp.check_it(jsonb_array_length(public.life_naver_list('11111111-1111-4111-8111-111111111111')->'subscriptions')=1,'owner RPC never returns A subscriptions to B');
reset role;
update haedo_naver_private.runtime set ready=true;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);
update fixture set value=public.life_naver_save('11111111-1111-4111-8111-111111111111','alpha',1,true) where key='a';
select pg_temp.check_it((select value->>'revision'='2' and value->>'enabled'='true' and value->>'ready'='true' from fixture where key='a'),'explicit ready enable advances subscription CAS');
reset role;
set local role service_role;
insert into fixture values('lease1',public.life_naver_claim(5,(select (value->>'id')::uuid from fixture where key='a'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->0);
select pg_temp.check_it((select value->>'revision'='2' and value->>'owner_id'='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and (value->>'lease_token') is not null from fixture where key='lease1'),'claim returns database-owned scoped token and revision');
select pg_temp.check_it(public.life_naver_claim(5,(select (value->>'id')::uuid from fixture where key='a'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')='[]','concurrent or repeated claim cannot own an active lease');
select pg_temp.check_it(public.life_naver_claim(5,(select (value->>'id')::uuid from fixture where key='a'),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')='[]','manual worker filter cannot claim a different owner');
do $$begin begin perform public.life_naver_claim(1,(select (value->>'id')::uuid from fixture where key='a'),null);raise exception 'Half scoped claim must fail';exception when invalid_parameter_value then null;end;end$$;
insert into fixture values('items1',jsonb_build_array(
 jsonb_build_object('log_no','101','title','첫 공개 RSS 항목','url','https://blog.naver.com/alpha/101','content_text',E'원문\r\n🌿','content_hash',encode(sha256(convert_to(E'원문\r\n🌿','UTF8')),'hex'),'published_at','2026-10-21T00:00:00Z','coverage','partial'),
 jsonb_build_object('log_no','102','title','링크만 확보','url','https://blog.naver.com/alpha/102','content_text',null,'content_hash',null,'published_at',null,'coverage','link_only')));
insert into fixture values('finish1',public.life_naver_finish((select (value->>'id')::uuid from fixture where key='a'),(select (value->>'lease_token')::uuid from fixture where key='lease1'),2,(select value from fixture where key='items1')));
select pg_temp.check_it((select value=jsonb_build_object('status','stored','inserted',2) from fixture where key='finish1'),'valid new items and receipt commit together');
select pg_temp.check_it(public.life_naver_finish((select (value->>'id')::uuid from fixture where key='a'),(select (value->>'lease_token')::uuid from fixture where key='lease1'),2,(select value from fixture where key='items1'))=(select value from fixture where key='finish1'),'lost completion acknowledgement replays exact result');
do $$begin
 begin perform public.life_naver_finish((select (value->>'id')::uuid from fixture where key='a'),(select (value->>'lease_token')::uuid from fixture where key='lease1'),2,'[]');raise exception 'Same token with another payload must fail';exception when invalid_parameter_value then if sqlerrm<>'life_naver_operation_mismatch' then raise;end if;end;
end$$;
reset role;
insert into fixture values('original_items',(select jsonb_agg(to_jsonb(i) order by id) from public.life_naver_items i));
select pg_temp.check_it((select count(*)=2 from public.life_naver_items),'retry inserts no duplicates');
select pg_temp.check_it((select content_text=E'원문\r\n🌿' and content_hash=encode(sha256(convert_to(E'원문\r\n🌿','UTF8')),'hex') and coverage='partial' from public.life_naver_items where log_no='101'),'raw plain content CRLF and emoji hash preserved');
select pg_temp.check_it((select last_error is null and last_success_at=last_checked_at and lease_token is null and next_check_at>last_checked_at+interval '59 minutes' from public.life_naver_subscriptions where id=(select (value->>'id')::uuid from fixture where key='a')),'success time, lease release and next check are atomic');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}',true);
select pg_temp.check_it((select count(*)=0 from public.life_naver_items),'owner B cannot read A inbox');
select pg_temp.check_it(public.life_naver_list('11111111-1111-4111-8111-111111111111')->'items'='[]','owner RPC hides foreign inbox');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);
insert into fixture values('page1',public.life_naver_list('11111111-1111-4111-8111-111111111111',1));
insert into fixture values('page2',public.life_naver_list('11111111-1111-4111-8111-111111111111',1,(select value->'next_cursor' from fixture where key='page1')));
select pg_temp.check_it((select value->>'has_more'='true' from fixture where key='page1') and (select value->>'has_more'='false' and value->'next_cursor'='null' from fixture where key='page2'),'pagination explicitly marks truncation and terminal cursor');
select pg_temp.check_it((select value#>>'{items,0,id}' from fixture where key='page1')<>(select value#>>'{items,0,id}' from fixture where key='page2'),'same-timestamp cursor pages never repeat an item');
select pg_temp.check_it(public.life_naver_list('22222222-2222-4222-8222-222222222222')->'items'='[]','different local workspace cannot inherit this inbox');
reset role;
update public.life_naver_subscriptions set next_check_at=clock_timestamp()-interval '1 second' where id=(select (value->>'id')::uuid from fixture where key='a');
set local role service_role;
insert into fixture values('lease2',public.life_naver_claim(1,(select (value->>'id')::uuid from fixture where key='a'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->0);
do $$begin
 begin perform public.life_naver_finish((select (value->>'id')::uuid from fixture where key='a'),(select (value->>'lease_token')::uuid from fixture where key='lease2'),2,
  jsonb_build_array(jsonb_build_object('log_no','103','title','앞의 정상 항목도 롤백','url','https://blog.naver.com/alpha/103','content_text',null,'content_hash',null,'published_at',null,'coverage','link_only'),
  jsonb_build_object('log_no','104','title','나쁜 해시','url','https://blog.naver.com/alpha/104','content_text','본문','content_hash',repeat('0',64),'published_at',null,'coverage','partial')));
  raise exception 'Bad late item must fail';exception when invalid_parameter_value then null;end;
end$$;
reset role;
select pg_temp.check_it(not exists(select 1 from public.life_naver_items where log_no in ('103','104')),'late validation error rolls back earlier item inserts');
select pg_temp.check_it((select lease_token=(select (value->>'lease_token')::uuid from fixture where key='lease2') from public.life_naver_subscriptions where id=(select (value->>'id')::uuid from fixture where key='a')),'failed finish retains lease for exact retry');
create function pg_temp.receipt_abort() returns trigger language plpgsql as $$begin raise exception using errcode='23514',message='synthetic final receipt failure';end$$;
create trigger naver_test_receipt_abort before insert on haedo_naver_private.receipts for each row execute function pg_temp.receipt_abort();
set local role service_role;
do $$begin
 begin perform public.life_naver_finish((select (value->>'id')::uuid from fixture where key='a'),(select (value->>'lease_token')::uuid from fixture where key='lease2'),2,
 jsonb_build_array(jsonb_build_object('log_no','103','title','영수증 실패면 보존하지 않음','url','https://blog.naver.com/alpha/103','content_text',null,'content_hash',null,'published_at',null,'coverage','link_only')));
 raise exception 'Final receipt failure must propagate';exception when check_violation then null;end;
end$$;
reset role;
drop trigger naver_test_receipt_abort on haedo_naver_private.receipts;
select pg_temp.check_it(not exists(select 1 from public.life_naver_items where log_no='103') and
 (select lease_token=(select (value->>'lease_token')::uuid from fixture where key='lease2') from public.life_naver_subscriptions where id=(select (value->>'id')::uuid from fixture where key='a')),
 'final receipt failure rolls back items, success stamp and lease release');
set local role service_role;
select pg_temp.check_it(public.life_naver_finish((select (value->>'id')::uuid from fixture where key='a'),(select (value->>'lease_token')::uuid from fixture where key='lease2'),2,'[]','network_error')=jsonb_build_object('status','stored','inserted',0),'collection failure is a recorded empty result');
reset role;
select pg_temp.check_it((select last_error='network_error' and last_success_at<last_checked_at and next_check_at>last_checked_at+interval '14 minutes' from public.life_naver_subscriptions where id=(select (value->>'id')::uuid from fixture where key='a')),'failure preserves previous success and applies bounded retry');
select pg_temp.check_it((select jsonb_agg(to_jsonb(i) order by id) from public.life_naver_items i)=(select value from fixture where key='original_items'),'collection failure leaves all prior immutable items unchanged');
update public.life_naver_subscriptions set next_check_at=clock_timestamp()-interval '1 second' where id=(select (value->>'id')::uuid from fixture where key='a');
set local role service_role;
insert into fixture values('lease3',public.life_naver_claim(1,(select (value->>'id')::uuid from fixture where key='a'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->0);
select pg_temp.check_it(public.life_naver_finish((select (value->>'id')::uuid from fixture where key='a'),(select (value->>'lease_token')::uuid from fixture where key='lease3'),2,
 jsonb_build_array((select value->0 from fixture where key='items1')||jsonb_build_object('title','수정돼도 원래 항목 보존')))=jsonb_build_object('status','stored','inserted',0),'a changed existing log number is ignored, never replaced');
reset role;
select pg_temp.check_it((select jsonb_agg(to_jsonb(i) order by id) from public.life_naver_items i)=(select value from fixture where key='original_items'),'new-items-only preserves original title, body, metadata and IDs');
update public.life_naver_subscriptions set next_check_at=clock_timestamp()-interval '1 second' where id=(select (value->>'id')::uuid from fixture where key='a');
set local role service_role;
insert into fixture values('lease4',public.life_naver_claim(1,(select (value->>'id')::uuid from fixture where key='a'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->0);
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);
update fixture set value=public.life_naver_save('11111111-1111-4111-8111-111111111111','alpha',2,false) where key='a';
reset role;
set local role service_role;
select pg_temp.check_it(public.life_naver_finish((select (value->>'id')::uuid from fixture where key='a'),(select (value->>'lease_token')::uuid from fixture where key='lease4'),2,'[]')->>'status'='stale','pause fences a late in-flight completion');
reset role;
set local role authenticated;
update fixture set value=public.life_naver_save('11111111-1111-4111-8111-111111111111','alpha',3,true) where key='a';
reset role;
set local role service_role;
insert into fixture values('lease5',public.life_naver_claim(1,(select (value->>'id')::uuid from fixture where key='a'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->0);
select pg_temp.check_it(public.life_naver_finish((select (value->>'id')::uuid from fixture where key='a'),(select (value->>'lease_token')::uuid from fixture where key='lease4'),2,'[]')->>'status'='stale','re-enable cannot revive an old revision or token');
reset role;
update public.life_naver_subscriptions set lease_until=clock_timestamp()-interval '1 second' where id=(select (value->>'id')::uuid from fixture where key='a');
set local role service_role;
insert into fixture values('lease6',public.life_naver_claim(1,(select (value->>'id')::uuid from fixture where key='a'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->0);
select pg_temp.check_it((select value->>'lease_token' from fixture where key='lease5')<>(select value->>'lease_token' from fixture where key='lease6'),'expired leases are reclaimed with new tokens');
select pg_temp.check_it(public.life_naver_finish((select (value->>'id')::uuid from fixture where key='a'),(select (value->>'lease_token')::uuid from fixture where key='lease5'),4,'[]')->>'status'='stale','expired worker cannot complete a reclaimed lease');
reset role;
update haedo_naver_private.runtime set ready=false;
set local role service_role;
select pg_temp.check_it(public.life_naver_finish((select (value->>'id')::uuid from fixture where key='a'),(select (value->>'lease_token')::uuid from fixture where key='lease6'),4,'[]')->>'status'='stale','runtime switch-off also fences completion');
reset role;
update haedo_naver_private.runtime set ready=true;
set local role service_role;
select pg_temp.check_it(public.life_naver_claim()='[]','scheduled collection never includes paused subscriptions');
insert into fixture values('manual_paused',public.life_naver_claim(1,(select (value->>'id')::uuid from fixture where key='case_variant'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->0);
select pg_temp.check_it((select value->>'blog_id'='Alpha' and value->>'revision'='1' from fixture where key='manual_paused'),'explicit scoped manual check can lease a paused first registration');
select pg_temp.check_it(public.life_naver_finish((select (value->>'id')::uuid from fixture where key='case_variant'),(select (value->>'lease_token')::uuid from fixture where key='manual_paused'),1,'[]')=jsonb_build_object('status','stored','inserted',0),'manual finish succeeds without enabling automatic collection');
insert into fixture values('manual_repeat',public.life_naver_claim(1,(select (value->>'id')::uuid from fixture where key='case_variant'),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->0);
select pg_temp.check_it((select value is not null from fixture where key='manual_repeat'),'explicit recheck can run before the next scheduled time');
do $$declare bad text;accepted jsonb;begin
 foreach bad in array array['0','001',repeat('9',31)] loop
  begin
   perform public.life_naver_finish((select (value->>'id')::uuid from fixture where key='case_variant'),(select (value->>'lease_token')::uuid from fixture where key='manual_repeat'),1,
    jsonb_build_array(jsonb_build_object('log_no',bad,'title','invalid identity','url','https://blog.naver.com/Alpha/'||bad,'content_text',null,'content_hash',null,'published_at',null,'coverage','link_only')));
   raise exception 'Invalid log identity must fail';exception when invalid_parameter_value then null;end;
 end loop;
 begin
  accepted:=public.life_naver_finish((select (value->>'id')::uuid from fixture where key='case_variant'),(select (value->>'lease_token')::uuid from fixture where key='manual_repeat'),1,
   jsonb_build_array(jsonb_build_object('log_no',repeat('9',30),'title','valid long identity','url','https://blog.naver.com/Alpha/'||repeat('9',30),'content_text',null,'content_hash',null,'published_at',null,'coverage','link_only')));
  if accepted<>jsonb_build_object('status','stored','inserted',1) then raise exception 'Valid 30 digit identity failed';end if;
  raise no_data_found; -- rollback this successful validation probe only
 exception when no_data_found then null;end;
end$$;
reset role;
select pg_temp.check_it((select not enabled from public.life_naver_subscriptions where id=(select (value->>'id')::uuid from fixture where key='case_variant')),'manual checking preserves the user pause');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}',true);
select public.life_naver_save('11111111-1111-4111-8111-111111111111','Alpha',1,false);
reset role;
set local role service_role;
select pg_temp.check_it(public.life_naver_finish((select (value->>'id')::uuid from fixture where key='case_variant'),(select (value->>'lease_token')::uuid from fixture where key='manual_repeat'),1,'[]')->>'status'='stale','explicit pause also fences a manual lease');
reset role;
rollback;
