<script setup lang="ts">
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import TmsBottomNav from '@/components/business/TmsBottomNav.vue'
import TmsIcon from '@/components/business/TmsIcon.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import type { MobileIconName } from '@mobile-core/icons'
import MobileMetricGrid from '@mobile-core/components/MobileMetricGrid.vue'
import TmsPageSkeleton from '@mobile-core/components/TmsPageSkeleton.vue'
import { getUserFacingErrorMessage } from '@/api/supabase'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'
import { useWaybillStore } from '@/stores/waybill'
import { maskIdCard, maskPhone } from '@/utils/format'
import { usePageTheme } from '@/composables/usePageTheme'

const { themeName } = usePageTheme()
const auth = useAuthStore()
const profile = useProfileStore()
const waybill = useWaybillStore()

const driver = computed(() => profile.driver)
const user = computed(() => profile.user)
const carrier = computed(() => profile.carrier)
const initialLoading = ref(!profile.summary)
const syncing = ref(false)
const loadError = ref('')
const openingExpense = ref(false)
const helpVisible = ref(false)
const contactNoticeVisible = ref(false)
const logoutConfirmVisible = ref(false)
const showSkeleton = computed(() => !profile.summary && (initialLoading.value || Boolean(loadError.value)))

type PopupPanel = HTMLElement | { $el: HTMLElement }
const helpPanel = ref<PopupPanel>()
const contactPanel = ref<PopupPanel>()
const logoutPanel = ref<PopupPanel>()
let popupTrigger: HTMLElement | null = null
let activePopup: HTMLElement | undefined

const metrics = computed(() => [
  { label: '运输次数', value: profile.summary?.completedCount ?? 0 },
  { label: '运输里程', value: profile.summary?.totalMileageKm ?? 0, unit: 'km' },
  { label: '服务评分', value: profile.summary?.rating || '--' }
])

const services: readonly { label: string; icon: MobileIconName; open: () => void }[] = [
  { label: '费用记录', icon: 'expense', open: openExpense },
  { label: '电子回单', icon: 'receipt', open: openCompletedWaybills },
  { label: '联系车队', icon: 'phone', open: contactCarrier },
  { label: '使用说明', icon: 'help', open: () => { helpVisible.value = true } }
]

const displayName = computed(
  () => driver.value?.driverName || user.value?.nickName || user.value?.userName || '司机师傅'
)
const avatarInitial = computed(() => Array.from(displayName.value.trim())[0] || '司')
const avatarLoadedUrl = ref('')
const avatarSrc = computed(() => user.value?.avatar || '')
const avatarReady = computed(() => Boolean(avatarSrc.value && avatarLoadedUrl.value === avatarSrc.value))

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
    if (profile.summary) uni.showToast({ title: loadError.value, icon: 'none' })
  } finally {
    syncing.value = false
    initialLoading.value = false
  }
}

async function refreshProfile() {
  await load()
  if (!loadError.value) uni.showToast({ title: '司机档案已更新', icon: 'success' })
}

async function openExpense() {
  if (openingExpense.value) return
  openingExpense.value = true
  try {
    const list = await waybill.loadList('all')
    const item = list.find((entry) =>
      ['accepted', 'loading', 'transporting', 'unloading', 'signed', 'completed'].includes(entry.status)
    )
    if (item) {
      uni.navigateTo({ url: `/pages/waybill/expense?id=${encodeURIComponent(item.id)}` })
    } else {
      uni.showToast({ title: '暂无可查看费用的运单', icon: 'none' })
    }
  } catch (error) {
    uni.showToast({ title: getUserFacingErrorMessage(error, '费用记录加载失败，请重试'), icon: 'none' })
  } finally {
    openingExpense.value = false
  }
}

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

function rememberPopupTrigger() {
  // #ifdef H5
  popupTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  // #endif
}

function focusPopup(panel: PopupPanel | undefined, close: () => void) {
  // #ifdef H5
  activePopup = panel instanceof HTMLElement ? panel : panel?.$el
  if (!activePopup) return
  activePopup.onkeydown = event => handlePopupKeydown(event, close)
  activePopup.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
  // #endif
}

function handlePopupKeydown(event: KeyboardEvent, close: () => void) {
  // #ifdef H5
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'Tab') return
  if (!(event.currentTarget instanceof HTMLElement)) return
  const buttons = event.currentTarget.querySelectorAll<HTMLElement>('[tabindex="0"]')
  const first = buttons[0]
  const last = buttons[buttons.length - 1]
  if (event.shiftKey ? event.target !== first : event.target !== last) return
  event.preventDefault()
  const next = event.shiftKey ? last : first
  next?.focus()
  // #endif
}

function restorePopupTrigger() {
  if (activePopup) activePopup.onkeydown = null
  activePopup = undefined
  if (popupTrigger?.isConnected) popupTrigger.focus({ preventScroll: true })
  popupTrigger = null
}

async function confirmLogout() {
  logoutConfirmVisible.value = false
  try {
    profile.clear()
    await auth.logout()
  } catch {
    uni.showToast({ title: '退出登录失败，请稍后重试', icon: 'none' })
  }
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace class="page driver-page">
      <MobileTopBar title="我的" capsule="always" />

      <view class="driver-content driver-content--tabbed">
        <TmsPageSkeleton
          v-if="showSkeleton"
          label="正在同步司机档案…"
          :error="loadError"
          @retry="load"
        />
        <view v-else class="mine-page__content">
          <view class="driver-card mine-identity">
            <view class="mine-identity__avatar" aria-hidden="true">
              <text v-if="!avatarReady">{{ avatarInitial }}</text>
              <image
                v-if="avatarSrc"
                class="mine-identity__photo"
                :class="{ 'mine-identity__photo--ready': avatarReady }"
                :src="avatarSrc"
                mode="aspectFill"
                @load="avatarLoadedUrl = avatarSrc"
              />
            </view>
            <view class="mobile-row__body">
              <text class="mine-identity__name">{{ displayName }}</text>
              <text class="mobile-row__detail">{{ carrier?.companyName || '暂未绑定承运商' }}</text>
            </view>
            <MobileAction
              class="mine-icon-button"
              :aria-label="syncing ? '正在刷新司机档案' : '刷新司机档案'"
              :disabled="syncing"
              @click="refreshProfile"
            >
              <TmsIcon name="refresh" size="18px" />
            </MobileAction>
          </view>

          <view>
            <text class="mobile-group-title" role="heading" aria-level="2">常用服务</text>
            <view class="mobile-group">
              <MobileAction
                v-for="service in services"
                :key="service.icon"
                class="mobile-row"
                :disabled="service.icon === 'expense' && openingExpense"
                @click="service.open"
              >
                <view class="mobile-row__icon" aria-hidden="true">
                  <TmsIcon :name="service.icon" size="17px" />
                </view>
                <view class="mobile-row__body">
                  <text class="mobile-row__label">{{ service.label }}</text>
                </view>
                <TmsIcon class="mobile-row__chevron" name="chevron" size="14px" aria-hidden="true" />
              </MobileAction>
            </view>
          </view>

          <view>
            <text class="mobile-group-title" role="heading" aria-level="2">履约表现</text>
            <MobileMetricGrid :items="metrics" />
          </view>

          <view>
            <text class="mobile-group-title" role="heading" aria-level="2">账户信息</text>
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

          <view class="mobile-group">
            <MobileAction class="mobile-row" aria-label="打开设置，管理主题配色" @click="openSettings">
              <view class="mobile-row__icon" aria-hidden="true"><TmsIcon name="settings" size="17px" /></view>
              <view class="mobile-row__body"><text class="mobile-row__label">主题配色</text></view>
              <TmsIcon class="mobile-row__chevron" name="chevron" size="14px" aria-hidden="true" />
            </MobileAction>
            <MobileAction class="mobile-row mine-page__logout" @click="logoutConfirmVisible = true">
              <text class="mobile-row__label">退出登录</text>
            </MobileAction>
          </view>
        </view>
      </view>

      <TmsBottomNav active="mine" />

      <wd-popup v-model="helpVisible" position="bottom" round :z-index="60"
        custom-style="padding-bottom:var(--mobile-safe-bottom,0px);"
        @before-enter="rememberPopupTrigger" @after-enter="focusPopup(helpPanel, () => helpVisible = false)" @after-leave="restorePopupTrigger"
      >
        <view ref="helpPanel" class="mine-help__panel" role="dialog" aria-modal="true" aria-label="使用说明">
          <view class="driver-heading">
            <text class="section-title" role="heading" aria-level="2">使用说明</text>
            <MobileAction class="mine-icon-button" aria-label="关闭使用说明" @click="helpVisible = false">
              <TmsIcon name="close" size="16px" />
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
        @before-enter="rememberPopupTrigger" @after-enter="focusPopup(contactPanel, () => contactNoticeVisible = false)" @after-leave="restorePopupTrigger"
      >
        <view ref="contactPanel" class="mine-dialog__body" role="alertdialog" aria-modal="true" aria-label="联系车队">
          <text class="section-title" role="heading" aria-level="2">联系车队</text>
          <text class="driver-copy">当前承运商尚未配置联系电话，请联系车队管理员。</text>
          <MobileAction class="tms-primary-action mine-modal-action" @click="contactNoticeVisible = false">我知道了</MobileAction>
        </view>
      </wd-popup>

      <wd-popup v-model="logoutConfirmVisible" position="center" round :z-index="70"
        @before-enter="rememberPopupTrigger" @after-enter="focusPopup(logoutPanel, () => logoutConfirmVisible = false)" @after-leave="restorePopupTrigger"
      >
        <view ref="logoutPanel" class="mine-dialog__body" role="alertdialog" aria-modal="true" aria-label="退出登录">
          <text class="section-title" role="heading" aria-level="2">退出登录</text>
          <text class="driver-copy">确认退出当前账号吗？</text>
          <view class="mine-dialog__actions">
            <MobileAction class="tms-secondary-action mine-modal-action" @click="logoutConfirmVisible = false">取消</MobileAction>
            <MobileAction class="tms-danger-action mine-modal-action" @click="confirmLogout">退出登录</MobileAction>
          </view>
        </view>
      </wd-popup>
    </MobileWorkspace>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.mine-page__content {
  display: grid;
  min-width: 0;
  gap: 16px;
}

.mine-identity {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mine-identity__avatar {
  position: relative;
  display: grid;
  width: 52px;
  height: 52px;
  flex: 0 0 52px;
  overflow: hidden;
  place-items: center;
  border-radius: 18px;
  color: var(--mobile-workspace-accent);
  background: var(--tms-primary-soft);
  font-size: 22px;
  font-weight: 700;
}

.mine-identity__photo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
}

.mine-identity__photo--ready {
  opacity: 1;
}

.mine-identity__name {
  color: var(--mobile-workspace-ink);
  font-size: clamp(18px, 4.6vw, 22px);
  font-weight: 700;
  line-height: 1.3;
}

.mine-icon-button.mobile-action {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  place-items: center;
  border-radius: 50%;
  color: var(--mobile-workspace-accent);
}

.mine-icon-button.mobile-action:active {
  background: var(--tms-primary-soft);
}

.mine-page__logout .mobile-row__label {
  color: var(--tms-red-strong);
}

.mine-help__panel {
  max-width: 560px;
  max-height: 80vh;
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

.mine-dialog__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.mine-modal-action.mobile-action {
  display: grid;
  width: 100%;
  place-items: center;
}
</style>
