<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { getWaybillExecutionContext, signWaybill, uploadWaybillProofFiles } from '@/api/waybill'
import type { Waybill } from '@/api/types'
import { getUserFacingErrorMessage } from '@/api/supabase'
import TmsRecordTimeNotice from '@/components/business/TmsRecordTimeNotice.vue'
import TmsDateTimePicker from '@/components/business/TmsDateTimePicker.vue'
import MobileAction from '@mobile-core/components/MobileAction.vue'
import MobileBottomSheet from '@mobile-core/components/MobileBottomSheet.vue'
import MobileEvidence from '@mobile-core/components/MobileEvidence.vue'
import MobileField from '@mobile-core/components/MobileField.vue'
import MobilePickerTrigger from '@mobile-core/components/MobilePickerTrigger.vue'
import TmsPageSkeleton from '@mobile-core/components/TmsPageSkeleton.vue'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'
import { chooseImages } from '@mobile-core/files'
import { formatDateTime } from '@/utils/format'

defineOptions({ options: { styleIsolation: 'shared' } })

const props = defineProps<{
  modelValue: boolean
  waybill: Waybill | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  success: []
}>()

const auth = useAuthStore()
const profile = useProfileStore()
const state = reactive({ loading: false, uploading: '', submitting: false, error: '' })
const form = reactive({
  signedAt: Date.now(),
  signerName: '',
  receiptUrls: [] as string[],
  signatureUrls: [] as string[],
  remark: ''
})
const datePickerVisible = ref(false)
const signedAtLabel = computed(() => formatDateTime(new Date(form.signedAt).toISOString()))

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})
const submitMissing = computed(() => {
  const missing: string[] = []
  if (!form.signerName.trim()) missing.push('签收人')
  if (!form.receiptUrls.length) missing.push('签收回单')
  if (!form.signatureUrls.length) missing.push('签字照片')
  return missing
})
const canSubmit = computed(
  () =>
    submitMissing.value.length === 0 &&
    !state.loading &&
    !state.error &&
    !state.submitting &&
    !state.uploading
)

watch(
  () => props.modelValue,
  (value) => {
    if (value) void load()
  }
)

async function load() {
  state.error = ''
  const waybill = props.waybill
  if (!waybill) {
    state.error = '运单信息不可用，请关闭后重试'
    return
  }
  state.loading = true
  try {
    const context = await auth.withFreshAccess((token) =>
      getWaybillExecutionContext(token, waybill.id)
    )
    const record = context.record
    form.signedAt = record?.signedAt ? new Date(record.signedAt).getTime() : Date.now()
    form.signerName = record?.signerName || waybill.receiverName || ''
    form.receiptUrls = [...(record?.receiptUrls || [])]
    form.signatureUrls = [...(record?.signatureUrls || [])]
    form.remark = record?.signatureRemark || ''
  } catch (error) {
    state.error = getUserFacingErrorMessage(error, '签收信息加载失败，请重试')
  } finally {
    state.loading = false
  }
}

async function upload(kind: 'receipt' | 'signature') {
  if (!visible.value || !props.waybill || state.loading || state.uploading || state.submitting) return
  state.uploading = kind
  try {
    const currentCount = kind === 'receipt' ? form.receiptUrls.length : form.signatureUrls.length
    const paths = await chooseImages((kind === 'receipt' ? 5 : 3) - currentCount)
    if (!paths.length) return
    const operator = profile.driver?.driverName || profile.user?.nickName || profile.user?.userName
    const files = await uploadWaybillProofFiles(
      auth.token,
      props.waybill,
      kind === 'receipt' ? 'receipt' : 'signature_confirmation',
      paths,
      operator
    )
    const urls = files.map((item) => item.url)
    if (kind === 'receipt') form.receiptUrls = [...form.receiptUrls, ...urls].slice(0, 5)
    else form.signatureUrls = [...form.signatureUrls, ...urls].slice(0, 3)
  } catch (error) {
    showError(error, '上传失败')
  } finally {
    state.uploading = ''
  }
}

function remove(kind: 'receipt' | 'signature', index: number) {
  if (!visible.value || state.uploading || state.submitting) return
  const target = kind === 'receipt' ? form.receiptUrls : form.signatureUrls
  target.splice(index, 1)
}


async function submit() {
  if (!visible.value || !props.waybill || !canSubmit.value) return

  state.submitting = true
  try {
    await signWaybill(
      auth.token,
      props.waybill.id,
      new Date(form.signedAt).toISOString(),
      form.signerName.trim(),
      [...form.receiptUrls],
      [...form.signatureUrls],
      form.remark.trim() || null
    )
    emit('success')
    visible.value = false
  } catch (error) {
    showError(error, '签收失败')
  } finally {
    state.submitting = false
  }
}

function showError(error: unknown, fallback: string) {
  uni.showToast({
    title: getUserFacingErrorMessage(error, fallback),
    icon: 'none',
    duration: 3000
  })
}
</script>


<template>
  <MobileBottomSheet
    v-model="visible"
    title="签收确认"
    close-label="关闭签收确认"
    :busy="state.submitting"
    tall
  >
    <view class="signature-sheet__content">
      <TmsPageSkeleton
        v-if="state.loading || state.error" compact label="正在同步签收信息…"
        :error="state.error" @retry="load"
      />
      <template v-else>
        <view class="signature-sheet__fields">
          <MobileField field="signature-time" label="签收时间" required>
            <MobilePickerTrigger
              id="signature-time" label="选择签收时间" :value="signedAtLabel"
              :description="`已选时间：${signedAtLabel}`"
              :expanded="datePickerVisible" :disabled="state.submitting" @click="datePickerVisible = true"
            />
          </MobileField>
          <TmsRecordTimeNotice subject="签收时间" />
          <MobileField
            v-model="form.signerName" field="signature-signer" label="签收人"
            :maxlength="50" required placeholder="请输入实际签收人"
          />
        </view>

        <view v-for="kind in ['receipt', 'signature'] as const" :key="kind" class="signature-sheet__fields">
          <view class="signature-sheet__section">
            <text class="signature-sheet__label" role="heading" aria-level="3">
              {{ kind === 'receipt' ? '签收回单' : '签字确认照片' }}
              <text class="required-mark" aria-hidden="true">*</text>
            </text>
            <text class="signature-sheet__copy">
              {{ kind === 'receipt' ? form.receiptUrls.length + '/5' : form.signatureUrls.length + '/3' }} 张
            </text>
          </view>
          <text class="signature-sheet__copy">
            {{ kind === 'receipt' ? '请拍清单号和签收信息。' : '请拍收货人签字后的确认凭证。' }}
          </text>
          <MobileEvidence
            :images="kind === 'receipt' ? form.receiptUrls : form.signatureUrls"
            :label="kind === 'receipt' ? '签收回单' : '签字照片'"
            :upload-label="kind === 'receipt' ? '上传回单' : '上传签字照片'"
            :limit="kind === 'receipt' ? 5 : 3"
            :disabled="state.submitting || Boolean(state.uploading)"
            :uploading="state.uploading === kind"
            @remove="remove(kind, $event)" @upload="upload(kind)"
          />
        </view>

        <view class="signature-sheet__fields">
          <MobileField
            v-model="form.remark" field="signature-remark" label="备注"
            multiline :maxlength="300" placeholder="可填写货损、少货或现场说明"
          />
        </view>
      </template>
    </view>

    <template #footer>
      <view class="signature-sheet__footer">
        <text v-if="!state.loading && !state.error" class="signature-sheet__copy" role="status">
          {{ submitMissing.length ? '还需 ' + submitMissing.join('、') : '签收后还需录入收车时间和里程。' }}
        </text>
        <view class="signature-sheet__controls">
          <MobileAction class="signature-sheet__action tms-secondary-action" :disabled="state.submitting" @click="visible = false">取消</MobileAction>
          <MobileAction
            class="signature-sheet__action tms-primary-action" :disabled="!canSubmit" :aria-busy="state.submitting"
            @click="submit"
          >
            <view class="mobile-inline-pair">
              <wd-loading v-if="state.submitting" type="circular" color="#fff" size="28rpx" aria-hidden="true" />
              <text class="mobile-inline-pair__label">{{ state.submitting ? '正在签收…' : '确认签收' }}</text>
            </view>
          </MobileAction>
        </view>
      </view>
    </template>
    <template #overlay>
      <TmsDateTimePicker
        v-model="form.signedAt" v-model:visible="datePickerVisible" title="选择签收时间"
      />
    </template>
  </MobileBottomSheet>
</template>

<style scoped lang="scss">
.signature-sheet__section { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.signature-sheet__content {
  display: grid;
  gap: 12px;
  padding: 12px max(16px, var(--mobile-safe-right)) 16px max(16px, var(--mobile-safe-left));
}
.signature-sheet__fields {
  display: grid;
  min-width: 0;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--tms-line-subtle);
  border-radius: 16px;
  background: var(--tms-surface);
}
.signature-sheet__label { color: var(--tms-text-strong); font-size: 14px; font-weight: 690; }
.signature-sheet__copy { color: var(--tms-text-secondary); font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
.signature-sheet__footer { display: grid; gap: 8px; }
.signature-sheet__controls { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
.signature-sheet__action { display: flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; }
</style>
