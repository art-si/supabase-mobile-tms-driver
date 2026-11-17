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

export function getDriverAssistantError(error: unknown) {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case 'forbidden': return '当前账号暂不能使用 AI 助手，请联系管理员。'
      case 'unauthorized': return '登录已过期，请重新登录后再试。'
      case 'not_found': return '当前会话无法继续，请开始新对话。'
      case 'rate_limited': return '提问次数已达上限，请稍后再试。'
      case 'feature_disabled':
      case 'missing_secret': return 'AI 助手暂不可用，请联系管理员。'
    }
  }
  return getUserFacingErrorMessage(error, '暂时无法取得答复，请重试。')
}
