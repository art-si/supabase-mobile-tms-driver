<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  analyzeDriverExpenseByAi,
  getDriverExpenseOcrEnabled,
  getDriverExpenseObjectPath,
  removeDriverExpenseFiles,
  reviewDriverExpenseOcrArtifact,
  submitDriverExpense,
  uploadDriverExpenseFiles,
} from "@/api/expense";
import { getUserFacingErrorMessage } from "@/api/supabase";
import type {
  DriverExpenseItem,
  DriverExpenseOcrAnalyzeResponse,
  DriverExpenseRecord,
  DriverExpenseWaybill,
} from "@/api/types";
import MobileAction from "@mobile-core/components/MobileAction.vue";
import MobileBottomSheet from "@mobile-core/components/MobileBottomSheet.vue";
import MobileInlineLabel from "@mobile-core/components/MobileInlineLabel.vue";
import MobileCalendarDate from "@mobile-core/components/MobileCalendarDate.vue";
import MobileEvidence from "@mobile-core/components/MobileEvidence.vue";
import MobileField from "@mobile-core/components/MobileField.vue";
import MobilePickerTrigger from "@mobile-core/components/MobilePickerTrigger.vue";
import MobileSelect from "@mobile-core/components/MobileSelect.vue";
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import { useAuthStore } from "@/stores/auth";
import { useDictionaryStore } from "@/stores/dictionary";
import { chooseImages } from "@mobile-core/files";
import { getCurrentGcj02Location } from "@/utils/location";

defineOptions({ options: { styleIsolation: "shared" } });

interface ExpenseAttachmentDraft {
  id: string;
  src: string;
  remoteUrl?: string;
  localPath?: string;
  objectPath?: string;
  disposable?: boolean;
}

const props = defineProps<{
  modelValue: boolean;
  waybill: DriverExpenseWaybill | null;
  expenseItems: DriverExpenseItem[];
  record?: DriverExpenseRecord | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  success: [costId: string];
}>();

const auth = useAuthStore();
const dictionary = useDictionaryStore();
const state = reactive({
  choosing: false,
  locating: false,
  uploading: false,
  analyzing: false,
  loadingAiConfig: false,
  submitting: false,
});
const form = reactive({
  expenseItemId: "",
  amount: "",
  occurredAt: Date.now(),
  providerName: "",
  paymentChannel: "",
  invoiceNo: "",
  expenseLocation: "",
  longitude: null as number | null,
  latitude: null as number | null,
  remark: "",
});
const attachments = ref<ExpenseAttachmentDraft[]>([]);
const attachmentImages = computed(() => attachments.value.map((item) => item.src));
const datePickerVisible = ref(false);
const initialRemoteUrls = ref<string[]>([]);
const idempotencyKey = ref("");
const submitError = ref("");
const ocrEnabled = ref(true);
const ocrResult = ref<DriverExpenseOcrAnalyzeResponse>();
const appliedOcrResult = ref<DriverExpenseOcrAnalyzeResponse>();

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});
const isEditing = computed(() => Boolean(props.record));
const expenseItemOptions = computed(() => props.expenseItems.map((item) => ({
  id: item.id,
  name: item.parentName ? `${item.parentName} · ${item.itemName}` : item.itemName,
})));
const paymentMethods = computed(() =>
  Object.values(
    dictionary.entriesByTypeCode.tmsCashPaymentMethod || {},
  ).sort((left, right) => (left.sort || 0) - (right.sort || 0)),
);
const paymentMethodOptions = computed(() => {
  const options = paymentMethods.value.map((item) => ({ id: item.value, name: item.label }));
  if (form.paymentChannel && !options.some((option) => option.id === form.paymentChannel)) {
    options.push({ id: form.paymentChannel, name: form.paymentChannel });
  }
  return options;
});
const ocrConfidencePercent = computed(() =>
  Math.round((ocrResult.value?.confidence || 0) * 100),
);
const ocrActionLabel = computed(() => {
  if (state.loadingAiConfig) return "检测中";
  if (state.uploading) return "上传中";
  if (state.analyzing) return "识别中";
  return ocrResult.value ? "重新识别" : "开始识别";
});
const missingFields = computed(() => {
  const missing: string[] = [];
  const amount = Number(form.amount);
  if (!form.expenseItemId) missing.push("费用项目");
  if (!Number.isFinite(amount) || amount <= 0) missing.push("金额");
  if (!attachments.value.length) missing.push("费用凭证");
  return missing;
});
const busy = computed(
  () =>
    state.choosing ||
    state.locating ||
    state.uploading ||
    state.analyzing ||
    state.submitting,
);
const canSubmit = computed(
  () => missingFields.value.length === 0 && !busy.value,
);

watch(
  () => props.modelValue,
  (value, previous) => {
    if (value) {
      resetForm();
      void prepareSheet();
    } else if (previous) {
      datePickerVisible.value = false;
      void cleanupDraftUploads();
    }
  },
);

function createIdempotencyKey() {
  return `driver-expense-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function resetForm() {
  const record = props.record;
  form.expenseItemId = record?.expenseItemId || "";
  form.amount = record ? String(record.amount) : "";
  form.occurredAt = record?.occurredOn
    ? new Date(`${record.occurredOn}T00:00:00`).getTime()
    : Date.now();
  form.providerName = record?.providerName || record?.payeeName || "";
  form.paymentChannel = record?.paymentChannel || "";
  form.invoiceNo = record?.invoiceNo || "";
  form.expenseLocation = record?.expenseLocation || "";
  form.longitude = record?.expenseLongitude ?? null;
  form.latitude = record?.expenseLatitude ?? null;
  form.remark = record?.remark || "";
  initialRemoteUrls.value = [...(record?.attachments || [])];
  attachments.value = initialRemoteUrls.value.map((url, index) => ({
    id: `remote-${index}-${url}`,
    src: url,
    remoteUrl: url,
  }));
  idempotencyKey.value = createIdempotencyKey();
  submitError.value = "";
  ocrResult.value = undefined;
  appliedOcrResult.value = undefined;
}

async function prepareSheet() {
  state.loadingAiConfig = true;
  try {
    await dictionary.load(auth.token);
    form.paymentChannel = normalizePaymentMethod(form.paymentChannel) || form.paymentChannel;
    ocrEnabled.value = await auth.withFreshAccess(getDriverExpenseOcrEnabled);
  } catch (error) {
    console.warn("failed to prepare expense dictionaries or AI config", error);
    ocrEnabled.value = true;
  } finally {
    state.loadingAiConfig = false;
  }
}

function normalizePaymentMethod(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "";
  const exact = paymentMethods.value.find(
    (item) =>
      item.value.toLowerCase() === normalized ||
      item.label.trim().toLowerCase() === normalized,
  );
  if (exact) return exact.value;
  const fuzzy = paymentMethods.value.find((item) => {
    const label = item.label.trim().toLowerCase();
    return label.includes(normalized) || normalized.includes(label);
  });
  return fuzzy?.value || "";
}

async function addAttachments() {
  if (busy.value || attachments.value.length >= 5) return;
  state.choosing = true;
  try {
    const paths = await chooseImages(5 - attachments.value.length);
    const next = paths.map((path, index) => ({
      id: `local-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      src: path,
      localPath: path,
    }));
    attachments.value = [...attachments.value, ...next].slice(0, 5);
    ocrResult.value = undefined;
    appliedOcrResult.value = undefined;
  } catch (error) {
    showError(error, "选择费用凭证失败");
  } finally {
    state.choosing = false;
  }
}

async function removeAttachment(index: number) {
  if (busy.value) return;
  const [removed] = attachments.value.splice(index, 1);
  ocrResult.value = undefined;
  appliedOcrResult.value = undefined;
  if (removed?.disposable && removed.objectPath) {
    try {
      await removeDriverExpenseFiles(auth.token, [removed.objectPath]);
    } catch (error) {
      console.warn("failed to remove draft expense attachment", error);
    }
  }
}

function previewAttachment(index: number) {
  const urls = attachments.value.map((item) => item.src);
  uni.previewImage({ current: urls[index], urls });
}

async function uploadPendingAttachments() {
  if (!props.waybill || !auth.user?.id) {
    throw new Error("登录信息不完整，请重新登录后重试");
  }
  const pending = attachments.value.filter(
    (item): item is ExpenseAttachmentDraft & { localPath: string } =>
      Boolean(item.localPath),
  );
  if (!pending.length) return;

  state.uploading = true;
  try {
    const uploaded = await uploadDriverExpenseFiles(
      auth.token,
      auth.user.id,
      props.waybill.id,
      pending.map((item) => item.localPath),
    );
    pending.forEach((item, index) => {
      const remote = uploaded[index];
      if (!remote) return;
      const draft = attachments.value.find((candidate) => candidate.id === item.id);
      if (!draft) return;
      draft.remoteUrl = remote.url;
      draft.objectPath = remote.objectPath;
      draft.disposable = true;
      draft.localPath = undefined;
    });
  } finally {
    state.uploading = false;
  }
}

async function analyzeAttachments() {
  if (busy.value || !ocrEnabled.value) return;
  if (!attachments.value.length) {
    uni.showToast({ title: "请先拍照上传费用票据", icon: "none" });
    return;
  }

  state.analyzing = true;
  try {
    await uploadPendingAttachments();
    const imageUrls = attachments.value
      .map((item) => item.remoteUrl)
      .filter((url): url is string => Boolean(url));
    if (!imageUrls.length) throw new Error("票据尚未上传完成，请重试");
    ocrResult.value = await analyzeDriverExpenseByAi(auth.token, imageUrls);
    appliedOcrResult.value = undefined;
    uni.showToast({ title: "票据识别完成，请核对结果", icon: "success" });
  } catch (error) {
    showError(error, "票据识别失败，请稍后重试或手工填写");
  } finally {
    state.analyzing = false;
  }
}

function applyOcrResult() {
  const result = ocrResult.value;
  if (!result) return;
  const value = result.expense;
  if (value.amount !== null && value.amount > 0) form.amount = String(value.amount);
  if (value.occurredOn && /^\d{4}-\d{2}-\d{2}$/.test(value.occurredOn)) {
    const timestamp = new Date(`${value.occurredOn}T00:00:00`).getTime();
    if (Number.isFinite(timestamp)) form.occurredAt = timestamp;
  }
  form.providerName = value.providerName || value.payeeName || form.providerName;
  form.invoiceNo = value.invoiceNo || form.invoiceNo;
  if (value.expenseLocation && form.longitude === null && form.latitude === null) {
    form.expenseLocation = value.expenseLocation;
  }
  form.remark = value.remark || form.remark;

  const paymentMethod = normalizePaymentMethod(value.paymentChannel);
  if (paymentMethod) form.paymentChannel = paymentMethod;
  appliedOcrResult.value = result;
  uni.showToast({
    title: paymentMethod || !value.paymentChannel
      ? "识别结果已填入，请核对"
      : "已填入票据信息，请手动选择支付方式",
    icon: "none",
    duration: 3000,
  });
}

async function locateExpense() {
  if (busy.value) return;
  state.locating = true;
  try {
    const location = await getCurrentGcj02Location(
      form.expenseLocation || undefined,
    );
    form.longitude = location.longitude;
    form.latitude = location.latitude;
    form.expenseLocation = location.locationText || form.expenseLocation;
    uni.showToast({
      title: location.locationText ? "当前位置已记录" : "坐标已记录，请补充地点名称",
      icon: location.locationText ? "success" : "none",
    });
  } catch (error) {
    showError(error, "定位失败，请手动填写地点");
  } finally {
    state.locating = false;
  }
}

function formatLocalDate(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildOcrFinalPayload() {
  return {
    expenseItemId: form.expenseItemId,
    amount: Number(form.amount),
    occurredOn: formatLocalDate(form.occurredAt),
    providerName: form.providerName.trim() || null,
    payeeName: form.providerName.trim() || null,
    paymentChannel: form.paymentChannel || null,
    invoiceNo: form.invoiceNo.trim() || null,
    expenseLocation: form.expenseLocation.trim() || null,
    expenseLongitude: form.longitude,
    expenseLatitude: form.latitude,
    expenseCoordinateSystem:
      form.longitude === null || form.latitude === null ? null : "gcj02",
    remark: form.remark.trim() || null,
  };
}

async function cleanupDraftUploads() {
  const disposable = attachments.value.filter(
    (item): item is ExpenseAttachmentDraft & { objectPath: string } =>
      Boolean(item.disposable && item.objectPath),
  );
  if (!disposable.length || !auth.token) return;
  disposable.forEach((item) => {
    item.disposable = false;
  });
  try {
    await removeDriverExpenseFiles(
      auth.token,
      disposable.map((item) => item.objectPath),
    );
  } catch (error) {
    console.warn("failed to clean up draft expense OCR uploads", error);
  }
}

async function submit() {
  if (!props.waybill || !auth.user?.id || !canSubmit.value) return;
  const amount = Number(form.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    uni.showToast({ title: "请输入正确的费用金额", icon: "none" });
    return;
  }

  const localPaths = attachments.value
    .map((item) => item.localPath)
    .filter((path): path is string => Boolean(path));
  let uploaded: Awaited<ReturnType<typeof uploadDriverExpenseFiles>> = [];
  submitError.value = "";
  state.submitting = true;
  try {
    if (localPaths.length) {
      state.uploading = true;
      uploaded = await uploadDriverExpenseFiles(
        auth.token,
        auth.user.id,
        props.waybill.id,
        localPaths,
      );
      state.uploading = false;
    }

    const retainedRemoteUrls = attachments.value
      .map((item) => item.remoteUrl)
      .filter((url): url is string => Boolean(url));
    const finalUrls = [
      ...retainedRemoteUrls,
      ...uploaded.map((item) => item.url),
    ];
    const payload = {
      waybillId: props.waybill.id,
      expenseItemId: form.expenseItemId,
      amount,
      occurredOn: formatLocalDate(form.occurredAt),
      attachments: finalUrls,
      idempotencyKey: idempotencyKey.value,
      costId: props.record?.id || null,
      providerName: form.providerName.trim() || null,
      payeeName: form.providerName.trim() || null,
      paymentChannel: form.paymentChannel.trim() || null,
      invoiceNo: form.invoiceNo.trim() || null,
      expenseLocation: form.expenseLocation.trim() || null,
      expenseLongitude: form.longitude,
      expenseLatitude: form.latitude,
      expenseCoordinateSystem:
        form.longitude === null || form.latitude === null ? null : "gcj02",
      remark: form.remark.trim() || null,
    } as const;
    let costId: string;
    try {
      costId = await submitDriverExpense(auth.token, payload);
    } catch (firstError) {
      // The RPC is idempotent. A single retry prevents a committed financial
      // record from losing its uploaded receipts after a late network timeout.
      try {
        costId = await submitDriverExpense(auth.token, payload);
      } catch {
        throw firstError;
      }
    }

    if (appliedOcrResult.value) {
      try {
        await reviewDriverExpenseOcrArtifact(auth.token, {
          artifactId: appliedOcrResult.value.artifactId,
          costId,
          finalPayload: buildOcrFinalPayload(),
        });
      } catch (reviewError) {
        console.warn("failed to associate expense OCR review", reviewError);
      }
    }

    attachments.value.forEach((item) => {
      item.disposable = false;
    });

    const retained = new Set(retainedRemoteUrls);
    const removedPaths = initialRemoteUrls.value
      .filter((url) => !retained.has(url))
      .map(getDriverExpenseObjectPath)
      .filter((path): path is string => Boolean(path));
    if (removedPaths.length) {
      try {
        await removeDriverExpenseFiles(auth.token, removedPaths);
      } catch (cleanupError) {
        console.warn("failed to clean up replaced expense files", cleanupError);
      }
    }

    visible.value = false;
    emit("success", costId);
  } catch (error) {
    if (uploaded.length) {
      try {
        await removeDriverExpenseFiles(
          auth.token,
          uploaded.map((item) => item.objectPath),
        );
      } catch (cleanupError) {
        console.warn("failed to clean up rejected expense uploads", cleanupError);
      }
    }
    submitError.value = getUserFacingErrorMessage(error, "费用暂未确认提交，请重试。");
  } finally {
    state.uploading = false;
    state.submitting = false;
  }
}

function showError(error: unknown, fallback: string) {
  uni.showToast({
    title: getUserFacingErrorMessage(error, fallback),
    icon: "none",
    duration: 3000,
  });
}
</script>

<template>
  <MobileBottomSheet
    v-model="visible"
    :title="isEditing ? '修改费用上报' : '新增费用上报'"
    close-label="关闭费用上报"
    :busy="busy"
    tall
  >
    <view class="expense-sheet__sections">
      <view v-if="record?.reviewRemark" class="expense-sheet__reject-note mobile-inline-pair mobile-inline-pair--start">
        <view class="mobile-inline-pair__icon" aria-hidden="true"><MobileIcon name="warning" size="16px" /></view>
        <view class="expense-sheet__reject-copy">
          <text>审批驳回说明</text>
          <text>{{ record.reviewRemark }}</text>
        </view>
      </view>

      <view class="expense-field">
        <text class="expense-field__title" role="heading" aria-level="3">费用明细</text>
        <MobileField field="expense-item" label="费用项目" required>
          <MobileSelect
            v-model="form.expenseItemId"
            field="expense-item"
            class="expense-field__picker"
            :options="expenseItemOptions"
            label="选择费用项目"
            placeholder="请选择费用项目"
            :disabled="busy"
          />
        </MobileField>
        <view class="expense-field--split">
          <MobileField
            v-model="form.amount"
            field="expense-amount"
            label="金额（元）"
            inputmode="decimal"
            placeholder="0.00"
            :maxlength="12"
            :disabled="busy"
            required
          />
          <MobileField field="expense-date" label="发生日期" required>
            <MobilePickerTrigger
              id="expense-date"
              label="选择费用发生日期"
              :value="formatLocalDate(form.occurredAt)"
              :expanded="datePickerVisible"
              :disabled="busy"
              @click="datePickerVisible = true"
            />
          </MobileField>
        </view>
        <text class="expense-field__help">支持补录，请填写实际发生日期。</text>
      </view>

      <view class="expense-field">
        <view class="expense-field__heading">
          <text class="expense-field__title" role="heading" aria-level="3">费用凭证 <text class="required-mark">*</text></text>
          <text class="expense-field__help">{{ attachments.length }}/5 张</text>
        </view>
        <text class="expense-field__help">请上传清晰、完整的票据、付款截图或现场凭证。</text>
        <MobileEvidence
          :images="attachmentImages"
          label="费用凭证"
          upload-label="添加费用凭证"
          :uploading="state.choosing"
          :disabled="busy"
          @upload="addAttachments"
          @preview="previewAttachment"
          @remove="removeAttachment"
        />
        <view v-if="attachments.length && ocrEnabled" class="expense-ocr">
          <view class="expense-field__heading">
            <view class="expense-ocr__identity">
              <text>识别票据</text>
              <text class="expense-field__help">提取金额、日期、商户和支付方式。</text>
            </view>
            <MobileAction
              class="expense-ocr__analyze"
              variant="link"
              :disabled="busy || state.loadingAiConfig"
              @click="analyzeAttachments"
            >{{ ocrActionLabel }}</MobileAction>
          </view>
          <view v-if="ocrResult" class="expense-ocr__result">
            <text class="expense-field__help">可信度 {{ ocrConfidencePercent }}%{{ appliedOcrResult ? " · 已应用" : "" }}</text>
            <text>{{ ocrResult.summary }}</text>
            <text v-if="ocrResult.warnings.length" class="expense-ocr__warning">{{ ocrResult.warnings.slice(0, 2).join("；") }}</text>
            <MobileAction class="expense-ocr__apply" variant="link" :disabled="busy" @click="applyOcrResult">
              {{ appliedOcrResult ? "重新应用识别结果" : "应用到费用表单" }}
            </MobileAction>
          </view>
        </view>
      </view>

      <view class="expense-field">
        <text class="expense-field__title" role="heading" aria-level="3">补充信息</text>
        <view class="expense-field__input-grid">
          <MobileField
            v-model="form.providerName"
            field="expense-provider"
            label="商户 / 收款方"
            placeholder="选填"
            :maxlength="100"
            :disabled="busy"
          />
          <MobileField field="expense-payment" label="支付方式">
            <MobileSelect
              v-model="form.paymentChannel"
              field="expense-payment"
              class="expense-field__compact-picker"
              :options="paymentMethodOptions"
              label="选择支付方式"
              :placeholder="paymentMethods.length ? '选填' : '暂无可用方式'"
              :disabled="busy || !paymentMethods.length"
            />
          </MobileField>
          <MobileField
            v-model="form.invoiceNo"
            field="expense-invoice"
            class="expense-field__invoice"
            label="发票号码"
            placeholder="选填"
            :maxlength="100"
            :disabled="busy"
          />
        </view>
        <view class="expense-field__location-row">
          <MobileField
            v-model="form.expenseLocation"
            field="expense-location"
            label="费用发生地点"
            placeholder="选填"
            :maxlength="300"
            :disabled="busy"
          />
          <MobileAction variant="link" :disabled="busy" @click="locateExpense">
            <MobileInlineLabel icon="location" :label="state.locating ? '定位中…' : '当前位置'" :icon-size="16" />
          </MobileAction>
        </view>
        <MobileField
          v-model="form.remark"
          field="expense-remark"
          label="费用说明"
          placeholder="选填，可说明费用原因或异常情况…"
          :maxlength="500"
          :disabled="busy"
          multiline
        />
      </view>
    </view>

    <template #footer>
      <view class="expense-sheet__footer">
        <text v-if="submitError" class="mobile-dock__note mobile-dock__note--error" role="alert">{{ submitError }}</text>
        <text v-if="missingFields.length" class="expense-sheet__completion">还需补充：{{ missingFields.join("、") }}</text>
        <MobileAction
          class="mobile-dock__action tms-primary-action"
          :aria-busy="state.submitting"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ state.uploading ? "正在上传凭证…" : state.submitting ? "正在提交…" : isEditing ? "重新提交" : "提交审批" }}
        </MobileAction>
      </view>
    </template>
    <template #overlay>
      <MobileCalendarDate
        v-model="form.occurredAt"
        v-model:visible="datePickerVisible"
        title="选择费用发生日期"
      />
    </template>
  </MobileBottomSheet>
</template>

<style scoped lang="scss">
.expense-sheet__sections {
  display: grid;
  min-width: 0;
  gap: 12px;
  padding: 12px max(16px, var(--mobile-safe-right)) 16px max(16px, var(--mobile-safe-left));
  color: var(--tms-text-strong);
}
.expense-field {
  display: grid;
  min-width: 0;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--tms-line-subtle);
  border-radius: 16px;
  background: var(--tms-surface);
}
.expense-field__title { color: var(--tms-text-strong); font-size: 16px; font-weight: 720; line-height: 1.3; }
.expense-field__heading { display: flex; align-items: center; justify-content: space-between; min-width: 0; gap: 8px; }
.expense-field__help, .expense-sheet__completion {
  color: var(--tms-muted);
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.expense-field--split, .expense-field__input-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}
.expense-field--split {
  /* Leave space for the full date and chevron at 320px. */
  grid-template-columns: minmax(0, 1fr) minmax(140px, 1fr);
}
.expense-field__invoice { grid-column: 1 / -1; }
.expense-field__location-row { --mobile-inline-pair-gap: 5px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 8px; }
.expense-ocr { display: grid; min-width: 0; gap: 8px; padding-top: 8px; border-top: 1px solid var(--tms-line-subtle); }
.expense-ocr__identity { min-width: 0; display: grid; gap: 3px; font-size: 14px; font-weight: 650; }
.expense-ocr__identity .expense-field__help { font-weight: 400; }
.expense-ocr__result {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--tms-surface-soft);
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.expense-ocr__apply { justify-self: start; }
.expense-ocr__warning { color: var(--tms-orange-strong); }
.expense-sheet__reject-note {
  --mobile-inline-pair-gap: 8px;
  padding: 12px;
  border-radius: 12px;
  color: var(--tms-red-strong);
  background: var(--tms-red-soft);
  font-size: 13px;
}
.expense-sheet__reject-copy { display: grid; min-width: 0; gap: 4px; overflow-wrap: anywhere; }
.expense-sheet__footer { display: grid; gap: 6px; }
</style>
