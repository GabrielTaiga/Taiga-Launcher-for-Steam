// Página do jogo dentro da Steam (pacote NativeGameLink adaptado): todo texto visível precisa sair no idioma do
// TaigaSteam. O teste roda o código compilado de verdade (steam/ngl.bundle.js) num ambiente simulado e confere
// todas as chaves usadas no código-fonte em português, inglês, espanhol, francês e alemão.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {fileURLToPath} from 'node:url';

const BUNDLE=new URL('../steam/ngl.bundle.js',import.meta.url);
const SOURCE=new URL('../../../third_party/nativegamelink/frontend/',import.meta.url),SOURCE_DIR=fileURLToPath(SOURCE);
const LANGS={'pt-BR':'brazilian',en:'english',es:'latam',fr:'french',de:'german'};

function react(){const n=()=>null,r={createElement:n,Fragment:'f',StrictMode:'s',Suspense:'su',Children:{map:()=>[],forEach(){},toArray:()=>[],count:()=>0,only:x=>x},cloneElement:x=>x,isValidElement:()=>false,createRef:()=>({current:null}),createContext:v=>({Provider:'p',Consumer:'c',_currentValue:v}),useContext:c=>c?._currentValue,useState:v=>[typeof v==='function'?v():v,n],useReducer:(f,v)=>[v,n],useEffect:n,useLayoutEffect:n,useInsertionEffect:n,useMemo:f=>f(),useRef:v=>({current:v}),useCallback:f=>f,useId:()=>'id',useTransition:()=>[false,f=>f()],useDeferredValue:v=>v,useImperativeHandle:n,useDebugValue:n,useSyncExternalStore:(s,g)=>g(),startTransition:f=>f(),memo:x=>x,forwardRef:x=>x,lazy:x=>x,Component:class{},PureComponent:class{}};r.default=r;return r;}
function loadBundle(){
 const store=new Map();
 const ctx={console:{log(){},warn(){},error(){},info(){},debug(){}},setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,URL,URLSearchParams,TextEncoder,TextDecoder,Intl,Date,Math,JSON,Promise,Map,Set,WeakMap,WeakSet,Symbol,Array,Object,String,Number,Boolean,RegExp,Error,
  navigator:{language:'en-US'},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
  document:{documentElement:{lang:''},querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},createElement:()=>({style:{},setAttribute(){},appendChild(){}}),head:{appendChild(){}},body:{appendChild(){}}},
  SP_REACT:react(),SP_REACTDOM:{createPortal:()=>null,render(){},createRoot:()=>({render(){},unmount(){}})},
  __TAIGA_MILLENNIUM_API__:{callable:()=>async()=>null,Millennium:{},IconsModule:{},definePlugin:x=>x,findClassModule:()=>null,findModuleExport:()=>null,findSP:()=>null,modules:new Map(),GamepadButton:{}}};
 ctx.window=ctx;ctx.self=ctx;ctx.globalThis=ctx;ctx.addEventListener=()=>{};ctx.removeEventListener=()=>{};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(BUNDLE,'utf8'),ctx);
 return {ctx,i18n:ctx.__TAIGA_NGL_MODULE__.__taigaI18n};
}
// Todas as chamadas gdlText(chave, padrão) e loc(token, padrão) do código-fonte.
function sourceCalls(){
 const files=[];const walk=d=>{for(const f of fs.readdirSync(d)){const p=path.join(d,f);if(fs.statSync(p).isDirectory())walk(p);else if(/\.tsx?$/.test(f))files.push(p);}};walk(SOURCE_DIR);
 const lit=String.raw`(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|\x60((?:[^\x60\\]|\\.)*)\x60)`;
 const re=new RegExp(String.raw`\b(gdlText|loc)\(\s*`+lit+String.raw`(?:\s*,\s*`+lit+')?','g');
 const gdl={},loc={};
 // Tokens da Steam passados de forma indireta (listas ['Token', 'Texto'] ou funções auxiliares).
 const pair=/["'\x60]((?:AppDetails|Achievements|AppActivity|AppBox|Played|EventDisplay|GameAction|Button|AppControllerConfiguration|ScreenshotManager)_\w+)["'\x60]\s*,\s*(["'\x60])((?:(?!\2)[^\\]|\\.)+)\2/g;
 for(const f of files){if(/(^|[\\/])(localization|token-fallbacks|taiga-[\w-]+|token-specs|translations-\w+|custom-translations)\.ts$/.test(f))continue;const s=fs.readFileSync(f,'utf8'),rel=path.relative(SOURCE_DIR,f);for(const m of s.matchAll(re)){const key=m[2]??m[3]??m[4],fallback=m[5]??m[6]??m[7];if(key.includes('${'))continue;((m[1]==='gdlText'?gdl:loc)[key]||=[]).push({fallback,file:rel});}
  for(const m of s.matchAll(pair))(loc[m[1]]||=[]).push({fallback:m[3],file:rel});}
 return {gdl,loc,files};
}
const placeholders=text=>[...String(text||'').matchAll(/\{(\w+)\}/g)].map(m=>m[1]);
const valuesFor=(...texts)=>Object.fromEntries(texts.flatMap(placeholders).map(n=>[n,'7']));
const fill=(text,values)=>String(text).replace(/\{(\w+)\}/g,(w,n)=>values[n]??w).replace(/NativeGameLink(?: for Steam)?|Native ?Game ?Link/g,'Taiga Launcher');
const looksSpanish=text=>/ción|ñ|Compatibilidad|logros?\b|juego|jugador|tienda|Ver /i.test(String(text||''));
// Tokens usados só para reconhecer rótulos da própria Steam (não aparecem como texto do TaigaSteam).
const DETECTION_FILES=/(^|[\\/])(properties|tabs|native-add-guard|sidebar-order|NativeStuffComponents)\.ts$/;
const NEUTRAL_TOKENS=new Set(['AppProperties_SteamCloudSection']);

test('Steam page (NGL): every text key used in the code has a translation in all 5 languages',t=>{
 if(!fs.existsSync(SOURCE)){t.skip('código-fonte do NGL ausente');return;}
 const {gdl,loc}=sourceCalls(),{i18n}=loadBundle(),T=i18n.tables;
 const missing=[];
 for(const [key,calls] of Object.entries(gdl)){
  for(const [lang,steam] of Object.entries(LANGS)){
   if(lang==='en'){const fb=calls.map(c=>c.fallback).find(f=>f!==undefined);if((fb===undefined||(looksSpanish(fb)&&fb===T.spanish[key]))&&!T.taiga.english[key])missing.push('en: '+key);continue;}
   const has=T.taiga[steam]?.[key]||(steam==='latam'?T.spanish[key]:T.other[steam]?.[key]);if(!has)missing.push(lang+': '+key);
  }
 }
 for(const [token,calls] of Object.entries(loc)){
  if(NEUTRAL_TOKENS.has(token)||calls.every(c=>!c.fallback||DETECTION_FILES.test(c.file)))continue;
  for(const [lang,steam] of Object.entries(LANGS)){
   const has=T.tokens[steam]?.[token]||(steam==='latam'?T.spanishTokens[token]:'');
   if(!has&&(lang!=='en'||calls.some(c=>looksSpanish(c.fallback))))missing.push(lang+' (Steam): '+token);
  }
 }
 assert.deepEqual(missing,[],'Textos sem tradução na página da Steam');
});

test('Steam page (NGL): with no Steam texts available, each language comes from its own table (never the English default)',t=>{
 if(!fs.existsSync(SOURCE)){t.skip('código-fonte do NGL ausente');return;}
 const {gdl}=sourceCalls(),{ctx,i18n}=loadBundle(),T=i18n.tables,wrong=[];
 for(const [lang,steam] of Object.entries(LANGS)){
  ctx.__TAIGA_CATALOG__={language:lang};assert.equal(i18n.displayLanguage(),steam);
  for(const [key,calls] of Object.entries(gdl)){
   const fallback=calls.map(c=>c.fallback).find(f=>f!==undefined)||'';
   const table=T.taiga[steam]?.[key]||(steam==='latam'?T.spanish[key]:T.other[steam]?.[key])||(lang==='en'?fallback||T.taiga.english[key]:'');
   const values=valuesFor(fallback,table),out=i18n.gdlText(key,fallback,values);
   if(out!==fill(table,values)||!out||/undefined|NativeGameLink/.test(out))wrong.push(`${lang} ${key}: ${JSON.stringify(out)}`);
  }
 }
 assert.deepEqual(wrong.slice(0,20),[]);
});

test('Steam page (NGL): Steam in another language or Steam English fallbacks never leak; Steam labels used for detection stay as Steam shows them',()=>{
 const {ctx,i18n}=loadBundle();
 // Steam em inglês, TaigaSteam em português: tudo em português.
 ctx.LocalizationManager={m_strELanguage:'english',m_mapTokens:new Map([['AppDetails_SectionTitle_Achievements','Achievements'],['AppDetails_Tab_Activity','Activity']]),m_mapFallbackTokens:new Map()};
 ctx.__TAIGA_CATALOG__={language:'pt-BR'};
 assert.equal(i18n.loc('AppDetails_SectionTitle_Achievements','Achievements'),'Conquistas');
 assert.equal(i18n.gdlText('feed_game_launch','Release'),'Lançamento');
 assert.equal(i18n.loc('AppDetails_Tab_Activity',''),'Activity','rótulo usado para reconhecer a aba da Steam continua o da Steam');
 // Steam em português sem o texto no idioma atual: o "fallback" em inglês da própria Steam não aparece.
 ctx.LocalizationManager={m_strELanguage:'brazilian',m_mapTokens:new Map(),m_mapFallbackTokens:new Map([['Achievements_LockedList_Title','Locked achievements'],['AppDetails_PctUnlocked','%1$s% of players have this achievement']])};
 assert.equal(i18n.loc('Achievements_LockedList_Title','Locked achievements'),'Conquistas bloqueadas');
 assert.equal(i18n.loc('AppDetails_PctUnlocked','%1$s% of players have this achievement'),'%1$s% dos jogadores têm esta conquista');
 // Mesmo idioma e a Steam tem o texto: o texto oficial da Steam é usado.
 ctx.LocalizationManager={m_strELanguage:'brazilian',m_mapTokens:new Map([['AppDetails_SectionTitle_Achievements','Conquistas da Steam']]),m_mapFallbackTokens:new Map()};
 assert.equal(i18n.loc('AppDetails_SectionTitle_Achievements','Achievements'),'Conquistas da Steam');
 for(const [lang,word] of [['en','Release'],['es','Lanzamiento'],['fr','Sortie'],['de','Veröffentlichung']]){ctx.__TAIGA_CATALOG__={language:lang};ctx.LocalizationManager=undefined;assert.equal(i18n.gdlText('feed_game_launch','Release'),word);}
 // Números no formato do idioma: 76,2% em português e alemão, 76.2% em inglês.
 for(const [lang,n] of [['pt-BR','76,2'],['de','76,2'],['en','76.2']]){ctx.__TAIGA_CATALOG__={language:lang};assert.equal(i18n.localNumber(76.24),n);}
});

test('Steam page (NGL): no "Game Launch", emulator games are not "released on Steam", no NGL panels inside Steam Properties',t=>{
 if(!fs.existsSync(SOURCE)){t.skip('código-fonte do NGL ausente');return;}
 const news=fs.readFileSync(new URL('features/library/news.ts',SOURCE),'utf8'),app=fs.readFileSync(new URL('runtime/app.tsx',SOURCE),'utf8'),specs=fs.readFileSync(new URL('steam/token-specs.ts',SOURCE),'utf8');
 assert.doesNotMatch(news,/Game Launch|EventDisplay_EventType_10/);assert.doesNotMatch(specs,/EventDisplay_EventType_10/);
 assert.match(news,/isTaigaVirtualAppId\(steamAppId\) \? gdlText\('feed_release_title_taiga'/);
 assert.match(app,/__TAIGA_NGL_HOST__[^\n]*\) return;\r?\n\t\ttryInjectPropertiesField/);
 const bundle=fs.readFileSync(BUNDLE,'utf8');assert.ok(!bundle.includes('"Game Launch"')&&!bundle.includes("'Game Launch'"),'pacote recompilado');
});
