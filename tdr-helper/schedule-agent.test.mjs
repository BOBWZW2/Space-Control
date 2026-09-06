import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';
import {validateTasks,createScheduleAgent,SCHEDULE_ORIGIN} from './schedule-agent.mjs';
const t={id:'11111111-1111-4111-8111-111111111111',enabled:true,lane:'CGX',vessel:'',sheet:'CGX',dates:['2026-08-01','2026-10-31']};
test('reject malformed ranges, duplicate queries and unsafe sheet names',()=>{assert.equal(validateTasks([t])[0].lane,'CGX');for(const patch of [{dates:['2026-02-30','2026-03-01']},{dates:['2026-01-01','2028-01-01']},{lane:'',vessel:''},{sheet:'../bad'},{sheet:"'x"}])assert.throws(()=>validateTasks([{...t,...patch}]));assert.throws(()=>validateTasks([t,t]))});
test('local API enforces exact host, origin and non-simple client header',async()=>{
 const agent=createScheduleAgent({root:'.',resolveBrowserExecutable:async()=>'/test-browser',beforeLogin:async()=>{throw Error('must not run')}});
 async function request(headers,method='GET',body=''){const req=Readable.from(body?[body]:[]);req.method=method;req.headers=headers;const result={};const res={setHeader(){},writeHead(s){result.status=s},end(b){result.body=b?JSON.parse(b):null}};await agent.handle(req,res,new URL('http://127.0.0.1:4318/api/schedule/status'));return result}
 const h={host:'127.0.0.1:4318',origin:SCHEDULE_ORIGIN,'x-allegro-client':'schedule-v1'};
 assert.equal((await request(h)).status,200);assert.equal((await request({...h,origin:'https://evil.example'})).status,403);assert.equal((await request({...h,host:'evil.example:4318'})).status,403);assert.equal((await request({...h,origin:undefined})).status,403);assert.equal((await request({...h,'x-allegro-client':undefined})).status,403);assert.equal((await request(h,'OPTIONS')).status,204);await agent.close();
});
