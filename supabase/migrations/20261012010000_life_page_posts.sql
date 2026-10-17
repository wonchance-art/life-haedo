-- Page posts and detached attachment snapshots. Local installs before deploying this client.
-- No source rows, Auth configuration, tables, RPC signatures or existing grants change.
begin;
do $pre$ begin
 if to_regprocedure('public.life_composition_valid(jsonb)') is null or to_regprocedure('public.life_public_page_valid(jsonb)') is null then
 raise exception 'life_page_posts_prerequisite_missing'; end if;
end; $pre$;
create or replace function public.life_page_attachments_valid(p_items jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog
as $function$
declare v_item jsonb; v_url text; v_authority text; v_host text; v_port text; v_address inet;
begin
 if jsonb_typeof(p_items) is distinct from 'array' then return false; end if;
 if jsonb_array_length(p_items) > 12 then return false; end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(v_item) is distinct from 'object' then return false; end if;
  if not (v_item ?& array['type','title','creator','url']) or v_item - array['type','title','creator','url'] <> '{}'::jsonb
   or jsonb_typeof(v_item -> 'type') is distinct from 'string' or v_item ->> 'type' not in ('music','book','film','video','article','artwork','tool','person','place','other')
   or not public.life_public_page_text_valid(v_item -> 'title',500,true)
   or not public.life_public_page_text_valid(v_item -> 'creator',500)
   or not public.life_public_page_text_valid(v_item -> 'url',2048)
   or (v_item ->> 'type' = 'person' and v_item ->> 'creator' <> '') then return false; end if;
  if v_item ->> 'url' <> '' then
        v_url := v_item ->> 'url';
        if not public.life_public_page_text_valid(v_item -> 'url',2048,true) or v_url !~* '^https?://[^/?#]+'
          or v_url ~ U&'[\0001-\0020\007F\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'
          or position(chr(92) in v_url) > 0 then return false; end if;
        v_authority := substring(v_url from '(?i)^https?://([^/?#]+)');
        if position('@' in v_authority) > 0 then return false; end if;
        v_port := null;
        if left(v_authority,1) = '[' then
          if v_authority !~ '^\[[0-9a-fA-F:.]+\](:[0-9]{0,5})?$' then return false; end if;
          v_host := substring(v_authority from '^\[([^]]+)\]');
          begin v_address := v_host::inet; exception when invalid_text_representation then return false; end;
          if family(v_address) <> 6 then return false; end if;
          v_port := substring(v_authority from '\]:([0-9]*)$');
        else
          if v_authority !~ '^[^:]+(:[0-9]{0,5})?$' then return false; end if;
          v_host := split_part(v_authority,':',1);
          if v_host ~ '[%<>^|\[\]]' then return false; end if;
          if v_host ~ '(^|\.)[0-9]+\.?$' then
            begin v_address := rtrim(v_host,'.')::inet; exception when invalid_text_representation then return false; end;
            if family(v_address) <> 4 then return false; end if;
          end if;
          v_port := substring(v_authority from ':([0-9]*)$');
        end if;
        if nullif(v_port,'') is not null and v_port::integer > 65535 then return false; end if;
  end if;
 end loop;
 return true;
end;
$function$;
revoke all on function public.life_page_attachments_valid(jsonb) from public, anon, authenticated;

create or replace function public.life_composition_valid(p_data jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog
as $function$
declare
  v_post jsonb; v_date text; v_timestamp timestamptz; v_group jsonb; v_entry jsonb; v_part jsonb; v_pair jsonb; v_page jsonb; v_reflection jsonb;
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
    or v_page - array['title','intro','showIntro','showRecent','entries','posts'] <> '{}'::jsonb
    or not public.life_composition_text_valid(v_page -> 'title',500,true)
    or not public.life_composition_text_valid(v_page -> 'intro',20000)
    or jsonb_typeof(v_page -> 'showIntro') is distinct from 'boolean'
    or jsonb_typeof(v_page -> 'showRecent') is distinct from 'boolean'
    or jsonb_typeof(v_page -> 'entries') is distinct from 'array' then return false; end if;
  if v_page ? 'posts' then
    if jsonb_typeof(v_page -> 'posts') is distinct from 'array' then return false; end if;
    if jsonb_array_length(v_page -> 'posts') > 200 then return false; end if;
    for v_post in select value from jsonb_array_elements(v_page -> 'posts') loop
      if jsonb_typeof(v_post) is distinct from 'object' then return false; end if;
      if not (v_post ?& array['id','status','replaces','baseUpdatedAt','body','attachments','visibility','createdAt','updatedAt'])
        or v_post - array['id','status','replaces','baseUpdatedAt','body','attachments','visibility','createdAt','updatedAt'] <> '{}'::jsonb
        or jsonb_typeof(v_post -> 'id') is distinct from 'string' or v_post ->> 'id' !~ '^[A-Za-z0-9_-]{1,128}$'
        or v_post -> 'status' is distinct from '"saved"'::jsonb
        or v_post -> 'replaces' is distinct from 'null'::jsonb or v_post -> 'baseUpdatedAt' is distinct from 'null'::jsonb
        or jsonb_typeof(v_post -> 'visibility') is distinct from 'string' or v_post ->> 'visibility' not in ('private','page')
        or not public.life_public_page_text_valid(v_post -> 'body',20000)
        or not public.life_page_attachments_valid(v_post -> 'attachments') then return false; end if;
      if not public.life_public_page_text_valid(v_post -> 'body',20000,true) and jsonb_array_length(v_post -> 'attachments') = 0 then return false; end if;
      foreach v_date in array array['createdAt','updatedAt'] loop
        if jsonb_typeof(v_post -> v_date) is distinct from 'string' or v_post ->> v_date !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$' then return false; end if;
        begin
          v_timestamp := (v_post ->> v_date)::timestamptz;
          if to_char(v_timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> v_post ->> v_date then return false; end if;
        exception when others then return false; end;
      end loop;
      if v_post ->> 'updatedAt' < v_post ->> 'createdAt' then return false; end if;
      v_ids := array_append(v_ids,v_post ->> 'id');
    end loop;
  end if;
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

create or replace function public.life_public_page_valid(p_snapshot jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog
as $function$
declare
  v_entry jsonb; v_part jsonb; v_omission jsonb; v_value jsonb;
  v_total integer := 0; v_url text; v_authority text; v_host text; v_port text; v_address inet;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object' then return false; end if;
  if octet_length(convert_to(p_snapshot::text, 'UTF8')) > 2097152 then return false; end if;
  if not (p_snapshot ?& array['format','title','intro','entries'])
    or p_snapshot - array['format','title','intro','entries'] <> '{}'::jsonb
    or p_snapshot -> 'format' is distinct from '"life-share-v1"'::jsonb
    or not public.life_public_page_text_valid(p_snapshot -> 'title',500,true)
    or (p_snapshot -> 'intro' <> 'null'::jsonb and not public.life_public_page_text_valid(p_snapshot -> 'intro',50000))
    or jsonb_typeof(p_snapshot -> 'entries') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_snapshot -> 'entries') > 100 then return false; end if;
  for v_entry in select value from jsonb_array_elements(p_snapshot -> 'entries') loop
    if jsonb_typeof(v_entry) is distinct from 'object' then return false; end if;
    if not (v_entry ?& array['title','pinned','note','parts'])
      or v_entry - array['title','pinned','note','parts','attachments'] <> '{}'::jsonb
      or not public.life_public_page_text_valid(v_entry -> 'title',500,true)
      or jsonb_typeof(v_entry -> 'pinned') is distinct from 'boolean'
      or (v_entry -> 'note' <> 'null'::jsonb and not public.life_public_page_text_valid(v_entry -> 'note',50000))
      or jsonb_typeof(v_entry -> 'parts') is distinct from 'array' then return false; end if;
    if jsonb_array_length(v_entry -> 'parts') > 100 then return false; end if;
    if v_entry ? 'attachments' then
      if not public.life_page_attachments_valid(v_entry -> 'attachments') or jsonb_array_length(v_entry -> 'parts') <> 0 then return false; end if;
      v_total := v_total + jsonb_array_length(v_entry -> 'attachments');
    end if;
    v_total := v_total + jsonb_array_length(v_entry -> 'parts');
    if v_total > 200 then return false; end if;
    for v_part in select value from jsonb_array_elements(v_entry -> 'parts') loop
      if jsonb_typeof(v_part) is distinct from 'object' then return false; end if;
      if not (v_part ?& array['title','origin','url','author','originalCreatedAt','coverage','text','textKind'])
        or v_part - array['title','origin','url','author','originalCreatedAt','coverage','text','textKind'] <> '{}'::jsonb
        or not public.life_public_page_text_valid(v_part -> 'title',500,true)
        or jsonb_typeof(v_part -> 'origin') is distinct from 'string'
        or v_part ->> 'origin' not in ('apple_notes','obsidian','naver_blog','instagram','other')
        or jsonb_typeof(v_part -> 'textKind') is distinct from 'string'
        or v_part ->> 'textKind' not in ('none','body','excerpt') then return false; end if;
      if v_part ->> 'textKind' = 'none' then
        if v_part -> 'text' is distinct from 'null'::jsonb then return false; end if;
      elsif not public.life_public_page_text_valid(v_part -> 'text',50000,true) then return false;
      end if;
      if v_part -> 'originalCreatedAt' <> 'null'::jsonb and not public.life_public_page_text_valid(v_part -> 'originalCreatedAt',200) then return false; end if;
      if v_part -> 'url' <> 'null'::jsonb then
        if jsonb_typeof(v_part -> 'url') is distinct from 'string' then return false; end if;
        v_url := v_part ->> 'url';
        if not public.life_public_page_text_valid(v_part -> 'url',2048,true) or v_url !~* '^https?://[^/?#]+'
          or v_url ~ U&'[\0001-\0020\007F\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'
          or position(chr(92) in v_url) > 0 then return false; end if;
        v_authority := substring(v_url from '(?i)^https?://([^/?#]+)');
        if position('@' in v_authority) > 0 then return false; end if;
        v_port := null;
        if left(v_authority,1) = '[' then
          if v_authority !~ '^\[[0-9a-fA-F:.]+\](:[0-9]{0,5})?$' then return false; end if;
          v_host := substring(v_authority from '^\[([^]]+)\]');
          begin v_address := v_host::inet; exception when invalid_text_representation then return false; end;
          if family(v_address) <> 6 then return false; end if;
          v_port := substring(v_authority from '\]:([0-9]*)$');
        else
          if v_authority !~ '^[^:]+(:[0-9]{0,5})?$' then return false; end if;
          v_host := split_part(v_authority,':',1);
          if v_host ~ '[%<>^|\[\]]' then return false; end if;
          if v_host ~ '(^|\.)[0-9]+\.?$' then
            begin v_address := rtrim(v_host,'.')::inet; exception when invalid_text_representation then return false; end;
            if family(v_address) <> 4 then return false; end if;
          end if;
          v_port := substring(v_authority from ':([0-9]*)$');
        end if;
        if nullif(v_port,'') is not null and v_port::integer > 65535 then return false; end if;
      end if;
      v_value := v_part -> 'author';
      if jsonb_typeof(v_value) is distinct from 'object' then return false; end if;
      if not (v_value ?& array['label','relation']) or v_value - array['label','relation'] <> '{}'::jsonb
        or not public.life_public_page_text_valid(v_value -> 'label',200)
        or jsonb_typeof(v_value -> 'relation') is distinct from 'string' or v_value ->> 'relation' not in ('self','other','unknown') then return false; end if;
      v_value := v_part -> 'coverage';
      if jsonb_typeof(v_value) is distinct from 'object' then return false; end if;
      if not (v_value ?& array['status','omissions']) or v_value - array['status','omissions'] <> '{}'::jsonb
        or jsonb_typeof(v_value -> 'status') is distinct from 'string' or v_value ->> 'status' not in ('full_text','partial','link_only','unknown')
        or jsonb_typeof(v_value -> 'omissions') is distinct from 'array' then return false; end if;
      if jsonb_array_length(v_value -> 'omissions') > 20 then return false; end if;
      for v_omission in select value from jsonb_array_elements(v_value -> 'omissions') loop
        if not public.life_public_page_text_valid(v_omission,300) then return false; end if;
      end loop;
      if v_value ->> 'status' = 'link_only' and v_part ->> 'textKind' <> 'none' then return false; end if;
    end loop;
  end loop;
  return public.life_public_page_json_bytes(p_snapshot) <= 1048576;
end;
$function$;
commit;
