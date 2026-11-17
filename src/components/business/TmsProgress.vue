<script setup lang="ts">
import { computed } from 'vue'
import type { WaybillStatus } from '@/api/types'
import { getStatusStep } from '@/utils/format'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'

defineOptions({ options: { styleIsolation: 'apply-shared' } })

const props = defineProps<{
  status: WaybillStatus
}>()

const steps = ['接单', '装货', '运输中', '卸货', '签收', '完成']
const currentStep = computed(() => getStatusStep(props.status))
const currentLabel = computed(() => steps[currentStep.value] || steps[0])
</script>

<template>
  <view
    class="progress"
    role="progressbar"
    :aria-valuemin="0"
    :aria-valuemax="steps.length - 1"
    :aria-valuenow="currentStep"
    aria-label="运输进度"
    :aria-valuetext="`${currentLabel}，第 ${currentStep + 1} 阶段，共 ${steps.length} 阶段`"
  >
    <view
      v-for="(item, index) in steps"
      :key="item"
      class="progress__step"
      :class="{
        'progress__step--completed': index < currentStep,
        'progress__step--current': index === currentStep
      }"
      aria-hidden="true"
    >
      <text class="progress__label">{{ item }}</text>
      <view class="progress__marker">
        <view v-if="index < steps.length - 1" class="progress__rail" />
        <view class="progress__dot mobile-icon-box">
          <MobileIcon v-if="index < currentStep" name="check" size="16rpx" />
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.progress {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  align-items: end;
}

.progress__step {
  display: grid;
  min-width: 0;
  gap: 8px;
  text-align: center;
}

.progress__label {
  color: var(--tms-text-secondary);
  font-size: max(22rpx, 12px);
  line-height: 1.2;
}

.progress__step--completed .progress__label {
  color: var(--tms-primary);
  font-weight: 600;
}

.progress__step--current .progress__label {
  color: var(--tms-primary);
  font-weight: 700;
}

.progress__marker {
  position: relative;
  display: grid;
  height: 20px;
  place-items: center;
}

.progress__rail {
  position: absolute;
  top: calc(50% - 2px);
  left: 50%;
  right: -50%;
  height: 4px;
  background: var(--tms-surface-muted);
}

.progress__step--completed .progress__rail {
  background: var(--tms-primary);
}

.progress__dot {
  position: relative;
  z-index: 1;
  width: 10px;
  height: 10px;
  box-sizing: border-box;
  border: 2px solid var(--mobile-workspace-surface, var(--tms-surface));
  border-radius: 50%;
  background: var(--tms-line);
  box-shadow: 0 0 0 2rpx var(--tms-line);
}

.progress__step--completed .progress__dot {
  width: 22rpx;
  height: 22rpx;
  border: 0;
  background: var(--tms-primary);
  box-shadow: 0 0 0 3rpx var(--tms-primary-soft-strong);
  color: #fff;
}

.progress__step--current .progress__dot {
  width: 26rpx;
  height: 26rpx;
  border: 3px solid var(--mobile-workspace-surface, var(--tms-surface));
  background: var(--tms-primary);
  box-shadow: 0 0 0 4rpx rgba(var(--tms-primary-rgb), 0.24);
}

</style>
