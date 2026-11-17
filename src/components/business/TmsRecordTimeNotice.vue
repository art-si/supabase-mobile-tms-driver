<script setup lang="ts">
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
withDefaults(
  defineProps<{
    subject?: string;
  }>(),
  {
    subject: "记录时间",
  },
);
</script>

<template>
  <view class="record-time-notice mobile-inline-pair mobile-inline-pair--start">
    <view class="mobile-inline-pair__icon" aria-hidden="true"><MobileIcon name="info" size="16px" /></view>
    <text class="record-time-notice__copy">
      支持实时填报与事后补录，{{ subject }}不受当前时间或前后节点限制；系统仅提示，请按实际发生时间填写。
    </text>
  </view>
</template>

<style scoped lang="scss">
.record-time-notice {
  min-width: 0;
  margin-top: 16rpx;
  padding: 18rpx 20rpx;
  border: 1rpx solid rgba(var(--tms-primary-rgb), 0.16);
  border-radius: 16rpx;
  color: var(--tms-info);
  background: var(--tms-info-soft);
  --mobile-inline-pair-gap: 6px;
  --mobile-inline-pair-leading: 1.55;
  font-size: max(23rpx, 12px);
  font-weight: 600;
}

.record-time-notice__copy {
  min-width: 0;
  flex: 1;
}
</style>
