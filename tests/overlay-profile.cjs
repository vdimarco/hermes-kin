// Run with node tests/overlay-profile.cjs. Only Electron startup is stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-profile-test-'));
try {
  for (const custom of [false, true]) {
    const home = path.join(root, custom ? 'custom' : 'default');
    const profile = custom ? path.join(home, 'profile with spaces') : path.join(home, '.hermes');
    fs.mkdirSync(path.join(profile, 'plugin-data/kin'), { recursive: true });
    const seed = new DatabaseSync(path.join(profile, 'state.db'));
    seed.exec('CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES (\'profile\')');
    seed.close();
    const python = path.join(profile, 'hermes-agent/venv/bin/python3');
    fs.mkdirSync(path.dirname(python), { recursive: true });
    fs.writeFileSync(python, '');
    fs.writeFileSync(path.join(profile, 'processes.json'), JSON.stringify([{ command: 'profile-test', pid: 123, status: 'running' }]));
    const context = vm.createContext({
      require(name) {
        if (name === 'electron') return {
          app: { commandLine: { appendSwitch() {} }, whenReady: () => ({ then() {} }), on() {} },
          ipcMain: { on() {} },
        };
        if (name === 'os') return { ...os, homedir: () => home };
        return require(name);
      },
      process: { env: custom ? { HOME: home, HERMES_HOME: profile } : { HOME: home } },
      __dirname: path.resolve(__dirname, '../overlay'), console,
    });
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../overlay/main.js'), 'utf8'), context);
    const result = vm.runInContext('({ kin: openKinDb(), state: openStateDb(), scratch: scratchDir(), python: kinPython(), tasks: readTasksAndRecent([]) })', context);
    assert(result.kin);
    assert.equal(result.state.prepare('SELECT value FROM marker').get().value, 'profile');
    assert.equal(result.scratch, path.join(profile, 'cache/scratch'));
    assert.equal(result.python, python);
    assert(result.tasks.active.some(task => task.sub.includes('PID 123')));
    result.kin.close();
    result.state.close();
  }
  console.log('Custom and default Hermes profile checks passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
