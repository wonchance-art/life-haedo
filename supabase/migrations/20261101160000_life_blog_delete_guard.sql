-- Explicit post deletion never removes a public post (2026-11-01 review B1).
-- A device can believe a post is unpublished while another device has just
-- published it; the server is the authority. Such a request deletes nothing
-- and reports 'published' so the client withdraws first. A stale revision
-- still reports 'conflict' and deletes nothing.
begin;
create or replace function haedo_blog_private.delete_post(p_post_id uuid,p_expected_revision bigint default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); p haedo_blog_private.posts%rowtype; paths jsonb; existed boolean;
begin
 if who is null then raise exception using errcode='42501',message='life_auth_required'; end if;
 if p_post_id is null or (p_expected_revision is not null and p_expected_revision not between 1 and 9007199254740991) then raise exception using errcode='22023',message='life_invalid_request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('blog:'||who::text||':'||p_post_id::text,0));
 select * into p from haedo_blog_private.posts where owner_id=who and id=p_post_id for update;
 existed:=found;
 if existed then
  if p_expected_revision is not null and p.revision<>p_expected_revision then return jsonb_build_object('status','conflict','revision',p.revision); end if;
  if exists(select 1 from haedo_blog_private.publications where owner_id=who and post_id=p_post_id and active) then
   return jsonb_build_object('status','published','revision',p.revision);
  end if;
  delete from haedo_blog_private.publications where owner_id=who and post_id=p_post_id;
  delete from haedo_blog_private.receipts where owner_id=who and post_id=p_post_id;
  delete from haedo_blog_private.posts where owner_id=who and id=p_post_id;
  update haedo_blog_private.assets set deleted_at=clock_timestamp() where owner_id=who and post_id=p_post_id and deleted_at is null;
 end if;
 delete from haedo_blog_private.assets a where a.owner_id=who and a.deleted_at is not null
  and not exists(select 1 from storage.objects o where o.bucket_id='haedo-blog-originals' and o.name=a.path);
 select coalesce(jsonb_agg(a.path order by a.path),'[]'::jsonb) into paths from haedo_blog_private.assets a
  where a.owner_id=who and a.post_id=p_post_id and a.deleted_at is not null;
 return jsonb_build_object('status',case when existed then 'deleted' else 'missing' end,'revision',coalesce(p.revision,0),'paths',paths);
end $$;
revoke all on function haedo_blog_private.delete_post(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function haedo_blog_private.delete_post(uuid,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
