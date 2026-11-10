<script setup lang="ts">
import { computed } from 'vue'
import type { WaybillStatus } from '@/api/types'
import { STATUS_LABEL, STATUS_TONE } from '@/utils/format'
import { useDictionaryStore } from '@/stores/dictionary'

const props = defineProps<{
  status: WaybillStatus
}>()

const dictionary = useDictionaryStore()
const label = computed(
  () => STATUS_LABEL[props.status] || dictionary.findLabel('tmsWaybillStatus', props.status) || props.status
)
</script>

<template>
  <view class="status-tag" :class="`status-tag--${STATUS_TONE[props.status] || 'gray'}`">
    <text class="status-tag__dot" />
    {{ label }}
  </view>
</template>

<style scoped lang="scss">
.status-tag {
  min-width: 96rpx;
  height: 46rpx;
  padding: 0 16rpx;
  border-radius: 999rpx;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9rpx;
  font-size: max(22rpx, 12px);
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.status-tag__dot {
  box-sizing: border-box;
  flex: 0 0 auto;
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.88;
}

.status-tag--blue {
  color: var(--tms-primary);
  background: var(--tms-primary-soft);
}

.status-tag--green {
  color: var(--tms-green-strong);
  background: var(--tms-green-soft);
}

.status-tag--orange {
  color: var(--tms-orange-strong);
  background: var(--tms-orange-soft);
}

.status-tag--red {
  color: var(--tms-red-strong);
  background: var(--tms-red-soft);
}

.status-tag--gray {
  color: var(--tms-text-secondary);
  background: var(--tms-surface-muted);
}
</style>
