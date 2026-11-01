-- Preparation deletions reach every signed-in device. A deleted head stays as a tombstone (revision kept, data retained server-side for the immutable-version checks) and is no longer listed; get returns {id,revision,deleted,updated_at}. A later put with the tombstone revision revives it, so a device with unsent edits recreates instead of dropping.
begin;
alter table haedo_material_private.heads add column if not exists deleted_at timestamptz;

-- Any revision advance that does not itself mark a deletion revives the head.
create or replace function haedo_material_private.revive() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if old.deleted_at is not null and new.deleted_at is not distinct from old.deleted_at and new.revision>old.revision then new.deleted_at:=null; end if;
 return new;
end $$;
drop trigger if exists material_heads_revive on haedo_material_private.heads;
create trigger material_heads_revive before update on haedo_material_private.heads for each row execute function haedo_material_private.revive();

create or replace function haedo_material_private.get(p_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner uuid:=auth.uid(); result jsonb;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
 if owner is null then raise exception using errcode='42501',message='life_material_auth_required'; end if;
 if p_id is null then raise exception using errcode='22023',message='life_material_invalid_request'; end if;
 select case when deleted_at is null then jsonb_build_object('id',id,'revision',revision,'data',data,'updated_at',updated_at)
  else jsonb_build_object('id',id,'revision',revision,'deleted',true,'updated_at',updated_at) end
  into result from haedo_material_private.heads where owner_id=owner and id=p_id;
 return result;
end $$;

create or replace function haedo_material_private.list(p_after_updated_at timestamptz default null,p_after_id uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner uuid:=auth.uid(); items jsonb; next_cursor jsonb; extra boolean;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
 if owner is null then raise exception using errcode='42501',message='life_material_auth_required'; end if;
 if (p_after_updated_at is null)<>(p_after_id is null) or p_after_updated_at is not null and not isfinite(p_after_updated_at) then raise exception using errcode='22023',message='life_material_invalid_request'; end if;
 with rows as (select id,revision,data#>>'{plan,title}' title,updated_at from haedo_material_private.heads
  where owner_id=owner and deleted_at is null and (p_after_updated_at is null or (updated_at,id)<(p_after_updated_at,p_after_id)) order by updated_at desc,id desc limit 21),
 numbered as(select *,row_number() over(order by updated_at desc,id desc) n from rows)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'title',title,'updated_at',updated_at) order by updated_at desc,id desc) filter(where n<=20),'[]'::jsonb),bool_or(n=21) into items,extra from numbered;
 if coalesce(extra,false) then next_cursor:=jsonb_build_object('updated_at',items#>>'{19,updated_at}','id',items#>>'{19,id}'); else next_cursor:=null; end if;
 return jsonb_build_object('items',items,'next',next_cursor);
end $$;

-- Compare-and-delete with the same operation receipts as put. 'missing' when no live head exists.
create or replace function haedo_material_private.remove(p_id uuid,p_operation_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner uuid:=auth.uid(); digest bytea; receipt haedo_material_private.receipts%rowtype; head haedo_material_private.heads%rowtype; result jsonb;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
 if owner is null then raise exception using errcode='42501',message='life_material_auth_required'; end if;
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<1 or p_expected_revision>=9007199254740991 then raise exception using errcode='22023',message='life_material_invalid_request'; end if;
 digest:=sha256(convert_to(jsonb_build_array('delete',p_expected_revision)::text,'UTF8'));
 perform pg_advisory_xact_lock(hashtextextended('haedo-material:'||owner::text||':'||p_id::text,0));
 select * into head from haedo_material_private.heads where owner_id=owner and id=p_id for update;
 select * into receipt from haedo_material_private.receipts where owner_id=owner and id=p_id and operation_id=p_operation_id;
 if found then
  if receipt.request_hash<>digest then raise exception using errcode='22023',message='life_material_operation_mismatch'; end if;
  return receipt.result;
 end if;
 if head.id is null or head.deleted_at is not null then return jsonb_build_object('status','missing','revision',coalesce(head.revision,0)); end if;
 if head.revision<>p_expected_revision then return jsonb_build_object('status','conflict','revision',head.revision); end if;
 result:=jsonb_build_object('status','deleted','revision',p_expected_revision+1);
 update haedo_material_private.heads set revision=p_expected_revision+1,deleted_at=clock_timestamp(),updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond')
  where owner_id=owner and id=p_id;
 insert into haedo_material_private.receipts values(owner,p_id,p_operation_id,digest,result);
 return result;
end $$;

create or replace function public.life_material_delete(p_id uuid,p_operation_id uuid,p_expected_revision bigint) returns jsonb language sql security invoker set search_path=pg_catalog as $$select haedo_material_private.remove(p_id,p_operation_id,p_expected_revision)$$;
revoke all on function haedo_material_private.revive(),haedo_material_private.remove(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.life_material_delete(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.life_material_delete(uuid,uuid,bigint) to authenticated;
grant execute on function haedo_material_private.remove(uuid,uuid,bigint),haedo_material_private.get(uuid),haedo_material_private.list(timestamptz,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
