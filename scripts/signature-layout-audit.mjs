import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { fixtureAccount, fixturePassword, useAuditFixture } from './audit-fixture.mjs'

const account = fixtureAccount || process.env.TMS_AUDIT_ACCOUNT || process.argv[2]
const password = fixturePassword || process.env.TMS_AUDIT_PASSWORD || process.argv[3]
const width = Number(process.env.TMS_AUDIT_WIDTH || process.argv[4] || 393)
if (!account || !password) throw new Error('Provide account and password as arguments or environment variables.')

const base = process.env.TMS_AUDIT_BASE || 'http://127.0.0.1:5173/'
const output = resolve(process.env.TMS_AUDIT_OUTPUT || 'artifacts/visual-audit')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width, height: 852 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
await useAuditFixture(context, base)
const page = await context.newPage()
try {
  await page.goto(new URL('#/pages/login/index', base).href)
  await page.locator('input').nth(0).fill(account)
  await page.locator('input').nth(1).fill(password)
  await page.locator('.login-form__button').click()
  await page.waitForURL(/#\/pages\/home\/index/, { timeout: 20000, waitUntil: 'domcontentloaded' })
  console.log('signed in')
  const waybillId = process.env.TMS_AUDIT_WAYBILL_ID || '9ca1a6d0-a3f9-45fb-adea-53ffbddf3715'
  await page.goto(new URL(`#/pages/waybill/detail?id=${encodeURIComponent(waybillId)}`, base).href, { waitUntil: 'domcontentloaded' })
  await page.locator('.route-card--detail').waitFor({ timeout: 20000 })
  console.log('detail ready')
  const sign = page.getByRole('button', { name: '办理签收', exact: true })
  if (await sign.isVisible()) await sign.click()
  else {
    const opened = await page.evaluate(() => {
      const current = getCurrentPages().at(-1)
      const vm = current?.$vm
      const state = vm?.$?.setupState
      if (vm && 'signatureVisible' in vm) vm.signatureVisible = true
      else if (state && 'signatureVisible' in state) state.signatureVisible = true
      else return false
      return true
    })
    if (!opened) throw new Error('Use a waybill that is ready for signature to audit this sheet.')
  }
  console.log('sheet opened')
  const dateControl = page.getByRole('button', { name: '选择签收时间', exact: true }).first()
  await dateControl.waitFor({ timeout: 20000 })
  await dateControl.scrollIntoViewIfNeeded()
  await page.waitForTimeout(350)
  const screenshot = resolve(output, `${width}-signature-fields.png`)
  await page.screenshot({ path: screenshot })
  const measurements = await dateControl.evaluate(element => {
    const label = element.closest('.mobile-field')?.querySelector('.mobile-field__label')?.getBoundingClientRect()
    const control = element.getBoundingClientRect()
    const signer = document.getElementById('signature-signer')
    const nextLabel = signer?.closest('.mobile-field')?.querySelector('.mobile-field__label')?.getBoundingClientRect()
    const nextControl = signer?.getBoundingClientRect()
    const arrow = element.querySelector('.mobile-icon')?.getBoundingClientRect()
    const notice = document.querySelector('.record-time-notice__copy')
    const noticeText = notice?.getBoundingClientRect()
    const noticeIcon = notice?.parentElement?.querySelector('.mobile-icon')?.getBoundingClientRect()
    const noticeLineHeight = notice ? parseFloat(getComputedStyle(notice).lineHeight) : 0
    const close = element.closest('[role="dialog"]')?.querySelector('[aria-label="关闭签收确认"]')?.getBoundingClientRect()
    return {
      dateGap: label && control ? control.top - label.bottom : null,
      signerGap: nextLabel && nextControl ? nextControl.top - nextLabel.bottom : null,
      dateHeight: control?.height,
      signerHeight: nextControl?.height,
      dateArrowRightInset: arrow ? control.right - arrow.right : null,
      noticeIconOffset: noticeIcon && noticeText
        ? Math.abs(noticeIcon.top + noticeIcon.height / 2 - (noticeText.top + noticeLineHeight / 2))
        : null,
      closeTargetSize: close ? Math.min(close.width, close.height) : 0,
    }
  })
  const displayedDate = dateControl.locator('.mobile-picker-trigger__value')
  const dateBefore = await displayedDate.innerText()
  await dateControl.click()
  console.log('date picker opened')
  const timePicker = page.getByRole('dialog', { name: '选择签收时间', exact: true })
  const confirmTime = timePicker.getByRole('button', { name: '确定', exact: true })
  await timePicker.locator('.datetime-sheet__time-field .wd-input').first().waitFor({ timeout: 10000 })
  await page.waitForTimeout(200)
  const pickerScreenshot = resolve(output, `${width}-signature-date-picker.png`)
  await page.screenshot({ path: pickerScreenshot })
  await confirmTime.click()
  await timePicker.waitFor({ state: 'hidden' })
  const dateAfter = await displayedDate.innerText()
  await dateControl.click()
  await page.waitForFunction(() => document.activeElement?.closest('[role="dialog"][aria-label="选择签收时间"]'))
  const nestedTrigger = page.locator('.datetime-sheet__date')
  await nestedTrigger.press('Space')
  await page.waitForFunction(() =>
    document.querySelector('.datetime-sheet__date')?.getAttribute('aria-expanded') === 'true')
  const calendar = page.getByRole('dialog', { name: '选择日期', exact: true })
  await calendar.waitFor()
  await page.keyboard.press('Escape')
  await calendar.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.classList.contains('datetime-sheet__date'))
  await nestedTrigger.press('Enter')
  await calendar.getByRole('button', { name: '确定', exact: true }).click()
  await calendar.waitFor({ state: 'hidden' })
  await page.locator('.datetime-sheet__time-field input').first().fill('19')
  await page.locator('.datetime-sheet__time-field input').last().fill('35')
  await confirmTime.click()
  await timePicker.waitFor({ state: 'hidden' })
  const editedDate = await displayedDate.innerText()
  await dateControl.click()
  await timePicker.getByRole('button', { name: '取消', exact: true }).click()
  await timePicker.waitFor({ state: 'hidden' })
  const afterCancel = await displayedDate.innerText()
  const report = { screenshot, pickerScreenshot, dateBefore, dateAfter, editedDate, afterCancel, measurements, url: page.url() }
  await writeFile(resolve(output, `${width}-signature-fields.json`), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (measurements.dateGap === null || measurements.signerGap === null ||
      Math.abs(measurements.dateGap - measurements.signerGap) > 1 ||
      Math.abs(measurements.dateHeight - measurements.signerHeight) > 1 ||
      measurements.noticeIconOffset === null || measurements.noticeIconOffset > 1 || measurements.closeTargetSize < 44 ||
      dateBefore !== dateAfter || !editedDate.endsWith('19:35') || editedDate !== afterCancel) {
    process.exitCode = 1
  }
} finally {
  await browser.close()
}
