-- Driver reports enter the same pending transport-exception queue as Web TMS.
-- They do not post freight, assign responsibility, or start financial approval.
begin;

create or replace function app_private.tms_submit_driver_mobile_exception(
  p_waybill_id uuid,
  p_request_key text,
  p_exception_type text,
  p_stage text,
  p_description text,
  p_occurred_at timestamptz,
  p_extra_freight numeric default null
) returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid := app_private.current_app_user_id();
  v_tenant uuid := app_private.current_user_tenant_id();
  v_driver uuid := app_private.current_user_driver_id();
  v_order uuid;
  v_waybill_no text;
  v_report uuid;
  v_description text := btrim(coalesce(p_description, ''));
begin
  if auth.uid() is null or not coalesce(app_private.is_driver_user(), false)
    or v_actor is null or v_tenant is null or v_driver is null then
    raise exception '仅已登录的司机可提交异常报备' using errcode = '42501';
  end if;
  if not coalesce(p_request_key ~ '^[A-Za-z0-9_-]{12,64}$', false)
    or not coalesce(p_exception_type in ('delay', 'damage', 'lost', 'detained'), false)
    or not coalesce(p_stage in ('pickup', 'transit', 'delivery'), false)
    or length(v_description) not between 2 and 1800
    or p_occurred_at is null or p_occurred_at > now()
    or (p_extra_freight is not null and (
      p_extra_freight <= 0 or p_extra_freight > 99999999.99 or scale(p_extra_freight) > 2
    )) then
    raise exception '请核对异常说明、发生时间和预计运费' using errcode = '22023';
  end if;

  -- Lock the owned waybill so duplicate retries are serialized for this report.
  select w.order_id, w.waybill_no into v_order, v_waybill_no
  from public.tms_waybill w
  join public.tms_order o on o.id = w.order_id and o.tenant_id = w.tenant_id
  where w.id = p_waybill_id and w.tenant_id = v_tenant and w.driver_id = v_driver
    and w.status <> 'cancelled' and o.order_status <> 'cancelled'
  for update of w;
  if v_order is null then
    raise exception '该运单不可报备，请核对运单或联系调度' using errcode = '42501';
  end if;

  select e.id into v_report from public.tms_order_exception e
  where e.tenant_id = v_tenant and e.order_id = v_order and e.created_by = v_actor
    and e.history #>> '{0,source}' = 'driver_mobile'
    and e.history #>> '{0,waybill_id}' = p_waybill_id::text
    and e.history #>> '{0,request_key}' = p_request_key
  limit 1;
  if v_report is not null then return v_report; end if;

  insert into public.tms_order_exception (
    tenant_id, order_id, exception_type, stage, description, occurred_at,
    created_by, updated_by, history
  ) values (
    v_tenant, v_order, p_exception_type, p_stage,
    v_description || case when p_extra_freight is null then ''
      else E'\n\n预计额外运费：¥' || p_extra_freight::text || '（司机报备，待复核）' end,
    p_occurred_at, v_actor, v_actor,
    jsonb_build_array(jsonb_build_object(
      'action', 'create', 'status', 'pending', 'actor', v_actor, 'at', now(),
      'source', 'driver_mobile', 'waybill_id', p_waybill_id, 'waybill_no', v_waybill_no, 'request_key', p_request_key,
      'extra_freight', p_extra_freight
    ))
  ) returning id into v_report;
  return v_report;
end;
$function$;

create or replace function app_private.tms_get_driver_mobile_exception_workspace()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_actor uuid := app_private.current_app_user_id();
  v_tenant uuid := app_private.current_user_tenant_id();
  v_driver uuid := app_private.current_user_driver_id();
begin
  if auth.uid() is null or not coalesce(app_private.is_driver_user(), false)
    or v_actor is null or v_tenant is null or v_driver is null then
    raise exception '仅已登录的司机可查看自己的异常报备' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'records', (
      select coalesce(jsonb_agg(to_jsonb(visible) order by visible.created_at desc, visible.id desc), '[]'::jsonb)
      from (
        select e.id, e.history #>> '{0,waybill_no}' as waybill_no,
          e.exception_type, e.stage, e.occurred_at, e.status, e.created_at,
          e.history #> '{0,extra_freight}' as extra_freight
        from public.tms_order_exception e
        where e.tenant_id = v_tenant and e.created_by = v_actor
          and e.history #>> '{0,source}' = 'driver_mobile'
        order by e.created_at desc, e.id desc
        limit 40
      ) visible
    ),
    'waybills', (
      select coalesce(jsonb_agg(to_jsonb(eligible) order by eligible.waybill_no desc, eligible.id desc), '[]'::jsonb)
      from (
        select w.id, w.waybill_no
        from public.tms_waybill w
        join public.tms_order o on o.id = w.order_id and o.tenant_id = w.tenant_id
        where w.tenant_id = v_tenant and w.driver_id = v_driver
          and w.status <> 'cancelled' and o.order_status <> 'cancelled'
        order by w.waybill_no desc, w.id desc
        limit 100
      ) eligible
    )
  );
end;
$function$;

create or replace function public.tms_submit_driver_mobile_exception(
  p_waybill_id uuid, p_request_key text, p_exception_type text, p_stage text,
  p_description text, p_occurred_at timestamptz, p_extra_freight numeric default null
) returns uuid
language sql security invoker set search_path = ''
as $$
  select app_private.tms_submit_driver_mobile_exception(
    p_waybill_id, p_request_key, p_exception_type, p_stage, p_description, p_occurred_at, p_extra_freight
  )
$$;

create or replace function public.tms_get_driver_mobile_exception_workspace()
returns jsonb
language sql stable security invoker set search_path = ''
as $$ select app_private.tms_get_driver_mobile_exception_workspace() $$;

revoke all on function app_private.tms_submit_driver_mobile_exception(uuid, text, text, text, text, timestamptz, numeric) from public, anon;
revoke all on function app_private.tms_get_driver_mobile_exception_workspace() from public, anon;
grant execute on function app_private.tms_submit_driver_mobile_exception(uuid, text, text, text, text, timestamptz, numeric) to authenticated;
grant execute on function app_private.tms_get_driver_mobile_exception_workspace() to authenticated;
revoke all on function public.tms_submit_driver_mobile_exception(uuid, text, text, text, text, timestamptz, numeric) from public, anon;
revoke all on function public.tms_get_driver_mobile_exception_workspace() from public, anon;
grant execute on function public.tms_submit_driver_mobile_exception(uuid, text, text, text, text, timestamptz, numeric) to authenticated;
grant execute on function public.tms_get_driver_mobile_exception_workspace() to authenticated;

commit;
