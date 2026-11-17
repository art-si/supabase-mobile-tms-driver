<script setup lang="ts">
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import TmsBottomNav from '@/components/business/TmsBottomNav.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileAccountIdentity from '@mobile-core/components/MobileAccountIdentity.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileSectionHeading from '@mobile-core/components/MobileSectionHeading.vue'
import MobileSignOutDialog from '@mobile-core/components/MobileSignOutDialog.vue'
import { useOverlayFocus } from '@mobile-core/overlay-focus'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import type { MobileIconName } from '@mobile-core/icons'
import MobileMetricGrid from '@mobile-core/components/MobileMetricGrid.vue'
import TmsPageSkeleton from '@mobile-core/components/TmsPageSkeleton.vue'
import { getUserFacingErrorMessage } from '@/api/supabase'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'
import { maskIdCard, maskPhone } from '@/utils/format'
import { usePageTheme } from '@/composables/usePageTheme'

const { themeName } = usePageTheme()
const auth = useAuthStore()
const profile = useProfileStore()

const driver = computed(() => profile.driver)
const user = computed(() => profile.user)
const carrier = computed(() => profile.carrier)
const initialLoading = ref(!profile.summary)
const syncing = ref(false)
const loadError = ref('')
const helpVisible = ref(false)
const contactNoticeVisible = ref(false)
const logoutConfirmVisible = ref(false)
const showSkeleton = computed(() => !profile.summary && (initialLoading.value || Boolean(loadError.value)))

type PopupPanel = HTMLElement | { $el?: unknown }
const helpPanel = ref<PopupPanel>()
const contactPanel = ref<PopupPanel>()
useOverlayFocus(helpVisible, {
  panel: () => helpPanel.value, cancel: () => { helpVisible.value = false }
})
useOverlayFocus(contactNoticeVisible, {
  panel: () => contactPanel.value, cancel: () => { contactNoticeVisible.value = false }
})

const metrics = computed(() => [
  { label: '运输次数', value: profile.summary?.completedCount ?? 0 },
  { label: '运输里程', value: profile.summary?.totalMileageKm ?? 0, unit: 'km' },
  { label: '服务评分', value: profile.summary?.rating || '--' }
])

const serviceGroups: readonly { title: string; services: readonly { label: string; icon: MobileIconName; open: () => void }[] }[] = [
  {
    title: '常用服务',
    services: [
      { label: '提货预约', icon: 'schedule', open: () => openPage('/pages/appointment/index?kind=pickup') },
      { label: '送货预约', icon: 'location', open: () => openPage('/pages/appointment/index?kind=delivery') },
      { label: '异常报备', icon: 'warning', open: () => openPage('/pages/mine/exception') },
      { label: '在途费用', icon: 'expense', open: () => openService('expense') },
      { label: '过磅记录', icon: 'document', open: () => openService('weighbridge') },
      { label: '电子回单', icon: 'receipt', open: openCompletedWaybills },
    ],
  },
  {
    title: '司机与帮助',
    services: [
      { label: '司机认证', icon: 'user', open: () => openPage('/pages/mine/certification') },
      { label: 'AI 助手', icon: 'message', open: () => openPage('/pages/mine/assistant') },
      { label: '联系车队', icon: 'phone', open: contactCarrier },
      { label: '使用说明', icon: 'help', open: () => { helpVisible.value = true } },
    ],
  },
]

const displayName = computed(
  () => driver.value?.driverName || user.value?.nickName || user.value?.userName || '司机师傅'
)

onShow(() => {
  void load()
})

async function load() {
  if (syncing.value) return
  syncing.value = true
  if (!profile.summary) initialLoading.value = true
  loadError.value = ''
  try {
    await profile.load(true)
  } catch (error) {
    loadError.value = getUserFacingErrorMessage(error, '司机档案同步失败，请重试')
  } finally {
    syncing.value = false
    initialLoading.value = false
  }
}

async function refreshProfile() {
  if (syncing.value) return
  await load()
  if (!loadError.value) uni.showToast({ title: '司机档案已更新', icon: 'success' })
}

function openService(service: 'expense' | 'weighbridge') {
  openPage(`/pages/waybill/index?service=${service}`)
}

function openPage(url: string) { uni.navigateTo({ url }) }

function openCompletedWaybills() {
  uni.reLaunch({ url: '/pages/waybill/index?group=completed' })
}

function contactCarrier() {
  const phone = carrier.value?.contactPhone
  if (phone) {
    uni.makePhoneCall({ phoneNumber: phone })
  } else {
    contactNoticeVisible.value = true
  }
}

function openSettings() {
  uni.navigateTo({ url: '/pages/settings/index' })
}

async function confirmLogout() {
  profile.clear()
  await auth.logout()
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace container-class="page driver-page">
      <MobileTopBar title="我的" capsule="always" />

      <view class="driver-content driver-content--tabbed" role="main">
        <TmsPageSkeleton
          v-if="showSkeleton"
          label="正在同步司机档案…"
          :error="loadError"
          @retry="load"
        />
        <view v-else class="mine-page__content">
          <MobileAccountIdentity :name="displayName" :detail="carrier?.companyName || '暂未绑定承运商'" :avatar-url="user?.avatar" initials>
            <template #action>
              <MobileAction
                class="mine-icon-button" variant="icon"
                :aria-label="syncing ? '正在刷新司机档案' : '刷新司机档案'"
                :disabled="syncing"
                @click="refreshProfile"
              >
                <MobileIcon name="refresh" size="18px" />
              </MobileAction>
            </template>
          </MobileAccountIdentity>
          <MobileLoadError v-if="loadError" title="司机档案刷新失败" :message="loadError" @retry="load()" />

          <view v-for="group in serviceGroups" :key="group.title" class="mobile-group-section">
            <MobileSectionHeading :title="group.title" />
            <view class="mobile-group">
              <MobileAction
                v-for="service in group.services"
                :key="service.label"
                class="mobile-row"
                @click="service.open"
              >
                <view class="mobile-row__icon" aria-hidden="true">
                  <MobileIcon :name="service.icon" size="17px" />
                </view>
                <view class="mobile-row__body">
                  <text class="mobile-row__label">{{ service.label }}</text>
                </view>
                <MobileIcon class="mobile-row__chevron" name="chevron" size="14px" aria-hidden="true" />
              </MobileAction>
            </view>
          </view>

          <view class="mobile-group-section">
            <MobileSectionHeading title="履约表现" />
            <MobileMetricGrid :items="metrics" />
          </view>

          <view class="mobile-group-section">
            <MobileSectionHeading title="账户信息" />
            <view class="mobile-group">
              <view class="mobile-row mobile-row--static">
                <view class="mobile-row__body"><text class="mobile-row__label">手机号</text></view>
                <text class="mobile-row__trailing mobile-row__detail mobile-row__value">{{ maskPhone(driver?.phone || user?.userPhone) }}</text>
              </view>
              <view class="mobile-row mobile-row--static">
                <view class="mobile-row__body"><text class="mobile-row__label">身份证号</text></view>
                <text class="mobile-row__trailing mobile-row__detail mobile-row__value">{{ maskIdCard(driver?.idCardNo) }}</text>
              </view>
              <view class="mobile-row mobile-row--static">
                <view class="mobile-row__body"><text class="mobile-row__label">准驾车型</text></view>
                <text class="mobile-row__trailing mobile-row__detail mobile-row__value">{{ driver?.licenseType || '--' }}</text>
              </view>
            </view>
          </view>

          <view class="mobile-group-section">
            <MobileSectionHeading title="设置与账号" />
            <view class="mobile-group">
              <MobileAction class="mobile-row" aria-label="打开设置，管理主题配色" @click="openSettings">
                <view class="mobile-row__icon" aria-hidden="true"><MobileIcon name="settings" size="17px" /></view>
                <view class="mobile-row__body"><text class="mobile-row__label">主题配色</text></view>
                <MobileIcon class="mobile-row__chevron" name="chevron" size="14px" aria-hidden="true" />
              </MobileAction>
            </view>
          </view>
          <view class="mobile-group">
            <MobileAction class="mobile-row mobile-row--danger" @click="logoutConfirmVisible = true">
              <text class="mobile-row__label">退出登录</text>
            </MobileAction>
          </view>
        </view>
      </view>

      <TmsBottomNav active="mine" />

      <wd-popup v-model="helpVisible" position="bottom" round :z-index="60"
        custom-style="padding-bottom:var(--mobile-safe-bottom,0px);"
      >
        <view ref="helpPanel" class="mine-help__panel" role="dialog" aria-modal="true" aria-label="使用说明" tabindex="-1">
          <view class="driver-heading">
            <text class="section-title" role="heading" aria-level="2">使用说明</text>
            <MobileAction class="mine-icon-button" variant="icon" aria-label="关闭使用说明" @click="helpVisible = false">
              <MobileIcon name="close" size="16px" />
            </MobileAction>
          </view>
          <view class="mine-help__steps">
            <view><text>1</text><text>在运单列表核对站点与货物信息，接受任务。</text></view>
            <view><text>2</text><text>到达装货地打卡，填写重量并上传照片与磅单。</text></view>
            <view><text>3</text><text>录入发车信息。到达后完成卸货、签收和回单上传。</text></view>
            <view><text>4</text><text>录入收车里程与车辆照片。垫付费用可在运单内上报。</text></view>
          </view>
          <MobileAction class="tms-primary-action mine-modal-action mine-help__done" @click="helpVisible = false">我知道了</MobileAction>
        </view>
      </wd-popup>

      <wd-popup v-model="contactNoticeVisible" position="center" round :z-index="70"
      >
        <view ref="contactPanel" class="mine-dialog__body" role="alertdialog" aria-modal="true" aria-label="联系车队" tabindex="-1">
          <text class="section-title" role="heading" aria-level="2">联系车队</text>
          <text class="driver-copy">当前承运商尚未配置联系电话，请联系车队管理员。</text>
          <MobileAction class="tms-primary-action mine-modal-action" @click="contactNoticeVisible = false">我知道了</MobileAction>
        </view>
      </wd-popup>

      <MobileSignOutDialog v-model="logoutConfirmVisible" :sign-out="confirmLogout" />
    </MobileWorkspace>
  </wd-config-provider>
</template>

<style scoped lang="scss">
@use '@mobile-core/styles/workspace';

.mine-page__content {
  display: grid;
  min-width: 0;
  gap: 16px;
}

.mine-icon-button.mobile-action {
  border-radius: 50%;
  color: var(--mobile-workspace-accent);
}

.mine-icon-button.mobile-action:active {
  background: var(--tms-primary-soft);
}

.mine-help__panel {
  max-width: 560px;
  max-height: 80vh;
  @include workspace.limit-bottom-sheet(80vh);
  margin-inline: auto;
  padding: 16px max(20px, var(--mobile-safe-right)) 20px max(20px, var(--mobile-safe-left));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.mine-help__steps {
  display: grid;
  gap: 12px;
  margin: 8px 0 20px;
  color: var(--mobile-workspace-muted);
  font-size: 14px;
  line-height: 1.5;
}

.mine-help__steps view {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
}

.mine-help__steps view text:first-child {
  color: var(--mobile-workspace-accent);
  font-weight: 700;
}

.mine-dialog__body {
  display: grid;
  width: min(84vw, 360px);
  padding: 20px;
  gap: 14px;
  background: var(--mobile-workspace-surface);
}

.mine-modal-action.mobile-action {
  display: grid;
  width: 100%;
  place-items: center;
}
</style>
