-- Review before applying. This read-only contract returns certification for the
-- enabled driver bound to the active session, without exposing document files.
begin;

create or replace function app_private.tms_driver_certification_state(p_driver_id uuid, p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $body$
declare
  d public.mdm_driver%rowtype;
  p public.tms_driver_profile%rowtype;
  latest app_private.tms_driver_certification_review%rowtype;
  required boolean;
  reason text;
begin
  select * into d from public.mdm_driver where id = p_driver_id and tenant_id = p_tenant_id;
  if not found then
    raise exception '司机不存在或不在当前租户范围' using errcode = '42501';
  end if;

  select * into p from public.tms_driver_profile where driver_id = d.id and tenant_id = d.tenant_id;
  required := d.carrier_id is not null or (found and p.driver_ownership is distinct from 'self');
  select * into latest from app_private.tms_driver_certification_review r
  where r.tenant_id = d.tenant_id and r.driver_id = d.id order by r.review_seq desc limit 1;

  if required then
    if p.driver_id is null then
      reason := '司机缺少证件档案，请补齐归属和认证资料';
    elsif p.identity_auth_status is distinct from 'verified'
       or p.license_auth_status is distinct from 'verified'
       or p.qualification_auth_status is distinct from 'verified' then
      reason := '身份证、驾驶证和从业资格证尚未全部审核通过';
    elsif jsonb_array_length(app_private.vms_revoked_certificate_blockers(d.tenant_id, null, d.id)) > 0 then
      reason := '司机证件已作废，请登记有效新证后重新审核';
    elsif not coalesce(app_private.tms_driver_certification_documents_exist(d.id, d.tenant_id), false) then
      reason := '司机证件影像缺失，请重新上传并审核';
    elsif latest.driver_id is null or latest.decision is distinct from 'approved'
       or latest.document_fingerprint is distinct from app_private.tms_driver_certification_fingerprint(d.id, d.tenant_id) then
      reason := '司机证件审核记录缺失或资料已变更，请重新审核';
    end if;
  end if;

  return jsonb_build_object(
    'required', required,
    'certified', required and reason is null,
    'reason', reason,
    'reviewedAt', latest.reviewed_at,
    'identityStatus', coalesce(p.identity_auth_status, 'unverified'),
    'licenseStatus', coalesce(p.license_auth_status, 'unverified'),
    'qualificationStatus', coalesce(p.qualification_auth_status, 'unverified')
  );
end;
$body$;

revoke all on function app_private.tms_driver_certification_state(uuid, uuid) from public, anon, authenticated;

-- Keep the current administrator permission and read scope; share only the
-- decision rules so the mobile and administration views cannot diverge.
create or replace function public.tms_get_driver_certification_secure(p_driver_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $body$
declare
  v_tenant_id uuid;
begin
  if auth.uid() is null or not (
    app_private.has_permission('TmsDriver:View')
    or app_private.has_permission('TmsDriver:Audit')
    or app_private.is_platform_super()
  ) then
    raise exception '无司机认证查看权限' using errcode = '42501';
  end if;

  select driver.tenant_id into v_tenant_id from public.mdm_driver driver
  where driver.id = p_driver_id and app_private.tenant_in_current_read_scope(driver.tenant_id);
  if not found then
    raise exception '司机不存在或不在当前租户范围' using errcode = '42501';
  end if;

  return app_private.tms_driver_certification_state(p_driver_id, v_tenant_id)
    || jsonb_build_object('canReview', app_private.is_platform_super() or app_private.has_permission('TmsDriver:Audit'));
end;
$body$;

create or replace function app_private.tms_get_driver_mobile_certification()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $body$
declare
  v_tenant_id uuid := app_private.current_user_tenant_id();
  v_driver_id uuid := app_private.current_user_driver_id();
  v_scoped_tenant_id uuid := app_private.current_read_tenant_id();
begin
  if auth.uid() is null or not coalesce(app_private.is_driver_user(), false) or v_tenant_id is null or v_driver_id is null or not exists (
    select 1 from public.mdm_driver driver
    where driver.id = v_driver_id and driver.tenant_id = v_tenant_id and driver.enabled is true
      and (v_scoped_tenant_id is null or driver.tenant_id = v_scoped_tenant_id)
  ) then
    raise exception '当前账号未绑定启用的司机档案' using errcode = '42501';
  end if;

  return app_private.tms_driver_certification_state(v_driver_id, v_tenant_id);
end;
$body$;

create or replace function public.tms_get_driver_mobile_certification()
returns jsonb
language sql stable security invoker set search_path = ''
as $$ select app_private.tms_get_driver_mobile_certification() $$;

revoke all on function app_private.tms_get_driver_mobile_certification() from public, anon;
grant execute on function app_private.tms_get_driver_mobile_certification() to authenticated;
revoke all on function public.tms_get_driver_mobile_certification() from public, anon;
grant execute on function public.tms_get_driver_mobile_certification() to authenticated;

commit;
