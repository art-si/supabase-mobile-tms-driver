<script setup lang="ts">
import { computed } from 'vue'
import type { WaybillStatus } from '@/api/types'
import { getStatusStep } from '@/utils/format'
import TmsIcon from './TmsIcon.vue'

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
    :aria-label="`运输进度：${currentLabel}`"
  >
    <view class="progress__labels">
      <text
        v-for="(item, index) in steps"
        :key="item"
        class="progress__label"
        :class="{
          'progress__label--completed': index < currentStep,
          'progress__label--current': index === currentStep
        }"
      >
        {{ item }}
      </text>
    </view>
    <view class="progress__track">
      <view
        class="progress__bar"
        :style="{ width: `${(currentStep / (steps.length - 1)) * 100}%` }"
      />
      <view
        v-for="(item, index) in steps"
        :key="`${item}-dot`"
        class="progress__dot"
        :class="{
          'progress__dot--completed': index < currentStep,
          'progress__dot--current': index === currentStep
        }"
      >
        <TmsIcon v-if="index < currentStep" name="check" size="16rpx" />
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.progress {
  width: 100%;
}

.progress__labels {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  margin-bottom: 20rpx;
}

.progress__label {
  color: var(--tms-text-secondary);
  font-size: max(22rpx, 12px);
  text-align: center;
  line-height: 1.2;
}

.progress__label:first-child {
  text-align: left;
}

.progress__label:last-child {
  text-align: right;
}

.progress__label--completed {
  color: var(--tms-primary);
  font-weight: 600;
}

.progress__label--current {
  color: var(--tms-primary);
  font-weight: 700;
}

.progress__track {
  position: relative;
  height: 8rpx;
  margin: 0 14rpx;
  border-radius: 8rpx;
  background: var(--tms-surface-muted);
}

.progress__bar {
  height: 100%;
  border-radius: inherit;
  background: var(--tms-primary);
}

.progress__dot {
  position: absolute;
  top: 50%;
  width: 20rpx;
  height: 20rpx;
  box-sizing: border-box;
  border: 4rpx solid #fff;
  border-radius: 50%;
  background: #cfd7e6;
  box-shadow: 0 0 0 2rpx var(--tms-line);
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.progress__dot:nth-of-type(2) {
  left: 0;
}

.progress__dot:nth-of-type(3) {
  left: 20%;
}

.progress__dot:nth-of-type(4) {
  left: 40%;
}

.progress__dot:nth-of-type(5) {
  left: 60%;
}

.progress__dot:nth-of-type(6) {
  left: 80%;
}

.progress__dot:nth-of-type(7) {
  left: 100%;
}

.progress__dot--completed {
  width: 22rpx;
  height: 22rpx;
  border: 0;
  background: var(--tms-primary);
  box-shadow: 0 0 0 3rpx var(--tms-primary-soft-strong);
  color: #fff;
}

.progress__dot--current {
  width: 26rpx;
  height: 26rpx;
  border: 6rpx solid #fff;
  background: var(--tms-primary);
  box-shadow: 0 0 0 4rpx rgba(var(--tms-primary-rgb), 0.24);
}

</style>
