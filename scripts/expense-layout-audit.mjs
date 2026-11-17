import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { fixtureAccount, fixturePassword, useAuditFixture } from './audit-fixture.mjs'

const account = fixtureAccount || process.env.TMS_AUDIT_ACCOUNT || process.argv[2]
const password = fixturePassword || process.env.TMS_AUDIT_PASSWORD || process.argv[3]
const width = Number(process.env.TMS_AUDIT_WIDTH || process.argv[4] || 393)
const waybillId = process.env.TMS_AUDIT_WAYBILL_ID || '9ca1a6d0-a3f9-45fb-adea-53ffbddf3715'
const base = process.env.TMS_AUDIT_BASE || 'http://127.0.0.1:5173/'
const output = resolve(process.env.TMS_AUDIT_OUTPUT || 'artifacts/visual-audit')

if (!account || !password) throw new Error('Provide account and password as arguments or environment variables.')
await mkdir(output, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width, height: 852 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  reducedMotion: 'reduce',
})
await useAuditFixture(context, base)
const page = await context.newPage()
try {
  await page.goto(new URL('#/pages/login/index', base).href)
  await page.locator('input').nth(0).fill(account)
  await page.locator('input').nth(1).fill(password)
  await page.locator('.login-form__button').click()
  await page.waitForURL(/#\/pages\/home\/index/, { timeout: 20000 })
  await page.goto(new URL(`#/pages/waybill/expense?id=${encodeURIComponent(waybillId)}&create=1`, base).href)
  await page.getByRole('dialog', { name: '新增费用上报', exact: true }).locator('.expense-field__input-grid').waitFor({ timeout: 20000 })
  await page.locator('.expense-field__picker').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  const topScreenshot = resolve(output, `${width}-expense-controls.png`)
  await page.screenshot({ path: topScreenshot })
  const selectorMeasurements = await page.locator('.expense-field__picker .mobile-select__control, #expense-date').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect()
    const arrow = element.querySelector('.mobile-select__chevron, .mobile-picker-trigger__chevron')?.getBoundingClientRect()
    return {
      className: element.className,
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      arrowRightInset: arrow ? rect.right - arrow.right : null,
      arrowCenterOffset: arrow ? Math.abs(rect.y + rect.height / 2 - (arrow.y + arrow.height / 2)) : null,
    }
  }))
  const dateTrigger = page.locator('#expense-date')
  const dateValue = dateTrigger.locator('.mobile-picker-trigger__value')
  const dateBefore = await dateValue.innerText()
  const amount = await page.locator('#expense-amount').boundingBox()
  const date = await dateTrigger.boundingBox()
  const dateAndAmountAlign = amount && date && date.height >= 44 &&
    Math.abs(date.height - amount.height) <= 1 && Math.abs(date.y - amount.y) <= 1
  await dateTrigger.press('Space')
  const calendar = page.getByRole('dialog', { name: '选择费用发生日期', exact: true })
  const confirmDate = calendar.getByRole('button', { name: '确定', exact: true })
  await calendar.waitFor()
  await page.waitForFunction(() =>
    document.activeElement?.closest('[role="dialog"][aria-label="选择费用发生日期"]'))
  await page.waitForFunction(() => {
    const popup = document.querySelector('[role="dialog"][aria-label="选择费用发生日期"]')?.closest('.wd-popup')
    return popup && Math.abs(popup.getBoundingClientRect().bottom - window.innerHeight) <= 1
  })
  const bounds = await calendar.boundingBox()
  const calendarWidth = await calendar.evaluate(panel => {
    const popup = panel.closest('.wd-popup') ?? panel
    return { className: popup.className, rootClassName: panel.className, maxWidth: getComputedStyle(popup).maxWidth }
  })
  const calendarTargets = await calendar.getByRole('button', { name: /^(关闭日期选择|上一年|上个月|下个月|下一年)$/ }).evaluateAll(elements =>
    elements.map(element => {
      const { width, height } = element.getBoundingClientRect()
      return { name: element.getAttribute('aria-label'), width, height }
    }))
  const calendarFitsWorkspace = bounds && bounds.width <= 561 &&
    Math.abs(bounds.x - (width - bounds.width) / 2) <= 1
  const datePickerScreenshot = resolve(output, `${width}-expense-date-picker-settled.png`)
  await page.screenshot({ path: datePickerScreenshot })
  await page.keyboard.press('Escape')
  await calendar.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.id === 'expense-date')
  await dateTrigger.press('Enter')
  await confirmDate.click()
  await calendar.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.id === 'expense-date')
  const dateAfter = await dateValue.innerText()
  const otherDay = dateBefore.endsWith('-15') ? '16' : '15'
  const expectedDate = dateBefore.replace(/\d{2}$/, otherDay)
  const [year, month, dayOfMonth] = expectedDate.split('-').map(Number)
  const dayName = `${year}年${month}月${dayOfMonth}日`
  await dateTrigger.press('Enter')
  await calendar.getByRole('button', { name: dayName, exact: true }).click()
  await calendar.getByRole('button', { name: dayName, exact: true, pressed: true }).waitFor()
  await confirmDate.click()
  await calendar.waitFor({ state: 'hidden' })
  await page.waitForFunction(value =>
    document.querySelector('#expense-date .mobile-picker-trigger__value')?.textContent?.trim() === value, expectedDate)
  await page.locator('.expense-field__input-grid').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  const screenshot = resolve(output, `${width}-expense-supplemental.png`)
  await page.screenshot({ path: screenshot })
  const measurements = await page.locator('.expense-field__input-grid .mobile-field__control, .expense-field__input-grid .mobile-select__control, #expense-location').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      tag: element.tagName,
      className: typeof element.className === 'string' ? element.className : '',
      text: (element.textContent || '').trim().slice(0, 45),
      x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right,
      padding: style.padding,
      background: style.backgroundColor,
      boxSizing: style.boxSizing,
      display: style.display,
    }
  }))
  const formControlHeights = measurements.map(item => item.height)
  const heightDelta = Math.max(...formControlHeights) - Math.min(...formControlHeights)
  const arrowsRightAligned = selectorMeasurements.every(item => item.arrowRightInset !== null && item.arrowRightInset <= 18 && item.arrowCenterOffset !== null && item.arrowCenterOffset <= 2)
  const report = { screenshot, topScreenshot, datePickerScreenshot, dateBefore, dateAfter, changedDate: expectedDate, heightDelta, arrowsRightAligned, dateAndAmountAlign, calendarFitsWorkspace, bounds, calendarWidth, calendarTargets, selectorMeasurements, measurements }
  await writeFile(resolve(output, `${width}-expense-supplemental.json`), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, measurements: undefined }, null, 2))
  if (heightDelta > 1 || !arrowsRightAligned || !dateAndAmountAlign || !calendarFitsWorkspace || dateBefore !== dateAfter ||
      calendarTargets.length !== 5 || calendarTargets.some(target => target.width < 44 || target.height < 44)) process.exitCode = 1
} finally {
  await browser.close()
}
