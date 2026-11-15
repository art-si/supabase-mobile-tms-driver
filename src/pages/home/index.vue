<script setup lang="ts">
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import TmsBottomNav from '@/components/business/TmsBottomNav.vue'
import TmsIcon from '@/components/business/TmsIcon.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import TmsPageSkeleton from '@mobile-core/components/TmsPageSkeleton.vue'
import TmsRouteCard from '@/components/business/TmsRouteCard.vue'
import { useProfileStore } from '@/stores/profile'
import { useWaybillStore } from '@/stores/waybill'
import { useDictionaryStore } from '@/stores/dictionary'
import { openWaybillNavigation } from '@/utils/navigation'
import { formatVehicleLoad } from '@/utils/format'
import type { Waybill } from '@/api/types'
import { getUserFacingErrorMessage } from '@/api/supabase'
import { usePageTheme } from '@/composables/usePageTheme'

const { themeName } = usePageTheme()
const profile = useProfileStore()
const waybill = useWaybillStore()
const dictionary = useDictionaryStore()
const refreshing = ref(false)
const initialized = ref(false)
const loadError = ref('')

const driver = computed(() => profile.driver)
const vehicle = computed(() => profile.vehicle)
const carrier = computed(() => profile.carrier)
const task = computed(() => waybill.currentTask)
const todoList = computed(() => {
  const candidates = waybill.list.filter((item) => item.id !== task.value?.id)
  const pending = candidates.filter((item) => item.status === 'pending')
  const supplements = candidates.filter((item) =>
    ['accepted', 'loading', 'transporting', 'unloading', 'signed'].includes(item.status)
  )
  return [...pending, ...supplements].slice(0, 3)
})
const vehicleTypeLabel = computed(() => dictionary.label('vehicleType', vehicle.value?.vehicleType))
const vehicleStatusLabel = computed(() =>
  vehicle.value
    ? dictionary.label('vehicleOperationStatus', vehicle.value.operationStatus, '状态待同步')
    : '未绑定'
)
const vehicleModelSummary = computed(() => {
  const load = vehicle.value?.approvedLoadMass
  const loadLabel = load === undefined || load === null ? '载重待同步' : `载重 ${formatVehicleLoad(load)}`
  return `${vehicleTypeLabel.value} · ${loadLabel}`
})

const taskButtonText = computed(() => {
  const status = task.value?.status
  if (status === 'pending') return '核对并接受'
  if (status === 'accepted') return '装货打卡'
  if (status === 'loading') return '录入发车信息'
  if (status === 'transporting') return '到达打卡'
  if (status === 'unloading') return '查看卸货进度'
  if (status === 'signed') return '录入收车信息'
  return '查看详情'
})
const taskButtonIcon = computed(() => {
  const status = task.value?.status
  if (status === 'accepted' || status === 'transporting') return 'location'
  if (status === 'loading') return 'vehicle'
  if (status === 'unloading') return 'box'
  if (status === 'signed') return 'check'
  if (status === 'pending') return 'success'
  return 'arrow-right'
})
const taskButtonLabel = computed(() => {
  if (!waybill.actionLoading) return taskButtonText.value
  const status = task.value?.status
  if (status === 'pending') return '正在接受任务'
  if (status === 'accepted') return '正在提交提货资料'
  if (status === 'loading') return '正在确认发车'
  if (status === 'transporting') return '正在确认到达'
  if (status === 'unloading') return '正在提交签收资料'
  if (status === 'signed') return '正在完成运单'
  return '正在处理'
})
const taskButtonDisabled = computed(() => waybill.actionLoading || refreshing.value)
onShow(() => {
  void refresh()
})

async function refresh() {
  loadError.value = ''
  refreshing.value = true
  try {
    await profile.load(true)
    await waybill.loadHomeTask()
    await waybill.loadList('all')
  } catch (error) {
    loadError.value = getUserFacingErrorMessage(error, '首页同步失败，请重试')
  } finally {
    refreshing.value = false
    initialized.value = true
  }
}

function openDetail(id?: string) {
  if (!id) return
  uni.navigateTo({ url: `/pages/waybill/detail?id=${id}` })
}

function openWaybillList() {
  uni.reLaunch({ url: '/pages/waybill/index' })
}

function openSettings() {
  uni.navigateTo({ url: '/pages/settings/index' })
}

function openVehicle() {
  uni.reLaunch({ url: '/pages/vehicle/index' })
}

function navigate(item?: Waybill) {
  openWaybillNavigation(item || task.value)
}

function handleTaskAction() {
  if (!task.value) return
  const { id, status } = task.value
  const route =
    status === 'accepted'
      ? `/pages/waybill/cargo-operation?id=${encodeURIComponent(id)}&type=loading`
      : status === 'loading'
        ? `/pages/waybill/execution-operation?id=${encodeURIComponent(id)}&action=departure`
        : status === 'transporting'
          ? `/pages/waybill/cargo-operation?id=${encodeURIComponent(id)}&type=unloading&mode=arrival`
          : status === 'signed'
            ? `/pages/waybill/execution-operation?id=${encodeURIComponent(id)}&action=completion`
            : `/pages/waybill/detail?id=${encodeURIComponent(id)}`
  uni.navigateTo({ url: route })
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace class="page driver-page">
      <MobileTopBar
        capsule="always" title="工作台" :eyebrow="driver?.driverName" :subtitle="carrier?.companyName"
        show-menu menu-icon="settings" menu-label="打开设置" @menu="openSettings"
      />

      <view class="driver-content driver-content--tabbed home-page__content" role="main">
        <TmsPageSkeleton
          v-if="!initialized || (loadError && !profile.summary)"
          label="正在同步运输任务…" :error="loadError" @retry="refresh"
        />
        <template v-else>
          <view v-if="loadError" class="driver-card driver-heading">
            <text class="driver-error" role="alert">{{ loadError }}</text>
            <MobileAction class="driver-inline" @click="refresh">重试</MobileAction>
          </view>

          <view class="home-section">
            <TmsRouteCard
              v-if="task" :waybill="task" variant="task" show-progress
              @open="openDetail(task.id)" @navigate="navigate"
            >
              <MobileAction
                class="tms-primary-action task-card__button" :disabled="taskButtonDisabled"
                :aria-busy="waybill.actionLoading" @click="handleTaskAction"
              >
                <TmsIcon :name="taskButtonIcon" size="18px" />
                <text>{{ taskButtonLabel }}</text>
              </MobileAction>
            </TmsRouteCard>
            <view v-else class="driver-card driver-empty">
              <view class="driver-empty__icon"><TmsIcon name="waybill" size="24px" /></view>
              <text class="section-title">当前没有运输任务</text>
              <MobileAction class="driver-inline" @click="openWaybillList">查看运单</MobileAction>
            </view>
          </view>

          <view v-if="todoList.length" class="home-section">
            <view class="driver-heading home-section__heading">
              <text class="mobile-group-title" role="heading" aria-level="2">其他任务</text>
              <MobileAction class="driver-inline todo-card__all-content" @click="openWaybillList">
                全部运单 <TmsIcon name="arrow-right" size="14px" />
              </MobileAction>
            </view>
            <view class="driver-stack todo-card__stack">
              <TmsRouteCard
                v-for="item in todoList" :key="item.id" :waybill="item" variant="compact"
                @open="openDetail(item.id)" @navigate="navigate"
              />
            </view>
          </view>

          <view class="home-section">
            <text class="mobile-group-title" role="heading" aria-level="2">车辆</text>
            <view class="mobile-group">
              <MobileAction class="mobile-row" aria-label="查看车辆" @click="openVehicle">
                <view class="mobile-row__icon"><TmsIcon name="vehicle" size="20px" /></view>
                <view class="mobile-row__body">
                  <text class="mobile-row__label">{{ vehicle?.plateNo || '暂无绑定车辆' }}</text>
                  <text v-if="vehicle" class="mobile-row__detail">{{ vehicleModelSummary }}</text>
                </view>
                <text v-if="vehicle" class="mobile-row__detail mobile-row__trailing">{{ vehicleStatusLabel }}</text>
                <TmsIcon class="mobile-row__chevron" name="chevron" size="14px" />
              </MobileAction>
            </view>
          </view>
        </template>
      </view>

      <TmsBottomNav active="home" />
    </MobileWorkspace>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.home-section { display: grid; gap: 8px; min-width: 0; }
.home-section__heading > .mobile-group-title { margin: 0; }
.home-section > .mobile-group-title { margin: 0; }
.task-card__button {
  flex: 1 0 auto;
}
</style>
