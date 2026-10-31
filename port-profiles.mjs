// Ports e recompilações de jogos de console que o Taiga Launcher reconhece pelo próprio programa (nome do .exe, pasta e
// arquivos ao lado). Cada um diz qual é o jogo original, de qual console, e de onde vêm as conquistas:
//  - ra: lista do RetroAchievements do jogo original (nomes, imagens e o seu progresso na conta). Os ports não rodam o
//    RetroAchievements, então os desbloqueios que aparecem são os feitos em emulador com a mesma conta.
//  - trophies: troféus do console lidos do dump do jogo, com os desbloqueios gravados pelo próprio port
//    (trophies.dat, trophies.log, gamedata/trophies/*.json, progress_user*.txt ou a saída do jogo).
//  - none: o port não tem código de troféus (só o nome e a capa do jogo original).
// Não existe um padrão comum entre ports: cada projeto é reconhecido por um perfil próprio aqui.
import fs from 'node:fs';
import path from 'node:path';

const list = d => { try { return fs.readdirSync(d); } catch { return []; } };
const has = (dir, re) => list(dir).some(n => re.test(n));

export const PORT_PROFILES = [
 {id: 'tenkaichi3decomp', name: 'Tenkaichi3Decomp', title: 'Dragon Ball Z: Budokai Tenkaichi 3', platform: 'ps2', serial: 'SLUS-21678', achievements: 'ra', url: 'https://github.com/z3xox/Tenkaichi3Decomp',
  match: ({exe, dir, parent}) => /tenkaichi\s*3|^bt3(?:[-_.].*)?\.exe$/i.test(exe) || /tenkaichi\s*3\s*decomp|tenkaichi3decomp/i.test(dir + ' ' + parent) || (has(dir, /^bt3\.exe(\.map)?$/i))},
 {id: 'zelda64recomp', name: 'Zelda64Recomp', title: "The Legend of Zelda: Majora's Mask", platform: 'n64', achievements: 'ra', url: 'https://github.com/Zelda64Recomp/Zelda64Recomp',
  match: ({exe, dir}) => /^zelda64recomp(?:iled)?\.exe$/i.test(exe) || /zelda64recomp/i.test(dir)},
 {id: 'shipwright', name: 'Ship of Harkinian', title: 'The Legend of Zelda: Ocarina of Time', platform: 'n64', achievements: 'ra', url: 'https://github.com/HarbourMasters/Shipwright',
  match: ({exe, dir}) => /^soh(?:\.exe)?$/i.test(exe) || /^soh\.exe$/i.test(exe) || (/\.exe$/i.test(exe) && has(dir, /^oot(?:-mq)?\.o2r$|^soh\.o2r$/i))},
 {id: 'sm64ex', name: 'sm64ex', title: 'Super Mario 64', platform: 'n64', achievements: 'ra', url: 'https://github.com/sm64pc/sm64ex',
  match: ({exe}) => /^sm64(?:ex)?(?:\.[a-z0-9_]+)*\.exe$/i.test(exe)},
 {id: 'opengoal-jak1', name: 'OpenGOAL', title: 'Jak and Daxter: The Precursor Legacy', platform: 'ps2', achievements: 'ra', url: 'https://github.com/open-goal/jak-project',
  match: ({exe, dir, parent}) => /^gk\.exe$/i.test(exe) && /jak\s*1\b|jak1|precursor/i.test(dir + ' ' + parent)},
 {id: 'opengoal-jak2', name: 'OpenGOAL', title: 'Jak II', platform: 'ps2', achievements: 'ra', url: 'https://github.com/open-goal/jak-project',
  match: ({exe, dir, parent}) => /^gk\.exe$/i.test(exe) && /jak\s*2\b|jak2|jak ii\b/i.test(dir + ' ' + parent)},
 {id: 'opengoal-jak3', name: 'OpenGOAL', title: 'Jak 3', platform: 'ps2', achievements: 'ra', url: 'https://github.com/open-goal/jak-project',
  match: ({exe, dir, parent}) => /^gk\.exe$/i.test(exe) && /jak\s*3\b|jak3/i.test(dir + ' ' + parent)},
 {id: 'spartanport', name: 'SpartanPort', title: 'God of War III Remastered', platform: 'ps4', serial: 'CUSA01623', achievements: 'trophies', url: 'https://github.com/FelipePrado0/SpartanPort',
  match: ({exe}) => /^spartan(?:port)?(?:[-_](?:launcher|game))?\.exe$/i.test(exe)},
 {id: 'gow2-recomp', name: 'gow2-recomp', title: 'God of War II HD', platform: 'ps3', serial: 'NPUA80491', achievements: 'none', url: 'https://github.com/andrebrumdev/gow2-recomp',
  match: ({exe, dir, parent}) => /^gow2[-_]?(?:recomp|pc)?\.exe$/i.test(exe) || (/\.exe$/i.test(exe) && /gow2[-_ ]?recomp/i.test(dir + ' ' + parent))},
 // God of War (PS2) pelo PS2Recomp: o programa se chama ps2EntryRunner.exe, então vale pela pasta ou pela ISO ao lado.
 {id: 'gow1-recomp', name: 'god-of-war-recomp', title: 'God of War', platform: 'ps2', serial: 'SCUS-97399', achievements: 'ra', url: 'https://github.com/KIexster/god-of-war-recomp',
  match: ({exe, dir, parent}) => /^(?:ps2EntryRunner|gow(?:1)?[-_]?recomp)\.exe$/i.test(exe) && (/god[-_ ]?of[-_ ]?war(?![-_ ]?(?:ii|2|3|iii))|gow[-_ ]?(?:1[-_ ]?)?recomp/i.test(dir + ' ' + parent) || has(dir, /^god of war\.iso$/i) || has(parent, /^god of war\.iso$/i))},
 {id: 'gow-ascension', name: 'God of War: Ascension PC', title: 'God of War: Ascension', platform: 'ps3', achievements: 'none', url: 'https://github.com/arnaldolima1/gow-ascension-pc',
  match: ({exe, dir, parent}) => /^ascension(?:launcher)?\.exe$/i.test(exe) || (/\.exe$/i.test(exe) && /gow[-_ ]?(?:a|ascension)[-_ ]?(?:pc|windows)/i.test(dir + ' ' + parent))},
 {id: 'yakuza-dead-souls', name: 'Yakuza Dead Souls Recompiled', title: 'Yakuza: Dead Souls', platform: 'ps3', achievements: 'trophies', url: 'https://github.com/canersaka/Yakuza-Dead-Souls-Recompiled',
  match: ({exe}) => /^yakuza[-_]?(?:recomp|dead[-_]?souls)\.exe$/i.test(exe)},
 {id: 'infamous-reborn', name: 'inFAMOUSreborn', title: 'inFAMOUS', platform: 'ps3', achievements: 'trophies', url: 'https://github.com/whompay/inFAMOUSreborn',
  match: ({exe, dir, parent}) => /^infamous(?:[-_ ]?(?:reborn|recomp(?:iled)?))?\.exe$/i.test(exe) || (/\.exe$/i.test(exe) && /infamous[-_ ]?(?:reborn|recomp)/i.test(dir + ' ' + parent))},
 {id: 'demons-souls-recomp', name: 'DemonsSoulsRecomp', title: "Demon's Souls", platform: 'ps3', serial: 'BLUS30443', achievements: 'trophies', url: 'https://github.com/JonathanDC64/DemonsSoulsRecomp',
  match: ({exe}) => /^des_boot\.exe$/i.test(exe)},
 {id: 'dragons-crown-pro', name: "Dragon's Crown Pro PC", title: "Dragon's Crown Pro", platform: 'ps4', achievements: 'trophies', url: 'https://github.com/saulob/dragons-crown-pro-pc',
  match: ({exe}) => /^dragons?[-_]?crown[-_]?pro(?:[-_]pc)?\.exe$/i.test(exe)},
 {id: 'gravity-rush-2', name: 'gr2_pc', title: 'Gravity Rush 2', platform: 'ps4', achievements: 'trophies', url: 'https://github.com/HayatoG/gr2_pc',
  match: ({exe, dir, parent}) => /^(?:gr2|tlg)[-_]?(?:pc|play)?\.exe$/i.test(exe) || (/\.exe$/i.test(exe) && /gr2[-_]pc|gravity[-_ ]?rush[-_ ]?2/i.test(dir + ' ' + parent))},
 {id: 'unicorn-overlord', name: 'Unicorn Overlord PC', title: 'Unicorn Overlord', platform: 'ps4', achievements: 'trophies', url: 'https://github.com/hachi23/unicorn_overlord_pc',
  match: ({exe, dir, parent}) => /^vwport\.exe$/i.test(exe) || (/^overlord\.exe$/i.test(exe) && /unicorn/i.test(dir + ' ' + parent))},
 {id: 'medievil-2019', name: 'MediEvil PC', title: 'MediEvil', platform: 'ps4', achievements: 'trophies', url: 'https://github.com/bc160201983/medievil_2019_pc_port',
  match: ({exe, dir, parent}) => /^medievil[-_]play\.exe$/i.test(exe) || (/^medievil\.exe$/i.test(exe) && /medievil[-_ ]?(?:2019|pc|port)/i.test(dir + ' ' + parent))},
 {id: 'drakengard3', name: 'dod3-recomp', title: 'Drakengard 3', platform: 'ps3', achievements: 'none', url: 'https://github.com/soyjxck/dod3-recomp',
  match: ({exe}) => /^dod3\.exe$/i.test(exe)},
 {id: 'soulcalibur2hd', name: 'Soulcalibur2HD-recomp', title: 'Soulcalibur II HD Online', platform: 'ps3', achievements: 'none', url: 'https://github.com/n0madic/Soulcalibur2HD-recomp',
  match: ({exe}) => /^sc2hd(?:_monolith)?\.exe$/i.test(exe)},
 {id: 'armored-core-4', name: 'AC4-Port', title: 'Armored Core 4', platform: 'ps3', achievements: 'none', url: 'https://github.com/SulphurS16/AC4-Port',
  match: ({exe}) => /^ac4(?:-launcher)?\.exe$/i.test(exe)},
 {id: 'armored-core-fa', name: 'ACFA-Port', title: 'Armored Core: For Answer', platform: 'ps3', achievements: 'none', url: 'https://github.com/SulphurS16/ACFA-Port',
  match: ({exe}) => /^acfa(?:-launcher)?\.exe$/i.test(exe)},
 // Uncharted: The Nathan Drake Collection (Supermedo/uncharted_pc): três jogos no mesmo programa. O launcher do port já
 // decifra a lista de cada jogo em out/<jogo>/trophy/trophies.txt e grava os desbloqueios em <user>/trophy/<NPWR>.log.
 {id: 'uncharted-collection', name: 'uncharted_pc', title: 'Uncharted: The Nathan Drake Collection', platform: 'ps4', serial: 'CUSA02320', achievements: 'trophies', url: 'https://github.com/Supermedo/uncharted_pc',
  configs: ['uncharted-launcher/settings.json'],
  match: ({exe, dir, parent}) => /^(?:play[ _-]?)?uncharted(?:[-_ ]?launcher)?\.exe$/i.test(exe) || (/^bb-probe\.exe$/i.test(exe) && /uncharted/i.test(dir + ' ' + parent))},
 // Bloodborne PC (Jgamrot/bloodborne_pc e o pacote para Windows): Bloodborne.exe abre o launcher, "Play Bloodborne.exe"
 // abre o jogo direto e bin\bb-probe.exe é o jogo. Troféus em <user>/trophies.txt; configurações em %APPDATA%\bbport-launcher.
 {id: 'bloodborne-port', name: 'Bloodborne PC', title: 'Bloodborne', platform: 'ps4', serial: 'CUSA03173', achievements: 'trophies', url: 'https://github.com/Jgamrot/bloodborne_pc',
  configs: ['bbport-launcher/settings.json', 'bbport-launcher-coop/settings.json'],
  match: ({exe, dir, parent}) => /^(?:play[ _-]?)?bloodborne(?:launcher)?\.exe$|^bbport(?:[-_.].*)?\.exe$/i.test(exe) || ((/^(?:bb-)?probe\.exe$/i.test(exe) || /\.exe$/i.test(exe)) && (has(dir, /^bbport\.ini$/i) || has(parent, /^bbport\.ini$/i)))},
 // inFAMOUS Second Son (HayatoG/iss_pc): troféus em <user>/trophies/CUSA00223/earned.json (ou um arquivo por save em
 // save-versions/ com ISS_TROPHIES_PER_SAVE=1); a pasta do usuário pode estar em %APPDATA%\inFAMOUS-PC\launcher.json.
 {id: 'infamous-second-son', name: 'iss_pc', title: 'inFAMOUS Second Son', platform: 'ps4', serial: 'CUSA00223', achievements: 'trophies', url: 'https://github.com/HayatoG/iss_pc',
  configs: ['inFAMOUS-PC/launcher.json'],
  match: ({exe, dir, parent}) => /^(?:play[ _-]?)?infamous[-_ ]?second[-_ ]?son\.exe$/i.test(exe) || (/\.exe$/i.test(exe) && /(^|[\\/])iss[-_]pc([\\/]|$)/i.test(dir + '/' + parent + '/'))},
 // Skate 3 (Xbox 360) recompilado: sem código de conquistas.
 {id: 'skate3-recomp', name: 'skate3recomp', title: 'Skate 3', platform: 'xbox360', achievements: 'none', url: 'https://github.com/mchughalex/skate3recomp',
  match: ({exe}) => /^skate3(?:recomp)?\.exe$/i.test(exe)},
 // Mario Kart Wii (patchzyy/Wiicompiled): conquistas do RetroAchievements do jogo original.
 {id: 'mkwii-compiled', name: 'WiiCompiled', title: 'Mario Kart Wii', platform: 'wii', achievements: 'ra', url: 'https://github.com/patchzyy/Wiicompiled',
  match: ({exe}) => /^(?:mario[-_ ]?kart[-_ ]?)?wii[-_ ]?compiled\.exe$|^retro[-_ ]?rewind\.exe$/i.test(exe)},
];

// Perfil do port de um jogo (pelo .exe), ou null.
export function portProfile(game) {
 const file = String(game?.path || '');
 if (!/\.exe$/i.test(file)) return null;
 // exe: nome do arquivo; dir e parent: caminhos completos da pasta do .exe e da pasta acima dela.
 const exe = path.basename(file), dir = path.dirname(file), parent = path.dirname(dir);
 for (const p of PORT_PROFILES) { try { if (p.match({exe, dir, parent})) return p; } catch {} }
 return null;
}

// Port ao lado de uma imagem de disco (ex.: Tenkaichi3Decomp guarda a ISO ou os dados do jogo junto do programa):
// procura na pasta do arquivo e nas duas acima um .exe de port do mesmo console (e do mesmo jogo, quando o perfil
// diz o código). Assim o jogo entra como o port, e não como um jogo de emulador.
const serialKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function nearPortExe(file, {platform = '', serial = ''} = {}) {
 let dir = path.dirname(String(file || ''));
 for (let i = 0; i < 3 && dir && dir !== path.dirname(dir); i++, dir = path.dirname(dir)) {
  for (const name of list(dir)) {
   if (!/\.exe$/i.test(name) || /setup|unins|crash|redist|vc_?redist|launcher/i.test(name)) continue;
   const parent = path.dirname(dir);
   for (const p of PORT_PROFILES) {
    let ok = false; try { ok = p.match({exe: name, dir, parent}); } catch {}
    if (!ok || (platform && p.platform && p.platform !== platform)) continue;
    if (p.serial && serial && serialKey(p.serial) !== serialKey(serial)) continue;
    return {exe: path.join(dir, name), profile: p};
   }
  }
 }
 return null;
}

// Arquivos de configuração do port fora da pasta dele (%APPDATA%\<launcher>\settings.json), pelo perfil.
export function portConfigFiles(exe, env = process.env) {
 const prof = portProfile({path: exe}), base = env?.APPDATA; if (!prof?.configs || !base) return [];
 return prof.configs.map(c => path.join(base, ...c.split('/')));
}

// Arquivos onde ports gravam os troféus desbloqueados, perto do .exe (bloodborne_pc: <user>/trophies.log).
export function portTrophyLogs(exe) {
 const dir = path.dirname(exe), out = [];
 for (const d of [dir, path.join(dir, 'user'), path.join(dir, 'data', 'user'), path.join(path.dirname(dir), 'user'), path.join(path.dirname(dir), 'data', 'user')]) {
  const f = path.join(d, 'trophies.log'); try { if (fs.statSync(f).isFile()) out.push(f); } catch {}
 }
 return out;
}
