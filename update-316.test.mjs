import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {RetroAchievements} from '../lib/retroachievements.mjs';
import {Providers} from '../lib/providers.mjs';

test('RetroAchievements fora do ar: só o primeiro jogo espera, os outros seguem na hora', async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-down-'));
 let calls = 0;
 const fetchImpl = async () => { calls++; const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; };
 const ra = new RetroAchievements({dir, config: () => ({}), fetchImpl});
 await assert.rejects(ra.hashLibrary(21));
 const t0 = Date.now();
 for (let i = 0; i < 8; i++) assert.equal(await ra.gameIdForHash('0'.repeat(32), 21), null);
 assert.ok(Date.now() - t0 < 1500, 'falha rápida depois da primeira');
 assert.equal(calls, 1, 'sem repetir a consulta para cada jogo');
 fs.rmSync(dir, {recursive: true, force: true});
});

test('Site sem resposta: as consultas seguintes ao mesmo site falham na hora por alguns minutos', () => {
 const p = new Providers(() => ({}), fs.mkdtempSync(path.join(os.tmpdir(), 'prov-')));
 const e = new Error('x'); e.name = 'TimeoutError';
 p.hostFailed('api.exemplo.com', e);
 assert.throws(() => p.hostCheck('api.exemplo.com'), /indisponível/);
 assert.doesNotThrow(() => p.hostCheck('outro.exemplo.com'));
 p.hostFailed('http.exemplo.com', new Error('HTTP 404'));
 assert.doesNotThrow(() => p.hostCheck('http.exemplo.com'), 'erro de resposta não derruba o site');
});

test('Busca de jogos: progresso por etapa, identificação em paralelo, leitura reaproveitada e downloads adiantados', () => {
 const s = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
 assert.match(s, /route==='\/api\/discover-progress'/);
 assert.match(s, /Math\.min\(4,requested\.length\)/);
 assert.match(s, /addFiles\(body\.items\.map\(i=>i\.path\),\{known:/);
 assert.match(s, /providers\.retro\?\.hashLibrary\?\.\(p\.ra\)/);
 assert.match(s, /Date\.now\(\)-discoveryAt>300000/);
 const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
 assert.match(app, /function watchDiscover/);
 for (const l of ['pt-BR', 'en', 'es', 'fr', 'de']) {
  const d = JSON.parse(fs.readFileSync(new URL(`../locales/${l}.json`, import.meta.url), 'utf8'));
  for (const k of ['disc.p.emulators', 'disc.p.folders', 'disc.p.sweep', 'disc.p.read', 'disc.p.identify']) assert.ok(d[k], l + ':' + k);
 }
});
