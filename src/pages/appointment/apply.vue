<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { createLatestRequest } from '@mobile-core/latest-request'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileEmptyState from '@mobile-core/components/MobileEmptyState.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobilePickerTrigger from '@mobile-core/components/MobilePickerTrigger.vue'
import MobileSelect from '@mobile-core/components/MobileSelect.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import TmsPageSkeleton from '@mobile-core/components/TmsPageSkeleton.vue'
import { revealControl } from '@mobile-core/form-focus'
import TmsDateTimePicker from '@/components/business/TmsDateTimePicker.vue'
import {
  appointmentError, getDriverAppointmentContext, submitDriverAppointment,
  type AppointmentKind, type EligibleAppointmentWaybill
} from '@/api/appointment'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime } from '@/utils/format'
import { appointmentKind, appointmentTypes, watchAppointmentQuery } from './shared'

const { themeName } = usePageTheme()
const auth = useAuthStore()
const kind = ref<AppointmentKind>('pickup')
const info = computed(() => appointmentTypes[kind.value])
const listUrl = computed(() => `/pages/appointment/index?kind=${kind.value}`)
const requestedId = ref('')
const eligible = ref<EligibleAppointmentWaybill[] | null>(null)
const selectedId = ref('')
const selected = computed(() => eligible.value?.find(item => item.id === selectedId.value))
const choices = computed(() => eligible.value?.map(item => ({
  id: item.id, name: [item.waybillNo, item.station].filter(Boolean).join(' · ')
})) || [])
const scheduledAt = ref<number>()
const formattedDate = computed(() => scheduledAt.value ? formatDateTime(new Date(scheduledAt.value).toISOString()) : '')
const dateOpen = ref(false)
const remark = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const saveError = ref('')
const validatedAt = ref(0)
const waybillError = computed(() => validatedAt.value && !selected.value ? '请选择预约运单。' : '')
const dateError = computed(() => {
  if (!validatedAt.value) return ''
  if (!scheduledAt.value) return '请选择预计入场时间。'
  return scheduledAt.value <= validatedAt.value ? '入场时间须晚于当前时间。' : ''
})
const defaultDate = new Date()
defaultDate.setMinutes(0, 0, 0)
defaultDate.setHours(defaultDate.getHours() + 1)
const requests = createLatestRequest()
let entryKind: AppointmentKind = 'pickup'

onLoad(query => {
  kind.value = appointmentKind(query?.kind)
  entryKind = kind.value
  requestedId.value = typeof query?.id === 'string' ? query.id : ''
  void load()
})
onUnload(requests.invalidate)
watchAppointmentQuery('apply', query => {
  const nextKind = appointmentKind(query.kind)
  const nextId = typeof query.id === 'string' ? query.id : ''
  if (nextKind === kind.value && nextId === requestedId.value) return
  requests.invalidate()
  kind.value = nextKind
  requestedId.value = nextId
  eligible.value = null
  selectedId.value = ''
  scheduledAt.value = undefined
  dateOpen.value = false
  remark.value = ''
  loading.value = false
  saving.value = false
  saveError.value = ''
  validatedAt.value = 0
  void load()
})

async function load() {
  if (loading.value) return
  const isCurrent = requests.snapshot()
  const requestKind = kind.value
  loading.value = true
  error.value = ''
  try {
    if (!await auth.ensureValidSession() || !isCurrent()) return
    const context = await auth.withFreshAccess(token => getDriverAppointmentContext(token, requestKind))
    if (!isCurrent()) return
    const candidates = requestedId.value
      ? context.eligibleWaybills.filter(item => item.id === requestedId.value)
      : context.eligibleWaybills
    eligible.value = candidates
    if (candidates.length === 1) selectedId.value = candidates[0]?.id || ''
  } catch (cause) {
    if (isCurrent()) error.value = appointmentError(cause, '申请信息同步失败，请稍后重试。')
  } finally {
    if (isCurrent()) loading.value = false
  }
}

function backToRecords() {
  const pages = getCurrentPages()
  if (kind.value === entryKind && pages[pages.length - 2]?.route === 'pages/appointment/index') uni.navigateBack()
  else uni.redirectTo({ url: listUrl.value })
}

async function submit() {
  if (saving.value) return
  saveError.value = ''
  validatedAt.value = Date.now()
  const waybill = selected.value
  const time = scheduledAt.value
  if (!waybill || !time || time <= validatedAt.value) {
    await revealControl(!waybill ? 'appointment-waybill' : 'appointment-time')
    return
  }
  const isCurrent = requests.snapshot()
  const requestKind = kind.value
  const requestRemark = remark.value
  saving.value = true
  try {
    await auth.withFreshAccess(token => submitDriverAppointment(
      token, requestKind, waybill.id, new Date(time).toISOString(), requestRemark
    ))
    if (!isCurrent()) return
    backToRecords()
    uni.showToast({ title: '申请已提交，等待调度确认', icon: 'none' })
  } catch (cause) {
    if (isCurrent()) saveError.value = appointmentError(cause, '暂未提交成功，已保留填写内容，请重试。')
  } finally {
    if (isCurrent()) saving.value = false
  }
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace container-class="page driver-page mobile-workspace--sticky-dock">
      <MobileTopBar title="车辆入场申请" :eyebrow="info.title" show-back capsule="always" :back-fallback="listUrl" :confirm-back="async () => !saving" />
      <view class="driver-content" role="main">
        <TmsPageSkeleton v-if="!eligible" label="正在核对可申请的运单…" :error="error" @retry="load" />
        <MobileEmptyState
          v-else-if="!eligible.length" icon="vehicle" title="当前没有可申请的运单"
          :description="requestedId ? '此运单状态可能已经更新或已有预约，请返回记录查看。' : info.scope"
        >
          <MobileAction class="tms-secondary-action" @click="backToRecords">返回预约记录</MobileAction>
        </MobileEmptyState>
        <template v-else>
          <view class="driver-card driver-stack">
            <text class="section-title" role="heading" aria-level="2">运单和车辆</text>
            <MobileField v-if="choices.length > 1" field="appointment-waybill" label="预约运单" :error="waybillError" required>
              <MobileSelect
                v-model="selectedId" field="appointment-waybill" label="预约运单" placeholder="选择运单…"
                :options="choices" :disabled="saving" :invalid="!!waybillError"
                :described-by="waybillError ? 'appointment-waybill-error' : undefined"
              />
            </MobileField>
            <template v-if="selected">
              <view class="appointment-facts">
                <template v-if="choices.length === 1">
                  <text class="driver-copy">运单号</text><text class="appointment-facts__value" translate="no">{{ selected.waybillNo }}</text>
                </template>
                <text class="driver-copy">车牌号</text><text class="appointment-facts__value" translate="no">{{ selected.plateNo }}</text>
                <text class="driver-copy">入场区域</text><text class="appointment-facts__value">{{ selected.station || '以调度安排为准' }}</text>
              </view>
            </template>
          </view>
          <view class="driver-card driver-stack">
            <text class="section-title" role="heading" aria-level="2">预计入场安排</text>
            <MobileField field="appointment-time" label="预计入场时间" :error="dateError" required>
              <MobilePickerTrigger
                id="appointment-time" label="选择预计入场时间" placeholder="选择日期和时间…"
                :value="formattedDate" :expanded="dateOpen" :invalid="!!dateError"
                :description="formattedDate ? `当前选中时间：${formattedDate}` : undefined"
                :described-by="dateError ? 'appointment-time-error' : undefined" :disabled="saving"
                @click="dateOpen = true"
              />
            </MobileField>
            <MobileField
              v-model="remark" field="appointment-remark" label="备注（选填）"
              placeholder="例如进场位置或装卸要求…" :maxlength="300" :disabled="saving" multiline
            />
            <text class="driver-copy">申请提交后由调度确认，请以确认后的入场安排为准。</text>
          </view>
        </template>
      </view>
      <view v-if="eligible?.length" class="mobile-dock mobile-dock--sticky" aria-label="预约申请操作">
        <text v-if="saveError" class="mobile-dock__note mobile-dock__note--error" role="alert">{{ saveError }}</text>
        <MobileAction class="tms-primary-action mobile-dock__action" :aria-busy="saving" :disabled="saving" @click="submit">
          {{ saving ? '正在提交…' : '提交入场申请' }}
        </MobileAction>
      </view>
      <TmsDateTimePicker
        :model-value="scheduledAt ?? defaultDate.getTime()" v-model:visible="dateOpen" title="选择预计入场时间"
        @update:model-value="scheduledAt = $event"
      />
    </MobileWorkspace>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.appointment-facts { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: baseline; gap: 8px 12px; }
.appointment-facts__value { min-width: 0; color: var(--mobile-workspace-ink); font-weight: 650; overflow-wrap: anywhere; }
</style>
