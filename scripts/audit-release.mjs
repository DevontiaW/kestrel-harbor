// Release audit: checks a folder for things that should never be published. No dependencies.
//
//   node scripts/audit-release.mjs <folder>                      audit a folder (exits 1 on any finding)
//   node scripts/audit-release.mjs <folder> --rules <file.json>  add project-specific rules
//
// Built-in checks: secret key shapes, private keys, local home-directory paths (Windows, macOS, Linux), email
// addresses, environment files, node_modules folders, symbolic links, images that could hide text, and text files
// it cannot read. A rules file can add more, as JSON:
//   { "paths": [{ "pattern": "^drafts$", "flags": "i", "label": "drafts folder" }],
//     "text":  [{ "pattern": "internal-only", "flags": "i", "label": "internal marker" }],
//     "names": ["Name To Keep Out"] }
// "paths" are matched against every folder and file name, "text" against the contents of every text file, and
// "names" as whole words in any case.
import { readFileSync, lstatSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Image files skip the text checks only when their first bytes prove the format and nothing can hide in them.
const MAGIC = { '.png': ['89504e47'], '.jpg': ['ffd8ff'], '.jpeg': ['ffd8ff'], '.gif': ['47494638'], '.webp': ['52494646'] };

export const PATH_RULES = [
  [/^node_modules$/i, 'dependencies folder'],
  [/^\.env/i, 'environment file'],
];

// Secret shapes are also searched inside image files.
export const SECRET_RULES = [
  [/\bsk-[A-Za-z0-9_-]{16,}/, 'API key shape'],
  [/\bgh[opsu]_[A-Za-z0-9]{20,}/, 'GitHub token shape'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub token shape'],
  [/\bxoxb-[A-Za-z0-9-]{10,}/, 'Slack token shape'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS key shape'],
  [/\bAIza[0-9A-Za-z_-]{35}/, 'Google key shape'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
];

export const TEXT_RULES = [
  ...SECRET_RULES,
  [/\b[A-Za-z]:\\{1,2}(?:Users|Documents and Settings)\\{1,2}[^\\\s"']+/i, 'local Windows home path'],
  [/(?:^|[^\w.])\/(?:Users|home)\/[A-Za-z0-9._-]+\//, 'local macOS or Linux home path'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/, 'email address'],
];

// Reads an optional rules file (see the header) into the same [regex, label] shape as the built-in rules.
export function loadRules(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const rules = list => (list || []).map(r => [new RegExp(r.pattern, r.flags || ''), r.label || r.pattern]);
  return { paths: rules(raw.paths), text: rules(raw.text), names: (raw.names || []).map(String).filter(Boolean) };
}

// Git metadata is skipped. A node_modules folder is returned as one entry (not walked) so it is refused by path.
// Symbolic links are returned as entries and refused, never followed.
export const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.name === '.git' ? []
  : e.isDirectory() && !/^node_modules$/i.test(e.name) ? walk(join(dir, e.name)) : [join(dir, e.name)]);

export function deniedPath(rel, extra = []) {
  for (const part of rel.split(/[\\/]/)) for (const [re, why] of [...PATH_RULES, ...extra]) if (re.test(part)) return why;
  return null;
}

// Returns a problem description, or null when the image ends where it should and carries no text or photo metadata.
function imageProblem(ext, b) {
  if (ext === '.png') {
    for (let o = 8; o + 12 <= b.length;) {
      const type = b.toString('latin1', o + 4, o + 8), next = o + 12 + b.readUInt32BE(o);
      if (/^(tEXt|iTXt|zTXt|eXIf)$/.test(type)) return `PNG carries a ${type} metadata chunk`;
      if (next > b.length) return 'PNG chunk runs past the end of the file';
      if (type === 'IEND') return next === b.length ? null : `${b.length - next} bytes after the end of the PNG image`;
      o = next;
    }
    return 'PNG has no IEND chunk';
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    if (!(b.length >= 4 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9)) return 'JPEG does not end at its end-of-image marker (FFD9)';
    // Walk the header segments up to the image data; APP1 (EXIF or XMP) and COM (comment) segments can carry text.
    for (let o = 2; o + 4 <= b.length && b[o] === 0xff;) {
      const marker = b[o + 1];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xe1) return 'JPEG carries an APP1 (EXIF or XMP) metadata segment';
      if (marker === 0xfe) return 'JPEG carries a comment segment';
      o += 2 + b.readUInt16BE(o + 2);
    }
    return null;
  }
  if (ext === '.gif') return b[b.length - 1] === 0x3b ? gifProblem(b) : 'GIF does not end at its trailer byte (3B)';
  if (ext === '.webp') return b.length >= 12 && b.readUInt32LE(4) + 8 === b.length ? null : 'WebP size field does not match the file length';
  return null;
}

// Walk a GIF's blocks: comment (21 FE) and plain-text (21 01) extensions can carry readable text, and application
// extensions other than the animation loop (NETSCAPE2.0 / ANIMEXTS1.0) can carry metadata such as XMP. Each is a finding.
// The walk must end exactly at the trailer byte.
function gifProblem(b) {
  if (b.length < 14 || b.toString('latin1', 0, 3) !== 'GIF') return 'GIF header is missing';
  const table = flags => (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0);
  const skipSubBlocks = o => { while (o < b.length && b[o] !== 0) o += b[o] + 1; return o + 1; };
  let o = 13 + table(b[10]);
  while (o < b.length) {
    const type = b[o];
    if (type === 0x3b) return o === b.length - 1 ? null : `${b.length - o - 1} bytes after the GIF trailer`;
    if (type === 0x21) {
      const label = b[o + 1];
      if (label === 0xfe) return 'GIF carries a comment extension';
      if (label === 0x01) return 'GIF carries a plain text extension';
      if (label === 0xff) { const app = b.toString('latin1', o + 3, o + 3 + b[o + 2]); if (!/^(NETSCAPE2\.0|ANIMEXTS1\.0)$/.test(app)) return `GIF carries an application extension (${app.replace(/[^\x20-\x7e]/g, '?')})`; }
      o = skipSubBlocks(o + 2); continue;
    }
    if (type === 0x2c) { o = skipSubBlocks(o + 10 + table(b[o + 9]) + 1); continue; } // descriptor, local color table, LZW size, data
    return `GIF has an unknown block (${type.toString(16)})`;
  }
  return 'GIF has no trailer (3B)';
}

// UTF-8, or UTF-16 when the file starts with a byte-order mark. NUL bytes without one: refused (returns null).
function readText(b) {
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b[0] === 0xfe && b[1] === 0xff) return Buffer.from(b.subarray(2, 2 + ((b.length - 2) & ~1))).swap16().toString('utf16le');
  return b.includes(0) ? null : b.toString('utf8');
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Audits every file under dir. `rules` adds project-specific checks; `skip` lists relative paths to ignore.
export function audit(dir, { rules = {}, skip = [] } = {}) {
  const { paths = [], text: textRules = [], names = [] } = rules, findings = [];
  for (const file of walk(dir)) {
    const rel = relative(dir, file).split(sep).join('/');
    if (skip.includes(rel)) continue;
    const why = deniedPath(rel, paths); if (why) { findings.push(`${rel}: path is not allowed (${why})`); continue; }
    if (lstatSync(file).isSymbolicLink()) { findings.push(`${rel}: symbolic link (refused, never followed)`); continue; }
    const ext = extname(file).toLowerCase(), magic = MAGIC[ext], bytes = readFileSync(file);
    if (magic) {
      if (!magic.some(m => bytes.subarray(0, m.length / 2).toString('hex') === m)) findings.push(`${rel}: not a real ${extname(file)} file (text checks would have been skipped)`);
      else { const problem = imageProblem(ext, bytes); if (problem) findings.push(`${rel}: ${problem} (text could hide there)`); }
      const raw = bytes.toString('latin1');
      for (const [re, label] of SECRET_RULES) if (re.test(raw)) findings.push(`${rel}: ${label} inside a binary file`);
      continue;
    }
    const text = readText(bytes);
    if (text === null) { findings.push(`${rel}: contains NUL bytes and no UTF-16 byte-order mark (not readable as text, refused)`); continue; }
    for (const [re, label] of [...TEXT_RULES, ...textRules]) { const m = text.match(re); if (m) findings.push(`${rel}: ${label}: "${m[0].slice(0, 40)}"`); }
    for (const name of names) if (new RegExp(`\\b${escapeRe(name)}\\b`, 'i').test(text)) findings.push(`${rel}: name on the keep-out list: "${name}"`);
  }
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), i = args.indexOf('--rules'), rulesFile = i >= 0 ? args[i + 1] : null;
  const dir = args.filter((a, k) => !a.startsWith('--') && !(i >= 0 && k === i + 1))[0];
  if (!dir || (i >= 0 && (!rulesFile || rulesFile.startsWith('--')))) { console.error('Usage: node scripts/audit-release.mjs <folder> [--rules <file.json>]'); process.exit(2); }
  const findings = audit(resolve(dir), { rules: rulesFile ? loadRules(resolve(rulesFile)) : {} });
  if (findings.length) { console.error(`RELEASE AUDIT FAILED (${findings.length}):\n  ${findings.join('\n  ')}`); process.exit(1); }
  console.log(`Release audit passed: ${walk(resolve(dir)).length} files.`);
}
