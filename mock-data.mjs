// Fictional mock data for Kestrel Harbor. Every company, person, plate and order here is invented
// for the simulation; nothing describes a real business, customer or patient.
export const SUPPLIER = 'Harlow Tube & Steel (fictional)';

export const VEHICLES = {
  tractor: { code: 'AG-07', kind: 'Tractor · Tillage', operator: 'Onboard plan F-12', task: 'Tillage pass, north rows' },
  harvester: { code: 'AG-11', kind: 'Harvester · Row crop', operator: 'Onboard plan F-14', task: 'Harvest pass, south rows' },
  'truck-a': { code: 'TRK-2207', kind: 'Truck · Box, rear doors', driver: 'R. Osei', bay: 'Bay A' },
  'truck-b': { code: 'TRK-2214', kind: 'Truck · Box, rear doors', driver: 'M. Delgado', bay: 'Bay B' },
  autovan: { code: 'SHUTTLE-1', kind: 'Shuttle · Line 1', operator: 'Onboard route L1' },
};

// Each truck trip carries one manifest of 4 crates; trips cycle through this list.
export const MANIFESTS = [
  ['PAL-3301 frame tubes', 'PAL-3302 frame tubes', 'PAL-3303 dropouts', 'PAL-3304 primer'],
  ['PAL-3311 head tubes', 'PAL-3312 primer', 'PAL-3313 clear coat', 'PAL-3314 masking film'],
  ['PAL-3321 seat stays', 'PAL-3322 chain stays', 'PAL-3323 powder coat (sage)', 'PAL-3324 decals'],
  ['PAL-3331 fork blanks', 'PAL-3332 primer', 'PAL-3333 powder coat (ink)', 'PAL-3334 rack hardware'],
];

// Agent-floor tickets: task n uses TICKETS[(n - 1) % length].
export const TICKETS = [
  'Reconcile Harlow invoice #4471 against receipts',
  'Draft paint-shop QC summary for Monday',
  'Compare two powder-coat quotes',
  'Update dock schedule for Thursday loads',
  'Summarize field sensor report AG-07',
  'Prepare reorder for primer stock',
  'Check shuttle Line 1 timetable change',
  'Draft reply to dealer warranty question',
  'Build weekly throughput table',
  'Flag overdue supplier certificates',
  'Write handover note for night shift',
  'Audit clinic supply-room order list',
];

// Medical office admin queue: administrative only, no patient data.
export const ADMIN_REQUESTS = [
  'Reorder exam-room gloves', 'Confirm Thursday supply delivery', 'Update vendor contact sheet',
  'Renew equipment service contract', 'Reschedule linen pickup', 'File utility invoice',
];

export const SHUTTLE_STOPS = [
  { name: 'Market St', at: 0.0 }, { name: 'Clinic', at: 0.2 }, { name: 'Dock Gate', at: 0.42 },
  { name: 'Agent Floor', at: 0.62 }, { name: 'Harbor View', at: 0.82 },
];

export const PLATES = ['KH 214', 'KH 377', 'KH 402', 'KH 519', 'KH 633', 'KH 781', 'KH 845', 'KH 906', 'KH 118', 'KH 260', 'KH 554', 'KH 690'];
