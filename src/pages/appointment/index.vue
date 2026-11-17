<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onShow, onUnload } from '@dcloudio/uni-app'
import { createLatestRequest } from '@mobile-core/latest-request'
import { mergePageRows } from '@mobile-core/list-rows'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileEmptyState from '@mobile-core/components/MobileEmptyState.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileInlineLabel from '@mobile-core/components/MobileInlineLabel.vue'
import MobileListFooter from '@mobile-core/components/MobileListFooter.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileStatusTag from '@mobile-core/components/MobileStatusTag.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import TmsPageSkeleton from '@mobile-core/components/TmsPageSkeleton.vue'
import { appointmentError, getDriverAppointmentContext, type AppointmentKind, type DriverAppointment } from '@/api/appointment'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime } from '@/utils/format'
import { appointmentKind, appointmentStates, appointmentTypes, watchAppointmentQuery } from './shared'

const { themeName } = usePageTheme()
const auth = useAuthStore()
const kind = ref<AppointmentKind>('pickup')
const info = computed(() => appointmentTypes[kind.value])
const records = ref<DriverAppointment[] | null>(null)
const eligible = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const moreError = ref('')
let nextOffset = 0
const requests = createLatestRequest()

onLoad(query => { kind.value = appointmentKind(query?.kind) })
onShow(() => { void load() })
onUnload(requests.invalidate)
watchAppointmentQuery('index', query => {
  const nextKind = appointmentKind(query.kind)
  if (nextKind === kind.value) return
  requests.invalidate()
  kind.value = nextKind
  records.value = null
  eligible.value = 0
  hasMore.value = false
  loading.value = false
  loadingMore.value = false
  nextOffset = 0
  void load()
})
onPullDownRefresh(async () => {
  try { await load() }
  finally { uni.stopPullDownRefresh() }
})

async function load(append = false) {
  if (loading.value || (append && (loadingMore.value || !hasMore.value))) return
  const isCurrent = append ? requests.snapshot() : requests.start()
  const requestKind = kind.value
  const offset = append ? nextOffset : 0
  if (append) loadingMore.value = true
  else {
    loading.value = true
    loadingMore.value = false
    error.value = ''
  }
  moreError.value = ''
  try {
    if (!await auth.ensureValidSession() || !isCurrent()) return
    const result = await auth.withFreshAccess(token => getDriverAppointmentContext(token, requestKind, offset))
    if (!isCurrent()) return
    records.value = append ? mergePageRows(records.value ?? [], result.records, item => item.id) : result.records
    nextOffset = offset + result.records.length
    eligible.value = result.eligibleWaybills.length
    hasMore.value = result.records.length > 0 && result.hasMore
  } catch (cause) {
    if (isCurrent()) {
      if (append) moreError.value = appointmentError(cause, '预约记录追加失败，请重试。')
      else error.value = appointmentError(cause, '预约信息同步失败，请稍后重试。')
    }
  } finally {
    if (isCurrent()) (append ? loadingMore : loading).value = false
  }
}

function openApplication() {
  if (!eligible.value || error.value || loading.value || loadingMore.value) return
  uni.navigateTo({ url: `/pages/appointment/apply?kind=${kind.value}` })
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace container-class="page driver-page">
      <MobileTopBar :title="info.title" show-back capsule="always" back-fallback="/pages/mine/index" />
      <view class="driver-content" role="main">
        <TmsPageSkeleton v-if="!records" label="正在同步预约记录…" :error="error" @retry="load()" />
        <template v-else>
          <view class="driver-card driver-stack appointment-action">
            <view class="appointment-action__heading">
              <view class="mobile-row__icon"><MobileIcon name="vehicle" size="18px" /></view>
              <view class="appointment-action__copy">
                <text class="section-title" role="heading" aria-level="2">车辆入场申请</text>
                <text class="driver-copy">{{ eligible ? '提交预计入场时间，由调度确认。' : info.scope }}</text>
              </view>
            </view>
            <MobileAction v-if="eligible" class="tms-primary-action" :disabled="loading || loadingMore || !!error" @click="openApplication">申请入场</MobileAction>
            <text v-else class="driver-copy appointment-action__notice">暂无符合条件的运单，也可联系调度确认安排。</text>
          </view>

          <view class="driver-stack" :aria-busy="loading || loadingMore">
            <view class="driver-heading appointment-records__heading">
              <text class="mobile-group-title" role="heading" aria-level="2">入场预约记录</text>
              <MobileAction
                class="appointment-refresh"
                variant="link"
                :aria-label="loading ? '正在刷新预约记录' : '刷新预约记录'"
                :disabled="loading"
                @click="load()"
              >
                <MobileInlineLabel icon="refresh" :label="loading ? '刷新中…' : '刷新'" :icon-size="16" />
              </MobileAction>
            </view>
            <MobileLoadError v-if="error" title="预约记录刷新失败" :message="error" @retry="load()" />
            <template v-if="records.length">
              <view v-for="record in records" :key="record.id" class="driver-card appointment-record">
                <view class="driver-heading">
                  <text class="appointment-record__no" translate="no">{{ record.appointmentNo || '入场预约' }}</text>
                  <MobileStatusTag :label="appointmentStates[record.status].label" :tone="appointmentStates[record.status].tone" />
                </view>
                <text class="appointment-record__time">{{ formatDateTime(record.scheduledAt) }}</text>
                <text class="driver-copy" translate="no">运单 {{ record.waybillNo }}</text>
                <text v-if="record.dockName" class="driver-copy">月台 {{ record.dockName }}</text>
                <text v-if="record.arrivedAt" class="driver-copy">到场 {{ formatDateTime(record.arrivedAt) }}</text>
                <text v-if="record.remark" class="driver-copy">备注 {{ record.remark }}</text>
              </view>
              <MobileListFooter
                :loading="loadingMore" :can-load-more="hasMore && !loading && !error" :error="moreError"
                error-title="无法加载更多预约记录" @more="load(true)"
              />
            </template>
            <MobileEmptyState v-else-if="!error" icon="time" title="暂无预约记录" description="申请提交后，可在这里查看确认状态和入场安排。" />
          </view>
        </template>
      </view>
    </MobileWorkspace>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.appointment-action__heading { display: flex; align-items: center; gap: 12px; }
.appointment-action__copy { display: grid; min-width: 0; gap: 2px; }
.appointment-action__notice { padding-top: 8px; border-top: 1px solid var(--mobile-workspace-line); }
.appointment-records__heading .mobile-group-title { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.appointment-refresh { min-width: 44px; min-height: 44px; font-size: max(13px, .8125rem); }
.appointment-record { display: grid; min-width: 0; gap: 6px; overflow-wrap: anywhere; }
.appointment-record__no { min-width: 0; color: var(--mobile-workspace-muted); font-size: 13px; font-weight: 650; }
.appointment-record__time { color: var(--mobile-workspace-ink); font-size: 20px; font-weight: 720; font-variant-numeric: tabular-nums; }
</style>
