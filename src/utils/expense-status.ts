import type { DriverExpenseAuditStatus, WaybillStatus } from '@/api/types'
import type { MobileStatusTone } from '@mobile-core/theme'

const statusMeta: Record<DriverExpenseAuditStatus, { label: string; tone: MobileStatusTone }> = {
  draft: { label: '草稿', tone: 'gray' },
  pending_review: { label: '审批中', tone: 'blue' },
  approved: { label: '已通过', tone: 'green' },
  rejected: { label: '已驳回', tone: 'red' },
  voided: { label: '已作废', tone: 'gray' },
}

export function getExpenseAuditStatus(status: DriverExpenseAuditStatus) {
  return statusMeta[status] ?? { label: '状态待确认', tone: 'gray' as const }
}

export function canReportWaybillExpense(status: WaybillStatus) {
  return ['accepted', 'loading', 'transporting', 'unloading', 'signed', 'completed'].includes(status)
}
