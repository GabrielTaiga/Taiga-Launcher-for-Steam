// TaigaSteam 1.4.2, página NativeGameLink no TaigaSteam, conquistas Epic/GOG, mais lojas, busca no PC inteiro,
// atalhos sem reiniciar a Steam, adoção de atalhos criados pela Steam e download de emuladores.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';
import {iso} from './fixtures.mjs';
import {StoreAchievements,epicGameInfo,parseEpicAccount,extractJSON,gogProductId} from '../lib/store-achievements.mjs';
import {packageFamilyName,scanXbox,scanRiot,scanHeroic,gameEvidence,scanInstalledGames} from '../lib/stores-more.mjs';
import {sweepGames,launchFor} from '../lib/games.mjs';
import {resolveDownload} from '../lib/emulator-download.mjs';
import {encodeVDF,uint} from '../lib/vdf.mjs';
const tmp=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'taiga-142-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;};
const write=(f,c)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,c);return f;};
const json=(data,status=200)=>({ok:status>=200&&status<300,status,headers:new Map(),text:async()=>typeof data==='string'?data:JSON.stringify(data),json:async()=>data});

test('Epic achievements: public list plus the player profile progress; private profile is reported',async t=>{
 const dir=tmp(t),calls=[];
 const fetchImpl=async(url,opt)=>{const body=JSON.parse(opt.body);calls.push(body.variables);if(/query Achievement/.test(body.query))return json({data:{Achievement:{productAchievementsRecordBySandbox:{productId:'prod1',sandboxId:body.variables.SandboxId,achievements:[{achievement:{name:'A1',hidden:false,unlockedDisplayName:'Primeira',unlockedDescription:'Fez',lockedDisplayName:'?',unlockedIconLink:'https://cdn1.epicgames.com/a1.png',lockedIconLink:'https://cdn1.epicgames.com/a1g.png',XP:10,rarity:{percent:42.5}}},{achievement:{name:'A2',hidden:true,unlockedDisplayName:'Segredo',unlockedDescription:'S',lockedDisplayName:'Oculta',lockedDescription:'???',XP:20,rarity:{percent:3}}}]}}}});
  if(body.variables.EpicAccountId==='private')return json({data:{PlayerProfile:{playerProfile:{productAchievements:null}}}});
  return json({data:{PlayerProfile:{playerProfile:{productAchievements:{data:{totalUnlocked:1,playerAchievements:[{playerAchievement:{achievementName:'A1',unlocked:true,unlockDate:'2026-10-01T10:00:00.000Z'}}]}}}}}});};
 const s=new StoreAchievements({dir,fetchImpl});
 const r=await s.epic({namespace:'ns1',accountId:'0123456789abcdef0123456789abcdef',language:'pt-BR'});
 assert.equal(r.status,'ok');assert.equal(r.progressKnown,true);assert.equal(r.achievements.length,2);
 assert.deepEqual(r.achievements.map(a=>[a.id,a.unlocked,a.title]),[['A1',true,'Primeira'],['A2',false,'Oculta']]);
 assert.equal(r.achievements[0].date,'2026-10-01T10:00:00.000Z');assert.equal(r.achievements[0].globalPercent,42.5);
 assert.equal(calls[0].Locale,'pt-BR');assert.equal(calls[1].Locale,'en-US');assert.equal(calls[2].ProductId,'prod1');
 // 1.4.7: a Epic devolveu o mesmo texto em inglês e em português: fica marcado para tradução.
 assert.equal(r.achievements[0].titleLanguage,'en');
 const p=await s.epic({namespace:'ns1',accountId:'private',language:'pt-BR'});assert.equal(p.status,'private');assert.equal(p.achievements.length,2);
 const none=await s.epic({namespace:'ns1',accountId:'',language:'pt-BR'});assert.equal(none.status,'unconfigured');
 assert.equal(parseEpicAccount('https://store.epicgames.com/u/0123456789ABCDEF0123456789ABCDEF'),'0123456789abcdef0123456789abcdef');assert.equal(parseEpicAccount('x'),'');
});

test('Epic game is found by the folder installed by the launcher; GOG by goggame info',t=>{
 const manifests=[{namespace:'fnafns',appName:'Pit',catalogItemId:'c1',root:'C:\\Epic\\FNAF Into the Pit'}];
 assert.deepEqual(epicGameInfo({path:'C:\\Epic\\FNAF Into the Pit\\Into the Pit.exe'},manifests),{namespace:'fnafns',appName:'Pit'});
 assert.equal(epicGameInfo({path:'C:\\Other\\game.exe'},manifests),null);
 assert.deepEqual(epicGameInfo({store:{name:'epic',namespace:'n2',appName:'X'}},[]),{namespace:'n2',appName:'X'});
 const d=tmp(t);write(path.join(d,'goggame-1207658924.info'),'{}');write(path.join(d,'game.exe'),'x');
 assert.equal(gogProductId({path:path.join(d,'game.exe')}),'1207658924');
 assert.equal(extractJSON('[{"a":"]"},{"b":[1,2]}];more'),'[{"a":"]"},{"b":[1,2]}]');
});

test('GOG achievements are read from the public profile page',async t=>{
 const dir=tmp(t);const fetchImpl=async url=>{if(/\/u\/taiga$/.test(url))return json('<script>window.profilesData.currentUser = {"userId":"48628349957132247"}</script>');return json('<script>window.profilesData.achievements = [{"achievement":{"id":"x1","name":"Herói","description":"Venceu","imageUrlUnlocked2":"https://images.gog-statics.com/u.png","imageUrlLocked2":"https://images.gog-statics.com/l.png","visible":true,"rarity":12.5},"stats":{"48628349957132247":{"isUnlocked":true,"unlockDate":1700000000}}}];\n</script>');};
 const r=await new StoreAchievements({dir,fetchImpl}).gog({productId:'1207658924',username:'taiga'});
 assert.equal(r.status,'ok');assert.equal(r.achievements[0].unlocked,true);assert.equal(r.achievements[0].title,'Herói');assert.equal(r.achievements[0].date,new Date(1700000000000).toISOString());
});

test('Xbox package family name, Riot and Heroic installs, installed games need engine evidence',async t=>{
 assert.equal(packageFamilyName('Microsoft.WindowsCalculator','CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US'),'Microsoft.WindowsCalculator_8wekyb3d8bbwe');
 const d=tmp(t),drive=path.join(d,'D');
 write(path.join(drive,'XboxGames','Halo MCC','Content','MicrosoftGame.config'),'<Game><Identity Name="Microsoft.Chelan" Publisher="CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US"/><ExecutableList><Executable Name="mcclauncher.exe" Id="Game"/></ExecutableList><ShellVisuals DefaultDisplayName="Halo: The Master Chief Collection"/></Game>');
 write(path.join(drive,'XboxGames','Halo MCC','Content','mcclauncher.exe'),'MZ');
 const x=scanXbox({drives:[drive]});assert.equal(x.length,1);assert.equal(x[0].title,'Halo: The Master Chief Collection');assert.equal(x[0].url,'shell:AppsFolder\\Microsoft.Chelan_8wekyb3d8bbwe!Game');
 const pd=path.join(d,'ProgramData'),val=path.join(d,'Riot Games','VALORANT','live');write(path.join(val,'VALORANT.exe'),'MZ'.padEnd(100,'x'));write(path.join(pd,'Riot Games','RiotClientInstalls.json'),JSON.stringify({rc_default:write(path.join(d,'Riot Client','RiotClientServices.exe'),'MZ')}));
 write(path.join(pd,'Riot Games','Metadata','valorant.live','valorant.live.product_settings.yaml'),'product_install_full_path: "'+val.replace(/\\/g,'/')+'"\n');
 const r=scanRiot({PROGRAMDATA:pd});assert.equal(r.length,1);assert.equal(r[0].title,'VALORANT');assert.equal(r[0].url,'--launch-product=valorant --launch-patchline=live');
 const g={profile:'store',path:r[0].path,launch:{exe:r[0].launcherExe,args:r[0].url}};assert.deepEqual(launchFor(g,{}),{exe:r[0].launcherExe,args:'--launch-product=valorant --launch-patchline=live'});
 assert.match(launchFor({profile:'store',launch:{exe:r[0].launcherExe,args:x[0].url}},{}).args,/^"shell:AppsFolder\\Microsoft\.Chelan_8wekyb3d8bbwe!Game"$/);
 const appdata=path.join(d,'AppData'),gameDir=path.join(d,'Heroic','Celeste');write(path.join(gameDir,'Celeste.exe'),'MZ');
 write(path.join(appdata,'heroic','legendaryConfig','legendary','installed.json'),JSON.stringify({Salt:{app_name:'Salt',title:'Celeste',install_path:gameDir,executable:'Celeste.exe'}}));
 const h=scanHeroic({APPDATA:appdata});assert.equal(h[0].url,'heroic://launch/legendary/Salt');
 const unity=path.join(d,'Programs','Cool Game');write(path.join(unity,'Cool Game.exe'),'MZ'.padEnd(500,'x'));write(path.join(unity,'UnityPlayer.dll'),'x');write(path.join(unity,'Cool Game_Data','globalgamemanagers'),'x');
 const app=path.join(d,'Programs','Editor');write(path.join(app,'editor.exe'),'MZ');
 assert.deepEqual(gameEvidence(unity),['unity']);assert.deepEqual(gameEvidence(app),[]);
 const reg=async()=>[{key:'HKLM\\...\\Uninstall\\Cool',values:{DisplayName:'Cool Game',InstallLocation:unity,DisplayIcon:path.join(unity,'Cool Game.exe'),Publisher:'Indie'}},{key:'HKLM\\...\\Uninstall\\Editor',values:{DisplayName:'Editor',InstallLocation:app,Publisher:'Someone'}}];
 const installed=await scanInstalledGames({regQuery:reg,includeLoose:true});assert.deepEqual((await scanInstalledGames({regQuery:reg})).filter(i=>i.store==='windows'),[],'1.6.0: sem loja, só pela Pasta de atalhos');assert.deepEqual(installed.map(i=>i.title),['Cool Game']);assert.equal(installed[0].store,'windows');
});

test('The PC sweep finds a PSP ISO anywhere and ignores an ISO that is not a game',t=>{
 const d=tmp(t);write(path.join(d,'Downloads','qualquer','Patapon.iso'),iso());write(path.join(d,'Downloads','windows11.iso'),Buffer.alloc(64*1024));write(path.join(d,'AppData','x.iso'),iso());
 const files=sweepGames([d]);assert.ok(files.some(f=>f.endsWith('Patapon.iso')));assert.ok(!files.some(f=>path.relative(d,f).split(path.sep).includes('AppData')));
});

test('Emulator download picks the official Windows zip of the latest release',async()=>{
 const fetchImpl=async url=>/duckstation/.test(url)?json({tag_name:'v0.1-9999',assets:[{name:'duckstation-windows-arm64-release.zip',browser_download_url:'https://github.com/x/arm.zip'},{name:'duckstation-windows-x64-release.zip',browser_download_url:'https://github.com/stenzek/duckstation/releases/download/latest/duckstation-windows-x64-release.zip',size:10}]}):json({tag_name:'v1.19.3',assets:[]});
 const d=await resolveDownload('ps1',{fetchImpl});assert.match(d.url,/duckstation-windows-x64-release\.zip$/);
 const p=await resolveDownload('psp',{fetchImpl});assert.equal(p.url,'https://www.ppsspp.org/files/1_19_3/ppsspp_win.zip');
 await assert.rejects(resolveDownload('ps3',{fetchImpl}),/não tem pacote para Windows/);await assert.rejects(resolveDownload('dolphin',{fetchImpl}),/download automático/);
});

test('Live add script creates the shortcut, sets every field, artwork and the SteamTaiga collection',async()=>{
 const calls=[],apps=new Map(),added=[];let saved=0;
 const SteamClient={Apps:{AddShortcut:async(name,exe,dir,opts)=>{calls.push(['add',name,exe,dir,opts]);apps.set(2915423700,{appid:2915423700});return 2915423700;},SetShortcutName:(...a)=>calls.push(['name',...a]),SetShortcutExe:(...a)=>calls.push(['exe',...a]),SetShortcutStartDir:(...a)=>calls.push(['dir',...a]),SetShortcutLaunchOptions:(...a)=>calls.push(['opts',...a]),SetShortcutIcon:(...a)=>calls.push(['icon',...a]),SetCustomArtworkForApp:async(...a)=>calls.push(['art',a[0],a[2],a[3]]),RemoveShortcut:id=>{calls.push(['remove',id]);apps.delete(id);}}};
 const collection={displayName:'SteamTaiga',AsDragDropCollection:()=>({AddApps:list=>added.push(...list),RemoveApps:()=>{}}),Save:async()=>{saved++;}};
 const ctx=vm.createContext({window:{SteamClient,appStore:{GetAppOverviewByAppID:id=>apps.get(id)||null},collectionStore:{userCollections:[collection]}},setTimeout,Promise,JSON,String,Number,Array});
 const fn=vm.runInContext(fs.readFileSync(new URL('../steam/live-sync.js',import.meta.url),'utf8'),ctx);
 const r=JSON.parse(await fn({appid:0,name:'God of War',exe:'"C:\\TaigaSteam\\TaigaPSP.exe"',startDir:'"C:\\TaigaSteam"',options:'--taiga-launch x',icon:'C:\\grid\\i.ico',art:[{type:0,ext:'png',b64:'AA=='},{type:1,ext:'jpg',b64:'AA=='}]},'SteamTaiga'));
 assert.equal(r.ok,true);assert.equal(r.appid,2915423700);assert.equal(r.created,true);
 assert.deepEqual(calls.map(c=>c[0]),['add','name','exe','dir','opts','icon','art','art']);assert.equal(added.length,1);assert.ok(saved>=1);
 const again=JSON.parse(await fn({appid:2915423700,name:'God of War',exe:'"x"',startDir:'"y"',options:'',art:[]},''));assert.equal(again.created,false);
 const gone=JSON.parse(await fn({appid:2915423700,remove:true},'SteamTaiga'));assert.equal(gone.removed,true);assert.ok(calls.some(c=>c[0]==='remove'));
});

test('Old SFP page script is retired on start; emulator games get Steam-style features; Steam shortcuts of emulators are adopted',async t=>{
 const {createApp}=await import('../server.mjs');
 const d=tmp(t),data=path.join(d,'data'),steam=path.join(d,'Steam'),acct='12345',roms=path.join(d,'roms');fs.mkdirSync(path.join(steam,'steamui'),{recursive:true});write(path.join(steam,'steam.exe'),'');
 write(path.join(steam,'steamui','libraryroot.custom.js.backup-1'),'// meu script');write(path.join(steam,'steamui','libraryroot.custom.js'),'/* Taiga Steam PSP 1.2.1 */');
 const ppsspp=write(path.join(d,'PPSSPP','PPSSPPWindows64.exe'),'MZ'),game=write(path.join(roms,'Patapon.iso'),iso()),sid=3123456789;
 write(path.join(steam,'userdata',acct,'config','shortcuts.vdf'),encodeVDF([{type:0,key:'shortcuts',value:[{type:0,key:'0',value:[{type:2,key:'appid',value:uint(sid)},{type:1,key:'AppName',value:'Patapon'},{type:1,key:'Exe',value:'"'+ppsspp+'"'},{type:1,key:'StartDir',value:'"'+path.dirname(ppsspp)+'"'},{type:1,key:'LaunchOptions',value:'"'+game+'"'}]}]}]));
 write(path.join(data,'config.json'),JSON.stringify({steamDir:steam,account:acct,language:'pt-BR',languageChosen:true,roots:[]}));
 write(path.join(data,'games.json'),JSON.stringify({version:1,games:[{id:'gow',uuid:'22222222-2222-4222-8222-222222222222',title:'God of War',profile:'ps2',path:path.join(roms,'gow.iso'),platformName:'PlayStation 2',bindings:{[acct]:3000000001},art:{},metadata:{summary:'Kratos.',developer:'Santa Monica Studio',publisher:'Sony',series:'God of War',release:'2005-03-22'}}]}));
 const port=41000+Math.floor(Math.random()*8000),app=createApp({dataDir:data,port});t.after(()=>new Promise(r=>app.server.close(r)));
 assert.equal(fs.readFileSync(path.join(steam,'steamui','libraryroot.custom.js'),'utf8'),'// meu script');
 const maps=JSON.parse(await app.nglBackend.call('get_all_mappings',{})),vid=maps['shortcut:3000000001'];assert.ok(Number(vid)>=1900000000);
 const gd=JSON.parse(await app.nglBackend.call('fetch_game_data',{steam_app_id:vid,language:'brazilian'}));
 assert.deepEqual(gd.categories.map(c=>c.id),[2,22,9901,28]);assert.deepEqual(gd.categories.map(c=>c.description),['Um jogador','Conquistas','Salvamento local','Compatibilidade total com controle']);
 assert.deepEqual(gd.franchises,['God of War']);assert.equal(gd.controller_support,'full');assert.deepEqual(gd.developers,['Santa Monica Studio']);
 const assets=JSON.parse(await app.nglBackend.call('fetch_library_assets',{request_json:JSON.stringify({steam_app_id:vid,language:'brazilian'})}));assert.equal(assets.franchise,'God of War');assert.deepEqual(assets.category_ids,[2,22,9901,28]);
 const det=JSON.parse(await app.nglBackend.call('detect_game_candidates',{request_json:JSON.stringify({shortcut_app_id:String(sid),title:'Patapon'})}));
 assert.equal(det.candidates[0].confidence,'exact');assert.ok(Number(det.candidates[0].appid)>=1900000000);
 const db=JSON.parse(fs.readFileSync(path.join(data,'games.json'),'utf8'));const adopted=db.games.find(g=>g.path===game);assert.ok(adopted);assert.equal(adopted.bindings[acct],sid);assert.equal(adopted.profile,'psp');
});
