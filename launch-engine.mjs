import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import {performance} from 'node:perf_hooks';import {portOf} from './port-trophies.mjs';import {portProfile} from './port-profiles.mjs';
import {json,save} from './files.mjs';import {launchFor} from './games.mjs';
import {repairLaunch} from './repair-service.mjs';
const exec=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
// Pasta de dados: %LOCALAPPDATA%\Taiga Launcher. Instalações antigas (TaigaSteamPSP) são renomeadas sozinhas na
// primeira abertura; se o Windows não deixar (pasta em uso), continua usando a antiga.
export function defaultDataDir(){if(process.env.TAIGA_DATA)return process.env.TAIGA_DATA;const base=process.env.LOCALAPPDATA||os.homedir(),now=path.join(base,'Taiga Launcher'),old=path.join(base,'TaigaSteamPSP');
 try{if(!fs.existsSync(now)&&fs.existsSync(old))fs.renameSync(old,now);}catch{return old;}return fs.existsSync(now)||!fs.existsSync(old)?now:old;}
export function splitArguments(text){
 if(/[\r\n\0]/.test(text))throw Error('Argumentos inválidos.');const result=[];let word='',quoted=false,started=false;
 for(let i=0;i<text.length;){if(text[i]==='\\'){let n=0;while(text[i+n]==='\\')n++;if(text[i+n]==='"'){word+='\\'.repeat(Math.floor(n/2));i+=n;if(n%2){word+='"';i++;}else{quoted=!quoted;i++;}started=true;}else{word+='\\'.repeat(n);i+=n;started=true;}continue;}if(text[i]==='"'){if(quoted&&text[i+1]==='"'){word+='"';i+=2;}else{quoted=!quoted;i++;}started=true;continue;}if(/\s/.test(text[i])&&!quoted){if(started){result.push(word);word='';started=false;}i++;continue;}word+=text[i++];started=true;}
 if(quoted)throw Error('Aspas não fechadas nos argumentos.');if(started)result.push(word);return result;
}
// Registro das aberturas (pasta logs): o que foi aberto, como e quanto tempo ficou aberto, para achar a causa
// quando um jogo "abre e fecha" pela Steam.
export function launchLog(dir,line){try{const f=path.join(dir,'logs','launch.log');fs.mkdirSync(path.dirname(f),{recursive:true});try{if(fs.statSync(f).size>512*1024)fs.renameSync(f,f+'.old');}catch{}fs.appendFileSync(f,new Date().toISOString()+' '+line+'\n');}catch{}}
// Abre pelo Windows (ShellExecute), como um clique duplo: funciona quando o Windows nega a abertura direta
// (EPERM/EACCES: programa que pede administrador, antitrapaça que só aceita ser aberto pelo Explorer, etc.).
export async function shellStart(exe,args,cwd){
 const q=v=>"'"+String(v).replace(/'/g,"''")+"'";
 const code="$ErrorActionPreference='Stop';$p=@{FilePath="+q(exe)+";WorkingDirectory="+q(cwd)+";PassThru=$true};"+(String(args||'').trim()?"$p.ArgumentList="+q(args)+";":"")+"$x=Start-Process @p;[Console]::Out.Write($x.Id)";
 const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,timeout:60000});
 const pid=Number(String(stdout).trim());return Number.isInteger(pid)&&pid>0?pid:null;}
const within=(file,dir)=>{try{const a=path.resolve(String(file)).toLowerCase(),b=path.resolve(String(dir)).toLowerCase();return a===b||a.startsWith(b.endsWith(path.sep)?b:b+path.sep)||a.startsWith(b+'\\')||a.startsWith(b+'/');}catch{return false;}};
// Pastas do jogo para reconhecer o processo dele quando quem abriu foi outro programa (loja, iniciador, Explorer).
function gameDirs(game){if(!['pc','store','custom'].includes(game.profile||'psp'))return [];const out=[];for(const d of [game.gameRoot,game.path&&path.dirname(game.path)]){if(!d)continue;const r=path.resolve(String(d));if(r.split(/[\\/]/).filter(Boolean).length<2)continue;if(/[\\/](windows|program files( \(x86\))?|programdata)$/i.test(r))continue;if(!out.some(x=>x.toLowerCase()===r.toLowerCase()))out.push(r);}return out;}
export const processAlive=pid=>{if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
export async function processSnapshot(){
 if(process.platform==='win32'){const code="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); @(Get-CimInstance Win32_Process | Select-Object @{n='pid';e={$_.ProcessId}},@{n='ppid';e={$_.ParentProcessId}},@{n='born';e={([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}},@{n='exe';e={$_.ExecutablePath}},@{n='name';e={$_.Name}}) | ConvertTo-Json -Compress";const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,timeout:10000,maxBuffer:4*1024*1024});const rows=JSON.parse(stdout.trim()||'[]');return Array.isArray(rows)?rows:[rows];}
 if(process.platform==='linux'){const rows=[],namespace=fs.readlinkSync('/proc/self/ns/pid');for(const name of fs.readdirSync('/proc'))if(/^\d+$/.test(name))try{if(fs.readlinkSync('/proc/'+name+'/ns/pid')!==namespace)continue;const stat=fs.readFileSync('/proc/'+name+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');if(fields[0]==='Z')continue;const status=fs.readFileSync('/proc/'+name+'/status','utf8'),ids=status.match(/^NSpid:\s*(.+)$/m)?.[1].trim().split(/\s+/);let exe='';try{exe=fs.readlinkSync('/proc/'+name+'/exe');}catch{}rows.push({pid:Number(ids?.at(-1)||name),host:Number(name),parentHost:Number(fields[1]),born:Number(fields[19]),exe});}catch{}const hostToPid=new Map(rows.map(r=>[r.host,r.pid]));return rows.map(r=>({...r,ppid:hostToPid.get(r.parentHost)||0}));}
 throw Error('Monitoramento de processos indisponível nesta plataforma.');
}
export class SessionStore{
 constructor(dir){this.dir=dir;this.folder=path.join(dir,'sessions');this.cache=null;fs.mkdirSync(this.folder,{recursive:true});}
 write(record){if(!UUID.test(record.id)||!UUID.test(record.uuid))throw Error('Sessão inválida.');save(path.join(this.folder,record.id+'.json'),record);this.cache=null;}
 records(){const out=[];for(const name of fs.readdirSync(this.folder))if(/^[a-f0-9-]{36}\.json$/i.test(name))try{const record=json(path.join(this.folder,name),null);if(record&&UUID.test(record.id)&&UUID.test(record.uuid)&&Number.isFinite(record.seconds)&&record.seconds>=0)out.push(record);}catch{}return out;}
 readIndex(){const file=path.join(this.dir,'playtime.json');try{if(!fs.existsSync(file)&&fs.existsSync(path.join(this.dir,'session-history')))throw Error('Rebuild missing index');const data=json(file,{totals:{},processed:[]});if(!data||typeof data.totals!=='object'||!Array.isArray(data.processed))throw Error('Invalid playtime index');return data;}catch{const backups=path.join(this.dir,'backups');fs.mkdirSync(backups,{recursive:true});if(fs.existsSync(file))fs.copyFileSync(file,path.join(backups,'playtime-corrupt-'+Date.now()+'.json'));const index={totals:{},processed:[]},history=path.join(this.dir,'session-history');if(fs.existsSync(history))for(const name of fs.readdirSync(history))if(/^[a-f0-9-]{36}\.json$/i.test(name))try{const r=json(path.join(history,name),null);if(!r||!UUID.test(r.uuid)||!Number.isFinite(r.seconds)||r.seconds<0)continue;const key=r.uuid+'|'+(r.account||'local'),old=index.totals[key]||{seconds:0,sessions:0};index.totals[key]={seconds:old.seconds+r.seconds,sessions:old.sessions+1,lastPlayed:old.lastPlayed&&old.lastPlayed>r.startedAt?old.lastPlayed:r.startedAt};index.processed.push(r.id);}catch{}(this.idxMemo=null,save(file,index));return index;}}
 // Sessões já terminadas de um jogo (pasta session-history), para a linha do tempo da página. A lista inteira só é lida
 // de novo quando a pasta muda.
 history(uuid,account){const dir=path.join(this.dir,'session-history');let st;try{st=fs.statSync(dir);}catch{return [];}if(!this.histMemo||this.histMemo.m!==st.mtimeMs){const all=[];for(const name of fs.readdirSync(dir))if(/^[a-f0-9-]{36}\.json$/i.test(name))try{const r=json(path.join(dir,name),null);if(r&&UUID.test(r.uuid)&&Number.isFinite(r.seconds)&&r.seconds>=0&&r.startedAt)all.push({uuid:r.uuid,account:r.account||'',seconds:r.seconds,startedAt:r.startedAt,endedAt:r.endedAt||null});}catch{}this.histMemo={m:st.mtimeMs,all};}return this.histMemo.all.filter(r=>r.uuid===uuid&&(!account||!r.account||r.account===account));}
 // playtime.json só é lido de novo quando muda (antes, a cada segundo em que alguém pedia o tempo de jogo).
 indexCached(){const f=path.join(this.dir,'playtime.json');let st;try{st=fs.statSync(f);}catch{return this.readIndex();}if(this.idxMemo&&this.idxMemo.m===st.mtimeMs&&this.idxMemo.s===st.size)return this.idxMemo.d;const d=this.readIndex();this.idxMemo={m:st.mtimeMs,s:st.size,d};return d;}
 snapshot(){if(this.cache&&Date.now()-this.cache.at<1000)return this.cache.stats;const index=this.indexCached(),stats=new Map(Object.entries(index.totals||{}).map(([key,value])=>[key,{...value,running:false}])),processed=new Set(index.processed||[]);for(const r of this.records()){if(processed.has(r.id))continue;const key=r.uuid+'|'+(r.account||'local'),value=stats.get(key)||{seconds:0,sessions:0,lastPlayed:null,running:false};value.seconds+=r.seconds;value.sessions++;value.lastPlayed=!value.lastPlayed||r.startedAt>value.lastPlayed?r.startedAt:value.lastPlayed;value.running||=r.status==='running'&&processAlive(r.launcherPid)&&Date.now()-Date.parse(r.heartbeatAt)<120000;if(r.status==='running'&&!processAlive(r.launcherPid))value.interrupted=true;if(r.warning)value.warning=r.warning;stats.set(key,value);}this.cache={at:Date.now(),stats};return stats;}
 // Tempo importado de outros programas (Epic, GOG, Playnite): vale o maior entre ele e o contado aqui.
 imported(uuid){const f=path.join(this.dir,'playtime-imported.json');let m=0;try{m=fs.statSync(f).mtimeMs;}catch{return 0;}if(!this.importCache||this.importCache.m!==m)this.importCache={m,data:json(f,{})||{}};return Math.max(0,...Object.values(this.importCache.data[uuid]||{}).map(Number).filter(Number.isFinite));}
 forGame(uuid,account){const own=this.snapshot().get(uuid+'|'+(account||'local'))||{seconds:0,sessions:0,running:false,lastPlayed:null},extra=this.imported(uuid);return extra>own.seconds?{...own,seconds:extra,imported:true}:own;}
 compact(record){const file=path.join(this.dir,'playtime.json'),index=this.readIndex();index.totals||={};index.processed||=[];if(!index.processed.includes(record.id)){const key=record.uuid+'|'+(record.account||'local'),old=index.totals[key]||{seconds:0,sessions:0};index.totals[key]={seconds:old.seconds+record.seconds,sessions:old.sessions+1,lastPlayed:old.lastPlayed&&old.lastPlayed>record.startedAt?old.lastPlayed:record.startedAt,warning:record.warning||null};index.processed.push(record.id);(this.idxMemo=null,save(file,index));}const session=path.join(this.folder,record.id+'.json');if(fs.existsSync(session)){const history=path.join(this.dir,'session-history');fs.mkdirSync(history,{recursive:true});fs.renameSync(session,path.join(history,record.id+'.json'));}this.cache=null;}
 recover(){const interrupted=[];for(const r of this.records())if(r.status==='running'&&!processAlive(r.launcherPid)){r.status='interrupted';r.endedAt=r.heartbeatAt;r.warning='SESSION_INTERRUPTED';this.write(r);interrupted.push(r);}return interrupted;}
}
// Saída capturada de um port (troféus no stdout).
export const portCaptureFile=(dir,uuid)=>path.join(dir,'port-logs',String(uuid).replace(/[^\w-]/g,'')+'.log');
// Jogo de loja aberto por link (explorer.exe "com.epicgames.launcher://..."): se o Windows não conhece esse tipo de
// link (loja desinstalada, reinstalada em outro lugar ou a versão nova do iniciador), o explorer só abre uma pasta.
// Aí o link vai direto para o iniciador da loja; sem ele, abre o .exe do jogo quando a loja não é obrigatória.
const STORE_LAUNCHERS={'com.epicgames.launcher':env=>[env['ProgramFiles(x86)'],env.ProgramFiles,'C:\\Program Files (x86)','C:\\Program Files'].filter(Boolean).flatMap(b=>['Win64','Win32'].map(a=>path.win32.join(b,'Epic Games','Launcher','Portal','Binaries',a,'EpicGamesLauncher.exe')))};
const regQuery=async key=>{try{await promisify(execFile)('reg',['query',key,'/v','URL Protocol'],{windowsHide:true,timeout:5000});return true;}catch{return false;}};
const protocolMemo=new Map();
export async function storeLinkFallback(launch,game,{platform=process.platform,env=process.env,query=regQuery,exists=f=>{try{return fs.statSync(f).isFile();}catch{return false;}},log=()=>{}}={}){
 if(platform!=='win32'||!/^explorer\.exe$/i.test(path.win32.basename(String(launch?.exe||''))))return launch;
 const url=String(launch.args||'').replace(/^"|"$/g,''),scheme=(url.match(/^([a-z][\w.+-]*):\/\//i)||[])[1];if(!scheme)return launch;
 let ok=query===regQuery?protocolMemo.get(scheme):null;if(!ok||Date.now()-ok.at>60000){ok={at:Date.now(),value:await query('HKCR\\'+scheme)};if(query===regQuery)protocolMemo.set(scheme,ok);}
 if(ok.value)return launch;
 const own=(STORE_LAUNCHERS[scheme.toLowerCase()]?.(env)||[]).find(exists);
 if(own){log('O Windows não abre links '+scheme+'://; abrindo pelo iniciador da loja.');return {exe:own,args:'"'+url+'"'};}
 if(!game?.store?.needsLauncher&&/\.exe$/i.test(String(game?.path||''))&&exists(game.path)){log('O Windows não abre links '+scheme+'://; abrindo o jogo direto.');return {exe:game.path,args:''};}
 throw Error('A loja deste jogo não está instalada ou o Windows não abre os links dela. Abra a loja uma vez e tente de novo.');
}
export class LaunchEngine{
 constructor({dir,snapshot=processSnapshot,spawnProcess=spawn,shellOpen=shellStart,interval=process.platform==='win32'?2500:150,grace=1200}={}){this.dir=dir;this.snapshot=snapshot;this.spawnProcess=spawnProcess;this.shellStart=shellOpen;this.interval=interval;this.grace=grace;this.store=new SessionStore(dir);}
 async run(game,config,{command=null,demoExecutable=process.execPath,repairs=null}={}){
  if(!UUID.test(game.uuid))throw Error('Jogo sem identificador permanente. Abra o Taiga Launcher para atualizar o cadastro.');if(game.demo)throw Error('Este cadastro não tem arquivo para executar.');{let ok=false;try{ok=fs.statSync(game.path).isFile();}catch(e){ok=/\.exe$/i.test(String(game.path))&&(e?.code==='EPERM'||e?.code==='EACCES');if(!ok&&e?.code!=='ENOENT'&&e?.code!=='ENOTDIR')throw e;}if(!ok)throw Error('Arquivo do jogo não encontrado.');}const launch=await storeLinkFallback(command||launchFor(game,config,demoExecutable),game,{log:m=>launchLog(this.store.dir,m)}),args=splitArguments(launch.args||'');
  const lockFile=path.join(this.store.folder,game.uuid+'.lock');try{fs.writeFileSync(lockFile,JSON.stringify({pid:process.pid}),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;let old;try{old=json(lockFile,null);}catch{}if(!old||processAlive(old.pid))throw Error('Este jogo já está em execução ou possui uma sessão a revisar.');fs.unlinkSync(lockFile);fs.writeFileSync(lockFile,JSON.stringify({pid:process.pid}),{flag:'wx'});}
  const started=performance.now(),record={id:crypto.randomUUID(),uuid:game.uuid,gameId:game.id,title:game.title,...(repairs?{repairs}:{}),account:config.account||'',launcherPid:process.pid,status:'starting',seconds:0,startedAt:new Date().toISOString(),heartbeatAt:new Date().toISOString()},tracked=new Map();let child,exitCode=null,spawned=false,captureFd=null;const closeCapture=()=>{if(captureFd!==null){try{fs.closeSync(captureFd);}catch{}captureFd=null;}};
  try{
   const spawnAt=Date.now(),cwd=path.dirname(launch.exe),dirs=gameDirs(game),base=path.basename(launch.exe).toLowerCase();let viaShell=false;
   launchLog(this.store.dir,'Abrindo '+game.title+': '+launch.exe+(launch.args?' '+launch.args:''));
   // Ports com troféus que só aparecem na saída do jogo (ex.: Bloodborne Windows, "Runtime: trophy N unlocked"): a
   // saída vai para port-logs/<uuid>.log, lido pelo Taiga Launcher. Só quando o próprio .exe do jogo é aberto.
   const sameExe=path.resolve(launch.exe).toLowerCase()===path.resolve(String(game.path||'')).toLowerCase();
   if(sameExe&&['pc','custom'].includes(game.profile)&&!game.native&&(()=>{try{return !!portOf(game)||portProfile(game)?.achievements==='trophies';}catch{return false;}})()){try{const f=portCaptureFile(this.dir,game.uuid);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'');captureFd=fs.openSync(f,'a');}catch{captureFd=null;}}
   try{child=this.spawnProcess(launch.exe,args,{cwd,stdio:captureFd!==null?['ignore',captureFd,captureFd]:'ignore',shell:false,windowsHide:false});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}
   catch(error){
    // O Windows negou a abertura direta: abre pelo Windows (como um clique duplo).
    if(process.platform!=='win32'||!/^(EPERM|EACCES|UNKNOWN|EINVAL|E2BIG)$/.test(String(error?.code||'')))throw error;
    launchLog(this.store.dir,'Abertura direta negada ('+error.code+'); abrindo pelo Windows.');
    let pid=null;try{pid=await this.shellStart(launch.exe,launch.args||'',cwd);}catch(e){launchLog(this.store.dir,'Abrir pelo Windows falhou: '+String(e?.message||e).slice(0,200));throw Error('O Windows não deixou abrir '+path.basename(launch.exe)+' ('+error.code+'). Se o jogo pede administrador, abra-o uma vez pelo próprio atalho e confirme; se for o antivírus, libere o Taiga Launcher.');}
    child=null;viaShell=true;if(pid){tracked.set(pid,{born:null,endedAt:null});record.rootPid=pid;}
   }
   spawned=true;record.status='running';if(child){record.rootPid=child.pid;tracked.set(child.pid,{born:null,endedAt:null});child.once('exit',code=>{exitCode=code;record.rootExitedAt=Date.now();const root=tracked.get(child.pid);if(root)root.endedAt=record.rootExitedAt;});}
   if(viaShell)record.via='shell';this.store.write(record);let emptyAt=null,failures=0,adopted=0;
   // Lojas e iniciadores que abrem o jogo e fecham (Epic, Riot, "Play ..."), ou abertura pelo Windows: espera o
   // processo do jogo aparecer na pasta dele e passa a acompanhá-lo (tempo de jogo e Steam "jogando" corretos).
   const watchUntil=()=>{if((game.profile==='store'||viaShell)&&dirs.length+(viaShell?1:0))return spawnAt+90000;if(game.profile==='custom'&&dirs.length&&path.resolve(launch.exe).toLowerCase()!==path.resolve(String(game.path||'')).toLowerCase()&&record.rootExitedAt&&record.rootExitedAt-spawnAt<15000)return record.rootExitedAt+45000;return 0;};
   for(;;){let rows;try{rows=await this.snapshot();failures=0;}catch{failures++;record.warning='PROCESS_SNAPSHOT_FAILED';rows=[...tracked].filter(([pid])=>processAlive(pid)).map(([pid,p])=>({pid,ppid:0,born:p.born}));}
    const present=new Map(rows.map(r=>[r.pid,r]));for(const [pid,known]of tracked){const row=present.get(pid);if(row&&!(child&&pid===child.pid&&record.rootExitedAt&&process.platform==='win32'&&row.born>record.rootExitedAt)&&(known.born===null||row.born===known.born)){known.born=row.born;known.endedAt=null;}else known.endedAt??=Date.now();}
    let found=true;while(found){found=false;for(const row of rows){if(tracked.has(row.pid)||!tracked.has(row.ppid))continue;const parent=tracked.get(row.ppid);if(parent.endedAt!==null&&process.platform==='win32'&&row.born>parent.endedAt)continue;tracked.set(row.pid,{born:row.born,endedAt:null});found=true;}}
    let alive=[...tracked].filter(([pid,known])=>{const row=present.get(pid);return row&&known.endedAt===null&&(known.born===null||known.born===row.born);});
    if(!alive.length&&Date.now()<watchUntil()){for(const row of rows){if(tracked.has(row.pid)||!(row.born>=spawnAt-3000))continue;const exe=String(row.exe||''),name=String(row.name||'').toLowerCase();if((exe&&dirs.some(d=>within(exe,d)))||(viaShell&&(exe?path.basename(exe).toLowerCase()===base:name===base))){tracked.set(row.pid,{born:row.born,endedAt:null});adopted++;launchLog(this.store.dir,'Processo do jogo encontrado: '+(exe||name)+' (pid '+row.pid+').');}}alive=[...tracked].filter(([pid,known])=>{const row=present.get(pid);return row&&known.endedAt===null&&(known.born===null||known.born===row.born);});}record.seconds=Math.max(0,(performance.now()-started)/1000);record.heartbeatAt=new Date().toISOString();record.processCount=alive.length;record.exitCode=exitCode;this.store.write(record);
    if(captureFd!==null){try{if(fs.fstatSync(captureFd).size>64*1024*1024)fs.ftruncateSync(captureFd,0);}catch{}}
    if(!alive.length&&Date.now()<watchUntil()){emptyAt=null;await pause(this.interval);continue;}
    if(!alive.length){emptyAt??=performance.now();if(performance.now()-emptyAt>=this.grace&&(failures===0||failures>=3)){if(failures>=3)record.warning='MONITORING_INCOMPLETE';break;}}else emptyAt=null;
    await pause(this.interval);
   }
   closeCapture();launchLog(this.store.dir,'Fim de '+game.title+': '+Math.round((performance.now()-started)/1000)+' s'+(adopted?', jogo acompanhado pela pasta':'')+(exitCode!==null?', código '+exitCode:'')+'.');
   record.seconds=Math.max(0,(emptyAt===null?performance.now():emptyAt)-started)/1000;record.status=record.warning==='MONITORING_INCOMPLETE'?'unverified':exitCode&&exitCode!==0?'failed':'ended';record.endedAt=new Date().toISOString();record.heartbeatAt=record.endedAt;this.store.write(record);return record;
  }catch(error){closeCapture();launchLog(this.store.dir,'Erro ao abrir '+game.title+': '+String(error?.message||error).slice(0,300));if(spawned){record.status='failed';record.error=error.message;record.endedAt=new Date().toISOString();this.store.write(record);}throw error;}
  finally{try{if(json(lockFile,null)?.pid===process.pid)fs.unlinkSync(lockFile);}catch{}}
 }
}
// Jogo de loja ainda não instalado: pede ao Taiga Launcher aberto que instale (Epic) ou abra a página no app Xbox.
async function requestInstall(game,config){
 const port=Number(config.port)||48767;
 try{const res=await fetch('http://127.0.0.1:'+port+'/api/store-install',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.adminToken},body:JSON.stringify({id:game.id}),signal:AbortSignal.timeout(30000)});const r=await res.json().catch(()=>({}));if(r.error)throw Error(r.error);return {install:true,...r};}
 catch(e){if(/fetch failed|ECONNREFUSED|abort/i.test(String(e.message||e)))throw Error('Abra o Taiga Launcher para instalar '+game.title+'.');throw e;}
}
export async function standaloneLaunch(uuid,{dir=defaultDataDir()}={}){
 if(!UUID.test(uuid))throw Error('Identificador do jogo inválido.');const config=json(path.join(dir,'config.json'),null),db=json(path.join(dir,'games.json'),null),game=db?.games?.find(g=>g.uuid===uuid);if(!config||!game)throw Error('Jogo não encontrado no Taiga Launcher.');if(game.notInstalled)return requestInstall(game,config);const engine=new LaunchEngine({dir});const repaired=await repairLaunch(game,config);return engine.run(repaired.game,repaired.config,{repairs:repaired.changes});
}
