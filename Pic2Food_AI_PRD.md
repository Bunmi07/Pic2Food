Pic2Food AI Product Control Document

**Version:** 0.1  
**Status:** MVP definition - Implemenation Baseline  
**Product owner:** Bunmi Ogidan  
**Purpose:** Establish the product intent, operating boundaries, grounding sources, evaluation plan, and release criteria for a portfolio-quality AI product.

## 1. Product thesis

People often arrive home tired, want to avoid ordering food, and still spend significant mental effort deciding what to cook from ingredients they already have. Pic2Food reduces that decision burden by turning a photo of available ingredients into a small set of supported, realistic recipe options.

The product is not intended to generate novel recipes. It identifies likely ingredients, asks the user to confirm or correct them, retrieves recipes from an approved source, and explains why each result fits. When the available ingredients or evidence are insufficient, it says so and gives the user a useful next step.

## 2. Use cases

### Primary user

A budget-conscious person who has food at home, is short on time or mental energy, and wants help deciding what to cook.

### User Scenario

> When I am tired and cannot decide what to cook, help me quickly understand what I can make from ingredients I already have so I can avoid unnecessary takeout and reduce food waste.

### Initial context

- Mobile browser
- One user
- One photo or a small number of photos
- Dinner or general meal decision
- Recipes available from an approved source
- English-language experience for MVP

## 3. Product outcome

The MVP succeeds when it helps a user move from an undecided state to selecting a feasible recipe in a few minutes, without inventing recipes or concealing uncertainty.

### Primary product metric

**Supported recipe selection rate:** Percentage of sessions in which the user selects or opens a retrieved recipe after confirming the detected ingredients.

### Supporting metrics

- Median time from photo upload to recipe selection
- Ingredient-confirmation completion rate
- Percentage of detected ingredients accepted without correction
- Recipe-result click or selection rate
- Percentage of sessions resulting in an appropriate no-match response
- User-rated usefulness
- User-reported likelihood that the suggestion prevented takeout
- Repeat use, when identity or local session tracking is introduced

## 4. MVP scope

### In scope

1. User uploads or takes a photo from a mobile browser.
2. A vision-capable model proposes a structured list of visible ingredients.
3. The interface displays the proposed ingredients and asks the user to confirm, remove, or add items.
4. The user may provide a small number of constraints:
   - Maximum cooking time
   - Dietary preference
   - Allergies or excluded ingredients
   - Pantry staples available
5. The system searches an approved recipe source.
6. It returns up to three recipes ranked by feasibility.
7. Each result displays:
   - Recipe title
   - Source and link
   - Detected ingredients it uses
   - Missing ingredients
   - Estimated time when source data provides it
   - A short, source-grounded explanation of why it was recommended
8. The system abstains when no recipe meets the defined match threshold.
9. The system records evaluation-relevant events without storing the user's image longer than necessary.

### Explicitly out of scope for MVP

- Native iOS or Android application
- Accounts, social features, grocery ordering, or payments
- Meal planning across multiple days
- Personalized health or medical nutrition advice
- Calorie or nutrient guarantees
- Inventing a new recipe when retrieval returns no acceptable match
- Determining whether food is safe to eat from an image
- Guaranteeing freshness, spoilage, doneness, allergen absence, or cross-contamination safety
- Supporting every cuisine in the first release
- Fine-tuning a model

## 5. Critical product decisions

### 5.1 Mobile web before native mobile

The user context is mobile, but a responsive web application is sufficient to test the core value proposition. Native mobile development adds distribution and device complexity without validating whether users value the recommendation workflow.

### 5.2 User confirmation before retrieval

Image recognition will be uncertain, especially for packaged, obscured, visually similar, or culturally specific ingredients. The system must show its proposed ingredient list and require confirmation before using it to retrieve recipes. This makes uncertainty visible and gives the user control.

### 5.3 Retrieval before generation

The MVP retrieves existing recipes from an approved source. The model may summarize why a recipe matches, but it may not create unsupported ingredients, quantities, or cooking steps. Recipe instructions must remain attributable to the source.

### 5.4 Abstention is a valid product outcome

Retrieval produces one of three outcomes rather than a binary match / no-match.

- **Supported match:** One or more recipes meet the feasibility threshold. Up to three are displayed, ranked.

- **Near match:** No recipe meets the threshold, but one or more fall short by a small, defined margin (a small number of missing ingredients). These are displayed as near matches, clearly labelled as requiring items the user does not have, ranked by ascending missing-ingredient burden. This is a result, not a failure message. The ranking logic already computes missing ingredients for every candidate; near match changes only the display cutoff, not the underlying calculation.

- **No supported match:** No recipe meets either threshold. The system abstains, states plainly that it could not find a sufficiently supported match, and offers a next step: add pantry staples not shown, supply another photo, or relax dietary or time constraints.

The feasibility threshold and the near-match margin are configurable values, not fixed constants. Abstention rate is measured across threshold settings against the controlled evaluation set to identify the point at which loosening the threshold buys meaningful coverage without producing unrealistic recommendations.

- **Near match must not weaken any hard constraint:**  Allergy and exclusion filtering are applied before feasibility scoring. A recipe removed by a hard constraint is never eligible as a near match.

### 5.5 Do not infer food safety from appearance

A photo alone cannot reliably establish that food is safe, spoiled, contaminated, or properly stored. The MVP must not label food safe or unsafe from an image. If the user asks about safety, the product should explain the limitation and direct them to official storage guidance or recommend discarding food when they are uncertain.

### 5.6 Prerequisites and user guidance

Before capture, the product sets two expectations that materially affect result quality.

- **Photo guidance:** Results depend on image clarity. The interface displays brief guidance before the camera opens: use good lighting, spread ingredients out where possible, and avoid photographing items through closed packaging or behind other objects. This guidance shifts the input distribution toward cases the system handles well. It does not eliminate poor input, which is why low-light, cluttered, and partially-hidden scenarios remain explicit evaluation slices.

- **Pantry staples:** The interface presents a short list of commonly available pantry staples, but the user must explicitly confirm the pantry list before retrieval. Pantry items are not inferred from the image or silently added to inventory.

Salt, pepper, cooking oil, and sugar may be presented as suggested staples. Butter, flour, eggs, dairy products, nuts, and other ingredients with meaningful allergen, dietary, or recipe-feasibility implications must not be assumed automatically.

Allergy and exclusion constraints apply to pantry staples as well as photographed ingredients.

### Pantry confirmation default

Detected ingredients render unchecked and require individual confirmation. Suggested pantry staples may be displayed as a separate editable list, but the user must confirm that list before retrieval. Inaction must not become consent for either detected ingredients or pantry availability.

Image-confirmed ingredients and user-confirmed pantry staples must remain distinguishable in the data model and evaluation events.

### User confirmation and event logging
- All detected ingredients render unchecked. The user must actively confirm each item. Nothing proceeds to retrieval until confirmation is complete. Rationale: this is food a person will ingest, so inaction must never become consent.
- The model returns at most three candidate guesses for any single ambiguous item. More than three indicates the model cannot identify the item, in which case the interface directs the user to manual text entry rather than presenting a long guess list.
- Confirmations and corrections are logged as distinct events. A confirmed proposal indicates the model was correct. A correction or manual override indicates the model was wrong and supplies the correct label. Both resolve to the same inventory, but they are different signals; the correction is the more valuable one and must not be collapsed into the confirmation event.

## 6. Grounding and data contract

### MVP recipe source recommendation

Use **TheMealDB API** for the first prototype because it provides structured recipe records and permits development use through official endpoints. The MVP must display source attribution. The development key is for development or educational use; a paid supporter key is required before publishing an app to an app store.

TheMealDB is a crowd-sourced recipe database. Its inclusion does not mean every recipe has been scientifically or professionally validated. For the portfolio MVP, create a controlled subset of recipes and manually review the records used in the evaluation set for completeness, coherent instructions, and usable ingredient mappings.

### Ingredient Normalization 

Confirmed ingredients must be resolved to a single internal vocabulary before retrieval. The same ingredient carries multiple common names — scallion, green onion, and spring onion refer to one item — and unresolved naming variance silently caps retrieval quality.

- **Mechanism:**: Normalization is performed by deterministic code against an owned mapping file, not by a language model. Mapping is a rules task, not a judgment task. A model-generated mapping can be plausible and wrong with no visible signal, whereas a mapping file can be inspected, tested, and corrected.

- **Structure:** A flat dictionary in JSON, where every alias maps to one standardardized name, and each standardardized name also maps to itself so lookup requires no special-case handling. Input is normalized before lookup: lowercased, trimmed, and plural-stripped where practical. Reverse lookup (standardardized name to all known aliases) is generated at load time rather than hand-maintained, so the two cannot drift out of sync.

- **Ambiguity:** Some terms are genuinely ambiguous across regions and cuisines. Coriander refers to the leaf in some regions and the seed in others. Such entries carry an ambiguity flag, and the system surfaces the ambiguity to the user rather than selecting a sense. Restraint is measured: ambiguity-flag rate is a tracked metric, not only mapping hit rate.

- **Construction and growth:** The initial table is built from the ingredients present in the controlled evaluation scenarios and the recipes matched against them, not from a speculative ingredient list. Completeness is defined relative to the evaluation set. Terms encountered at runtime that are absent from the table are logged as unknown terms and never guessed. The table grows from logged evidence.

- ** Stated limitations:** A flat file is appropriate below roughly one thousand entries and becomes unwieldy beyond that, or where fuzzy matching or concurrent editing is required. A future version separates normalization into two layers: confirmed term to internal standardardized vocabulary (source-agnostic), and standardardized vocabulary to each source's dialect (a thin per-source adapter). That separation is what makes normalization measurable across multiple recipe sources, and it allows a failed match to be attributed to detection, standardization, or the source adapter rather than being collapsed into a single opaque failure. The MVP uses a single curated mapping against one source.

#### Metrics.

- **standardardization accuracy:** exact match of confirmed term to expected standardardized concept against a fixed list.
- Unknown-term rate.
- Ambiguity-flag rate.
### Alternative for a later version

**Edamam Recipe Search API** provides broader recipe search and cuisine, diet, and allergy filters. Many results are third-party web recipes, and the standard API returns source links rather than licensed cooking instructions. Its attribution, caching, and usage restrictions must be respected.

### Food storage and safety source

Use **USDA FoodKeeper data** for storage guidance in a future safety-information feature. This source may provide storage timelines, but it still does not make image-based spoilage detection reliable.

### Data fields required for each controlled recipe

- Stable recipe ID
- Recipe name
- Source name and URL
- Cuisine or region, when available
- Ingredient list
- Normalized ingredient list
- Required versus optional ingredients, when manually curated
- Measurements and quantities from the source
- Instructions or source link, according to license
- Cooking time, when available
- Dietary tags, when supported by source data
- Allergen-related fields only when explicitly supported by source data
- Date retrieved
- Source version or content hash when practical

### Data quality dimensions

- **Accuracy:** Recipe fields match the source.
- **Completeness:** Required recipe fields are populated.
- **Consistency:** Ingredient names are normalized without changing meaning.
- **Freshness:** Broken links and changed source records are detected.
- **Lineage:** Every result identifies its source and retrieval date.
- **Coverage:** The controlled set represents the intended MVP scenarios.
- **Permission:** Use complies with API and content terms.
- **Stability:** Failed or malformed source responses are handled safely.

## 7. Proposed system workflow

1. Receive image.
2. Validate file type and size.
      - Downscale images client-side before upload. The vision call is the dominant cost and latency driver; full-resolution phone photos are unnecessary to identify ingredients. Downscaling reduces cost, upload time, latency, and (as a side effect) metadata exposure simultaneously.
3. Ask the vision model for structured ingredient candidates and confidence or uncertainty indicators.
      - The vision call must have a defined timeout and failure path. The specific timeout value is to-be-confirmed after baseline measurement. Retrying silently doubles cost, so retry behaviour is an explicit decision, not a default.
4. Display candidates to the user.
5. Require user confirmation or correction.
6. Normalize confirmed ingredients into the product vocabulary.
      - Try, then tell. When a user types an ingredient absent from the alias table:
      - Pass the raw term to recipe search.
      - If results return, proceed and log the term as an unknown for later addition to the alias table.
      - If nothing returns, tell the user the ingredient is unrecognized.

    No fuzzy matching — a wrong guess passes through as fact with no visible signal.
    **Caveat to record:** a search miss does not prove the ingredient is unknown, only that the current vocabulary did not cover it (e.g. "courgette" vs. a source's "zucchini"). This is exactly why unknown terms are logged.
    **Safety rule (applies regardless):** an unmatched, unverifiable term can never unlock a recipe that allergy or exclusion filtering would otherwise remove.  
7. Apply explicit constraints such as allergies, exclusions, time, and pantry staples.
8. Retrieve recipe candidates from the approved source.
9. Calculate deterministic feasibility features:
   - Required ingredient coverage
   - Number of missing ingredients
   - Presence of excluded ingredients
   - Time-constraint match
   - Source availability and completeness
10. Remove candidates that violate hard constraints.
11. Rank remaining candidates.
12. Use the language model only to produce a concise explanation grounded in the structured recipe record.
13. Display up to three results with sources and missing ingredients.
14. If no candidate meets the threshold, abstain and provide a next step.

- Post-baseline work (not MVP-blocking): measure cost per session; compare at least two vision models against the evaluation set, since a cheaper model may meet the precision target on clear images.

This is best described initially as a **multimodal, retrieval-grounded recommendation workflow**. Do not call it an autonomous agent merely because it uses an LLM. If a later version independently chooses tools, plans multiple steps, and adapts its actions based on intermediate results, the agent label may become appropriate.

## 8. Evaluation strategy

### Evaluation principle

Evaluate each stage separately before assessing the full user outcome. A wrong final recommendation may originate from image recognition, user confirmation, ingredient normalization, retrieval, ranking, source data, or response generation.

### 8.1 Ingredient-recognition evaluation

**Question:** Did the system correctly identify what is visibly present?

Metrics:

- Ingredient precision: Of the ingredients proposed, how many were actually visible?
- Ingredient recall: Of the clearly visible ingredients, how many were proposed?
- User correction rate
- Unsupported ingredient rate
- Performance by test slice

Important slices:

- Clear lighting
- Low lighting
- Cluttered fridge
- Partially hidden items
- Packaged foods
- Similar-looking produce
- Empty or nearly empty fridge
- Culturally diverse ingredients
- Multiple photos of the same inventory
- Non-food images
- Text-in-image

Release principle: Optimize precision over recall for the initial ingredient proposal. Missing an ingredient is recoverable through user confirmation; inventing one can produce an infeasible or unsafe recommendation.

### 8.2 User confirmation evaluation

**Question:** Did the user-confirmation step actually catch the errors it exists to catch?

User confirmation is named in the evaluation principle as a stage that can produce a wrong final result, and it is the product's primary safety mechanism. It therefore requires its own measurement. Two failure modes are independent of model quality.

Over-trust. The model proposes an incorrect ingredient, and the user confirms it without noticing. Detection evaluation records this as a model miss; the product treats it as confirmed truth. The human did not catch it.

Confirmation fatigue. As the proposed list grows, attention per item falls, and confirmation degrades toward rubber-stamping. The unchecked-by-default rule raises the cost of rubber-stamping but does not eliminate it.

Metrics.

- Human catch rate: on scenarios where the proposed list contains a known planted error, the percentage in which the user corrected or removed it. Primary metric.
- Correction rate by list length, and median time per confirmed item by list length. Fatigue indicators.
- Confirmation abandonment rate: sessions reaching the confirmation screen without completing it.

Instrumentation note. Confirmations and corrections are logged as distinct events (see 5.6). Collapsing both into a single resulting inventory discards the more valuable of the two signals.

### 8.3 Retrieval evaluation

**Question:** Given the confirmed ingredients and constraints, did the system retrieve feasible recipes?

Metrics:

- Recall@K for known relevant recipes
- Required-ingredient coverage
- Average number of missing ingredients
- Hard-constraint violation rate
- Cuisine or dietary filter accuracy when supported
- No-match accuracy

### 8.4 Ranking evaluation

**Question:** Were the most feasible and useful recipes ranked first?

Metrics:

- Pairwise human preference
- Top-result feasibility
- Ingredient utilization
- Missing-ingredient burden
- Time-constraint fit
- User selection rate

### 8.5 Generated explanation evaluation

**Groundedness:** Does every claim in the explanation come from the confirmed ingredients, constraints, or retrieved recipe record?

**Relevance:** Does the explanation address why this recipe fits this user's ingredients and constraints?

**Completeness:** Does it include the important decision information: matched ingredients, missing ingredients, relevant constraints, and source?

**Citation or attribution correctness:** Does the displayed source point to the actual recipe used?

**Unsupported-claim rate:** Does the explanation introduce ingredients, cooking steps, health claims, timing, or cultural labels absent from the source?

### 8.6 Abstention evaluation and result-state evaluation

Scoring is against three expected outcomes rather than two. Each controlled scenario is labelled with its expected state: supported match, near match, or no supported match.

Metrics.

- Correct-state rate: percentage of scenarios resolving to the expected state.
- False-abstention rate: answerable or near-match scenarios that returned no supported match.
- Over-permissive rate: no-match scenarios that returned a supported or near match.
- Near-match precision: near matches whose missing ingredients were genuinely small and reasonable.
- Next-step usefulness on true abstentions.
- Absence of invented recipes or ingredients in every state.

### 8.7 End-to-end product evaluation

**Question:** Did the product reduce decision effort and help the user choose something feasible?

Metrics:

- Time to recipe selection
- Supported recipe selection rate
- User-rated usefulness
- User confidence in the recommendation
- Percentage of users who report that they would cook the selected recipe
- Percentage who report avoiding takeout

## 9. Initial controlled evaluation set

Start with **30 scenarios**, not hundreds. Each scenario should contain:

- One or more test images
- Human-labeled visible ingredients
- Confirmed ingredient list
- Pantry-staple assumptions
- User constraints
- Expected result state: supported match, near match, or no supported match
- One or more acceptable recipe IDs for supported-match and near-match scenarios
- Expected missing-ingredient range for near-match scenarios
- Forbidden recipe IDs or ingredients when relevant
- Expected abstention reason for no-supported-match scenarios
- Expected useful next step for no-supported-match scenarios

### Suggested scenario distribution
- 10 clear supported-match cases
- 5 near-match cases with one or two reasonable missing ingredients
- 5 visually difficult but correctable cases
- 4 dietary or allergen-constraint cases
- 3 culturally diverse ingredient cases
- 3 no-supported-match cases

Run non-deterministic model stages multiple times for a subset of scenarios to measure variation rather than relying on one output.

## 10. Preliminary release criteria

These thresholds are hypotheses and should be revised after baseline testing. Do not choose favorable thresholds after seeing the final results.

- Zero known allergy or exclusion violations in the controlled test set
- Zero invented recipes presented as sourced recipes
- Zero broken or incorrect source attributions in the controlled test set
- At least 90% ingredient precision on clear-image scenarios
- At least 80% ingredient recall on clear-image scenarios
- At least 90% correct abstention on designated no-match scenarios
- No more than 10% false abstention on answerable scenarios
- At least 85% grounded explanations
- At least 80% complete decision summaries
- At least 80% of answerable scenarios return one feasible recipe in the top three
- Median response time suitable for a mobile decision workflow, with the target set after measuring the prototype baseline
- **The vision call must have a defined timeout and failure path:** The specific timeout value is to-be-confirmed after baseline measurement. Retrying silently doubles cost, so retry behaviour is an explicit decision, not a default.
- **Post-baseline work (not MVP-blocking)**: measure cost per session; compare at least two vision models against the evaluation set, since a cheaper model may meet the precision target on clear images.

## 11. Risks and mitigations

| Risk | Product consequence | MVP mitigation |
|---|---|---|
| Ingredient misidentification | Infeasible or unsafe suggestion | User confirmation; optimize for precision; expose uncertainty |
| Hidden or unpictured ingredients | Incomplete inventory | Allow manual additions and pantry staples |
| Allergy conflict | Potential harm | Require explicit user input; hard-filter; do not infer absence |
| Spoilage judgment | False reassurance | Never determine food safety from image; show limitation |
| Recipe hallucination | Loss of trust or unsafe instructions | Retrieval-only recipe contract; source link; grounded explanation |
| Weak recipe-source data | Bad recommendations | Controlled subset; validation; lineage; source monitoring |
| Cultural mislabeling or narrow coverage | Poor relevance and trust | Measure coverage; add cuisines deliberately in later versions |
| Overly strict matching | Excessive abstention | Track false-abstention rate; allow pantry staples and small gaps |
| Overly loose matching | Unrealistic recipes | Required-ingredient coverage threshold and missing-item cap |
| Image privacy | User mistrust | Minimize retention; disclose handling; avoid unnecessary storage |
| Non-food image | User mistrust | This doesn't look like food. Try a photo of food ingredients |
| Food present but Unreadable| User mistrust/infeasible/unsafe suggestion |  Food is undetifiable; Try better lighting or spreading items out |

## 12. Future roadmap hypotheses

These are hypotheses, not MVP commitments:

- Cuisine and cultural preference controls
- User taste and household personalization
- Multi-day meal planning
- Leftover and food-waste optimization
- Grocery-gap minimization
- Nutrition filters using an appropriate data source
- USDA-supported storage guidance
- Multi-image pantry and refrigerator inventory
- User feedback loop for ranking
- Native mobile experience if mobile-web evidence justifies it