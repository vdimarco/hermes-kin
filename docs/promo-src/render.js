// usage: node render.js <html> <out.png> <w> <h>
const { chromium } = require('playwright');
(async () => {
  const [html, out, w, h] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 });
  await p.goto('file://' + require('path').resolve(html), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  await p.screenshot({ path: out });
  await b.close();
})();
