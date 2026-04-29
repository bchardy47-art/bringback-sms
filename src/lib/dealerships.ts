export type DealershipProfile = {
  name: string
  address: string
  city: string
  manufacturer: string
  secondaryManufacturer?: string
  stats: {
    inventory: number
    newVehicles: number
    usedVehicles: number
    avgDealValue: number
    closeRate: number
    replyRate: number
  }
}

// Demo profiles — matched by tenant name (case-insensitive contains)
const PROFILES: Record<string, DealershipProfile> = {
  ford: {
    name: 'Smith Ford Lincoln',
    address: '1230 Auto Center Dr',
    city: 'Austin, TX 78758',
    manufacturer: 'ford',
    secondaryManufacturer: 'lincoln',
    stats: { inventory: 287, newVehicles: 142, usedVehicles: 145, avgDealValue: 28450, closeRate: 11.2, replyRate: 34.7 },
  },
  toyota: {
    name: 'Valley Toyota',
    address: '4500 Valley Blvd',
    city: 'Los Angeles, CA 90032',
    manufacturer: 'toyota',
    stats: { inventory: 412, newVehicles: 221, usedVehicles: 191, avgDealValue: 31200, closeRate: 13.4, replyRate: 38.2 },
  },
  bmw: {
    name: 'Premier BMW',
    address: '8800 Wilshire Blvd',
    city: 'Beverly Hills, CA 90211',
    manufacturer: 'bmw',
    stats: { inventory: 198, newVehicles: 114, usedVehicles: 84, avgDealValue: 58900, closeRate: 9.8, replyRate: 41.3 },
  },
  chevy: {
    name: 'Sunset Chevrolet',
    address: '3200 Sunset Hwy',
    city: 'Phoenix, AZ 85001',
    manufacturer: 'chevrolet',
    stats: { inventory: 334, newVehicles: 189, usedVehicles: 145, avgDealValue: 35100, closeRate: 14.1, replyRate: 32.6 },
  },
  honda: {
    name: 'Metro Honda',
    address: '711 Commerce Blvd',
    city: 'Chicago, IL 60601',
    manufacturer: 'honda',
    stats: { inventory: 298, newVehicles: 163, usedVehicles: 135, avgDealValue: 26800, closeRate: 12.7, replyRate: 36.9 },
  },
}

export const ALL_DEMO_DEALERSHIPS = Object.values(PROFILES)

export function getDealershipProfile(tenantName: string): DealershipProfile {
  const lower = tenantName.toLowerCase()
  if (lower.includes('ford') || lower.includes('lincoln')) return PROFILES.ford
  if (lower.includes('toyota'))  return PROFILES.toyota
  if (lower.includes('bmw'))     return PROFILES.bmw
  if (lower.includes('chevy') || lower.includes('chevrolet')) return PROFILES.chevy
  if (lower.includes('honda'))   return PROFILES.honda
  // Default — show Ford as the demo
  return PROFILES.ford
}
