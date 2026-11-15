import { defineStore } from "pinia";
import {
  acceptAssignedWaybill,
  cancelAssignedWaybill,
  getWaybill,
  getWaybillExecutionContext,
  listWaybillEvents,
  listWaybillProofs,
  listWaybills,
  type WaybillStatusGroup,
} from "@/api/waybill";
import type {
  Waybill,
  WaybillEvent,
  WaybillProof,
  WaybillStatus,
} from "@/api/types";
import { syncDriverWaybills } from "@/api/supabase";
import { useAuthStore } from "./auth";
import { useDictionaryStore } from "./dictionary";

interface WaybillState {
  list: Waybill[];
  current: Waybill | null;
  currentTask: Waybill | null;
  events: WaybillEvent[];
  proofs: WaybillProof[];
  loading: boolean;
  actionLoading: boolean;
  activeGroup: WaybillStatusGroup;
}

const activeStatuses: WaybillStatus[] = [
  "accepted",
  "loading",
  "transporting",
  "unloading",
  "signed",
];

export const useWaybillStore = defineStore("waybill", {
  state: (): WaybillState => ({
    list: [],
    current: null,
    currentTask: null,
    events: [],
    proofs: [],
    loading: false,
    actionLoading: false,
    activeGroup: "all",
  }),
  getters: {
    pendingCount: (state) =>
      state.list.filter((item) => item.status === "pending").length,
    activeCount: (state) =>
      state.list.filter((item) => activeStatuses.includes(item.status)).length,
    completedCount: (state) =>
      state.list.filter((item) => item.status === "completed").length,
  },
  actions: {
    async syncAssignedWaybills(token: string) {
      try {
        await syncDriverWaybills(token);
      } catch (error) {
        console.warn("sync driver waybills failed", error);
      }
    },
    async ensureSession() {
      const auth = useAuthStore();
      if (!(await auth.ensureValidSession())) throw new Error("请先登录");
      return auth;
    },
    async loadList(group?: WaybillStatusGroup) {
      const targetGroup = group || this.activeGroup;
      if (targetGroup !== this.activeGroup) this.list = [];
      this.activeGroup = targetGroup;
      const auth = await this.ensureSession();
      this.loading = true;
      try {
        await this.syncAssignedWaybills(auth.token);
        this.list = await auth.withFreshAccess((token) =>
          listWaybills(token, { group: targetGroup }),
        );
        return this.list;
      } finally {
        this.loading = false;
      }
    },
    async loadHomeTask() {
      const auth = await this.ensureSession();
      await this.syncAssignedWaybills(auth.token);
      const active = await auth.withFreshAccess((token) =>
        listWaybills(token, { group: "active", limit: 1 }),
      );
      const pending = active.length
        ? []
        : await auth.withFreshAccess((token) =>
            listWaybills(token, { group: "pending", limit: 1 }),
          );
      const latest =
        active.length || pending.length
          ? []
          : await auth.withFreshAccess((token) =>
              listWaybills(token, { group: "all", limit: 1 }),
            );
      const latestTask = latest[0];
      let recoverableCompletedTask: Waybill | null = null;
      if (latestTask?.status === "completed") {
        try {
          const context = await auth.withFreshAccess((token) =>
            getWaybillExecutionContext(token, latestTask.id),
          );
          if (context.needsReturnCompletion && context.canComplete) {
            recoverableCompletedTask = latestTask;
          }
        } catch {
          // 首页降级展示最近任务；详情页会再次读取执行上下文并给出准确提示。
        }
      }
      this.currentTask =
        active[0] ||
        pending[0] ||
        recoverableCompletedTask ||
        latestTask ||
        null;
      return this.currentTask;
    },
    async loadDetail(id: string) {
      const auth = await this.ensureSession();
      this.loading = true;
      this.current = null;
      this.events = [];
      this.proofs = [];
      try {
        await useDictionaryStore().load(auth.token);
        const detail = await auth.withFreshAccess((token) => getWaybill(token, id));
        const [events, proofs] = detail
          ? await Promise.all([
              auth.withFreshAccess((token) => listWaybillEvents(token, id)),
              auth.withFreshAccess((token) => listWaybillProofs(token, id)),
            ])
          : [[], []];
        this.current = detail;
        this.events = events;
        this.proofs = proofs;
        return detail;
      } finally {
        this.loading = false;
      }
    },
    async acceptCurrent() {
      if (!this.current) throw new Error("运单不存在");
      const auth = await this.ensureSession();
      this.actionLoading = true;
      try {
        await acceptAssignedWaybill(auth.token, this.current.id);
        await this.loadDetail(this.current.id);
        await this.loadHomeTask();
        return this.current;
      } finally {
        this.actionLoading = false;
      }
    },
    async cancelCurrent(reason: string) {
      if (!this.current) throw new Error("运单不存在");
      const auth = await this.ensureSession();
      this.actionLoading = true;
      try {
        await cancelAssignedWaybill(auth.token, this.current.id, reason);
        await this.loadDetail(this.current.id);
        await this.loadHomeTask();
        return this.current;
      } finally {
        this.actionLoading = false;
      }
    },
  },
});
