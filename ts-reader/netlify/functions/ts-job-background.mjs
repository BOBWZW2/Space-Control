import {authenticate,storageKey,encrypt,pack,shape,jsonReply,TTL,Invalid} from '../../ts-private/protocol.mjs';
import {store,collectExpired} from '../../ts-private/storage.mjs';
import {readManifest,probeLanding} from '../../ts-private/reader.mjs';

import {queryFailure,queryStage,progressReporter} from '../../ts-private/query-receipt.mjs';

export default async function run(request) {
  let task;
  try {task=await authenticate(request,'/api/ts-job');}catch{return;}
  queryStage('claim');
  const db=store(), id=storageKey(task);
  const claim=await db.set(id,new Uint8Array(0),{onlyIfNew:true});
  if (!claim.modified) return;
  const progress=progressReporter(async stage=>{
    if (Date.now() < task.issued+TTL) {
      await db.set(id, encrypt(task,pack(jsonReply(202,{status:'pending',stage}))));
    }
  });
  let result;
  try {
    if (task.smoke===true) {
      queryStage('smoke');
      const checked=await probeLanding(task.cfg);
      if (checked?.browser!==true || checked?.landing!==true) throw new Invalid(502,'landing_unverified');
      result=jsonReply(200,{kind:'ready',browser:true,landing:true});
    } else {
      const jar = task.jar;
      if (!jar || typeof jar!=='object' || Array.isArray(jar) || !Object.keys(jar).length || Object.keys(jar).length>40 || !task.call || !task.cfg) throw new Invalid(400,'invalid_parameters');
      const cookies=Object.entries(jar).map(([name,value])=>{if(!/^[!#$%&'*+.^_A-Za-z0-9|~-]{1,90}$/.test(name) || typeof value!=='string' || /[\r\n;]/.test(value)||value.length>4096) throw new Invalid(400,'invalid_session');return {name,value};});
      const {vvd,port,allegroCall,eta,allowSole,allowNearest}=task.call;
      const output=await readManifest({vvd,port,expectedCall:allegroCall||eta||'',allowSole:allowSole===true,allowNearest:allowNearest===true,cookies},task.cfg,progress.stage);
      result=shape(output);
    }
  } catch(error) {
    const failure=queryFailure(error?.code);
    console.info('ts-query outcome',failure.code);
    result=jsonReply(failure.status,{code:failure.code});
  }
  queryStage('store');
  await progress.finish();
  if(Date.now()<task.issued+TTL) await db.set(id,encrypt(task,pack(result)));
  else await db.delete(id);
  queryStage('ready');
  await collectExpired(db).catch(()=>{});
}
export const config={path:'/api/ts-job',method:'POST',background:true};
