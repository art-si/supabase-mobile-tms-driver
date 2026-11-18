<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import MobileLogin from '@mobile-core/components/MobileLogin.vue'
import { isWechatPhoneLoginEnabled, wechatPhoneLoginError } from '@mobile-core/wechat-phone-login'
import { getUserFacingErrorMessage } from '@/api/supabase'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'

const { themeName } = usePageTheme()
const auth = useAuthStore()
const profile = useProfileStore()

const brand = {
  name: 'TMS',
  badge: '司机端',
  eyebrow: '智慧运输协同',
  title: '每一程，都清晰可控',
  description: '任务、路线、车辆与回单集中处理，让运输履约更简单。',
  benefits: ['任务实时同步', '数据安全连接']
}

function openHome() {
  uni.reLaunch({ url: '/pages/home/index' })
}

onLoad(async () => {
  auth.hydrate()
  if (!auth.isLoggedIn) return
  try {
    if (!(await auth.ensureValidSession(false))) return
    await profile.load(true)
    openHome()
  } catch {
    auth.clearSession()
  }
})

async function authenticate(account: string, password: string) {
  await auth.login(account, password)
}

async function authenticatePhone(code: string) {
  await auth.loginWithWechatPhone(code)
}

function explainError(error: unknown, channel?: 'phone') {
  if (channel === 'phone') return wechatPhoneLoginError(error)
  return getUserFacingErrorMessage(
    error,
    channel === 'phone' ? '手机号登录暂不可用，请使用账号密码登录' : '登录失败，请检查账号与密码'
  )
}
</script>

<template>
  <MobileLogin
    :theme-name="themeName"
    :brand="brand"
    account-label="司机账号"
    account-placeholder="请输入手机号/邮箱"
    account-hint="使用后台分配的司机账号"
    remember-key="tms-driver-account"
    help-text="司机账号由车队管理员开通与管理"
    forgot-password-text="请联系车队管理员重置密码"
    :authenticate="authenticate"
    :authenticate-phone="isWechatPhoneLoginEnabled ? authenticatePhone : undefined"
    :explain-error="explainError"
    @success="openHome"
  />
</template>
