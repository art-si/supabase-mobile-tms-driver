<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import MobileCalendarDate from '@mobile-core/components/MobileCalendarDate.vue'
import MobilePickerTrigger from '@mobile-core/components/MobilePickerTrigger.vue'

defineOptions({ options: { styleIsolation: 'shared' } })

const props = defineProps<{
  modelValue: number
  visible: boolean
  title: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
  'update:visible': [value: boolean]
}>()

const dateVisible = ref(false)
const draftDate = ref(Date.now())
const hour = ref('')
const minute = ref('')

const popupVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value)
})
const dateLabel = computed(() => {
  const date = new Date(draftDate.value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
})
const canConfirm = computed(() => {
  if (!/^\d{1,2}$/.test(hour.value) || !/^\d{1,2}$/.test(minute.value)) return false
  return Number(hour.value) <= 23 && Number(minute.value) <= 59
})

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      dateVisible.value = false
      return
    }
    const date = new Date(props.modelValue)
    draftDate.value = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    hour.value = String(date.getHours()).padStart(2, '0')
    minute.value = String(date.getMinutes()).padStart(2, '0')
  }
)

function confirm() {
  if (!canConfirm.value) return
  const selected = new Date(draftDate.value)
  selected.setHours(Number(hour.value), Number(minute.value), 0, 0)
  emit('update:modelValue', selected.getTime())
  popupVisible.value = false
}
</script>

<template>
  <MobileBottomSheet v-model="popupVisible" :title="title" close-label="关闭时间选择">
    <view class="datetime-sheet__body">
      <text class="datetime-sheet__label">日期</text>
      <MobilePickerTrigger
        class="datetime-sheet__date"
        label="选择日期"
        :value="dateLabel"
        :expanded="dateVisible"
        @click="dateVisible = true"
      />
      <text class="datetime-sheet__label datetime-sheet__time-label">时间 · 24 小时制</text>
      <view class="datetime-sheet__time">
        <view class="datetime-sheet__time-field">
          <wd-input v-model="hour" type="number" inputmode="numeric" :maxlength="2" aria-label="小时" placeholder="时" />
          <text>小时</text>
        </view>
        <text class="datetime-sheet__colon">:</text>
        <view class="datetime-sheet__time-field">
          <wd-input v-model="minute" type="number" inputmode="numeric" :maxlength="2" aria-label="分钟" placeholder="分" />
          <text>分钟</text>
        </view>
      </view>
    </view>
    <template #footer>
      <view class="datetime-sheet__footer">
        <MobileAction class="tms-secondary-action" @click="popupVisible = false">取消</MobileAction>
        <MobileAction class="tms-primary-action" :disabled="!canConfirm" @click="confirm">确定</MobileAction>
      </view>
    </template>
    <template #overlay>
      <MobileCalendarDate v-model="draftDate" v-model:visible="dateVisible" title="选择日期" />
    </template>
  </MobileBottomSheet>
</template>

<style scoped lang="scss">
.datetime-sheet__body {
  padding: 14px max(16px, var(--mobile-safe-right)) 16px max(16px, var(--mobile-safe-left));
}
.datetime-sheet__label {
  display: block;
  color: var(--tms-text);
  font-size: max(25rpx, 12px);
  font-weight: 700;
}
.datetime-sheet__body :deep(.datetime-sheet__date) {
  margin-top: 14rpx;
}
.datetime-sheet__time-label {
  margin-top: 32rpx;
}
.datetime-sheet__time {
  margin-top: 14rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.datetime-sheet__time-field {
  flex: 1;
  min-width: 0;
  height: var(--tms-control-height);
  padding: 0 18rpx;
  border: 1rpx solid var(--tms-line);
  border-radius: var(--tms-control-radius);
  background: var(--tms-panel);
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.datetime-sheet__time-field :deep(.wd-input) {
  flex: 1;
  min-width: 0;
  padding: 0;
  background: transparent;
}
.datetime-sheet__time-field :deep(.wd-input__inner) {
  height: 100%;
  font-size: max(27rpx, 12px);
  font-weight: 700;
  text-align: center;
}
.datetime-sheet__time-field text {
  color: var(--tms-muted);
  font-size: max(22rpx, 12px);
  white-space: nowrap;
}
.datetime-sheet__colon {
  color: var(--tms-text);
  font-size: 30rpx;
  font-weight: 700;
}
.datetime-sheet__footer {
  display: grid;
  grid-template-columns: repeat(2,minmax(0,1fr));
  gap: 8px;
}
</style>
