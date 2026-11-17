<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileInlineLabel from '@mobile-core/components/MobileInlineLabel.vue'
import MobileLoadingStatus from '@mobile-core/components/MobileLoadingStatus.vue'
import MobileStatusTag from '@mobile-core/components/MobileStatusTag.vue'
import MobileTopBar from '@mobile-core/components/MobileTopBar.vue'
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import TmsPageSkeleton from '@mobile-core/components/TmsPageSkeleton.vue'
import type { MobileStatusTone } from '@mobile-core/theme'
import { getDriverCertification, type DriverCertification } from '@/api/profile'
import { getUserFacingErrorMessage } from '@/api/supabase'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime } from '@/utils/format'

const { themeName } = usePageTheme()
const auth = useAuthStore()
const certification = ref<DriverCertification>()
const loading = ref(false)
const error = ref('')
const statuses: Record<string, { label: string; tone: MobileStatusTone }> = {
  verified: { label: '已审核通过', tone: 'green' },
  unverified: { label: '尚未通过', tone: 'gray' },
  pending: { label: '审核中', tone: 'blue' },
  rejected: { label: '未通过', tone: 'red' },
  revoked: { label: '已撤销', tone: 'red' },
}
const documents = computed(() => {
  const result = certification.value
  if (!result) return []
  return [
    { label: '身份证', status: result.identityStatus },
    { label: '驾驶证', status: result.licenseStatus },
    { label: '从业资格证', status: result.qualificationStatus },
  ].map(item => ({ name: item.label, meta: statuses[item.status] ?? { label: '状态待确认', tone: 'gray' as const } }))
})

onShow(() => void load())

async function load() {
  if (loading.value) return
  loading.value = true
  try {
    if (!(await auth.ensureValidSession())) return
    certification.value = await auth.withFreshAccess(getDriverCertification)
    error.value = ''
  } catch (cause) {
    error.value = getUserFacingErrorMessage(cause, '暂时无法获取认证状态，请稍后重试。')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace container-class="page driver-page">
      <MobileTopBar title="司机认证" capsule="always" show-back back-fallback="/pages/mine/index" />
      <view class="driver-content" role="main">
        <TmsPageSkeleton v-if="!certification" label="正在同步认证状态…" :error="loading ? '' : error" @retry="load" />
        <template v-else>
          <view class="driver-card driver-stack">
            <view class="driver-stack" :aria-busy="loading || undefined">
              <view class="driver-heading certification-head">
                <text class="section-title" role="heading" aria-level="2">认证状态</text>
                <MobileStatusTag
                  :label="!certification.required ? '无需认证' : certification.certified ? '认证通过' : '尚未通过'"
                  :tone="!certification.required ? 'gray' : certification.certified ? 'green' : 'orange'"
                  hide-dot
                />
              </view>
              <text class="driver-copy">{{ !certification.required ? '当前身份无需司机认证。' : certification.certified ? '系统已确认所需证件审核通过。' : (certification.reason || '证件资料尚未审核通过。') }}</text>
              <text v-if="certification.reviewedAt" class="driver-copy">最近审核 {{ formatDateTime(certification.reviewedAt) }}</text>
            </view>
            <view class="certification-sync">
              <view class="certification-sync__copy">
                <MobileLoadingStatus v-if="loading" label="正在同步认证状态…" />
                <text v-else-if="error" class="driver-copy" role="alert">同步失败，当前显示上次的认证状态。</text>
                <text v-else class="driver-copy" role="status">已同步</text>
              </view>
              <MobileAction
                class="certification-sync__action"
                variant="link"
                :aria-label="error ? '重试认证状态' : '刷新认证状态'"
                :disabled="loading"
                @click="load"
              >
                <MobileInlineLabel icon="refresh" :icon-size="16" :label="error ? '重试' : '刷新'" />
              </MobileAction>
            </view>
          </view>

          <view v-if="certification.required" :aria-busy="loading || undefined">
            <text class="mobile-group-title" role="heading" aria-level="2">证件审核</text>
            <view class="mobile-group">
              <view v-for="item in documents" :key="item.name" class="mobile-row mobile-row--static">
                <view class="mobile-row__icon"><MobileIcon name="document" size="17px" /></view>
                <text class="mobile-row__body mobile-row__label">{{ item.name }}</text>
                <MobileStatusTag :label="item.meta.label" :tone="item.meta.tone" hide-dot />
              </view>
            </view>
            <text v-if="!certification.certified" class="driver-copy certification-note">需要补充材料或重新审核时，请联系车队管理员。</text>
          </view>
        </template>
      </view>
    </MobileWorkspace>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.certification-head { flex-wrap: wrap; }
.certification-sync {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--mobile-workspace-line);
}
.certification-sync__copy {
  --mobile-loading-size: 16px;
  --mobile-loading-gap: 6px;
  font-size: .875rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.certification-sync__action { min-width: 44px; min-height: 44px; }
.certification-note { display: block; margin-top: 8px; }
</style>
