-- Read-only catalog/configuration check; never reads private blog documents.
begin read only;
select jsonb_build_object(
 'private_bucket',exists(select 1 from storage.buckets where id='haedo-blog-originals' and not public and file_size_limit=67108864),
 'private_schema',exists(select 1 from pg_namespace where nspname='haedo_blog_private'),
 'five_tables_rls',(select count(*)=5 and bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='haedo_blog_private' and c.relkind='r'),
 'owner_rpc_authenticated',has_function_privilege('authenticated','public.life_blog_save(uuid,uuid,bigint,uuid,jsonb)','execute'),
 'owner_rpc_not_anon',not has_function_privilege('anon','public.life_blog_save(uuid,uuid,bigint,uuid,jsonb)','execute'),
 'public_read_anon',has_function_privilege('anon','public.life_blog_public_read(uuid)','execute'),
 'media_rpc_server_only',has_function_privilege('service_role','public.life_blog_public_media(uuid,text)','execute') and not has_function_privilege('anon','public.life_blog_public_media(uuid,text)','execute') and not has_function_privilege('authenticated','public.life_blog_public_media(uuid,text)','execute'),
 'no_client_table_access',not has_table_privilege('authenticated','haedo_blog_private.posts','select') and not has_table_privilege('anon','haedo_blog_private.posts','select'),
 'four_restrictive_storage_guards',(select count(*)=4 from pg_policy where polrelid='storage.objects'::regclass and polname in('blog_originals_read_guard','blog_originals_insert_guard','blog_originals_update_guard','blog_originals_delete_guard') and not polpermissive),
 'nine_invoker_api_wrappers',(select count(*)=9 and bool_and(not p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('life_blog_list','life_blog_read','life_blog_save','life_blog_prepare_asset','life_blog_publish','life_blog_unpublish','life_blog_public_read','life_blog_public_list','life_blog_public_media')),
 'publication_cas_argument',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='life_blog_publish' and 'p_expected_publication_revision'=any(p.proargnames))
) as result;
rollback;
