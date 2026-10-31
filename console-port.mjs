// Ports nativos de jogos de console (ex.: SpartanPort, God of War III para PC a partir do dump de PS4): a pasta do
// dump traz o PARAM.SFO com o nome oficial e o código do jogo. Procura perto do .exe e nos caminhos citados nos
// arquivos de configuração do port (settings.json, *.ini).
import fs from 'node:fs';
import path from 'node:path';
import {parseSFO} from './psp.mjs';

const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const isDir = f => { try { return fs.statSync(f).isDirectory(); } catch { return false; } };
const list = d => { try { return fs.readdirSync(d, {withFileTypes: true}); } catch { return []; } };
// Extratores de PKG gravam os arquivos de sistema em Sc0/ (param.sfo, trophy/) em vez de sce_sys/.
const SFO_AT = d => [path.join(d, 'sce_sys', 'param.sfo'), path.join(d, 'Sc0', 'param.sfo'), path.join(d, 'PS3_GAME', 'PARAM.SFO'), path.join(d, 'PARAM.SFO'),
 // Ports ps3recomp (Yakuza Dead Souls, inFAMOUS...): o disco fica em gamedata/dev_bdvd/PS3_GAME.
 path.join(d, 'gamedata', 'dev_bdvd', 'PS3_GAME', 'PARAM.SFO'), path.join(d, 'dev_bdvd', 'PS3_GAME', 'PARAM.SFO')];
const CODE = /\b(CUSA|PPSA|BLUS|BLES|BCUS|BCES|NPUB|NPEB|NPUA|NPEA|PCSA|PCSE|PCSB|ULUS|ULES|UCUS|UCES)\d{5}\b/i;

function readSfo(file) {
  try { if (!isFile(file) || fs.statSync(file).size > 1024 * 1024) return null; const d = parseSFO(fs.readFileSync(file)); const title = String(d.TITLE || '').trim(); if (!title) return null; const code = String(d.TITLE_ID || d.CONTENT_ID?.slice?.(7, 16) || '').trim(); const ps4 = /^(CUSA|PPSA|PCSA|PCSE)/i.test(code) || /sce_sys|[\\/]Sc0[\\/]/i.test(file); return {title, code, platform: ps4 ? 'PlayStation 4' : /^(UL|UC|NP[UEHJ]H)/i.test(code) ? 'PlayStation Portable' : 'PlayStation 3', file, dump: /[\\/](sce_sys|Sc0|PS3_GAME)[\\/][^\\/]+$/i.test(file) ? path.dirname(path.dirname(file)) : path.dirname(file)}; } catch { return null; }
}
// configs: arquivos de configuração do port fora da pasta dele (ex.: %APPDATA%\bbport-launcher\settings.json).
const citedDirs = text => { const out = []; for (const m of String(text).matchAll(/((?:[A-Za-z]:(?:\\\\|\\|\/)|\/(?!\/))[^"'\r\n]{2,260})/g)) { const p = m[1].replace(/\\\\/g, '\\').replace(/[\\/]+$/, ''); if (isDir(p)) out.push(p); } return out; };
export function consoleTitleNear(exe, {configs = []} = {}) {
  const dirs = [], add = d => { if (d && isDir(d) && !dirs.includes(d)) dirs.push(d); };
  let d = path.dirname(exe); for (let i = 0; i < 3; i++) { add(d); const up = path.dirname(d); if (up === d) break; d = up; }
  for (const f of configs) { try { if (isFile(f) && fs.statSync(f).size <= 256 * 1024) for (const p of citedDirs(fs.readFileSync(f, 'utf8'))) add(p); } catch {} }
  // Caminhos citados nas configurações do port.
  for (const dir of dirs.slice(0, 2)) for (const e of [...list(dir), ...list(path.join(dir, 'user')).map(x => Object.assign(x, {sub: 'user'}))]) {
    if (!e.isFile?.() || !/\.(json|ini|cfg|toml|txt)$/i.test(e.name)) continue; const f = path.join(dir, e.sub || '', e.name);
    try { if (fs.statSync(f).size > 256 * 1024) continue; const text = fs.readFileSync(f, 'utf8'); for (const m of text.matchAll(/((?:[A-Za-z]:(?:\\\\|\\|\/)|\/(?!\/))[^"'\r\n]{2,260})/g)) { const p = m[1].replace(/\\\\/g, '\\').replace(/[\\/]+$/, ''); if (isDir(p)) add(p); } } catch {}
  }
  for (const dir of dirs) {
    for (const f of SFO_AT(dir)) { const r = readSfo(f); if (r) return r; }
    for (const e of list(dir).slice(0, 60)) if (e.isDirectory() && (CODE.test(e.name) || /dump|game|ps4|ps3|eboot/i.test(e.name))) for (const f of SFO_AT(path.join(dir, e.name))) { const r = readSfo(f); if (r) return r; }
  }
  return null;
}
