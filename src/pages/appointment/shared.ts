import type { AppointmentKind, AppointmentStatus } from '@/api/appointment'
import type { MobileStatusTone } from '@mobile-core/theme'
import { watchMobilePageQuery } from '@mobile-core/watchMobilePageQuery'

export const appointmentTypes = {
  pickup: { title: '提货预约', scope: '接单后、装货前可申请提货入场。' },
  delivery: { title: '送货预约', scope: '发车后、到达卸货地前可申请送货入场。' }
} as const

export const appointmentStates = {
  confirming: { label: '待确认', tone: 'orange' },
  confirmed: { label: '已确认', tone: 'blue' },
  completed: { label: '已完结', tone: 'green' }
} satisfies Record<AppointmentStatus, { label: string; tone: MobileStatusTone }>

export function appointmentKind(value: unknown): AppointmentKind {
  return value === 'delivery' ? 'delivery' : 'pickup'
}

type AppointmentQuery = { kind?: unknown; id?: unknown }

export function watchAppointmentQuery(page: 'index' | 'apply', callback: (query: AppointmentQuery) => void) {
  watchMobilePageQuery(`/pages/appointment/${page}`, callback)
}
