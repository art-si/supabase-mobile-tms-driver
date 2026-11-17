-- Reviewable driver-only contract. Apply in the TMS project only after approval.
-- The dispatcher's existing menu permissions, status actions, snapshot trigger,
-- and numbering remain authoritative.
begin;

create or replace function app_private.tms_driver_mobile_appointment_context(
  p_kind text, p_offset integer
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_driver uuid := app_private.current_user_driver_id();
  v_tenant uuid := app_private.auth_user_tenant_id();
  v_status text := case p_kind when 'pickup' then 'accepted' when 'delivery' then 'transporting' end;
  v_records jsonb;
  v_has_more boolean;
  v_eligible jsonb;
begin
  if auth.uid() is null or not coalesce(app_private.is_driver_user(), false) or v_driver is null or v_tenant is null then
    raise exception '当前账号没有司机预约权限' using errcode='42501';
  end if;
  if v_status is null or p_offset is null or p_offset < 0 or p_offset > 10000 then
    raise exception '预约查询条件无效' using errcode='22023';
  end if;

  with page_rows as (
    select a.id, a.appointment_no, a.scheduled_at, a.status, a.dock_name, a.arrived_at, a.create_time,
           own.id as waybill_id, own.waybill_no,
           case when a.created_by_user_id = (select auth.uid()) then a.remark end as own_remark
    from public.tms_waybill_appointment a
    cross join lateral (
      select w.id, w.waybill_no
      from public.tms_waybill w
      where w.id = any(a.selected_waybill_ids) and w.tenant_id = v_tenant and w.driver_id = v_driver
      order by (w.id = a.anchor_waybill_id) desc, w.id
      limit 1
    ) own
    where a.tenant_id = v_tenant and a.kind = p_kind
    order by a.scheduled_at desc, a.create_time desc, a.id desc
    limit 21 offset p_offset
  ), numbered as (
    select *, row_number() over (order by scheduled_at desc, create_time desc, id desc) as row_number
    from page_rows
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'appointmentNo', appointment_no, 'waybillId', waybill_id, 'waybillNo', waybill_no,
           'scheduledAt', scheduled_at, 'status', status, 'dockName', dock_name, 'arrivedAt', arrived_at,
           'remark', own_remark
         ) order by row_number) filter (where row_number <= 20), '[]'::jsonb), count(*) > 20
    into v_records, v_has_more
  from numbered;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', candidate.id, 'waybillNo', candidate.waybill_no, 'station', candidate.station,
           'plateNo', candidate.plate_no
         ) order by candidate.create_time desc, candidate.id desc), '[]'::jsonb)
    into v_eligible
  from (
    select w.id, w.waybill_no, w.create_time, v.plate_no,
           case p_kind when 'pickup' then w.origin_city else w.destination_city end as station
    from public.tms_waybill w
    join public.mdm_driver d on d.id=w.driver_id and d.tenant_id=w.tenant_id and d.enabled
    join public.mdm_vehicle v on v.id=w.vehicle_id and v.tenant_id=w.tenant_id
    where w.tenant_id=v_tenant and w.driver_id=v_driver and w.status=v_status
      and (p_kind='pickup' or w.arrived_at is null)
      and char_length(btrim(d.driver_name)) between 1 and 60 and d.phone ~ '^[+0-9() -]{6,24}$'
      and char_length(btrim(v.plate_no)) between 1 and 24
      and not exists (
        select 1 from public.tms_waybill_appointment a
        where a.tenant_id=v_tenant and a.kind=p_kind and w.id=any(a.selected_waybill_ids)
      )
    order by w.create_time desc, w.id desc
    limit 100
  ) candidate;
  return jsonb_build_object('records', v_records, 'hasMore', v_has_more, 'eligibleWaybills', v_eligible);
end
$$;

create or replace function app_private.tms_driver_mobile_submit_appointment(
  p_kind text, p_waybill_id uuid, p_scheduled_at timestamptz, p_remark text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_driver uuid := app_private.current_user_driver_id();
  v_tenant uuid := app_private.auth_user_tenant_id();
  v_status text := case p_kind when 'pickup' then 'accepted' when 'delivery' then 'transporting' end;
  v_waybill public.tms_waybill%rowtype;
  v_snapshot jsonb;
  v_remark text := nullif(btrim(coalesce(p_remark, '')), '');
  v_id uuid;
begin
  if auth.uid() is null or not coalesce(app_private.is_driver_user(), false) or v_driver is null or v_tenant is null then
    raise exception '当前账号没有司机预约权限' using errcode='42501';
  end if;
  if v_status is null or p_waybill_id is null or p_scheduled_at is null or not isfinite(p_scheduled_at)
     or p_scheduled_at <= now() or char_length(coalesce(v_remark, '')) > 300 then
    raise exception '请选择晚于当前时间的预约时间，备注最多 300 字' using errcode='22023';
  end if;
  select * into v_waybill from public.tms_waybill w
  where w.id=p_waybill_id and w.tenant_id=v_tenant and w.driver_id=v_driver
  for update;
  if not found then
    raise exception '此运单未派给当前司机' using errcode='42501';
  end if;
  if v_waybill.status is distinct from v_status or (p_kind='delivery' and v_waybill.arrived_at is not null) then
    raise exception '运单状态已更新，暂不能提交此类预约' using errcode='23514';
  end if;

  -- Serializes repeated driver submissions on the same waybill.
  if exists (
    select 1 from public.tms_waybill_appointment a
    where a.tenant_id=v_tenant and a.kind=p_kind and p_waybill_id=any(a.selected_waybill_ids)
  ) then
    raise exception '此运单已有同类预约，请返回预约记录查看' using errcode='23505';
  end if;

  v_snapshot := app_private.tms_appointment_snapshot(p_waybill_id);
  if coalesce(char_length(btrim(v_snapshot->>'driverName')), 0) not between 1 and 60
     or coalesce(v_snapshot->>'driverPhone', '') !~ '^[+0-9() -]{6,24}$'
     or coalesce(char_length(btrim(v_snapshot->>'plateNo')), 0) not between 1 and 24 then
    raise exception '司机或车辆资料不完整，请联系调度补全' using errcode='23514';
  end if;
  insert into public.tms_waybill_appointment(
    tenant_id, kind, anchor_waybill_id, selected_waybill_ids, status,
    driver_name, driver_phone, plate_no, load_capacity_ton, vehicle_length_m,
    scheduled_at, remark, created_by_user_id
  ) values (
    v_tenant, p_kind, p_waybill_id, array[p_waybill_id], 'confirming',
    v_snapshot->>'driverName', v_snapshot->>'driverPhone', v_snapshot->>'plateNo',
    (v_snapshot->>'loadCapacityTon')::numeric, (v_snapshot->>'vehicleLengthM')::numeric,
    p_scheduled_at, v_remark, (select auth.uid())
  ) returning id into v_id;
  return v_id;
end
$$;

create or replace function public.tms_get_driver_mobile_appointment_context(
  p_kind text, p_offset integer default 0
) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select app_private.tms_driver_mobile_appointment_context(p_kind, p_offset) $$;

create or replace function public.tms_submit_driver_mobile_appointment(
  p_kind text, p_waybill_id uuid, p_scheduled_at timestamptz, p_remark text default null
) returns uuid
language sql security invoker set search_path = ''
as $$ select app_private.tms_driver_mobile_submit_appointment(p_kind, p_waybill_id, p_scheduled_at, p_remark) $$;

revoke execute on function app_private.tms_driver_mobile_appointment_context(text, integer) from public, anon;
revoke execute on function app_private.tms_driver_mobile_submit_appointment(text, uuid, timestamptz, text) from public, anon;
revoke execute on function public.tms_get_driver_mobile_appointment_context(text, integer) from public, anon;
revoke execute on function public.tms_submit_driver_mobile_appointment(text, uuid, timestamptz, text) from public, anon;
grant execute on function app_private.tms_driver_mobile_appointment_context(text, integer) to authenticated;
grant execute on function app_private.tms_driver_mobile_submit_appointment(text, uuid, timestamptz, text) to authenticated;
grant execute on function public.tms_get_driver_mobile_appointment_context(text, integer) to authenticated;
grant execute on function public.tms_submit_driver_mobile_appointment(text, uuid, timestamptz, text) to authenticated;

commit;
