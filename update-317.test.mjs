import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {legendaryInstalledItem} from '../lib/legendary.mjs';
import {latestReleaseAny, updateScript} from '../lib/updater.mjs';

test('Epic instalada pelo Taiga: achada pelo registro do Legendary mesmo sem executável indicado', () => {
 const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leg-')), cfg = path.join(d, 'cfg'), game = path.join(d, 'Games', 'APlague');
 fs.mkdirSync(path.join(game, 'Bin'), {recursive: true}); fs.writeFileSync(path.join(game, 'Bin', 'APlagueTale.exe'), Buffer.alloc(600 * 1024)); fs.writeFileSync(path.join(game, 'Bin', 'unins000.exe'), Buffer.alloc(900 * 1024));
 fs.mkdirSync(cfg, {recursive: true});
 fs.writeFileSync(path.join(cfg, 'installed.json'), JSON.stringify({Mango: {app_name: 'Mango', title: 'A Plague Tale: Innocence', install_path: game, executable: '', namespace: 'ns', catalog_item_id: 'cat'}}));
 const it = legendaryInstalledItem('mango', 'C:\\leg.exe', {env: {LEGENDARY_CONFIG_PATH: cfg}});
 assert.equal(it.path, path.join(game, 'Bin', 'APlagueTale.exe')); assert.equal(it.url, 'launch Mango'); assert.equal(it.appName, 'Mango');
 assert.equal(legendaryInstalledItem('outro', '', {env: {LEGENDARY_CONFIG_PATH: cfg}}), null);
 fs.rmSync(d, {recursive: true, force: true});
});

test('Atualização: procura no repositório novo e no nome antigo; o script espera os processos, pede administrador e grava o resultado', async () => {
 const fetchImpl = async url => new Response(JSON.stringify(url.includes('Taiga-Launcher-for-Steam') ? {tag_name: 'v3.1.7', assets: [{name: 'Taiga Launcher 3.1.7.zip', browser_download_url: 'https://github.com/x/y/releases/download/v3.1.7/a.zip', size: 10}]} : {tag_name: 'v2.3.13', assets: [{name: 'Taiga Launcher 2.3.13.zip', browser_download_url: 'https://github.com/x/y/a.zip'}]}));
 const r = await latestReleaseAny(['GabrielTaiga/Taiga-Launcher-for-Steam', 'GabrielTaiga/taiga-launcher'], {fetchImpl});
 assert.equal(r.version, '3.1.7');
 const s = updateScript({zip: 'C:\\a.zip', installDir: 'C:\\T', pid: 1, resultFile: 'C:\\r.json', version: '3.1.7'});
 assert.match(s, /-Verb RunAs/); assert.match(s, /Stop-Process -Force/); assert.match(s, /Result \$false/); assert.match(s, /Result \$true/);
 assert.ok(!/\$args\b/.test(s), 'não usa a variável automática $args');
 const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
 assert.equal(pkg.taigaUpdates, 'GabrielTaiga/Taiga-Launcher-for-Steam'); assert.deepEqual(pkg.taigaUpdatesFallback, ['GabrielTaiga/taiga-launcher']);
});

test('"Não pode ser aberto" mostra o motivo; aviso de atualização que falhou nos 5 idiomas', () => {
 const s = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8'), app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
 assert.match(s, /launchError:\(\(\)=>/); assert.match(app, /T\('sync\.cantRunWhy'/); assert.match(app, /T\('upd\.failedApply'/);
 assert.match(s, /legendaryInstalledItem\(g\.store\.appName,legendary\.exe\)/);
 for (const l of ['pt-BR', 'en', 'es', 'fr', 'de']) { const d = JSON.parse(fs.readFileSync(new URL(`../locales/${l}.json`, import.meta.url), 'utf8')); assert.ok(d['sync.cantRunWhy'].includes('{reason}') && d['upd.failedApply'].includes('{version}'), l); }
});
