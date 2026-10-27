# Contributing

Thank you for helping. This project teaches non-engineers to see where AI (artificial intelligence) agent work waits, so clarity matters more than features.

## Ground rules

- **Keep it deterministic.** No random numbers or wall-clock time in the engine. Same settings, same result.
- **Every number on screen comes from the model.** Do not type numbers into labels or lessons; compute them (lessons use `{{name}}` tokens filled by `lesson-numbers.mjs`).
- **No new frameworks.** three.js, esbuild and plain ES modules.
- **Fictional data only.** No real people, companies, clients or patients. Label illustrative numbers as illustrative.
- **Plain language.** Write for a busy owner on a phone. Spell out acronyms on first use. No em dashes in reader-facing text.

## Before you open a pull request

1. `npm ci` then `npm test`. Add a test for any model change, including exact-minute accounting (a task's spans must tile its life) and conservation (arrived = in progress + finished).
2. `npm run build` and commit the rebuilt `index.html`, `factory.html` and `lessons/`.
3. If you changed the page, run `python functional-test.py` (Playwright with Microsoft Edge), or describe what you checked by hand at desktop and 390-pixel phone width.
4. For a lesson: one idea, a familiar situation first, a prediction before the reveal, one break-it step in the town, a question about a different situation, and a Monday check.

Small, focused pull requests are easier to review. Open an issue first for anything large.
