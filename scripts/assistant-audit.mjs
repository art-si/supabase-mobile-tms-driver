import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

process.env.TMS_AUDIT_FIXTURE = '1'
const { fixtureAccount, fixturePassword, useAuditFixture } = await import('./audit-fixture.mjs')
const base = process.env.TMS_AUDIT_BASE || 'http://127.0.0.1:5191/'
const output = resolve(process.env.TMS_ASSISTANT_AUDIT_OUTPUT || 'artifacts/assistant-audit')
await mkdir(output, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 320, height: 852 }, reducedMotion: 'reduce' })
const requests = []
let releaseFirst
const firstResponse = new Promise(resolve => { releaseFirst = resolve })
let releaseRetry
const retryResponse = new Promise(resolve => { releaseRetry = resolve })
const firstAnswer = [
  '接单后，从运单详情查看装货站点和联系人。',
  '',
  '### 装货凭证',
  '1. 到场后可提交**装货照片**和磅单。',
  '2. 确认资料清楚且关联到本次装货。',
  '3. 提交后回到运单详情查看结果。',
  ...Array.from({ length: 12 }, (_, i) => `${i + 4}. 长回复测试：请在车辆停稳后核对操作结果，资料有缺项时联系调度。`)
].join('\n')

try {
  await useAuditFixture(context, base)
  await context.route('**/functions/v1/ai-assistant', async route => {
    const request = route.request()
    requests.push({ body: request.postDataJSON(), authorization: request.headers().authorization })
    const number = requests.length
    if (number === 1) await firstResponse
    if (number === 2) return route.fulfill({ status: 503, json: { code: 'feature_disabled', message: 'AI backend unavailable' } })
    if (number === 3) await retryResponse
    const message = number === 1
      ? firstAnswer
      : number === 3 ? '如果凭证上传失败，请先确认网络可用，再打开原运单重试。已上传的凭证不需要重复提交。'
        : '新会话已建立，可以继续提问。<b>此格式不会被执行。</b>'
    return route.fulfill({ status: 200, json: { conversationId: number === 4 ? 'new-fixture-chat' : 'fixture-chat', runId: 'fixture-run', message } })
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(new URL('#/pages/login/index', base).href)
  await page.locator('.login-form input').first().fill(fixtureAccount)
  await page.locator('.login-form input').nth(1).fill(fixturePassword)
  await page.locator('.login-form__button').click()
  await page.getByRole('link', { name: '我的', exact: true }).click()
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  await page.waitForURL(/#\/pages\/mine\/assistant/)
  const editor = page.getByRole('textbox', { name: '你的问题' })
  const submit = page.getByRole('button', { name: '发送', exact: true })
  assert.equal(await submit.isDisabled(), true)
  const suggestion = page.getByRole('button', { name: '装卸与回单', exact: true })
  const footer = page.locator('.conversation__footer')
  const panel = page.locator('.conversation')
  await suggestion.waitFor()
  await page.screenshot({ path: resolve(output, '320-starter.png') })
  const initialFooter = await footer.boundingBox()
  const initialInput = await page.locator('.conversation__input').boundingBox()
  assert(initialFooter.height <= 104, `Empty composer should leave room for the thread: footer ${initialFooter.height}px, input ${initialInput.height}px`)
  const composerMetrics = await page.evaluate(() => {
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('.conversation__input .uni-textarea-placeholder'))
    const text = range.getBoundingClientRect()
    const send = document.querySelector('.conversation__send').getBoundingClientRect()
    return { textCenter: text.top + text.height / 2, sendCenter: send.top + send.height / 2 }
  })
  assert(Math.abs(composerMetrics.textCenter - composerMetrics.sendCenter) < 2, JSON.stringify(composerMetrics))
  const edges = async () => {
    const data = await page.evaluate(() => {
      const rect = name => document.querySelector(name).getBoundingClientRect()
      const icon = rect('.conversation__prompt .mobile-icon')
      const label = rect('.conversation__prompt > uni-text')
      return {
        iconDelta: Math.abs(icon.top + icon.height / 2 - label.top - label.height / 2),
        wide: document.documentElement.scrollWidth,
        viewport: innerWidth
      }
    })
    assert(data.iconDelta < 1, 'Suggestion icon and text have a shared center line')
    assert.equal(data.wide, data.viewport)
  }
  await edges()
  await suggestion.click()
  const firstQuestion = '接单后如何上传装卸凭证、磅单和电子回单？'
  await page.waitForFunction(question => document.querySelector('#assistant-question-input')?.value === question, firstQuestion)
  assert.equal(requests.length, 0, 'Suggested prompts must remain editable and not send automatically')

  await submit.click()
  await page.getByText('正在思考，请稍候…', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '等待回复…', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '新对话', exact: true }).count(), 0)
  releaseFirst()
  await page.getByText(/接单后，从运单详情查看装货站点/).waitFor()
  await page.getByRole('heading', { name: '装货凭证', exact: true }).waitFor()
  assert.equal(await page.locator('.conversation__part--strong').textContent(), '装货照片')
  assert.equal(await page.locator('.conversation__marker').count(), 15)
  assert(await page.locator('.conversation__line--item .conversation__line-copy').evaluateAll(lines =>
    lines.every(line => Math.abs(line.getBoundingClientRect().left - lines[0].getBoundingClientRect().left) < 1)
  ), 'All numbered replies use the same text column')
  const answerBox = await page.getByText('接单后，从运单详情查看装货站点和联系人。', { exact: true }).boundingBox()
  assert(answerBox.y >= 0 && answerBox.y < (await footer.boundingBox()).y, 'Long replies open at the start')
  await page.screenshot({ path: resolve(output, '320-long-answer.png') })
  assert.deepEqual(requests[0].body, {
    action: 'chat',
    messages: [{ role: 'user', content: firstQuestion }],
    context: { routeName: 'driver-assistant', routePath: '/pages/mine/assistant', pageTitle: '司机端 AI 助手' }
  })
  assert.match(requests[0].authorization, /^Bearer /)

  await editor.fill('凭证上传失败怎么办？')
  await submit.click()
  await page.getByRole('alert').getByText('AI 助手暂不可用，请联系管理员。').waitFor()
  assert.equal(requests[1].body.conversationId, 'fixture-chat')
  assert.deepEqual(requests[1].body.messages.map(message => message.role), ['user', 'assistant', 'user'])
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.waitForFunction(() => {
    const nodes = document.querySelectorAll('.conversation__viewport .uni-scroll-view')
    return [...nodes].some(node => node.scrollTop > 80)
  })
  const scrollThread = page.locator('.conversation__viewport .uni-scroll-view').last()
  await scrollThread.evaluate(node => { node.scrollTop = 0 })
  await page.getByRole('button', { name: '查看最新', exact: true }).waitFor()
  releaseRetry()
  await page.getByText(/已上传的凭证不需要重复提交/).waitFor()
  assert((await scrollThread.evaluate(node => node.scrollTop)) < 12, 'A response must not interrupt reading older messages')
  await page.getByRole('button', { name: '查看最新', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.conversation__viewport .uni-scroll-view')].some(node => node.scrollTop > 80))
  assert.deepEqual(requests[2].body, requests[1].body)
  assert.equal(await page.locator('.conversation__turn--user').count(), 2)
  await page.setViewportSize({ width: 393, height: 852 })
  await page.screenshot({ path: resolve(output, '393-conversation.png') })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 393)

  await page.getByRole('button', { name: '新对话', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: '开始新对话' })
  await confirm.getByRole('button', { name: '开始新对话' }).click()
  await page.getByText('常见问题', { exact: true }).waitFor()
  await page.setViewportSize({ width: 320, height: 530 })
  await editor.fill(Array.from({ length: 20 }, () => '司机填写较长的问题').join('\n'))
  const compactFooter = await footer.boundingBox()
  assert(compactFooter.height < 170 && compactFooter.y > 280, 'Long drafts must not cover the viewport')
  const compactPanel = await panel.boundingBox()
  await page.screenshot({ path: resolve(output, '320-compact-draft.png') })
  assert(Math.abs(compactFooter.y + compactFooter.height - compactPanel.y - compactPanel.height) < 2,
    JSON.stringify({ compactFooter, compactPanel }))
  await page.setViewportSize({ width: 320, height: 812 })
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 520 })
    window.visualViewport.dispatchEvent(new Event('resize'))
  })
  await page.waitForFunction(() => Math.abs(document.querySelector('.conversation__footer').getBoundingClientRect().bottom - 520) < 2)
  await page.evaluate(() => {
    Reflect.deleteProperty(window.visualViewport, 'height')
    window.visualViewport.dispatchEvent(new Event('resize'))
  })
  await editor.fill('车辆故障要怎么处理？')
  await submit.click()
  await page.getByText(/<b>此格式不会被执行。<\/b>/).waitFor()
  assert.equal(await page.locator('.conversation__answer b').count(), 0, 'Assistant content must render as text')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin })
  await page.getByRole('button', { name: '复制这条回复', exact: true }).click()
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /新会话已建立/)
  assert.equal(requests[3].body.conversationId, undefined)
  assert.equal(requests[3].body.messages.length, 1)
  await page.setViewportSize({ width: 768, height: 852 })
  await page.reload()
  await suggestion.waitFor()
  const desktopPanel = await panel.boundingBox()
  assert.equal(desktopPanel.width, 560)
  assert(Math.abs(desktopPanel.x - (768 - desktopPanel.width) / 2) < 1)
  await edges()
  const rowCount = () => page.locator('.conversation__prompt').evaluateAll(items =>
    new Set(items.map(item => Math.round(item.getBoundingClientRect().top))).size)
  assert.equal(await rowCount(), 2)
  await page.screenshot({ path: resolve(output, '768-starter.png') })
  await page.setViewportSize({ width: 320, height: 740 })
  await page.evaluate(() => document.documentElement.style.setProperty('font-size', '24px', 'important'))
  await edges()
  assert.equal(await rowCount(), 4, 'At larger text size the suggestions must stack on narrow screens')
  await page.screenshot({ path: resolve(output, '320-large-text.png') })
  assert.deepEqual(errors, [])
  console.log('PASS: assistant entry, formal answer reading, follow/review scroll behavior, safe copy, reset, retry, keyboard space, large text and centered desktop.')
} finally {
  releaseFirst()
  releaseRetry()
  await browser.close()
}
