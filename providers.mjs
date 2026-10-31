import fs from 'node:fs';
import path from 'node:path';
import {normalize,save,json,digest,atomic} from './files.mjs';
import {legacyPSP} from './legacy.mjs';
import {applyIGDB,titleKey} from './metadata.mjs';
import {translatePortuguese,translateText,looksPortuguese,detectLanguage} from './translation.mjs';
import {DatIndex,libretroThumbnailURL,libretroThumbnailName} from './dat-index.mjs';
import {RetroAchievements,isRAWarning} from './retroachievements.mjs';
import {platformByKey,platformByName,platformByIGDB} from './platforms.mjs';
import {similarity,normalizeTitle,scoreCandidate,confidentChoice} from './title-match.mjs';
import {isMainEntry} from './external.mjs';
import {parseRomName} from './rom-name.mjs';
// Campos IGDB usados em toda busca (inclui tipo do jogo e versão-mãe para agrupar edições).
export const IGDB_FIELDS='name,summary,storyline,first_release_date,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,genres.name,url,alternative_names.name,cover.url,screenshots.url,screenshots.width,screenshots.height,artworks.url,platforms.name,release_dates.date,release_dates.platform,game_type.type,category,version_parent,parent_game,total_rating_count,franchises.name,collections.name,external_games.uid,external_games.category,external_games.external_game_source';
const TEXT_HOSTS=['raw.githubusercontent.com','thumbnails.libretro.com','steamcommunity.com','store.steampowered.com','www.exophase.com','api.exophase.com'];
const cacheJSON=(file,fallback)=>{try{return json(file,fallback);}catch{return fallback;}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rateLimitError=host=>Object.assign(Error('Limite temporário de consultas atingido ('+host+'); o Taiga Launcher tenta de novo sozinho em alguns minutos.'),{code:'rate_limited'});
export class Providers{
 constructor(config,dir,{convertImage=null,compressImage=null,heroFromCover=null,offline=!!process.env.TAIGA_OFFLINE,defaultServer=''}={}){this.defaultServer=defaultServer;this.convertImage=convertImage;this.compressImage=compressImage;this.heroFromCover=heroFromCover;this.config=config;this.dir=dir;this.token=null;this.lanes=new Map();this.pending=new Map();this.cache=new Map();this.images=new Map();this.offline=offline;this.dat=new DatIndex({dir,fetchText:url=>this.requestText(url),offline});this.retro=new RetroAchievements({dir,config,offline});}
 async cached(key,ttl,fn){const hit=this.cache.get(key);if(hit&&hit.until>Date.now())return structuredClone(hit.value);if(this.pending.has(key))return structuredClone(await this.pending.get(key));const pending=(async()=>{const value=await fn();if(ttl){if(this.cache.size>=300)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,{value:structuredClone(value),until:Date.now()+ttl});}return value;})();this.pending.set(key,pending);try{return structuredClone(await pending);}finally{this.pending.delete(key);}}
 // Site fora do ar ou lento demais (falha de rede/tempo esgotado): as próximas consultas a ele falham na hora por 3 min,
 // em vez de cada jogo esperar o tempo-limite inteiro de novo.
 hostCheck(host){const until=(this.down||=new Map()).get(host);if(until&&until>Date.now())throw Error('Serviço indisponível no momento ('+host+').');const lim=(this.limits||=new Map()).get(host);if(lim&&lim>Date.now())throw rateLimitError(host);}
 // Limite de consultas (HTTP 429): o serviço pede para esperar. Durante a espera as consultas a ele falham na hora (sem
 // gastar mais o limite) e as capas que faltaram são buscadas de novo sozinhas quando a espera acaba.
 hostLimited(host,ms){const until=Date.now()+Math.min(30*60000,Math.max(60000,Number.isFinite(ms)?ms:10*60000));(this.limits||=new Map()).set(host,until);return until;}
 limitedUntil(){let max=0;for(const [,until] of (this.limits||new Map()))if(until>Date.now()&&until>max)max=until;return max;}
 limited(){return this.limitedUntil()>Date.now();}
 hostFailed(host,e){if(e&&(e.name==='TimeoutError'||e.name==='AbortError'||e.name==='TypeError'||/fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(String(e.message||e)+String(e.cause?.code||''))))(this.down||=new Map()).set(host,Date.now()+180000);}
 async request(url,options={}){
  if(this.offline)throw Error('Sem conexão (modo offline).');
  const key=digest(url+JSON.stringify(options.headers||{})+String(options.body||''));
  return this.cached('request:'+key,0,async()=>{
   const host=new URL(url).hostname,lane=this.lanes.get(host)||{last:0,tail:Promise.resolve()};this.lanes.set(host,lane);
   const job=async()=>{for(let i=0;i<3;i++){
    this.hostCheck(host);await sleep(Math.max(0,300-(Date.now()-lane.last)));lane.last=Date.now();
    let res;try{res=await fetch(url,{...options,signal:options.signal||AbortSignal.timeout(15000)});}catch(e){this.hostFailed(host,e);throw e;}
    if(res.status===429||res.status>=500){const raw=res.headers.get('retry-after'),seconds=Number(raw),delay=raw?(Number.isFinite(seconds)?seconds*1000:Date.parse(raw)-Date.now()):(i+1)*1000;await res.body?.cancel();
     // Espera curta: tenta de novo. Espera longa (ou o limite do dia do servidor, que vem sem prazo): para de consultar.
     const page=(res.headers.get('content-type')||'').includes('text/html');
     if(res.status===429&&(i>=1||page&&!raw||Number.isFinite(delay)&&delay>5000)){this.hostLimited(host,raw?delay:page?15*60000:2*60000);throw rateLimitError(host);}
     if(i<2){await sleep(Math.max(0,Math.min(5000,Number.isFinite(delay)?delay:1000)));continue;}}
    if(!res.ok)throw Error(`Serviço respondeu HTTP ${res.status}. Verifique as credenciais e tente novamente.`);
    const data=await res.json();if(data?.success===false||data?.Error||data?.error)throw Error('O serviço não aceitou a consulta.');return data;
   }};const pending=lane.tail.then(job,job);lane.tail=pending.catch(()=>{});return pending;
  });
 }
 // Texto (bancos DAT e listas de miniaturas) somente de hosts conhecidos, com limite de tamanho.
 async requestText(url,{maxBytes=24*1024*1024,headers={}}={}){
  if(this.offline)throw Error('Sem conexão (modo offline).');const u=new URL(url);if(u.protocol!=='https:'||!TEXT_HOSTS.includes(u.hostname))throw Error('Fonte não permitida.');
  const host=u.hostname,lane=this.lanes.get(host)||{last:0,tail:Promise.resolve()};this.lanes.set(host,lane);
  const job=async()=>{this.hostCheck(host);await sleep(Math.max(0,300-(Date.now()-lane.last)));lane.last=Date.now();let res;try{res=await fetch(u,{signal:AbortSignal.timeout(45000),headers:{'User-Agent':'TaigaLauncher/1.4.4',...headers}});}catch(e){this.hostFailed(host,e);throw e;}if(!res.ok)throw Error('HTTP '+res.status);const chunks=[];let n=0;for await(const chunk of res.body){n+=chunk.length;if(n>maxBytes)throw Error('Resposta muito grande.');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');};
  const pending=lane.tail.then(job,job);lane.tail=pending.catch(()=>{});return pending;
 }
 // Banco Redump/No-Intro: título exato por serial, CRC, MD5 ou tamanho (sem chave).
 async datLookup(platform,item){if(!platform?.dat?.length)return null;try{return await this.dat.lookup(platform,{serial:item.serial||item.discId||'',crc:item.crc||'',crcAlt:item.crcAlt||'',md5:item.md5||'',size:Number(item.bytes)||0,title:item.fileTitle||item.title||'',regions:item.region||[]});}catch{return null;}}
 // Hash RetroAchievements -> jogo RA, pela biblioteca pública de hashes (sem conta).
 async raGameId(hash,platform){if(!hash||!platform?.ra)return null;try{return await this.retro.gameIdForHash(hash,platform.ra);}catch{return null;}}
 // Capas, títulos e telas de jogo do libretro-thumbnails (sem chave), pelo nome canônico do dump.
 async libretroListing(system,kind){const file=path.join(this.dir,'cache','libretro-'+kind+'-'+system.replace(/[^\w.-]+/g,'_')+'.json');const old=cacheJSON(file,null);if(old&&Date.now()-old.at<(old.failed?6*3600000:14*86400000))return old.names||[];if(this.offline)return old?.names||[];try{const html=await this.requestText('https://thumbnails.libretro.com/'+encodeURIComponent(system)+'/'+kind+'/',{maxBytes:16*1024*1024});const names=[...html.matchAll(/href="([^"?/][^"]*?\.png)"/gi)].map(m=>{try{return decodeURIComponent(m[1]).replace(/\.png$/i,'');}catch{return null;}}).filter(Boolean);save(file,{at:Date.now(),names});return names;}catch{save(file,{at:Date.now(),failed:true,names:old?.names||[]});return old?.names||[];}}
 async libretroName(platform,game){if(!platform?.libretro)return null;const names=await this.libretroListing(platform.libretro,'Named_Boxarts');if(!names.length)return null;const wanted=libretroThumbnailName(game.canonicalName||'');if(wanted&&names.includes(wanted))return wanted;const title=normalizeTitle(game.title),regions=game.region?.length?game.region:['USA','World','Europe','Brazil','Japan'];let best=null;for(const n of names){const parsed=parseRomName(n+'.png');if(/\((?:Beta|Proto|Demo|Sample|Kiosk)/i.test(n))continue;const sim=normalizeTitle(parsed.title)===title?1:similarity(parsed.title,game.title);if(sim<.92)continue;const rank=Math.min(...(parsed.regions.length?parsed.regions:['?']).map(r=>{const i=regions.indexOf(r);return i<0?50:i;}));const score=sim*100-rank;if(!best||score>best.score)best={n,score};}return best?.n||null;}
 async libretroArt(game,{kinds=['cover','media']}={}){const platform=platformByKey(game.platformKey)||platformByName(game.platformName);if(!platform?.libretro||this.offline)return [];const warnings=[];try{const name=await this.libretroName(platform,game);if(!name)return [];game.libretroName=name;game.art||={};if(kinds.includes('cover')&&!game.art.cover&&!game.artPinned?.cover)try{game.art.cover=await this.image(libretroThumbnailURL(platform.libretro,'Named_Boxarts',name));game.artSources={...(game.artSources||{}),cover:'libretro'};}catch(e){warnings.push('Capa libretro: '+e.message);}
  if(kinds.includes('media')&&!game.media?.length){const media=[];for(const kind of ['Named_Snaps','Named_Titles'])try{media.push({image:await this.image(libretroThumbnailURL(platform.libretro,kind,name)),source:'libretro',url:''});}catch{}if(media.length)game.media=media;}}catch(e){warnings.push('libretro: '+e.message);}return warnings;}
 // Fontes com chave são opcionais: a chave do próprio usuário ou o Servidor do Taiga Launcher (que guarda a chave dele).
 // Servidor de chaves do Taiga Launcher (Cloudflare Worker): as chaves do SteamGridDB e da IGDB ficam só nele.
 server(){const v=String(this.config().profileServer||this.defaultServer||'').trim();return /^https:\/\//.test(v)?v.replace(/\/+$/,''):'';}
 sgAvailable(){return !!(this.config().sgdbKey||this.server());}
 igAvailable(){const c=this.config();return !!((c.igdbId&&c.igdbSecret)||this.server());}
 async sg(endpoint){const key=this.config().sgdbKey,server=this.server();if(!key&&!server)throw Error('SteamGridDB indisponível.');const r=await this.cached('sg:'+digest((key||server)+':'+endpoint),300000,()=>key?this.request('https://www.steamgriddb.com/api/v2/'+endpoint,{headers:{Authorization:'Bearer '+key}}):this.request(server+'/v1/sgdb/'+endpoint));if(!Array.isArray(r.data)){if(/^games\/(steam|egs|origin|uplay|bnet|id)\//.test(endpoint)&&r.data?.id)return [r.data];throw Error('Resposta SteamGridDB inesperada.');}return r.data;}
 // Várias consultas do SteamGridDB num pedido só ao Servidor do Taiga Launcher (as artes de um jogo): o limite diário
 // do servidor rende quatro a cinco vezes mais. Servidor antigo sem essa rota: segue com um pedido por consulta.
 async sgPrefetch(endpoints){const server=this.server();if(this.config().sgdbKey||!server||this.noBatch||this.offline)return;const key=e=>'sg:'+digest(server+':'+e);
  const todo=[...new Set(endpoints)].filter(e=>{const h=this.cache.get(key(e));return !(h&&h.until>Date.now());}).slice(0,8);if(todo.length<2)return;
  let r;try{r=await this.request(server+'/v1/sgdb/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoints:todo})});}catch(e){if(/HTTP (?:400|404|405)\b/.test(String(e.message)))this.noBatch=true;return;}
  for(const e of todo){const v=r?.results?.[e];if(v?.status===200&&v.body&&typeof v.body==='object'&&v.body.success!==false){if(this.cache.size>=300)this.cache.delete(this.cache.keys().next().value);this.cache.set(key(e),{value:structuredClone(v.body),until:Date.now()+300000});}}
 }
 async ig(query,endpoint='games'){if(!['games','characters'].includes(endpoint))throw Error('IGDB: consulta inválida.');const c=this.config();if(!c.igdbId||!c.igdbSecret){const server=this.server();if(!server)throw Error('IGDB indisponível.');return this.cached('ig:server:'+(endpoint==='games'?'':endpoint+':')+digest(query),300000,()=>this.request(server+'/v1/igdb/'+endpoint,{method:'POST',headers:{'Content-Type':'text/plain'},body:query}));}
  const fingerprint=digest(c.igdbId+c.igdbSecret);
  if(!this.token||this.token.fingerprint!==fingerprint||this.token.expires<Date.now()){
   const t=await this.request('https://id.twitch.tv/oauth2/token',{method:'POST',body:new URLSearchParams({client_id:c.igdbId,client_secret:c.igdbSecret,grant_type:'client_credentials'})});
   if(!t.access_token||!t.expires_in)throw Error('A Twitch não retornou um token válido. Confira Client ID e Client Secret.');
   this.token={value:t.access_token,expires:Date.now()+(t.expires_in-60)*1000,fingerprint};
  }
  return this.cached('ig:'+fingerprint+':'+(endpoint==='games'?'':endpoint+':')+digest(query),300000,()=>this.request('https://api.igdb.com/v4/'+endpoint,{method:'POST',headers:{'Client-ID':c.igdbId,Authorization:'Bearer '+this.token.value,'Content-Type':'text/plain'},body:query}));
 }
 async ra(endpoint,params={}){const c=this.config();if(!c.raKey)throw Error('Configure a chave RetroAchievements.');return this.request('https://retroachievements.org/API/'+endpoint+'?'+new URLSearchParams({y:c.raKey,...params}));}
 async candidates(title,{allPlatforms=false,includeRA=true,onlyRA=false,onlyIGDB=false,platformKey=null}={}){title=String(title).replace(/[™®©]/g,'').replace(/\s+/g,' ').trim();const result={sgdb:[],igdb:[],ra:[],errors:[]};
  // Sem plataforma explícita mantém o comportamento anterior (PSP), exceto na busca em todas as plataformas.
  const platform=platformKey?platformByKey(platformKey):allPlatforms?null:platformByKey('psp');
  const c=this.config();
  const tasks=[];tasks.push((async()=>{if(!onlyRA&&!onlyIGDB&&this.sgAvailable())try{result.sgdb=(await this.sg('search/autocomplete/'+encodeURIComponent(title))).map(g=>({id:g.id,name:g.name,release_date:g.release_date||null,types:g.types||[]}));}catch(e){result.errors.push('SteamGridDB: '+e.message);}})());
  tasks.push((async()=>{if(!onlyRA&&this.igAvailable())try{
   const q=(where,limit)=>this.ig(`search ${JSON.stringify(title)}; fields ${IGDB_FIELDS}; ${where?`where platforms = (${where});`:''} limit ${limit};`);
   let lists;
   if(platform?.igdb&&!allPlatforms&&!platformKey)lists=[await q(platform.igdb,8)];
   else if(platform?.igdb)lists=await Promise.all([q(platform.igdb,10),q(null,10).catch(()=>[])]);
   else lists=[await q(null,16)];
   const seen=new Set();result.igdb=lists.flat().filter(g=>g&&g.id&&!seen.has(g.id)&&seen.add(g.id));
  }catch(e){result.errors.push('IGDB: '+e.message);}})());
  tasks.push((async()=>{const consoleId=platform?.ra;if(includeRA&&this.config().raKey&&consoleId)try{
   const list=await this.raGameList(consoleId);
   const q=normalize(title),words=q.split(' ');result.ra=list.map(g=>({id:g.id,name:g.name})).filter(g=>normalize(g.name)===q||words.filter(w=>w.length>2).every(w=>normalize(g.name).includes(w))).slice(0,12);
  }catch(e){result.errors.push('RetroAchievements: '+e.message);}})());
  await Promise.all(tasks);for(const key of ['sgdb','igdb','ra']){if(!Array.isArray(result[key])){result[key]=[];result.errors.push(key+': resposta inesperada do serviço.');}}
  // Sem IGDB/SteamGridDB: nomes do libretro-thumbnails da plataforma (com a capa como miniatura), sem chave nenhuma.
  result.free=[];if(!onlyRA&&!result.igdb.length&&!result.sgdb.length&&!this.offline){const plats=platform?[platform]:[];for(const p of plats.filter(p=>p.libretro)){try{const names=await this.libretroListing(p.libretro,'Named_Boxarts');const scored=names.map(n=>{const parsed=parseRomName(n+'.png');return {n,title:parsed.title,score:normalizeTitle(parsed.title)===normalizeTitle(title)?1:similarity(parsed.title,title)};}).filter(x=>x.score>=.55&&!/\((?:Beta|Proto|Demo|Sample|Kiosk)/i.test(x.n)).sort((a,b)=>b.score-a.score);const seen=new Set();for(const x of scored){const k=normalizeTitle(x.title);if(seen.has(k))continue;seen.add(k);result.free.push({name:x.title,libretroName:x.n,platformKey:p.key,url:libretroThumbnailURL(p.libretro,'Named_Boxarts',x.n),score:x.score});if(result.free.length>=8)break;}}catch{}}}
  return result;
 }
 // Lista de jogos RA por console (com hashes quando a Web API Key existe), em cache por 1 dia.
 async raGameList(consoleId){const file=path.join(this.dir,'cache',Number(consoleId)===41?'ra-psp-list.json':'ra-list-'+Number(consoleId)+'.json');let cached=cacheJSON(file,null);
  if(!cached||Date.now()-cached.at>86400000){const data=await this.ra('API_GetGameList.php',{i:consoleId,f:1,h:1});cached={at:Date.now(),data};save(file,cached);}
  return (cached.data||[]).map(g=>({id:g.ID,name:g.Title,hashes:(g.Hashes||[]).map(h=>String(h).toLowerCase())}));}
 // Endereço público (https) de onde veio cada arte salva: usado no perfil público (amigos veem as mesmas capas sem
 // o Taiga Launcher enviar imagens).
 artOrigins(){if(!this._origins){try{this._origins=JSON.parse(fs.readFileSync(path.join(this.dir,'art-origins.json'),'utf8'));}catch{this._origins={};}}return this._origins;}
 artOrigin(name){return this.artOrigins()[String(name||'')]||'';}
 rememberOrigin(name,url){if(!name||!/^https:\/\//.test(url))return;const o=this.artOrigins();if(o[name]===url)return;o[name]=url;clearTimeout(this._originsTimer);this._originsTimer=setTimeout(()=>{try{fs.mkdirSync(this.dir,{recursive:true});fs.writeFileSync(path.join(this.dir,'art-origins.json'),JSON.stringify(o));}catch{}},500);this._originsTimer.unref?.();}
 async image(url){
  if(this.images.has(url))return this.images.get(url);
  const prefix=digest(url).slice(0,24);for(const ext of ['png','jpg','ico']){const name=prefix+'.'+ext,file=path.join(this.dir,'art',name);try{const stat=fs.statSync(file);if(stat.isFile()&&stat.size&&Date.now()-stat.mtimeMs<7*86400000){this.rememberOrigin(name,url);return name;}}catch{}}
  const pending=this.downloadImage(url);this.images.set(url,pending);try{const name=await pending;this.rememberOrigin(name,url);return name;}finally{this.images.delete(url);}
 }
 async downloadImage(url){
  const u=new URL(url);if(u.protocol!=='https:'||!['cdn2.steamgriddb.com','cdn.steamgriddb.com','upload.wikimedia.org','media.retroachievements.org','images.igdb.com','thumbnails.libretro.com','shared.fastly.steamstatic.com','shared.steamstatic.com','shared.akamai.steamstatic.com','shared.cloudflare.steamstatic.com','cdn.akamai.steamstatic.com','cdn.cloudflare.steamstatic.com','cdn.fastly.steamstatic.com','steamcdn-a.akamaihd.net','media.steampowered.com','cdn1.epicgames.com','cdn2.unrealengine.com','images.gog-statics.com','store-images.s-microsoft.com','images-eds-ssl.xboxlive.com','images-eds.xboxlive.com'].includes(u.hostname))throw Error('Fonte de imagem não permitida.');
  const res=await fetch(u,{signal:AbortSignal.timeout(20000),redirect:'error'});if(!res.ok)throw Error('Não foi possível baixar a imagem.');
  if(Number(res.headers.get('content-length')||0)>48000000)throw Error('Imagem excede 48 MB. Escolha outra opção da galeria.');
  const chunks=[];let n=0;for await(const chunk of res.body){n+=chunk.length;if(n>48000000)throw Error('Imagem excede 48 MB. Escolha outra opção da galeria.');chunks.push(chunk);}let bytes=Buffer.concat(chunks);if(bytes.length>12000000&&this.convertImage)bytes=await this.convertImage(bytes);if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){if(!this.convertImage)throw Error('Abra o programa desktop para converter esta imagem WebP.');bytes=await this.convertImage(bytes);}
  if(this.convertImage&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.length>=24&&(bytes.readUInt32BE(16)>2048||bytes.readUInt32BE(20)>2048))bytes=await this.convertImage(bytes);if(bytes.length>12000000)throw Error('Abra o programa desktop para reduzir esta imagem.');
  // Capas, fundos e banners sem transparência viram JPEG de alta qualidade: ocupam até 80% menos no disco e na Steam.
  if(this.compressImage)try{const out=await this.compressImage(bytes);if(out?.length)bytes=out;}catch{}
  let ext;if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))ext='png';else if(bytes[0]===255&&bytes[1]===216)ext='jpg';else if(bytes.subarray(0,4).equals(Buffer.from([0,0,1,0])))ext='ico';else throw Error('Formato de imagem não suportado.');
  const name=digest(url).slice(0,24)+'.'+ext;atomic(path.join(this.dir,'art',name),bytes);return name;
 }
 // Associa o jogo ao SteamGridDB sozinho (pelo AppID da Steam ou pelo nome exato), inclusive para jogos
 // adicionados antes de a chave ser informada.
 async resolveSgdbId(game,{steamAppId=null}={}){
  if(game.sgdbId||!this.sgAvailable())return game.sgdbId||null;
  try{if(steamAppId){const list=await this.sg('games/steam/'+Number(steamAppId));if(list.length===1)return game.sgdbId=list[0].id;}}catch{}
  const names=[...new Set([game.title,game.steamLink?.name,game.canonicalName,...(game.aliases||[])].filter(Boolean))].slice(0,4);
  for(const name of names){try{const list=await this.sg('search/autocomplete/'+encodeURIComponent(name)),exact=list.filter(x=>titleKey(x.name)===titleKey(name));if(exact.length===1)return game.sgdbId=exact[0].id;if(!exact.length&&list.length){const scored=list.map(x=>({x,...scoreCandidate(name,x.name,{})})),c=confidentChoice(scored,{min:.95,gap:.1});if(c)return game.sgdbId=c.x.id;}}catch{}}
  return null;
 }
 // Opções oficiais da Steam para jogos que existem lá (só as que respondem).
 async steamArtwork(appId,kind){
  if(!appId||this.offline)return [];const base='https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/'+Number(appId)+'/';
  const urls={cover:['library_600x900_2x.jpg','library_600x900.jpg'],hero:['library_hero.jpg'],logo:['logo.png'],wide:['header.jpg','capsule_616x353.jpg']}[kind]||[];
  const ok=await Promise.all(urls.map(async n=>{try{const r=await fetch(base+n,{method:'HEAD',signal:AbortSignal.timeout(6000)});return r.ok?base+n:null;}catch{return null;}}));
  return ok.filter(Boolean).map((url,i)=>({id:'steam-'+kind+'-'+i,url,preview:url,author:'Steam',source:'Steam',width:0,height:0}));
 }
 async artwork(game,kind,page=0,{steamAppId=null}={}){
  const endpoints={cover:'grids',wide:'grids',hero:'heroes',logo:'logos',icon:'icons'};if(!endpoints[kind])throw Error('Tipo de arte inválido.');
  const out=[],first=!(Number(page)>0);
  // 1) Steam (jogos com AppID), 2) SteamGridDB, 3) capa do libretro (jogos de emulador).
  if(first&&steamAppId)out.push(...await this.steamArtwork(steamAppId,kind));
  if(!game.sgdbId)await this.resolveSgdbId(game,{steamAppId});
  if(game.sgdbId){
   const dims=kind==='cover'?'&dimensions=600x900':kind==='wide'?'&dimensions=460x215,920x430':'';
   const mimes=kind==='logo'?'image/png,image/webp':kind==='icon'?'image/png':'image/png,image/jpeg';
   const data=await this.sg(`${endpoints[kind]}/game/${game.sgdbId}?types=static&mimes=${mimes}${dims}&page=${Math.max(0,Math.min(20,Number(page)||0))}`);
   out.push(...data.filter(a=>!a.nsfw&&!a.humor&&a.url).map(a=>({id:a.id,url:a.url,preview:a.thumb||a.url,author:a.author?.name||'SteamGridDB',width:a.width||0,height:a.height||0})));
  }
  // Sem chave nenhuma: capa, telas e logo do libretro-thumbnails (jogos de emulador).
  if(first){const platform=platformByKey(game.platformKey)||platformByName(game.platformName);if(platform?.libretro&&!this.offline)try{const name=game.libretroName||await this.libretroName(platform,game);if(name){const dirs={cover:['Named_Boxarts'],wide:['Named_Titles','Named_Snaps'],hero:['Named_Titles','Named_Snaps'],logo:['Named_Logos']}[kind]||[];for(const d of dirs){const names=d==='Named_Boxarts'?null:await this.libretroListing(platform.libretro,d);if(names&&!names.includes(name))continue;const url=libretroThumbnailURL(platform.libretro,d,name);out.push({id:'libretro-'+d,url,preview:url,author:'libretro-thumbnails',source:'libretro',width:0,height:0});}}}catch{}}
  if(!out.length&&!game.sgdbId)throw Error(this.sgAvailable()?'Não encontramos este jogo no SteamGridDB. Use Trocar jogo para escolher o título certo.':'Nenhuma arte encontrada para este jogo. Escolha uma imagem do computador ou adicione uma chave do SteamGridDB em Configurações para ver mais opções.');
  return out;
 }
 async enrich(game,selected){
  const warnings=[];if(selected.free?.libretroName){game.libretroName=selected.free.libretroName;}
  if(selected.igdb){const incoming=applyIGDB(game,selected.igdb),old=game.metadata||{};game.metadata={...incoming,...old};for(const key of ['summary','developer','publisher','release','genres','url','series'])if(!game.metadataPinned?.[key]&&(!old[key]||Array.isArray(old[key])&&!old[key].length))game.metadata[key]=incoming[key];if(!old.summary&&!game.metadataPinned?.summary)game.metadata.summaryLanguage='en';game.igdbId=selected.igdb.id;}

  if(selected.ra)game.raId=Number(selected.ra.id);
  if(selected.sgdb){game.sgdbId=Number(selected.sgdb.id);game.art||={};
   const artEndpoint=(kind,endpoint)=>{const dims=kind==='cover'?'&dimensions=600x900':kind==='wide'?'&dimensions=460x215,920x430':'';const mimes=kind==='logo'?'image/png,image/webp':kind==='icon'?'image/png':'image/png,image/jpeg';return `${endpoint}/game/${game.sgdbId}?types=static&mimes=${mimes}${dims}`;};
   const ART=[['cover','grids'],['wide','grids'],['hero','heroes'],['logo','logos'],['icon','icons']],wanted=ART.filter(([kind])=>!(game.artPinned?.[kind]||selected.missingOnly&&game.art?.[kind]));
   await this.sgPrefetch(wanted.map(([kind,endpoint])=>artEndpoint(kind,endpoint))).catch(()=>{});
   for(const [kind,endpoint] of wanted)try{
    const imgs=await this.sg(artEndpoint(kind,endpoint));
    const img=imgs.find(x=>!x.nsfw&&!x.humor&&x.url);if(img)game.art[kind]=await this.image(img.url);else if(kind==='cover')warnings.push('SteamGridDB: nenhuma capa estática disponível para este jogo.');
   }catch(e){warnings.push(kind+': '+e.message);}
  }
  if(!game.artPinned?.cover&&selected.igdb?.cover?.url&&!game.art?.cover){try{const source=selected.igdb.cover.url;const url=(source.startsWith('//')?'https:'+source:source).replace('/t_thumb/','/t_cover_big/');game.art||={};game.art.cover=await this.image(url);}catch(e){warnings.push('Capa IGDB: '+e.message);}}
  if(selected.igdb){warnings.push(...await this.localize(game));warnings.push(...await this.refreshMedia(game,selected.igdb));}return warnings;
 }
 async fillMetadata(game){
  const warnings=[];let items=[];const platform=platformByKey(game.platformKey)||platformByName(game.platformName);
  try{if(Number.isSafeInteger(Number(game.igdbId))&&Number(game.igdbId)>0)items=await this.ig(`fields ${IGDB_FIELDS}; where id = ${Number(game.igdbId)}; limit 1;`);else{const found=await this.candidates(game.title,{allPlatforms:!platform,platformKey:platform?.key||null,includeRA:false,onlyIGDB:true});items=found.igdb;warnings.push(...found.errors);}}
  catch(e){if(!this.igAvailable())return [];warnings.push('IGDB: '+e.message);return warnings;}
  // Sem IGDB (modo gratuito): nada a marcar como pendente; os dados vêm da Wikidata.
  if(!items.length&&!this.igAvailable())return [];
  let exact;
  if(game.igdbId)exact=items;
  else{
   // Pontuação por título + plataforma (mesma regra da importação); só aceita escolha clara.
   const scored=items.filter(isMainEntry).map(x=>({x,...scoreCandidate(game.title,x.name,{platformMatch:platform?(x.platforms||[]).some(p=>Number(p.id)===platform.igdb||platformByName(p.name)?.key===platform.key):null,aliases:(x.alternative_names||[]).map(a=>a.name)})}));
   const choice=confidentChoice(scored,{min:.9});
   exact=choice?[choice.x]:items.filter(x=>[x.name,...(x.alternative_names||[]).map(a=>a.name)].some(name=>titleKey(name)===titleKey(game.title)));
   if(!choice&&platform){const compatible=exact.filter(x=>(x.platforms||[]).some(p=>platformByName(p.name)?.key===platform.key));if(compatible.length)exact=compatible;}
  }
  if(exact.length!==1){game.identificationPending=true;if(items.length)warnings.push('Identificação pendente: use Trocar jogo para escolher a versão correta entre os resultados encontrados.');else if(!warnings.length)warnings.push('IGDB: nenhum resultado para este título.');return warnings;}
  delete game.identificationPending;const source=exact[0],fetched=applyIGDB(game,source),current=game.metadata||{},hadSummary=!!current.summary;
  game.metadata={...fetched,...current};for(const key of ['summary','developer','publisher','release','genres','url','series'])if(!game.metadataPinned?.[key]&&(!current[key]||(Array.isArray(current[key])&&!current[key].length)))game.metadata[key]=fetched[key];
  if(!hadSummary){game.metadata.summaryLanguage='en';delete game.metadata.summaryOriginal;}if(!current.release)game.metadata.releaseBasis=fetched.releaseBasis;game.igdbId=source.id;
  if(!game.artPinned?.cover&&!game.art?.cover&&source.cover?.url){try{const raw=source.cover.url;game.art||={};game.art.cover=await this.image((raw.startsWith('//')?'https:'+raw:raw).replace('/t_thumb/','/t_cover_big/'));}catch(e){warnings.push('Capa IGDB: '+e.message);}}
  warnings.push(...await this.localize(game));warnings.push(...await this.refreshMedia(game,source));return warnings;
 }
 async completeMissing(game){
  const warnings=[],needs=()=>['summary','developer','publisher','release'].some(k=>!game.metadata?.[k]&&!game.metadataPinned?.[k]);
  if(needs())warnings.push(...(await this.fillMetadata(game)).filter(w=>this.igAvailable()||!/^IGDB|Identificação pendente/.test(w)));
  if(needs())warnings.push(...await this.wikiMetadata(game));
  game.metadata||={};const m=game.metadata,local=legacyPSP[normalize(game.title)]?.metadata;
  const fill=(key,value,source)=>{if(value&&!m[key]&&!game.metadataPinned?.[key]){m[key]=value;m.sources||={};m.sources[key]=source;if(key==='summary')m.summaryLanguage=source==='Dados locais'?'pt-BR':'en';}};
  if(local)for(const key of ['summary','developer','publisher','release'])fill(key,local[key],'Dados locais');
  if(game.raId&&this.config().raKey&&(needs()||!game.art?.cover))try{const raw=await this.cached('ra-meta:'+game.raId+':'+digest(this.config().raKey),86400000,()=>this.ra('API_GetGameExtended.php',{i:game.raId}));const raPlatform=platformByKey(game.platformKey)||platformByName(game.platformName);if(!raw.ConsoleID||!raPlatform?.ra||Number(raw.ConsoleID)===raPlatform.ra){fill('developer',raw.Developer,'RetroAchievements');fill('publisher',raw.Publisher,'RetroAchievements');if(raw.ReleasedAtGranularity!=='year'&&raw.ReleasedAtGranularity!=='month'&&/^\d{4}-\d{2}-\d{2}/.test(raw.Released||''))fill('release',raw.Released.slice(0,10),'RetroAchievements');fill('summary',raw.Description,'RetroAchievements');if(!game.art?.cover&&!game.artPinned?.cover&&/^\/Images\/[a-z0-9]+\.png$/i.test(raw.ImageBoxArt||'')){game.art||={};game.art.cover=await this.image('https://media.retroachievements.org'+raw.ImageBoxArt);}}}catch(e){warnings.push('Dados alternativos: '+e.message);}
  if(!game.sgdbId&&this.sgAvailable()){try{const list=await this.sg('search/autocomplete/'+encodeURIComponent(game.title)),exact=list.filter(g=>titleKey(g.name)===titleKey(game.title));if(exact.length===1)game.sgdbId=exact[0].id;}catch(e){warnings.push('Artes alternativas: '+e.message);}}
  if(game.sgdbId&&['cover','wide','hero','logo','icon'].some(k=>!game.art?.[k]&&!game.artPinned?.[k]))warnings.push(...await this.enrich(game,{sgdb:{id:game.sgdbId},missingOnly:true}));
  if(!game.art?.cover||!game.media?.length)warnings.push(...await this.libretroArt(game));
  if(!game.art?.cover)await this.findCover(game);
  warnings.push(...await this.freeArt(game));
  warnings.push(...await this.localize(game));return [...new Set(warnings)];
 }
 // Capa sem chave, nesta ordem: capa oficial da Steam (jogo com AppID), capa do libretro (jogos de emulador)
 // e a imagem do artigo da Wikipedia em inglês, só quando é vertical (capa, não logo).
 async findCover(game){
  if(this.offline||game.art?.cover||game.artPinned?.cover)return !!game.art?.cover;game.art||={};const set=(name,src)=>{game.art.cover=name;game.artSources={...(game.artSources||{}),cover:src};return true;};
  const appId=Number(game.steamLink?.appId||game.achievementSettings?.steamAppId||game.metadataSteamAppId||0);
  if(appId)try{const list=await this.steamArtwork(appId,'cover');for(const it of list){try{return set(await this.image(it.url),'Steam');}catch{}}}catch{}
  try{await this.libretroArt(game,{kinds:['cover']});if(game.art.cover)return true;}catch{}
  try{
   if(!game.wikiEnTitle&&!game.wikiChecked){game.wikiChecked=Date.now();await this.wikiMetadata(game);}
   if(game.wikiEnTitle){const r=await this.request('https://en.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(game.wikiEnTitle.replace(/ /g,'_')),{headers:{'User-Agent':'TaigaLauncher/1.8 (https://github.com/; contato pelo repositório)'}});
    const img=r?.originalimage||r?.thumbnail;if(img?.source&&/^https:\/\/upload\.wikimedia\.org\//.test(img.source)&&img.height>img.width*1.15)return set(await this.image(img.source),'Wikipedia');}
  }catch{}
  return false;
 }
 // Artes sem chave para o que faltou: horizontal e logo do libretro (tela de título / logo), fundo gerado a partir
 // da capa (versão bem desfocada, no próprio PC) ou, sem capa, a tela de título.
 async freeArt(game){
  const warnings=[];if(this.offline)return warnings;game.art||={};const need=k=>!game.art[k]&&!game.artPinned?.[k];
  if(!need('wide')&&!need('hero')&&!need('logo'))return warnings;
  const platform=platformByKey(game.platformKey)||platformByName(game.platformName);let name=null;
  try{if(platform?.libretro)name=game.libretroName||await this.libretroName(platform,game);}catch{}
  const pick=async dirs=>{if(!name)return null;for(const d of dirs){try{const names=await this.libretroListing(platform.libretro,d);if(!names.includes(name))continue;return await this.image(libretroThumbnailURL(platform.libretro,d,name));}catch{}}return null;};
  try{if(need('wide')){const f=await pick(['Named_Titles','Named_Snaps']);if(f){game.art.wide=f;game.artSources={...(game.artSources||{}),wide:'libretro'};}}}catch(e){warnings.push('Arte horizontal: '+e.message);}
  try{if(need('logo')){const f=await pick(['Named_Logos']);if(f){game.art.logo=f;game.artSources={...(game.artSources||{}),logo:'libretro'};}}}catch{}
  try{if(need('hero')){let f=null;const cover=game.art.cover&&path.join(this.dir,'art',path.basename(game.art.cover));
   if(cover&&this.heroFromCover&&fs.existsSync(cover)){const bytes=await this.heroFromCover(fs.readFileSync(cover));if(bytes?.length){f=digest(game.art.cover+':hero').slice(0,24)+'.jpg';fs.mkdirSync(path.join(this.dir,'art'),{recursive:true});fs.writeFileSync(path.join(this.dir,'art',f),bytes);}}
   if(!f)f=await pick(['Named_Titles','Named_Snaps']);if(f){game.art.hero=f;game.artSources={...(game.artSources||{}),hero:f.endsWith('.jpg')&&!this.artOrigin(f)?'gerado':'libretro'};}}}catch(e){warnings.push('Fundo: '+e.message);}
  return warnings;
 }
 // Dados do jogo sem chave: Wikidata (desenvolvedora, distribuidora, série, lançamento) e resumo da Wikipedia no
 // idioma do Taiga Launcher (ou em inglês, traduzido depois). Só aceita um item que seja "jogo eletrônico" com o mesmo nome.
 // AppIDs da Steam do item do Wikidata já identificado (P1733).
 async wikidataSteamIds(qid){if(this.offline||!/^Q\d+$/.test(String(qid||'')))return [];const r=await this.request('https://www.wikidata.org/w/api.php?'+new URLSearchParams({format:'json',origin:'*',action:'wbgetentities',ids:qid,props:'claims'}),{headers:{'User-Agent':'TaigaLauncher/1.6 (https://github.com/; contato pelo repositório)'}});return [...new Set((r?.entities?.[qid]?.claims?.P1733||[]).map(x=>Number(x.mainsnak?.datavalue?.value)).filter(n=>Number.isInteger(n)&&n>0))];}
 async wikiMetadata(game){
  if(this.offline||!game.title)return [];const lang=({'pt-BR':'pt',en:'en',es:'es',fr:'fr',de:'de'})[this.config().language||'pt-BR']||'en';
  const headers={'User-Agent':'TaigaLauncher/1.6 (https://github.com/; contato pelo repositório)'},w=params=>this.request('https://www.wikidata.org/w/api.php?'+new URLSearchParams({format:'json',origin:'*',...params}),{headers});
  try{
   const title=String(game.title).replace(/[™®©]/g,'').trim(),found=await w({action:'wbsearchentities',search:title,language:'en',uselang:lang,type:'item',limit:'10'});
   const ids=(found.search||[]).map(x=>x.id).filter(x=>/^Q\d+$/.test(x));if(!ids.length)return [];
   const ents=(await w({action:'wbgetentities',ids:ids.join('|'),props:'claims|sitelinks|labels|aliases',languages:'en|'+lang})).entities||{};
   const claim=(e,p)=>(e.claims?.[p]||[]).map(c=>c.mainsnak?.datavalue?.value).filter(Boolean);
   const names=e=>[e.labels?.en?.value,e.labels?.[lang]?.value,...(e.aliases?.en||[]).map(a=>a.value)].filter(Boolean);
   const games=ids.map(id=>ents[id]).filter(e=>e&&claim(e,'P31').some(v=>v.id==='Q7889')&&names(e).some(n=>titleKey(n)===titleKey(title)));
   if(games.length!==1)return [];const e=games[0],m=game.metadata||(game.metadata={});const fill=(k,v,src)=>{if(v&&!m[k]&&!game.metadataPinned?.[k]){m[k]=v;m.sources||={};m.sources[k]=src;}};
   const refs=[...claim(e,'P178'),...claim(e,'P123'),...claim(e,'P179')].map(v=>v.id).filter(Boolean);
   const labels=refs.length?(await w({action:'wbgetentities',ids:[...new Set(refs)].slice(0,40).join('|'),props:'labels',languages:lang+'|en'})).entities||{}:{};
   const label=id=>labels[id]?.labels?.[lang]?.value||labels[id]?.labels?.en?.value||'';
   fill('developer',claim(e,'P178').map(v=>label(v.id)).filter(Boolean).slice(0,3).join(', '),'Wikidata');
   fill('publisher',claim(e,'P123').map(v=>label(v.id)).filter(Boolean).slice(0,3).join(', '),'Wikidata');
   fill('series',claim(e,'P179').map(v=>label(v.id)).filter(Boolean)[0]||'','Wikidata');
   const dates=claim(e,'P577').filter(v=>v.precision>=11&&/^\+\d{4}-\d{2}-\d{2}/.test(v.time)).map(v=>v.time.slice(1,11)).sort();fill('release',dates[0]||'','Wikidata');
   if(!m.summary&&!game.metadataPinned?.summary){const site=e.sitelinks?.[lang+'wiki']||e.sitelinks?.enwiki,wl=e.sitelinks?.[lang+'wiki']?lang:'en';
    if(site?.title){const r=await this.request('https://'+wl+'.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(site.title.replace(/ /g,'_')),{headers});const text=String(r?.extract||'').trim();if(text){m.summary=text.slice(0,2200);m.summaryLanguage=wl==='pt'?'pt-BR':wl;m.sources||={};m.sources.summary='Wikipedia';}}}
   game.wikidataId=e.id;if(e.sitelinks?.enwiki?.title)game.wikiEnTitle=e.sitelinks.enwiki.title;
   // Wikidata P1733 = AppID da Steam: liga o jogo à Steam pelo ID, sem depender do nome.
   game.wikiSteamAppIds=[...new Set(claim(e,'P1733').map(v=>Number(v)).filter(n=>Number.isInteger(n)&&n>0))];
   return [];
  }catch(err){return [];}
 }
 async refreshMedia(game,source=null){
  if(game.media?.length&&!source)return [];
  const warnings=[];
  try{if(!source&&game.igdbId){const list=await this.ig(`fields screenshots.url,screenshots.width,screenshots.height,artworks.url; where id = ${Number(game.igdbId)}; limit 1;`);source=list[0];}
   const pictures=[...(source?.screenshots||[]),...(source?.artworks||[])].filter(x=>x.url&&(!x.width||!x.height||x.width>x.height)).slice(0,3),media=[];
   for(const picture of pictures){try{const raw=picture.url,url=(raw.startsWith('//')?'https:'+raw:raw).replace('/t_thumb/','/t_screenshot_med/');media.push({image:await this.image(url),source:'IGDB',url:game.metadata?.url||''});}catch(e){warnings.push('Imagem do jogo: '+e.message);}}
   if(media.length)game.media=media;
  }catch(e){warnings.push('Imagens do jogo: '+e.message);}return warnings;
 }
 async translate(text,target='pt-BR',source='en'){return translateText(text,this.dir,url=>this.request(url),target,source);}
 async localize(game){const m=game.metadata||{},target=this.config().language||'pt-BR';if(!m.summary)return [];const actual=detectLanguage(m.summary);if(game.metadataPinned?.summary&&actual!==null&&actual===target)return [];if(actual===target||(actual===null&&m.summaryLanguage===target)){if(m.summaryLanguage!==target)m.summaryLanguage=target;return [];}if(game.metadataPinned?.summary&&actual===null)return [];const original=actual&&actual!==target&&m.summaryOriginal&&detectLanguage(m.summaryOriginal)!==target?m.summaryOriginal:m.summary,source=detectLanguage(original)||m.summaryOriginalLanguage||(m.summaryLanguage&&m.summaryLanguage!==target?m.summaryLanguage:'en');m.summaryOriginal=original;m.summaryOriginalLanguage=source;try{m.summary=await this.translate(original,target,source);m.summaryLanguage=target;m.translationSource=target===source?'Original':'MyMemory';return [];}catch(e){return ['Tradução indisponível. Mostrando o texto original.'];}}

 async refreshPresentation(game){const warnings=[];if(game.sgdbId&&!game.art?.logo&&!game.artPinned?.logo){try{const items=await this.artwork(game,'logo');let saved=false,last='';for(const img of items.slice(0,5)){try{game.art||={};game.art.logo=await this.image(img.url);saved=true;break;}catch(e){last=e.message;}}if(!saved)warnings.push('Logo: '+(last||'nenhuma opção disponível. Escolha uma imagem no editor.'));}catch(e){warnings.push('Logo: '+e.message);}}warnings.push(...await this.localize(game));return warnings;}
 raUserFor(){const c=this.config();try{return this.retro.credentials()?.user||c.raUser||'';}catch{return c.raUser||'';}}
 cachedAchievements(game){const user=this.raUserFor();if(!user||!game.raId)return null;const data=cacheJSON(path.join(this.dir,'cache',digest(user.toLowerCase()+':'+game.raId)+'.json'),null)?.data||null;if(data?.achievements){data.achievements=data.achievements.filter(a=>!isRAWarning(a.id,a.title));data.total=data.achievements.length;data.unlocked=data.achievements.filter(a=>a.unlocked).length;}return data;}
 async achievements(game,{maxAge=60000}={}){
  const c=this.config();if(!game.raId)return {status:'unmapped',achievements:[],total:0,unlocked:0};
  // Sem login no Taiga: usa a conta já conectada no emulador; a Web API Key continua opcional.
  let cred=null;try{cred=this.retro.credentials();}catch{}
  const webApi=!!(c.raKey&&c.raUser);if(!cred&&!webApi)return {status:'unconfigured',achievements:[],total:0,unlocked:0,message:'Entre no RetroAchievements em um emulador (RetroArch, PCSX2, DuckStation, PPSSPP, Dolphin, Flycast) ou nas Configurações para ver seu progresso.'};
  const user=(cred?.user||c.raUser),file=path.join(this.dir,'cache',digest(user.toLowerCase()+':'+game.raId)+'.json');const old=cacheJSON(file,null);
  if(old?.data?.achievements)old.data.achievements=old.data.achievements.filter(a=>!isRAWarning(a.id,a.title));
  if(old&&Date.now()-old.at<maxAge)return old.data;
  try{
   let data;
   if(webApi&&(!cred||cred.source==='webapi'||cred.user.toLowerCase()===c.raUser.toLowerCase())){
    const raw=await this.ra('API_GetGameInfoAndUserProgress.php',{g:game.raId,u:c.raUser});
    const list=Object.values(raw.Achievements||{}).filter(a=>!isRAWarning(a.ID,a.Title)).map(a=>({id:a.ID,title:a.Title,description:a.Description,points:a.Points,icon:`https://media.retroachievements.org/Badge/${a.BadgeName}.png`,lockedIcon:`https://media.retroachievements.org/Badge/${a.BadgeName}_lock.png`,globalPercent:Number(raw.NumDistinctPlayers)>0&&Number.isFinite(Number(a.NumAwarded))?Math.max(0,Math.min(100,Number(a.NumAwarded)/Number(raw.NumDistinctPlayers)*100)):null,unlocked:!!(a.DateEarned||a.DateEarnedHardcore),hardcore:!!a.DateEarnedHardcore,date:a.DateEarned||a.DateEarnedHardcore||null}));
    data={status:'ok',at:new Date().toISOString(),total:list.length,unlocked:list.filter(a=>a.unlocked).length,achievements:list,account:{user:c.raUser,source:'webapi'}};
   }else{
    data=await this.retro.progressByToken(game.raId,cred);data.account={user:cred.user,source:cred.source,emulator:cred.emulator||null};
   }
   save(file,{at:Date.now(),data});return data;
  }catch(e){if(old)return {...old.data,status:'offline',message:'Mostrando último progresso salvo.'};throw e;}
 }
}
