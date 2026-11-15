<script setup lang="ts">
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import MobileThemePicker from '@mobile-core/components/MobileThemePicker.vue'
import type { ThemePresetId } from '@mobile-core/theme'
import { usePageTheme } from '@/composables/usePageTheme'

const { theme, themeName } = usePageTheme()

function selectTheme(preset: ThemePresetId) {
  if (!theme.selectPreset(preset)) {
    uni.showToast({ title: '主题已切换，保存失败', icon: 'none' })
  }
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace class="page driver-page">
      <MobileTopBar title="设置" capsule="always" show-back />
      <view class="driver-content settings-page__content" role="main">
        <view>
          <text class="mobile-group-title" role="heading" aria-level="2">外观</text>
          <view class="mobile-group">
            <MobileThemePicker :model-value="theme.preset" @update:model-value="selectTheme" />
          </view>
        </view>
      </view>
    </MobileWorkspace>
  </wd-config-provider>
</template>
