/**
 * The "Recipes" card: runs the search once the allergy check is clear and
 * shows the outcome.
 *
 * - supported: up to three recipes you can make now
 * - near_match: up to three recipes that each need a few more things
 * - no_match: a plain "nothing close enough" with next steps
 *
 * Each recipe shows its source and link, a short "why this fits you" line
 * (code-written, swapped for a checked AI wording when one arrives), what you have, what you'd need,
 * the pantry staples it assumes, and any ingredients we couldn't check
 * against your allergies. Recipe text is shown exactly as the source gave it.
 * App remounts this card whenever the ingredients or constraints change, so
 * results are never stale.
 */
import { useEffect, useRef, useState } from 'react'
import type { UserConstraints } from '../constraints'
import type { ReadyIngredient } from '../normalizeInventory'
import {
  itemLabel,
  requestRecipeSearch,
  stapleLabel,
  swapNote,
  type Recipe,
  type RecipeSearchResult,
} from '../recipeSearch'
import { requestExplanations, type Explanation } from '../recipeExplanations'

type RecipeResultsProps = {
  ingredients: ReadyIngredient[]
  constraints: UserConstraints
}

type SearchState = { status: 'loading' } | RecipeSearchResult

export function RecipeResults({ ingredients, constraints }: RecipeResultsProps) {
  const cardRef = useRef<HTMLElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<SearchState>({ status: 'loading' })
  const [explanations, setExplanations] = useState<Map<string, Explanation> | null>(null)

  useEffect(() => {
    let cancelled = false
    const names = ingredients.map((item) => item.name)
    requestRecipeSearch(names, constraints).then((result) => {
      if (cancelled) return
      setState(result)
      if (!result.ok || result.recipes.length === 0) return
      const ids = result.recipes.map((recipe) => recipe.id)
      requestExplanations(names, constraints, ids).then((lines) => {
        if (!cancelled) setExplanations(lines)
      })
    })
    return () => {
      cancelled = true
    }
  }, [ingredients, constraints, attempt])

  useEffect(() => {
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  function retry() {
    setState({ status: 'loading' })
    setExplanations(null)
    setAttempt((value) => value + 1)
  }

  return (
    <section ref={cardRef} className="card" aria-labelledby="recipes-heading" aria-live="polite">
      <h2 id="recipes-heading">{heading(state)}</h2>

      {'status' in state && state.status === 'loading' ? (
        <p>Searching TheMealDB for recipes that use your ingredients…</p>
      ) : null}

      {'ok' in state && !state.ok ? (
        <>
          <p className="photo-error" role="alert">
            {state.message}
          </p>
          {state.canRetry ? (
            <button type="button" className="primary-action" onClick={retry}>
              Try again
            </button>
          ) : null}
        </>
      ) : null}

      {'ok' in state && state.ok ? (
        <>
          {state.status === 'near_match' ? (
            <p>
              Nothing uses only what you have, but these come close. Each one
              needs a few things you didn’t list.
            </p>
          ) : null}

          {state.status === 'no_match' ? (
            <>
              <p>
                We couldn’t find a recipe that’s close enough to what you have.
                You could:
              </p>
              <ul>
                <li>Add ingredients you have that weren’t in the photo (above).</li>
                <li>Take another photo with more of your food in it.</li>
                <li>Remove a food to avoid if it isn’t essential to you.</li>
              </ul>
            </>
          ) : null}

          {state.notFound.length > 0 ? (
            <p className="hint">
              TheMealDB doesn’t list{' '}
              {state.notFound.map((name) => `“${name.trim()}”`).join(', ')}, so{' '}
              {state.notFound.length === 1 ? 'it wasn’t' : 'they weren’t'} used in the
              search.
            </p>
          ) : null}

          {state.recipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              near={state.status === 'near_match'}
              explanation={explanations?.get(recipe.id)}
            />
          ))}

          <p className="hint">
            Recipes come from TheMealDB, a community recipe site, and haven’t
            been checked by us. We can’t tell whether food is fresh or safe to
            eat, so use your judgment and follow the original recipe.
          </p>
        </>
      ) : null}
    </section>
  )
}

function heading(state: SearchState): string {
  if (!('ok' in state) || !state.ok) return 'Recipes'
  if (state.status === 'supported') return 'Recipes you can make'
  if (state.status === 'near_match') return 'Close matches'
  return 'No good match yet'
}

type RecipeCardProps = { recipe: Recipe; near: boolean; explanation?: Explanation }

function RecipeCard({ recipe, near, explanation }: RecipeCardProps) {
  const meta = [recipe.area, recipe.category].filter(Boolean).join(' · ')
  const viaMealDb = recipe.source.url !== recipe.mealdbUrl
  const why = explanation ?? { text: recipe.explanation, byAi: false }

  return (
    <article className="recipe-card">
      {recipe.imageUrl ? (
        <img className="recipe-image" src={recipe.imageUrl} alt="" loading="lazy" />
      ) : null}
      <div className="recipe-body">
        <h3>{recipe.title}</h3>
        {meta ? <p className="recipe-meta">{meta}</p> : null}
        <p className="recipe-meta">
          Source:{' '}
          <a href={recipe.source.url} target="_blank" rel="noopener noreferrer">
            {recipe.source.name}
          </a>
          {viaMealDb ? (
            <>
              {' · via '}
              <a href={recipe.mealdbUrl} target="_blank" rel="noopener noreferrer">
                TheMealDB
              </a>
            </>
          ) : null}
        </p>

        {near ? (
          <p className="badge">
            Needs {recipe.missing.length} more ingredient{recipe.missing.length === 1 ? '' : 's'}
          </p>
        ) : null}

        <div className="recipe-why">
          <h4>Why this fits you</h4>
          <p>{why.text}</p>
          {why.byAi ? (
            <p className="hint">Worded by AI from this recipe and your ingredients.</p>
          ) : null}
        </div>

        <h4>You have</h4>
        <ul>
          {recipe.matched.map((item, index) => {
            const note = swapNote(item)
            return (
              <li key={`${item.name}-${index}`}>
                {itemLabel(item)}
                {note ? <span className="swap-note">{note}</span> : null}
              </li>
            )
          })}
        </ul>

        <h4>You’d need</h4>
        {recipe.missing.length > 0 ? (
          <ul>
            {recipe.missing.map((item, index) => (
              <li key={`${item.name}-${index}`}>{itemLabel(item)}</li>
            ))}
          </ul>
        ) : (
          <p>Nothing else from your list.</p>
        )}

        {recipe.staples.length > 0 ? (
          <p className="hint">
            Also uses pantry staples we assume you have:{' '}
            {recipe.staples.map(stapleLabel).join(', ')}.
          </p>
        ) : null}

        {recipe.uncheckedAllergy.length > 0 ? (
          <p className="recipe-warning" role="note">
            We couldn’t check these against your allergies:{' '}
            {recipe.uncheckedAllergy.join(', ')}. Check them before cooking.
          </p>
        ) : null}

        <details className="recipe-details">
          <summary>Full ingredients and method from the source</summary>
          <ul>
            {recipe.ingredients.map((item, index) => (
              <li key={`${item.name}-${index}`}>
                {item.measure ? `${item.measure} ` : ''}
                {item.name}
              </li>
            ))}
          </ul>
          {recipe.instructions
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line, index) => (
              <p key={index}>{line}</p>
            ))}
        </details>
      </div>
    </article>
  )
}
