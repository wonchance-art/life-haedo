-- 해도 네이버 수집 상태 확인 (읽기 전용, Supabase SQL Editor에서 실행)
-- 아무것도 바꾸지 않는다. 블로그 ID·글 제목·URL·본문·키는 출력하지 않고 개수·상태·시각만 보여 준다.
-- 결과 표를 그대로 복사해 전달하면 다음 단계를 정할 수 있다.
select 1 as ord, 'runtime ready' as item,
       coalesce((select ready::text from haedo_naver_private.runtime where singleton), 'missing') as value
union all
select 2, 'cron jobs (name:active:schedule)',
       coalesce((select string_agg(jobname || ':' || active || ':' || schedule, ' | ' order by jobname)
                 from cron.job where jobname like 'haedo-naver-%'), 'none')
union all
select 3, 'last 6 cron runs (job:status:start)',
       coalesce((select string_agg(x, ' | ') from (
         select j.jobname || ':' || d.status || ':' || to_char(d.start_time at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as x
         from cron.job_run_details d join cron.job j on j.jobid = d.jobid
         where j.jobname like 'haedo-naver-%' order by d.start_time desc limit 6) r), 'none')
union all
select 4, 'subscriptions (enabled/total)',
       (select count(*) filter (where enabled) || '/' || count(*) from public.life_naver_subscriptions)
union all
select 5, 'enabled subscription last check / success / error',
       case when not exists(select 1 from public.life_naver_subscriptions where enabled) then 'no enabled subscription'
            else (select coalesce(to_char(max(last_checked_at) at time zone 'Asia/Seoul', 'MM-DD HH24:MI'), 'never') || ' / ' ||
                         coalesce(to_char(max(last_success_at) at time zone 'Asia/Seoul', 'MM-DD HH24:MI'), '-') || ' / ' ||
                         coalesce(string_agg(distinct left(last_error, 60), ','), '-')
                  from public.life_naver_subscriptions where enabled) end
union all
-- Automatic list checks only claim subscriptions that already have an inventory row;
-- the app creates it with the owner's first "과거 공개 글 목록 확인".
select 5.5, 'enabled subscriptions without inventory (need first list check in app)',
       (select count(*)::text from public.life_naver_subscriptions s
        where s.enabled and not exists(select 1 from haedo_naver_private.inventory i where i.subscription_id = s.id))
union all
select 6, 'inventory sub:status:page:method:baseline_count',
       coalesce((select string_agg(case when s.enabled then 'on' else 'off' end || ':' || i.status || ':' || i.page || ':' ||
                                   coalesce(i.baseline_method, '-') || ':' || coalesce(i.baseline_count::text, '-'), ' | ' order by s.enabled desc)
                 from haedo_naver_private.inventory i join public.life_naver_subscriptions s on s.id = i.subscription_id), 'none')
union all
select 7, 'inventory sub: baseline done / last check / next check / error',
       coalesce((select string_agg(case when s.enabled then 'on' else 'off' end || ': ' ||
                                   coalesce(to_char(i.baseline_completed_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI'), 'not yet') || ' / ' ||
                                   coalesce(to_char(i.last_checked_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI'), '-') || ' / ' ||
                                   to_char(i.next_check_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') || ' / ' ||
                                   coalesce(left(i.last_error, 60), '-'), ' | ' order by s.enabled desc)
                 from haedo_naver_private.inventory i join public.life_naver_subscriptions s on s.id = i.subscription_id), 'none')
union all
select 8, 'observations (verified/complete/total, latest pages:seen)',
       (select count(*) filter (where verified) || '/' || count(*) filter (where completed_at is not null) || '/' || count(*) ||
               ', ' || coalesce((select last_page || ':' || seen_count from haedo_naver_private.inventory_scan_observations
                                 order by started_at desc limit 1), '-')
        from haedo_naver_private.inventory_scan_observations)
union all
select 9, 'listed posts (total / baseline / new after baseline / auto eligible)',
       (select count(*) || ' / ' || count(*) filter (where baseline) || ' / ' || count(*) filter (where not baseline) ||
               ' / ' || count(*) filter (where auto_eligible)
        from haedo_naver_private.inventory_entries)
union all
select 10, 'capture jobs by status',
       coalesce((select string_agg(status || ':' || n, ' ' order by status)
                 from (select status, count(*) n from haedo_naver_private.capture_jobs group by status) s), 'none')
union all
select 11, 'stored captures',
       (select count(*)::text from public.life_naver_captures)
order by ord;
