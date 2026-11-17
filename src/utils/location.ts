import { captureBrowserGcj02, captureNativeGcj02, toGcj02Location, type LocationCoordinates } from '@mobile-core/location'
import type { CargoOperationLocation } from '@/api/types'
import { isAndroidApp } from '@mobile-core/platform'

export async function getCurrentGcj02Location(locationText?: string): Promise<CargoOperationLocation> {
  // #ifdef H5
  if (isAndroidApp()) return getAndroidGcj02Location(locationText)
  return withBrowserAddress(await captureBrowserGcj02(), locationText)
  // #endif

  // #ifndef H5
  const { address, ...coordinates } = await captureNativeGcj02()
  return { ...coordinates, locationText: locationText?.trim() || formatLocationAddress(address) }
  // #endif
}

// #ifdef H5
async function getAndroidGcj02Location(locationText?: string): Promise<CargoOperationLocation> {
  try {
    const { Geolocation } = await import('@capacitor/geolocation')
    let permission = await Geolocation.checkPermissions()
    if (permission.location === 'prompt' || permission.location === 'prompt-with-rationale') {
      permission = await Geolocation.requestPermissions({ permissions: ['location'] })
    }
    // Approximate Android location can be several kilometers from the check-in point.
    if (permission.location === 'granted') {
      const { coords } = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        enableLocationFallback: true,
        timeout: 15000,
        maximumAge: 5000
      })
      return withBrowserAddress(toGcj02Location(coords), locationText)
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (code === 'OS-PLUG-GLOC-0003') {
      throw new Error('请在 Android 系统设置中允许应用访问精确位置后重试')
    }
    if (code === 'OS-PLUG-GLOC-0010') throw new Error('定位超时，请移至开阔区域后重试')
    throw new Error('暂时无法获取位置，请开启手机定位服务后重试')
  }
  throw new Error('请在 Android 系统设置中允许应用访问精确位置后重试')
}

async function withBrowserAddress(
  coordinates: LocationCoordinates,
  locationText?: string
): Promise<CargoOperationLocation> {
  return {
    ...coordinates,
    locationText: locationText?.trim() || (await reverseGeocodeAmap(coordinates.longitude, coordinates.latitude))
  }
}
// #endif

function formatLocationAddress(address: unknown) {
  if (typeof address === 'string') return address.trim() || undefined
  if (!address || typeof address !== 'object') return undefined
  const value = address as Record<string, unknown>
  const formatted = [value.formattedAddress, value.formatted_address, value.address]
    .find((item): item is string => typeof item === 'string' && Boolean(item.trim()))
  if (formatted) return formatted.trim()
  const parts = [
    value.province,
    value.city,
    value.district,
    value.street,
    value.streetNum,
    value.poiName
  ].filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
  return parts.join('') || undefined
}

async function reverseGeocodeAmap(longitude: number, latitude: number) {
  const key = import.meta.env.VITE_AMAP_WEB_SERVICE_KEY
  if (!key) return undefined
  try {
    const params = new URLSearchParams({
      key,
      location: `${longitude},${latitude}`,
      extensions: 'base',
      roadlevel: '0'
    })
    const response = await fetch(`https://restapi.amap.com/v3/geocode/regeo?${params}`)
    if (!response.ok) return undefined
    const payload: unknown = await response.json()
    if (!payload || typeof payload !== 'object') return undefined
    const data = payload as Record<string, unknown>
    if (data.status !== '1' || !data.regeocode || typeof data.regeocode !== 'object') {
      return undefined
    }
    return formatLocationAddress(data.regeocode)
  } catch (error) {
    console.warn('reverse geocoding failed', error)
    return undefined
  }
}

export function calculateDistanceMeters(
  location: Pick<CargoOperationLocation, 'longitude' | 'latitude'>,
  centerLongitude?: number | null,
  centerLatitude?: number | null
): number | null {
  if (centerLongitude == null || centerLatitude == null) return null

  const radians = (value: number) => (value * Math.PI) / 180
  const latitudeDelta = radians(centerLatitude - location.latitude)
  const longitudeDelta = radians(centerLongitude - location.longitude)
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(location.latitude)) *
      Math.cos(radians(centerLatitude)) *
      Math.sin(longitudeDelta / 2) ** 2

  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
