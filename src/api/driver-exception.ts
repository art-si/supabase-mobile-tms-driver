import { ApiRequestError, getUserFacingErrorMessage, rpc } from './supabase'

export type DriverExceptionType = 'delay' | 'damage' | 'lost' | 'detained'
export type DriverExceptionStage = 'pickup' | 'transit' | 'delivery'

export interface DriverException {
  id: string
  waybillNo: string
  exceptionType: DriverExceptionType
  stage: DriverExceptionStage
  occurredAt: string
  status: 'pending' | 'in_progress' | 'resolved' | 'closed'
  extraFreight: number | null
}

export interface DriverExceptionWorkspace {
  records: DriverException[]
  waybills: { id: string; waybillNo: string }[]
}

export function getDriverExceptionWorkspace(token: string) {
  return rpc<DriverExceptionWorkspace>(token, 'tms_get_driver_mobile_exception_workspace', {})
}

export function submitDriverException(token: string, input: {
  waybillId: string
  requestKey: string
  exceptionType: DriverExceptionType
  stage: DriverExceptionStage
  description: string
  occurredAt: string
  extraFreight: number | null
}) {
  return rpc<string>(token, 'tms_submit_driver_mobile_exception', {
    p_waybill_id: input.waybillId,
    p_request_key: input.requestKey,
    p_exception_type: input.exceptionType,
    p_stage: input.stage,
    p_description: input.description,
    p_occurred_at: input.occurredAt,
    p_extra_freight: input.extraFreight
  })
}

export function driverExceptionError(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError && error.code === 'PGRST202') {
    return '异常报备服务尚未开通。当前有异常时，请先联系调度。'
  }
  return getUserFacingErrorMessage(error, fallback)
}
