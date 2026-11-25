import {getDeployStore} from '@netlify/blobs';
import {TTL} from './protocol.mjs';
export function store() { return getDeployStore({consistency:'strong'}); }
export async function collectExpired(blobs,now=Date.now()) {
  const {blobs:list}=await blobs.list({prefix:'ts-native/'});
  const old=list.filter(x=>/^ts-native\/\d{13}-[a-f0-9-]+$/.test(x.key) && Number(x.key.slice(10,23))+TTL<now).slice(0,24);
  await Promise.all(old.map(x=>blobs.delete(x.key)));
}
