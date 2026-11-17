import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { fixtureAccount, fixturePassword, useAuditFixture } from './audit-fixture.mjs'

const account = fixtureAccount || process.env.TMS_AUDIT_ACCOUNT || process.argv[2]
const password = fixturePassword || process.env.TMS_AUDIT_PASSWORD || process.argv[3]
const width = Number(process.env.TMS_AUDIT_WIDTH || process.argv[5] || 393)
const height = Number(process.env.TMS_AUDIT_HEIGHT || 852)
const requestedWaybillId = process.env.TMS_AUDIT_WAYBILL_ID || ''
const output = resolve(process.env.TMS_AUDIT_OUTPUT || 'artifacts/visual-audit')
const base = process.env.TMS_AUDIT_BASE || 'http://127.0.0.1:5173/'
const only = process.env.TMS_AUDIT_ONLY || process.argv[4]
const auditAlignment = process.env.TMS_AUDIT_ALIGNMENT === '1'
const selectedPages = new Set(only?.split(',') || [])
const wantsPage = name => !only || only === 'all' || selectedPages.has(name)
const waybillPages = ['detail', 'cargo-loading', 'cargo-unloading', 'execution-departure', 'execution-completion', 'expense', 'expense-edit', 'weighbridge']

if (!account || !password) {
  throw new Error('Set TMS_AUDIT_ACCOUNT and TMS_AUDIT_PASSWORD before running the visual audit.')
}

await mkdir(output, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'light',
  reducedMotion: 'reduce',
})
await useAuditFixture(context, base)
const page = await context.newPage()
const errors = []
const results = []
const dictionaryResponses = []
const accessibleWaybills = new Map()
const activeRequests = new Map()
const readySelectors = {
  login: '.login-form .login-form__button',
  home: '.task-card__button, .mobile-empty, .driver-error',
  waybill: '.route-card--list .route-card__open, .mobile-empty',
  detail: '.route-card--detail',
  'cargo-loading': '.operation-page__content',
  'cargo-unloading': '.operation-page__content',
  'execution-departure': '.execution-page__content',
  'execution-completion': '.execution-page__content',
  expense: '.expense-page__content',
  'expense-edit': '.expense-record__retry',
  weighbridge: '.weighbridge-section__head',
  certification: '.certification-head',
  vehicle: '.vehicle-card, .mobile-empty',
  mine: '.mine-page__content',
  settings: '.settings-page__content',
}

page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }))
page.on('request', request => activeRequests.set(request, Date.now()))
page.on('requestfinished', request => activeRequests.delete(request))
page.on('requestfailed', request => activeRequests.delete(request))
page.on('console', message => {
  if (message.type() === 'error') errors.push({ type: 'console', message: message.text(), location: message.location() })
})
page.on('response', async response => {
  if (response.status() >= 400) {
    errors.push({ type: 'http', status: response.status(), url: response.url() })
  }
  const pathname = new URL(response.url()).pathname
  if (pathname.endsWith('/rpc/tms_list_driver_mobile_waybills') && response.ok()) {
    const rows = await response.json().catch(() => [])
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (typeof row?.id === 'string') accessibleWaybills.set(row.id, row)
      }
    }
  }
  if (!/\/(sys_dict_type|sys_dictionary)$/.test(pathname)) return
  const data = await response.json().catch(() => null)
  dictionaryResponses.push({
    table: pathname.split('/').pop(),
    status: response.status(),
    count: Array.isArray(data) ? data.length : null,
  })
})

async function capture(name, path) {
  if (path) {
    await page.goto(new URL(`#${path}`, base).href, { waitUntil: 'domcontentloaded' })
    await page.reload({ waitUntil: 'domcontentloaded' })
  }
  if (readySelectors[name]) {
    await page.waitForSelector(readySelectors[name], { timeout: 20000 }).catch(() => {
      errors.push({
        type: 'readiness',
        page: name,
        message: 'Page content did not become ready within 20 seconds',
        pending: [...activeRequests.keys()].map(request => new URL(request.url()).pathname)
      })
    })
  }
  if (name === 'expense-edit') {
    await page.getByRole('button', { name: '修改并重新提交', exact: true }).click()
    await page.getByRole('dialog', { name: '修改费用上报' }).waitFor()
  }
  await page.waitForTimeout(350)
  await page.evaluate(() => document.fonts?.ready)

  const topImage = join(output, `${width}-${name}-top.png`)
  await page.screenshot({ path: topImage })

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    scrollAreas: Array.from(document.querySelectorAll('*'))
      .filter(element => element.scrollHeight > element.clientHeight + 40 && element.clientHeight > 120)
      .slice(0, 8)
      .map(element => ({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === 'string' ? element.className.slice(0, 120) : '',
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      })),
  }))
  const buttons = await page.locator('uni-button, button, [role="button"]').evaluateAll(elements =>
    elements.map(element => ({
      text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70),
      label: element.getAttribute('aria-label') || '',
      disabled: element.hasAttribute('disabled'),
    })),
  )
  const evidence = await page.locator('.tms-evidence-preview, .tms-evidence-remove').evaluateAll(elements =>
    elements.map(element => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const parent = element.parentElement?.getBoundingClientRect()
      return {
        tag: element.tagName.toLowerCase(),
        className: element.className,
        position: style.position,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        parentTop: parent?.top,
        parentRight: parent?.right,
        background: style.backgroundImage,
      }
    }),
  )
  const alignment = auditAlignment ? await page.evaluate(() => {
    const pairs = [
      ['bottom navigation', '.bottom-nav__item', '.bottom-nav__icon-box', '.bottom-nav__label', 'column'],
      ['list action', '.driver-inline, .task-card__button, .detail-operation, .mobile-inline-pair:not(.mobile-inline-pair--start), .expense-footer .mobile-dock__action',
        '.mobile-icon', 'uni-text:not(.mobile-icon)', 'row'],
      ['grouped list', '.mobile-row', '.mobile-row__icon', '.mobile-row__body', 'row'],
      ['status tag', '.status-tag', '.status-tag__dot', '.status-tag__label', 'row'],
      ['stop tag', '.route-summary__stop, .route-summary__next-stop', '.route-summary__stop-label', '.route-summary__address, .route-summary__next-address', 'first line'],
      ['timeline dot', '.tracking-item', '.tracking-item__dot', '.tracking-item__title', 'first line'],
      ['picker', '.mobile-picker-trigger, .mobile-select__control', '.mobile-icon', 'uni-text:not(.mobile-icon)', 'row'],
      ['sheet title', '.mobile-sheet__header, .mine-help__panel .driver-heading',
        '.mobile-icon', '[role="heading"]', 'row'],
      ['notice', '.record-time-notice, .tracking-card__warning, .execution-callout, .expense-record__review, .expense-sheet__reject-note',
        '.mobile-icon', 'uni-text:not(.mobile-icon)', 'first line'],
    ]
    return pairs.flatMap(([kind, scope, icon, label, direction]) =>
      Array.from(document.querySelectorAll(scope)).flatMap(element => {
        const iconElement = element.querySelector(icon)
        const labelElement = Array.from(element.querySelectorAll(label)).find(candidate =>
          candidate !== iconElement && !candidate.closest('.mobile-icon'))
        const rawLabel = !labelElement && Array.from(element.childNodes).find(node =>
          node.nodeType === Node.TEXT_NODE && node.textContent.trim())
        if (!iconElement || (!labelElement && !rawLabel) || element.closest('[hidden]')) return []
        const hit = element.getBoundingClientRect()
        const box = iconElement.getBoundingClientRect()
        const range = rawLabel ? document.createRange() : undefined
        if (range) range.selectNodeContents(rawLabel)
        const text = labelElement?.getBoundingClientRect() ?? range.getBoundingClientRect()
        if (!hit.width || !hit.height || !box.width || !text.width) return []
        const lineHeight = parseFloat(getComputedStyle(labelElement ?? element).lineHeight) || text.height
        const offset = direction === 'column'
          ? (box.left + box.width / 2) - (text.left + text.width / 2)
          : (box.top + box.height / 2) - (text.top + (direction === 'first line' ? lineHeight : text.height) / 2)
        return [{
          kind, className: element.className, text: (labelElement ?? rawLabel).textContent.trim(),
          centerOffset: Math.round(offset * 100) / 100,
          labelFontSize: getComputedStyle(labelElement ?? element).fontSize,
          labelLineHeight: getComputedStyle(labelElement ?? element).lineHeight,
          width: Math.round(hit.width * 100) / 100,
          height: Math.round(hit.height * 100) / 100,
        }]
      }),
    )
  }) : undefined
  const touchTargets = auditAlignment ? await page.locator(
    '.bottom-nav__item, .waybill-refresh, .top-bar__icon, .mine-icon-button, .mobile-sheet__close, .route-card__nav',
  ).evaluateAll(elements => elements.flatMap(element => {
    const { width, height } = element.getBoundingClientRect()
    return width && height ? [{
      className: element.className, label: element.getAttribute('aria-label'),
      width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100,
    }] : []
  })) : undefined

  await page.mouse.move(Math.round(width / 2), Math.round(height * 0.65))
  await page.mouse.wheel(0, 1800)
  await page.waitForTimeout(300)
  const bottomImage = join(output, `${width}-${name}-bottom.png`)
  await page.screenshot({ path: bottomImage })

  let settledImage
  let settledVehicleLabels
  if (name === 'vehicle') {
    await page.waitForTimeout(5000)
    settledImage = join(output, `${width}-${name}-settled.png`)
    await page.screenshot({ path: settledImage })
    settledVehicleLabels = await page.locator('.vehicle-specs .mobile-row').allTextContents()
  }

  results.push({ name, url: page.url(), layout, buttons, evidence, alignment, touchTargets, topImage, bottomImage, settledImage, settledVehicleLabels })
  console.log(`${name}: ${layout.documentWidth}/${layout.viewportWidth}px, ${buttons.length} buttons`)
}

try {
  await page.goto(new URL('#/pages/login/index', base).href, { waitUntil: 'domcontentloaded' })
  await capture('login')
  await page.locator('input').nth(0).fill(account)
  await page.locator('input').nth(1).fill(password)
  await page.locator('.login-form__button').click()
  await page.waitForURL(/#\/pages\/home\/index/, { timeout: 20000 })

  const mainRoutes = [
    ['home', '/pages/home/index'],
    ['waybill', '/pages/waybill/index'],
  ]
  const needsWaybill = !requestedWaybillId && waybillPages.some(wantsPage)

  for (const [name, path] of mainRoutes) {
    if (wantsPage(name) || (name === 'waybill' && needsWaybill)) await capture(name, path)
  }

  const waybillId = requestedWaybillId ||
    [...accessibleWaybills.values()].find(item => ['accepted', 'loading', 'transporting', 'unloading', 'signed'].includes(item.status))?.id ||
    accessibleWaybills.keys().next().value
  const routes = [
    ['detail', `/pages/waybill/detail?id=${encodeURIComponent(waybillId)}`],
    ['cargo-loading', `/pages/waybill/cargo-operation?id=${encodeURIComponent(waybillId)}&type=loading`],
    ['cargo-unloading', `/pages/waybill/cargo-operation?id=${encodeURIComponent(waybillId)}&type=unloading`],
    ['execution-departure', `/pages/waybill/execution-operation?id=${encodeURIComponent(waybillId)}&action=departure`],
    ['execution-completion', `/pages/waybill/execution-operation?id=${encodeURIComponent(waybillId)}&action=completion`],
    ['expense', `/pages/waybill/expense?id=${encodeURIComponent(waybillId)}`],
    ['expense-edit', `/pages/waybill/expense?id=${encodeURIComponent(waybillId)}`],
    ['weighbridge', `/pages/waybill/weighbridge?id=${encodeURIComponent(waybillId)}`],
    ['certification', '/pages/mine/certification'],
    ['vehicle', '/pages/vehicle/index'],
    ['mine', '/pages/mine/index'],
    ['settings', '/pages/settings/index'],
  ]

  for (const [name, path] of routes) {
    if (name === 'expense-edit' && !selectedPages.has(name)) continue
    if (wantsPage(name)) {
      if (!waybillId && waybillPages.includes(name)) {
        errors.push({ type: 'readiness', page: name, message: 'No accessible waybill for visual audit' })
        continue
      }
      await capture(name, path)
    }
  }
} finally {
  const alignmentFailures = auditAlignment ? results.flatMap(({ name, alignment }) =>
    alignment.filter(item => (
      item.kind === 'stop tag' || item.kind === 'timeline dot' ||
      item.kind === 'notice' && item.className.includes('mobile-inline-pair--start') ||
      item.kind === 'list action' && item.text === '费用上报'
    ) && Math.abs(item.centerOffset) > 1).map(item => ({ page: name, ...item }))) : []
  await writeFile(join(output, `${width}-audit.json`), JSON.stringify({ results, errors, dictionaryResponses, alignmentFailures }, null, 2))
  await browser.close()
  if (errors.length || alignmentFailures.length ||
    results.some(result => result.layout.documentWidth > result.layout.viewportWidth)) process.exitCode = 1
}
