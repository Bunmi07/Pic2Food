/**
 * Local, in-memory evaluation events. Never include image pixels, image
 * metadata, or personal data. Not sent anywhere.
 */
export type EvaluationEventType =
  | 'candidate_presented'
  | 'candidate_confirmed'
  | 'candidate_corrected'
  | 'candidate_removed'
  | 'manual_ingredient_added'
  | 'confirmation_abandoned'

export type EvaluationEvent = {
  type: EvaluationEventType
  at: string
  candidateId?: string
  name?: string
  originalName?: string
}

const events: EvaluationEvent[] = []

export function logEvaluationEvent(event: Omit<EvaluationEvent, 'at'>): void {
  const entry = { ...event, at: new Date().toISOString() }
  events.push(entry)
  if (import.meta.env?.DEV) {
    console.debug('[pic2food event]', entry)
  }
}

export function getEvaluationEvents(): readonly EvaluationEvent[] {
  return events
}

export function clearEvaluationEvents(): void {
  events.length = 0
}
