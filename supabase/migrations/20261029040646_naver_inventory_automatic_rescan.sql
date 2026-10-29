-- Restart invalidated automatic inventory scans from a fresh observation set.
-- No activation, new privileges, baseline rewrite, or deletion of captured data.
-- New scan_id isolates previous inventory_seen rows without deleting history.
begin;
create or replace function haedo_naver_private.inventory_claim(p_limit integer default 1,p_subscription_id uuid default null,p_owner_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare s public.life_naver_subscriptions%rowtype;i haedo_naver_private.inventory%rowtype;result jsonb:='[]';
begin
 if p_limit is null or p_limit not between 1 and 2 or (p_subscription_id is null)<>(p_owner_id is null) then raise exception using errcode='22023',message='life_naver_invalid_request';end if;
 perform 1 from haedo_naver_private.runtime where singleton and ready for share;if not found then return result;end if;
 for s in select sub.* from public.life_naver_subscriptions sub join haedo_naver_private.inventory inv on inv.subscription_id=sub.id
  where (p_subscription_id is null and sub.enabled and inv.next_check_at<=clock_timestamp() or sub.id=p_subscription_id and sub.owner_id=p_owner_id)
   and (inv.lease_until is null or inv.lease_until<=clock_timestamp()) order by inv.next_check_at,sub.id for update of sub skip locked limit p_limit loop
  select * into i from haedo_naver_private.inventory where subscription_id=s.id for update;
  if i.lease_until>clock_timestamp() then continue;end if;
  if i.status='complete' or i.last_error in ('inventory_changed','inventory_incomplete') then
   update haedo_naver_private.inventory set scan_id=gen_random_uuid(),page=1,total_start=null,revision=revision+1 where subscription_id=s.id;
  end if;
  update haedo_naver_private.inventory set status='running',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',subscription_revision=s.revision where subscription_id=s.id returning * into i;
  result:=result||jsonb_build_array(jsonb_build_object('subscription_id',s.id,'owner_id',s.owner_id,'blog_id',s.blog_id,'revision',i.revision,'subscription_revision',s.revision,
   'lease_token',i.lease_token,'lease_until',i.lease_until,'scan_id',i.scan_id,'page',i.page,'page_size',30,'total_start',i.total_start));
 end loop;
 return result;
end $$;
commit;
