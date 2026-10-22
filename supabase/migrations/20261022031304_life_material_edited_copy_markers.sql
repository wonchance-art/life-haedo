-- Additive exact-version edited-copy markers. No table, RLS or existing RPC-shape changes.
begin;
create or replace function haedo_material_private.valid(j jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare b jsonb; p jsonb; o jsonb; v jsonb; s jsonb; m jsonb; q jsonb; r jsonb; line text; val text; key text;
 seen text[]; needed text[]:='{}'; source_needed text[]:='{}'; blocks_seen text[]; materials jsonb:='{}';
 refs jsonb:='[]'; quotes integer:=0; chars bigint:=0; ops bigint:=0; marker_versions text[]:='{}';
begin
 if not haedo_blog_private.keys(j,array['format','bundle','plan','output'],array['format','bundle','plan','output']) or j->>'format' is distinct from 'life-material-continuity-v1' then return false; end if;
 b:=j->'bundle'; p:=j->'plan'; o:=j->'output';
 if not haedo_blog_private.keys(b,array['schemaVersion','workspaceId','title','revision','createdAt','updatedAt','sources','sourceVersions','records','links','resumeHints','tombstones'],array['schemaVersion','workspaceId','title','revision','createdAt','updatedAt','sources','sourceVersions','records','links','resumeHints','tombstones'])
  or b->'schemaVersion' is distinct from '1'::jsonb or not haedo_material_private.ident(b->'workspaceId')
  or not haedo_material_private.str(b->'title',500,true) or not haedo_blog_private.intval(b->'revision',0,9007199254740991)
  or not haedo_material_private.date_ok(b->'createdAt') or not haedo_material_private.date_ok(b->'updatedAt')
  or jsonb_typeof(b->'sources') is distinct from 'array' or jsonb_typeof(b->'sourceVersions') is distinct from 'array'
  or jsonb_array_length(b->'sources')>80 or jsonb_array_length(b->'sourceVersions')>80 then return false; end if;
 foreach key in array array['records','resumeHints','tombstones'] loop if b->key is distinct from '[]'::jsonb then return false; end if; end loop;
 seen:=array[b->>'workspaceId'];
 for s in select value from jsonb_array_elements(b->'sources') loop
  if not haedo_blog_private.keys(s,array['id','origin','title','url','sourceKey','revision','createdAt','updatedAt'],array['id','origin','title','revision','createdAt','updatedAt'])
   or not haedo_material_private.ident(s->'id') or s->>'id'=any(seen) or not haedo_material_private.str(s->'title',500,true)
   or not coalesce(s->>'origin'=any(array['apple_notes','obsidian','naver_blog','instagram','other']),false)
   or not haedo_blog_private.intval(s->'revision',1,9007199254740991) or not haedo_material_private.date_ok(s->'createdAt') or not haedo_material_private.date_ok(s->'updatedAt')
   or (s?'url' and not haedo_material_private.url_ok(s->'url')) or (s?'sourceKey' and not haedo_material_private.str(s->'sourceKey',2000,true)) then return false; end if;
  seen:=array_append(seen,s->>'id');
 end loop;
 for v in select value from jsonb_array_elements(b->'sourceVersions') loop
  if not haedo_blog_private.keys(v,array['id','sourceId','format','contentText','contentHash','coverage','originalAuthor','originalCreatedAt','importedAt','revision'],array['id','sourceId','format','contentText','contentHash','coverage','originalAuthor','originalCreatedAt','importedAt','revision'])
   or not haedo_material_private.ident(v->'id') or v->>'id'=any(seen) or not haedo_material_private.ident(v->'sourceId')
   or not coalesce(v->>'format'=any(array['text/plain','text/markdown']),false) or not haedo_blog_private.intval(v->'revision',1,9007199254740991)
   or not haedo_material_private.date_ok(v->'importedAt')
   or not haedo_blog_private.keys(v->'coverage',array['status','omissions'],array['status','omissions'])
   or not coalesce(v#>>'{coverage,status}'=any(array['full_text','partial','link_only','unknown']),false)
   or jsonb_typeof(v#>'{coverage,omissions}') is distinct from 'array' or jsonb_array_length(v#>'{coverage,omissions}')>100
   or not haedo_blog_private.keys(v->'originalAuthor',array['label','relation'],array['label','relation'])
   or not haedo_material_private.str(v#>'{originalAuthor,label}',500)
   or not coalesce(v#>>'{originalAuthor,relation}'=any(array['self','other','unknown']),false)
   or (v->'originalCreatedAt'<>'null'::jsonb and not haedo_material_private.str(v->'originalCreatedAt',200)) then return false; end if;
  select value into s from jsonb_array_elements(b->'sources') where value->'id'=v->'sourceId'; if s is null then return false; end if;
  for q in select value from jsonb_array_elements(v#>'{coverage,omissions}') loop if not haedo_material_private.str(q,500) then return false; end if; end loop;
  if v->'contentText'='null'::jsonb then
   if v->'contentHash'<>'null'::jsonb or v#>>'{coverage,status}'<>'link_only' or not(s?'url') then return false; end if;
  elsif jsonb_typeof(v->'contentText')<>'string' or length(v->>'contentText')=0 or octet_length(v->>'contentText')>1048576
   or haedo_blog_private.utf16(v->>'contentText')>1048576 or v#>>'{coverage,status}'='link_only'
   or jsonb_typeof(v->'contentHash') is distinct from 'string' or v->>'contentHash'<>encode(sha256(convert_to(v->>'contentText','UTF8')),'hex') then return false; end if;
  seen:=array_append(seen,v->>'id');
 end loop;
 -- Only the immutable edited-version marker travels with an exact selected
 -- version. Base-history edges, lifecycle state and unrelated links stay local.
 if jsonb_typeof(b->'links') is distinct from 'array' or jsonb_array_length(b->'links')>80 then return false; end if;
 for r in select value from jsonb_array_elements(b->'links') loop
  if not haedo_blog_private.keys(r,array['id','kind','entityRefs','revision','createdAt','updatedAt'],array['id','kind','entityRefs','revision','createdAt','updatedAt'])
   or not haedo_material_private.ident(r->'id') or r->>'id'=any(seen) or r->>'kind' is distinct from 'source_edited_copy'
   or r->'revision' is distinct from '1'::jsonb or not haedo_material_private.date_ok(r->'createdAt') or r->'updatedAt' is distinct from r->'createdAt'
   or jsonb_typeof(r->'entityRefs') is distinct from 'array' or jsonb_array_length(r->'entityRefs')<>1
   or not haedo_blog_private.keys(r#>'{entityRefs,0}',array['entityType','entityId'],array['entityType','entityId'])
   or r#>>'{entityRefs,0,entityType}' is distinct from 'sourceVersion' or not haedo_material_private.ident(r#>'{entityRefs,0,entityId}') then return false; end if;
  val:=r#>>'{entityRefs,0,entityId}';
  if val=any(marker_versions) or not exists(select 1 from jsonb_array_elements(b->'sourceVersions') entry where entry->>'id'=val) then return false; end if;
  marker_versions:=array_append(marker_versions,val); seen:=array_append(seen,r->>'id');
 end loop;
 if not haedo_blog_private.keys(p,array['id','title','question','createdAt','updatedAt','materials','blocks','output'],array['id','title','question','createdAt','updatedAt','materials','blocks','output'])
  or not haedo_material_private.ident(p->'id') or p->'id'=b->'workspaceId' or p->'output'<>'null'::jsonb
  or not haedo_blog_private.txt(p->'title',500) or not haedo_blog_private.txt(p->'question',50000)
  or not haedo_material_private.date_ok(p->'createdAt',true) or not haedo_material_private.date_ok(p->'updatedAt',true) or p->>'updatedAt'<p->>'createdAt'
  or jsonb_typeof(p->'materials') is distinct from 'array' or jsonb_array_length(p->'materials')>16
  or jsonb_typeof(p->'blocks') is distinct from 'array' or jsonb_array_length(p->'blocks')>128 then return false; end if;
 blocks_seen:=array[b->>'workspaceId',p->>'id'];
 for m in select value from jsonb_array_elements(p->'materials') loop
  if not haedo_blog_private.keys(m,array['id','sourceId','sourceVersionId','contentHash','note'],array['id','sourceId','sourceVersionId','contentHash','note'])
   or not haedo_material_private.ident(m->'id') or m->>'id'=any(blocks_seen) or not haedo_material_private.ident(m->'sourceId') or not haedo_material_private.ident(m->'sourceVersionId')
   or not haedo_blog_private.txt(m->'note',50000) then return false; end if;
  select value into v from jsonb_array_elements(b->'sourceVersions') where value->'id'=m->'sourceVersionId';
  if v is null or v->'sourceId'<>m->'sourceId' or v->'contentHash' is distinct from m->'contentHash' then return false; end if;
  blocks_seen:=array_append(blocks_seen,m->>'id'); materials:=materials||jsonb_build_object(m->>'id',m);
  needed:=array_append(needed,m->>'sourceVersionId'); source_needed:=array_append(source_needed,m->>'sourceId');
 end loop;
 for q in select value from jsonb_array_elements(p->'blocks') loop
  if not haedo_material_private.ident(q->'id') or q->>'id'=any(blocks_seen) then return false; end if;
  blocks_seen:=array_append(blocks_seen,q->>'id');
  if q->>'kind'='quote' then
   if not haedo_blog_private.keys(q,array['id','kind','materialId','reference'],array['id','kind','materialId','reference']) or not haedo_material_private.ident(q->'materialId') then return false; end if;
   m:=materials->(q->>'materialId'); r:=q->'reference'; quotes:=quotes+1;
   if m is null or quotes>64 or not haedo_material_private.valid_ref(r,b) or m->'sourceId'<>r->'sourceId' or m->'sourceVersionId'<>r->'sourceVersionId' or m->'contentHash' is distinct from r->'contentHash' then return false; end if;
   val:=replace(replace(r->>'quote',E'\r\n',E'\n'),E'\r',E'\n'); chars:=chars+haedo_blog_private.utf16(val)+1+haedo_blog_private.utf16('출처: '||(r->>'title')||E'\n'); ops:=ops+1;
   for line in select regexp_split_to_table(val,E'\n') loop ops:=ops+case when line='' then 1 else 2 end; end loop;
   if r->>'url'<>'' then chars:=chars+haedo_blog_private.utf16(r->>'url')+1; ops:=ops+2; end if;
  elsif q->>'kind'=any(array['heading','paragraph']) then
   if not haedo_blog_private.keys(q,array['id','kind','text'],array['id','kind','text']) or not haedo_blog_private.txt(q->'text',50000) then return false; end if;
   val:=replace(replace(q->>'text',E'\r\n',E'\n'),E'\r',E'\n'); chars:=chars+haedo_blog_private.utf16(val)+case when right(val,1)=E'\n' then 0 else 1 end;
   if q->>'kind'='paragraph' then ops:=ops+1;
   else
    if right(val,1)=E'\n' then val:=left(val,length(val)-1); end if;
    for line in select regexp_split_to_table(val,E'\n') loop ops:=ops+case when line='' then 1 else 2 end; end loop;
   end if;
  else return false;
  end if;
 end loop;
 if chars>50000 or ops>5000 then return false; end if;
 if o<>'null'::jsonb then
  if not haedo_blog_private.keys(o,case when o->>'state'='saved' then array['state','postId','claimId','revision','refs'] else array['state','postId','claimId'] end,
    case when o->>'state'='saved' then array['state','postId','claimId','revision','refs'] else array['state','postId','claimId'] end)
   or not coalesce(o->>'state'=any(array['writing','saved']),false)
   or jsonb_typeof(o->'postId') is distinct from 'string' or o->>'postId' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or jsonb_typeof(o->'claimId') is distinct from 'string' or o->>'claimId' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return false; end if;
  if o->>'state'='saved' then
   if not haedo_blog_private.intval(o->'revision',1,9007199254740991) or jsonb_typeof(o->'refs') is distinct from 'array' or jsonb_array_length(o->'refs')>64 then return false; end if;
   for r in select value from jsonb_array_elements(o->'refs') loop
    if not haedo_material_private.valid_ref(r,b) then return false; end if;
    needed:=array_append(needed,r->>'sourceVersionId'); source_needed:=array_append(source_needed,r->>'sourceId');
   end loop;
  end if;
 end if;
 if exists(select 1 from jsonb_array_elements(b->'sourceVersions') entry where not(entry->>'id'=any(needed)))
  or exists(select 1 from jsonb_array_elements(b->'sources') entry where not(entry->>'id'=any(source_needed))) then return false; end if;
 return true;
exception when others then return false;
end $$;

create or replace function haedo_material_private.put(p_id uuid,p_operation_id uuid,p_expected_revision bigint,p_data jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner uuid:=auth.uid(); digest bytea; receipt haedo_material_private.receipts%rowtype; head haedo_material_private.heads%rowtype;
 old_output jsonb; new_output jsonb; result jsonb; item jsonb; identity jsonb; version_digest jsonb; version_hashes jsonb; source_identities jsonb; actual_post_revision bigint; marker jsonb; marker_key text; marker_digest jsonb;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store, max-age=0"}]',true);
 if owner is null then raise exception using errcode='42501',message='life_material_auth_required'; end if;
 if p_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 then raise exception using errcode='22023',message='life_material_invalid_request'; end if;
 if p_data is null then raise exception using errcode='22023',message='life_material_invalid_remote_data'; end if;
 if octet_length(p_data::text)>16777216 then raise exception using errcode='22001',message='life_material_payload_too_large'; end if;
 if not haedo_material_private.valid(p_data) then raise exception using errcode='22023',message='life_material_invalid_remote_data'; end if;
 digest:=sha256(convert_to(jsonb_build_array(p_expected_revision,p_data)::text,'UTF8'));
 perform pg_advisory_xact_lock(hashtextextended('haedo-material:'||owner::text||':'||p_id::text,0));
 select * into head from haedo_material_private.heads where owner_id=owner and id=p_id for update;
 select * into receipt from haedo_material_private.receipts where owner_id=owner and id=p_id and operation_id=p_operation_id;
 if found then
  if receipt.request_hash<>digest then raise exception using errcode='22023',message='life_material_operation_mismatch'; end if;
  if head.id is null then raise exception using errcode='22023',message='life_material_remote_missing'; end if;
  if head.revision<(receipt.result->>'revision')::bigint then raise exception using errcode='22023',message='life_material_invalid_remote_data'; end if;
  return receipt.result;
 end if;
 if head.id is null and exists(select 1 from haedo_material_private.receipts where owner_id=owner and id=p_id) then raise exception using errcode='22023',message='life_material_remote_missing'; end if;
 if head.id is null and p_expected_revision<>0 then raise exception using errcode='22023',message='life_material_remote_missing'; end if;
 if head.id is not null and head.revision<>p_expected_revision then return jsonb_build_object('status','conflict','revision',head.revision); end if;
 old_output:=coalesce(head.data->'output','null'::jsonb); new_output:=p_data->'output';
 if head.id is not null then
  if head.data#>'{bundle,workspaceId}' is distinct from p_data#>'{bundle,workspaceId}' or head.data#>'{plan,id}' is distinct from p_data#>'{plan,id}' then raise exception using errcode='22023',message='life_material_invalid_request'; end if;
  if exists(select 1 from jsonb_array_elements(head.data#>'{bundle,sourceVersions}') old join jsonb_array_elements(p_data#>'{bundle,sourceVersions}') incoming on old->'id'=incoming->'id' where old<>incoming) then raise exception using errcode='22023',message='life_material_immutable_source_version'; end if;
  if exists(select 1 from jsonb_array_elements(head.data#>'{bundle,sources}') old join jsonb_array_elements(p_data#>'{bundle,sources}') incoming on old->'id'=incoming->'id'
   where (old->'origin') is distinct from incoming->'origin' or (old->'url') is distinct from incoming->'url' or (old?'sourceKey' and (old->'sourceKey') is distinct from incoming->'sourceKey')) then raise exception using errcode='22023',message='life_material_immutable_source_version'; end if;
 end if;
 version_hashes:=coalesce(head.version_hashes,'{}'::jsonb); source_identities:=coalesce(head.source_identities,'{}'::jsonb);
 for item in select value from jsonb_array_elements(p_data#>'{bundle,sourceVersions}') loop
  version_digest:=to_jsonb(encode(sha256(convert_to(item::text,'UTF8')),'hex'));
  if version_hashes?(item->>'id') and version_hashes->(item->>'id')<>version_digest then raise exception using errcode='22023',message='life_material_immutable_source_version'; end if;
  -- The colon namespace cannot collide with Core's identifier alphabet.
  -- Keep this digest after a material is removed, just as immutable versions do.
  marker_key:='edited_copy:'||(item->>'id');
  select value into marker from jsonb_array_elements(p_data#>'{bundle,links}') where value#>>'{entityRefs,0,entityId}'=item->>'id';
  if marker is null then
   if version_hashes?marker_key then raise exception using errcode='22023',message='life_material_immutable_source_version'; end if;
  else
   marker_digest:=to_jsonb(encode(sha256(convert_to(marker::text,'UTF8')),'hex'));
   if version_hashes?marker_key then
    if version_hashes->marker_key<>marker_digest then raise exception using errcode='22023',message='life_material_immutable_source_version'; end if;
   elsif version_hashes?(item->>'id') then
    -- A committed ordinary version cannot be relabelled later as an edit.
    raise exception using errcode='22023',message='life_material_immutable_source_version';
   end if;
   version_hashes:=version_hashes||jsonb_build_object(marker_key,marker_digest);
  end if;
  version_hashes:=version_hashes||jsonb_build_object(item->>'id',version_digest);
 end loop;
 for item in select value from jsonb_array_elements(p_data#>'{bundle,sources}') loop
  -- Core source titles/revisions/dates are mutable. Only immutable source
  -- identity is retained; an initially missing file key may be adopted once.
  identity:=jsonb_build_object('origin',item->'origin','url',item->'url','sourceKey',item->'sourceKey');
  if source_identities?(item->>'id') then
   if source_identities#>array[item->>'id','origin'] is distinct from identity->'origin'
    or source_identities#>array[item->>'id','url'] is distinct from identity->'url'
    or (source_identities#>array[item->>'id','sourceKey']<>'null'::jsonb and source_identities#>array[item->>'id','sourceKey'] is distinct from identity->'sourceKey') then raise exception using errcode='22023',message='life_material_immutable_source_version'; end if;
  end if;
  source_identities:=source_identities||jsonb_build_object(item->>'id',identity);
 end loop;
 if old_output='null'::jsonb then
  if new_output<>'null'::jsonb and new_output->>'state'<>'writing' then raise exception using errcode='22023',message='life_material_output_conflict'; end if;
 elsif new_output='null'::jsonb or new_output->'postId' is distinct from old_output->'postId' or new_output->'claimId' is distinct from old_output->'claimId'
  or old_output->>'state'='saved' and (new_output->>'state'<>'saved' or (new_output->>'revision')::bigint<(old_output->>'revision')::bigint
    or new_output->'revision'=old_output->'revision' and new_output->'refs' is distinct from old_output->'refs') then raise exception using errcode='22023',message='life_material_output_conflict';
 end if;
 if new_output->>'state'='saved' then
  -- Keep the exact private blog head stable through descriptor commit. A
  -- service-side read alone can race with another device's blog save.
  select revision into actual_post_revision from haedo_blog_private.posts
   where owner_id=owner and id=(new_output->>'postId')::uuid for share;
  if not found then raise exception using errcode='22023',message='life_material_output_missing'; end if;
  if actual_post_revision<>(new_output->>'revision')::bigint then raise exception using errcode='22023',message='life_material_output_changed'; end if;
 end if;
 result:=jsonb_build_object('status','stored','revision',p_expected_revision+1);
 insert into haedo_material_private.heads(owner_id,id,revision,data,version_hashes,source_identities) values(owner,p_id,p_expected_revision+1,p_data,version_hashes,source_identities)
 on conflict(owner_id,id) do update set revision=excluded.revision,data=excluded.data,version_hashes=excluded.version_hashes,source_identities=excluded.source_identities,updated_at=greatest(clock_timestamp(),haedo_material_private.heads.updated_at+interval '1 microsecond');
 insert into haedo_material_private.receipts values(owner,p_id,p_operation_id,digest,result);
 return result;
end $$;
-- Metadata-only support probe. No preparation, source or account data is read.
create or replace function public.life_material_capabilities() returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog as $$
begin
 if auth.uid() is null then raise exception using errcode='42501',message='life_material_auth_required'; end if;
 return jsonb_build_object('source_edited_copy',1);
end $$;
revoke all on function public.life_material_capabilities() from public,anon,authenticated;
grant execute on function public.life_material_capabilities() to authenticated;
notify pgrst, 'reload schema';
commit;
