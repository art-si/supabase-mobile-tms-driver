<script setup lang="ts">
import { computed } from "vue";
import type { Waybill, WaybillEvent } from "@/api/types";
import { formatDateTime } from "@/utils/format";
import { getWaybillRoutePoints } from "@/utils/route";
import MobileStatusTag from "@mobile-core/components/MobileStatusTag.vue";
import TmsRouteMap from "./TmsRouteMap.vue";

interface TraceNode {
  id: string;
  longitude: number;
  latitude: number;
  title: string;
  time?: string;
  location: string;
  source: "measured" | "inferred";
}

const props = withDefaults(
  defineProps<{
    waybill?: Waybill | null;
    events?: WaybillEvent[];
  }>(),
  { events: () => [] },
);

let mapRouteAvailable = true;
// #ifndef H5
mapRouteAvailable = Boolean(import.meta.env.VITE_AMAP_WEB_SERVICE_KEY);
// #endif

const actionLabels: Record<string, string> = {
  accept: "接受任务",
  loading_checkin: "装货定位打卡",
  complete_loading: "装货完成",
  upload_pickup: "装货凭证上传",
  confirm_departure: "确认发车",
  confirm_arrival: "到达定位打卡",
  complete_unloading: "卸货完成",
  complete_unload: "卸货完成",
  sign: "签收完成",
  submit_signature: "签收完成",
  complete: "确认回场",
  cancel: "取消运单",
};

function validCoordinate(longitude: unknown, latitude: unknown) {
  return (
    typeof longitude === "number" &&
    typeof latitude === "number" &&
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
}

function eventTitle(event: WaybillEvent) {
  const action = typeof event.payload?.action === "string" ? event.payload.action : "";
  return actionLabels[action] || event.eventType || "业务定位";
}

const measuredNodes = computed<TraceNode[]>(() =>
  [...props.events]
    .filter((event) => validCoordinate(event.longitude, event.latitude))
    .sort(
      (left, right) =>
        new Date(left.eventTime).getTime() - new Date(right.eventTime).getTime(),
    )
    .map((event) => ({
      id: event.id,
      longitude: Number(event.longitude),
      latitude: Number(event.latitude),
      title: eventTitle(event),
      time: event.eventTime,
      location: event.locationText || "设备定位坐标",
      source: "measured" as const,
    })),
);

const inferredNodes = computed<TraceNode[]>(() =>
  getWaybillRoutePoints(props.waybill).map((point, index, source) => ({
    id: `route-${index}`,
    longitude: point.longitude,
    latitude: point.latitude,
    title: index === 0 ? "装货地" : index === source.length - 1 ? "卸货地" : "运输站点",
    location:
      index === 0
        ? props.waybill?.shipperAddress || "装货地运单坐标"
        : props.waybill?.receiverAddress || "卸货地运单坐标",
    source: "inferred" as const,
  })),
);

function samePoint(left: TraceNode, right: TraceNode) {
  return (
    Math.abs(left.longitude - right.longitude) < 0.00001 &&
    Math.abs(left.latitude - right.latitude) < 0.00001
  );
}

const traceNodes = computed(() => {
  if (measuredNodes.value.length >= 2) return measuredNodes.value;
  const combined = [
    inferredNodes.value[0],
    ...measuredNodes.value,
    inferredNodes.value[inferredNodes.value.length - 1],
  ].filter((item): item is TraceNode => Boolean(item));
  return combined.filter(
    (item, index, source) => source.findIndex((candidate) => samePoint(item, candidate)) === index,
  );
});

const mapPoints = computed(() =>
  traceNodes.value.map((item) => ({
    longitude: item.longitude,
    latitude: item.latitude,
  })),
);

const traceDescription = computed(() => {
  if (measuredNodes.value.length >= 2) {
    return "以实测业务节点为途经点规划车行路线；路线用于节点串联展示，不代表司机实际行驶轨迹。";
  }
  if (measuredNodes.value.length === 1) {
    return "结合 1 个实测定位与运单起终点规划车行路线，补全坐标会明确标注来源。";
  }
  return "暂无实测打卡坐标，当前按运单起终点规划车行路线，不作为实际行驶轨迹。";
});
</script>


<template>
  <view class="driver-card trajectory-panel">
    <view class="driver-heading trajectory-panel__header">
      <text class="section-title" role="heading" aria-level="2">定位节点</text>
      <text class="driver-copy">{{ traceNodes.length }} 个节点</text>
    </view>

    <view class="trajectory-panel__map">
      <TmsRouteMap :waybill="waybill" :points-override="mapPoints" route-mode="nodes" embedded />
    </view>
    <view v-if="mapRouteAvailable" class="trajectory-panel__legend" aria-label="地图图例">
      <text class="trajectory-panel__legend-item trajectory-panel__legend-item--route">车行路线</text>
      <text class="trajectory-panel__legend-item trajectory-panel__legend-item--node">业务节点</text>
    </view>
    <text class="driver-copy">{{ traceDescription }}</text>

    <view v-if="traceNodes.length" class="trace-list">
      <view v-for="node in traceNodes" :key="node.id" class="trace-list__item">
        <view class="driver-heading trace-list__top">
          <text class="trace-list__title">{{ node.title }}</text>
          <MobileStatusTag
            :label="node.source === 'measured' ? '设备定位' : '运单坐标'"
            :tone="node.source === 'measured' ? 'blue' : 'gray'"
          />
        </view>
        <text class="driver-copy">{{ node.location }}</text>
        <view class="trace-list__meta">
          <text v-if="node.time">{{ formatDateTime(node.time) }}</text>
          <text>{{ node.longitude.toFixed(6) }}, {{ node.latitude.toFixed(6) }}</text>
        </view>
      </view>
    </view>

    <text v-else class="driver-copy">暂无定位坐标，装货或到达打卡后会在这里显示。</text>
  </view>
</template>

<style scoped lang="scss">
.trajectory-panel { display: grid; min-width: 0; gap: 10px; }
.trajectory-panel__header { flex-wrap: wrap; }
.trajectory-panel__map {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--mobile-workspace-line);
  border-radius: 14px;
  background: var(--tms-surface-soft);
}
.trajectory-panel__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  color: var(--mobile-workspace-muted);
  font-size: 12px;
}
.trajectory-panel__legend-item { display: flex; align-items: center; gap: 5px; }
.trajectory-panel__legend-item::before { content: ''; display: inline-block; }
.trajectory-panel__legend-item--route::before {
  width: 12px;
  height: 3px;
  border-radius: 8px;
  background: var(--mobile-workspace-accent);
}
.trajectory-panel__legend-item--node::before {
  width: 7px;
  height: 7px;
  border: 2px solid var(--mobile-workspace-accent);
  border-radius: 50%;
}
.trace-list { display: grid; }
.trace-list__item {
  display: grid;
  min-width: 0;
  gap: 4px;
  padding-block: 9px;
  border-top: 1px solid var(--mobile-workspace-line);
  overflow-wrap: anywhere;
}
.trace-list__item:last-child { padding-bottom: 0; }
.trace-list__top { flex-wrap: wrap; }
.trace-list__title { color: var(--mobile-workspace-ink); font-size: 14px; font-weight: 700; }
.trace-list__meta { display: flex; flex-wrap: wrap; gap: 2px 9px; color: var(--mobile-workspace-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
</style>
