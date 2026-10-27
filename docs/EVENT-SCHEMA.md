# Agent floor event schema, version 1.1.0

The agent floor records what every task does, minute by minute, as plain JavaScript Object Notation (JSON). This page is the contract: the shapes below are stable within a major version, so lessons, tests and any future tool can rely on them. The version lives in code as `SCHEMA_VERSION` in `agent-floor.mjs`.

The model is deterministic. Running the same floor with the same inputs produces the same events, byte for byte.

## Time

One tick is one simulated minute. Minute 0 is 08:00. A span covering `start: 120, end: 125` means 10:00 to 10:05. A task that arrives at minute `a` has its first span start at `a`.

## Task

Each task carries its own spans. Read a task with `floor.task('T-012')`.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | `T-001`, `T-002`, ... in arrival order |
| `n` | integer | Arrival number (1 for `T-001`) |
| `arrival` | integer | Minute the task arrived |
| `finished` | integer, absent until done | Minute the task left the floor |
| `stage` | string | `research`, `plan`, `execute`, `review`, `approve`, `quarantine` (1.1.0, only while poisoned requests are on), or `done` |
| `state` | string | `queued`, `working` or `done` |
| `worked`, `queued`, `blocked`, `approval` | integer | Minutes spent working, in line, stopped by an outage, and waiting for the approver |
| `reworked` | boolean | Sent back from review once (for the every-5th rule, or to fix a defect review caught) |
| `spans` | array of Span | The task's whole life, in order |

Optional quality and security fields (1.1.0). They appear only when their rule is switched on, so a floor with the rules off produces exactly the 1.0.0 shapes:

| Field | Type | Meaning |
|---|---|---|
| `carriedDefect` | `true` | The task arrived carrying a defect (every Nth task, `defectEvery`) |
| `defect` | boolean | The defect is still in the work (`false` once review or approval caught it and it was fixed) |
| `escaped` | `true` | The task finished with the defect still in it: it reached the customer |
| `poisoned` | boolean | The task carries an instruction hidden in content an agent reads (every Nth task, `poisonEvery`); `false` once acted on, refused or cleared |
| `injected` | string | What the hidden instruction asks for: `exportRecords` (a tool outside the execution role) or `sendOutside` (the send tool, pointed outside) |
| `quarantined` | `true` | The checkpoint blocked its tool action and sent it to a person |
| `unsafe` | `true` | The unsafe tool action was carried out (checkpoint off) |

## Span

A span is a stretch of minutes in which nothing about the task changed: same stage, same state, same cause, same worker.

| Field | Type | Meaning |
|---|---|---|
| `stage` | string | Stage the task was at |
| `state` | `working` or `waiting` | |
| `cause` | `null`, `queue`, `approval`, `blocked` | Why it waited (`null` when working) |
| `by` | `null` or array of strings | For `blocked`: which services were down: `internet`, `modelApi`, `power`, `reviewer` |
| `worker` | `null` or string | Who worked it, for example `reviewer 2` or `execution agent 1` |
| `start`, `end` | integer | Minutes; `end` is exclusive |

Guarantee, enforced by tests: a task's spans tile its life exactly. The first starts at `arrival`, each starts where the last ended, the last ends at `finished` (or the current minute), and the minutes by state equal `worked`, `queued`, `blocked` and `approval`.

## Event

`floor.log` is one array of events for the whole floor, in time order.

| `type` | Extra fields | When |
|---|---|---|
| `entered` | `stage` | The task joins a stage's line (arrival, or after the previous stage) |
| `started` | `stage`, `worker` | A worker picks it up |
| `left` | `stage`, `worker`, `outcome` | Work at the stage is done. `outcome` is `done`, `pass`, `rework` (review sent it back) or `approved`; in 1.1.0 also `rejected` (approval found a defect), `blocked` (the checkpoint stopped the execution agent's tool action) and `cleared` (a person cleared a quarantined task) |
| `finished` | `cycle`, `approved`, `reworked` | The task leaves the floor |
| `defect` (1.1.0) | `stage`, `worker`, `result` | A check met a defect. `result` is `caught` or `missed` at `review`, `caught` or `missed` at `approve`, or `escaped` at `done` (just before `finished`) |
| `tool` (1.1.0) | `stage`, `worker`, `tool`, `request`, `result` | The execution agent tried the action a hidden instruction asked for. `result` is `blocked` (checkpoint), `denied` (least privilege: the role does not hold that tool) or `carried-out` (an unsafe action). When the checkpoint missed the action (it looked allowed), the event has `slipped: true` and `result` is `denied` or `carried-out` |

Every event also has `minute` and `task`.

Order guarantees for the new events: a `defect` event comes just before the `left` (or `finished`) event of the same check; a `tool` event comes just before the execution stage's `left` event, and a `blocked` result is always followed by `entered` at `quarantine`.

The quality and security rules are deterministic: `defectEvery` (every Nth task carries a defect), `missEvery` (every Nth review that sees a defect misses it, counted across the shift), `approveMissEvery` (every Nth defect the approver sees, the approver misses), `slipEvery` (every Nth poisoned action the checkpoint examines looks allowed and gets through), `poisonEvery` (every Nth task is poisoned; odd-numbered poisoned tasks ask for `exportRecords`, even ones for `sendOutside`), `checkpoint` and `leastPrivilege` (both on by default, and with no effect while `poisonEvery` is 0). Both miss rules default to 0 (never miss). All are documented with their defaults in `agent-floor.mjs`.

## OpenTelemetry shape

`toOtlp(floor)` in `trace-export.mjs` emits the same data in the OpenTelemetry Protocol (OTLP) JSON trace layout, so a standard collector could ingest it later:

- one trace per task: `traceId` is the task number as 32 hex digits;
- a root span named `task T-012` covering arrival to finish;
- one child span per Span above, named `<stage> <state>`, with attributes `kh.stage`, `kh.state`, `kh.wait.cause`, `kh.blocked.by` and `kh.worker`;
- timestamps are nanoseconds from a fixed illustrative date (2026-01-01 08:00 UTC), so exports are deterministic.

No network calls are made. Sending data to a collector is out of scope.

## Versioning

- Patch (1.0.x): documentation or bug fixes that keep every field and meaning.
- Minor (1.x.0): new optional fields or event types. Readers must ignore fields they do not know.
- Major (x.0.0): a field removed, renamed or changed in meaning.

History:
- 1.1.0: optional quality and security fields; `defect` and `tool` events; `left` outcomes `rejected`, `blocked`, `cleared`; the `quarantine` stage (spans and OTLP child spans named `quarantine working` / `quarantine waiting`). With every new rule off, the event log, tasks, spans and metrics are byte-for-byte the same as 1.0.0 (a test locks this); the only difference in an OTLP export is the `kh.schema.version` attribute, which now reads 1.1.0.
- 1.0.0: first version.
