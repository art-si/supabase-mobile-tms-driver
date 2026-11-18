import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import { chromium } from 'playwright'

process.env.TMS_AUDIT_FIXTURE = '1'
const { fixtureAccount, fixturePassword, useAuditFixture } = await import('./audit-fixture.mjs')
const built = process.env.TMS_ASSISTANT_AUDIT_BUILD ? resolve(process.env.TMS_ASSISTANT_AUDIT_BUILD) : undefined
const base = process.env.TMS_AUDIT_BASE || (built ? 'http://127.0.0.1:9879/' : 'http://127.0.0.1:5191/')
const output = resolve(process.env.TMS_ASSISTANT_AUDIT_OUTPUT || 'artifacts/assistant-audit')
await mkdir(output, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 320, height: 852 }, reducedMotion: 'reduce' })
const requests = []
const errors = []
const checks = []
let keyboardClear
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
const retryAnswer = '如果凭证上传失败，请先确认网络可用，再打开原运单重试。已上传的凭证不需要重复提交。'
const newAnswer = '新会话已建立，可以继续提问。<b>此格式不会被执行。</b>'
const scriptedReplies = [
  { status: 200, hold: firstResponse, conversationId: 'fixture-chat', message: firstAnswer },
  { status: 503, code: 'feature_disabled' },
  { status: 429, code: 'rate_limited' },
  { status: 200, hold: retryResponse, conversationId: 'fixture-chat', message: retryAnswer },
  { status: 404, code: 'not_found' },
  { status: 200, conversationId: 'recovered-fixture-chat', message: newAnswer },
  { status: 404, code: 'not_found' },
  { status: 200, conversationId: 'another-fixture-chat', message: '已在另一条新对话中收到保留的问题。' },
]
let auditError
let page

try {
  if (built) {
    await readFile(resolve(built, 'index.html'))
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
    await context.route(url => url.origin === new URL(base).origin, async route => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname)
      const file = resolve(built, path === '/' ? 'index.html' : '.' + path)
      if (relative(built, file).startsWith('..')) return route.abort('accessdenied')
      try { return await route.fulfill({ path: file, contentType: mime[extname(file)] || 'application/octet-stream' }) }
      catch { return route.fulfill({ status: 404 }) }
    })
  }
  await useAuditFixture(context, base)
  await context.route('**/functions/v1/ai-assistant', async route => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fallback()
    const reply = scriptedReplies[requests.length]
    requests.push({ body: request.postDataJSON(), usesFixtureToken: request.headers().authorization === 'Bearer fixture-token', status: reply?.status ?? 500 })
    if (!reply) return route.fulfill({ status: 500, json: { code: 'unexpected_fixture_request' } })
    if (reply.hold) await reply.hold
    return route.fulfill({
      status: reply.status,
      headers: { 'access-control-allow-origin': new URL(base).origin },
      json: reply.code
        ? { code: reply.code, message: 'Fixture assistant error' }
        : { conversationId: reply.conversationId, runId: 'fixture-run', message: reply.message },
    })
  })
  page = await context.newPage()
  page.setDefaultTimeout(12_000)
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
  const userTurns = page.locator('.conversation__turn--user')
  const questionTurn = question => userTurns.filter({ has: page.getByText(question, { exact: true }) })
  const retry = page.getByRole('button', { name: '重试', exact: true })
  const recover = page.getByRole('button', { name: '开始新对话', exact: true })
  const confirm = page.getByRole('dialog', { name: '开始新对话' })
  const confirmAction = confirm.getByRole('button', { name: '开始新对话', exact: true })
  const waitForEditorFocus = () => page.waitForFunction(() => document.activeElement?.id === 'assistant-question-input')
  const waitForDraft = value => page.waitForFunction(expected => document.getElementById('assistant-question-input')?.value === expected, value, { timeout: 3000 })
  const capture = name => page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' })
  async function focusViaTab(target, key = 'Tab') {
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press(key)
      if (await target.evaluate(node => node === document.activeElement && node.matches(':focus-visible'))) return
    }
    assert.fail('Expected actual Tab traversal to reach the intended control')
  }
  async function confirmByKeyboard() {
    await page.waitForFunction(() => document.activeElement?.classList.contains('mobile-confirm__cancel'))
    await focusViaTab(confirmAction)
    await page.keyboard.press('Enter')
    await confirm.waitFor({ state: 'hidden' })
    await waitForEditorFocus()
  }
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
      const label = rect('.conversation__prompt .mobile-inline-pair__label')
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
  await suggestion.press('Enter')
  const firstQuestion = '接单后如何上传装卸凭证、磅单和电子回单？'
  await waitForDraft(firstQuestion)
  await waitForEditorFocus()
  assert.equal(requests.length, 0, 'Suggested prompts must remain editable and not send automatically')
  await editor.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true,
  })))
  assert.equal(requests.length, 0, 'IME Enter must not submit the draft')

  await page.keyboard.press('Tab')
  assert.equal(await submit.evaluate(node => node === document.activeElement), true)
  await page.keyboard.press('Enter')
  keyboardClear = await page.evaluate(() => {
    const field = document.getElementById('assistant-question-input')
    return { focused: document.activeElement === field, remainingCharacters: field?.value.length }
  })
  assert.deepEqual(keyboardClear, { focused: true, remainingCharacters: 0 }, 'Keyboard Send must clear the editor before a held reply')
  await page.keyboard.insertText('接着输入')
  await waitForDraft('接着输入')
  await editor.fill('')
  await page.getByText('正在思考，请稍候…', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '等待回复…', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '新对话', exact: true }).count(), 0)
  await waitForEditorFocus()
  await page.keyboard.press('Shift+Tab')
  const back = page.getByRole('button', { name: '返回上一页', exact: true })
  assert.equal(await back.evaluate(node => node === document.activeElement), true, 'Focus can leave the editor before the response')
  releaseFirst()
  await page.getByText(/接单后，从运单详情查看装货站点/).waitFor()
  assert.equal(await back.evaluate(node => node === document.activeElement), true, 'A response must not pull focus away from the control the user chose')
  checks.push('keyboard send returns to the editor before disabling; immediate new typing does not append to the sent question; pending response never steals intentionally moved focus')
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
  assert.equal(requests[0].usesFixtureToken, true)

  const blockedQuestion = '请检查当前司机账号的助手功能。'
  await editor.fill(blockedQuestion)
  await submit.click()
  const blocked = questionTurn(blockedQuestion)
  const disabledCopy = 'AI 助手暂不可用，请联系管理员。'
  await blocked.getByRole('alert').getByText(disabledCopy, { exact: true }).waitFor()
  assert.equal(requests[1].body.conversationId, 'fixture-chat')
  assert.equal(await blocked.getByRole('button').count(), 0, 'Permanent feature failure has no retry or reset action')
  assert.equal(await retry.count(), 0)
  await capture('320-feature-disabled')

  const temporaryQuestion = '凭证上传失败怎么办？'
  await editor.fill(temporaryQuestion)
  await submit.click()
  const temporary = questionTurn(temporaryQuestion)
  await temporary.getByRole('alert').getByText('提问次数已达上限，请稍后再试。', { exact: true }).waitFor()
  await blocked.getByText(disabledCopy, { exact: true }).waitFor()
  assert.equal(await blocked.getByRole('button').count(), 0)
  assert.equal(requests[2].body.conversationId, 'fixture-chat')
  assert.deepEqual(requests[2].body.messages, [
    { role: 'user', content: firstQuestion }, { role: 'assistant', content: firstAnswer },
    { role: 'user', content: temporaryQuestion },
  ])
  checks.push('feature_disabled stays attached to its question, has no retry, and is excluded from the next request')
  const retryBox = await retry.boundingBox()
  assert.ok(retryBox.width >= 44 && retryBox.height >= 44, 'Retry is a visible 44×44 touch target')
  await capture('320-temporary-retry')
  await retry.press('Space')
  await waitForEditorFocus()
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
  assert.deepEqual(requests[3].body, requests[2].body)
  assert.equal(await userTurns.count(), 3)
  assert.equal(await temporary.getByText(temporaryQuestion, { exact: true }).count(), 1)
  assert.equal(await temporary.getByRole('alert').count(), 0)
  assert.equal(await blocked.getByText(disabledCopy, { exact: true }).count(), 1)
  checks.push('rate_limited retry uses the original body and conversation exactly once, without repeating the question or moving a reader')
  await page.setViewportSize({ width: 393, height: 852 })
  await page.screenshot({ path: resolve(output, '393-conversation.png') })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 393)

  const expiredQuestion = '如果运单联系人变更怎么处理？'
  const laterDraft = '车辆故障要怎么处理？'
  const expiredCopy = '当前对话已失效，可以带上问题开始新对话。'
  await editor.fill(expiredQuestion)
  await submit.click()
  const expired = questionTurn(expiredQuestion)
  await expired.getByRole('alert').getByText(expiredCopy, { exact: true }).waitFor()
  assert.equal(requests[4].body.conversationId, 'fixture-chat')
  assert.equal(await retry.count(), 0)
  assert.equal(await expired.getByRole('button').count(), 1)
  const inlineRecovery = expired.getByRole('button', { name: '开始新对话', exact: true })
  await inlineRecovery.waitFor()
  const recoveryBox = await inlineRecovery.boundingBox()
  assert.ok(recoveryBox.width >= 44 && recoveryBox.height >= 44, 'Recovery is a 44×44 touch target')
  assert.ok(await expired.locator('.conversation__failure-copy').evaluate(node => {
    const glyph = node.querySelector('.mobile-icon').getBoundingClientRect()
    const text = node.querySelector('.mobile-inline-pair__label')
    const firstLine = text.getBoundingClientRect().top + parseFloat(getComputedStyle(text).lineHeight) / 2
    return Math.abs(glyph.top + glyph.height / 2 - firstLine) <= 1
  }), 'The recovery icon is centered to the first line of its message')
  await capture('393-expired-conversation')
  await editor.fill(laterDraft)
  assert.equal(await submit.isDisabled(), true)
  await editor.press('Control+Enter')
  assert.equal(requests.length, 5, 'An expired conversation cannot send a changed draft')
  await focusViaTab(inlineRecovery, 'Shift+Tab')
  await page.keyboard.press('Enter')
  await confirm.getByText('会保留待发送的问题。新对话不会沿用之前的聊天内容。', { exact: true }).waitFor()
  await page.waitForFunction(() => document.activeElement?.classList.contains('mobile-confirm__cancel'))
  await capture('393-recover-dialog')
  await page.keyboard.press('Enter')
  await confirm.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.classList.contains('conversation__recover'))
  assert.equal(await editor.inputValue(), laterDraft)
  assert.equal(await expired.getByRole('alert').count(), 1)
  assert.equal(requests.length, 5)
  await page.keyboard.press('Enter')
  await confirmByKeyboard()
  await page.getByText('常见问题', { exact: true }).waitFor()
  assert.equal(await editor.inputValue(), laterDraft)
  assert.equal(await userTurns.count(), 0)
  assert.equal(requests.length, 5, 'Confirming the reset must not submit automatically')
  await capture('393-recovered-draft')
  await submit.click()
  await page.getByText(newAnswer, { exact: true }).waitFor()
  assert.equal(await page.locator('.conversation__answer b').count(), 0, 'Assistant content must render as text')
  assert.equal(requests[5].body.conversationId, undefined)
  assert.deepEqual(requests[5].body.messages, [{ role: 'user', content: laterDraft }])
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin })
  await page.getByRole('button', { name: '复制这条回复', exact: true }).click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), newAnswer)

  const savedQuestion = '到货签收有没有要核对的信息？'
  await editor.fill('')
  await page.keyboard.insertText(savedQuestion)
  assert.equal(await editor.inputValue(), savedQuestion)
  await submit.click()
  await questionTurn(savedQuestion).getByRole('alert').getByText(expiredCopy, { exact: true }).waitFor()
  assert.equal(requests[6].body.conversationId, 'recovered-fixture-chat')
  await waitForDraft('')
  await recover.click()
  await confirmAction.click()
  await page.getByText('常见问题', { exact: true }).waitFor()
  await waitForDraft(savedQuestion)
  assert.equal(requests.length, 7, 'Recovering the failed question must not submit automatically')
  await editor.press('Control+Enter')
  await page.getByText(scriptedReplies[7].message, { exact: true }).waitFor()
  assert.equal(requests[7].body.conversationId, undefined)
  assert.deepEqual(requests[7].body.messages, [{ role: 'user', content: savedQuestion }])
  checks.push('not_found offers only a new conversation; cancel preserves the session; confirm preserves a non-empty draft or the failed question, with no automatic request or old ID')

  await focusViaTab(page.getByRole('button', { name: '新对话', exact: true }), 'Shift+Tab')
  await page.keyboard.press('Enter')
  await confirmByKeyboard()
  await page.getByText('常见问题', { exact: true }).waitFor()
  await waitForDraft('')
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
    Object.defineProperties(window.visualViewport, {
      height: { configurable: true, value: 210 },
      offsetTop: { configurable: true, value: 35 }
    })
    window.visualViewport.dispatchEvent(new Event('resize'))
  })
  const waitForViewport = (top, bottom) => page.waitForFunction(({ top, bottom }) => {
    const panel = document.querySelector('.conversation').getBoundingClientRect()
    const footer = document.querySelector('.conversation__footer').getBoundingClientRect()
    const thread = document.querySelector('.conversation__viewport').getBoundingClientRect()
    return Math.abs(panel.top - top) < 2 && Math.abs(footer.bottom - bottom) < 2 && thread.height >= 20
  }, { top, bottom })
  await waitForViewport(35, 245)
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: 55 })
    window.visualViewport.dispatchEvent(new Event('scroll'))
  })
  await waitForViewport(55, 265)
  await page.evaluate(() => {
    Reflect.deleteProperty(window.visualViewport, 'height')
    Reflect.deleteProperty(window.visualViewport, 'offsetTop')
    window.visualViewport.dispatchEvent(new Event('resize'))
  })
  await waitForViewport(0, 812)
  assert.equal(requests.length, scriptedReplies.length)
  assert.ok(requests.every(request => request.usesFixtureToken))
  checks.push('actual Tab/Enter cancel restores the inline opener; keyboard confirmation from inline and header restores the editor')
  checks.push('long answers, literal markup, clipboard, reset, and long drafts remain usable when the 210px visible viewport moves and restores')
  await page.setViewportSize({ width: 768, height: 852 })
  await page.reload()
  await suggestion.waitFor()
  const desktopPanel = await panel.boundingBox()
  assert.equal(desktopPanel.width, 560)
  assert(Math.abs(desktopPanel.x - (768 - desktopPanel.width) / 2) < 1)
  await edges()
  const waitForPromptRows = count => page.waitForFunction(expected =>
    new Set([...document.querySelectorAll('.conversation__prompt')].map(item => Math.round(item.getBoundingClientRect().top))).size === expected,
  count, { timeout: 3000 })
  await waitForPromptRows(2)
  await page.screenshot({ path: resolve(output, '768-starter.png') })
  await page.setViewportSize({ width: 320, height: 740 })
  await page.addStyleTag({ content: 'html { font-size: 24px !important }' })
  await waitForPromptRows(4)
  await edges()
  assert.ok(await page.locator('.conversation__prompt').evaluateAll(items => items.every(item => {
    const box = item.getBoundingClientRect()
    return box.width >= 44 && box.height >= 44 && item.scrollWidth <= item.clientWidth
  })), 'Large text prompts retain touch targets and do not clip')
  await page.screenshot({ path: resolve(output, '320-large-text.png') })
  assert.deepEqual(errors, [])
  checks.push('320px enlarged text and centered 768px layout remain aligned')
  console.log('PASS: assistant entry, long replies, typed recovery, preserved drafts, keyboard focus and IME, copy, and responsive layout.')
} catch (error) {
  auditError = error.message
  if (page) await page.screenshot({ path: resolve(output, 'audit-failure.png'), animations: 'disabled' }).catch(() => undefined)
  throw error
} finally {
  releaseFirst()
  releaseRetry()
  await browser.close()
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ passed: !auditError, ...(auditError && { error: auditError }), build: built, base, keyboardClear, checks, requests, errors }, null, 2) + '\n')
}
