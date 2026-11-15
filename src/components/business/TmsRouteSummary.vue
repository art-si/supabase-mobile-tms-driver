<script setup lang="ts">
import { computed } from 'vue'
import MobileRoute from '@mobile-core/components/MobileRoute.vue'
import type { Waybill } from '@/api/types'
import { formatDateTime, formatDuration, formatKm, formatTon } from '@/utils/format'
import { getEstimatedDurationMin, getRouteDistanceKm } from '@/utils/route'
import TmsStatusTag from './TmsStatusTag.vue'

const props = defineProps<{
  waybill: Waybill
  showStatus: boolean
  variant: 'default' | 'task' | 'compact' | 'list' | 'detail'
  heading?: string
}>()

const cargoNo = computed(() => props.waybill.cargoNo || props.waybill.goodsNo || props.waybill.orderNo)
const origin = computed(() => props.waybill.originCity || props.waybill.fromStationName || '发货地待确认')
const destination = computed(() => props.waybill.destinationCity || props.waybill.toStationName || '收货地待确认')
const pickup = computed(() => props.waybill.senderAddress || props.waybill.shipperAddress || props.waybill.fromStationName)
const delivery = computed(() => props.waybill.receiverAddress || props.waybill.toStationName)
const duration = computed(() => getEstimatedDurationMin(props.waybill))
const distance = computed(() => props.variant === 'task' ? getRouteDistanceKm(props.waybill) : undefined)
const showStops = computed(() => props.variant !== 'compact')
const showSchedule = computed(() => props.variant !== 'compact' && props.variant !== 'list')
const originStation = computed(() => props.variant === 'compact' && props.waybill.fromStationName !== origin.value
  ? props.waybill.fromStationName
  : undefined)
</script>

<template>
  <view class="route-summary">
    <view class="route-summary__head">
      <text v-if="heading" class="route-summary__label">{{ heading }}</text>
      <text v-else class="route-summary__label route-summary__number" translate="no">{{ waybill.waybillNo || '暂无运单号' }}</text>
      <TmsStatusTag v-if="showStatus" :status="waybill.status" />
    </view>

    <MobileRoute class="route-summary__route" :origin="origin" :destination="destination" />

    <view v-if="showStops && (pickup || delivery)" class="route-summary__stops">
      <view v-if="pickup" class="route-summary__stop">
        <text class="route-summary__stop-label">装</text><text>{{ pickup }}</text>
      </view>
      <view v-if="delivery" class="route-summary__stop">
        <text class="route-summary__stop-label route-summary__stop-label--end">卸</text><text>{{ delivery }}</text>
      </view>
    </view>

    <view
      v-if="heading || cargoNo || originStation || waybill.cargoName || waybill.cargoWeightTon || duration !== undefined"
      class="route-summary__meta"
    >
      <text v-if="heading" class="route-summary__number" translate="no">{{ waybill.waybillNo }}</text>
      <text v-if="originStation">{{ originStation }}</text>
      <text v-if="cargoNo && variant !== 'task' && variant !== 'compact'" translate="no">货号 {{ cargoNo }}</text>
      <text v-if="waybill.cargoName">{{ waybill.cargoName }}</text>
      <text v-if="waybill.cargoWeightTon">{{ formatTon(waybill.cargoWeightTon) }}</text>
      <text v-if="duration !== undefined">预计 {{ formatDuration(duration) }}</text>
      <text v-if="distance !== undefined">剩余 {{ formatKm(distance) }}</text>
    </view>

    <view v-if="showSchedule && (waybill.plannedLoadTime || waybill.plannedUnloadTime)" class="route-summary__schedule">
      <text v-if="waybill.plannedLoadTime">计划装货 {{ formatDateTime(waybill.plannedLoadTime) }}</text>
      <text v-if="waybill.plannedUnloadTime">计划卸货 {{ formatDateTime(waybill.plannedUnloadTime) }}</text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.route-summary {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 8px;
  color: var(--mobile-workspace-muted, var(--tms-text-secondary));
  text-align: start;
  overflow-wrap: anywhere;
}

.route-summary__head {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.route-summary__label { font-size: 13px; font-weight: 660; line-height: 1.35; }
.route-summary__number, .route-summary__schedule { font-variant-numeric: tabular-nums; }
.route-summary__route { --mobile-route-size: clamp(16px, 4.7vw, 20px); }
.route-summary__stops { display: grid; gap: 4px; }
.route-summary__stop { display: flex; align-items: baseline; gap: 7px; font-size: 13px; line-height: 1.4; }
.route-summary__stop-label {
  flex: none;
  padding: 1px 3px;
  border-radius: 4px;
  color: var(--tms-primary);
  background: var(--tms-primary-soft);
  font-size: 11px;
  font-weight: 700;
}
.route-summary__stop-label--end { color: var(--tms-text-secondary); background: var(--tms-surface-muted); }
.route-summary__meta, .route-summary__schedule {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 10px;
  color: var(--mobile-workspace-muted, var(--tms-text-secondary));
  font-size: 12px;
  line-height: 1.45;
}
</style>
