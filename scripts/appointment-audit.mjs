import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { fixtureAccount, fixturePassword, fixtureMode, useAuditFixture } from './audit-fixture.mjs'

if (!fixtureMode) throw new Error('Run with TMS_AUDIT_FIXTURE=1. Appointment submissions are always mocked.')

const base = process.env.TMS_AUDIT_BASE || 'http://127.0.0.1:5191/'
const origin = new URL(base).origin
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true })
const page = await context.newPage()
const button = name => page.getByRole('button', { name, exact: true })
const text = content => page.getByText(content, { exact: true })
const future = new Date(Date.now() + 3_600_000).toISOString()
const first = { id: '9ca1a6d0-a3f9-45fb-adea-53ffbddf3715', waybillNo: 'YD20261116001', plateNo: '鄂A90836', station: '武汉东西湖综合物流中心东门入场通道' }
const second = { id: '92a00000-0000-4000-8000-000000000004', waybillNo: 'YD20261116004', plateNo: '鄂A90836', station: '杭州' }
let requestPayload
let rejectOnce = true
let deliveryAvailable = false
let deliveryUnavailable = false
let holdDelivery
let records = [{ id: 'old', appointmentNo: 'YY20261116001', waybillId: 'past', waybillNo: 'YD20261115001', scheduledAt: future, status: 'confirmed', dockName: '东侧 B-17 月台', arrivedAt: null, remark: null }]
const deliveryRecords = []
const appendOffsets = []
let exerciseMore = true
let holdFirstAppend

await useAuditFixture(context, base)
await context.route(/\/rest\/v1\/rpc\/tms_(get|submit)_driver_mobile_appointment(_context)?$/, async route => {
  const request = route.request()
  const headers = {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'apikey, authorization, content-type',
    'access-control-allow-methods': 'POST, OPTIONS'
  }
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  const data = request.postDataJSON()
  if (request.url().endsWith('_context')) {
    if (data.p_kind === 'delivery' && holdDelivery) {
      const pending = holdDelivery
      holdDelivery = undefined
      await pending
    }
    if (data.p_kind === 'delivery' && deliveryUnavailable) {
      return route.fulfill({ status: 404, headers, json: { code: 'PGRST202', message: 'Could not find the function in the schema cache' } })
    }
    if (data.p_kind === 'pickup' && data.p_offset > 0) {
      appendOffsets.push(data.p_offset)
      if (holdFirstAppend) {
        await holdFirstAppend
        holdFirstAppend = undefined
        return route.fulfill({ status: 503, headers, json: { message: '网络请求失败' } })
      }
      exerciseMore = false
      return route.fulfill({ headers, json: {
        records: [{ ...records[0], id: 'older', appointmentNo: 'YY20261115002', dockName: null }],
        eligibleWaybills: [first, second], hasMore: false
      } })
    }
    return route.fulfill({
      headers,
      json: data.p_kind === 'delivery'
        ? { records: deliveryRecords, eligibleWaybills: deliveryAvailable && !deliveryRecords.length ? [second] : [], hasMore: false }
        : { records, eligibleWaybills: records.some(record => record.id === 'new') ? [second] : [first, second], hasMore: exerciseMore }
    })
  }
  requestPayload = data
  if (rejectOnce) {
    rejectOnce = false
    return route.fulfill({ status: 400, headers, json: { code: '23514', message: '预约资料已变化，请重新核对运单。' } })
  }
  const waybill = data.p_kind === 'delivery' ? second : first
  const record = {
    id: 'new', appointmentNo: 'YY20261116002', waybillId: waybill.id, waybillNo: waybill.waybillNo,
    scheduledAt: data.p_scheduled_at, status: 'confirming', dockName: null, arrivedAt: null, remark: data.p_remark
  }
  if (data.p_kind === 'delivery') deliveryRecords.push(record)
  else records = [record, ...records]
  return route.fulfill({ headers, json: '92a00000-0000-4000-8000-000000000005' })
})

const errors = []
page.on('pageerror', error => errors.push(error.message))
await mkdir('artifacts/appointment-audit', { recursive: true })
async function setAppointmentTime() {
  await button('选择预计入场时间').click()
  const date = page.getByRole('dialog', { name: '选择预计入场时间', exact: true })
  await date.getByText('确定', { exact: true }).click()
  await date.waitFor({ state: 'hidden' })
  assert.match(await button('选择预计入场时间').getAttribute('aria-description') ?? '', /^当前选中时间：\d{4}-/)
}
try {
  await page.goto(base)
  await page.locator('.login-form input').first().fill(fixtureAccount)
  await page.locator('.login-form input').nth(1).fill(fixturePassword)
  await page.locator('.login-form__button').click()
  await page.waitForURL(/#\/pages\/home\/index/)
  await page.getByRole('link', { name: '我的', exact: true }).click()
  await button('提货预约').click()
  await text('月台 东侧 B-17 月台').waitFor()
  const loadMore = button('加载更多')
  assert.ok((await loadMore.boundingBox()).height >= 44)
  await page.screenshot({ path: 'artifacts/appointment-audit/pickup-list-320.png' })
  let releaseAppend
  holdFirstAppend = new Promise(resolve => { releaseAppend = resolve })
  await loadMore.click()
  await text('正在加载更多…').waitFor()
  await text('YY20261116001').waitFor()
  await page.screenshot({ path: 'artifacts/appointment-audit/pickup-loading-more-320.png' })
  releaseAppend()
  await text('无法加载更多预约记录').waitFor()
  const footerError = page.locator('.mobile-load-error')
  const retry = footerError.getByRole('button', { name: '重试', exact: true })
  const retryTarget = await retry.boundingBox()
  assert.ok(retryTarget.width >= 44 && retryTarget.height >= 44, `Append retry target must be at least 44×44px: ${JSON.stringify(retryTarget)}`)
  console.log(`Append retry target: ${retryTarget.width}×${retryTarget.height}px`)
  await page.screenshot({ path: 'artifacts/appointment-audit/pickup-append-error-320.png' })
  await retry.click()
  await text('YY20261115002').waitFor()
  await text('YY20261116001').waitFor()
  assert.deepEqual(appendOffsets, [1, 1], 'Retry keeps the existing appointments and uses the failed offset again')
  assert.equal(await loadMore.count(), 0)
  await button('申请入场').click()
  await button('提交入场申请').press('Enter')
  await text('请选择预约运单。').waitFor()
  await page.waitForFunction(() => document.activeElement?.id === 'appointment-waybill')
  await button('预约运单').press('Enter')
  const chooser = page.getByRole('dialog', { name: '预约运单', exact: true })
  await chooser.getByRole('button', { name: `${first.waybillNo} · ${first.station}` }).click()
  await chooser.waitFor({ state: 'hidden' })
  await button('提交入场申请').press('Enter')
  await text('请选择预计入场时间。').waitFor()
  await page.waitForFunction(() => document.activeElement?.id === 'appointment-time')
  await setAppointmentTime()
  const remark = page.locator('#appointment-remark textarea')
  await remark.fill('先在东门登记。')
  await remark.blur()
  await page.getByRole('heading', { name: '车辆入场申请', level: 1 }).scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: 'artifacts/appointment-audit/pickup-form-320.png', fullPage: true, animations: 'disabled' })
  await button('提交入场申请').click()
  await text('预约资料已变化，请重新核对运单。').waitFor()
  assert.equal(await remark.inputValue(), '先在东门登记。')
  await button('提交入场申请').click()
  await text('待确认').waitFor()
  await text('YY20261116002').waitFor()
  await text('申请已提交，等待调度确认').waitFor({ state: 'hidden' })
  assert.deepEqual(Object.keys(requestPayload).sort(), ['p_kind', 'p_remark', 'p_scheduled_at', 'p_waybill_id'])
  assert.equal(requestPayload.p_kind, 'pickup')
  assert.equal(requestPayload.p_waybill_id, first.id)
  assert.equal(requestPayload.p_remark, '先在东门登记。')
  await button('返回上一页').click()
  await button('送货预约').click()
  await text('暂无预约记录').waitFor()
  assert.equal(await button('申请入场').count(), 0)
  await page.screenshot({ path: 'artifacts/appointment-audit/delivery-empty-320.png' })
  await button('返回上一页').click()
  deliveryAvailable = true
  await button('送货预约').click()
  await button('申请入场').click()
  await text(second.waybillNo).waitFor()
  await setAppointmentTime()
  await button('提交入场申请').click()
  await text('待确认').waitFor()
  assert.equal(requestPayload.p_kind, 'delivery')
  assert.equal(requestPayload.p_waybill_id, second.id)
  await button('返回上一页').click()
  deliveryUnavailable = true
  await button('送货预约').click()
  await text('司机预约服务尚未开通，请联系调度办理。').waitFor()
  assert.equal(await button('申请入场').count(), 0)
  await button('返回上一页').click()
  deliveryUnavailable = false
  await button('送货预约').click()
  await text(`运单 ${second.waybillNo}`).waitFor()

  const pickupUrl = new URL('#/pages/appointment/index?kind=pickup', base).href
  const deliveryUrl = new URL('#/pages/appointment/index?kind=delivery', base).href
  await page.goto(pickupUrl)
  await page.getByRole('heading', { name: '提货预约', level: 1 }).waitFor()
  await text(`运单 ${first.waybillNo}`).waitFor()
  assert.equal(await text(`运单 ${second.waybillNo}`).count(), 0)

  let releaseDelivery
  holdDelivery = new Promise(resolve => { releaseDelivery = resolve })
  const isDeliveryContext = request => request.method() === 'POST'
    && request.url().endsWith('/rpc/tms_get_driver_mobile_appointment_context')
    && request.postDataJSON().p_kind === 'delivery'
  const deliverySent = page.waitForRequest(isDeliveryContext, { timeout: 8_000 })
  await page.goto(deliveryUrl)
  await deliverySent
  await page.getByRole('heading', { name: '送货预约', level: 1 }).waitFor()
  assert.equal(await text(`运单 ${first.waybillNo}`).count(), 0)
  await page.goto(pickupUrl)
  await text(`运单 ${first.waybillNo}`).waitFor()
  const deliveryReceived = page.waitForResponse(response => isDeliveryContext(response.request()), { timeout: 8_000 })
  releaseDelivery()
  await deliveryReceived
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await text(`运单 ${second.waybillNo}`).count(), 0)

  const pickupFormUrl = new URL(`#/pages/appointment/apply?kind=pickup&id=${second.id}`, base).href
  const deliveryFormUrl = new URL(`#/pages/appointment/apply?kind=delivery&id=${second.id}`, base).href
  await page.goto(pickupFormUrl)
  await text(second.waybillNo).waitFor()
  await remark.fill('提货备注不会遗留到送货表单。')
  await remark.blur()
  await page.goto(deliveryFormUrl)
  await text('当前没有可申请的运单').waitFor()
  assert.equal(await remark.count(), 0)
  await page.goto(pickupFormUrl)
  await text(second.waybillNo).waitFor()
  assert.equal(await remark.inputValue(), '')
  assert.deepEqual(errors, [])
  console.log('PASS appointment fixture: mine links, 320px list/form, append failure with same-offset retry, field focus, failed submit recovery, pickup and delivery confirmation, empty and missing-backend states, live route query changes, and stale response rejection.')
} catch (error) {
  await page.screenshot({ path: 'artifacts/appointment-audit/failure.png' }).catch(() => undefined)
  throw error
} finally {
  await browser.close()
}
