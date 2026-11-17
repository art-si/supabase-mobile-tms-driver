<script setup lang="ts">
import { computed } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileInlineLabel from '@mobile-core/components/MobileInlineLabel.vue'
import type { Waybill } from '@/api/types'
import { STATUS_LABEL } from '@/utils/format'
import { getWaybillNavigationTarget, openWaybillNavigation } from '@/utils/navigation'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import TmsProgress from './TmsProgress.vue'
import TmsRouteSummary from './TmsRouteSummary.vue'

defineOptions({ options: { styleIsolation: 'apply-shared' } })

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
}>()

const heading = computed(() => props.variant === 'task' ? props.title || '当前任务' : undefined)
const navigation = computed(() => {
  if (props.variant === 'list' || props.variant === 'compact' || props.waybill.status === 'cancelled') return null
  const target = getWaybillNavigationTarget(props.waybill)
  return target.point || target.address ? target : null
})
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
          <TmsRouteSummary :waybill="waybill" :variant="variant" :show-status="showStatus" :heading="heading" :navigation="navigation" />
        </view>
        <view class="route-card__chevron mobile-icon-box" aria-hidden="true">
          <MobileIcon name="chevron" size="24rpx" />
        </view>
      </view>
    </MobileAction>
    <view v-else class="route-card__summary">
      <view class="route-card__content">
        <TmsRouteSummary :waybill="waybill" :variant="variant" :show-status="showStatus" :heading="heading" :navigation="navigation">
          <template v-if="variant === 'detail' && $slots.operations" #operations>
            <slot name="operations" />
          </template>
        </TmsRouteSummary>
      </view>
    </view>

    <view v-if="showProgress" class="route-card__progress">
      <TmsProgress :status="waybill.status" />
    </view>

    <view v-if="$slots.operations && (clickable || variant !== 'detail')" class="route-card__operations">
      <slot name="operations" />
    </view>

    <view v-if="$slots.default || navigation" class="route-card__actions">
      <slot />
      <view v-if="navigation" class="route-card__nav">
        <MobileAction variant="link" :aria-label="`导航到${navigation.stop}`" @click="openWaybillNavigation(navigation)">
          <MobileInlineLabel icon="nav" :label="`${navigation.stop}导航`" />
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

.route-card__chevron {
  min-height: 24px;
  color: var(--mobile-workspace-muted, var(--tms-text-secondary));
}
.route-card__progress { margin: 0 var(--route-card-padding) 14px; }
.route-card__actions {
  --mobile-action-link-color: var(--mobile-workspace-accent, var(--tms-primary));
  --mobile-action-link-font-size: 13px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-inline: var(--route-card-padding);
  padding-block: 3px;
  border-top: 1px solid var(--mobile-workspace-line, var(--tms-line-subtle));
}

.route-card--task .route-card__summary { padding-bottom: 12px; }

.route-card--task .route-card__progress {
  margin-bottom: 12px;
  padding: 10px 6px 6px;
  border-radius: 12px;
  background: var(--tms-surface-soft);
}

.route-card__operations { margin: 0 var(--route-card-padding) 12px; }

.route-card--task .route-card__actions { padding-block: 9px; }

.route-card--detail .route-card__actions {
  --mobile-action-link-padding: 0 4px;
  column-gap: 4px;
}

.route-card--compact {
  border: 0;
  border-radius: 0;
  background: transparent;
}

.route-card--compact .route-card__open:focus-visible { outline-offset: -3px; }

.route-card__nav { margin-inline-start: auto; }

.route-card--detail .route-card__nav {
  display: flex;
  min-width: 0;
}

.route-card__actions:empty { display: none; }

@media (hover: hover) {
  .route-card__open:hover { background: var(--tms-surface-soft); }
}
</style>
