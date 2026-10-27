# Changelog

## 0.2.0, unreleased

Govern and secure: three new lessons and the enterprise view.

- Quality rules (off by default): every 4th task carries a defect, every 4th review that sees one misses it, the shift lead sees every third task, and both checks miss some on a fixed pattern. Metrics, the one-task trace and the Experiment Lab now show defects caught at review, caught at approval, and escaped to the customer.
- Security rules (off by default): every 10th task carries a hidden instruction. A checkpoint before the tool action quarantines it for a person (and misses every 3rd one on a fixed pattern); least privilege limits each agent to its role's tools. New break-it control (Checkpoint off) and lab changes (turn off the checkpoint, give agents every tool).
- Enterprise view: a vendor-neutral map of the town as a company network, with sensors and checkpoints and a scripted incident's path, drawn as inline SVG from the same code as the lessons.
- Lessons 6 (who decided, and can you prove it?), 7 (where the sensors and checkpoints go) and 8 (when the input is the attack). The lessons are grouped into Simulate, Observe, and Govern and secure.
- Every lesson ends with an optional "Build it yourself with AI" section: the one rule, a starter prompt with a copy button, what done looks like, and numbers to check the AI's work, all computed from the model.
- Event schema 1.1.0: optional quality and security fields, `defect` and `tool` events, the `quarantine` stage. With the new rules off, every output is byte-for-byte the same as before (a test locks this).
- Lesson pages follow the reader's dark mode. The README shows the town in a short animation.
- Release audit: GIF files are walked block by block; comment, plain-text and metadata extensions are findings.

## 0.1.0, unreleased

First public practicum release candidate.

- Observability layer for the agent floor: a per-task event log (event schema 1.0.0), metrics with a Little's Law check that can fail, a single-task trace view, Experiment Lab v0 (baseline vs one change, same start and horizon) and break-it controls (model API outage, reviewers away, power loss).
- OpenTelemetry-shaped trace export (no network).
- Five lessons with every number computed from the model at build time.
- Release audit (`scripts/audit-release.mjs`) for secrets, local paths, emails and hidden image text.
