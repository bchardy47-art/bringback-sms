export interface SendMessageParams {
  to: string
  from: string
  body: string
  mediaUrls?: string[]
  /**
   * Provider-level idempotency key. When set, the provider includes it on the
   * create-message request so retries (network errors, worker restarts) cannot
   * produce duplicate sends. Should be stable per logical send (e.g. the
   * workflow step execution id).
   */
  idempotencyKey?: string
}

export interface SendResult {
  providerMessageId: string
  status: 'queued' | 'sent'
}

export interface InboundMessage {
  providerMessageId: string
  from: string   // E.164
  to: string     // E.164 — our number
  body: string
  mediaUrls?: string[]
  receivedAt: Date
}

export interface StatusEvent {
  providerMessageId: string
  status: 'sent' | 'delivered' | 'failed'
  failureReason?: string
  occurredAt: Date
}

export interface MessagingProvider {
  send(params: SendMessageParams): Promise<SendResult>
  parseInboundWebhook(payload: unknown): InboundMessage
  parseStatusWebhook(payload: unknown): StatusEvent
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): boolean
}
