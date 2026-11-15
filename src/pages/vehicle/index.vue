<script setup lang="ts">
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import TmsBottomNav from '@/components/business/TmsBottomNav.vue'
import TmsIcon from '@/components/business/TmsIcon.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import TmsPageSkeleton from '@mobile-core/components/TmsPageSkeleton.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import TmsVehicleVisual from '@/components/business/TmsVehicleVisual.vue'
import { getUserFacingErrorMessage } from '@/api/supabase'
import { useDictionaryStore } from '@/stores/dictionary'
import { useProfileStore } from '@/stores/profile'
import { formatMeters, normalizeVehicleLoadTon } from '@/utils/format'
import { usePageTheme } from '@/composables/usePageTheme'

const { themeName } = usePageTheme()
const profile = useProfileStore()
const dictionary = useDictionaryStore()

const vehicle = computed(() => profile.vehicle)
const initialLoading = ref(!profile.summary)
const syncing = ref(false)
const loadError = ref('')
const showSkeleton = computed(() => !profile.summary && (initialLoading.value || Boolean(loadError.value)))
const approvedLoadTon = computed(() => normalizeVehicleLoadTon(vehicle.value?.approvedLoadMass))

const vehicleTypeLabel = computed(() => dictionary.label('vehicleType', vehicle.value?.vehicleType))
const fuelTypeLabel = computed(() => dictionary.label('vehicleFuelType', vehicle.value?.fuelType))
const vehicleStatusLabel = computed(() =>
  dictionary.label('vehicleOperationStatus', vehicle.value?.operationStatus)
)
const auditStatusLabel = computed(() =>
  dictionary.findLabel('vehicleAuditStatus', vehicle.value?.auditStatus) ||
  ({
    approved: '已通过',
    pending: '审核中',
    rejected: '未通过'
  } as Record<string, string>)[vehicle.value?.auditStatus || ''] ||
  '待审核'
)

const vehicleDescription = computed(() => {
  const type = vehicleTypeLabel.value === '--' ? '' : vehicleTypeLabel.value
  return [type, vehicle.value?.brandModel].filter(Boolean).join(' · ')
})

const vehicleFacts = computed(() => [
  {
    label: '载重',
    value: approvedLoadTon.value === undefined ? '--' : `${approvedLoadTon.value} 吨`
  },
  { label: '车长', value: vehicle.value?.overallLength ? formatMeters(vehicle.value.overallLength) : '--' },
  { label: '燃料类型', value: fuelTypeLabel.value },
  { label: '运营状态', value: vehicleStatusLabel.value },
  { label: '审核状态', value: auditStatusLabel.value }
])
const vehicleDocuments = computed(() => [
  { label: '行驶证', icon: 'document', url: vehicle.value?.drivingLicenseFrontUrl },
  { label: '运输证', icon: 'receipt', url: vehicle.value?.operationLicenseUrl }
] as const)

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
    loadError.value = getUserFacingErrorMessage(error, '车辆档案同步失败，请重试')
  } finally {
    syncing.value = false
    initialLoading.value = false
  }
}

function preview(url?: string) {
  if (!url) {
    uni.showToast({ title: '暂无证件图片', icon: 'none' })
    return
  }
  uni.previewImage({ urls: [url] })
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace class="page driver-page">
      <MobileTopBar title="车辆" capsule="always" />
      <view class="driver-content driver-content--tabbed">
        <TmsPageSkeleton
          v-if="showSkeleton"
          label="正在同步车辆档案…"
          :error="loadError"
          @retry="load"
        />
        <template v-else>
          <view v-if="loadError" class="driver-card driver-heading vehicle-sync-error" role="alert">
            <text class="driver-error">档案同步失败，当前显示上次的信息</text>
            <MobileAction class="driver-inline" :disabled="syncing" @click="load">重试</MobileAction>
          </view>

          <template v-if="vehicle">
            <view class="driver-card vehicle-card">
              <TmsVehicleVisual class="vehicle-card__image" height="72px" :photo-url="vehicle.vehiclePhotoUrl" />
              <view class="mobile-row__body">
                <text class="vehicle-card__plate">{{ vehicle.plateNo || '车牌待登记' }}</text>
                <text v-if="vehicleDescription" class="mobile-row__detail">{{ vehicleDescription }}</text>
              </view>
            </view>

            <view>
              <text class="mobile-group-title" role="heading" aria-level="2">车辆信息</text>
              <view class="mobile-group vehicle-specs">
                <view v-for="fact in vehicleFacts" :key="fact.label" class="mobile-row mobile-row--static">
                  <view class="mobile-row__body"><text class="mobile-row__label">{{ fact.label }}</text></view>
                  <text class="mobile-row__trailing mobile-row__detail mobile-row__value">{{ fact.value }}</text>
                </view>
              </view>
            </view>

            <view>
              <text class="mobile-group-title" role="heading" aria-level="2">证件</text>
              <view class="mobile-group">
                <MobileAction
                  v-for="document in vehicleDocuments"
                  :key="document.icon"
                  class="mobile-row"
                  :aria-label="`预览${document.label}`"
                  @click="preview(document.url)"
                >
                  <view class="mobile-row__icon" aria-hidden="true">
                    <TmsIcon :name="document.icon" size="17px" />
                  </view>
                  <view class="mobile-row__body"><text class="mobile-row__label">{{ document.label }}</text></view>
                  <text class="mobile-row__trailing mobile-row__detail">{{ document.url ? '已上传' : '待上传' }}</text>
                  <TmsIcon class="mobile-row__chevron" name="chevron" size="14px" aria-hidden="true" />
                </MobileAction>
              </view>
            </view>
          </template>

          <view v-else class="driver-card driver-empty">
            <view class="driver-empty__icon" aria-hidden="true"><TmsIcon name="vehicle" size="22px" /></view>
            <text class="section-title" role="heading" aria-level="2">暂无绑定车辆</text>
            <text class="driver-copy">绑定车辆后可查看档案与证件。</text>
          </view>
        </template>
      </view>
      <TmsBottomNav active="vehicle" />
    </MobileWorkspace>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.vehicle-card {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}

.vehicle-card__image {
  border-radius: 12px;
}

.vehicle-card__plate {
  color: var(--mobile-workspace-ink);
  font-size: clamp(19px, 5vw, 24px);
  font-weight: 700;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}

.vehicle-sync-error {
  padding-block: 6px;
}

.vehicle-sync-error .driver-inline {
  flex-shrink: 0;
}
</style>
