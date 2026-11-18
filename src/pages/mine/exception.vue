<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileEmptyState from '@mobile-core/components/MobileEmptyState.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobilePickerTrigger from '@mobile-core/components/MobilePickerTrigger.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileSelect from '@mobile-core/components/MobileSelect.vue'
import MobileStatusTag from '@mobile-core/components/MobileStatusTag.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import TmsPageSkeleton from '@mobile-core/components/TmsPageSkeleton.vue'
import { revealControl } from '@mobile-core/form-focus'
import { driverExceptionError, getDriverExceptionWorkspace, submitDriverException, type DriverExceptionWorkspace } from '@/api/driver-exception'
import TmsDateTimePicker from '@/components/business/TmsDateTimePicker.vue'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime, formatMoney } from '@/utils/format'

const { themeName } = usePageTheme()
const auth = useAuthStore()
const types = [{ id: 'delay', name: '延误' }, { id: 'damage', name: '货损' }, { id: 'lost', name: '货物遗失' }, { id: 'detained', name: '滞留' }] as const
const stages = [{ id: 'pickup', name: '提货' }, { id: 'transit', name: '在途' }, { id: 'delivery', name: '送货' }] as const
const statuses = {
  pending: { label: '待处理', tone: 'orange' },
  in_progress: { label: '处理中', tone: 'blue' },
  resolved: { label: '已处理', tone: 'green' },
  closed: { label: '已关闭', tone: 'gray' }
} as const

const form = reactive({ waybill: '', type: '', stage: '', time: Date.now(), description: '', freight: '' })
type FormField = keyof typeof form
const errors = ref<Partial<Record<FormField, string>>>({})
const workspace = ref<DriverExceptionWorkspace>({ records: [], waybills: [] })
const reports = computed(() => workspace.value.records)
const choices = computed(() => workspace.value.waybills.map(item => ({ id: item.id, name: item.waybillNo })))
const loading = ref(true)
const loadError = ref('')
const submitError = ref('')
const formOpen = ref(false)
const dateOpen = ref(false)
const submitting = ref(false)
const receipt = ref('')
const linkedWaybill = ref('')
let lastPayload = ''
let requestKey = ''

const occurredAt = computed(() => Number.isFinite(form.time) ? formatDateTime(new Date(form.time).toISOString()) : '')

onLoad((options) => {
  if (typeof options?.id === 'string') linkedWaybill.value = options.id
  void load()
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    if (!(await auth.ensureValidSession())) return
    workspace.value = await auth.withFreshAccess(getDriverExceptionWorkspace)
    if (linkedWaybill.value && choices.value.some(item => item.id === linkedWaybill.value)) {
      form.waybill = linkedWaybill.value
      formOpen.value = true
      linkedWaybill.value = ''
    }
  } catch (error) {
    loadError.value = driverExceptionError(error, '无法读取异常报备，请重试。')
  } finally { loading.value = false }
}

function start() {
  receipt.value = ''
  formOpen.value = true
  form.time = Date.now()
}

function clearError(field: FormField) {
  if (errors.value[field]) delete errors.value[field]
}

async function submit() {
  if (submitting.value) return
  const next: Partial<Record<FormField, string>> = {}
  const exceptionType = types.find(item => item.id === form.type)?.id
  const stage = stages.find(item => item.id === form.stage)?.id
  const description = form.description.trim()
  const amount = form.freight.trim()
  const extraFreight = amount ? Number(amount) : null
  if (!choices.value.some(item => item.id === form.waybill)) next.waybill = '请选择关联运单。'
  if (!exceptionType) next.type = '请选择异常类型。'
  if (!stage) next.stage = '请选择发生环节。'
  if (!Number.isFinite(form.time) || form.time > Date.now()) next.time = '发生时间不能晚于现在。'
  if (description.length < 2) next.description = '请简要说明发生了什么。'
  if (extraFreight !== null && (!/^\d{1,8}(\.\d{1,2})?$/.test(amount) || extraFreight <= 0)) next.freight = '请输入大于 0、最多两位小数的金额。'
  errors.value = next
  const first = Object.keys(next)[0]
  if (first) { await revealControl(`driver-exception-${first}`); return }
  if (!exceptionType || !stage) return

  submitting.value = true
  submitError.value = ''
  const payload = { waybillId: form.waybill, exceptionType, stage, description, occurredAt: new Date(form.time).toISOString(), extraFreight }
  const signature = JSON.stringify(payload)
  if (signature !== lastPayload) {
    lastPayload = signature
    requestKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
  try {
    await auth.withFreshAccess(token => submitDriverException(token, { ...payload, requestKey }))
    receipt.value = choices.value.find(item => item.id === payload.waybillId)?.name || '关联运单'
    formOpen.value = false
    Object.assign(form, { type: '', stage: '', description: '', freight: '' })
    lastPayload = ''
    void revealControl('driver-exception-receipt')
  } catch (error) {
    submitError.value = driverExceptionError(error, '异常报备提交失败。填写的内容仍在，可以重试。')
    void revealControl('driver-exception-submit-error', { focus: false })
  } finally { submitting.value = false }
}

async function showRecords() {
  formOpen.value = false
  receipt.value = ''
  await load()
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace container-class="page driver-page">
      <MobileTopBar capsule="always" title="异常报备" subtitle="记录运输异常，提交给调度处理" show-back back-fallback="/pages/mine/index" />
      <view class="driver-content" role="main">
        <TmsPageSkeleton v-if="loading" compact label="正在加载异常报备…" />
        <MobileLoadError v-else-if="loadError" :message="loadError" @retry="load" />
        <view v-else-if="receipt" id="driver-exception-receipt" class="driver-card">
          <MobileEmptyState icon="check" title="已提交异常报备" :description="`${receipt} · 待调度处理`">
            <MobileAction variant="link" @click="showRecords">查看报备记录</MobileAction>
          </MobileEmptyState>
        </view>
        <view v-else-if="formOpen" class="driver-card driver-stack">
          <text class="section-title" role="heading" aria-level="2">填写异常信息</text>
          <template v-for="item in [{ field: 'waybill', label: '关联运单', options: choices }, { field: 'type', label: '异常类型', options: types }, { field: 'stage', label: '发生环节', options: stages }] as const" :key="item.field">
            <MobileField :field="`driver-exception-${item.field}`" :label="item.label" :error="errors[item.field]" required>
              <MobileSelect
                v-model="form[item.field]" :field="`driver-exception-${item.field}`" :label="item.label"
                :placeholder="`请选择${item.label}…`" :options="item.options" :disabled="submitting"
                @select="clearError(item.field)"
              />
            </MobileField>
          </template>
          <MobileField field="driver-exception-time" label="发生时间" :error="errors.time" required>
            <MobilePickerTrigger
              id="driver-exception-time" label="发生时间" placeholder="选择日期和时间…"
              :value="occurredAt" :expanded="dateOpen" :disabled="submitting"
              :description="occurredAt ? `当前时间：${occurredAt}` : undefined"
              @click="dateOpen = true"
            />
          </MobileField>
          <MobileField v-model="form.description" field="driver-exception-description" label="异常说明" placeholder="说明发生了什么、当前影响…" :maxlength="1800" :error="errors.description" :disabled="submitting" required multiline @update:model-value="clearError('description')" />
          <MobileField v-model="form.freight" field="driver-exception-freight" label="预计额外运费（元，选填）" inputmode="decimal" placeholder="如无额外运费可留空" :error="errors.freight" :disabled="submitting" @update:model-value="clearError('freight')" />
          <text class="driver-copy">预计金额供调度和财务复核，提交后不会直接计费。</text>
          <text v-if="submitError" id="driver-exception-submit-error" class="driver-error" role="alert">{{ submitError }}</text>
          <view class="exception-actions">
            <MobileAction class="tms-secondary-action exception-actions__button" :disabled="submitting" @click="showRecords">返回列表</MobileAction>
            <MobileAction class="tms-primary-action exception-actions__button" :disabled="submitting" :aria-busy="submitting" @click="submit">{{ submitting ? '正在提交…' : '提交报备' }}</MobileAction>
          </view>
        </view>
        <template v-else>
          <view class="driver-heading exception-list-head">
            <text class="section-title" role="heading" aria-level="2">最近报备</text>
            <MobileAction v-if="choices.length" class="tms-primary-action" @click="start">新增报备</MobileAction>
          </view>
          <view v-if="reports.length" class="mobile-group">
            <view v-for="report in reports" :key="report.id" class="mobile-row mobile-row--static exception-row">
              <view class="mobile-row__body">
                <text class="mobile-row__label">{{ types.find(item => item.id === report.exceptionType)?.name || '运输异常' }} · {{ report.waybillNo }}</text>
                <text class="mobile-row__detail">{{ stages.find(item => item.id === report.stage)?.name }} · {{ formatDateTime(report.occurredAt) }}</text>
                <text v-if="report.extraFreight !== null" class="mobile-row__detail">预计运费 {{ formatMoney(report.extraFreight) }}</text>
              </view>
              <MobileStatusTag :label="statuses[report.status]?.label || '状态待确认'" :tone="statuses[report.status]?.tone || 'gray'" />
            </view>
          </view>
          <MobileEmptyState v-else class="driver-card" icon="notice" :title="choices.length ? '暂无异常报备' : '暂无可关联运单'" :description="choices.length ? '发生运输异常时，可选择关联运单提交报备。' : '仅支持已关联运输订单、未取消的本人运单。如有异常，请联系调度。'" />
        </template>
      </view>
      <TmsDateTimePicker
        v-if="formOpen" :model-value="Number.isFinite(form.time) ? form.time : Date.now()"
        v-model:visible="dateOpen" title="选择发生时间"
        @update:model-value="form.time = $event; clearError('time')"
      />
    </MobileWorkspace>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.exception-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.exception-actions__button { flex: 1 1 auto; }
.exception-list-head { flex-wrap: wrap; }
.exception-row { align-items: flex-start; }
</style>
