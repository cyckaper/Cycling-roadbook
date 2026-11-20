// 真實路網導航：OpenRouteService 自行車路徑（含沿線海拔與逐步轉向指示）
// 需要環境變數 ORS_API_KEY（免費申請：https://openrouteservice.org/dev/#/signup）
//
// v2.7 吸附半徑修正：ORS 預設只在路點 350 m 內尋找可騎道路，路點若落在園區內部、登山步道或山坡上
// （例如大直、劍潭山腳的地名中心點），會回 2010「Could not find routable point」，整段失敗而退成直線。
// 改為先以不限半徑（-1）求解，必要時換一般自行車模式，最後以 2 km 半徑兜底；
// 失敗時回傳結構化原因（code／message），前端據此在時間軸與地圖上說明「為何未接通」。
export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = Netlify.env.get("ORS_API_KEY");
  if (!key) return json({ error: "尚未設定 ORS_API_KEY（Netlify 環境變數）" }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const coords = body.coordinates; // [[lng,lat],[lng,lat]] — 一段一段呼叫
  if (!Array.isArray(coords) || coords.length < 2 || coords.length > 5) {
    return json({ error: "coordinates 需為 2–5 個 [lng,lat]" }, 400);
  }

  const want = body.profile === "cycling-regular" ? "cycling-regular" : "cycling-road";
  const call = (profile, radiuses) => fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
    method: "POST",
    headers: { "content-type": "application/json", "Authorization": key },
    body: JSON.stringify({
      coordinates: coords,
      radiuses,
      elevation: true,
      instructions: true,
      language: "zh-cn", // ORS 尚無 zh-TW；下方以字表轉為繁體
      units: "m",
    }),
  });

  // 嘗試順序：預設模式＋不限吸附 → 一般自行車模式＋不限吸附 → 一般自行車模式＋2 km 吸附
  const unlimited = coords.map(() => -1), wide = coords.map(() => 2000);
  const plan = [[want, unlimited]];
  if (want !== "cycling-regular") plan.push(["cycling-regular", unlimited]);
  plan.push(["cycling-regular", wide]);

  let r = null, fail = null;
  for (const [profile, rad] of plan) {
    try { r = await call(profile, rad); }
    catch (e) { fail = { status: 0, code: null, message: "無法連線 OpenRouteService：" + e.message }; r = null; continue; }
    if (r.ok) break;
    fail = { status: r.status, ...orsError(await r.text()) };
    r = null;
    if ([401, 403, 429].includes(fail.status)) break;   // 金鑰或配額問題，換參數也沒用
  }
  if (!r) {
    return json({ error: "ORS " + (fail ? fail.status : "?"), code: fail ? fail.code : null, message: fail ? fail.message : "" }, 502);
  }

  const j = await r.json();
  const f = j.features && j.features[0];
  if (!f) return json({ error: "ORS 無路徑結果", code: null, message: "" }, 502);

  const seg = (f.properties.segments && f.properties.segments[0]) || {};
  const steps = (seg.steps || []).map(s => ({
    instruction: s2t(s.instruction), distance: Math.round(s.distance), name: s2t(s.name || ""),
  }));
  return json({
    distance: seg.distance ?? f.properties.summary?.distance ?? 0,   // 公尺
    duration: seg.duration ?? f.properties.summary?.duration ?? 0,   // 秒（ORS 自估，僅參考）
    ascent: f.properties.ascent ?? 0,
    descent: f.properties.descent ?? 0,
    geometry: f.geometry.coordinates, // [[lng,lat,ele], ...]
    steps,
  });
};

// ORS 錯誤格式有兩種：{"error":{"code":2010,"message":"…"}} 或 {"error":"Rate Limit Exceeded"}
function orsError(t) {
  try {
    const j = JSON.parse(t);
    const e = j && j.error;
    if (e && typeof e === "object") return { code: e.code ?? null, message: String(e.message || "").slice(0, 240) };
    if (typeof e === "string") return { code: null, message: e.slice(0, 240) };
  } catch (_) {}
  return { code: null, message: String(t || "").slice(0, 240) };
}

// ORS 指示模板為簡體，逐字轉為繁體（涵蓋其指令詞彙與常見路名用字）
const S2T = {"进":"進","转":"轉","继":"繼","续":"續","环":"環","岛":"島","后":"後","离":"離","开":"開",
  "达":"達","侧":"側","号":"號","车":"車","线":"線","弯":"彎","处":"處","终":"終","点":"點","于":"於",
  "沿":"沿","东":"東","汇":"匯","并":"併","坏":"壞","过":"過","桥":"橋","顺":"順","头":"頭","联":"聯",
  "极":"極","陆":"陸","经":"經","风":"風","张":"張","湾":"灣","乐":"樂","门":"門","观":"觀","广":"廣",
  "庄":"莊","坚":"堅","龙":"龍","凤":"鳳","鸡":"雞","鸟":"鳥","乡":"鄉","镇":"鎮","县":"縣","区":"區"};
function s2t(s){ return String(s).replace(/[一-鿿]/g, ch => S2T[ch] || ch); }

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const config = { path: "/api/route" };
