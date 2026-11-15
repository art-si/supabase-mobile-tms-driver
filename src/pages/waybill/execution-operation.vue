<script setup lang="ts">
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import { computed, reactive, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import { getUserFacingErrorMessage } from "@/api/supabase";
import {
  completeWaybillExecution,
  getWaybillExecutionContext,
  recordWaybillDeparture,
  uploadWaybillProofFiles,
} from "@/api/waybill";
import type { ExecutionAction } from "@/api/types";
import TmsIcon from "@/components/business/TmsIcon.vue";
import TmsPageSkeleton from "@mobile-core/components/TmsPageSkeleton.vue";
import TmsDateTimePicker from "@/components/business/TmsDateTimePicker.vue";
import MobileAction from "@mobile-core/components/MobileAction.vue";
import MobileEvidence from "@mobile-core/components/MobileEvidence.vue";
import MobileField from "@mobile-core/components/MobileField.vue";
import MobileTopBar from "@mobile-core/components/MobileTopBar.vue";
import { usePageTheme } from "@/composables/usePageTheme";
import { useAuthStore } from "@/stores/auth";
import { useProfileStore } from "@/stores/profile";
import { useWaybillStore } from "@/stores/waybill";
import { chooseImages } from "@mobile-core/files";
import { formatDateTime } from "@/utils/format";

const { themeName } = usePageTheme();
const auth = useAuthStore();
const profile = useProfileStore();
const waybill = useWaybillStore();
const id = ref("");
const action = ref<Exclude<ExecutionAction, "signature">>("departure");
const state = reactive({
  loading: false,
  uploading: false,
  submitting: false,
  error: "",
});
const form = reactive({
  occurredAt: Date.now(),
  odometerKm: "",
  photoUrls: [] as string[],
  remark: "",
});
const datePickerVisible = ref(false);
const current = computed(() => waybill.current);
const executionContext =
  ref<Awaited<ReturnType<typeof getWaybillExecutionContext>>>();
const isDeparture = computed(() => action.value === "departure");
const isRepairingReturnArchive = computed(
  () =>
    !isDeparture.value &&
    Boolean(
      executionContext.value?.needsReturnCompletion &&
      current.value?.status === "completed",
    ),
);
const title = computed(() =>
  isDeparture.value
    ? "确认发车"
    : isRepairingReturnArchive.value
      ? "补录回场"
      : "确认回场",
);
const timeLabel = computed(() => isDeparture.value ? "实际发车时间" : "收车时间");
const photoLabel = computed(() => isDeparture.value ? "发车照片" : "收车照片");
const fieldTitle = computed(() =>
  isDeparture.value ? "出车里程（公里）" : "收车里程（公里）",
);
const odometerError = computed(() => {
  if (!form.odometerKm) return "";
  const value = Number(form.odometerKm);
  if (!Number.isFinite(value) || value < 0) return "请输入有效的仪表盘里程。";
  if (!isDeparture.value && value < Number(executionContext.value?.record?.departureOdometerKm ?? 0)) {
    return "收车里程不得小于出车里程。";
  }
  return "";
});
const submitMissing = computed(() => {
  const missing: string[] = [];
  const odometer = Number(form.odometerKm);
  if (form.odometerKm === "" || !Number.isFinite(odometer) || odometer < 0)
    missing.push("里程");
  else if (
    !isDeparture.value &&
    odometer < Number(executionContext.value?.record?.departureOdometerKm ?? 0)
  )
    missing.push("收车里程不得小于出车里程");
  if (!form.photoUrls.length) missing.push("车辆照片");
  return missing;
});
const canSubmit = computed(
  () =>
    submitMissing.value.length === 0 &&
    !state.loading &&
    !state.submitting &&
    !state.uploading,
);

onLoad((query) => {
  id.value = String(query?.id || "");
  action.value = query?.action === "completion" ? "completion" : "departure";
  void load();
});

async function load() {
  state.error = "";
  if (!id.value) {
    state.error = "缺少运单参数，请返回任务详情后重新进入";
    return;
  }
  state.loading = true;
  try {
    await Promise.all([waybill.loadDetail(id.value), profile.load(true)]);
    const context = await getWaybillExecutionContext(auth.token, id.value);
    executionContext.value = context;
    const record = context.record;
    const time = isDeparture.value ? record?.departureTime : record?.returnTime;
    const odometer = isDeparture.value
      ? record?.departureOdometerKm
      : record?.returnOdometerKm;
    form.occurredAt = time ? new Date(time).getTime() : Date.now();
    form.odometerKm =
      odometer === null || odometer === undefined ? "" : String(odometer);
    form.photoUrls = [
      ...(isDeparture.value
        ? record?.departurePhotoUrls || []
        : record?.returnPhotoUrls || []),
    ];
    form.remark =
      (isDeparture.value
        ? record?.departureRemark
        : record?.completionRemark) || "";
  } catch (error) {
    state.error = getUserFacingErrorMessage(
      error,
      "执行信息加载失败，请稍后重试",
    );
  } finally {
    state.loading = false;
  }
}

async function uploadPhotos() {
  if (!current.value || state.uploading || state.submitting) return;
  try {
    const paths = await chooseImages(5 - form.photoUrls.length);
    if (!paths.length) return;
    state.uploading = true;
    const operator =
      profile.driver?.driverName ||
      profile.user?.nickName ||
      profile.user?.userName;
    const files = await uploadWaybillProofFiles(
      auth.token,
      current.value,
      isDeparture.value ? "departure" : "return",
      paths,
      operator,
    );
    form.photoUrls = [
      ...form.photoUrls,
      ...files.map((item) => item.url),
    ].slice(0, 5);
  } catch (error) {
    showError(error, "照片上传失败");
  } finally {
    state.uploading = false;
  }
}

function removePhoto(index: number) {
  form.photoUrls.splice(index, 1);
}

function preview(index: number) {
  uni.previewImage({ current: form.photoUrls[index], urls: form.photoUrls });
}

function openDatePicker() {
  if (!state.submitting) datePickerVisible.value = true;
}

function handleDateKey(event: KeyboardEvent) {
  if ((event.key !== "Enter" && event.key !== " ") || event.repeat) return;
  event.preventDefault();
  event.stopPropagation();
  openDatePicker();
}

async function submit() {
  if (state.submitting || state.uploading || state.loading) return;
  const odometer = Number(form.odometerKm);
  if (!Number.isFinite(odometer) || odometer < 0)
    return void uni.showToast({
      title: `请输入正确的${fieldTitle.value}`,
      icon: "none",
    });
  if (!form.photoUrls.length)
    return void uni.showToast({
      title: `请上传${isDeparture.value ? "发车" : "收车"}照片`,
      icon: "none",
    });
  if (!isDeparture.value) {
    const departureOdometer = Number(
      executionContext.value?.record?.departureOdometerKm ?? 0,
    );
    if (odometer < departureOdometer) {
      return void uni.showToast({
        title: `收车里程不能小于出车里程 ${departureOdometer} 公里`,
        icon: "none",
        duration: 3000,
      });
    }
  }
  state.submitting = true;
  try {
    if (isDeparture.value) {
      await recordWaybillDeparture(
        auth.token,
        id.value,
        new Date(form.occurredAt).toISOString(),
        odometer,
        [...form.photoUrls],
        form.remark.trim() || null,
      );
    } else {
      await completeWaybillExecution(
        auth.token,
        id.value,
        new Date(form.occurredAt).toISOString(),
        odometer,
        [...form.photoUrls],
        form.remark.trim() || null,
      );
    }
    uni.showToast({ title: `${title.value}成功`, icon: "success" });
    setTimeout(() => uni.navigateBack(), 450);
  } catch (error) {
    showError(error, "提交失败");
  } finally {
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
  <wd-config-provider :theme="themeName">
    <MobileWorkspace class="page driver-page execution-page" :class="themeName">
      <MobileTopBar :title="title" :subtitle="current?.waybillNo" capsule="always" show-back />
      <TmsPageSkeleton
        v-if="state.loading || state.error"
        :label="isDeparture ? '正在加载发车记录…' : '正在加载收车记录…'"
        :error="state.error"
        @retry="load"
      />
      <view v-else class="driver-content execution-page__content mobile-content-with-dock" role="main">
        <view v-if="isRepairingReturnArchive" class="driver-card execution-callout">
          <TmsIcon name="info" size="18px" />
          <text class="driver-copy">这张运单缺少回场档案。提交后将补齐回场记录和车辆里程台账。</text>
        </view>
        <view class="driver-card driver-stack" aria-labelledby="execution-vehicle-title">
          <text id="execution-vehicle-title" class="section-title" role="heading" aria-level="2">车辆记录</text>
          <view class="field-block">
            <text class="execution-label">{{ timeLabel }} <text class="execution-required">*</text></text>
            <wd-cell
              custom-class="tms-date-trigger"
              :value="formatDateTime(new Date(form.occurredAt).toISOString())"
              is-link
              role="button"
              :tabindex="state.submitting ? -1 : 0"
              :aria-label="'选择' + timeLabel"
              :aria-disabled="state.submitting"
              @click="openDatePicker()"
              @keydown="handleDateKey($event)"
            />
            <text class="driver-copy">支持补录，请按实际发生时间填写。</text>
            <TmsDateTimePicker
              v-model="form.occurredAt"
              v-model:visible="datePickerVisible"
              :title="'选择' + timeLabel"
            />
          </view>
          <MobileField
            v-model="form.odometerKm"
            field="execution-odometer"
            :label="fieldTitle"
            inputmode="decimal"
            placeholder="填写仪表盘公里数…"
            :error="odometerError"
            :disabled="state.submitting"
            required
          />
          <text class="driver-copy">
            {{ isDeparture ? "回场时用收车里程减去出车里程，计算本次行驶距离。" : "出车里程：" + (executionContext?.record?.departureOdometerKm ?? 0) + " 公里" }}
          </text>
        </view>

        <view class="driver-card driver-stack" aria-labelledby="execution-photo-title">
          <view class="driver-heading">
            <text id="execution-photo-title" class="section-title" role="heading" aria-level="2">{{ photoLabel }}</text>
            <text class="driver-copy">{{ form.photoUrls.length }}/5 张</text>
          </view>
          <text class="driver-copy">拍摄车辆外观和仪表盘，确保车牌及里程清晰。</text>
          <MobileEvidence
            :images="form.photoUrls"
            :label="photoLabel"
            :uploading="state.uploading"
            :disabled="state.submitting"
            @preview="preview"
            @remove="removePhoto"
            @upload="uploadPhotos"
          />
        </view>

        <view class="driver-card">
          <MobileField
            v-model="form.remark"
            field="execution-remark"
            label="现场备注"
            placeholder="选填，可补充现场情况…"
            :maxlength="300"
            :disabled="state.submitting"
            multiline
          />
        </view>
      </view>

      <view v-if="!state.loading && !state.error" class="mobile-dock execution-footer" aria-label="车辆记录提交操作">
        <text v-if="submitMissing.length" class="mobile-dock__note">还需补充：{{ submitMissing.join("、") }}</text>
        <MobileAction
          class="mobile-dock__action tms-primary-action"
          :disabled="!canSubmit"
          :aria-busy="state.submitting"
          @click="submit"
        >
          {{ state.submitting ? "正在提交…" : title }}
        </MobileAction>
      </view>
    </MobileWorkspace>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.execution-callout { display: flex; align-items: start; gap: 8px; color: var(--tms-info); }
.execution-label { display: block; color: var(--mobile-workspace-ink); font-size: 14px; font-weight: 650; }
.execution-required { color: var(--tms-red-strong); }
.field-block { display: grid; gap: 7px; min-width: 0; }
.field-block :deep(.tms-date-trigger) {
  margin-top: 0;
  background: var(--tms-surface-soft);
  border-radius: var(--tms-control-radius);
}
</style>
