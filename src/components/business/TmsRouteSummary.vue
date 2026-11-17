<script setup lang="ts">
import { computed } from 'vue'
import MobileRoute from '@mobile-core/components/MobileRoute.vue'
import type { Waybill } from '@/api/types'
import { formatDateTime, formatDuration, formatKm, formatTon } from '@/utils/format'
import { getEstimatedDurationMin, getRouteDistanceKm } from '@/utils/route'
import type { getWaybillNavigationTarget } from '@/utils/navigation'
import TmsStatusTag from './TmsStatusTag.vue'

const props = defineProps<{
  waybill: Waybill
  showStatus: boolean
  variant: 'default' | 'task' | 'compact' | 'list' | 'detail'
  heading?: string
  navigation: ReturnType<typeof getWaybillNavigationTarget> | null
}>()

const cargoNo = computed(() => props.waybill.cargoNo || props.waybill.goodsNo || props.waybill.orderNo)
const origin = computed(() => props.waybill.originCity || props.waybill.fromStationName || '发货地待确认')
const destination = computed(() => props.waybill.destinationCity || props.waybill.toStationName || '收货地待确认')
const pickup = computed(() => props.waybill.senderAddress || props.waybill.shipperAddress || props.waybill.fromStationName)
const delivery = computed(() => props.waybill.receiverAddress || props.waybill.toStationName)
const duration = computed(() => getEstimatedDurationMin(props.waybill))
const distance = computed(() => props.variant === 'task' ? getRouteDistanceKm(props.waybill) : undefined)
const distanceLabel = computed(() => Number.isFinite(props.waybill.remainingDistanceKm) ? '剩余' : '全程')
const nextStop = computed(() => (props.variant === 'task' || props.variant === 'detail') && props.navigation?.address ? props.navigation : null)
const showStops = computed(() => props.variant !== 'compact' && !nextStop.value)
const showSchedule = computed(() => props.variant !== 'compact' && props.variant !== 'list')
const loadTime = computed(() => props.variant === 'task' && nextStop.value?.stop === '卸货地' ? undefined : props.waybill.plannedLoadTime)
const unloadTime = computed(() => props.variant === 'task' && nextStop.value?.stop === '装货地' ? undefined : props.waybill.plannedUnloadTime)
const originStation = computed(() => props.variant === 'compact' && props.waybill.fromStationName !== origin.value
  ? props.waybill.fromStationName
  : undefined)
</script>

<template>
  <view class="route-summary" :class="`route-summary--${variant}`">
    <view class="route-summary__head">
      <view v-if="variant === 'detail'" class="route-summary__detail-route">
        <MobileRoute :origin="origin" :destination="destination" />
      </view>
      <text v-else-if="heading" class="route-summary__label">{{ heading }}</text>
      <text v-else class="route-summary__label route-summary__number" translate="no">{{ waybill.waybillNo || '暂无运单号' }}</text>
      <TmsStatusTag v-if="showStatus" :status="waybill.status" />
    </view>

    <text v-if="variant === 'detail'" class="route-summary__label route-summary__number" translate="no">{{ waybill.waybillNo || '暂无运单号' }}</text>
    <MobileRoute v-else class="route-summary__route" :origin="origin" :destination="destination" />

    <view v-if="nextStop" class="route-summary__next-stop mobile-inline-pair mobile-inline-pair--start">
      <view class="mobile-inline-pair__icon"><text class="route-summary__stop-label">{{ nextStop.stop }}</text></view>
      <text class="route-summary__next-address">{{ nextStop.address }}</text>
    </view>
    <view v-else-if="showStops && (pickup || delivery)" class="route-summary__stops">
      <view v-if="pickup" class="route-summary__stop mobile-inline-pair mobile-inline-pair--start">
        <view class="mobile-inline-pair__icon"><text class="route-summary__stop-label">装</text></view>
        <text class="route-summary__address">{{ pickup }}</text>
      </view>
      <view v-if="delivery" class="route-summary__stop mobile-inline-pair mobile-inline-pair--start">
        <view class="mobile-inline-pair__icon"><text class="route-summary__stop-label route-summary__stop-label--end">卸</text></view>
        <text class="route-summary__address">{{ delivery }}</text>
      </view>
    </view>

    <slot name="operations" />

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
      <text v-if="distance !== undefined">{{ distanceLabel }} {{ formatKm(distance) }}</text>
    </view>

    <view v-if="showSchedule && (loadTime || unloadTime)" class="route-summary__schedule">
      <text v-if="loadTime">计划装货 {{ formatDateTime(loadTime) }}</text>
      <text v-if="unloadTime">计划卸货 {{ formatDateTime(unloadTime) }}</text>
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
.route-summary--task .route-summary__route { --mobile-route-size: clamp(1.25rem, 5.7vw, 1.625rem); }
.route-summary--task .route-summary__label { color: var(--mobile-workspace-ink, var(--tms-text-strong)); }
.route-summary--detail .route-summary__head { flex-wrap: wrap; }
.route-summary__detail-route {
  --mobile-route-size: clamp(1.25rem, 6.3vw, 1.625rem);
  flex: 1 1 10.5rem;
  min-width: 0;
}
.route-summary__stops { display: grid; gap: 4px; }
.route-summary__next-stop {
  --mobile-inline-pair-gap: 8px;
  --mobile-inline-pair-leading: 1.45;
  font-size: 14px;
}
.route-summary__address, .route-summary__next-address { min-width: 0; }
.route-summary__next-address { color: var(--mobile-workspace-ink, var(--tms-text)); }
.route-summary__stop {
  --mobile-inline-pair-gap: 7px;
  --mobile-inline-pair-leading: 1.4;
  font-size: 13px;
}
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
