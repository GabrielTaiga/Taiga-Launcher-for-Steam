import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const LANGS = ['pt-BR', 'en', 'es', 'fr', 'de'];

test('1.9.0: names from exe, folders and acronyms (gow3 → God of War III)', async () => {
  const m = await import('../lib/title-guess.mjs');
  assert.deepEqual(m.guessNames('D:\\God of war 3\\gow3-windows\\Play God of War III.exe'), ['gow 3', 'God of war 3', 'God of War III']);
  assert.deepEqual(m.guessNames('C:\\Jogos\\gow3\\gow3.exe'), ['gow 3', 'God of War 3']);
  assert.ok(m.initialisms('Grand Theft Auto V').includes('gta5'));
  assert.ok(m.guessScore('RDR 2', 'Red Dead Redemption 2') >= .9);
  assert.ok(m.guessScore('God of War III', 'God of War Ragnarök') < .5);
  const fake = async q => ({items: /god of war/i.test(q) ? [{appId: 1, name: 'God of War Ragnarök'}, {appId: 2, name: 'God of War III Remastered'}] : []});
  const r = await m.guessSteamGame(m.guessNames('C:\\Jogos\\gow3\\gow3.exe'), fake);
  assert.equal(r.best.appId, 2);
});

test('1.9.0: installed games, game folders with engine proof only; known paths skipped', async () => {
  const {findInstalledGames} = await import('../lib/installed-games.mjs');
  const drive = fs.mkdtempSync(path.join(os.tmpdir(), 'drv-')), g = path.join(drive, 'Games');
  fs.mkdirSync(path.join(g, 'Hades II'), {recursive: true}); fs.writeFileSync(path.join(g, 'Hades II', 'UnityPlayer.dll'), 'x'); fs.writeFileSync(path.join(g, 'Hades II', 'Hades2.exe'), 'MZ'); fs.writeFileSync(path.join(g, 'Hades II', 'unins000.exe'), 'MZ');
  fs.mkdirSync(path.join(g, 'Ferramenta'), {recursive: true}); fs.writeFileSync(path.join(g, 'Ferramenta', 'tool.exe'), 'MZ');
  fs.mkdirSync(path.join(g, 'Old'), {recursive: true}); fs.writeFileSync(path.join(g, 'Old', 'steam_api64.dll'), 'x'); fs.writeFileSync(path.join(g, 'Old', 'old.exe'), 'MZ');
  const items = await findInstalledGames({drives: [drive], known: [path.join(g, 'Old', 'old.exe')]});
  assert.deepEqual(items.map(i => i.title), ['Hades II']);
  assert.equal(path.basename(items[0].path), 'Hades2.exe');
  assert.equal(items[0].confidence, 'high');
});

test('1.9.0: built-in keys from chaves.json, never written to the user config', async () => {
  const {readBuiltinKeys, attachBuiltinKeys} = await import('../lib/builtin-keys.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
  fs.writeFileSync(path.join(dir, 'chaves.json'), JSON.stringify({sgdbKey: 'abc', igdbId: 'id1', igdbSecret: 'COLE_AQUI'}));
  const keys = readBuiltinKeys(dir, {});
  assert.deepEqual(keys, {sgdbKey: 'abc', igdbId: 'id1'});
  const cfg = attachBuiltinKeys({igdbId: 'mine'}, keys);
  assert.equal(cfg.sgdbKey, 'abc'); assert.equal(cfg.igdbId, 'mine'); assert.equal(cfg.igdbSecret, '');
  const saved = JSON.parse(JSON.stringify(cfg));
  assert.ok(!('sgdbKey' in saved)); assert.equal(saved.own_igdbId, 'mine'); assert.equal(saved.own_sgdbKey, '');
  assert.ok(!app.includes("input('sgdbKey'"), 'no key fields in Settings');
  assert.match(fs.readFileSync(new URL('../../../.gitignore', import.meta.url), 'utf8'), /resources\/app\/chaves\.json/);
});

test('1.9.0: Xbox / Microsoft Store, login token, achievements by package name, account card', async () => {
  const {tokenFromRedirect, pfnOf} = await import('../lib/xbox-auth.mjs');
  const t = tokenFromRedirect('https://login.live.com/oauth20_desktop.srf?lc=1046#access_token=AAA&token_type=bearer&expires_in=3600&refresh_token=RRR');
  assert.equal(t.accessToken, 'AAA'); assert.equal(t.refreshToken, 'RRR');
  assert.equal(pfnOf({launch: {args: 'shell:AppsFolder\\Microsoft.Game_8wekyb3d8bbwe!App'}}), 'Microsoft.Game_8wekyb3d8bbwe');
  const {StoreAchievements} = await import('../lib/store-achievements.mjs');
  const seen = [];
  const fetchImpl = async url => { seen.push(url); const body = /titlehub/.test(url) ? {titles: [{titleId: '99', pfn: 'Microsoft.Game_8wekyb3d8bbwe', name: 'Game'}]} : {achievements: [{id: '1', name: 'Primeira', description: 'Feito', progressState: 'Achieved', progression: {timeUnlocked: '2026-01-02T00:00:00Z'}, mediaAssets: [{type: 'Icon', url: 'https://x/i.png'}], rarity: {currentPercentage: 12.5}}, {id: '2', name: 'Segunda', lockedDescription: '?', isSecret: true, progressState: 'NotStarted'}]}; return new Response(JSON.stringify(body)); };
  const st = new StoreAchievements({dir: fs.mkdtempSync(path.join(os.tmpdir(), 'xb-')), fetchImpl});
  const r = await st.xbox({session: {xsts: {token: 'T', uhs: 'U', xuid: '42'}}, pfn: 'Microsoft.Game_8wekyb3d8bbwe'});
  assert.equal(r.status, 'ok'); assert.equal(r.achievements.length, 2); assert.equal(r.achievements[0].unlocked, true); assert.equal(r.achievements[1].hidden, true);
  assert.ok(seen.some(u => /achievements\.xboxlive\.com\/users\/xuid\(42\)\/achievements\?titleId=99/.test(u)));
  const none = await st.xbox({session: null});
  assert.equal(none.status, 'unconfigured');
  assert.match(app, /ACC_KINDS=\['epic','xbox','gog','ra'\]/);
});

test('1.9.0: yuzu game folders, guess screen, installed dialog; texts in 5 languages', async () => {
  const {emulatorGameFolders} = await import('../lib/discover.mjs');
  const files = {[path.join('/a', 'yuzu', 'config', 'qt-config.ini')]: '[UI]\nPaths\\gamedirs\\1\\path=SDMC\nPaths\\gamedirs\\4\\path=/jogos/switch\n'};
  const io = {exists: f => f in files, read: f => files[f] || '', list: () => []};
  assert.deepEqual(emulatorGameFolders({env: {APPDATA: '/a'}, io}).filter(x => x.source === 'yuzu').map(x => x.path), [path.normalize('/jogos/switch')]);
  assert.match(app, /api\('guess-game',\{path:g\.path\}\)/);
  assert.match(app, /async function installedDialog\(after\)/);
  assert.match(app, /data-act="installed"|mini\('installed'/);
  for (const l of LANGS) {
    const d = JSON.parse(fs.readFileSync(new URL(`../locales/${l}.json`, import.meta.url), 'utf8'));
    for (const k of ['inst.title', 'inst.lead', 'inst.add', 'guess.isThis', 'guess.confirm', 'guess.other', 'account.why.xbox', 'account.connect.xbox', 'ob2.pcLead2']) assert.ok(d[k], `${l}:${k}`);
  }
});

test('1.9.1: one identification screen (Steam on top + all platforms), console ports via PARAM.SFO, deferred import, stores in installed scan', async () => {
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(app, /function renderSteamStrip\(g\)/);
  assert.match(app, /pcMode=p\?\.key==='pc'/);
  assert.match(app, /deferred:true/);
  assert.match(server, /route==='\/api\/import-finish'/);
  assert.match(server, /await scanStores\(\)/);
  assert.match(server, /route==='\/exe-icon'/);
  assert.ok(!app.includes("ob2.pcNote"));
  const {bestQuery, guessNames} = await import('../lib/title-guess.mjs');
  assert.equal(bestQuery(guessNames('D:\\God of war 3\\gow3-windows\\Play God of War III.exe')), 'God of war 3');
  // Port nativo: dump de PS4 com sce_sys/param.sfo citado no settings.json do port.
  const {consoleTitleNear} = await import('../lib/console-port.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'port-')), exe = path.join(dir, 'gow3-windows', 'Play SpartanPort.exe'), dump = path.join(dir, 'CUSA01623');
  fs.mkdirSync(path.dirname(exe), {recursive: true}); fs.writeFileSync(exe, 'MZ'); fs.mkdirSync(path.join(dump, 'sce_sys'), {recursive: true});
  const sfo = (() => { const keys = ['TITLE', 'TITLE_ID'], vals = ['God of War III Remastered', 'CUSA01623']; const kt = Buffer.from(keys.join('\0') + '\0'), dt = Buffer.concat(vals.map(v => { const b = Buffer.alloc(64); b.write(v); return b; })); const h = Buffer.alloc(20 + keys.length * 16); h.writeUInt32LE(0x46535000, 0); h.writeUInt32LE(0x101, 4); h.writeUInt32LE(20 + keys.length * 16, 8); h.writeUInt32LE(20 + keys.length * 16 + kt.length, 12); h.writeUInt32LE(keys.length, 16); let ko = 0; keys.forEach((k, i) => { const p = 20 + i * 16; h.writeUInt16LE(ko, p); h.writeUInt16LE(0x204, p + 2); h.writeUInt32LE(vals[i].length + 1, p + 4); h.writeUInt32LE(64, p + 8); h.writeUInt32LE(i * 64, p + 12); ko += k.length + 1; }); return Buffer.concat([h, kt, dt]); })();
  fs.writeFileSync(path.join(dump, 'sce_sys', 'param.sfo'), sfo);
  const found = consoleTitleNear(exe);
  assert.equal(found?.title, 'God of War III Remastered'); assert.equal(found?.platform, 'PlayStation 4');
});
