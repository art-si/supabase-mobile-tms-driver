<script setup lang="ts">
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import MobileEmptyState from '@mobile-core/components/MobileEmptyState.vue'
import { computed, nextTick, ref } from 'vue'
import { onLoad, onPageScroll, onPullDownRefresh, onShow, onUnload } from '@dcloudio/uni-app'
import { createLatestRequest } from '@mobile-core/latest-request'
import { watchMobilePageQuery } from '@mobile-core/watchMobilePageQuery'
import TmsBottomNav from '@/components/business/TmsBottomNav.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileInlineLabel from '@mobile-core/components/MobileInlineLabel.vue'
import MobileSegmented from '@mobile-core/components/MobileSegmented.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import TmsPageSkeleton from '@mobile-core/components/TmsPageSkeleton.vue'
import TmsRouteCard from '@/components/business/TmsRouteCard.vue'
import type { WaybillStatusGroup } from '@/api/waybill'
import type { Waybill } from '@/api/types'
import { getUserFacingErrorMessage } from '@/api/supabase'
import { useWaybillStore } from '@/stores/waybill'
import { usePageTheme } from '@/composables/usePageTheme'
import { canReportWaybillExpense } from '@/utils/expense-status'

const { themeName } = usePageTheme()
const waybill = useWaybillStore()
const active = ref<WaybillStatusGroup>('all')
const service = ref<'weighbridge' | 'expense'>()
const pending = ref(true)
const result = ref<{ group: WaybillStatusGroup; items: Waybill[] }>()
const loadError = ref('')
const currentResult = computed(() => result.value?.group === active.value ? result.value : undefined)
const rows = computed(() => service.value === 'expense'
  ? currentResult.value?.items.filter(item => canReportWaybillExpense(item.status)) ?? []
  : currentResult.value?.items ?? [])
const title = computed(() => service.value === 'weighbridge' ? '过磅记录' : service.value === 'expense' ? '在途费用' : '运输任务')
const requests = createLatestRequest()
let scrollTop = 0
let returnScroll: number | undefined
const tabs: Array<{ label: string; value: WaybillStatusGroup }> = [
  { label: '全部', value: 'all' },
  { label: '待处理', value: 'pending' },
  { label: '进行中', value: 'active' },
  { label: '已完成', value: 'completed' }
]

function readQuery(query?: Record<string, unknown>) {
  return {
    group: tabs.find(tab => tab.value === query?.group)?.value ?? 'all',
    service: query?.service === 'weighbridge' || query?.service === 'expense' ? query.service : undefined
  } as const
}

onLoad(query => {
  const route = readQuery(query)
  active.value = route.group
  service.value = route.service
})
watchMobilePageQuery('/pages/waybill/index', query => {
  const route = readQuery(query)
  if (active.value === route.group && service.value === route.service) return
  service.value = route.service
  switchGroup(route.group)
})
onUnload(requests.invalidate)

onPageScroll((event) => {
  scrollTop = event.scrollTop
})

onShow(async () => {
  if (returnScroll !== undefined) {
    const position = returnScroll
    returnScroll = undefined
    await nextTick()
    // #ifdef H5
    // Wait for the H5 router to finish restoring its own position.
    requestAnimationFrame(() => requestAnimationFrame(() => scrollTo(position)))
    // #endif
    // #ifndef H5
    scrollTo(position)
    // #endif
  }
  void load()
})

onPullDownRefresh(async () => {
  try {
    await refreshList()
  } finally {
    uni.stopPullDownRefresh()
  }
})

async function load(group: WaybillStatusGroup = active.value) {
  const isCurrent = requests.start()
  pending.value = true
  loadError.value = ''
  try {
    const items = await waybill.loadList(group)
    if (isCurrent()) result.value = { group, items }
  } catch (error) {
    if (isCurrent()) loadError.value = getUserFacingErrorMessage(error, '运单加载失败，请重试')
  } finally {
    if (isCurrent()) pending.value = false
  }
}

function refreshList() {
  if (!pending.value) return load()
}

function switchGroup(value: WaybillStatusGroup) {
  if (value === active.value) return
  active.value = value
  scrollTo(0)
  void load(value)
}

function scrollTo(position: number) {
  // #ifdef H5
  // The H5 shell scrolls the body, while Uni's pageScrollTo scrolls the window.
  document.body.scrollTop = position
  // #endif
  // #ifndef H5
  uni.pageScrollTo({ scrollTop: position, duration: 0 })
  // #endif
}

function openFromList(url: string) {
  returnScroll = scrollTop
  // #ifdef H5
  returnScroll = document.body.scrollTop
  // #endif
  uni.navigateTo({ url, fail() { returnScroll = undefined } })
}

function openWaybill(item: Waybill) {
  const id = encodeURIComponent(item.id)
  openFromList(`/pages/waybill/${service.value || 'detail'}?id=${id}`)
}

</script>


<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace container-class="page driver-page">
      <MobileTopBar :title="title" :show-back="Boolean(service)" capsule="always" back-fallback="/pages/mine/index" />

      <view class="driver-content" :class="{ 'driver-content--tabbed': !service }" role="main">
        <text v-if="service" class="driver-copy">{{ service === 'weighbridge' ? '选择运单，查看装卸货称重和磅单。' : '选择运单，查看费用和审核状态。' }}</text>
        <view class="waybill-filters">
          <MobileSegmented
            :model-value="active"
            :options="tabs"
            label="运单状态筛选"
            @update:model-value="switchGroup"
          />
          <MobileAction
            class="waybill-refresh" variant="icon"
            aria-label="刷新运单列表"
            :disabled="pending"
            @click="refreshList"
          >
            <wd-loading v-if="pending" type="circular" color="var(--tms-primary)" size="30rpx" />
            <MobileIcon v-else name="refresh" size="32rpx" aria-hidden="true" />
          </MobileAction>
        </view>

        <view v-if="loadError && currentResult" class="waybill-sync-error" role="alert">
          <text>同步失败，当前显示上次查询结果</text>
          <MobileAction class="waybill-retry" @click="refreshList">重试</MobileAction>
        </view>
        <TmsPageSkeleton
          v-if="!currentResult"
          compact
          label="正在同步运输任务…"
          :error="loadError"
          @retry="refreshList"
        />
        <view v-else-if="rows.length" class="driver-stack" :aria-busy="pending">
          <text class="driver-copy waybill-count" role="status">{{ pending ? '正在更新任务…' : `共 ${rows.length} 项任务` }}</text>
          <TmsRouteCard
            v-for="item in rows"
            :key="item.id"
            :waybill="item"
            variant="list"
            @open="openWaybill(item)"
          >
            <MobileAction
              v-if="!service && canReportWaybillExpense(item.status)"
              class="route-expense-action" variant="link"
              :aria-label="'上报运单 ' + item.waybillNo + ' 的费用'"
              @click="openFromList(`/pages/waybill/expense?id=${encodeURIComponent(item.id)}&create=1`)"
            >
              <MobileInlineLabel icon="expense" label="费用上报" />
            </MobileAction>
          </TmsRouteCard>
        </view>
        <MobileEmptyState v-else class="driver-card" icon="waybill" title="当前筛选下暂无任务" description="可以切换状态，或刷新查看新任务。">
          <MobileAction class="driver-inline" @click="refreshList">重新同步</MobileAction>
        </MobileEmptyState>
      </view>

      <TmsBottomNav v-if="!service" active="waybill" />
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

.waybill-refresh.mobile-action {
  align-self: start;
  margin-top: 4px;
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
