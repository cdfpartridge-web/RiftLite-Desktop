/* Run with the bundled Electron executable, never against an existing profile.
 * Loads only the public signed-out lobby; does not sign in or press play.
 * Compiles just the diagnostic's three source modules in memory (no app build).
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');

const repo = path.resolve(__dirname, '..');
const output = path.join(repo, 'output', 'playwright');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'riftlite-atlas-field-repair-')));

function sourceModule(relativePath) {
  const source = fs.readFileSync(path.join(repo, relativePath), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', code)(module, module.exports);
  return module.exports;
}

const { ATLAS_LOBBY_PLAYER_FIELD_PROBE } = sourceModule('src/shared/atlasLobbyPlayerField.ts');
const { AtlasLobbyPlayerFieldRepair } = sourceModule('src/main/services/atlasLobbyPlayerFieldRepair.ts');
const { atlasCardRenderingCssForUrl } = sourceModule('src/shared/atlasCardRendering.ts');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const measurements = `(() => {
  const field = document.querySelector('#right-rail-player-name');
  return { field: field?.getBoundingClientRect().toJSON(),
    visibility: document.visibilityState,
    ancestors: field ? [field, field.parentElement, field.parentElement.parentElement].map(el => ({
      display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility,
      bounds: el.getBoundingClientRect().toJSON()
    })) : [] };
})()`;
const deadline = setTimeout(() => { console.error('Native layout probe timed out'); app.exit(1); }, 55000);

app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({ width: 1690, height: 945, useContentSize: true, show: false,
      webPreferences: { partition: 'atlas-field-repair-probe', sandbox: true,
        nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
    const guest = win.webContents;
    guest.setWindowOpenHandler(() => ({ action: 'deny' }));
    const results = [];
    let applications = 0;
    let safe = true;
    const controller = new AtlasLobbyPlayerFieldRepair({
      isSafe: () => safe && !guest.isDestroyed() && !guest.isLoadingMainFrame(),
      readField: () => guest.executeJavaScript(ATLAS_LOBBY_PLAYER_FIELD_PROBE),
      applyCss: async () => {
        applications++;
        await guest.insertCSS(atlasCardRenderingCssForUrl(guest.getURL()));
      },
      report: outcome => results.push(outcome)
    });
    for (let documentIndex = 0; documentIndex < 2; documentIndex++) {
      controller.navigationChanged(true);
      await guest.loadURL('https://play.riftatlas.com/');
      for (let attempt = 0; attempt < 40; attempt++) {
        if (await guest.executeJavaScript('Boolean(document.querySelector("#right-rail-player-name"))')) break;
        await delay(250);
      }
      await delay(1500);
      const initialFieldBounds = await guest.executeJavaScript('document.querySelector("#right-rail-player-name")?.getBoundingClientRect().toJSON()');
      const applicationsBefore = applications;
      const before = await guest.executeJavaScript(ATLAS_LOBBY_PLAYER_FIELD_PROBE);
      fs.writeFileSync(path.join(output, `atlas-player-field-repair-${documentIndex}-before.png`), (await guest.capturePage()).toPNG());
      // A protected guest must not be touched, even when the defect is present.
      safe = false;
      await controller.check();
      assert.equal(applications, applicationsBefore);
      safe = true;
      await controller.check();
      const after = await guest.executeJavaScript(ATLAS_LOBBY_PLAYER_FIELD_PROBE);
      const afterBounds = await guest.executeJavaScript(measurements);
      fs.writeFileSync(path.join(output, `atlas-player-field-repair-${documentIndex}-after.png`), (await guest.capturePage()).toPNG());
      console.log(JSON.stringify({ documentIndex, initialFieldBounds, before, after, afterBounds, applications, results }));
      assert.ok(before === 'collapsed' || before === 'ready', 'Live lobby must expose the expected idle form');
      assert.equal(after, 'ready');
      assert.ok(applications - applicationsBefore <= 1);
      if (applications > applicationsBefore) assert.equal(results.at(-1), 'repaired');
      const applicationsAfter = applications;
      await controller.check();
      controller.navigationChanged(false); // Same-document navigation must not reset its budget.
      await controller.check();
      assert.equal(applications, applicationsAfter);
      if (documentIndex === 0) {
        for (const zoom of [0.8, 1, 1.6]) {
          guest.setZoomFactor(zoom);
          await delay(150);
          assert.equal(await guest.executeJavaScript(ATLAS_LOBBY_PLAYER_FIELD_PROBE), 'ready');
        }
        guest.setZoomFactor(1);
      }
    }
    controller.dispose();
    console.log('PASS: native layout/source check, protected guest, duplicate/SPA budget, same-URL reload and zoom. CSS repairs: ' + applications);
    clearTimeout(deadline);
    win.destroy();
    app.quit();
  } catch (error) {
    console.error(error.stack || String(error));
    clearTimeout(deadline);
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(1);
  }
});
