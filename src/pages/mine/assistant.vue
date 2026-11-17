<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow, onUnload } from '@dcloudio/uni-app'
import MobileConfirmDialog from '@mobile-core/components/MobileConfirmDialog.vue'
import MobileConversation from '@mobile-core/components/MobileConversation.vue'
import MobileWorkspace from '@mobile-core/components/MobileWorkspace.vue'
import { DRIVER_ASSISTANT_MESSAGE_LIMIT, getDriverAssistantError, sendDriverAssistantMessage, type DriverAssistantMessage } from '@/api/driver-assistant'
import { usePageTheme } from '@/composables/usePageTheme'
import { useAuthStore } from '@/stores/auth'

const starters = [
  { icon: 'schedule', label: '提送货预约', question: '如何申请提货或送货预约？提交后在哪里查看确认结果？' },
  { icon: 'warning', label: '异常报备', question: '运输途中遇到车辆故障或无法按时送达，怎样上报异常？' },
  { icon: 'expense', label: '在途费用', question: '如何上报在途费用？费用审核退回后在哪里修改？' },
  { icon: 'receipt', label: '装卸与回单', question: '接单后如何上传装卸凭证、磅单和电子回单？' }
] as const

const { themeName } = usePageTheme()
const auth = useAuthStore()
const ready = ref(false)
const sending = ref(false)
const resetOpen = ref(false)
const draft = ref('')
const conversationId = ref<string>()
const messages = ref<DriverAssistantMessage[]>([])
const error = ref('')
const canSend = computed(() => ready.value && !sending.value && !!draft.value.trim())
const canReset = computed(() => !sending.value && Boolean(messages.value.length || draft.value.trim()))
let active = true

onShow(async () => { ready.value = await auth.ensureValidSession() })
onUnload(() => { active = false })

function reset() {
  messages.value = []
  draft.value = ''
  conversationId.value = undefined
  error.value = ''
}

function send() {
  if (!canSend.value) return
  messages.value.push({ role: 'user', content: draft.value.trim().slice(0, DRIVER_ASSISTANT_MESSAGE_LIMIT) })
  draft.value = ''
  void requestReply()
}

async function requestReply() {
  if (!ready.value || sending.value || !messages.value.length) return
  const thread = messages.value.slice()
  sending.value = true
  error.value = ''
  try {
    const reply = await auth.withFreshAccess(token => sendDriverAssistantMessage(token, thread, conversationId.value))
    if (!active) return
    conversationId.value = reply.conversationId
    messages.value.push({ role: 'assistant', content: reply.message })
  } catch (cause) {
    if (active) error.value = getDriverAssistantError(cause)
  } finally {
    if (active) sending.value = false
  }
}
</script>

<template>
  <wd-config-provider :theme="themeName">
    <MobileWorkspace container-class="page driver-page">
      <MobileConversation
        v-model="draft"
        title="AI 助手"
        intro="司机业务，有问有答"
        scope="从提送货预约到签收回单，查操作步骤、问处理流程。"
        assistance="AI 回复仅供参考，请勿输入个人或客户资料。"
        back-fallback="/pages/mine/index"
        field="assistant-question"
        placeholder="问司机端操作…"
        :limit="DRIVER_ASSISTANT_MESSAGE_LIMIT"
        :messages="messages"
        :prompts="starters"
        :ready="ready"
        :sending="sending"
        :can-reset="canReset"
        :error="error"
        @send="send"
        @retry="requestReply"
        @reset="resetOpen = true"
      />
      <MobileConfirmDialog v-model="resetOpen" title="开始新对话" message="新对话不会沿用当前聊天内容。" confirm-text="开始新对话" :destructive="false" @confirm="reset" />
    </MobileWorkspace>
  </wd-config-provider>
</template>

