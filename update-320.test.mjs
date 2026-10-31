import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readTRP, portOf, readPortTrophies, PortTrophyStore, parsePs3recompTrophies} from '../lib/port-trophies.mjs';
import {portProfile} from '../lib/port-profiles.mjs';
import {storeLinkFallback} from '../lib/launch-engine.mjs';

const put = (f, data = 'x') => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, data); };
// TRP do PS3: cabeçalho de 0x40 bytes (versão 1), entradas de 0x40 a partir de 0x40.
function ps3TRP(files) {
 const head = Buffer.alloc(0x40), entries = Buffer.alloc(files.length * 0x40);
 head.writeUInt32BE(0xDCA24D00, 0); head.writeUInt32BE(1, 4); head.writeUInt32BE(files.length, 0x10); head.writeUInt32BE(0x40, 0x14);
 let pos = 0x40 + entries.length; const bodies = [];
 files.forEach(([name, d], i) => { entries.write(name, i * 0x40, 'latin1'); entries.writeBigUInt64BE(BigInt(pos), i * 0x40 + 32); entries.writeBigUInt64BE(BigInt(d.length), i * 0x40 + 40); bodies.push(d); pos += d.length; });
 const out = Buffer.concat([head, entries, ...bodies]); out.writeBigUInt64BE(BigInt(out.length), 8); return out;
}
const sfo = (title, code) => {
 // PARAM.SFO mínimo: TITLE e TITLE_ID.
 const keys = ['TITLE', 'TITLE_ID'], vals = [title, code], keyTable = Buffer.from(keys.join('\0') + '\0'), dataParts = vals.map(v => { const b = Buffer.alloc(128); b.write(v); return b; });
 const head = Buffer.alloc(20), index = Buffer.alloc(16 * keys.length), keyStart = 20 + index.length, dataStart = keyStart + keyTable.length + ((4 - (keyTable.length % 4)) % 4);
 head.writeUInt32LE(0x46535000, 0); head.writeUInt32LE(0x101, 4); head.writeUInt32LE(keyStart, 8); head.writeUInt32LE(dataStart, 12); head.writeUInt32LE(keys.length, 16);
 let ko = 0; keys.forEach((k, i) => { index.writeUInt16LE(ko, i * 16); index.writeUInt16LE(0x0204, i * 16 + 2); index.writeUInt32LE(vals[i].length + 1, i * 16 + 4); index.writeUInt32LE(128, i * 16 + 8); index.writeUInt32LE(i * 128, i * 16 + 12); ko += k.length + 1; });
 return Buffer.concat([head, index, keyTable, Buffer.alloc(dataStart - keyStart - keyTable.length), ...dataParts]);
};
const SIG = '<!--Sce-Np-Trophy-Signature: AAAABBBB-->\n';
const conf = (lang) => Buffer.from(SIG + `<?xml version="1.0" encoding="UTF-8"?><trophyconf version="1.0"><title-name>inFAMOUS</title-name>` +
 `<trophy id="000" hidden="no" ttype="P" pid="-1"><name>${lang === 'pt' ? 'Platina' : 'Platinum'}</name><detail>${lang === 'pt' ? 'Todos os troféus' : 'All trophies'}</detail></trophy>` +
 `<trophy id="001" hidden="no" ttype="B" pid="0"><name>${lang === 'pt' ? 'Herói' : 'Hero'}</name><detail>A</detail></trophy>` +
 `<trophy id="002" hidden="yes" ttype="G" pid="0"><name>Ouro</name><detail>B</detail></trophy></trophyconf>`);
const png = n => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('i' + n)]);

test('inFAMOUS (ps3recomp): TRP do PS3, assinatura antes do XML, idioma e desbloqueios do gamedata/trophies', () => {
 const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ps3r-')), data = fs.mkdtempSync(path.join(os.tmpdir(), 'ps3r-data-'));
 const root = path.join(d, 'infamous-recomp'), exe = path.join(root, 'inFAMOUS.exe'), ps3 = path.join(root, 'gamedata', 'dev_bdvd', 'PS3_GAME');
 put(exe); put(path.join(ps3, 'PARAM.SFO'), sfo('inFAMOUS', 'BCUS98119'));
 const pack = ps3TRP([['TROPCONF.SFM', conf('en')], ['TROP.SFM', conf('en')], ['TROP_01.SFM', conf('en')], ['TROP_07.SFM', conf('pt')], ['TROP000.PNG', png(0)], ['TROP001.PNG', png(1)], ['TROP002.PNG', png(2)], ['ICON0.PNG', png(9)]]);
 put(path.join(ps3, 'TROPDIR', 'NPWR00660_00', 'TROPHY.TRP'), pack);
 assert.equal(readTRP(pack).length, 8, 'cabeçalho de 0x40 do PS3');
 put(path.join(root, 'gamedata', 'trophies', 'NPWR00660.json'), JSON.stringify({trophies: [{id: 1, timestamp: 1761400000}, {id: 2, timestamp: 1761400500}]}));
 assert.equal(portProfile({path: exe})?.id, 'infamous-reborn');
 const game = {id: 'i', uuid: 'u-inf', title: 'inFAMOUS', path: exe, profile: 'pc'}, port = portOf(game);
 assert.ok(port?.dump, 'dump achado em gamedata/dev_bdvd');
 const r = readPortTrophies(game, port, {config: {language: 'pt-BR'}, dataDir: data, store: new PortTrophyStore(data)});
 assert.equal(r.trophySet, 'NPWR00660_00'); assert.equal(r.detail, 'full');
 assert.deepEqual(r.achievements.map(a => [a.id, a.title, a.grade, a.unlocked]), [['0', 'Platina', 'P', true], ['1', 'Herói', 'B', true], ['2', 'Ouro', 'G', true]]);
 assert.equal(r.achievements[2].hidden, true); assert.match(r.achievements[1].icon, /^\/art\//);
 assert.equal(r.achievements[1].date, 1761400000);
 assert.deepEqual(parsePs3recompTrophies('[{"id":3,"timestamp":1761400000}]').map(t => t.id), [3]);
 fs.rmSync(d, {recursive: true, force: true}); fs.rmSync(data, {recursive: true, force: true});
});

test('Fortnite/Epic pela Steam: link que o Windows não conhece vai para o iniciador da loja (e não abre uma pasta)', async () => {
 const url = 'com.epicgames.launcher://apps/fn%3A4fe75%3AFortnite?action=launch&silent=true', launch = {exe: 'C:\\Windows\\explorer.exe', args: '"' + url + '"'};
 const egl = 'C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe';
 const base = {platform: 'win32', env: {'ProgramFiles(x86)': 'C:\\Program Files (x86)'}, exists: f => f === egl};
 assert.equal(await storeLinkFallback(launch, {}, {...base, query: async () => true}), launch, 'link conhecido: sem mudança');
 const r = await storeLinkFallback({...launch}, {}, {...base, query: async () => false});
 assert.equal(r.exe, egl); assert.equal(r.args, '"' + url + '"');
 await assert.rejects(storeLinkFallback({...launch}, {store: {needsLauncher: true}, path: 'C:\\G\\F.exe'}, {...base, exists: () => false, query: async () => false}), /loja deste jogo não está instalada/);
 assert.equal(await storeLinkFallback(launch, {}, {platform: 'linux'}), launch);
});
