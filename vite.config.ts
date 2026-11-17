import { relative, resolve } from 'node:path'
import { defineConfig } from 'vite'
import uniPlugin from '@dcloudio/vite-plugin-uni'
import { applicationRoot, loadMobilePro } from './scripts/mobile-pro.mjs'

export default defineConfig(async ({ command }) => {
  const output = process.env.UNI_OUTPUT_DIR
  if (command === 'build' && process.env.UNI_PLATFORM === 'h5' && output &&
      relative(resolve(applicationRoot, 'docs'), resolve(applicationRoot, output)) === '') {
    // Vite gives existing process variables precedence over dotenv files.
    process.env.VITE_AMAP_SECURITY_JS_CODE = ''
    process.env.VITE_AMAP_WEB_SERVICE_KEY = ''
  }
  const { createMobileViteConfig } = await loadMobilePro()
  return createMobileViteConfig(applicationRoot, uniPlugin)
})
