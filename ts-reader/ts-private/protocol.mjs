import {createHash,createPublicKey,verify,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

const key = createPublicKey({format:'jwk', key:{kty:'EC',crv:'P-256',x:'yATVM126sPD7AZ8wbWTXQ5AmRBmCnJ0Sn3Ww7LXFZnM',y:'bzPZjnXueowKD86S8A5G96Hs1o5gMQD6ZnN067qYM8A'}});
export const TTL = 8 * 60 * 1000;
export const FILE_LIMIT = 4 * 1024 * 1024;
export const json = (obj,status=200) => Response.json(obj,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export class Invalid extends Error {
  constructor(status,code) {super(code); this.status=status; this.code=code;}
}
const b64 = (v,n) => typeof v==='string' && /^[\w-]+$/.test(v) && Buffer.from(v,'base64url').byteLength===n && Buffer.from(v,'base64url').toString('base64url')===v;
export async function authenticate(request,path,now=Date.now(),publicKey=key) {
  if (request.method!=='POST' || new URL(request.url).pathname!==path) throw new Invalid(404,'route');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Invalid(415,'type');
  const when=request.headers.get('x-ts-time'),sig=request.headers.get('x-ts-signature');
  if (!when || !/^\d{10}$/.test(when) || Math.abs(Number(when)*1000-now)>80_000 || !b64(sig,64)) throw new Invalid(403,'unauthorized');
  if (Number(request.headers.get('content-length'))>24000) throw new Invalid(413,'size');
  const raw=await request.text();
  if (Buffer.byteLength(raw)>24000) throw new Invalid(413,'size');
  const sha=createHash('sha256').update(raw).digest('hex');
  const message=['ts-v1','POST',path,when,sha].join('\n');
  if (!verify('sha256',Buffer.from(message),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(sig,'base64url'))) throw new Invalid(403,'unauthorized');
  let body;
  try{body=JSON.parse(raw);}catch{throw new Invalid(400,'invalid');}
  if (!body || typeof body!=='object' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.job) || !Number.isSafeInteger(body.issued) || !b64(body.key,32)) throw new Invalid(400,'invalid');
  if (body.issued>now+15_000 || now-body.issued>TTL) throw new Invalid(410,'expired');
  return body;
}
export const storageKey = body => 'ts-native/'+String(body.issued)+'-'+body.job.toLowerCase();
export function encrypt(body,bytes) {
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(body.key,'base64url'),nonce);
  cipher.setAAD(Buffer.from(storageKey(body)));
  const payload=Buffer.concat([cipher.update(bytes),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),payload]);
}
export function decrypt(body,bytes) {
  const packet=Buffer.from(bytes);
  const cipher=createDecipheriv('aes-256-gcm',Buffer.from(body.key,'base64url'),packet.subarray(0,12));
  cipher.setAAD(Buffer.from(storageKey(body)));cipher.setAuthTag(packet.subarray(12,28));
  return Buffer.concat([cipher.update(packet.subarray(28)),cipher.final()]);
}
export function pack(reply) {
  const {status,headers}=reply;
  const meta=Buffer.from(JSON.stringify({status,headers}));
  const prefix=Buffer.alloc(4);prefix.writeUInt32BE(meta.length);
  const buffer=Buffer.from(reply.body);
  return Buffer.concat([prefix,meta,buffer]);
}
export function unpack(data) {
  const n=data.readUInt32BE();
  if(n>4096)throw Error('invalid');
  const {status,headers}=JSON.parse(data.subarray(4,4+n).toString());
  return new Response(data.subarray(4+n),{status,headers:{...headers,'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
export const jsonReply = (status,body)=>({status,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify(body))});
export function shape(result) {
  if(result.kind==='choose')return jsonReply(200,{kind:'choose',options:result.options});
  if(result.kind==='empty')return jsonReply(200,{kind:'empty',call:result.call,boxes:0,teu:0});
  if(result.kind!=='file' || !Buffer.isBuffer(result.bytes) || result.bytes.length<4 || result.bytes.length>FILE_LIMIT)throw new Invalid(422,'invalid_file');
  return {status:200,headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','x-ts-boxes':String(result.boxes),'x-ts-teu':String(result.teu),'x-ts-call':result.call},body:result.bytes};
}
