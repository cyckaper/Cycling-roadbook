// Node test harness: mock Netlify.env + fetch, invoke each function handler
const ENV = {};
globalThis.Netlify = { env: { get: k => ENV[k] } };
let fetchLog = [];
const J = (o,ok=true,status=200)=>Promise.resolve({ok,status,json:async()=>o,text:async()=>JSON.stringify(o)});

async function run(mod, req){ const m=await import(mod); const res=await m.default(req); return {status:res.status, body:await res.json()}; }
const post=(url,body)=>new Request(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});

// ---- extract ----
globalThis.fetch = async (u,o)=>{ fetchLog.push(u);
  return J({content:[{type:"text",text:"```json\n{\"waypoints\":[{\"name\":\"花蓮車站\",\"region\":\"花蓮市\"},{\"name\":\"佳興小吃店\",\"region\":\"新城鄉\"},{\"name\":\"天祥\",\"region\":\"秀林鄉\"}]}\n```"}]});
};
let r = await run("./netlify/functions/extract.mts", post("http://x/api/extract",{text:"…遊記…"}));
console.log("extract(no key):", r.status, r.body.error);
ENV.ANTHROPIC_API_KEY="sk-test";
r = await run("./netlify/functions/extract.mts?1", post("http://x/api/extract",{text:"花蓮出發經佳興小吃店到天祥,武嶺見!"})).catch(e=>({status:"ERR",body:{error:String(e)}}));
console.log("extract(ok):", r.status, JSON.stringify(r.body.waypoints));

// bad model output path
globalThis.fetch = async ()=> J({content:[{type:"text",text:"抱歉我無法…"}]});
r = await run("./netlify/functions/extract.mts?2", post("http://x/api/extract",{text:"abc"}));
console.log("extract(bad JSON):", r.status, r.body.error);

// ---- geocode: google path ----
ENV.GOOGLE_MAPS_API_KEY="g-test";
globalThis.fetch = async (u)=>{ fetchLog.push(u);
  if(String(u).includes("places.googleapis")) return J({places:[{displayName:{text:"佳興冰果室"},formattedAddress:"花蓮縣新城鄉…",location:{latitude:24.128,longitude:121.653}}]});
  return J({},false,500); };
r = await run("./netlify/functions/geocode.mts", new Request("http://x/api/geocode?q=佳興小吃店&region=新城鄉&near=24.03,121.62"));
console.log("geocode(google):", r.status, r.body.source, r.body.results[0]);

// geocode: fallback to nominatim when no google key
delete ENV.GOOGLE_MAPS_API_KEY;
globalThis.fetch = async (u)=>{ if(String(u).includes("nominatim")) return J([{display_name:"新城老街, 新城鄉, 花蓮縣",lat:"24.128",lon:"121.641"}]); return J({},false,500); };
r = await run("./netlify/functions/geocode.mts?1", new Request("http://x/api/geocode?q=新城老街"));
console.log("geocode(osm fallback):", r.status, r.body.source, r.body.results[0].name, r.body.results[0].lat);

// ---- route ----
r = await run("./netlify/functions/route.mts", post("http://x/api/route",{coordinates:[[121.6,24.0],[121.62,24.16]]}));
console.log("route(no key):", r.status, r.body.error);
ENV.ORS_API_KEY="ors-test";
globalThis.fetch = async (u,o)=>{ fetchLog.push(u);
  const body=JSON.parse(o.body); if(!body.elevation) throw new Error("elevation flag missing");
  // synthetic 7km climb 450m: 30 points
  const geom=[]; for(let i=0;i<30;i++){ geom.push([121.90+0.0022*i, 25.02-0.0006*i, 25+i*(450/29)]); }
  return J({features:[{properties:{ascent:450,descent:20,summary:{distance:7000,duration:2100},
    segments:[{distance:7000,duration:2100,steps:[{instruction:"向右转进入 台9线",distance:1200,name:"台9线"},{instruction:"继续直行",distance:5800,name:"草岭古道口"}]}]},
    geometry:{coordinates:geom}}]});
};
r = await run("./netlify/functions/route.mts?1", post("http://x/api/route",{coordinates:[[121.90,25.02],[121.94,25.00]]}));
console.log("route(ok): dist",r.body.distance,"ascent",r.body.ascent,"geomN",r.body.geometry.length,"steps",r.body.steps.length);

// ---- matrix ----
globalThis.fetch = async (u,o)=>{ const b=JSON.parse(o.body);
  if(b.sources.length!==2||b.destinations.length!==3) throw new Error("matrix idx wrong");
  return J({distances:[[5200,9100,null],[3300,2100,8800]]}); };
r = await run("./netlify/functions/matrix.mts", post("http://x/api/matrix",{sources:[[121.9,25.0],[121.94,25.01]],destinations:[[121.91,25.02],[121.94,25.015],[121.8,24.9]]}));
console.log("matrix(ok):", JSON.stringify(r.body.distances));

// ---- tdx ----
r = await run("./netlify/functions/tdx-stations.mts", new Request("http://x/api/stations"));
console.log("tdx(no creds):", r.status, r.body.stations.length, r.body.note);
ENV.TDX_CLIENT_ID="id"; ENV.TDX_CLIENT_SECRET="sec";
globalThis.fetch = async (u)=>{ const s=String(u);
  if(s.includes("token")) return J({access_token:"tok",expires_in:1800});
  if(s.includes("Station")) return J({Stations:[{StationName:{Zh_tw:"知本"},StationPosition:{PositionLat:22.71,PositionLon:121.06}},{StationName:{Zh_tw:"太麻里"},StationPosition:{PositionLat:22.61,PositionLon:121.0}}]});
  return J({},false,500); };
r = await run("./netlify/functions/tdx-stations.mts?1", new Request("http://x/api/stations"));
console.log("tdx(ok):", r.body.stations);

// ---- route v2.7: 吸附半徑與結構化錯誤 ----
{
  let calls=[];
  const ok7k = ()=>{ const geom=[]; for(let i=0;i<10;i++) geom.push([121.55+0.001*i,25.08,10]);
    return J({features:[{properties:{ascent:5,descent:5,summary:{distance:1500},segments:[{distance:1500,steps:[]}]},geometry:{coordinates:geom}}]}); };
  // 情境一：預設模式回 2010（路點離可騎道路太遠）→ 換一般自行車模式成功
  globalThis.fetch = async (u,o)=>{ const b=JSON.parse(o.body); calls.push({u:String(u), rad:b.radiuses});
    if(calls.length===1) return {ok:false,status:404,json:async()=>({}),text:async()=>JSON.stringify({error:{code:2010,message:"Could not find routable point within a radius of 350.0 meters of specified coordinate 1"}})};
    return ok7k(); };
  r = await run("./netlify/functions/route.mts?v27a", post("http://x/api/route",{coordinates:[[121.55,25.08],[121.52,25.06]]}));
  const okA = r.status===200 && calls.length===2 && calls[0].rad.every(x=>x===-1) && calls[1].u.includes("cycling-regular");
  console.log("route(2010→regular):", okA ? "PASS" : "FAIL", r.status, calls.map(c=>c.u.split("/")[5]+":"+JSON.stringify(c.rad)).join(" | "));

  // 情境二：配額用盡 429 → 立即停止，不再浪費兩次呼叫，回傳結構化原因
  calls=[];
  globalThis.fetch = async (u,o)=>{ calls.push(String(u)); return {ok:false,status:429,json:async()=>({}),text:async()=>JSON.stringify({error:"Rate Limit Exceeded"})}; };
  r = await run("./netlify/functions/route.mts?v27b", post("http://x/api/route",{coordinates:[[121.55,25.08],[121.52,25.06]]}));
  const okB = r.status===502 && calls.length===1 && r.body.error==="ORS 429" && /Rate Limit/.test(r.body.message);
  console.log("route(429 stop):", okB ? "PASS" : "FAIL", JSON.stringify(r.body));

  // 情境三：三次全敗 → 最後一次為 2 km 吸附，錯誤碼帶回前端
  calls=[];
  globalThis.fetch = async (u,o)=>{ const b=JSON.parse(o.body); calls.push(b.radiuses);
    return {ok:false,status:404,json:async()=>({}),text:async()=>JSON.stringify({error:{code:2009,message:"Route could not be found"}})}; };
  r = await run("./netlify/functions/route.mts?v27c", post("http://x/api/route",{coordinates:[[121.55,25.08],[121.52,25.06]]}));
  const okC = r.status===502 && calls.length===3 && calls[2].every(x=>x===2000) && r.body.code===2009;
  console.log("route(all fail):", okC ? "PASS" : "FAIL", JSON.stringify(r.body));
  if(!(okA&&okB&&okC)) process.exitCode=1;
}
