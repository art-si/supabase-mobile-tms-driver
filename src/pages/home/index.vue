<script setup lang="ts">
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import MobileEmptyState from '@mobile-core/components/MobileEmptyState.vue'
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import TmsBottomNav from '@/components/business/TmsBottomNav.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileInlineLabel from '@mobile-core/components/MobileInlineLabel.vue'
import MobileLoadError from '@mobile-core/components/MobileLoadError.vue'
import MobileSectionHeading from '@mobile-core/components/MobileSectionHeading.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import TmsPageSkeleton from '@mobile-core/components/TmsPageSkeleton.vue'
import TmsRouteCard from '@/components/business/TmsRouteCard.vue'
import { useProfileStore } from '@/stores/profile'
import { useWaybillStore } from '@/stores/waybill'
import { useDictionaryStore } from '@/stores/dictionary'
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
const loadedTask = ref(false)
const loadError = ref('')
const task = ref<Waybill | null>(null)
const list = ref<Waybill[]>([])

const driver = computed(() => profile.driver)
const vehicle = computed(() => profile.vehicle)
const carrier = computed(() => profile.carrier)
const todoList = computed(() => {
  const candidates = list.value.filter((item) => item.id !== task.value?.id)
  const pending = candidates.filter((item) => item.status === 'pending')
  const supplements = candidates.filter((item) =>
    ['accepted', 'loading', 'transporting', 'unloading', 'signed'].includes(item.status)
  )
  return [...pending, ...supplements].slice(0, 3)
})
const vehicleStatusLabel = computed(() =>
  dictionary.findLabel('vehicleOperationStatus', vehicle.value?.operationStatus) || '状态待同步'
)
const vehicleModelSummary = computed(() => {
  const model = dictionary.findLabel('vehicleType', vehicle.value?.vehicleType) || vehicle.value?.brandModel
  const load = vehicle.value?.approvedLoadMass
  const loadLabel = load === undefined || load === null ? '载重待同步' : `载重 ${formatVehicleLoad(load)}`
  return [model, loadLabel].filter(Boolean).join(' · ')
})

const archived = computed(() => task.value?.status === 'completed' || task.value?.status === 'cancelled')
const taskAction = computed(() => {
  if (!task.value) return null
  const id = encodeURIComponent(task.value.id)
  const detail = `/pages/waybill/detail?id=${id}`
  switch (task.value.status) {
    case 'pending': return { label: '核对并接受', icon: 'success', url: detail }
    case 'accepted': return { label: '装货打卡', icon: 'location', url: `/pages/waybill/cargo-operation?id=${id}&type=loading` }
    case 'loading': return { label: '录入发车信息', icon: 'vehicle', url: `/pages/waybill/execution-operation?id=${id}&action=departure` }
    case 'transporting': return { label: '到达打卡', icon: 'location', url: `/pages/waybill/cargo-operation?id=${id}&type=unloading&mode=arrival` }
    case 'unloading': return { label: '查看卸货进度', icon: 'box', url: detail }
    case 'signed': return { label: '录入收车信息', icon: 'check', url: `/pages/waybill/execution-operation?id=${id}&action=completion` }
    default: return { label: '查看任务详情', icon: 'arrow-right', url: detail }
  }
})
onShow(() => {
  void refresh()
})

async function refresh() {
  if (refreshing.value) return
  loadError.value = ''
  refreshing.value = true
  try {
    const [taskResult, listResult, profileResult] = await Promise.allSettled([
      waybill.loadHomeTask(), waybill.loadList('all'), profile.load(true)
    ])
    if (taskResult.status === 'fulfilled') {
      task.value = taskResult.value
      loadedTask.value = true
    }
    if (listResult.status === 'fulfilled') list.value = listResult.value
    const failed = [taskResult, listResult, profileResult].find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') loadError.value = getUserFacingErrorMessage(failed.reason, '首页同步失败，请重试')
  } finally {
    refreshing.value = false
    initialized.value = true
  }
}

function openDetail(id?: string) {
  if (!id) return
  uni.navigateTo({ url: `/pages/waybill/detail?id=${encodeURIComponent(id)}` })
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

function handleTaskAction() {
  if (taskAction.value) uni.navigateTo({ url: taskAction.value.url })
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace container-class="page driver-page">
      <MobileTopBar
        capsule="always" title="工作台" :eyebrow="driver?.driverName" :subtitle="carrier?.companyName"
        show-menu menu-icon="settings" menu-label="打开设置" @menu="openSettings"
      />

      <view class="driver-content driver-content--tabbed home-page__content" role="main">
        <TmsPageSkeleton
          v-if="!initialized || (loadError && !loadedTask)"
          label="正在同步运输任务…" :error="loadError" @retry="refresh"
        />
        <template v-else>
          <MobileLoadError v-if="loadError" title="工作台刷新失败" :message="loadError" @retry="refresh" />

          <view class="mobile-group-section">
            <TmsRouteCard
              v-if="task" :waybill="task" variant="task" :show-progress="task.status !== 'cancelled'"
              :title="archived ? '最近任务' : '当前任务'" @open="openDetail(task.id)"
            >
              <MobileAction
                v-if="taskAction" class="task-card__button"
                :class="archived ? 'tms-secondary-action' : 'tms-primary-action'" @click="handleTaskAction"
              >
                <MobileInlineLabel :icon="taskAction.icon" :label="taskAction.label" :icon-size="18" />
              </MobileAction>
            </TmsRouteCard>
            <MobileEmptyState v-else class="driver-card" icon="waybill" title="当前没有运输任务">
              <MobileAction class="driver-inline" @click="openWaybillList">查看运单</MobileAction>
            </MobileEmptyState>
          </view>

          <view v-if="todoList.length" class="mobile-group-section">
            <MobileSectionHeading title="其他任务" action-label="全部运单" @action="openWaybillList" />
            <view class="mobile-group">
              <view v-for="item in todoList" :key="item.id" class="home-task-row">
                <TmsRouteCard :waybill="item" variant="compact" @open="openDetail(item.id)" />
              </view>
            </view>
          </view>

          <view class="mobile-group-section">
            <MobileSectionHeading title="车辆" />
            <view class="mobile-group">
              <MobileAction class="mobile-row" aria-label="查看车辆" @click="openVehicle">
                <view class="mobile-row__icon"><MobileIcon name="vehicle" size="20px" /></view>
                <view class="mobile-row__body">
                  <text class="mobile-row__label">{{ vehicle?.plateNo || '暂无绑定车辆' }}</text>
                  <text v-if="vehicle" class="mobile-row__detail">{{ vehicleModelSummary }}</text>
                </view>
                <text v-if="vehicle" class="mobile-row__detail mobile-row__trailing">{{ vehicleStatusLabel }}</text>
                <MobileIcon class="mobile-row__chevron" name="chevron" size="14px" />
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
.home-task-row + .home-task-row { border-top: 1px solid var(--mobile-workspace-line); }
.task-card__button {
  flex: 1 1 144px;
  min-width: 0;
}
</style>
