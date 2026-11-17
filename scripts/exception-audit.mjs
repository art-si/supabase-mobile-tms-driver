import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

process.env.TMS_AUDIT_FIXTURE = '1'
const { fixtureAccount, fixturePassword, useAuditFixture } = await import('./audit-fixture.mjs')
const base = process.env.TMS_SMOKE_URL || 'http://localhost:5190/'
const output = 'artifacts/exception-audit'
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
const origin = new URL(base).origin
const requests = []
let unavailable = false
await useAuditFixture(context, base)
await context.route(/\/rest\/v1\/rpc\/tms_(get|submit)_driver_mobile_exception/, async route => {
  const request = route.request()
  const headers = {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'authorization, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS'
  }
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  if (request.url().endsWith('_workspace')) {
    if (unavailable) return route.fulfill({ status: 404, headers, json: { code: 'PGRST202', message: 'Function not found in schema cache' } })
    return route.fulfill({ headers, json: {
      waybills: [{ id: '9ca1a6d0-a3f9-45fb-adea-53ffbddf3715', waybill_no: 'YD20261116001' }],
      records: requests.length < 2 ? [] : [{
        id: 'report-fixture', waybill_no: 'YD20261116001', exception_type: 'delay', stage: 'transit',
        occurred_at: requests[1].p_occurred_at, status: 'pending', extra_freight: 120.5
      }]
    } })
  }
  requests.push(request.postDataJSON())
  if (requests.length === 1) return route.fulfill({ status: 503, headers, json: { message: '暂时无法提交，请稍后重试。' } })
  return route.fulfill({ headers, json: 'report-fixture' })
})

const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const button = name => page.getByRole('button', { name, exact: true })
const label = text => page.getByText(text, { exact: true })
const expectNoOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
const choose = async (name, option) => {
  await button(name).click()
  const picker = page.getByRole('dialog', { name, exact: true })
  await picker.getByRole('button', { name: option }).click()
  await picker.waitFor({ state: 'hidden' })
}

try {
  await mkdir(output, { recursive: true })
  await page.goto(`${base}#/pages/login/index`)
  await page.locator('input').nth(0).fill(fixtureAccount)
  await page.locator('input').nth(1).fill(fixturePassword)
  await page.locator('.login-form__button').click()
  await page.getByRole('link', { name: '我的', exact: true }).click()
  await button('异常报备').click()
  await label('暂无异常报备').waitFor()
  await button('新增报备').click()
  await button('提交报备').click()
  await label('请选择关联运单。').waitFor()
  await page.waitForFunction(() => document.activeElement?.id === 'driver-exception-waybill')
  assert.equal(requests.length, 0)
  await choose('关联运单', /YD20261116001/)
  await choose('异常类型', '延误')
  await choose('发生环节', '在途')
  const description = page.locator('#driver-exception-description textarea')
  await description.fill('途中故障，预计晚到两小时。')
  const amount = page.locator('#driver-exception-freight input')
  await amount.fill('120.501')
  await button('提交报备').click()
  await label('请输入大于 0、最多两位小数的金额。').waitFor()
  assert.equal(requests.length, 0)
  await amount.fill('120.50')
  await expectNoOverflow()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${output}/320-form.png` })
  await button('提交报备').click()
  await label('暂时无法提交，请稍后重试。').waitFor()
  assert.equal(await description.inputValue(), '途中故障，预计晚到两小时。')
  await button('提交报备').click()
  await label('已提交异常报备').waitFor()
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[0], requests[1])
  assert.equal(requests[0].p_extra_freight, 120.5)
  assert.equal(requests[0].p_waybill_id, '9ca1a6d0-a3f9-45fb-adea-53ffbddf3715')
  await button('查看报备记录').click()
  await label('延误 · YD20261116001').waitFor()
  await label('待处理').waitFor()
  await expectNoOverflow()
  await page.screenshot({ path: `${output}/320-record.png` })
  unavailable = true
  await page.reload()
  await label('异常报备服务尚未开通。当前有异常时，请先联系调度。').waitFor()
  assert.deepEqual(errors, [])
  console.log('Driver exception: Mine entry, validation/focus, preserved draft, retry identity, real-response receipt and unavailable API passed at 320px.')
} finally {
  await browser.close()
}
