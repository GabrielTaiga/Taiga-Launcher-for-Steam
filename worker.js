// Servidor do Taiga Launcher na Cloudflare (Worker). Guarda as chaves do SteamGridDB e da IGDB e um banco próprio
// (D1) com tudo o que já foi pesquisado: quando alguém busca um jogo, a resposta fica salva e serve para todos os
// outros usuários. Assim as APIs recebem um pedido por jogo por mês, e não um por pessoa, e os limites deixam de
// ser um problema.
//
// Configuração (painel da Cloudflare):
//  - Secrets: SGDB_KEY (SteamGridDB), TWITCH_ID e TWITCH_SECRET (IGDB/Twitch).
//  - Binding D1: banco "taiga-cache" com o nome DB (a tabela é criada sozinha no primeiro uso).
//  - (Opcional) Binding KV: PROFILES, para o perfil público de amigos no futuro.
//  - Comentários dos jogos: secret STEAM_KEY (chave da API da Steam, steamcommunity.com/dev/apikey), variável
//    COMMENTS_MIN_LEVEL (nível mínimo da conta Steam para comentar, padrão 3) e, para moderar, o secret ADMIN_KEY
//    (página /v1/admin). Banco: COMMENTS_DB (recomendado, um D1 só para eles) ou o mesmo DB; tabelas c_* criadas sozinhas.
//
// Rotas (só leitura de dados públicos; o programa não consegue gravar nada no banco):
//  GET  /v1/health                     → o que está configurado
//  GET  /v1/sgdb/<endpoint da API v2>  → SteamGridDB (busca, grades, heróis, logos, ícones, jogos)
//  POST /v1/sgdb/batch {endpoints:[...]} → até 8 consultas do SteamGridDB num pedido só (capa, fundo, logo e ícone de um
//                                       jogo): cada pedido ao worker conta no limite diário da Cloudflare.
//  POST /v1/igdb/games  (consulta)     → IGDB
//  POST /v1/igdb/characters (consulta)  → IGDB (personagens: cartas dos jogos de emulador)
//  GET/PUT /v1/profiles/<SteamID64>    → perfil público (precisa do KV PROFILES)
//  Comentários (login pela Steam, OpenID oficial; a senha nunca passa por aqui):
//  POST /v1/auth/start, GET /v1/auth/steam, GET /v1/auth/return, POST /v1/auth/poll, POST /v1/auth/logout
//  GET  /v1/comments?game=<chave>      → comentários do jogo (públicos)
//  POST /v1/comments                   → comentar (conta Steam conectada, nível mínimo, perfil público)
//  DELETE /v1/comments/<id>            → apagar o próprio comentário
//  POST /v1/comments/<id>/report       → denunciar (3 denúncias escondem o comentário até a moderação)
//  POST /v1/comments/<id>/like         → curtir ({like: false} desfaz); GET /v1/comments aceita sort=popular e offset
//  GET  /v1/admin                      → página de moderação (ADMIN_KEY)
const MAX = 1024 * 1024;
const SGDB_ENDPOINT = /^(search\/autocomplete|grids|heroes|logos|icons|games)\//;
const DAY = 86400000;
const TTL_OK = 30 * DAY, TTL_EMPTY = 3 * DAY;
const json = (body, status = 200, extra = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...extra}});
async function sha256(text) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); }

// Limite simples por endereço IP (por instância): evita que alguém use o servidor para esgotar as chaves.
const hitsByIp = new Map();
function tooMany(request) {
 // 1500 em 5 minutos: dá para a primeira busca de uma biblioteca grande (centenas de jogos) sem bloquear a pessoa.
 const ip = request.headers.get('cf-connecting-ip') || 'x', now = Date.now(), win = 5 * 60000, max = 1500;
 const row = hitsByIp.get(ip); if (!row || now - row.at > win) { hitsByIp.set(ip, {at: now, n: 1}); if (hitsByIp.size > 5000) hitsByIp.clear(); return false; }
 row.n++; return row.n > max;
}

export default {
 async fetch(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PUT, DELETE', 'access-control-allow-headers': 'content-type, x-taiga-key, authorization, x-admin-key'}});
  // Links de apoio mostrados no programa: defina KOFI_URL e SPONSORS_URL nas variáveis do worker.
  if (url.pathname === '/v1/links') return json({kofi: String(env.KOFI_URL || ''), sponsors: String(env.SPONSORS_URL || '')}, 200, {'cache-control': 'public, max-age=3600'});
  if (url.pathname === '/v1/health') return json({ok: true, commentsCheck: await commentsCheck(env, url.searchParams.get('write') === '1'), sgdb: !!env.SGDB_KEY, igdb: !!(env.TWITCH_ID && env.TWITCH_SECRET), db: !!env.DB, profiles: !!env.PROFILES, comments: !!((env.COMMENTS_DB || env.DB) && env.STEAM_KEY), commentsDb: env.COMMENTS_DB ? 'own' : env.DB ? 'shared' : 'none', commentsMinLevel: minLevel(env)});
  if (tooMany(request)) return json({error: 'rate_limited'}, 429, {'retry-after': '60'});
  try {
   if (url.pathname === '/v1/sgdb/batch' && request.method === 'POST') return await sgdbBatch(request, env, ctx);
  if (url.pathname.startsWith('/v1/sgdb/') && request.method === 'GET') return await sgdb(url, env, ctx);
   if (url.pathname === '/v1/igdb/games' && request.method === 'POST') return await igdb(request, env, ctx, 'games');
   if (url.pathname === '/v1/igdb/characters' && request.method === 'POST') return await igdb(request, env, ctx, 'characters');
   const m = url.pathname.match(/^\/v1\/profiles\/(\d{17})$/);
   if (m) return await profiles(request, env, m[1]);
   if (url.pathname.startsWith('/v1/auth/') || url.pathname.startsWith('/v1/comments') || url.pathname.startsWith('/v1/admin')) return await comments(request, env, url);
  } catch (e) { return json({error: 'server', message: String(e && e.message || e).slice(0, 200)}, 500); }
  return json({error: 'not_found'}, 404);
 },
};

// ── banco compartilhado (D1) + cache da borda ──
let tableReady = false;
async function db(env) {
 if (!env.DB) return null;
 if (!tableReady) { await env.DB.prepare('CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT NOT NULL, status INTEGER NOT NULL, at INTEGER NOT NULL)').run(); try { await env.DB.prepare('DROP INDEX IF EXISTS cache_at').run(); } catch {} tableReady = true; }
 return env.DB;
}
// Ordem: cache da borda (grátis e rápido) → banco D1 → API de origem. Se a origem falhar (limite, fora do ar), a
// resposta antiga do banco é usada mesmo vencida: o programa nunca fica sem resposta por causa de limite.
async function shared(key, env, ctx, fetchOrigin) {
 const edge = caches.default, edgeReq = new Request('https://cache.taiga-launcher/' + await sha256(key));
 const hit = await edge.match(edgeReq); if (hit) return hit;
 const d = await db(env).catch(() => null), k = await sha256(key);
 let row = null; if (d) { try { row = await d.prepare('SELECT v, status, at FROM cache WHERE k = ?').bind(k).first(); } catch {} }
 const fresh = row && Date.now() - row.at < (row.status !== 200 || isEmpty(row.v) ? TTL_EMPTY : TTL_OK);
 const respond = (text, status, source) => { const r = json(text, status, {'cache-control': 'public, max-age=86400', 'x-taiga-cache': source}); ctx.waitUntil(edge.put(edgeReq, r.clone())); return r; };
 if (fresh) return respond(row.v, row.status, 'db');
 let res = null; try { res = await fetchOrigin(); } catch {}
 // "Não encontrado" também fica salvo (por menos tempo): o mesmo jogo inexistente não gasta a chave toda vez.
 if (res && (res.ok || res.status === 404)) {
  const status = res.ok ? 200 : 404, text = res.ok ? await res.text() : '[]'; if (text.length > 512 * 1024) return json(text, status);
  // O banco guarda só respostas com resultado (as vazias ficam no cache da borda): cada gravação conta no limite
  // diário grátis da Cloudflare, que é o mesmo dos comentários.
  // Só uma parte das respostas novas vai para o banco (as mais pedidas acabam entrando): o cache da borda já serve
  // quase tudo e cada gravação gasta o limite diário grátis da Cloudflare, que é o mesmo dos comentários.
  if (d && status === 200 && !isEmpty(text) && text.length <= 200 * 1024 && Math.random() < (Number.isFinite(Number(env.CACHE_SAVE_RATE)) ? Number(env.CACHE_SAVE_RATE) : SAVE_RATE)) ctx.waitUntil(saveCache(d, k, text, status));
  return respond(text, status, 'origin');
 }
 if (row) return respond(row.v, row.status, 'db-stale');
 return json({error: 'upstream', status: res ? res.status : 0}, res && res.status === 429 ? 429 : 502);
}
// Guarda no banco. Banco cheio (limite do plano grátis): apaga as respostas mais antigas (um quarto) e tenta de novo.
// De vez em quando também tira o que passou de 90 dias, para o banco não crescer sem parar.
// 0 = nada do cache de capas e dados vai para o banco (só o cache da borda, que é grátis e sem limite): o limite diário
// de gravações da conta fica inteiro para os comentários. Para voltar a guardar, defina a variável CACHE_SAVE_RATE (0 a 1).
const SAVE_RATE = 0;
async function saveCache(d, k, text, status) {
 const put = () => d.prepare('INSERT INTO cache (k, v, status, at) VALUES (?, ?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, status = excluded.status, at = excluded.at').bind(k, text, status, Date.now()).run();
 try {
  if (Math.random() < 0.005) await d.prepare('DELETE FROM cache WHERE rowid IN (SELECT rowid FROM cache WHERE at < ? ORDER BY rowid LIMIT 200)').bind(Date.now() - 90 * DAY).run();
  await put();
 } catch (e) {
  if (!/maximum DB size|SQLITE_FULL|database or disk is full/i.test(String(e && e.message || e))) return;
  try { await pruneCache(d, 0.25); await put(); } catch {}
 }
}
async function pruneCache(d, fraction) {
 // Sem contar a tabela inteira (cada linha lida conta no limite diário): apaga um lote fixo das mais antigas.
 const drop = Math.max(50, Math.min(2000, Math.round(fraction * 4000)));
 await d.prepare('DELETE FROM cache WHERE rowid IN (SELECT rowid FROM cache ORDER BY rowid LIMIT ?)').bind(drop).run();
 return drop;
}
const isEmpty = text => /^\s*(\[\s*\]|\{\s*"success"\s*:\s*true\s*,\s*"data"\s*:\s*\[\s*\]\s*\})\s*$/.test(text);

async function sgdb(url, env, ctx) {
 if (!env.SGDB_KEY) return json({error: 'not_configured'}, 503);
 const endpoint = url.pathname.slice('/v1/sgdb/'.length) + url.search;
 if (!SGDB_ENDPOINT.test(endpoint) || endpoint.length > 600) return json({error: 'endpoint'}, 400);
 return sgdbOne(endpoint, env, ctx);
}
const sgdbOne = (endpoint, env, ctx) => shared('sgdb:' + endpoint, env, ctx, () => fetch('https://www.steamgriddb.com/api/v2/' + endpoint, {headers: {Authorization: 'Bearer ' + env.SGDB_KEY}}));
async function sgdbBatch(request, env, ctx) {
 if (!env.SGDB_KEY) return json({error: 'not_configured'}, 503);
 let body; try { body = JSON.parse(await request.text()); } catch { return json({error: 'json'}, 400); }
 const list = [...new Set(Array.isArray(body?.endpoints) ? body.endpoints.map(String) : [])];
 if (!list.length || list.length > 8 || list.some(e => !SGDB_ENDPOINT.test(e) || e.length > 600)) return json({error: 'endpoint'}, 400);
 const results = {};
 await Promise.all(list.map(async e => { try { const r = await sgdbOne(e, env, ctx), text = await r.text(); let parsed = null; try { parsed = JSON.parse(text); } catch {} results[e] = {status: r.status, body: parsed}; } catch { results[e] = {status: 502, body: null}; } }));
 return json({results});
}

// IGDB: até 4 pedidos por segundo por chave. Uma fila por instância segura o ritmo; em "429" espera e tenta de novo.
let twitch = null, lastIgdb = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function igdbToken(env) {
 if (twitch && twitch.until > Date.now()) return twitch.token;
 const t = await (await fetch('https://id.twitch.tv/oauth2/token', {method: 'POST', body: new URLSearchParams({client_id: env.TWITCH_ID, client_secret: env.TWITCH_SECRET, grant_type: 'client_credentials'})})).json();
 if (!t.access_token) throw Error('twitch_auth');
 twitch = {token: t.access_token, until: Date.now() + (Number(t.expires_in) || 3600) * 1000 - 600000}; return twitch.token;
}
async function igdb(request, env, ctx, endpoint = 'games') {
 if (!env.TWITCH_ID || !env.TWITCH_SECRET) return json({error: 'not_configured'}, 503);
 const query = await request.text(); if (query.length > 4000) return json({error: 'too_large'}, 413);
 return shared('igdb:' + (endpoint === 'games' ? '' : endpoint + ':') + query.replace(/\s+/g, ' ').trim(), env, ctx, async () => {
  for (let i = 0; i < 3; i++) {
   const wait = 260 - (Date.now() - lastIgdb); if (wait > 0) await sleep(wait); lastIgdb = Date.now();
   const res = await fetch('https://api.igdb.com/v4/' + endpoint, {method: 'POST', headers: {'Client-ID': env.TWITCH_ID, Authorization: 'Bearer ' + await igdbToken(env), 'Content-Type': 'text/plain'}, body: query});
   if (res.status === 401) { twitch = null; continue; }
   if (res.status === 429) { await sleep(600 * (i + 1)); continue; }
   return res;
  }
  return new Response('', {status: 429});
 });
}

async function profiles(request, env, id) {
 if (!env.PROFILES) return json({error: 'not_configured'}, 503);
 if (request.method === 'GET') { const v = await env.PROFILES.get('p:' + id); return v ? json(v, 200, {'cache-control': 'public, max-age=300'}) : json({error: 'not_found'}, 404); }
 if (request.method !== 'PUT') return json({error: 'method'}, 405);
 const key = request.headers.get('x-taiga-key') || ''; if (!/^[0-9a-f]{48}$/.test(key)) return json({error: 'key'}, 401);
 const body = await request.text(); if (body.length > MAX) return json({error: 'too_large'}, 413);
 let data; try { data = JSON.parse(body); } catch { return json({error: 'json'}, 400); }
 if (data?.v !== 1 || String(data.steamId) !== id || !Array.isArray(data.games)) return json({error: 'shape'}, 400);
 const owner = await env.PROFILES.get('k:' + id), hash = await sha256(key);
 if (owner && owner !== hash) return json({error: 'owner'}, 403);
 if (!owner) await env.PROFILES.put('k:' + id, hash);
 await env.PROFILES.put('p:' + id, body);
 return json({ok: true});
}

// ══ Comentários dos jogos ══
// Segurança:
//  - Login só pelo OpenID oficial da Steam (steamcommunity.com): o servidor recebe apenas o SteamID confirmado pela
//    própria Steam. A senha nunca passa pelo Taiga Launcher nem por aqui.
//  - O programa recebe a sessão por um pedido próprio (código de uso único + segredo que só ele conhece), sem servidor
//    local e sem nada aberto no PC.
//  - Sessões guardadas só como hash. Comentários são texto puro (sem links, sem HTML), com limite de tamanho e de
//    frequência. Conta precisa de perfil público e nível mínimo. 3 denúncias escondem o comentário.
// Espaço: tabelas enxutas (números em vez de textos longos, horários em segundos, conta Steam como número de 32 bits,
// jogo guardado uma vez só, foto só pelo código), curtidas e denúncias sem linha extra, e limpeza automática do que
// não serve mais (escondidos há 60 dias, sessões paradas há 180 dias, logins não concluídos).
const OPENID = 'https://steamcommunity.com/openid/login';
const AVATAR_RE = /^https:\/\/avatars\.(?:akamai\.|cloudflare\.|fastly\.)?steamstatic\.com\/([a-f0-9]{40})(?:_full|_medium)?\.jpg$/;
const DEFAULT_AVATAR = 'https://avatars.fastly.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg';
const avatarUrl = hash => /^[a-f0-9]{40}$/.test(String(hash || '')) ? 'https://avatars.fastly.steamstatic.com/' + hash + '_full.jpg' : DEFAULT_AVATAR;
const GAME_RE = /^[a-z]{2,8}:[a-z0-9._:-]{1,100}$/;
const MAX_BODY = 500;
const LANG_RE = /^(pt|en|es|fr|de)$/;
const STEAM_BASE = 76561197960265728n;
const toAccount = steamid => Number(BigInt(steamid) - STEAM_BASE);
const toSteamId = account => String(STEAM_BASE + BigInt(account));
const now = () => Math.floor(Date.now() / 1000);
const minLevel = env => { const n = Number(env.COMMENTS_MIN_LEVEL); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 3; };
const randomHex = bytes => [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
const tokenKey = async token => (await sha256(token)).slice(0, 32);
const noStore = {'cache-control': 'no-store'};
function sameText(a, b) { a = String(a || ''); b = String(b || ''); if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }

let commentTables = false;
// Comentários num banco próprio (COMMENTS_DB) quando existir: o cache de capas e dados nunca enche o espaço deles.
async function cdb(env) {
 const DB = env.COMMENTS_DB || env.DB;
 if (!DB) return null;
 if (!commentTables) {
  await DB.batch([
   DB.prepare('CREATE TABLE IF NOT EXISTS cgm (id INTEGER PRIMARY KEY, k TEXT NOT NULL UNIQUE)'),
   DB.prepare('CREATE TABLE IF NOT EXISTS cm (id INTEGER PRIMARY KEY, g INTEGER NOT NULL, u INTEGER NOT NULL, b TEXT NOT NULL, t INTEGER NOT NULL, l INTEGER NOT NULL DEFAULT 0, r INTEGER NOT NULL DEFAULT 0, h INTEGER NOT NULL DEFAULT 0)'),
   DB.prepare('CREATE INDEX IF NOT EXISTS cm_g ON cm (g, t)'),
   DB.prepare('CREATE INDEX IF NOT EXISTS cm_u ON cm (u, t)'),
   DB.prepare('CREATE TABLE IF NOT EXISTS cl (c INTEGER NOT NULL, u INTEGER NOT NULL, PRIMARY KEY (c, u)) WITHOUT ROWID'),
   DB.prepare('CREATE TABLE IF NOT EXISTS cr (c INTEGER NOT NULL, u INTEGER NOT NULL, PRIMARY KEY (c, u)) WITHOUT ROWID'),
   DB.prepare('CREATE TABLE IF NOT EXISTS cs (k TEXT PRIMARY KEY, u INTEGER NOT NULL, t INTEGER NOT NULL) WITHOUT ROWID'),
   DB.prepare('CREATE TABLE IF NOT EXISTS cg (id TEXT PRIMARY KEY, ch TEXT NOT NULL, t INTEGER NOT NULL, tok TEXT, u INTEGER) WITHOUT ROWID'),
   DB.prepare('CREATE TABLE IF NOT EXISTS cu (u INTEGER PRIMARY KEY, n TEXT, a TEXT, lv INTEGER, p INTEGER, t INTEGER NOT NULL)'),
   DB.prepare('CREATE TABLE IF NOT EXISTS cb (u INTEGER PRIMARY KEY, t INTEGER NOT NULL)'),
   // Tabelas da primeira versão (só tinham testes): removidas para não ocupar espaço.
   DB.prepare('DROP TABLE IF EXISTS c_comments'), DB.prepare('DROP TABLE IF EXISTS c_likes'), DB.prepare('DROP TABLE IF EXISTS c_reports'),
   DB.prepare('DROP TABLE IF EXISTS c_sessions'), DB.prepare('DROP TABLE IF EXISTS c_logins'), DB.prepare('DROP TABLE IF EXISTS c_users'), DB.prepare('DROP TABLE IF EXISTS c_bans'),
  ]);
  // Idioma do comentário (pt, en, es, fr, de): coluna nova; em bancos antigos é acrescentada uma vez.
  try { await DB.prepare('ALTER TABLE cm ADD COLUMN lg TEXT').run(); } catch (e) { if (!/duplicate column/i.test(String(e && e.message || e))) throw e; }
  commentTables = true;
 }
 return DB;
}
const FULL = e => /maximum DB size|SQLITE_FULL|database or disk is full|D1_ERROR.*full/i.test(String(e && e.message || e));
// Teste rápido do banco dos comentários para a página /v1/health (lê e grava uma linha temporária).
async function commentsCheck(env, write = false) {
 try {
  const d = await cdb(env); if (!d) return 'sem banco';
  // Só leitura por padrão (gravar gasta o limite diário); /v1/health?write=1 testa a gravação também.
  if (!write) { await d.prepare('SELECT 1 FROM cg LIMIT 1').first(); return 'ok'; }
  const id = randomHex(16);
  await d.prepare('INSERT INTO cg (id, ch, t) VALUES (?, ?, ?)').bind(id, 'health', now()).run();
  await d.prepare('DELETE FROM cg WHERE id = ?').bind(id).run();
  return 'ok';
 } catch (e) { return 'erro: ' + String(e && e.message || e).slice(0, 160); }
}
// Limpeza de vez em quando (1 em cada 50 gravações).
async function tidy(d) {
 if (Math.random() > 0.02) return;
 const t = now();
 try { await d.batch([
  d.prepare('DELETE FROM cm WHERE h = 1 AND t < ?').bind(t - 60 * 86400),
  d.prepare('DELETE FROM cl WHERE c NOT IN (SELECT id FROM cm)'),
  d.prepare('DELETE FROM cr WHERE c NOT IN (SELECT id FROM cm)'),
  d.prepare('DELETE FROM cs WHERE t < ?').bind(t - 180 * 86400),
  d.prepare('DELETE FROM cg WHERE t < ?').bind(t - 900),
 ]); } catch {}
}
async function readJson(request, max = 8192) { const t = await request.text(); if (t.length > max) throw Object.assign(Error('too_large'), {status: 413}); try { return JSON.parse(t || '{}'); } catch { throw Object.assign(Error('json'), {status: 400}); } }
// Conta conectada (número da conta Steam) pela sessão, ou null.
async function sessionUser(request, d) {
 const m = String(request.headers.get('authorization') || '').match(/^Bearer ([0-9a-f]{64})$/); if (!m) return null;
 const k = await tokenKey(m[1]);
 const row = await d.prepare('SELECT u, t FROM cs WHERE k = ?').bind(k).first(); if (!row) return null;
 if (now() - row.t > 180 * 86400) { await d.prepare('DELETE FROM cs WHERE k = ?').bind(k).run(); return null; }
 if (now() - row.t > 86400) await d.prepare('UPDATE cs SET t = ? WHERE k = ?').bind(now(), k).run();
 return Number(row.u);
}
// Nome, foto, nível e se o perfil é público (API oficial da Steam), guardados por 12 h.
async function steamUser(u, env, d, force = false) {
 const old = await d.prepare('SELECT * FROM cu WHERE u = ?').bind(u).first();
 if (old && !force && now() - old.t < 12 * 3600) return old;
 if (!env.STEAM_KEY) return old || null;
 const steamid = toSteamId(u);
 try {
  const s = await (await fetch('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=' + encodeURIComponent(env.STEAM_KEY) + '&steamids=' + steamid)).json();
  const p = s?.response?.players?.[0]; if (!p) return old || null;
  const isPublic = Number(p.communityvisibilitystate) === 3 ? 1 : 0;
  let level = null;
  if (isPublic) { try { const l = await (await fetch('https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=' + encodeURIComponent(env.STEAM_KEY) + '&steamid=' + steamid)).json(); if (Number.isFinite(Number(l?.response?.player_level))) level = Number(l.response.player_level); } catch {} }
  const row = {u, n: String(p.personaname || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64) || steamid, a: String(p.avatarfull || '').match(AVATAR_RE)?.[1] || '', lv: level, p: isPublic, t: now()};
  await d.prepare('INSERT INTO cu (u, n, a, lv, p, t) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(u) DO UPDATE SET n = excluded.n, a = excluded.a, lv = excluded.lv, p = excluded.p, t = excluded.t').bind(row.u, row.n, row.a, row.lv, row.p, row.t).run();
  return row;
 } catch { return old || null; }
}
const userView = (u, row) => ({steamid: toSteamId(u), name: row?.n || toSteamId(u), avatar: avatarUrl(row?.a), level: row?.lv ?? null, public: !!row?.p});
const publicComment = r => ({id: String(r.id), body: r.b, at: Number(r.t) * 1000, likes: Number(r.l) || 0, lang: LANG_RE.test(r.lg || '') ? r.lg : null, ...(r.liked !== undefined ? {liked: !!r.liked} : {}), steamid: toSteamId(r.u), name: r.n || toSteamId(r.u), avatar: avatarUrl(r.a)});
async function gameId(d, key, create = false) {
 if (create) await d.prepare('INSERT OR IGNORE INTO cgm (k) VALUES (?)').bind(key).run();
 return (await d.prepare('SELECT id FROM cgm WHERE k = ?').bind(key).first())?.id ?? null;
}
// Texto puro: sem caracteres de controle (menos a quebra de linha), no máximo 2 linhas em branco seguidas, sem links.
function cleanBody(text) {
 const t = String(text || '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/[ \t]{3,}/g, '  ').replace(/\n{3,}/g, '\n\n').trim();
 if (!t) return {error: 'empty'};
 if ([...t].length > MAX_BODY) return {error: 'too_long'};
 if (/(?:https?:\/\/|www\.|discord\.gg|t\.me\/|\b[a-z0-9-]{2,}\.(?:com|net|org|io|gg|xyz|ru|br|me|ly|co|tk|app|site|online|link|shop)\b)/i.test(t)) return {error: 'no_links'};
 return {body: t};
}
const LOGIN_TEXT = {
 pt: ['Pronto!', 'Sua conta Steam foi conectada aos comentários do Taiga Launcher. Pode fechar esta página.', 'Não foi possível confirmar o login', 'Tente de novo pelo Taiga Launcher.'],
 en: ['Done!', 'Your Steam account is now connected to Taiga Launcher comments. You can close this page.', 'Could not confirm the sign-in', 'Please try again from Taiga Launcher.'],
 es: ['¡Listo!', 'Tu cuenta de Steam quedó conectada a los comentarios de Taiga Launcher. Puedes cerrar esta página.', 'No se pudo confirmar el inicio de sesión', 'Inténtalo de nuevo desde Taiga Launcher.'],
 fr: ['C’est fait !', 'Votre compte Steam est connecté aux commentaires de Taiga Launcher. Vous pouvez fermer cette page.', 'Impossible de confirmer la connexion', 'Réessayez depuis Taiga Launcher.'],
 de: ['Fertig!', 'Dein Steam-Konto ist jetzt mit den Kommentaren von Taiga Launcher verbunden. Du kannst diese Seite schließen.', 'Die Anmeldung konnte nicht bestätigt werden', 'Bitte versuche es erneut über Taiga Launcher.'],
};
function loginPage(request, ok) {
 const lang = (String(request.headers.get('accept-language') || '').match(/^(pt|en|es|fr|de)/i)?.[1] || 'en').toLowerCase(), t = LOGIN_TEXT[lang] || LOGIN_TEXT.en;
 const title = ok ? t[0] : t[2], body = ok ? t[1] : t[3];
 const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Taiga Launcher</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1b2838;color:#dcdedf;font-family:"Motiva Sans",Arial,sans-serif}main{max-width:460px;padding:32px;background:#16202d;border-radius:4px;box-shadow:0 8px 32px #0008;text-align:center}h1{margin:0 0 12px;font-size:22px;color:${ok ? '#a4d007' : '#ff8a8a'}}p{margin:0;line-height:1.5;color:#acb2b8}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
 return new Response(html, {status: ok ? 200 : 400, headers: {'content-type': 'text/html; charset=utf-8', ...noStore, 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'"}});
}

async function comments(request, env, url) {
 const retry = request.method === 'GET' || request.method === 'DELETE' ? null : request.clone();
 try { return await commentsOnce(request, env, url); }
 catch (e) {
  // Banco cheio: quando os comentários dividem o banco com o cache de capas, o cache mais velho dá lugar.
  if (FULL(e) && env.DB && (!env.COMMENTS_DB || env.COMMENTS_DB === env.DB)) {
   try { await pruneCache(env.DB, 0.3); commentTables = false; return await commentsOnce(retry || request, env, url); } catch {}
  }
  // Páginas abertas no navegador (login pela Steam): mostra a página do Taiga, nunca o erro cru.
  if (/^\/v1\/auth\/(steam|return)$/.test(url.pathname)) return loginPage(request, false);
  return json({error: 'server', message: String(e && e.message || e).slice(0, 160)}, 500, noStore);
 }
}
async function commentsOnce(request, env, url) {
 const d = await cdb(env); if (!d) return json({error: 'not_configured'}, 503, noStore);
 const p = url.pathname, method = request.method, origin = url.origin;
 try {
  // ── login ──
  if (p === '/v1/auth/start' && method === 'POST') {
   const b = await readJson(request); const id = String(b.id || ''), challenge = String(b.challenge || '');
   if (!/^[0-9a-f]{32}$/.test(id) || !/^[0-9a-f]{64}$/.test(challenge)) return json({error: 'shape'}, 400, noStore);
   await d.prepare('DELETE FROM cg WHERE t < ?').bind(now() - 900).run();
   await d.prepare('INSERT INTO cg (id, ch, t) VALUES (?, ?, ?)').bind(id, challenge, now()).run();
   return json({url: origin + '/v1/auth/steam?id=' + id, minLevel: minLevel(env)}, 200, noStore);
  }
  if (p === '/v1/auth/steam' && method === 'GET') {
   const id = url.searchParams.get('id') || ''; if (!/^[0-9a-f]{32}$/.test(id)) return loginPage(request, false);
   const row = await d.prepare('SELECT t FROM cg WHERE id = ? AND tok IS NULL').bind(id).first(); if (!row || now() - row.t > 600) return loginPage(request, false);
   const q = new URLSearchParams({'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'checkid_setup', 'openid.return_to': origin + '/v1/auth/return?id=' + id, 'openid.realm': origin, 'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select', 'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'});
   return new Response(null, {status: 302, headers: {location: OPENID + '?' + q, ...noStore}});
  }
  if (p === '/v1/auth/return' && method === 'GET') {
   const id = url.searchParams.get('id') || ''; if (!/^[0-9a-f]{32}$/.test(id)) return loginPage(request, false);
   const row = await d.prepare('SELECT t FROM cg WHERE id = ? AND tok IS NULL').bind(id).first(); if (!row || now() - row.t > 600) return loginPage(request, false);
   const q = url.searchParams, claimed = q.get('openid.claimed_id') || '', m = claimed.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(7656\d{13})$/);
   const signed = String(q.get('openid.signed') || '').split(',');
   if (q.get('openid.mode') !== 'id_res' || !m || q.get('openid.identity') !== claimed || q.get('openid.op_endpoint') !== OPENID || q.get('openid.return_to') !== origin + '/v1/auth/return?id=' + id || !['claimed_id', 'identity', 'return_to', 'response_nonce'].every(k => signed.includes(k))) return loginPage(request, false);
   // Confirmação direta com a Steam (a resposta só vale se a própria Steam disser que é válida).
   const check = new URLSearchParams(); for (const [k, v] of q) if (k.startsWith('openid.')) check.set(k, v); check.set('openid.mode', 'check_authentication');
   const verify = await (await fetch(OPENID, {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: check.toString()})).text();
   if (!/(^|\n)is_valid:true(\n|$)/.test(verify)) return loginPage(request, false);
   const u = toAccount(m[1]);
   if (await d.prepare('SELECT 1 FROM cb WHERE u = ?').bind(u).first()) return loginPage(request, false);
   const token = randomHex(32);
   await d.batch([
    d.prepare('INSERT INTO cs (k, u, t) VALUES (?, ?, ?)').bind(await tokenKey(token), u, now()),
    d.prepare('UPDATE cg SET tok = ?, u = ? WHERE id = ?').bind(token, u, id),
   ]);
   await steamUser(u, env, d, true);
   return loginPage(request, true);
  }
  if (p === '/v1/auth/poll' && method === 'POST') {
   const b = await readJson(request); const id = String(b.id || ''), verifier = String(b.verifier || '');
   if (!/^[0-9a-f]{32}$/.test(id) || !/^[0-9a-f]{64}$/.test(verifier)) return json({error: 'shape'}, 400, noStore);
   const row = await d.prepare('SELECT * FROM cg WHERE id = ?').bind(id).first();
   if (!row || now() - row.t > 900 || !sameText(row.ch, await sha256(verifier))) return json({error: 'expired'}, 410, noStore);
   if (!row.tok) return json({pending: true}, 200, noStore);
   await d.prepare('DELETE FROM cg WHERE id = ?').bind(id).run();
   const u = Number(row.u), info = await steamUser(u, env, d);
   return json({token: row.tok, ...userView(u, info), minLevel: minLevel(env)}, 200, noStore);
  }
  if (p === '/v1/auth/logout' && method === 'POST') {
   const m = String(request.headers.get('authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
   if (m) await d.prepare('DELETE FROM cs WHERE k = ?').bind(await tokenKey(m[1])).run();
   return json({ok: true}, 200, noStore);
  }
  if (p === '/v1/auth/me' && method === 'GET') {
   const u = await sessionUser(request, d); if (u === null) return json({error: 'login'}, 401, noStore);
   return json({...userView(u, await steamUser(u, env, d)), minLevel: minLevel(env)}, 200, noStore);
  }
  // ── comentários ──
  if (p === '/v1/comments' && method === 'GET') {
   const key = String(url.searchParams.get('game') || ''); if (!GAME_RE.test(key)) return json({error: 'game'}, 400, noStore);
   // Mais recentes (padrão) ou mais curtidos; páginas de 20. Com a sessão, diz quais você curtiu.
   const popular = url.searchParams.get('sort') === 'popular', offset = Math.min(2000, Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0))), limit = 20;
   const g = await gameId(d, key);
   // Idioma: com lang, só os comentários nesse idioma (e os antigos, sem idioma); all=1 traz todos.
   const lang = LANG_RE.test(url.searchParams.get('lang') || '') ? url.searchParams.get('lang') : '', all = url.searchParams.get('all') === '1' || !lang;
   if (g === null) return json({items: [], more: false, total: offset === 0 ? 0 : undefined, others: 0, minLevel: minLevel(env)}, 200, noStore);
   const where = all ? 'c.g = ? AND c.h = 0' : 'c.g = ? AND c.h = 0 AND (c.lg = ? OR c.lg IS NULL)', wb = all ? [g] : [g, lang];
   const me = await sessionUser(request, d);
   const rows = (await d.prepare('SELECT c.id, c.b, c.t, c.l, c.u, c.lg, cu.n, cu.a' + (me !== null ? ', (SELECT 1 FROM cl WHERE cl.c = c.id AND cl.u = ?) AS liked' : '') + ' FROM cm c LEFT JOIN cu ON cu.u = c.u WHERE ' + where + ' ORDER BY ' + (popular ? 'c.l DESC, c.t DESC' : 'c.t DESC') + ' LIMIT ? OFFSET ?').bind(...(me !== null ? [me] : []), ...wb, limit + 1, offset).all()).results || [];
   const total = offset === 0 ? Number((await d.prepare('SELECT COUNT(*) AS n FROM cm c WHERE ' + where).bind(...wb).first())?.n || 0) : undefined;
   const others = offset === 0 && !all ? Number((await d.prepare('SELECT COUNT(*) AS n FROM cm WHERE g = ? AND h = 0 AND lg IS NOT NULL AND lg <> ?').bind(g, lang).first())?.n || 0) : undefined;
   return json({items: rows.slice(0, limit).map(r => publicComment(me !== null ? {...r, liked: r.liked} : r)), more: rows.length > limit, total, others, minLevel: minLevel(env)}, 200, noStore);
  }
  if (p === '/v1/comments' && method === 'POST') {
   const u = await sessionUser(request, d); if (u === null) return json({error: 'login'}, 401, noStore);
   if (!env.STEAM_KEY) return json({error: 'not_configured'}, 503, noStore);
   if (await d.prepare('SELECT 1 FROM cb WHERE u = ?').bind(u).first()) return json({error: 'banned'}, 403, noStore);
   const b = await readJson(request); const key = String(b.game || ''); if (!GAME_RE.test(key)) return json({error: 'game'}, 400, noStore);
   const clean = cleanBody(b.text); if (clean.error) return json({error: clean.error, max: MAX_BODY}, 400, noStore);
   const info = await steamUser(u, env, d);
   if (!info) return json({error: 'steam_unavailable'}, 503, noStore);
   if (!info.p) return json({error: 'private_profile'}, 403, noStore);
   if (!(Number(info.lv) >= minLevel(env))) return json({error: 'low_level', minLevel: minLevel(env), level: info.lv}, 403, noStore);
   const last = await d.prepare('SELECT t FROM cm WHERE u = ? ORDER BY t DESC LIMIT 1').bind(u).first();
   if (last && now() - last.t < 30) return json({error: 'slow_down', wait: 30 - (now() - last.t)}, 429, noStore);
   const today = Number((await d.prepare('SELECT COUNT(*) AS n FROM cm WHERE u = ? AND t > ?').bind(u, now() - 86400).first())?.n || 0);
   if (today >= 30) return json({error: 'daily_limit'}, 429, noStore);
   const g = await gameId(d, key, true);
   if (await d.prepare('SELECT 1 FROM cm WHERE u = ? AND t > ? AND g = ? AND b = ?').bind(u, now() - 86400, g, clean.body).first()) return json({error: 'duplicate'}, 409, noStore);
   const t = now();
   const lg = LANG_RE.test(String(b.lang || '')) ? String(b.lang) : null;
   const res = await d.prepare('INSERT INTO cm (g, u, b, t, lg) VALUES (?, ?, ?, ?, ?)').bind(g, u, clean.body, t, lg).run();
   const id = res?.meta?.last_row_id ?? (await d.prepare('SELECT id FROM cm WHERE u = ? AND t = ? ORDER BY id DESC LIMIT 1').bind(u, t).first())?.id;
   await tidy(d);
   return json({item: publicComment({id, b: clean.body, t, l: 0, u, lg, n: info.n, a: info.a})}, 200, noStore);
  }
  const one = p.match(/^\/v1\/comments\/(\d{1,12})(\/report|\/like)?$/);
  if (one) {
   const u = await sessionUser(request, d); if (u === null) return json({error: 'login'}, 401, noStore);
   const row = await d.prepare('SELECT id, u FROM cm WHERE id = ?').bind(Number(one[1])).first(); if (!row) return json({error: 'not_found'}, 404, noStore);
   const mine = Number(row.u) === u;
   if (!one[2] && method === 'DELETE') {
    if (!mine) return json({error: 'forbidden'}, 403, noStore);
    await d.batch([d.prepare('DELETE FROM cm WHERE id = ?').bind(row.id), d.prepare('DELETE FROM cr WHERE c = ?').bind(row.id), d.prepare('DELETE FROM cl WHERE c = ?').bind(row.id)]);
    return json({ok: true}, 200, noStore);
   }
   if (one[2] === '/like' && method === 'POST') {
    if (mine) return json({error: 'own'}, 400, noStore);
    const {like} = await readJson(request);
    if (like === false) await d.prepare('DELETE FROM cl WHERE c = ? AND u = ?').bind(row.id, u).run();
    else await d.prepare('INSERT OR IGNORE INTO cl (c, u) VALUES (?, ?)').bind(row.id, u).run();
    const n = Number((await d.prepare('SELECT COUNT(*) AS n FROM cl WHERE c = ?').bind(row.id).first())?.n || 0);
    await d.prepare('UPDATE cm SET l = ? WHERE id = ?').bind(n, row.id).run();
    return json({ok: true, likes: n, liked: like !== false}, 200, noStore);
   }
   if (one[2] === '/report' && method === 'POST') {
    if (mine) return json({error: 'own'}, 400, noStore);
    await d.prepare('INSERT OR IGNORE INTO cr (c, u) VALUES (?, ?)').bind(row.id, u).run();
    const n = Number((await d.prepare('SELECT COUNT(*) AS n FROM cr WHERE c = ?').bind(row.id).first())?.n || 0);
    await d.prepare('UPDATE cm SET r = ?, h = CASE WHEN ? >= 3 THEN 1 ELSE h END WHERE id = ?').bind(n, n, row.id).run();
    return json({ok: true, hidden: n >= 3}, 200, noStore);
   }
   return json({error: 'method'}, 405, noStore);
  }
  // ── moderação ──
  if (p.startsWith('/v1/admin')) return await admin(request, env, d, url);
 } catch (e) { if (!e.status) throw e; return json({error: e.message}, e.status, noStore); }
 return json({error: 'not_found'}, 404, noStore);
}

async function admin(request, env, d, url) {
 if (url.pathname === '/v1/admin' && request.method === 'GET') return new Response(ADMIN_HTML, {headers: {'content-type': 'text/html; charset=utf-8', ...noStore, 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https://avatars.steamstatic.com https://avatars.akamai.steamstatic.com https://avatars.cloudflare.steamstatic.com https://avatars.fastly.steamstatic.com; connect-src 'self'"}});
 if (!env.ADMIN_KEY || String(env.ADMIN_KEY).length < 24 || !sameText(request.headers.get('x-admin-key') || '', env.ADMIN_KEY)) return json({error: 'admin'}, 401, noStore);
 if (url.pathname === '/v1/admin/cache/prune' && request.method === 'POST' && env.DB) { const {fraction} = await readJson(request); const f = Math.min(0.9, Math.max(0.05, Number(fraction) || 0.25)); return json({ok: true, removed: await pruneCache(env.DB, f)}, 200, noStore); }
 if (url.pathname === '/v1/admin/comments' && request.method === 'GET') {
  const rows = (await d.prepare('SELECT c.id, c.b, c.t, c.l, c.u, c.h, c.r, g.k, cu.n, cu.a, (SELECT 1 FROM cb WHERE cb.u = c.u) AS banned FROM cm c LEFT JOIN cu ON cu.u = c.u LEFT JOIN cgm g ON g.id = c.g WHERE (? = 1 OR c.r > 0 OR c.h = 1) ORDER BY c.t DESC LIMIT 100').bind(url.searchParams.get('all') === '1' ? 1 : 0).all()).results || [];
  return json({items: rows.map(r => ({...publicComment(r), game: r.k, hidden: !!r.h, reports: r.r, banned: !!r.banned}))}, 200, noStore);
 }
 const m = url.pathname.match(/^\/v1\/admin\/comments\/(\d{1,12})$/);
 if (m && request.method === 'POST') {
  const {action} = await readJson(request), id = Number(m[1]);
  if (action === 'hide' || action === 'show') await d.prepare('UPDATE cm SET h = ? WHERE id = ?').bind(action === 'hide' ? 1 : 0, id).run();
  else if (action === 'delete') await d.batch([d.prepare('DELETE FROM cm WHERE id = ?').bind(id), d.prepare('DELETE FROM cr WHERE c = ?').bind(id), d.prepare('DELETE FROM cl WHERE c = ?').bind(id)]);
  else if (action === 'clear') await d.batch([d.prepare('UPDATE cm SET r = 0, h = 0 WHERE id = ?').bind(id), d.prepare('DELETE FROM cr WHERE c = ?').bind(id)]);
  else return json({error: 'action'}, 400, noStore);
  return json({ok: true}, 200, noStore);
 }
 const b = url.pathname.match(/^\/v1\/admin\/bans\/(7656\d{13})$/);
 if (b && request.method === 'POST') {
  const {ban} = await readJson(request), u = toAccount(b[1]);
  if (ban) await d.batch([d.prepare('INSERT OR REPLACE INTO cb (u, t) VALUES (?, ?)').bind(u, now()), d.prepare('UPDATE cm SET h = 1 WHERE u = ?').bind(u), d.prepare('DELETE FROM cs WHERE u = ?').bind(u)]);
  else await d.prepare('DELETE FROM cb WHERE u = ?').bind(u).run();
  return json({ok: true}, 200, noStore);
 }
 return json({error: 'not_found'}, 404, noStore);
}

// Página de moderação: a chave fica só nesta aba (sessionStorage); tudo da lista é escrito como texto (nunca HTML).
const ADMIN_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Moderação · Taiga Launcher</title>
<style>body{margin:0;background:#1b2838;color:#dcdedf;font:14px Arial,sans-serif}header{display:flex;gap:8px;align-items:center;padding:14px 18px;background:#171a21;position:sticky;top:0}h1{font-size:16px;margin:0 auto 0 0}input,button{font:inherit;border-radius:3px;border:1px solid #3d4450;background:#2a3f5a;color:#fff;padding:6px 10px}button{cursor:pointer}main{max-width:900px;margin:0 auto;padding:16px}.c{display:flex;gap:12px;padding:12px;margin:0 0 10px;background:#16202d;border-radius:3px}.c.h{opacity:.6;border-left:3px solid #ff8a8a}.c img{width:40px;height:40px;border-radius:2px}.m{flex:1;min-width:0}.t{white-space:pre-wrap;word-break:break-word;margin:6px 0}.s{color:#8f98a0;font-size:12px}.a{display:flex;gap:6px;flex-wrap:wrap}</style></head>
<body><header><h1>Moderação dos comentários</h1><label><input type="checkbox" id="all"> todos</label><input id="key" type="password" placeholder="ADMIN_KEY" autocomplete="off"><button id="go">Carregar</button></header><main id="list"></main>
<script>
const $=s=>document.querySelector(s),key=()=>{const v=$('#key').value||sessionStorage.getItem('k')||'';sessionStorage.setItem('k',v);return v;};
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{'x-admin-key':key(),'content-type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error((await r.json().catch(()=>({}))).error||r.status);return r.json();}
function el(tag,props,kids){const e=document.createElement(tag);Object.assign(e,props||{});for(const k of kids||[])e.append(k);return e;}
async function load(){const list=$('#list');list.textContent='Carregando…';try{const {items}=await api('/v1/admin/comments'+($('#all').checked?'?all=1':''));list.textContent='';if(!items.length)list.textContent='Nada para revisar.';for(const c of items){const act=(label,fn)=>el('button',{textContent:label,onclick:async()=>{try{await fn();load();}catch(e){alert(e.message);}}});
list.append(el('div',{className:'c'+(c.hidden?' h':'')},[el('img',{src:c.avatar,alt:''}),el('div',{className:'m'},[el('div',{className:'s',textContent:c.name+' · '+c.steamid+' · '+c.game+' · '+new Date(c.at).toLocaleString()+' · denúncias: '+c.reports+(c.hidden?' · escondido':'')+(c.banned?' · conta bloqueada':'')}),el('div',{className:'t',textContent:c.body}),el('div',{className:'a'},[act(c.hidden?'Mostrar':'Esconder',()=>api('/v1/admin/comments/'+c.id,{action:c.hidden?'show':'hide'})),act('Limpar denúncias',()=>api('/v1/admin/comments/'+c.id,{action:'clear'})),act('Apagar',()=>confirm('Apagar este comentário?')&&api('/v1/admin/comments/'+c.id,{action:'delete'})),act(c.banned?'Desbloquear conta':'Bloquear conta',()=>confirm(c.banned?'Desbloquear?':'Bloquear esta conta e esconder todos os comentários dela?')&&api('/v1/admin/bans/'+c.steamid,{ban:!c.banned}))])])]));}}catch(e){list.textContent='Erro: '+e.message;}}
$('#go').onclick=load;$('#all').onchange=load;if(sessionStorage.getItem('k'))load();
</script></body></html>`;
