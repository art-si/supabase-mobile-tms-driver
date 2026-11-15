<script setup lang="ts">
import MobileBottomNav from '@mobile-core/components/MobileBottomNav.vue'

type NavKey = 'home' | 'waybill' | 'vehicle' | 'mine'
defineProps<{ active: NavKey }>()

const items = [
  { key: 'home', label: '首页', icon: 'home', url: '/pages/home/index' },
  { key: 'waybill', label: '运单', icon: 'waybill', url: '/pages/waybill/index' },
  { key: 'vehicle', label: '车辆', icon: 'vehicle', url: '/pages/vehicle/index' },
  { key: 'mine', label: '我的', icon: 'user', url: '/pages/mine/index' }
]
</script>

<template>
  <MobileBottomNav :active="active" :items="items" />
</template>
