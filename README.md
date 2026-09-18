# Basketball Rotation Planner

A static basketball rotation planner for GitHub Pages.

## Features
- Add/edit/remove players
- Multiple positions (G/F/C)
- Skill rating 1-100
- Toggle game attendance
- Rotation style slider (equal minutes ↔ fully competitive) instead of fixed presets
- 4- or 5-minute blocks
- LocalStorage persistence
- No backend/database required

## Run locally
Open `index.html` directly, or run a simple local server:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000

## Deploy to GitHub Pages
1. Create a new GitHub repository.
2. Upload `index.html`, `styles.css`, `app.js`, and this README to the repository root.
3. In GitHub, open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select `main` and `/ (root)`, then save.
6. GitHub will publish the site at your Pages URL.

## Storage
The roster and settings are stored in the browser's `localStorage`. Clearing browser/site data removes them. Data does not sync between devices.

## Tests
Automated tests live in `tests/` and run with [Playwright](https://playwright.dev/), driving a real Chromium browser against the static files (served via `python3 -m http.server`) — no build step, no changes to the shipped app. Playwright is a dev-only dependency and never ships to the site.

```bash
npm install
npx playwright install --with-deps chromium
npm test
```

- `tests/logic.spec.js` — the rotation-building algorithm, seeded RNG, min/max minute enforcement, and formatting helpers, called directly as page globals.
- `tests/ui.spec.js` — end-to-end flows: roster compact/edit toggle, generate/regenerate, seed reproduction, validation alerts, add/delete/reset.

Tests also run automatically on every push/PR via GitHub Actions (`.github/workflows/tests.yml`).

