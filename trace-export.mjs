// Export agent-floor tasks as OpenTelemetry-shaped JSON (the OTLP/JSON trace layout), so a real collector could
// ingest the same data later. No network, no dependencies, deterministic ids. Schema: docs/EVENT-SCHEMA.md.
import { SCHEMA_VERSION } from './agent-floor.mjs';

const EPOCH_NS = 1767254400000000000n; // simulated 08:00 = 2026-01-01T08:00:00Z, a fixed illustrative date
const NS_PER_MINUTE = 60000000000n;
const at = minute => String(EPOCH_NS + BigInt(minute) * NS_PER_MINUTE);
const hex = (n, width) => n.toString(16).padStart(width, '0');
const attr = (key, value) => ({ key, value: typeof value === 'number' ? { intValue: String(value) } : typeof value === 'boolean' ? { boolValue: value } : { stringValue: String(value) } });

// One trace per task: a root span for the task's whole life, and one child span per working or waiting segment.
export function taskToSpans(task, now) {
  const traceId = hex(task.n, 32), rootId = hex(task.n * 4096, 16), end = task.finished ?? now;
  const root = { traceId, spanId: rootId, name: `task ${task.id}`, kind: 1, startTimeUnixNano: at(task.arrival), endTimeUnixNano: at(end),
    attributes: [attr('kh.task.id', task.id), attr('kh.task.reworked', task.reworked), attr('kh.task.finished', task.finished !== undefined)], status: { code: 0 } };
  const children = task.spans.map((s, i) => ({ traceId, spanId: hex(task.n * 4096 + i + 1, 16), parentSpanId: rootId,
    name: `${s.stage} ${s.state}`, kind: 1, startTimeUnixNano: at(s.start), endTimeUnixNano: at(s.end),
    attributes: [attr('kh.stage', s.stage), attr('kh.state', s.state), ...(s.cause ? [attr('kh.wait.cause', s.cause)] : []),
      ...(s.by ? [attr('kh.blocked.by', s.by.join(','))] : []), ...(s.worker ? [attr('kh.worker', s.worker)] : [])],
    status: { code: 0 } }));
  return [root, ...children];
}

export function toOtlp(floor) {
  const tasks = [...floor.done, ...floor.tasks].sort((a, b) => a.n - b.n);
  return { resourceSpans: [{
    resource: { attributes: [attr('service.name', 'kestrel-harbor-agent-floor'), attr('kh.schema.version', SCHEMA_VERSION)] },
    scopeSpans: [{ scope: { name: 'kestrel-harbor', version: SCHEMA_VERSION }, spans: tasks.flatMap(t => taskToSpans(t, floor.time)) }],
  }] };
}
