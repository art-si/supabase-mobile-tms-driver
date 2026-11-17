import type { Waybill } from '@/api/types'
import { isAndroidApp } from '@mobile-core/platform'
import { findWaybillEndpoint, type ValidRoutePoint } from './route'

export function getWaybillNavigationTarget(waybill: Waybill) {
  const pickup = waybill.status === 'pending' || waybill.status === 'accepted'
  const point = findWaybillEndpoint(waybill, pickup ? 'shipper' : 'receiver')
  const stop = pickup ? '装货地' : '卸货地'
  const station = pickup ? waybill.fromStationName : waybill.toStationName
  const city = pickup ? waybill.originCity : waybill.destinationCity
  const street = pickup ? waybill.senderAddress || waybill.shipperAddress : waybill.receiverAddress
  const address = street || point?.address || station || city || ''
  return { point, address, stop, name: station || point?.name || city || stop }
}

export function openWaybillNavigation({ point, address, name }: ReturnType<typeof getWaybillNavigationTarget>) {

  if (!point) {
    openAddressFallback(name, address)
    return
  }
  // #ifdef H5
  openWebMapLocation(name, address, point)
  // #endif

  // #ifndef H5
  uni.openLocation({
    latitude: point.latitude,
    longitude: point.longitude,
    name,
    address,
    scale: 15,
    fail() {
      uni.showToast({ title: '打开导航失败', icon: 'none' })
    }
  })
  // #endif
}

// #ifdef H5
function openWebMapLocation(name: string, address: string, destination?: ValidRoutePoint) {
  const title = encodeURIComponent(name || address || '目的地')
  const keyword = encodeURIComponent(address || name || '目的地')
  const url = destination
    ? `https://apis.map.qq.com/uri/v1/routeplan?type=drive&to=${title}&tocoord=${destination.latitude},${destination.longitude}&policy=1&referer=tms-driver`
    : `https://apis.map.qq.com/uri/v1/search?keyword=${keyword}&referer=tms-driver`

  if (isAndroidApp()) {
    void openAndroidMap(url)
    return
  }
  const opened = window.open(url, '_blank')
  if (!opened) window.location.href = url
}

async function openAndroidMap(url: string) {
  try {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url })
  } catch {
    // The bridge can still hand an external top-level navigation to Android.
    window.location.assign(url)
  }
}
// #endif

function openAddressFallback(name: string, address: string) {
  if (!address) {
    uni.showToast({ title: '暂无导航地址', icon: 'none' })
    return
  }

  // #ifdef H5
  openWebMapLocation(name, address)
  return
  // #endif

  uni.setClipboardData({
    data: address,
    success() {
      uni.showToast({ title: '已复制目的地地址', icon: 'none' })
    },
    fail() {
      uni.showModal({
        title: name,
        content: address,
        showCancel: false,
        confirmText: '知道了'
      })
    }
  })
}
