// ABOUTME: Fills the GitHub star count next to the header's GitHub icon (docs and /play).
// ABOUTME: Cached for the session so moving between pages doesn't spend the API rate limit.
const StarsKey = "ph-github-stars";

function showStars(stars: number) {
  const label = document.querySelector<HTMLElement>("[data-github-stars]");
  if (!label) return;
  label.textContent = new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  })
    .format(stars)
    .toLowerCase();
  label.closest("a")?.setAttribute("aria-label", `GitHub, ${stars} stars`);
  label.hidden = false;
}

let cached: number | undefined;
try {
  const value = Number(sessionStorage.getItem(StarsKey));
  if (value > 0) cached = value;
} catch {}

if (cached) {
  showStars(cached);
} else {
  fetch("https://api.github.com/repos/spencerc99/playhtml", {
    headers: { Accept: "application/json" },
  })
    .then((response) => (response.ok ? response.json() : undefined))
    .then((repo) => {
      const stars = repo?.stargazers_count;
      if (typeof stars !== "number" || !Number.isFinite(stars)) return;
      showStars(stars);
      try {
        sessionStorage.setItem(StarsKey, String(stars));
      } catch {}
    })
    .catch(() => {});
}
