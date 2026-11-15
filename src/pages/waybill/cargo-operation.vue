<script setup lang="ts">
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import { computed, reactive, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import { getUserFacingErrorMessage } from "@/api/supabase";
import MobileAction from "@mobile-core/components/MobileAction.vue";
import MobileEvidence from "@mobile-core/components/MobileEvidence.vue";
import MobileField from "@mobile-core/components/MobileField.vue";
import MobileStatusTag from "@mobile-core/components/MobileStatusTag.vue";
import MobileTopBar from "@mobile-core/components/MobileTopBar.vue";
import TmsIcon from "@/components/business/TmsIcon.vue";
import TmsPageSkeleton from "@mobile-core/components/TmsPageSkeleton.vue";
import { usePageTheme } from "@/composables/usePageTheme";
import {
  analyzeCargoWeighbridgeTicket,
  checkInCargoOperation,
  completeCargoOperation,
  getCargoOperationContext,
  uploadWaybillProofFiles,
} from "@/api/waybill";
import type {
  CargoOperationContext,
  CargoOperationLocation,
  CargoOperationRecognitionPayload,
  CargoOperationType,
  Waybill,
} from "@/api/types";
import { useAuthStore } from "@/stores/auth";
import { useProfileStore } from "@/stores/profile";
import { useWaybillStore } from "@/stores/waybill";
import { chooseImages } from "@mobile-core/files";
import { formatDateTime } from "@/utils/format";
import {
  calculateDistanceMeters,
  getCurrentGcj02Location,
} from "@/utils/location";

interface OperationForm {
  grossWeightTon: string;
  tareWeightTon: string;
  weightTon: string;
  photoUrls: string[];
  weighbridgeTicketUrls: string[];
  recognitionInfo: string;
  recognitionPayload: CargoOperationRecognitionPayload | null;
  remark: string;
}

const { themeName } = usePageTheme();
const waybillStore = useWaybillStore();
const auth = useAuthStore();
const profile = useProfileStore();
const id = ref("");
const operationType = ref<CargoOperationType>("loading");
const checkinOnly = ref(false);
const context = ref<CargoOperationContext | null>(null);
const current = ref<Waybill | null>(null);
const state = reactive({
  loading: false,
  locating: false,
  submitting: false,
  analyzing: false,
  uploading: "",
  error: "",
});
const form = reactive<OperationForm>({
  grossWeightTon: "",
  tareWeightTon: "",
  weightTon: "",
  photoUrls: [],
  weighbridgeTicketUrls: [],
  recognitionInfo: "",
  recognitionPayload: null,
  remark: "",
});

const title = computed(() =>
  operationType.value === "loading" ? "装货" : "卸货",
);
const pageTitle = computed(() =>
  checkinOnly.value ? "确认到达" : `${title.value}打卡`,
);
const address = computed(() => {
  if (!current.value) return "--";
  return operationType.value === "loading"
    ? current.value.shipperAddress
    : current.value.receiverAddress;
});
const isCompleted = computed(
  () => context.value?.operation?.operationStatus === "completed",
);
const submitMissing = computed(() => {
  const missing: string[] = [];
  if (!form.weightTon || Number(form.weightTon) <= 0) missing.push(`${title.value}净重`);
  if (form.grossWeightTon && Number(form.grossWeightTon) <= 0) missing.push("毛重格式");
  if (form.tareWeightTon && Number(form.tareWeightTon) <= 0) missing.push("皮重格式");
  if (
    Number(form.grossWeightTon) > 0 &&
    Number(form.tareWeightTon) > 0 &&
    Number(form.grossWeightTon) < Number(form.tareWeightTon)
  ) {
    missing.push("毛重应不小于皮重");
  }
  if (!form.photoUrls.length) missing.push(`${title.value}照片`);
  if (!form.weighbridgeTicketUrls.length) missing.push("磅单");
  return missing;
});
const canSubmit = computed(
  () =>
    Boolean(context.value?.operation) &&
    submitMissing.value.length === 0 &&
    !state.submitting &&
    !state.analyzing &&
    !state.uploading,
);
const calculatedNetWeight = computed(() => {
  const gross = Number(form.grossWeightTon);
  const tare = Number(form.tareWeightTon);
  if (!Number.isFinite(gross) || !Number.isFinite(tare) || gross <= 0 || tare <= 0) {
    return null;
  }
  return Math.max(0, Number((gross - tare).toFixed(3)));
});
const weightDifferenceWarning = computed(() => {
  const calculated = calculatedNetWeight.value;
  const net = Number(form.weightTon);
  if (calculated === null || !Number.isFinite(net) || net <= 0) return "";
  const difference = Math.abs(calculated - net);
  return difference > 0.05
    ? `毛重减皮重为 ${calculated} 吨，与填写净重相差 ${difference.toFixed(3)} 吨，请核对扣水、扣杂等业务数据。`
    : "";
});
const recognitionConfidence = computed(() => {
  const value = Number(form.recognitionPayload?.confidence);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
});
const recognitionWarnings = computed(() => form.recognitionPayload?.warnings || []);
const recognitionIsStale = computed(() => {
  const source = form.recognitionPayload?.ticketUrls || [];
  if (!source.length || !form.weighbridgeTicketUrls.length) return false;
  return source.join("|") !== form.weighbridgeTicketUrls.join("|");
});
const policyLabel = computed(() => {
  if (!context.value?.geofenceEnabled) return "围栏校验已停用";
  return context.value.allowOutsideCheckIn ? "可围栏外打卡" : "仅围栏内打卡";
});
const policyHint = computed(() => {
  if (!context.value?.geofenceEnabled) {
    return "电子围栏校验已关闭，定位仅用于运输留痕，不再按装卸货地点距离拦截打卡。";
  }

  return `围栏内${
    context.value.autoCheckIn
      ? "会自动生成打卡记录"
      : "需要点击下方按钮手动打卡"
  }；围栏外${context.value.allowOutsideCheckIn ? "可说明原因后手动打卡" : "不支持打卡"}。`;
});
const checkinModeLabel = computed(() => {
  const labels = { manual: "司机手动", automatic: "围栏自动", admin: "PC 端" };
  const mode = context.value?.operation?.checkinMode;
  return mode ? labels[mode] : "--";
});

onLoad((query) => {
  id.value = String(query?.id || "");
  operationType.value = query?.type === "unloading" ? "unloading" : "loading";
  checkinOnly.value = query?.mode === "arrival";
  void load();
});

async function load() {
  state.error = "";
  if (!id.value) {
    state.error = "缺少运单参数，请返回运单详情后重新进入";
    return;
  }
  state.loading = true;
  try {
    current.value = await waybillStore.loadDetail(id.value);
    context.value = await auth.withFreshAccess((token) =>
      getCargoOperationContext(token, id.value, operationType.value),
    );
    const operation = context.value.operation;
    Object.assign(form, {
      grossWeightTon: operation?.grossWeightTon ? String(operation.grossWeightTon) : "",
      tareWeightTon: operation?.tareWeightTon ? String(operation.tareWeightTon) : "",
      weightTon: operation?.weightTon ? String(operation.weightTon) : "",
      photoUrls: operation?.photoUrls || [],
      weighbridgeTicketUrls: operation?.weighbridgeTicketUrls || [],
      recognitionInfo: operation?.recognitionInfo || "",
      recognitionPayload: operation?.recognitionPayload || null,
      remark: operation?.remark || "",
    });
    if (!operation && context.value.autoCheckIn) await tryAutomaticCheckIn();
  } catch (error) {
    state.error = getUserFacingErrorMessage(error, `${title.value}信息加载失败`);
  } finally {
    state.loading = false;
  }
}

function distanceMeters(location: CargoOperationLocation) {
  const target = context.value;
  if (!target) return null;
  return calculateDistanceMeters(
    location,
    target.centerLongitude,
    target.centerLatitude,
  );
}

function requestOutsideReason(distance: number): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.showModal({
      title: "围栏外打卡确认",
      content: `当前距${title.value}地约 ${Math.round(distance)} 米。继续打卡需填写原因，请在下一步输入。`,
      editable: true,
      placeholderText: "例如：园区入口封闭，在指定临时作业区",
      confirmText: "确认打卡",
      success(result) {
        if (!result.confirm) {
          reject(new Error("已取消打卡"));
          return;
        }
        const reason = String(result.content || "").trim();
        if (reason.length < 4) {
          reject(new Error("围栏外打卡原因至少填写 4 个字"));
          return;
        }
        resolve(reason);
      },
      fail() {
        reject(new Error("已取消打卡"));
      },
    });
  });
}

async function resolveOutsideReason(location: CargoOperationLocation) {
  const target = context.value;
  if (!target?.geofenceEnabled) return null;
  const distance = distanceMeters(location);
  if (distance === null || distance <= target.radiusM) return null;
  if (!target.allowOutsideCheckIn) {
    throw new Error(`当前不在${title.value}地围栏内，请到达现场后重新打卡`);
  }
  return await requestOutsideReason(distance);
}

async function tryAutomaticCheckIn() {
  try {
    const location = await getCurrentGcj02Location(address.value);
    const distance = distanceMeters(location);
    if (distance === null || !context.value || distance > context.value.radiusM)
      return;
    context.value = await checkInCargoOperation(
      auth.token,
      id.value,
      operationType.value,
      location,
      null,
      true,
    );
    uni.showToast({ title: `已自动${title.value}打卡`, icon: "success" });
  } catch {
    // 自动打卡失败不阻断页面，司机仍可查看策略并手动重试。
  }
}

async function handleCheckIn() {
  if (state.locating || context.value?.operation) return;
  state.locating = true;
  try {
    const location = await getCurrentGcj02Location(address.value);
    const outsideReason = await resolveOutsideReason(location);
    context.value = await checkInCargoOperation(
      auth.token,
      id.value,
      operationType.value,
      location,
      outsideReason,
    );
    uni.showToast({ title: `${title.value}打卡成功`, icon: "success" });
    if (checkinOnly.value) setTimeout(() => uni.navigateBack(), 450);
  } catch (error) {
    showError(error, "打卡失败");
  } finally {
    state.locating = false;
  }
}

async function uploadEvidence(kind: "photo" | "ticket") {
  if (!current.value || !context.value?.operation || isCompleted.value || state.uploading || state.submitting || state.analyzing) return;
  try {
    const currentCount =
      kind === "photo"
        ? form.photoUrls.length
        : form.weighbridgeTicketUrls.length;
    const paths = await chooseImages((kind === "photo" ? 5 : 3) - currentCount);
    if (!paths.length) return;
    state.uploading = kind;
    const operatorName =
      profile.driver?.driverName ||
      profile.user?.nickName ||
      profile.user?.userName;
    const files = await uploadWaybillProofFiles(
      auth.token,
      current.value,
      `${operationType.value}_${kind}`,
      paths,
      operatorName,
    );
    const urls = files.map((file) => file.url);
    if (kind === "photo")
      form.photoUrls = [...form.photoUrls, ...urls].slice(0, 5);
    else
      form.weighbridgeTicketUrls = [
        ...form.weighbridgeTicketUrls,
        ...urls,
      ].slice(0, 3);
  } catch (error) {
    showError(error, "上传失败");
  } finally {
    state.uploading = "";
  }
}

function preview(url: string | undefined, urls: string[]) {
  if (!url) return;
  uni.previewImage({ current: url, urls });
}

function removeEvidence(kind: "photo" | "ticket", index: number) {
  if (isCompleted.value) return;
  const target = kind === "photo" ? form.photoUrls : form.weighbridgeTicketUrls;
  target.splice(index, 1);
}

async function analyzeWeighbridgeTicket() {
  if (state.analyzing || state.uploading || !form.weighbridgeTicketUrls.length) return;
  state.analyzing = true;
  try {
    const result = await analyzeCargoWeighbridgeTicket(
      auth.token,
      id.value,
      operationType.value,
      form.weighbridgeTicketUrls,
    );
    form.recognitionInfo = result.rawText;
    form.recognitionPayload = {
      ...result,
      source: "ai_ocr",
      ticketUrls: [...form.weighbridgeTicketUrls],
    };
    if (!form.grossWeightTon && result.weights.grossWeightTon) {
      form.grossWeightTon = String(result.weights.grossWeightTon);
    }
    if (!form.tareWeightTon && result.weights.tareWeightTon) {
      form.tareWeightTon = String(result.weights.tareWeightTon);
    }
    if (!form.weightTon && result.weights.netWeightTon) {
      form.weightTon = String(result.weights.netWeightTon);
    }
    uni.showToast({ title: "识别完成，请核对重量", icon: "success" });
  } catch (error) {
    showError(error, "磅单识别失败，请手工填写重量");
  } finally {
    state.analyzing = false;
  }
}

async function submit() {
  if (state.submitting || state.uploading || state.analyzing || isCompleted.value) return;
  if (!context.value?.operation) {
    uni.showToast({ title: `请先完成${title.value}打卡`, icon: "none" });
    return;
  }
  const weightTon = Number(form.weightTon);
  if (!Number.isFinite(weightTon) || weightTon <= 0) {
    uni.showToast({ title: `请输入正确的${title.value}重量`, icon: "none" });
    return;
  }
  const grossWeightTon = form.grossWeightTon ? Number(form.grossWeightTon) : null;
  const tareWeightTon = form.tareWeightTon ? Number(form.tareWeightTon) : null;
  if (grossWeightTon !== null && (!Number.isFinite(grossWeightTon) || grossWeightTon <= 0)) {
    uni.showToast({ title: "请输入正确的毛重", icon: "none" });
    return;
  }
  if (tareWeightTon !== null && (!Number.isFinite(tareWeightTon) || tareWeightTon <= 0)) {
    uni.showToast({ title: "请输入正确的皮重", icon: "none" });
    return;
  }
  if (grossWeightTon !== null && tareWeightTon !== null && grossWeightTon < tareWeightTon) {
    uni.showToast({ title: "毛重不能小于皮重", icon: "none" });
    return;
  }
  if (!form.photoUrls.length) {
    uni.showToast({ title: `请上传${title.value}照片`, icon: "none" });
    return;
  }
  if (!form.weighbridgeTicketUrls.length) {
    uni.showToast({ title: `请上传${title.value}磅单`, icon: "none" });
    return;
  }
  state.submitting = true;
  try {
    context.value = await completeCargoOperation(
      auth.token,
      id.value,
      operationType.value,
      {
        grossWeightTon,
        tareWeightTon,
        weightTon,
        photoUrls: [...form.photoUrls],
        weighbridgeTicketUrls: [...form.weighbridgeTicketUrls],
        recognitionInfo: form.recognitionInfo || null,
        recognitionPayload: form.recognitionPayload,
        remark: form.remark.trim() || null,
      },
    );
    await waybillStore.loadDetail(id.value);
    uni.showToast({ title: `${title.value}信息已提交`, icon: "success" });
    setTimeout(() => uni.navigateBack(), 650);
  } catch (error) {
    showError(error, "提交失败");
  } finally {
    state.submitting = false;
  }
}

function showError(error: unknown, fallback: string) {
  const message = getUserFacingErrorMessage(error, fallback);
  if (message === "已取消打卡") return;
  uni.showToast({ title: message || fallback, icon: "none", duration: 3000 });
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace class="page driver-page operation-page" :class="themeName">
      <MobileTopBar :title="pageTitle" capsule="always" show-back />
      <TmsPageSkeleton
        v-if="state.loading || state.error"
        :label="'正在加载' + title + '规则与现场资料…'"
        :error="state.error"
        @retry="load"
      />

      <view
        v-else-if="context"
        class="driver-content operation-page__content"
        :class="{ 'mobile-content-with-dock': context.operation && !isCompleted && !checkinOnly }"
        role="main"
      >
        <view class="driver-card driver-stack" aria-labelledby="cargo-checkin-title">
          <view class="cargo-checkin">
            <view class="cargo-checkin__icon" :class="{ 'cargo-checkin__icon--done': context.operation }">
              <TmsIcon :name="context.operation ? 'check' : 'location'" size="21px" />
            </view>
            <view class="cargo-checkin__heading">
              <text id="cargo-checkin-title" class="section-title" role="heading" aria-level="2">
                {{ context.operation ? "已完成定位打卡" : "等待定位打卡" }}
              </text>
              <text class="driver-copy" translate="no">{{ current?.waybillNo }}</text>
            </view>
            <MobileStatusTag v-if="isCompleted" label="资料已提交" tone="green" hide-dot />
          </view>
          <text class="cargo-checkin__address">{{ address }}</text>
          <view v-if="context.operation" class="cargo-checkin__detail">
            <text class="driver-copy">{{ formatDateTime(context.operation.checkinTime) }} · {{ checkinModeLabel }}</text>
            <view class="cargo-checkin__facts">
              <view v-if="context.geofenceEnabled">
                <text class="driver-copy">围栏判定</text>
                <text>{{ context.operation.insideGeofence ? "围栏内" : "围栏外" }}</text>
              </view>
              <view>
                <text class="driver-copy">{{ context.geofenceEnabled ? "距中心" : "定位用途" }}</text>
                <text>{{ context.geofenceEnabled ? Math.round(context.operation.distanceM) + " 米" : "仅留痕" }}</text>
              </view>
              <view>
                <text class="driver-copy">定位精度</text>
                <text>{{ context.operation.locationAccuracyM ? "约 " + Math.round(context.operation.locationAccuracyM) + " 米" : "—" }}</text>
              </view>
            </view>
            <text v-if="context.operation.outsideReason" class="driver-copy">
              围栏外打卡原因：{{ context.operation.outsideReason }}
            </text>
          </view>
          <template v-else>
            <view class="cargo-policy">
              <text class="cargo-policy__title">
                {{ policyLabel }}<text v-if="context.geofenceEnabled"> · {{ context.radiusM }} 米</text>
              </text>
              <text class="driver-copy">{{ policyHint }}</text>
            </view>
            <MobileAction
              class="mobile-dock__action tms-primary-action"
              :disabled="state.locating"
              :aria-busy="state.locating"
              @click="handleCheckIn"
            >
              <TmsIcon name="location" size="18px" />
              <text>{{ state.locating ? "正在获取定位…" : "获取定位并打卡" }}</text>
            </MobileAction>
          </template>
        </view>

        <view v-if="!checkinOnly && !context.operation" class="driver-card cargo-locked">
          <TmsIcon name="lock" size="18px" />
          <text class="driver-copy">完成定位打卡后，填写净重并上传{{ title }}照片和磅单。</text>
        </view>

        <template v-if="!checkinOnly && context.operation">
          <view class="driver-card driver-stack" aria-labelledby="cargo-weight-title">
            <text id="cargo-weight-title" class="section-title" role="heading" aria-level="2">{{ title }}重量</text>
            <MobileField
              v-model="form.weightTon"
              field="cargo-net-weight"
              :label="title + '净重（吨）'"
              inputmode="decimal"
              placeholder="例如 12.5…"
              :readonly="isCompleted"
              :disabled="state.submitting"
              required
            />
            <view class="cargo-weight-grid">
              <MobileField
                v-model="form.grossWeightTon"
                field="cargo-gross-weight"
                label="毛重（吨）"
                inputmode="decimal"
                placeholder="选填"
                :readonly="isCompleted"
                :disabled="state.submitting"
              />
              <MobileField
                v-model="form.tareWeightTon"
                field="cargo-tare-weight"
                label="皮重（吨）"
                inputmode="decimal"
                placeholder="选填"
                :readonly="isCompleted"
                :disabled="state.submitting"
              />
            </view>
            <text v-if="calculatedNetWeight !== null" class="driver-copy">毛重减皮重：{{ calculatedNetWeight }} 吨</text>
            <text v-if="weightDifferenceWarning" class="cargo-weight-warning" role="status">{{ weightDifferenceWarning }}</text>
          </view>

          <view class="driver-card driver-stack" aria-labelledby="cargo-photo-title">
            <view class="driver-heading">
              <text id="cargo-photo-title" class="section-title" role="heading" aria-level="2">{{ title }}照片</text>
              <text class="driver-copy">{{ form.photoUrls.length }}/5 张</text>
            </view>
            <text v-if="!isCompleted" class="driver-copy">拍摄车辆、货物与现场，确保车牌清晰。</text>
            <MobileEvidence
              :images="form.photoUrls"
              :label="title + '照片'"
              upload-label="上传照片"
              :readonly="isCompleted"
              :disabled="Boolean(state.uploading) || state.submitting"
              :uploading="state.uploading === 'photo'"
              @upload="uploadEvidence('photo')"
              @preview="preview(form.photoUrls[$event], form.photoUrls)"
              @remove="removeEvidence('photo', $event)"
            />
          </view>

          <view class="driver-card driver-stack" aria-labelledby="cargo-ticket-title">
            <view class="driver-heading">
              <text id="cargo-ticket-title" class="section-title" role="heading" aria-level="2">{{ title }}磅单</text>
              <text class="driver-copy">{{ form.weighbridgeTicketUrls.length }}/3 张</text>
            </view>
            <text v-if="!isCompleted" class="driver-copy">拍摄完整磅单，确保重量、日期和单号清晰。</text>
            <MobileEvidence
              :images="form.weighbridgeTicketUrls"
              :label="title + '磅单'"
              upload-label="上传磅单"
              :limit="3"
              :readonly="isCompleted"
              :disabled="Boolean(state.uploading) || state.submitting || state.analyzing"
              :uploading="state.uploading === 'ticket'"
              @upload="uploadEvidence('ticket')"
              @preview="preview(form.weighbridgeTicketUrls[$event], form.weighbridgeTicketUrls)"
              @remove="removeEvidence('ticket', $event)"
            />
            <view v-if="form.recognitionInfo || (!isCompleted && form.weighbridgeTicketUrls.length)" class="cargo-ocr">
              <view class="driver-heading">
                <text class="cargo-ocr__title">磅单识别</text>
                <MobileAction
                  v-if="!isCompleted"
                  class="driver-inline"
                  :disabled="!form.weighbridgeTicketUrls.length || state.analyzing || Boolean(state.uploading) || state.submitting"
                  @click="analyzeWeighbridgeTicket"
                >
                  {{ state.analyzing ? "识别中…" : form.recognitionInfo ? "重新识别" : "识别磅单" }}
                </MobileAction>
              </view>
              <text v-if="recognitionIsStale" class="cargo-weight-warning">磅单已变更，请重新识别。</text>
              <template v-if="form.recognitionInfo">
                <text class="driver-copy">{{ recognitionConfidence === null ? "OCR 原文" : "OCR 原文 · 可信度 " + recognitionConfidence + "%" }}</text>
                <text class="cargo-ocr__raw">{{ form.recognitionInfo }}</text>
                <text v-if="recognitionWarnings.length" class="cargo-weight-warning">{{ recognitionWarnings.slice(0, 3).join("；") }}</text>
                <text class="driver-copy">请核对识别结果，以最终填写的重量为准。</text>
              </template>
              <text v-else class="driver-copy">可识别磅单，也可以手动填写重量。</text>
            </view>
          </view>

          <view class="driver-card">
            <MobileField
              v-model="form.remark"
              field="cargo-remark"
              label="现场备注"
              :maxlength="300"
              :readonly="isCompleted"
              :disabled="state.submitting"
              placeholder="选填，可注明货损或磅差…"
              multiline
            />
          </view>
        </template>
      </view>

      <view
        v-if="context?.operation && !isCompleted && !checkinOnly && !state.loading && !state.error"
        class="mobile-dock operation-footer"
        aria-label="装卸货提交操作"
      >
        <text v-if="submitMissing.length" class="mobile-dock__note">还需补充：{{ submitMissing.join("、") }}</text>
        <MobileAction
          class="mobile-dock__action tms-primary-action"
          :disabled="!canSubmit"
          :aria-busy="state.submitting"
          @click="submit"
        >
          {{ state.submitting ? "正在提交…" : "提交" + title + "信息" }}
        </MobileAction>
      </view>
    </MobileWorkspace>
  </wd-config-provider>
</template>

<style scoped lang="scss">
.cargo-checkin { display: flex; min-width: 0; align-items: center; gap: 10px; }
.cargo-checkin__icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  color: var(--mobile-workspace-accent);
  background: var(--tms-primary-soft);
}
.cargo-checkin__icon--done { color: var(--tms-green-strong); background: var(--tms-green-soft); }
.cargo-checkin__heading { flex: 1; min-width: 0; display: grid; gap: 2px; }
.cargo-checkin__address { color: var(--mobile-workspace-ink); font-size: 16px; line-height: 1.45; overflow-wrap: anywhere; }
.cargo-checkin__detail,
.cargo-policy { display: grid; gap: 8px; }
.cargo-checkin__facts { display: flex; flex-wrap: wrap; gap: 10px 20px; font-size: 14px; font-weight: 650; font-variant-numeric: tabular-nums; }
.cargo-checkin__facts > view { display: grid; gap: 2px; }
.cargo-checkin__facts .driver-copy { font-weight: 400; }
.cargo-policy, .cargo-ocr { padding-top: 10px; border-top: 1px solid var(--mobile-workspace-line); }
.cargo-policy__title, .cargo-ocr__title { font-size: 14px; font-weight: 700; }
.cargo-locked { display: flex; align-items: center; gap: 8px; color: var(--mobile-workspace-muted); }
.cargo-weight-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.cargo-weight-warning { color: var(--tms-orange-strong); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.cargo-ocr { display: grid; gap: 8px; }
.cargo-ocr__raw {
  display: block;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--tms-surface-soft);
  color: var(--mobile-workspace-ink);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
