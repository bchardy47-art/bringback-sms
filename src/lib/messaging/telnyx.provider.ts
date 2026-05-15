import { verify as cryptoVerify } from 'crypto'
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
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }
    // Telnyx honours `Idempotency-Key` to dedup retries server-side, so a
    // network glitch between us and Telnyx never produces two outbound SMS.
    if (params.idempotencyKey) {
      headers['Idempotency-Key'] = params.idempotencyKey
    }

    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers,
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
  //
  // We also enforce a ±REPLAY_WINDOW_S timestamp window so a captured webhook
  // cannot be replayed indefinitely.
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean {
    const REPLAY_WINDOW_S = 5 * 60 // 5 minutes
    try {
      const signature = headers['telnyx-signature-ed25519']
      const timestamp = headers['telnyx-timestamp']
      if (!signature || !timestamp) {
        console.warn(
          `[webhook/telnyx] missing headers — sig=${!!signature} ts=${!!timestamp}`,
        )
        return false
      }

      // Telnyx sends Unix epoch seconds as a string.
      const tsSeconds = Number.parseInt(timestamp, 10)
      if (!Number.isFinite(tsSeconds)) {
        console.warn(`[webhook/telnyx] non-numeric timestamp: ${timestamp}`)
        return false
      }
      const nowSeconds = Math.floor(Date.now() / 1000)
      const drift = Math.abs(nowSeconds - tsSeconds)
      if (drift > REPLAY_WINDOW_S) {
        console.warn(
          `[webhook/telnyx] timestamp outside replay window — drift=${drift}s (window=${REPLAY_WINDOW_S}s)`,
        )
        return false
      }

      const message = `${timestamp}|${rawBody}`

      const rawKeyBuffer = Buffer.from(this.publicKey, 'base64')
      if (rawKeyBuffer.length !== 32) {
        console.warn(
          `[webhook/telnyx] TELNYX_PUBLIC_KEY decodes to ${rawKeyBuffer.length} bytes (expected 32)`,
        )
        return false
      }
      const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
      const spkiBuffer = Buffer.concat([SPKI_PREFIX, rawKeyBuffer])

      const sigBuffer = Buffer.from(signature, 'base64')
      if (sigBuffer.length !== 64) {
        console.warn(
          `[webhook/telnyx] sig buffer is ${sigBuffer.length} bytes (expected 64) — header.len=${signature.length} header.prefix=${JSON.stringify(signature.slice(0, 24))}`,
        )
        return false
      }

      // Ed25519 is a "pure" signature scheme (no separate digest step),
      // so Node's one-shot crypto.verify(null, …) is the correct API.
      // The streaming createVerify('ed25519') path throws "Invalid digest"
      // in Node 20 because it routes through EVP_DigestVerifyFinal.
      const ok = cryptoVerify(
        null,
        Buffer.from(message, 'utf8'),
        { key: spkiBuffer, format: 'der', type: 'spki' },
        sigBuffer,
      )
      if (!ok) {
        console.warn(
          `[webhook/telnyx] signature mismatch — ts=${timestamp} bodyLen=${rawBody.length} sigB64Len=${signature.length}`,
        )
      }
      return ok
    } catch (err) {
      console.warn('[webhook/telnyx] verify threw:', (err as Error)?.message)
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
