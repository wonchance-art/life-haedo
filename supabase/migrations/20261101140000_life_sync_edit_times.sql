-- Compositions and library metadata may carry the writing device's local edit time (top-level "editedAt", an exact ISO-8601 UTC millisecond string) so automatic latest-wins conflict handling compares edit times, not upload times. The content validators are unchanged: the edit time is validated and removed before them. Clients fall back to sending without it while this migration is not installed.
begin;

-- Keep the existing composition validator body as the content check.
do $$
begin
 if to_regprocedure('public.life_composition_valid_content(jsonb)') is null then
  alter function public.life_composition_valid(jsonb) rename to life_composition_valid_content;
 end if;
end $$;

create or replace function public.life_composition_valid(p_data jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(p_data)='object'
  and (not (p_data ? 'editedAt') or public.life_library_date(p_data->'editedAt'))
  and public.life_composition_valid_content(p_data - 'editedAt'),false)
$$;
revoke all on function public.life_composition_valid(jsonb),public.life_composition_valid_content(jsonb) from public,anon,authenticated;

-- The table check referenced the renamed function by identity; point it at the wrapper.
alter table public.life_compositions drop constraint if exists life_composition_state;
alter table public.life_compositions add constraint life_composition_state check (
 public.life_composition_valid(data) and (data ->> 'workspaceId') is not distinct from workspace_id::text);

create or replace function public.life_library_meta_valid(v jsonb,w uuid,bundle jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_typeof(v)='object'
 and (not (v ? 'editedAt') or public.life_library_date(v->'editedAt'))
 and public.life_library_fields(v - 'editedAt',array['format','workspaceId','revision','sourceFolders','collection','nineBoard'])
 and v->>'format'='life-library-meta-v1' and v->>'workspaceId'=w::text
 and public.life_library_integer(v->'revision',0,9007199254740991)
 and public.life_library_folders_valid(v->'sourceFolders',w)
 and public.life_library_collection_valid(v->'collection',w)
 and public.life_library_nine_valid(v->'nineBoard',w,bundle)
 and public.life_composition_json_bytes(v)<=8388608,false)
$$;

notify pgrst, 'reload schema';
commit;
