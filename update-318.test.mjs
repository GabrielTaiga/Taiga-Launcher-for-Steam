import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {portProfile, portConfigFiles} from '../lib/port-profiles.mjs';
import {portOf, readPortTrophies, PortTrophyStore, portProgressFiles, readProgressFile, portUserDirs, portStoreKey, activeCachedSet, parseCachedSet, PortLogWatcher} from '../lib/port-trophies.mjs';

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const put = (f, data = 'x') => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, data); };
const png = n => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('icone' + n)]);
const setText = (npwr, title, trophies) => ['format\t2', 'stamp\tC:/g/trophy02.trp|1|2|17', 'npcommid\t' + npwr, 'title\t' + title, 'detail\t', 'groups\t0', ...trophies.map(t => ['trophy', ...t].join('\t'))].join('\n') + '\n';

test('Ports novos reconhecidos; os sem troféus ficam marcados como "sem conquistas"', () => {
 const p = f => portProfile({path: f})?.id;
 assert.equal(p('C:/BB/Play Bloodborne.exe'), 'bloodborne-port');
 assert.equal(p('C:/U/Uncharted.exe'), 'uncharted-collection');
 assert.equal(p('C:/U/Play Uncharted.exe'), 'uncharted-collection');
 assert.equal(p('C:/I/inFAMOUS Second Son.exe'), 'infamous-second-son');
 assert.equal(portProfile({path: 'C:/S/skate3.exe'}).achievements, 'none');
 assert.equal(portProfile({path: 'C:/W/WiiCompiled.exe'}).title, 'Mario Kart Wii');
 assert.equal(p('C:/God of War/ps2EntryRunner.exe'), 'gow1-recomp');
 assert.equal(p('C:/Outro/ps2EntryRunner.exe'), undefined);
 assert.equal(portProfile({path: 'C:/gow2-recomp/gow2.exe'}).platform, 'ps3');
 // Uncharted também tem bbport.ini (veio do port do Bloodborne): continua sendo Uncharted.
 const d = tmp('unc-id-'); put(path.join(d, 'Uncharted.exe')); put(path.join(d, 'bbport.ini'));
 assert.equal(p(path.join(d, 'Uncharted.exe')), 'uncharted-collection');
 assert.deepEqual(portConfigFiles('C:/BB/Bloodborne.exe', {APPDATA: '/ad'}).map(f => f.replace(/\\/g, '/')), ['/ad/bbport-launcher/settings.json', '/ad/bbport-launcher-coop/settings.json']);
 fs.rmSync(d, {recursive: true, force: true});
});

test('Bloodborne PC: trophies.txt ("id horário") e pasta de saves escolhida no launcher do port (%APPDATA%)', () => {
 const d = tmp('bb-'), app = path.join(d, 'AppData'), saves = path.join(d, 'Meus saves'), exe = path.join(d, 'port', 'Bloodborne.exe');
 put(exe); put(path.join(app, 'bbport-launcher', 'settings.json'), JSON.stringify({user_dir: saves, game_dir: path.join(d, 'dump')}));
 put(path.join(saves, 'trophies.txt'), '3 1761400000\n12 1761400100\nlixo\n');
 const env = {APPDATA: app};
 assert.equal(portUserDirs(exe, env)[0], saves);
 const files = portProgressFiles(exe, env);
 assert.deepEqual(files.map(f => f.kind), ['idlog']);
 assert.deepEqual(readProgressFile(files[0].file).map(t => [t.id, t.at]), [[3, 1761400000], [12, 1761400100]]);
 fs.rmSync(d, {recursive: true, force: true});
});

test('Uncharted: lista já decifrada pelo port, um conjunto por jogo, o jogado por último aparece', () => {
 const d = tmp('unc-'), exe = path.join(d, 'Uncharted.exe'), data = tmp('unc-data-');
 put(exe);
 put(path.join(d, 'out', 'eboot', 'trophy', 'trophies.txt'), setText('NPWR09798_00', "Uncharted: Drake's Fortune", [['0', 'P', '0', 'Platina 1', 'Todos'], ['1', 'B', '0', 'Primeiro', 'A']]));
 put(path.join(d, 'out', 'big2', 'trophy', 'trophies.txt'), setText('NPWR09799_00', 'Uncharted 2', [['0', 'P', '0', 'Platina 2', 'Todos'], ['1', 'B', '0', 'Tiro\\tcerto', 'Linha\\nnova'], ['2', 'G', '1', 'Ouro', 'B']]));
 put(path.join(d, 'out', 'big2', 'trophy', 'TROP001.PNG'), png(1));
 assert.equal(parseCachedSet(fs.readFileSync(path.join(d, 'out', 'big2', 'trophy', 'trophies.txt'), 'utf8')).language, 'pt-BR');
 // Sem nenhum jogo jogado: o escolhido no launcher do port.
 const app = path.join(d, 'AppData'); put(path.join(app, 'uncharted-launcher', 'settings.json'), JSON.stringify({start: 'u2'}));
 assert.equal(activeCachedSet(exe, {APPDATA: app}).set, 'NPWR09799_00');
 const port = portOf({path: exe, profile: 'pc'});
 assert.ok(port && port.cached, 'vale sem achar o dump');
 put(path.join(d, 'user', 'trophy', 'NPWR09798_00.log'), '1 1761000000\n');
 const old = new Date(Date.now() - 3600e3); fs.utimesSync(path.join(d, 'user', 'trophy', 'NPWR09798_00.log'), old, old);
 put(path.join(d, 'user', 'trophy', 'NPWR09799_00.log'), '1 1761400000\n2 1761400100\n');
 const game = {id: 'u', uuid: 'abc', path: exe, profile: 'pc', title: 'Uncharted'};
 const store = new PortTrophyStore(data);
{
  const res = readPortTrophies(game, port, {config: {language: 'pt-BR'}, dataDir: data, store});
  assert.equal(res.trophySet, 'NPWR09799_00'); assert.equal(res.detail, 'full'); assert.equal(res.sourceLanguage, 'pt-BR');
  assert.equal(res.achievements[1].title, 'Tiro\tcerto'); assert.equal(res.achievements[1].description, 'Linha\nnova');
  assert.match(res.achievements[1].icon, /^\/art\/[0-9a-f]+\.png$/);
  assert.ok(res.achievements.every(a => a.unlocked), 'platina conta sozinha quando o resto está completo');
  assert.equal(res.achievements[0].grade, 'P');
  assert.equal(portStoreKey(game), 'abc-NPWR09799_00');
  assert.equal(portStoreKey(game, path.join(d, 'user', 'trophy', 'NPWR09798_00.log')), 'abc-NPWR09798_00');
  assert.deepEqual(Object.keys(store.get('abc-NPWR09799_00').unlocked).sort(), ['0', '1', '2']);
  assert.deepEqual(store.get('abc').unlocked, {}, 'o progresso de um jogo da coleção não vai para outro');
  fs.rmSync(d, {recursive: true, force: true}); fs.rmSync(data, {recursive: true, force: true});
 }
});

test('inFAMOUS Second Son: earned.json e o arquivo do save usado por último', () => {
 const d = tmp('iss-'), exe = path.join(d, 'inFAMOUS Second Son.exe'), base = path.join(d, 'user', 'trophies', 'CUSA00223');
 put(exe);
 put(path.join(base, 'earned.json'), JSON.stringify({schema: 1, title_id: 'CUSA00223', package_fingerprint: 'f', save_identity: '', earned: [{id: 4, time: 1761400000}, {id: 9, time: 1761400500}], recovered: []}));
 put(path.join(base, 'save-versions', 'a'.repeat(64) + '.json'), JSON.stringify({earned: [{id: 1, time: 1761000000}]}));
 const old = new Date(Date.now() - 3600e3); fs.utimesSync(path.join(base, 'save-versions', 'a'.repeat(64) + '.json'), old, old);
 put(path.join(base, 'save-versions', 'b'.repeat(64) + '.json'), JSON.stringify({earned: [{id: 2, time: 1761300000}]}));
 const files = portProgressFiles(exe, {});
 assert.deepEqual(files.map(f => [f.kind, path.basename(f.file)]), [['ledger', 'earned.json'], ['ledger', 'b'.repeat(64) + '.json']]);
 assert.deepEqual(readProgressFile(files[0].file).map(t => t.id), [4, 9]);
 assert.deepEqual(readProgressFile(files[1].file).map(t => t.id), [2]);
 fs.rmSync(d, {recursive: true, force: true});
});

test('Troféu novo no arquivo do port avisa na hora, com o arquivo para separar o jogo da coleção', async () => {
 const d = tmp('watch-'), log = path.join(d, 'user', 'trophy', 'NPWR09801_00.log'); put(log, '1 1761400000\n');
 const got = [], game = {uuid: 'g'};
 const w = new PortLogWatcher({games: () => [{game, file: log}], onUnlock: (g, id, o) => got.push([id, o.live, o.file])});
 w.tick(); assert.equal(got.length, 1); assert.equal(got[0][1], false, 'o que já estava no arquivo entra sem aviso');
 await new Promise(r => setTimeout(r, 30)); fs.appendFileSync(log, '5 1761400100\n'); const t = new Date(Date.now() + 2000); fs.utimesSync(log, t, t);
 w.tick(); assert.deepEqual(got[1], [5, true, log]);
 fs.rmSync(d, {recursive: true, force: true});
});
