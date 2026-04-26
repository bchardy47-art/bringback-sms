import type { MessagingProvider } from './provider.interface'
import { TelnyxProvider } from './telnyx.provider'

let _provider: MessagingProvider | null = null

export function getProvider(): MessagingProvider {
  if (_provider) return _provider

  const providerName = process.env.MESSAGING_PROVIDER ?? 'telnyx'

  if (providerName === 'telnyx') {
    const apiKey = process.env.TELNYX_API_KEY
    const publicKey = process.env.TELNYX_PUBLIC_KEY
    if (!apiKey || !publicKey) {
      throw new Error('TELNYX_API_KEY and TELNYX_PUBLIC_KEY are required')
    }
    _provider = new TelnyxProvider(apiKey, publicKey)
    return _provider
  }

  throw new Error(`Unknown messaging provider: ${providerName}`)
}
