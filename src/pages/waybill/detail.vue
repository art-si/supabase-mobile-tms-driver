<script setup lang="ts">
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import { computed, ref } from "vue";
import { onHide, onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import { createLatestRequest } from "@mobile-core/latest-request";
import { getUserFacingErrorMessage } from "@/api/supabase";
import { getDriverExpenseContext } from "@/api/expense";
import {
  checkInCargoOperation,
  getCargoOperationContext,
  getWaybillExecutionContext,
} from "@/api/waybill";
import type {
  CargoOperationType,
  DriverExpenseRecord,
  Waybill,
  WaybillExecutionContext,
} from "@/api/types";
import MobileIcon from "@mobile-core/components/MobileIcon.vue";
import TmsProgress from "@/components/business/TmsProgress.vue";
import TmsRouteCard from "@/components/business/TmsRouteCard.vue";
import TmsStatusTag from "@/components/business/TmsStatusTag.vue";
import MobileAction from "@mobile-core/components/MobileAction.vue";
import MobileInlineLabel from "@mobile-core/components/MobileInlineLabel.vue";
import MobileConfirmDialog from "@mobile-core/components/MobileConfirmDialog.vue";
import MobileEvidence from "@mobile-core/components/MobileEvidence.vue";
import MobileField from "@mobile-core/components/MobileField.vue";
import MobileLoadError from "@mobile-core/components/MobileLoadError.vue";
import MobileSegmented from "@mobile-core/components/MobileSegmented.vue";
import MobileTopBar from "@mobile-core/components/MobileTopBar.vue";
import TmsPageSkeleton from "@mobile-core/components/TmsPageSkeleton.vue";
import type { MobileIconName } from "@mobile-core/icons";
// #ifdef H5
import { revealControl } from "@mobile-core/form-focus";
// #endif
import WaybillTrackingTimeline from "@/components/business/WaybillTrackingTimeline.vue";
import WaybillTrajectoryPanel from "@/components/business/WaybillTrajectoryPanel.vue";
import WaybillSignatureSheet from "@/components/business/WaybillSignatureSheet.vue";
import { usePageTheme } from "@/composables/usePageTheme";
import { useDictionaryStore } from "@/stores/dictionary";
import { useAuthStore } from "@/stores/auth";
import { useWaybillStore } from "@/stores/waybill";
import { canReportWaybillExpense } from "@/utils/expense-status";
import {
  formatDateTime,
  formatMoney,
  formatTon,
  maskPhone,
} from "@/utils/format";
import {
  calculateDistanceMeters,
  getCurrentGcj02Location,
} from "@/utils/location";

const { themeName } = usePageTheme();
const waybill = useWaybillStore();
const auth = useAuthStore();
const dictionary = useDictionaryStore();
const id = ref("");
type DetailAction = "accept" | "cancel";
type DetailTab = "tracking" | "trajectory";
const activeAction = ref<DetailAction | "">("");
const activeDetailTab = ref<DetailTab>("tracking");
const detailTabOptions: Array<{ value: DetailTab; label: string }> = [
  { value: "tracking", label: "运单跟踪" },
  { value: "trajectory", label: "轨迹定位" },
];
const detailLoading = ref(true);
const detailError = ref("");
const executionContext = ref<WaybillExecutionContext>();
const signatureVisible = ref(false);
const completionPromptVisible = ref(false);
const cancellationVisible = ref(false);
const cancellationReason = ref("");
const cancellationChecked = ref(false);
const cancellationError = ref("");
const submittedAction = ref<{ id: string; action: DetailAction }>();
const readbackCopy = {
  accept: { title: "已接受任务", message: "详情暂未同步，请重新加载。" },
  cancel: { title: "取消状态待同步", message: "取消已提交，运单状态暂未同步，请重新加载。" },
};
const expenseRecords = ref<DriverExpenseRecord[]>([]);
const trackingWarning = ref("");
const requests = createLatestRequest();
let visible = false;

const currentSubmission = computed(() => submittedAction.value?.id === id.value ? submittedAction.value.action : undefined);
const readbackNotice = computed(() => currentSubmission.value ? readbackCopy[currentSubmission.value] : undefined);

function hasReadBack(item?: Waybill | null) {
  if (!item) return false;
  if (currentSubmission.value === "accept") return item.status !== "pending";
  if (currentSubmission.value === "cancel") return item.status === "cancelled";
  return true;
}

const current = computed(() => {
  const item = waybill.current;
  return item?.id === id.value && hasReadBack(item) ? item : null;
});
const cancellationReasonError = computed(() =>
  cancellationChecked.value && cancellationReason.value.trim().length < 4 ? "取消原因至少填写 4 个字。" : "");
const isPending = computed(() => current.value?.status === "pending");
const isCompleted = computed(() => current.value?.status === "completed");
const isAccepted = computed(() => current.value?.status === "accepted");
const isLoading = computed(() => current.value?.status === "loading");
const isTransporting = computed(() => current.value?.status === "transporting");
const isUnloading = computed(() => current.value?.status === "unloading");
const isSigned = computed(() => current.value?.status === "signed");
const canReportExpense = computed(() => Boolean(current.value && canReportWaybillExpense(current.value.status)));
const needsReturnCompletion = computed(() =>
  Boolean(
    executionContext.value?.needsReturnCompletion &&
    executionContext.value?.canComplete,
  ),
);
const actionBusy = computed(
  () => Boolean(activeAction.value) || waybill.actionLoading,
);
const nextAction = computed<{ label: string; icon: MobileIconName; run: () => void } | null>(() => {
  if (!current.value || isPending.value || current.value.status === "cancelled") return null;
  if (isAccepted.value) return { label: "装货打卡", icon: "location", run: () => openCargoOperation("loading") };
  if (isLoading.value) return { label: "录入发车信息", icon: "vehicle", run: () => openExecutionOperation("departure") };
  if (isTransporting.value) return { label: "到达打卡", icon: "location", run: () => openCargoOperation("unloading", "arrival") };
  if (isUnloading.value) {
    return executionContext.value?.unloadingStatus === "completed"
      ? { label: "办理签收", icon: "success", run: () => { signatureVisible.value = true; } }
      : { label: "填写卸货信息", icon: "box", run: () => openCargoOperation("unloading") };
  }
  if (isSigned.value || needsReturnCompletion.value) {
    return {
      label: isCompleted.value ? "补录收车信息" : "录入收车信息",
      icon: "check",
      run: () => openExecutionOperation("completion"),
    };
  }
  return null;
});

const statusHint = computed(() => {
  const item = current.value;
  if (!item) return "";
  if (item.status === "accepted") {
    return "到达装货地后请完成定位打卡和装货资料";
  }
  if (item.status === "loading") return "提货凭证已上传，请确认发车";
  if (item.status === "transporting") return "到达目的地后请确认到达";
  if (item.status === "unloading")
    return executionContext.value?.unloadingStatus === "completed"
      ? "卸货资料已完成，请办理签收"
      : "已到达目的地，请填写卸货信息";
  if (item.status === "signed") return "签收已完成，请录入收车时间和收车里程";
  if (item.status === "completed") {
    if (needsReturnCompletion.value) return "请补录收车时间、里程和照片";
    const deliveredAt = item.completedAt || item.unloadedAt;
    return deliveredAt ? `送达时间 ${formatDateTime(deliveredAt)}` : "";
  }
  return "";
});

const proofUrls = computed(() =>
  waybill.proofs.map((item) => item.fileUrl).filter(Boolean),
);
const cargoTypeLabel = computed(() => {
  const item = current.value;
  if (!item) return "--";
  return dictionary.labelAny(
    ["tmsCustomerPriceCargoType", "tmsCargoUnit"],
    item.cargoType,
    item.cargoName || "--",
  );
});
const cargoRows = computed(() => {
  const item = current.value;
  if (!item) return [];
  return [
    { label: "货物类型", value: cargoTypeLabel.value },
    { label: "货物重量", value: formatTon(item.cargoWeightTon) },
    {
      label: "货物体积",
      value: item.cargoVolumeM3 ? `${item.cargoVolumeM3}m³` : "--",
    },
    { label: "数量", value: item.cargoQuantity || "--" },
  ];
});
const stationRows = computed(() => {
  const item = current.value;
  if (!item) return [];
  return [
    {
      label: "发货站",
      station: item.fromStationName || item.originCity,
      name: item.senderName || item.shipperName,
      phone: item.senderPhone || item.shipperPhone || "",
      address: item.senderAddress || item.shipperAddress,
    },
    {
      label: "到货站",
      station: item.toStationName || item.destinationCity,
      name: item.receiverName,
      phone: item.receiverPhone || "",
      address: item.receiverAddress,
    },
  ];
});

onLoad((query) => {
  id.value = String(query?.id || "");
  activeDetailTab.value = "tracking";
  executionContext.value = undefined;
  expenseRecords.value = [];
});

onShow(() => {
  visible = true;
  void load();
});
function invalidateDetail() {
  visible = false;
  requests.invalidate();
}
onHide(invalidateDetail);
onUnload(invalidateDetail);

async function load() {
  if (!visible) return;
  const requestedId = id.value;
  if (!requestedId) {
    detailError.value = "缺少运单编号，请返回任务列表重新打开。";
    detailLoading.value = false;
    return;
  }
  const isCurrent = requests.start();
  detailLoading.value = true;
  detailError.value = "";
  try {
    trackingWarning.value = "";
    const loaded = await waybill.loadDetail(requestedId, isCurrent);
    if (!isCurrent()) return;
    if (readbackNotice.value && !hasReadBack(loaded)) {
      detailError.value = readbackNotice.value.message;
      return;
    }
    const [executionResult, expenseResult] = await Promise.allSettled([
      auth.withFreshAccess((token) => getWaybillExecutionContext(token, requestedId)),
      auth.withFreshAccess((token) => getDriverExpenseContext(token, requestedId)),
    ]);
    if (!isCurrent()) return;
    if (executionResult.status === "fulfilled") {
      executionContext.value = executionResult.value;
    } else {
      executionContext.value = undefined;
      uni.showToast({
        title: getUserFacingErrorMessage(
          executionResult.reason,
          "任务节点同步失败，请稍后重试",
        ),
        icon: "none",
        duration: 3000,
      });
    }
    if (expenseResult.status === "fulfilled") {
      expenseRecords.value = expenseResult.value.records;
    } else {
      expenseRecords.value = [];
      trackingWarning.value = "费用上报记录暂未同步，其他运输节点仍可正常查看，请稍后刷新。";
      console.warn(
        "failed to load expense records for waybill tracking",
        expenseResult.reason,
      );
    }
    await tryAutomaticCargoCheckIn(loaded, isCurrent);
  } catch (error) {
    if (isCurrent()) {
      detailError.value = readbackNotice.value && !current.value
        ? readbackNotice.value.message
        : getUserFacingErrorMessage(error, "任务详情加载失败，请重试。");
    }
  } finally {
    if (isCurrent()) detailLoading.value = false;
  }
}

async function tryAutomaticCargoCheckIn(item: typeof current.value, isCurrent: () => boolean) {
  if (!item) return;
  const operationType: CargoOperationType | null =
    item.status === "accepted"
      ? "loading"
      : item.status === "transporting"
        ? "unloading"
        : null;
  if (!operationType) return;

  try {
    const context = await auth.withFreshAccess((token) =>
      getCargoOperationContext(token, item.id, operationType),
    );
    if (!isCurrent() || !context.geofenceEnabled || !context.autoCheckIn || context.operation)
      return;
    const operationAddress =
      operationType === "loading" ? item.shipperAddress : item.receiverAddress;
    const location = await getCurrentGcj02Location(operationAddress);
    const distance = calculateDistanceMeters(
      location,
      context.centerLongitude,
      context.centerLatitude,
    );
    if (!isCurrent() || distance === null || distance > context.radiusM) return;
    await checkInCargoOperation(
      auth.token,
      item.id,
      operationType,
      location,
      null,
      true,
    );
    if (!isCurrent()) return;
    await waybill.loadDetail(item.id, isCurrent);
    if (!isCurrent()) return;
    const execution = await auth.withFreshAccess((token) =>
      getWaybillExecutionContext(token, item.id),
    );
    if (!isCurrent()) return;
    executionContext.value = execution;
    uni.showToast({
      title: `已自动${operationType === "loading" ? "装货" : "卸货"}打卡`,
      icon: "success",
    });
  } catch {
    // 自动定位不阻断详情页，司机仍可进入作业页手动重试。
  }
}

function callPhone(phone?: string) {
  if (!phone) {
    uni.showToast({ title: "暂无联系电话", icon: "none" });
    return;
  }
  uni.makePhoneCall({ phoneNumber: phone });
}

async function accept() {
  const item = current.value;
  if (actionBusy.value || item?.status !== "pending") return;
  activeAction.value = "accept";
  try {
    await waybill.acceptCurrent();
    submittedAction.value = { id: item.id, action: "accept" };
    await load();
  } catch (error) {
    uni.showToast({ title: actionErrorMessage(error, "接受任务失败，请稍后重试"), icon: "none", duration: 2600 });
  } finally {
    activeAction.value = "";
  }
}

function openCargoOperation(type: "loading" | "unloading", mode?: "arrival") {
  if (!current.value) return;
  uni.navigateTo({
    url: `/pages/waybill/cargo-operation?id=${encodeURIComponent(current.value.id)}&type=${type}${mode ? `&mode=${mode}` : ""}`,
  });
}

function openExecutionOperation(action: "departure" | "completion") {
  if (!current.value) return;
  uni.navigateTo({
    url: `/pages/waybill/execution-operation?id=${encodeURIComponent(current.value.id)}&action=${action}`,
  });
}

function openExpense() {
  if (!current.value || !canReportExpense.value) return;
  uni.navigateTo({
    url: `/pages/waybill/expense?id=${encodeURIComponent(current.value.id)}&create=1`,
  });
}

function openWeighbridge() {
  if (current.value) uni.navigateTo({ url: `/pages/waybill/weighbridge?id=${encodeURIComponent(current.value.id)}` });
}

function actionErrorMessage(error: unknown, fallback: string) {
  const message = getUserFacingErrorMessage(error, fallback);
  return /状态不允许|运输节点|已进入下一/.test(message)
    ? "运单状态已变化，请刷新后重试"
    : message;
}

function openCancellation() {
  if (actionBusy.value || !isAccepted.value) return;
  cancellationReason.value = "";
  cancellationChecked.value = false;
  cancellationError.value = "";
  cancellationVisible.value = true;
}

async function cancel() {
  if (actionBusy.value || !cancellationVisible.value || !isAccepted.value || !current.value) return;
  cancellationChecked.value = true;
  cancellationError.value = "";
  if (cancellationReasonError.value) {
    // #ifdef H5
    void revealControl("waybill-cancel-reason");
    // #endif
    return;
  }
  const requestedId = current.value.id;
  activeAction.value = "cancel";
  try {
    await waybill.cancelCurrent(cancellationReason.value.trim());
    submittedAction.value = { id: requestedId, action: "cancel" };
    await load();
    cancellationVisible.value = false;
    if (current.value?.status === "cancelled") uni.showToast({ title: "已取消", icon: "success" });
  } catch (error) {
    cancellationError.value = actionErrorMessage(error, "取消失败，请稍后重试。");
  } finally {
    activeAction.value = "";
  }
}

async function handleSignatureSuccess() {
  signatureVisible.value = false;
  await load();
  if (executionContext.value?.canComplete) {
    completionPromptVisible.value = true;
  } else {
    uni.showToast({ title: "签收成功", icon: "success" });
  }
}

const proofEvidence = ref<InstanceType<typeof MobileEvidence>>();
function viewReceipt() {
  if (proofUrls.value.length === 0) {
    uni.showToast({ title: "暂无回单文件", icon: "none" });
    return;
  }
  proofEvidence.value?.preview();
}
</script>


<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace container-class="page driver-page">
      <MobileTopBar title="任务详情" show-back capsule="always" back-fallback="/pages/waybill/index" />

      <view class="driver-content" :class="{ 'mobile-content-with-dock': current && isPending }" role="main">
        <template v-if="current">
          <TmsRouteCard
            :waybill="current"
            :show-status="!nextAction"
            :clickable="false"
            variant="detail"
          >
            <template v-if="canReportExpense || isAccepted" #default>
              <view class="detail-secondary-actions">
                <MobileAction v-if="canReportExpense" variant="link" @click="openExpense">
                  <MobileInlineLabel icon="expense" label="费用上报" />
                </MobileAction>
                <MobileAction
                  v-if="isAccepted"
                  class="detail-danger"
                  variant="link"
                  :disabled="actionBusy"
                  @click="openCancellation"
                >{{ activeAction === 'cancel' ? '正在取消…' : '取消运单' }}</MobileAction>
              </view>
            </template>

            <template v-if="detailError || nextAction || isCompleted" #operations>
              <view class="detail-actions">
                <view v-if="detailError" class="detail-sync-warning" role="alert">
                  <text class="driver-copy">{{ detailError }}</text>
                  <MobileAction class="driver-inline" @click="load">重试</MobileAction>
                </view>
                <view v-if="nextAction" class="detail-actions__header">
                  <text class="detail-actions__title" role="heading" aria-level="2">下一步</text>
                  <TmsStatusTag :status="current.status" />
                </view>
                <text v-if="statusHint" class="driver-copy" role="status">{{ statusHint }}</text>
                <MobileAction
                  v-if="nextAction"
                  class="detail-operation tms-primary-action"
                  :disabled="actionBusy"
                  @click="nextAction.run"
                >
                  <MobileInlineLabel :icon="nextAction.icon" :label="nextAction.label" icon-size="16px" />
                </MobileAction>
                <MobileAction
                  v-else-if="isCompleted"
                  class="detail-operation tms-secondary-action"
                  @click="viewReceipt()"
                >
                  <MobileInlineLabel icon="document" label="查看运输单据" icon-size="16px" />
                </MobileAction>
                <TmsProgress v-if="!isPending && current.status !== 'cancelled'" class="detail-actions__progress" :status="current.status" />
              </view>
            </template>
          </TmsRouteCard>

          <view>
            <text class="mobile-group-title" role="heading" aria-level="2">站点与联系人</text>
            <view class="mobile-group">
              <view v-for="row in stationRows" :key="row.label" class="mobile-row mobile-row--static detail-station">
                <view class="mobile-row__body">
                  <text class="detail-station__kind">{{ row.label }}</text>
                  <text v-if="row.station" class="mobile-row__label">{{ row.station }}</text>
                  <text class="mobile-row__detail">{{ row.address || '地址待补充' }}</text>
                  <text v-if="row.name || row.phone" class="mobile-row__detail">{{ [row.name, row.phone ? maskPhone(row.phone) : ''].filter(Boolean).join(' · ') }}</text>
                </view>
                <MobileAction
                  v-if="row.phone"
                  class="detail-phone" variant="icon"
                  :aria-label="'拨打' + row.label + '电话'"
                  @click="callPhone(row.phone)"
                ><MobileIcon name="phone" size="31rpx" aria-hidden="true" /></MobileAction>
              </view>
            </view>
          </view>

          <view>
            <text class="mobile-group-title" role="heading" aria-level="2">货物信息</text>
            <view class="mobile-group">
              <view v-for="row in cargoRows" :key="row.label" class="mobile-row mobile-row--static detail-info-row">
                <text class="driver-copy">{{ row.label }}</text>
                <text class="detail-info-row__value">{{ row.value }}</text>
              </view>
            </view>
          </view>

          <view v-if="proofUrls.length">
            <view class="driver-heading">
              <text class="mobile-group-title" role="heading" aria-level="2">运输单据</text>
              <text class="driver-copy">{{ proofUrls.length }} 份</text>
            </view>
            <view class="driver-card">
              <MobileEvidence ref="proofEvidence" readonly :images="proofUrls" label="运输单据" />
            </view>
          </view>
          <view v-if="!isPending && current.status !== 'cancelled'" class="mobile-group">
            <MobileAction class="mobile-row" @click="openWeighbridge">
              <view class="mobile-row__icon"><MobileIcon name="document" size="17px" /></view>
              <view class="mobile-row__body"><text class="mobile-row__label">过磅记录</text></view>
              <MobileIcon class="mobile-row__chevron" name="chevron" size="14px" />
            </MobileAction>
          </view>

          <MobileSegmented v-model="activeDetailTab" :options="detailTabOptions" label="运单详情视图" />
          <WaybillTrackingTimeline
            v-if="activeDetailTab === 'tracking'"
            :waybill="current"
            :events="waybill.events"
            :expenses="expenseRecords"
            :sync-warning="trackingWarning"
          />
          <WaybillTrajectoryPanel v-else :waybill="current" :events="waybill.events" />
        </template>

        <MobileLoadError
          v-else-if="readbackNotice && !detailLoading && detailError"
          :title="readbackNotice.title"
          :message="detailError"
          retry-text="重新加载"
          @retry="load"
        />
        <TmsPageSkeleton
          v-else
          label="正在加载任务详情…"
          :error="detailLoading ? '' : detailError || '找不到此任务，请返回任务列表重新打开。'"
          @retry="load"
        />
      </view>

      <view v-if="current && isPending" class="mobile-dock pending-footer" aria-label="接受运输任务">
        <view class="pending-footer__charge">
          <text class="driver-copy">本单运费</text>
          <text class="pending-footer__money">{{ formatMoney(current.freightAmount) }}</text>
        </view>
        <MobileAction
          class="mobile-dock__action tms-primary-action"
          :disabled="actionBusy" :aria-busy="activeAction === 'accept'"
          @click="accept"
        >
          <view class="mobile-inline-pair">
            <wd-loading v-if="activeAction === 'accept'" type="circular" color="#fff" size="30rpx" aria-hidden="true" />
            <text class="mobile-inline-pair__label">{{ activeAction === 'accept' ? '正在接受任务…' : '确认接受任务' }}</text>
          </view>
        </MobileAction>
      </view>

      <WaybillSignatureSheet v-model="signatureVisible" :waybill="current" @success="handleSignatureSuccess" />
      <MobileConfirmDialog
        v-model="cancellationVisible"
        title="取消运单"
        message="请填写取消原因，再确认取消本次运输任务。"
        cancel-text="保留运单"
        :confirm-text="activeAction === 'cancel' ? '正在取消…' : '确认取消运单'"
        keep-open-on-confirm
        :busy="activeAction === 'cancel'"
        @confirm="cancel"
      >
        <MobileField
          v-model="cancellationReason"
          field="waybill-cancel-reason"
          label="取消原因"
          placeholder="至少填写 4 个字"
          :maxlength="-1"
          :error="cancellationReasonError"
          :disabled="activeAction === 'cancel'"
          multiline
          required
        />
        <text v-if="cancellationError" class="detail-cancel-error" role="alert">{{ cancellationError }}</text>
      </MobileConfirmDialog>
      <MobileConfirmDialog
        v-model="completionPromptVisible"
        title="签收已完成"
        message="现在录入收车时间、里程和车辆照片，完成本次运输。"
        confirm-text="去录入"
        cancel-text="稍后处理"
        :destructive="false"
        @confirm="openExecutionOperation('completion')"
      />
    </MobileWorkspace>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.detail-actions {
  display: grid;
  min-width: 0;
  gap: 8px;
  padding-block: 12px;
  border-block: 1px solid var(--mobile-workspace-line);
}
.detail-actions__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 8px;
}
.detail-actions__title {
  color: var(--mobile-workspace-ink);
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.35;
}
.detail-actions__progress { margin-top: 4px; }
.detail-sync-warning { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.detail-sync-warning .driver-copy { min-width: 0; }
.detail-cancel-error { color: var(--tms-red-strong); font-size: .875rem; line-height: 1.5; }

.detail-operation { width: 100%; }

.detail-secondary-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }

.detail-danger {
  --mobile-action-link-color: var(--tms-red-strong);
  --mobile-action-link-active-background: var(--tms-red-soft);
}

.detail-info-row { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); }
.detail-info-row > text { min-width: 0; }
.detail-info-row__value {
  color: var(--mobile-workspace-ink);
  font-size: 14px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  text-align: end;
}
.detail-phone.mobile-action {
  border-radius: 12px;
  color: var(--mobile-workspace-accent);
  background: var(--tms-primary-soft);
}
.detail-station__kind { color: var(--mobile-workspace-accent); font-size: 13px; font-weight: 700; }

.pending-footer {
  grid-template-columns: minmax(0, auto) minmax(0, 1fr);
  align-items: center;
  gap: 14px;
}
.pending-footer__charge { display: grid; gap: 2px; }
.pending-footer__money { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
</style>
