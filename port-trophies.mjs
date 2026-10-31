// Troféus de ports nativos de jogos de console (ex.: SpartanPort, God of War III do PS4 rodando como .exe).
//
// O jogo continua chamando as funções de troféu do console (sceNpTrophyUnlockTrophy). O port não tem PSN, então
// só escreve o desbloqueio na saída do jogo ("Runtime: trophy 12 unlocked"), que o launcher grava em last_run.log.
// O Taiga Launcher:
//  1. acha o dump do jogo (PARAM.SFO perto do .exe ou citado nas configurações do port);
//  2. lê a lista de troféus do próprio dump (arquivo TRP): ícones sempre; nomes, descrições e tipo
//     (bronze/prata/ouro/platina) direto no PS3 e, no PS4, com a chave de troféus que o usuário já tem
//     configurada no shadPS4 (o Taiga Launcher não traz chave nenhuma) ou com os arquivos já extraídos pelo shadPS4;
//  3. acompanha o log enquanto o jogo roda e guarda cada troféu desbloqueado (o log é apagado a cada sessão);
//  4. calcula a platina quando todos os outros troféus estão completos.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {digest, json, save} from './files.mjs';
import {parseTrophyXML} from './rpcs3-achievements.mjs';
import {consoleTitleNear} from './console-port.mjs';
import {shadps4Roots} from './console-trophies.mjs';
import {portTrophyLogs, portProfile, portConfigFiles} from './port-profiles.mjs';

const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const isDir = f => { try { return fs.statSync(f).isDirectory(); } catch { return false; } };
const list = d => { try { return fs.readdirSync(d, {withFileTypes: true}); } catch { return []; } };

// ── Linhas de log que anunciam um troféu ──
// SpartanPort: "Runtime: trophy 12 unlocked". Os outros cobrem variações comuns de ports e camadas de compatibilidade.
export const PORT_TROPHY_PATTERNS = [
 /\btroph(?:y|ies)\s*(?:id\s*)?[#:=]?\s*(\d{1,3})\s*(?:was\s+|has\s+been\s+)?unlocked\b/i,
 /\bunlock(?:ed|ing)?\s+troph(?:y|ies)\s*(?:id\s*)?[#:=]?\s*(\d{1,3})\b/i,
 /\bUnlockTrophy\b[^\n]*?\btroph(?:y)?_?id\s*[:=]\s*(\d{1,3})\b/i,
];
// trophyLog: arquivo trophies.log do bloodborne_pc ("id horário-unix" por linha).
export function parsePortTrophyLines(text, {trophyLog = false} = {}) {
 const ids = [];
 for (const line of String(text).split(/\r?\n/)) {
  if (trophyLog) { const m = line.trim().match(/^(\d{1,3})\s+\d{9,11}$/); if (m) ids.push(Number(m[1])); continue; }
  for (const re of PORT_TROPHY_PATTERNS) { const m = line.match(re); if (m) { ids.push(Number(m[1])); break; } }
 }
 return ids;
}

// ── Arquivo TRP (pacote de troféus do PS3/PS4/Vita) ──
// Cabeçalho big-endian (magic DCA24D00) seguido de entradas de 0x40: nome[32], posição u64, tamanho u64. O cabeçalho
// tem 0x40 bytes no PS3 (versões 1 e 2) e 0x60 no PS4 (versão 3, com o SHA-1 maior): vale o que tiver entradas válidas.
export function readTRP(buf) {
 if (!Buffer.isBuffer(buf) || buf.length < 0x60 || buf.readUInt32BE(0) !== 0xDCA24D00) throw Error('Arquivo de troféus (TRP) inválido.');
 const count = buf.readUInt32BE(0x10), size = buf.readUInt32BE(0x14), version = buf.readUInt32BE(4);
 if (count < 1 || count > 4096 || size < 0x40 || size > 0x100) throw Error('Índice do arquivo de troféus inválido.');
 const read = start => {
  if (start + count * size > buf.length) return null;
  const entries = [];
  for (let i = 0; i < count; i++) {
   const at = start + i * size, name = buf.toString('latin1', at, at + 32).replace(/\0.*$/s, ''), pos = Number(buf.readBigUInt64BE(at + 32)), len = Number(buf.readBigUInt64BE(at + 40));
   if (!name || !/^[\w.-]+$/.test(name) || !Number.isSafeInteger(pos) || pos < start + count * size || pos + len > buf.length) continue;
   entries.push({name, pos, len});
  }
  return entries.length ? entries : null;
 };
 const entries = (version >= 3 ? [0x60, 0x40] : [0x40, 0x60]).map(read).find(Boolean);
 if (!entries) throw Error('Índice do arquivo de troféus inválido.');
 return entries;
}
const entryData = (buf, e) => buf.subarray(e.pos, e.pos + e.len);
// PS4: TROP*.ESFM é cifrado (AES-128-CBC). Chave do conjunto = AES-CBC(chave de troféus, iv 0, NPWR..._00 com zeros);
// os primeiros 16 bytes da entrada são o IV. Mesmo procedimento do shadPS4 (GPL; implementação própria).
export function decryptESFM(data, trophyKey, npCommId) {
 if (!trophyKey || trophyKey.length !== 16 || data.length < 32) return null;
 const comm = Buffer.alloc(16); Buffer.from(String(npCommId), 'latin1').copy(comm, 0, 0, 16);
 const enc = crypto.createCipheriv('aes-128-cbc', trophyKey, Buffer.alloc(16)); enc.setAutoPadding(false);
 const setKey = Buffer.concat([enc.update(comm), enc.final()]);
 const body = data.subarray(16, 16 + Math.floor((data.length - 16) / 16) * 16);
 const dec = crypto.createDecipheriv('aes-128-cbc', setKey, data.subarray(0, 16)); dec.setAutoPadding(false);
 const out = Buffer.concat([dec.update(body), dec.final()]);
 const end = out.lastIndexOf('>'); const text = out.subarray(0, end + 1);
 return /<trophyconf\b/i.test(text.toString('utf8')) ? text : null;
}

// Chave de troféus do PS4: a do usuário (configurações do Taiga Launcher, ou keys.json/config.toml do shadPS4).
export function findTrophyKey(config = {}, {extraDirs = [], env = process.env} = {}) {
 const hex = v => { const s = String(v || '').trim().replace(/^0x/i, ''); return /^[0-9a-f]{32}$/i.test(s) ? Buffer.from(s, 'hex') : null; };
 const own = hex(config.ps4TrophyKey); if (own) return own;
 const dirs = [...extraDirs, ...shadps4Roots(config, env)];
 if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'shadPS4'));
 for (const d of [...new Set(dirs.filter(Boolean))]) {
  for (const f of [path.join(d, 'keys.json'), path.join(d, 'user', 'keys.json'), path.join(d, 'keys', 'keys.json')]) {
   if (!isFile(f)) continue; const j = json(f, null);
   const k = hex(j?.TrophyKeySet?.ReleaseTrophyKey) || hex(j?.TrophyKey); if (k) return k;
  }
  for (const f of [path.join(d, 'config.toml'), path.join(d, 'user', 'config.toml')]) {
   if (!isFile(f)) continue; try { const m = fs.readFileSync(f, 'utf8').match(/^\s*TrophyKey\s*=\s*["']?([0-9a-fA-F]{32})/m); if (m) return Buffer.from(m[1], 'hex'); } catch {}
  }
 }
 return null;
}

// Pacotes de troféus do dump e o identificador NPWR.
export function portTrophyPacks(dump) {
 const out = [];
 for (const base of [path.join(dump, 'sce_sys'), path.join(dump, 'Sc0')]) for (const sub of ['trophy', 'trophy2']) for (const e of list(path.join(base, sub))) if (e.isFile() && /\.trp$/i.test(e.name)) out.push({file: path.join(base, sub, e.name), kind: 'ps4'});
 for (const e of list(path.join(dump, 'PS3_GAME', 'TROPDIR'))) if (e.isDirectory()) for (const f of list(path.join(dump, 'PS3_GAME', 'TROPDIR', e.name))) if (/\.trp$/i.test(f.name)) out.push({file: path.join(dump, 'PS3_GAME', 'TROPDIR', e.name, f.name), kind: 'ps3', set: e.name});
 return out;
}
export function npCommIds(dump) {
 const out = new Set();
 for (const f of [path.join(dump, 'sce_sys', 'npbind.dat'), path.join(dump, 'Sc0', 'npbind.dat'), path.join(dump, 'sce_sys', 'trophy2', 'npbind.dat')]) {
  try { if (isFile(f) && fs.statSync(f).size < 1024 * 1024) for (const m of fs.readFileSync(f).toString('latin1').matchAll(/NPWR\d{5}_\d{2}/g)) out.add(m[0]); } catch {}
 }
 return [...out];
}

// Arquivo de idioma do PS4/PS3 (TROP_XX): pt-BR 17 (ou 07), en 01, es 20/03, fr 02, de 04.
const LANG_FILES = {'pt-BR': ['17', '07'], en: ['01', '18'], es: ['20', '03'], fr: ['02', '22'], de: ['04']};
const TROPHY_WORD = {'pt-BR': 'Troféu', en: 'Trophy', es: 'Trofeo', fr: 'Trophée', de: 'Trophäe'};
const saveIcon = (dataDir, bytes) => {
 if (!bytes || bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.length > 4 * 1024 * 1024) return '';
 const name = digest(bytes) + '.png', dest = path.join(dataDir, 'art', name);
 try { fs.mkdirSync(path.dirname(dest), {recursive: true}); if (!isFile(dest)) fs.writeFileSync(dest, bytes); } catch { return ''; }
 return '/art/' + name;
};

// Lista de troféus de um port: {set, title, sourceLanguage, detail: 'full'|'icons', achievements:[{id,title,description,grade,hidden,icon}]}.
// A lista vem de um pacote que pode ter dezenas de MB (e ser cifrada): guardada enquanto o pacote, o idioma e a chave
// forem os mesmos (a página do jogo pede as conquistas a cada poucos segundos).
const defsMemo = new Map();
export function portTrophyDefinitions(port, opts = {}) {
 const {config = {}, language = 'pt-BR', env = process.env, exeDir = '', exeFile = ''} = opts;
 // Lista já decifrada pelo próprio port (Uncharted: out/<jogo>/trophy/trophies.txt).
 const cached = exeFile ? activeCachedSet(exeFile, env) : null;
 if (cached) {
  let stamp = ''; try { stamp = String(fs.statSync(path.join(cached.folder, 'trophies.txt')).mtimeMs); } catch {}
  const k = ['cache', cached.folder, stamp, cached.log, opts.dataDir || ''].join('\u0001'), hit = defsMemo.get(k);
  if (hit && Date.now() - hit.at < 2 * 60000) return structuredClone(hit.value);
  const value = cachedSetDefinitions(cached, opts.dataDir, port?.title); if (defsMemo.size > 50) defsMemo.clear(); defsMemo.set(k, {at: Date.now(), value});
  return structuredClone(value);
 }
 if (!port?.dump) return null;
 const packs = portTrophyPacks(port.dump), trophyKey = findTrophyKey(config, {extraDirs: [exeDir, exeDir && path.join(exeDir, 'user')], env});
 const stamp = packs.map(p => { try { const st = fs.statSync(p.file); return p.file + ':' + st.mtimeMs + ':' + st.size; } catch { return p.file; } }).join('|');
 const memoKey = [port.dump, language, trophyKey ? digest(Buffer.from(String(trophyKey))).slice(0, 12) : '', exeFile, opts.dataDir || '', stamp].join('\u0001');
 const hit = defsMemo.get(memoKey); if (hit && Date.now() - hit.at < 2 * 60000) return hit.value ? structuredClone(hit.value) : null;
 const value = readPortTrophyDefinitions(port, opts);
 if (defsMemo.size > 50) defsMemo.clear(); defsMemo.set(memoKey, {at: Date.now(), value});
 return value ? structuredClone(value) : null;
}
function readPortTrophyDefinitions(port, {config = {}, dataDir, language = 'pt-BR', env = process.env, exeDir = '', exeFile = ''} = {}) {
 const ids = npCommIds(port.dump), key = findTrophyKey(config, {extraDirs: [exeDir, exeDir && path.join(exeDir, 'user')], env});
 for (const pack of portTrophyPacks(port.dump)) {
  let buf; try { if (fs.statSync(pack.file).size > 64 * 1024 * 1024) continue; buf = fs.readFileSync(pack.file); } catch { continue; }
  let entries; try { entries = readTRP(buf); } catch { continue; }
  const set = pack.set || ids[0] || '';
  const icons = new Map(); for (const e of entries) { const m = e.name.match(/^TROP(\d{3})\.PNG$/i); if (m) icons.set(Number(m[1]), e); }
  // Definições: arquivo no idioma escolhido, senão o padrão.
  const want = [...(LANG_FILES[language] || []).map(n => 'TROP_' + n), 'TROP', 'TROPCONF'];
  let def = null, sourceLanguage = 'en';
  for (const base of want) {
   const e = entries.find(x => x.name.toUpperCase() === base + '.SFM') || entries.find(x => x.name.toUpperCase() === base + '.ESFM');
   if (!e) continue;
   let xml = null;
   if (/\.SFM$/i.test(e.name) && !/\.ESFM$/i.test(e.name)) xml = entryData(buf, e);
   else if (key && set) { try { xml = decryptESFM(entryData(buf, e), key, set); } catch { xml = null; } }
   if (!xml) continue;
   try { def = parseTrophyXML(xml); if (!def.achievements.some(a => a.title)) { def = null; continue; } sourceLanguage = base.startsWith('TROP_') && (LANG_FILES[language] || []).includes(base.slice(5)) ? language : 'en'; break; } catch { def = null; }
  }
  // Sem chave: arquivos que o shadPS4 já extraiu (trophy/<NPWR>/Xml).
  if (!def && set) for (const root of [...shadps4Roots(config, env), ...(exeFile ? portUserDirs(exeFile) : [])]) {
   const folder = path.join(root, 'trophy', set, 'Xml');
   for (const name of [...(LANG_FILES[language] || []).map(n => `TROP_${n}.XML`), 'TROP.XML']) { const f = path.join(folder, name); if (!isFile(f)) continue; try { def = parseTrophyXML(fs.readFileSync(f)); sourceLanguage = name.startsWith('TROP_') ? language : 'en'; break; } catch {} }
   if (def) break;
  }
  if (def) {
   const achievements = def.achievements.map(a => ({...a, icon: icons.has(Number(a.id)) ? saveIcon(dataDir, entryData(buf, icons.get(Number(a.id)))) : ''}));
   return {set, title: def.title || port.title, sourceLanguage, detail: 'full', achievements};
  }
  // Só os ícones: a lista existe (um ícone por troféu), mas nomes e tipos ficam para quando houver a chave.
  if (icons.size) {
   const word = TROPHY_WORD[language] || TROPHY_WORD.en;
   const achievements = [...icons.keys()].sort((a, b) => a - b).map(id => ({id: String(id), title: `${word} ${id + 1}`, description: '', grade: '', hidden: false, icon: saveIcon(dataDir, entryData(buf, icons.get(id)))}));
   return {set, title: port.title, sourceLanguage: language, detail: 'icons', achievements};
  }
 }
 return null;
}

// ── Progresso guardado pelo Taiga Launcher (o port não guarda) ──
// Troféu de platina: tipo "P"; sem tipo (lista vinda do trophy_texts.txt ou só de ícones), o troféu 0 cuja descrição é
// "desbloquear todos os troféus" (nos idiomas mais comuns) ou cujo nome tem "platina".
const ALL_TROPHIES = /\b(?:unlock|obtain|earn|get|collect)\s+(?:all|every)\b.*\btroph|\btodos\s+os\s+trof[eé]us|\btodos\s+los\s+trofeos|\btous\s+les\s+troph[eé]es|\balle\s+troph[äa]en|\bplatin/i;
export function platinumOf(list) {
 if (!Array.isArray(list) || list.length < 2) return null;
 const byGrade = list.filter(a => String(a?.grade || '').toUpperCase() === 'P'); if (byGrade.length) return byGrade.length === 1 ? byGrade[0] : null;
 if (list.some(a => a?.grade)) return null;
 const zero = list.find(a => String(a?.id) === '0'); return zero && ALL_TROPHIES.test(String(zero.description || '') + ' ' + String(zero.title || '')) ? zero : null;
}
export class PortTrophyStore {
 constructor(dir) { this.dir = path.join(dir, 'port-trophies'); }
 file(uuid) { return path.join(this.dir, String(uuid).replace(/[^\w-]/g, '') + '.json'); }
 get(uuid) { const d = json(this.file(uuid), null); return d && typeof d === 'object' && d.unlocked ? d : {unlocked: {}, manual: {}}; }
 // Devolve true quando o troféu é novo.
 record(uuid, id, at = Math.floor(Date.now() / 1000), {manual = false} = {}) {
  const d = this.get(uuid), key = String(Number(id)); if (!/^\d+$/.test(key) || d.unlocked[key]) return false;
  d.unlocked[key] = at; if (manual) (d.manual ||= {})[key] = true; save(this.file(uuid), d); return true;
 }
 remove(uuid, id) { const d = this.get(uuid), key = String(Number(id)); if (!d.unlocked[key]) return false; delete d.unlocked[key]; if (d.manual) delete d.manual[key]; save(this.file(uuid), d); return true; }
}

// ── SpartanPort (versões novas): troféus guardados pelo próprio port ──
// <pasta do usuário>/trophies.dat: 16 bytes, quatro palavras de 32 bits little-endian; o troféu id é o bit id % 32 da
// palavra id / 32. <pasta do usuário>/trophy_texts.txt: "ID=Nome | Descrição" no idioma do launcher do port.
export function portUserDirs(exe, env = process.env) {
 const dir = path.dirname(exe), parent = path.dirname(dir), out = [], add = d => { if (d && !out.includes(d)) out.push(d); };
 // Pasta escolhida no launcher do port e guardada fora da pasta dele (%APPDATA%\bbport-launcher\settings.json,
 // %APPDATA%\uncharted-launcher\settings.json, %APPDATA%\inFAMOUS-PC\launcher.json).
 for (const f of portConfigFiles(exe, env)) { const j = json(f, null), u = j && typeof j.user_dir === 'string' ? j.user_dir.trim() : ''; if (u && (path.isAbsolute(u) || /^[A-Za-z]:[\\/]/.test(u))) add(u); }
 // settings.json do launcher (Python ou Rust; no pacote o jogo fica em bin/ e as configurações na pasta acima).
 for (const base of [dir, path.join(dir, 'user'), path.join(dir, 'data'), parent]) {
  const j = json(path.join(base, 'settings.json'), null), u = j && typeof j.user_dir === 'string' ? j.user_dir.trim() : '';
  if (u) add(path.isAbsolute(u) || /^[A-Za-z]:[\\/]/.test(u) ? u : path.join(base, u));
 }
 add(path.join(dir, 'user')); add(path.join(dir, 'data', 'user')); add(path.join(parent, 'user'));
 return out;
}
export function parseTrophiesDat(buf) {
 const ids = []; if (!Buffer.isBuffer(buf) || buf.length < 4) return ids;
 for (let w = 0; w * 4 + 4 <= Math.min(buf.length, 16); w++) { const v = buf.readUInt32LE(w * 4); for (let b = 0; b < 32; b++) if (v & (1 << b) >>> 0) ids.push(w * 32 + b); }
 return ids;
}
export function trophiesDatFiles(exe) { const out = []; for (const d of portUserDirs(exe)) { const f = path.join(d, 'trophies.dat'); if (isFile(f)) out.push(f); } return out; }
export function parseTrophyTexts(text) {
 const out = new Map();
 for (const line of String(text || '').split(/\r?\n/)) { const m = line.match(/^\s*(\d{1,3})\s*=\s*([^|]*?)\s*(?:\|\s*(.*?))?\s*$/); if (m && m[2]) out.set(Number(m[1]), {title: m[2], description: m[3] || ''}); }
 return out;
}
export function portTrophyTexts(exe) {
 // Idioma em que o launcher do port escreveu o arquivo ("# ... (language: en)"): os nomes são traduzidos para o idioma do
 // Taiga Launcher quando forem de outro.
 const LANGS = {en: 'en', english: 'en', pt: 'pt-BR', 'pt-br': 'pt-BR', brazilian: 'pt-BR', portuguese: 'pt-BR', es: 'es', spanish: 'es', fr: 'fr', french: 'fr', de: 'de', german: 'de'};
 for (const d of portUserDirs(exe)) for (const name of ['trophy_texts.txt', 'trophy_names.txt']) { const f = path.join(d, name); try { if (fs.statSync(f).size < 512 * 1024) { const text = fs.readFileSync(f, 'utf8'), m = parseTrophyTexts(text); if (m.size) { const lang = (text.match(/^#.*\blanguage:\s*([a-z-]+)/im) || [])[1]; m.language = LANGS[String(lang || '').toLowerCase()] || 'en'; return m; } } } catch {} }
 return null;
}

// ── Ports da família ps3recomp (Yakuza Dead Souls, inFAMOUS, Demon's Souls...): gamedata/trophies/<NPWR>.json ──
// {"trophies":[{"id":N,"timestamp":T}]}, T em CellRtcTick (microssegundos desde o ano 1) ou, nos arquivos antigos,
// segundos Unix. O caminho é relativo à pasta de onde o jogo roda (a do .exe ou até duas acima).
const RTC_EPOCH = 62135596800;
export function rtcToUnix(t) { const n = Number(t) || 0; if (!n) return 0; return n < 1e12 ? Math.floor(n) : Math.max(0, Math.floor(n / 1e6) - RTC_EPOCH); }
export function parsePs3recompTrophies(text) {
 let j; try { j = JSON.parse(String(text || '')); } catch { return []; }
 // {"trophies":[...]} (ps3recomp) ou, em versões diferentes, a lista direto / {"unlocked":[...]} / {"earned":[...]}.
 const rows = Array.isArray(j) ? j : Array.isArray(j?.trophies) ? j.trophies : Array.isArray(j?.unlocked) ? j.unlocked : Array.isArray(j?.earned) ? j.earned : [];
 return rows.map(t => typeof t === 'number' ? {id: t, timestamp: 0} : {...t, id: t?.id ?? t?.trophy_id ?? t?.trophyId, timestamp: t?.timestamp ?? t?.time ?? t?.unlocked_at ?? 0}).filter(t => Number.isInteger(Number(t?.id)) && Number(t.id) >= 0 && Number(t.id) < 256).map(t => ({id: Number(t.id), at: rtcToUnix(t.timestamp)}));
}
// ── Dragon's Crown Pro PC: <usuário>/trophy/<NPWR>/progress_user<n>.txt ("DCP-TROPHIES 1", "unlocked <id> <unix>") ──
export function parseDcpProgress(text) {
 const lines = String(text || '').split(/\r?\n/); if (!/^DCP-TROPHIES\s+\d/.test(lines[0] || '')) return [];
 const out = []; for (const l of lines) { const m = l.match(/^unlocked\s+(\d{1,3})\s+(\d+)\s*$/); if (m) out.push({id: Number(m[1]), at: Number(m[2]) || 0}); }
 return out;
}
const NPWR = /^NPWR\d{5}_\d{2}$/i;
// ── Ports que guardam "id horário-unix" por linha: bloodborne_pc (<user>/trophies.txt, antes trophies.log) e
// uncharted_pc (<user>/trophy/<NPWR>.log, um arquivo por jogo da coleção) ──
export function parseIdLog(text) {
 const out = []; for (const l of String(text || '').split(/\r?\n/)) { const m = l.trim().match(/^(\d{1,3})\s+(\d{1,12})$/); if (m) out.push({id: Number(m[1]), at: Number(m[2]) || 0}); }
 return out;
}
// ── iss_pc (inFAMOUS Second Son): <user>/trophies/CUSA00223/earned.json {"earned":[{"id":N,"time":T}]} ──
export function parseLedger(text) {
 let j; try { j = JSON.parse(String(text || '')); } catch { return []; }
 return (Array.isArray(j?.earned) ? j.earned : []).filter(t => Number.isInteger(Number(t?.id)) && Number(t.id) >= 0 && Number(t.id) < 256).map(t => ({id: Number(t.id), at: Number(t.time) || 0}));
}
const newest = files => files.map(f => { try { return {f, t: fs.statSync(f).mtimeMs}; } catch { return null; } }).filter(Boolean).sort((a, b) => b.t - a.t).map(x => x.f);
// Arquivos de progresso que o próprio port grava: [{file, kind: 'dat'|'ps3recomp'|'dcp'|'idlog'|'ledger', set?}].
export function portProgressFiles(exe, env = process.env) {
 const out = [], add = (file, kind, set) => { if (!out.some(x => x.file === file) && isFile(file)) out.push(set ? {file, kind, set} : {file, kind}); };
 for (const f of trophiesDatFiles(exe)) add(f, 'dat');
 let d = path.dirname(exe);
 for (let i = 0; i < 3; i++) {
  for (const e of list(path.join(d, 'gamedata', 'trophies')).slice(0, 40)) if (e.isFile() && /^NPWR\d{5}(_\d{2})?\.json$/i.test(e.name)) add(path.join(d, 'gamedata', 'trophies', e.name), 'ps3recomp');
  const up = path.dirname(d); if (up === d) break; d = up;
 }
 for (const u of portUserDirs(exe, env)) {
  for (const e of list(path.join(u, 'trophy')).slice(0, 20)) {
   if (e.isDirectory() && NPWR.test(e.name)) for (const f of list(path.join(u, 'trophy', e.name))) { if (f.isFile() && /^progress_user\d+\.txt$/i.test(f.name)) add(path.join(u, 'trophy', e.name, f.name), 'dcp'); }
   const m = e.isFile() && e.name.match(/^(NPWR\d{5}_\d{2})\.log$/i); if (m) add(path.join(u, 'trophy', e.name), 'idlog', m[1].toUpperCase());
  }
  for (const name of ['trophies.txt', 'trophies.log']) add(path.join(u, name), 'idlog');
  for (const e of list(path.join(u, 'trophies')).slice(0, 10)) if (e.isDirectory() && /^[A-Z]{4}\d{5}$/i.test(e.name)) {
   const base = path.join(u, 'trophies', e.name); add(path.join(base, 'earned.json'), 'ledger');
   // Um arquivo por save (ISS_TROPHIES_PER_SAVE=1): vale o do save usado por último.
   const saves = newest(list(path.join(base, 'save-versions')).filter(x => x.isFile() && /^[0-9a-f]{16,64}\.json$/i.test(x.name)).slice(0, 200).map(x => path.join(base, 'save-versions', x.name)));
   if (saves[0]) add(saves[0], 'ledger');
  }
 }
 return out.slice(0, 16);
}
const progressKind = file => /(^|[\\/])trophies\.dat$/i.test(file) ? 'dat' : /[\\/]gamedata[\\/]trophies[\\/][^\\/]+\.json$/i.test(file) ? 'ps3recomp' : /(^|[\\/])progress_user\d+\.txt$/i.test(file) ? 'dcp'
 : /(^|[\\/])trophies\.(?:txt|log)$|[\\/]trophy[\\/]NPWR\d{5}_\d{2}\.log$/i.test(file) ? 'idlog' : /[\\/]trophies[\\/][A-Z]{4}\d{5}[\\/](?:earned|save-versions[\\/][0-9a-f]{16,64})\.json$/i.test(file) ? 'ledger' : '';
// Troféus de um arquivo de progresso: [{id, at}] (at 0 = sem data; usa a do arquivo).
export function readProgressFile(file, kind = progressKind(file)) {
 try {
  const st = fs.statSync(file); if (st.size > 1024 * 1024) return [];
  const mt = Math.floor(st.mtimeMs / 1000), buf = fs.readFileSync(file);
  const list = kind === 'dat' ? parseTrophiesDat(buf).map(id => ({id, at: 0})) : kind === 'ps3recomp' ? parsePs3recompTrophies(buf.toString('utf8')) : kind === 'dcp' ? parseDcpProgress(buf.toString('utf8'))
   : kind === 'idlog' ? parseIdLog(buf.toString('utf8')) : kind === 'ledger' ? parseLedger(buf.toString('utf8')) : [];
  return list.map(x => ({id: x.id, at: x.at > 0 && x.at <= mt + 86400 ? x.at : mt}));
 } catch { return []; }
}

// ── Listas que o port já decifrou (uncharted_pc: out/<jogo>/trophy/trophies.txt com TROPxxx.PNG ao lado) ──
// "npcommid\tNPWR..", "title\t..", "stamp\t<pacote>|<tamanho>|<data>|<idioma>", "trophy\t<id>\t<P|G|S|B>\t<oculto>\t<nome>\t<descrição>".
const PS4_LANG = {1: 'en', 18: 'en', 17: 'pt-BR', 7: 'pt-BR', 3: 'es', 20: 'es', 2: 'fr', 22: 'fr', 4: 'de'};
const unescapeText = t => String(t || '').replace(/\\(.)/g, (_, c) => c === 'n' ? '\n' : c === 't' ? '\t' : c);
export function parseCachedSet(text) {
 const set = {npcommid: '', title: '', language: 'en', trophies: []};
 for (const line of String(text || '').split(/\r?\n/)) {
  const f = line.split('\t');
  if (f[0] === 'npcommid' && f[1]) set.npcommid = f[1].trim();
  else if (f[0] === 'title' && f.length > 1) set.title = unescapeText(f[1]);
  else if (f[0] === 'stamp' && f[1]) set.language = PS4_LANG[Number(f[1].split('|').pop())] || 'en';
  else if (f[0] === 'trophy' && f.length >= 6 && /^\d{1,3}$/.test(f[1])) set.trophies.push({id: Number(f[1]), grade: /^[PGSB]$/.test(f[2]) ? f[2] : '', hidden: f[3] === '1', title: unescapeText(f[4]), description: unescapeText(f[5])});
 }
 return NPWR.test(set.npcommid) && set.trophies.length ? set : null;
}
// Conjuntos do port ([{folder, key, set, title, language, trophies, log}]) e o que está em uso: o do jogo jogado por
// último (log mais novo), senão o escolhido no launcher do port ("start": u1/u2/u3), senão o primeiro.
const UNCHARTED_KEYS = {u1: 'eboot', u2: 'big2', u3: 'big3'};
const setsMemo = new Map();
export function portCachedSets(exe, env = process.env) {
 const hit = setsMemo.get(exe); if (hit && Date.now() - hit.at < 5000) return hit.value;
 const dir = path.dirname(exe), sets = [], users = portUserDirs(exe, env);
 for (const base of [dir, path.dirname(dir)]) {
  for (const e of list(path.join(base, 'out')).slice(0, 12)) {
   if (!e.isDirectory()) continue; const folder = path.join(base, 'out', e.name, 'trophy'), file = path.join(folder, 'trophies.txt');
   let parsed = null; try { if (isFile(file) && fs.statSync(file).size < 2 * 1024 * 1024) parsed = parseCachedSet(fs.readFileSync(file, 'utf8')); } catch {}
   if (!parsed || sets.some(x => x.set === parsed.npcommid)) continue;
   const logs = users.map(u => path.join(u, 'trophy', parsed.npcommid + '.log')), log = logs.find(isFile) || logs[0] || '';
   sets.push({folder, key: e.name.toLowerCase(), set: parsed.npcommid, title: parsed.title, language: parsed.language, trophies: parsed.trophies, log});
  }
  if (sets.length) break;
 }
 if (setsMemo.size > 30) setsMemo.clear(); setsMemo.set(exe, {at: Date.now(), value: sets});
 return sets;
}
export function activeCachedSet(exe, env = process.env) {
 const sets = portCachedSets(exe, env); if (!sets.length) return null; if (sets.length === 1) return sets[0];
 const played = sets.map(s => { try { return {s, t: fs.statSync(s.log).mtimeMs}; } catch { return null; } }).filter(Boolean).sort((a, b) => b.t - a.t);
 if (played[0]) return played[0].s;
 for (const f of portConfigFiles(exe, env)) { const start = String(json(f, null)?.start || '').toLowerCase(), key = UNCHARTED_KEYS[start] || start; const s = key && sets.find(x => x.key === key || x.key.startsWith(key)); if (s) return s; }
 return sets[0];
}
function cachedSetDefinitions(c, dataDir, fallbackTitle) {
 const icon = id => { try { const f = path.join(c.folder, `TROP${String(id).padStart(3, '0')}.PNG`); return isFile(f) && fs.statSync(f).size < 4 * 1024 * 1024 ? saveIcon(dataDir, fs.readFileSync(f)) : ''; } catch { return ''; } };
 return {set: c.set, title: c.title || fallbackTitle || '', sourceLanguage: c.language, detail: 'full', progressFile: c.log, achievements: c.trophies.map(t => ({id: String(t.id), title: t.title, description: t.description, grade: t.grade, hidden: t.hidden, icon: icon(t.id)}))};
}
// Chave do progresso guardado pelo Taiga Launcher: uma por conjunto quando o port tem vários jogos (Uncharted).
export function portStoreKey(game, file = '') {
 const base = game?.uuid || game?.id, m = String(file || '').match(/[\\/]trophy[\\/](NPWR\d{5}_\d{2})\.log$/i);
 if (m) return base + '-' + m[1].toUpperCase();
 let a = null; try { a = game?.path && portCachedSets(game.path).length > 1 ? activeCachedSet(game.path) : null; } catch {}
 return a ? base + '-' + a.set : base;
}

// Resultado no formato do gerenciador de conquistas.
export function readPortTrophies(game, port, {config = {}, dataDir, store, env = process.env, names = null, namesLanguage = 'en', namesSource = 'Exophase'} = {}) {
 const language = config.language || 'pt-BR';
 const defs = portTrophyDefinitions(port, {config, dataDir, language, env, exeDir: game.path ? path.dirname(game.path) : '', exeFile: game.path || ''});
 if (!defs) return null;
 // Lista cifrada: nomes, descrições, tipo e raridade vindos de fora (Exophase), na mesma ordem dos IDs.
 let sourceLanguage = defs.sourceLanguage, detail = defs.detail;
 if ((detail === 'icons' || namesSource === 'PlayStation') && Array.isArray(names) && names.length === defs.achievements.length) { defs.achievements = defs.achievements.map((a, i) => ({...a, title: names[i].title || a.title, description: names[i].description || '', grade: names[i].grade || '', hidden: !!names[i].hidden, globalPercent: names[i].globalPercent ?? null})); if (!defs.achievements.some(a => a.grade === 'P') && /^(unlock|obtain|earn|collect)\b.*\ball\b.*\btroph/i.test(names[0]?.description || '')) defs.achievements[0].grade = 'P'; sourceLanguage = namesLanguage; detail = namesSource === 'PlayStation' ? 'psn' : 'online'; }
 // Nomes gravados pelo port (SpartanPort: trophy_texts.txt, no idioma do launcher dele) quando a lista é só de ícones.
 if (game.path && (detail === 'icons' || !defs.achievements.some(a => a.description))) { const texts = portTrophyTexts(game.path); if (texts) { defs.achievements = defs.achievements.map(a => { const t = texts.get(Number(a.id)); return t ? {...a, title: t.title || a.title, description: t.description || a.description} : a; }); detail = detail === 'icons' ? 'port' : detail; sourceLanguage = texts.language || 'en'; } }
 // Troféus que o próprio port guardou (trophies.dat, gamedata/trophies/*.json, progress_user*.txt): entram no progresso
 // com a data gravada pelo port (ou a do arquivo).
 const key = portStoreKey(game);
 if (game.path) for (const {file, kind, set} of portProgressFiles(game.path, env)) { if (set && set !== defs.set) continue; for (const t of readProgressFile(file, kind)) store.record(key, t.id, t.at); }
 const state = store.get(key), unlocked = state.unlocked || {};
 const achievements = defs.achievements.map(a => ({id: /^\d+$/.test(String(a.id)) ? String(Number(a.id)) : String(a.id), title: a.title, description: a.description, grade: a.grade, hidden: !!a.hidden, icon: a.icon, globalPercent: a.globalPercent ?? null, unlocked: !!unlocked[String(Number(a.id))], date: unlocked[String(Number(a.id))] || null, manual: !!state.manual?.[String(Number(a.id))]}));
 // Platina: quando todos os outros estão completos (o port não calcula).
 const plat = platinumOf(achievements);
 if (plat && !plat.unlocked) { const rest = achievements.filter(a => a !== plat); if (rest.length && rest.every(a => a.unlocked)) { plat.unlocked = true; plat.date = Math.max(...rest.map(a => Number(a.date) || 0)) || Math.floor(Date.now() / 1000); store.record(key, plat.id, plat.date); } }
 return {status: 'ok', provider: 'port', source: (port.platform || 'Console') + ' · port' + (detail === 'online' ? ' · Exophase' : detail === 'psn' ? ' · PlayStation' : ''), sourceLanguage, progressKnown: true, trophySet: defs.set, detail, achievements};
}

// Arquivos de log de um port: last_run.log (SpartanPort; pasta "user" ou a definida em settings.json) e *.log da pasta.
export function portLogFiles(exe, {extra = []} = {}) {
 const dir = path.dirname(exe), out = [], add = f => { if (f && !out.includes(f)) out.push(f); };
 for (const f of extra) add(f);
 for (const u of portUserDirs(exe)) add(path.join(u, 'last_run.log'));
 add(path.join(dir, 'last_run.log'));
 // Pastas de log dos ports (gr2_pc: out/logs e out/last_run.log; Unicorn Overlord: data/logs). Dos run-*.log, só os
 // mais novos (um por sessão).
 const dirs = [dir, path.join(dir, 'user'), path.join(dir, 'logs'), path.join(dir, 'log'), path.join(dir, 'out'), path.join(dir, 'out', 'logs'), path.join(dir, 'data', 'logs'), path.join(dir, 'user', 'logs')];
 const runs = [];
 for (const d of dirs) for (const e of list(d).slice(0, 300)) {
  if (!e.isFile() || !/\.(log|txt)$/i.test(e.name) || !/log|run|output|console/i.test(e.name)) continue;
  const f = path.join(d, e.name);
  if (/^run[-_]/i.test(e.name)) { try { runs.push({f, t: fs.statSync(f).mtimeMs}); } catch {} } else add(f);
 }
 for (const r of runs.sort((a, b) => b.t - a.t).slice(0, 3)) add(r.f);
 for (const f of portTrophyLogs(exe)) add(f);
 for (const p of portProgressFiles(exe)) add(p.file);
 return out.slice(0, 20);
}

// Acompanha os logs dos ports. onUnlock(game, trophyId, {live}), live=false para linhas antigas (o jogo rodou com
// o Taiga Launcher fechado): o troféu entra no progresso sem notificação.
export class PortLogWatcher {
 constructor({games, onUnlock, interval = 1500}) { Object.assign(this, {games, onUnlock, interval}); this.offsets = new Map(); this.timer = null; this.startedAt = Date.now(); }
 start() { if (this.timer) return; this.timer = setInterval(() => this.tick(), this.interval); this.timer.unref?.(); this.tick(); }
 stop() { clearInterval(this.timer); this.timer = null; }
 tick() {
  let pairs = []; try { pairs = this.games(); } catch {}
  for (const {game, file} of pairs) {
   let st; try { st = fs.statSync(file); } catch { continue; }
   // Arquivos de progresso (trophies.dat, gamedata/trophies/*.json, progress_user*.txt): troféus novos = os que não
   // estavam na leitura anterior.
   const kind = progressKind(file);
   if (kind) {
    const prev = this.offsets.get(file); if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) continue;
    const ids = readProgressFile(file, kind).map(t => t.id);
    // Arquivo sendo regravado (vazio ou JSON pela metade): tenta de novo no próximo ciclo.
    if (!ids.length && prev?.ids?.length) continue;
    const live = st.mtimeMs >= this.startedAt - 5000, before = new Set(prev?.ids || []);
    for (const id of ids) if (!before.has(id)) { try { this.onUnlock(game, id, {live: live && !!prev, file}); } catch {} }
    this.offsets.set(file, {mtime: st.mtimeMs, size: st.size, ids});
    continue;
   }
   const known = this.offsets.get(file);
   let from = known?.offset ?? 0;
   // O launcher recria o log a cada sessão: arquivo menor ou mais novo que o lido = começa do início.
   const head = (() => { try { const fd = fs.openSync(file, 'r'); try { const b = Buffer.alloc(Math.min(256, st.size)); fs.readSync(fd, b, 0, b.length, 0); return digest(b); } finally { fs.closeSync(fd); } } catch { return ''; } })();
   if (known && (st.size < known.offset || st.birthtimeMs > known.birth + 1 || (known.head && st.size >= 256 && known.head !== head))) from = 0;
   if (known && from === st.size && st.mtimeMs === known.mtime) continue;
   const live = st.mtimeMs >= this.startedAt - 5000;
   if (st.size > from) {
    let text = '';
    try { const fd = fs.openSync(file, 'r'); try { const len = Math.min(st.size - from, 4 * 1024 * 1024), b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, Math.max(from, st.size - len)); text = b.toString('utf8'); } finally { fs.closeSync(fd); } } catch { continue; }
    // Só linhas completas.
    const cut = text.lastIndexOf('\n'); if (cut < 0 && st.size - from < 4096) { this.offsets.set(file, {offset: from, mtime: st.mtimeMs, birth: st.birthtimeMs, head: st.size >= 256 ? head : ''}); continue; }
    const usable = cut >= 0 ? text.slice(0, cut + 1) : text;
    for (const id of parsePortTrophyLines(usable, {trophyLog: /(^|[\\/])trophies\.log$/i.test(file)})) { try { this.onUnlock(game, id, {live, file}); } catch {} }
    this.offsets.set(file, {offset: from + Buffer.byteLength(usable), mtime: st.mtimeMs, birth: st.birthtimeMs, head: st.size >= 256 ? head : ''});
   } else this.offsets.set(file, {offset: st.size, mtime: st.mtimeMs, birth: st.birthtimeMs, head: st.size >= 256 ? head : ''});
  }
 }
}

// Port detectado para um jogo de PC (cache por caminho do .exe).
const portCache = new Map();
export function portOf(game) {
 if (!game?.path || game.demo || game.native || !/\.exe$/i.test(game.path) || !['pc', 'custom'].includes(game.profile)) return null;
 const hit = portCache.get(game.path); if (hit && Date.now() - hit.at < 120000) return hit.port;
 let port = null; try { port = consoleTitleNear(game.path, {configs: portConfigFiles(game.path)}); } catch {}
 if (port && !isDir(port.dump)) port = null;
 // Sem o dump, mas com a lista já decifrada pelo port (Uncharted): vale do mesmo jeito.
 if (!port) { const prof = portProfile(game); if (prof?.achievements === 'trophies' && portCachedSets(game.path).length) port = {title: prof.title, code: prof.serial || '', platform: 'PlayStation 4', dump: '', cached: true}; }
 portCache.set(game.path, {at: Date.now(), port}); return port;
}
