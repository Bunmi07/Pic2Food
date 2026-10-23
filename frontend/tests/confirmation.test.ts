import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import {
  confirmationEvents,
  countConfirmedRows,
  createConfirmedInventory,
  createManualRow,
  rowsFromCandidates,
  type CandidateRow,
} from '../src/confirmedInventory.ts'
import {
  clearEvaluationEvents,
  getEvaluationEvents,
  logEvaluationEvent,
} from '../src/eventLog.ts'
import { INGREDIENT_CANDIDATE_FIXTURE } from '../src/fixtures/ingredientCandidates.ts'
import {
  MAX_GUESSES_PER_ITEM,
  parseIngredientCandidates,
} from '../src/loadIngredientCandidates.ts'

function fixtureRows(): CandidateRow[] {
  const result = parseIngredientCandidates(INGREDIENT_CANDIDATE_FIXTURE)
  assert.ok(result.ok)
  return rowsFromCandidates(result.items)
}

function check(rows: CandidateRow[], id: string, patch: Partial<CandidateRow> = {}) {
  return rows.map((row) =>
    row.id === id ? { ...row, confirmed: true, ...patch } : row,
  )
}

describe('detected candidates', () => {
  test('render unchecked by default', () => {
    const rows = fixtureRows()
    assert.ok(rows.length > 0)
    assert.ok(rows.every((row) => row.confirmed === false))
  })

  test('cannot reach inventory without explicit confirmation', () => {
    const result = createConfirmedInventory(fixtureRows())
    assert.equal(result.ok, false)
  })

  test('only checked items enter inventory', () => {
    const rows = check(check(fixtureRows(), 'eggs'), 'milk')
    const result = createConfirmedInventory(rows)
    assert.ok(result.ok)
    assert.deepEqual(
      result.inventory.ingredients.map((item) => item.name),
      ['Eggs', 'milk'],
    )
  })

  test('removed items do not enter inventory', () => {
    const rows = check(fixtureRows(), 'eggs').filter((row) => row.id !== 'eggs')
    assert.equal(createConfirmedInventory(rows).ok, false)
  })
})

describe('ambiguous candidates', () => {
  test(`present at most ${MAX_GUESSES_PER_ITEM} guesses`, () => {
    const rows = fixtureRows()
    for (const row of rows) {
      assert.ok(row.guesses.length <= MAX_GUESSES_PER_ITEM)
    }
    const ambiguous = rows.find((row) => row.id === 'wrapped-block')
    assert.equal(ambiguous?.kind, 'ambiguous')
    assert.deepEqual(ambiguous?.guesses, ['butter', 'cream cheese', 'tofu'])
  })

  const overflowInput = [
    { id: 'unclear', description: 'Unclear item', guesses: ['a', 'b', 'c', 'd'] },
  ]

  test('more than three guesses route to manual entry', () => {
    const result = parseIngredientCandidates(overflowInput)
    assert.ok(result.ok)
    const [overflow] = rowsFromCandidates(result.items)
    assert.equal(overflow.kind, 'manual-entry')
    assert.deepEqual(overflow.guesses, [])
  })

  test('manual-entry items never enter inventory, even if forced checked', () => {
    const result = parseIngredientCandidates(overflowInput)
    assert.ok(result.ok)
    const rows = check(rowsFromCandidates(result.items), 'unclear', { name: 'a' })
    assert.equal(countConfirmedRows(rows), 0)
    assert.equal(createConfirmedInventory(rows).ok, false)
  })

  test('checked ambiguous item with no guess picked is excluded', () => {
    const rows = check(fixtureRows(), 'wrapped-block')
    assert.equal(createConfirmedInventory(rows).ok, false)
  })

  test('picking a guess and checking it confirms that guess', () => {
    const rows = check(fixtureRows(), 'wrapped-block', { name: 'butter' })
    const result = createConfirmedInventory(rows)
    assert.ok(result.ok)
    assert.deepEqual(result.inventory.ingredients[0], {
      candidateId: 'wrapped-block',
      name: 'butter',
      originalName: 'Wrapped pale block',
      source: 'confirmed',
    })
  })
})

describe('accept, correct, remove, add', () => {
  test('corrected name is recorded as corrected', () => {
    const rows = check(fixtureRows(), 'potato', { name: 'sweet potato' })
    const result = createConfirmedInventory(rows)
    assert.ok(result.ok)
    assert.equal(result.inventory.ingredients[0].source, 'corrected')
    assert.equal(result.inventory.ingredients[0].originalName, 'potato')
  })

  test('manual additions are recorded as manual', () => {
    const rows = [...fixtureRows(), createManualRow('manual-1', '  onion ')]
    const result = createConfirmedInventory(rows)
    assert.ok(result.ok)
    assert.deepEqual(result.inventory.ingredients, [
      { candidateId: 'manual-1', name: 'onion', originalName: 'onion', source: 'manual' },
    ])
  })
})

describe('candidate parsing', () => {
  test('malformed or empty input is a safe failure', () => {
    assert.equal(parseIngredientCandidates(null).ok, false)
    assert.equal(parseIngredientCandidates([]).ok, false)
    assert.equal(parseIngredientCandidates([{ id: 'x' }]).ok, false)
    assert.equal(parseIngredientCandidates([{ name: 'egg' }]).ok, false)
    assert.equal(
      parseIngredientCandidates([
        { id: 'a', name: 'egg' },
        { id: 'a', name: 'milk' },
      ]).ok,
      false,
    )
  })
})

describe('evaluation events', () => {
  beforeEach(() => clearEvaluationEvents())

  test('confirmations and corrections are distinct events', () => {
    let rows = check(fixtureRows(), 'eggs')
    rows = check(rows, 'potato', { name: 'sweet potato' })
    rows = [...rows, createManualRow('manual-1', 'onion')]
    const result = createConfirmedInventory(rows)
    assert.ok(result.ok)

    const events = confirmationEvents(result.inventory)
    assert.deepEqual(
      events.map((event) => event.type),
      ['candidate_confirmed', 'candidate_corrected'],
    )
  })

  test('logged events carry only structured, non-image fields', () => {
    logEvaluationEvent({ type: 'candidate_presented', candidateId: 'eggs', name: 'Eggs' })
    const [event] = getEvaluationEvents()
    assert.deepEqual(Object.keys(event).sort(), ['at', 'candidateId', 'name', 'type'])
  })
})
