import {pfnOf} from './xbox-auth.mjs';
import {xboxIdentity} from './stores-more.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {digest,json,save} from './files.mjs';
import {nativeAchievementSchema,publicAchievementSchema,nativeUserProgress} from './steam-achievement-schema.mjs';
import {readRPCS3} from './rpcs3-achievements.mjs';
import {readVita3K,readShadPS4,trophyTime} from './console-trophies.mjs';
import {portOf,readPortTrophies,PortTrophyStore} from './port-trophies.mjs';
import {exophaseTrophies} from './exophase.mjs';
import {platformByKey,platformByName} from './platforms.mjs';
import {editionBase} from './title-match.mjs';
import {portProfile} from './port-profiles.mjs';
import {psnTrophies} from './psn.mjs';
import {achievementRoots,findLocalDefinitions,findLocalProgress,schemaRows,progressEntries} from './local-achievements.mjs';
import {translateText,translateMany} from './translation.mjs';
import {steamAppIdEvidence} from './identify.mjs';
import {epicManifests,epicGameInfo,epicAccountIdFromLauncher,parseEpicAccount,gogProductId} from './store-achievements.mjs';
const empty=(status,source='Local',message='')=>({status,source,provider:'local',message,total:0,unlocked:0,achievements:[]});
const exists=f=>{try{return fs.statSync(f).isFile();}catch{return false;}};
const boundedJSON=file=>{if(fs.statSync(file).size>8*1024*1024)throw Error('Arquivo de conquistas excede 8 MB.');return json(file,null);};
const LANG={ 'pt-BR':['brazilian','pt-BR','pt'],en:['english','en'],es:['spanish','es'],fr:['french','fr'],de:['german','de'] };
export function localized(value,language='pt-BR'){if(typeof value==='string')return value;if(!value||typeof value!=='object')return '';for(const key of [...(LANG[language]||LANG.en),'english','en'])if(typeof value[key]==='string'&&value[key])return value[key];return '';}
export function normalizeLocal(schema,state,language='pt-BR',sourceLanguage='en'){
 const rows=Array.isArray(schema)?schema:schema?.achievements||schema?.game?.availableGameStats?.achievements||schema?.achievement?.list||[];
 const indexed=new Map(progressEntries(state));
 if(!Array.isArray(rows)||rows.length>10000)throw Error('Definições de conquistas inválidas.');
 const langOf=value=>typeof value==='object'&&value?((LANG[language]||LANG.en).some(k=>typeof value[k]==='string'&&value[k])?language:'en'):sourceLanguage;
 const used=new Set();return rows.flatMap(a=>{const id=String(a.name??a.apiname??a.id??'');if(!id||used.has(id))return [];used.add(id);const st=indexed.get(id),earned=st===true||st===1||st?.earned===true||st?.earned===1||st?.unlocked===true||st?.unlocked===1||st?.achieved===1||st?.achieved===true;return [{id,title:localized(a.displayName||a.title||a.display_name,language)||id,description:localized(a.description||a.desc,language),titleLanguage:langOf(a.displayName||a.title||a.display_name),descriptionLanguage:langOf(a.description||a.desc),icon:a.icon||a.icon_url||'',lockedIcon:a.icongray||a.icon_gray||'',hidden:[true,1,'1','true'].includes(a.hidden),globalPercent:a.globalPercent!==undefined&&a.globalPercent!==null&&Number.isFinite(Number(a.globalPercent))?Math.max(0,Math.min(100,Number(a.globalPercent))):null,progress:st?.progress!==null&&st?.progress!==undefined&&Number.isFinite(Number(st.progress))?Math.max(0,Number(st.progress)):null,maxProgress:Number(st?.max_progress||a.maxProgress||a.max_progress_int)||null,unlocked:earned,date:earned?(st?.earned_time||st?.unlocktime||st?.date||null):null}];});
}
export class AchievementProviderManager{
 constructor({isRunning=null,config,dir,providers,account,onUnlock,stores=null,env=process.env,epicSession=async()=>null,xboxSession=async()=>null,psnSession=async()=>null,pageFetch=null,log=null,onGameChange=null}){Object.assign(this,{isRunning,config,dir,providers,account,onUnlock,stores,env,epicSession,xboxSession,psnSession,pageFetch,log,onGameChange});this.epicCache=null;this.portStore=new PortTrophyStore(dir);this.jobs=new Map();this.pending=new Map();this.latest=new Map();}
 // Epic: jogos instalados e conta (informada nas configurações ou registrada pelo launcher neste PC).
 epicList(){if(!this.epicCache||Date.now()-this.epicCache.at>(this.epicCache.account?600000:60000))this.epicCache={at:Date.now(),list:epicManifests(this.env),account:epicAccountIdFromLauncher(this.env)};return this.epicCache.list;}
 // Conta Epic: a informada nas configurações, a capturada do jogo aberto pela Epic (-epicuserid) ou a do launcher.
 epicAccount(){const c=this.config();return parseEpicAccount(c.epicAuth?.accountId)||parseEpicAccount(c.epicAccount)||parseEpicAccount(c.epicAccountDetected)||(this.epicList(),this.epicCache.account)||'';}
 epicSource(){const c=this.config();return parseEpicAccount(c.epicAuth?.accountId)?'login':parseEpicAccount(c.epicAccount)?'manual':parseEpicAccount(c.epicAccountDetected)?'game':(this.epicList(),this.epicCache.account)?'launcher':'';}
 isEpicGame(game){return !!epicGameInfo(game,this.epicList());}
 async storeAchievements(game,mode,language,live){
  if(!this.stores)return null;const c=this.config();
  if(mode==='epic'||mode==='auto'){const epic=epicGameInfo(game,this.epicList());if(epic){let auth=null;try{auth=await this.epicSession();}catch{}const data=await this.stores.epic({namespace:epic.namespace,accountId:this.epicAccount(),language,live:!!live,auth});if(data.achievements.length||mode==='epic')return data;}}
  // Xbox / PC Game Pass: pela loja ou pelo MicrosoftGame.config ao lado do jogo (mesmo achado como jogo de PC comum).
  const xb=(mode==='xbox'||mode==='auto')?xboxIdentity(game):null;
  if(xb&&(game.store?.name==='xbox'||xb.pfn||xb.titleId)){let session=null;try{session=await this.xboxSession();}catch{}const data=await this.stores.xbox({session,pfn:xb.pfn||pfnOf(game),titleId:xb.titleId,name:game.title,altNames:[game.storeTitleEn,game.fileTitle,game.internalTitle].filter(Boolean),language,live:!!live});if(data.achievements.length||mode==='xbox'||mode==='auto')return data;}
  if(mode==='gog'||mode==='auto'){const id=gogProductId(game);if(id){try{const data=await this.stores.gog({productId:id,username:String(c.gogUser||'').trim(),language,live:!!live});if(data.achievements.length||mode==='gog')return data;}catch(error){if(mode==='gog')throw error;}}}
  return null;
 }
 fingerprint(game){const c=this.config(),a=this.account?.();let raUser=c.raUser;try{raUser=this.providers.retro?.credentials()?.user||c.raUser;}catch{}return digest(JSON.stringify([game.id,game.achievementSettings,game.raId,game.metadataSteamAppId,raUser,c.account,a?.steamId,c.language,(['pc','custom','store'].includes(game.profile)?this.epicAccount():c.epicAccount)||'',c.gogUser||'',game.store?.namespace||'',c.steamKey?digest(c.steamKey):'',c.achievementRoot,c.rpcs3Root,c.rpcs3User,c.launchers?.ps3?.exe,c.vita3kRoot,c.shadps4Root,c.launchers?.vita3k?.exe,c.launchers?.shadps4?.exe]));}
 // Lista salva em disco, guardada na memória enquanto o arquivo não muda (a tela pede isso a cada atualização).
 cached(game){const fp=this.fingerprint(game),hit=this.latest.get(fp);if(hit)return hit;const file=path.join(this.dir,'cache','achievement-'+fp+'.json');let st;try{st=fs.statSync(file);}catch{return null;}const memo=(this.diskMemo||=new Map()).get(file);if(memo&&memo.m===st.mtimeMs&&memo.s===st.size)return memo.d;let d=null;try{d=json(file,null)?.data||null;}catch{}this.diskMemo.set(file,{m:st.mtimeMs,s:st.size,d});if(this.diskMemo.size>2000)this.diskMemo.clear();return d;}
 // Página do jogo aberta na Steam pede as conquistas a cada 5 s. Com o jogo fechado nada muda nesse tempo: a última
 // leitura (até 30 s, e só se o arquivo de progresso não mudou) é devolvida sem ler tudo de novo.
 // Qualquer mudança no cadastro do jogo (vínculo com a Steam, RetroAchievements, fonte escolhida) invalida a cópia.
 gameSig(game){try{return JSON.stringify([game.path,game.profile,game.raId,game.native,game.appId,game.metadataSteamAppId,game.steamLink?.appId,game.achievementSettings,game.platformKey,game.serial,game.discId]);}catch{return String(Math.random());}}
 fileMark(file){if(!file)return '';try{const st=fs.statSync(file);return st.mtimeMs+':'+st.size;}catch{return 'x';}}
 recent(game,key){if(!this.isRunning)return null;let running=true;try{running=!!this.isRunning(game);}catch{}if(running)return null;const hit=this.latest.get(key),mark=this.latestAt?.get(key),at=mark?.at;if(!hit||!at||Date.now()-at>30000||mark.sig!==this.gameSig(game))return null;
  // Só fontes na internet (ou com arquivo de progresso conferível): arquivos locais sem esse arquivo são sempre relidos.
  if(!hit.progressFile&&!['retroachievements','steam','epic','xbox','gog','port'].includes(hit.provider))return null;if(hit.progressFile&&this.fileMark(hit.progressFile)!==mark.file)return null;return structuredClone(hit);}
 async get(game,{live=false,quiet=false}={}){if(['pc','custom','store'].includes(game.profile))this.detectSteamId(game);const key=this.fingerprint(game);if(!live&&!quiet&&!this.pending.has(key)){const hit=this.recent(game,key);if(hit)return hit;}if(this.pending.has(key)&&!quiet)return this.pending.get(key);const work=(this.pending.get(key)||Promise.resolve()).catch(()=>{}).then(()=>this.read(game,{live})).then(data=>this.finish(game,data,key,{quiet}));this.pending.set(key,work);try{const r=await work;
  // Lista nova ainda sem tradução: espera a tradução (até 12 s) para a página da Steam já abrir no idioma certo.
  if(r?.translationStatus==='pending'&&!quiet){const job=this.jobs.get(this.transFor?.get(key));if(job)await Promise.race([job,new Promise(res=>setTimeout(res,12000))]);const done=this.latest.get(key);if(done&&done.translationStatus!=='pending')return structuredClone(done);}
  return r;}catch(error){const old=this.cached(game);if(old)return {...old,status:'offline',message:error.message};return empty('unavailable','Local',error.message);}finally{this.pending.delete(key);}}
 roots(game){return achievementRoots(game,this.config());}
 // Lista de troféus cifrada no dump: busca nomes e descrições no Exophase (cache de 30 dias).
 async portNames(port,count){if(!this.providers?.requestText)return null;const ua={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36','Accept-Language':'en-US,en;q=0.9'},log=m=>{try{this.log?.(m);}catch{}};
  const ok=/<li\b[^>]*\bdata-average=|<ul\b[^>]*class="[^"]*\b(trophy|achievement)\b/i;
  // Pedido direto com cara de navegador; se o site recusar, a janela invisível do programa carrega a página.
  const page=async url=>{let html='';try{html=await this.providers.requestText(url,{headers:ua,maxBytes:8*1024*1024});}catch(e){log('Exophase: página direta falhou ('+e.message+').');}if(!ok.test(html)&&this.pageFetch){try{html=await this.pageFetch(url,'trophies')||html;}catch(e){log('Exophase: janela falhou ('+e.message+').');}}return html;};
  const request=async url=>{let text='';try{text=await this.providers.requestText(url,{headers:{...ua,Accept:'application/json'},maxBytes:4*1024*1024});return JSON.parse(text);}catch(e){if(!this.pageFetch)throw e;log('Exophase: busca direta falhou ('+e.message+'); usando a janela.');text=await this.pageFetch(url,'json');return JSON.parse(String(text).replace(/^[\s\S]*?(\{)/,'$1').replace(/\}[^}]*$/,'}'));}};
  try{return await exophaseTrophies({title:port.title,platform:port.platform,count},{request,page,cacheDir:path.join(this.dir,'cache'),log});}catch(e){log('Exophase: '+e.message);return null;}}
 detectSteamId(game){if(!game.native&&!(game.profile==='pc'||game.profile==='store'||game.profile==='custom'&&/\.exe$/i.test(game.path||''))&&!game.achievementSettings?.steamAppId)return null;if(game.achievementSettings?.steamAppId||game.metadataSteamAppId)return Number(game.achievementSettings?.steamAppId||game.metadataSteamAppId);for(const root of this.roots(game)){const found=steamAppIdEvidence(root);if(found){game.metadataSteamAppId=found.appId;return found.appId;}}return null;}
 async schema(appid,language){const c=this.config();if(!appid)return null;const local=nativeAchievementSchema(c.steamDir,appid);const file=path.join(this.dir,'cache','steam-schema-'+appid+'-'+language+'.json'),old=json(file,null);if(old&&Date.now()-old.at<86400000)return old.data;try{try{const publicRaw=await this.providers.request('https://api.steampowered.com/IPlayerService/GetGameAchievements/v1/?'+new URLSearchParams({appid,language:(LANG[language]||LANG.en)[0]}),{signal:AbortSignal.timeout(8000)});const publicSchema=publicAchievementSchema(publicRaw,appid,language);if(publicSchema){save(file,{at:Date.now(),data:publicSchema});return publicSchema;}}catch{}if(!c.steamKey)return old?.data||local||null;const url='https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?'+new URLSearchParams({key:c.steamKey,appid,l:(LANG[language]||LANG.en)[0]});const r=await this.providers.request(url);if(!Array.isArray(r?.game?.availableGameStats?.achievements))return null;save(file,{at:Date.now(),data:r});return r;}catch(error){if(old)return old.data;if(local)return local;throw error;}}
 // Jogo EXE (port, decomp, recompilação) com conquistas do RetroAchievements: não há ROM para calcular o hash, então
 // o jogo é achado pelo nome na lista de jogos do RetroAchievements do console (o escolhido no jogo, o do port ou os
 // consoles mais comuns). Liga só quando há exatamente um jogo com esse nome. Fica salvo no jogo (raId).
 async resolveRaId(game){
  if(game.raId)return game.raId;const retro=this.providers?.retro;if(!retro?.gamesList)return null;
  // Lista indisponível na última tentativa (sem internet, RA fora do ar): tenta de novo em 10 min, não em 6 h.
  if(game.raLookupAt&&Date.now()-game.raLookupAt<(game.raLookupFailed?600000:6*3600000))return null;game.raLookupAt=Date.now();
  const port=(()=>{try{return portOf(game);}catch{return null;}})(),prof=portProfile(game);
  const norm=t=>String(t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[™®©]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
  const expand=list=>[...new Set(list.filter(Boolean).flatMap(t=>[t,editionBase(t)]).map(norm).filter(t=>t.length>1))];
  // Primeiro o nome do jogo; os outros nomes (do disco, do arquivo, da loja) só se ele não achar nada.
  const primary=expand([prof?.title,game.title]),titles=expand([prof?.title,game.title,port?.title,game.storeTitleEn,game.wikiEnTitle,game.internalTitle,game.fileTitle]);
  if(!titles.length)return null;
  const hint=[prof?platformByKey(prof.platform):null,platformByKey(game.platformKey),platformByName(game.platformName),port?.platform?platformByName(port.platform)||platformByKey(port.platform):null].find(p=>p?.ra);
  const keys=hint?[hint.key]:['ps2','psp','ps1','gc','wii','n64','snes','nes','gba','nds','genesis','saturn','dreamcast','gb','gbc','3ds'];
  const lists=[];let failed=false;
  for(const key of keys){const p=platformByKey(key);if(!p?.ra)continue;let list={};try{list=await retro.gamesList(p.ra);}catch(e){failed=true;this.log?.('RetroAchievements (lista '+p.short+'): '+e.message);continue;}lists.push([p,list]);}
  if(failed)game.raLookupFailed=true;else delete game.raLookupFailed;
  const find=names=>{const hits=new Map();for(const [p,list] of lists){
   // Hacks e homebrew ("~Hack~ Newer Super Mario Bros. Wii") valem pelo nome sem a marca; subconjuntos não.
   for(const [id,name] of Object.entries(list)){if(/\[subset/i.test(name))continue;const tagged=/^~[^~]+~/.test(name),clean=String(name).replace(/^(?:~[^~]+~\s*)+/,'');if(/~/.test(clean))continue;const alts=clean.split('|').map(norm);if(alts.some(a=>names.includes(a)))hits.set(Number(id),{id:Number(id),name,platform:p,tagged});}
   if(hint&&hits.size)break;}
   if(hits.size>1){const plain=[...hits.values()].filter(h=>!h.tagged);if(plain.length===1)return new Map([[plain[0].id,plain[0]]]);}
   return hits;};
  let hits=find(primary);if(!hits.size)hits=find(titles);
  if(hits.size!==1){if(hits.size>1)this.log?.('RetroAchievements: mais de um jogo com o nome de '+game.title+' ('+[...hits.values()].map(h=>h.name+' '+h.platform.short).join(', ')+').');return null;}
  const [hit]=hits.values();game.raId=hit.id;game.raAuto={name:hit.name,platform:hit.platform.key,at:new Date().toISOString()};this.log?.('RetroAchievements: '+game.title+' → '+hit.name+' ('+hit.platform.short+', '+hit.id+').');try{this.onGameChange?.(game);}catch{}return hit.id;
 }
 // Ports que não desbloqueiam sozinhos (decomps e recompilações com a lista do RetroAchievements): as conquistas
 // marcadas à mão no Taiga Launcher entram por cima da lista (só aqui; nada é enviado ao RetroAchievements).
 withManual(game,data){
  if(!data||!Array.isArray(data.achievements)||!data.achievements.length)return data;
  const state=this.portStore.get(game.uuid||game.id),marks=state.unlocked||{};let any=false;
  const achievements=data.achievements.map(a=>{const k=String(a.id),at=marks[k];if(a.unlocked||!at)return a;any=true;return {...a,unlocked:true,date:a.date||at,manual:true};});
  return {...data,achievements,manualAllowed:true,...(any?{progressKnown:true}:{})};
 }
 async read(game,{live=false}={}){
  const c=this.config(),mode=game.achievementSettings?.provider||'auto',language=c.language||'pt-BR';if(mode==='none')return empty('disabled');if(mode==='rpcs3'||mode==='auto'&&game.profile==='ps3'){const r=readRPCS3(game,c,this.dir);for(const a of r.achievements||[])if(a.date)a.date=trophyTime(a.date);return r;}
  if(mode==='vita3k'||mode==='auto'&&(game.profile==='vita3k'||game.platformKey==='vita'))return readVita3K(game,c,this.dir);
  if(mode==='shadps4'||mode==='auto'&&(game.profile==='shadps4'||game.platformKey==='ps4'))return readShadPS4(game,c,this.dir);
  // Port conhecido (Tenkaichi3Decomp, Zelda64Recomp, Ship of Harkinian, sm64ex, OpenGOAL...): conquistas do
  // RetroAchievements do jogo original, sem precisar escolher nada.
  const prof=!game.native&&['pc','custom'].includes(game.profile)?portProfile(game):null;
  if(prof?.achievements==='ra'&&mode==='auto'){if(!game.raId)await this.resolveRaId(game);if(game.raId){const data=await this.providers.achievements(game,live?{maxAge:live===true?12000:live}:undefined);return this.withManual(game,{...data,provider:'retroachievements',source:'RetroAchievements · '+prof.name,sourceLanguage:'en',portNote:true});}}
  if(mode==='retroachievements'&&!game.raId&&!game.native)await this.resolveRaId(game);
  // Jogo de emulador sem o hash no RetroAchievements (GameCube/Wii, hacks, dumps diferentes): procura pelo nome na lista do console.
  if(mode==='auto'&&!game.raId&&!game.native&&!['pc','custom','store','ps3','vita3k','shadps4'].includes(game.profile||'psp')&&(platformByKey(game.platformKey)||platformByName(game.platformName))?.ra)await this.resolveRaId(game);
  if(mode==='retroachievements'||mode==='auto'&&game.raId&&!game.native){const data=await this.providers.achievements(game,live?{maxAge:live===true?12000:live}:undefined);if(data?.status==='unmapped'&&!game.raId&&!data.message)data.message='Este jogo não foi encontrado no RetroAchievements pelo nome. Confira o nome e a plataforma em Editar (por exemplo, PlayStation 2).';const out={...data,provider:'retroachievements',source:'RetroAchievements',sourceLanguage:'en'};return ['pc','custom'].includes(game.profile)&&/\.exe$/i.test(game.path||'')?this.withManual(game,out):out;}
  // Ports nativos de jogos de console (SpartanPort e parecidos): troféus do dump + desbloqueios lidos do log do port.
  if(mode==='port'||mode==='auto'&&!game.native&&['pc','custom'].includes(game.profile)&&!game.achievementSettings?.steamAppId){const port=portOf(game);if(port){const opts={config:c,dataDir:this.dir,store:this.portStore,env:this.env};let r=readPortTrophies(game,port,opts);
   // Conta PlayStation conectada: nomes oficiais no idioma do programa e troféus já ganhos no console.
   let psn=null;if(r?.trophySet){try{const auth=await this.psnSession();if(auth)psn=await psnTrophies(r.trophySet,auth,{language});}catch(e){this.log?.('PlayStation: '+e.message);}}
   const silent=[];if(psn?.achievements?.length===r?.achievements?.length){for(const t of psn.achievements)if(t.earnedAt&&this.portStore.record(game.uuid||game.id,t.id,t.earnedAt))silent.push(String(t.id));r=readPortTrophies(game,port,{...opts,names:psn.achievements,namesLanguage:language,namesSource:'PlayStation'});}
   else if(r?.detail==='icons'){const names=await this.portNames(port,r.achievements.length);if(names)r=readPortTrophies(game,port,{...opts,names});}
   // Sem nomes agora (site fora do ar): mantém os nomes e descrições da última leitura boa em vez de "Troféu 1, 2...".
   if(r?.detail==='icons'){const old=this.cached(game);if(old?.achievements?.length===r.achievements.length&&old.detail&&old.detail!=='icons'){const byId=new Map(old.achievements.map(a=>[String(a.id),a]));r={...r,detail:old.detail,source:old.source||r.source,sourceLanguage:old.sourceLanguage||r.sourceLanguage,achievements:r.achievements.map(a=>{const o=byId.get(String(a.id));return o?{...a,title:o.title,description:o.description,grade:o.grade||a.grade,hidden:!!o.hidden,globalPercent:o.globalPercent??null,titleLanguage:o.titleLanguage,descriptionLanguage:o.descriptionLanguage}:a;})};}}
   if(r){if(silent.length)r.silentIds=silent;return r;}}if(mode==='port')return empty('unmapped','Port');}
  // Jogos da Epic e da GOG: conquistas e progresso da própria loja (como o RetroAchievements nos emuladores).
  if(['epic','gog','xbox'].includes(mode)||mode==='auto'&&!game.native&&['pc','custom','store'].includes(game.profile)){const data=await this.storeAchievements(game,mode,language,live);if(data)return data;}
  const appid=game.native&&!game.shortcut?Number(game.appId):this.detectSteamId(game);
  if(mode==='steam'||mode==='auto'&&game.native&&!game.shortcut){if(!game.native||game.shortcut)return empty('unconfigured','Steam','Escolha Local para ler o progresso do jogo não Steam.');const schema=await this.schema(appid,language);if(!schema)return empty('unmapped','Steam');let state=null;
   // Progresso nativo gravado pela Steam no PC (sem chave); a Web API fica como alternativa.
   const native=nativeUserProgress(c.steamDir,c.account,appid);let progressFile=native?.file||null;if(native)state=native.state;
   if(!state&&c.steamKey&&this.account?.()?.steamId)try{const raw=await this.providers.request('https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?'+new URLSearchParams({key:c.steamKey,appid,steamid:this.account().steamId,l:(LANG[language]||LANG.en)[0]}));if(!raw.playerstats?.success)throw Error('Progresso Steam indisponível.');state=raw.playerstats.achievements;}catch(error){const old=this.cached(game);if(old?.progressKnown)return {...old,status:'offline',message:error.message};}
   const list=normalizeLocal(schema,state,language,schema.language||language);return {status:'ok',provider:'steam',source:'Steam',sourceLanguage:language,progressKnown:!!state,progressFile,achievements:list};}

  const roots=this.roots(game),definitions=findLocalDefinitions(roots);let schema=definitions?.schema,base=definitions?.base;
  if(appid){try{const official=await this.schema(appid,language);if(official)schema=official;}catch(error){if(!schema)throw error;}}
  if(!schema)return empty('unmapped');const chosen=findLocalProgress(roots,schema,{historicalRoot:c.achievementRoot});let state=chosen?.state,progressFile=chosen?.file||null,fromSteam=false;base||=chosen?.base;
  // Sem arquivo local: se o mesmo jogo também tem progresso gravado pela Steam neste PC, usa esse progresso.
  if(!state&&appid){const native=nativeUserProgress(c.steamDir,c.account,appid);if(native){state=native.state;progressFile=native.file;fromSteam=true;}}const list=normalizeLocal(schema,state,language,schema.language||schema.locale||'en');if(!list.length)return empty('unmapped');

  // Expose only validated image files through opaque local asset names.
  for(const a of list)for(const field of ['icon','lockedIcon']){const value=a[field];if(!value)continue;try{const u=new URL(value);if(u.protocol==='https:'&&['shared.fastly.steamstatic.com','shared.steamstatic.com','media.steampowered.com','cdn.akamai.steamstatic.com'].includes(u.hostname))continue;a[field]='';}catch{const root=base||this.roots(game)[0];if(!root){a[field]='';continue;}const f=path.resolve(root,value),rel=path.relative(fs.realpathSync(root),exists(f)?fs.realpathSync(f):f);if(rel.startsWith('..')||path.isAbsolute(rel)||!exists(f)||fs.statSync(f).size>4*1024*1024){a[field]='';continue;}const bytes=fs.readFileSync(f);let ext;if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))ext='png';else if(bytes[0]===255&&bytes[1]===216)ext='jpg';else{a[field]='';continue;}const name=digest(bytes)+'.'+ext;saveImage(path.join(this.dir,'art',name),bytes);a[field]='/art/'+name;}}
  return {status:'ok',provider:'local',source:fromSteam?'Steam':appid?'Local · Steam':'Local',sourceLanguage:schema.language||schema.locale||'en',progressKnown:!!state,progressFile,metadataAppId:appid||null,achievements:list};
 }
 finish(game,input,key,{quiet=false}={}){const old=this.cached(game),data={...input,at:new Date().toISOString()};autoPlatinum(data.achievements);data.total=data.achievements.length;data.unlocked=data.achievements.filter(a=>a.unlocked).length;
  if(['ok','offline'].includes(data.status)){if(!quiet&&old?.progressKnown!==false&&old?.achievements?.length&&data.progressKnown!==false){const known=new Map(old.achievements.map(a=>[String(a.id),a]));for(const a of data.achievements)if(a.unlocked&&known.has(String(a.id))&&!known.get(String(a.id)).unlocked&&!data.silentIds?.includes(String(a.id)))this.onUnlock?.(game,{...a,title:known.get(String(a.id)).title||a.title,description:known.get(String(a.id)).description||a.description},data.source);}
   const c=this.config(),language=c.language||'pt-BR';if(data.achievements.length&&(language!==data.sourceLanguage||data.achievements.some(a=>a.titleLanguage&&a.titleLanguage!==language||a.descriptionLanguage&&a.descriptionLanguage!==language))){const jobkey=digest(key+JSON.stringify(data.achievements.map(a=>[a.id,a.title,a.description]))),translated=json(path.join(this.dir,'cache','achievement-text-'+jobkey+'.json'),null);if(translated&&(translated.complete||Date.now()-Number(translated.at||0)<120000)){for(const a of data.achievements){const text=translated.rows?.[a.id];if(text)Object.assign(a,text);}data.translationStatus=translated.complete?'translated':'partial';}else{data.translationStatus='pending';(this.transFor||=new Map()).set(key,jobkey);this.translate(game,data,key,jobkey,language);}}
   this.latest.set(key,data);(this.latestAt||=new Map()).set(key,{at:Date.now(),sig:this.gameSig(game),file:this.fileMark(data.progressFile)});save(path.join(this.dir,'cache','achievement-'+key+'.json'),{data});
  }return structuredClone(data);
 }
 // Tradução das conquistas em lotes (poucas consultas): os textos aparecem no idioma do programa em segundos.
 translate(game,data,key,jobkey,language){if(this.jobs.has(jobkey))return;const job=(async()=>{const rows={},list=data.achievements,req=url=>this.providers.request(url);let complete=true;
  const groups=new Map();for(const a of list)for(const field of ['title','description']){const src=(field==='title'?a.titleLanguage:a.descriptionLanguage)||data.sourceLanguage||'en';if(src===language||!String(a[field]||'').trim())continue;if(!groups.has(src))groups.set(src,[]);groups.get(src).push([a,field]);}
  for(const [src,items] of groups){const out=await translateMany(items.map(([a,f])=>a[f]),this.dir,req,language,src==='auto'?'en':src);if(out.failed)complete=false;items.forEach(([a,f],k)=>{(rows[a.id]||={})[f]=out[k];if(f==='title')rows[a.id].titleLanguage=language;else rows[a.id].descriptionLanguage=language;});}
  save(path.join(this.dir,'cache','achievement-text-'+jobkey+'.json'),{rows,complete,at:Date.now()});const latest=this.latest.get(key);if(latest){for(const a of latest.achievements)if(rows[a.id])Object.assign(a,rows[a.id]);latest.translationStatus=complete?'translated':'partial';save(path.join(this.dir,'cache','achievement-'+key+'.json'),{data:latest});}})().catch(()=>{}).finally(()=>this.jobs.delete(jobkey));this.jobs.set(jobkey,job);}
}
function saveImage(file,bytes){fs.mkdirSync(path.dirname(file),{recursive:true});if(!exists(file))fs.writeFileSync(file,bytes);}
// Troféu de platina (PlayStation): o console dá a platina sozinho quando todos os outros troféus estão desbloqueados.
// Progresso lido de arquivo (RPCS3 e outros) nem sempre traz a platina marcada; aqui ela segue a mesma regra.
export function autoPlatinum(list){
 if(!Array.isArray(list))return list;const plat=list.filter(a=>String(a?.grade||'').toUpperCase()==='P'),rest=list.filter(a=>String(a?.grade||'').toUpperCase()!=='P');
 if(plat.length!==1||!rest.length||plat[0].unlocked||!rest.every(a=>a.unlocked))return list;
 const dates=rest.map(a=>a.date).filter(Boolean).map(d=>/^\d+$/.test(String(d))?Number(d):Date.parse(d)).filter(Number.isFinite);
 const last=dates.length?Math.max(...dates):null;
 plat[0].unlocked=true;plat[0].date=last===null?null:(rest.some(a=>/^\d+$/.test(String(a.date)))?String(last):new Date(last).toISOString());plat[0].auto=true;
 return list;
}
