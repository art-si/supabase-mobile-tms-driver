<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  DriverExpenseRecord,
  Waybill,
  WaybillEvent,
} from "@/api/types";
import { formatDateTime, formatMoney } from "@/utils/format";
import { getExpenseAuditStatus } from "@/utils/expense-status";
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileInlineLabel from '@mobile-core/components/MobileInlineLabel.vue'
import MobileIcon from '@mobile-core/components/MobileIcon.vue'
import MobileSegmented from '@mobile-core/components/MobileSegmented.vue'

type TimelineTone = "blue" | "green" | "orange" | "red" | "gray";

interface TimelineItem {
  id: string;
  category: "transport" | "expense";
  title: string;
  description: string;
  eventTime?: string;
  recordedAt?: string;
  operator?: string;
  source: string;
  location?: string;
  remark?: string;
  metrics: string[];
  attachments: string[];
  tone: TimelineTone;
  keyAction?: string;
}

const props = defineProps<{
  waybill: Waybill;
  events: WaybillEvent[];
  expenses?: DriverExpenseRecord[];
  syncWarning?: string;
}>();

const actionMeta: Record<
  string,
  { title: string; description: string; tone: TimelineTone; keyAction?: string }
> = {
  assigned: {
    title: "运输任务已派发",
    description: "运单进入司机端，等待确认接受任务",
    tone: "gray",
  },
  accept: {
    title: "确认接受任务",
    description: "司机已接单，运输任务正式开始",
    tone: "green",
    keyAction: "accepted",
  },
  loading_checkin: {
    title: "装货定位打卡",
    description: "已获取定位并完成装货地打卡",
    tone: "blue",
  },
  complete_loading: {
    title: "装货信息已提交",
    description: "装货净重、可选毛皮重、现场照片与磅单已归档",
    tone: "green",
    keyAction: "loaded",
  },
  upload_pickup: {
    title: "装货凭证已上传",
    description: "装货现场资料已归档",
    tone: "green",
    keyAction: "loaded",
  },
  confirm_departure: {
    title: "发车信息已提交",
    description: "发车时间、出车里程与车辆照片已记录",
    tone: "blue",
    keyAction: "departed",
  },
  confirm_arrival: {
    title: "到达定位打卡",
    description: "已获取定位并完成到货地打卡",
    tone: "blue",
    keyAction: "arrived",
  },
  complete_unloading: {
    title: "卸货信息已提交",
    description: "卸货净重、可选毛皮重、现场照片与磅单已归档",
    tone: "green",
    keyAction: "unloaded",
  },
  complete_unload: {
    title: "卸货信息已提交",
    description: "卸货作业资料已归档",
    tone: "green",
    keyAction: "unloaded",
  },
  sign: {
    title: "签收完成",
    description: "签收人、回单与签字凭证已归档",
    tone: "green",
    keyAction: "signed",
  },
  submit_signature: {
    title: "签收完成",
    description: "签收信息与回单已归档",
    tone: "green",
    keyAction: "signed",
  },
  web_sign: {
    title: "Web 端确认签收",
    description: "调度端已完成签收归档",
    tone: "green",
    keyAction: "signed",
  },
  complete: {
    title: "确认回场",
    description: "收车时间、里程与车辆照片已记录，运输闭环完成",
    tone: "green",
    keyAction: "completed",
  },
  repair_completion: {
    title: "补录回场信息",
    description: "历史缺失的收车档案与车辆里程台账已补齐",
    tone: "orange",
    keyAction: "completed",
  },
  cancel: {
    title: "运单已取消",
    description: "运输任务已终止",
    tone: "red",
  },
};

const eventTypeFallback: Record<string, (typeof actionMeta)[string]> = {
  created: actionMeta.assigned!,
  accepted: actionMeta.accept!,
  loading_checked_in: actionMeta.loading_checkin!,
  loaded: actionMeta.complete_loading!,
  departed: actionMeta.confirm_departure!,
  arrived: actionMeta.confirm_arrival!,
  unloaded: actionMeta.complete_unloading!,
  signed: actionMeta.sign!,
  completed: actionMeta.complete!,
  cancelled: actionMeta.cancel!,
  photo_uploaded: {
    title: "运输凭证已上传",
    description: "现场影像已归档",
    tone: "blue",
  },
  status_changed: {
    title: "运单状态已更新",
    description: "运输节点状态发生变化",
    tone: "gray",
  },
};

const keyActionTotal = 7;
const filters = [
  { label: "全部", value: "all" },
  { label: "运输节点", value: "transport" },
  { label: "费用记录", value: "expense" },
] as const;
const selected = ref<(typeof filters)[number]["value"]>("all");
const expanded = ref<string>();

function payloadText(payload: Record<string, unknown> | undefined, key: string) {
  const value = payload?.[key];
  return typeof value === "string" ? value : "";
}

function payloadNumber(payload: Record<string, unknown> | undefined, key: string) {
  const value = payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function payloadBoolean(payload: Record<string, unknown> | undefined, key: string) {
  const value = payload?.[key];
  return typeof value === "boolean" ? value : null;
}

function sourceLabel(event: WaybillEvent) {
  const source = payloadText(event.payload, "source");
  if (source === "driver") return "司机端";
  if (source === "web") return "Web 端";
  return event.operatorName ? "操作记录" : "系统";
}

function eventMetrics(event: WaybillEvent) {
  const payload = event.payload;
  const values: string[] = [];
  const weight = payloadNumber(payload, "weightTon");
  const grossWeight = payloadNumber(payload, "grossWeightTon");
  const tareWeight = payloadNumber(payload, "tareWeightTon");
  const odometer = payloadNumber(payload, "odometerKm");
  const returnOdometer = payloadNumber(payload, "returnOdometerKm");
  const mileage = payloadNumber(payload, "runningMileageKm");
  const photos = payloadNumber(payload, "photoCount");
  const tickets = payloadNumber(payload, "ticketCount");
  const receipts = payloadNumber(payload, "receiptCount");
  const signatures = payloadNumber(payload, "signatureCount");
  const signer = payloadText(payload, "signerName");
  const inside = payloadBoolean(payload, "insideGeofence");
  const distance = payloadNumber(payload, "distanceM");

  if (weight !== null) values.push(`净重 ${weight.toLocaleString("zh-CN")} 吨`);
  if (grossWeight !== null) values.push(`毛重 ${grossWeight.toLocaleString("zh-CN")} 吨`);
  if (tareWeight !== null) values.push(`皮重 ${tareWeight.toLocaleString("zh-CN")} 吨`);
  if (payloadBoolean(payload, "hasRecognitionInfo")) values.push("含 OCR 识别原文");
  if (odometer !== null) values.push(`出车里程 ${odometer.toLocaleString("zh-CN")} km`);
  if (returnOdometer !== null)
    values.push(`收车里程 ${returnOdometer.toLocaleString("zh-CN")} km`);
  if (mileage !== null) values.push(`本次行驶 ${mileage.toLocaleString("zh-CN")} km`);
  if (signer) values.push(`签收人 ${signer}`);
  if (photos !== null) values.push(`${photos} 张现场照片`);
  if (tickets !== null) values.push(`${tickets} 张磅单`);
  if (receipts !== null) values.push(`${receipts} 张回单`);
  if (signatures !== null) values.push(`${signatures} 张签字照片`);
  if (inside !== null) values.push(inside ? "围栏内打卡" : "围栏外打卡");
  if (distance !== null) values.push(`距作业点约 ${Math.round(distance)} 米`);
  return values;
}

function mapEvent(event: WaybillEvent): TimelineItem {
  const action = payloadText(event.payload, "action");
  const meta =
    actionMeta[action] ||
    eventTypeFallback[event.eventType] || {
      title: "运输节点已更新",
      description: "运单产生一笔新的操作记录",
      tone: "gray" as const,
    };
  return {
    id: `event-${event.id}`,
    category: "transport",
    title: meta.title,
    description: meta.description,
    eventTime: event.eventTime,
    recordedAt: event.createTime,
    operator: event.operatorName,
    source: sourceLabel(event),
    location: event.locationText,
    remark: event.remark,
    metrics: eventMetrics(event),
    attachments: [],
    tone: meta.tone,
    keyAction: meta.keyAction,
  };
}

function mapExpense(record: DriverExpenseRecord): TimelineItem {
  const status = getExpenseAuditStatus(record.auditStatus);
  return {
    id: `expense-${record.id}`,
    category: "expense",
    title: `费用上报 · ${record.expenseItemName}`,
    description: `${formatMoney(record.amount)} · ${status.label}`,
    eventTime: record.submittedAt || record.createTime,
    recordedAt: record.createTime,
    source: "司机端",
    location: record.expenseLocation || undefined,
    remark: record.remark || record.reviewRemark || undefined,
    metrics: record.occurredOn ? [`发生日期 ${record.occurredOn}`] : [],
    attachments: record.attachments,
    tone: status.tone,
  };
}

const timeline = computed(() => {
  const items = [
    ...props.events.map(mapEvent),
    ...(props.expenses || []).map(mapExpense),
  ];
  if (!props.events.some((event) => event.eventType === "created") && props.waybill.createTime) {
    const assignedMeta = actionMeta.assigned!;
    items.push({
      id: `assigned-${props.waybill.id}`,
      category: "transport",
      title: assignedMeta.title,
      description: assignedMeta.description,
      eventTime: props.waybill.createTime,
      recordedAt: props.waybill.createTime,
      source: "系统",
      metrics: [],
      attachments: [],
      tone: assignedMeta.tone,
    });
  }
  return items.sort((left, right) => eventTimestamp(right) - eventTimestamp(left));
});

const hasBothTypes = computed(() => timeline.value.some(item => item.category === "transport") && timeline.value.some(item => item.category === "expense"));
const visibleItems = computed(() => !hasBothTypes.value || selected.value === "all" ? timeline.value : timeline.value.filter(item => item.category === selected.value));

const completedKeyActionCount = computed(
  () =>
    new Set(timeline.value.map((item) => item.keyAction).filter(Boolean)).size,
);

function eventTimestamp(item: TimelineItem) {
  return Date.parse(item.eventTime || "") || Date.parse(item.recordedAt || "") || 0;
}

function timeLabel(item: TimelineItem) {
  if (item.eventTime && Number.isFinite(Date.parse(item.eventTime))) return formatDateTime(item.eventTime);
  if (item.recordedAt && Number.isFinite(Date.parse(item.recordedAt))) return `记录于 ${formatDateTime(item.recordedAt)}`;
  return "时间未记录";
}

function shouldShowRecordedAt(item: TimelineItem) {
  if (!item.recordedAt || !item.eventTime) return false;
  const recorded = new Date(item.recordedAt).getTime();
  const occurred = new Date(item.eventTime).getTime();
  return Number.isFinite(recorded) && Number.isFinite(occurred) && Math.abs(recorded - occurred) > 60_000;
}

function hasDetails(item: TimelineItem) {
  return Boolean(item.metrics.length || item.location || item.remark || shouldShowRecordedAt(item));
}

function preview(item: TimelineItem) {
  if (!item.attachments.length) return;
  uni.previewImage({
    current: item.attachments[0],
    urls: item.attachments,
  });
}
</script>


<template>
  <view class="driver-card tracking-card">
    <view class="driver-heading tracking-card__head">
      <text class="section-title" role="heading" aria-level="2">运单记录</text>
      <text v-if="timeline.length" class="driver-copy">{{ completedKeyActionCount }}/{{ keyActionTotal }} 个关键节点</text>
    </view>
    <view v-if="syncWarning" class="tracking-card__warning mobile-inline-pair mobile-inline-pair--start" role="status">
      <view class="mobile-inline-pair__icon" aria-hidden="true"><MobileIcon name="warning" size="14px" /></view>
      <text>{{ syncWarning }}</text>
    </view>

    <MobileSegmented v-if="hasBothTypes" v-model="selected" :options="filters" label="筛选运单记录" />

    <view v-if="visibleItems.length" class="tracking-list" role="list">
      <view v-for="item in visibleItems" :key="item.id" class="tracking-item" :class="'tracking-item--' + item.tone" role="listitem">
        <view class="tracking-item__rail" aria-hidden="true"><view class="tracking-item__dot" /></view>
        <view class="tracking-item__content">
          <text class="tracking-item__title" role="heading" aria-level="3">{{ item.title }}</text>
          <view class="tracking-item__meta">
            <text>{{ timeLabel(item) }}</text>
            <text>{{ item.source }}</text>
            <text v-if="item.operator">{{ item.operator }}</text>
          </view>
          <text class="driver-copy">{{ item.description }}</text>

          <view v-if="hasDetails(item) || item.attachments.length" class="tracking-item__actions">
            <MobileAction v-if="hasDetails(item)" variant="link" class="tracking-item__action"
              :aria-label="`${expanded === item.id ? '收起' : '展开'}${item.title}明细`"
              :aria-expanded="expanded === item.id" @click="expanded = expanded === item.id ? undefined : item.id"
            >{{ expanded === item.id ? '收起明细' : '展开明细' }}</MobileAction>
            <MobileAction v-if="item.attachments.length" variant="link" class="tracking-item__action" @click="preview(item)">
              <MobileInlineLabel icon="document" :label="`查看 ${item.attachments.length} 张凭证`" />
            </MobileAction>
          </view>
          <view v-if="expanded === item.id" class="tracking-item__details">
            <view v-if="item.metrics.length" class="tracking-item__meta">
              <text v-for="metric in item.metrics" :key="metric">{{ metric }}</text>
            </view>
            <text v-if="item.location" class="driver-copy">{{ item.location }}</text>
            <text v-if="item.remark" class="driver-copy">备注 · {{ item.remark }}</text>
            <text v-if="shouldShowRecordedAt(item)" class="driver-copy">系统记录于 {{ formatDateTime(item.recordedAt) }}</text>
          </view>
        </view>
      </view>
    </view>
    <text v-else class="driver-copy">完成运输节点后，操作时间和资料会显示在这里。</text>
  </view>
</template>

<style scoped lang="scss">
.tracking-card { display: grid; gap: 12px; }
.tracking-card__head { flex-wrap: wrap; }
.tracking-card__warning {
  --mobile-inline-pair-gap: 7px;
  --mobile-inline-pair-leading: 1.4;
  padding: 8px 10px;
  border-radius: 10px;
  color: var(--tms-orange-strong);
  background: var(--tms-orange-soft);
  font-size: 13px;
}
.tracking-list { display: grid; }
.tracking-item {
  --tracking-title-size: 15px;
  --tracking-title-line-height: 1.35;
  --tracking-dot-size: 8px;
  --tracking-dot-center: calc(var(--tracking-title-size) * var(--tracking-title-line-height) / 2);
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr);
  gap: 8px;
}
.tracking-item__rail { position: relative; display: flex; justify-content: center; }
.tracking-item:not(:last-child) .tracking-item__rail::after {
  position: absolute;
  z-index: 0;
  inset-block: var(--tracking-dot-center) calc(-1 * var(--tracking-dot-center));
  width: 1px;
  background: var(--mobile-workspace-line);
  content: '';
}
.tracking-item__dot {
  position: relative;
  z-index: 1;
  width: var(--tracking-dot-size);
  height: var(--tracking-dot-size);
  margin-top: calc(var(--tracking-dot-center) - var(--tracking-dot-size) / 2);
  border-radius: 50%;
  background: var(--mobile-workspace-accent);
}
.tracking-item--green .tracking-item__dot { background: var(--tms-green-strong); }
.tracking-item--orange .tracking-item__dot { background: var(--tms-orange-strong); }
.tracking-item--red .tracking-item__dot { background: var(--tms-red-strong); }
.tracking-item--gray .tracking-item__dot { background: var(--mobile-workspace-muted); }
.tracking-item__content { display: grid; min-width: 0; gap: 4px; padding-bottom: 16px; overflow-wrap: anywhere; }
.tracking-item:last-child .tracking-item__content { padding-bottom: 0; }
.tracking-item__title { color: var(--mobile-workspace-ink); font-size: var(--tracking-title-size); font-weight: 690; line-height: var(--tracking-title-line-height); }
.tracking-item__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  color: var(--mobile-workspace-muted);
  font-size: 12px;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
}
.tracking-item__actions { display: flex; flex-wrap: wrap; column-gap: 12px; }
.tracking-item__action { --mobile-action-link-padding: 0; }
.tracking-item__details { display: grid; gap: 6px; padding: 8px 10px; border-radius: 9px; background: var(--tms-surface-soft); }
</style>
