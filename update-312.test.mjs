import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {xboxIdentity} from '../lib/stores-more.mjs';
import {StoreAchievements} from '../lib/store-achievements.mjs';
import {scanUbisoft, scanGOG, mainExecutable} from '../lib/stores.mjs';

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const put = (f, data = 'x') => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, data); };
const session = {xsts: {token: 't', uhs: 'u', xuid: '123'}};

test('Xbox: jogo achado como PC comum é reconhecido pelo MicrosoftGame.config (pacote e Title ID)', () => {
 const d = tmp('xb-'), exe = path.join(d, 'XboxGames', 'Among Us', 'Content', 'Among Us.exe');
 put(exe); put(path.join(d, 'XboxGames', 'Among Us', 'Content', 'MicrosoftGame.config'), '<Game><Identity Name="Innersloth.AmongUs" Publisher="CN=ABC" Version="1.0"/><TitleId>6F8B1D5C</TitleId></Game>');
 const id = xboxIdentity({path: exe, profile: 'pc'});
 assert.match(id.pfn, /^Innersloth\.AmongUs_[0-9a-z]{13}$/);
 assert.equal(id.titleId, String(0x6F8B1D5C));
 assert.deepEqual(xboxIdentity({store: {name: 'xbox', pfn: 'A_b', titleId: '42'}, notInstalled: true}), {pfn: 'A_b', titleId: '42'});
 fs.rmSync(d, {recursive: true, force: true});
});

test('Xbox: conquistas pelo Title ID, nome com "™"/"(PC)", todas as páginas, e motivo quando falta login', async () => {
 const dir = tmp('xba-'), calls = [];
 const fetchImpl = async url => {
  calls.push(url);
  if (url.includes('titlehistory')) return new Response(JSON.stringify({titles: [{titleId: '1870000000', pfn: 'Other_1', name: 'Among Us™ (PC)', achievement: {totalAchievements: 3}}]}));
  if (url.includes('/achievements?titleId=1870000000') && !url.includes('continuationToken')) return new Response(JSON.stringify({achievements: [{id: '1', name: 'Crewmate', progressState: 'Achieved', progression: {timeUnlocked: '2026-01-02T00:00:00Z'}, mediaAssets: [{type: 'Icon', url: 'https://images-eds-ssl.xboxlive.com/i.png'}]}, {id: '2', name: 'Impostor', progressState: 'NotStarted', lockedDescription: 'Win', progression: {requirements: [{current: '3', target: '10'}]}}], pagingInfo: {continuationToken: 'abc'}}));
  if (url.includes('continuationToken=abc')) return new Response(JSON.stringify({achievements: [{id: '3', name: 'Sabotage', progressState: 'NotStarted'}], pagingInfo: {continuationToken: null}}));
  return new Response('{}', {status: 404});
 };
 const s = new StoreAchievements({dir, fetchImpl});
 const r = await s.xbox({session, name: 'Among Us', language: 'pt-BR'});
 assert.equal(r.status, 'ok'); assert.equal(r.achievements.length, 3);
 assert.equal(r.achievements[0].unlocked, true); assert.equal(r.achievements[1].maxProgress, 10); assert.equal(r.achievements[1].progress, 3);
 const byId = await new StoreAchievements({dir: tmp('xbb-'), fetchImpl}).xbox({session, titleId: '1870000000', name: 'Nome diferente'});
 assert.equal(byId.achievements.length, 3);
 const none = await s.xbox({session: null, name: 'Among Us'});
 assert.equal(none.status, 'unconfigured'); assert.equal(none.provider, 'xbox');
 fs.rmSync(dir, {recursive: true, force: true});
});

test('Ubisoft: ícone .ico ou do Ubisoft Connect não esconde o jogo; o executável vem da pasta', async () => {
 const d = tmp('ubi-'), root = path.join(d, 'Far Cry 5'), exe = path.join(root, 'bin', 'FarCry5.exe');
 put(exe, Buffer.alloc(400 * 1024)); put(path.join(root, 'bin', 'uninstall.exe'), Buffer.alloc(900 * 1024)); put(path.join(root, 'game.ico'));
 const reg = {
  'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher': [{key: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher', values: {InstallDir: 'C:\\Ubisoft\\'}}],
  'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs': [{key: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\4311', values: {InstallDir: root + path.sep}}],
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall': [{key: 'HKEY_LOCAL_MACHINE\\...\\Uninstall\\Uplay Install 4311', values: {DisplayName: 'Far Cry® 5', DisplayIcon: path.join(root, 'game.ico')}}],
 };
 const items = await scanUbisoft({query: async k => reg[k] || []});
 assert.equal(items.length, 1); assert.equal(items[0].path, exe); assert.equal(items[0].title, 'Far Cry® 5'); assert.equal(items[0].url, 'uplay://launch/4311/0');
 assert.equal(mainExecutable(root), exe);
 fs.rmSync(d, {recursive: true, force: true});
});

test('GOG: pasta padrão "GOG Games" sem config do Galaxy e DLC não vira jogo', () => {
 const d = tmp('gog-'), game = path.join(d, 'GOG Games', 'Witcher 3');
 put(path.join(game, 'bin', 'witcher3.exe'));
 put(path.join(game, 'goggame-1207664663.info'), JSON.stringify({gameId: '1207664663', rootGameId: '1207664663', name: 'The Witcher 3', playTasks: [{isPrimary: true, type: 'FileTask', path: 'bin\\witcher3.exe'}]}));
 put(path.join(game, 'goggame-1640424747.info'), JSON.stringify({gameId: '1640424747', rootGameId: '1207664663', name: 'Hearts of Stone', playTasks: [{isPrimary: true, type: 'FileTask', path: 'bin\\witcher3.exe'}]}));
 const items = scanGOG({PROGRAMDATA: path.join(d, 'nada')}, [], [d]);
 assert.deepEqual(items.map(i => i.title), ['The Witcher 3']);
 fs.rmSync(d, {recursive: true, force: true});
});

test('Capas e Steam: capa da loja na hora, jogo não instalado pode ir para a Steam, marcos fora da atividade', () => {
 const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
 assert.match(server, /route\.startsWith\('\/store-art\/'\)/);
 assert.match(server, /await pool\([^;]*,8,quickStoreArt\)/);
 assert.match(server, /!g\.notInstalled&&!isFile\(g\.path\)/);
 assert.match(server, /steamByTitle\(\)\.get\(normalize\(g\.title\)\)/);
 const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
 assert.match(app, /class="art-remote" src="\/store-art\//);
 const ngl = fs.readFileSync(new URL('../../../third_party/nativegamelink/frontend/features/library/social/taiga-extras.ts', import.meta.url), 'utf8');
 assert.match(ngl, /filter\(a => a\.kind === 'achievements'\);/);
 assert.ok(ngl.indexOf("t('media')") < ngl.indexOf("t('similar')"), 'imagens antes de "Se você gosta deste jogo"');
 assert.match(ngl, /\.taiga-x-lightbox \*\{-webkit-app-region:no-drag\}/); assert.match(ngl, /\.taiga-x-lb-close\{top:72px/);
 const oc = fs.readFileSync(new URL('../../../third_party/nativegamelink/frontend/features/library/social/online-comments.ts', import.meta.url), 'utf8');
 assert.match(oc, /export const ONLINE_COMMENTS = false;/, 'comentários online desligados');
 assert.match(oc, /if \(!ONLINE_COMMENTS\) return;/); assert.match(oc, /if \(!ONLINE_COMMENTS \|\| !m/);
 assert.ok(!/k:'comments'/.test(app) && !/\['comments',null\]/.test(app), 'sem slide e ajuda de comentários');
});

test('PlayStation: platina desbloqueia sozinha quando todos os outros troféus estão desbloqueados', async () => {
 const {autoPlatinum} = await import('../lib/achievement-manager.mjs');
 const list = [{id: '0', grade: 'P', unlocked: false, date: null}, {id: '1', grade: 'B', unlocked: true, date: '100'}, {id: '2', grade: 'G', unlocked: true, date: '250'}];
 autoPlatinum(list);
 assert.equal(list[0].unlocked, true); assert.equal(list[0].date, '250');
 const partial = [{grade: 'P', unlocked: false}, {grade: 'B', unlocked: true}, {grade: 'S', unlocked: false}];
 autoPlatinum(partial); assert.equal(partial[0].unlocked, false);
 const noPlat = [{grade: 'B', unlocked: true}]; autoPlatinum(noPlat); assert.equal(noPlat.length, 1);
});

test('Platina sem tipo: troféu 0 "desbloquear todos os troféus" (SpartanPort, trophy_texts.txt) conta sozinho', async () => {
 const {autoPlatinum} = await import('../lib/achievement-manager.mjs');
 const {platinumOf} = await import('../lib/port-trophies.mjs');
 const list = [{id: '0', title: 'King of the Hill', description: 'Unlock all trophies', unlocked: false}, {id: '1', unlocked: true, date: '10'}, {id: '2', unlocked: true, date: '20'}];
 autoPlatinum(list); assert.equal(list[0].unlocked, true); assert.equal(list[0].date, '20');
 assert.equal(platinumOf([{id: '0', title: 'Rei da Colina', description: 'Desbloquear todos os troféus'}, {id: '1'}])?.id, '0');
 assert.equal(platinumOf([{id: '0', title: 'Início', description: 'Comece o jogo'}, {id: '1'}]), null);
 assert.equal(platinumOf([{id: '0', grade: 'B', description: 'Unlock all trophies'}, {id: '1', grade: 'S'}]), null, 'com tipo, só vale o "P"');
});
