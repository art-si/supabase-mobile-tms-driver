<script setup lang="ts">
import { useStartupData } from '@mobile-core/startup'
import { useAuthStore } from '@/stores/auth'
import { useDictionaryStore } from '@/stores/dictionary'
// #ifdef H5
import { onLaunch } from '@dcloudio/uni-app'
import { App as NativeApp } from '@capacitor/app'
import { registerAndroidBackHandler } from '@mobile-core/android-back'

onLaunch(() => registerAndroidBackHandler(NativeApp))
// #endif

useStartupData(useAuthStore, useDictionaryStore)
</script>

<style lang="scss">
@use '@mobile-core/styles/global.scss' as mobile;
@use '@mobile-core/styles/workspace.scss';
@use '@mobile-core/styles/grouped-list.scss' as grouped-list;
@use '@mobile-core/styles/control-reset.scss';

@include mobile.apply('tms');
@include workspace.apply('driver');
@include grouped-list.styles();

page {
  min-height: 100%;
  background: var(--tms-bg);
  color: var(--tms-text);
  overflow-x: hidden;
  font-family: var(--tms-font-family);
  font-weight: 400;
  font-synthesis: none;
  font-variant-numeric: tabular-nums;
  font-optical-sizing: auto;
  letter-spacing: 0.01em;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* #ifdef H5 */
html,
body {
  min-width: 320px;
  margin: 0;
  overflow-x: hidden;
  background: var(--tms-bg);
}

@media (pointer: fine) {
  html {
    overscroll-behavior: none;
  }
}

@media (prefers-reduced-transparency: reduce) {
  page,
  .card,
  .bottom-nav {
    background: var(--tms-surface) !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
}

@media (prefers-contrast: more) {
  .card,
  .bottom-nav {
    border-color: var(--tms-text-secondary) !important;
  }
}
/* #endif */

@include control-reset.apply('tms');

/* #ifdef H5 */
uni-scroll-view .uni-scroll-view {
  overscroll-behavior: contain;
}
/* #endif */
</style>
