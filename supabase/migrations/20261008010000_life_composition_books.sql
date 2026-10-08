-- Add optional private book projects to the existing life-workbench-v1 validator.
-- Requires 20261006010000_life_compositions.sql. Run as the project administrator.
-- No tables, rows, original content, RPC contracts, Auth or grants are changed.
-- CREATE OR REPLACE keeps the existing function identity, owner and ACL.
-- Existing v1 data without books remains valid. Reapplying is safe.
begin;

-- Fail before CREATE OR REPLACE if this is not an extension of the private
-- composition installation. A standalone CREATE would receive default grants.
do $prerequisite$
begin
  if to_regprocedure('public.life_composition_valid(jsonb)') is null
    or to_regprocedure('public.life_composition_text_valid(jsonb,integer,boolean)') is null
    or to_regprocedure('public.life_composition_ids_valid(jsonb,integer)') is null
    or to_regprocedure('public.life_composition_json_bytes(jsonb)') is null
    or to_regclass('public.life_compositions') is null then
    raise exception using errcode='55000', message='life_composition_books_prerequisite_missing';
  end if;
end;
$prerequisite$;

create or replace function public.life_composition_valid(p_data jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog
as $function$
declare
  v_group jsonb; v_entry jsonb; v_part jsonb; v_pair jsonb; v_page jsonb; v_reflection jsonb;
  v_ids text[] := array[]::text[]; v_versions text[]; v_pairs jsonb[] := array[]::jsonb[];
  v_revision numeric; v_book jsonb; v_chapter jsonb;
begin
  if p_data is null or jsonb_typeof(p_data) is distinct from 'object' then return false; end if;
  -- Bound work before nested validation. The final compact limit is independent.
  if octet_length(convert_to(p_data::text,'UTF8')) > 4194304 then return false; end if;
  if not (p_data ?& array['format','workspaceId','revision','groups','page','reflection'])
    or p_data - array['format','workspaceId','revision','groups','page','reflection','discovery','books'] <> '{}'::jsonb
    or p_data -> 'format' is distinct from '"life-workbench-v1"'::jsonb
    or jsonb_typeof(p_data -> 'workspaceId') is distinct from 'string'
    or (p_data ->> 'workspaceId') !~ '^[A-Za-z0-9_-]{1,128}$'
    or jsonb_typeof(p_data -> 'revision') is distinct from 'number'
    or jsonb_typeof(p_data -> 'groups') is distinct from 'array'
    or jsonb_typeof(p_data -> 'page') is distinct from 'object'
    or jsonb_typeof(p_data -> 'reflection') is distinct from 'object' then return false; end if;
  v_revision := (p_data ->> 'revision')::numeric;
  if v_revision < 0 or v_revision > 9007199254740991 or trunc(v_revision) <> v_revision then return false; end if;
  if jsonb_array_length(p_data -> 'groups') > 100 then return false; end if;
  for v_group in select value from jsonb_array_elements(p_data -> 'groups') loop
    if jsonb_typeof(v_group) is distinct from 'object' then return false; end if;
    if not (v_group ?& array['id','title','versionIds']) or v_group - array['id','title','versionIds'] <> '{}'::jsonb
      or jsonb_typeof(v_group -> 'id') is distinct from 'string' or (v_group ->> 'id') !~ '^[A-Za-z0-9_-]{1,128}$'
      or not public.life_composition_text_valid(v_group -> 'title',500,true)
      or not public.life_composition_ids_valid(v_group -> 'versionIds',1000) then return false; end if;
    if (v_group ->> 'id') = any(v_ids) then return false; end if;
    v_ids := array_append(v_ids,v_group ->> 'id');
  end loop;
  v_page := p_data -> 'page';
  if not (v_page ?& array['title','intro','showIntro','showRecent','entries'])
    or v_page - array['title','intro','showIntro','showRecent','entries'] <> '{}'::jsonb
    or not public.life_composition_text_valid(v_page -> 'title',500,true)
    or not public.life_composition_text_valid(v_page -> 'intro',20000)
    or jsonb_typeof(v_page -> 'showIntro') is distinct from 'boolean'
    or jsonb_typeof(v_page -> 'showRecent') is distinct from 'boolean'
    or jsonb_typeof(v_page -> 'entries') is distinct from 'array' then return false; end if;
  if jsonb_array_length(v_page -> 'entries') > 200 then return false; end if;
  for v_entry in select value from jsonb_array_elements(v_page -> 'entries') loop
    if jsonb_typeof(v_entry) is distinct from 'object' then return false; end if;
    if not (v_entry ?& array['id','title','parts','note','pinned','enabled','showBody','showNote'])
      or v_entry - array['id','title','parts','note','pinned','enabled','showBody','showNote'] <> '{}'::jsonb
      or jsonb_typeof(v_entry -> 'id') is distinct from 'string' or (v_entry ->> 'id') !~ '^[A-Za-z0-9_-]{1,128}$'
      or not public.life_composition_text_valid(v_entry -> 'title',500,true)
      or not public.life_composition_text_valid(v_entry -> 'note',20000)
      or jsonb_typeof(v_entry -> 'pinned') is distinct from 'boolean'
      or jsonb_typeof(v_entry -> 'enabled') is distinct from 'boolean'
      or jsonb_typeof(v_entry -> 'showBody') is distinct from 'boolean'
      or jsonb_typeof(v_entry -> 'showNote') is distinct from 'boolean'
      or jsonb_typeof(v_entry -> 'parts') is distinct from 'array' then return false; end if;
    if (v_entry ->> 'id') = any(v_ids) then return false; end if;
    v_ids := array_append(v_ids,v_entry ->> 'id');
    if jsonb_array_length(v_entry -> 'parts') > 100 then return false; end if;
    v_versions := array[]::text[];
    for v_part in select value from jsonb_array_elements(v_entry -> 'parts') loop
      if jsonb_typeof(v_part) is distinct from 'object' then return false; end if;
      if not (v_part ?& array['versionId','enabled']) or v_part - array['versionId','enabled'] <> '{}'::jsonb
        or jsonb_typeof(v_part -> 'versionId') is distinct from 'string' or (v_part ->> 'versionId') !~ '^[A-Za-z0-9_-]{1,128}$'
        or jsonb_typeof(v_part -> 'enabled') is distinct from 'boolean' then return false; end if;
      if (v_part ->> 'versionId') = any(v_versions) then return false; end if;
      v_versions := array_append(v_versions,v_part ->> 'versionId');
    end loop;
  end loop;
  v_reflection := p_data -> 'reflection';
  if not (v_reflection ?& array['versionIds','note']) or v_reflection - array['versionIds','note'] <> '{}'::jsonb
    or not public.life_composition_ids_valid(v_reflection -> 'versionIds',1000)
    or not public.life_composition_text_valid(v_reflection -> 'note',20000) then return false; end if;
  if p_data ? 'discovery' then
    if jsonb_typeof(p_data -> 'discovery') is distinct from 'object' then return false; end if;
    if not (p_data -> 'discovery' ? 'excludedPairs') or (p_data -> 'discovery') - 'excludedPairs' <> '{}'::jsonb
      or jsonb_typeof(p_data #> '{discovery,excludedPairs}') is distinct from 'array' then return false; end if;
    if jsonb_array_length(p_data #> '{discovery,excludedPairs}') > 1000 then return false; end if;
    for v_pair in select value from jsonb_array_elements(p_data #> '{discovery,excludedPairs}') loop
      if jsonb_typeof(v_pair) is distinct from 'object' then return false; end if;
      if not (v_pair ?& array['seedSourceId','candidateSourceId']) or v_pair - array['seedSourceId','candidateSourceId'] <> '{}'::jsonb
        or jsonb_typeof(v_pair -> 'seedSourceId') is distinct from 'string'
        or jsonb_typeof(v_pair -> 'candidateSourceId') is distinct from 'string'
        or (v_pair ->> 'seedSourceId') !~ '^[A-Za-z0-9_-]{1,128}$'
        or (v_pair ->> 'candidateSourceId') !~ '^[A-Za-z0-9_-]{1,128}$'
        or v_pair -> 'seedSourceId' = v_pair -> 'candidateSourceId' then return false; end if;
      if v_pair = any(v_pairs) then return false; end if;
      v_pairs := array_append(v_pairs,v_pair);
    end loop;
  end if;
  -- Books are optional in v1. Metadata is separate from each original's dates.
  -- References may intentionally be absent; the original ID is never replaced.
  if p_data ? 'books' then
    if jsonb_typeof(p_data -> 'books') is distinct from 'array' then return false; end if;
    if jsonb_array_length(p_data -> 'books') > 20 then return false; end if;
    for v_book in select value from jsonb_array_elements(p_data -> 'books') loop
      if jsonb_typeof(v_book) is distinct from 'object' then return false; end if;
      if not (v_book ?& array['id','title','fromYear','toYear','question','chapters'])
        or v_book - array['id','title','fromYear','toYear','question','chapters'] <> '{}'::jsonb
        or jsonb_typeof(v_book -> 'id') is distinct from 'string' or (v_book ->> 'id') !~ '^[A-Za-z0-9_-]{1,128}$'
        or not public.life_composition_text_valid(v_book -> 'title',500,true)
        or not public.life_composition_text_valid(v_book -> 'question',20000)
        or jsonb_typeof(v_book -> 'fromYear') is distinct from 'string'
        or jsonb_typeof(v_book -> 'toYear') is distinct from 'string'
        or (v_book ->> 'fromYear') !~ '^([0-9]{4})?$' or (v_book ->> 'fromYear') = '0000'
        or (v_book ->> 'toYear') !~ '^([0-9]{4})?$' or (v_book ->> 'toYear') = '0000'
        or jsonb_typeof(v_book -> 'chapters') is distinct from 'array' then return false; end if;
      if (v_book ->> 'fromYear') <> '' and (v_book ->> 'toYear') <> ''
        and (v_book ->> 'fromYear') > (v_book ->> 'toYear') then return false; end if;
      if (v_book ->> 'id') = any(v_ids) then return false; end if;
      v_ids := array_append(v_ids,v_book ->> 'id');
      if jsonb_array_length(v_book -> 'chapters') > 100 then return false; end if;
      for v_chapter in select value from jsonb_array_elements(v_book -> 'chapters') loop
        if jsonb_typeof(v_chapter) is distinct from 'object' then return false; end if;
        if not (v_chapter ?& array['id','title','note','versionIds'])
          or v_chapter - array['id','title','note','versionIds'] <> '{}'::jsonb
          or jsonb_typeof(v_chapter -> 'id') is distinct from 'string' or (v_chapter ->> 'id') !~ '^[A-Za-z0-9_-]{1,128}$'
          or not public.life_composition_text_valid(v_chapter -> 'title',500,true)
          or not public.life_composition_text_valid(v_chapter -> 'note',20000)
          or not public.life_composition_ids_valid(v_chapter -> 'versionIds',1000) then return false; end if;
        if (v_chapter ->> 'id') = any(v_ids) then return false; end if;
        v_ids := array_append(v_ids,v_chapter ->> 'id');
      end loop;
    end loop;
  end if;
  return public.life_composition_json_bytes(p_data) <= 2097152;
end;
$function$;
notify pgrst,'reload schema';
commit;
