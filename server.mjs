import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {atomic,json,save,normalize,digest} from './lib/files.mjs';
import {inspectGame,scanGames as scan,launchFor,PROFILES,auxiliaryExecutable} from './lib/games.mjs';
import {parseVDF,encodeVDF,shortcuts,upsert,value,shortcutInfo,windowsPath} from './lib/vdf.mjs';
import {iconBytes,imageType} from './lib/images.mjs';
import {legacyPSP} from './lib/legacy.mjs';
import {Providers} from './lib/providers.mjs';
import {DEMOS} from './lib/demos.mjs';
import {needsMetadata,ensureDemoSize,titleKey} from './lib/metadata.mjs';
import {SteamInjector,DEFAULT_DEBUG_PORT} from './lib/steam-inject.mjs';
import {exchangeCode,validSession} from './lib/epic-auth.mjs';
import {createCommunity} from './lib/community.mjs';
import {translateText,detectLanguage} from './lib/translation.mjs';
import {createPublicProfile,profileServerUrl} from './lib/public-profile.mjs';
import {createHousekeeping} from './lib/housekeeping.mjs';
import {createComments,gameCommentKey,commentTitle,commentLang} from './lib/comments.mjs';
import {buildActivity as buildGameActivity,createGameExtras} from './lib/game-extras.mjs';
import {portProfile} from './lib/port-profiles.mjs';
import {createNglBackend,encodeCallResult,virtualAppIdFor} from './lib/ngl/backend.mjs';
import {executableTitle} from './lib/executable-title.mjs';
import {SteamCommunity} from './lib/steam-community.mjs';
import {RALogWatcher,raLogCandidates} from './lib/ra-log.mjs';
import {externalResults,externalPreview} from './lib/external.mjs';
import {reconcile,inventoryCandidates,duplicateOf,portTwinOf} from './lib/reconcile.mjs';
import {collectionWrites,collectionDelete} from './lib/steam-collections.mjs';
import {brandIcons} from './lib/brand-icons.mjs';
import {readBuiltinKeys,attachBuiltinKeys} from './lib/builtin-keys.mjs';
import {installedGames,libraryShortcuts,localArt,localPlaytime,ownedGames} from './lib/steam-library.mjs';
import {inventory} from './lib/inventory.mjs';
import {exactIdentity,identityKey,internallyIdentified} from './lib/identification.mjs';
import {obsoleteArtwork,commitSteamFiles} from './lib/steam-write.mjs';
import * as win from './lib/windows.mjs';
import localeRuntime from './locales/runtime.cjs';
import {iconSourceFor} from './lib/exe-icon-source.mjs';
import {directPlay} from './lib/port-launch.mjs';
import {retroArchPlatforms,clearRetroArchCache,retroArchCoreFor} from './lib/retroarch.mjs';
import {MODERN} from './lib/emulator-registry.mjs';
import {defaultDiscoveryRoots,applyDiscovery,preferredProfile,launcherSettings,detectedArguments,guessProfile,emulatorDisplayName,PROFILES as REGISTRY_PROFILES} from './lib/emulator-registry.mjs';
import {SessionStore,UUID,defaultDataDir,portCaptureFile} from './lib/launch-engine.mjs';
import {JobQueue} from './lib/job-queue.mjs';
import {LibraryWatcher} from './lib/library-watcher.mjs';
import {gameStatus} from './lib/game-status.mjs';
import {SteamLinkService,steamAppId} from './lib/steam-link.mjs';
import {AchievementProviderManager} from './lib/achievement-manager.mjs';
import {platformByKey,platformByName,platformList} from './lib/platforms.mjs';
import {identifyLocal,identifyPC,displayTitle,steamAppByName,steamAppIdEvidence} from './lib/identify.mjs';
import {scoreCandidate,confidentChoice,normalizeTitle} from './lib/title-match.mjs';
import {isMainEntry,preferredPlatform} from './lib/external.mjs';
import {publicAccounts} from './lib/emulator-accounts.mjs';
import {scanStores,explorer,scanEpic,regQuery,setLegendaryExe} from './lib/stores.mjs';
import {epicLibrary,xboxLibrary,xboxStoreLink,epicInstallLink} from './lib/store-library.mjs';
import {Legendary} from './lib/legendary.mjs';
import {cardSet,cardSvg} from './lib/cards.mjs';
import {findInstalledGames} from './lib/installed-games.mjs';
import {guessNames,guessSteamGame} from './lib/title-guess.mjs';
import {consoleTitleNear} from './lib/console-port.mjs';
import {buildPortablePackage} from './lib/portable-package.mjs';
import {steamIdFromStore} from './lib/store-steam-id.mjs';
import {appIdFromFolder,engineProductName,folderExecutables,verifyCandidates,isGameFolder} from './lib/steam-appid-proof.mjs';
import {resolveSteamAppId,localSteamProof} from './lib/steam-resolve.mjs';
import {DiscordPresence,buildActivity} from './lib/discord-rpc.mjs';
import {legendaryInstalledItem} from './lib/legendary.mjs';
import {latestRelease,latestReleaseAny,downloadRelease,updateScript,newer} from './lib/updater.mjs';
import {psnFromNpsso,validPsn,psnProfile} from './lib/psn.mjs';
import {epicPlaytime,gogPlaytime,playnitePlaytime,applyImported} from './lib/playtime-import.mjs';
import {openSecrets,sealSecrets} from './lib/secret-box.mjs';
import {PortLogWatcher,portOf,portLogFiles,portStoreKey} from './lib/port-trophies.mjs';
import {validXbox,xstsFromMsa} from './lib/xbox-auth.mjs';
import {listShortcuts,epicFromUrl} from './lib/shortcut-folder.mjs';
import {StoreAchievements,parseEpicAccount,gogProductId} from './lib/store-achievements.mjs';
import {downloadable,downloadEmulator} from './lib/emulator-download.mjs';
import {discoverGameFolders,sweepRoots,emulatorSearchRoots,emulatorGameFolders,collapseFolders,windowsDrives} from './lib/discover.mjs';
import {lnkTarget} from './lib/lnk.mjs';
export const VERSION='3.2.0';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
export function pickSystemLanguage(list){const first=(Array.isArray(list)?list:[list]).map(x=>String(x||'').trim().toLowerCase()).find(Boolean);if(!first)return 'pt-BR';const base=first.split(/[-_]/)[0];return base==='pt'?'pt-BR':['es','fr','de','en'].includes(base)?base:'en';}
export function createApp({dataDir=defaultDataDir(),port=48767,picker=win.pick,launcherExecutable=null,onLanguageChange=null,onStartupChange=null,systemLanguages=null,brandFetch=null,xboxLogin=null,readShortcut=null,fileIcon=null,installedRegQuery=null,onAchievementUnlocked=null,onOpenManager=null,startInjector=false,injectorOptions={},onSteamNeedsIntegration=null,epicLogin=null,pageFetch=null,secretBox=null,psnLogin=null,onApplyUpdate=null,imageThumb=null,imageCompress=null,heroFromCover=null,iconResize=null,imageValidate=null,imageConvert=null,demoExecutable=process.execPath,providersFactory=(cfg,dir)=>new Providers(cfg,dir,{convertImage:imageConvert,compressImage:imageCompress,heroFromCover,defaultServer:(()=>{try{return String(JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).taigaServer||'');}catch{return '';}})()})}={}){
 fs.mkdirSync(dataDir,{recursive:true});
 const configFile=path.join(dataDir,'config.json'),dbFile=path.join(dataDir,'games.json');
 let config=json(configFile,{emulator:'',steamDir:'',account:'',roots:[],sgdbKey:'',igdbId:'',igdbSecret:'',raUser:'',raKey:'',adminToken:crypto.randomBytes(32).toString('hex'),readToken:crypto.randomBytes(32).toString('hex')});
 openSecrets(config,secretBox);const saveConfig=()=>save(configFile,sealSecrets(config,secretBox));
 // Configuração copiada ou editada sem as chaves internas: gera de novo em vez de travar o programa.
 attachBuiltinKeys(config,readBuiltinKeys([ROOT,path.dirname(process.execPath),path.join(path.dirname(process.execPath),'resources'),dataDir]));
 if(!config.adminToken)config.adminToken=crypto.randomBytes(32).toString('hex');if(!config.readToken)config.readToken=crypto.randomBytes(32).toString('hex');
 let db=json(dbFile,{version:1,games:[]});if(db.version!==1||!Array.isArray(db.games))throw Error('Banco inválido; restaure um backup antes de continuar.');
 saveConfig();
 config.preferences={startWithWindows:true,autoLookup:true,closeSteam:true,scanOnStart:true,watchFolders:true,autoDiscover:true,theme:'dark',autoCollection:false,autoSync:true,showUninstalled:true,emuCollection:true,...(config.preferences||{})};
 // 1.7.0: o visual novo é claro; quem estava no padrão ("igual ao sistema") passa para o claro uma vez.
 // 1.8.2: o tema padrão é o escuro; uma vez, todos passam para o escuro (dá para trocar depois).
 if(!config.designV18){config.preferences.theme='dark';config.designV17=true;config.designV18=true;saveConfig();}
 const importSessions=new Map(),identityFile=path.join(dataDir,'identity-choices.json'),identityChoices=json(identityFile,{});
 const providers=providersFactory(()=>config,dataDir),matches=new Map(),externalChoices=new Map(),artChoices=new Map(),nativeGames=new Map(),pickedArts=new Set(),uploadedArts=new Set(),emuIcons=new Map(),iconAllow=new Set(),iconRoots=new Map(),pendingFinish=new Map(),brandIcon=brandIcons(path.join(dataDir,"cache"),brandFetch||((...a)=>globalThis.fetch(...a)));let busy=false,steamSnapshot=[],integrationStatus=null;
 // Idioma antes da escolha: o do Windows (português, espanhol, francês, alemão ou inglês); outro idioma vira inglês.
 const sysLang=pickSystemLanguage(systemLanguages);
 // Emuladores configurados com os argumentos automáticos: atualiza para os argumentos atuais (tela cheia e abrir
 // direto no jogo), sem mexer nos que o usuário escreveu à mão.
 try{let n=0;for(const [p,l] of Object.entries(config.launchers||{})){if(!l?.exe||!(l.argsSource==='detected'||l.source==='detected'))continue;let a;try{a=detectedArguments(p,l.exe);}catch{continue;}if(a&&a!==l.args){l.args=a;n++;}}if(n)saveConfig();}catch{}
 const locale=localeRuntime.create(config.language||sysLang);
 const achievementManager=new AchievementProviderManager({isRunning:g=>{try{return !!sessions.forGame(g.uuid,config.account)?.running;}catch{return true;}},onGameChange:()=>persist(),psnSession:()=>validPsn(config.psnAuth,{save:next=>{config.psnAuth=next;saveConfig();}}),pageFetch,log:m=>nglNote('[conquistas] '+m),xboxSession:()=>validXbox(config.xboxAuth,{save:next=>{config.xboxAuth=next;saveConfig();}}),epicSession:()=>validSession(config.epicAuth,{save:next=>{config.epicAuth=next;saveConfig();}}),config:()=>config,dir:dataDir,providers,stores:new StoreAchievements({dir:dataDir,offline:!!process.env.TAIGA_OFFLINE}),account:()=>win.accounts(config.steamDir).find(a=>a.id===config.account),onUnlock:(game,a,source)=>{const f=path.join(dataDir,'activity.json'),rows=json(f,[]),row={id:crypto.randomUUID(),gameId:game.id,achievementId:a.id,title:a.title,description:a.description,icon:a.icon,account:config.account,source,at:new Date().toISOString(),native:false};rows.push(row);save(f,rows.slice(-500));
  // Notificação nativa da Steam pelo injetor; sem Steam conectada, aviso do Windows e da página como reserva.
  const icon=String(a.icon||'').startsWith('/art/')?`http://127.0.0.1:${port}${a.icon}`:a.icon||'';
  const sid=Number(game.bindings?.[config.account])||0;
  Promise.resolve(sid&&injector?injector.evaluateShared(`window.__TAIGA_NGL_STATE__==='ready'&&!!(window.SteamUIStore&&Array.from(window.SteamUIStore.RunningApps||[]).some(a=>((Number(a.appid??a.m_unAppID))>>>0)===${sid}))`).catch(()=>false):false).then(handled=>{if(handled){const list=json(f,[]),item=list.find(x=>x.id===row.id);if(item){item.native=true;item.by='ngl';save(f,list);}return;}
  return Promise.resolve(injector?.notify({id:a.id,title:a.title,description:a.description,icon,appid:game.metadataSteamAppId||game.bindings?.[config.account]||0,globalPercent:a.globalPercent,date:a.date||row.at})).then(native=>{if(native){const list=json(f,[]),item=list.find(x=>x.id===row.id);if(item){item.native=true;save(f,list);}}else{try{onAchievementUnlocked?.(game,a,source);}catch{}}});}).catch(()=>{try{onAchievementUnlocked?.(game,a,source);}catch{}});}});
 // Jogos instalados pelas lojas (Epic, GOG, Ubisoft, itch.io, Amazon) prontos para importar.
 const storeInfo=(info,store)=>({...info,title:store.title,internalTitle:store.title,identitySource:'Loja',store:{name:store.store,label:store.storeName,id:store.id,...(store.namespace?{namespace:store.namespace,appName:store.appName||''}:{}),url:store.url||'',...(store.titleId?{titleId:String(store.titleId)}:{}),...(store.pfn?{pfn:String(store.pfn)}:{}),needsLauncher:!!store.needsLauncher,launcherExe:store.launcherExe||null,args:store.args||'',workingDir:store.workingDir||''},suggestedRoot:store.root||info.suggestedRoot,gameRoot:store.root||null,auxiliary:false});
 // ── Jogos das lojas que não estão instalados (Epic e Xbox) ──
 // Opção "Mostrar jogos não instalados das lojas": cada jogo da conta entra na coleção e na Steam com o botão
 // Instalar. Epic: instala pelo Legendary (progresso e cancelar de verdade) ou pelo Epic Games Launcher.
 // Xbox: abre a página do jogo no app Xbox. Quando o jogo aparece instalado, a mesma entrada vira o jogo
 // instalado (mesmo atalho da Steam, mesmas artes e tempo de jogo).
 const legendary=new Legendary({dataDir,log:m=>nglNote('[epic] '+m)});setLegendaryExe(legendary.exe);
 const installWatch=new Map();
 const pfnFromUrl=u=>String(u||'').match(/AppsFolder\\([^!\\]+)!/i)?.[1]||'';
 const itemStoreKey=it=>it.store==='epic'?(it.appName?'epic:'+String(it.appName).toLowerCase():''):it.store==='xbox'?((it.pfn||pfnFromUrl(it.url))?'xbox:'+String(it.pfn||pfnFromUrl(it.url)).toLowerCase():''):'';
 const gameStoreKey=g=>{const s=g.store||{};if(s.name==='epic')return s.appName?'epic:'+String(s.appName).toLowerCase():'';if(s.name==='xbox'){const p=s.pfn||pfnFromUrl(s.url)||pfnFromUrl(g.launch?.args);return p?'xbox:'+p.toLowerCase():'';}return '';};
 const epicAuthNow=()=>validSession(config.epicAuth,{save:next=>{config.epicAuth=next;saveConfig();}}).catch(()=>null);
 const xboxAuthNow=()=>validXbox(config.xboxAuth,{save:next=>{config.xboxAuth=next;saveConfig();}}).catch(()=>null);
 const defaultEpicDir=()=>path.join(process.env.SystemDrive?process.env.SystemDrive+'\\':os.homedir(),'Games','Epic Games');
 const epicInstallDir=()=>config.epicInstallDir||defaultEpicDir();
 const openLink=url=>{if(process.platform!=='win32')return;const c=spawn(explorer(),[url],{detached:true,stdio:'ignore',windowsHide:true});c.on('error',()=>{});c.unref();};
 function placeholderGame(it){const key=itemStoreKey(it),title=String(it.title||'').slice(0,200);
  return {id:digest('store-'+key).slice(0,20),path:path.join(dataDir,'not-installed',digest(key).slice(0,16)+'.exe'),title,fileTitle:title,internalTitle:title,identitySource:'Loja',bytes:0,mtime:0,sizeBasis:null,profile:'store',profileLocked:true,platformName:PROFILES.store.platform,platformKey:'pc',platformSource:'store',discId:'',serial:'',revision:null,region:[],languages:[],discNumber:null,needsReview:false,art:{},bindings:{},metadata:{},addedAt:new Date().toISOString(),notInstalled:true,...(it.titleEn&&it.titleEn!==title?{storeTitleEn:String(it.titleEn).slice(0,200)}:{}),
   store:{name:it.store,label:it.storeName,id:it.id||'',...(it.store==='epic'?{namespace:it.namespace,appName:it.appName,catalogItemId:it.catalogItemId}:{pfn:it.pfn,productId:it.productId||'',titleId:it.titleId||''})},storeImages:it.images||{}};}
 // A entrada "não instalada" vira o jogo instalado encontrado pela busca das lojas.
 function convertInstalled(g,s){
  delete g.notInstalled;installWatch.delete(g.id);g.path=s.path;g.gameRoot=s.root||null;g.installedAt=new Date().toISOString();
  try{const st=fs.statSync(s.path);g.bytes=st.size;g.mtime=st.mtimeMs;}catch{}
  g.store={...g.store,name:s.store,label:s.storeName,id:s.id||g.store?.id||'',...(s.namespace?{namespace:s.namespace,appName:s.appName||g.store?.appName||''}:{}),url:s.url||'',needsLauncher:!!s.needsLauncher,launcherExe:s.launcherExe||null};
  if(s.needsLauncher&&s.url){g.profile='store';g.launch={exe:s.launcherExe||explorer(),args:s.url};}else{g.profile='pc';delete g.launch;}
  nglNote('Jogo instalado: '+g.title+' ('+s.storeName+')');
 }
 const notInstalledGames=()=>db.games.filter(g=>g.notInstalled&&!g.demo);
 let libraryBusy=null;
 function syncStoreLibrary(){if(libraryBusy)return libraryBusy;libraryBusy=syncStoreLibraryNow().finally(()=>{libraryBusy=null;});return libraryBusy;}
 // Grava logo depois de várias mudanças seguidas (capas chegando uma a uma pela tela).
 let persistTimer=null;const persistSoon=()=>{clearTimeout(persistTimer);persistTimer=setTimeout(()=>{if(!closed)persist();},1500);persistTimer.unref?.();};
 // Roda tarefas com no máximo N ao mesmo tempo.
 async function pool(items,n,fn){let next=0;await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(next<items.length&&!closed){const it=items[next++];try{await fn(it);}catch{}}}));}
 // Imagens oficiais guardadas da loja (capa, horizontal, fundo e logo) para o que ainda falta.
 async function quickStoreArt(g){const im=g?.storeImages||{};let got=false;for(const [kind,url] of [['cover',im.cover],['wide',im.wide],['hero',im.wide],['logo',im.logo]]){if(!url||g.art?.[kind]||g.artPinned?.[kind])continue;try{g.art={...(g.art||{}),[kind]:await providers.image(url)};got=true;}catch{}}return got;}
 async function syncStoreLibraryNow(){
  const out={added:0,removed:0,installed:0,errors:[],stores:[]};
  let scanned=[];try{scanned=(await scanStores()).items||[];}catch{}
  const byKey=new Map();for(const s of scanned){const k=itemStoreKey(s);if(k&&!byKey.has(k))byKey.set(k,s);}
  // Instalados por fora (Epic, app Xbox, Legendary): a entrada vira o jogo instalado.
  for(const g of notInstalledGames()){const s=byKey.get(gameStoreKey(g));if(s&&!db.games.some(o=>o!==g&&!o.notInstalled&&o.path.toLowerCase()===s.path.toLowerCase())){convertInstalled(g,s);out.installed++;}}
  if(!config.preferences.showUninstalled){
   const list=notInstalledGames().filter(g=>!g.hidden&&!legendary.state(g.store?.appName||'')?.phase?.match(/^(tool|preparing|downloading|finishing)$/));
   if(list.length){const bound=list.filter(g=>g.bindings?.[config.account]).map(g=>g.id);if(bound.length)try{await sync(bound,{remove:true,restart:false,openSteam:false});}catch(e){out.errors.push({file:'Steam',message:e.message});persist();return out;}
    const drop=new Set(list.map(g=>g.id));db.games=db.games.filter(g=>!drop.has(g.id));out.removed=list.length;}
   if(out.installed||out.removed)persist();return out;
  }
  const lang=config.language||sysLang,lib=[],fetched=new Set();
  if(config.epicAuth){const auth=await epicAuthNow();if(auth)try{lib.push(...await epicLibrary(auth,{cacheDir:path.join(dataDir,'cache'),language:lang}));fetched.add('epic');out.stores.push('Epic Games');}catch(e){out.errors.push({file:'Epic Games',message:e.message});}}
  if(config.xboxAuth){const s=await xboxAuthNow();if(s)try{lib.push(...await xboxLibrary(s,{language:lang}));fetched.add('xbox');out.stores.push('Xbox');}catch(e){out.errors.push({file:'Xbox',message:e.message});}}
  const known=new Set([...db.games.map(gameStoreKey).filter(Boolean),...byKey.keys()]);
  const added=[],libKeys=new Set();
  for(const it of lib){const k=itemStoreKey(it);if(!k)continue;libKeys.add(k);if(known.has(k))continue;known.add(k);const g=placeholderGame(it);if(db.games.some(o=>o.id===g.id))continue;db.games.push(g);added.push(g.id);}
  // Jogo que saiu da conta (devolvido, fim do Game Pass): a entrada não instalada sai também.
  const gone=notInstalledGames().filter(g=>fetched.has(g.store?.name)&&!libKeys.has(gameStoreKey(g))&&!installWatch.has(g.id)&&!legendary.state(g.store?.appName||''));
  if(gone.length){const bound=gone.filter(g=>g.bindings?.[config.account]).map(g=>g.id);let ok=true;if(bound.length)try{await sync(bound,{remove:true,restart:false,openSteam:false});}catch{ok=false;}if(ok){const drop=new Set(gone.map(g=>g.id));db.games=db.games.filter(g=>!drop.has(g.id));out.removed=gone.length;}}
  out.added=added.length;persist();
  // Jogos já cadastrados que ainda não acharam o jogo na Steam: ganham o nome em inglês e tentam de novo.
  const retry=[];for(const it of lib){const g=notInstalledGames().find(x=>gameStoreKey(x)===itemStoreKey(it));if(!g)continue;if(it.titleEn&&it.titleEn!==g.title&&!g.storeTitleEn)g.storeTitleEn=String(it.titleEn).slice(0,200);if(it.images&&!g.storeImages?.cover)g.storeImages=it.images;if(!steamAppIdFor(g)&&!g.steamLinkDisabled&&!g.storeLinkRetry254){g.storeLinkRetry254=true;delete g.storeSteamCheckedAt;delete g.steamNameCheckedAt;delete g.steamResolve;retry.push(g.id);}}
  const linkAndArt=async id=>{const g=db.games.find(x=>x.id===id);if(!g||closed)return;try{await autoSteamLink(g);}catch{}};
  const todo=[...added,...retry];
  // Capas na hora: as imagens oficiais da própria loja (Epic, Xbox, GOG) vêm direto do site da loja, sem consultas.
  // Depois, quem existe na Steam troca pelas artes oficiais da Steam.
  await pool(todo.map(id=>db.games.find(x=>x.id===id)).filter(Boolean),8,quickStoreArt);if(todo.length){persist();injector?.reload?.()?.catch?.(()=>{});}
  await pool(todo,6,linkAndArt);if(todo.length)persist();
  if(added.length){(async()=>{for(const id of added){if(closed)return;const g=db.games.find(x=>x.id===id);if(!g)continue;try{await providers.completeMissing?.(g);}catch{}}persist();injector?.reload().catch(()=>{});})().catch(()=>{});
   try{await autoAddToSteam(added);}catch(e){out.errors.push({file:'Steam',message:e.message});}}
  if(retry.length)refreshSteamLive?.().catch?.(()=>{});
  nglNote('Biblioteca das lojas: '+out.added+' novo(s), '+out.installed+' instalado(s), '+out.removed+' removido(s).');
  setTimeout(()=>prefetchSizes(),15000).unref?.();
  return out;
 }
 // Estado da instalação de um jogo (página da Steam e janela do jogo).
 function installState(g){
  if(!g)return {state:'unknown'};if(!g.notInstalled)return {state:'installed'};
  const store=g.store?.name||'';
  if(store==='epic'){const j=legendary.state(g.store.appName);if(j&&!['done','cancelled'].includes(j.phase)&&!(j.phase==='error'&&installWatch.has(g.id))){if(j.phase==='error'&&!installWatch.has(g.id))return {state:'error',store,error:j.error||'',errorCode:j.errorCode||'',errorValues:j.errorValues||{}};if(j.phase==='paused')return {state:'paused',store,phase:'paused',percent:Math.round((j.percent||0)*10)/10,downloadedMiB:j.downloadedMiB||0,totalMiB:j.totalMiB||0};return {state:'installing',store,phase:j.phase,percent:Math.round((j.percent||0)*10)/10,eta:j.eta||'',downloadedMiB:j.downloadedMiB||0,totalMiB:j.totalMiB||0,speedMiB:j.speedMiB||0};}}
  if(installWatch.has(g.id))return {state:'external',store};
  return {state:'none',store,method:store==='epic'?(config.preferences.epicInstaller==='launcher'?'launcher':'legendary'):'app',sizeBytes:g.store?.diskBytes||0};
 }
 let installTimer=null;
 function watchExternalInstalls(){if(installTimer)return;installTimer=setInterval(async()=>{if(closed||!installWatch.size){clearInterval(installTimer);installTimer=null;return;}for(const [id,w] of installWatch)if(Date.now()-w.since>6*3600000)installWatch.delete(id);try{await refreshInstalledStores();}catch{}},20000);}
 async function refreshInstalledStores(){let scanned=[];try{scanned=(await scanStores()).items||[];}catch{return 0;}const byKey=new Map(scanned.map(s=>[itemStoreKey(s),s]));let n=0;
  for(const g of notInstalledGames()){const s=byKey.get(gameStoreKey(g));if(s&&!db.games.some(o=>o!==g&&!o.notInstalled&&o.path.toLowerCase()===s.path.toLowerCase())){convertInstalled(g,s);n++;}}
  if(n){persist();injector?.reload().catch(()=>{});refreshSteamLive?.().catch?.(()=>{});}return n;}
 // ── Janela "Instalar" (igual à da Steam): tamanho do jogo, discos e atalhos ──
 let driveLabels={at:0,map:{}};
 async function volumeLabels(){if(process.platform!=='win32')return {};if(Date.now()-driveLabels.at<600000)return driveLabels.map;
  try{const {stdout}=await new Promise((ok,no)=>execFile('powershell.exe',['-NoProfile','-Command','[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType | ConvertTo-Json -Compress'],{windowsHide:true,timeout:15000},(e,so)=>e?no(e):ok({stdout:String(so)})));
   const rows=[].concat(JSON.parse(stdout.trim()||'[]')),map={};for(const r of rows)if(r?.DeviceID)map[String(r.DeviceID).toUpperCase()]={label:String(r.VolumeName||''),type:Number(r.DriveType)};driveLabels={at:Date.now(),map};}catch{}
  return driveLabels.map;}
 async function installDrives(needBytes){
  const labels=await volumeLabels(),cfgDir=epicInstallDir(),defLetter=(path.parse(cfgDir).root||'C:\\').slice(0,2).toUpperCase(),out=[];
  for(let c=67;c<=90;c++){const letter=String.fromCharCode(c)+':',root=letter+'\\';if(process.platform==='win32'&&!fs.existsSync(root))continue;const info=labels[letter];if(info&&![2,3].includes(info.type))continue;
   let free=0,total=0;try{const st=fs.statfsSync(root);free=Number(st.bavail)*Number(st.bsize);total=Number(st.blocks)*Number(st.bsize);}catch{continue;}
   const dir=letter===defLetter?cfgDir:path.join(root,'Games','Epic Games');out.push({letter,label:info?.label||'',free,total,dir,default:letter===defLetter,enough:!needBytes||free>needBytes});}
  if(process.platform!=='win32'&&!out.length){try{const st=fs.statfsSync(cfgDir.startsWith('/')?'/':os.homedir());out.push({letter:'/',label:'',free:Number(st.bavail)*Number(st.bsize),total:0,dir:cfgDir,default:true,enough:true});}catch{}}
  return out;}
 const sizeJobs=new Map();
 // Tamanho do jogo (Epic): guardado no cadastro; a primeira consulta roda em segundo plano.
 function epicSize(g){if(g.store?.diskBytes)return Promise.resolve(g.store.diskBytes);if(sizeJobs.has(g.id))return sizeJobs.get(g.id);
  const job=(async()=>{const auth=await epicAuthNow();if(!auth)return 0;const r=await legendary.info(g.store.appName,auth);if(r.diskBytes){g.store.diskBytes=r.diskBytes;g.store.downloadBytes=r.downloadBytes;persist();}return r.diskBytes;})().catch(e=>{nglNote('Tamanho do jogo ('+g.title+'): '+e.message);return 0;}).finally(()=>sizeJobs.delete(g.id));
  sizeJobs.set(g.id,job);return job;}
 // Tamanhos calculados antes, em segundo plano e devagar (um jogo por vez, com pausa), para a página já abrir com o
 // "Espaço necessário". Para enquanto houver jogo aberto, para não pesar.
 let sizePrefetch=null;
 function prefetchSizes(){if(sizePrefetch||closed||process.platform!=='win32'||!config.preferences.showUninstalled||!config.epicAuth)return;sizePrefetch=(async()=>{
  const todo=notInstalledGames().filter(g=>g.store?.name==='epic'&&!g.store.diskBytes&&!g.hidden&&!(g.store.sizeTriedAt&&Date.now()-g.store.sizeTriedAt<86400000));
  for(const g of todo){if(closed||!config.preferences.showUninstalled)break;if(db.games.some(x=>x.uuid&&sessions.forGame(x.uuid,config.account)?.running))break;if(legendary.active().length)break;
   g.store.sizeTriedAt=Date.now();try{await epicSize(g);}catch{}await new Promise(r=>setTimeout(r,2500));}
  persist();})().finally(()=>{sizePrefetch=null;});}
 async function installInfo(g,{wait=false}={}){
  if(!g?.notInstalled)return {state:'installed'};const st=installState(g);
  let size=g.store?.diskBytes||0;if(!size&&g.store?.name==='epic'&&process.platform==='win32'){const p=epicSize(g);if(wait)size=await Promise.race([p,new Promise(r=>setTimeout(()=>r(0),45000))]);}
  let header='';const art=g.art?.wide||g.art?.hero||g.art?.cover;if(art)try{const f=path.join(dataDir,'art',path.basename(art)),b=fs.readFileSync(f);if(b.length<4000000)header='data:image/'+(imageType(b)==='png'?'png':'jpeg')+';base64,'+b.toString('base64');}catch{}
  return {...st,title:g.title,sizeBytes:size,header,drives:g.store?.name==='epic'?await installDrives(size):[]};}
 // Atalhos como os da Steam: abrem o jogo pela Steam (steam://rungameid), com o ícone do jogo.
 let desktopDir=null;
 async function shellFolder(name){if(process.platform!=='win32')return '';try{const {stdout}=await new Promise((ok,no)=>execFile('powershell.exe',['-NoProfile','-Command','[Environment]::GetFolderPath("'+name+'")'],{windowsHide:true,timeout:10000},(e,so)=>e?no(e):ok({stdout:String(so)})));return stdout.trim();}catch{return '';}}
 async function createGameShortcuts(g,{desktop=false,startMenu=false}={}){
  const id=Number(g.bindings?.[config.account])>>>0;if(!id||(!desktop&&!startMenu))return;
  const url='steam://rungameid/'+((BigInt(id)<<32n)|0x02000000n).toString(),icon=isFile(g.path)?g.path:'';
  const body='[InternetShortcut]\r\nIDList=\r\nURL='+url+'\r\n'+(icon?'IconIndex=0\r\nIconFile='+icon+'\r\n':''),name=String(g.title).replace(/[<>:"/\\|?*\x00-\x1f]/g,'').trim().slice(0,120)||'Jogo';
  if(desktop){desktopDir??=await shellFolder('Desktop');if(desktopDir)try{fs.writeFileSync(path.join(desktopDir,name+'.url'),body);}catch{}}
  if(startMenu){const dir=await shellFolder('Programs');if(dir)try{fs.writeFileSync(path.join(dir,name+'.url'),body);}catch{}}}
 async function startInstall(g,{via='',dir='',shortcuts=null}={}){
  if(!g?.notInstalled)return installState(g);
  const store=g.store?.name;
  if(store==='xbox'){openLink(xboxStoreLink(g.store));installWatch.set(g.id,{since:Date.now()});watchExternalInstalls();return installState(g);}
  if(store!=='epic')throw Error('Instalação não disponível para esta loja.');
  if((config.preferences.epicInstaller==='launcher'&&via!=='legendary')||via==='launcher'){openLink(epicInstallLink(g.store));installWatch.set(g.id,{since:Date.now()});watchExternalInstalls();return installState(g);}
  const auth=await epicAuthNow();if(!auth)throw Error('Entre com a sua conta Epic em Contas para instalar jogos da Epic.');
  let baseDir=epicInstallDir();const want=String(dir||'').trim();if(want){if(!path.isAbsolute(want)||/[<>"|?*]/.test(want.slice(2)))throw Error('Escolha uma pasta válida para instalar os jogos da Epic.');baseDir=want;}
  if(shortcuts&&typeof shortcuts==='object')g.installShortcuts={desktop:!!shortcuts.desktop,startMenu:!!shortcuts.startMenu};
  await legendary.install(g.store.appName,{auth,baseDir,onDone:async st=>{
   if(st.phase==='done'){let n=await refreshInstalledStores().catch(()=>0);
    // O registro do Legendary às vezes demora um instante; e jogos sem executável indicado nele: acha pela pasta.
    if(!n){await new Promise(r=>setTimeout(r,3000));n=await refreshInstalledStores().catch(()=>0);}
    if(!n&&g.notInstalled){const it=legendaryInstalledItem(g.store.appName,legendary.exe);if(it){convertInstalled(g,it);persist();injector?.reload().catch(()=>{});refreshSteamLive?.().catch?.(()=>{});n=1;}}if(n&&g.installShortcuts){try{await createGameShortcuts(g,g.installShortcuts);}catch{}delete g.installShortcuts;persist();}if(!n)nglNote('Instalação Epic terminou, mas o jogo não foi encontrado: '+g.title);}
   // Jogo que só instala pelo Ubisoft Connect: a própria Epic cuida da instalação.
   else if(st.phase==='error'&&st.errorCode==='uplay'){openLink(epicInstallLink(g.store));installWatch.set(g.id,{since:Date.now()});watchExternalInstalls();}
  }});
  return installState(g);
 }
 async function pauseInstall(g){if(g?.store?.name==='epic')await legendary.pause(g.store.appName);return installState(g);}
 async function cancelInstall(g){if(!g)return {state:'unknown'};if(g.store?.name==='epic'&&legendary.state(g.store.appName))await legendary.cancel(g.store.appName);installWatch.delete(g.id);return installState(g);}
 // Arquivos escolhidos à mão: atalhos (.lnk/.url) viram o jogo de destino. Atalho do Xbox (shell:AppsFolder, sem
 // arquivo de destino) é ligado ao jogo do Xbox pela família do pacote ou pelo nome do atalho.
 async function resolvePicked(paths){let stores=null;const getStores=async()=>stores??=(await scanStores().catch(()=>({items:[]}))).items||[];const norm=t=>String(t||'').toLowerCase().replace(/[^a-z0-9]+/g,'');const out=[];
  for(const file of paths){if(!/\.(lnk|url)$/i.test(file)){out.push(file);continue;}
   let target='';if(/\.lnk$/i.test(file)){try{target=readShortcut?String(readShortcut(file)||''):'';}catch{}if(!target)try{target=lnkTarget(file);}catch{}}
   if(target&&isFile(target)&&!/\.(lnk|url)$/i.test(target)){out.push(target);continue;}
   let raw='';try{const b=fs.readFileSync(file);raw=(b.toString('utf16le')+'\n'+b.toString('latin1')).toLowerCase();}catch{}
   const list=await getStores(),name=norm(path.basename(file).replace(/\.(lnk|url)$/i,''));
   const hit=list.find(i=>{const fam=String(i.url||'').match(/appsfolder\\([^!]+)!/i)?.[1];return fam&&raw.includes(fam.toLowerCase());})||list.find(i=>i.url&&raw.includes(String(i.url).toLowerCase()))||list.find(i=>name&&norm(i.title)===name);
   out.push(hit?hit.path:file);}
  return {paths:out,stores:await getStores()};}
 async function storePreview(){
  const found=await scanStores(),errors=[...found.errors];const fresh=found.items.filter(item=>!db.games.some(g=>!g.demo&&g.path.toLowerCase()===item.path.toLowerCase()));
  const existing=found.items.map(item=>db.games.find(g=>!g.demo&&g.path.toLowerCase()===item.path.toLowerCase())).filter(Boolean).map(g=>({id:g.id,title:g.title,path:g.path,hidden:!!g.hidden}));
  const inspected=fresh.length?await inventory('inspect',fresh.slice(0,500).map(i=>i.path)):{items:[],errors:[]};errors.push(...inspected.errors);
  const items=inspected.items.map(info=>{const store=fresh.find(i=>i.path.toLowerCase()===info.path.toLowerCase());delete info.icon;return storeInfo(info,store);});
  return {items:splitDuplicates(items,existing),existing,errors,stores:[...new Set(found.items.map(i=>i.storeName))]};
 }
 // Jogos adicionados antes das chaves de API: ao salvar as chaves, completa capas, fundos, logos e dados que faltam.
 let artCompleting=false;
 async function completeArtworkAfterKeys(){if(artCompleting)return;artCompleting=true;try{for(const g of db.games.filter(x=>!x.demo&&!x.hidden)){if(closed)break;const missing=['cover','hero','logo','wide'].filter(k=>!g.art?.[k]&&!g.artPinned?.[k]);if(!missing.length&&g.sgdbId&&g.metadata?.summary)continue;try{const appId=steamAppIdFor(g);if(appId&&missing.length)await steamLink.apply(g,appId).catch(()=>{});if(!g.sgdbId)await providers.resolveSgdbId(g,{steamAppId:appId});if(g.sgdbId&&['cover','hero','logo','wide'].some(k=>!g.art?.[k]&&!g.artPinned?.[k]))await providers.enrich(g,{sgdb:{id:g.sgdbId},missingOnly:true});if(providers.completeMissing)await providers.completeMissing(g);persist();}catch{}}}finally{artCompleting=false;}}
 let injector=null;
 const integration={needsRestart:false,since:0,notifiedAt:0,checking:false,restarting:false};
 // NativeGameLink for Steam (MIT) rodando dentro da Steam com o backend do Taiga Launcher.
 const nglLog=[];const nglLogFile=path.join(dataDir,'logs','steam-integracao.log');const nglNote=m=>{const line=new Date().toISOString()+' '+m;nglLog.push(line);if(nglLog.length>400)nglLog.splice(0,nglLog.length-400);if(process.env.TAIGA_DEBUG)console.log('[ngl]',m);
  // Registro em arquivo (sobrevive ao fechamento do programa): é o que mostra por que a página não apareceu.
  try{fs.mkdirSync(path.dirname(nglLogFile),{recursive:true});try{if(fs.statSync(nglLogFile).size>1048576)fs.renameSync(nglLogFile,nglLogFile+'.1');}catch{}fs.appendFileSync(nglLogFile,line+'\n');}catch{}};
 const artUrl=name=>name&&/^[a-f0-9]+\.(png|jpg|ico)$/.test(String(name))?`http://127.0.0.1:${port}/art/${name}`:'';
 const shortcutGame=id=>{const n=Number(id)>>>0;return n?db.games.find(g=>!g.demo&&!g.hidden&&(Number(g.bindings?.[config.account])>>>0)===n)||null:null;};
 // Cartas colecionáveis dos jogos sem página na Steam (jogos de emulador e outros): personagens do IGDB ou, sem eles,
 // conquistas do jogo. Guardadas no jogo; refeitas depois de 30 dias (ou 1 dia, se não achou nada).
 const cardCache=new Map(),cardJobs=new Map();
 // Depois de montadas, as cartas ficam salvas no jogo e não mudam mais (nada é refeito a cada abertura da página). Só
 // um conjunto vazio tenta de novo (uma vez por dia), e um conjunto feito só com imagens locais tenta achar personagens
 // ou conquistas uma vez por semana.
 function ensureCards(g){const set=g.cardSet,age=set?Date.now()-set.at:Infinity;if(set&&set.v===2&&(set.items?.length?(set.source!=='scenes'||age<7*86400000):age<86400000))return Promise.resolve(set);if(cardJobs.has(g.id))return cardJobs.get(g.id);
  const media=()=>[...(g.media||[]).map(m=>({file:path.basename(String(m.image||'')),name:g.title})),...['hero','wide','cover'].map(k=>g.art?.[k]?{file:path.basename(g.art[k]),name:g.title}:null).filter(Boolean)];
  const job=cardSet(g,{igAvailable:()=>providers.igAvailable?.(),ig:(q,e)=>providers.ig(q,e),image:url=>providers.image(url),achievements:async()=>(achievementManager.cached(g)||await achievementManager.get(g,{quiet:true}).catch(()=>null))?.achievements||[],media,platformIgdb:Number(platformOf(g)?.igdb)||0,artDir:path.join(dataDir,'art'),log:m=>nglNote(m)})
   .then(r=>{if(set?.items?.length&&!r.items.length)return set;g.cardSet={...r,v:2};if(r.items.length)nglNote('Cartas de '+g.title+': '+r.items.length+' ('+r.source+').');persist();return g.cardSet;}).catch(()=>set||null).finally(()=>cardJobs.delete(g.id));cardJobs.set(g.id,job);return job;}
 async function virtualCards(vid){const g=virtualIndex().get(Number(vid));if(!g)return null;const set=await Promise.race([ensureCards(g),new Promise(r=>setTimeout(()=>r(g.cardSet||null),25000))]);if(!set?.items?.length)return {appid:Number(vid),cards:[],badges:[],generated:true};
  const v=set.at.toString(36),badge=artUrl(g.art?.logo||g.art?.icon||g.art?.cover);
  return {appid:Number(vid),generated:true,source:set.source,game:g.title,cards:set.items.map((it,i)=>({title:it.name,image:`http://127.0.0.1:${port}/card/${g.id}/${i}.svg?v=${v}`,artwork:artUrl(it.file)||''})),badges:badge?[{title:g.title,image:badge}]:[]};}
 // Índice AppID virtual → jogo, refeito só quando a coleção muda (antes era recalculado a cada pedido da página da Steam).
 let vIndex=null,vIndexAt=-1,vIndexLen=-1;
 const virtualIndex=()=>{if(vIndex&&vIndexAt===dataVersion&&vIndexLen===db.games.length)return vIndex;const m=new Map();for(const g of db.games)if(!g.demo&&g.uuid)m.set(virtualAppIdFor(g.uuid),g);vIndex=m;vIndexAt=dataVersion;vIndexLen=db.games.length;return m;};
 const nglBackend=createNglBackend({dataVersion:()=>{try{return dataVersion;}catch{return 0;}},translate:text=>translateText(text,dataDir,u=>providers.request(u),config.language||sysLang,'en'),dataDir,config:()=>config,games:()=>db.games.filter(g=>!g.demo&&!g.hidden),shortcutGame,virtualGame:vid=>{const g=virtualIndex().get(Number(vid));return g?{...g,emulatorName:g.profile==='pc'||g.profile==='store'?'':PROFILES[g.profile||'psp']?.name||''}:null;},
  localizeGame:async vid=>{const g=virtualIndex().get(Number(vid));if(!g)return;const before=g.metadata?.summary;await providers.localize(g).catch(()=>{});if(g.metadata?.summary!==before)persist();},
  steamAppIdOf:g=>steamAppIdFor(g),linkGame:(g,appId)=>{delete g.steamLinkDisabled;g.steamLink={appId,name:g.steamLink?.appId===appId?g.steamLink.name:'',source:'nativegamelink',at:new Date().toISOString()};g.metadataSteamAppId=appId;g.nglDismissed=false;persist();},
  unlinkGame:g=>{if(steamAppIdFor(g)&&g.steamLink?.source==='nativegamelink'){g.steamLinkPrev={...g.steamLink,removedAt:new Date().toISOString()};delete g.steamLink;g.steamLinkDisabled=true;}else g.nglDismissed=true;persist();},save:()=>persist(),
  achievements:(g,o)=>achievementManager.get(g,o),cachedAchievements:g=>achievementManager.cached(g)||providers.cachedAchievements(g),playtime:g=>sessions.forGame(g.uuid,config.account),artUrl,
  searchStore:term=>steamLink.search(term),executableTitle:f=>{try{return executableTitle(f);}catch{return '';}},steamAppIdEvidence,log:nglNote,
  setConfig:patch=>{Object.assign(config,patch);saveConfig();},setGameAchievementRoot:(g,root)=>{g.achievementSettings={...(g.achievementSettings||{}),root:root||undefined};persist();},
  onSteamGridDbKey:key=>{if(!config.sgdbKey){config.sgdbKey=key;saveConfig();}},adoptShortcut:info=>adoptShortcut(info),virtualCards:vid=>virtualCards(vid),install:{ids:()=>db.games.filter(g=>g.notInstalled&&!g.hidden&&!g.demo&&g.bindings?.[config.account]).map(g=>({id:Number(g.bindings[config.account])>>>0,...installState(g)})),state:g=>installState(g),start:(g,o)=>startInstall(g,o),pause:g=>pauseInstall(g),info:(g,o)=>installInfo(g,o),pickFolder:async()=>{try{const r=await picker('folder');return Array.isArray(r)&&r[0]?String(r[0]):'';}catch{return '';}},cancel:g=>cancelInstall(g)}});
 // Jogo de emulador adicionado pela própria Steam ("Adicionar um jogo não Steam"): quando o atalho abre um emulador
 // conhecido com um arquivo de jogo que o conteúdo identifica, entra na coleção já ligado a esse atalho.
 const emulatorExeNames=new Map(Object.entries(REGISTRY_PROFILES).flatMap(([key,p])=>(p.files||[]).map(f=>[f.toLowerCase(),key])));
 const adopting=new Set();
 async function adoptShortcut({sid,exe,startDir,options,title}={}){
  sid=Number(sid)>>>0;if(!sid||sid<2147483648||shortcutGame(sid)||adopting.has(sid))return null;
  // Atalho do próprio Taiga Launcher (abre "--taiga-launch <uuid>") que perdeu a ligação com o jogo (Steam recriou o
  // atalho com outro número, cadastro antigo): religa na hora e a página do jogo volta (loja, instalar, conquistas).
  const own=String(options||'').match(/--taiga-launch\s+"?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"?/i);
  if(own){const g=db.games.find(x=>!x.demo&&String(x.uuid||'').toLowerCase()===own[1].toLowerCase());
   if(!g){nglNote('Atalho da Steam de um jogo que não está mais no Taiga Launcher: '+String(title||sid).slice(0,120)+'.');return null;}
   g.bindings={...(g.bindings||{}),[config.account]:sid};g.hidden=false;if(g.steamRemoved)delete g.steamRemoved[config.account];persist();nglNote('Atalho da Steam religado ao jogo: '+g.title+'.');return g;}
  const profile=emulatorExeNames.get(path.win32.basename(String(exe||'').replace(/^"|"$/g,'')).toLowerCase());if(!profile)return null;
  const tokens=[...String(options||'').matchAll(/"([^"]+)"|(\S+)/g)].map(m=>m[1]||m[2]),file=tokens.map(t=>path.isAbsolute(t)||/^[a-z]:[\\/]/i.test(t)?t:startDir?path.join(String(startDir).replace(/^"|"$/g,''),t):'').find(t=>t&&isFile(t)&&!/\.exe$/i.test(t));
  if(!file||db.games.some(g=>!g.demo&&g.path.toLowerCase()===file.toLowerCase()))return null;
  adopting.add(sid);try{const r=await addFiles([file]),g=r.addedIds[0]&&getGame(r.addedIds[0]);if(!g)return null;
   if(!['header','folder'].includes(g.platformSource)){db.games.splice(db.games.indexOf(g),1);persist();return null;}
   try{const local=await identifyLocal(g,{providers});if(local.automatic&&g.dat?.title)g.title=displayTitle(g.dat.title);}catch{}
   if(title&&!g.dat)g.title=String(title).slice(0,200);g.adoptedShortcut=true;g.bindings={[config.account]:sid};g.applied={[config.account]:signature(g)};persist();
   nglNote('Atalho adicionado pela Steam virou jogo do Taiga Launcher: '+g.title);
   setTimeout(async()=>{try{if(providers.completeMissing)await providers.completeMissing(g);persist();injector?.reload().catch(()=>{});}catch{}},0);
   return g;}finally{adopting.delete(sid);}
 }
 // Artes escolhidas na própria Steam pelo NGL passam a ser as artes do jogo no Taiga Launcher.
 function adoptSteamArtwork(shortcutAppId,{pin=true}={}){const g=shortcutGame(shortcutAppId);if(!g||!config.steamDir)return {ok:false};const grid=path.join(config.steamDir,'userdata',config.account,'config','grid'),id=String(Number(shortcutAppId)>>>0);let changed=0;
  for(const [kind,suffix] of [['cover','p'],['hero','_hero'],['logo','_logo'],['wide','']])for(const ext of ['png','jpg','jpeg']){const f=path.join(grid,id+suffix+'.'+ext);if(!isFile(f))continue;try{const bytes=fs.readFileSync(f);const type=imageType(bytes);if(!['png','jpg'].includes(type))break;const name=digest(bytes)+'.'+type;if(g.art?.[kind]===name)break;atomic(path.join(dataDir,'art',name),bytes);if(!pin&&g.artPinned?.[kind])break;g.art={...(g.art||{}),[kind]:name};if(pin)g.artPinned={...(g.artPinned||{}),[kind]:true};changed++;}catch{}break;}
  if(changed)persist();return {ok:true,changed};}
 const nglCatalog=()=>{const links={},artLocked=[];for(const g of db.games){if(g.demo||g.hidden)continue;const sid=g.bindings?.[config.account];if(sid&&!steamAppIdFor(g))artLocked.push(String(Number(sid)>>>0));if(steamAppIdFor(g)||!g.uuid)continue;const list=[];if(g.raId)list.push({label:'RetroAchievements',url:'https://retroachievements.org/game/'+Number(g.raId)});const u=String(g.metadata?.url||'');if(/^https:\/\//.test(u))list.push({label:/igdb\.com/.test(u)?'IGDB':'Site',url:u});/* Jogo sem página na Steam: links úteis no lugar de Loja/Comunidade/Guias da Steam. */const q=encodeURIComponent(g.title||'');const wl=({'pt-BR':'pt',es:'es',fr:'fr',de:'de'})[config.language||sysLang]||'en';if(q)list.push({label:'Wikipedia',url:wl==='en'&&g.wikiEnTitle?'https://en.wikipedia.org/wiki/'+encodeURIComponent(String(g.wikiEnTitle).replace(/ /g,'_')):'https://'+wl+'.wikipedia.org/w/index.php?search='+encodeURIComponent(g.wikiEnTitle||g.title)});if(q){list.push({label:'YouTube',url:'https://www.youtube.com/results?search_query='+q+'%20gameplay'});list.push({label:'Twitch',url:'https://www.twitch.tv/search?term='+q});}if(g.sgdbId)list.push({label:'SteamGridDB',url:'https://www.steamgriddb.com/game/'+Number(g.sgdbId)});links[virtualAppIdFor(g.uuid)]=list;}return {links,artLocked,language:config.language||sysLang};};
 // Versão dos scripts injetados: muda quando o programa OU os arquivos da página mudam (ex.: atualização extraída com o
 // programa aberto). Assim a Steam sempre recebe a página nova, sem depender de reiniciar nada.
 let scriptStamp={at:0,v:''};const scriptVersion=()=>{if(Date.now()-scriptStamp.at<4000)return scriptStamp.v;let sig='';for(const f of ['steam/ngl.bundle.js','steam/ngl-boot.js','steam/ngl-host.js','steam/community.js','steam/shared.notify.js']){try{const st=fs.statSync(path.join(ROOT,f));sig+=st.size+'.'+Math.round(st.mtimeMs)+';';}catch{}}scriptStamp={at:Date.now(),v:VERSION+'-'+digest(sig).slice(0,10)};return scriptStamp.v;};
 const nglBundle=()=>{const f=path.join(ROOT,'steam/ngl.bundle.js');return isFile(f)?fs.readFileSync(f,'utf8'):'';};
 const community=new SteamCommunity({request:(u,o)=>providers.request(u,o),requestText:(u,o)=>providers.requestText(u,o),language:()=>config.language||sysLang});
 // AppID da Steam vinculado: associação manual, ficha, detecção (steam_appid etc.) ou jogo nativo.
 // Páginas do perfil na Comunidade Steam (Jogos, Recém-jogados, Concluídos, Conquistas) com os jogos do Taiga Launcher.
 // Comentários online dos jogos sem página na Steam (servidor do Taiga Launcher; login pela Steam).
 const comments=createComments({server:()=>providers.server(),config:()=>config,saveConfig,log:m=>nglNote(m)});
 // Ports e recompilações: o jogo original (nome e console do perfil do port ou do PARAM.SFO do dump), seja qual for a
 // versão ou o nome do .exe. Assim todos com o mesmo jogo (port ou emulador) veem os mesmos comentários.
 function originalIdentity(g){let prof=null,port=null;if(['pc','custom'].includes(g.profile)&&/\.exe$/i.test(g.path||'')){try{prof=portProfile(g);}catch{}try{port=portOf(g);}catch{}}return {title:prof?.title||port?.title||'',platform:prof?.platform||port?.platform||platformOf(g)?.key||''};}
 // Parte de baixo da página dos jogos sem página na Steam: sua atividade, trailers, capturas e jogos parecidos.
 const gameExtras=createGameExtras({cacheDir:path.join(dataDir,'cache'),ig:q=>providers.ig(q),igAvailable:()=>{try{return !!providers.igAvailable?.();}catch{return false;}},image:url=>providers.image(url),log:m=>nglNote(m)});
 async function extrasCall(args){
  const g=args&&args.shortcut_app_id?shortcutGame(args.shortcut_app_id):null;if(!g||g.native||g.demo||steamAppIdFor(g))return {enabled:false};
  const ach=achievementManager.cached(g),iconUrl=u=>{const v=String(u||'');if(v.startsWith('/art/'))return artUrl(v.slice(5));return /^https:\/\//.test(v)?v:'';};
  const activity=buildGameActivity({achievements:ach?.achievements||[],iconUrl});
  const id=originalIdentity(g),opts={title:id.title||g.title,platformIgdb:Number(platformOf(g)?.igdb)||0,onResolved:()=>persist()};
  const media=args.wait?await gameExtras.wait(g,opts):gameExtras.get(g,opts);
  const owned=new Map();for(const o of db.games){if(o.demo||o.hidden)continue;const sid=Number(o.bindings?.[config.account])>>>0;if(sid)owned.set(commentTitle(o.title),sid);}
  const similar=(media.similar||[]).map(s=>({name:s.name,cover:artUrl(s.cover),year:s.year||null,family:!!s.family,shortcut:owned.get(commentTitle(s.name))||null})).filter(s=>s.cover);
  return {enabled:true,activity,videos:(media.videos||[]).map(v=>({id:v.id,name:v.name,thumb:artUrl(v.thumb)||''})),shots:(media.shots||[]).map(artUrl).filter(Boolean),similar,pending:!!media.pending};
 }
 async function commentsCall(method,args){
  const g=args&&args.shortcut_app_id?shortcutGame(args.shortcut_app_id):null,target=g&&!g.native&&!g.demo&&!steamAppIdFor(g)?g:null;
  const key=target?gameCommentKey(target,originalIdentity(target)):'';
  try{
   if(method==='taiga_comments_state'){const st=comments.state();if(!key||!st.available)return {enabled:false};if(st.loggedIn&&Date.now()-Date.parse(config.commentsAuth?.at||0)>6*3600000){config.commentsAuth.at=new Date().toISOString();comments.refreshMe().catch(()=>{});}let page;try{page=await comments.list(key,{sort:args.sort==='popular'?'popular':'recent',offset:Math.max(0,Number(args.offset)||0),lang:commentLang(config.language||sysLang),all:args.all===true});}catch(e){page={items:[],error:e.code||'offline'};}return {enabled:true,game:String(target.title||'').slice(0,120),lang:commentLang(config.language||sysLang),...comments.state(),...page};}
   if(method==='taiga_comments_post'){if(!key)return {ok:false,error:'game'};return {ok:true,...await comments.post(key,String(args.text||'').slice(0,4000),commentLang(config.language||sysLang))};}
   if(method==='taiga_comments_delete')return await comments.remove(String(args.id||''));
   if(method==='taiga_comments_report')return await comments.report(String(args.id||''));
   if(method==='taiga_comments_like')return await comments.like(String(args.id||''),args.like!==false);
   if(method==='taiga_comments_login')return {ok:true,...await comments.startLogin()};
   if(method==='taiga_comments_login_state')return comments.state();
   if(method==='taiga_comments_logout')return await comments.logout();
   // Traduz um comentário que a página mostrou (pelo número; o texto vem do que o servidor mandou).
   if(method==='taiga_comments_translate'){const c=comments.seenComment(String(args.id||''));if(!c)return {ok:false,error:'not_found'};const target=config.language||sysLang;const lang=['pt-BR','en','es','fr','de'].includes(target)?target:'en';try{const text=await translateText(c.body,dataDir,u=>providers.request(u),lang,c.lang||'auto');return {ok:true,text:String(text||'').slice(0,2000)};}catch{return {ok:false,error:'translate'};}}
  }catch(e){if(!e?.code)nglNote('Comentários ('+method+'): '+String(e?.message||e).slice(0,200));return {ok:false,error:e?.code||'offline',minLevel:e?.minLevel||null,wait:e?.wait||null,detail:e?.detail||''};}
  throw Error('Não permitido.');
 }
 const profilePages=createCommunity({artOrigin:name=>{try{return providers.artOrigin?.(name)||'';}catch{return '';}},language:()=>config.language||sysLang,games:()=>db.games,account:()=>config.account,steamId:()=>{try{return config.steamDir?win.accounts(config.steamDir).find(a=>a.id===config.account)?.steamId||'':'';}catch{return '';}},steamAppIdOf:g=>steamAppIdFor(g),virtualAppIdOf:uuid=>nglBackend.virtualAppIdFor(uuid),playtimeOf:(g,sid)=>nglBackend.playtimeFor({shortcut_app_id:String(sid)}),achievementsOf:g=>achievementManager.get(g),cachedAchievementsOf:g=>achievementManager.cached(g),artDir:path.join(dataDir,'art'),port,imageThumb,log:nglNote});
 // Perfil para amigos (opcional, sem servidor por padrão): arquivo pequeno com os jogos do Taiga Launcher.
 const publicProfile=createPublicProfile({dir:dataDir,config:()=>config,build:()=>profilePages.publicProfile(),log:nglNote});
 const steamAppIdFor=g=>Number(g.steamLink?.appId||g.achievementSettings?.steamAppId||g.metadataSteamAppId||0)||null;
 const steamLink=new SteamLinkService({dir:dataDir,providers,config:()=>config});
 // Vinculação automática ao AppID (NativeGameLink, item 7): evidência na pasta; senão, nome confirmado na loja Steam.
 // Ligação automática ao AppID da Steam, da prova mais forte para a mais fraca (2.2.5):
 //  1. arquivos da pasta do jogo que guardam o AppID (steam_appid.txt ao lado da steam_api.dll, steam_settings, .ini
 //     de emuladores de Steam, appmanifest), procurando também nas subpastas; vale mais que uma ligação antiga por nome;
 //  2. ID da loja (Epic, GOG, Xbox) pelo IGDB/SteamGridDB;
 //  3. Wikidata (P1733) do jogo já identificado;
 //  4. busca pelo nome na Steam; os candidatos são conferidos pela ficha pública da Steam (o .exe que ela abre existe
 //     na pasta, ou a pasta de instalação tem o mesmo nome);
 //  5. nome exato e único (com o nome do produto gravado pelo motor do jogo ou o da Wikipédia como confirmação).
 // Sem nenhuma dessas provas, o jogo fica "para confirmar" com os candidatos.
 const autoSteamLink=async g=>{if(config.preferences.autoLookup===false||!['pc','custom','store'].includes(g.profile)||g.steamLinkDisabled||g.steamLink)return;
  const root=g.gameRoot||g.suggestedRoot||(g.path&&/\.exe$/i.test(g.path)?path.dirname(g.path):''),now=()=>new Date().toISOString();
  const found=(id,source,name)=>{g.metadataSteamAppId=Number(id);g.steamDetection={source,name:name||g.title,at:now()};delete g.steamLinkPending;delete g.steamLinkCandidates;persist();return Number(id);};
  let appId=null;
  // 1. Prova na pasta.
  if(root&&isGameFolder(root)&&!(g.steamProof?.root===root&&Date.now()-g.steamProof.at<7*86400000)){let r=null;try{r=localSteamProof(g);}catch{}g.steamProof={root,at:Date.now(),appId:r?.appId||0,source:r?.source||''};persist();}
  if(g.steamProof?.appId&&g.steamProof.root===root)appId=Number(g.metadataSteamAppId)===g.steamProof.appId?g.steamProof.appId:found(g.steamProof.appId,'file:'+g.steamProof.source);
  if(!appId)appId=achievementManager.detectSteamId(g);
  if(root&&g.engineProduct===undefined){try{g.engineProduct=engineProductName(root)?.product||'';}catch{g.engineProduct='';}}
  // 2. Jogo de loja (Epic, GOG, Xbox…): o ID da loja diz qual é o jogo na Steam, sem depender do nome.
  if(!appId&&g.store&&!g.storeSteamCheckedAt){try{const r=await steamIdFromStore(g,providers,{log:m=>nglNote('[steam-id] '+m)});g.storeSteamCheckedAt=Date.now();if(r?.appId)appId=found(r.appId,'store-id:'+r.source,r.name);persist();}catch{}}
  // 3. Bancos que guardam o AppID de cada jogo (Wikidata, PCGamingWiki, IGDB, SteamGridDB) e a busca exata da Steam,
  //    conferidos na loja (jogo base): liga quando fontes independentes concordam; se discordarem, pede confirmação.
  if(!appId&&!(g.steamResolve?.at&&Date.now()-g.steamResolve.at<3*86400000)){try{const r=await resolveSteamAppId(g,{providers,steamLink,local:false,log:m=>nglNote('[steam-id] '+g.title+': '+m)});g.steamResolve={at:Date.now(),appId:r.appId||0,via:r.via,candidates:(r.candidates||[]).slice(0,4).map(c=>({appId:c.appId,title:c.title,score:Math.round(c.score*100)/100,image:'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/'+c.appId+'/capsule_231x87.jpg',via:c.via}))};if(r.confident&&r.appId)appId=found(r.appId,'consenso:'+r.via.join('+'),r.name);persist();}catch{}}
  // 4. Nome na Steam. A busca só é marcada como feita quando a Steam respondeu.
  if(!appId&&(!g.steamNameCheckedAt||Date.now()-g.steamNameCheckedAt>7*86400000)){try{const r=await steamAppByName({...g,storeName:g.storeName||g.launch?.storeName||(g.store?g.title:undefined)},steamLink);g.steamNameCheckedAt=Date.now();if(r.confident)appId=found(r.appId,'name',r.name);else{const seen=new Set();g.steamLinkCandidates=[...(g.steamResolve?.candidates||[]),...r.candidates.map(c=>({appId:c.appId,title:c.name,score:Math.round(c.score*100)/100,image:c.image||''}))].filter(c=>!seen.has(c.appId)&&seen.add(c.appId)).slice(0,8);if(r.candidates.length)g.steamLinkPending=true;delete g.steamVerifyAt;}}catch{}persist();}
  //    Candidatos conferidos pela ficha da Steam (.exe / pasta de instalação).
  if(!appId&&g.steamLinkCandidates?.length&&root&&!(g.steamVerifyAt&&Date.now()-g.steamVerifyAt<86400000)){g.steamVerifyAt=Date.now();try{const v=await verifyCandidates(g.steamLinkCandidates.filter(c=>c.score>=.5),{exes:folderExecutables(root,g.path),folder:path.basename(root),request:u=>providers.request(u)});if(v)appId=found(v.appId,'steam-'+v.by+':'+v.detail,v.name);}catch{}persist();}
  // 5. Nome exato e único.
  if(!appId&&Array.isArray(g.steamLinkCandidates)&&g.steamLinkCandidates.length){const key=t=>normalizeTitle(String(t||'').replace(/[™®©]/g,''));const exact=g.steamLinkCandidates.filter(c=>c.score>=.99&&[g.title,g.wikiEnTitle,g.engineProduct].some(t=>t&&key(t)===key(c.title)));const close=g.steamLinkCandidates.filter(c=>c.score>=.9);if(exact.length===1&&close.length===1)appId=found(exact[0].appId,'name-exact',exact[0].title);}
  // Ligado à Steam: nome, descrição e artes oficiais (capa, fundo, logo, ícone) entram na hora, antes de o jogo ir
  // para a Steam; se a Steam não responder agora, fica na fila e tenta de novo.
  if(appId){let done=false;if(!g.steamLink&&!closed)try{await steamLink.apply(g,appId);persist();done=!!g.steamLink;achievementManager.get(g).catch(()=>{});}catch{}
   if(!done)queue.add('steam-link-refresh',{uuid:g.uuid,gameId:g.id,appId,account:config.account},'steam-link:'+g.uuid+':'+appId+':'+(config.language||sysLang));}};
 // Port + pasta do console: a versão de emulador entra no port (escondida, com o motivo) em vez de ficar duplicada.
 // Jogo sem ícone próprio: a Steam mostraria o ícone do .exe do Taiga Launcher (e guardava o antigo). Usa o ícone do
 // programa de forma explícita, gravado na pasta de artes da Steam, para ficar sempre o atual.
 const launcherIcon=grid=>{try{const src=path.join(ROOT,'desktop','icon.ico'),dest=path.join(grid,'taiga-launcher_icon.ico');if(!isFile(src))return '';const bytes=fs.readFileSync(src);if(!isFile(dest)||!fs.readFileSync(dest).equals(bytes)){fs.mkdirSync(grid,{recursive:true});atomic(dest,bytes);}return dest;}catch{return '';}};
 // Capa na hora ao adicionar: a prévia já baixada na identificação ou a primeira capa do SteamGridDB (a mesma que a
 // busca completa escolheria, para não trocar depois); sem ela, Steam/libretro/Wikipedia. O resto vem em seguida.
 async function quickCover(g,choice){if(g.art?.cover||g.artPinned?.cover)return false;try{
  if(choice?.previewArt&&isFile(path.join(dataDir,'art',path.basename(choice.previewArt)))){g.art={...(g.art||{}),cover:path.basename(choice.previewArt)};return true;}
  if(providers.sgAvailable?.()){let id=choice?.sgdb?.id||g.sgdbId;if(!id){const name=choice?.igdb?.name||g.title;const found=await providers.sg('search/autocomplete/'+encodeURIComponent(name));const exact=(found||[]).filter(x=>titleKey(x.name)===titleKey(name));if(exact.length===1)id=exact[0].id;}
   if(id){const imgs=await providers.sg('grids/game/'+Number(id)+'?types=static&mimes=image/png,image/jpeg&dimensions=600x900');const img=(imgs||[]).find(x=>!x.nsfw&&!x.humor&&x.url);if(img){g.art={...(g.art||{}),cover:await providers.image(img.url)};return true;}}}
  if(providers.findCover)return !!(await providers.findCover(g));
 }catch{}return false;}
 // Port nativo para PC (feito a partir do arquivo original do jogo) tem prioridade sobre a versão do emulador:
 // quando um port é encontrado e o mesmo jogo já está na coleção pelo emulador, o port entra no lugar (com as artes
 // e os dados que o jogo já tinha) e a versão do emulador fica guardada em "Removidos" (dá para separar de novo).
 const isDir=p=>{try{return fs.statSync(p).isDirectory();}catch{return false;}};
 const insideDir=(p,dir)=>{try{const a=path.resolve(String(p)).toLowerCase(),b=path.resolve(String(dir)).toLowerCase();return a===b||a.startsWith(b+path.sep)||a.startsWith(b+'/')||a.startsWith(b+'\\');}catch{return false;}};
 const codeKey=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 const PORT_AUX=/^(unins|setup|install|crash|report|vc_?redist|dxsetup|dotnet|ue4prereq|easyanticheat|update|patch|config)/i;
 // Port com tela de configurações antes do jogo: usa o argumento do iniciador "Play ..." para abrir direto no jogo.
 function applyDirectPlay(g){if(g.demo||g.profile!=='pc'||!g.path||(g.launch&&g.launch.args!==undefined&&g.launch.args!==null))return false;let dp=null;try{dp=directPlay(g.path);}catch{}if(!dp?.args)return false;g.launch={...(g.launch||{}),args:dp.args,argsSource:'port'};nglNote('Abrir direto no jogo: '+g.title+' com '+dp.args+' (como '+path.basename(dp.wrapper)+').');return true;}
 // Port de console para PC (SpartanPort e parecidos) escolhido como se fosse emulador: entra como jogo de PC.
 function portMainExe(target){let dir=target,exe='';try{if(fs.statSync(target).isFile()){dir=path.dirname(target);exe=target;}}catch{return null;}
  let names=[];try{names=fs.readdirSync(dir).filter(n=>/\.exe$/i.test(n));}catch{return null;}
  const marker=names.length&&(fs.existsSync(path.join(dir,'spartanport'))||names.some(n=>/spartanport/i.test(n))||fs.existsSync(path.join(dir,'settings.json'))&&names.some(n=>/^play /i.test(n)));
  const pick=()=>{const main=names.filter(n=>!/^(play|start|launch|run)\b/i.test(n)&&!/spartanport|unins|crash|setup/i.test(n)).map(n=>path.join(dir,n));const withWrapper=main.find(f=>{try{return !!directPlay(f)?.args;}catch{return false;}});if(withWrapper)return withWrapper;return main.sort((a,b)=>{try{return fs.statSync(b).size-fs.statSync(a).size;}catch{return 0;}})[0]||'';};
  if(exe&&/^(play|start|launch|run)\b/i.test(path.basename(exe))||exe&&/spartanport/i.test(path.basename(exe)))exe=pick()||exe;
  const candidate=exe||pick();if(!candidate)return null;let port=null;try{port=consoleTitleNear(candidate);}catch{}
  return port||marker?{exe:candidate,port}:null;}
 async function addPortGame(found){const existing=db.games.find(g=>!g.demo&&g.path&&String(g.path).toLowerCase()===found.exe.toLowerCase());if(existing){existing.hidden=false;persist();return existing;}
  const adopted=await adoptPorts([{path:found.exe,root:path.dirname(found.exe),title:found.port?.title||''}]);if(adopted[0])return getGame(adopted[0].id);
  const r=await addFiles([found.exe]);const g=r.addedIds?.[0]&&getGame(r.addedIds[0]);if(!g)throw Error(r.errors?.[0]?.message||'Não foi possível adicionar este port.');
  g.profile='pc';g.platformKey='pc';g.needsReview=false;g.gameRoot=path.dirname(found.exe);if(found.port?.title){g.title=found.port.title;g.titleSource='port';}applyDirectPlay(g);persist();
  (async()=>{try{await quickCover(g,null);}catch{}try{await autoSteamLink(g);}catch{}try{await providers.completeMissing?.(g);}catch{}persist();try{await autoAddToSteam([g.id]);}catch{}})();return g;}
 async function adoptPorts(candidates){
  const adopted=[];
  for(const it of candidates||[]){
   try{
    if(!it?.path||!/\.exe$/i.test(it.path)||!isFile(it.path)||PORT_AUX.test(path.basename(it.path)))continue;
    if(db.games.some(g=>!g.demo&&g.path&&String(g.path).toLowerCase()===String(it.path).toLowerCase()))continue;
    let port=null;try{port=consoleTitleNear(it.path);}catch{}if(!port?.dump||!isDir(port.dump))continue;
    const twin=db.games.find(g=>!g.demo&&!g.native&&!g.hidden&&!g.keepSeparate&&g.path&&!['pc','store','custom'].includes(g.profile||'psp')&&(insideDir(g.path,port.dump)||(codeKey(port.code).length>=9&&codeKey(g.serial||g.discId)===codeKey(port.code))));
    if(!twin)continue;
    const r=await addFiles([it.path]);const g=r.addedIds?.[0]&&getGame(r.addedIds[0]);if(!g)continue;
    g.profile='pc';g.needsReview=false;g.title=twin.title||it.title||port.title||g.title;applyDirectPlay(g);g.titleSource='port';g.gameRoot=it.root||path.dirname(it.path);g.platformName=PROFILES.pc?.platform||g.platformName;g.platformKey='pc';
    for(const k of ['metadata','metadataPinned','media','aliases'])if(twin[k]!==undefined)g[k]=structuredClone(twin[k]);
    g.art={...(twin.art||{}),...Object.fromEntries(Object.entries(g.art||{}).filter(([k])=>k==='icon'&&!twin.art?.icon))};if(twin.artPinned)g.artPinned={...twin.artPinned};
    for(const k of ['sgdbId','igdbId','wikidataId','wikiEnTitle'])if(twin[k]&&!g[k])g[k]=twin[k];
    const hadSteam=twin.bindings?.[config.account];
    mergePortTwins();
    if(!twin.hidden){twin.hidden=true;twin.mergedInto=g.id;twin.hiddenReason='port';g.consoleTwin={id:twin.id,profile:twin.profile,serial:twin.serial||twin.discId||'',platformName:twin.platformName||''};}
    persist();nglNote('Port para PC no lugar da versão do emulador: '+g.title+' ('+it.path+').');
    if(hadSteam)try{await sync([twin.id],{remove:true,restart:false});}catch(e){nglNote('Port: tirar a versão do emulador da Steam: '+e.message);}
    adopted.push({id:g.id,title:g.title,replaced:twin.id});
   }catch(e){nglNote('Port: '+e.message);}
  }
  if(adopted.length){try{await autoAddToSteam(adopted.map(a=>a.id));}catch{}try{injector?.reload?.();}catch{}}
  return adopted;
 }
 // Na abertura: procura um port perto de cada jogo de console da coleção (pasta do jogo e as vizinhas).
 async function findPortsNearConsoleGames(){
  const out=[],seen=new Set();
  for(const g of db.games){
   if(g.demo||g.native||g.hidden||g.keepSeparate||!g.path||['pc','store','custom'].includes(g.profile||'psp'))continue;
   let base=g.gameRoot||path.dirname(g.path);
   for(let up=0;up<3&&base;up++){const parent=path.dirname(base);if(parent===base)break;
    let entries=[];try{entries=fs.readdirSync(parent,{withFileTypes:true}).slice(0,80);}catch{}
    for(const e of entries){const full=path.join(parent,e.name);
     const exes=e.isFile()?(/\.exe$/i.test(e.name)?[full]:[]):(e.isDirectory()&&!insideDir(g.path,full)?(()=>{try{return fs.readdirSync(full).filter(n=>/\.exe$/i.test(n)).slice(0,10).map(n=>path.join(full,n));}catch{return [];}})():[]);
     for(const x of exes){const k=x.toLowerCase();if(!seen.has(k)){seen.add(k);out.push({path:x,root:path.dirname(x),title:g.title});}}
    }
    base=parent;if(out.length>200)break;
   }
  }
  return adoptPorts(out);
 }
 const mergePortTwins=()=>{let n=0;for(const g of db.games){if(g.hidden||g.demo||g.native||g.keepSeparate||['pc','store','custom'].includes(g.profile||'psp'))continue;const twin=portTwinOf(db.games,g,portOf);if(!twin)continue;g.hidden=true;g.mergedInto=twin.game.id;g.hiddenReason='port';twin.game.consoleTwin={id:g.id,profile:g.profile,serial:g.serial||g.discId||'',platformName:g.platformName||''};n++;}if(n){persist();nglNote('Port e pasta do console unidos: '+n+' jogo(s).');}return n;};
 const assignUUIDs=()=>{const used=new Set();let changed=0;for(const g of db.games){if(!UUID.test(g.uuid||'')||used.has(g.uuid)){g.uuid=crypto.randomUUID();changed++;}used.add(g.uuid);}return changed;};if(assignUUIDs()){if(fs.existsSync(dbFile)){const backup=path.join(dataDir,'backups');fs.mkdirSync(backup,{recursive:true});fs.copyFileSync(dbFile,path.join(backup,'games-before-uuid-'+Date.now()+'.json'));}save(dbFile,db);}
 let dataVersion=1,packaging=null;
 const TEST_TEXT={'pt-BR':['Teste do Taiga Launcher','Se você está vendo isto com som, as notificações estão funcionando.'],en:['Taiga Launcher test','If you see this with sound, notifications are working.'],es:['Prueba de Taiga Launcher','Si ves esto con sonido, las notificaciones funcionan.'],fr:['Test de Taiga Launcher','Si vous voyez ceci avec le son, les notifications fonctionnent.'],de:['Taiga Launcher Test','Wenn du das mit Ton siehst, funktionieren die Benachrichtigungen.']};
 const TX_SERVER=k=>{const r=TEST_TEXT[config.language||sysLang]||TEST_TEXT.en;return k==='test.title'?r[0]:r[1];};
 const persist=()=>{dataVersion++;assignUUIDs();save(dbFile,db);if(nativeGames.size){const f=path.join(dataDir,'steam-art-edits.json'),stored=json(f,{});for(const [id,g] of nativeGames)stored[id]={art:g.art,artPinned:g.artPinned,sgdbId:g.sgdbId,achievementSettings:g.achievementSettings,metadataSteamAppId:g.metadataSteamAppId};save(f,stored);}},getGame=id=>{const g=db.games.find(x=>x.id===id)||nativeGames.get(id);if(!g)throw Error('Jogo não encontrado.');return g;};
 if(db.games.map(ensureDemoSize).some(Boolean))persist();
 // 1.9.2: a limpeza automática do NativeGameLink desligava a página de jogos adicionados com a Steam aberta
 // (o atalho ainda não estava no shortcuts.vdf). Religa as páginas desligadas desse jeito.
 // 2.5.8: ports conhecidos e o RetroAchievements pelo console certo: quem já tentou antes tenta de novo agora.
 if(!config.raRetry258){config.raRetry258=true;saveConfig();let n=0;for(const g of db.games)if(g.raLookupAt&&!g.raId){delete g.raLookupAt;n++;}if(n)save(dbFile,db);}
 if(!config.nglRepair192){let n=0;for(const g of db.games)if(g.nglDismissed){delete g.nglDismissed;n++;}config.nglRepair192=true;saveConfig();if(n)save(dbFile,db);}
 // 2.2.3: jogos de loja/PC que perderam a ligação com a Steam (limpeza automática do NGL) são procurados de novo.
 if(!config.steamRelink223){config.steamRelink223=true;saveConfig();const todo=db.games.filter(g=>!g.demo&&!g.hidden&&['pc','custom','store'].includes(g.profile)&&!g.steamLinkDisabled&&!steamAppIdFor(g));for(const g of todo){delete g.storeSteamCheckedAt;delete g.steamNameCheckedAt;}if(todo.length)save(dbFile,db);}
 // 1.4.0: cadastros antigos ganham a chave de plataforma do catálogo (sem alterar o nome exibido).
 {let changed=false;for(const g of db.games)if(!g.platformKey){const p=platformByName(g.platformName||(g.demo?'':'PlayStation Portable'));if(p){g.platformKey=p.key;changed=true;}}if(changed)save(dbFile,db);}
 const scriptTarget=()=>path.join(config.scriptDir||path.join(config.steamDir,'steamui'),'libraryroot.custom.js');
 // O caminho do .exe só entra na assinatura quando não é o nome antigo: ao trocar TaigaPSP.exe por "Taiga Launcher.exe",
 // os atalhos da Steam ficam pendentes e são regravados apontando para o executável novo.
 const exeMark=launcherExecutable&&!/(^|[\\/])TaigaPSP\.exe$/i.test(launcherExecutable)?launcherExecutable.toLowerCase():null;
 const signature=g=>digest(JSON.stringify([g.title,launcherExecutable&&!g.demo?g.uuid:g.path,...(exeMark&&!g.demo?[exeMark]:[]),g.demo?demoExecutable:launcherExecutable||config.emulator,launcherExecutable?null:g.profile,launcherExecutable?null:g.launch,launcherExecutable?null:config.launchers,g.media,Object.entries(g.art||{}).sort(),g.metadata,g.raId,g.bytes,g.installedBytes,g.platformName,g.sizeSynthetic,g.sizeBasis,g.sizeApproximate,[g.steamLink?.appId,g.steamLink?.about,g.steamLink?.language]]));
 const isFile=p=>{try{return fs.statSync(p).isFile();}catch(e){return /\.exe$/i.test(String(p))&&(e?.code==='EPERM'||e?.code==='EACCES');}};
 const metadataView=g=>{const m={...(g.metadata||{})};if(config.language&&m.summaryLanguage&&m.summaryLanguage!==config.language&&!g.metadataPinned?.summary&&m.summaryOriginal){m.summary=m.summaryOriginal;m.summaryLanguage=m.summaryOriginalLanguage||'en';}return m;};
 const sessions=new SessionStore(dataDir);let discoveryResult=null,discoveryAt=0,scanStatus={newCandidates:0,errors:[]};
 // Etapa da busca de jogos, para a tela mostrar o andamento (e não só "Procurando...").
 let discoverProgress={phase:'',done:0,total:0,at:0};const setDiscoverProgress=(phase,done=0,total=0)=>{discoverProgress={phase,done,total,at:Date.now()};};
 const steamLaunchFor=g=>{const direct=launchFor(g,config,demoExecutable);return launcherExecutable&&!g.demo?{exe:launcherExecutable,args:'--taiga-launch '+g.uuid}:direct;};
 const matchesLaunch=(entry,g)=>{const direct=launchFor(g,config,demoExecutable),proxy=steamLaunchFor(g);if(windowsPath(entry.exe)===windowsPath(proxy.exe)&&entry.options===proxy.args)return true;if(windowsPath(entry.exe)!==windowsPath(direct.exe))return false;if(g.profile==='pc')return true;return windowsPath(entry.options).includes(windowsPath(g.path));};
 const publicGame=g=>({id:g.id,uuid:g.uuid,steamAppId:Number(g.steamLink?.appId||g.achievementSettings?.steamAppId||g.metadataSteamAppId||0)||null,...gameStatus(g,config),playtime:sessions.forGame(g.uuid,config.account),steamLink:g.steamLink||null,steamLinkDisabled:!!g.steamLinkDisabled,steamLinkPending:!!g.steamLinkPending&&!g.steamLink&&!g.steamLinkDisabled,title:g.title,platformKey:platformOf(g)?.key||null,platformShort:platformOf(g)?.short||null,serial:g.serial||'',region:Array.isArray(g.region)?g.region:[],canonicalName:g.canonicalName||null,addedAt:g.addedAt||null,identification:g.identification||null,hidden:!!g.hidden,demo:!!g.demo,external:!!g.external,sizeBasis:g.sizeBasis||null,sizeApproximate:!!g.sizeApproximate,sizeSynthetic:!!g.sizeSynthetic,platformInferred:!!g.platformInferred,profile:g.profile||'psp',emulatorName:g.demo?null:emulatorDisplayName(g.profile||'psp',g.launch?.exe||config.launchers?.[g.profile||'psp']?.exe||(g.profile==='psp'||!g.profile?config.emulator:'')),media:g.media||[],platformName:g.platformName||'PlayStation Portable',presentationRevision:g.presentationRevision||0,discId:g.discId,bytes:Number.isFinite(g.installedBytes)?g.installedBytes:g.bytes,fileBytes:g.bytes,sizeKind:Number.isFinite(g.installedBytes)?'folder':(['pc','ps3'].includes(g.profile)?'executable':'file'),gameRoot:g.gameRoot||null,metadata:metadataView(g),art:g.art||{},raId:g.raId||null,cachedAchievements:achievementManager.cached(g)||((!g.achievementSettings?.provider||['auto','retroachievements'].includes(g.achievementSettings.provider))&&g.profile!=='ps3'?providers.cachedAchievements(g):null),achievementProvider:g.achievementSettings?.provider||'auto',language:config.language||sysLang,appId:g.bindings?.[config.account]||null,consolePort:['pc','custom'].includes(g.profile)&&!g.demo?(portOf(g)?.platform||null):null,aliases:g.aliases||[],available:!!g.demo||isFile(g.path),sgdbId:g.sgdbId||null,igdbId:g.igdbId||null,syncNeeded:!!g.bindings?.[config.account]&&(g.applied?.[config.account]!==signature(g)||!inSteamNow(g)),steamFound:inSteamNow(g)});
 function readSteamSnapshot(){try{const f=path.join(config.steamDir,'userdata',config.account,'config','shortcuts.vdf');steamSnapshot=fs.existsSync(f)?shortcutInfo(parseVDF(fs.readFileSync(f))):[];steamSnapshotAt=fs.existsSync(f)?fs.statSync(f).mtimeMs:0;}catch{steamSnapshot=[];steamSnapshotAt=0;}}
 // Adicionado com a Steam aberta: a Steam só grava o shortcuts.vdf depois. Até lá o jogo conta como "na Steam".
 let steamSnapshotAt=0;const inSteamNow=g=>{const id=g.bindings?.[config.account];if(!id)return false;if(steamSnapshot.some(e=>e.appId===id))return true;const at=Number(g.liveAdded?.[config.account]||0);return at>0&&steamSnapshotAt<at;};
 // Conquistas que só aparecem depois de conectar uma conta: Epic (login), GOG (usuário) e RetroAchievements (emuladores).
 const gogIds=new Map(),gogIdOf=g=>{const k=(g.path||'')+'|'+(g.gameRoot||'')+'|'+(g.store?.id||'');if(!gogIds.has(k))gogIds.set(k,gogProductId(g));return gogIds.get(k);};
 const raConnected=()=>{try{return !!providers.retro?.credentials?.();}catch{return false;}};
 // Conta de que as conquistas do jogo dependem (conectada ou não) e se ainda falta conectar.
 const accountKindOf=g=>{if(g.demo||g.native||(g.achievementSettings?.provider||'auto')==='none')return null;
  if(['pc','custom','store'].includes(g.profile)){if(g.store?.name==='xbox')return 'xbox';try{if(achievementManager.isEpicGame(g))return 'epic';}catch{}if(gogIdOf(g))return 'gog';return null;}
  if(platformOf(g)?.ra&&!['ps3','vita3k','shadps4'].includes(g.profile))return 'ra';return null;};
 const accountConnected=kind=>kind==='xbox'?!!config.xboxAuth?.msa:kind==='epic'?!!config.epicAuth?.accessToken:kind==='gog'?!!String(config.gogUser||'').trim():kind==='ra'?raConnected():true;
 const accountNeedOf=g=>{if(g.hidden)return null;const kind=accountKindOf(g);return kind&&!accountConnected(kind)?kind:null;};
 // Atalhos da Steam agrupados pelo nome normalizado (refeito só quando a lista muda).
 let steamTitleMap=null,steamTitleSrc=null;const steamByTitle=()=>{if(steamTitleSrc!==steamSnapshot){steamTitleSrc=steamSnapshot;steamTitleMap=new Map();for(const e of steamSnapshot||[]){const k=normalize(e.title);if(!steamTitleMap.has(k))steamTitleMap.set(k,[]);steamTitleMap.get(k).push(e);}}return steamTitleMap;};
 const privateGame=g=>({...publicGame(g),consoleTwin:g.consoleTwin||null,mergedInto:g.mergedInto||null,accountKind:accountKindOf(g),accountNeed:accountNeedOf(g),fromShortcut:!!g.shortcutSource,storeLabel:g.store?.label||'',notInstalled:!!g.notInstalled,install:g.notInstalled?installState(g):null,suspectedAuxiliary:!g.demo&&(auxiliaryExecutable(g.path)||/\.bin$/i.test(g.path)&&!g.discId&&g.profile!=='ps3'),path:g.path,launch:g.launch||{},achievementSettings:g.achievementSettings||{},metadataSteamAppId:g.metadataSteamAppId||null,launchReady:(()=>{try{if(!g.demo&&!g.notInstalled&&!isFile(g.path))return false;launchFor(g,config,demoExecutable);return true;}catch{return false;}})(),launchError:(()=>{if(g.demo||g.notInstalled)return '';if(!isFile(g.path))return 'FILE_MISSING';try{launchFor(g,config,demoExecutable);return '';}catch(e){return String(e?.message||e).slice(0,240);}})(),lookup:g.lookup||null,steamCandidates:(steamByTitle().get(normalize(g.title))||[]).map(e=>({appId:e.appId,title:e.title,exe:e.exe,path:e.path})),storeCover:!!(g.storeImages?.cover&&!g.art?.cover),artPinned:g.artPinned||{}});
 // known: leitura já feita na busca (arquivo conferido sem mudança): não lê e calcula a impressão digital de novo.
 async function addFiles(paths,{known=null}={}){let added=0,skipped=0;const inspected=known?{items:known,errors:[]}:await inventory('inspect',paths),errors=[...inspected.errors],addedIds=[],duplicates=[];
  for(const info of inspected.items)try{const file=info.path,old=db.games.find(g=>g.path.toLowerCase()===info.path.toLowerCase());if(old){skipped++;continue;}
   // Jogo já identificado na coleção (mesmo código de disco, arquivo idêntico, mesmo arquivo por outro caminho): não entra de novo.
   const dup=duplicateOf(db.games,info,{steamAppIdOf:steamAppIdFor,portOf});if(dup){skipped++;duplicates.push({file:info.path,id:dup.game.id,title:dup.game.title,reason:dup.reason});continue;}
   if(info.icon){atomic(path.join(dataDir,'art',info.id+'.png'),info.icon);info.art={icon:info.id+'.png'};}delete info.icon;const legacy=legacyPSP[normalize(info.title)];if(legacy){info.metadata=structuredClone(legacy.metadata);info.raId=legacy.raId;}info.bindings={};info.addedAt=new Date().toISOString();db.games.push(info);addedIds.push(info.id);added++;
  }catch(e){errors.push({file:info.path,message:e.message});}persist();if(addedIds.length)coverSoon();for(const d of duplicates)errors.push({file:d.file,message:duplicateMessage(d)});return {added,addedIds,skipped,errors,duplicates};
 }
 const duplicateMessage=d=>({serial:'Este jogo já está na coleção como "'+d.title+'" (mesmo código do disco).',identical:'Este arquivo é uma cópia idêntica de "'+d.title+'", que já está na coleção.',path:'Este arquivo já está na coleção como "'+d.title+'".',store:'Este jogo da loja já está na coleção como "'+d.title+'".',steam:'Este jogo já está na coleção como "'+d.title+'" (mesmo jogo da Steam).',port:'Esta é a pasta do console usada pelo port "'+d.title+'", que já está na coleção.'})[d.reason]||'Já está na coleção.';
 // Separa da lista da busca o que já está na coleção (inclusive por outro caminho) e cópias repetidas na própria busca.
 function splitDuplicates(items,existing){const fresh=[];for(const item of items){const dup=duplicateOf(db.games,item,{steamAppIdOf:steamAppIdFor,portOf});if(dup){if(dup.game.notInstalled&&item.store?.name&&isFile(item.path)){convertInstalled(dup.game,{store:item.store.name,storeName:item.store.label,id:item.store.id,namespace:item.store.namespace,appName:item.store.appName,url:item.store.url,needsLauncher:item.store.needsLauncher,launcherExe:item.store.launcherExe,path:item.path,root:item.gameRoot});persist();}if(!existing.some(e=>e.id===dup.game.id))existing.push({id:dup.game.id,title:dup.game.title,path:dup.game.path,hidden:!!dup.game.hidden,duplicate:dup.reason,file:item.path});continue;}const twin=duplicateOf(fresh.map(f=>({...f,profile:f.profile})),item);if(twin)continue;fresh.push(item);}return fresh;}
 const platformOf=g=>platformByKey(g.platformKey)||platformByName(g.platformName);
 // Guarda as opções de uma busca para o usuário escolher depois (cartões agrupados por jogo).
 const choiceCards=(found,{platformKey=null,query=''}={})=>externalResults(found,{platformKey,query}).map((option,i)=>{const key=crypto.randomBytes(16).toString('hex');externalChoices.set(key,{...option,at:Date.now()});const preferred=preferredPlatform(option,platformKey);return {key,name:option.name,platforms:option.platforms,preview:externalPreview(option)||(option.sgdb?.id||option.igdb?.name?'/choice-art/'+key:''),source:option.igdb?'IGDB':option.free?'libretro':'SteamGridDB',year:option.year??(option.igdb?.first_release_date?new Date(option.igdb.first_release_date*1000).getUTCFullYear():null),platformMatch:option.platformMatch,score:Math.round((option.score||0)*100)/100,best:i===0&&(option.score||0)>=.85&&option.platformMatch!==false,preferredPlatform:preferred?.name||null};});
 async function recognize(id,query){const g=getGame(id),platform=platformOf(g),q=query||(g.dat?.title)||g.title,found=await providers.candidates(q,{platformKey:platform?.key||null,allPlatforms:!platform,includeRA:!!config.raKey&&!!platform?.ra});matches.set(id,found);
  if(query)return {...found,grouped:choiceCards(found,{platformKey:platform?.key||null,query:q})};
  await autoSteamLink(g);
  const selected={missingOnly:true};
  // IGDB: pontuação por título + plataforma, aceitando só escolha clara.
  const scored=(found.igdb||[]).filter(isMainEntry).map(x=>({x,...scoreCandidate(q,x.name,{platformMatch:platform?(x.platforms||[]).some(p=>Number(p.id)===platform.igdb||platformByName(p.name)?.key===platform.key):null,aliases:(x.alternative_names||[]).map(a=>a.name)})}));
  const igdbChoice=confidentChoice(scored,{min:.9});if(igdbChoice&&(!g.igdbId||String(g.igdbId)===String(igdbChoice.x.id)))selected.igdb=igdbChoice.x;
  for(const key of ['sgdb','ra']){const names=[q,g.title,selected.igdb?.name].filter(Boolean);const exact=found[key].filter(x=>names.some(n=>titleKey(n)===titleKey(x.name)));const existing=g[{sgdb:'sgdbId',ra:'raId'}[key]];if(exact.length===1&&(!existing||String(existing)===String(exact[0].id)))selected[key]=exact[0];}
  // Título vindo do banco de dumps ("Nome - Subtítulo") passa ao nome oficial quando a IGDB confirma o jogo.
  if(selected.igdb&&g.titleSource==='dat'&&selected.igdb.name&&selected.igdb.name!==g.title){g.aliases=[...new Set([...(g.aliases||[]),g.title])];g.title=selected.igdb.name.slice(0,200);g.titleSource='igdb';}
  const warnings=await providers.enrich(g,selected);if(providers.completeMissing)warnings.push(...await providers.completeMissing(g));g.lookup={at:new Date().toISOString(),warnings:[...found.errors,...warnings],automatic:Object.keys(selected).filter(k=>k!=='missingOnly')};persist();return {...found,automatic:Object.keys(selected).filter(k=>k!=='missingOnly'),warnings};
 }
 function configView(){
  const accounts=config.steamDir?win.accounts(config.steamDir):[];
  const readiness={emulator:isFile(config.emulator)&&/^PPSSPPWindows(?:64)?\.exe$/i.test(path.basename(config.emulator)),steam:isFile(path.join(config.steamDir,'steam.exe')),account:accounts.some(a=>a.id===config.account),integration:false};
  const target=scriptTarget();
  if(config.steamDir&&isFile(target))try{readiness.integration=fs.readFileSync(target,'utf8').includes('Taiga Steam PSP 1.2')&&fs.readFileSync(target,'utf8').includes(config.readToken);}catch{}
  let raStatus=null;try{raStatus=providers.retro?.status()||null;}catch{}
  let raCores=null;if(isFile(config.launchers?.retroarch?.exe))try{raCores=retroArchPlatforms(config.launchers.retroarch.exe);}catch{raCores=[];}
  return {version:VERSION,setupDone:!!config.setupDone,seenVersion:config.seenVersion||'',updateFailure,supportHideUntil:Number(config.supportHideUntil)||0,supportLinks:config.supportLinks||{},retroarchAsked:!!config.retroarchAsked,emuCollectionName:config.emuCollectionName||'',retroarchPlatforms:raCores,epicInstallDir:config.epicInstallDir||'',epicInstallDefault:defaultEpicDir(),storeLogins:{epic:!!config.epicAuth,xbox:!!config.xboxAuth},notInstalledCount:db.games.filter(g=>g.notInstalled&&!g.hidden).length,githubRepo:updateRepo,discoveredAt:config.discoveredAt||null,profileServer:config.profileServer||'',discordClientId:config.discordClientId||'',discordReady:/^\d{17,20}$/.test(discordAppId()),shortcutFolder:config.shortcutFolder||'',publicProfileFile:path.join(dataDir,'public-profile.json'),epicAccount:config.epicAccount||'',epicLogin:config.epicAuth?.accountId?{name:config.epicAuth.displayName||'',id:config.epicAuth.accountId}:null,epicLoginAvailable:!!epicLogin,xboxLogin:config.xboxAuth?.msa?{name:config.xboxAuth.gamertag||''}:null,xboxLoginAvailable:!!xboxLogin,psnLoginAvailable:!!psnLogin,psnLogin:config.psnAuth?.access?{name:config.psnAuth.name||''}:null,epicDetected:achievementManager.epicAccount()&&!config.epicAccount&&!config.epicAuth?.accountId?{id:achievementManager.epicAccount(),source:achievementManager.epicSource()}:null,gogUser:config.gogUser||'',injectSteam:config.injectSteam!==false,autoRestartSteam:config.autoRestartSteam===true,steamNeedsRestart:integration.needsRestart&&config.injectSteam!==false,steamDebugPort:Number(config.steamDebugPort)||DEFAULT_DEBUG_PORT,platforms:platformList(),ra:raStatus,vita3kRoot:config.vita3kRoot||'',shadps4Root:config.shadps4Root||'',ps4TrophyKey:config.ps4TrophyKey||'',raUseEmulatorAccounts:config.raUseEmulatorAccounts!==false,launcherReady:!!launcherExecutable,emulatorNames:[...new Set([...(isFile(config.emulator)?['PPSSPP']:[]),...Object.entries(config.launchers||{}).filter(([,l])=>isFile(l.exe)).map(([p])=>PROFILES[p]?.name).filter(Boolean)])],emulatorDiscovery:discoveryResult,scanStatus,language:config.language||sysLang,languageChosen:!!config.language,achievementRoot:config.achievementRoot||'',rpcs3Root:config.rpcs3Root||'',rpcs3User:config.rpcs3User||'00000001',profiles:PROFILES,launchers:config.launchers||{},emulator:config.emulator,steamDir:config.steamDir,scriptDir:config.scriptDir||'',scriptFile:scriptTarget(),account:config.account,roots:config.roots,raUser:config.raUser,preferences:config.preferences,credentials:Object.fromEntries(['sgdbKey','igdbId','igdbSecret','raKey','steamKey','raToken'].map(k=>[k,!!config[k]])),accounts,readiness,integrationStatus};
 }
 function validatePaths(requireEmulator=true){
  if(requireEmulator&&(!isFile(config.emulator)||!/^PPSSPPWindows(?:64)?\.exe$/i.test(path.basename(config.emulator))))throw Error('Selecione PPSSPPWindows64.exe ou PPSSPPWindows.exe nas configurações.');
  if(!isFile(path.join(config.steamDir,'steam.exe')))throw Error('Selecione a pasta da Steam.');
  if(!win.accounts(config.steamDir).some(a=>a.id===config.account))throw Error('Selecione uma conta Steam válida.');
 }
 function scriptBytes(){const shared=fs.readFileSync(path.join(ROOT,'web/achievement-view.cjs'),'utf8')+'\n;globalThis.TaigaAchievementView.css='+JSON.stringify(fs.readFileSync(path.join(ROOT,'web/achievement-view.css'),'utf8'))+';\n';const catalog=db.games.filter(g=>g.bindings?.[config.account]).map(publicGame);const snapshot=JSON.stringify(catalog).replaceAll('<','\\u003c').replaceAll('>','\\u003e');return fs.readFileSync(path.join(ROOT,'locales/catalog.cjs'),'utf8')+'\n'+fs.readFileSync(path.join(ROOT,'locales/runtime.cjs'),'utf8')+'\n'+shared+fs.readFileSync(path.join(ROOT,'steam/libraryroot.custom.js'),'utf8').replace('__TAIGA_LANGUAGE__',config.language||sysLang).replace('__TAIGA_READ_TOKEN__',config.readToken).replace('/*__TAIGA_CATALOG__*/[]',snapshot);}
 function bigPictureBytes(){const catalog=db.games.filter(g=>g.bindings?.[config.account]).map(publicGame);const snapshot=JSON.stringify(catalog).replaceAll('<','\\u003c').replaceAll('>','\\u003e');const file=path.join(ROOT,'steam/bigpicture.custom.js');if(!isFile(file))return '';return fs.readFileSync(path.join(ROOT,'locales/catalog.cjs'),'utf8')+'\n'+fs.readFileSync(path.join(ROOT,'locales/runtime.cjs'),'utf8')+'\n'+fs.readFileSync(file,'utf8').replace('__TAIGA_LANGUAGE__',config.language||sysLang).replace('__TAIGA_READ_TOKEN__',config.readToken).replace('/*__TAIGA_CATALOG__*/[]',snapshot).replace('__TAIGA_PORT__',String(port));}
 function installScript(){validatePaths(false);const target=scriptTarget(),template=scriptBytes();
  if(fs.existsSync(target)&&fs.readFileSync(target,'utf8')!==template)fs.copyFileSync(target,target+'.backup-'+Date.now());atomic(target,template);
  return {message:'Painel PSP instalado com catálogo local e backup do script anterior. Reinicie a Steam com o SFP ativo.'};
 }
 const liveScript=()=>fs.readFileSync(path.join(ROOT,'steam/live-sync.js'),'utf8');
 async function liveReady(){if(!injector||config.injectSteam===false)return false;try{return await injector.evaluateShared('!!(window.SteamClient&&window.SteamClient.Apps&&typeof window.SteamClient.Apps.AddShortcut==="function"&&window.appStore)')===true;}catch{return false;}}
 // Coleções de um jogo na Steam: "Taiga Launcher" e, com a opção ligada, a coleção da loja ("Epic Games", "Xbox"...).
 const EMU_COLLECTION={'pt-BR':'Emuladores',en:'Emulators',es:'Emuladores',fr:'Émulateurs',de:'Emulatoren'};
 const emuCollectionLabel=()=>config.emuCollectionName||(config.emuCollectionName=EMU_COLLECTION[config.language||sysLang]||EMU_COLLECTION.en);
 const isEmulatorGame=g=>!!g&&!g.native&&!g.demo&&!g.store&&!['pc','store','custom'].includes(g.profile||'psp');
 // Coleção do jogo por grupo: a loja ("Epic Games", "Xbox"...) ou "Emuladores", cada uma com a sua opção.
 const groupCollectionName=(g,{all=false}={})=>{if(!g)return '';if(g.store?.label)return all||config.preferences.storeCollections?String(g.store.label).slice(0,60):'';if(isEmulatorGame(g))return all||config.preferences.emuCollection?emuCollectionLabel():'';return '';};
 const storeCollectionName=g=>groupCollectionName(g);
 const storeLabels=()=>[...new Set([...db.games.map(g=>g.store?.label).filter(Boolean).map(l=>String(l).slice(0,60)),...(config.emuCollectionName?[config.emuCollectionName]:[])])];
 // Coleções por loja para a gravação com a Steam fechada: cada loja recebe os atalhos dos seus jogos.
 const storeCollectionSpecs=updates=>{if(!config.preferences.storeCollections&&!config.preferences.emuCollection)return [];const idOf=g=>{const p=updates.find(([item])=>item.id===g.id);return p?p[1]:g.bindings?.[config.account];};const specs=new Map();
  for(const g of db.games){const name=storeCollectionName(g);if(!name)continue;const spec=specs.get(name)||{name,add:[],remove:[]};const id=idOf(g);if(id&&!g.hidden)spec.add.push(id);specs.set(name,spec);}
  for(const [g,id] of updates)if(!id){const name=storeCollectionName(g);const old=g.bindings?.[config.account];if(name&&old){const spec=specs.get(name)||{name,add:[],remove:[]};spec.remove.push(old);specs.set(name,spec);}}
  return [...specs.values()];};
 // Liga/desliga as coleções por loja. Steam aberta com a integração: na hora; fechada: no arquivo de coleções.
 async function applyStoreCollections(){
  if(!config.steamDir||!config.account)return {ok:false};
  // Cada grupo liga ou desliga pela sua opção: lojas (storeCollections) e emuladores (emuCollection).
  const groups=new Map(),onFor=new Map();
  for(const g of db.games){if(g.demo||g.hidden)continue;const name=groupCollectionName(g,{all:true});if(!name)continue;const id=Number(g.bindings?.[config.account])>>>0;if(!id)continue;(groups.get(name)||groups.set(name,[]).get(name)).push(id);onFor.set(name,g.store?.label?!!config.preferences.storeCollections:!!config.preferences.emuCollection);}
  const on=[...onFor.values()].some(Boolean);
  const made=new Set(config.storeCollectionsMade||[]);
  if(await win.running().catch(()=>false)){
   if(!(await liveReady()))return {ok:false,pending:true};
   const script=`(async function(groups,onMap,made){const cs=window.collectionStore;if(!cs)return 'no';const find=n=>Array.from(cs.userCollections||[]).find(c=>c&&!c.bIsDynamic&&(c.displayName===n||c.m_strName===n));const ov=id=>{try{return window.appStore.GetAppOverviewByAppID(id>>>0)}catch(e){return null}};const out=[];
    for(const [name,ids] of groups){let col=find(name);const on=!!onMap[name];if(on){if(!col&&cs.NewUnsavedCollection){col=cs.NewUnsavedCollection(name,undefined,[]);if(col&&col.Save)await col.Save();out.push(name);}if(col&&col.AsDragDropCollection){const apps=ids.map(ov).filter(Boolean);if(apps.length)col.AsDragDropCollection().AddApps(apps);if(col.Save)await col.Save();}}
     else if(col&&made.includes(name)){try{const apps=ids.map(ov).filter(Boolean);if(apps.length&&col.AsDragDropCollection)col.AsDragDropCollection().RemoveApps(apps);if(col.Save)await col.Save();}catch(e){}try{const left=(col.allApps||col.visibleApps||[]).length;if(!left){if(typeof col.Delete==='function')await col.Delete();else if(typeof cs.DeleteCollection==='function')await cs.DeleteCollection(col.id);}}catch(e){}}}
    return JSON.stringify(out);})`;
   let r='';try{r=await injector.evaluateShared(script+'('+JSON.stringify([...groups])+','+JSON.stringify(Object.fromEntries(onFor))+','+JSON.stringify([...made])+')');}catch(e){throw Error('A Steam não respondeu: '+e.message);}
   try{for(const n of JSON.parse(r)||[])made.add(n);}catch{}
  }else{
   const onList=[...groups].filter(([n])=>onFor.get(n)),offList=[...groups.keys()].filter(n=>!onFor.get(n)&&made.has(n));
   if(onList.length)for(const [f,b] of collectionWrites(config.steamDir,config.account,[],[],onList.map(([name,add])=>({name,add}))))atomic(f,b);
   if(offList.length)for(const [f,b] of collectionDelete(config.steamDir,config.account,{storeNames:offList,main:false}))atomic(f,b);
   for(const [n] of onList)made.add(n);
  }
  for(const [n,v] of onFor)if(!v)made.delete(n);config.storeCollectionsMade=[...made];saveConfig();return {ok:true,on,collections:[...groups.keys()].filter(n=>onFor.get(n))};
 }
 const collectionNamesFor=g=>[config.preferences.autoCollection!==false?'Taiga Launcher':'',storeCollectionName(g)].filter(Boolean);
 async function syncLive(games,{remove=false,fallback=false}={}){
  const grid=path.join(config.steamDir,'userdata',config.account,'config','grid'),script=liveScript(),results=[],failures=[],failedIds=[];
  for(const g of games){
   const previousId=Number(g.bindings?.[config.account])||0;let item;
   if(remove)item={appid:previousId,remove:true};
   else{const launch=steamLaunchFor(g),exe=launch.exe,art=[];let icon='';
    for(const [kind,name] of Object.entries(g.art||{})){const src=path.join(dataDir,'art',path.basename(name));if(!isFile(src))continue;let bytes=fs.readFileSync(src),ext=imageType(bytes);
     if(kind==='icon'){try{bytes=await iconBytes(bytes,iconResize);icon=path.join(grid,'taiga-'+(g.uuid||g.id)+'_icon.ico');atomic(icon,bytes);}catch{icon='';}continue;}
     const type={cover:0,hero:1,logo:2,wide:3}[kind];if(type===undefined||!['png','jpg'].includes(ext))continue;art.push({type,ext,b64:bytes.toString('base64')});}
    if(!icon)icon=launcherIcon(grid);
    item={appid:previousId,name:g.title,exe:'"'+exe+'"',startDir:'"'+path.dirname(exe)+'"',options:launch.args||'',icon,art:[],taken:db.games.filter(o=>o!==g&&!o.demo&&o.bindings?.[config.account]).map(o=>Number(o.bindings[config.account])>>>0)};item.pendingArt=art;}
   const run=async it=>{let r=null;try{r=JSON.parse(await injector.evaluateShared('('+script+')('+JSON.stringify(it)+','+JSON.stringify(collectionNamesFor(g))+')'));}catch{}return r;};
   const pendingArt=item.pendingArt||[];delete item.pendingArt;
   // Sem resposta: tenta de novo uma vez (o script reaproveita o atalho se a primeira chamada já o criou).
   let r=await run(item);if(!r?.ok&&!r?.error){nglNote('Steam sem resposta ao adicionar '+g.title+'; tentando de novo.');await new Promise(res=>setTimeout(res,1500));r=await run(item);}
   if(!r?.ok){failures.push(g.title+': '+(r?.error||'sem resposta da Steam'));failedIds.push(g.id);continue;}
   for(const a of pendingArt){const ra=await run({appid:Number(r.appid)>>>0,artOnly:true,art:[a]});if(!ra?.ok)nglNote('Arte não aplicada ao vivo em '+g.title+' (tipo '+a.type+').');}
   g.bindings||={};g.applied||={};if(remove){delete g.bindings[config.account];delete g.applied[config.account];g.steamRemoved={...(g.steamRemoved||{}),[config.account]:true};}else{if(g.steamRemoved)delete g.steamRemoved[config.account];g.bindings[config.account]=Number(r.appid)>>>0;g.applied[config.account]=signature(g);g.liveAdded={...(g.liveAdded||{}),[config.account]:Date.now()};}
   results.push({id:g.id,title:g.title,appId:Number(r.appid)>>>0,account:config.account,live:true,reused:!r.created});
  }
  persist();injector.reload().catch(()=>{});
  if(!results.length&&failures.length&&!fallback)throw Error('A Steam não aceitou: '+failures.join(' · '));
  save(path.join(dataDir,'last-sync.json'),{at:new Date().toISOString(),account:config.account,live:true,results,warnings:failures});
  return {message:remove?'Removido da Steam sem reiniciar.':results.length+' jogo(s) aplicado(s) na Steam sem reiniciar.',results,warnings:failures,failedIds,live:true};
 }
 // Uma gravação na Steam por vez: duas ao mesmo tempo (importação em segundo plano + pasta de atalhos, por exemplo)
 // criavam o mesmo atalho duas vezes.
 let syncChain=Promise.resolve();
 function sync(ids,opts={}){const run=syncChain.then(()=>syncNow(ids,opts));syncChain=run.catch(()=>{});return run;}
 async function syncNow(ids,{remove=false,restart=false,openSteam=false,installIntegration=true,adopt={},classic=false,dropCollection=false}={}){
  validatePaths(false);if(!Array.isArray(ids))throw Error('Seleção inválida.');const games=[...new Set(ids)].map(getGame);if(!games.length)throw Error('Selecione pelo menos um jogo.');
  if(!remove)for(const g of games){if(!g.demo&&!g.notInstalled&&!isFile(g.path))throw Error('Jogo não encontrado: '+g.title);launchFor(g,config,demoExecutable);}
  const wasRunning=await win.running({fresh:true}),active=wasRunning?await win.activeAccount():null;if(active&&active!==config.account)throw Error('A conta selecionada não é a conta aberta na Steam. Selecione a conta '+active+' nas configurações para aplicar nesta Biblioteca.');
  // Steam aberta com a integração: adiciona/atualiza direto na Steam, sem fechar nem reiniciar.
  // Se a Steam recusar algum jogo ao vivo, ele é gravado do jeito clássico: fecha, grava e reabre a Steam.
  let liveResult=null;
  if(wasRunning&&!classic&&!Object.keys(adopt).length&&await liveReady()){liveResult=await syncLive(games,{remove,fallback:restart});if(!liveResult.failedIds.length)return liveResult;games.splice(0,games.length,...liveResult.failedIds.map(getGame));nglNote('Steam recusou ao vivo: '+liveResult.warnings.join(' · ')+', gravando com reinício.');}
  if(wasRunning&&!restart)throw Error('Feche a Steam pelo menu Steam > Sair ou marque a opção de reinício.');
  if(wasRunning)await win.stopSteam(config.steamDir);if(await win.running({fresh:true}))throw Error('Steam ainda aberta.');
  const base=path.join(config.steamDir,'userdata',config.account,'config'),file=path.join(base,'shortcuts.vdf'),grid=path.join(base,'grid');
  const before=fs.existsSync(file)?fs.readFileSync(file):null,root=before?parseVDF(before):[];shortcuts(root);
  const updates=[],artWrites=[],results=[];const existing=shortcutInfo(root);
  for(const g of games){
   const previousId=g.bindings?.[config.account];let oldId=previousId;if(oldId&&!existing.some(e=>e.appId===oldId))oldId=null;
   if(adopt[g.id]){const selected=existing.find(e=>e.appId===Number(adopt[g.id]));if(!selected||normalize(selected.title)!==normalize(g.title)||!(matchesLaunch(selected,g)||windowsPath(selected.exe)===windowsPath(launchFor(g,config,demoExecutable).exe))||db.games.some(other=>other.id!==g.id&&other.bindings?.[config.account]===selected.appId))throw Error('O atalho escolhido não corresponde a este jogo ou já pertence a outro cadastro.');oldId=selected.appId;}
   if(remove){if(oldId){const list=shortcuts(root);const i=list.findIndex(n=>Buffer.isBuffer(value(n.value,'appid'))&&value(n.value,'appid').readUInt32LE(0)===oldId);if(i>=0)list.splice(i,1);list.forEach((n,j)=>n.key=String(j));}updates.push([g,null]);continue;}
   const launch=steamLaunchFor(g);const exact=existing.filter(e=>matchesLaunch(e,g));if(!oldId&&exact.length===1)oldId=exact[0].appId;
   const collisions=existing.filter(e=>normalize(e.title)===normalize(g.title));if(!oldId&&collisions.length&&!adopt[g.id])throw Error('Já existe um atalho com o nome '+g.title+'. Escolha qual atualizar na confirmação para evitar duplicatas.');
   const executable=launch.exe,launchGame={...g,appId:oldId,launchOptions:launch.args};const id=upsert(root,launchGame,executable,path.dirname(executable));let icon='';const appliedArts={};
   for(const [kind,name] of Object.entries(g.art||{})){
    const suffix={cover:'p',wide:'',hero:'_hero',logo:'_logo',icon:'_icon'}[kind];if(suffix===undefined)continue;const src=path.join(dataDir,'art',path.basename(name));if(!isFile(src))throw Error('Arte selecionada não encontrada: '+kind+'. Escolha a imagem novamente.');
    let bytes=fs.readFileSync(src),ext=imageType(bytes);if(kind==='icon'){bytes=await iconBytes(bytes,iconResize);ext='ico';}
    const dest=path.join(grid,id+suffix+'.'+ext);artWrites.push([dest,bytes]);appliedArts[kind]=dest;if(kind==='icon')icon=dest;
   }
   if(!icon)icon=launcherIcon(grid);
   if(icon)upsert(root,{...launchGame,appId:id},executable,path.dirname(executable),icon);if(adopt[g.id]&&previousId&&previousId!==id&&!db.games.some(other=>other.id!==g.id&&other.bindings?.[config.account]===previousId)){const list=shortcuts(root),old=shortcutInfo(root).find(e=>e.appId===previousId);if(old&&windowsPath(old.path)===windowsPath(g.path)&&/ppssppwindows(?:64)?\.exe/i.test(old.exe)){const index=list.indexOf(old.node);if(index>=0)list.splice(index,1);list.forEach((n,i)=>n.key=String(i));}}updates.push([g,id]);results.push({id:g.id,title:g.title,appId:id,account:config.account,shortcutFile:file,art:appliedArts,reused:!!oldId});
   if(!isFile(path.join(grid,id+'.json')))artWrites.push([path.join(grid,id+'.json'),Buffer.from(JSON.stringify({appid:String(id)}))]);
  }
  const encoded=encodeVDF(root);parseVDF(encoded);if(await win.running({fresh:true}))throw Error('A Steam foi aberta durante a operação. Feche e tente novamente.');
  if((before&&(!fs.existsSync(file)||!fs.readFileSync(file).equals(before)))||(!before&&fs.existsSync(file)))throw Error('Os atalhos mudaram durante a operação. Tente novamente.');
  const backup=path.join(dataDir,'backups',config.account,Date.now()+'-shortcuts.vdf');if(before)atomic(backup,before);
  const stale=obsoleteArtwork(grid,artWrites.map(([dest])=>dest));
  const collections=dropCollection?collectionDelete(config.steamDir,config.account,{storeNames:storeLabels()}):config.preferences.autoCollection||config.preferences.storeCollections||config.preferences.emuCollection?collectionWrites(config.steamDir,config.account,config.preferences.autoCollection?db.games.map(g=>{const pending=updates.find(([item])=>item.id===g.id);return pending?pending[1]:g.bindings?.[config.account];}).filter(Boolean):[],config.preferences.autoCollection?updates.filter(([,id])=>!id).map(([g])=>g.bindings?.[config.account]).filter(Boolean):[],storeCollectionSpecs(updates)):[];
  const transaction=commitSteamFiles([...artWrites,[file,encoded],...collections],stale,path.join(dataDir,'backups','artwork',config.account,Date.now()+'-'+crypto.randomBytes(3).toString('hex')));
  const written=shortcutInfo(parseVDF(fs.readFileSync(file)));
  for(const r of results){const e=written.find(e=>e.appId===r.appId);if(!e||e.title!==r.title||(e.options!==steamLaunchFor(getGame(r.id)).args||windowsPath(e.exe)!==windowsPath(steamLaunchFor(getGame(r.id)).exe)))throw Error('A verificação do atalho gravado falhou. Há backup para recuperação.');for(const dest of Object.values(r.art))if(!isFile(dest))throw Error('A verificação de uma arte gravada falhou.');}
  for(const [g,id] of updates){g.bindings||={};if(id){g.bindings[config.account]=id;g.applied||={};g.applied[config.account]=signature(g);}else {delete g.bindings[config.account];if(g.applied)delete g.applied[config.account];}}persist();readSteamSnapshot();
  const warnings=[];if(installIntegration&&config.injectSteam===false)try{installScript();}catch(e){warnings.push('Atalhos gravados, mas o painel não foi instalado: '+e.message);}
  save(path.join(dataDir,'last-sync.json'),{at:new Date().toISOString(),account:config.account,shortcutFile:file,backup:before?backup:null,results,warnings});
  if((wasRunning&&restart)||(!wasRunning&&openSteam))win.startSteam(config.steamDir,Number(config.steamDebugPort)||DEFAULT_DEBUG_PORT);
  injector?.reload().catch(()=>{});
  const out={message:remove?'Atalhos removidos. Jogos e saves preservados.':results.length+' atalho(s) gravado(s) e verificado(s) na conta Steam selecionada.',results,warnings,artworkChanges:transaction,integrationInstalled:!warnings.length&&installIntegration};
  if(liveResult){out.results=[...liveResult.results,...results];out.message=out.results.length+' jogo(s) aplicado(s) na Steam (a Steam foi reiniciada para concluir).';}
  return out;
 }
 // Jogo adicionado ao Taiga Launcher já vai para a Steam (preferência "Adicionar à Steam automaticamente").
 //  - Steam fechada: grava os atalhos (aparecem ao abrir);  - aberta com a integração: entra na hora, sem reiniciar;
 //  - aberta sem a integração: reinicia a Steam só se nenhum jogo do Taiga Launcher estiver aberto e o reinício
 //    automático estiver permitido; senão avisa para reiniciar.
 async function autoAddToSteam(ids){
  if(config.preferences.autoSync===false||!ids?.length)return null;
  try{validatePaths(false);}catch{return null;}
  const list=ids.filter(id=>{try{const g=getGame(id);return !g.demo&&!g.bindings?.[config.account]&&launchReadyFor(g);}catch{return false;}});if(!list.length)return null;
  const running=await win.running().catch(()=>false),gameOpen=db.games.some(g=>!g.demo&&g.uuid&&sessions.forGame(g.uuid,config.account)?.running);
  try{
   if(running&&!(await liveReady())&&(gameOpen||config.preferences.closeSteam===false))return {pending:list.length,message:'Reinicie a Steam para ver os jogos novos.'};
   const r=await sync(list,{restart:running&&!gameOpen&&config.preferences.closeSteam!==false});return {added:r.results?.length||0,live:!!r.live,message:r.message};
  }catch(e){nglNote('Adicionar à Steam automaticamente: '+e.message);return {error:e.message};}
 }
 // Pasta de atalhos: cada atalho (.lnk/.url/.exe) vira um jogo com o nome do atalho e vai para a Steam;
 // atalho apagado = jogo tirado da Steam e da coleção (o jogo em si não é tocado).
 const defaultShortcutFolder=()=>path.join(os.homedir(),'Documents','TaigaSteam - Atalhos');
 let shortcutBusy=null;
 function syncShortcutFolder(){if(shortcutBusy)return shortcutBusy;shortcutBusy=(async()=>{try{return await syncShortcutFolderNow();}finally{shortcutBusy=null;}})();return shortcutBusy;}
 async function syncShortcutFolderNow(){
  const folder=config.shortcutFolder;if(!folder||!fs.existsSync(folder))return {added:0,removed:0,errors:[]};
  const {items,errors}=listShortcuts(folder),added=[];let epic=null;
  const ignored=new Set(config.shortcutIgnore||[]);if(ignored.size){const alive=[...ignored].filter(f=>fs.existsSync(f));if(alive.length!==ignored.size){config.shortcutIgnore=alive;saveConfig();}}
  for(const it of items){
   if(ignored.has(it.file.toLowerCase()))continue;
   if(db.games.some(g=>String(g.shortcutSource||'').toLowerCase()===it.file.toLowerCase()&&!g.hidden))continue;
   let exe=it.target,args=it.args||'',storeItem=null;
   if(it.kind==='url'){const e=epicFromUrl(it.url);epic??=scanEpic(process.env);storeItem=e&&epic.find(x=>x.appName===e.appName||(e.catalogItemId&&x.id===e.catalogItemId));if(!storeItem){errors.push({file:it.file,message:'Atalho de internet não suportado (use um atalho do jogo ou da Epic).'});continue;}exe=storeItem.path;}
   if(!exe||!isFile(exe)){errors.push({file:it.file,message:'O jogo deste atalho não foi encontrado: '+(exe||it.file)});continue;}
   let g=db.games.find(x=>!x.demo&&x.path&&x.path.toLowerCase()===exe.toLowerCase());
   if(!g){const r=await addFiles([exe]);if(r.addedIds[0])g=getGame(r.addedIds[0]);else{const d=r.duplicates?.[0];g=d?getGame(d.id):null;if(!g){errors.push(...r.errors);continue;}}}
   const isNew=!g.shortcutSource&&(!g.bindings?.[config.account]||g.hidden);
   g.hidden=false;g.shortcutSource=it.file;g.title=it.name.slice(0,200)||g.title;g.titleSource='manual';
   if(storeItem){g.store={name:storeItem.store,label:storeItem.storeName,id:storeItem.id,...(storeItem.namespace?{namespace:storeItem.namespace,appName:storeItem.appName||''}:{})};if(storeItem.needsLauncher&&storeItem.url){g.profile='store';g.launch={exe:storeItem.launcherExe||explorer(),args:storeItem.url};g.needsReview=false;}}
   else{g.profile='pc';g.needsReview=false;if(args)g.launch={...(g.launch||{}),args};}
   if(it.workingDir&&!g.gameRoot)g.gameRoot=it.workingDir;
   if(isNew)added.push(g.id);
  }
  const gone=db.games.filter(g=>g.shortcutSource&&!g.hidden&&!fs.existsSync(g.shortcutSource));
  persist();
  for(const id of added){const g=getGame(id);try{await autoSteamLink(g);}catch{}providers.completeMissing?.(g).then(()=>{persist();if(!steamAppIdFor(g))return autoSteamLink(g);}).catch(()=>{});}
  let steam=null;if(added.length)steam=await autoAddToSteam(added);
  if(gone.length){const bound=gone.filter(g=>g.bindings?.[config.account]).map(g=>g.id);if(bound.length)try{await sync(bound,{remove:true,restart:false});}catch(e){nglNote('Pasta de atalhos: '+e.message);}for(const g of gone)g.hidden=true;persist();}
  return {added:added.length,removed:gone.length,errors,steam};
 }
 let shortcutWatcher=null;
 function watchShortcutFolder(){try{shortcutWatcher?.close();}catch{}shortcutWatcher=null;const folder=config.shortcutFolder;if(!startInjector||!folder||!fs.existsSync(folder))return;let t=null;try{shortcutWatcher=fs.watch(folder,{recursive:false},()=>{clearTimeout(t);t=setTimeout(()=>{syncShortcutFolder().catch(()=>{});},1500);});}catch{}}
 const launchReadyFor=g=>{try{launchFor(g,config,demoExecutable);return !!g.notInstalled||isFile(g.path);}catch{return false;}};
 // Emuladores ou preferência mudaram: jogo cujo emulador não está pronto passa para um que esteja (ex.: RetroArch com
 // o núcleo da plataforma); com "Usar o RetroArch nas plataformas retrô", os retrô passam para ele (e voltam quando
 // a opção é desligada). Os que ficaram prontos e ainda não estão na Steam entram nela.
 async function reassignProfiles({addToSteam=true,startup=false}={}){
  const changed=[],ready=[],anyInSteam=db.games.some(g=>!g.demo&&g.bindings?.[config.account]);
  for(const g of db.games){
   if(g.demo||g.hidden||g.native||g.notInstalled||g.launch?.exe||g.launch?.core||['pc','store','custom'].includes(g.profile||'psp'))continue;
   const before=g.profile||'psp',wasReady=launchReadyFor(g),candidates=platformOf(g)?.profiles||[];
   let next=preferredProfile(g,config,candidates);
   // Opção desligada: quem foi para o RetroArch por causa dela volta para o emulador próprio, se estiver pronto.
   if(!config.preferences?.retroarchFirst&&before==='retroarch'&&g.profileAuto==='retroarch'){const own=candidates.find(k=>k!=='retroarch');if(own){const back=preferredProfile({...g,profile:own},config,candidates);if(back!=='retroarch'&&launchReadyFor({...g,profile:back}))next=back;}}
   if(next&&next!==before){g.profile=next;if(next==='retroarch'&&config.preferences?.retroarchFirst)g.profileAuto='retroarch';else delete g.profileAuto;changed.push(g);}
   // Nunca esteve na Steam (não foi tirado de lá pelo usuário) e agora pode abrir: entra.
   if(!g.bindings?.[config.account]&&!g.liveAdded?.[config.account]&&!g.steamRemoved?.[config.account]&&(!wasReady||next!==before||startup&&anyInSteam)&&launchReadyFor(g))ready.push(g.id);
  }
  if(changed.length){persist();nglNote('Emuladores: '+changed.length+' jogo(s) passaram para outro emulador pronto.');}
  let steam=null;if(addToSteam&&ready.length)try{steam=await autoAddToSteam(ready);}catch{}
  return {changed:changed.length,ready:ready.length,steam};
 }
 let closed=false;const logFile=path.join(dataDir,'diagnostics.json');const log=(type,message)=>{try{const entries=json(logFile,[]);entries.push({at:new Date().toISOString(),type,message:String(message).slice(0,500)});save(logFile,entries.slice(-200));}catch{}};
 let waiting=0;
 // Discord: o jogo aberto aparece no perfil como um jogo da Steam (nome, capa, plataforma e tempo de sessão).
 const discordAppId=()=>String(config.discordClientId||(()=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).taigaDiscord||'';}catch{return '';}})());
 let presence=null;
 const presenceCover=g=>{const sid=steamAppIdFor(g);if(sid)return 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/'+sid+'/library_600x900.jpg';try{return providers.artOrigin?.(g.art?.cover)||'';}catch{return '';}};
 const presencePlatform=g=>{const plat=String(g.platformName||'').replace(/^PC \(Microsoft Windows\)$/,'PC');const emu=g.profile&&!['pc','custom','store'].includes(g.profile)?(PROFILES[g.profile]?.name||''):'';return [plat,emu].filter(Boolean).join(' · ');};
 function updatePresence(){const id=discordAppId(),on=config.preferences?.discordPresence!==false&&/^\d{17,20}$/.test(id);
  if(!on){if(presence){presence.close();presence=null;}return;}
  if(!presence||presence.clientId!==id){presence?.close();presence=new DiscordPresence({clientId:id,log:m=>nglNote('[discord] '+m)});}
  const run=sessions.records().filter(r=>r.status==='running').sort((a,b)=>String(b.startedAt||'').localeCompare(String(a.startedAt||'')))[0];
  const g=run&&db.games.find(x=>x.uuid===run.uuid);
  presence.set(g?buildActivity({title:g.title||run.title,platform:presencePlatform(g),cover:presenceCover(g),startedAt:run.startedAt}):null).catch(()=>{});}
 const queue=new JobQueue({dir:dataDir,canRun:job=>!busy&&!waiting&&(!job.payload.account||job.payload.account===config.account),onError:(job,error)=>log(job.type,error.message),handlers:{
  'steam-link-refresh':async payload=>{const game=db.games.find(g=>g.uuid===payload.uuid);if(!game||game.steamLinkDisabled||game.steamLink)return {skipped:true};const result=await steamLink.apply(game,payload.appId);if(!closed)persist();await achievementManager.get(game);return {gameId:game.id,warnings:result.warnings};},
  'refresh-achievements':async payload=>{const game=db.games.find(g=>g.uuid===payload.uuid);const record=sessions.records().find(r=>r.id===payload.sessionId);if(!game){if(record)sessions.compact(record);return {skipped:true};}if(record?.repairs?.to&&!isFile(game.path)&&record.repairs.from===game.path){const check=await inventory('inspect',[record.repairs.to]);reconcile([game],check.items);}const data=await achievementManager.get(game);if(['offline','unavailable'].includes(data.status))throw Error(data.message||'A fonte de conquistas está indisponível.');if(!closed)persist();if(record)sessions.compact(record);return {gameId:game.id,achievementStatus:data.status};},
  'library-check':async payload=>{const found=await inventory('scan',[payload.root]);const files=inventoryCandidates(found.files,db.games),inspected=await inventory('inspect',files.slice(0,1000));if(closed)return {cancelled:true};const result=reconcile(db.games,inspected.items);if(result.moved.length||result.changedIds.length)persist();scanStatus={newCandidates:result.items.length,at:new Date().toISOString(),errors:[...found.errors,...inspected.errors]};return {moved:result.moved.length,changed:result.changedIds.length,candidates:result.items.length};}
 }});
 const watcher=new LibraryWatcher({ignoreDir:dataDir,onChange:root=>queue.add('library-check',{root},'library:'+root),onError:(root,error)=>log('watch',error.code||error.message)});
 function setWatchRoots(){if(config.preferences.watchFolders!==false)watcher.setRoots(config.roots||[]);else watcher.close();}
 const collectSessions=()=>{if(closed)return;try{updatePresence();}catch{}try{sessions.recover();for(const record of sessions.records())if(record.status!=='running'&&!queue.jobs.some(j=>j.key==='session:'+record.id))queue.add('refresh-achievements',{uuid:record.uuid,gameId:record.gameId,sessionId:record.id,account:record.account},'session:'+record.id);}catch(error){log('sessions',error.message);}};
 const sessionTimer=setInterval(collectSessions,3000);sessionTimer.unref();
 const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin||'',local=`http://127.0.0.1:${port}`;
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403);return res.end();}
  const allowed=!origin||origin===local||origin===`http://localhost:${port}`||origin==='https://steamloopback.host';
  if(!allowed){res.writeHead(403);return res.end();}
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Private-Network','true');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  const url=new URL(req.url,local),route=url.pathname;
  const send=(data,status=200)=>{if(data&&typeof data==='object')for(const key of ['error','message'])if(typeof data[key]==='string')data[key]=locale.text(data[key]);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
   if(req.method==='GET'&&route==='/api/steam-art'){const appId=Number(url.searchParams.get('appid')),kind=url.searchParams.get('kind');if(!Number.isSafeInteger(appId)||!['cover','hero','logo','wide','icon'].includes(kind))throw Error('Arte inválida.');const image=localArt(config.steamDir,config.account,appId)[kind];if(!image){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':image.file.endsWith('.png')?'image/png':image.file.endsWith('.ico')?'image/x-icon':image.file.endsWith('.webp')?'image/webp':'image/jpeg'});return res.end(fs.readFileSync(image.file));}
   if(route==='/api/avatar'){if(origin&&origin!==local&&origin!==`http://localhost:${port}`){res.writeHead(403);return res.end();}const account=win.accounts(config.steamDir).find(a=>a.id===url.searchParams.get('id')),file=account&&win.avatarFile(config.steamDir,account.steamId);if(!file){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':file.endsWith('.png')?'image/png':'image/jpeg'});return res.end(fs.readFileSync(file));}
   if(/^\/flags\/(pt-BR|en|es|fr|de)\.svg$/.test(route)){res.writeHead(200,{'Content-Type':'image/svg+xml'});return res.end(fs.readFileSync(path.join(ROOT,'web',route)));}
   if(route==='/locale.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(fs.readFileSync(path.join(ROOT,'locales/catalog.cjs'),'utf8')+'\n'+fs.readFileSync(path.join(ROOT,'locales/runtime.cjs'),'utf8'));}
   if(route==='/health')return send({name:'TaigaSteamPSP',version:VERSION});
   {const m=route.match(/^\/img\/pay\/(sponsors|pix|kofi)\.png$/);if(m){res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'max-age=86400'});return res.end(fs.readFileSync(path.join(ROOT,'web','pay',m[1]+'.png')));}}
   if(route==='/img/logo.png'||route==='/img/brand.png'||route==='/favicon.ico'){res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-cache'});return res.end(fs.readFileSync(path.join(ROOT,'web','logo.png')));}
   if(/^\/img\/(?:ob-(?:store|collections)|news-(?:epic|comments|page))\.jpg$/.test(route)){res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'max-age=86400'});return res.end(fs.readFileSync(path.join(ROOT,'web',route.slice(5))));}
   if(route==='/img/trophy-steam.webp'){res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'max-age=86400'});return res.end(fs.readFileSync(path.join(ROOT,'web','trophy-steam.webp')));}
   if(route==='/assets/no-achievements.png'){res.writeHead(200,{'Content-Type':'image/png'});return res.end(fs.readFileSync(path.join(ROOT,'assets/no-achievements.png')));}
   if(req.method==='GET'&&/^\/choice-art\/[a-f0-9]{32}$/.test(route)){const option=externalChoices.get(route.slice(12));const fail=()=>{res.writeHead(404,{'Cache-Control':'no-store'});return res.end();};if(!option)return fail();try{let name=option.previewArt;if(!name){let id=option.sgdb?.id;if(!id&&option.igdb?.name&&providers.sgAvailable?.()){const found=await providers.sg('search/autocomplete/'+encodeURIComponent(option.igdb.name));const exact=(found||[]).find(s=>titleKey(s.name)===titleKey(option.igdb.name));id=exact?.id;}if(!id)return fail();const grids=await providers.sg('grids/game/'+Number(id)+'?dimensions=600x900&types=static&nsfw=false');const url=(grids||[]).find(g=>g.url)?.url;if(!url)return fail();name=await providers.image(url);option.previewArt=name;}const f=path.join(dataDir,'art',name);if(!isFile(f))return fail();res.writeHead(200,{'Content-Type':name.endsWith('.png')?'image/png':'image/jpeg','Cache-Control':'private, max-age=3600'});return res.end(fs.readFileSync(f));}catch{return fail();}}
   // Ícone do próprio programa do emulador (lido do .exe pelo Windows), com cache em memória.
   // Ícone do .exe de um jogo listado em "Jogos instalados no PC" (só desses caminhos).
   if(req.method==='GET'&&route==='/exe-icon'){if(origin&&origin!==local&&origin!==`http://localhost:${port}`){res.writeHead(403);return res.end();}const exe=String(url.searchParams.get('p')||''),fail=()=>{res.writeHead(404,{'Cache-Control':'no-store'});return res.end();};if(!fileIcon||!iconAllow.has(exe.toLowerCase())||!isFile(exe))return fail();try{let png=emuIcons.get(exe);if(!png){const src=iconSourceFor(exe,iconRoots.get(exe.toLowerCase())||'');if(src.png){const b=fs.readFileSync(src.png);if(b.length<4*1024*1024&&imageType(b)==='png')png=b;}if(!png?.length)png=await fileIcon(src.exe||exe);if(!png?.length)return fail();emuIcons.set(exe,png);}res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'max-age=3600','X-Content-Type-Options':'nosniff'});return res.end(png);}catch{return fail();}}
   if(req.method==='GET'&&/^\/emu-icon\/[a-z0-9]+$/.test(route)){if(origin&&origin!==local&&origin!==`http://localhost:${port}`){res.writeHead(403);return res.end();}const profile=route.slice(10),exe=config.launchers?.[profile]?.exe||(profile==='psp'?config.emulator:'');const fail=()=>{res.writeHead(404,{'Cache-Control':'no-store'});return res.end();};if(!fileIcon||!exe||!isFile(exe))return fail();try{const key=exe+'|'+fs.statSync(exe).mtimeMs;let png=emuIcons.get(key);if(!png){png=await fileIcon(exe);if(!png?.length)return fail();emuIcons.set(key,png);}res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'max-age=3600','X-Content-Type-Options':'nosniff'});return res.end(png);}catch{return fail();}}
   if(req.method==='GET'&&/^\/brand\/(epic|gog|ra|xbox|psn)$/.test(route)){if(origin&&origin!==local&&origin!==`http://localhost:${port}`){res.writeHead(403);return res.end();}const r=await brandIcon(route.slice(7));if(!r){res.writeHead(404,{'Cache-Control':'no-store'});return res.end();}res.writeHead(200,{'Content-Type':r.type,'Cache-Control':'max-age=86400','X-Content-Type-Options':'nosniff'});return res.end(r.body);}
   // Cartas dos jogos de emulador (SVG gerado com as imagens embutidas).
   if(req.method==='GET'&&/^\/card\/[A-Za-z0-9_-]{1,64}\/\d{1,2}\.svg$/.test(route)){const [,,gid,n]=route.split('/');const g=db.games.find(x=>x.id===gid),it=g?.cardSet?.items?.[parseInt(n)];if(!it){res.writeHead(404);return res.end();}
    const key=gid+':'+n+':'+g.cardSet.at+':'+(g.art?.logo||''),hit=cardCache.get(key);const svg=hit||cardSvg({image:path.join(dataDir,'art',path.basename(it.file)),name:it.name,kind:it.kind,logo:g.art?.logo?path.join(dataDir,'art',path.basename(g.art.logo)):'',title:g.title});if(!hit){cardCache.set(key,svg);if(cardCache.size>200)cardCache.delete(cardCache.keys().next().value);}
    res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'});return res.end(svg);}
   if(req.method==='GET'&&route.startsWith('/store-art/')){const g=db.games.find(x=>x.id===route.slice(11));const url=g?.storeImages?.cover;if(!g||!url){res.writeHead(404);return res.end();}let name=g.art?.cover;if(!name){try{name=await providers.image(url);if(!g.art?.cover&&!g.artPinned?.cover){g.art={...(g.art||{}),cover:name};persistSoon();}}catch{res.writeHead(404);return res.end();}}const f=path.join(dataDir,'art',path.basename(name));if(!isFile(f)){res.writeHead(404);return res.end();}const b=fs.readFileSync(f);res.writeHead(200,{'Content-Type':imageType(b)==='png'?'image/png':imageType(b)==='ico'?'image/x-icon':'image/jpeg','Cache-Control':'private, max-age=600'});return res.end(b);}
   if(route.startsWith('/art/')){const name=route.slice(5);if(!/^[a-f0-9]+\.(png|jpg|ico)$/.test(name))throw Error('Imagem inválida');const f=path.join(dataDir,'art',name);if(!fs.existsSync(f)){res.writeHead(404);return res.end();}const stat=fs.statSync(f),etag='"'+stat.size+'-'+stat.mtimeMs+'"';res.setHeader('Cache-Control','private, max-age=0, must-revalidate');res.setHeader('ETag',etag);if(req.headers['if-none-match']===etag){res.writeHead(304);return res.end();}res.writeHead(200,{'Content-Type':name.endsWith('.jpg')?'image/jpeg':name.endsWith('.ico')?'image/x-icon':'image/png'});return res.end(fs.readFileSync(f));}
   if(!route.startsWith('/api/')){
    if(origin==='https://steamloopback.host'){res.writeHead(403);return res.end();}
    if(/^\/fonts\/[A-Za-z0-9_-]+\.ttf$/.test(route)){const f=path.join(ROOT,'web',route);if(!isFile(f)){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':'font/ttf'});return res.end(fs.readFileSync(f));}
    const name=({'/':'index.html','/app.js':'app.js','/style.css':'style.css','/achievement-view.js':'achievement-view.cjs','/achievement-view.css':'achievement-view.css','/qrcode.js':'qrcode.js'})[route];if(!name){res.writeHead(404);return res.end();}
    let data=fs.readFileSync(path.join(ROOT,'web',name));if(name==='index.html')data=Buffer.from(data.toString().replace('__ADMIN_TOKEN__',config.adminToken));
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' https://media.retroachievements.org https://cdn2.steamgriddb.com https://cdn.steamgriddb.com https://images.igdb.com https://shared.fastly.steamstatic.com https://shared.steamstatic.com; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css':'text/javascript'});return res.end(data);
   }
   const token=req.headers.authorization?.replace(/^Bearer /,'');const admin=token===config.adminToken,read=token===config.readToken;
   if(!admin&&!read)return send({error:'Acesso não autorizado. Reinstale a integração pelo gerenciador.'},401);
   if(req.method==='POST'&&route==='/api/open-manager'){if(onOpenManager){onOpenManager();return send({message:'Programa aberto.'});}return send({error:'Abra o Taiga Launcher para gerenciar os jogos.'},409);}
   if(req.method==='GET'&&route==='/api/catalog'){readSteamSnapshot();return send({language:config.language||sysLang,games:db.games.filter(g=>g.bindings?.[config.account]).map(publicGame)});}
   if(req.method==='POST'&&route==='/api/integration-status'){let t='';for await(const c of req){t+=c;if(t.length>4096)throw Error('Relatório muito grande.');}const report=JSON.parse(t||'{}');integrationStatus={at:new Date().toISOString(),version:String(report.version||'').slice(0,10),page:String(report.page||'').slice(0,160),matched:!!report.matched,panel:!!report.panel};return send({ok:true});}
   if(req.method==='GET'&&route==='/api/activity'){const selected=url.searchParams.get('id'),game=selected?getGame(selected):null,since=Number(url.searchParams.get('since'))||0;const allowed=new Set(db.games.filter(g=>g.bindings?.[config.account]).map(g=>g.id));const rows=json(path.join(dataDir,'activity.json'),[]).filter(a=>(game?a.gameId===game.id:allowed.has(a.gameId))&&a.account===config.account&&Date.parse(a.at)>=since).slice(-50).map(({id,title,description,icon,source,at})=>({id,title,description,icon,source,at}));return send({items:rows,at:Date.now()});}
   if(req.method==='GET'&&route==='/api/achievements')return send(await achievementManager.get(getGame(url.searchParams.get('id'))));
   // Linha do tempo do jogo para a página na Steam: sessões, conquistas desbloqueadas e cadastro.
   if(req.method==='GET'&&route==='/api/game-feed'){const g=getGame(url.searchParams.get('id'));if(!g.bindings?.[config.account]&&!admin)return send({error:'Jogo não aplicado nesta conta.'},403);const history=path.join(dataDir,'session-history'),sessionRows=[];for(const folder of [history,path.join(dataDir,'sessions')])try{for(const name of fs.readdirSync(folder).slice(-4000))if(/^[a-f0-9-]{36}\.json$/i.test(name))try{const r=json(path.join(folder,name),null);if(r&&r.uuid===g.uuid&&(r.account||'')===(config.account||'')&&Number(r.seconds)>=60)sessionRows.push({startedAt:r.startedAt,endedAt:r.endedAt||null,seconds:Math.round(r.seconds),running:r.status==='running'});}catch{}}catch{}
    const unlocks=json(path.join(dataDir,'activity.json'),[]).filter(a=>a.gameId===g.id&&a.account===config.account).slice(-60).map(({id,title,description,icon,source,at})=>({id,title,description,icon,source,at}));
    return send({sessions:sessionRows.sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt))).slice(0,30),unlocks,addedAt:g.addedAt||null});}
   if(req.method==='GET'&&(route==='/api/steam-news'||route==='/api/steam-community')){const g=getGame(url.searchParams.get('id'));if(!g.bindings?.[config.account]&&!admin)return send({error:'Jogo não aplicado nesta conta.'},403);const appId=steamAppIdFor(g);if(!appId)return send({items:[],appId:null});try{return send({appId,items:route==='/api/steam-news'?await community.news(appId):await community.community(appId)});}catch(e){return send({appId,items:[],error:e.message});}}
   if(!admin)return send({error:'Operação permitida somente no gerenciador.'},403);
   if(req.method==='GET'&&route==='/api/steam-library'){
    const local=installedGames(config.steamDir),shorts=libraryShortcuts(config.steamDir,config.account);let owned=[],complete=false,message='';
    try{owned=await ownedGames(providers,config);complete=true;save(path.join(dataDir,'cache','steam-owned-'+config.account+'.json'),{at:Date.now(),games:owned});}catch(e){message=e.message;const old=json(path.join(dataDir,'cache','steam-owned-'+config.account+'.json'),null);if(old){owned=old.games;message+=' Mostrando a última lista salva.';}}
    const combined=new Map();for(const g of [...owned,...local.filter(g=>!complete||owned.some(o=>o.appId===g.appId)),...shorts])combined.set(g.appId,{...combined.get(g.appId),...g});
    const artDb=json(path.join(dataDir,'steam-art-edits.json'),{}),played=localPlaytime(config.steamDir,config.account);nativeGames.clear();const list=[];
    for(const raw of combined.values()){const lp=played.get(raw.appId),item=lp&&!raw.shortcut?{...raw,playtime:Math.max(raw.playtime||0,lp.playtime),lastPlayed:Math.max(raw.lastPlayed||0,lp.lastPlayed)}:raw;const id='steam-'+config.account+'-'+item.appId,stored=artDb[id]||{},g={...stored,...item,id,native:true,platformName:'PC (Microsoft Windows)',metadata:{},art:stored.art||{},artPinned:stored.artPinned||{},account:config.account};nativeGames.set(id,g);list.push({...g,localArt:Object.fromEntries(Object.entries(localArt(config.steamDir,config.account,item.appId)).map(([kind,value])=>[kind,value.url]))});}
    return send({games:list.sort((a,b)=>a.title.localeCompare(b.title)),complete,message});
   }

   if(req.method==='GET'&&route==='/api/playtime')return send(sessions.forGame(getGame(url.searchParams.get('id')).uuid,config.account));
   if(req.method==='GET'&&route==='/api/library-status')return send({scanStatus,steamNeedsRestart:integration.needsRestart&&config.injectSteam!==false,dataVersion,busy:queue.jobs.filter(j=>['queued','running'].includes(j.status)).length,update:update.available?{version:update.available.version,downloading:update.downloading,progress:Math.round(update.progress*100)}:null});
   if(req.method==='GET'&&route==='/api/jobs')return send({jobs:queue.summary(),scanStatus});
   if(req.method==='GET'&&route==='/api/activity')return send({items:json(path.join(dataDir,'activity.json'),[])});
   if(req.method==='GET'&&route==='/api/state'){readSteamSnapshot();return send({settings:configView(),games:db.games.filter(g=>!g.hidden).map(privateGame),hiddenGames:db.games.filter(g=>g.hidden).map(privateGame),busy,lastSync:json(path.join(dataDir,'last-sync.json'),null)});}
   if(req.method!=='POST')return send({error:'Rota não encontrada'},404);
   let text='';for await(const chunk of req){text+=chunk;if(text.length>1024*1024)throw Error('Requisição muito grande');}const body=JSON.parse(text||'{}');
   // 2.2.3: uma tarefa em segundo plano (artes, busca na Steam, conquistas) ou outro pedido em andamento não recusa
   // mais o clique: o pedido espera a vez (a fila não começa outra tarefa enquanto houver pedido esperando).
   // Login de contas e escolha de arquivo/pasta não mexem na coleção: abrem na hora, sem esperar outra tarefa.
   const free=/^\/api\/((epic|xbox|psn|ra)-(login|logout)|pick|bug-report)$/.test(route);
   if(!free&&(busy||queue.running)){waiting++;try{const until=Date.now()+180000;while((busy||queue.running)&&Date.now()<until&&!closed)await new Promise(r=>setTimeout(r,120));}finally{waiting--;}}
   if(!free&&(busy||queue.running))return send({error:'Uma operação já está em andamento. Aguarde.'},409);if(!free)busy=true;
   try{
    if(route==='/api/native-art-apply'){const g=getGame(body.id);if(!g.native||g.account!==config.account)throw Error('Reabra a biblioteca da conta selecionada.');validatePaths(false);const grid=path.join(config.steamDir,'userdata',config.account,'config/grid'),writes=[];for(const [kind,name] of Object.entries(g.art||{})){const suffix={cover:'p',wide:'',hero:'_hero',logo:'_logo',icon:'_icon'}[kind];if(suffix===undefined)continue;let bytes=fs.readFileSync(path.join(dataDir,'art',path.basename(name))),ext=imageType(bytes);if(kind==='icon'){bytes=await iconBytes(bytes,iconResize);ext='ico';}writes.push([path.join(grid,g.appId+suffix+'.'+ext),bytes]);}if(!writes.length)throw Error('Escolha uma arte primeiro.');const wasRunning=await win.running();if(wasRunning){const active=await win.activeAccount();if(active&&active!==config.account)throw Error('Selecione o perfil aberto na Steam antes de aplicar.');if(!body.restart)throw Error('Feche a Steam ou marque fechar e reabrir para aplicar.');await win.stopSteam(config.steamDir);}if(await win.running())throw Error('A Steam ainda está aberta.');const result=commitSteamFiles(writes,obsoleteArtwork(grid,writes.map(([f])=>f)),path.join(dataDir,'backups','native-art',config.account,Date.now().toString()));if(wasRunning&&body.restart)win.startSteam(config.steamDir,Number(config.steamDebugPort)||DEFAULT_DEBUG_PORT);return send({message:'Artes aplicadas. Confira na Steam.',result});}
    if(route==='/api/emulators-discover'){
     const roots=body.paths||defaultDiscoveryRoots(config,{appRoot:launcherExecutable?path.dirname(launcherExecutable):ROOT});const found=await inventory('emulators',roots);discoveryResult=found;discoveryAt=Date.now();const applied=applyDiscovery(config,found,{force:true});saveConfig();clearRetroArchCache();const moved=await reassignProfiles();return send({applied,moved:moved.changed,readyGames:moved.ready,...found});
    }
    // Aba Emuladores: cada emulador configurado, os jogos dele e as pastas de jogos que ele mesmo usa.
    if(route==='/api/emulators'){
     const launchers={...(config.launchers||{})};if(config.emulator&&!launchers.psp?.exe)launchers.psp={exe:config.emulator};
     const cfgFolders=(()=>{try{return emulatorGameFolders({launchers,emulator:config.emulator});}catch{return [];}})();
     const items=Object.entries(launchers).filter(([k,l])=>l?.exe&&REGISTRY_PROFILES[k]?.files).map(([k,l])=>{const name=emulatorDisplayName(k,l.exe),n=name.toLowerCase(),games=db.games.filter(g=>!g.demo&&!g.hidden&&(g.profile||'psp')===k);
      const fromCfg=cfgFolders.filter(f=>{const src=String(f.source||'').toLowerCase();return src&&(n.includes(src)||src.includes(n));}).map(f=>f.path);
      const fromGames=games.map(g=>path.dirname(g.gameRoot&&isFile(g.path)?g.path:g.path)).filter(Boolean);
      let folders=[];try{folders=collapseFolders([...fromCfg,...fromGames].filter(d=>{try{return fs.statSync(d).isDirectory();}catch{return false;}}).map(p=>({path:p,source:''}))).map(f=>f.path);}catch{folders=[...new Set(fromCfg)];}
      let platforms=REGISTRY_PROFILES[k].platforms?.length?REGISTRY_PROFILES[k].platforms:[REGISTRY_PROFILES[k].platform].filter(p=>p&&p!=='Não informada');if(k==='retroarch'){try{platforms=retroArchPlatforms(l.exe);}catch{platforms=[];}}
      return {profile:k,name,exe:l.exe,found:isFile(l.exe),platforms,games:games.length,folders:folders.slice(0,6),removable:true};}).sort((a,b)=>b.games-a.games||a.name.localeCompare(b.name));
     return send({items});
    }
    // Adicionar emulador pelo programa, por um atalho (.lnk) ou pela pasta dele; devolve as pastas de jogos que ele usa.
    if(route==='/api/emulator-add'){
     let target=String(body.path||'');if(!target)throw Error('Escolha o emulador.');
     if(/\.lnk$/i.test(target)){let t='';try{t=readShortcut?String(readShortcut(target)||''):'';}catch{}if(!t)try{t=lnkTarget(target);}catch{}if(!t)throw Error('Não foi possível ler este atalho. Escolha o programa do emulador.');target=t;}
     let exe='',profile='';
     try{if(fs.statSync(target).isDirectory()){const found=[];const walk=(d,depth)=>{let list=[];try{list=fs.readdirSync(d,{withFileTypes:true});}catch{return;}for(const e of list){const f=path.join(d,e.name);if(e.isFile()&&/\.exe$/i.test(e.name)){const p=guessProfile(f);if(p&&REGISTRY_PROFILES[p]?.files)found.push({f,p,known:(REGISTRY_PROFILES[p].files||[]).some(x=>x.toLowerCase()===e.name.toLowerCase())});}else if(e.isDirectory()&&depth<2&&!/^(\.|cache|shaders|logs|memcards|bios)$/i.test(e.name))walk(f,depth+1);}};walk(target,0);found.sort((a,b)=>b.known-a.known);if(found[0]){exe=found[0].f;profile=found[0].p;}if(!exe){const pf=portMainExe(target);if(pf){const g=await addPortGame(pf);return send({message:'Este é um port para PC, não um emulador: {0} foi adicionado como jogo.'.replace('{0}',g.title),port:true,gameId:g.id});}throw Error('Não encontramos um emulador conhecido nesta pasta. Escolha o programa (.exe) do emulador.');}}else{exe=target;profile=String(body.profile||'')||guessProfile(exe)||'';}}catch(e){if(/^Não encontramos/.test(e.message))throw e;throw Error('Emulador não encontrado.');}
     if(isFile(exe)&&(!profile||!REGISTRY_PROFILES[profile]?.files)){const pf=portMainExe(exe);if(pf){const g=await addPortGame(pf);return send({message:'Este é um port para PC, não um emulador: {0} foi adicionado como jogo.'.replace('{0}',g.title),port:true,gameId:g.id});}}
     if(!isFile(exe))throw Error('Emulador não encontrado.');if(!profile||!REGISTRY_PROFILES[profile]?.files)throw Error('Não reconhecemos este emulador. Escolha o .exe de um emulador da lista (PPSSPP, PCSX2, DuckStation, Dolphin, RetroArch...).');
     const old=config.launchers?.[profile]||{};config.launchers||={};config.launchers[profile]=launcherSettings(old,profile,exe);if(profile==='psp')config.emulator=exe;config.emulatorIgnore=(config.emulatorIgnore||[]).filter(k=>k!==profile);saveConfig();clearRetroArchCache();await reassignProfiles();
     const name=emulatorDisplayName(profile,exe),n=name.toLowerCase();let folders=[];try{folders=emulatorGameFolders({launchers:config.launchers,emulator:config.emulator}).filter(f=>{const src=String(f.source||'').toLowerCase();return src&&(n.includes(src)||src.includes(n));}).map(f=>f.path).filter(d=>{try{return fs.statSync(d).isDirectory();}catch{return false;}});folders=[...new Set(folders)].slice(0,8);}catch{}
     return send({message:'{0} configurado.'.replace('{0}',name),profile,name,folders});
    }
    // Tirar um emulador da lista: os jogos dele passam para outro emulador pronto para a plataforma (se houver).
    if(route==='/api/emulator-remove'){
     const profile=String(body.profile||'');if(!REGISTRY_PROFILES[profile]?.files||!config.launchers?.[profile]&&!(profile==='psp'&&config.emulator))throw Error('Emulador não encontrado.');
     const name=emulatorDisplayName(profile,config.launchers?.[profile]?.exe||'');delete config.launchers[profile];if(profile==='psp')config.emulator='';
     config.emulatorIgnore=[...new Set([...(config.emulatorIgnore||[]),profile])];saveConfig();clearRetroArchCache();
     const r=await reassignProfiles();return send({message:'{0} removido.'.replace('{0}',name||profile),moved:r.changed});
    }
    // Primeiro uso: quantos jogos já podem ir para a Steam e o que falta (emulador por plataforma), sem excesso.
    if(route==='/api/setup-summary'){
     const list=db.games.filter(g=>!g.demo&&!g.hidden&&!g.native&&!g.notInstalled&&!['pc','store'].includes(g.profile||'psp'));
     let ready=0,review=0;const groups=new Map();const ra=config.launchers?.retroarch?.exe;const raOk=isFile(ra);
     for(const g of list){if((g.profile||'psp')==='custom'){review++;continue;}if(launchReadyFor(g)){ready++;continue;}if(!isFile(g.path))continue;
      const name=g.platformName||'';const k=groups.get(name)||{platform:name,short:platformOf(g)?.short||name,count:0,profiles:platformOf(g)?.profiles||[]};k.count++;groups.set(name,k);}
     const dl=new Set(downloadable().map(d=>d.profile));
     const missing=[...groups.values()].sort((a,b)=>b.count-a.count).map(k=>{const prof=k.profiles.find(p=>dl.has(p)&&p!=='retroarch');const core=raOk&&!!retroArchCoreFor(k.platform,ra);return {platform:k.platform,short:k.short,count:k.count,retroarch:core,download:prof||null,downloadName:prof?downloadable().find(d=>d.profile===prof)?.name||'':'',need:(()=>{const own=k.profiles.find(p=>p!=='retroarch');return own?emulatorDisplayName(own)||REGISTRY_PROFILES[own]?.name||'':'RetroArch';})(),retroarchOption:k.profiles.includes('retroarch')};});
     const retro=list.filter(g=>!MODERN.has(g.platformName)&&(g.profile||'psp')!=='custom').length;
     return send({total:list.length,ready,review,missing,retroarch:{found:raOk,asked:!!config.retroarchAsked,on:!!config.preferences.retroarchFirst,retro},inSteam:list.filter(g=>g.bindings?.[config.account]).length});
    }
    if(route==='/api/emulator-select'){
     // Qualquer .exe vale (versões renomeadas ou portáteis); sem perfil, o Taiga Launcher descobre qual emulador é.
     const exe=String(body.exe||''),profile=String(body.profile||'')||guessProfile(exe)||'';if(!isFile(exe)||!/\.exe$/i.test(exe)&&process.platform==='win32')throw Error('Selecione o arquivo .exe do emulador.');if(!profile||!REGISTRY_PROFILES[profile]?.files){const pf=portMainExe(exe);if(pf){const g=await addPortGame(pf);return send({message:'Este é um port para PC, não um emulador: {0} foi adicionado como jogo.'.replace('{0}',g.title),port:true,gameId:g.id});}}if(!profile||!REGISTRY_PROFILES[profile]?.files)throw Error('Não reconhecemos este emulador. Escolha o .exe de um emulador da lista (PPSSPP, PCSX2, DuckStation, Dolphin, RetroArch...).');
     const old=config.launchers?.[profile]||{};config.launchers||={};config.launchers[profile]=launcherSettings(old,profile,exe);if(profile==='psp')config.emulator=exe;config.emulatorIgnore=(config.emulatorIgnore||[]).filter(k=>k!==profile);saveConfig();clearRetroArchCache();await reassignProfiles();return send({message:'{0} configurado.'.replace('{0}',emulatorDisplayName(profile,exe)),profile});
    }
    if(route==='/api/store-library'){const r=await syncStoreLibrary();return send(r);}
    if(route==='/api/store-install'){const g=getGame(body.id);return send(await startInstall(g,{via:['launcher','legendary'].includes(body.via)?body.via:'',dir:typeof body.dir==='string'?body.dir:'',shortcuts:body.shortcuts||null}));}
    if(route==='/api/store-install-info'){const g=getGame(body.id);return send(await installInfo(g,{wait:!!body.wait}));}
    if(route==='/api/store-install-pause'){const g=getGame(body.id);return send(await pauseInstall(g));}
    if(route==='/api/store-install-cancel'){const g=getGame(body.id);return send(await cancelInstall(g));}
    if(route==='/api/store-install-state'){const g=getGame(body.id);return send(installState(g));}
    if(route==='/api/play'){
     const g=getGame(body.id);if(!launcherExecutable||g.native||g.demo)throw Error('Abra o aplicativo desktop para iniciar um jogo local.');if(g.notInstalled)return send(await startInstall(g));if(!isFile(g.path))throw Error('Arquivo do jogo não encontrado.');launchFor(g,config,demoExecutable);
     const child=spawn(launcherExecutable,['--taiga-launch',g.uuid],{detached:true,stdio:'ignore',windowsHide:true});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return send({message:'Iniciando jogo.'});
    }
    if(route==='/api/job-retry'){queue.retry(body.id);return send({message:'Tarefa agendada novamente.'});}
    if(route==='/api/repair-check'){
     const plans=db.games.filter(g=>!g.demo&&!g.hidden).map(g=>({id:g.id,title:g.title,...gameStatus(g,config)})).filter(g=>g.problems.length);return send({games:plans,discovery:discoveryResult,scanStatus});
    }
    // Jogos instalados no PC (programas do Windows e pastas de jogos), só com prova; a pessoa confirma.
    if(route==='/api/installed-scan'){const drives=process.platform==='win32'?windowsDrives():(body.drives||[]);const known=db.games.filter(g=>!g.demo).map(g=>g.path),knownSet=new Set(known.map(p=>p.toLowerCase()));
     // Lojas primeiro (Epic, GOG, Xbox, EA, Ubisoft…), depois os programas instalados e as pastas de jogos.
     let storeItems=[];try{const st=body.stores===false?{items:[]}:await scanStores();storeItems=st.items.filter(i=>!knownSet.has(i.path.toLowerCase())).map(i=>({title:i.title,path:i.path,root:i.root||path.dirname(i.path),evidence:[],store:i.store,storeName:i.storeName,source:'store',confidence:'high'}));}catch{}
     const loose=await findInstalledGames({regQuery:process.platform==='win32'?regQuery:(installedRegQuery||null),drives,home:process.env.USERPROFILE||'',known:[...known,...storeItems.map(i=>i.path)]});
     const roots=new Set(storeItems.map(i=>String(i.root).toLowerCase())),items=[...storeItems,...loose.filter(i=>!roots.has(String(i.root).toLowerCase()))].slice(0,300);
     let adopted=[];try{adopted=await adoptPorts(items);}catch{}if(adopted.length){const done=new Set(adopted.map(a=>getGame(a.id).path.toLowerCase()));for(let i=items.length-1;i>=0;i--)if(done.has(String(items[i].path).toLowerCase()))items.splice(i,1);}const already=db.games.filter(g=>!g.demo&&!g.hidden).length;iconAllow.clear();iconRoots.clear();for(const i of items){iconAllow.add(i.path.toLowerCase());if(i.root)iconRoots.set(i.path.toLowerCase(),String(i.root));}return send({items,inCollection:already,adopted});}
    // Nome certo de um .exe: produto gravado no arquivo, pastas, siglas; busca na Steam e devolve o melhor.
    if(route==='/api/guess-game'){const file=String(body.path||'');let product='',port=null;try{product=isFile(file)?executableTitle(file)||'':'';}catch{}try{port=isFile(file)?consoleTitleNear(file):null;}catch{}const names=guessNames(file,{productName:product,shortcutName:String(body.name||''),consoleTitle:port?.title||''});const r=await guessSteamGame(names,q=>steamLink.search(q));if(port)r.query=port.title;return send({...r,port:port?{title:port.title,code:port.code,platform:port.platform}:null});}
    if(route==='/api/steam-link-search')return send(await steamLink.search(body.query));
    // Detecção automática do AppID com candidatos, certeza e capas (modelo do NativeGameLink).
    // Relatar um problema: monta um relatório (descrição + dados do programa + últimos registros, sem senhas e sem o
    // nome do usuário do Windows), salva em Downloads e devolve o texto e o link para abrir o relato no GitHub.
    if(route==='/api/bug-report'){const text=String(body.text||'').slice(0,4000).trim(),home=os.homedir(),user=path.basename(home);
     const clean=v=>String(v).split(home).join('%USERPROFILE%').replace(new RegExp('\\b'+user.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','gi'),'<usuario>').replace(/(token|key|password|senha|npsso|authorization)(["'\s:=]+)[^\s"',]+/gi,'$1$2<oculto>');
     const acc=configView().accounts||[],games=db.games.filter(g=>!g.demo&&!g.hidden);
     const info=[`Taiga Launcher ${VERSION}`,`Windows ${os.release()} (${os.arch()}) · idioma ${config.language||sysLang}`,`Steam: ${config.steamDir?'configurada':'não configurada'} · integração ${config.injectSteam!==false?'ligada':'desligada'}${integration.needsRestart?' · precisa reiniciar':''}`,`Jogos: ${games.length} (na Steam: ${games.filter(g=>g.bindings?.[config.account]).length}; ligados a um AppID: ${games.filter(g=>steamAppIdFor(g)).length})`,`Lojas: ${games.filter(g=>g.notInstalled).length} não instalado(s) (na Steam: ${games.filter(g=>g.notInstalled&&g.bindings?.[config.account]).length}) · mostrar não instalados: ${config.preferences.showUninstalled?'sim':'não'}`,`Contas: ${['epic','xbox','psn','gog','ra'].map(k=>k+(config[k+'Auth']||k==='ra'&&config.raToken||k==='gog'&&config.gogUser?' sim':' não')).join(', ')}`].join('\n');
     let logs='';if(body.logs!==false){const tail=(f,n)=>{try{return fs.readFileSync(f,'utf8').split(/\r?\n/).filter(Boolean).slice(-n).join('\n');}catch{return '';}};const diag=json(path.join(dataDir,'diagnostics.json'),[]).slice(-30).map(e=>`${e.at} [${e.type}] ${e.message}`).join('\n');const failed=queue.jobs.filter(j=>j.status==='failed').slice(-10).map(j=>`${j.type}: ${j.error}`).join('\n');
      logs=['','── Registro da integração com a Steam ──',tail(nglLogFile,150),'','── Diagnóstico ──',diag,failed?'\n── Tarefas com erro ──\n'+failed:''].join('\n');}
     const report=clean(['── O que aconteceu ──',text||'(sem descrição)','','── Programa ──',info,logs].join('\n'));
     const stamp=new Date().toISOString().replace(/[:T]/g,'-').slice(0,16),dirs=[path.join(home,'Downloads'),path.join(dataDir,'relatorios')];let file='';
     for(const d of dirs){try{fs.mkdirSync(d,{recursive:true});const f=path.join(d,`Taiga Launcher - relatório ${stamp}.txt`);fs.writeFileSync(f,report);file=f;break;}catch{}}
     const issueUrl=updateRepo&&/^[\w.-]+\/[\w.-]+$/.test(updateRepo)?`https://github.com/${updateRepo}/issues/new?`+new URLSearchParams({title:(text.split('\n')[0]||'Problema').slice(0,90),body:clean(`${text||''}\n\n${info}\n\n(Anexe o arquivo do relatório: ${path.basename(file)})`).slice(0,5500)}):'';
     return send({file:clean(file),fileName:path.basename(file),text:report,issueUrl});}
    if(route==='/api/steam-link-detect'){const g=getGame(body.id),header=id=>'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/'+id+'/header.jpg',out=[];const root=g.gameRoot||g.suggestedRoot||(g.path&&/\.exe$/i.test(g.path)?path.dirname(g.path):''),proof=['pc','custom','store'].includes(g.profile)&&root?(()=>{try{return appIdFromFolder(root);}catch{return null;}})():null,evidence=proof?.appId||(['pc','custom','store'].includes(g.profile)?achievementManager.detectSteamId(g):null);
     if(evidence){const d=await steamLink.details(evidence).catch(()=>null);out.push({appId:evidence,name:d?.name||'AppID '+evidence,image:header(evidence),confidence:1,reason:'evidence'});}
     const r=await steamAppByName(g,steamLink).catch(()=>({candidates:[]}));for(const c of r.candidates||[])if(!out.some(x=>x.appId===c.appId))out.push({appId:c.appId,name:c.name,image:header(c.appId),confidence:Math.round(Math.min(.99,c.score)*100)/100,reason:c.exact?'name':'similar'});
     return send({candidates:out.slice(0,6),confident:!!evidence||!!r.confident});}
    if(route==='/api/steam-link'){
     const game=getGame(body.id);if(game.native)throw Error('Este jogo já pertence à biblioteca Steam.');const appId=steamAppId(body.appId);{const twin=db.games.find(o=>o!==game&&!o.demo&&!o.native&&!o.hidden&&['pc','store','custom'].includes(o.profile)&&steamAppIdFor(o)===appId);if(twin)throw Error('Este jogo da Steam já está associado a "'+twin.title+'" na coleção.');}const result=await steamLink.apply(game,appId,{replace:true});delete game.steamLinkDisabled;delete game.steamLinkPending;persist();const achievements=await achievementManager.get(game);persist();return send({warnings:result.warnings,offline:result.offline,steamLink:game.steamLink,achievements});
    }
    if(route==='/api/steam-unlink'){const game=getGame(body.id),appId=game.steamLink?.appId;delete game.steamLink;game.steamLinkDisabled=true;delete game.steamLinkPending;if(game.metadataSteamAppId===appId)delete game.metadataSteamAppId;delete game.steamFields;persist();return send({ok:true});}
    // Troféu de port marcado à mão (conquistado antes de o Taiga Launcher acompanhar o jogo).
    if(route==='/api/port-trophy'){const g=getGame(body.id),trophy=Number(body.trophy);if(!Number.isInteger(trophy)||trophy<0||trophy>2147483647)throw Error('Troféu inválido.');const store=achievementManager.portStore,key=portStoreKey(g);if(body.unlocked)store.record(key,trophy,Math.floor(Date.now()/1000),{manual:true});else if(store.get(key).manual?.[String(trophy)])store.remove(key,trophy);return send(await achievementManager.get(g,{quiet:true}));}
    // Pacote do programa para outro PC (com as chaves de API deste PC; sem jogos, contas nem logins).
    // "Testar integração": confere cada peça e manda uma notificação de teste com som.
    if(route==='/api/integration-test'){const checks=[],add=(key,ok,extra={})=>checks.push({key,ok:!!ok,...extra});
     const steamOk=!!config.steamDir&&isFile(path.join(config.steamDir,'steam.exe'));add('steamDir',steamOk,{value:config.steamDir||''});
     const accounts=steamOk?win.accounts(config.steamDir):[],acc=accounts.find(a=>a.id===config.account);add('account',!!acc,{value:acc?.name||''});
     const running=await win.running().catch(()=>false);add('steamRunning',running);
     let active=null;if(running)try{active=await win.activeAccount();}catch{}if(running&&active)add('sameAccount',active===config.account);
     const st=injector?.status()||{};add('debugPort',running&&st.connected,{skip:!running});
     let ngl=null;if(st.connected)try{ngl=await injector.evaluateShared('window.__TAIGA_NGL_STATE__||null');}catch{}add('page',ngl==='ready',{skip:!st.connected,value:ngl||''});
     let notified=false;if(st.connected)try{notified=await injector.notify({id:'taiga-test',title:TX_SERVER('test.title'),description:TX_SERVER('test.text'),icon:'',appid:0,date:new Date().toISOString()});}catch{}add('notification',notified,{skip:!st.connected});
     const bound=db.games.filter(g=>!g.demo&&!g.hidden&&g.bindings?.[config.account]).length;add('games',bound>0,{value:String(bound),warn:true});
     nglNote('Teste de integração: '+checks.map(c=>c.key+'='+(c.skip?'-':c.ok?'ok':'falhou')).join(' '));return send({checks});}
    // Desinstalar da Steam: tira todos os atalhos do programa e a coleção (a Steam é fechada e reaberta).
    if(route==='/api/steam-remove-all'){const ids=db.games.filter(g=>!g.demo&&g.bindings?.[config.account]).map(g=>g.id);const running=await win.running().catch(()=>false);
     if(running&&db.games.some(g=>g.uuid&&sessions.forGame(g.uuid,config.account)?.running))throw Error('Feche o jogo aberto antes de remover tudo da Steam.');
     if(ids.length)await sync(ids,{remove:true,restart:running,openSteam:running,classic:true,dropCollection:true});else if(!running){for(const [f,b] of collectionDelete(config.steamDir,config.account,{storeNames:storeLabels()}))atomic(f,b);}
     if(body.integration){try{const m=cefMarker();if(m&&fs.existsSync(m))fs.rmSync(m);}catch{}config.injectSteam=false;saveConfig();}
     for(const g of db.games)if(g.liveAdded)delete g.liveAdded[config.account];persist();nglNote('Remover tudo da Steam: '+ids.length+' atalho(s).');return send({removed:ids.length});}
    if(route==='/api/storage'){const u=housekeeping.usage();return send({total:u.total,art:u.parts.art||0,cache:u.parts.cache||0,backups:u.parts.backups||0,updates:u.parts.updates||0});}
    if(route==='/api/storage-clean'){const before=housekeeping.usage().total;await housekeeping.run();config.cleanAt=Date.now();saveConfig();const after=housekeeping.usage().total;return send({freed:Math.max(0,before-after),total:after});}
    if(route==='/api/update-check'){if(!updateRepo)return send({enabled:false,version:VERSION});await checkUpdate();return send({enabled:true,version:VERSION,available:update.available?{version:update.available.version,notes:update.available.notes,page:update.available.page}:null,error:update.error});}
    if(route==='/api/update-apply'){if(!update.available)throw Error('Nenhuma atualização disponível.');if(process.platform!=='win32'||!onApplyUpdate)throw Error('A atualização automática só funciona no programa instalado no Windows.');if(update.downloading)throw Error('A atualização já está sendo baixada.');
     update.downloading=true;update.progress=0;try{const zip=await downloadRelease(update.available,path.join(dataDir,'updates'),{onProgress:(got,total)=>{update.progress=total?got/total:0;}});const script=path.join(dataDir,'updates','aplicar.ps1');atomic(script,Buffer.from('\uFEFF'+updateScript({zip,installDir:path.dirname(process.execPath),pid:process.pid,resultFile:path.join(dataDir,'updates','resultado.json'),version:update.available.version}),'utf8'));nglNote('Aplicando atualização '+update.available.version);setTimeout(()=>onApplyUpdate(script),200);return send({ok:true});}finally{update.downloading=false;}}
    if(route==='/api/playtime-import')return send(await importPlaytime());
    if(route==='/api/build-package'){if(packaging)throw Error('O pacote já está sendo gerado.');const installDir=path.dirname(process.execPath),home=os.homedir(),desk=[path.join(home,'Desktop'),path.join(home,'OneDrive','Desktop'),path.join(home,'Área de Trabalho'),path.join(home,'Downloads'),home].find(d=>fs.existsSync(d)),out=path.join(desk,'Taiga Launcher '+VERSION+' (para outro PC).zip');
     packaging={at:Date.now(),done:0,total:0};try{const r=await buildPortablePackage({installDir:body.installDir&&process.env.TAIGA_TEST?body.installDir:installDir,out:body.out&&process.env.TAIGA_TEST?body.out:out,version:VERSION,exeName:path.basename(process.execPath),keys:providers.defaultServer?{}:{sgdbKey:config.sgdbKey,igdbId:config.igdbId,igdbSecret:config.igdbSecret},onProgress:(d,t)=>{packaging.done=d;packaging.total=t;}});
      if(process.platform==='win32')try{spawn('explorer.exe',['/select,',r.file],{detached:true,stdio:'ignore'}).unref();}catch{}return send({file:r.file,bytes:r.bytes,keys:r.keys});}finally{packaging=null;}}
    if(route==='/api/achievement-settings'){
     const g=getGame(body.id),mode=String(body.provider||'auto');if(!['auto','local','retroachievements','rpcs3','vita3k','shadps4','port','epic','gog','xbox','steam','none'].includes(mode))throw Error('Fonte de conquistas inválida.');
     if(body.steamAppId&&!/^[1-9]\d{0,9}$/.test(String(body.steamAppId)))throw Error('Steam AppID inválido.');if(body.trophySet&&!/^NPWR\d+_\d+$/.test(body.trophySet))throw Error('Conjunto de troféus inválido.');
     const folder=typeof body.path==='string'?body.path.trim():'';if(folder&&!fs.existsSync(folder))throw Error('Pasta de conquistas não encontrada.');
     g.achievementSettings={provider:mode,path:folder,steamAppId:body.steamAppId?Number(body.steamAppId):null,trophySet:body.trophySet||''};if(mode==='retroachievements')delete g.raLookupAt;if(g.achievementSettings.steamAppId)g.metadataSteamAppId=g.achievementSettings.steamAppId;else delete g.metadataSteamAppId;persist();return send({message:'Fonte de conquistas salva.'});
    }
    if(route==='/api/ra-login'){const user=String(body.user||'').trim(),password=String(body.password||'');if(!/^[A-Za-z0-9_.-]{2,32}$/.test(user)||!password)throw Error('Informe usuário e senha do RetroAchievements.');const r=await providers.retro.login(user,password);config.raUser=r.user;config.raToken=r.token;saveConfig();providers.retro.accountsCache=null;return send({message:'Conectado ao RetroAchievements como '+r.user+'.',ra:providers.retro.status()});}
    if(route==='/api/ra-logout'){delete config.raToken;saveConfig();providers.retro.accountsCache=null;return send({message:'Login do RetroAchievements removido do Taiga Launcher.',ra:providers.retro.status()});}
    if(route==='/api/settings'){
     if(body.language!==undefined){if(!localeRuntime.languages.some(l=>l.id===body.language))throw Error('Idioma inválido.');const changed=config.language!==body.language;config.language=body.language;locale.setLanguage(body.language);onLanguageChange?.(body.language);if(changed&&startInjector)setTimeout(async()=>{/* A página da Steam usa o idioma do programa: entrega o idioma novo e recarrega a interface da Steam (sem fechar a Steam) para todos os textos trocarem juntos. */try{await injector?.reload?.();}catch{}const playing=db.games.some(g=>!g.demo&&g.uuid&&sessions.forGame(g.uuid,config.account)?.running);if(!playing)try{await injector.evaluateShared("(()=>{try{localStorage.setItem('taigaNglRestart',String(Date.now()));if(window.SteamClient&&SteamClient.Browser&&typeof SteamClient.Browser.RestartJSContext==='function'){setTimeout(()=>SteamClient.Browser.RestartJSContext(),50);return true;}}catch(e){}return false;})()");}catch{}},600).unref?.();if(changed)queueMicrotask(async()=>{for(const game of db.games){if(config.language!==body.language)break;try{if(game.steamLink)await steamLink.apply(game,game.steamLink.appId);await providers.localize?.(game);}catch{}}persist();});}
     for(const key of ['achievementRoot','rpcs3Root','vita3kRoot','shadps4Root'])if(typeof body[key]==='string')config[key]=body[key].trim();if(typeof body.ps4TrophyKey==='string'){const v=body.ps4TrophyKey.trim().replace(/^0x/i,'');if(v&&!/^[0-9a-f]{32}$/i.test(v))throw Error('A chave de troféus do PS4 tem 32 caracteres hexadecimais.');config.ps4TrophyKey=v;}if(typeof body.epicAccount==='string'){const v=body.epicAccount.trim();if(v&&!parseEpicAccount(v))throw Error('ID da conta Epic inválido. Use o ID de 32 caracteres ou o link do perfil.');config.epicAccount=v?parseEpicAccount(v):'';}if(typeof body.profileServer==='string'){config.profileServer=profileServerUrl(body.profileServer);if(config.profileServer&&!config.profileKey)config.profileKey=crypto.randomBytes(24).toString('hex');setTimeout(()=>publicProfile.refresh({force:true}).catch(()=>{}),0);}if(typeof body.gogUser==='string'){const v=body.gogUser.trim().replace(/^https?:\/\/www\.gog\.com\/u\//i,'').replace(/[/?#].*$/,'');if(v&&!/^[\w.-]{2,40}$/.test(v))throw Error('Usuário GOG inválido.');config.gogUser=v;}if(typeof body.injectSteam==='boolean'){config.injectSteam=body.injectSteam;if(!body.injectSteam)injector?.disconnect();setTimeout(()=>{ensureCefMarker();retireSfpScript();},0);}if(typeof body.autoRestartSteam==='boolean')config.autoRestartSteam=body.autoRestartSteam;if(body.steamDebugPort!==undefined){const n=Number(body.steamDebugPort);if(!Number.isInteger(n)||n<1024||n>65535)throw Error('Porta inválida.');config.steamDebugPort=n;if(injector){injector.port=n;injector.disconnect();}}if(typeof body.raUseEmulatorAccounts==='boolean'){config.raUseEmulatorAccounts=body.raUseEmulatorAccounts;providers.retro.accountsCache=null;}if(body.rpcs3User!==undefined){if(!/^\d{8}$/.test(body.rpcs3User))throw Error('Usuário RPCS3 inválido.');config.rpcs3User=body.rpcs3User;}

     for(const key of ['emulator','steamDir','scriptDir','account','raUser'])if(typeof body[key]==='string')config[key]=body[key].trim();
     if(typeof body.discordClientId==='string'){const v=body.discordClientId.trim();if(v&&!/^\d{17,20}$/.test(v))throw Error('O ID do aplicativo do Discord tem só números (17 a 20).');config.discordClientId=v;}
     if(typeof body.emulator==='string'&&config.launchers?.psp&&config.launchers.psp.exe!==config.emulator)config.launchers.psp=launcherSettings(config.launchers.psp,'psp',config.emulator);
     const hadArtKeys=!!config.sgdbKey,hadIgdb=!!(config.igdbId&&config.igdbSecret);for(const key of ['sgdbKey','igdbId','igdbSecret','raKey','steamKey'])if(typeof body[key]==='string'&&body[key].trim())config[key]=body[key].trim();if(!hadArtKeys&&config.sgdbKey||!hadIgdb&&config.igdbId&&config.igdbSecret)setTimeout(()=>completeArtworkAfterKeys().catch(()=>{}),500);
     if(typeof body.steamDir==='string'){const ac=win.accounts(config.steamDir);if(!ac.some(a=>a.id===config.account))config.account=ac.find(a=>a.recent)?.id||ac[0]?.id||'';}
     if(Array.isArray(body.roots))config.roots=body.roots.filter(x=>typeof x==='string'&&x.trim());
     const raBefore=!!config.preferences.retroarchFirst,libBefore=!!config.preferences.showUninstalled,colBefore=!!config.preferences.storeCollections+'|'+!!config.preferences.emuCollection;if(typeof body.retroarchAsked==='boolean'){config.retroarchAsked=body.retroarchAsked;}if(typeof body.setupDone==='boolean'){config.setupDone=body.setupDone;}if(typeof body.seenVersion==='string'&&/^\d+\.\d+\.\d+$/.test(body.seenVersion)){config.seenVersion=body.seenVersion;}if(body.supportHideUntil!==undefined){const n=Number(body.supportHideUntil);config.supportHideUntil=Number.isFinite(n)&&n>0?Math.min(n,Date.now()+400*864e5):0;}if(body.preferences){for(const k of ['autoLookup','closeSteam','scanOnStart','autoCollection','watchFolders','autoDiscover','autoSync','discordPresence','startWithWindows','showUninstalled','storeCollections','retroarchFirst','emuCollection'])if(typeof body.preferences[k]==='boolean')config.preferences[k]=body.preferences[k];if(['legendary','launcher'].includes(body.preferences.epicInstaller))config.preferences.epicInstaller=body.preferences.epicInstaller;if(typeof body.preferences.startWithWindows==='boolean')try{onStartupChange?.(body.preferences.startWithWindows);}catch{}if(['system','light','dark'].includes(body.preferences.theme))config.preferences.theme=body.preferences.theme;}
     if(typeof body.epicInstallDir==='string'){const d=body.epicInstallDir.trim();if(d&&!path.isAbsolute(d))throw Error('Escolha uma pasta válida para instalar os jogos da Epic.');config.epicInstallDir=d;}
     saveConfig();setWatchRoots();
     if(raBefore!==!!config.preferences.retroarchFirst)reassignProfiles().catch(e=>nglNote('Emuladores: '+e.message));
     if(libBefore!==!!config.preferences.showUninstalled)syncStoreLibrary().catch(e=>nglNote('Biblioteca das lojas: '+e.message));
     if(colBefore!==!!config.preferences.storeCollections+'|'+!!config.preferences.emuCollection)applyStoreCollections().catch(e=>nglNote('Coleções das lojas: '+e.message));
     return send({message:'Configurações salvas.'});
    }
    // Integração direta com a Steam (injetor próprio).
    if(route==='/api/shortcut-folder'){
     const action=String(body.action||'');
     if(action==='create'||action==='set'){let folder=action==='create'?defaultShortcutFolder():String(body.path||'').trim();if(!folder)throw Error('Escolha uma pasta.');fs.mkdirSync(folder,{recursive:true});config.shortcutFolder=folder;saveConfig();watchShortcutFolder();}
     if(action==='disable'){config.shortcutFolder='';saveConfig();watchShortcutFolder();return send({folder:''});}
     if(action==='open'||action==='create'){if(process.platform==='win32'&&config.shortcutFolder)try{spawn(explorer(),[config.shortcutFolder],{detached:true,stdio:'ignore'}).unref();}catch{}}
     const result=await syncShortcutFolder();return send({folder:config.shortcutFolder||'',...result});}
    if(route==='/api/epic-login'){if(!epicLogin)throw Error('O login da Epic só está disponível no aplicativo do Taiga Launcher.');const code=await epicLogin();if(!code)return send({cancelled:true});config.epicAuth=await exchangeCode(code);saveConfig();for(const g of db.games.filter(x=>!x.hidden&&!x.demo&&['pc','custom','store'].includes(x.profile)&&achievementManager.isEpicGame(x)))achievementManager.get(g,{live:true}).catch(()=>{});if(config.preferences.showUninstalled)syncStoreLibrary().catch(()=>{});return send({message:'Conta Epic conectada'+(config.epicAuth.displayName?': '+config.epicAuth.displayName:'')+'.',name:config.epicAuth.displayName||''});}
    if(route==='/api/xbox-login'){if(!xboxLogin)throw Error('O login da Microsoft só está disponível no aplicativo do Taiga Launcher.');const msa=await xboxLogin();if(!msa)return send({cancelled:true});const xsts=await xstsFromMsa(msa);config.xboxAuth={msa,xsts,gamertag:xsts.gamertag,xuid:xsts.xuid};saveConfig();for(const g of db.games.filter(x=>!x.hidden&&x.store?.name==='xbox'))achievementManager.get(g,{live:true}).catch(()=>{});if(config.preferences.showUninstalled)syncStoreLibrary().catch(()=>{});return send({message:'Conta Xbox conectada'+(xsts.gamertag?': '+xsts.gamertag:'')+'.'});}
    if(route==='/api/psn-login'){if(!psnLogin)throw Error('O login da PlayStation só está disponível no aplicativo do Taiga Launcher.');const npsso=await psnLogin();if(!npsso)return send({cancelled:true});const auth=await psnFromNpsso(npsso);const prof=await psnProfile(auth).catch(()=>({}));config.psnAuth={...auth,...prof};saveConfig();for(const g of db.games.filter(x=>!x.hidden&&['pc','custom'].includes(x.profile)))achievementManager.get(g,{quiet:true}).catch(()=>{});return send({message:'Conta PlayStation conectada.'});}
    if(route==='/api/psn-logout'){delete config.psnAuth;saveConfig();return send({message:'Conta PlayStation desconectada.'});}
    if(route==='/api/xbox-logout'){delete config.xboxAuth;saveConfig();return send({message:'Conta Xbox desconectada.'});}
    if(route==='/api/epic-logout'){delete config.epicAuth;saveConfig();return send({message:'Conta Epic desconectada.'});}
    if(route==='/api/steam-integration'){const steamUp=await win.running().catch(()=>false),cmd=steamUp?await win.steamCommandLine():null,auto=await win.steamAutostart(config.steamDir).catch(()=>({available:false,enabled:false}));return send({...injector.status(),steamRunning:steamUp,debugFlag:cmd===null?null:/-cef-enable-debugging/i.test(cmd||''),marker:cefMarker()?fs.existsSync(cefMarker()):false,needsRestart:integration.needsRestart,autostart:auto,ngl:await injector.evaluateShared('window.__TAIGA_NGL_STATE__||null').catch(()=>null)});}
    if(route==='/api/steam-integration/restart'){validatePaths(false);ensureCefMarker();integration.needsRestart=false;integration.since=0;await win.stopSteam(config.steamDir);win.startSteam(config.steamDir,Number(config.steamDebugPort)||DEFAULT_DEBUG_PORT);injector.disconnect();setTimeout(()=>injector.tick(),4000);return send({message:'Steam reiniciada com a integração do Taiga Launcher. O painel aparece em alguns segundos.'});}
    if(route==='/api/steam-integration/autostart'){const r=await win.steamAutostart(config.steamDir,{enable:!!body.enable,port:Number(config.steamDebugPort)||DEFAULT_DEBUG_PORT});return send({...r,message:r.enabled?'A Steam vai iniciar com o Windows já com a integração.':'Inicialização da Steam restaurada.'});}
    // Emulador oficial baixado e configurado sozinho (opcional).
    if(route==='/api/emulator-downloads')return send({items:downloadable().map(d=>({...d,platform:PROFILES[d.profile]?.platform||'',configured:d.profile==='psp'?isFile(config.emulator)||isFile(config.launchers?.psp?.exe):isFile(config.launchers?.[d.profile]?.exe)}))});
    if(route==='/api/emulator-download'){const profile=String(body.profile||'');const home=process.env.USERPROFILE||os.homedir(),legacy=path.join(home,'TaigaSteam','Emuladores'),dest=fs.existsSync(legacy)?legacy:path.join(home,'Taiga Launcher','Emuladores');const r=await downloadEmulator(profile,{dest,tmpDir:path.join(dataDir,'downloads')});
     if(r.manual){if(process.platform==='win32'){try{spawn('explorer.exe',['/select,',r.manual],{stdio:'ignore',detached:true}).unref();}catch{}}return send({message:'{0} {1} baixado. Extraia o arquivo {2} nessa pasta e use Procurar emuladores.'.replace('{0}',r.name).replace('{1}',r.version).replace('{2}',path.basename(r.manual)),folder:r.folder,manual:true,settings:configView()});}const found=await inventory('emulators',[r.folder]);discoveryResult=found;discoveryAt=Date.now();const applied=applyDiscovery(config,found,{force:true});saveConfig();clearRetroArchCache();const moved=await reassignProfiles();return send({moved:moved.changed,readyGames:moved.ready,message:r.name+' '+r.version+' instalado em '+r.folder+' e configurado.',folder:r.folder,applied,settings:configView()});}
    if(route==='/api/diagnostics'){const report=await diagnostics(),file=path.join(dataDir,'diagnostico-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');save(file,report);if(process.platform==='win32')try{spawn(explorer(),['/select,',file],{detached:true,stdio:'ignore'}).unref();}catch{}return send({file,report});}
    if(route==='/api/steam-integration/reload'){
     // Recarrega a interface da Steam (sem fechar a Steam): a página do jogo volta do zero com a versão atual.
     let restarted=false;try{restarted=!!(await injector.evaluateShared("(()=>{try{localStorage.setItem('taigaNglRestart',String(Date.now()));if(window.SteamClient&&SteamClient.Browser&&typeof SteamClient.Browser.RestartJSContext==='function'){setTimeout(()=>SteamClient.Browser.RestartJSContext(),50);return true;}}catch(e){}return false;})()"));}catch{}
     if(!restarted)await injector.reload();return send({message:'Painel atualizado na Steam.'});}
    if(route==='/api/profile'){const account=win.accounts(config.steamDir).find(a=>a.id===String(body.account));if(!account)throw Error('Perfil Steam não encontrado.');config.account=account.id;saveConfig();readSteamSnapshot();return send({message:'Perfil selecionado: '+account.name});}
    if(route==='/api/accounts')return send({accounts:win.accounts(typeof body.steamDir==='string'?body.steamDir:'')});
    if(route==='/api/detect'){config.steamDir=await win.detectSteam()||config.steamDir;const ac=win.accounts(config.steamDir);if(!config.account)config.account=ac.find(x=>x.recent)?.id||ac[0]?.id||'';
     for(const p of [path.join(ROOT,'Emuladores/PSP/PPSSPPWindows64.exe'),'C:\\SFP\\Emuladores\\PSP\\PPSSPPWindows64.exe'])if(!config.emulator&&fs.existsSync(p))config.emulator=p;
     const legacy='C:\\SFP\\Conquistas\\ra-helper.config.json';if(!config.raKey&&fs.existsSync(legacy)){const c=json(legacy,{});config.raKey=c.webApiKey||'';config.raUser=c.username||'';}const found=await inventory('emulators',defaultDiscoveryRoots(config,{appRoot:launcherExecutable?path.dirname(launcherExecutable):ROOT}));discoveryResult=found;discoveryAt=Date.now();applyDiscovery(config,found);saveConfig();return send({message:'Detecção concluída.',settings:configView()});}
    if(route==='/api/pick'){let paths=await picker(body.kind);if(/^steam/.test(body.kind))paths=await Promise.all(paths.map(p=>win.steamLocation(p)));if(body.kind==='art')paths.forEach(p=>pickedArts.add(p));return send({paths});}
    if(route==='/api/art-upload'){if(!pickedArts.has(body.path))throw Error('Selecione a imagem pelo botão do programa.');const stat=fs.statSync(body.path);if(!stat.isFile()||stat.size>16*1024*1024)throw Error('Use uma imagem de até 16 MB.');const bytes=fs.readFileSync(body.path),ext=imageType(bytes),name=digest(bytes)+'.'+ext;if(ext==='png'&&(bytes.length<24||!bytes.readUInt32BE(16)||!bytes.readUInt32BE(20)))throw Error('PNG inválido.');if(imageValidate)await imageValidate(bytes);atomic(path.join(dataDir,'art',name),bytes);uploadedArts.add(name);return send({name});}
    if(route==='/api/art-save'){const g=getGame(body.id),next={...g.art},pinned={...g.artPinned};if(!body.selections||typeof body.selections!=='object')throw Error('Seleção inválida.');for(const [kind,selection] of Object.entries(body.selections)){if(!['cover','hero','logo','icon','wide'].includes(kind))throw Error('Tipo de arte inválido.');if(typeof selection!=='string')throw Error('Seleção inválida.');if(selection===g.art?.[kind])continue;const choice=artChoices.get(selection);let name;if(choice&&choice.gameId===g.id&&choice.kind===kind)name=await providers.image(choice.url);else if(uploadedArts.has(selection))name=selection;else throw Error('Escolha uma imagem da galeria ou do computador.');if(kind!=='icon'&&name.endsWith('.ico'))throw Error('ICO pode ser usado somente no ícone.');next[kind]=name;pinned[kind]=true;}g.art=next;g.artPinned=pinned;persist();return send({message:'Artes escolhidas salvas. Atualize na Steam para aplicar.'});}
    if(route==='/api/scan'||route==='/api/discover'){
     // Busca automática: pastas configuradas nos emuladores, frontends e pastas de ROMs comuns, mais as lojas.
     const discovering=route==='/api/discover';let discovered=null,sweepFiles=[];
     if(discovering){
      // 1) Emuladores primeiro: as pastas de jogos ficam guardadas nas configurações deles.
      // (a busca da tela inicial acabou de fazer isso: reaproveita se tiver menos de 5 min)
      setDiscoverProgress('emulators');
      if(!discoveryResult||Date.now()-discoveryAt>300000)try{const appRoot=launcherExecutable?path.dirname(launcherExecutable):ROOT;discoveryResult=await inventory('emulators',[...new Set([...defaultDiscoveryRoots(config,{appRoot}),...emulatorSearchRoots()])].slice(0,1000));discoveryAt=Date.now();applyDiscovery(config,discoveryResult);saveConfig();}catch{}
      // 2) Pastas dos emuladores, frontends, ROMs comuns e as já escolhidas.
      discovered=discoverGameFolders(config);body.paths=discovered.paths;
      // 3) Varredura das pastas do usuário e das unidades: ISOs e ROMs soltas em qualquer lugar.
      if(body.sweep!==false)try{setDiscoverProgress('sweep');const sw=await inventory('sweep',sweepRoots({skip:discovered.paths,...(body.sweep==='home'?{drives:[]}:{})}));sweepFiles=sw.files||[];}catch{}
      config.discoveredAt=new Date().toISOString();saveConfig();
     }
     let pickedStores=null;if(!discovering&&Array.isArray(body.paths)&&body.paths.some(p=>/\.(lnk|url|exe)$/i.test(p))){const r=await resolvePicked(body.paths);body.paths=r.paths;pickedStores=r.stores;}
     if(discovering&&!body.paths.length&&!sweepFiles.length&&body.stores===false)return send({items:[],existing:[],skipped:0,errors:[],scanId:null,folders:[],sources:[]});
     if(discovering)setDiscoverProgress('folders');
     const scanned=body.paths?.length||!discovering?await inventory('scan',body.paths||config.roots):{files:[],errors:[]},scanResult={files:[...new Set([...scanned.files,...sweepFiles])],errors:scanned.errors},errors=discovering?scanResult.errors.filter(e=>!/muito grande|ENOENT|EPERM|EACCES/i.test(e.message||e)):[...scanResult.errors];
     const sweptOnly=new Set(sweepFiles.filter(f=>!scanned.files.includes(f)).map(f=>f.toLowerCase()));
     const candidates=inventoryCandidates(scanResult.files,db.games);if(candidates.length>1000)errors.push({file:'Busca',message:'Mostrando os primeiros 1.000 candidatos. Escolha uma pasta menor para revisar os demais.'});
     // Leitura dos jogos em lotes (cada lote em até 3 linhas de trabalho), com o andamento na tela.
     const toRead=candidates.slice(0,1000),inspected={items:[],errors:[]};
     for(let i=0;i<toRead.length;i+=48){setDiscoverProgress('read',i,toRead.length);const r=await inventory('inspect',toRead.slice(i,i+48));inspected.items.push(...(r.items||[]));inspected.errors.push(...(r.errors||[]));}
     setDiscoverProgress('identify',0,inspected.items.length);
     // Bancos de dumps e listas do RetroAchievements das plataformas achadas começam a baixar já, enquanto a tela
     // prepara a identificação (antes, cada jogo esperava o seu download na hora).
     if(config.preferences.autoLookup!==false)for(const key of new Set(inspected.items.map(i=>i.platformKey).filter(Boolean))){const p=platformByKey(key);for(const [set,system] of p?.dat||[])providers.dat?.index?.(set,system)?.catch?.(()=>{});if(p?.ra)providers.retro?.hashLibrary?.(p.ra)?.catch?.(()=>{});}errors.push(...(discovering?inspected.errors.filter(e=>!sweptOnly.has(String(e.file||'').toLowerCase())):inspected.errors));
     // Achados soltos pela varredura só entram com prova no conteúdo (cabeçalho) ou dentro de pasta de plataforma.
     if(sweptOnly.size)inspected.items=inspected.items.filter(i=>!sweptOnly.has(String(i.path).toLowerCase())||['header','folder'].includes(i.platformSource));
     // Busca automática: só jogos de emulador (o arquivo prova o jogo). Jogos de PC vêm das lojas ou da Pasta de atalhos.
     if(discovering)inspected.items=inspected.items.filter(i=>i.profile!=='pc'&&!/\.(exe|bat|cmd|lnk)$/i.test(i.path));
     // Busca de um emulador só (aba Emuladores): só os jogos que ele abre.
     if(body.profile&&REGISTRY_PROFILES[body.profile]){const pf=REGISTRY_PROFILES[body.profile],plats=pf.platforms||[pf.platform];inspected.items=inspected.items.filter(i=>i.profile===body.profile||plats.includes(i.platformName));}
     if(pickedStores?.length)inspected.items=inspected.items.map(i=>{const lp=String(i.path).toLowerCase(),st=pickedStores.find(x=>x.path.toLowerCase()===lp)||pickedStores.find(x=>x.store==='xbox'&&x.root&&lp.startsWith(String(x.root).toLowerCase().replace(/[\\/]+$/,'')+path.sep));return st?storeInfo(i,st):i;});
     const result=reconcile(db.games,inspected.items);if(inspected.items.some(g=>!['pc','custom'].includes(g.profile)&&!isFile(config.launchers?.[g.profile]?.exe)&&!(g.profile==='psp'&&isFile(config.emulator)))){const roots=[...(config.roots||[]),...(body.paths||[]).map(p=>isFile(p)?path.dirname(p):p)];discoveryResult=await inventory('emulators',defaultDiscoveryRoots({...config,roots},{appRoot:launcherExecutable?path.dirname(launcherExecutable):ROOT}));applyDiscovery(config,discoveryResult);saveConfig();}
     if(result.moved.length||result.changedIds.length)persist();
     const existing=scanResult.files.map(file=>db.games.find(g=>!g.demo&&g.path.toLowerCase()===file.toLowerCase())).filter(Boolean).map(g=>({id:g.id,title:g.title,path:g.path,hidden:!!g.hidden}));
     result.items=splitDuplicates(result.items,existing);
     for(const [key,v] of importSessions)if(Date.now()-v.at>3600000)importSessions.delete(key);
     if(importSessions.size>=20)importSessions.delete(importSessions.keys().next().value);
     let stores=[];if(discovering&&body.stores!==false){try{const st=await storePreview();stores=st.stores;errors.push(...st.errors);existing.push(...st.existing.filter(e=>!existing.some(x=>x.id===e.id)));for(const item of st.items)if(!result.items.some(i=>i.path.toLowerCase()===item.path.toLowerCase()))result.items.push(item);}catch(e){errors.push({file:'Lojas',message:e.message});}}
     const scanId=crypto.randomUUID();importSessions.set(scanId,{at:Date.now(),paths:new Set(result.items.map(i=>i.path.toLowerCase())),items:result.items});
     result.items.forEach(info=>delete info.icon);return send({...result,scanId,existing,skipped:existing.length,errors,...(discovering?{folders:discovered.folders.map(f=>({path:f.path,sources:f.sources})),sources:discovered.sources,stores}:{})});
    }
    // Jogos instalados pela Epic, GOG, Ubisoft, itch.io e Amazon (somente leitura dos registros das lojas).
    if(route==='/api/stores-scan'){
     const {items,existing,errors,stores}=await storePreview();
     for(const [key,v] of importSessions)if(Date.now()-v.at>3600000)importSessions.delete(key);if(importSessions.size>=20)importSessions.delete(importSessions.keys().next().value);
     const scanId=crypto.randomUUID();importSessions.set(scanId,{at:Date.now(),paths:new Set(items.map(i=>i.path.toLowerCase())),items});
     return send({items,scanId,existing,skipped:existing.length,errors,stores});
    }
    if(route==='/api/discover-progress')return send(discoverProgress);
    if(route==='/api/import-resolve'){
     const session=importSessions.get(body.scanId);if(!session||Date.now()-session.at>3600000)throw Error('Selecione os arquivos novamente.');
     const requested=Array.isArray(body.paths)?body.paths:session.items.map(g=>g.path);if(requested.length>25)throw Error('Identifique até 25 arquivos por chamada.');
     const autoLookup=config.preferences.autoLookup!==false;session.resolved||=new Map();
     for(const file of requested)if(!session.items.some(g=>g.path===file))throw Error('Arquivo fora da seleção.');
     // Quatro jogos identificados ao mesmo tempo (antes, um por um); a ordem da lista continua a mesma.
     const resolveOne=async file=>{const original=session.items.find(g=>g.path===file);const item={...original},platform=platformByKey(item.platformKey);item.profile=preferredProfile(item,config,platform?.profiles);delete item.icon;
      const saved=identityKey(item)?db.games.find(g=>identityKey(g)===identityKey(item)):null,remembered=saved?{title:saved.title,profile:saved.profile,platformName:saved.platformName}:identityChoices[identityKey(item)],same=internallyIdentified(item)?db.games.find(g=>g.discId===item.discId&&g.profile===item.profile&&g.internalTitle===item.internalTitle&&!g.demo):null;
      item.automatic=internallyIdentified(item);item.identificationReason=item.automatic?'Nome e código lidos do jogo':null;
      if(item.store){item.automatic=true;item.identificationReason='Nome lido da loja '+item.store.label;}
      if(remembered){Object.assign(item,remembered);item.automatic=true;item.identificationReason='Identificação escolhida anteriormente';}
      else if(same){item.title=same.title;item.automatic=true;item.identificationReason='Mesmo código interno de um jogo da coleção';}
      // Identificação sem chave: banco Redump/No-Intro, hash RetroAchievements e loja Steam (PC).
      if(!remembered&&!same&&!item.auxiliary&&autoLookup){
       try{const local=await identifyLocal(item,{providers});item.identificationReasons=local.reasons;if(local.automatic&&!item.automatic){item.automatic=true;item.identificationReason=local.reasons[0];}}catch{}
       if(item.profile==='pc')try{const pc=await identifyPC(item,{steamLink});if(pc.reasons.length)item.identificationReasons=[...(item.identificationReasons||[]),...pc.reasons];if(pc.automatic&&!item.automatic){item.automatic=true;item.identificationReason=pc.reasons.at(-1)||'Jogo encontrado na Steam';}item.steamSuggestions=pc.suggestions;}catch{}
      }
      if(!item.automatic&&!item.auxiliary&&autoLookup){try{
       const query=item.dat?.title||item.title,found=await providers.candidates(query,{platformKey:item.platformKey||null,allPlatforms:!item.platformKey,includeRA:false}),exact=exactIdentity(item,found);
       item.suggestionQuery=query;item.suggestions=choiceCards(found,{platformKey:item.platformKey||null,query}).slice(0,12);
       // Pontuação por título + plataforma: aceita sozinho só quando é claramente o melhor.
       const scored=item.platformKey?(found.igdb||[]).filter(isMainEntry).map(x=>({x,...scoreCandidate(query,x.name,{platformMatch:(x.platforms||[]).some(p=>platformByName(p.name)?.key===item.platformKey),aliases:(x.alternative_names||[]).map(a=>a.name)})})):[];
       const best=exact?{name:exact.name,igdb:exact.igdb,sgdb:exact.sgdb,platforms:exact.platforms}:(()=>{const c=confidentChoice(scored,{min:.93,gap:.1});if(!c)return null;const card=item.suggestions.find(s=>externalChoices.get(s.key)?.igdb?.id===c.x.id);return card?{...externalChoices.get(card.key)}:null;})();
       if(best){const key=crypto.randomBytes(16).toString('hex');externalChoices.set(key,{...best,at:Date.now()});item.choice=key;item.title=best.name;
        // Executable names alone are not proof: ask once, but show the best match.
        if((item.profile!=='pc'||item.identitySource==='PE ProductName')&&!item.needsReview){item.automatic=true;item.identificationReason=exact?'Nome exato e plataforma compatível':'Melhor correspondência para a plataforma detectada';}
       }
      }catch{item.lookupUnavailable=true;}}
      if(platform)item.platformShort=platform.short;
      session.resolved.set(item.path.toLowerCase(),{raId:item.raId||null,canonicalName:item.canonicalName||null,dat:item.dat||null,steamAppId:item.steamAppId||null,identificationReasons:item.identificationReasons||[]});
      session.resolvedCount=(session.resolvedCount||0)+1;setDiscoverProgress('identify',Math.min(session.resolvedCount,session.items.length),session.items.length);return item;};
     const items=new Array(requested.length);let nextItem=0;await Promise.all(Array.from({length:Math.min(4,requested.length)},async()=>{while(nextItem<requested.length){const i=nextItem++,file=requested[i];
      // Limite de 30 s por jogo: serviço lento não prende a busca; o jogo segue com o que já foi lido do arquivo.
      let timer;const late=new Promise(r=>{timer=setTimeout(()=>{const o=session.items.find(g=>g.path===file),auto=internallyIdentified(o);r({...o,profile:preferredProfile(o,config,platformByKey(o.platformKey)?.profiles),automatic:auto,identificationReason:auto?'Nome e código lidos do jogo':null,lookupUnavailable:true,icon:undefined});},30000);});
      items[i]=await Promise.race([resolveOne(file),late]);clearTimeout(timer);}}));return send({items});
    }
    if(route==='/api/import-confirm'){
     const session=importSessions.get(body.scanId);if(!session||Date.now()-session.at>3600000)throw Error('A revisão expirou. Selecione os arquivos novamente.');
     if(!Array.isArray(body.items)||!body.items.length||body.items.length>500)throw Error('Selecione entre 1 e 500 jogos.');
     for(const item of body.items){if(typeof item.path!=='string'||!session.paths.has(path.resolve(item.path).toLowerCase()))throw Error('Revise os arquivos encontrados antes de adicionar.');if(!PROFILES[item.profile])throw Error('Escolha um perfil válido.');const scanned=session.items.find(g=>g.path.toLowerCase()===path.resolve(item.path).toLowerCase()),stat=(()=>{try{return fs.statSync(item.path);}catch(e){if(scanned&&/\.exe$/i.test(item.path)&&/^(EPERM|EACCES)$/.test(String(e?.code||'')))return {size:scanned.bytes,mtimeMs:scanned.mtime};throw e;}})();if(!scanned||scanned.bytes!==stat.size||scanned.mtime!==stat.mtimeMs)throw Error('O arquivo mudou durante a identificação. Selecione-o novamente.');if(item.choice){const choice=externalChoices.get(item.choice);if(!choice||Date.now()-choice.at>3600000)throw Error('A identificação expirou. Pesquise novamente.');}}
     const pre=body.items.map(i=>session.items.find(g=>g.path.toLowerCase()===path.resolve(i.path).toLowerCase())).filter(Boolean);
     const result=await addFiles(body.items.map(i=>i.path),{known:pre.length===body.items.length&&pre.every(x=>x.fingerprint&&x.profile!=='pc'&&!x.store)?pre.map(x=>structuredClone(x)):null});
     for(const id of result.addedIds){const g=getGame(id),item=body.items.find(i=>path.resolve(i.path).toLowerCase()===g.path.toLowerCase());if(!item)continue;
      if(typeof item.title==='string'&&item.title.trim())g.title=item.title.trim().slice(0,200);g.profile=item.profile;g.needsReview=g.profile==='custom';g.platformName=String(item.platformName||PROFILES[item.profile].platform).slice(0,150);
      const chosenPlatform=platformByName(g.platformName);if(chosenPlatform)g.platformKey=chosenPlatform.key;
      // Resultado da identificação local (dump verificado, hash RA, AppID Steam).
      const storeItem=session.items.find(i=>i.path.toLowerCase()===g.path.toLowerCase())?.store;if(storeItem){g.store={name:storeItem.name,label:storeItem.label,id:storeItem.id,...(storeItem.namespace?{namespace:storeItem.namespace,appName:storeItem.appName||''}:{})};if(storeItem.needsLauncher&&storeItem.url){g.profile='store';g.launch={exe:storeItem.launcherExe||explorer(),args:storeItem.url};g.needsReview=false;}else if(storeItem.args)g.launch={args:storeItem.args};}
      const resolved=session.resolved?.get(g.path.toLowerCase()),detectedKey=session.items.find(i=>i.path.toLowerCase()===g.path.toLowerCase())?.platformKey||null;if(resolved&&(!chosenPlatform||!detectedKey||chosenPlatform.key===detectedKey)){if(resolved.raId){g.raId=resolved.raId;g.raSource='hash';}if(resolved.canonicalName){g.canonicalName=resolved.canonicalName;if(resolved.dat?.title&&g.title===resolved.dat.title)g.titleSource='dat';}if(resolved.dat)g.dat=resolved.dat;if(resolved.steamAppId&&g.profile==='pc'){g.metadataSteamAppId=resolved.steamAppId;}if(resolved.identificationReasons?.length)g.identification={reasons:resolved.identificationReasons,at:new Date().toISOString()};}
      const warnings=[];if(item.choice){const choice=externalChoices.get(item.choice);g.title=choice.name;g.metadata={};if(!resolved?.raId){delete g.raId;delete g.raSource;}if(body.deferred){pendingFinish.set(g.id,{choice});if(choice.previewArt&&!g.art?.cover&&isFile(path.join(dataDir,'art',path.basename(choice.previewArt))))g.art={...(g.art||{}),cover:path.basename(choice.previewArt)};}else try{warnings.push(...await providers.enrich(g,{igdb:choice.igdb,sgdb:choice.sgdb,free:choice.free}));}catch(e){warnings.push(e.message);}}
      if(item.gameRoot&&body.deferred&&['pc','ps3','vita3k','shadps4'].includes(g.profile)){g.gameRoot=item.gameRoot;pendingFinish.set(g.id,{...(pendingFinish.get(g.id)||{}),root:item.gameRoot});}
      else if(item.gameRoot&&['pc','ps3','vita3k','shadps4'].includes(g.profile))try{const size=await inventory('size',[item.gameRoot]);if(size.items[0]){g.installedBytes=size.items[0].bytes;g.gameRoot=size.items[0].root;g.sizeBasis='Arquivos da pasta do jogo, medidos em '+size.items[0].at;g.sizeMeasuredAt=size.items[0].at;}else warnings.push(...size.errors.map(e=>e.message));}catch(e){warnings.push('Tamanho: '+e.message);}
      if(!body.deferred)await autoSteamLink(g);else pendingFinish.set(g.id,{...(pendingFinish.get(g.id)||{}),link:true});
      // Jogo de PC já na coleção por outra loja/pasta (mesmo jogo da Steam): não fica duplicado.
      {const sidNew=steamAppIdFor(g),twin=sidNew&&db.games.find(o=>o!==g&&!o.demo&&!o.native&&['pc','store','custom'].includes(o.profile)&&steamAppIdFor(o)===sidNew);if(twin){db.games.splice(db.games.indexOf(g),1);result.addedIds=result.addedIds.filter(x=>x!==g.id);result.errors.push({file:g.path,message:duplicateMessage({reason:'steam',title:twin.title})});continue;}}
      if(warnings.length)g.lookup={at:new Date().toISOString(),warnings};
      const key=identityKey(g);if(key)identityChoices[key]={title:g.title,profile:g.profile,platformName:g.platformName};
     }try{mergePortTwins();}catch{}persist();save(identityFile,identityChoices);for(const item of body.items)session.paths.delete(path.resolve(item.path).toLowerCase());session.items=session.items.filter(i=>session.paths.has(i.path.toLowerCase()));if(!session.paths.size)importSessions.delete(body.scanId);if(body.deferred){result.deferred=true;return send(result);}result.steam=await autoAddToSteam(result.addedIds);return send(result);
    }
    // Segunda parte da importação, em segundo plano: artes e dados escolhidos, AppID da Steam, tamanho da pasta e envio à Steam.
    if(route==='/api/import-finish'){const ids=(Array.isArray(body.ids)?body.ids:[]).filter(id=>db.games.some(g=>g.id===id));
     // No máximo 6 jogos ao mesmo tempo: muitas buscas juntas esbarram no limite das APIs e ficam mais lentas.
     {let next=0;const one=async id=>{const g=getGame(id),job=pendingFinish.get(id)||{};pendingFinish.delete(id);try{if(await quickCover(g,job.choice))persist();}catch{}try{if(applyDirectPlay(g))persist();}catch{}try{if(job.choice)await providers.enrich(g,{igdb:job.choice.igdb,sgdb:job.choice.sgdb,free:job.choice.free});}catch{}try{if(job.link!==false)await autoSteamLink(g);}catch{}try{if(providers.completeMissing)await providers.completeMissing(g);}catch{}try{if(job.link!==false&&!steamAppIdFor(g))await autoSteamLink(g);}catch{}try{await providers.localize(g);}catch{}achievementManager.get(g,{quiet:true}).catch(()=>{});};await Promise.all(Array.from({length:Math.min(6,ids.length)},async()=>{while(next<ids.length)await one(ids[next++]);}));}
     // O AppID da Steam só é conhecido agora: o mesmo jogo já na coleção (outra loja/pasta) não entra duas vezes.
     const merged=[];for(const id of [...ids]){const g=db.games.find(x=>x.id===id);if(!g||g.bindings?.[config.account])continue;const sid=steamAppIdFor(g),twin=sid&&db.games.find(o=>o!==g&&!o.demo&&!o.native&&!o.hidden&&['pc','store','custom'].includes(o.profile)&&steamAppIdFor(o)===sid);if(twin){db.games.splice(db.games.indexOf(g),1);ids.splice(ids.indexOf(id),1);merged.push(twin.title);nglNote('Importação: '+g.title+' já estava na coleção como '+twin.title+'; não foi duplicado.');}}
     persist();const steam=ids.length?await autoAddToSteam(ids):null;try{injector?.reload?.();}catch{}setTimeout(()=>refreshSteamLive(),20000).unref?.();
     for(const id of ids){const job=null;const g=db.games.find(x=>x.id===id);if(g?.gameRoot&&['pc','ps3','vita3k','shadps4'].includes(g.profile)&&!g.installedBytes)inventory('size',[g.gameRoot]).then(r=>{const sz=r.items[0];if(sz){g.installedBytes=sz.bytes;g.gameRoot=sz.root;g.sizeBasis='Arquivos da pasta do jogo, medidos em '+sz.at;g.sizeMeasuredAt=sz.at;persist();}}).catch(()=>{});}
     return send({steam,merged});}
    if(route==='/api/game-size'){const g=getGame(body.id);if(g.native||g.demo)throw Error('Selecione um jogo com arquivo local.');const result=await inventory('size',[body.path||g.gameRoot]);if(!result.items[0])throw Error(result.errors[0]?.message||'Não foi possível medir a pasta.');const size=result.items[0];g.installedBytes=size.bytes;g.gameRoot=size.root;g.sizeBasis='Arquivos da pasta do jogo, medidos em '+size.at;g.sizeMeasuredAt=size.at;persist();return send({message:'Tamanho da pasta atualizado.',size});}
    if(route==='/api/launch'){
     const g=getGame(body.id);if(!PROFILES[body.profile])throw Error('Perfil inválido.');
     const next={...g,profile:body.profile,platformName:String(body.platformName||PROFILES[body.profile].platform).slice(0,150),launch:{exe:String(body.exe||'').trim(),args:String(body.args??PROFILES[body.profile].args).slice(0,2000),core:String(body.core||'').trim()}};
     if(next.profile==='pc'&&!/\.exe$/i.test(g.path)&&!g.demo)throw Error('Selecione o executável Windows do jogo.');
     next.needsReview=next.profile==='custom';Object.assign(g,next);if(body.saveDefault){config.launchers||={};config.launchers[g.profile]={...g.launch};saveConfig();}persist();return send({message:'Perfil salvo. Atualize o atalho na Steam.'});
    }
    if(route==='/api/external-search'){
     const query=String(body.query||'').trim();if(query.length<2||query.length>200)throw Error('Digite entre 2 e 200 caracteres para pesquisar.');
     const platformKey=body.platformKey&&platformByKey(body.platformKey)?String(body.platformKey):null;
     const found=await providers.candidates(query,{allPlatforms:!platformKey,platformKey,includeRA:false});if(!body.preserveChoices)externalChoices.clear();for(const [key,v] of externalChoices)if(Date.now()-v.at>3600000)externalChoices.delete(key);if(externalChoices.size>2000)externalChoices.clear();
     return send({items:choiceCards(found,{platformKey,query}),warnings:found.errors||[]});
    }
    if(route==='/api/external-add'){
     const item=externalChoices.get(body.choice);if(!item||Date.now()-item.at>600000)throw Error('Pesquise novamente antes de adicionar este jogo.');
     const platform=item.platforms.find(p=>String(p.id)===String(body.platform));if(!platform)throw Error('Selecione uma plataforma da lista.');
     const old=db.games.find(g=>(item.igdb&&g.igdbId===item.igdb.id||item.sgdb&&g.sgdbId===item.sgdb.id||normalize(g.title)===normalize(item.name))&&((g.platformName||'PlayStation Portable')===platform.name||(g.platformInferred&&platform.name==='Não informada')));
     if(old){const restored=!!old.hidden;old.hidden=false;if(restored)persist();return send({id:old.id,existing:true,warnings:[],message:restored?'Jogo devolvido à coleção.':'Este jogo já está na coleção.'});}
     const id='external-'+crypto.randomUUID(),g={id,title:item.name.slice(0,200),external:true,demo:true,path:'demo:'+id,platformName:platform.name,bytes:0,art:{},bindings:{},metadata:{},platformId:Number(platform.id)||null,presentationRevision:139};
     const warnings=await providers.enrich(g,{igdb:item.igdb,sgdb:item.sgdb,free:item.free});if(providers.completeMissing)warnings.push(...await providers.completeMissing(g));
     if(providers.completeMissing)warnings.push(...await providers.completeMissing(g));else if(needsMetadata(g))warnings.push(...await providers.fillMetadata(g));
     // Só PSP pode usar a associação RetroAchievements já implementada.
     if(platform.name==='PlayStation Portable'){try{const found=await providers.candidates(item.name,{onlyRA:true});const ra=found.ra.filter(r=>normalize(r.name)===normalize(item.name));if(ra.length===1)g.raId=Number(ra[0].id);}catch(e){warnings.push('Conquistas: '+e.message);}}
     const sample=DEMOS.find(d=>normalize(d.title)===normalize(g.title)&&d.platformName===g.platformName);if(sample){g.bytes=sample.bytes;g.sizeBasis=sample.sizeBasis;g.sizeApproximate=!!sample.sizeApproximate;}
     ensureDemoSize(g);g.lookup={at:new Date().toISOString(),warnings,automatic:[]};db.games.push(g);persist();return send({id:g.id,existing:false,warnings,message:'Jogo adicionado à coleção. Você já pode adicioná-lo à Steam.'});
    }
    if(route==='/api/collection-hide-many'){if(!Array.isArray(body.ids)||!body.ids.length)throw Error('Selecione os jogos.');const games=[...new Set(body.ids)].map(getGame);if(games.some(g=>g.native))throw Error('Selecione jogos da coleção.');for(const g of games)g.hidden=true;persist();return send({message:games.length+' jogo(s) removido(s) da coleção. Arquivos e atalhos da Steam preservados.'});}
    // Remover: sai da Steam e do Taiga Launcher de uma vez. Arquivos e saves nunca são apagados; um jogo vindo da Pasta de
    // atalhos fica ignorado (não volta na próxima leitura) até ser recuperado em Configurações.
    if(route==='/api/remove-games'){if(!Array.isArray(body.ids)||!body.ids.length)throw Error('Selecione os jogos.');const games=[...new Set(body.ids)].map(getGame);if(games.some(g=>g.native))throw Error('Selecione jogos da coleção.');
     const bound=games.filter(g=>g.bindings?.[config.account]).map(g=>g.id);if(bound.length)await sync(bound,{remove:true,restart:config.preferences?.closeSteam!==false,openSteam:config.preferences?.closeSteam!==false});
     const ignore=new Set(config.shortcutIgnore||[]);for(const g of games){g.hidden=true;if(g.shortcutSource)ignore.add(g.shortcutSource.toLowerCase());}config.shortcutIgnore=[...ignore];saveConfig();persist();
     return send({message:games.length===1?'Jogo removido. Os arquivos e saves continuam no seu PC.':'{0} jogos removidos. Os arquivos e saves continuam no seu PC.'.replace('{0}',games.length)});}
    if(route==='/api/port-twin-separate'){const port=getGame(body.id);const g=db.games.find(x=>x.mergedInto===port.id);if(g){g.hidden=false;g.keepSeparate=true;delete g.mergedInto;delete g.hiddenReason;}delete port.consoleTwin;persist();return send({message:'Versão de console mostrada separada.'});}
    if(route==='/api/collection-hide'){const g=getGame(body.id);g.hidden=true;persist();return send({message:'Jogo removido da coleção. Você pode recuperá-lo nas Configurações.'});}
    if(route==='/api/collection-restore'){const g=getGame(body.id);g.hidden=false;if(g.mergedInto){g.keepSeparate=true;const port=db.games.find(x=>x.id===g.mergedInto);if(port)delete port.consoleTwin;delete g.mergedInto;delete g.hiddenReason;}if(g.shortcutSource)config.shortcutIgnore=(config.shortcutIgnore||[]).filter(f=>f!==g.shortcutSource.toLowerCase());saveConfig();persist();let steam=null;if(!g.demo&&config.preferences?.autoSync!==false)try{steam=await autoAddToSteam([g.id]);}catch{}return send({message:'Jogo devolvido à coleção.',steam});}
    if(route==='/api/add-demos'){const addedIds=[];for(const demo of DEMOS){const existing=db.games.find(g=>g.id===demo.id);if(existing){if(existing.demo){existing.bytes=demo.bytes;existing.sizeBasis=demo.sizeBasis;existing.sizeApproximate=!!demo.sizeApproximate;delete existing.sizeSynthetic;existing.metadata||={};if(!existing.metadata.release)existing.metadata.release=demo.metadata.release;}continue;}db.games.push(structuredClone(demo));addedIds.push(demo.id);}persist();return send({addedIds,message:'Quatro exemplos de demonstração disponíveis na coleção.'});}
    if(route==='/api/refresh-presentation'){const g=getGame(body.id),warnings=[];
     // Jogos antigos: calcula o hash RetroAchievements do arquivo para reconhecer o conjunto sem conta.
     const rp=platformOf(g);if(!g.demo&&!g.raId&&rp?.ra&&isFile(g.path)&&config.preferences.autoLookup!==false)try{const r=await inventory('inspect',[g.path]),it=r.items[0];if(it?.raHash){const id=await providers.raGameId(it.raHash,rp);if(id){g.raId=id;g.raSource='hash';}}}catch{}if(providers.completeMissing)warnings.push(...await providers.completeMissing(g));else if(needsMetadata(g))warnings.push(...await providers.fillMetadata(g));ensureDemoSize(g);if(g.demo&&!g.sgdbId&&config.sgdbKey){try{const list=await providers.sg('search/autocomplete/'+encodeURIComponent(g.title)),exact=list.filter(x=>normalize(x.name)===normalize(g.title));if(exact.length){warnings.push(...await providers.enrich(g,{sgdb:exact[0]}));}else warnings.push('Escolha a correspondência SteamGridDB em Capas e dados para este exemplo.');}catch(e){warnings.push(e.message);}}warnings.push(...await providers.refreshPresentation(g));if(providers.refreshMedia)warnings.push(...await providers.refreshMedia(g));g.presentationRevision=139;g.lookup={...(g.lookup||{}),at:new Date().toISOString(),warnings};persist();return send({warnings});}
    if(route==='/api/recognize')return send(await recognize(body.id,body.query));
    if(route==='/api/select'){const g=getGame(body.id),choices=matches.get(g.id);if(!choices)throw Error('Pesquise o jogo primeiro.');const selected={};for(const k of ['sgdb','igdb','ra'])if(body[k]){const item=choices[k].find(x=>String(x.id)===String(body[k]));if(!item)throw Error('Seleção inválida');selected[k]=item;}
     if(body.replaceIdentity&&(selected.igdb||selected.sgdb)){const chosen=selected.igdb||selected.sgdb;g.aliases=[...new Set([...(g.aliases||[]),g.title])];g.title=chosen.name;g.metadata={};g.metadataPinned={};g.media=[];delete g.igdbId;delete g.sgdbId;if(g.raSource!=='hash')delete g.raId;g.art=Object.fromEntries(Object.entries(g.art||{}).filter(([k])=>g.artPinned?.[k]));}const warnings=await providers.enrich(g,selected);if(body.replaceIdentity&&selected.sgdb&&!selected.igdb&&providers.fillMetadata)warnings.push(...await providers.fillMetadata(g));g.lookup={at:new Date().toISOString(),warnings,automatic:[]};persist();return send({message:'Dados atualizados.',warnings});}
    // Escolha de um cartão agrupado (IGDB + SteamGridDB correspondente + RA de mesmo nome).
    if(route==='/api/select-choice'){const g=getGame(body.id),choice=externalChoices.get(body.choice);if(!choice||Date.now()-choice.at>3600000)throw Error('Pesquise novamente antes de escolher.');const selected={};if(choice.igdb)selected.igdb=choice.igdb;if(choice.sgdb)selected.sgdb=choice.sgdb;if(choice.free)selected.free=choice.free;const ra=(matches.get(g.id)?.ra||[]).filter(x=>titleKey(x.name)===titleKey(choice.name));if(ra.length===1)selected.ra=ra[0];
     if(body.replaceIdentity!==false){g.aliases=[...new Set([...(g.aliases||[]),g.title])];g.title=choice.name;g.metadata={};g.metadataPinned={};g.media=[];delete g.igdbId;delete g.sgdbId;if(g.raSource!=='hash')delete g.raId;g.art=Object.fromEntries(Object.entries(g.art||{}).filter(([k])=>g.artPinned?.[k]));}
     const preferred=preferredPlatform(choice,platformOf(g)?.key);if(preferred)g.platformId=Number(preferred.id)||g.platformId;
     const warnings=await providers.enrich(g,selected);if(!selected.igdb&&providers.fillMetadata&&(!providers.igAvailable||providers.igAvailable()))warnings.push(...await providers.fillMetadata(g));if(providers.completeMissing)warnings.push(...await providers.completeMissing(g));g.lookup={at:new Date().toISOString(),warnings,automatic:[]};persist();return send({message:'Dados atualizados.',warnings});}
    if(route==='/api/edit'){const g=getGame(body.id);let replacement;if(body.path){replacement=inspectGame(body.path);if(g.external&&g.platformName!=='Não informada'&&replacement.platformName!=='Não informada'&&g.platformName!==replacement.platformName)throw Error('O arquivo identificado pertence a outra plataforma. Corrija o perfil antes de vincular.');if(db.games.some(other=>other.id!==g.id&&other.path.toLowerCase()===replacement.path.toLowerCase()))throw Error('Este arquivo já pertence a outro jogo da coleção.');if(g.discId&&replacement.discId!==g.discId)throw Error('O código do novo arquivo é diferente.');}if(typeof body.title==='string'&&body.title.trim()&&body.title.trim()!==g.title){g.aliases=[...new Set([...(g.aliases||[]),g.title])];g.title=body.title.trim().slice(0,200);g.titleSource='manual';}if(replacement){g.path=replacement.path;g.bytes=replacement.bytes;delete g.installedBytes;delete g.gameRoot;g.discId=replacement.discId;g.platformName=replacement.platformName;g.profile=replacement.profile;g.demo=false;g.external=false;delete g.sizeBasis;delete g.sizeApproximate;delete g.sizeSynthetic;}persist();return send({message:'Cadastro atualizado. Aplique novamente à Steam para atualizar o atalho.'});}
    if(route==='/api/art-list'){const g=getGame(body.id),hadSgdb=g.sgdbId;const items=await providers.artwork(g,body.kind,body.page,{steamAppId:g.native&&!g.shortcut?Number(g.appId):steamAppIdFor(g)});if(!hadSgdb&&g.sgdbId)persist();const choices=items.map(item=>{const key=crypto.randomBytes(12).toString('hex');artChoices.set(key,{...item,gameId:g.id,kind:body.kind});return {...item,choice:key};});return send({items:choices});}
    if(route==='/api/art-select'){const g=getGame(body.id),choice=artChoices.get(body.choice);if(!choice||choice.gameId!==g.id||choice.kind!==body.kind)throw Error('Escolha uma imagem da galeria deste jogo.');const name=await providers.image(choice.url);g.art||={};g.art[body.kind]=name;g.artPinned||={};g.artPinned[body.kind]=true;persist();return send({message:'Arte selecionada. Aplique à Steam para atualizar.'});}
    if(route==='/api/metadata'){const g=getGame(body.id),m={...g.metadata};for(const k of ['summary','developer','publisher','release'])if(typeof body[k]==='string'){const value=body[k].trim().slice(0,k==='summary'?12000:300);if(value!==String(m[k]||'')){g.metadataPinned||={};g.metadataPinned[k]=true;}m[k]=value;}if(typeof body.release==='string'){if(body.release&&(!/^\d{4}-\d{2}-\d{2}$/.test(body.release)||Number.isNaN(Date.parse(body.release))||new Date(body.release).toISOString().slice(0,10)!==body.release))throw Error('Data de lançamento inválida.');delete m.releaseBasis;}if(typeof body.summary==='string'&&m.summary!==String(g.metadata?.summary||'')){m.summaryLanguage=detectLanguage(m.summary)||config.language||sysLang;delete m.summaryOriginal;}g.metadata=m;persist();return send({message:'Informações salvas. Aplique à Steam para atualizar o painel.'});}
    if(route==='/api/restore-original-script'){validatePaths(false);const target=scriptTarget();if(isFile(target))fs.copyFileSync(target,target+'.backup-'+Date.now());atomic(target,fs.readFileSync(path.join(ROOT,'reference/libraryroot.original.js')));return send({message:'Script original enviado por você restaurado. Reinicie a Steam e use os helpers do projeto antigo para seus módulos originais.'});}
    if(route==='/api/install-script')return send(installScript());
    if(route==='/api/sync')return send(await sync(body.ids||[],{restart:!!body.restart,remove:!!body.remove,openSteam:!!body.openSteam,installIntegration:body.installIntegration!==false,adopt:body.adopt||{}}));
    if(route==='/api/test-apis'){const results={};for(const [k,fn] of [['SteamGridDB',()=>providers.sg('search/autocomplete/Patapon')],['IGDB',()=>providers.ig('fields name; where platforms = (38); limit 1;')],['RetroAchievements',async()=>{if(config.raKey)return providers.ra('API_GetUserSummary.php',{u:config.raUser,g:0,a:0});const cred=providers.retro.credentials();if(!cred)throw Error('Nenhuma conta encontrada. Entre no RetroAchievements em um emulador ou nas Configurações (opcional).');await providers.retro.unlocks(1,cred,false);}]])try{await fn();results[k]='Conexão aceita';}catch(e){results[k]=e.message;}return send({results});}
    return send({error:'Rota não encontrada'},404);
   }finally{if(!free)busy=false;}
  }catch(e){send({error:e.message||'Falha na operação.'},400);}
 });
 server.on('listening',()=>{setWatchRoots();collectSessions();try{mergePortTwins();}catch{}if(startInjector)setTimeout(()=>findPortsNearConsoleGames().catch(()=>{}),12000).unref?.();try{let n=0;for(const g of db.games)if(!g.hidden&&applyDirectPlay(g))n++;if(n)persist();}catch{}for(const game of db.games.filter(g=>!g.demo&&!g.hidden))autoSteamLink(game);});server.on('close',()=>{closed=true;try{presence?.close();}catch{}watcher.close();queue.close();clearInterval(sessionTimer);});
 // Injetor próprio (sem SFP/Millennium): conecta à Steam aberta com depuração do CEF e injeta os painéis.
 // Conquistas em tempo real (como no Steam Achievement Notifier): jogo aberto pelo Taiga Launcher é relido a cada
 // 8 s; arquivos de progresso conhecidos (emuladores de Steam, Steam local, RPCS3, Vita3K...) são conferidos a
 // cada 20 s mesmo quando o jogo foi aberto por fora; o log do emulador antecipa desbloqueios do RetroAchievements.
 const progressMarks=new Map();let liveBusy=false;
 const liveTimer=setInterval(async()=>{if(closed||liveBusy)return;liveBusy=true;try{for(const g of db.games){if(g.hidden||g.demo||!g.uuid)continue;let running=false;try{running=!!sessions.forGame(g.uuid,config.account)?.running;}catch{}if(running){try{await achievementManager.get(g,{live:true});}catch{}continue;}const f=achievementManager.cached(g)?.progressFile;if(!f)continue;let m;try{m=fs.statSync(f).mtimeMs;}catch{continue;}const old=progressMarks.get(g.id);progressMarks.set(g.id,m);if(old!==undefined&&old!==m)try{await achievementManager.get(g);}catch{}}}finally{liveBusy=false;}},8000);liveTimer.unref?.();
 const raLog=new RALogWatcher({files:()=>raLogCandidates(config),onEvent:e=>{if(e.type!=='award'&&e.type!=='start')return;const g=db.games.find(x=>x.raId&&Number(x.raId)===Number(e.gameId)&&!x.hidden);if(!g)return;setTimeout(()=>achievementManager.get(g,{live:e.type==='award'?1:true}).catch(()=>{}),e.type==='award'?1500:0);}});
 // Troféus de ports nativos (SpartanPort e parecidos): o desbloqueio aparece no log do port e é guardado aqui.
 // Lista de arquivos de cada port guardada por 20 s (o ciclo de 1,5 s só lê o tamanho dos arquivos).
 const portFilesCache=new Map();
 const portLog=new PortLogWatcher({games:()=>db.games.filter(g=>!g.demo&&!g.hidden&&['pc','custom'].includes(g.profile)&&(g.achievementSettings?.provider||'auto')!=='none').flatMap(g=>{const port=portOf(g);if(!port)return [];const k=g.path+'|'+g.uuid,hit=portFilesCache.get(k);if(hit&&Date.now()-hit.at<20000)return hit.files.map(file=>({game:g,file}));const files=portLogFiles(g.path,{extra:g.uuid?[portCaptureFile(dataDir,g.uuid)]:[]});portFilesCache.set(k,{at:Date.now(),files});return files.map(file=>({game:g,file}));}),
  onUnlock:(g,id,{live,file})=>{(async()=>{const store=achievementManager.portStore,key=portStoreKey(g,file);if(store.get(key).unlocked[String(id)])return;if(live)await achievementManager.get(g,{quiet:true}).catch(()=>{});if(!store.record(key,id))return;nglNote('Troféu '+id+' de '+g.title+(live?' desbloqueado agora.':' encontrado no log da última sessão.'));await achievementManager.get(g,live?{live:1}:{quiet:true}).catch(()=>{});})().catch(()=>{});}});
 if(startInjector){raLog.start();portLog.start();}
 // Integração sempre ligada, como no Millennium: o marcador .cef-enable-remote-debugging faz a Steam abrir a porta
 // de depuração local (127.0.0.1:8080) mesmo quando é aberta pelo atalho normal, pela inicialização do Windows ou
 // depois de se atualizar sozinha. Sem ele, a Steam precisa receber -cef-enable-debugging (o Taiga Launcher passa ao abrir).
 const cefMarker=()=>config.steamDir?path.join(config.steamDir,'.cef-enable-remote-debugging'):'';
 function ensureCefMarker(){const f=cefMarker();if(!f||!isFile(path.join(config.steamDir,'steam.exe')))return false;try{if(config.injectSteam!==false){if(!fs.existsSync(f)){fs.writeFileSync(f,'');config.cefMarkerCreated=true;saveConfig();}return true;}if(config.cefMarkerCreated&&fs.existsSync(f)){fs.rmSync(f,{force:true});config.cefMarkerCreated=false;saveConfig();}}catch(e){nglNote('Marcador CEF: '+e.message);}return false;}
 ensureCefMarker();
 // O script antigo do painel (modo SFP) desenhava a página velha por cima da página nova. Com a integração própria
 // ligada, o arquivo instalado pelo Taiga Launcher volta a ser o que o usuário tinha antes (ou um arquivo vazio).
 function retireSfpScript(){try{if(config.injectSteam===false||!config.steamDir)return false;const target=scriptTarget();if(!isFile(target))return false;const text=fs.readFileSync(target,'utf8');if(!/Taiga Steam PSP 1\.2/.test(text))return false;
  const dir=path.dirname(target),backups=fs.readdirSync(dir).filter(n=>/^libraryroot\.custom\.js\.backup-\d+$/.test(n)).sort((a,b)=>Number(b.split('-').pop())-Number(a.split('-').pop()));let restore=null;
  for(const n of backups){try{const t=fs.readFileSync(path.join(dir,n),'utf8');if(!/Taiga Steam PSP 1\.2/.test(t)){restore=t;break;}}catch{}}
  fs.copyFileSync(target,target+'.backup-'+Date.now());atomic(target,restore??'// Taiga Launcher: a página dos jogos agora é colocada pelo próprio Taiga Launcher (sem SFP).\n');nglNote('Script antigo do SFP retirado de '+target);return true;}catch(e){nglNote('Script do SFP: '+e.message);return false;}}
 retireSfpScript();
 // Steam aberta sem a porta: avisa uma vez (ou reinicia sozinha se o usuário pediu), como o "Force Steam arguments" do SFP.
 async function checkIntegration(){if(closed||integration.checking||config.injectSteam===false||!config.steamDir||!startInjector)return;integration.checking=true;try{const st=injector.status();if(st.connected&&st.windows.length){integration.needsRestart=false;integration.since=0;return;}if(integration.downAt&&Date.now()-integration.downAt<15000)return;const up=await win.running().catch(()=>false);if(!up){integration.downAt=Date.now();integration.needsRestart=false;integration.since=0;return;}integration.downAt=0;
   if(!integration.since){integration.since=Date.now();return;}if(Date.now()-integration.since<15000)return;integration.needsRestart=true;
   const ownRunning=db.games.some(g=>!g.demo&&g.uuid&&sessions.forGame(g.uuid,config.account)?.running);
   if(config.autoRestartSteam===true&&!ownRunning&&!integration.restarting){integration.restarting=true;try{nglNote('Steam sem integração: reiniciando automaticamente.');await win.stopSteam(config.steamDir);ensureCefMarker();win.startSteam(config.steamDir,Number(config.steamDebugPort)||DEFAULT_DEBUG_PORT);integration.since=0;integration.needsRestart=false;}catch(e){nglNote('Reinício automático falhou: '+e.message);}finally{integration.restarting=false;}return;}
   if(Date.now()-integration.notifiedAt>3600000){integration.notifiedAt=Date.now();try{onSteamNeedsIntegration?.();}catch{}}
  }finally{integration.checking=false;}}
 const integrationTimer=setInterval(()=>{checkIntegration().catch(()=>{});},5000);integrationTimer.unref?.();
 // Diagnóstico para suporte: estado da integração, registros e configuração sem senhas/chaves.
 async function diagnostics(){const redact=v=>v?'(definido)':'';const c={...config};if(c.xboxAuth)c.xboxAuth={connected:true,gamertag:c.xboxAuth.gamertag};for(const k of ['ps4TrophyKey','sgdbKey','igdbSecret','igdbId','own_sgdbKey','own_igdbSecret','own_igdbId','raKey','steamKey','adminToken','readToken','raToken','raPassword','profileKey'])if(k in c)c[k]=redact(c[k]);if(c.epicAuth)c.epicAuth={connected:true,accountId:c.epicAuth.accountId};if(c.psnAuth)c.psnAuth={connected:true};if(c.commentsAuth)c.commentsAuth={connected:true,steamid:c.commentsAuth.steamid};
  const up=await win.running().catch(()=>null),cmd=up?await win.steamCommandLine().catch(()=>null):null;let shared=null;try{shared=await injector?.evaluateShared('JSON.stringify({ngl:window.__TAIGA_NGL_STATE__||null,error:window.__TAIGA_NGL_ERROR__||null,host:!!window.__TAIGA_NGL_HOST__,missing:window.__TAIGA_NGL_MISSING__||null,globals:{react:typeof window.SP_REACT,reactDom:typeof window.SP_REACTDOM,webpack:Object.keys(window).filter(k=>/^webpackChunk/.test(k)),appStore:typeof window.appStore,popup:typeof window.g_PopupManager,client:typeof window.SteamClient},ui:typeof window.SteamUIStore,popups:(()=>{try{return Array.from(window.g_PopupManager.GetPopups()).map(p=>p.m_strName||p.name||"").slice(0,20)}catch(e){return null}})()})');}catch{}
  return {generated:new Date().toISOString(),version:VERSION,platform:process.platform+' '+os.release(),node:process.version,config:c,steam:{running:up,commandLine:cmd,marker:cefMarker()?fs.existsSync(cefMarker()):false,debugPortReachable:injector?.status().connected||false},injector:injector?.status()||null,integration:{...integration},shared:(()=>{try{return JSON.parse(shared||'null');}catch{return shared;}})(),games:{total:db.games.filter(g=>!g.demo).length,bound:db.games.filter(g=>g.bindings?.[config.account]).length},nglMappings:Object.keys(nglBackend.allMappings()).length,log:nglLog.slice(-300)};}
 // Conquistas da Epic: a conta é capturada sozinha quando a Epic abre um jogo (-epicuserid) e o progresso é relido
 // a cada 5 min (a cada 30 s enquanto o jogo está aberto, pelo ciclo acima), para as novas aparecerem sem fazer nada.
 let epicTick=0;const epicTimer=setInterval(async()=>{if(closed)return;epicTick++;try{const epicGames=db.games.filter(g=>!g.hidden&&!g.demo&&g.uuid&&['pc','custom','store'].includes(g.profile)&&!g.native&&achievementManager.isEpicGame(g));if(!epicGames.length)return;
  if(!achievementManager.epicAccount()){const id=await win.epicUserFromProcesses();if(id){config.epicAccountDetected=id;saveConfig();nglNote('Conta Epic detectada pelo jogo aberto.');for(const g of epicGames)try{await achievementManager.get(g,{live:true});}catch{}nglBackend.invalidate?.();}return;}
  if(epicTick%5===0)for(const g of epicGames)try{await achievementManager.get(g,{live:true});}catch{}}catch{}},60000);epicTimer.unref?.();
 server.on('close',()=>{clearInterval(liveTimer);clearInterval(epicTimer);clearInterval(integrationTimer);raLog.stop();portLog.stop();injector?.stop();nglBackend.flush();});
 // O pacote do NativeGameLink usa o React da Steam (window.SP_REACT) logo ao carregar. Logo depois de a Steam abrir, o
 // contexto principal já existe mas o React ainda não: carregar nessa hora quebrava o pacote e a página nunca aparecia.
 // Como o Millennium, espera webpack, React, janelas e lojas da Steam ficarem prontos antes de carregar o plugin.
 function nglLoader(bundle,boot){return `;(function(){'use strict';
 if(window.__TAIGA_NGL_LOADER__===2)return;window.__TAIGA_NGL_LOADER__=2;
 var log=function(m){try{if(typeof window.__taiga_ffi__==='function')window.__taiga_ffi__(JSON.stringify({id:0,method:'fe_log',args:{msg:String(m).slice(0,4000)}}));}catch(e){}};
 // Peças da Steam que o plugin precisa. Versões novas da Steam nem sempre deixam o React (SP_REACT/SP_REACTDOM) como
 // variável global: como o Decky e o Millennium, ele é procurado nos módulos webpack da própria Steam.
 var isReact=function(m){return !!(m&&typeof m.createElement==='function'&&typeof m.createContext==='function'&&m.Component&&m.PureComponent&&typeof m.useLayoutEffect==='function');};
 var isDom=function(m){return !!(m&&typeof m.createPortal==='function'&&(typeof m.createRoot==='function'||typeof m.render==='function'||typeof m.flushSync==='function'));};
 var api=function(){return window.__TAIGA_MILLENNIUM_API__;};
 var host=function(){return window.__TAIGA_NGL_HOST__;};
 var fill=function(){
  if(!host()||!host().webpackChunk||!host().webpackChunk())return;
  try{if(!isReact(window.SP_REACT)){var R=api().findModule(isReact);if(R)window.SP_REACT=R;}}catch(e){}
  try{if(!isDom(window.SP_REACTDOM)){var D=api().findModule(isDom);if(D){var C=null;try{C=api().findModule(function(m){return m&&m!==D&&typeof m.createRoot==='function'&&typeof m.hydrateRoot==='function';});}catch(e){}window.SP_REACTDOM=C&&typeof D.createRoot!=='function'?Object.assign({},D,{createRoot:C.createRoot,hydrateRoot:C.hydrateRoot}):D;}}}catch(e){}
 };
 var missing=function(optional){var m=[];if(!(host()&&host().webpackChunk&&host().webpackChunk()))m.push('webpack');if(!isReact(window.SP_REACT))m.push('SP_REACT');if(!window.g_PopupManager)m.push('g_PopupManager');if(!window.SteamClient)m.push('SteamClient');
  if(optional){if(!isDom(window.SP_REACTDOM))m.push('SP_REACTDOM');if(!(window.appStore||window.AppStore||window.SteamUIStore))m.push('appStore');}return m;};
 var ready=function(){fill();window.__TAIGA_NGL_MISSING__=missing(true);if(missing(false).length)return false;
  // Peças opcionais (o próprio NativeGameLink também as procura): espera até 20 s por elas e depois segue.
  return !window.__TAIGA_NGL_MISSING__.length||Date.now()-start>20000;};
 var load=function(){
  if(!(window.PLUGIN_LIST&&window.PLUGIN_LIST.NativeGameLinkForSteam)&&!window.__TAIGA_NGL_MODULE__){
   try{(function(){\n${bundle}\n;window.__TAIGA_NGL_MODULE__=__TAIGA_NGL_MODULE__;})();}
   catch(e){window.__TAIGA_NGL_STATE__='error';window.__TAIGA_NGL_ERROR__='load: '+String(e&&(e.stack||e.message)||e);log('Falha ao carregar o NativeGameLink: '+window.__TAIGA_NGL_ERROR__);return;}
  }
  ${boot}
 };
 if(!window.__TAIGA_NGL_STATE__)window.__TAIGA_NGL_STATE__='waiting';
 var start=Date.now(),warned=false;
 (function tick(){if(ready()){load();return;}if(!warned&&Date.now()-start>30000){warned=true;log('NativeGameLink aguardando peças da Steam: '+(window.__TAIGA_NGL_MISSING__||[]).join(', '));}setTimeout(tick,250);})();
})();`;}
 injector=new SteamInjector({version:scriptVersion,port:Number(config.steamDebugPort)||DEFAULT_DEBUG_PORT,ports:[DEFAULT_DEBUG_PORT],enabled:()=>config.injectSteam!==false&&!!config.steamDir,log:m=>{nglNote('[injetor] '+m);},
  // Como o Millennium: o NativeGameLink roda no contexto compartilhado da Steam e fala com o backend pelo binding do DevTools.
  scripts:async()=>{const bundle=nglBundle(),notify=fs.readFileSync(path.join(ROOT,'steam/shared.notify.js'),'utf8'),communityScript='window.__TAIGA_COMMUNITY_FALLBACK__='+fs.readFileSync(path.join(ROOT,'steam/community.fallback.json'),'utf8')+';\n'+fs.readFileSync(path.join(ROOT,'steam/community.js'),'utf8');if(!bundle)return {library:scriptBytes(),bigpicture:bigPictureBytes(),shared:notify,community:communityScript};
   return {community:communityScript,shared:'(function(){var want='+JSON.stringify(digest(bundle).slice(0,16))+';try{if(window.__TAIGA_NGL_PLUGIN__&&window.__TAIGA_NGL_VERSION__!==want){var k=\'taigaNglRestart\',last=Number(localStorage.getItem(k)||0);if(Date.now()-last>120000){localStorage.setItem(k,String(Date.now()));try{window.__taiga_ffi__&&window.__taiga_ffi__(JSON.stringify({id:0,method:\'fe_log\',args:{msg:\'Taiga Launcher atualizado: recarregando a interface da Steam para usar a página nova.\'}}));}catch(e){}if(window.SteamClient&&SteamClient.Browser&&typeof SteamClient.Browser.RestartJSContext===\'function\')SteamClient.Browser.RestartJSContext();else location.reload();}}}catch(e){}window.__TAIGA_NGL_WANT__=want;})();\n'+'window.__TAIGA_CATALOG__='+JSON.stringify(nglCatalog())+';\n'+fs.readFileSync(path.join(ROOT,'steam/ngl-host.js'),'utf8')+'\n'+nglLoader(bundle,fs.readFileSync(path.join(ROOT,'steam/ngl-boot.js'),'utf8'))+'\n'+notify};},
  onCall:async(method,args,kind)=>{
   // Página da Comunidade (site): só os três pedidos de leitura dela.
   if(kind==='community'||kind==='web'){if(method==='community_games')return JSON.stringify(await profilePages.games());if(method==='community_image')return JSON.stringify(await profilePages.image(args));if(method==='community_achievements')return JSON.stringify(await profilePages.achievements(args));if(method==='community_friend')return JSON.stringify(await publicProfile.friend(args.steamId));throw Error('Não permitido.');}
   if(kind!=='shared')throw Error('Não permitido.');
   if(method.startsWith('taiga_comments_'))return encodeCallResult(await commentsCall(method,args));
   if(method==='taiga_game_extras')return encodeCallResult(await extrasCall(args));
   if(method==='taiga_artwork_changed')return encodeCallResult(adoptSteamArtwork(args.shortcut_app_id,{pin:args.user===true}));return encodeCallResult(await nglBackend.call(method,args));},
  health:{shared:"window.__TAIGA_NGL_STATE__!=='error'&&window.__TAIGA_NGL_STATE__!=='missing'"},refreshExpression:async()=>`window.__TAIGA_SET_CATALOG__&&window.__TAIGA_SET_CATALOG__(${JSON.stringify(nglCatalog())});window.__TAIGA_NGL_REFRESH__&&window.__TAIGA_NGL_REFRESH__();true`,...injectorOptions});
 if(startInjector)injector.start();
 // Artes que faltam (capa, fundo, logo, horizontal e ícone): procura logo depois de adicionar o jogo e volta a tentar
// sozinho (1 h, 6 h, 1 dia, 3 dias, 7 dias), porque o banco compartilhado vai ganhando artes novas. Baixa só uma de cada
// tipo (a galeria completa só carrega em Editar). Se a última tentativa foi sem SteamGridDB (sem chave ou servidor fora)
// e agora há, tenta de novo na hora. Quando acha, a Steam recebe a arte na próxima atualização ao vivo.
let coverBusy=false,coverAgain=false;const COVER_WAIT=[0,3600000,6*3600000,86400000,3*86400000,7*86400000],ART_KINDS=['cover','hero','logo','wide','icon'];
const artMissing=g=>ART_KINDS.filter(k=>!g.art?.[k]&&!g.artPinned?.[k]);
const coverDue=g=>{if(pendingFinish.has(g.id)||g.demo||g.hidden||g.native)return false;const miss=artMissing(g);if(!miss.length)return false;if(!g.coverCheckedAt)return true;if(providers.sgAvailable?.()&&g.artTriedApi===false)return !providers.limited?.();return Date.now()-g.coverCheckedAt>=COVER_WAIT[Math.min(g.coverTries||0,COVER_WAIT.length-1)];};
// Ícone de jogo de PC sem ícone em nenhum banco: logo do pacote (Xbox/Microsoft Store) ou o ícone do .exe.
async function localIcon(g){const exe=g.launch?.exe&&/\.exe$/i.test(g.launch.exe)&&!/explorer\.exe$/i.test(g.launch.exe)&&g.profile!=='store'?g.launch.exe:g.path;if(!exe||!/\.exe$/i.test(exe)||!isFile(exe))return;const src=iconSourceFor(exe,g.gameRoot||'');let bytes=null;if(src.png){const b=fs.readFileSync(src.png);if(b.length<4*1024*1024&&imageType(b)==='png')bytes=b;}if(!bytes&&fileIcon&&(src.exe!==exe||!src.png))bytes=await fileIcon(src.exe||exe);if(!bytes?.length||imageType(bytes)!=='png')return;const name=digest(bytes)+'.png';atomic(path.join(dataDir,'art',name),bytes);g.art={...(g.art||{}),icon:name};g.artSources={...(g.artSources||{}),icon:src.png?'pacote':'executável'};}
async function coverSweep(){if(closed||providers.offline)return;if(coverBusy){coverAgain=true;return;}coverBusy=true;let found=0,done=0;try{
  {const quick=db.games.filter(g=>!g.hidden&&!g.demo&&g.storeImages&&artMissing(g).some(k=>g.storeImages[k==='hero'?'wide':k]));if(quick.length){let n=0;await pool(quick,8,async g=>{if(await quickStoreArt(g)){found++;if(++n%20===0)persist();}});persist();}}
  do{coverAgain=false;{const list=db.games.filter(coverDue).slice(0,40);let next=0;await Promise.all(Array.from({length:Math.min(3,list.length)},async()=>{while(next<list.length&&!closed){const g=list[next++];done++;const before=artMissing(g).length;g.coverCheckedAt=Date.now();g.coverTries=(g.coverTries||0)+1;g.artTriedApi=!!providers.sgAvailable?.()&&!providers.limited?.();try{const appId=steamAppIdFor(g);if(appId&&artMissing(g).some(k=>k!=='icon'))await steamLink.apply(g,appId).catch(()=>{});if(!g.sgdbId&&providers.resolveSgdbId&&g.artTriedApi)await providers.resolveSgdbId(g,{steamAppId:appId}).catch(()=>{});if(g.sgdbId&&artMissing(g).length)await providers.enrich(g,{sgdb:{id:g.sgdbId},missingOnly:true}).catch(()=>{});if(!g.art?.cover&&providers.findCover)await providers.findCover(g);if(artMissing(g).some(k=>k!=='icon')&&providers.freeArt)await providers.freeArt(g).catch(()=>{});if(!g.art?.icon&&!g.artPinned?.icon&&['pc','store','custom'].includes(g.profile))await localIcon(g).catch(()=>{});const after=artMissing(g).length;if(after<before)found++;if(!after||g.art?.cover&&after<before)delete g.coverTries;
   // Limite de consultas no meio: não conta como tentativa (a espera até a próxima não cresce) e volta quando o limite acabar.
   if(after&&providers.limited?.()){g.artTriedApi=false;g.coverTries=Math.max(0,(g.coverTries||1)-1);coverAfterLimit();}}catch{}if(done%5===0)persist();}}));}persist();
  // Coleção grande recém-adicionada (primeiro uso): continua até todos terem passado, sem esperar o próximo ciclo.
  if(!coverAgain&&done<600&&!closed&&db.games.some(coverDue))coverAgain=true;}while(coverAgain&&!closed);}finally{coverBusy=false;}if(found){try{injector?.reload?.()?.catch?.(()=>{});}catch{}setTimeout(()=>refreshSteamLive(),5000).unref?.();}}
// Depois de um limite de consultas (HTTP 429): uma nova rodada de capas logo que a espera acaba.
let coverLimitTimer=null;function coverAfterLimit(){if(coverLimitTimer||!startInjector)return;const wait=Math.max(5000,(providers.limitedUntil?.()||0)-Date.now()+5000);coverLimitTimer=setTimeout(()=>{coverLimitTimer=null;coverSweep().catch(()=>{});},Math.min(wait,31*60000));coverLimitTimer.unref?.();}
function coverSoon(){if(!startInjector)return;const t=setTimeout(()=>coverSweep().catch(()=>{}),4000);t.unref?.();}
if(startInjector){setTimeout(()=>coverSweep().catch(()=>{}),15000).unref?.();const ct=setInterval(()=>coverSweep().catch(()=>{}),15*60000);ct.unref?.();server.on('close',()=>clearInterval(ct));}
 // Tempo de jogo de outros programas (Epic, GOG Galaxy, Playnite).
 async function importPlaytime(){const rows=[],sources={};const run=async(name,fn)=>{try{const r=await fn();rows.push(...r);sources[name]=r.length;}catch(e){sources[name]=-1;nglNote('Tempo de jogo '+name+': '+e.message);}};
  await run('epic',async()=>{const auth=await validSession(config.epicAuth,{save:next=>{config.epicAuth=next;saveConfig();}}).catch(()=>null);return auth?epicPlaytime(auth):[];});
  await run('gog',()=>gogPlaytime());await run('playnite',async()=>playnitePlaytime());
  const r=applyImported(db.games.filter(g=>!g.demo),rows,dataDir);nglNote('Tempo de jogo importado: '+r.matched+' jogo(s) ('+JSON.stringify(sources)+').');dataVersion++;return {...r,sources};}
 if(startInjector){setTimeout(()=>importPlaytime().catch(()=>{}),45000).unref?.();}
 // Atualização automática (Releases do GitHub definidas em package.json → taigaUpdates).
 const updateRepo=(()=>{try{return String(JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).taigaUpdates||'');}catch{return '';}})();
 // Nome antigo do repositório como reserva (o GitHub redireciona, mas se não houver Release no novo, procura no antigo).
 const updateRepos=(()=>{try{const p=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));return [updateRepo,...(Array.isArray(p.taigaUpdatesFallback)?p.taigaUpdatesFallback:[])].filter(r=>/^[\w.-]+\/[\w.-]+$/.test(String(r||'')));}catch{return updateRepo?[updateRepo]:[];}})();
 // Resultado da última atualização automática (gravado pelo script): avisa uma vez se falhou.
 let updateFailure=null;try{const f=path.join(dataDir,'updates','resultado.json');if(fs.existsSync(f)){const r=JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));if(r&&r.ok===false&&r.version&&newer(r.version,VERSION))updateFailure={version:String(r.version).slice(0,20),error:String(r.error||'').slice(0,300)};fs.rmSync(f,{force:true});}}catch{}
 const update={available:null,checkedAt:0,downloading:false,progress:0,error:''};
 async function checkUpdate(){if(!updateRepo||process.env.TAIGA_OFFLINE)return update;try{const rel=await latestReleaseAny(updateRepos);update.checkedAt=Date.now();update.error='';update.available=rel&&newer(rel.version,VERSION)?rel:null;if(update.available)nglNote('Atualização disponível: '+rel.version);}catch(e){update.error=e.message;}return update;}
 // Faxina da pasta de dados (atualizações já instaladas, backups velhos, imagens que ninguém usa): uma vez por dia,
 // 90 s depois de abrir, em segundo plano.
 const housekeeping=createHousekeeping({dataDir,version:VERSION,games:()=>db.games,extraRefs:()=>{const out=[];for(const m of [matches,externalChoices,artChoices])try{out.push(JSON.stringify([...m.values()]));}catch{}return out;},log:m=>nglNote(m)});
 if(startInjector){setTimeout(()=>{if(closed||Date.now()-(Number(config.cleanAt)||0)<20*3600000)return;housekeeping.run().then(()=>{config.cleanAt=Date.now();saveConfig();}).catch(()=>{});},90000).unref?.();}
 // Links de apoio (Ko-fi, GitHub Sponsors) vindos do servidor: no máximo uma vez a cada 12 horas, só https dos sites certos.
 async function refreshSupportLinks(){const srv=providers.server?.();if(!srv||process.env.TAIGA_OFFLINE||Date.now()-(Number(config.supportLinksAt)||0)<12*3600000)return;try{const r=await fetch(srv+'/v1/links',{signal:AbortSignal.timeout(6000)});if(!r.ok)return;const j=await r.json(),ok=(u,host)=>{try{const x=new URL(String(u||''));return x.protocol==='https:'&&(x.hostname===host||x.hostname==='www.'+host)?x.href:'';}catch{return '';}};config.supportLinks={kofi:ok(j.kofi,'ko-fi.com'),sponsors:ok(j.sponsors,'github.com')};config.supportLinksAt=Date.now();saveConfig();}catch{}}
 if(startInjector){setTimeout(()=>refreshSupportLinks(),5000).unref?.();}
 if(startInjector&&updateRepo){setTimeout(()=>checkUpdate(),4000).unref?.();const ut=setInterval(()=>checkUpdate(),6*3600000);ut.unref?.();server.on('close',()=>clearInterval(ut));}
 // Capa, dados ou nome que mudaram depois de o jogo ir para a Steam: com a Steam aberta e a integração ativa,
 // atualiza sozinho (sem reiniciar). Sem a integração, continua a bolinha de pendência.
 // Atalhos do Taiga Launcher na Steam que perderam a ligação com o jogo (Steam recriou o atalho com outro número):
 // religa pelo "--taiga-launch <uuid>" do próprio atalho. Sem isso, a página do jogo volta a ser a simples da Steam.
 function relinkShortcuts(){if(!config.steamDir||!config.account)return 0;let list=[];try{list=nglBackend.shortcutsList();}catch{return 0;}let n=0;list=list.filter(s=>s.source==='shortcuts_vdf');const present=new Set(list.map(s=>Number(s.shortcut_app_id)>>>0));
  for(const s of list){const m=String(s.launch_options||'').match(/--taiga-launch\s+"?([0-9a-f-]{36})"?/i);if(!m)continue;const sid=Number(s.shortcut_app_id)>>>0;if(!sid||shortcutGame(sid))continue;
   const g=db.games.find(x=>!x.demo&&String(x.uuid||'').toLowerCase()===m[1].toLowerCase());if(!g)continue;const cur=Number(g.bindings?.[config.account])>>>0;if(cur&&present.has(cur)||Date.now()-Number(g.liveAdded?.[config.account]||0)<600000)continue;g.bindings={...(g.bindings||{}),[config.account]:sid};g.hidden=false;if(g.steamRemoved)delete g.steamRemoved[config.account];n++;}
  if(n){persist();nglNote('Atalhos da Steam religados aos jogos: '+n+'.');injector?.reload?.().catch?.(()=>{});}return n;}
 let refreshing=false;async function refreshSteamLive(){if(refreshing||closed||config.preferences?.autoSync===false||!config.steamDir)return;refreshing=true;try{try{relinkShortcuts();}catch{}if(!(injector?.status?.().connected||await win.running().catch(()=>false))||!(await liveReady()))return;const ids=db.games.filter(g=>!g.demo&&!g.hidden&&g.bindings?.[config.account]&&g.applied?.[config.account]!==signature(g)&&launchReadyFor(g)&&!sessions.forGame(g.uuid,config.account)?.running).map(g=>g.id).slice(0,20);if(ids.length){await sync(ids,{restart:false});nglNote('Atualizado na Steam sem reiniciar: '+ids.length+' jogo(s).');}}catch(e){nglNote('Atualização automática na Steam: '+e.message);}finally{refreshing=false;}}
 if(startInjector){const ra=setTimeout(()=>{try{relinkShortcuts();}catch{}if((config.preferences.storeCollections||config.preferences.emuCollection)&&config.collectionsAppliedVersion!==VERSION)applyStoreCollections().then(r=>{if(r?.ok){config.collectionsAppliedVersion=VERSION;saveConfig();}}).catch(()=>{});reassignProfiles({startup:true}).catch(e=>nglNote('Emuladores: '+e.message));},45000);ra.unref?.();server.on('close',()=>clearTimeout(ra));}
 if(startInjector){const rt=setInterval(()=>refreshSteamLive(),120000);rt.unref?.();server.on('close',()=>clearInterval(rt));}
 // 2.5.4: jogos de loja ainda sem a página da Steam tentam de novo, uma vez, com as regras novas (nome sem o sufixo
 // de edição, Wikidata pelo nome). Em segundo plano, um por vez.
 if(startInjector)setTimeout(async()=>{const todo=db.games.filter(g=>!g.demo&&!g.hidden&&g.store&&!steamAppIdFor(g)&&!g.steamLinkDisabled&&!g.storeLinkRetry254);for(const g of todo){if(closed)return;g.storeLinkRetry254=true;delete g.storeSteamCheckedAt;delete g.steamNameCheckedAt;delete g.steamResolve;try{await autoSteamLink(g);}catch{}}if(todo.length){persist();refreshSteamLive?.().catch?.(()=>{});}},90000).unref?.();
 // Biblioteca das lojas (jogos não instalados): ao abrir e a cada 6 h; também confere jogos instalados por fora.
 if(startInjector){const lib=()=>{if(config.preferences.showUninstalled||notInstalledGames().length)syncStoreLibrary().catch(e=>nglNote('Biblioteca das lojas: '+e.message));};setTimeout(lib,70000).unref?.();const lt=setInterval(lib,6*3600000);lt.unref?.();server.on('close',()=>{clearInterval(lt);for(const a of legendary.active())legendary.cancel(a).catch(()=>{});});}
 // Descrições que ficaram em outro idioma (tradução indisponível na hora da importação): tenta de novo.
 // Tradução que ficou para depois (cota, sem internet): tenta de novo ao abrir e a cada 2 horas, descrições e conquistas,
 // até tudo estar no idioma do programa. Nada fica em inglês para sempre.
 const retranslate=async()=>{if(closed)return;const lang=config.language||sysLang;for(const g of db.games.filter(x=>!x.demo&&!x.hidden&&x.metadata?.summary&&(detectLanguage(x.metadata.summary)||x.metadata.summaryLanguage||lang)!==lang).slice(0,60)){if(closed)break;try{const w=await providers.localize(g);if(!w.length)persist();}catch{}}
  for(const g of db.games.filter(x=>!x.demo&&!x.hidden)){if(closed)break;const c=achievementManager.cached(g);if(c?.translationStatus&&c.translationStatus!=='translated')try{await achievementManager.get(g,{quiet:true});}catch{}}};
 if(startInjector){setTimeout(()=>retranslate().catch(()=>{}),25000).unref?.();const rt2=setInterval(()=>retranslate().catch(()=>{}),2*3600000);rt2.unref?.();}
 if(startInjector&&config.shortcutFolder){watchShortcutFolder();setTimeout(()=>syncShortcutFolder().catch(()=>{}),8000).unref?.();}
 if(startInjector){const ppTimer=setInterval(()=>{if(!closed)publicProfile.refresh().catch(()=>{});},300000);ppTimer.unref?.();setTimeout(()=>publicProfile.refresh().catch(()=>{}),20000).unref?.();server.on('close',()=>clearInterval(ppTimer));}
 return {server,dataDir,injector,nglLog,nglBackend,getLanguage:()=>config.language||sysLang,startWithWindows:()=>config.preferences?.startWithWindows!==false,findPorts:()=>findPortsNearConsoleGames()};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=createApp();app.server.on('error',e=>{if(e.code==='EADDRINUSE'){console.error('Porta 48767 ocupada. Verifique se o Taiga PSP já está aberto.');}else console.error(e.message);process.exitCode=1;});
 app.server.listen(48767,'127.0.0.1',()=>{console.log('Taiga Launcher: http://127.0.0.1:48767, deixe esta janela aberta para os painéis da Steam.');if(process.argv.includes('--open')&&process.platform==='win32'){const child=spawn('explorer.exe',['http://127.0.0.1:48767'],{stdio:'ignore'});child.on('error',()=>{});}});
}
