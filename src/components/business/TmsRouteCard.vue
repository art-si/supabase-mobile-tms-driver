<script setup lang="ts">
import { computed } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import type { Waybill } from '@/api/types'
import { STATUS_LABEL } from '@/utils/format'
import TmsIcon from './TmsIcon.vue'
import TmsProgress from './TmsProgress.vue'
import TmsRouteSummary from './TmsRouteSummary.vue'

const props = withDefaults(defineProps<{
  waybill: Waybill
  showProgress?: boolean
  showStatus?: boolean
  clickable?: boolean
  variant?: 'default' | 'task' | 'compact' | 'list' | 'detail'
  title?: string
}>(), {
  showProgress: false,
  showStatus: true,
  clickable: true,
  variant: 'default'
})

const emit = defineEmits<{
  open: [waybill: Waybill]
  navigate: [waybill: Waybill]
}>()

const heading = computed(() => props.variant === 'task' ? props.title || '当前任务' : undefined)
const showNavigation = computed(() => props.variant !== 'list' && props.variant !== 'compact')
const accessibilityLabel = computed(() => {
  const item = props.waybill
  const origin = item.originCity || item.fromStationName || '发货地待确认'
  const destination = item.destinationCity || item.toStationName || '收货地待确认'
  const status = props.showStatus ? STATUS_LABEL[item.status] : ''
  return [`${origin}到${destination}`, `运单号 ${item.waybillNo || '待确认'}`, status].filter(Boolean).join('，')
})
</script>

<template>
  <view class="route-card" :class="`route-card--${variant}`">
    <MobileAction
      v-if="clickable"
      class="route-card__open"
      style="display: block; width: 100%; border-radius: inherit"
      :aria-label="accessibilityLabel"
      @click="emit('open', waybill)"
    >
      <view class="route-card__summary">
        <view class="route-card__content">
          <TmsRouteSummary :waybill="waybill" :variant="variant" :show-status="showStatus" :heading="heading" />
        </view>
        <view class="route-card__chevron" aria-hidden="true">
          <TmsIcon name="chevron" size="24rpx" />
        </view>
      </view>
    </MobileAction>
    <view v-else class="route-card__summary">
      <view class="route-card__content">
        <TmsRouteSummary :waybill="waybill" :variant="variant" :show-status="showStatus" :heading="heading" />
      </view>
    </view>

    <view v-if="showProgress" class="route-card__progress">
      <TmsProgress :status="waybill.status" />
    </view>

    <view v-if="$slots.default || showNavigation" class="route-card__actions">
      <slot />
      <view v-if="showNavigation" class="route-card__nav">
        <MobileAction variant="link" @click="emit('navigate', waybill)">
          <view class="route-card__nav-content">
            <TmsIcon name="nav" size="29rpx" aria-hidden="true" />
            <text>导航</text>
          </view>
        </MobileAction>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.route-card {
  --route-card-padding: var(--mobile-workspace-card-padding, 16px);
  min-width: 0;
  background: var(--mobile-workspace-surface, var(--tms-surface));
  border: 1px solid var(--mobile-workspace-line, var(--tms-line-subtle));
  border-radius: var(--mobile-workspace-card-radius, 20px);
}

.route-card__summary {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
  padding: var(--route-card-padding);
}

.route-card__content { flex: 1; min-width: 0; }

.route-card__chevron { flex: none; color: var(--mobile-workspace-muted, var(--tms-text-secondary)); }
.route-card__progress { margin: 0 var(--route-card-padding) 14px; }
.route-card__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-inline: var(--route-card-padding);
  padding-block: 3px;
  border-top: 1px solid var(--mobile-workspace-line, var(--tms-line-subtle));
}

.route-card--task .route-card__actions { padding-block: 8px; }

.route-card__nav { margin-inline-start: auto; }
.route-card__nav-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--mobile-workspace-accent, var(--tms-primary));
  font-size: 13px;
  font-weight: 660;
  white-space: nowrap;
}

.route-card__actions:empty { display: none; }

@media (hover: hover) {
  .route-card__open:hover { background: var(--tms-surface-soft); }
}
</style>
