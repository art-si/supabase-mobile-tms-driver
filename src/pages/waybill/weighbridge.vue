<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileEvidence from '@mobile-core/components/MobileEvidence.vue'
import MobileInlineLabel from '@mobile-core/components/MobileInlineLabel.vue'
import MobileMetricGrid from '@mobile-core/components/MobileMetricGrid.vue'
import MobileRoute from '@mobile-core/components/MobileRoute.vue'
import MobileStatusTag from '@mobile-core/components/MobileStatusTag.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import TmsPageSkeleton from '@mobile-core/components/TmsPageSkeleton.vue'
import { getUserFacingErrorMessage } from '@/api/supabase'
import { getCargoOperationContext } from '@/api/waybill'
import type { CargoOperationRecord, CargoOperationType, Waybill } from '@/api/types'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'
import { useWaybillStore } from '@/stores/waybill'
import { formatDateTime } from '@/utils/format'

const { themeName } = usePageTheme()
const auth = useAuthStore()
const waybillStore = useWaybillStore()
const stops = [{ type: 'loading', name: '装货' }, { type: 'unloading', name: '卸货' }] as const
const id = ref('')
const waybill = ref<Waybill | null>(null)
const loading = ref(false)
const error = ref('')
const records = ref<Partial<Record<CargoOperationType, CargoOperationRecord | null>>>({})
const failed = ref<Partial<Record<CargoOperationType, string>>>({})
const pending = ref<Partial<Record<CargoOperationType, boolean>>>({})
const sections = computed(() => stops.map(stop => ({
  ...stop,
  record: records.value[stop.type],
  failure: failed.value[stop.type],
  pending: Boolean(pending.value[stop.type]),
})))

onLoad(query => {
  id.value = String(query?.id || '')
  void load()
})

async function load() {
  if (loading.value) return
  if (!id.value) {
    error.value = '缺少运单编号，请返回运单列表重新选择。'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const current = await waybillStore.loadWaybill(id.value)
    if (!current) throw new Error('找不到此运单，请返回运单列表重新选择。')
    waybill.value = current
    await Promise.all(stops.map(({ type }) => loadSection(current.id, type)))
  } catch (cause) {
    error.value = getUserFacingErrorMessage(cause, '运单信息同步失败，请重试。')
  } finally {
    loading.value = false
  }
}

async function loadSection(waybillId: string, type: CargoOperationType) {
  if (pending.value[type]) return
  pending.value[type] = true
  try {
    const context = await auth.withFreshAccess(token => getCargoOperationContext(token, waybillId, type))
    records.value[type] = context.operation ?? null
    failed.value[type] = undefined
  } catch (cause) {
    failed.value[type] = getUserFacingErrorMessage(cause, '过磅资料同步失败，请重试。')
  } finally {
    pending.value[type] = false
  }
}

function retrySection(type: CargoOperationType) {
  if (waybill.value && failed.value[type]) void loadSection(waybill.value.id, type)
}

function measurements(record: CargoOperationRecord) {
  return [
    { label: '毛重', value: record.grossWeightTon ?? '—', unit: record.grossWeightTon == null ? undefined : '吨' },
    { label: '皮重', value: record.tareWeightTon ?? '—', unit: record.tareWeightTon == null ? undefined : '吨' },
    { label: '净重', value: record.weightTon ?? '—', unit: record.weightTon == null ? undefined : '吨' },
  ]
}

function preview(record: CargoOperationRecord, index: number) {
  uni.previewImage({ current: record.weighbridgeTicketUrls[index], urls: record.weighbridgeTicketUrls })
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace container-class="page driver-page">
      <MobileTopBar title="过磅记录" show-back capsule="always" back-fallback="/pages/waybill/index?service=weighbridge" />
      <view class="driver-content" role="main">
        <TmsPageSkeleton v-if="!waybill" label="正在同步过磅记录…" :error="error" @retry="load" />
        <template v-else>
          <view class="driver-card driver-stack">
            <text class="driver-copy" translate="no">运单 {{ waybill.waybillNo || '待登记' }}</text>
            <MobileRoute :origin="waybill.originCity || '装货地待确认'" :destination="waybill.destinationCity || '卸货地待确认'" />
          </view>

          <view v-for="stop in sections" :key="stop.type" class="driver-card driver-stack" :aria-busy="stop.pending">
            <view class="driver-heading weighbridge-section__head">
              <text class="section-title" role="heading" aria-level="2">{{ stop.name }}过磅</text>
              <MobileStatusTag v-if="stop.record" :label="stop.record.operationStatus === 'completed' ? '资料已提交' : '已打卡'" :tone="stop.record.operationStatus === 'completed' ? 'green' : 'blue'" hide-dot />
            </view>
            <view v-if="stop.failure" class="weighbridge-recovery">
              <text class="driver-copy weighbridge-recovery__message" :role="stop.pending ? 'status' : 'alert'">
                {{ stop.pending ? `正在重试${stop.name}过磅资料…` : stop.failure }}
              </text>
              <MobileAction
                class="weighbridge-recovery__action"
                variant="link"
                :aria-label="`重试${stop.name}过磅资料`"
                :disabled="stop.pending"
                @click="retrySection(stop.type)"
              >
                <MobileInlineLabel icon="refresh" :icon-size="16" :label="stop.pending ? '重试中…' : '重试'" />
              </MobileAction>
            </view>
            <template v-if="stop.record">
              <MobileMetricGrid :items="measurements(stop.record)" />
              <text v-if="stop.record.completedAt" class="driver-copy">资料提交于 {{ formatDateTime(stop.record.completedAt) }}</text>
              <MobileEvidence v-if="stop.record.weighbridgeTicketUrls.length" :images="stop.record.weighbridgeTicketUrls" :label="`${stop.name}磅单`" readonly @preview="preview(stop.record, $event)" />
              <text v-else class="driver-copy">暂无{{ stop.name }}磅单，作业资料提交后会显示在这里。</text>
            </template>
            <text v-else-if="stop.pending && !stop.failure" class="driver-copy" role="status">正在同步{{ stop.name }}过磅资料…</text>
            <text v-else-if="!stop.failure" class="driver-copy">暂无{{ stop.name }}过磅资料。</text>
          </view>
        </template>
      </view>
    </MobileWorkspace>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.weighbridge-section__head { flex-wrap: wrap; }
.weighbridge-recovery {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}
.weighbridge-recovery__message { flex: 1 1 9rem; overflow-wrap: anywhere; }
.weighbridge-recovery__action { flex: 0 0 auto; min-width: 44px; min-height: 44px; }
</style>
