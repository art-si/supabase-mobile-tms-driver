<script setup lang="ts">
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import { computed, reactive, ref } from "vue";
import { onLoad, onUnload } from "@dcloudio/uni-app";
import { getUserFacingErrorMessage } from "@/api/supabase";
import {
  completeWaybillExecution,
  getWaybillExecutionContext,
  recordWaybillDeparture,
  uploadWaybillProofFiles,
} from "@/api/waybill";
import type { ExecutionAction, Waybill } from "@/api/types";
import MobileIcon from "@mobile-core/components/MobileIcon.vue";
import TmsPageSkeleton from "@mobile-core/components/TmsPageSkeleton.vue";
import TmsDateTimePicker from "@/components/business/TmsDateTimePicker.vue";
import MobileAction from "@mobile-core/components/MobileAction.vue";
import MobileEvidence from "@mobile-core/components/MobileEvidence.vue";
import MobileField from "@mobile-core/components/MobileField.vue";
import MobilePickerTrigger from "@mobile-core/components/MobilePickerTrigger.vue";
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
  error: "",
  submitError: "",
});
const submission = ref<"idle" | "saving" | "saved">("idle");
const submissionLocked = computed(() => submission.value !== "idle");
let pageActive = true;
let returnTimer: ReturnType<typeof setTimeout> | undefined;
const form = reactive({
  occurredAt: Date.now(),
  odometerKm: "",
  photoUrls: [] as string[],
  remark: "",
});
const datePickerVisible = ref(false);
const current = ref<Waybill | null>(null);
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
const occurredAtLabel = computed(() => formatDateTime(new Date(form.occurredAt).toISOString()));
const photoLabel = computed(() => isDeparture.value ? "发车照片" : "收车照片");
const fieldTitle = computed(() =>
  isDeparture.value ? "出车里程（公里）" : "收车里程（公里）",
);
const odometerError = computed(() => {
  if (!form.odometerKm.trim()) return "";
  const value = Number(form.odometerKm);
  if (!Number.isFinite(value) || value < 0) return "请输入有效的仪表盘里程。";
  if (!isDeparture.value && value < Number(executionContext.value?.record?.departureOdometerKm ?? 0)) {
    return "收车里程不得小于出车里程。";
  }
  return "";
});
const submitMissing = computed(() => {
  const missing: string[] = [];
  if (!form.odometerKm.trim()) missing.push("里程");
  if (!form.photoUrls.length) missing.push("车辆照片");
  return missing;
});
const canSubmit = computed(
  () =>
    submitMissing.value.length === 0 &&
    !odometerError.value &&
    !state.loading &&
    !submissionLocked.value &&
    !state.uploading,
);

onLoad((query) => {
  id.value = String(query?.id || "");
  action.value = query?.action === "completion" ? "completion" : "departure";
  void load();
});
onUnload(() => {
  pageActive = false;
  if (returnTimer !== undefined) clearTimeout(returnTimer);
});

async function load() {
  state.error = "";
  if (!id.value) {
    state.error = "缺少运单参数，请返回任务详情后重新进入";
    return;
  }
  state.loading = true;
  try {
    const [item, context] = await Promise.all([
      waybill.loadWaybill(id.value),
      auth.withFreshAccess((token) => getWaybillExecutionContext(token, id.value)),
      profile.load(true),
    ]);
    if (!item) throw new Error("找不到此运单，请返回任务列表重新打开");
    current.value = item;
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
  if (!current.value || state.uploading || submissionLocked.value) return;
  state.uploading = true;
  try {
    const paths = await chooseImages(5 - form.photoUrls.length);
    if (!paths.length) return;
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
  if (state.uploading || submissionLocked.value) return;
  form.photoUrls.splice(index, 1);
}


async function submit() {
  if (!canSubmit.value) return;
  const odometer = Number(form.odometerKm);
  state.submitError = "";
  submission.value = "saving";
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
  } catch (error) {
    state.submitError = getUserFacingErrorMessage(error, "提交失败，请重试。");
    submission.value = "idle";
    return;
  }
  submission.value = "saved";
  if (!pageActive) return;
  uni.showToast({ title: `${title.value}成功`, icon: "success" });
  returnTimer = setTimeout(() => uni.navigateBack(), 450);
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
    <MobileWorkspace :container-class="['page driver-page execution-page mobile-workspace--sticky-dock', themeName]">
      <MobileTopBar :title="title" :subtitle="current?.waybillNo" capsule="always" show-back />
      <TmsPageSkeleton
        v-if="state.loading || state.error"
        :label="isDeparture ? '正在加载发车记录…' : '正在加载收车记录…'"
        :error="state.error"
        @retry="load"
      />
      <view v-else class="driver-content execution-page__content" role="main">
        <view v-if="isRepairingReturnArchive" class="driver-card execution-callout mobile-inline-pair mobile-inline-pair--start">
          <view class="mobile-inline-pair__icon" aria-hidden="true"><MobileIcon name="info" size="16px" /></view>
          <text class="execution-callout__copy">这张运单缺少回场档案。提交后将补齐回场记录和车辆里程台账。</text>
        </view>
        <view class="driver-card driver-stack" aria-labelledby="execution-vehicle-title">
          <text id="execution-vehicle-title" class="section-title" role="heading" aria-level="2">车辆记录</text>
          <MobileField field="execution-time" :label="timeLabel" required>
            <MobilePickerTrigger
              id="execution-time"
              :value="occurredAtLabel"
              :label="'选择' + timeLabel"
              :expanded="datePickerVisible"
              :disabled="submissionLocked"
              described-by="execution-time-hint"
              @click="datePickerVisible = true"
            />
            <text id="execution-time-hint" class="driver-copy">支持补录，请按实际发生时间填写。</text>
          </MobileField>
          <MobileField
            v-model="form.odometerKm"
            field="execution-odometer"
            :label="fieldTitle"
            inputmode="decimal"
            placeholder="填写仪表盘公里数…"
            :error="odometerError"
            :disabled="submissionLocked"
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
            :disabled="submissionLocked"
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
            :disabled="submissionLocked"
            multiline
          />
        </view>
      </view>

      <view v-if="!state.loading && !state.error" class="mobile-dock mobile-dock--sticky execution-footer" aria-label="车辆记录提交操作">
        <text v-if="state.submitError" class="mobile-dock__note mobile-dock__note--error" role="alert">{{ state.submitError }}</text>
        <text v-if="submitMissing.length" class="mobile-dock__note">还需补充：{{ submitMissing.join("、") }}</text>
        <MobileAction
          class="mobile-dock__action tms-primary-action"
          :disabled="!canSubmit"
          :aria-busy="submission === 'saving'"
          @click="submit"
        >
          {{ submission === 'saving' ? '正在提交…' : submission === 'saved' ? '已提交' : title }}
        </MobileAction>
      </view>
      <TmsDateTimePicker
        v-model="form.occurredAt"
        v-model:visible="datePickerVisible"
        :title="'选择' + timeLabel"
      />
    </MobileWorkspace>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.execution-callout {
  --mobile-inline-pair-gap: 8px;
  color: var(--tms-info);
  font-size: 13px;
}
.execution-callout__copy { min-width: 0; color: var(--tms-text-secondary); }
</style>
