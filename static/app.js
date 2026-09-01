const photoInput = document.getElementById("photo");
const preview = document.getElementById("preview");
const previewWrap = document.getElementById("preview-wrap");
const previewEmpty = document.getElementById("preview-empty");
const go = document.getElementById("go");
const statusEl = document.getElementById("status");
const result = document.getElementById("result");
const timeChips = document.getElementById("time-chips");

let photoFile = null;
let timeMinutes = 20;

timeChips.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  timeMinutes = Number(button.dataset.minutes);
  for (const chip of timeChips.querySelectorAll("button")) {
    chip.classList.toggle("on", chip === button);
  }
});

photoInput.addEventListener("change", () => {
  photoFile = photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;
  if (!photoFile) {
    preview.hidden = true;
    previewEmpty.hidden = false;
    previewWrap.classList.add("empty");
    go.disabled = true;
    return;
  }
  preview.src = URL.createObjectURL(photoFile);
  preview.hidden = false;
  previewEmpty.hidden = true;
  previewWrap.classList.remove("empty");
  go.disabled = false;
  result.hidden = true;
  statusEl.textContent = "";
});

go.addEventListener("click", async () => {
  if (!photoFile) return;
  go.disabled = true;
  statusEl.textContent = "Looking at your fridge… no guessing.";
  result.hidden = true;

  const body = new FormData();
  body.append("photo", photoFile);
  body.append("cooking_level", document.getElementById("cooking-level").value);
  body.append("time_minutes", String(timeMinutes));
  body.append("preferences", document.getElementById("preferences").value);
  body.append("pantry_staples", document.getElementById("pantry").value);

  try {
    const response = await fetch("/api/recipes", { method: "POST", body });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Could not get recipes.");
    }
    renderResult(data);
    statusEl.textContent = "";
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    go.disabled = !photoFile;
  }
});

function renderResult(data) {
  const ingredients = (data.visible_ingredients || [])
    .map(
      (item) =>
        `<li class="${item.confidence === "low" ? "low" : ""}">${escapeHtml(
          item.name
        )} · ${escapeHtml(item.confidence || "")}</li>`
    )
    .join("");

  const ignored = (data.ignored_uncertain || []).length
    ? `<p class="meta">Not using (too uncertain): ${escapeHtml(
        data.ignored_uncertain.join(", ")
      )}</p>`
    : "";

  const recipes = (data.recipes || [])
    .map((recipe) => {
      const uses = (recipe.uses || [])
        .map((item) => `${item.name}${item.source === "pantry" ? " (pantry)" : ""}`)
        .join(", ");
      const steps = (recipe.steps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("");
      return `<article class="recipe">
        <h3>${escapeHtml(recipe.title || "Untitled")}</h3>
        <p class="meta">${escapeHtml(String(recipe.minutes || "?"))} min · ${escapeHtml(
        recipe.skill_fit || ""
      )}</p>
        <p class="meta">Uses: ${escapeHtml(uses)}</p>
        <ol>${steps}</ol>
      </article>`;
    })
    .join("");

  result.innerHTML = `
    <div class="honesty ${data.can_make_meal ? "ok" : ""}">${escapeHtml(
      data.honesty || ""
    )}</div>
    <h2>What I can see</h2>
    <ul class="ingredients">${ingredients || "<li>Nothing clear enough</li>"}</ul>
    ${ignored}
    ${data.can_make_meal ? recipes : recipes || "<p>No recipes — that is the honest answer.</p>"}
  `;
  result.hidden = false;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
