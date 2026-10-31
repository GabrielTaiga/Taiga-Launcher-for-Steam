// Instalação de jogos da Epic pelo Legendary (https://github.com/legendary-gl/legendary, GPL-3.0), o mesmo programa
// que o Heroic Games Launcher usa. Ele roda como um programa separado: é baixado na primeira instalação (versão fixa,
// conferida pelo SHA-256 que o GitHub publica) e fica em %LOCALAPPDATA%\Taiga Launcher\tools\legendary.
//  - Login: a sessão da Epic que o usuário já fez no Taiga Launcher (mesmo cliente do launcher que o Legendary usa)
//    gera um código de troca, entregue ao Legendary uma vez ("legendary auth --token").
//  - Progresso: lido da saída do Legendary ("= Progress: 12.34% ... ETA: 00:01:00"), como o Heroic faz.
//  - Cancelar: encerra o Legendary e apaga só a pasta que esta instalação criou.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mainExecutable} from './stores.mjs';

export const LEGENDARY_VERSION = '0.21.1';
const REPO = 'legendary-gl/legendary', ASSET = 'legendary_windows_x64.exe';
const RELEASE_API = 'https://api.github.com/repos/' + REPO + '/releases/tags/' + LEGENDARY_VERSION;
const DOWNLOAD = 'https://github.com/' + REPO + '/releases/download/' + LEGENDARY_VERSION + '/' + ASSET;
const EXCHANGE = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/exchange';

// Pasta de configuração padrão do Legendary no Windows (~/.config/legendary).
export const legendaryConfigDir = (env = process.env) => env.LEGENDARY_CONFIG_PATH || path.join(env.USERPROFILE || os.homedir(), '.config', 'legendary');

// Linha de saída do Legendary → progresso.
export function parseProgress(line, state = {}) {
 const s = String(line || '');
 let m = s.match(/= Progress: ([\d.]+)% \((\d+)\/(\d+)\).*?ETA: (\d\d:\d\d:\d\d)/);
 if (m) { state.phase = 'downloading'; state.percent = Math.min(100, Math.max(0, Number(m[1]))); state.eta = m[4]; }
 m = s.match(/ - Downloaded: ([\d.]+) MiB/); if (m) state.downloadedMiB = Number(m[1]);
 m = s.match(/Download size: ([\d.]+) (MiB|GiB)/); if (m) state.totalMiB = Number(m[1]) * (m[2] === 'GiB' ? 1024 : 1);
 m = s.match(/ - Download\t- ([\d.]+) MiB\/s/); if (m) state.speedMiB = Number(m[1]);
 if (/Finished installation process|Game has been installed|has been successfully installed/i.test(s)) { state.phase = 'finishing'; state.percent = 100; }
 if (/Verifying|Running prerequisite|Finalizing/i.test(s) && state.phase !== 'downloading') state.phase = 'finishing';
 // Motivo real da recusa ("! Failure: ..."), impresso antes de "Installation cannot proceed".
 m = s.match(/!\s*Failure:\s*(.+)$/); if (m) { state.failures = [...(state.failures || []), m[1].trim()].slice(-5); Object.assign(state, failureCode(m[1])); }
 if (/ERROR|CRITICAL|FATAL/.test(s) && !/AttributeError: 'NoneType'/.test(s)) { const msg = s.replace(/^.*?(?:ERROR|CRITICAL|FATAL):\s*/, '').trim(); if (msg && !(/cannot proceed/i.test(msg) && state.failures?.length)) { state.lastError = msg.slice(0, 300); if (!state.errorCode) Object.assign(state, failureCode(msg)); } }
 return state;
}
// Motivos conhecidos → código traduzido na interface (Steam e programa).
export function failureCode(text) {
 const s = String(text || ''); let m;
 if ((m = s.match(/Not enough available disk space!\s*([\d.]+)\s*GiB\s*<\s*([\d.]+)\s*GiB/i))) return {errorCode: 'disk', errorValues: {free: m[1], need: m[2]}};
 if (/Install path .* does not exist/i.test(s)) return {errorCode: 'path'};
 if (/requires installation via Uplay|Ubisoft/i.test(s)) return {errorCode: 'uplay'};
 if (/login|logged in|authenticat|token/i.test(s)) return {errorCode: 'auth'};
 if (/not own|could not find|not found|does not exist in/i.test(s)) return {errorCode: 'notfound'};
 return {};
}

// Jogos instalados pelo Legendary (installed.json), no formato das lojas do Taiga Launcher.
export function scanLegendary({env = process.env, exe = ''} = {}) {
 const data = (() => { try { return JSON.parse(fs.readFileSync(path.join(legendaryConfigDir(env), 'installed.json'), 'utf8')); } catch { return null; } })();
 const out = [];
 for (const [k, v] of Object.entries(data || {})) {
  if (!v || v.is_dlc || !v.install_path || !v.executable || (v.platform && !/^win/i.test(v.platform))) continue;
  const file = path.join(v.install_path, ...String(v.executable).split(/[\\/]/));
  try { if (!fs.statSync(file).isFile()) continue; } catch { continue; }
  out.push({store: 'epic', storeName: 'Epic Games', id: v.catalog_item_id || '', appName: v.app_name || k, namespace: v.namespace || '', title: v.title || k, path: file, root: v.install_path, legendary: true,
   ...(exe ? {launcherExe: exe, url: 'launch ' + (v.app_name || k), needsLauncher: true} : {})});
 }
 return out;
}

// Um jogo instalado pelo Legendary, lido direto do installed.json; sem executável indicado, o principal da pasta.
export function legendaryInstalledItem(appName, exe = '', {env = process.env} = {}) {
 let data = null; try { data = JSON.parse(fs.readFileSync(path.join(legendaryConfigDir(env), 'installed.json'), 'utf8')); } catch { return null; }
 const key = Object.keys(data || {}).find(k => k.toLowerCase() === String(appName || '').toLowerCase()); const v = key && data[key];
 if (!v || !v.install_path) return null;
 let file = v.executable ? path.join(v.install_path, ...String(v.executable).split(/[\\/]/)) : '';
 try { if (!file || !fs.statSync(file).isFile()) file = ''; } catch { file = ''; }
 if (!file) file = mainExecutable(v.install_path);
 if (!file) return null;
 return {store: 'epic', storeName: 'Epic Games', id: v.catalog_item_id || '', appName: v.app_name || key, namespace: v.namespace || '', title: v.title || key, path: file, root: v.install_path, legendary: true, ...(exe ? {launcherExe: exe, url: 'launch ' + (v.app_name || key), needsLauncher: true} : {})};
}
export class Legendary {
 constructor({dataDir, fetchImpl = (...a) => fetch(...a), platform = process.platform, env = process.env, log = () => {}} = {}) {
  Object.assign(this, {dataDir, fetchImpl, platform, env, log});
  this.jobs = new Map(); // appName → estado da instalação
 }
 get exe() { return path.join(this.dataDir, 'tools', 'legendary', 'legendary.exe'); }
 installed() { try { return fs.statSync(this.exe).size > 1000000; } catch { return false; } }

 // Baixa o Legendary (uma vez) e confere o SHA-256 publicado pelo GitHub para esse arquivo.
 async ensure(onState = () => {}) {
  if (this.installed()) return this.exe;
  if (this.platform !== 'win32') throw Error('A instalação pela Epic só funciona no Windows.');
  onState({phase: 'tool'});
  let digest = '';
  try { const rel = await (await this.fetchImpl(RELEASE_API, {headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'TaigaLauncher'}, signal: AbortSignal.timeout(20000)})).json(); digest = String((rel?.assets || []).find(a => a?.name === ASSET)?.digest || '').replace(/^sha256:/i, '').toLowerCase(); } catch {}
  const res = await this.fetchImpl(DOWNLOAD, {headers: {'User-Agent': 'TaigaLauncher'}, redirect: 'follow', signal: AbortSignal.timeout(300000)});
  if (!res.ok) throw Error('Não foi possível baixar o Legendary (HTTP ' + res.status + ').');
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 1000000 || bytes.readUInt16LE(0) !== 0x5a4d) throw Error('O arquivo do Legendary baixado não é válido.');
  const sum = createHash('sha256').update(bytes).digest('hex');
  if (digest && sum !== digest) throw Error('O Legendary baixado não confere com o publicado no GitHub. Nada foi instalado.');
  fs.mkdirSync(path.dirname(this.exe), {recursive: true});
  fs.writeFileSync(this.exe + '.tmp', bytes); fs.renameSync(this.exe + '.tmp', this.exe);
  fs.writeFileSync(path.join(path.dirname(this.exe), 'VERSION.txt'), LEGENDARY_VERSION + '\nsha256 ' + sum + '\nGPL-3.0: https://github.com/' + REPO + '\n');
  this.log('Legendary ' + LEGENDARY_VERSION + ' baixado (' + sum + ')');
  return this.exe;
 }
 run(args, {timeout = 120000} = {}) {
  return new Promise((resolve, reject) => execFile(this.exe, args, {windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024, env: {...this.env, PYTHONIOENCODING: 'utf-8'}}, (e, stdout, stderr) => e ? reject(Object.assign(Error(String(stderr || e.message).trim().split(/\r?\n/).filter(Boolean).pop() || e.message), {stdout, stderr})) : resolve({stdout: String(stdout), stderr: String(stderr)})));
 }
 // Entrega ao Legendary a sessão da Epic do Taiga Launcher (só quando ele ainda não está com a mesma conta).
 async ensureAuth(auth) {
  if (!auth?.accessToken) throw Error('Entre com a sua conta Epic em Contas para instalar jogos da Epic.');
  const user = (() => { try { return JSON.parse(fs.readFileSync(path.join(legendaryConfigDir(this.env), 'user.json'), 'utf8')); } catch { return null; } })();
  if (user?.account_id && String(user.account_id).toLowerCase() === String(auth.accountId).toLowerCase() && user.refresh_token) return;
  const res = await this.fetchImpl(EXCHANGE, {headers: {Authorization: 'bearer ' + auth.accessToken, 'User-Agent': 'TaigaLauncher'}, signal: AbortSignal.timeout(20000)});
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.code) throw Error('A Epic não liberou o login para a instalação. Entre de novo com a conta Epic em Contas.');
  await this.run(['auth', '--token', String(data.code)]);
 }
 // Tamanho do jogo (manifest): espaço em disco e download, como o Heroic mostra antes de instalar.
 async info(appName, auth) {
  if (!/^[\w.-]{1,120}$/.test(String(appName))) throw Error('Jogo da Epic inválido.');
  await this.ensure();
  await this.ensureAuth(auth);
  const {stdout} = await this.run(['info', appName, '--json', '--platform', 'Windows'], {timeout: 90000});
  const start = stdout.indexOf('{'); const d = JSON.parse(stdout.slice(start));
  const disk = Number(d?.manifest?.disk_size) || 0, dl = Number(d?.manifest?.download_size) || 0;
  return {diskBytes: disk, downloadBytes: dl};
 }
 state(appName) { const j = this.jobs.get(appName); return j ? {...j.state} : null; }
 // Inicia a instalação; o estado é acompanhado por state(appName). onDone(estado) ao terminar (ok, erro ou cancelado).
 async install(appName, {auth, baseDir, onDone = () => {}} = {}) {
  if (!/^[\w.-]{1,120}$/.test(String(appName))) throw Error('Jogo da Epic inválido.');
  const running = this.jobs.get(appName); if (running && ['tool', 'preparing', 'downloading', 'finishing'].includes(running.state.phase)) return running.state;
  if (this.active().length) throw Error('Já há um jogo da Epic sendo instalado. Espere terminar ou cancele.');
  const prev = this.jobs.get(appName);
  const job = {state: {phase: 'preparing', percent: prev?.state?.phase === 'paused' ? prev.state.percent || 0 : 0, startedAt: Date.now()}, child: null, cancelled: false, paused: false, created: prev?.state?.phase === 'paused' ? prev.created || [] : []};
  this.jobs.set(appName, job);
  (async () => {
   try {
    await this.ensure(s => Object.assign(job.state, s));
    job.state.phase = 'preparing';
    await this.ensureAuth(auth);
    if (job.cancelled) throw Error('cancelled');
    fs.mkdirSync(baseDir, {recursive: true});
    const before = new Set(fs.readdirSync(baseDir).map(n => n.toLowerCase()));
    const child = spawn(this.exe, ['install', appName, '--base-path', baseDir, '--platform', 'Windows', '--skip-sdl', '--skip-dlcs', '-y'], {windowsHide: true, env: {...this.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1'}});
    job.child = child;
    let buf = '';
    const feed = d => { buf += String(d); const lines = buf.split(/\r?\n|\r/); buf = lines.pop(); for (const l of lines) parseProgress(l, job.state); };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    const code = await new Promise(r => { child.on('close', r); child.on('error', () => r(-1)); });
    try { job.created = [...new Set([...job.created, ...fs.readdirSync(baseDir).filter(n => !before.has(n.toLowerCase())).map(n => path.join(baseDir, n))])]; } catch {}
    if (job.cancelled) throw Error('cancelled');
    if (job.paused) { job.state.phase = 'paused'; job.child = null; try { onDone({...job.state}); } catch {} return; }
    if (code !== 0) throw Error((job.state.failures || []).join(' ') || job.state.lastError || 'O Legendary parou com o código ' + code + '.');
    job.state.phase = 'done'; job.state.percent = 100;
   } catch (e) {
    if (job.cancelled || e.message === 'cancelled') { job.state.phase = 'cancelled'; this.cleanup(job); }
    else { job.state.phase = 'error'; job.state.error = String(e.message || e).slice(0, 300); this.log('Instalação Epic falhou (' + appName + '): ' + job.state.error); }
   }
   job.child = null;
   try { onDone({...job.state}); } catch {}
  })();
  return {...job.state};
 }
 cleanup(job) { for (const dir of job.created || []) { try { fs.rmSync(dir, {recursive: true, force: true}); } catch {} } }
 // Pausa: encerra o Legendary sem apagar nada; "Retomar" continua o download de onde parou (o Legendary guarda o
 // ponto em que estava).
 async pause(appName) {
  const job = this.jobs.get(appName); if (!job?.child) return false;
  job.paused = true;
  await this.kill(job);
  return true;
 }
 async kill(job) {
  const pid = job.child?.pid;
  if (pid) { if (this.platform === 'win32') await new Promise(r => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], {windowsHide: true}, () => r())); else { try { job.child.kill('SIGKILL'); } catch {} } }
 }
 // Cancela: encerra o Legendary (e os processos dele) e apaga a pasta criada por esta instalação.
 async cancel(appName) {
  const job = this.jobs.get(appName); if (!job) return false;
  if (job.state.phase === 'paused') { this.cleanup(job); job.state.phase = 'cancelled'; return true; }
  job.cancelled = true;
  const pid = job.child?.pid;
  if (pid) { if (this.platform === 'win32') await new Promise(r => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], {windowsHide: true}, () => r())); else { try { job.child.kill('SIGKILL'); } catch {} } }
  else { job.state.phase = 'cancelled'; }
  return true;
 }
 active() { return [...this.jobs.entries()].filter(([, j]) => ['tool', 'preparing', 'downloading', 'finishing'].includes(j.state.phase)).map(([k]) => k); }
}
