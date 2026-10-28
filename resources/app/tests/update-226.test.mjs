// 2.2.6: Discord mostra o jogo aberto (Rich Presence pelo canal local do Discord).
import test from 'node:test';import assert from 'node:assert/strict';import net from 'node:net';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {DiscordPresence,buildActivity,encodeFrame,decodeFrames} from '../lib/discord-rpc.mjs';
test('Discord presence: handshake, game shown like a Steam game, cleared when the game closes', async t => {
 // No Windows o Discord escuta num named pipe (\\?\pipe\discord-ipc-N), não num arquivo.
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'taiga-226-'));const sock=process.platform==='win32'?`\\\\?\\pipe\\${path.basename(dir)}-discord-ipc-0`:path.join(dir,'discord-ipc-0');const seen=[];
 const server=net.createServer(c=>{let buf=Buffer.alloc(0);c.on('data',d=>{buf=Buffer.concat([buf,d]);const {frames,rest}=decodeFrames(buf);buf=rest;for(const f of frames){seen.push(f);if(f.op===0)c.write(encodeFrame(1,{cmd:'DISPATCH',evt:'READY',data:{v:1}}));}});});
 await new Promise(r=>server.listen(sock,r));t.after(()=>{server.close();fs.rmSync(dir,{recursive:true,force:true});});
 const p=new DiscordPresence({clientId:'123456789012345678',paths:[path.join(dir,'nao-existe'),sock]});
 const a=buildActivity({title:'God of War® III Remastered',platform:'PlayStation 4 · shadPS4',cover:'https://cdn.example/cover.jpg',startedAt:'2026-10-20T15:00:00Z'});
 assert.equal(a.details,'God of War® III Remastered');assert.equal(a.status_display_type,2);assert.equal(a.assets.large_image,'https://cdn.example/cover.jpg');assert.equal(a.timestamps.start,Date.parse('2026-10-20T15:00:00Z'));
 assert.equal(await p.set(a),undefined);await new Promise(r=>setTimeout(r,100));
 assert.deepEqual(seen[0],{op:0,data:{v:1,client_id:'123456789012345678'}});assert.equal(seen[1].data.cmd,'SET_ACTIVITY');assert.equal(seen[1].data.args.activity.details,'God of War® III Remastered');
 await p.set(a);await new Promise(r=>setTimeout(r,50));assert.equal(seen.length,2,'nada muda, nada é enviado');
 await p.set(null);await new Promise(r=>setTimeout(r,50));assert.equal(seen[2].data.args.activity,null);p.close();
 assert.equal(await new DiscordPresence({clientId:''}).set(a),undefined,'sem ID do aplicativo não faz nada');
});

import {duplicateOf,portTwinOf} from '../lib/reconcile.mjs';
test('PC port and the console dump it uses are one game: the emulator copy is recognised as part of the port', () => {
 const port={id:'p',profile:'pc',path:'D:\\God of war 3\\gow3-windows\\God of War III.exe'};
 const portOf=g=>g===port?{code:'CUSA01623',dump:'D:\\God of war 3\\CUSA01623',platform:'PlayStation 4'}:null;
 const dump={id:'d',profile:'shadps4',path:'D:\\God of war 3\\CUSA01623\\eboot.bin',serial:'CUSA-01623',discId:'CUSA01623'};
 assert.equal(portTwinOf([port],dump,portOf)?.game,port);
 assert.equal(duplicateOf([port],dump,{portOf})?.reason,'port');
 assert.equal(portTwinOf([port],{...dump,path:'E:\\Outro\\eboot.bin'},portOf)?.game,port,'mesmo código do jogo em outra pasta');
 assert.equal(portTwinOf([port],{...dump,path:'E:\\Outro\\eboot.bin',serial:'CUSA99999',discId:'CUSA99999'},portOf),null,'outro jogo');
 assert.equal(portTwinOf([port],{...port,id:'x'},portOf),null,'jogos de PC não entram');
});
