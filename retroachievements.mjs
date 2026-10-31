// Cliente RetroAchievements do Taiga Launcher.
// - Identificação por hash sem conta: biblioteca pública de hashes (r=hashlibrary).
// - Progresso sem pedir login no Taiga: usa a conta já conectada em um emulador
//   (token de leitura) ou o login opcional do próprio Taiga (r=login2, guarda só o token).
// - A Web API Key continua aceita e traz datas de desbloqueio e porcentagens globais.
// Somente chamadas de leitura são feitas; nenhuma sessão de jogo é iniciada e nenhuma
// conquista é enviada.
import path from 'node:path';
import {json, save, digest} from './files.mjs';
import {emulatorAccounts} from './emulator-accounts.mjs';

export const RA_BASE = 'https://retroachievements.org';
export const RA_MEDIA = 'https://media.retroachievements.org';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cacheRead = file => { try { return json(file, null); } catch { return null; } };

// O servidor do RA acrescenta avisos como conquistas (ID 101000001 "Warning: Unknown Emulator",
// 101000002 "Unsupported game version") quando o cliente não é um emulador conhecido. Não são conquistas reais.
export const isRAWarning = (id, title = '') => Number(id) >= 101000000 || /^(warning|aviso)\s*:/i.test(String(title || ''));
export class RetroAchievements {
 constructor({dir, config, version = '1.4.4', offline = false, fetchImpl = (...a) => fetch(...a)}) {
  Object.assign(this, {dir, config, version, offline, fetchImpl});
  this.last = 0; this.tail = Promise.resolve(); this.pending = new Map(); this.accountsCache = null;
 }
 get userAgent() { return `TaigaLauncher/${this.version} (Windows) TaigaRA/1.0`; }
 // Uma requisição por vez, com intervalo, como pede a documentação do RA.
 async call(params, {method = 'POST', timeout = 20000} = {}) {
  if (this.offline) throw Error('Sem conexão (modo offline).');
  const job = async () => {
   for (let attempt = 0; attempt < 3; attempt++) {
    // Site fora do ar ou lento: as próximas consultas falham na hora por 3 minutos.
    if (this.downUntil > Date.now()) throw Error('RetroAchievements indisponível no momento.');
    await sleep(Math.max(0, 700 - (Date.now() - this.last))); this.last = Date.now();
    const body = new URLSearchParams(params);
    let res; try { res = await this.fetchImpl(method === 'GET' ? RA_BASE + '/dorequest.php?' + body : RA_BASE + '/dorequest.php', {method, headers: {'User-Agent': this.userAgent, ...(method === 'POST' ? {'Content-Type': 'application/x-www-form-urlencoded'} : {})}, body: method === 'POST' ? body : undefined, signal: AbortSignal.timeout(timeout)}); } catch (e) { this.downUntil = Date.now() + 180000; throw e; }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { const wait = Number(res.headers.get('retry-after')) * 1000 || (attempt + 1) * 2000; await res.body?.cancel(); await sleep(Math.min(5000, wait)); continue; }
    let data = null; try { data = await res.json(); } catch {}
    if (res.status === 403) throw Error('O RetroAchievements recusou o acesso deste programa (403).');
    if (!res.ok || data?.Success === false) throw Error(data?.Error ? 'RetroAchievements: ' + data.Error : 'RetroAchievements respondeu HTTP ' + res.status + '.');
    return data;
   }
  };
  const run = this.tail.then(job, job); this.tail = run.catch(() => {}); return run;
 }
 async cached(name, ttl, load) {
  const file = path.join(this.dir, 'cache', name + '.json'), old = cacheRead(file);
  if (old && Date.now() - old.at < ttl) return old.data;
  if (this.pending.has(file)) return this.pending.get(file);
  // Falhou há pouco (sem lista guardada): não tenta de novo para cada jogo; volta a tentar depois de 10 min.
  const failed = (this.failures ||= new Map()).get(file); if (!old && failed && Date.now() - failed < 600000) throw Error('Lista do RetroAchievements indisponível no momento.');
  const work = (async () => { try { const data = await load(); save(file, {at: Date.now(), data}); this.failures.delete(file); return data; } catch (e) { this.failures.set(file, Date.now()); if (old) return old.data; throw e; } })();
  this.pending.set(file, work);
  try { return await work; } finally { this.pending.delete(file); }
 }
 // --- Identificação (sem conta) ---
 async hashLibrary(consoleId) {
  if (!consoleId) return {};
  return this.cached('ra-hashlib-' + Number(consoleId), 7 * 86400000, async () => {
   const data = await this.call({r: 'hashlibrary', c: String(consoleId)}, {method: 'GET', timeout: 30000});
   const list = data?.MD5List || {}, out = {};
   for (const [hash, id] of Object.entries(list)) if (/^[a-f0-9]{32}$/i.test(hash) && Number(id) > 0) out[hash.toLowerCase()] = Number(id);
   return out;
  });
 }
 // Lista de jogos (id → nome) de um console, sem chave: a mesma que os emuladores usam (r=gameslist). 7 dias em cache.
 async gamesList(consoleId) {
  if (!consoleId) return {};
  return this.cached('ra-gameslist-' + Number(consoleId), 7 * 86400000, async () => {
   const data = await this.call({r: 'gameslist', c: String(consoleId)}, {method: 'GET', timeout: 60000});
   const out = {}; for (const [id, title] of Object.entries(data?.Response || {})) if (Number(id) > 0 && title) out[id] = String(title);
   return out;
  });
 }
 async gameIdForHash(hash, consoleId) {
  if (!/^[a-f0-9]{32}$/i.test(hash || '')) return null;
  try { const lib = await this.hashLibrary(consoleId); if (lib[hash.toLowerCase()]) return lib[hash.toLowerCase()]; } catch {}
  try { const r = await this.call({r: 'gameid', m: hash.toLowerCase()}, {method: 'GET', timeout: 10000}); return Number(r?.GameID) > 0 ? Number(r.GameID) : null; } catch { return null; }
 }
 // --- Credenciais ---
 emulatorAccounts() {
  if (this.accountsCache && Date.now() - this.accountsCache.at < 60000) return this.accountsCache.list;
  const c = this.config();
  const list = c.raUseEmulatorAccounts === false ? [] : emulatorAccounts(c);
  this.accountsCache = {at: Date.now(), list};
  return list;
 }
 // Ordem: login do Taiga > conta do emulador > Web API Key (usuário + chave).
 credentials() {
  const c = this.config();
  if (c.raUser && c.raToken) return {user: c.raUser, token: c.raToken, source: 'taiga'};
  const emu = this.emulatorAccounts().find(a => !c.raUser || a.user.toLowerCase() === c.raUser.toLowerCase()) || this.emulatorAccounts()[0];
  if (emu) return {user: emu.user, token: emu.token, source: 'emulator', emulator: emu.emulator};
  if (c.raUser && c.raKey) return {user: c.raUser, key: c.raKey, source: 'webapi'};
  return null;
 }
 status() {
  const c = this.config(), cred = this.credentials();
  return {connected: !!cred, user: cred?.user || c.raUser || '', source: cred?.source || null, emulator: cred?.emulator || null, webApi: !!c.raKey, emulatorAccounts: this.emulatorAccounts().map(a => ({user: a.user, emulators: a.emulators}))};
 }
 async login(user, password) {
  const data = await this.call({r: 'login2', u: user, p: password});
  if (!data?.Token) throw Error('O RetroAchievements não retornou um token. Confira usuário e senha.');
  return {user: data.User || user, token: data.Token};
 }
 // --- Conquistas (somente leitura) ---
 async gameData(gameId, cred) {
  return this.cached('ra-patch2-' + Number(gameId) + '-' + digest(cred.user.toLowerCase()).slice(0, 8), 86400000, async () => {
   const r = await this.call({r: 'patch', u: cred.user, t: cred.token, g: String(gameId)});
   if (r?.PatchData?.Achievements) r.PatchData.Achievements = r.PatchData.Achievements.filter(a => !isRAWarning(a.ID, a.Title));
   const p = r?.PatchData;
   if (!p) throw Error('RetroAchievements não retornou o conjunto deste jogo.');
   return {id: p.ID, title: p.Title, consoleId: p.ConsoleID, icon: p.ImageIconURL || (p.ImageIcon ? RA_MEDIA + p.ImageIcon : ''), achievements: (p.Achievements || []).filter(a => Number(a.Flags) === 3 && !isRAWarning(a.ID, a.Title)).map(a => ({id: a.ID, title: a.Title, description: a.Description, points: a.Points, badge: a.BadgeName, rarity: a.Rarity, rarityHardcore: a.RarityHardcore, type: a.Type || null}))};
  });
 }
 async unlocks(gameId, cred, hardcore) {
  const r = await this.call({r: 'unlocks', u: cred.user, t: cred.token, g: String(gameId), h: hardcore ? '1' : '0'});
  return new Set((r?.UserUnlocks || []).map(Number));
 }
 // Progresso pelo token (sem Web API Key): definições + desbloqueios normal e hardcore.
 async progressByToken(gameId, cred) {
  const data = await this.gameData(gameId, cred);
  const [soft, hard] = await Promise.all([this.unlocks(gameId, cred, false), this.unlocks(gameId, cred, true)]);
  const list = data.achievements.map(a => ({id: a.id, title: a.title, description: a.description, points: a.points, icon: `${RA_MEDIA}/Badge/${a.badge}.png`, lockedIcon: `${RA_MEDIA}/Badge/${a.badge}_lock.png`, globalPercent: Number.isFinite(Number(a.rarity)) && a.rarity !== null && a.rarity !== undefined ? Math.max(0, Math.min(100, Number(a.rarity))) : null, unlocked: soft.has(Number(a.id)) || hard.has(Number(a.id)), hardcore: hard.has(Number(a.id)), date: null}));
  return {status: 'ok', at: new Date().toISOString(), total: list.length, unlocked: list.filter(a => a.unlocked).length, achievements: list, raTitle: data.title, user: cred.user};
 }
}
