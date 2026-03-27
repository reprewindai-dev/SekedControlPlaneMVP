/**
 * Cloud Region ↔ Balancing Authority Mapping
 *
 * Maps cloud provider regions (AWS, GCP, Azure) to US balancing authorities
 * for EIA-930 grid signal data. Non-US regions return null (use WattTime/EM only).
 *
 * LOCKED REGIONS (from product doctrine):
 * - us-east-1, us-west-2, eu-west-1, eu-central-1, ap-southeast-1, ap-northeast-1
 */

export interface RegionMapping {
  cloudRegion: string
  balancingAuthority: string | null
  eiaRespondent: string | null
  country: string
  hasEia930Coverage: boolean
  notes?: string
}

/**
 * Complete mapping table for locked cloud regions → EIA BAs
 * Plus additional common cloud regions for extensibility
 */
const REGION_MAP: RegionMapping[] = [
  // ── AWS Regions ──
  { cloudRegion: 'us-east-1',       balancingAuthority: 'PJM',   eiaRespondent: 'PJM',   country: 'US', hasEia930Coverage: true,  notes: 'Northern Virginia, PJM territory' },
  { cloudRegion: 'us-east-2',       balancingAuthority: 'PJM',   eiaRespondent: 'PJM',   country: 'US', hasEia930Coverage: true,  notes: 'Ohio, PJM territory' },
  { cloudRegion: 'us-west-1',       balancingAuthority: 'CISO',  eiaRespondent: 'CISO',  country: 'US', hasEia930Coverage: true,  notes: 'N. California, CAISO territory' },
  { cloudRegion: 'us-west-2',       balancingAuthority: 'BPAT',  eiaRespondent: 'BPAT',  country: 'US', hasEia930Coverage: true,  notes: 'Oregon, BPA territory' },
  { cloudRegion: 'eu-west-1',       balancingAuthority: null,     eiaRespondent: null,     country: 'IE', hasEia930Coverage: false, notes: 'Ireland — no EIA coverage, use WattTime/EM' },
  { cloudRegion: 'eu-west-2',       balancingAuthority: null,     eiaRespondent: null,     country: 'GB', hasEia930Coverage: false, notes: 'London — no EIA coverage' },
  { cloudRegion: 'eu-central-1',    balancingAuthority: null,     eiaRespondent: null,     country: 'DE', hasEia930Coverage: false, notes: 'Frankfurt — no EIA coverage' },
  { cloudRegion: 'ap-southeast-1',  balancingAuthority: null,     eiaRespondent: null,     country: 'SG', hasEia930Coverage: false, notes: 'Singapore — no EIA coverage' },
  { cloudRegion: 'ap-northeast-1',  balancingAuthority: null,     eiaRespondent: null,     country: 'JP', hasEia930Coverage: false, notes: 'Tokyo — no EIA coverage' },
  { cloudRegion: 'ap-south-1',      balancingAuthority: null,     eiaRespondent: null,     country: 'IN', hasEia930Coverage: false, notes: 'Mumbai — no EIA coverage' },

  // ── GCP Regions ──
  { cloudRegion: 'us-central1',     balancingAuthority: 'MISO',  eiaRespondent: 'MISO',  country: 'US', hasEia930Coverage: true,  notes: 'Iowa, MISO territory' },
  { cloudRegion: 'us-east4',        balancingAuthority: 'PJM',   eiaRespondent: 'PJM',   country: 'US', hasEia930Coverage: true,  notes: 'N. Virginia, PJM territory' },
  { cloudRegion: 'us-west1',        balancingAuthority: 'BPAT',  eiaRespondent: 'BPAT',  country: 'US', hasEia930Coverage: true,  notes: 'Oregon, BPA territory' },
  { cloudRegion: 'europe-west1',    balancingAuthority: null,     eiaRespondent: null,     country: 'BE', hasEia930Coverage: false, notes: 'Belgium — no EIA coverage' },

  // ── Azure Regions ──
  { cloudRegion: 'eastus',          balancingAuthority: 'PJM',   eiaRespondent: 'PJM',   country: 'US', hasEia930Coverage: true,  notes: 'Virginia, PJM territory' },
  { cloudRegion: 'eastus2',         balancingAuthority: 'PJM',   eiaRespondent: 'PJM',   country: 'US', hasEia930Coverage: true,  notes: 'Virginia, PJM territory' },
  { cloudRegion: 'westus2',         balancingAuthority: 'BPAT',  eiaRespondent: 'BPAT',  country: 'US', hasEia930Coverage: true,  notes: 'Washington, BPA territory' },
  { cloudRegion: 'centralus',       balancingAuthority: 'SPP',   eiaRespondent: 'SPP',   country: 'US', hasEia930Coverage: true,  notes: 'Iowa, SPP territory' },
  { cloudRegion: 'southcentralus',  balancingAuthority: 'ERCO',  eiaRespondent: 'ERCO',  country: 'US', hasEia930Coverage: true,  notes: 'Texas, ERCOT territory' },
]

const regionIndex = new Map(REGION_MAP.map(r => [r.cloudRegion, r]))

/**
 * Look up the balancing authority for a cloud region
 */
export function getRegionMapping(cloudRegion: string): RegionMapping | null {
  return regionIndex.get(cloudRegion) ?? null
}

/**
 * Check if a cloud region has EIA-930 coverage
 */
export function hasEia930Coverage(cloudRegion: string): boolean {
  const mapping = regionIndex.get(cloudRegion)
  return mapping?.hasEia930Coverage ?? false
}

/**
 * Get the EIA respondent code for a cloud region (null if non-US)
 */
export function getEiaRespondent(cloudRegion: string): string | null {
  return regionIndex.get(cloudRegion)?.eiaRespondent ?? null
}

/**
 * Get the balancing authority for a cloud region (null if non-US)
 */
export function getBalancingAuthority(cloudRegion: string): string | null {
  return regionIndex.get(cloudRegion)?.balancingAuthority ?? null
}

/**
 * Get all unique US balancing authorities that have cloud region mappings
 * Used by the ingestion worker to know which BAs to fetch
 */
export function getUsBalancingAuthorities(): Array<{
  region: string
  balancingAuthority: string
  eiaRespondent: string
}> {
  const seen = new Set<string>()
  const result: Array<{ region: string; balancingAuthority: string; eiaRespondent: string }> = []

  for (const mapping of REGION_MAP) {
    if (mapping.hasEia930Coverage && mapping.balancingAuthority && mapping.eiaRespondent) {
      if (!seen.has(mapping.balancingAuthority)) {
        seen.add(mapping.balancingAuthority)
        result.push({
          region: mapping.balancingAuthority,
          balancingAuthority: mapping.balancingAuthority,
          eiaRespondent: mapping.eiaRespondent,
        })
      }
    }
  }

  return result
}

/**
 * Get all cloud regions in the mapping table
 */
export function getAllMappedRegions(): RegionMapping[] {
  return [...REGION_MAP]
}
