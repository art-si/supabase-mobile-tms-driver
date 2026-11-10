<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'
import { getUserFacingErrorMessage } from '@/api/supabase'
import TmsIcon from '@/components/business/TmsIcon.vue'
import { usePageTheme } from '@/composables/usePageTheme'

const { themeName } = usePageTheme()
const auth = useAuthStore()
const profile = useProfileStore()
const account = ref('')
const password = ref('')
const remember = ref(true)
const loading = ref(false)
const phoneLoading = ref(false)
const accountError = ref('')
const passwordError = ref('')
const loginError = ref('')
const focusField = ref<'account' | 'password' | ''>('')
const inputStyle = 'width: 100%; height: 100%; --wot-input-padding: 0 24rpx; --wot-input-bg: transparent; --wot-input-inner-height: 88rpx; --wot-input-inner-font-size: 28rpx; --wot-input-inner-color: #172033; --wot-input-inner-placeholder-color: #98a3b5;'
const accountValue = computed(() => account.value.trim())

watch(account, () => {
  accountError.value = ''
  loginError.value = ''
})
watch(password, () => {
  passwordError.value = ''
  loginError.value = ''
})

onLoad(() => {
  auth.hydrate()
  const cachedAccount = uni.getStorageSync('tms-driver-account')
  if (cachedAccount) account.value = String(cachedAccount)
  if (auth.isLoggedIn) {
    uni.reLaunch({ url: '/pages/home/index' })
  }
})

onMounted(() => {
  // #ifdef H5
  const inputs = document.querySelectorAll<HTMLInputElement>('.login-form input')
  inputs[0]?.setAttribute('autocomplete', 'username')
  inputs[0]?.setAttribute('name', 'username')
  inputs[1]?.setAttribute('autocomplete', 'current-password')
  inputs[1]?.setAttribute('name', 'password')
  // #endif
})

async function submit() {
  if (loading.value) return
  accountError.value = accountValue.value ? '' : '请输入司机账号'
  passwordError.value = password.value ? '' : '请输入登录密码'
  loginError.value = ''
  if (accountError.value || passwordError.value) {
    focusField.value = accountError.value ? 'account' : 'password'
    return
  }

  focusField.value = ''
  loading.value = true
  try {
    await auth.login(accountValue.value, password.value)
    if (remember.value) {
      uni.setStorageSync('tms-driver-account', accountValue.value)
    } else {
      uni.removeStorageSync('tms-driver-account')
    }
    await profile.load(true)
    uni.reLaunch({ url: '/pages/home/index' })
  } catch (error) {
    loginError.value = getUserFacingErrorMessage(error, '登录失败，请检查账号与密码')
  } finally {
    loading.value = false
  }
}

async function phoneLogin(event?: unknown) {
  if (phoneLoading.value) return
  const payload = event as { code?: string; detail?: { code?: string; errMsg?: string } } | undefined
  const detail = payload?.detail || payload
  const phoneCode = detail?.code

  if (!phoneCode) {
    uni.showToast({ title: '请在微信小程序中授权手机号登录', icon: 'none' })
    return
  }

  phoneLoading.value = true
  try {
    await auth.loginWithWechatPhone(phoneCode)
    await profile.load(true)
    uni.reLaunch({ url: '/pages/home/index' })
  } catch (error) {
    uni.showToast({
      title: getUserFacingErrorMessage(error, '手机号登录暂不可用，请使用账号密码登录'),
      icon: 'none'
    })
  } finally {
    phoneLoading.value = false
  }
}

function forgotPassword() {
  uni.showToast({ title: '请联系车队管理员重置密码', icon: 'none' })
}

</script>

<template>
<wd-config-provider :theme="themeName">
  <view class="login-page page">
    <view class="login-page__orb login-page__orb--one" />
    <view class="login-page__orb login-page__orb--two" />
    <view class="login-page__grid" />

    <view class="login-page__hero">
      <view class="login-page__brand">
        <view class="login-page__mark">
          <view class="login-page__mark-main" />
          <view class="login-page__mark-dots">
            <text />
            <text />
            <text />
          </view>
        </view>
        <text class="login-page__name">TMS</text>
        <text class="login-page__badge">司机端</text>
      </view>
      <text class="login-page__eyebrow">智慧运输协同</text>
      <text class="login-page__title">每一程，都清晰可控</text>
      <text class="login-page__description">任务、路线、车辆与回单集中处理，让运输履约更简单。</text>
      <view class="login-page__trust">
        <view><text class="login-page__trust-dot" />任务实时同步</view>
        <view><text class="login-page__trust-dot" />数据安全连接</view>
      </view>
    </view>

    <view class="login-form" role="form" aria-label="司机账号登录">
      <view class="login-form__head">
        <view>
          <text class="login-form__title">账号登录</text>
          <text class="login-form__hint">使用后台分配的司机账号</text>
        </view>
        <text class="login-form__secure">安全登录</text>
      </view>
      <view class="login-form__control" :class="{ 'login-form__control--error': accountError }">
        <text class="login-form__label">司机账号</text>
        <view class="login-form__field" :class="{ 'login-form__field--focused': focusField === 'account' }">
          <wd-input
            v-model="account"
            :custom-style="inputStyle"
            aria-label="司机账号，手机号或邮箱"
            :aria-invalid="Boolean(accountError)"
            :error="Boolean(accountError)"
            :focus="focusField === 'account'"
            placeholder="请输入手机号/邮箱"
            placeholder-style="color: #98a3b5"
            autocomplete="username"
            type="text"
            confirm-type="next"
            clearable
            no-border
            :disabled="loading"
            @focus="focusField = 'account'"
            @blur="focusField = ''"
          >
            <template #prefix><TmsIcon name="user" size="34rpx" /></template>
          </wd-input>
        </view>
        <text v-if="accountError" class="login-form__error" role="alert">{{ accountError }}</text>
      </view>
      <view class="login-form__control" :class="{ 'login-form__control--error': passwordError }">
        <text class="login-form__label">登录密码</text>
        <view class="login-form__field" :class="{ 'login-form__field--focused': focusField === 'password' }">
          <wd-input
            v-model="password"
            :custom-style="inputStyle"
            aria-label="登录密码"
            :aria-invalid="Boolean(passwordError)"
            :error="Boolean(passwordError)"
            :focus="focusField === 'password'"
            placeholder="请输入登录密码"
            placeholder-style="color: #98a3b5"
            autocomplete="current-password"
            show-password
            confirm-type="done"
            no-border
            :disabled="loading"
            @focus="focusField = 'password'"
            @blur="focusField = ''"
            @confirm="submit"
          >
            <template #prefix><TmsIcon name="lock" size="34rpx" /></template>
          </wd-input>
        </view>
        <text v-if="passwordError" class="login-form__error" role="alert">{{ passwordError }}</text>
      </view>
      <text v-if="loginError" class="login-form__error login-form__error--server" role="alert" aria-live="polite">{{ loginError }}</text>

      <view class="login-form__options">
        <view class="login-form__remember">
          <wd-checkbox
            v-model="remember"
            type="square"
            checked-color="var(--tms-primary)"
            :disabled="loading"
          >
            记住我
          </wd-checkbox>
        </view>
        <button
          class="login-form__link"
          hover-class="login-form__link--pressed"
          @tap="forgotPassword"
        >
          忘记密码？
        </button>
      </view>

      <view class="login-form__button">
        <wd-button
          custom-class="tms-primary-action"
          type="primary"
          size="large"
          block
          :round="false"
          :loading="loading"
          :disabled="loading"
          :aria-busy="loading"
          @click="submit"
        >
          登录
        </wd-button>
      </view>
    </view>

    <!-- #ifdef MP-WEIXIN -->
    <view class="login-page__phone-wrap">
      <wd-button
        open-type="getPhoneNumber"
        variant="text"
        custom-style="width: 220rpx; min-width: 110px; height: 130rpx; min-height: 65px; margin: 0; padding: 0; border: 0; color: #748096; background: transparent; box-shadow: none; opacity: 1;"
        :disabled="phoneLoading"
        @getphonenumber="phoneLogin"
      >
        <view class="login-page__phone-content">
          <view class="login-page__phone-icon">
            <wd-loading v-if="phoneLoading" type="circular" color="#ffffff" size="34rpx" />
            <TmsIcon v-else name="mobile" size="44rpx" />
          </view>
          <text>{{ phoneLoading ? '正在登录…' : '手机一键登录' }}</text>
        </view>
      </wd-button>
    </view>
    <!-- #endif -->
    <view class="login-page__agreement">
      司机账号由车队管理员开通与管理
    </view>
  </view>
</wd-config-provider>
</template>

<style scoped lang="scss">
.login-page {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  padding: calc(70rpx + env(safe-area-inset-top)) 34rpx calc(32rpx + env(safe-area-inset-bottom));
  overflow-x: hidden;
  background:
    radial-gradient(circle at 92% 2%, rgba(var(--tms-primary-rgb), 0.12), transparent 360rpx),
    linear-gradient(180deg, var(--tms-primary-soft) 0%, var(--tms-bg) 52%, var(--tms-bg) 100%);
  display: flex;
  flex-direction: column;
}

.login-page__orb {
  position: absolute;
  z-index: 0;
  border-radius: 50%;
  pointer-events: none;
}

.login-page__orb--one {
  top: -220rpx;
  right: -220rpx;
  width: 540rpx;
  height: 540rpx;
  border: 1rpx solid rgba(var(--tms-primary-rgb), 0.12);
  box-shadow:
    0 0 0 74rpx rgba(var(--tms-primary-rgb), 0.025),
    0 0 0 148rpx rgba(var(--tms-primary-rgb), 0.018);
}

.login-page__orb--two {
  left: -120rpx;
  bottom: 120rpx;
  width: 260rpx;
  height: 260rpx;
  background: rgba(56, 189, 248, 0.05);
  filter: blur(8rpx);
}

.login-page__grid {
  position: absolute;
  inset: 0 0 auto;
  height: 620rpx;
  opacity: 0.08;
  background-image:
    linear-gradient(rgba(var(--tms-primary-rgb), 0.08) 1rpx, transparent 1rpx),
    linear-gradient(90deg, rgba(var(--tms-primary-rgb), 0.08) 1rpx, transparent 1rpx);
  background-size: 82rpx 82rpx;
  mask-image: linear-gradient(to bottom, #000, transparent);
  pointer-events: none;
}

.login-page__hero,
.login-form,
.login-page__phone-wrap,
.login-page__agreement {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
}

.login-page__hero {
  padding: 0 14rpx;
}

.login-page__hero,
.login-form {
  flex-shrink: 0;
}

.login-page__brand {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.login-page__mark {
  position: relative;
  width: 72rpx;
  height: 72rpx;
}

.login-page__mark-main {
  position: absolute;
  left: 5rpx;
  top: 14rpx;
  width: 48rpx;
  height: 48rpx;
  background: linear-gradient(135deg, var(--tms-primary), var(--tms-primary-bright));
  border-radius: 14rpx;
  box-shadow: 0 12rpx 22rpx rgba(var(--tms-primary-rgb), 0.22);
  transform: rotate(45deg);
}

.login-page__mark-dots {
  position: absolute;
  right: 0;
  top: 20rpx;
  width: 38rpx;
  height: 42rpx;
}

.login-page__mark-dots text {
  position: absolute;
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: #f59e0b;
}

.login-page__mark-dots text:nth-child(1) {
  left: 0;
  top: 14rpx;
}

.login-page__mark-dots text:nth-child(2) {
  left: 16rpx;
  top: 0;
}

.login-page__mark-dots text:nth-child(3) {
  right: 0;
  bottom: 0;
}

.login-page__name {
  color: #172033;
  font-size: 50rpx;
  font-style: italic;
  font-weight: 700;
  letter-spacing: 0;
}

.login-page__badge {
  height: 42rpx;
  padding: 0 14rpx;
  border-radius: 10rpx;
  background: var(--tms-primary);
  color: #fff;
  font-size: max(23rpx, 12px);
  font-weight: 700;
  display: flex;
  align-items: center;
}

.login-page__eyebrow {
  display: block;
  margin-top: 64rpx;
  color: var(--tms-primary);
  font-size: max(19rpx, 12px);
  font-weight: 700;
}

.login-page__title {
  display: block;
  margin-top: 18rpx;
  color: var(--tms-text-strong);
  font-size: 46rpx;
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: -1.2rpx;
  font-optical-sizing: auto;
}

.login-page__description {
  display: block;
  max-width: 590rpx;
  margin-top: 18rpx;
  color: var(--tms-text-secondary);
  font-size: max(25rpx, 12px);
  font-weight: 500;
  line-height: 1.65;
}

.login-page__trust {
  margin-top: 28rpx;
  display: flex;
  align-items: center;
  gap: 28rpx;
  color: var(--tms-muted);
  font-size: max(21rpx, 12px);
  font-weight: 600;
}

.login-page__trust view {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.login-page__trust-dot {
  width: 9rpx;
  height: 9rpx;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 0 5rpx rgba(16, 185, 129, 0.1);
}

.login-form {
  margin-top: 54rpx;
  padding: 32rpx;
  background: var(--tms-material-regular);
  border: 1rpx solid rgba(255, 255, 255, 0.76);
  border-radius: 30rpx;
  box-shadow: var(--tms-shadow-floating);
  backdrop-filter: blur(26rpx) saturate(145%);
  -webkit-backdrop-filter: blur(26rpx) saturate(145%);
}

.login-form__head {
  margin-bottom: 28rpx;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18rpx;
}

.login-form__title,
.login-form__hint {
  display: block;
}

.login-form__title {
  color: var(--tms-text-strong);
  font-size: 30rpx;
  font-weight: 700;
}

.login-form__hint {
  margin-top: 8rpx;
  color: var(--tms-text-secondary);
  font-size: max(21rpx, 12px);
}

.login-form__secure {
  padding: 8rpx 14rpx;
  border-radius: 999rpx;
  color: var(--tms-green-strong);
  background: var(--tms-green-soft);
  font-size: max(20rpx, 12px);
  font-weight: 700;
}

.login-form__field {
  height: 98rpx;
  min-height: 44px;
  border: 1rpx solid var(--tms-line);
  border-radius: 18rpx;
  background: rgba(118, 118, 128, 0.08);
  overflow: hidden;
  transition:
    border-color var(--tms-apple-duration-fast) var(--tms-apple-ease),
    box-shadow var(--tms-apple-duration-fast) var(--tms-apple-ease),
    background-color var(--tms-apple-duration-fast) var(--tms-apple-ease);
}

.login-form__control + .login-form__control {
  margin-top: 18rpx;
}

.login-form__label {
  display: block;
  margin-bottom: 10rpx;
  color: var(--tms-text-secondary);
  font-size: max(25rpx, 14px);
  font-weight: 600;
}

.login-form__control--error .login-form__field {
  border-color: #e5484d;
}

.login-form__field--focused,
.login-form__field:focus-within {
  border-color: var(--tms-primary);
  background: rgba(var(--tms-primary-rgb), 0.045);
  box-shadow: 0 0 0 4rpx rgba(var(--tms-primary-rgb), 0.12);
}

.login-form__control--error .login-form__field--focused,
.login-form__control--error .login-form__field:focus-within {
  border-color: #e5484d;
  box-shadow: 0 0 0 3px rgba(229, 72, 77, 0.13);
}

.login-form__error {
  display: block;
  margin-top: 8rpx;
  color: var(--tms-red-strong);
  font-size: max(22rpx, 12px);
  line-height: 1.4;
}

.login-form__error--server {
  margin-top: 18rpx;
}

.login-form__options {
  margin-top: 20rpx;
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--tms-text-strong);
  font-size: max(26rpx, 12px);
}

.login-form__remember {
  min-height: 88rpx;
  display: flex;
  align-items: center;
  font-size: max(24rpx, 12px);
}

.login-form__remember :deep(.wd-checkbox__shape) {
  width: 32rpx;
  height: 32rpx;
  border-width: 2rpx;
  border-radius: 10rpx;
}

.login-form__remember :deep(.wd-checkbox__label) {
  color: var(--tms-text-strong);
  font-size: max(23rpx, 12px);
}

.login-form__link {
  min-height: 88rpx;
  margin: 0;
  padding: 0 4rpx 0 18rpx;
  border: 0;
  color: var(--tms-primary);
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: max(23rpx, 12px);
  font-weight: 700;
  line-height: 1;
  touch-action: manipulation;
  transition:
    color var(--tms-apple-duration-fast) var(--tms-apple-ease),
    background-color var(--tms-apple-duration-fast) var(--tms-apple-ease),
    transform var(--tms-apple-duration-fast) var(--tms-apple-ease);
}

.login-form__link::after {
  border: 0;
}

.login-form__link--pressed {
  color: var(--tms-primary-deep);
  background: rgba(var(--tms-primary-rgb), 0.06);
  transform: scale(0.98);
}

.login-form__button {
  margin-top: 24rpx;
}

@media screen and (max-height: 700px) {
  .login-page {
    padding-top: calc(38rpx + env(safe-area-inset-top));
  }

  .login-page__eyebrow {
    margin-top: 34rpx;
  }

  .login-form {
    margin-top: 38rpx;
  }
}

.login-page__phone-wrap {
  margin-top: 24rpx;
  flex-shrink: 0;
  display: flex;
  justify-content: center;
}

.login-page__phone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  color: var(--tms-text-secondary);
  font-size: max(24rpx, 12px);
  line-height: 1.2;
}

.login-page__phone-icon {
  width: 74rpx;
  height: 74rpx;
  border-radius: 50%;
  color: #fff;
  background: var(--tms-primary);
  box-shadow: var(--tms-shadow-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-page__agreement {
  margin-top: auto;
  padding-top: 30rpx;
  color: var(--tms-light);
  font-size: max(20rpx, 12px);
  line-height: 1.6;
  text-align: center;
}

@media (prefers-reduced-transparency: reduce) {
  .login-form {
    background: var(--tms-surface);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

</style>
