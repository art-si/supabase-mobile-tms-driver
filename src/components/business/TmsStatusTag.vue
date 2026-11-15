<script setup lang="ts">
import { computed } from 'vue'
import MobileStatusTag from '@mobile-core/components/MobileStatusTag.vue'
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
  <MobileStatusTag :label="label" :tone="STATUS_TONE[status] || 'gray'" />
</template>
