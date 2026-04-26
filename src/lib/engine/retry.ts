const MAX_RETRIES = 3

// Returns delay in ms for the given retry attempt, or null if retries exhausted.
const RETRY_DELAYS_MS = [
  5 * 60 * 1000,   // 5 min
  15 * 60 * 1000,  // 15 min
  60 * 60 * 1000,  // 1 hr
]

export function getRetryDelay(retryCount: number): number | null {
  if (retryCount >= MAX_RETRIES) return null
  return RETRY_DELAYS_MS[retryCount] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]
}

export function hasRetriesRemaining(retryCount: number): boolean {
  return retryCount < MAX_RETRIES
}
