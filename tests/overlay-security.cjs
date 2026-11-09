// Run with: electron tests/overlay-security.cjs (xvfb-run -a on headless Linux).
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-renderer-test-'));
app.setPath('userData', tmp);
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const actions = [];
ipcMain.on('kin:action', (_e, payload) => actions.push(payload));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: {
    preload: path.resolve(__dirname, '../overlay/preload.js'),
    contextIsolation: true, nodeIntegration: false,
  }});
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });
  const run = (fn, ...args) => win.webContents.executeJavaScript(`(${fn})(${args.map(x => JSON.stringify(x)).join(',')})`);
  try {
    await win.loadFile(path.resolve(__dirname, '../overlay/index.html'));
    await new Promise(r => setTimeout(r, 1500));
    assert.deepEqual(errors, [], 'Avatar assets must load under CSP');
    const attack = `" onmouseover="window.kinFloat.act({kind:'ask',text:'injected'})" x="<img src=x onerror=alert(1)> '&`;
    win.webContents.send('kin:state', { recentTasks: [{ label: attack, sub: attack, nav: attack, status: 'done' }] });
    await new Promise(r => setTimeout(r, 100));
    const row = await run(() => {
      const row = document.querySelector('#task-list .row');
      row.dispatchEvent(new MouseEvent('mouseover'));
      return { title: row.title, text: row.querySelector('.row-title').textContent,
        nav: row.dataset.nav, handler: row.getAttribute('onmouseover'), image: !!row.querySelector('img') };
    });
    assert.deepEqual(row, { title: attack, text: attack, nav: attack, handler: null, image: false });
    await run(() => {
      const script = document.createElement('script');
      script.textContent = 'window.inlineRan = true';
      document.body.append(script);
      const button = document.createElement('button');
      button.setAttribute('onclick', 'window.inlineRan = true');
      document.body.append(button);
      button.click();
    });
    assert.equal(await run(() => !!window.inlineRan), false);
    await run(() => {
      document.querySelector('#ask-input').value = 'tts key test-secret';
      document.querySelector('#ask-row').requestSubmit();
    });
    await new Promise(r => setTimeout(r, 100));
    assert.equal(actions.some(a => a.kind === 'ask' || a.kind === 'set-eleven-key'), false);
    assert.equal(await run(() => localStorage.getItem('kin_ask_history')), null);
    await run(() => {
      document.querySelector('#ask-input').value = 'hello';
      document.querySelector('#ask-row').requestSubmit();
    });
    await new Promise(r => setTimeout(r, 100));
    assert(actions.some(a => a.kind === 'ask' && a.text === 'hello'));
    assert.equal(errors.filter(m => m.includes('Content Security Policy')).length, 2);
    console.log('Renderer security checks passed (including avatar load and CSP enforcement).');
    app.exit(0);
  } catch (err) {
    console.error(err, errors);
    app.exit(1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
