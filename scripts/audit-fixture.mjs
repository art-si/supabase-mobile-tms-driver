// Browser-only fixtures: production services are never used when this mode is on.
export const fixtureMode = process.env.TMS_AUDIT_FIXTURE === '1'
export const fixtureAccount = fixtureMode ? 'fixture-driver' : undefined
export const fixturePassword = fixtureMode ? 'fixture-password' : undefined

const mainId = '9ca1a6d0-a3f9-45fb-adea-53ffbddf3715'
const pendingId = '92a00000-0000-4000-8000-000000000002'
const completedId = '92a00000-0000-4000-8000-000000000003'
const date = '2026-11-16T09:30:00+08:00'
const routeDetails = {
  originCity: '武汉', destinationCity: '杭州',
  fromStationName: '武汉东西湖物流中心', toStationName: '杭州钱塘仓配中心',
  shipperAddress: '武汉市东西湖区临空港大道 88 号 2 号库',
  receiverAddress: '杭州市钱塘区江东一路 168 号卸货平台',
  senderName: '张师傅', senderPhone: '13100000001', receiverName: '周师傅', receiverPhone: '13100000002',
  cargoName: '标准箱装货物', cargoWeightTon: 18.4, freightAmount: 4860,
  plannedLoadTime: date, plannedUnloadTime: date, remainingDistanceKm: 724.8,
  routePoints: [{ longitude: 114.18, latitude: 30.61 }, { longitude: 120.47, latitude: 30.31 }],
}

export async function useAuditFixture(context, base) {
  if (!fixtureMode) return

  const origin = new URL(base).origin
  const empty = process.env.TMS_AUDIT_STATE === 'empty'
  const dense = process.env.TMS_AUDIT_PHASE === 'dense' || process.env.TMS_AUDIT_STATE === 'dense'
  const lifecycle = process.env.TMS_AUDIT_PHASE === 'mutations'
  const testFilters = process.env.TMS_AUDIT_PHASE === 'filters'
  const detailStatus = process.env.TMS_AUDIT_DETAIL_STATUS || (process.env.TMS_AUDIT_PHASE === 'focus' ? 'unloading' : 'accepted')
  let failNextList = process.env.TMS_AUDIT_STATE === 'retry'
  let failCompletedFilter = false
  let failCertification = process.env.TMS_AUDIT_PHASE === 'services'
  let failUnloadingWeight = process.env.TMS_AUDIT_STATE === 'weighbridge-partial'
  const acceptReadbackMode = process.env.TMS_AUDIT_STATE
  const delayDetailAfterAccept = ['accept-readback', 'accept-readback-stale'].includes(acceptReadbackMode)
  let delayedAcceptReadId
  let failCancellation = process.env.TMS_AUDIT_STATE === 'cancel-recovery'
  let failCancelledDetail = process.env.TMS_AUDIT_STATE === 'cancel-recovery'
  const certificationExempt = process.env.TMS_AUDIT_STATE === 'certification-exempt'
  const proof = `${origin}/__tms-audit__/image.svg`
  const driver = { id: 'driver-audit', driverName: '陈师傅', phone: '13100000003', idCardNo: '420100000000000012', licenseType: 'A1' }
  const carrier = { id: 'carrier-audit', companyName: '华中联运测试车队' }
  const vehicle = { id: 'vehicle-audit', plateNo: '鄂 A·90836', brandModel: '东风天龙', approvedLoadMass: 33000, overallLength: 9600, operationStatus: 'active', auditStatus: 'approved', drivingLicenseFrontUrl: proof, operationLicenseUrl: proof }
  const orders = [
    { id: mainId, waybillNo: 'YD20261116001', status: lifecycle ? 'pending' : detailStatus },
    { id: pendingId, waybillNo: 'YD20261116002', status: 'pending' },
    { id: completedId, waybillNo: 'YD20261116003', status: 'completed' },
  ].map(order => ({ ...routeDetails, ...order, tenantId: 'tenant-audit', vehicle, driver, carrier }))
  const expenseRecord = { id: 'expense-1', costNo: 'BX20261116001', expenseItemId: 'item-1', expenseItemName: '高速通行费', amount: 240.5, occurredOn: '2026-11-16', auditStatus: lifecycle ? 'rejected' : 'pending_review', settlementStatus: 'unsettled', attachments: [proof] }
  const expenseRecords = [expenseRecord]
  if (dense) {
    Object.assign(vehicle, { brandModel: '长途重型牵引车 DX-ROADMASTER-LONG-CHASSIS-2026-SPECIAL', plateNo: '鄂 A·90836' })
    Object.assign(orders[0], {
      senderAddress: '武汉市东西湖区临空港大道 88 号综合物流园一期北侧车辆通道，经二号闸机进入五号仓后门装卸平台',
      receiverAddress: '杭州市钱塘区江东一路 168 号东区货运枢纽三号门，沿内部道路行驶至二期钢结构仓库的 B-17 卸货平台',
      fromStationName: '武汉东西湖保税综合物流运营中心装货站', toStationName: '杭州钱塘国际仓储配送服务中心卸货站',
    })
    Object.assign(expenseRecord, {
      expenseItemName: '跨省高速通行与临时道路通行服务费用', amount: 120054.8, auditStatus: 'rejected',
      submittedAt: date, costNo: 'BX20261116001-REIMBURSEMENT-LOGISTICS-0123456789',
      reviewRemark: '收费站抵扣信息未显示完整，请补充包含发票号码、车辆信息、收费区间及付款方名称的完整票据。',
      attachments: Array.from({ length: 5 }, (_, index) => `${proof}?expense=${index + 1}`),
    })
    for (let index = 1; index < 15; index += 1) {
      orders.push({ ...orders[0], id: `audit-long-list-${index}`, waybillNo: `YD202611169${String(index).padStart(2, '0')}` })
    }
  }
  const cargoCompleted = new Set()
  const cargoCheckedIn = new Set()
  const illustration = '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220" viewBox="0 0 360 220"><rect width="360" height="220" fill="#dfe9e8"/><rect x="25" y="30" width="310" height="160" rx="18" fill="#fff"/><path d="M56 81h151M56 112h228M56 143h181" stroke="#78a5a0" stroke-width="8" stroke-linecap="round"/><circle cx="289" cy="83" r="17" fill="#18746a"/></svg>'

  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/__tms-audit__/image.svg') {
      return route.fulfill({ contentType: 'image/svg+xml', body: illustration })
    }
    if (url.origin === origin) return route.fallback()
    if (!/^\/(rest|auth|functions|storage)\/v1\//.test(url.pathname)) return route.abort()

    const method = request.method()
    const headers = {
      'access-control-allow-origin': origin,
      'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'apikey, authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    }
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (url.pathname.startsWith('/storage/v1/') && method === 'GET') {
      return route.fulfill({ headers, contentType: 'image/svg+xml', body: illustration })
    }

    const operation = url.pathname.split('/').at(-1)
    const input = method === 'POST' && request.headers()['content-type']?.includes('application/json')
      ? request.postDataJSON() || {} : {}
    const order = orders.find(item => item.id === input.p_waybill_id) || orders[0]
    const execution = {
      waybillId: order.id, waybillStatus: order.status, loadingStatus: 'completed', unloadingStatus: !lifecycle || cargoCompleted.has('unloading') ? 'completed' : undefined,
      canAccept: true, canDepart: true, canArrive: true, canUnload: true, canSign: true, canComplete: true, canCancel: true,
      record: { departureTime: date, departureOdometerKm: 72400, departurePhotoUrls: [proof], returnTime: date, returnOdometerKm: 73124, returnPhotoUrls: [proof], receiptUrls: lifecycle ? [proof] : [], signatureUrls: lifecycle ? [proof] : [] },
    }
    const cargoOperation = {
      waybillId: order.id, waybillStatus: order.status, operationType: input.p_operation_type, radiusM: 1200,
      centerLongitude: 114.18, centerLatitude: 30.61, canManage: true, geofenceEnabled: true,
      operation: { id: 'operation-audit', operationStatus: !lifecycle || cargoCompleted.has(input.p_operation_type) ? 'completed' : 'checked_in', completedAt: !lifecycle ? date : undefined, checkinTime: date, distanceM: 30, insideGeofence: true,
        checkinMode: 'manual', weightTon: 18.4, grossWeightTon: 33.4, tareWeightTon: 15,
        photoUrls: [proof], weighbridgeTicketUrls: [proof] },
    }
    const updateOrder = status => ({ ...execution, waybillStatus: order.status = status })
    const invalidMutation = () => route.fulfill({ status: 422, headers, json: { message: '测试资料记录无效' } })

    let data
    switch (operation) {
      case 'driver-auth':
      case 'token':
        data = { access_token: 'fixture-token', refresh_token: 'fixture-refresh', expires_in: 3600, user: { id: 'audit-user' } }
        break
      case 'logout': return route.fulfill({ status: 204, headers })
      case 'sync-driver-waybills': data = { ok: true, synced: 0, waybillNos: [] }; break
      case 'sys_dict_type': data = [{ id: 'payment-audit', code: 'tmsCashPaymentMethod', name: '支付方式' }]; break
      case 'sys_dictionary': data = [{ id: 'payment-cash', typeId: 'payment-audit', value: 'cash', label: '现金' }]; break
      case 'tms_get_driver_mobile_profile':
        data = { driver, carrier, vehicle: empty ? null : vehicle, completedCount: empty ? 0 : 1, rating: 4.8 }
        break
      case 'tms_get_driver_mobile_certification':
        if (failCertification) {
          failCertification = false
          return route.fulfill({ status: 503, headers, json: { message: '认证服务暂时不可用' } })
        }
        data = { required: !certificationExempt, certified: certificationExempt, reason: certificationExempt ? '' : '身份证、驾驶证和从业资格证尚未全部审核通过', reviewedAt: null, identityStatus: 'verified', licenseStatus: 'verified', qualificationStatus: 'unverified' }
        break
      case 'tms_list_driver_mobile_waybills':
        if (testFilters && input.p_group === 'pending') {
          failCompletedFilter = true
          await new Promise(resolve => setTimeout(resolve, 800))
        }
        if (failCompletedFilter && input.p_group === 'completed' && input.p_limit === 1000) {
          failCompletedFilter = false
          return route.fulfill({ status: 503, headers, json: { message: '已完成任务同步失败，请重试' } })
        }
        if (failNextList && input.p_group === 'all') {
          failNextList = false
          return route.fulfill({ status: 503, headers, json: { message: '测试同步中断' } })
        }
        data = empty ? [] : orders.filter(item => input.p_group === 'pending' ? item.status === 'pending'
          : input.p_group === 'completed' ? item.status === 'completed'
            : input.p_group === 'active' ? !['pending', 'completed'].includes(item.status) : true)
        break
      case 'tms_get_driver_mobile_waybill':
        if (delayedAcceptReadId === order.id) {
          delayedAcceptReadId = undefined
          if (acceptReadbackMode === 'accept-readback') {
            return route.fulfill({ status: 503, headers, json: { message: '详情同步暂不可用，请重新加载。' } })
          }
          data = { ...order, status: 'pending' }
          break
        }
        if (failCancelledDetail && order.status === 'cancelled') {
          failCancelledDetail = false
          return route.fulfill({ status: 503, headers, json: { message: '取消已提交，测试状态暂不可读' } })
        }
        data = order
        break
      case 'tms_get_waybill_execution_context': data = execution; break
      case 'tms_accept_assigned_waybill':
        if (delayDetailAfterAccept && (input.p_waybill_id !== order.id || order.status !== 'pending')) return invalidMutation()
        data = updateOrder('accepted')
        if (delayDetailAfterAccept) delayedAcceptReadId = order.id
        break
      case 'tms_cancel_assigned_waybill':
        if (input.p_waybill_id !== order.id || order.status !== 'accepted' || typeof input.p_reason !== 'string' || input.p_reason.trim().length < 4) return invalidMutation()
        if (failCancellation) {
          failCancellation = false
          return route.fulfill({ status: 503, headers, json: { message: '取消暂时失败，请稍后重试。' } })
        }
        data = updateOrder('cancelled')
        break
      case 'tms_record_waybill_departure':
        if (!input.p_departure_time || !input.p_photo_urls?.length || typeof input.p_odometer_km !== 'number') return invalidMutation()
        data = updateOrder('transporting')
        break
      case 'tms_sign_waybill':
        if (!input.p_signed_at || !input.p_signer_name?.trim() || !input.p_receipt_urls?.length || !input.p_signature_urls?.length) return invalidMutation()
        data = updateOrder('signed')
        break
      case 'tms_complete_waybill_execution':
        if (!input.p_return_time || !input.p_photo_urls?.length || typeof input.p_return_odometer_km !== 'number') return invalidMutation()
        data = updateOrder('completed')
        break
      case 'tms_list_driver_mobile_waybill_events':
        data = [{ id: 'event-audit', waybillId: order.id, eventType: 'accepted', operatorName: driver.driverName, eventTime: date }]
        if (dense) data.push(
          { id: 'event-loaded', waybillId: order.id, eventType: 'loaded', eventTime: '2026-11-15T08:20:00+08:00', createTime: '2026-11-15T09:40:00+08:00', operatorName: '物流中心联合调度作业组', locationText: order.shipperAddress, remark: '箱货外包装已逐件核验，重件放置在车辆中部，请在到货台查验签收件数量。', payload: { source: 'driver', weightTon: 18.4, grossWeightTon: 33.4, tareWeightTon: 15, photoCount: 5, ticketCount: 3 } },
          { id: 'event-update', waybillId: order.id, eventType: 'status_changed' },
        )
        break
      case 'tms_list_driver_mobile_waybill_proofs':
        data = [{ id: 'proof-1', waybillId: order.id, proofType: 'pickup_photo', fileUrl: proof }, { id: 'proof-2', waybillId: order.id, proofType: 'receipt', fileUrl: `${proof}?receipt` }]
        break
      case 'tms_get_waybill_cargo_operation_context':
        if (failUnloadingWeight && input.p_operation_type === 'unloading') {
          failUnloadingWeight = false
          return route.fulfill({ status: 503, headers, json: { message: '卸货过磅资料暂时不可用' } })
        }
        data = lifecycle && !cargoCheckedIn.has(input.p_operation_type) ? { ...cargoOperation, operation: null } : cargoOperation
        break
      case 'tms_check_in_waybill_cargo_operation':
        if (typeof input.p_longitude !== 'number' || typeof input.p_latitude !== 'number') return invalidMutation()
        cargoCheckedIn.add(input.p_operation_type)
        if (input.p_operation_type === 'unloading') order.status = 'unloading'
        data = { ...cargoOperation, waybillStatus: order.status }
        break
      case 'tms_complete_waybill_cargo_operation':
        if (!(input.p_weight_ton > 0) || !input.p_photo_urls?.length || !input.p_weighbridge_ticket_urls?.length) return invalidMutation()
        cargoCompleted.add(input.p_operation_type)
        order.status = input.p_operation_type
        data = { ...cargoOperation, waybillStatus: order.status, operation: { ...cargoOperation.operation, operationStatus: 'completed' } }
        break
      case 'tms_get_driver_waybill_expense_context':
        data = {
          waybill: order, canReport: true,
          expenseItems: [{ id: 'item-1', itemCode: 'toll', itemName: '高速通行费', parentName: '运输费用' }],
          records: empty ? [] : expenseRecords,
          stats: { reportCount: empty ? 0 : expenseRecords.length, totalAmount: empty ? 0 : expenseRecords.reduce((sum, entry) => sum + entry.amount, 0), pendingCount: empty ? 0 : expenseRecords.filter(entry => entry.auditStatus === 'pending_review').length, approvedAmount: 0 },
        }
        break
      case 'tms_submit_driver_waybill_expense': {
        if (!(input.p_amount > 0) || !input.p_idempotency_key || !input.p_attachments?.length) return invalidMutation()
        const record = input.p_cost_id
          ? expenseRecords.find(item => item.id === input.p_cost_id)
          : { ...expenseRecord, id: 'expense-new', costNo: 'BX20261116002' }
        if (!record) return invalidMutation()
        Object.assign(record, { amount: input.p_amount, auditStatus: 'pending_review', submittedAt: date, attachments: input.p_attachments })
        if (!input.p_cost_id) expenseRecords.push(record)
        data = record.id
        break
      }
      case 'get_effective_ai_feature_configs':
        data = [{ feature: 'waybill_expense_ocr', enabled: false }]
        break
      default: data = []
    }
    return route.fulfill({ status: 200, headers, json: data })
  })
}
