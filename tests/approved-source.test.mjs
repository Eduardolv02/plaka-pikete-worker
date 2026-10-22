import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedSource,ingestApprovedSource} from '../src/approved-source.mjs';
import {Readable} from 'node:stream';
const PID='f1234567-1234-4234-a234-123456789abc';
const IID='a1234567-1234-4234-a234-123456789abc';
const UID='12345678-1234-4234-a234-123456789abc';
const env={PIKETE_APPROVED_INGEST_ENABLED:'true',PIKETE_APPROVED_AUDIO_HOSTS:'media.plaka.example',
 PIKETE_ARCHIVE_UPLOADS_ENABLED:'true',PIKETE_TG_BOT_1_TOKEN:'123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefg123456789',
 PIKETE_TG_BOT_1_CHAT_ID:'-1001234567890',PIKETE_SUPABASE_B_URL:'https://cpdklixfmiibrcptleir.supabase.co',
 PIKETE_SUPABASE_B_SECRET_KEY:'sb_secret_'+'a'.repeat(32),PIKETE_SUPABASE_C_URL:'https://wxleseokrzltkuyjmjev.supabase.co',
 PIKETE_SUPABASE_C_SECRET_KEY:'sb_secret_'+'b'.repeat(32)};
const input={node:'B',playlist_id:PID,item_id:IID,owner_id:UID,audio_url:'https://media.plaka.example/authorized/file.mp3',mime:'audio/mpeg',owner_confirmed_rights:true,provider_download_authorized:true};
const j=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
test('exact approved hosts only; rejects redirects and YouTube origins',()=>{
 assert.equal(allowedSource(input.audio_url,env),input.audio_url);
 for(const url of ['http://media.plaka.example/f.mp3','https://media.plaka.example.evil.test/f',
 'https://api.youtube.com/f','https://media.plaka.example:8443/f','https://media.plaka.example@evil.com/f',
 'https://localhost/f','file:///etc/passwd'])assert.equal(allowedSource(url,env),null,url);
});
test('rejects missing rights and unapproved sources before any network',async()=>{
 for(const change of [{owner_confirmed_rights:false},{provider_download_authorized:false},{audio_url:'https://evil.test/f.mp3'}])
 await assert.rejects(ingestApprovedSource({...input,...change},{env,sourceFetch:()=>{throw Error('network forbidden')}}));
});
test('source requires correct content-type, fixed size and no redirect',async()=>{
 for(const response of [new Response('redirect',{status:302,headers:{location:'https://media.plaka.example/x'}}),
  new Response('bad',{status:200,headers:{'content-type':'text/html','content-length':'3'}})])
 await assert.rejects(ingestApprovedSource(input,{env,sourceFetch:async()=>response}));
});
test('authorized source goes through existing SHA/Telegram/attachment pipeline',async()=>{
 const data=Buffer.alloc(2048);data.set([73,68,51]);const operations=[];
 const result=await ingestApprovedSource(input,{env,sourceFetch:async()=>new Response(data,{headers:{'content-type':'audio/mpeg','content-length':String(data.length)}}),fetchImpl:async (url,init)=>{
   const u=new URL(url);const table=u.pathname.split('/').pop();
   if(u.hostname==='api.telegram.org'){operations.push('uploaded');return j({ok:true,result:{audio:{file_id:'file_id_0123456789abcdefghijklmnop',file_unique_id:'unique'}}});}
   if(table==='pikete_playlists')return j([{id:PID}]);
   if(table==='pikete_playlist_items')return j([{id:IID,source_type:'local',title:'Tema',artist:'Artista',normalization_status:'normalized',metadata_confirmed_at:'2026-10-21T12:00:00Z',rights_status:'unknown'}]);
   if(table==='pikete_audio_archive'){
     if(init.method==='GET')return j([]);
     operations.push('indexed');return j([JSON.parse(init.body)]);
   }
   if(table==='pikete_attach_verified_audio'){operations.push('attached');return j({ok:true});}
   throw Error('unexpected '+url);
 }});
 assert.equal(result.ok,true);assert.deepEqual(operations,['uploaded','indexed','attached']);
});
