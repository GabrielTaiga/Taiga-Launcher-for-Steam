import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Providers} from '../lib/providers.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
const SERVER = 'https://taiga.example.workers.dev';
function withFetch(handler) { const old = globalThis.fetch, calls = []; globalThis.fetch = async (url, opts = {}) => { calls.push({url: String(url), method: opts.method || 'GET', body: opts.body}); return handler(String(url), opts); }; return {calls, restore: () => { globalThis.fetch = old; }}; }
const jsonRes = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', ...headers}});

test('Limite de consultas (429): para de consultar, avisa que tenta de novo e não fala em credenciais', async () => {
 const f = withFetch(() => jsonRes({error: 'rate_limited'}, 429, {'retry-after': '60'}));
 try {
  const p = new Providers(() => ({profileServer: SERVER}), tmp()); p.offline = false;
  await assert.rejects(p.sg('search/autocomplete/God%20of%20War'), e => e.code === 'rate_limited' && /tenta de novo sozinho/.test(e.message) && !/credenciais/.test(e.message));
  assert.equal(f.calls.length, 1, 'espera longa: não insiste');
  assert.ok(p.limited() && p.limitedUntil() - Date.now() > 50000);
  await assert.rejects(p.ig('fields name; search "x";'), e => e.code === 'rate_limited');
  assert.equal(f.calls.length, 1, 'durante a espera nada sai para o servidor');
 } finally { f.restore(); }
});

test('Limite do dia da Cloudflare (página 1027 sem prazo): espera longa', async () => {
 const f = withFetch(() => new Response('<html>Error 1027</html>', {status: 429, headers: {'content-type': 'text/html'}}));
 try {
  const p = new Providers(() => ({profileServer: SERVER}), tmp()); p.offline = false;
  await assert.rejects(p.sg('grids/game/1?types=static'), e => e.code === 'rate_limited');
  assert.ok(p.limitedUntil() - Date.now() > 10 * 60000);
 } finally { f.restore(); }
});

test('Artes de um jogo num pedido só ao servidor; servidor antigo sem a rota continua funcionando', async () => {
 const f = withFetch((url, opts) => {
  if (url.endsWith('/v1/sgdb/batch')) { const {endpoints} = JSON.parse(opts.body); return jsonRes({results: Object.fromEntries(endpoints.map(e => [e, {status: 200, body: {success: true, data: []}}]))}); }
  return jsonRes({success: true, data: []});
 });
 try {
  const p = new Providers(() => ({profileServer: SERVER}), tmp()); p.offline = false;
  await p.enrich({id: 'g', title: 'God of War III Remastered', art: {}}, {sgdb: {id: 123}});
  assert.equal(f.calls.length, 1, 'capa, horizontal, fundo, logo e ícone num pedido');
  assert.equal(JSON.parse(f.calls[0].body).endpoints.length, 5);
 } finally { f.restore(); }
 const old = withFetch(url => url.endsWith('/v1/sgdb/batch') ? jsonRes({error: 'not_found'}, 404) : jsonRes({success: true, data: []}));
 try {
  const p = new Providers(() => ({profileServer: SERVER}), tmp()); p.offline = false;
  await p.enrich({id: 'g', title: 'X', art: {}}, {sgdb: {id: 7}});
  assert.equal(old.calls.filter(c => c.url.includes('/v1/sgdb/grids/')).length, 2);
  assert.ok(p.noBatch);
 } finally { old.restore(); }
});

test('Servidor: rota em lote, limite por IP maior; capas voltam depois do limite; login do RetroAchievements alinhado', () => {
 const w = fs.readFileSync(new URL('../tools/profile-server/worker.js', import.meta.url), 'utf8');
 assert.match(w, /url\.pathname === '\/v1\/sgdb\/batch' && request\.method === 'POST'/);
 assert.match(w, /win = 5 \* 60000, max = 1500;/);
 const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
 assert.match(server, /function coverAfterLimit\(\)/);
 assert.match(server, /g\.artTriedApi===false\)return !providers\.limited\?\.\(\);/);
 const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'), css = fs.readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
 assert.match(app, /<form id="ra-login-form" class="dlg-form">/);
 assert.match(css, /\.dlg-form label\{display:flex;flex-direction:column/);
});
