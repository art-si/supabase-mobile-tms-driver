import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { fixtureAccount, fixtureMode, fixturePassword, useAuditFixture } from './audit-fixture.mjs'

const account = fixtureAccount || process.env.TMS_AUDIT_ACCOUNT || process.argv[2]
const password = fixturePassword || process.env.TMS_AUDIT_PASSWORD || process.argv[3]
const waybillId = process.env.TMS_AUDIT_WAYBILL_ID || '9ca1a6d0-a3f9-45fb-adea-53ffbddf3715'
const output = resolve(process.env.TMS_AUDIT_OUTPUT || 'artifacts/interaction-audit')
const base = process.env.TMS_AUDIT_BASE || 'http://127.0.0.1:5173/'
const phase = process.env.TMS_AUDIT_PHASE || process.argv[4] || 'all'
const width = Number(process.env.TMS_AUDIT_WIDTH || 393)
const results = []
const dialogs = []
const pageErrors = []
const listReady = '.route-card--list .route-card__open, .mobile-empty'
const detailReady = '.route-card--detail'
const detailProof = '[aria-label^="预览"][aria-label$="张运输单据"]'

if (!account || !password) throw new Error('Provide the driver account and password for this local audit.')
if (['mutations', 'filters', 'dense', 'services'].includes(phase) && !fixtureMode) throw new Error('Use TMS_AUDIT_FIXTURE=1 for simulated workflows.')
await mkdir(output, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width, height: 852 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  reducedMotion: 'reduce',
})
await context.route('https://apis.map.qq.com/**', route => route.abort())
await useAuditFixture(context, base)
const page = await context.newPage()
page.setDefaultTimeout(12000)
await page.addInitScript(() => {
  window.__auditGlobalEvents = []
  document.addEventListener('click', event => {
    const target = event.target
    window.__auditGlobalEvents.push({ type: 'click', tag: target?.tagName, className: String(target?.className || '').slice(0, 120), text: target?.textContent?.trim().slice(0, 40), hash: location.hash })
  }, true)
  window.addEventListener('hashchange', () => window.__auditGlobalEvents.push({ type: 'hashchange', hash: location.hash }))
  const open = window.open.bind(window)
  window.open = (url, target, features) => {
    if (typeof url === 'string' && url.startsWith('https://apis.map.qq.com/')) {
      window.__auditNavigationCount = (window.__auditNavigationCount || 0) + 1
      window.__auditNavigationUrl = url
      return window
    }
    return open(url, target, features)
  }
})
page.on('dialog', async dialog => {
  dialogs.push({ type: dialog.type(), message: dialog.message() })
  await dialog.dismiss()
})
page.on('pageerror', error => pageErrors.push(error.message))

async function visit(path, ready) {
  const closePreview = page.getByRole('button', { name: '关闭预览', exact: true })
  if (await closePreview.isVisible()) {
    await closePreview.click()
    await closePreview.waitFor({ state: 'hidden' })
  }
  await page.goto(new URL(`#${path}`, base).href, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  if (ready) await page.waitForSelector(ready, { timeout: 25000 })
  await page.waitForTimeout(180)
  if (path.startsWith('/pages/waybill/detail')) {
    await page.evaluate(() => {
      window.__auditDomEvents = []
      for (const selector of ['[aria-label$="张运输单据"]', '.detail-actions .detail-operation', '.route-card--detail .driver-inline', '.route-card__nav', '[aria-label^="拨打"]']) {
        const element = document.querySelector(selector)
        for (const type of ['click', 'tap']) {
          element?.addEventListener(type, () => window.__auditDomEvents.push(`${selector}:${type}`))
        }
      }
    })
  }
}

async function step(name, action, options = {}) {
  const before = page.url()
  let error = ''
  try {
    await action()
    await page.waitForTimeout(options.delay ?? 450)
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }
  const screenshot = join(output, `${name}.png`)
  await page.screenshot({ path: screenshot }).catch(() => {})
  const after = page.url()
  const toast = await page.locator('.uni-toast, .wd-toast, uni-modal, .uni-modal').allTextContents().catch(() => [])
  const layout = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth })).catch(() => null)
  const openPages = context.pages().map(tab => tab.url())
  const previewCount = await page.locator('dialog.mobile-image-viewer[open]').count().catch(() => 0)
  const domEvents = await page.evaluate(() => window.__auditDomEvents || null).catch(() => null)
  const globalEvents = await page.evaluate(() => window.__auditGlobalEvents || null).catch(() => null)
  const previewDom = await page.evaluate(() => {
    const root = document.getElementById('u-a-p')
    const child = root?.firstElementChild
    const style = child && getComputedStyle(child)
    return child ? { html: child.outerHTML.slice(0, 350), display: style.display, position: style.position, zIndex: style.zIndex, opacity: style.opacity } : null
  }).catch(() => null)
  results.push({ name, before, after, error, toast: toast.map(text => text.trim()).filter(Boolean), layout, screenshot, openPages, previewCount, domEvents, globalEvents, previewDom })
  console.log(`${error ? 'FAIL' : 'PASS'} ${name} ${new URL(after).hash}`)
  if (error) console.error(error)
  if (error && phase === 'mutations') throw new Error(`Could not complete ${name}`)
}

try {
  await visit('/pages/login/index', '.login-form')
  await step('login-forgot-password', () => page.getByRole('button', { name: '忘记密码？' }).click())
  await step('login-remember-toggle', () => page.locator('.login-form__remember').click())
  await page.locator('input').nth(0).fill(account)
  await page.locator('input').nth(1).fill(password)
  await step('login-submit', async () => {
    await page.locator('.login-form__button').click()
    await page.waitForURL(/#\/pages\/home\/index/, { timeout: 25000 })
  })

  if (phase === 'filters') {
    await visit('/pages/waybill/index', listReady)
    const filters = page.getByRole('group', { name: '运单状态筛选' })
    const option = (name, pressed) => filters.getByRole('button', { name, exact: true, pressed })
    const cards = page.locator('.route-card--list')
    const pendingRequest = (request) => request.url().endsWith('/rpc/tms_list_driver_mobile_waybills') &&
      request.postDataJSON()?.p_group === 'pending'
    await step('filters-ignore-old-response', async () => {
      const [slowRequest] = await Promise.all([
        page.waitForRequest(pendingRequest),
        option('待处理').click(),
      ])
      await option('待处理', true).waitFor()
      const slowResponse = slowRequest.response()
      await option('进行中').click()
      await option('进行中', true).waitFor()
      await cards.getByText('YD20261116001', { exact: true }).waitFor()
      await (await slowResponse)?.finished()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      if (await cards.getByText('YD20261116002', { exact: true }).count()) throw new Error('Out-of-order pending response replaced the active filter')
    })
    await step('filters-fail-then-retry', async () => {
      await option('已完成').click()
      await page.getByText('已完成任务同步失败，请重试', { exact: true }).waitFor()
      if (await cards.count()) throw new Error('An errored filter reused records from another group')
      await page.getByRole('button', { name: '重新加载', exact: true }).click()
      await cards.getByText('YD20261116003', { exact: true }).waitFor()
      await option('已完成', true).waitFor()
    })
    await visit('/pages/home/index', '.route-card--task')
    await step('pickup-nav-and-progress', async () => {
      const action = page.getByRole('button', { name: '导航到装货地', exact: true })
      const size = await action.boundingBox()
      if (!size || size.width < 44 || size.height < 44) throw new Error('Pickup navigation touch target is smaller than 44px')
      await action.click()
      const output = await page.evaluate(() => window.__auditNavigationUrl)
      if (!output || new URL(output).searchParams.get('tocoord') !== '30.61,114.18') throw new Error('Pickup navigation selected the wrong endpoint')
      const stepAlignments = await page.locator('.progress__step').evaluateAll(elements => elements.map(element => {
        const label = element.querySelector('.progress__label').getBoundingClientRect()
        const marker = element.querySelector('.progress__dot').getBoundingClientRect()
        return Math.abs(label.left + label.width / 2 - marker.left - marker.width / 2)
      }))
      if (stepAlignments.length !== 6 || stepAlignments.some(offset => offset > 1)) throw new Error('Progress labels are misaligned')
      await page.getByRole('progressbar', { name: '运输进度' }).waitFor()
    })
    await visit('/pages/waybill/detail?id=92a00000-0000-4000-8000-000000000003', detailReady)
    await step('delivery-nav', async () => {
      await page.getByRole('button', { name: '导航到卸货地', exact: true }).click()
      const output = await page.evaluate(() => window.__auditNavigationUrl)
      if (!output || new URL(output).searchParams.get('tocoord') !== '30.31,120.47') throw new Error('Delivery navigation selected the wrong endpoint')
    })
  }

  if (phase === 'focus') {
    await visit(`/pages/waybill/expense?id=${encodeURIComponent(waybillId)}`, '.expense-page__content')
    await step('expense-nested-keyboard-dismiss', async () => {
      const open = page.getByRole('button', { name: '新增费用', exact: true })
      await open.press('Enter')
      const sheet = page.getByRole('dialog', { name: '新增费用上报' })
      const category = sheet.getByRole('button', { name: '选择费用项目' })
      await category.press('Enter')
      const picker = page.getByRole('dialog', { name: '选择费用项目' })
      await picker.waitFor()
      await page.keyboard.press('Escape')
      await picker.waitFor({ state: 'hidden' })
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '选择费用项目')
      await page.keyboard.press('Escape')
      await sheet.waitFor({ state: 'hidden' })
      await page.waitForFunction(() => document.activeElement?.textContent.trim().includes('新增费用'))
    })
    await visit(`/pages/waybill/detail?id=${encodeURIComponent(waybillId)}`, detailReady)
    await step('signature-nested-keyboard-dismiss', async () => {
      await page.getByRole('button', { name: '办理签收' }).press('Enter')
      const sheet = page.getByRole('dialog', { name: '签收确认' })
      await sheet.getByRole('button', { name: '选择签收时间' }).press('Enter')
      const picker = page.getByRole('dialog', { name: '选择签收时间' })
      await picker.waitFor()
      await page.keyboard.press('Escape')
      await picker.waitFor({ state: 'hidden' })
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '选择签收时间')
      await page.keyboard.press('Escape')
      await sheet.waitFor({ state: 'hidden' })
      await page.waitForFunction(() => document.activeElement?.textContent.trim().includes('办理签收'))
    })
  }

  if (phase === 'dense') {
    const action = name => page.getByRole('button', { name, exact: true })
    const enlargeText = selector => page.locator(selector).first().evaluate(element => {
      const targets = [...element.querySelectorAll('uni-text')]
      const sizes = targets.map(target => parseFloat(getComputedStyle(target).fontSize))
      targets.forEach((target, index) => { target.style.fontSize = `${Math.round(sizes[index] * 1.35)}px` })
    })
    await visit('/pages/waybill/index', listReady)
    await step('list-return-preserves-context', async () => {
      await action('进行中').click()
      const card = page.getByRole('button', { name: /运单号 YD20261116912/ })
      await card.scrollIntoViewIfNeeded()
      const before = await card.boundingBox()
      const scrollPath = () => card.evaluate(element => {
        const ancestors = []
        for (let current = element.parentElement; current; current = current.parentElement) {
          if (current.scrollTop) ancestors.push(`${current.tagName}#${current.id}.${current.className}: ${current.scrollTop}`)
        }
        return ancestors.join(', ')
      })
      const beforeScroll = await scrollPath()
      await card.click()
      await page.waitForURL(/waybill\/detail/)
      await page.locator(detailReady).waitFor()
      await action('返回上一页').click()
      await page.waitForURL(/waybill\/index/)
      await page.getByRole('group', { name: '运单状态筛选' }).getByRole('button', { name: '进行中', pressed: true }).waitFor()
      await card.waitFor()
      try {
        await card.evaluate((element, expected) => new Promise((resolve, reject) => {
          let frames = 0
          const deadline = performance.now() + 2800
          const check = () => {
            frames = Math.abs(element.getBoundingClientRect().top - expected) <= 10 ? frames + 1 : 0
            if (frames >= 3) return resolve()
            if (performance.now() > deadline) return reject(new Error('Selected card did not return to the viewport'))
            requestAnimationFrame(check)
          }
          requestAnimationFrame(check)
        }), before?.y)
      } catch {
        throw new Error(`Returning from a record restored scroll [${await scrollPath()}] instead of [${beforeScroll}]`)
      }
      const after = await card.boundingBox()
      if (!before || !after || Math.abs(before.y - after.y) > 10) throw new Error(`Returning from a record moved the selected card from ${before?.y} to ${after?.y}`)
    })
    await visit(`/pages/waybill/detail?id=${encodeURIComponent(waybillId)}`, detailReady)
    await step('dense-timeline', async () => {
      const timeline = page.locator('.tracking-card')
      await enlargeText('.tracking-card')
      await action('费用记录').click()
      if (await timeline.getByRole('heading', { name: '装货信息已提交' }).count()) throw new Error('Expense filter still shows transport events')
      await action('查看 5 张凭证').click()
      const preview = page.getByRole('dialog', { name: '预览凭证', exact: true })
      await preview.getByRole('status').getByText('1 / 5', { exact: true }).waitFor()
      await preview.getByRole('button', { name: '关闭预览', exact: true }).click()
      await action('运输节点').click()
      await timeline.getByText('时间未记录', { exact: true }).waitFor()
      await action('展开装货信息已提交明细').click()
      await timeline.getByText('系统记录于 2026-11-15 09:40').waitFor()
      await timeline.locator('.tracking-item__details').scrollIntoViewIfNeeded()
    })
    await visit(`/pages/waybill/expense?id=${encodeURIComponent(waybillId)}`, '.expense-page__content')
    await step('dense-expense-history', async () => {
      await enlargeText('.expense-record')
      const retry = action('修改并重新提交')
      await retry.scrollIntoViewIfNeeded()
      const [button, proof] = await Promise.all([retry.boundingBox(), page.locator('.expense-record__proofs').boundingBox()])
      if (!button || !proof || button.y + button.height > proof.y) throw new Error('Expense correction is still below the receipt grid')
    })
    await visit('/pages/vehicle/index', '.vehicle-card')
    await step('dense-vehicle-profile', async () => {
      await enlargeText('.vehicle-card')
      await page.locator('.vehicle-card').scrollIntoViewIfNeeded()
    })
  }

  if (phase === 'services') {
    await visit('/pages/mine/index', '.mine-page__content')
    await step('mine-weighbridge-by-waybill', async () => {
      await page.getByRole('button', { name: '过磅记录', exact: true }).click()
      await page.waitForURL(/index\?service=weighbridge/)
      await page.getByRole('button', { name: /运单号 YD20261116001/ }).click()
      await page.waitForURL(/waybill\/weighbridge\?id=/)
      await page.getByRole('heading', { name: '装货过磅' }).waitFor()
      await page.getByRole('heading', { name: '卸货过磅' }).waitFor()
      await page.getByRole('button', { name: '预览第 1 张装货磅单', exact: true }).click()
      const preview = page.getByRole('dialog', { name: '预览装货磅单', exact: true })
      await preview.getByRole('button', { name: '关闭预览', exact: true }).click()
      if (process.env.TMS_AUDIT_STATE === 'weighbridge-partial') {
        await page.getByText('卸货过磅资料暂时不可用', { exact: true }).waitFor()
        const retry = page.getByRole('button', { name: '重试卸货过磅资料', exact: true })
        const box = await retry.boundingBox()
        if (!box || box.width < 44 || box.height < 44) throw new Error('The weighbridge retry target is smaller than 44px')
        await retry.click()
        await page.getByRole('button', { name: '预览第 1 张装货磅单', exact: true }).waitFor()
      }
      await page.getByRole('button', { name: '预览第 1 张卸货磅单', exact: true }).waitFor()
      await page.getByRole('button', { name: '返回上一页' }).click()
      await page.waitForURL(/index\?service=weighbridge/)
    })
    await visit('/pages/mine/index', '.mine-page__content')
    await step('mine-certification-retry', async () => {
      await page.getByRole('button', { name: '司机认证', exact: true }).click()
      await page.waitForURL(/mine\/certification/)
      await page.getByText('页面加载失败', { exact: true }).waitFor()
      await page.getByRole('button', { name: '重新加载', exact: true }).click()
      await page.getByRole('heading', { name: '认证状态', exact: true }).waitFor()
      const documents = page.getByRole('heading', { name: '证件审核', exact: true })
      if (process.env.TMS_AUDIT_STATE === 'certification-exempt') {
        await page.getByText('无需认证', { exact: true }).waitFor()
        if (await documents.count()) throw new Error('An exempt driver would see irrelevant checklist items')
      } else {
        await documents.waitFor()
        await page.locator('.mobile-row').filter({ hasText: '从业资格证' }).getByText('尚未通过', { exact: true }).waitFor()
        await page.getByText('身份证、驾驶证和从业资格证尚未全部审核通过', { exact: true }).waitFor()
      }
    })
  }

  if (phase === 'mutations') {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ longitude: 114.18, latitude: 30.61, accuracy: 12 })
    const action = name => page.getByRole('button', { name, exact: true })
    const uploadFixtureImage = async (name, visibleProofName, scope = page) => {
      const selected = page.waitForEvent('filechooser')
      await scope.getByRole('button', { name, exact: true }).click()
      await (await selected).setFiles({
        name: 'fixture-proof.png', mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvZcAAAAASUVORK5CYII=', 'base64'),
      })
      await scope.getByRole('button', { name: visibleProofName, exact: true }).waitFor()
    }
    const detailPath = `/pages/waybill/detail?id=${encodeURIComponent(waybillId)}`
    await visit(detailPath, detailReady)
    await step('lifecycle-accept', async () => {
      await action('确认接受任务').click()
      await action('装货打卡').waitFor()
      if (await page.getByText('已接受任务', { exact: true }).isVisible()) throw new Error('The accepted task has a next action; no toast should obscure it')
    })
    await step('lifecycle-load-cargo', async () => {
      await action('装货打卡').click()
      await action('获取定位并打卡').click()
      await page.getByText('已完成定位打卡', { exact: true }).waitFor()
      if (await page.getByText('装货打卡成功', { exact: true }).isVisible()) throw new Error('The cargo form must show check-in status without obscuring uploads')
      await page.locator('#cargo-net-weight input').fill('18.4')
      const pendingChooser = page.waitForEvent('filechooser')
      await action('上传照片').click()
      const chooser = await pendingChooser
      if (!await action('上传磅单').isDisabled()) throw new Error('A second evidence chooser can open while picking an image')
      await chooser.element().dispatchEvent('cancel')
      await uploadFixtureImage('上传照片', '预览第 1 张装货照片')
      await uploadFixtureImage('上传磅单', '预览第 1 张装货磅单')
      const submit = action('提交装货信息')
      await page.locator('#cargo-net-weight input').fill('0')
      await page.getByText('请输入大于 0 的净重。', { exact: true }).waitFor()
      if (!await submit.isDisabled()) throw new Error('Zero net weight enabled cargo submission')
      await page.locator('#cargo-net-weight input').fill('18.4')
      const gross = page.locator('#cargo-gross-weight input')
      const tare = page.locator('#cargo-tare-weight input')
      await gross.fill('12')
      await tare.fill('13')
      await page.getByText('毛重不得小于皮重。', { exact: true }).waitFor()
      if (!await submit.isDisabled()) throw new Error('Inconsistent gross and tare weights enabled cargo submission')
      const [grossBox, tareBox] = await Promise.all([gross.boundingBox(), tare.boundingBox()])
      if (!grossBox || !tareBox || Math.abs(grossBox.y - tareBox.y) > 1) throw new Error('A weight error misaligned the weight inputs')
      await gross.fill('')
      await tare.fill('')
      await submit.click()
      await action('录入发车信息').waitFor()
    })
    await step('lifecycle-departure', async () => {
      await action('录入发车信息').click()
      const field = page.locator('#execution-odometer input')
      const odometer = await field.inputValue()
      const departureRpc = request => request.url().endsWith('/rest/v1/rpc/tms_record_waybill_departure')
      const submissions = []
      const recordSubmission = request => { if (departureRpc(request)) submissions.push(request) }
      await page.route('**/rest/v1/rpc/tms_record_waybill_departure', route =>
        route.fulfill({ status: 503, json: { message: 'Fixture: temporary execution failure' } }), { times: 1 })
      page.on('request', recordSubmission)
      try {
        await action('确认发车').click()
        await page.locator('.execution-footer').getByRole('alert').waitFor()
        if (await field.inputValue() !== odometer) throw new Error('Failed departure cleared the draft')
        await action('确认发车').click()
        const saved = action('已提交')
        await saved.waitFor()
        if (!await saved.isDisabled()) throw new Error('A completed departure can submit again before leaving the form')
        await saved.dispatchEvent('click')
        await action('到达打卡').waitFor()
        if (submissions.length !== 2) throw new Error(`Expected one failed departure and one successful retry, got ${submissions.length} requests`)
      } finally {
        page.off('request', recordSubmission)
      }
    })
    await step('lifecycle-unload-cargo', async () => {
      await action('到达打卡').click()
      await action('获取定位并打卡').click()
      await page.getByText('卸货打卡成功', { exact: true }).waitFor()
      await action('填写卸货信息').click()
      await action('提交卸货信息').click()
      await action('办理签收').waitFor()
    })
    await step('lifecycle-sign', async () => {
      await action('办理签收').click()
      await page.locator('#signature-signer input').fill('测试签收人')
      await action('确认签收').click()
      await page.getByRole('dialog', { name: '签收已完成' }).waitFor()
      if (await page.getByText('签收成功', { exact: true }).isVisible()) throw new Error('A success toast must not obscure the next action dialog')
    })
    await step('lifecycle-return', async () => {
      await action('去录入').click()
      await action('确认回场').click()
      await page.locator('.route-card--detail').getByText('已完成', { exact: true }).waitFor()
    })
    await step('expense-resubmit', async () => {
      await visit(`/pages/waybill/expense?id=${encodeURIComponent(waybillId)}`, '.expense-page__content')
      await action('修改并重新提交').click()
      await page.locator('#expense-amount input').fill('268.50')
      await action('重新提交').click()
      const record = page.locator('.expense-record').first()
      await record.getByText('审批中', { exact: true }).waitFor()
      await record.getByText('¥268.50', { exact: true }).waitFor()
    })
    await step('expense-create-submit', async () => {
      await action('新增费用').click()
      await action('选择费用项目').click()
      await page.getByRole('dialog', { name: '选择费用项目' }).locator('.mobile-select__option').first().click()
      await page.locator('#expense-amount input').fill('96.30')
      await uploadFixtureImage('添加费用凭证', '预览第 1 张费用凭证', page.getByRole('dialog', { name: '新增费用上报' }))
      await action('提交审批').click()
      const record = page.locator('.expense-record').filter({ hasText: 'BX20261116002' })
      await record.getByText('审批中', { exact: true }).waitFor()
      await record.getByText('¥96.30', { exact: true }).waitFor()
    })
  }

  if (phase === 'states' && process.env.TMS_AUDIT_STATE === 'retry') {
    await step('home-sync-error', () => page.getByRole('alert').filter({ hasText: '测试同步中断' }).waitFor())
    await step('home-sync-retry', async () => {
      await page.getByRole('button', { name: '重试', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: '测试同步中断' }).waitFor({ state: 'hidden' })
      await page.locator('.task-card__button:not([disabled])').waitFor()
    })
  }

  if (phase === 'states' && process.env.TMS_AUDIT_STATE === 'empty') {
    await step('home-no-task', () => page.getByText('当前没有运输任务', { exact: true }).waitFor())
    await step('waybill-no-task', async () => {
      await page.getByRole('button', { name: '查看运单', exact: true }).click()
      await page.getByText('当前筛选下暂无任务', { exact: true }).waitFor()
    })
    await step('vehicle-not-bound', async () => {
      await page.locator('.bottom-nav__item[aria-label="车辆"]').click()
      await page.getByText('暂无绑定车辆', { exact: true }).waitFor()
    })
    await step('expense-empty-history', async () => {
      await visit(`/pages/waybill/expense?id=${encodeURIComponent(waybillId)}`, '.expense-page__content')
      await page.getByText('暂无费用上报', { exact: true }).waitFor()
    })
  }

  if (phase === 'all' || phase === 'navigation') {
  await visit('/pages/home/index', '.home-page__content')
  await step('home-current-task', () => page.locator('.route-card--task .route-card__open').click())
  await visit('/pages/home/index', '.home-page__content')
  await page.locator('.task-card__button:not([disabled])').waitFor({ state: 'visible', timeout: 15000 })
  await step('home-primary-action', async () => {
    await page.locator('.task-card__button').click()
    await page.waitForURL(/#\/pages\/waybill\/(detail|cargo-operation|execution-operation)/, { timeout: 10000 })
  })
  await visit('/pages/home/index', '.home-page__content')
  if (await page.locator('.todo-card__stack .route-card__open').count()) {
    await step('home-pending-task', () => page.locator('.todo-card__stack .route-card__open').first().click())
  }
  await visit('/pages/home/index', '.home-page__content')
  if (await page.locator('.todo-card__all-content').count()) {
    await step('home-all-tasks', () => page.locator('.todo-card__all-content').click())
  }
  await visit('/pages/home/index', '.home-page__content')
  await step('home-settings', async () => {
    await page.locator('[aria-label="打开设置"]').click()
    await page.waitForURL(/#\/pages\/settings\/index/)
  })
  await step('settings-theme-persistence', async () => {
    const group = page.getByRole('group', { name: '主题色' })
    const selected = group.getByRole('button', { pressed: true })
    const original = await selected.getAttribute('aria-label')
    const alternative = group.getByRole('button', { pressed: false }).first()
    const alternativeName = await alternative.getAttribute('aria-label')
    await alternative.click()
    const changed = group.getByRole('button', { name: alternativeName, exact: true, pressed: true })
    await changed.waitFor()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await changed.waitFor()
    await group.getByRole('button', { name: original, exact: true }).click()
  })
  await visit('/pages/home/index', '.home-page__content')
  await step('home-navigation', () => page.locator('.route-card__nav').first().click())
  for (const [label, destination] of [
    ['车辆', 'vehicle'],
    ['我的', 'mine'],
    ['运单', 'waybill'],
    ['首页', 'home'],
  ]) {
    await step(`bottom-nav-${destination}`, async () => {
      await page.locator(`.bottom-nav__item[aria-label="${label}"]`).click()
      await page.waitForURL(new RegExp(`#\\/pages\\/${destination}\\/index`), { timeout: 10000 })
    })
  }

  await visit('/pages/waybill/index', listReady)
  for (const group of ['待处理', '进行中', '已完成', '全部']) {
    await step(`waybill-filter-${group}`, async () => {
      await page.getByRole('group', { name: '运单状态筛选' }).getByRole('button', { name: group, exact: true }).click()
      await page.getByRole('group', { name: '运单状态筛选' }).getByRole('button', { name: group, exact: true, pressed: true }).waitFor()
      await page.waitForSelector(listReady, { timeout: 20000 })
    })
  }
  await step('waybill-refresh', async () => {
    await page.locator('[aria-label="刷新运单列表"]').click()
    await page.waitForSelector(listReady, { timeout: 20000 })
  })
  await step('waybill-card-open', () => page.locator('.route-card--list .route-card__open').first().click())
  await visit('/pages/waybill/index', listReady)
  await step('waybill-expense-open', () => page.getByRole('button', { name: /^上报运单 .+ 的费用$/ }).first().click())
  }

  if (phase === 'all' || phase === 'detail') {
  const detailUrl = `/pages/waybill/detail?id=${encodeURIComponent(waybillId)}`
  await visit(detailUrl, detailReady)
  const openProof = async (control) => {
    await control.click()
    await page.getByRole('dialog', { name: '预览运输单据', exact: true }).waitFor({ state: 'visible' })
  }
  const detailControls = await page.evaluate(() =>
    ['.detail-actions .detail-operation', '.route-card--detail .driver-inline', '[aria-label$="张运输单据"]', '.route-card__nav']
      .map(selector => {
        const element = document.querySelector(selector)
        if (!element) return { selector, found: false }
        const rect = element.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return {
          selector,
          found: true,
          tag: element.tagName,
          html: element.outerHTML.slice(0, 750),
          disabled: element.hasAttribute('disabled'),
          pointerEvents: getComputedStyle(element).pointerEvents,
          hitTag: hit?.tagName,
          hitClass: hit?.className,
        }
      }),
  )
  await writeFile(join(output, 'detail-controls.json'), JSON.stringify(detailControls, null, 2))
  await step('detail-trajectory-tab', () => page.getByRole('button', { name: '轨迹定位', exact: true }).click(), { delay: 900 })
  await step('detail-tracking-tab', () => page.getByRole('button', { name: '运单跟踪', exact: true }).click())
  await step('detail-first-proof', () => openProof(page.locator(detailProof).first()))
  await visit(detailUrl, detailProof)
  await step('detail-last-proof', () => openProof(page.locator(detailProof).last()))
  await visit(detailUrl, detailReady)
  await step('detail-receipt-action', async () => {
    const receipt = page.getByRole('button', { name: '查看运输单据', exact: true })
    await openProof(await receipt.isVisible() ? receipt : page.locator(detailProof).first())
  })
  await visit(detailUrl, detailReady)
  await step('detail-expense-action', async () => {
    await page.getByRole('button', { name: '费用上报', exact: true }).click()
    await page.waitForURL(/#\/pages\/waybill\/expense/, { timeout: 10000 })
  })
  await visit('/pages/home/index', '.route-card--task .route-card__open')
  await page.locator('.route-card--task .route-card__open').click()
  await page.locator(detailReady).waitFor()
  await step('detail-back', async () => {
    await page.locator('.top-bar__icon[aria-label="返回上一页"]').click()
    await page.waitForURL(/#\/pages\/home\/index/, { timeout: 10000 })
  })
  await visit(detailUrl, detailReady)
  await step('detail-navigation', async () => {
    await page.locator('.route-card__nav button, .route-card__nav uni-button').click()
    await page.waitForFunction(() => window.__auditNavigationCount === 1)
  })
  const phonePage = await context.newPage()
  try {
    await phonePage.goto(new URL(`#${detailUrl}`, base).href, { waitUntil: 'domcontentloaded' })
    await phonePage.locator(detailReady).waitFor()
    const interceptsPhone = await phonePage.evaluate(() => {
      if (typeof window.uni?.addInterceptor !== 'function') return false
      window.__auditPhoneCalls = 0
      window.uni.addInterceptor('makePhoneCall', { invoke() { window.__auditPhoneCalls += 1; return false } })
      return true
    })
    for (const [station, count, label] of [['origin', 1, '拨打发货站电话'], ['destination', 2, '拨打到货站电话']]) {
      await step(`detail-phone-${station}${interceptsPhone ? '' : '-control'}`, async () => {
        const control = phonePage.getByRole('button', { name: label, exact: true })
        await control.waitFor({ state: 'visible' })
        const rect = await control.boundingBox()
        if (!rect || rect.width < 44 || rect.height < 44 || !(await control.isEnabled())) {
          throw new Error(`Phone control ${station} must be enabled with a 44px hit area`)
        }
        // A standalone H5 bundle may not expose the interceptor. Do not hand a tel: URL to the OS.
        if (!interceptsPhone) return
        await control.click()
        await phonePage.waitForFunction(expected => window.__auditPhoneCalls === expected, count, { timeout: 6000 })
      })
    }
  } finally {
    await phonePage.close()
  }
  }

  if (phase === 'all' || phase === 'forms') {
  for (const mode of ['loading', 'unloading']) {
    for (const kind of ['照片', '磅单']) {
      await visit(`/pages/waybill/cargo-operation?id=${encodeURIComponent(waybillId)}&type=${mode}`, '.operation-page__content')
      await step(`cargo-${mode}-preview-${kind}`, () => page.locator(`uni-button[aria-label*="${kind}"]`).first().click())
    }
  }

  for (const action of ['departure', 'completion']) {
    await visit(`/pages/waybill/execution-operation?id=${encodeURIComponent(waybillId)}&action=${action}`, '.execution-page__content')
    const dateTrigger = page.locator('#execution-time')
    const dateValue = dateTrigger.locator('.mobile-picker-trigger__value')
    const timePicker = page.getByRole('dialog', { name: (await dateTrigger.getAttribute('aria-label')) ?? '', exact: true })
    const dateBefore = await dateValue.innerText()
    await step(`execution-${action}-date-picker`, async () => {
      const dateRect = await dateTrigger.boundingBox()
      const odometerRect = await page.locator('#execution-odometer').boundingBox()
      if (!dateRect || !odometerRect || dateRect.height < 44 ||
          Math.abs(dateRect.height - odometerRect.height) > 1 || Math.abs(dateRect.x - odometerRect.x) > 1) {
        throw new Error(`Date and odometer controls do not align: ${JSON.stringify({ dateRect, odometerRect })}`)
      }
      await dateTrigger.press('Enter')
      await timePicker.waitFor()
    })
    await step(`execution-${action}-date-confirm`, async () => {
      await timePicker.getByRole('button', { name: '确定', exact: true }).click()
      await timePicker.waitFor({ state: 'hidden' })
      const dateAfter = await dateValue.innerText()
      if (dateBefore !== dateAfter) throw new Error(`Date changed without editing: ${dateBefore} -> ${dateAfter}`)
      await page.waitForFunction(() => document.activeElement?.id === 'execution-time')
    })
    await visit(`/pages/waybill/execution-operation?id=${encodeURIComponent(waybillId)}&action=${action}`, '.execution-page__content')
    await step(`execution-${action}-preview`, () => page.locator('.tms-evidence-preview').first().click())
    await visit(`/pages/waybill/execution-operation?id=${encodeURIComponent(waybillId)}&action=${action}`, '.execution-page__content')
    await step(`execution-${action}-remove`, async () => {
      const remove = page.locator('.tms-evidence-remove').first()
      await remove.click()
      await remove.waitFor({ state: 'hidden' })
    })
    await step(`execution-${action}-required-validation`, async () => {
      const submit = page.locator('.execution-footer uni-button')
      if (!(await submit.isDisabled())) throw new Error('Execution submit must stay disabled without photos')
    })
  }

  await visit(`/pages/waybill/expense?id=${encodeURIComponent(waybillId)}`, '.expense-page__content')
  await step('expense-history-proof', () => page.locator('.expense-record__proofs uni-button').first().click())
  await visit(`/pages/waybill/expense?id=${encodeURIComponent(waybillId)}`, '.expense-page__content')
  await step('expense-open-sheet', async () => {
    await page.locator('.expense-footer uni-button').click()
    await page.getByRole('dialog', { name: '新增费用上报', exact: true }).waitFor({ timeout: 10000 })
  })
  await step('expense-category-picker', () => page.getByRole('button', { name: '选择费用项目', exact: true }).click())
  await step('expense-category-confirm', async () => {
    await page.getByRole('dialog', { name: '选择费用项目', exact: true }).locator('.mobile-select__option').first().click()
    const value = await page.locator('.expense-field__picker .mobile-select__control').innerText()
    if (!value || value.includes('请选择')) throw new Error(`Expense category was not selected: ${value}`)
  })
  await visit(`/pages/waybill/expense?id=${encodeURIComponent(waybillId)}`, '.expense-page__content')
  await page.locator('.expense-footer uni-button').click()
  const expenseDate = page.locator('#expense-date')
  const expenseDateValue = expenseDate.locator('.mobile-picker-trigger__value')
  const expenseCalendar = page.getByRole('dialog', { name: '选择费用发生日期', exact: true })
  await step('expense-date-picker', () => expenseDate.press('Space'))
  await step('expense-date-confirm', async () => {
    const before = await expenseDateValue.innerText()
    await expenseCalendar.getByRole('button', { name: '确定', exact: true }).click()
    await expenseCalendar.waitFor({ state: 'hidden' })
    const after = await expenseDateValue.innerText()
    if (before !== after) throw new Error(`Unchanged calendar selection modified the date: ${before} -> ${after}`)
    await page.waitForFunction(() => document.activeElement?.id === 'expense-date')
  })
  await visit(`/pages/waybill/expense?id=${encodeURIComponent(waybillId)}`, '.expense-page__content')
  await page.locator('.expense-footer uni-button').click()
  await step('expense-payment-picker', async () => {
    await page.getByRole('button', { name: '选择支付方式', exact: true }).click()
  }, { delay: 1200 })
  await step('expense-payment-confirm', async () => {
    await page.getByRole('dialog', { name: '选择支付方式', exact: true }).locator('.mobile-select__option').first().click()
    const value = await page.locator('.expense-field__compact-picker .mobile-select__control').innerText()
    if (!value.trim() || value.includes('选填')) throw new Error(`Payment method was not selected: ${value}`)
  })
  await visit(`/pages/waybill/expense?id=${encodeURIComponent(waybillId)}`, '.expense-page__content')
  await page.locator('.expense-footer uni-button').click()
  await step('expense-sheet-close', () => page.getByRole('button', { name: '关闭费用上报', exact: true }).click())

  for (const document of ['行驶证', '运输证']) {
    await visit('/pages/vehicle/index', '.vehicle-card')
    await step(`vehicle-preview-${document}`, () => page.locator(`uni-button[aria-label="预览${document}"]`).click(), { delay: 1800 })
  }
  }

  if (phase === 'all' || phase === 'forms' || phase === 'mine') {
  await visit('/pages/mine/index', '.mine-page__content')
  await step('mine-refresh', () => page.locator('[aria-label="刷新司机档案"]').click(), { delay: 1200 })
  await step('mine-help-open', async () => {
    await page.getByRole('button', { name: '使用说明', exact: true }).click()
    await page.locator('.mine-help__panel').waitFor({ state: 'visible' })
  })
  await step('mine-help-close', () => page.locator('.mine-help__done').click())
  const regularViewport = page.viewportSize()
  await page.setViewportSize({ width: 320, height: 320 })
  await step('mine-help-short-screen', async () => {
    await page.getByRole('button', { name: '使用说明', exact: true }).click()
    const help = page.getByRole('dialog', { name: '使用说明', exact: true })
    await help.waitFor()
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))))
    const done = await help.locator('.mine-help__done').boundingBox()
    if (!done || done.y < 0 || done.y + done.height > 320) throw new Error('Help action must remain visible on a short screen')
    const body = help.locator('.mobile-sheet__body')
    await body.hover()
    await page.mouse.wheel(0, 1000)
    await page.waitForFunction(() => {
      const body = document.querySelector('[role="dialog"][aria-label="使用说明"] .mobile-sheet__body')?.getBoundingClientRect()
      const last = document.querySelector('.mine-help__steps > :last-child')?.getBoundingClientRect()
      return body && last && last.bottom <= body.bottom + 1 && last.bottom > body.top
    })
    await help.locator('.mine-help__done').click()
    await help.waitFor({ state: 'hidden' })
  })
  await page.setViewportSize(regularViewport)
  await step('mine-expenses', async () => {
      await page.getByRole('button', { name: '在途费用', exact: true }).click()
    await page.waitForURL(/index\?service=expense/)
    await page.getByRole('button', { name: /运单号 YD20261116001/ }).click()
    await page.waitForURL(/#\/pages\/waybill\/expense/, { timeout: 15000 })
  })
  await visit('/pages/mine/index', '.mine-page__content')
  await step('mine-receipts', async () => {
    await page.getByRole('button', { name: '电子回单', exact: true }).click()
    await page.waitForURL(/#\/pages\/waybill\/index\?group=completed/, { timeout: 10000 })
    await page.locator(listReady).first().waitFor({ state: 'visible', timeout: 15000 })
  })
  await visit('/pages/mine/index', '.mine-page__content')
  const contactPage = await context.newPage()
  try {
    await contactPage.goto(new URL('#/pages/mine/index', base).href, { waitUntil: 'domcontentloaded' })
    await contactPage.getByRole('button', { name: '联系车队', exact: true }).waitFor({ timeout: 15000 })
    await step('mine-contact-carrier', () => contactPage.getByRole('button', { name: '联系车队', exact: true }).click())
    await contactPage.screenshot({ path: join(output, 'mine-contact-carrier.png') })
  } finally {
    await contactPage.close()
  }
  const logoutButton = page.getByRole('button', { name: '退出登录', exact: true }).first()
  const logoutDialog = page.getByRole('alertdialog', { name: '退出登录' })
  const cancelLogout = logoutDialog.getByRole('button', { name: '取消', exact: true })
  await step('mine-logout-dialog', async () => {
    await logoutButton.focus()
    await logoutButton.press('Enter')
    await logoutDialog.waitFor({ state: 'visible' })
    const alignment = await logoutButton.evaluate(element => {
      const action = element.getBoundingClientRect()
      const label = element.firstElementChild.getBoundingClientRect()
      return Math.abs(action.x + action.width / 2 - label.x - label.width / 2)
    })
    if (alignment > 1) throw new Error('Logout row text must be centered')
  })
  await step('mine-logout-cancel', async () => {
    if (!(await cancelLogout.evaluate(element => document.activeElement === element))) throw new Error('Cancel should receive initial focus')
    await cancelLogout.click()
    await logoutDialog.waitFor({ state: 'hidden' })
  })
  await step('mine-logout-escape', async () => {
    await logoutButton.press('Enter')
    await logoutDialog.waitFor({ state: 'visible' })
    await cancelLogout.focus()
    const confirm = logoutDialog.getByRole('button', { name: '退出登录', exact: true })
    await page.keyboard.press('Shift+Tab')
    if (!(await confirm.evaluate(element => document.activeElement === element))) throw new Error('Shift+Tab must wrap to confirm')
    await page.keyboard.press('Tab')
    if (!(await cancelLogout.evaluate(element => document.activeElement === element))) throw new Error('Tab must wrap to cancel')
    await page.keyboard.press('Escape')
    await logoutDialog.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.classList.contains('mobile-row--danger'))
  })
  await step('mine-logout-confirm', async () => {
    await logoutButton.click()
    await logoutDialog.getByRole('button', { name: '退出登录', exact: true }).click()
    await page.locator('.login-form').waitFor({ state: 'visible', timeout: 10000 })
  })
  }
} finally {
  await writeFile(join(output, `${phase}-audit.json`), JSON.stringify({ results, dialogs, pageErrors }, null, 2))
  await browser.close()
  if (pageErrors.length || results.some(result => result.error || (result.layout && result.layout.documentWidth > result.layout.width))) process.exitCode = 1
}
