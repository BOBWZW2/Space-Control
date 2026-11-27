import {authenticate,storageKey,encrypt,pack,shape,jsonReply,TTL,Invalid} from '../../ts-private/protocol.mjs';
import {store,collectExpired} from '../../ts-private/storage.mjs';
import {readManifest,probeLanding} from '../../ts-private/reader.mjs';

export default async function run(request) {
  let task;
  try {task=await authenticate(request,'/api/ts-job');}catch{return;}
  const db=store(), id=storageKey(task);
  const claim=await db.set(id,new Uint8Array(0),{onlyIfNew:true});
  if (!claim.modified) return;
  let result;
  try {
    if (task.smoke===true) {
      const checked=await probeLanding(task.cfg);
      if (checked?.browser!==true || checked?.landing!==true) throw new Invalid(502,'landing_unverified');
      result=jsonReply(200,{kind:'ready',browser:true,landing:true});
    } else {
      const jar = task.jar;
      if (!jar || typeof jar!=='object' || Array.isArray(jar) || !Object.keys(jar).length || Object.keys(jar).length>40 || !task.call || !task.cfg) throw new Invalid(400,'invalid_parameters');
      const cookies=Object.entries(jar).map(([name,value])=>{if(!/^[!#$%&'*+.^_A-Za-z0-9|~-]{1,90}$/.test(name) || typeof value!=='string' || /[\r\n;]/.test(value)||value.length>4096) throw new Invalid(400,'invalid_session');return {name,value};});
      const {vvd,port,allegroCall,eta}=task.call;
      const output=await readManifest({vvd,port,expectedCall:allegroCall||eta||'',cookies},task.cfg);
      result=shape(output);
    }
  } catch(error) {
    const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:502;
    const code=status===401?'login_required':status===403?'access_denied':error instanceof Invalid?error.code:(
      typeof error.code==='string'&&/^[A-Za-z][a-zA-Z_0-9-]{0,42}$/.test(error.code)?error.code:'upstream_error'
    );
    result=jsonReply(status,{code});
  }
  if(Date.now()<task.issued+TTL) await db.set(id,encrypt(task,pack(result)));
  else await db.delete(id);
  await collectExpired(db).catch(()=>{});
}
export const config={path:'/api/ts-job',method:'POST',background:true};
