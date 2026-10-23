import type { EvaluationEvent } from './eventLog.ts'
import type { IngredientCandidate } from './loadIngredientCandidates.ts'

export type InventorySource = 'confirmed' | 'corrected' | 'manual'

export type CandidateRow = {
  id: string
  origin: 'detected' | 'manual'
  kind: IngredientCandidate['kind']
  description: string | null
  guesses: string[]
  originalName: string
  name: string
  confirmed: boolean
}

export type ConfirmedIngredient = {
  candidateId: string
  name: string
  originalName: string
  source: InventorySource
}

export type ConfirmedInventory = {
  ingredients: ConfirmedIngredient[]
}

export function rowsFromCandidates(items: IngredientCandidate[]): CandidateRow[] {
  return items.map((item) => {
    if (item.kind === 'named') {
      return {
        id: item.id,
        origin: 'detected',
        kind: item.kind,
        description: null,
        guesses: [],
        originalName: item.name,
        name: item.name,
        confirmed: false,
      }
    }
    return {
      id: item.id,
      origin: 'detected',
      kind: item.kind,
      description: item.description,
      guesses: item.kind === 'ambiguous' ? item.guesses : [],
      originalName: item.description,
      name: '',
      confirmed: false,
    }
  })
}

export function createManualRow(id: string, name: string): CandidateRow {
  const trimmed = name.trim()
  return {
    id,
    origin: 'manual',
    kind: 'named',
    description: null,
    guesses: [],
    originalName: trimmed,
    name: trimmed,
    confirmed: true,
  }
}

/** A row can only be confirmed once it has a concrete name. */
export function canConfirmRow(row: CandidateRow): boolean {
  return row.kind !== 'manual-entry' && row.name.trim() !== ''
}

export function countConfirmedRows(rows: CandidateRow[]): number {
  return rows.filter((row) => row.confirmed && canConfirmRow(row)).length
}

export function sourceForRow(row: CandidateRow): InventorySource {
  if (row.origin === 'manual') {
    return 'manual'
  }
  const name = row.name.trim()
  if (row.kind === 'ambiguous') {
    return row.guesses.includes(name) ? 'confirmed' : 'corrected'
  }
  return name === row.originalName.trim() ? 'confirmed' : 'corrected'
}

export function createConfirmedInventory(
  rows: CandidateRow[],
): { ok: true; inventory: ConfirmedInventory } | { ok: false; message: string } {
  const ingredients: ConfirmedIngredient[] = rows
    .filter((row) => row.confirmed && canConfirmRow(row))
    .map((row) => ({
      candidateId: row.id,
      name: row.name.trim(),
      originalName: row.originalName,
      source: sourceForRow(row),
    }))

  if (ingredients.length === 0) {
    return {
      ok: false,
      message: 'Check each ingredient you actually have, or add one, before confirming.',
    }
  }

  return { ok: true, inventory: { ingredients } }
}

/**
 * One event per detected item at confirmation time. Manual additions are
 * logged when they are added, so they are not repeated here.
 */
export function confirmationEvents(
  inventory: ConfirmedInventory,
): Omit<EvaluationEvent, 'at'>[] {
  return inventory.ingredients
    .filter((item) => item.source !== 'manual')
    .map((item) =>
      item.source === 'corrected'
        ? {
            type: 'candidate_corrected' as const,
            candidateId: item.candidateId,
            name: item.name,
            originalName: item.originalName,
          }
        : {
            type: 'candidate_confirmed' as const,
            candidateId: item.candidateId,
            name: item.name,
          },
    )
}
