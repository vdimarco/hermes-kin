// usage: node capture.js <outdir> <fps> <durationSec> [jpegQuality] [everyNth]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const REPO = path.resolve(__dirname, '../../..');
const HERE = __dirname;
const [outDir, fpsArg, durArg, qArg, nthArg, startArg] = process.argv.slice(2);
const FPS = +fpsArg || 30, DUR = +durArg || 60, Q = +qArg || 92, NTH = +nthArg || 1;
fs.mkdirSync(outDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.css': 'text/css' };
function resolve(u) {
  const p = decodeURIComponent(u.split('?')[0]);
  if (p === '/comp.html' || p === '/mock.js') return path.join(HERE, p);
  if (p.startsWith('/overlay/') || p.startsWith('/docs/')) { const f = path.join(REPO, p); return f.startsWith(REPO) ? f : null; }
  return null;
}
const srv = http.createServer((q, r) => {
  const f = resolve(q.url);
  if (!f || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
}).listen(0, main);

const STEP = (dt) => {
  for (const a of document.getAnimations()) {
    if (a.__v === undefined) { a.pause(); a.__v = Number(a.currentTime) || 0; }
    a.__v += dt; a.currentTime = a.__v;
  }
};

async function main() {
  const port = srv.address().port;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing'] });
  const page = await b.newPage({ viewport: { width: +(process.env.VW || 1920), height: +(process.env.VH || 1080) }, deviceScaleFactor: 1 });
  const errs = new Set();
  page.on('pageerror', (e) => errs.add('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errs.add(r.status() + ' ' + r.url()); });
  await page.addInitScript({ path: path.join(HERE, 'mock.js') });
  await page.clock.install({ time: new Date('2026-11-08T15:00:00Z') });
  await page.goto(`http://127.0.0.1:${port}/comp.html${process.env.QS || ''}`);
  await page.evaluate(() => document.fonts.ready);
  // Warm up: let real I/O (GLBs, images) land while fake time moves.
  const frame = () => page.frames().find((f) => f.url().includes('/overlay/'));
  for (let i = 0; i < 80; i++) {
    await page.clock.runFor(100);
    await page.waitForTimeout(60);
    const ok = await frame()?.evaluate(() => getComputedStyle(document.getElementById('gl')).display === 'block').catch(() => false);
    if (ok && i > 40) break;
  }
  const cdp = await page.context().newCDPSession(page);
  const dtMs = 1000 / FPS;
  const total = Math.round(DUR * FPS);
  const t0 = Date.now();
  const first = Math.round((+startArg || 0) * FPS);
  for (let f = first; f < total; f++) {
    const t = f / FPS;
    await page.evaluate((t) => window.render(t), t);
    await page.clock.runFor(dtMs);
    const dt = f === first ? 0 : dtMs;
    await page.evaluate(STEP, dt);
    await frame()?.evaluate(STEP, dt).catch(() => {});
    if (f % NTH === 0) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: Q, optimizeForSpeed: true });
      fs.writeFileSync(path.join(outDir, `${String(f / NTH | 0).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
    }
    if (f % (FPS * 5) === 0) console.log(`t=${t.toFixed(1)}s frame ${f}/${total} elapsed ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  console.log('errors:\n' + [...errs].join('\n'));
  await b.close(); srv.close();
}
