import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json'};
const server=createServer((req,res)=>{
  const raw=(req.url||'/').split('?')[0],name=raw==='/'?'/index.html':raw;
  try{const body=readFileSync(join(ROOT,decodeURIComponent(name).replace(/^\/+/,'')));res.writeHead(200,{'Content-Type':MIME[extname(name)]||'application/octet-stream'});res.end(body);}
  catch{res.writeHead(404).end('nao encontrado');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/index.html`;
const browser=await chromium.launch();
const page=await browser.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon|Failed to load resource/.test(m.text()))errors.push(m.text());});

try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.RelationalStore&&window.CardStore,{timeout:30000});
  const result=await page.evaluate(async()=>{
    const profile='p-concorrente',plan='pl-concorrente';
    const scope='diario-estudos:u:'+profile+':p:'+plan+':cards';
    const remote={
      profile_id:profile,plan_id:plan,card_id:'c1',deck_id:null,subject:null,topic:null,card_type:null,
      front:'REMOTE',back:'Verso',favorite:true,status:'sei',banca:null,kind:'basic',due:'2026-09-21',
      due_ts:null,ease:2.5,interval_value:10,lapses:1,learn_step:0,reps:10,phase:'review',
      reversed_of:null,d:5,s:12,algo:'fsrs',last_review:'2026-09-11',
      created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-09-21T10:00:00.000Z',position:1,extra:{remoto:'preservar'}
    };
    const reviewRows=[{profile_id:profile,plan_id:plan,position:5,card_id:'anterior'}];

    class Query{
      constructor(table,mode,payload){this.table=table;this.mode=mode;this.payload=payload;this.filters=[];this.orderBy=null;this.limitN=null;this.selectCols='*';}
      select(cols='*'){this.selectCols=cols; if(this.mode==='idle')this.mode='select'; return this;}
      update(row){this.mode='update';this.payload=row;return this;}
      delete(){this.mode='delete';return this;}
      eq(col,val){this.filters.push([col,val]);return this;}
      order(col,opt){this.orderBy={col,asc:!(opt&&opt.ascending===false)};return this;}
      limit(n){this.limitN=n;return this;}
      then(resolve,reject){return Promise.resolve(this.exec()).then(resolve,reject);}
      match(row){return this.filters.every(([k,v])=>String(row[k]??'')===String(v??''));}
      exec(){
        if(this.table==='study_cards'){
          if(this.mode==='select') return {data:this.match(remote)?[{...remote}]:[],error:null};
          if(this.mode==='update'){
            if(!this.match(remote)) return {data:[],error:null};
            Object.assign(remote,this.payload);
            return {data:[{...remote}],error:null};
          }
          throw new Error('modo cards nao suportado: '+this.mode);
        }
        if(this.table==='study_review_log'){
          if(this.mode==='insert'){
            const row={...this.payload};
            if(reviewRows.some(x=>x.profile_id===row.profile_id&&x.plan_id===row.plan_id&&Number(x.position)===Number(row.position))){
              return {data:null,error:{code:'23505',message:'position collision'}};
            }
            reviewRows.push(row);return {data:null,error:null};
          }
          if(this.mode==='select'){
            let data=reviewRows.filter(x=>this.match(x)).map(x=>({position:x.position}));
            if(this.orderBy)data.sort((a,b)=>this.orderBy.asc?Number(a.position)-Number(b.position):Number(b.position)-Number(a.position));
            if(this.limitN!=null)data=data.slice(0,this.limitN);
            return {data,error:null};
          }
          throw new Error('modo revlog nao suportado: '+this.mode);
        }
        throw new Error('tabela nao suportada: '+this.table);
      }
    }

    const fake={
      from(table){
        return {
          select(cols='*'){const q=new Query(table,'select');q.selectCols=cols;return q;},
          update(row){return new Query(table,'update',row);},
          insert(row){return new Query(table,'insert',row);},
          delete(){return new Query(table,'delete');}
        };
      }
    };
    const keep={client:CloudStore.client,logged:CloudStore.isLoggedIn,enabled:RelationalStore.enabled,tail:RelationalStore._tail,lastError:RelationalStore._lastError};
    CloudStore.client=fake;CloudStore.isLoggedIn=()=>true;RelationalStore.enabled=true;RelationalStore._tail=Promise.resolve();RelationalStore._lastError=null;

    try{
      const mutation={
        id:'c1',action:'upsert',position:0,
        base:{id:'c1',frente:'LOCAL-ANTIGO',favorito:false,reps:10,updatedAt:'2026-09-21T09:00:00.000Z'},
        card:{id:'c1',frente:'LOCAL-ANTIGO',favorito:false,reps:11,updatedAt:'2026-09-21T09:30:00.000Z'},
        ops:[{id:'op-1',patch:{reps:11},context:{kind:'edit'},updatedAt:'2026-09-21T09:30:00.000Z'}]
      };
      const ack=await RelationalStore._applyCardMutation(scope,mutation);
      const revAck=await RelationalStore.queueRevlogAppend(
        'diario-estudos:u:'+profile+':p:'+plan+':revlog',
        {_position:5,ts:123,cardId:'c1',grade:3,date:'2026-09-21'}
      );
      return {
        card:{front:remote.front,favorite:remote.favorite,reps:remote.reps,extra:remote.extra,updated_at:remote.updated_at},
        ack:ack&&ack.card,
        revPosition:revAck&&revAck.position,
        positions:reviewRows.map(x=>x.position).sort((a,b)=>a-b)
      };
    }finally{
      CloudStore.client=keep.client;CloudStore.isLoggedIn=keep.logged;RelationalStore.enabled=keep.enabled;
      RelationalStore._tail=keep.tail;RelationalStore._lastError=keep.lastError;
    }
  });

  assert.equal(result.card.front,'REMOTE','CAS deve preservar a edicao remota que nao faz parte do patch local');
  assert.equal(result.card.favorite,true,'CAS deve preservar campos alterados pelo outro aparelho');
  assert.equal(result.card.reps,11,'patch local deve ser reaplicado sobre o remoto mais novo');
  assert.equal(result.ack.frente,'REMOTE','ACK deve devolver o estado efetivamente confirmado');
  assert.equal(result.revPosition,6,'colisao de position do revlog deve reservar a proxima posicao');
  assert.deepEqual(result.positions,[5,6],'historico concorrente nao pode sobrescrever linha existente');
  assert.equal(errors.length,0,'sem erros no navegador: '+errors.join(' | '));

  console.log('CARDS CONCORRENCIA OK — CAS preserva remoto e revlog resolve colisao.');
}finally{
  await browser.close();
  await new Promise(r=>server.close(r));
}
