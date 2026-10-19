<script setup lang="ts">
import { computed, ref } from 'vue'
import TmsIcon from './TmsIcon.vue'

const props = defineProps<{ photoUrl?: string | null; height?: string }>()
const failedUrl = ref('')
const loadedUrl = ref('')
const photoSrc = computed(() =>
  props.photoUrl && props.photoUrl !== failedUrl.value ? props.photoUrl : ''
)
const photoReady = computed(() => Boolean(photoSrc.value && loadedUrl.value === photoSrc.value))

function handlePhotoError() {
  failedUrl.value = props.photoUrl || ''
}

function handlePhotoLoad() {
  loadedUrl.value = photoSrc.value
}
</script>

<template>
  <view class="vehicle-visual" :style="{ height: props.height || '94rpx' }">
    <TmsIcon v-if="!photoReady" name="vehicle" size="52rpx" />
    <image
      v-if="photoSrc"
      class="vehicle-visual__photo"
      :class="{ 'vehicle-visual__photo--ready': photoReady }"
      :src="photoSrc"
      mode="aspectFill"
      aria-label="当前绑定车辆照片"
      @load="handlePhotoLoad"
      @error="handlePhotoError"
    />
  </view>
</template>

<style scoped lang="scss">
.vehicle-visual {
  position: relative;
  width: 100%;
  flex: 0 0 auto;
  overflow: hidden;
  color: var(--tms-primary);
  background: linear-gradient(145deg, #fff, var(--tms-primary-soft));
  display: flex;
  align-items: center;
  justify-content: center;
}

.vehicle-visual__photo {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
}

.vehicle-visual__photo--ready {
  opacity: 1;
}
</style>
