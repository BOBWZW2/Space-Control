import {authenticate,encrypt,json,Invalid} from '../../ts-private/protocol.mjs';
import {portalLogin} from '../../ts-private/login.mjs';

const knownStatus = {
  invalid:400, invalid_probe:400, invalid_credentials:401, access_denied:403,
  probe_session_check:502, login_form_http:502, login_form_transport:502,
  unexpected_login_page:502, login_submit_http:502, login_submit_transport:502,
  unexpected_signon_response:502, login_check_http:502, login_check_transport:502,
  unexpected_session_response:502, invalid_session:502, allegro_unavailable:502
};
const knownStages = new Set(['start','page','form','submit','session','receipt']);
function record(stage) {
  // Only fixed field values reach logs. Never pass the request, payload, jar or upstream error.
  if(knownStages.has(stage)) console.info('ts-login', stage);
}
export default async function login(request) {
  let payload;
  try {payload=await authenticate(request,'/api/ts-login');}
  catch(error) {
    return json({code:error instanceof Invalid?error.code:'unauthorized'},error instanceof Invalid?error.status:403);
  }
  record('start');
  let value;
  try {value=await portalLogin(payload,record);}
  catch(error) {
    const code=error && Object.hasOwn(knownStatus,error.code) ? error.code : 'allegro_unavailable';
    const status=knownStatus[code];
    console.info('ts-login outcome',code,status);
    value={kind:'login-error',code,status};
  }
  const packet=encrypt(payload,Buffer.from(JSON.stringify(value))).toString('base64url');
  record('receipt');
  // The prior non-2xx provider error path is handled by older clients as well. Signed errors
  // now travel as an authenticated application result like all other login outcomes.
  return json({packet});
}
export const config={path:'/api/ts-login',method:['POST']};
