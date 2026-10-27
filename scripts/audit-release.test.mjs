import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { audit, loadRules } from './audit-release.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = join(ROOT, '.audit-test');
const SCRIPT = join(ROOT, 'scripts', 'audit-release.mjs');
// Planted values are split in two so this file never contains them whole (it is audited like any other file).
const KEY = 'sk-' + 'A1b2C3d4E5f6G7h8I9j0';
const PLANTS = {
  key: ['leak.txt', `token = "${KEY}"`, /API key shape/],
  github: ['gh.txt', 'ghp_' + 'a'.repeat(30), /GitHub token shape/],
  githubPat: ['pat.txt', 'github_pat_' + '11ABC' + 'x'.repeat(40), /GitHub token shape/],
  githubOauth: ['gho.txt', 'gho_' + 'c'.repeat(36), /GitHub token shape/],
  githubServer: ['ghs.txt', 'ghs_' + 'd'.repeat(36), /GitHub token shape/],
  slack: ['slack.txt', 'xoxb-' + '1234567890ab', /Slack token shape/],
  aws: ['aws.txt', 'id = AKIA' + 'ABCDEFGHIJ234567', /AWS key shape/],
  google: ['g.txt', 'key=AIza' + 'Sy' + 'b'.repeat(33), /Google key shape/],
  privateKey: ['id.pem', '-----BEGIN RSA ' + 'PRIVATE KEY-----', /private key/],
  windows: ['path.md', 'see C:' + '\\Users\\someone\\notes', /local Windows home path/],
  windowsJson: ['path.json', '{"p": "C:' + '\\\\Users\\\\someone\\\\x"}', /local Windows home path/],
  mac: ['mac.md', 'see /' + 'Users/someone/thing', /local macOS or Linux home path/],
  linux: ['linux.md', 'cd /' + 'home/someone/project', /local macOS or Linux home path/],
  email: ['mail.md', 'write to someone' + '@' + 'example.org', /email address/],
};

after(() => rmSync(SCRATCH, { recursive: true, force: true }));

function folder(name, files = {}) {
  const dir = join(SCRATCH, name); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  for (const [path, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), body); }
  return dir;
}

test('a clean folder passes, including ordinary web links that contain /home/ or /Users/ after a domain', () => {
  const dir = folder('clean', { 'README.md': '# Hello\nSee https://example.org/home/page/ for more.', 'src/a.mjs': 'export const x = 1;' });
  assert.deepEqual(audit(dir), []);
});

test('every planted secret, local path or email fails the audit, naming the file and the reason', () => {
  for (const [id, [file, body, reason]] of Object.entries(PLANTS)) {
    const f = audit(folder(`plant-${id}`, { 'ok.txt': 'fine', [file]: body }));
    assert.ok(f.some(x => x.startsWith(`${file}:`) && reason.test(x)), `${id}: ${JSON.stringify(f)}`);
    assert.ok(!f.some(x => x.startsWith('ok.txt')), id);
  }
});

test('environment files and node_modules folders are refused by path, and node_modules is not walked', () => {
  const dir = folder('paths', { '.env': 'A=1', '.env.local': 'B=2', 'lib/node_modules/pkg/index.js': `module.exports = "${KEY}"` });
  const f = audit(dir);
  assert.ok(f.some(x => /^\.env: path is not allowed/.test(x)) && f.some(x => /^\.env\.local: path is not allowed/.test(x)), JSON.stringify(f));
  assert.ok(f.some(x => /node_modules.*path is not allowed/.test(x)) && !f.some(x => /API key/.test(x)), JSON.stringify(f));
});

test('a symbolic link is refused, never followed', (t) => {
  const dir = folder('symlink', { 'docs/ok.md': 'ok', 'secret.txt': KEY });
  try { symlinkSync(join(dir, 'secret.txt'), join(dir, 'docs', 'link.md')); } catch { t.skip('cannot create symlinks here'); return; }
  assert.ok(audit(join(dir, 'docs')).some(f => /^link\.md: symbolic link/.test(f)));
});

test('an extra rules file adds path, text and name checks', () => {
  const dir = folder('rules', { 'private-notes/a.md': 'x', 'docs/guide.md': 'This draft is INTERNAL-ONLY.', 'docs/thanks.md': 'Thanks to Jane Example.', 'docs/ok.md': 'Examples are fine.' });
  const rulesPath = join(SCRATCH, 'rules.json');
  writeFileSync(rulesPath, JSON.stringify({
    paths: [{ pattern: '^private-notes$', flags: 'i', label: 'private notes folder' }],
    text: [{ pattern: 'internal-only', flags: 'i', label: 'internal marker' }],
    names: ['Example'],
  }));
  const f = audit(dir, { rules: loadRules(rulesPath) });
  assert.ok(f.some(x => /^private-notes\/a\.md: path is not allowed \(private notes folder\)/.test(x)), JSON.stringify(f));
  assert.ok(f.some(x => /^docs\/guide\.md: internal marker/.test(x)), JSON.stringify(f));
  assert.ok(f.some(x => /^docs\/thanks\.md: name on the keep-out list/.test(x)), JSON.stringify(f));
  assert.ok(!f.some(x => x.startsWith('docs/ok.md')), 'names match whole words only');
  assert.deepEqual(audit(dir), [], 'without the rules file the same folder passes');
});

// Minimal image files built byte by byte. Chunk checksums are not checked by the audit, so zeros are fine.
const chunk = (type, data = Buffer.alloc(0)) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]); };
const PNG_SIG = Buffer.from('89504e470d0a1a0a', 'hex');
const png = (...extra) => Buffer.concat([PNG_SIG, chunk('IHDR', Buffer.alloc(13)), ...extra, chunk('IDAT', Buffer.alloc(8)), chunk('IEND')]);
const JPG = 'ffd8ffe000104a46494600010100000100010000';

test('images must be real, end where the image ends, and carry no text or photo metadata', () => {
  const dir = folder('images');
  writeFileSync(join(dir, 'clean.png'), png());
  writeFileSync(join(dir, 'tail.png'), Buffer.concat([png(), Buffer.from(' notes after the image')]));
  writeFileSync(join(dir, 'text.png'), png(chunk('tEXt', Buffer.from('Comment\0hidden'))));
  writeFileSync(join(dir, 'itext.png'), png(chunk('iTXt', Buffer.from('x'))));
  writeFileSync(join(dir, 'ztext.png'), png(chunk('zTXt', Buffer.from('x'))));
  writeFileSync(join(dir, 'exif.png'), png(chunk('eXIf', Buffer.from('MM'))));
  writeFileSync(join(dir, 'fake.png'), `not an image ${KEY}`);
  writeFileSync(join(dir, 'clean.jpg'), Buffer.from(JPG + 'ffd9', 'hex'));
  writeFileSync(join(dir, 'tail.jpg'), Buffer.concat([Buffer.from(JPG + 'ffd9', 'hex'), Buffer.from('appended')]));
  writeFileSync(join(dir, 'exif.jpg'), Buffer.from('ffd8ffe1000845786966000000' + 'ffd9', 'hex'));
  writeFileSync(join(dir, 'comment.jpg'), Buffer.from('ffd8fffe0006616263' + 'ffd9', 'hex'));
  writeFileSync(join(dir, 'clean.gif'), Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(7), Buffer.from([0x3b])]));
  writeFileSync(join(dir, 'tail.gif'), Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(7), Buffer.from([0x3b]), Buffer.from('appended')]));
  const f = audit(dir);
  for (const bad of ['tail.png', 'text.png', 'itext.png', 'ztext.png', 'exif.png', 'fake.png', 'tail.jpg', 'exif.jpg', 'comment.jpg', 'tail.gif']) assert.ok(f.some(x => x.startsWith(`${bad}:`)), `${bad}: ${JSON.stringify(f)}`);
  for (const good of ['clean.png', 'clean.jpg', 'clean.gif']) assert.ok(!f.some(x => x.startsWith(`${good}:`)), `${good}: ${JSON.stringify(f)}`);
});

test('GIF: the block walk refuses comment, plain-text and metadata extensions, and text hidden after a trailer byte', () => {
  const dir = folder('gif', {});
  // A real 1x1 animated GIF: header, screen with a 2-color table, the loop extension, one image, the trailer.
  const head = Buffer.concat([Buffer.from('GIF89a'), Buffer.from('01000100800000000000ffffff', 'hex')]);
  const loop = Buffer.concat([Buffer.from('21ff0b', 'hex'), Buffer.from('NETSCAPE2.0'), Buffer.from('0301000000', 'hex')]);
  const image = Buffer.from('2c00000000010001000002024401' + '00', 'hex');
  const gif = (...blocks) => Buffer.concat([head, ...blocks, Buffer.from([0x3b])]);
  const sub = (label, text) => Buffer.concat([Buffer.from([0x21, label, text.length]), Buffer.from(text), Buffer.from([0])]);
  writeFileSync(join(dir, 'anim.gif'), gif(loop, image));
  writeFileSync(join(dir, 'comment.gif'), gif(loop, sub(0xfe, 'hello'), image));
  writeFileSync(join(dir, 'plain.gif'), gif(loop, Buffer.concat([Buffer.from([0x21, 0x01, 12]), Buffer.alloc(12), Buffer.from([3]), Buffer.from('abc'), Buffer.from([0])]), image));
  writeFileSync(join(dir, 'xmp.gif'), gif(Buffer.concat([Buffer.from('21ff0b', 'hex'), Buffer.from('XMP DataXMP'), Buffer.from([2, 0x3c, 0x78, 0])]), image));
  writeFileSync(join(dir, 'semicolon.gif'), Buffer.concat([gif(loop, image), Buffer.from('note;')]));
  const f = audit(dir);
  assert.ok(!f.some(x => x.startsWith('anim.gif:')), JSON.stringify(f));
  assert.ok(f.some(x => /^comment\.gif: .*comment extension/.test(x)), JSON.stringify(f));
  assert.ok(f.some(x => /^plain\.gif: .*plain text extension/.test(x)), JSON.stringify(f));
  assert.ok(f.some(x => /^xmp\.gif: .*application extension \(XMP DataXMP\)/.test(x)), JSON.stringify(f));
  assert.ok(f.some(x => /^semicolon\.gif: .*bytes after the GIF trailer/.test(x)), JSON.stringify(f));
});

test('the published screenshots are clean images', { skip: !existsSync(join(ROOT, 'docs', 'screenshots')) }, () => {
  assert.deepEqual(audit(join(ROOT, 'docs', 'screenshots')), []);
});

test('the published media (diagrams and the README animation) are clean, and the animation stays small enough for a phone', { skip: !existsSync(join(ROOT, 'docs', 'media')) }, () => {
  assert.deepEqual(audit(join(ROOT, 'docs', 'media')), []);
  const gif = join(ROOT, 'docs', 'media', 'town-demo.gif');
  if (existsSync(gif)) assert.ok(statSync(gif).size < 5e6, `${statSync(gif).size} bytes`);
});

test('UTF-16 text is decoded and audited, and text with NUL bytes and no byte-order mark is refused', () => {
  const dir = folder('utf16');
  writeFileSync(join(dir, 'le.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`token ${KEY}`, 'utf16le')]));
  writeFileSync(join(dir, 'be.txt'), Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(`token ${KEY}`, 'utf16le').swap16()]));
  writeFileSync(join(dir, 'nul.txt'), Buffer.from(`token ${KEY}`, 'utf16le'));
  const f = audit(dir);
  assert.ok(f.some(x => /^le\.txt: API key shape/.test(x)) && f.some(x => /^be\.txt: API key shape/.test(x)), JSON.stringify(f));
  assert.ok(f.some(x => /^nul\.txt: .*NUL/.test(x)), JSON.stringify(f));
});

test('the command line exits 1 on a finding, 0 on a clean folder, and 2 with usage when no folder is given', () => {
  const bad = folder('cli-bad', { 'secret.txt': KEY }), good = folder('cli-good', { 'a.txt': 'fine' });
  const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8' });
  const r1 = run(bad); assert.equal(r1.status, 1); assert.match(r1.stderr, /RELEASE AUDIT FAILED/);
  const r2 = run(good); assert.equal(r2.status, 0); assert.match(r2.stdout, /Release audit passed: 1 files/);
  const r3 = run(); assert.equal(r3.status, 2); assert.match(r3.stderr, /usage/i);
  const rulesPath = join(SCRATCH, 'cli-rules.json'); writeFileSync(rulesPath, JSON.stringify({ text: [{ pattern: 'fine', label: 'flagged word' }] }));
  const r4 = run(good, '--rules', rulesPath); assert.equal(r4.status, 1); assert.match(r4.stderr, /flagged word/);
});
