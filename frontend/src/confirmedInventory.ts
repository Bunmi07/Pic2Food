/**
 * The rules for turning guesses into a confirmed inventory. No screen code.
 *
 * A CandidateRow is one line in the checklist. The ConfirmedInventory is what
 * later steps (recipe search) are allowed to use, and it only ever contains
 * rows the user checked. Each confirmed item records whether it was accepted
 * as guessed, corrected, or added by hand.
 */
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

/** Build checklist rows from detected guesses. Every row starts unchecked. */
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

/** A row the user typed in. Checked by default, since the user entered it. */
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

/** Was this item accepted as guessed, corrected by the user, or typed in? */
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

/**
 * The gate before recipe search: keep only checked rows with a real name.
 * Fails if nothing is checked, so unconfirmed guesses can't move downstream.
 */
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
