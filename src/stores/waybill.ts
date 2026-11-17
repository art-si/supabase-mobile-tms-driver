import { defineStore } from "pinia";
import { createLatestRequest } from "@mobile-core/latest-request";
import {
  acceptAssignedWaybill,
  cancelAssignedWaybill,
  getWaybill,
  listWaybillEvents,
  listWaybillProofs,
  listWaybills,
  type WaybillStatusGroup,
} from "@/api/waybill";
import type {
  Waybill,
  WaybillEvent,
  WaybillProof,
} from "@/api/types";
import { syncDriverWaybills } from "@/api/supabase";
import { useAuthStore } from "./auth";
import { useDictionaryStore } from "./dictionary";

interface WaybillState {
  current: Waybill | null;
  events: WaybillEvent[];
  proofs: WaybillProof[];
  actionLoading: boolean;
}

const pendingSyncs = new Map<string, Promise<unknown>>();
const detailRequests = createLatestRequest();

export const useWaybillStore = defineStore("waybill", {
  state: (): WaybillState => ({
    current: null,
    events: [],
    proofs: [],
    actionLoading: false,
  }),
  actions: {
    syncAssignedWaybills(token: string) {
      const running = pendingSyncs.get(token);
      if (running) return running;
      const request = syncDriverWaybills(token)
        .catch((error) => console.warn("sync driver waybills failed", error))
        .finally(() => pendingSyncs.delete(token));
      pendingSyncs.set(token, request);
      return request;
    },
    async ensureSession() {
      const auth = useAuthStore();
      if (!(await auth.ensureValidSession())) throw new Error("请先登录");
      return auth;
    },
    async loadList(group: WaybillStatusGroup) {
      const auth = await this.ensureSession();
      await this.syncAssignedWaybills(auth.token);
      return auth.withFreshAccess((token) => listWaybills(token, { group }));
    },
    async loadHomeTask() {
      const auth = await this.ensureSession();
      await this.syncAssignedWaybills(auth.token);
      for (const group of ["active", "pending", "all"] as const) {
        const [task] = await auth.withFreshAccess((token) => listWaybills(token, { group, limit: 1 }));
        if (task) return task;
      }
      return null;
    },
    async loadWaybill(id: string) {
      const auth = await this.ensureSession();
      return auth.withFreshAccess((token) => getWaybill(token, id));
    },
    async loadDetail(id: string, isCurrentPage: () => boolean) {
      const isLatest = detailRequests.start();
      const isCurrent = () => isLatest() && isCurrentPage();
      const auth = await this.ensureSession();
      if (!isCurrent()) return null;
      this.current = null;
      this.events = [];
      this.proofs = [];
      await useDictionaryStore().load(auth.token);
      if (!isCurrent()) return null;
      const detail = await auth.withFreshAccess((token) => getWaybill(token, id));
      if (!isCurrent()) return null;
      const [events, proofs] = detail
        ? await Promise.all([
            auth.withFreshAccess((token) => listWaybillEvents(token, id)),
            auth.withFreshAccess((token) => listWaybillProofs(token, id)),
          ])
        : [[], []];
      if (!isCurrent()) return null;
      this.current = detail;
      this.events = events;
      this.proofs = proofs;
      return detail;
    },
    async acceptCurrent() {
      const id = this.current?.id;
      if (!id) throw new Error("运单不存在");
      const auth = await this.ensureSession();
      this.actionLoading = true;
      try {
        await acceptAssignedWaybill(auth.token, id);
      } finally {
        this.actionLoading = false;
      }
    },
    async cancelCurrent(reason: string) {
      const id = this.current?.id;
      if (!id) throw new Error("运单不存在");
      const auth = await this.ensureSession();
      this.actionLoading = true;
      try {
        await cancelAssignedWaybill(auth.token, id, reason);
      } finally {
        this.actionLoading = false;
      }
    },
  },
});
