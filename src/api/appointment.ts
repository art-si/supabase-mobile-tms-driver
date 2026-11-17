import { ApiRequestError, getUserFacingErrorMessage, rpc } from './supabase'

export type AppointmentKind = 'pickup' | 'delivery'
export type AppointmentStatus = 'confirming' | 'confirmed' | 'completed'

export interface DriverAppointment {
  id: string
  appointmentNo: string
  waybillId: string
  waybillNo: string
  scheduledAt: string
  status: AppointmentStatus
  dockName: string | null
  arrivedAt: string | null
  remark: string | null
}

export interface EligibleAppointmentWaybill {
  id: string
  waybillNo: string
  station: string | null
  plateNo: string
}

export interface DriverAppointmentContext {
  records: DriverAppointment[]
  hasMore: boolean
  eligibleWaybills: EligibleAppointmentWaybill[]
}

export function getDriverAppointmentContext(token: string, kind: AppointmentKind, offset = 0) {
  return rpc<DriverAppointmentContext>(token, 'tms_get_driver_mobile_appointment_context', {
    p_kind: kind, p_offset: offset
  })
}

export function submitDriverAppointment(
  token: string, kind: AppointmentKind, waybillId: string, scheduledAt: string, remark: string
) {
  return rpc<string>(token, 'tms_submit_driver_mobile_appointment', {
    p_kind: kind, p_waybill_id: waybillId, p_scheduled_at: scheduledAt, p_remark: remark.trim() || null
  })
}

export function appointmentError(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError && (error.code === 'PGRST202' || error.code === '42883')) {
    return '司机预约服务尚未开通，请联系调度办理。'
  }
  return getUserFacingErrorMessage(error, fallback)
}
