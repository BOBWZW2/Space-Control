import {authenticate,storageKey,decrypt,unpack,json,Invalid} from '../../ts-private/protocol.mjs';
import {store,collectExpired} from '../../ts-private/storage.mjs';
import {queryFailure} from '../../ts-private/query-receipt.mjs';

export default async function result(request,context) {
  if (request.method==='GET')return json({ready:true,version:1});
  let task;
  try {task=await authenticate(request,'/api/ts-result');}
  catch(e){return json({code:e instanceof Invalid?e.code:'unauthorized'},e instanceof Invalid?e.status:403);}
  try {
    const id=storageKey(task), db=store();
    const raw=await db.get(id,{type:'arrayBuffer',consistency:'strong'});
    if(!raw || !raw.byteLength) return json({status:'pending'},202);
    let bytes;
    try {bytes=decrypt(task,raw);}catch{throw new Invalid(403,'unauthorized');}
    if (task.ack===true) {
      await db.delete(id);context.waitUntil?.(collectExpired(db).catch(()=>{}));
      return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
    }
    const reply=unpack(bytes);
    if(reply.ok)return reply;
    const stored=await reply.json().catch(()=>null);
    return json(queryFailure(stored?.code));
  }catch(e){
    if(e instanceof Invalid)return json({code:e.code},e.status);
    return json(queryFailure('job_store_unavailable'));
  }
}
export const config={path:'/api/ts-result',method:['GET','POST']};
