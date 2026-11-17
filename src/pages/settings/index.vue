<script setup lang="ts">
import MobileAppearanceSettings from '@mobile-core/components/MobileAppearanceSettings.vue'
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import { usePageTheme } from '@/composables/usePageTheme'

const { theme, themeName } = usePageTheme()
</script>

<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace container-class="page driver-page">
      <MobileTopBar title="设置" capsule="always" show-back />
      <view class="driver-content settings-page__content" role="main">
        <MobileAppearanceSettings :model-value="theme.preset" :persist-preset="theme.selectPreset" />
      </view>
    </MobileWorkspace>
  </wd-config-provider>
</template>
