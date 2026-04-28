import { Knex } from 'knex'
import { ParsedEvent } from '../types/horizonSync.js'

/**
 * Idempotency Service
 * Handles checking and recording of processed operations to ensure exactly-once execution.
 */
export class IdempotencyService {
  private db: Knex

  constructor(db: Knex) {
    this.db = db
  }

  /**
   * Check if an event has already been processed.
   * 
   * @param eventId - Unique ID of the event
   * @param trx - Optional transaction to use for the check
   * @returns Promise<boolean> - True if already processed
   */
  async isEventProcessed(eventId: string, trx?: Knex.Transaction): Promise<boolean> {
    const query = (trx || this.db)('processed_events')
      .where({ event_id: eventId })
      .first()
    
    const result = await query
    return !!result
  }

  /**
   * Mark an event as processed in the database.
   * MUST be called within a transaction that includes the business logic operations.
   * 
   * @param event - The parsed event being processed
   * @param trx - Transaction to use for recording
   */
  async markEventProcessed(event: ParsedEvent, trx: Knex.Transaction): Promise<void> {
    await trx('processed_events').insert({
      event_id: event.eventId,
      transaction_hash: event.transactionHash,
      event_index: event.eventIndex,
      ledger_number: event.ledgerNumber,
      processed_at: new Date(),
      created_at: new Date()
    })
  }

  /**
   * General-purpose idempotency check for API requests.
   * Checks the idempotency_keys table.
   * 
   * @param key - The idempotency key provided by the client
   * @returns Promise<any | null> - The stored response if found, null otherwise
   */
  async getStoredResponse(key: string): Promise<any | null> {
    const record = await this.db('idempotency_keys')
      .where({ key })
      .first()
    
    return record ? record.response : null
  }

  /**
   * Store a response for a given idempotency key.
   * 
   * @param key - The idempotency key
   * @param response - The response payload to store
   * @param trx - Optional transaction
   */
  async storeResponse(key: string, response: any, trx?: Knex.Transaction): Promise<void> {
    await (trx || this.db)('idempotency_keys').insert({
      key,
      response: typeof response === 'string' ? response : JSON.stringify(response),
      created_at: new Date()
    })
  }
}

// In-memory idempotency store for testing
const idempotencyStore = new Map<string, { response: any; hash: string; vaultId?: string }>()

export const resetIdempotencyStore = (): void => {
  idempotencyStore.clear()
}

export const getIdempotentResponse = async <T>(key: string, hash: string): Promise<T | null> => {
  const stored = idempotencyStore.get(key)
  if (stored) {
    if (stored.hash === hash) {
      return stored.response as T
    } else {
      throw new IdempotencyConflictError('Idempotency key already used with a different request')
    }
  }
  return null
}

export const saveIdempotentResponse = async (key: string, hash: string, vaultId: string, response: any): Promise<void> => {
  idempotencyStore.set(key, { response, hash, vaultId })
}

export const hashRequestPayload = (payload: any): string => {
  return JSON.stringify(payload)
}

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdempotencyConflictError'
  }
}
