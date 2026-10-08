-- Add optional private book/chapter archives and fixed book-edition snapshots.
-- Requires 20261008020000_life_composition_insights.sql. Run as project administrator.
-- Only the existing validator changes; no rows, tables, RPCs, Auth or grants.
-- CREATE OR REPLACE preserves its identity, owner and private ACL.
-- Old v1/books/insights stay valid. Missing exact references remain unchanged.
begin;

do $prerequisite$
begin
  if to_regprocedure('public.life_composition_valid(jsonb)') is null
    or to_regprocedure('public.life_composition_text_valid(jsonb,integer,boolean)') is null
    or to_regprocedure('public.life_composition_ids_valid(jsonb,integer)') is null
    or to_regprocedure('public.life_composition_json_bytes(jsonb)') is null
    or to_regclass('public.life_compositions') is null then
    raise exception using errcode='55000', message='life_composition_editions_prerequisite_missing';
  end if;
  -- A function with the same name from the original composition installation
  -- does not yet support chapter interpretations. Verify only a constant sample, not personal data.
  if public.life_composition_valid('{"format":"life-workbench-v1","workspaceId":"installation_check","revision":0,"groups":[],"page":{"title":"check","intro":"","showIntro":true,"showRecent":true,"entries":[]},"reflection":{"versionIds":[],"note":""},"books":[{"id":"book","title":"check","fromYear":"","toYear":"","question":"","chapters":[{"id":"chapter","title":"check","note":"","versionIds":[],"insights":[{"id":"insight","statement":"","uncertainty":"","supportVersionIds":[],"counterVersionIds":[],"excluded":true}]}]}]}'::jsonb) is not true then
    raise exception using errcode='55000', message='life_composition_editions_insights_prerequisite_missing';
  end if;
end;
$prerequisite$;

create or replace function public.life_composition_valid(p_data jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog
as $function$
declare
  v_group jsonb; v_entry jsonb; v_part jsonb; v_pair jsonb; v_page jsonb; v_reflection jsonb;
  v_ids text[] := array[]::text[]; v_versions text[]; v_pairs jsonb[] := array[]::jsonb[];
  v_revision numeric; v_book jsonb; v_chapter jsonb; v_insight jsonb; v_edition jsonb; v_chapter_sets jsonb; v_chapters jsonb; v_created_at timestamptz;
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
        or v_book - array['id','title','fromYear','toYear','question','chapters','archived','editions'] <> '{}'::jsonb
        or jsonb_typeof(v_book -> 'id') is distinct from 'string' or (v_book ->> 'id') !~ '^[A-Za-z0-9_-]{1,128}$'
        or not public.life_composition_text_valid(v_book -> 'title',500,true)
        or not public.life_composition_text_valid(v_book -> 'question',20000)
        or jsonb_typeof(v_book -> 'fromYear') is distinct from 'string'
        or jsonb_typeof(v_book -> 'toYear') is distinct from 'string'
        or (v_book ->> 'fromYear') !~ '^([0-9]{4})?$' or (v_book ->> 'fromYear') = '0000'
        or (v_book ->> 'toYear') !~ '^([0-9]{4})?$' or (v_book ->> 'toYear') = '0000'
        or (v_book ? 'archived' and jsonb_typeof(v_book -> 'archived') is distinct from 'boolean')
        or jsonb_typeof(v_book -> 'chapters') is distinct from 'array' then return false; end if;
      if (v_book ->> 'fromYear') <> '' and (v_book ->> 'toYear') <> ''
        and (v_book ->> 'fromYear') > (v_book ->> 'toYear') then return false; end if;
      v_ids := array_append(v_ids,v_book ->> 'id');
      v_chapter_sets := jsonb_build_array(v_book -> 'chapters');
      if v_book ? 'editions' then
        if jsonb_typeof(v_book -> 'editions') is distinct from 'array' then return false; end if;
        if jsonb_array_length(v_book -> 'editions') > 10 then return false; end if;
        for v_edition in select value from jsonb_array_elements(v_book -> 'editions') loop
          if jsonb_typeof(v_edition) is distinct from 'object' then return false; end if;
          if not (v_edition ?& array['id','label','createdAt','title','fromYear','toYear','question','chapters'])
            or v_edition - array['id','label','createdAt','title','fromYear','toYear','question','chapters'] <> '{}'::jsonb
            or jsonb_typeof(v_edition -> 'id') is distinct from 'string' or (v_edition ->> 'id') !~ '^[A-Za-z0-9_-]{1,128}$'
            or not public.life_composition_text_valid(v_edition -> 'label',500,true)
            or not public.life_composition_text_valid(v_edition -> 'title',500,true)
            or not public.life_composition_text_valid(v_edition -> 'question',20000)
            or jsonb_typeof(v_edition -> 'fromYear') is distinct from 'string'
            or jsonb_typeof(v_edition -> 'toYear') is distinct from 'string'
            or (v_edition ->> 'fromYear') !~ '^([0-9]{4})?$' or (v_edition ->> 'fromYear') = '0000'
            or (v_edition ->> 'toYear') !~ '^([0-9]{4})?$' or (v_edition ->> 'toYear') = '0000'
            or jsonb_typeof(v_edition -> 'createdAt') is distinct from 'string'
            or (v_edition ->> 'createdAt') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$'
            or left(v_edition ->> 'createdAt',4) = '0000'
            or jsonb_typeof(v_edition -> 'chapters') is distinct from 'array' then return false; end if;
          if (v_edition ->> 'fromYear') <> '' and (v_edition ->> 'toYear') <> ''
            and (v_edition ->> 'fromYear') > (v_edition ->> 'toYear') then return false; end if;
          -- Reject impossible dates as well as PostgreSQL's normalization of
          -- non-canonical times. The explicit UTC round trip matches the client.
          begin
            v_created_at := (v_edition ->> 'createdAt')::timestamptz;
          exception when datetime_field_overflow or invalid_datetime_format then return false;
          end;
          if to_char(v_created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> v_edition ->> 'createdAt' then return false; end if;
          v_ids := array_append(v_ids,v_edition ->> 'id');
          v_chapter_sets := v_chapter_sets || jsonb_build_array(v_edition -> 'chapters');
        end loop;
      end if;
      -- Current and snapshot chapters share one schema and one global ID set.
      -- Snapshots contain no recursive editions and retain archived/excluded data.
      for v_chapters in select value from jsonb_array_elements(v_chapter_sets) loop
        if jsonb_array_length(v_chapters) > 100 then return false; end if;
        for v_chapter in select value from jsonb_array_elements(v_chapters) loop
          if jsonb_typeof(v_chapter) is distinct from 'object' then return false; end if;
          if not (v_chapter ?& array['id','title','note','versionIds'])
            or v_chapter - array['id','title','note','versionIds','insights','archived'] <> '{}'::jsonb
            or jsonb_typeof(v_chapter -> 'id') is distinct from 'string' or (v_chapter ->> 'id') !~ '^[A-Za-z0-9_-]{1,128}$'
            or (v_chapter ? 'archived' and jsonb_typeof(v_chapter -> 'archived') is distinct from 'boolean')
            or not public.life_composition_text_valid(v_chapter -> 'title',500,true)
            or not public.life_composition_text_valid(v_chapter -> 'note',20000)
            or not public.life_composition_ids_valid(v_chapter -> 'versionIds',1000) then return false; end if;
          v_ids := array_append(v_ids,v_chapter ->> 'id');
          -- An interpretation is authored composition, never an assertion inferred
          -- from a saved original. Role lists are independent exact references.
          if v_chapter ? 'insights' then
            if jsonb_typeof(v_chapter -> 'insights') is distinct from 'array' then return false; end if;
            if jsonb_array_length(v_chapter -> 'insights') > 100 then return false; end if;
            for v_insight in select value from jsonb_array_elements(v_chapter -> 'insights') loop
              if jsonb_typeof(v_insight) is distinct from 'object' then return false; end if;
              if not (v_insight ?& array['id','statement','uncertainty','supportVersionIds','counterVersionIds','excluded'])
                or v_insight - array['id','statement','uncertainty','supportVersionIds','counterVersionIds','excluded'] <> '{}'::jsonb
                or jsonb_typeof(v_insight -> 'id') is distinct from 'string' or (v_insight ->> 'id') !~ '^[A-Za-z0-9_-]{1,128}$'
                or not public.life_composition_text_valid(v_insight -> 'statement',20000)
                or not public.life_composition_text_valid(v_insight -> 'uncertainty',20000)
                or not public.life_composition_ids_valid(v_insight -> 'supportVersionIds',100)
                or not public.life_composition_ids_valid(v_insight -> 'counterVersionIds',100)
                or jsonb_typeof(v_insight -> 'excluded') is distinct from 'boolean' then return false; end if;
              v_ids := array_append(v_ids,v_insight ->> 'id');
            end loop;
          end if;
        end loop;
      end loop;
    end loop;
  end if;
  -- Validate the global namespace once. Repeated linear scans make a valid
  -- near-2-MiB collection of short interpretations unnecessarily expensive.
  if (select count(*) <> count(distinct id) from unnest(v_ids) ids(id)) then return false; end if;
  return public.life_composition_json_bytes(p_data) <= 2097152;
end;
$function$;
notify pgrst,'reload schema';
commit;
