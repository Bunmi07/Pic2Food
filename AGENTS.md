# AGENTS.md - Project Guidelines for Pic2Food

## Project Overview
* **Product Name:** Pic2Food
* **Description:**  A mobile-first web app (MVP), architected to inform a later native mobile experience. It identifies likely ingredients from a photo, has the user confirm them, and retrieves sourced recipes based on the confirmed ingredients. 
* **Target Audience:** consumer facing users

Pic2Food is a mobile-friendly web application that helps a user identify feasible recipes from a photo of available food ingredients.

The system proposes possible ingredients from the image, but the user must confirm, correct, remove, or add ingredients before recipe retrieval. Only user-confirmed ingredients may be treated as the available inventory.

The product retrieves existing recipes from approved sources. It does not invent recipes.

### Target User

A budget-conscious person who has food at home, is short on time or mental energy, and wants help deciding what to cook.

### Primary User Journey

1. The user uploads or takes a photo of available food ingredients.
2. The vision stage proposes ingredient relevant image regions and proposes ingredients candidates while exposing uncertainty.
3. The user confirms or corrects the proposed inventory.
4. The system applies the user’s constraints.
5. The system retrieves recipes from an approved source.
6. Deterministic logic filters and ranks eligible recipes.
7. The app displays sourced recommendations or an appropriate no-match response.

Refer to `Pic2Food_AI_PRD.md` for detailed product requirements, evaluation criteria, risks, and decisions.

## 2. Current Technical Environment

Do not assume frameworks, databases, vector stores, or orchestration libraries that are not already present in the repository.

Before proposing an implementation:

1. Inspect the existing project structure and dependency files.
2. Explain the current architecture in plain language.
3. Identify the smallest files that need to change.
4. State any assumptions or unresolved decisions.
5. Prefer the simplest implementation that satisfies the current milestone.

Do not add a database, vector store, agent framework, or LLM orchestration library unless the current requirement clearly needs it and the user explicitly approves it.

## 3. Non-Negotiable Product Boundaries

### Ingredient Grounding

- Vision-model outputs are candidates, not facts.
- Detected ingredients must render unchecked by default. The user actively checks each item to confirm it. Never pre-check a detected ingredient.
- Do not proceed to retrieval until the user has completed confirmation.
- Present at most three candidate guesses for a single ambiguous item. If the model cannot narrow to three, direct the user to manual entry instead of showing a longer guess list.
- Log confirmations and corrections/manual entries as distinct events. Do not collapse them into a single inventory write.
- Never silently convert an uncertain detection into a confirmed ingredient.
- Users must be able to accept, correct, remove, or add ingredients.
- Preserve uncertainty when the image does not provide enough evidence.
- Do not claim that an ingredient was identified with certainty.

### Recipe Grounding

- Never generate or invent a recipe for the MVP.
- Retrieve recipes only from an approved, attributable source.
- Every displayed recipe must include its source name and link.
- Do not add ingredients, quantities, instructions, cooking times, or claims absent from the source record.
- Clearly distinguish matched ingredients from missing ingredients.
- Abstain when no retrieved recipe meets the defined feasibility threshold.

### Allergies and Exclusions

- Never infer allergies, dietary requirements, or allergen absence from an image.
- Treat user-provided allergies and exclusions as hard constraints.
- A ranking score must never override a hard constraint.
- Do not describe a recommendation as “safe” or “allergen-free” unless an approved source explicitly supports that claim.
- When source information is incomplete, disclose the limitation or abstain.

### Food Safety

- Never determine freshness, spoilage, contamination, proper storage, doneness, or food safety from an image.
- Never reassure a user that food is safe to eat based on appearance.
- Do not provide medical or personalized nutrition advice.
- Display the approved food-safety limitation when relevant.

## 4. Architecture Boundaries

Keep these responsibilities separate:

1. Image validation
2. Vision-based ingredient candidate extraction
3. User confirmation and correction
4. Ingredient normalization
5. Constraint enforcement
6. Recipe retrieval
7. Deterministic feasibility scoring and ranking
8. Grounded explanation
9. Abstention and error handling
10. Evaluation and event logging

Do not describe or implement Pic2Food as an autonomous agent unless the product requirements explicitly change.

Use deterministic code for:

- Allergy and exclusion filtering
- Required-ingredient coverage
- Missing-ingredient calculations
- Feasibility thresholds
- Recipe ranking for the initial MVP
- Source-attribution validation
- Abstention decisions

### Image validation
- Downscale the image client-side before upload / before the vision call. Do not send full-resolution phone photos.

### Ingredient Normalization

- Confirmed ingredients are resolved to a single standardized name before recipe retrieval. The same ingredient often has several common names (for example, scallion, green onion, and spring onion refer to one item); unresolved naming variance silently reduces retrieval quality.
- Normalization is performed by deterministic code against an owned mapping file, not by a language model. Mapping is a rules task, not a judgment task. The model must never perform or invent a mapping.
- The mapping file is a flat dictionary (JSON): every alias points to one standardized name, and each standardized name also points to itself so lookup needs no special-case handling.
- Normalize input before lookup: lowercase, trim whitespace, and strip plurals where practical.
- Terms not found in the mapping file are logged as unknown terms and never guessed. Do not fabricate a mapping to force a match.
- Entries marked ambiguous (for example, "coriander," which refers to the leaf in some regions and the seed in others) must surface the ambiguity to the user; the code must not silently pick a sense.
- Do not introduce fuzzy matching, a vector store, or an external vocabulary service for the MVP without explicit approval.

### Unrecognized User-Entered Ingredients

When a user types an ingredient that is not found in the mapping file:

- Pass the raw term to recipe retrieval. If results return, proceed, and log the term as an unknown term for later review and addition to the mapping file.
- If no results return, tell the user the ingredient was not recognized.
- Do not apply fuzzy matching to "rescue" the term. A wrong guess passes through as fact with no visible signal.
- A search miss does not prove the ingredient is unknown, only that the current mapping did not cover it (for example, "courgette" versus a source's "zucchini"). This is why unknown terms are logged.
- Regardless of match outcome, an unmatched or unverifiable term must never unlock a recipe that allergy or exclusion filtering would otherwise remove.

### Non-food and Malinformed Input

- If the image does not appear to contain food, return an explicit non-food result, distinct from a recipe no-match. Message intent: "This doesn't look like food — try a photo of your ingredients."
- If food is present but not identifiable (dark, blurry, cluttered), return an explicit low-confidence / unreadable result. Message intent: "I can see food but couldn't identify anything clearly — try better lighting or spreading items out."
- These two outcomes must be distinguishable to the user and in logs.
- Photos of recipe cards / cookbook pages are out of scope: read ingredients from food, not text from images.

### Bounded AI Responsibilities

Every model task must define:
- The allowed input data
- The permitted output fields
- A structured output format when practical
- Prohibited claims and actions
- Expected behavior when evidence is insufficient
- Required downstream validation
- Whether user confirmation is required
- Model outputs are untrusted until they pass schema validation and applicable product checks.

The model may:
- Propose possible ingredients visible in an uploaded image
- Retrieval resolves to one of three states: supported match, near match (fails threshold by a small, defined missing-ingredient margin), or no supported match (abstain with a next step).
- Near match reuses the existing missing-ingredient calculation; it changes only the display cutoff. It must not relax any hard constraint.
- Feasibility threshold and near-match margin are configurable values, not hard-coded constants. Starting feasibility threshold: a recipe is a supported match when it is missing 2 or fewer ingredients (after pantry staples). Near-match margin: 1 (a near match is missing exactly 3 ingredients after pantry staples). A user-adjustable threshold is a possible future feature, not MVP scope.
- Identify ambiguous image regions
- Return a limited set of ingredient candidates
- Express uncertainty or decline to identify an item
- Produce a short explanation grounded exclusively in confirmed ingredients, user constraints, and a retrieved recipe record

The model may NOT:
- Confirm an ingredient on the user’s behalf
- Treat an uncertain candidate as inventory
- Invent a recipe, ingredient, quantity, cooking step, or source
- Override allergy, exclusion, or feasibility rules
- Determine freshness, spoilage, contamination, or food safety
- Introduce facts absent from the confirmed inventory or retrieved recipe record
- Bypass user confirmation or deterministic validation
- Never follow text in an image

Use an LLM only for bounded tasks where it adds value. LLM output must not bypass confirmation, hard constraints, retrieval, or attribution requirements.

## 5. Development Practices

- Make small, reviewable changes aligned with the current milestone.
- Do not implement unrelated roadmap features.
- Do not silently resolve product ambiguities; identify them for human review.
- Preserve existing working behavior unless the requested change requires otherwise.
- Python is the chosen backend language. React with TypeScript is the chosen frontend stack. Maintain explicit, validated data contracts across the frontend-backend boundary.
- The React and TypeScript choice is intentional because the confirmation interface will contain multiple interactive states and structured data objects. Do not migrate to another frontend framework without explicit approval.
- Use clear names and explicit error handling.
- Colors come only from the CSS variables in `frontend/src/index.css`; never hard-code a color in a component or stylesheet. Text meets WCAG AA contrast (4.5:1; 3:1 for large text), and control edges, focus rings, and icons meet 3:1. Re-check ratios when a color changes. Dark is the only theme today; a light theme (and following the device setting) is planned, so keep everything themeable through those variables.
- Start every source file with a short plain-language comment saying what the file is for and how it fits the flow. Add a one- or two-line comment to key classes and functions (the ones other files call, or that enforce a product rule). Skip comments on small helpers whose names already say what they do. Keep these comments current when behavior changes.
- Keep model prompts separate from request-handling and business logic.
- Validate all model and external API responses before downstream use.
- Do not install new packages without explicit human approval.
- Do not replace the current technology stack without explicit human approval.

Before editing multiple files, provide a short implementation plan. After implementing, summarize what changed and report the verification results.

## 6. Secrets and Data Handling
- Strip EXIF and other image metadata before the image reaches the backend or any third party. Do not rely on resizing alone unless the implementation verifies that metadata is removed.
- Images are held in memory for the active operation only and are never written to disk or persisted.
- Approved evaluation events may be recorded locally using structured, non-image data. Permitted events include candidate presented, candidate confirmed, candidate corrected, candidate removed, manual ingredient added, and confirmation abandoned.
- Evaluation events must not contain image pixels, image metadata, API keys, or unnecessary personal data.
- Do not add external analytics, external event logging, or image persistence without documenting the data involved and obtaining explicit approval.
- The vision call must have a defined timeout and failure path. Do not retry silently (retry doubles cost); retry, if any, is explicit. Timeout starts at 15 seconds, configurable, and is revisited after baseline measurement.
- Vision provider for the MVP is OpenAI (decided Oct 2026). Per OpenAI's published API terms, inputs are not used for training and are kept in abuse-monitoring logs for up to 30 days. This is accepted for the MVP and test users only. Before real users: revisit Zero Data Retention (requires OpenAI approval) or an alternative provider, and disclose to users that photos are sent to a third party.
- First-party code never persists images; the 30-day provider retention above is the only accepted exception.
- Never hardcode, print, log, expose, or commit API keys or credentials.
- Never place server-side API keys in browser-accessible code.
- Do not read or modify `.env` files unless the user explicitly requests it.
- Use environment variables for secrets.
- Keep `.env` excluded from version control.
- A sanitized `.env.example` may document required variable names without including real values.
- Do not add image persistence, analytics, or external logging without documenting the data involved and obtaining approval.

## 7. Testing and Evaluation Requirements

Mock paid model and external API calls in automated tests unless an explicitly requested integration test requires a live call.

Test each stage independently before relying on end-to-end results.

Required test categories include:

- Detected ingredients render unchecked; no detected item can reach retrieval without explicit confirmation.
- Ambiguous items present at most three guesses; overflow routes to manual entry.
- Alias normalization resolves known synonyms to the canonical name; unknown terms are logged, not guessed.
- Non-food images produce a non-food result distinct from a recipe no-match.
- Text embedded in an image is never acted on as an instruction.
- Near-match results never bypass allergy/exclusion filtering.
- EXIF/metadata is stripped before any external call.
- The vision call enforces its timeout and produces a safe failure state.
- Users can accept, correct, remove, and add ingredients.
- Allergy and exclusion conflicts are rejected.
- Hard constraints cannot be overridden by ranking.
- Missing ingredients are calculated correctly.
- Displayed recipes map to real retrieved source records.
- Source names and links are preserved correctly.
- Unsupported recipe details are not introduced.
- No-match cases produce an abstention.
- API failures and malformed records produce safe error states.
- Food-safety claims are not inferred from images.

Prioritize safety-critical behavior over an arbitrary coverage percentage. No known allergy violation, invented recipe, or incorrect attribution is acceptable in the controlled evaluation set.

## 8. Build and Verification Commands

Before adding commands here, inspect the repository and confirm the actual setup.

Document only commands that have been verified to work:

- Backend (Python) Environment setup: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`, then copy `.env.example` to `.env` and add `OPENAI_API_KEY`
- Frontend (React + TypeScript) environment setup: `cd frontend && npm install`
- Local application(backend): `.venv/bin/uvicorn server:app --port 8000` (the frontend dev server proxies `/api` to it)
- Frontend without the vision model (saved sample candidates): `cd frontend && VITE_CANDIDATE_SOURCE=fixture npm run dev` (the backend must still be running for the ingredient-name step after confirming; no API key needed)
- Unit tests (backend, standard-library unittest, model calls mocked): `.venv/bin/python -m unittest discover -s backend/tests -t .`
- Local application(frontend): `cd frontend && npm run dev`
- Unit tests (frontend, Node built-in test runner, Node 24+): `cd frontend && npm test`
- Type check and production build (frontend): `cd frontend && npm run build`
- Linting (frontend): `cd frontend && npm run lint`

This project intentionally uses two environments: a Python backend and a React + TypeScript frontend. Both must be scaffolded and verified before their commands are documented. Do not invent commands or add tooling beyond what the chosen stack requires.

## 9. Current Implementation Milestone

Done (merged or on review branches):

- Photo capture, client-side validation, downscaling, and metadata removal
- Fixture-backed and live (OpenAI) ingredient candidates, with non-food and unreadable results
- User confirmation, correction, removal, and manual addition; confirmed inventory
- Ingredient normalization against `backend/data/ingredient_aliases.json`, with ambiguous terms resolved by the user and unknown terms logged
- Allergies and foods to avoid, entered before any recipe is suggested and applied as hard constraints to every result, including near matches (`backend/constraints.py`)
- Recipe retrieval from TheMealDB (`backend/mealdb_client.py`, `backend/recipe_search.py`), with source name and link on every recipe and malformed records skipped
- Deterministic feasibility and ranking (`backend/feasibility.py`): supported match, near match, or abstention, with matched, missing, and assumed-staple ingredients shown (`frontend/src/components/RecipeResults.tsx`)
- Grounded explanation (`backend/explanations.py`, `POST /api/recipe-explanations`): every recipe card has a "Why this fits you" line built by code from the recipe and the user's ingredients. For the top three, an OpenAI model may reword that line. It sees only the recipe title, ingredients the user has, ingredients they'd need, and sugar swaps. Code adds "Recipes listing X were left out." Each model line is checked by code (length, no numbers or links, no words like "safe" or "healthy", no food that isn't in the recipe facts) and falls back to the code-built line if it fails, times out, or there's no API key. Model-worded lines are labelled "Worded by AI from this recipe and your ingredients." Settings: `EXPLANATION_MODEL`, `EXPLANATION_TIMEOUT_SECONDS`.
- Deterministic evaluation set (`backend/evaluation.py`, `backend/data/evaluation_scenarios.json`, `backend/data/evaluation_catalog.json`): 14 labeled kitchens scored through the same search the app uses, against a frozen catalog. Checks are result state, recipe ids, hard constraints, source name and link, and the code-built explanation. A confirmed ingredient that clashes with an allergy or food to avoid is scored as a refused search. No photo and no model call.

This is a local prototype: it runs on the developer's machine only and is not hosted.

Decided for these slices:

- Pantry staples (never counted as missing): salt, black pepper, cooking oil (including olive oil), and water.
- A recipe ingredient written only as "Pepper" (or "Ground Pepper") is read as black pepper, so it counts as a staple, and the screen says so ("we read this as black pepper"). Allergy and food-to-avoid checks test both the written name and the assumed one. Named peppers (red, bell, cayenne, ...) are not assumed. Later idea, not MVP: work out the likely pepper from other recipes or another source.
- Supported match: missing 2 or fewer ingredients after staples. Near match: missing exactly 3. Anything more is not shown.
- If TheMealDB gives no original source link for a recipe, cite the TheMealDB recipe page.
- Allergies: the user ticks any of nine allergens (milk, egg, fish, shellfish, tree nuts, peanuts, wheat, soy, sesame), and the words each one covers live in `backend/data/allergen_groups.json`. Foods to avoid are typed freely and matched by name, plus alias-file names. If the typed word names a food family in `backend/data/food_families.json` ("pork", "meat", "dairy", "nuts", "gluten", "alcohol", ...), the whole family is blocked ("pork" blocks bacon, ham, lard, gelatin). Families may reuse allergen lists, so "dairy" gets the full milk list. Family lists need the same product review as the allergen list. Matching is whole-word and errs toward blocking ("peanut" blocks "peanut oil"; "nut" does not block "nutmeg").
- If a confirmed ingredient clashes with an allergy or a food to avoid, recipe search is blocked until the user removes the ingredient or changes the allergy. Nothing is removed automatically.
- If a recipe ingredient can't be checked against the user's allergies (it isn't in the alias or allergen file), the recipe may be shown, but only with a visible warning naming those ingredients. A blocked ingredient always removes the recipe.
- Allergy choices stay in the browser session and are never logged.
- Every search checks TheMealDB's whole catalog (about 800 recipes), loaded into server memory on the first search and reloaded after `RECIPE_CATALOG_HOURS` (default 24). Nothing is written to disk.
- Retrieval settings (TheMealDB address and key, timeout, catalog reload hours, and the match thresholds) are environment variables listed in `.env.example`.

- The alias file covers the most common TheMealDB ingredients (single, whole foods only). Blends and packaged products whose contents vary by brand (stock cubes, curry pastes, sauces, spice blends, baking powder, plain "oil" or "vinegar") are deliberately left out so they keep the allergy warning. Preparation words ("chopped", "fresh") are ignored when deciding whether an ingredient is recognized.

Signed off Oct 2026: the alias, allergen, and food-family additions from the TheMealDB catalog review, including "red pepper" read as bell pepper; marshmallow treated as pork (gelatin); gochujang, doubanjiang, and chilli bean paste blocked for both wheat and soy; oats recognized (not wheat, though often cross-contaminated).

Decided Oct 2026: coconut is not a tree nut (recognized, never blocked by the tree-nut allergy). Sugar types are swappable: if the user has any sugar and the recipe asks for a different type (caster, icing, brown, ...), it counts as something they have, with a visible note naming both so the user judges. With no sugar at all it is still missing. Exact matches rank above swaps. The swap groups live in `SWAP_GROUPS` in `backend/feasibility.py`.

Decided Oct 2026 (grounded explanation): the model only rewords facts code already worked out. Allergies and foods to avoid are never sent to the model. The code-built line is always the fallback, and model-worded lines carry an AI label.

Open: the model-worded lines have not yet been checked live (no API key was set during the build); check the share of lines that fall back once a key is in `.env`. The evaluation set is not the full 30 scenarios from the PRD: photo checks (precision, recall, non-food, unreadable) are not scored yet.

Possible later work, not MVP: regional ingredient names (suggesting the likely meaning based on the user's region), a user-adjustable threshold, and remembering allergies on the user's device.

Do not connect a recipe API, ranking, or generated explanation ahead of the allergy and exclusion step.

Do not implement accounts, payments, grocery ordering, multi-day meal planning, medical nutrition guidance, recipe generation, autonomous agents, or image-based food-safety judgments.


