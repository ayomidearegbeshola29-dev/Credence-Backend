/**
 * Reputation engine – computes an off-chain trust score from bond data and
 * attestation history stored in the identity DB.
 *
 * Score breakdown (max 100, configurable via environment):
 *   Bond amount  : up to REPUTATION_BOND_SCORE_MAX pts (default: 50 pts at ≥ 1 ETH)
 *   Bond duration: up to REPUTATION_DURATION_SCORE_MAX pts (default: 20 pts at ≥ 365 days bonded)
 *   Attestations : up to REPUTATION_ATTESTATION_SCORE_MAX pts (default: 30 pts at ≥ 5 attestations)
 *
 * All scoring weights are externalized to config and versioned via REPUTATION_MODEL_VERSION.
 */

import { getIdentity, type Identity } from '../db/store.js'
import { loadConfig } from '../config/index.js'

export interface TrustScore {
  address: string
  score: number
  bondedAmount: string
  bondStart: string | null
  attestationCount: number
  agreedFields?: Record<string, string>
  scoringModelVersion?: string
}

export interface ScoringConfig {
  bondScoreMax: number
  durationScoreMax: number
  attestationScoreMax: number
  oneEthWei: bigint
  maxDurationDays: number
  maxAttestationCount: number
  scoringModelVersion: string
}

// Lazy-load config to avoid issues during test initialization
let cachedScoringConfig: ScoringConfig | null = null

function getDefaultScoringConfig(): ScoringConfig {
  if (!cachedScoringConfig) {
    const config = loadConfig()
    cachedScoringConfig = config.reputation
  }
  return cachedScoringConfig
}

/**
 * Get the current scoring configuration.
 * Useful for testing and introspection.
 */
export function getScoringConfig(): ScoringConfig {
  return { ...getDefaultScoringConfig() }
}

/** Points proportional to bonded amount; maxes out at configured ONE_ETH_WEI. */
export function computeBondScore(
  bondedAmountWei: string,
  cfg?: ScoringConfig
): number {
  const config = cfg || getDefaultScoringConfig()
  try {
    const amount = BigInt(bondedAmountWei)
    if (amount <= 0n) return 0
    const score = Number((amount * BigInt(config.bondScoreMax)) / config.oneEthWei)
    return Math.min(config.bondScoreMax, score)
  } catch {
    return 0
  }
}

/** Points proportional to days since bond start; maxes out at configured max duration. */
export function computeDurationScore(
  bondStart: string | null,
  now = Date.now(),
  cfg?: ScoringConfig
): number {
  const config = cfg || getDefaultScoringConfig()
  if (!bondStart) return 0
  const startMs = new Date(bondStart).getTime()
  if (isNaN(startMs) || startMs >= now) return 0
  const daysBonded = (now - startMs) / 86_400_000
  const score = (daysBonded / config.maxDurationDays) * config.durationScoreMax
  return Math.min(config.durationScoreMax, Math.round(score))
}

/** Points proportional to attestation count; maxes out at configured max attestation count. */
export function computeAttestationScore(
  count: number,
  cfg?: ScoringConfig
): number {
  const config = cfg || getDefaultScoringConfig()
  if (count <= 0) return 0
  const score = (count / config.maxAttestationCount) * config.attestationScoreMax
  return Math.min(config.attestationScoreMax, Math.round(score))
}

/** Compute a full TrustScore from an Identity record. */
export function computeTrustScore(
  identity: Identity,
  cfg?: ScoringConfig
): TrustScore {
  const config = cfg || getDefaultScoringConfig()
  const bondScore = computeBondScore(identity.bondedAmount, config)
  const durationScore = computeDurationScore(identity.bondStart, Date.now(), config)
  const attestationScore = computeAttestationScore(identity.attestationCount, config)
  const score = Math.min(100, bondScore + durationScore + attestationScore)

  return {
    address: identity.address,
    score,
    bondedAmount: identity.bondedAmount,
    bondStart: identity.bondStart,
    attestationCount: identity.attestationCount,
    scoringModelVersion: config.scoringModelVersion,
    ...(identity.agreedFields ? { agreedFields: identity.agreedFields } : {}),
  }
}

/**
 * Look up an identity by address and return its computed trust score,
 * or null when no record exists.
 * Uses Redis cache and Postgres DB.
 */
export async function getTrustScore(address: string): Promise<TrustScore | null> {
  const cacheKey = address.toLowerCase()
  
  // 1. Try cache
  const cached = await cache.get<TrustScore>('trust', cacheKey)
  if (cached) return cached

  // 2. Try DB
  const idResult = await pool.query(
    `SELECT address, bonded_amount as "bondedAmount", 
            bond_start as "bondStart"
     FROM identities
     WHERE address = $1`,
    [address]
  )

  if (idResult.rows.length === 0) {
    return null
  }

  const row = idResult.rows[0]
  const attResult = await pool.query(
    'SELECT COUNT(*)::int as count FROM attestations WHERE subject_address = $1',
    [address]
  )
  const attestationCount = parseInt(attResult.rows[0]?.count || '0', 10)
  const record: IdentityRecord = { ...row, attestationCount }
  const trustScore = computeTrustScoreFromRecord(record)

  // 3. Save to cache (TTL 1 hour)
  await cache.set('trust', cacheKey, trustScore, 3600)

  return trustScore
}

/**
 * Invalidate the trust score cache for a given address.
 */
export async function invalidateTrustScoreCache(address: string): Promise<void> {
  await cache.delete('trust', address.toLowerCase())
}
