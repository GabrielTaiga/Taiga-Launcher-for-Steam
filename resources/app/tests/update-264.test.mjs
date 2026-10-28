import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {retroArchCores, retroArchCoreFor, platformsForDatabase, parseRetroArchCfg, clearRetroArchCache} from '../lib/retroarch.mjs';
import {preferredProfile, discoverEmulators, defaultDiscoveryRoots, applyDiscovery} from '../lib/emulator-registry.mjs';
import {inspectGame, zipPlatform, nintendoDiscHeader, chdPlatform} from '../lib/games.mjs';
import {AchievementProviderManager} from '../lib/achievement-manager.mjs';

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const touch = (f, data = 'x') => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, data); };

test('RetroArch: núcleos instalados pelo .info (inclusive desconhecidos), pasta do retroarch.cfg e a ordem preferida', () => {
 clearRetroArchCache();
 const d = tmp('ra-'), exe = path.join(d, 'retroarch.exe');
 touch(exe);
 touch(path.join(d, 'retroarch.cfg'), 'libretro_directory = ":\\meus_cores"\nlibretro_info_path = ":\\info"\nsystem_directory = ":\\system"\n');
 for (const c of ['snes9x', 'bsnes', 'genesis_plus_gx', 'mupen64plus_next', 'nucleo_novo']) touch(path.join(d, 'meus_cores', c + '_libretro.dll'));
 touch(path.join(d, 'info', 'nucleo_novo_libretro.info'), 'display_name = "Novo"\ndatabase = "NEC - PC Engine - TurboGrafx 16|NEC - PC Engine SuperGrafx"\n');
 touch(path.join(d, 'info', 'genesis_plus_gx_libretro.info'), 'database = "Sega - Mega Drive - Genesis|Sega - Master System - Mark III|Sega - Game Gear|Sega - Mega-CD - Sega CD"\n');
 const r = retroArchCores(exe, {env: {}});
 assert.equal(r.cores.length, 5);
 assert.match(retroArchCoreFor('Super Nintendo Entertainment System', exe, {env: {}}), /snes9x_libretro\.dll$/);
 assert.match(retroArchCoreFor('TurboGrafx-16/PC Engine', exe, {env: {}}), /nucleo_novo/);
 assert.match(retroArchCoreFor('Sega CD', exe, {env: {}}), /genesis_plus_gx/);
 assert.match(retroArchCoreFor('Nintendo 64', exe, {env: {}}), /mupen64plus_next/);
 assert.equal(retroArchCoreFor('PlayStation', exe, {env: {}}), '');
 assert.deepEqual(platformsForDatabase('FBNeo - Arcade Games|Sega - Dreamcast'), ['Arcade', 'Dreamcast']);
 assert.equal(parseRetroArchCfg('a = "1"\nb=2').b, '2');
 fs.rmSync(d, {recursive: true, force: true});
});

test('RetroArch como emulador: escolhido quando o emulador próprio falta; com a preferência, sempre nas retrô', () => {
 clearRetroArchCache();
 const d = tmp('ra2-'), exe = path.join(d, 'retroarch.exe'), mesen = path.join(d, 'Mesen.exe');
 touch(exe); touch(mesen); touch(path.join(d, 'cores', 'snes9x_libretro.dll')); touch(path.join(d, 'cores', 'pcsx2_libretro.dll'));
 const snes = {profile: 'mesen', platformName: 'Super Nintendo Entertainment System'};
 assert.equal(preferredProfile(snes, {launchers: {retroarch: {exe}}}, ['mesen', 'retroarch']), 'retroarch');
 assert.equal(preferredProfile(snes, {launchers: {retroarch: {exe}, mesen: {exe: mesen}}}, ['mesen', 'retroarch']), 'mesen');
 assert.equal(preferredProfile(snes, {launchers: {retroarch: {exe}, mesen: {exe: mesen}}, preferences: {retroarchFirst: true}}, ['mesen', 'retroarch']), 'retroarch');
 // PS2 é "moderna": a preferência não troca o emulador próprio pelo núcleo.
 const ps2 = {profile: 'ps2', platformName: 'PlayStation 2'};
 assert.equal(preferredProfile(ps2, {launchers: {retroarch: {exe}, ps2: {exe: mesen}}, preferences: {retroarchFirst: true}}, ['ps2', 'retroarch']), 'ps2');
 fs.rmSync(d, {recursive: true, force: true});
});

test('Busca de emuladores: RetroArch da Steam em outra biblioteca, raiz grande não esconde os outros, removido não volta sozinho', () => {
 const d = tmp('steam-'), lib = path.join(d, 'Biblioteca');
 touch(path.join(d, 'steamapps', 'libraryfolders.vdf'), '"libraryfolders"{"0"{"path" "' + lib.replace(/\\/g, '\\\\') + '"}}');
 touch(path.join(lib, 'steamapps', 'common', 'RetroArch', 'retroarch.exe'));
 const big = path.join(d, 'Grande');
 for (let i = 0; i < 40; i++) touch(path.join(big, 'pasta' + i, 'arquivo.txt'));
 touch(path.join(big, 'Dolphin', 'Dolphin.exe'));
 const roots = defaultDiscoveryRoots({steamDir: d}, {env: {}, home: '', appRoot: d});
 assert.match(roots[0], /RetroArch$/);
 const r = discoverEmulators([...roots, big], {perRoot: 20});
 assert.ok(r.profiles.retroarch.selected);
 assert.ok(r.profiles.dolphin.selected, 'arquivos da pasta são vistos antes de descer nas subpastas');
 const config = {launchers: {}, emulatorIgnore: ['dolphin']};
 applyDiscovery(config, r);
 assert.ok(config.launchers.retroarch && !config.launchers.dolphin);
 applyDiscovery(config, r, {force: true});
 assert.ok(config.launchers.dolphin);
 fs.rmSync(d, {recursive: true, force: true});
});

test('ROM em ZIP fora de pasta da plataforma e cabeçalhos de Wii/GameCube em RVZ, WBFS e CISO', () => {
 const d = tmp('rom-');
 // ZIP armazenado (sem compressão) com um .sfc dentro.
 const name = Buffer.from('Jogo (USA).sfc'), data = Buffer.alloc(1024, 1);
 const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
 const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
 const cdOffset = 30 + name.length + data.length, end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(cdOffset, 16);
 const zip = path.join(d, 'misturado', 'Jogo (USA).zip');
 touch(zip, Buffer.concat([local, name, data, central, name, end]));
 assert.equal(zipPlatform(zip)?.key, 'snes');
 assert.equal(inspectGame(zip).platformKey, 'snes');
 const disc = Buffer.alloc(0x80); disc.write('GALE01', 0, 'ascii'); disc.writeUInt32BE(0xc2339f3d, 0x1c); disc.write('SUPER SMASH BROS Melee', 0x20);
 const ciso = path.join(d, 'm.ciso'); touch(ciso, Buffer.concat([Buffer.from('CISO'), Buffer.alloc(0x8000 - 4), disc]));
 assert.deepEqual({...nintendoDiscHeader(ciso, 'ciso'), revision: 0}, {id: 'GALE01', title: 'SUPER SMASH BROS Melee', wii: false, revision: 0});
 const wii = Buffer.from(disc); wii.writeUInt32BE(0, 0x1c); wii.writeUInt32BE(0x5d1c9ea3, 0x18); wii.write('SMNE01', 0, 'ascii');
 const rvz = path.join(d, 'n.rvz'); touch(rvz, Buffer.concat([Buffer.from('RVZ\x01', 'latin1'), Buffer.alloc(0x54), wii]));
 const g = inspectGame(rvz); assert.equal(g.platformKey, 'wii'); assert.equal(g.discId, 'SMNE01'); assert.equal(g.profile, 'dolphin');
 const wbfs = path.join(d, 'o.wbfs'); touch(wbfs, Buffer.concat([Buffer.from('WBFS'), Buffer.alloc(4), Buffer.from([9]), Buffer.alloc(512 - 9), wii]));
 assert.equal(nintendoDiscHeader(wbfs, 'wbfs').wii, true);
 // CHD de GD-ROM: Dreamcast mesmo fora de uma pasta "Dreamcast".
 const h = Buffer.alloc(124); h.write('MComprHD', 0, 'latin1'); h.writeUInt32BE(124, 8); h.writeUInt32BE(5, 12); h.writeBigUInt64BE(200n, 0x30);
 const meta = Buffer.alloc(16); meta.write('CHGD', 0, 'latin1');
 const chd = path.join(d, 'jogos', 'Sonic Adventure.chd'); touch(chd, Buffer.concat([h, Buffer.alloc(76), meta, Buffer.alloc(32)]));
 assert.equal(chdPlatform(chd), 'dreamcast'); assert.equal(inspectGame(chd).profile, 'flycast');
 fs.rmSync(d, {recursive: true, force: true});
});

test('RetroAchievements: jogo de emulador sem hash é achado pelo nome, inclusive hacks; o nome do jogo vale antes do nome do disco', async () => {
 const dir = tmp('ra-name-');
 const retro = {gamesList: async id => id === 19 ? {34904: '~Hack~ Newer Super Mario Bros. Wii', 1234: 'New Super Mario Bros. Wii', 77: 'New Super Mario Bros. Wii [Subset - Bonus]'} : {}, credentials: () => null};
 const m = new AchievementProviderManager({config: () => ({}), dir, providers: {retro, achievements: async g => ({status: 'ok', achievements: [{id: 1}], total: 1, unlocked: 0, raId: g.raId})}, account: () => null});
 const newer = {id: 'n', title: 'Newer Super Mario Bros. Wii', internalTitle: 'NEW SUPER MARIO BROS. Wii', profile: 'dolphin', platformKey: 'wii', platformName: 'Wii', path: path.join(dir, 'n.wbfs')};
 const r = await m.read(newer);
 assert.equal(newer.raId, 34904); assert.equal(r.provider, 'retroachievements');
 const original = {id: 'o', title: 'New Super Mario Bros. Wii', profile: 'dolphin', platformKey: 'wii', platformName: 'Wii', path: path.join(dir, 'o.wbfs')};
 await m.read(original);
 assert.equal(original.raId, 1234);
 fs.rmSync(dir, {recursive: true, force: true});
});

test('RetroAchievements: lista do console indisponível tenta de novo em 10 min; lista carregada sem o jogo espera 6 h', async () => {
 let online = false, calls = 0;
 const retro = {gamesList: async () => { calls++; if (!online) throw Error('offline'); return {34904: '~Hack~ Newer Super Mario Bros. Wii'}; }};
 const m = new AchievementProviderManager({config: () => ({}), dir: os.tmpdir(), providers: {retro}, account: () => null});
 const game = {id: 'n', title: 'Newer Super Mario Bros. Wii', profile: 'dolphin', platformKey: 'wii', platformName: 'Wii'};
 assert.equal(await m.resolveRaId(game), null); assert.equal(game.raLookupFailed, true);
 assert.equal(await m.resolveRaId(game), null); assert.equal(calls, 1, 'logo depois da falha não pede de novo');
 game.raLookupAt -= 11 * 60000; online = true;
 assert.equal(await m.resolveRaId(game), 34904); assert.equal(game.raLookupFailed, undefined);
 const other = {id: 'x', title: 'Jogo Sem Conquistas', profile: 'dolphin', platformKey: 'wii', platformName: 'Wii'};
 assert.equal(await m.resolveRaId(other), null); other.raLookupAt -= 11 * 60000; calls = 0;
 assert.equal(await m.resolveRaId(other), null); assert.equal(calls, 0, 'lista carregada e jogo ausente: espera as 6 h');
});
