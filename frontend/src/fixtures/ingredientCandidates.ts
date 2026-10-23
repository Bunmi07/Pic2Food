/**
 * Fixed ingredient guesses for the first slice.
 * Replace this list (or the loader) when live vision is wired.
 * These are candidates, not confirmed inventory.
 */
export const INGREDIENT_CANDIDATE_FIXTURE = [
  { id: 'eggs', name: 'Eggs' },
  { id: 'bread', name: 'bread' },
  { id: 'milk', name: 'milk' },
  { id: 'potato', name: 'potato' },
  { id: 'cheese-slices', name: 'cheese slices' },
  {
    id: 'wrapped-block',
    description: 'Wrapped pale block',
    guesses: ['butter', 'cream cheese', 'tofu'],
  },
]
