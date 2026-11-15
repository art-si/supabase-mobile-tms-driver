<script setup lang="ts">
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import TmsBottomNav from '@/components/business/TmsBottomNav.vue'
import TmsIcon from '@/components/business/TmsIcon.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileSegmented from '@mobile-core/components/MobileSegmented.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import TmsPageSkeleton from '@mobile-core/components/TmsPageSkeleton.vue'
import TmsRouteCard from '@/components/business/TmsRouteCard.vue'
import type { WaybillStatusGroup } from '@/api/waybill'
import type { Waybill } from '@/api/types'
import { getUserFacingErrorMessage } from '@/api/supabase'
import { useWaybillStore } from '@/stores/waybill'
import { usePageTheme } from '@/composables/usePageTheme'

const { themeName } = usePageTheme()
const waybill = useWaybillStore()
const active = ref<WaybillStatusGroup>('all')
const refreshing = ref(false)
const loadingGroup = ref<WaybillStatusGroup | ''>('')
const initialized = ref(false)
const loadError = ref('')
const isBusy = computed(() => waybill.loading || refreshing.value || Boolean(loadingGroup.value))
const showListLoading = computed(
  () => initialized.value && !loadingGroup.value && waybill.loading && waybill.list.length > 0
)
const tabs: Array<{ label: string; value: WaybillStatusGroup }> = [
  { label: '全部', value: 'all' },
  { label: '待处理', value: 'pending' },
  { label: '进行中', value: 'active' },
  { label: '已完成', value: 'completed' }
]

onLoad((query) => {
  const match = tabs.find((tab) => tab.value === query?.group)
  if (match) active.value = match.value
})

onShow(() => {
  void load()
})

onPullDownRefresh(async () => {
  await refreshList()
  uni.stopPullDownRefresh()
})

async function load(group: WaybillStatusGroup = active.value) {
  loadError.value = ''
  try {
    await waybill.loadList(group)
  } catch (error) {
    loadError.value = getUserFacingErrorMessage(error, '运单加载失败，请重试')
  } finally {
    initialized.value = true
  }
}

async function refreshList() {
  if (isBusy.value) return
  refreshing.value = true
  try {
    await load(active.value)
  } finally {
    refreshing.value = false
  }
}

async function switchGroup(value: WaybillStatusGroup) {
  if (isBusy.value || value === active.value) return
  active.value = value
  loadingGroup.value = value
  try {
    await load(value)
  } finally {
    loadingGroup.value = ''
  }
}

function openDetail(id: string) {
  uni.navigateTo({ url: `/pages/waybill/detail?id=${id}` })
}

function canReportExpense(item: Waybill) {
  return ['accepted', 'loading', 'transporting', 'unloading', 'signed', 'completed'].includes(
    item.status
  )
}

function openExpense(id: string) {
  uni.navigateTo({ url: `/pages/waybill/expense?id=${encodeURIComponent(id)}&create=1` })
}

</script>


<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace class="page driver-page">
      <MobileTopBar title="运输任务" capsule="always" />

      <view class="driver-content driver-content--tabbed" role="main">
        <view class="waybill-filters">
          <MobileSegmented
            :model-value="active"
            :options="tabs"
            :disabled="isBusy"
            label="运单状态筛选"
            @update:model-value="switchGroup"
          />
          <MobileAction
            class="waybill-refresh"
            aria-label="刷新运单列表"
            :disabled="isBusy"
            @click="refreshList"
          >
            <wd-loading v-if="refreshing" type="circular" color="var(--tms-primary)" size="30rpx" />
            <TmsIcon v-else name="refresh" size="32rpx" aria-hidden="true" />
          </MobileAction>
        </view>

        <view v-if="loadError && waybill.list.length" class="waybill-sync-error" role="alert">
          <text>同步失败，当前显示上次的任务列表</text>
          <MobileAction class="waybill-retry" @click="refreshList">重试</MobileAction>
        </view>
        <text v-if="showListLoading" class="driver-copy" role="status">正在更新任务…</text>

        <TmsPageSkeleton
          v-if="!initialized || loadingGroup || (loadError && !waybill.list.length) || (isBusy && !waybill.list.length)"
          compact
          label="正在同步运输任务…"
          :error="loadError"
          @retry="refreshList"
        />
        <view v-else-if="waybill.list.length" class="driver-stack">
          <text class="driver-copy waybill-count" role="status">共 {{ waybill.list.length }} 项任务</text>
          <TmsRouteCard
            v-for="item in waybill.list"
            :key="item.id"
            :waybill="item"
            variant="list"
            @open="openDetail(item.id)"
          >
            <MobileAction
              v-if="canReportExpense(item)"
              class="driver-inline"
              :aria-label="'上报运单 ' + item.waybillNo + ' 的费用'"
              @click="openExpense(item.id)"
            >
              <TmsIcon name="expense" size="26rpx" aria-hidden="true" />
              费用上报
            </MobileAction>
          </TmsRouteCard>
        </view>
        <view v-else class="driver-card driver-empty">
          <view class="driver-empty__icon" aria-hidden="true"><TmsIcon name="waybill" size="39rpx" /></view>
          <text class="section-title" role="heading" aria-level="2">当前筛选下暂无任务</text>
          <text class="driver-copy">可以切换状态，或刷新查看新任务。</text>
          <MobileAction class="driver-inline" @click="refreshList">重新同步</MobileAction>
        </view>
      </view>

      <TmsBottomNav active="waybill" />
    </MobileWorkspace>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.waybill-filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.waybill-refresh {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  color: var(--mobile-workspace-accent);
  background: var(--mobile-workspace-surface);
  border: 1px solid var(--mobile-workspace-line);
  border-radius: 13px;
}

.waybill-count { margin-inline: 2px; }

.waybill-sync-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 10px 4px 14px;
  color: var(--tms-orange-strong);
  background: var(--tms-orange-soft);
  border-radius: 14px;
  font-size: 13px;
}

.waybill-retry {
  flex: none;
  min-width: 44px;
  min-height: 44px;
  color: inherit;
  font-weight: 700;
}
</style>
