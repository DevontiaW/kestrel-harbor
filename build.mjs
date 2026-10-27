import { build } from 'esbuild';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { fillNumbers, lessonNumbers } from './lesson-numbers.mjs';
const license = await readFile('node_modules/three/LICENSE', 'utf8');
for (const [entry, page, output] of [['app.js', 'page.html', 'factory.html'], ['district.js', 'district-page.html', 'index.html']]) {
  const result = await build({ entryPoints: [entry], bundle: true, minify: true, write: false, format: 'iife', target: 'es2020', legalComments: 'inline' });
  const html = await readFile(page, 'utf8');
  await writeFile(output, html.replace('<!-- APP -->', () => `<!-- Three.js license\n${license}\n--><script>${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`));
  console.log(`Built ${output}: bundled scripts and styles, no runtime network dependency.`);
}
// Lessons: every {{number}} is computed from the model at build time (lesson-numbers.mjs).
const numbers = lessonNumbers();
await mkdir('lessons', { recursive: true });
for (const name of (await readdir('lessons-src')).filter(f => f.endsWith('.html'))) {
  await writeFile(`lessons/${name}`, fillNumbers(await readFile(`lessons-src/${name}`, 'utf8'), numbers));
}
console.log('Built lessons/: numbers filled from the model.');
// Diagrams for the docs, drawn by the same code as the page and the lessons (light and dark in one file).
const { townInsideSvg, enterpriseMapSvg } = await import('./network-surface.mjs');
await mkdir('docs/media', { recursive: true });
await writeFile('docs/media/town-inside.svg', townInsideSvg() + '\n');
await writeFile('docs/media/enterprise-map.svg', enterpriseMapSvg({ highlight: 'sendOutside' }) + '\n');
console.log('Built docs/media/*.svg: diagrams from network-surface.mjs.');
