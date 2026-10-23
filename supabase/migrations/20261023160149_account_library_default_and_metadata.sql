-- Account-default private material libraries. Existing Core/Composition RPCs stay unchanged.
-- Client caches/outboxes remain recoverable; no Auth/publication/draft domain is added.
begin;

create table if not exists public.life_library_defaults (
 owner_id uuid primary key, workspace_id uuid not null,
 initial_revision bigint, initial_hash bytea,
 created_at timestamptz not null default now(),
 check ((initial_revision is null and initial_hash is null) or
   (initial_revision between 1 and 9007199254740991 and octet_length(initial_hash)=32))
 -- Deliberately no cascading FK: a deleted default remains known missing.
);
create table if not exists public.life_library_metadata (
 owner_id uuid not null, workspace_id uuid not null,
 revision bigint not null check(revision between 1 and 9007199254740991),
 source_revision bigint not null check(source_revision between 1 and 9007199254740991),
 data jsonb not null, updated_at timestamptz not null default now(),
 primary key(owner_id,workspace_id),
 foreign key(owner_id,workspace_id) references public.life_workspaces(owner_id,id) on delete cascade
);
create table if not exists public.life_library_meta_receipts (
 owner_id uuid not null, workspace_id uuid not null, operation_id uuid not null,
 request_hash bytea not null check(octet_length(request_hash)=32), result jsonb not null,
 primary key(owner_id,workspace_id,operation_id),
 foreign key(owner_id,workspace_id) references public.life_workspaces(owner_id,id) on delete cascade
);
create table if not exists public.life_library_originals (
 owner_id uuid not null, id uuid not null, revision bigint not null default 1 check(revision=1),
 manifest jsonb not null, created_at timestamptz not null default now(),
 deleted_at timestamptz, primary key(owner_id,id)
);
create table if not exists public.life_library_original_receipts (
 owner_id uuid not null, id uuid not null, operation_id uuid not null,
 request_hash bytea not null check(octet_length(request_hash)=32), result jsonb not null,
 primary key(owner_id,id,operation_id),
 foreign key(owner_id,id) references public.life_library_originals(owner_id,id) on delete restrict
);

-- Small private model helpers. All predicates reject JSON null and extra fields.
create or replace function public.life_library_fields(v jsonb,k text[])
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(v)='object' and v ?& k and v-k='{}'::jsonb,false)
$$;
create or replace function public.life_library_integer(v jsonb,lo numeric,hi numeric)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
 return coalesce(jsonb_typeof(v)='number' and (v#>>'{}')::numeric between lo and hi
   and trunc((v#>>'{}')::numeric)=(v#>>'{}')::numeric,false);
exception when others then return false;
end $$;
create or replace function public.life_library_id(v jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(v)='string' and (v#>>'{}')~'^[A-Za-z0-9_-]{1,128}$',false)
$$;
create or replace function public.life_library_text(v jsonb,n integer,required boolean default false)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select public.life_composition_text_valid(v,n,required)
$$;
create or replace function public.life_library_url(v jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select public.life_library_text(v,2048) and coalesce((v#>>'{}')='' or
 ((v#>>'{}') ~* '^https?://[^/@[:space:]\\]+([/?#]|$)' and
 (v#>>'{}') !~ '[[:space:]\\]'),false)
$$;
create or replace function public.life_library_date(v jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare s text:=v#>>'{}';
begin
 return coalesce(jsonb_typeof(v)='string' and s~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
 and to_char(s::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=s,false);
exception when others then return false;
end $$;
create or replace function public.life_library_folders_valid(v jsonb,w uuid)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare f jsonb;a jsonb;current_id text;seen text[];depth integer;ids text[]:=array[]::text[];pairs text[]:=array[]::text[];names text[]:=array[]::text[];key text;restored jsonb;
begin
 if not public.life_library_fields(v,array['format','workspaceId','revision','folders','assignments'])
 or v->>'format' is distinct from 'life-source-folders-v1' or v->>'workspaceId' is distinct from w::text
 or not public.life_library_integer(v->'revision',0,9007199254740991)
 or jsonb_typeof(v->'folders') is distinct from 'array' or jsonb_array_length(v->'folders')>200
 or jsonb_typeof(v->'assignments') is distinct from 'array' or jsonb_array_length(v->'assignments')>20000 then return false;end if;
 for f in select * from jsonb_array_elements(v->'folders') loop
  if not public.life_library_fields(f,array['id','name','parentId']) or not public.life_library_id(f->'id')
  or f->>'id'=any(ids) or f->>'id' in ('all','unfiled')
  or not public.life_library_text(f->'name',120,true)
  or f->>'name'~U&'[\0001-\001F\007F-\009F/]' or position(chr(92) in f->>'name')>0
  or f->>'name'~U&'^[\0009-\000D \00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]|[\0009-\000D \00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]$'
  or (f->'parentId'<>'null'::jsonb and not public.life_library_id(f->'parentId')) then return false;end if;
  ids:=array_append(ids,f->>'id');key:=coalesce(f->>'parentId','')||':'||lower(normalize(f->>'name',NFC));
  if key=any(names) then return false;end if;names:=array_append(names,key);
 end loop;
 for f in select * from jsonb_array_elements(v->'folders') loop
  current_id:=f->>'id';seen:=array[]::text[];depth:=0;
  while current_id is not null loop
   if current_id=any(seen) or not(current_id=any(ids)) then return false;end if;
   seen:=array_append(seen,current_id);depth:=depth+1;if depth>5 then return false;end if;
   select x->>'parentId' into current_id from jsonb_array_elements(v->'folders') x where x->>'id'=current_id;
  end loop;
 end loop;
 for a in select * from jsonb_array_elements(v->'assignments') loop
  if not public.life_library_fields(a,array['sourceId','folderId']) or not public.life_library_id(a->'sourceId')
  or not public.life_library_id(a->'folderId') or not(a->>'folderId'=any(ids)) or a->>'sourceId'=any(pairs) then return false;end if;
  pairs:=array_append(pairs,a->>'sourceId');
 end loop;
 restored:=jsonb_build_object('format','life-source-folders-v1','workspaceId','00000000-0000-4000-8000-000000000000','revision',0,
 'folders',(select coalesce(jsonb_agg(jsonb_build_object('id','00000000-0000-4000-8000-000000000000','name',x->'name','parentId',case when x->'parentId'='null'::jsonb then null else '00000000-0000-4000-8000-000000000000' end)),'[]'::jsonb) from jsonb_array_elements(v->'folders') x),
 'assignments',(select coalesce(jsonb_agg(jsonb_build_object('sourceId','00000000-0000-4000-8000-000000000000','folderId','00000000-0000-4000-8000-000000000000')),'[]'::jsonb) from jsonb_array_elements(v->'assignments')));
 return public.life_composition_json_bytes(v)<=2097152 and public.life_composition_json_bytes(restored)<=2097152;
exception when others then return false;
end $$;
create or replace function public.life_library_attachment_valid(v jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(public.life_library_fields(v,array['type','title','creator','url'])
 and v->>'type'=any(array['music','book','film','video','article','artwork','tool','person','place','other'])
 and public.life_library_text(v->'title',500,true) and public.life_library_text(v->'creator',500)
 and public.life_library_url(v->'url') and (v->>'type'<>'person' or v->>'creator'=''),false)
$$;
create or replace function public.life_library_collection_valid(v jsonb,w uuid)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare i jsonb;t jsonb;d jsonb;ids text[]:=array[]::text[];tags text[];allowed text[];
begin
 if not public.life_library_fields(v,array['format','workspaceId','revision','items']) or v->>'format' is distinct from 'life-collection-v1' or v->>'workspaceId' is distinct from w::text
 or not public.life_library_integer(v->'revision',0,9007199254740991) or jsonb_typeof(v->'items') is distinct from 'array' or jsonb_array_length(v->'items')>1000 then return false;end if;
 for i in select * from jsonb_array_elements(v->'items') loop
  if not public.life_library_fields(i,array['id','type','title','creator','url','note','tags','details','archived','createdAt','updatedAt'])
  or not public.life_library_id(i->'id') or i->>'id'=any(ids)
  or not public.life_library_attachment_valid(jsonb_build_object('type',i->'type','title',i->'title','creator',i->'creator','url',i->'url'))
  or not public.life_library_text(i->'note',10000) or jsonb_typeof(i->'archived') is distinct from 'boolean'
  or not public.life_library_date(i->'createdAt') or not public.life_library_date(i->'updatedAt') or i->>'updatedAt'<i->>'createdAt'
  or (i->>'type'='person' and i->>'creator'<>'') or jsonb_typeof(i->'tags') is distinct from 'array' or jsonb_array_length(i->'tags')>12
  or jsonb_typeof(i->'details') is distinct from 'object' then return false;end if;
  ids:=array_append(ids,i->>'id');tags:=array[]::text[];
  for t in select * from jsonb_array_elements(i->'tags') loop
   if not public.life_library_text(t,60,true) or t#>>'{}'=any(tags) or t#>>'{}'~U&'^[\0009-\000D \00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]|[\0009-\000D \00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]$' then return false;end if;
   tags:=array_append(tags,t#>>'{}');
  end loop;
  allowed:=case i->>'type' when 'music' then array['year'] when 'book' then array['year'] when 'film' then array['year','country','duration'] when 'video' then array['year'] when 'article' then array['year'] when 'artwork' then array['year','medium','holding','rights'] when 'person' then array['field'] else array[]::text[] end;
  if i->'details'-allowed<>'{}'::jsonb then return false;end if;
  for d in select value from jsonb_each(i->'details') loop if not public.life_library_text(d,500) then return false;end if;end loop;
 end loop;
 return public.life_composition_json_bytes(v)<=2097152 and public.life_composition_json_bytes(jsonb_build_object('format','life-collection-backup-v1','exportedAt','1970-01-01T00:00:00.000Z','items',v->'items'))<=2097152;
exception when others then return false;
end $$;

-- JavaScript UTF-16 locators must land on scalar boundaries. Never normalize text.
create or replace function public.life_library_utf16_slice(s text,a bigint,b bigint)
returns text language plpgsql immutable set search_path=pg_catalog as $$
declare pos bigint:=0;i integer;ch text;n integer;result text:='';
begin
 for i in 1..char_length(s) loop
  ch:=substr(s,i,1);n:=case when ascii(ch)>65535 then 2 else 1 end;
  if (a>pos and a<pos+n) or (b>pos and b<pos+n) then return null;end if;
  if pos>=a and pos<b then result:=result||ch;end if;pos:=pos+n;
  if pos>=b then exit;end if;
 end loop;
 if pos<b then return null;end if;return result;
end $$;
create or replace function public.life_library_clean_text(v jsonb,n integer)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select public.life_library_text(v,n) and coalesce(v#>>'{}'!~U&'[\0001-\0008\000B\000C\000E-\001F\007F]',false)
$$;
create or replace function public.life_library_reference_valid(v jsonb,w uuid,bundle jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare r jsonb:=v->'value';ver jsonb;a bigint;b bigint;
begin
 if not public.life_library_fields(v,array['kind','value']) or not coalesce(v->>'kind'=any(array['source','post']),false) then return false;end if;
 if v->>'kind'='source' then
  if not public.life_library_fields(r,array['format','workspaceId','sourceId','sourceVersionId','locator','quote','contentHash','title','sourceKey','url'])
  or r->>'format' is distinct from 'life-source-reference-v1' or not public.life_library_id(r->'sourceId') or not public.life_library_id(r->'sourceVersionId')
  or not public.life_library_clean_text(r->'sourceKey',2000) or not public.life_library_url(r->'url') then return false;end if;
 else
  if not public.life_library_fields(r,array['format','workspaceId','postId','postRevision','locator','quote','contentHash','title'])
  or r->>'format' is distinct from 'life-post-reference-v1' or not public.life_library_id(r->'postId') or not public.life_library_integer(r->'postRevision',1,9007199254740991) then return false;end if;
 end if;
 if not public.life_library_id(r->'workspaceId') or not public.life_library_clean_text(r->'quote',50000)
 or not public.life_library_clean_text(r->'title',500) or jsonb_typeof(r->'contentHash') is distinct from 'string' or r->>'contentHash'!~'^[a-f0-9]{64}$'
 or not public.life_library_fields(r->'locator',array['start','end']) or not public.life_library_integer(r#>'{locator,start}',0,9007199254740991)
 or not public.life_library_integer(r#>'{locator,end}',1,9007199254740991) then return false;end if;
 a:=(r#>>'{locator,start}')::bigint;b:=(r#>>'{locator,end}')::bigint;
 if b<=a or char_length(r->>'quote')+regexp_count(r->>'quote',U&'[\+010000-\+10FFFF]')<>b-a then return false;end if;
 if v->>'kind'='source' and r->>'workspaceId'=w::text then
  select x into ver from jsonb_array_elements(bundle->'sourceVersions') x where x->>'id'=r->>'sourceVersionId';
  -- Missing legacy evidence remains explicitly missing; available evidence is exact.
  if ver is not null and (ver->>'sourceId'<>r->>'sourceId' or ver->>'contentHash'<>r->>'contentHash'
   or encode(sha256(convert_to(ver->>'contentText','UTF8')),'hex')<>r->>'contentHash'
   or public.life_library_utf16_slice(ver->>'contentText',a,b) is distinct from r->>'quote') then return false;end if;
 end if;
 return true;
exception when others then return false;
end $$;
create or replace function public.life_library_nine_valid(v jsonb,w uuid,bundle jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare b jsonb;a jsonb;i jsonb;ids text[]:=array[]::text[];
begin
 if not public.life_library_fields(v,array['format','workspaceId','revision','boards']) or not coalesce(v->>'format'=any(array['life-nine-board-v1','life-nine-board-v2']),false) or v->>'workspaceId' is distinct from w::text
 or not public.life_library_integer(v->'revision',0,9007199254740991) or jsonb_typeof(v->'boards') is distinct from 'array' or jsonb_array_length(v->'boards')>20 then return false;end if;
 for b in select * from jsonb_array_elements(v->'boards') loop
  if not public.life_library_fields(b,array['id','title','intro','areas']) or not public.life_library_id(b->'id') or b->>'id'=any(ids)
  or not public.life_library_clean_text(b->'title',500) or not public.life_library_clean_text(b->'intro',20000)
  or jsonb_typeof(b->'areas') is distinct from 'array' or jsonb_array_length(b->'areas')>9 then return false;end if;ids:=array_append(ids,b->>'id');
  for a in select * from jsonb_array_elements(b->'areas') loop
   if not public.life_library_fields(a,array['id','title','note','items']) or not public.life_library_id(a->'id') or a->>'id'=any(ids)
   or not public.life_library_clean_text(a->'title',500) or not public.life_library_clean_text(a->'note',20000)
   or jsonb_typeof(a->'items') is distinct from 'array' or jsonb_array_length(a->'items')>9 then return false;end if;ids:=array_append(ids,a->>'id');
   for i in select * from jsonb_array_elements(a->'items') loop
    if not public.life_library_fields(i,case when i ? 'reference' and v->>'format'='life-nine-board-v2' then array['attachment','reason','reference'] else array['attachment','reason'] end)
    or not public.life_library_attachment_valid(i->'attachment') or not public.life_library_clean_text(i->'reason',20000) or not public.life_library_clean_text(i#>'{attachment,title}',500) or not public.life_library_clean_text(i#>'{attachment,creator}',500) or not public.life_library_clean_text(i#>'{attachment,url}',2048)
    or (i ? 'reference' and not public.life_library_reference_valid(i->'reference',w,bundle)) then return false;end if;
   end loop;
  end loop;
 end loop;
 return public.life_composition_json_bytes(v)<=2097152 and public.life_composition_json_bytes(v->'boards')<=2096128;
exception when others then return false;
end $$;
create or replace function public.life_library_meta_valid(v jsonb,w uuid,bundle jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(public.life_library_fields(v,array['format','workspaceId','revision','sourceFolders','collection','nineBoard'])
 and v->>'format'='life-library-meta-v1' and v->>'workspaceId'=w::text
 and public.life_library_integer(v->'revision',0,9007199254740991)
 and public.life_library_folders_valid(v->'sourceFolders',w)
 and public.life_library_collection_valid(v->'collection',w)
 and public.life_library_nine_valid(v->'nineBoard',w,bundle)
 and public.life_composition_json_bytes(v)<=8388608,false)
$$;

create or replace function public.life_library_capabilities()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if auth.uid() is null then raise exception using errcode='42501',message='life_auth_required';end if;
 return jsonb_build_object('version',1,'metadataVersion',1,'originalsVersion',1);
end $$;
create or replace function public.life_library_open(p_preferred_workspace_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner uuid:=auth.uid();ptr public.life_library_defaults%rowtype;row public.life_workspaces%rowtype;w uuid;data jsonb;stamp text;
begin
 if owner is null then raise exception using errcode='42501',message='life_auth_required';end if;
 perform pg_advisory_xact_lock(hashtextextended('life-library-default:'||owner::text,0));
 select * into ptr from public.life_library_defaults where owner_id=owner;
 if found then
  select * into row from public.life_workspaces where owner_id=owner and id=ptr.workspace_id;
  if not found then return jsonb_build_object('status','missing','workspace_id',ptr.workspace_id,'default_revision',0,'pristine',false);end if;
 else
  w:=p_preferred_workspace_id;
  if w is null then select id into w from public.life_workspaces where owner_id=owner order by updated_at,id limit 1;end if;
  w:=coalesce(w,gen_random_uuid());
  perform pg_advisory_xact_lock(hashtextextended(owner::text||':'||w::text,0));
  select * into row from public.life_workspaces where owner_id=owner and id=w;
  if not found then
   stamp:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
   data:=jsonb_build_object('schemaVersion',1,'workspaceId',w::text,'title','자료실','revision',0,'createdAt',stamp,'updatedAt',stamp,
    'sources','[]'::jsonb,'sourceVersions','[]'::jsonb,'records','[]'::jsonb,'links','[]'::jsonb,'resumeHints','[]'::jsonb,'tombstones','[]'::jsonb);
   perform public.life_sync_put(w,0,gen_random_uuid(),data);
   select * into row from public.life_workspaces where owner_id=owner and id=w;
   insert into public.life_library_defaults(owner_id,workspace_id,initial_revision,initial_hash) values(owner,w,row.revision,sha256(convert_to(row.data::text,'UTF8'))) returning * into ptr;
  else
   insert into public.life_library_defaults(owner_id,workspace_id) values(owner,w) returning * into ptr;
  end if;
 end if;
 return jsonb_build_object('status','ready','workspace_id',ptr.workspace_id,'default_revision',row.revision,
  'pristine',coalesce(row.revision=ptr.initial_revision and sha256(convert_to(row.data::text,'UTF8'))=ptr.initial_hash,false));
end $$;
create or replace function public.life_library_catalog(p_after uuid default null,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare owner uuid:=auth.uid();items jsonb;cursor uuid;
begin
 if owner is null then raise exception using errcode='42501',message='life_auth_required';end if;
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception using errcode='22023',message='life_library_invalid_limit';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'revision',revision,'updated_at',updated_at) order by id),'[]'::jsonb) into items
 from (select * from public.life_workspaces where owner_id=owner and (p_after is null or id>p_after) order by id limit p_limit) q;
 if jsonb_array_length(items)=p_limit then
  cursor:=(items->(p_limit-1)->>'id')::uuid;
  if not exists(select 1 from public.life_workspaces where owner_id=owner and id>cursor) then cursor:=null;end if;
 end if;
 return jsonb_build_object('items',items,'next',cursor);
end $$;
create or replace function public.life_library_meta_get(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare owner uuid:=auth.uid();r public.life_library_metadata%rowtype;
begin
 if owner is null then raise exception using errcode='42501',message='life_auth_required';end if;
 select * into r from public.life_library_metadata where owner_id=owner and workspace_id=p_workspace_id;
 if not found then return null;end if;
 return jsonb_build_object('workspace_id',r.workspace_id,'revision',r.revision,'source_revision',r.source_revision,'data',r.data,'updated_at',r.updated_at);
end $$;
create or replace function public.life_library_meta_put(p_workspace_id uuid,p_expected_revision bigint,p_operation_id uuid,p_source_revision bigint,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner uuid:=auth.uid();source public.life_workspaces%rowtype;r public.life_library_metadata%rowtype;receipt public.life_library_meta_receipts%rowtype;digest bytea;result jsonb;nextrev bigint;
begin
 if owner is null then raise exception using errcode='42501',message='life_auth_required';end if;
 if p_workspace_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision not between 0 and 9007199254740991 or p_source_revision is null or p_source_revision not between 1 and 9007199254740991 then raise exception using errcode='22023',message='life_library_invalid_request';end if;
 if octet_length(convert_to(p_data::text,'UTF8'))>16777216 or public.life_composition_json_bytes(p_data)>8388608 then raise exception using errcode='22001',message='life_library_meta_too_large';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text||':'||p_workspace_id::text,0));
 select * into source from public.life_workspaces where owner_id=owner and id=p_workspace_id for update;
 if not found then return jsonb_build_object('status','missing');end if;
 if not public.life_library_meta_valid(p_data,p_workspace_id,source.data) then raise exception using errcode='22023',message='life_library_invalid_metadata';end if;
 digest:=sha256(convert_to(p_expected_revision::text||':'||p_source_revision::text||':'||p_data::text,'UTF8'));
 select * into receipt from public.life_library_meta_receipts where owner_id=owner and workspace_id=p_workspace_id and operation_id=p_operation_id;
 if found then
  if receipt.request_hash is distinct from digest then raise exception using errcode='22023',message='life_operation_mismatch';end if;return receipt.result;
 end if;
 if source.revision<p_source_revision then raise exception using errcode='22023',message='life_library_source_not_ready';end if;
 select * into r from public.life_library_metadata where owner_id=owner and workspace_id=p_workspace_id for update;
 if not found then if p_expected_revision<>0 then return jsonb_build_object('status','missing');end if;nextrev:=1;
 else
  if r.revision<>p_expected_revision then return jsonb_build_object('status','conflict','revision',r.revision);end if;
  if p_source_revision<r.source_revision then raise exception using errcode='22023',message='life_library_source_not_ready';end if;
  if r.revision>=9007199254740991 then raise exception using errcode='22003',message='life_revision_limit';end if;nextrev:=r.revision+1;
 end if;
 insert into public.life_library_metadata(owner_id,workspace_id,revision,source_revision,data) values(owner,p_workspace_id,nextrev,p_source_revision,p_data)
 on conflict(owner_id,workspace_id) do update set revision=excluded.revision,source_revision=excluded.source_revision,data=excluded.data,updated_at=clock_timestamp();
 result:=jsonb_build_object('status','stored','revision',nextrev);
 insert into public.life_library_meta_receipts values(owner,p_workspace_id,p_operation_id,digest,result);return result;
end $$;

create table if not exists public.life_library_original_tombstones (
 owner_id uuid not null,id uuid not null,deleted_at timestamptz not null default now(),primary key(owner_id,id)
);
create or replace function public.life_library_original_tombstone()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if TG_OP='DELETE' or new.deleted_at is not null then
  insert into public.life_library_original_tombstones(owner_id,id) values(old.owner_id,old.id) on conflict do nothing;
 end if;
 if TG_OP='DELETE' then return old;end if;return new;
end $$;
drop trigger if exists life_library_original_tombstone on public.life_library_originals;
create trigger life_library_original_tombstone before delete or update of deleted_at on public.life_library_originals
 for each row execute function public.life_library_original_tombstone();
create or replace function public.life_library_path(v jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select public.life_library_text(v,4000,true) and coalesce(v#>>'{}'!~U&'[\0001-\001F\007F]' and position(chr(92) in v#>>'{}')=0
 and v#>>'{}'!~'^/' and v#>>'{}'!~*'^[a-z]:' and v#>>'{}'!~'(^|/)(\.{1,2}|)(/|$)'
 and v#>>'{}'!~*'</?(script|iframe|svg|img|object|embed|style|link|meta)([[:space:]> /])',false)
$$;
create or replace function public.life_library_original_valid(v jsonb,owner uuid,id uuid)
returns boolean language plpgsql stable set search_path=pg_catalog as $$
declare e jsonb;c jsonb;name text;ext text;mime text;prefix text;seen text[]:=array[]::text[];n integer:=0;total bigint:=0;files bigint:=0;lastend bigint:=0;
begin
 if not public.life_library_fields(v,array['format','id','sourceHead','part','partCount','archiveBytes','archiveHash','entries','chunks'])
 or v->>'format' is distinct from 'life-library-original-v1' or v->>'id' is distinct from id::text or jsonb_typeof(v->'sourceHead') is distinct from 'string' or v->>'sourceHead'!~'^[a-f0-9]{40}$'
 or not public.life_library_integer(v->'partCount',1,200) or not public.life_library_integer(v->'part',1,(v->>'partCount')::numeric)
 or not public.life_library_integer(v->'archiveBytes',22,134217728) or jsonb_typeof(v->'archiveHash') is distinct from 'string' or v->>'archiveHash'!~'^[a-f0-9]{64}$'
 or jsonb_typeof(v->'entries') is distinct from 'array' or jsonb_array_length(v->'entries') not between 1 and 500
 or jsonb_typeof(v->'chunks') is distinct from 'array' or jsonb_array_length(v->'chunks') not between 1 and 16
 or public.life_composition_json_bytes(v)>2097152 then return false;end if;
 for e in select * from jsonb_array_elements(v->'entries') loop
  if not public.life_library_fields(e,array['sourceRelativePath','snapshotPath','role','bytes','sha256','mime','sourceGitCommit','offset','crc'])
  or not public.life_library_path(e->'sourceRelativePath') or not public.life_library_path(e->'snapshotPath')
  or not public.life_library_integer(e->'bytes',0,67108864) or not public.life_library_integer(e->'offset',30,134217728)
  or not public.life_library_integer(e->'crc',0,4294967295) or jsonb_typeof(e->'sha256') is distinct from 'string' or e->>'sha256'!~'^[a-f0-9]{64}$'
  or (e->'sourceGitCommit'<>'null'::jsonb and (jsonb_typeof(e->'sourceGitCommit') is distinct from 'string' or e->>'sourceGitCommit'!~'^[a-f0-9]{40}$')) then return false;end if;
  prefix:=case e->>'role' when 'git-excluded-attachment' then 'attachments' when 'working-note-version' then 'working-version' when 'git-note-version' then 'git-version' else null end;
  ext:=lower(regexp_replace(e->>'sourceRelativePath','^.*\.',''));
  mime:=case ext when 'png' then 'image/png' when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg' when 'heic' then 'image/heic' when 'pdf' then 'application/pdf' when 'md' then 'text/markdown' else null end;
  if prefix is null or mime is null or e->>'mime' is distinct from mime or e->>'snapshotPath' is distinct from 'snapshot/'||prefix||'/'||(e->>'sourceRelativePath')
  or (e->>'role'='git-excluded-attachment' and ext='md') or (e->>'role'<>'git-excluded-attachment' and ext<>'md')
  or (e->>'role'='git-note-version' and e->>'sourceGitCommit' is distinct from v->>'sourceHead')
  or e->>'snapshotPath'=any(seen) or (e->>'offset')::bigint+(e->>'bytes')::bigint>(v->>'archiveBytes')::bigint
  or (e->>'offset')::bigint<lastend then return false;end if;
  seen:=array_append(seen,e->>'snapshotPath');lastend:=(e->>'offset')::bigint+(e->>'bytes')::bigint;files:=files+(e->>'bytes')::bigint;
 end loop;
 for c in select * from jsonb_array_elements(v->'chunks') loop
  if not public.life_library_fields(c,array['index','path','bytes','sha256']) or not public.life_library_integer(c->'index',n,n)
  or not public.life_library_integer(c->'bytes',1,8388608) or jsonb_typeof(c->'sha256') is distinct from 'string' or c->>'sha256'!~'^[a-f0-9]{64}$'
  or jsonb_typeof(c->'path') is distinct from 'string' then return false;end if;
  name:=owner::text||'/'||(v->>'archiveHash')||'/'||lpad(n::text,4,'0')||'-'||(c->>'sha256');
  if c->>'path' is distinct from name then return false;end if;
  total:=total+(c->>'bytes')::bigint;n:=n+1;
 end loop;
 return total=(v->>'archiveBytes')::bigint and files<=total;
exception when others then return false;
end $$;

create or replace function public.life_library_originals_list(p_after uuid default null,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare owner uuid:=auth.uid();items jsonb;cursor uuid;
begin
 if owner is null then raise exception using errcode='42501',message='life_auth_required';end if;
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception using errcode='22023',message='life_library_invalid_limit';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'created_at',created_at,
 'archive_sha256',manifest->'archiveHash','archive_bytes',manifest->'archiveBytes','part',manifest->'part','part_count',manifest->'partCount',
 'source_head',manifest->'sourceHead','entry_count',jsonb_array_length(manifest->'entries'),'total_file_bytes',
 (select coalesce(sum((x->>'bytes')::bigint),0) from jsonb_array_elements(manifest->'entries') x)) order by id),'[]'::jsonb) into items
 from (select * from public.life_library_originals r where r.owner_id=owner and r.deleted_at is null
 and not exists(select 1 from public.life_library_original_tombstones t where t.owner_id=owner and t.id=r.id)
 and (p_after is null or r.id>p_after) order by r.id limit p_limit) q;
 if jsonb_array_length(items)=p_limit then
  cursor:=(items->(p_limit-1)->>'id')::uuid;
  if not exists(select 1 from public.life_library_originals r where r.owner_id=owner and r.id>cursor and r.deleted_at is null
    and not exists(select 1 from public.life_library_original_tombstones t where t.owner_id=owner and t.id=r.id)) then cursor:=null;end if;
 end if;
 return jsonb_build_object('items',items,'next',cursor);
end $$;
create or replace function public.life_library_original_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare owner uuid:=auth.uid();r public.life_library_originals%rowtype;
begin
 if owner is null then raise exception using errcode='42501',message='life_auth_required';end if;
 select * into r from public.life_library_originals x where x.owner_id=owner and x.id=p_id and x.deleted_at is null
 and not exists(select 1 from public.life_library_original_tombstones t where t.owner_id=owner and t.id=p_id);
 if not found then return null;end if;
 return jsonb_build_object('id',r.id,'revision',r.revision,'manifest',r.manifest,'created_at',r.created_at);
end $$;
create or replace function public.life_library_original_put(p_id uuid,p_operation_id uuid,p_manifest jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner uuid:=auth.uid();r public.life_library_originals%rowtype;receipt public.life_library_original_receipts%rowtype;digest bytea;c jsonb;result jsonb;
begin
 if owner is null then raise exception using errcode='42501',message='life_auth_required';end if;
 if p_id is null or p_operation_id is null then raise exception using errcode='22023',message='life_library_invalid_request';end if;
 perform pg_advisory_xact_lock(hashtextextended('life-library-original:'||owner::text||':'||p_id::text,0));
 if exists(select 1 from public.life_library_original_tombstones where owner_id=owner and id=p_id)
 or exists(select 1 from public.life_library_originals where owner_id=owner and id=p_id and deleted_at is not null) then return jsonb_build_object('status','missing');end if;
 if octet_length(convert_to(p_manifest::text,'UTF8'))>4194304 or public.life_composition_json_bytes(p_manifest)>2097152 then raise exception using errcode='22001',message='life_library_original_too_large';end if;
 if not public.life_library_original_valid(p_manifest,owner,p_id) then raise exception using errcode='22023',message='life_library_invalid_original';end if;
 digest:=sha256(convert_to(p_manifest::text,'UTF8'));
 select * into receipt from public.life_library_original_receipts where owner_id=owner and id=p_id and operation_id=p_operation_id;
 if found then if receipt.request_hash is distinct from digest then raise exception using errcode='22023',message='life_operation_mismatch';end if;return receipt.result;end if;
 select * into r from public.life_library_originals where owner_id=owner and id=p_id for update;
 if found and r.manifest is distinct from p_manifest then raise exception using errcode='22023',message='life_library_original_immutable';end if;
 -- storage metadata.size is written by the Storage service from the received object.
 -- JSON numbers/strings are both used by supported Storage versions; reject missing,
 -- negative, noninteger or wrong sizes instead of trusting caller-supplied metadata.
 for c in select * from jsonb_array_elements(p_manifest->'chunks') loop
  if not exists(select 1 from storage.objects o where o.bucket_id='life-library-originals' and o.name=c->>'path'
    and o.owner_id=owner::text and (o.metadata->>'size')~'^[0-9]{1,9}$' and (o.metadata->>'size')::bigint=(c->>'bytes')::bigint) then
   raise exception using errcode='22023',message='life_library_original_chunk_missing';
  end if;
 end loop;
 insert into public.life_library_originals(owner_id,id,manifest) values(owner,p_id,p_manifest) on conflict(owner_id,id) do nothing;
 result:=jsonb_build_object('status','stored','revision',1);
 insert into public.life_library_original_receipts values(owner,p_id,p_operation_id,digest,result);return result;
end $$;

-- Only this new bucket is configured; existing buckets and their grants stay intact.
insert into storage.buckets(id,name,public,file_size_limit) values('life-library-originals','life-library-originals',false,8388608) on conflict(id) do nothing;
do $$ begin
 if not exists(select 1 from storage.buckets where id='life-library-originals' and public=false and file_size_limit=8388608) then
  raise exception 'life_library_bucket_configuration_conflict';
 end if;
end $$;
-- Restrictive guards also protect this bucket if an older project policy permits
-- authenticated users broadly. They do not change access to any other bucket.
drop policy if exists life_library_originals_read_guard on storage.objects;
create policy life_library_originals_read_guard on storage.objects as restrictive for select to public
 using(bucket_id<>'life-library-originals' or (owner_id=(select auth.uid())::text and split_part(name,'/',1)=(select auth.uid())::text));
drop policy if exists life_library_originals_insert_guard on storage.objects;
create policy life_library_originals_insert_guard on storage.objects as restrictive for insert to public
 with check(bucket_id<>'life-library-originals' or (owner_id=(select auth.uid())::text and
 name~('^'||(select auth.uid())::text||'/[a-f0-9]{64}/(000[0-9]|001[0-5])-[a-f0-9]{64}$') and
 (metadata->>'size')~'^[0-9]{1,9}$' and (metadata->>'size')::bigint between 1 and 8388608));
drop policy if exists life_library_originals_update_guard on storage.objects;
create policy life_library_originals_update_guard on storage.objects as restrictive for update to public
 using(bucket_id<>'life-library-originals') with check(bucket_id<>'life-library-originals');
drop policy if exists life_library_originals_delete_guard on storage.objects;
create policy life_library_originals_delete_guard on storage.objects as restrictive for delete to public using(bucket_id<>'life-library-originals');
drop policy if exists life_library_originals_owner_read on storage.objects;
create policy life_library_originals_owner_read on storage.objects for select to authenticated
 using(bucket_id='life-library-originals' and owner_id=(select auth.uid())::text and split_part(name,'/',1)=(select auth.uid())::text);
drop policy if exists life_library_originals_owner_insert on storage.objects;
create policy life_library_originals_owner_insert on storage.objects for insert to authenticated
 with check(bucket_id='life-library-originals' and owner_id=(select auth.uid())::text and
 name~('^'||(select auth.uid())::text||'/[a-f0-9]{64}/(000[0-9]|001[0-5])-[a-f0-9]{64}$') and
 (metadata->>'size')~'^[0-9]{1,9}$' and (metadata->>'size')::bigint between 1 and 8388608);

-- Tables are owner-readable where useful; all changes are RPC-only. Defaults and
-- receipts are internal. Helper EXECUTE is revoked, including PUBLIC defaults.
do $$ declare n text;fn record;begin
 foreach n in array array['life_library_defaults','life_library_metadata','life_library_meta_receipts','life_library_originals','life_library_original_receipts','life_library_original_tombstones'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on table public.%I from public,anon,authenticated',n);
 end loop;
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and left(p.proname,13)='life_library_' loop
  execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
 end loop;
end $$;
grant select on public.life_library_metadata to authenticated;
drop policy if exists life_library_metadata_owner_read on public.life_library_metadata;
create policy life_library_metadata_owner_read on public.life_library_metadata for select to authenticated using(owner_id=(select auth.uid()));
-- Originals are exposed via RPC so tombstones can never leak as live catalog rows.
grant execute on function public.life_library_capabilities() to authenticated;
grant execute on function public.life_library_open(uuid) to authenticated;
grant execute on function public.life_library_catalog(uuid,integer) to authenticated;
grant execute on function public.life_library_meta_get(uuid) to authenticated;
grant execute on function public.life_library_meta_put(uuid,bigint,uuid,bigint,jsonb) to authenticated;
grant execute on function public.life_library_originals_list(uuid,integer) to authenticated;
grant execute on function public.life_library_original_get(uuid) to authenticated;
grant execute on function public.life_library_original_put(uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
