import { ApiRequestError, getUserFacingErrorMessage, request } from './supabase'

export const DRIVER_ASSISTANT_MESSAGE_LIMIT = 2000

export interface DriverAssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

interface DriverAssistantReply {
  conversationId: string
  message: string
}

export async function sendDriverAssistantMessage(
  token: string,
  messages: readonly DriverAssistantMessage[],
  conversationId?: string
): Promise<DriverAssistantReply> {
  const response = await request<unknown>('/functions/v1/ai-assistant', {
    method: 'POST',
    token,
    body: {
      action: 'chat',
      ...(conversationId ? { conversationId } : {}),
      messages: messages.slice(-12).map(({ role, content }) => ({ role, content: content.slice(0, 4000) })),
      context: { routeName: 'driver-assistant', routePath: '/pages/mine/assistant', pageTitle: '司机端 AI 助手' }
    }
  })

  if (!response || typeof response !== 'object' || !('conversationId' in response) || !('message' in response) ||
    typeof response.conversationId !== 'string' || !response.conversationId.trim() ||
    typeof response.message !== 'string' || !response.message.trim()) {
    throw new Error('助手没有返回有效答复，请重试')
  }
  return { conversationId: response.conversationId, message: response.message }
}

export function getDriverAssistantError(error: unknown, hasConversation: boolean): {
  message: string
  action?: 'retry' | 'reset'
} {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case 'forbidden': return { message: '当前账号暂不能使用 AI 助手，请联系管理员。' }
      case 'unauthorized': return { message: '登录已过期，请重新登录后再试。' }
      case 'not_found': return hasConversation
        ? { message: '当前对话已失效，可以带上问题开始新对话。', action: 'reset' }
        : { message: 'AI 助手暂不可用，请联系管理员。' }
      case 'rate_limited': return { message: '提问次数已达上限，请稍后再试。', action: 'retry' }
      case 'feature_disabled':
      case 'missing_secret': return { message: 'AI 助手暂不可用，请联系管理员。' }
    }
  }
  return { message: getUserFacingErrorMessage(error, '暂时无法取得答复，请重试。'), action: 'retry' }
}
