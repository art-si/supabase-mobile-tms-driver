import { defineConfig } from 'vite'
import uniPlugin from '@dcloudio/vite-plugin-uni'
import { applicationRoot, loadMobilePro } from './scripts/mobile-pro.mjs'

export default defineConfig(async () => {
  const { createMobileViteConfig } = await loadMobilePro()
  return createMobileViteConfig(applicationRoot, uniPlugin)
})
