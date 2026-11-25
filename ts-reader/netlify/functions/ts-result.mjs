import {authenticate,storageKey,decrypt,unpack,json,Invalid} from '../../ts-private/protocol.mjs';
import {store,collectExpired} from '../../ts-private/storage.mjs';
export default async function result(request,context) {
  if (request.method==='GET')return json({ready:true,version:1});
  try {
    const task=await authenticate(request,'/api/ts-result'), id=storageKey(task), db=store();
    const raw=await db.get(id,{type:'arrayBuffer',consistency:'strong'});
    if(!raw || !raw.byteLength) return json({status:'pending'},202);
    let bytes;
    try {bytes=decrypt(task,raw);}catch{throw new Invalid(403,'unauthorized');}
    if (task.ack===true) {
      await db.delete(id);context.waitUntil?.(collectExpired(db).catch(()=>{}));
      return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
    }
    return unpack(bytes);
  }catch(e){return json({code:e instanceof Invalid?e.code:'job_store_unavailable'},e instanceof Invalid?e.status:503);}
}
export const config={path:'/api/ts-result',method:['GET','POST']};
