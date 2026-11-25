import {authenticate,encrypt,json,Invalid} from '../../ts-private/protocol.mjs';
import {portalLogin} from '../../ts-private/login.mjs';

export default async function login(request) {
  try {
    const payload=await authenticate(request,'/api/ts-login');
    const jar=await portalLogin(payload);
    return json({packet:encrypt(payload,Buffer.from(JSON.stringify(jar))).toString('base64url')});
  } catch(e){return json({code:e instanceof Invalid?e.code:'allegro_unavailable'},e instanceof Invalid?e.status:502);}
}
export const config={path:'/api/ts-login',method:['POST']};
