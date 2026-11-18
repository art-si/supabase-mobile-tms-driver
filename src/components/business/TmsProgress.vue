<script setup lang="ts">
import MobileStageProgress from '@mobile-core/components/MobileStageProgress.vue'
import type { WaybillStatus } from '@/api/types'
import { getStatusStep } from '@/utils/format'

defineOptions({ options: { virtualHost: true, styleIsolation: 'apply-shared' } })
defineProps<{ status: WaybillStatus }>()
const steps = ['接单', '装货', '运输中', '卸货', '签收', '完成']
</script>

<template>
  <MobileStageProgress label="运输进度" :steps="steps" :current="getStatusStep(status)" />
</template>
