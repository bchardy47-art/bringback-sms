import { createVerify } from 'crypto'
import type {
  MessagingProvider,
  SendMessageParams,
  SendResult,
  InboundMessage,
  StatusEvent,
} from './provider.interface'

export class TelnyxProvider implements MessagingProvider {
  private apiKey: string
  private publicKey: string

  constructor(apiKey: string, publicKey: string) {
    this.apiKey = apiKey
    this.publicKey = publicKey
  }

  async send(params: SendMessageParams): Promise<SendResult> {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: params.from,
        to: params.to,
        text: params.body,
        ...(params.mediaUrls?.length ? { media_urls: params.mediaUrls } : {}),
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Telnyx send failed: ${res.status} ${err}`)
    }

    const data = await res.json()
    return {
      providerMessageId: data.data.id,
      status: 'queued',
    }
  }

  parseInboundWebhook(payload: unknown): InboundMessage {
    const p = payload as TelnyxWebhookPayload
    const msg = p.data.payload
    return {
      providerMessageId: msg.id,
      from: msg.from.phone_number,
      to: msg.to[0].phone_number,
      body: msg.text ?? '',
      mediaUrls: msg.media?.map((m) => m.url),
      receivedAt: new Date(p.data.occurred_at),
    }
  }

  parseStatusWebhook(payload: unknown): StatusEvent {
    const p = payload as TelnyxWebhookPayload
    const msg = p.data.payload
    const eventType = p.data.event_type

    let status: StatusEvent['status']
    if (eventType === 'message.delivered') status = 'delivered'
    else if (eventType === 'message.failed') status = 'failed'
    else status = 'sent'

    return {
      providerMessageId: msg.id,
      status,
      failureReason: msg.errors?.[0]?.detail,
      occurredAt: new Date(p.data.occurred_at),
    }
  }

  // Telnyx signs webhooks with Ed25519.
  // The public key from the portal is a raw 32-byte Ed25519 key (base64-encoded),
  // NOT a DER SPKI structure. We must prepend the SPKI header so Node.js crypto
  // can import it. The header for Ed25519 SPKI DER is the 12-byte sequence:
  //   30 2a 30 05 06 03 2b 65 70 03 21 00
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean {
    try {
      // Telnyx may send the signature header with or without the -1 suffix
      const signature =
        headers['telnyx-signature-ed25519'] ||
        headers['telnyx-signature-ed25519-1']
      const timestamp = headers['telnyx-timestamp']
      if (!signature || !timestamp) return false

      const message = `${timestamp}|${rawBody}`

      // Convert raw 32-byte Ed25519 key → DER SPKI (44 bytes) by prepending the
      // ASN.1 SubjectPublicKeyInfo header for Ed25519 (OID 1.3.101.112)
      const rawKeyBuffer = Buffer.from(this.publicKey, 'base64')
      const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
      const spkiBuffer = Buffer.concat([SPKI_PREFIX, rawKeyBuffer])

      const verify = createVerify('ed25519')
      verify.update(message)
      return verify.verify(
        { key: spkiBuffer, format: 'der', type: 'spki' } as Parameters<typeof verify.verify>[0],
        Buffer.from(signature, 'base64')
      )
    } catch {
      return false
    }
  }
}

// ── Telnyx webhook shape (minimal) ────────────────────────────────────────
interface TelnyxWebhookPayload {
  data: {
    event_type: string
    occurred_at: string
    payload: {
      id: string
      text?: string
      from: { phone_number: string }
      to: Array<{ phone_number: string }>
      media?: Array<{ url: string }>
      errors?: Array<{ detail: string }>
    }
  }
}
