import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {isRAWarning} from '../lib/retroachievements.mjs';
import {readProgress,emulatorSaveDirs} from '../lib/local-achievements.mjs';
import {appIdFromIni,steamAppIdEvidence,steamAppByName} from '../lib/identify.mjs';
import {nativeUserProgress} from '../lib/steam-achievement-schema.mjs';
import {encodeVDF,uint} from '../lib/vdf.mjs';
import {parseNews,parseCommunity,safeImage} from '../lib/steam-community.mjs';
import {targetKind,SteamInjector} from '../lib/steam-inject.mjs';
import {parseRALines,RALogWatcher} from '../lib/ra-log.mjs';
import {externalPreview} from '../lib/external.mjs';
import {discoverGameFolders,emulatorGameFolders,collapseFolders,iniSections} from '../lib/discover.mjs';
const tmp=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'taiga-141-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('RetroAchievements "Unknown Emulator" pseudo-achievement is filtered',()=>{
 assert.equal(isRAWarning(101000001,'Warning: Unknown Emulator'),true);
 assert.equal(isRAWarning(5,'Aviso: emulador desconhecido'),true);
 assert.equal(isRAWarning(12345,'Defeat the boss'),false);
});

test('Steam emulator INI/CFG progress formats are read (CODEX, OnlineFix, CreamAPI)',t=>{
 const d=tmp(t);
 fs.writeFileSync(path.join(d,'achievements.ini'),'[SteamAchievements]\nCount=2\n[ACH_ONE]\nAchieved=1\nUnlockTime=1700000000\n[ACH_TWO]\nAchieved=0\n');
 let p=readProgress(path.join(d,'achievements.ini'));
 assert.equal(p.ACH_ONE.earned,1);assert.equal(p.ACH_ONE.earned_time,1700000000);assert.equal(p.ACH_TWO.earned,0);assert.equal(p.SteamAchievements,undefined);
 fs.writeFileSync(path.join(d,'Achievements.ini'.replace('.ini','2.ini')),'[WIN]\nachieved=true\ntimestamp=1690000000\n');
 p=readProgress(path.join(d,'Achievements2.ini'));assert.equal(p.WIN.earned,1);assert.equal(p.WIN.earned_time,1690000000);
 fs.writeFileSync(path.join(d,'CreamAPI.Achievements.cfg'),'[A1]\nachieved=true\nunlocktime=1680000000\n');
 p=readProgress(path.join(d,'CreamAPI.Achievements.cfg'));assert.equal(p.A1.earned,1);
 const dirs=emulatorSaveDirs(2638370,{APPDATA:'C:\\Users\\u\\AppData\\Roaming',PUBLIC:'C:\\Users\\Public',USERPROFILE:'C:\\Users\\u',LOCALAPPDATA:'C:\\Users\\u\\AppData\\Local'}).join('|');
 for(const part of ['Goldberg','CODEX','OnlineFix','CreamAPI'])assert.match(dirs,new RegExp(part));
});

test('Steam AppID evidence comes from steam_appid.txt and emulator INIs',t=>{
 assert.equal(appIdFromIni('[Settings]\nAppId=1234\n'),1234);assert.equal(appIdFromIni('RealAppId = 2638370'),2638370);assert.equal(appIdFromIni('nothing=1'),null);
 const d=tmp(t);assert.equal(steamAppIdEvidence(d),null);
 fs.writeFileSync(path.join(d,'OnlineFix.ini'),'[Main]\nRealAppId=2638370\n');
 assert.deepEqual(steamAppIdEvidence(d),{appId:2638370,source:'OnlineFix.ini'});
 fs.writeFileSync(path.join(d,'steam_appid.txt'),'480\n');assert.equal(steamAppIdEvidence(d).appId,480);
});

test('PC games are linked to Steam by name only when names agree',async()=>{
 const steamLink={search:async q=>({items:[{appId:2638370,name:"Five Nights at Freddy's: Into the Pit"},{appId:1,name:"Five Nights at Freddy's"}]})};
 const ok=await steamAppByName({title:"Five Nights at Freddy's: Into the Pit",titleSource:'igdb',path:'C:\\Games\\FNAF Into the Pit\\Into the Pit.exe'},steamLink);
 assert.equal(ok.appId,2638370);assert.equal(ok.confident,true);
 const weak=await steamAppByName({title:'Setup',path:'C:\\Downloads\\setup.exe'},steamLink);
 assert.equal(weak.appId,null);
});

test('Native Steam progress is read from UserGameStats bitmask and unlock times',t=>{
 const d=tmp(t),stats=path.join(d,'appcache','stats');fs.mkdirSync(stats,{recursive:true});
 const schema={achievements:[{name:'A0',statId:'1',bit:0},{name:'A1',statId:'1',bit:1},{name:'A2',statId:'1',bit:2}]};
 const bin=encodeVDF([{type:0,key:'cache',value:[{type:2,key:'crc',value:uint(1)},{type:0,key:'1',value:[{type:2,key:'data',value:uint(0b101)},{type:0,key:'AchievementTimes',value:[{type:2,key:'0',value:uint(1700000000)},{type:2,key:'2',value:uint(1700000500)}]}]}]}]);
 fs.writeFileSync(path.join(stats,'UserGameStats_99_2638370.bin'),bin);
 const r=nativeUserProgress(d,99,2638370,schema);
 assert.deepEqual(r.state,{A0:{earned:1,earned_time:1700000000},A1:{earned:0},A2:{earned:1,earned_time:1700000500}});
});

test('Steam news and community hub are parsed safely',()=>{
 const news=parseNews({appnews:{newsitems:[{gid:'1',title:'Patch 1.2 Notes',url:'https://store.steampowered.com/news/app/1/view/1',feedname:'steam_community_announcements',date:1700000000,contents:'[img]{STEAM_CLAN_IMAGE}/1/abc.png[/img] Fixed bugs https://x.y/z.png'},{gid:'2',title:'Spam',url:'https://evil.example/',feedname:'other',date:1}]}});
 assert.equal(news.length,1);assert.equal(news[0].kind,'update');assert.match(news[0].image,/^https:\/\/clan\.akamai\.steamstatic\.com\/images\/1\/abc\.png$/);assert.doesNotMatch(news[0].summary,/png|img/i);
 const html='<div class="apphub_Card modalContentLink" data-modal-content-url="https://steamcommunity.com/sharedfiles/filedetails/?id=5"><div class="apphub_CardContentType">Screenshot</div><img class="apphub_CardContentPreviewImage" src="https://images.steamusercontent.com/ugc/1/A/"><div class="apphub_CardContentAuthorName"><a href="#">Player</a></div></div><div class="apphub_Card"><img class="apphub_CardContentPreviewImage" src="https://evil.example/a.png"></div>';
 const items=parseCommunity(html);assert.equal(items.length,1);assert.equal(items[0].type,'screenshot');assert.equal(items[0].author,'Player');
 assert.equal(safeImage('javascript:alert(1)'),'');
});

test('Built-in injector attaches to Steam windows, injects once and sends native notifications',async()=>{
 assert.equal(targetKind({type:'page',title:'Steam',url:'https://steamloopback.host/index.html'}),'library');
 assert.equal(targetKind({type:'page',title:'SharedJSContext',url:'https://steamloopback.host/'}),'shared');
 assert.equal(targetKind({type:'page',title:'Steam Big Picture Mode',url:''}),'bigpicture');
 assert.equal(targetKind({type:'page',title:'Store',url:'https://store.steampowered.com/'}),null);
 const injected=new Map();let notified=null;
 class FakeWS extends EventTarget{constructor(url){super();this.url=url;this.readyState=0;setTimeout(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));},5);}
  close(){this.readyState=3;}
  send(raw){const m=JSON.parse(raw),reply=result=>setTimeout(()=>{const e=new Event('message');e.data=JSON.stringify({id:m.id,result});this.dispatchEvent(e);},1);
   if(m.method==='Target.getTargets')return reply({targetInfos:[{targetId:'L',type:'page',title:'Steam',url:'https://steamloopback.host/index.html'},{targetId:'S',type:'page',title:'SharedJSContext',url:'https://steamloopback.host/'},{targetId:'X',type:'page',title:'Other',url:'about:blank'}]});
   if(m.method==='Target.attachToTarget')return reply({sessionId:'s-'+m.params.targetId});
   if(m.method==='Runtime.evaluate'){const e=m.params.expression;if(e.startsWith('window.__TAIGA_INJECTED__==='))return reply({result:{value:injected.has(m.sessionId)}});if(e==='document.readyState')return reply({result:{value:'complete'}});if(e.includes('__TAIGA_NOTIFY__')){if(m.sessionId==='s-S'){notified=e;return reply({result:{value:true}});}return reply({result:{value:false}});}if(/;window.__TAIGA_INJECTED__="[a-z:.0-9]+";true$/.test(e)){injected.set(m.sessionId,(injected.get(m.sessionId)||0)+1);return reply({result:{value:true}});}}
   reply({});}}
 const inj=new SteamInjector({port:8080,WebSocketImpl:FakeWS,fetchImpl:async()=>({ok:true,json:async()=>({webSocketDebuggerUrl:'ws://127.0.0.1:8080/devtools/browser/abc'})}),scripts:async()=>({library:'1',shared:'2',bigpicture:'3'})});
 await inj.tick();await sleep(500);
 assert.deepEqual([...injected.keys()].sort(),['s-L','s-S']);
 assert.deepEqual(inj.status().windows.sort(),['library','shared']);
 await inj.tick();await sleep(400);assert.equal(injected.get('s-L'),1,'não injeta de novo se já está na janela');
 assert.equal(await inj.notify({title:'Ok'}),true);assert.match(notified,/"title":"Ok"/);
 inj.stop();
});

test('RetroAchievements log events are parsed and only new lines produce unlocks',async t=>{
 const ev=parseRALines('[RCHEEVOS] Game 1234 loaded, Hardcore disabled\nAwarding achievement 55\nUnloading game 1234\n');
 assert.deepEqual(ev.map(e=>e.type),['start','award','stop']);assert.equal(ev[1].gameId,1234);assert.equal(ev[1].achievementId,55);
 const d=tmp(t),log=path.join(d,'retroarch.log');fs.writeFileSync(log,'Game 77 loaded, Hardcore enabled\nAwarding achievement 1\n');
 const events=[];const w=new RALogWatcher({files:()=>[log],onEvent:e=>events.push(e),interval:50});w.start();
 fs.appendFileSync(log,'Awarding achievement 2\n');await sleep(150);w.stop();
 assert.deepEqual(events.filter(e=>e.type==='award').map(e=>[e.gameId,e.achievementId]),[[77,2]]);
});

test('Identification covers use high-quality IGDB or Steam art',()=>{
 assert.match(externalPreview({igdb:{cover:{url:'//images.igdb.com/igdb/image/upload/t_thumb/co1abc.jpg'}}}),/t_cover_big_2x\/co1abc\.jpg/);
 assert.match(externalPreview({igdb:{external_games:[{category:1,uid:'2638370'}]}})||'',/2638370\/library_600x900\.jpg/);
});

test('Automatic game discovery reads emulator configs, frontends and common folders without duplicates',t=>{
 const d=tmp(t),home=path.join(d,'home'),appdata=path.join(home,'AppData','Roaming'),docs=path.join(home,'Documents');
 const mk=p=>{fs.mkdirSync(p,{recursive:true});return p;};
 const psp=mk(path.join(d,'games','psp')),ps2=mk(path.join(d,'games','ps2')),gc=mk(path.join(d,'games','gc')),snes=mk(path.join(d,'roms','snes')),drive=mk(path.join(d,'drive'));
 mk(path.join(drive,'Roms','n64'));mk(path.join(drive,'Games','Some PC Game'));mk(path.join(drive,'Games','Roms'));
 mk(path.join(docs,'PCSX2','inis'));fs.writeFileSync(path.join(docs,'PCSX2','inis','PCSX2.ini'),`[UI]\nx=1\n[GameList]\nRecursivePaths = ${ps2}\n`);
 const ppsspp=mk(path.join(d,'emu','ppsspp'));mk(path.join(ppsspp,'memstick','PSP','SYSTEM'));fs.writeFileSync(path.join(ppsspp,'memstick','PSP','SYSTEM','ppsspp.ini'),`[General]\nCurrentDirectory = ${psp}\n[Recent]\nFileName0 = ${path.join(psp,'Game.iso')}\n`);
 mk(path.join(appdata,'Dolphin Emulator','Config'));fs.writeFileSync(path.join(appdata,'Dolphin Emulator','Config','Dolphin.ini'),`[General]\nISOPaths = 1\nISOPath0 = ${gc}\n`);
 const ra=mk(path.join(d,'emu','retroarch','playlists'));fs.writeFileSync(path.join(ra,'Nintendo - SNES.lpl'),JSON.stringify({items:[{path:path.join(snes,'Mario.sfc')},{path:path.join(snes,'pack.zip')+'#Zelda.sfc'}]}));
 const env={USERPROFILE:home,APPDATA:appdata};
 const config={launchers:{psp:{exe:path.join(ppsspp,'PPSSPPWindows64.exe')},retroarch:{exe:path.join(d,'emu','retroarch','retroarch.exe')}},roots:[psp]};
 const emu=emulatorGameFolders({launchers:config.launchers,env}).map(f=>f.source+':'+f.path);
 for(const want of ['PCSX2:'+ps2,'PPSSPP:'+psp,'Dolphin:'+gc,'RetroArch:'+snes])assert.ok(emu.includes(want),want+' em '+emu.join(', '));
 // Plataforma real: no Windows Roms/ROMs/roms são a mesma pasta e só a comparação sem diferenciar maiúsculas evita repetição.
 const r=discoverGameFolders(config,{env,platform:process.platform,drives:[drive]});
 assert.deepEqual(new Set(r.paths),new Set([ps2,psp,gc,snes,path.join(drive,'Roms'),path.join(drive,'Games','Roms'),path.join(drive,'Games','Some PC Game')]));
 assert.equal(r.paths.filter(p=>p===psp).length,1);
 assert.ok(r.folders.find(f=>f.path===psp).sources.includes('saved'));
 assert.deepEqual(collapseFolders([{path:'/a',source:'x'},{path:'/a/b',source:'y'},{path:'/a',source:'z'}]).map(f=>[f.path,f.sources]),[[path.resolve('/a'),['x','z']]]);
 assert.deepEqual(iniSections('[A]\nk = v\n; c\n').a,[['k','v']]);
});

test('Discover endpoint adds only games that are certain and offers the rest for review',async t=>{
 const {createApp}=await import('../server.mjs');const d=tmp(t),data=path.join(d,'data'),home=path.join(d,'home'),roms=path.join(home,'Roms');fs.mkdirSync(roms,{recursive:true});
 // PSP ISO com cabeçalho reconhecível e um executável qualquer (não vira jogo sozinho).
 const iso=Buffer.alloc(0x8800);iso.write('CD001',0x8001,'latin1');fs.writeFileSync(path.join(roms,'Some Game (USA).iso'),iso);
 const old=process.env.USERPROFILE;process.env.USERPROFILE=home;t.after(()=>{if(old===undefined)delete process.env.USERPROFILE;else process.env.USERPROFILE=old;});
 const port=41000+Math.floor(Math.random()*8000),{server}=createApp({dataDir:data,port});await new Promise(r=>server.listen(port,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const token=JSON.parse(fs.readFileSync(path.join(data,'config.json'))).adminToken,base='http://127.0.0.1:'+port;
 const res=await fetch(base+'/api/discover',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({stores:false})}),text=await res.text(),body=text?JSON.parse(text):{status:res.status};
 assert.equal(res.status,200,JSON.stringify(body));
 assert.ok(body.folders.some(f=>f.path===roms),JSON.stringify(body.folders));
 assert.ok(body.items.some(i=>i.path.endsWith('Some Game (USA).iso')));
 assert.ok(body.scanId);
});
