<script setup lang="ts">
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import { computed, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import { getDriverExpenseContext } from "@/api/expense";
import { getUserFacingErrorMessage } from "@/api/supabase";
import type {
  DriverExpenseAuditStatus,
  DriverExpenseContext,
  DriverExpenseRecord,
} from "@/api/types";
import TmsIcon from "@/components/business/TmsIcon.vue";
import TmsPageSkeleton from "@mobile-core/components/TmsPageSkeleton.vue";
import MobileAction from "@mobile-core/components/MobileAction.vue";
import MobileEvidence from "@mobile-core/components/MobileEvidence.vue";
import MobileRoute from "@mobile-core/components/MobileRoute.vue";
import MobileStatusTag from "@mobile-core/components/MobileStatusTag.vue";
import type { MobileStatusTone } from "@mobile-core/theme";
import MobileTopBar from "@mobile-core/components/MobileTopBar.vue";
import WaybillExpenseSheet from "@/components/business/WaybillExpenseSheet.vue";
import { usePageTheme } from "@/composables/usePageTheme";
import { useAuthStore } from "@/stores/auth";
import { formatDateTime, formatMoney } from "@/utils/format";

const { themeName } = usePageTheme();
const auth = useAuthStore();
const id = ref("");
const context = ref<DriverExpenseContext>();
const loading = ref(false);
const error = ref("");
const sheetVisible = ref(false);
const editingRecord = ref<DriverExpenseRecord | null>(null);
const shouldAutoCreate = ref(false);

const records = computed(() => context.value?.records || []);
const stats = computed(
  () =>
    context.value?.stats || {
      reportCount: 0,
      totalAmount: 0,
      pendingCount: 0,
      approvedAmount: 0,
    },
);

const statusMeta: Record<
  DriverExpenseAuditStatus,
  { label: string; tone: MobileStatusTone }
> = {
  draft: { label: "草稿", tone: "gray" },
  pending_review: {
    label: "审批中",
    tone: "blue",
  },
  approved: { label: "已通过", tone: "green" },
  rejected: { label: "已驳回", tone: "red" },
  voided: { label: "已作废", tone: "gray" },
};

onLoad((query) => {
  id.value = String(query?.id || "");
  shouldAutoCreate.value = String(query?.create || "") === "1";
});

onShow(() => {
  if (!sheetVisible.value) void load();
});

async function load() {
  if (!id.value) {
    error.value = "缺少运单参数，请从运单详情重新进入";
    return;
  }
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    auth.hydrate();
    context.value = await auth.withFreshAccess((token) =>
      getDriverExpenseContext(token, id.value),
    );
    if (shouldAutoCreate.value) {
      shouldAutoCreate.value = false;
      openCreate();
    }
  } catch (requestError) {
    error.value = getUserFacingErrorMessage(
      requestError,
      "费用信息加载失败，请稍后重试",
    );
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  if (!context.value?.canReport) {
    uni.showToast({ title: "当前运单状态不允许上报费用", icon: "none" });
    return;
  }
  if (!context.value.expenseItems.length) {
    uni.showToast({ title: "暂无可用费用项目，请联系管理员", icon: "none" });
    return;
  }
  editingRecord.value = null;
  sheetVisible.value = true;
}

function openEdit(record: DriverExpenseRecord) {
  if (record.auditStatus !== "rejected") return;
  editingRecord.value = record;
  sheetVisible.value = true;
}

function previewAttachments(record: DriverExpenseRecord, index: number) {
  uni.previewImage({
    current: record.attachments[index],
    urls: record.attachments,
  });
}

async function handleSuccess() {
  editingRecord.value = null;
  await load();
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace class="page driver-page expense-page" :class="themeName">
      <MobileTopBar title="费用上报" capsule="always" show-back />
      <TmsPageSkeleton
        v-if="loading || error"
        label="正在同步费用项目与审批记录…"
        :error="error"
        @retry="load"
      />

      <view
        v-else-if="context"
        class="driver-content expense-page__content"
        :class="{ 'mobile-content-with-dock': context.canReport }"
        role="main"
      >
        <view class="driver-card driver-stack">
          <view class="driver-heading">
            <text class="expense-waybill-number" translate="no">{{ context.waybill.waybillNo }}</text>
            <MobileStatusTag :label="context.canReport ? '可上报' : '暂不可上报'" :tone="context.canReport ? 'green' : 'gray'" hide-dot />
          </view>
          <MobileRoute :origin="context.waybill.originCity || '—'" :destination="context.waybill.destinationCity || '—'" />
          <text v-if="!context.canReport" class="driver-copy">当前运单尚未接受或已经取消，暂不能上报费用。</text>
        </view>

        <view class="driver-card driver-stack" aria-labelledby="expense-total-title">
          <view class="driver-heading expense-total">
            <view>
              <text id="expense-total-title" class="driver-copy" role="heading" aria-level="2">累计上报</text>
              <text class="expense-total__amount">{{ formatMoney(stats.totalAmount) }}</text>
            </view>
            <text class="driver-copy">{{ stats.reportCount }} 笔记录</text>
          </view>
          <view class="expense-totals">
            <view>
              <text class="driver-copy">审批中</text>
              <text>{{ stats.pendingCount }} 笔</text>
            </view>
            <view>
              <text class="driver-copy">已通过</text>
              <text>{{ formatMoney(stats.approvedAmount) }}</text>
            </view>
          </view>
        </view>

        <view class="driver-stack">
          <text class="mobile-group-title" role="heading" aria-level="2">费用上报记录</text>
          <view v-if="records.length" class="expense-records driver-stack">
            <view v-for="record in records" :key="record.id" class="expense-record driver-card driver-stack">
              <view class="driver-heading">
                <view class="expense-record__name">
                  <text v-if="record.expenseParentName" class="driver-copy">{{ record.expenseParentName }}</text>
                  <text class="section-title" role="heading" aria-level="3">{{ record.expenseItemName }}</text>
                </view>
                <MobileStatusTag :label="statusMeta[record.auditStatus].label" :tone="statusMeta[record.auditStatus].tone" hide-dot />
              </view>
              <view class="driver-heading expense-record__amount-row">
                <text class="expense-record__amount">{{ formatMoney(record.amount) }}</text>
                <text class="driver-copy">发生于 {{ record.occurredOn }}</text>
              </view>
              <text class="driver-copy" translate="no">单号 {{ record.costNo }}</text>
              <view v-if="record.reviewRemark" class="expense-record__review" :class="{ 'expense-record__review--rejected': record.auditStatus === 'rejected' }">
                <TmsIcon :name="record.auditStatus === 'rejected' ? 'warning' : 'info'" size="16px" />
                <text>{{ record.reviewRemark }}</text>
              </view>
              <view v-if="record.attachments.length" class="expense-record__proofs">
                <MobileEvidence
                  :images="record.attachments"
                  label="费用凭证"
                  readonly
                  @preview="previewAttachments(record, $event)"
                />
              </view>
              <view class="expense-record__footer">
                <text class="driver-copy">提交于 {{ formatDateTime(record.submittedAt || record.createTime) }}</text>
                <MobileAction
                  v-if="record.auditStatus === 'rejected'"
                  class="driver-inline"
                  @click="openEdit(record)"
                >修改并重新提交</MobileAction>
              </view>
            </view>
          </view>
          <view v-else class="driver-card driver-empty">
            <view class="driver-empty__icon"><TmsIcon name="document" size="24px" /></view>
            <text class="section-title">暂无费用上报</text>
            <text class="driver-copy">垫付费用后，可上传票据并提交审批。</text>
          </view>
        </view>
      </view>

      <view v-if="context?.canReport && !loading && !error" class="mobile-dock expense-footer" aria-label="费用上报操作">
        <MobileAction class="mobile-dock__action tms-primary-action" @click="openCreate">
          <TmsIcon name="add" size="18px" /><text>新增费用</text>
        </MobileAction>
      </view>

      <WaybillExpenseSheet
        v-model="sheetVisible"
        :waybill="context?.waybill || null"
        :expense-items="context?.expenseItems || []"
        :record="editingRecord"
        @success="handleSuccess"
      />
    </MobileWorkspace>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.expense-waybill-number { min-width: 0; overflow-wrap: anywhere; color: var(--mobile-workspace-muted); font-size: 14px; font-weight: 650; }
.expense-total > view { min-width: 0; }
.expense-total__amount {
  display: block;
  margin-top: 4px;
  color: var(--mobile-workspace-ink);
  font-size: clamp(24px, 6.4vw, 34px);
  font-weight: 750;
  line-height: 1.15;
  letter-spacing: -.025em;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.expense-totals {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--mobile-workspace-line);
}
.expense-totals > view, .expense-record__name { min-width: 0; display: grid; gap: 3px; }
.expense-totals > view > text:last-child { font-weight: 700; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.expense-record__amount-row { flex-wrap: wrap; }
.expense-record__amount { font-size: 20px; font-weight: 750; line-height: 1.15; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.expense-record__review {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 9px;
  color: var(--tms-info);
  background: var(--tms-info-soft);
  font-size: 13px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.expense-record__review--rejected { color: var(--tms-red-strong); background: var(--tms-red-soft); }
.expense-record__footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 3px 10px; }
</style>
