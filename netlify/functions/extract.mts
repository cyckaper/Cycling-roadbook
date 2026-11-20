// AI 地名抽取：把整段行程文字交給 Claude，依行進順序抽出沿線地點
// 需要環境變數 ANTHROPIC_API_KEY（Netlify → Site settings → Environment variables）
// v2.6.4：補上「搭車接駁」與「單車道」的規則——上車站不列、下車站寫清楚是高鐵站還是火車站、
// 回程沒寫站名就不自行補站；具名單車道照敘述位置列入。
const SYSTEM = `你是台灣單車路線的地名抽取器。使用者會貼一段路線敘述、遊記或地點清單。
請依「實際騎乘順序」抽出沿線會經過或停留的地點（車站、景點、老街、廟宇、橋、隧道口、山口、具名的單車道、有店名的補給點）。
規則：
1) 只輸出 JSON，格式 {"waypoints":[{"name":"地名","region":"鄉鎮市區"}]}，不要任何其他文字或說明。
2) 略過：日期、時刻、車次、距離、爬升數字、網址、感嘆與道別語（如「武嶺見」「終於」「明天見」）、純敘述句，以及沒有店名的吃喝活動（如「吃羊肉爐」「喝咖啡」）。但帶地名的賞景要保留地點：「看銅鑼菊花」列「銅鑼菊花」、「去南寮看夕陽」列「南寮」；沒有地名的（如「看夕陽」）才略過。
3) 地名保留原文寫法，不要改寫、不要編造不存在的地點；唯一例外是車站要依第 7 點寫清楚是哪一種站。
4) region 填該點所在行政區：台灣填鄉鎮市區（如「新城鄉」「花蓮市」）；海外填州／省或城市英文或當地名（如「Illinois」「京都市」），不確定就省略該欄位。
5) 同一地點重複提到只收一次（除非行程真的再度經過）。
6) 最多 30 點。
7) 搭乘交通工具的段落（高鐵、台鐵火車、捷運、客運、計程車、開車載車）不是騎乘路線：
   a. 上車的站不要列入（例如「從板橋搭高鐵到新竹」的板橋）。
   b. 下車的站就是騎乘起點，列為第一點，並寫出完整站名區分系統：高鐵寫「高鐵○○站」（如「高鐵新竹站」，region 填車站所在鄉鎮市區，如「竹北市」）；台鐵寫「○○車站」（如「新竹車站」）；捷運寫「捷運○○站」。原文只寫城市名（如「搭高鐵到新竹」「坐火車到福隆」）時，依搭乘的交通工具判斷是高鐵站還是火車站。
   c. 結尾的「坐火車／搭高鐵／搭客運回家」：原文有寫上車站才列為最後一點（同樣寫清楚是哪一種站）；沒寫站名就不要自行補站，也不要把起點的車站拿來當終點——最後一點就是最後提到的騎乘地點。
   d. 但原文明說「騎回」某地（如「再騎回淡水捷運站」「騎回起點」），那是環線的一部分，要把該地列為最後一點，即使與起點相同。
8) 「沿○○單車道」「轉○○自行車道」「接○○河濱」這類路線描述：有具名的單車道、自行車道、河濱或綠廊，也要列為地點（保留原名，如「頭前溪單車道」），放在敘述中的位置。
範例：「搭高鐵從台北到台中，沿旱溪自行車道到大坑，吃豆花，最後搭火車回家」→
{"waypoints":[{"name":"高鐵台中站","region":"烏日區"},{"name":"旱溪自行車道"},{"name":"大坑","region":"北屯區"}]}`;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const key = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "尚未設定 ANTHROPIC_API_KEY（Netlify 環境變數）" }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  let text = String(body.text || "").slice(0, 8000);
  if (!text.trim()) return json({ error: "empty text" }, 400);
  // 內文擴充：偵測第一個網址，伺服器代抓文章（含短網址轉址），一併餵給模型
  const um = text.match(/https?:\/\/[^\s"'<>）)】]+/);
  if (um) {
    const page = await fetchArticle(um[0]);
    if (page) text = (text + "\n\n【連結內文（自動抓取）】\n" + page).slice(0, 14000);
  }

  const model = Netlify.env.get("EXTRACT_MODEL") || "claude-sonnet-4-6";
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        temperature: 0,
        system: SYSTEM,
        messages: [{ role: "user", content: text }],
      }),
    });
  } catch (e) {
    return json({ error: "無法連線 Anthropic API：" + e.message }, 502);
  }
  if (!r.ok) {
    const t = await r.text();
    return json({ error: "Anthropic API " + r.status, detail: t.slice(0, 300) }, 502);
  }
  const data = await r.json();
  const raw = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  const parsed = extractJson(raw);
  if (!parsed || !Array.isArray(parsed.waypoints)) {
    return json({ error: "模型回應無法解析為 JSON", raw: raw.slice(0, 300) }, 502);
  }
  const waypoints = parsed.waypoints
    .filter(w => w && typeof w.name === "string" && w.name.trim())
    .slice(0, 30)
    .map(w => ({
      name: w.name.trim().slice(0, 40),
      ...(typeof w.region === "string" && w.region.trim() ? { region: w.region.trim().slice(0, 20) } : {}),
    }));
  return json({ waypoints, model });
};

async function fetchArticle(u) {
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(u, { signal: ctl.signal, redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; xiaobu-roadbook)", "accept": "text/html,*/*" } });
    clearTimeout(to);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (!/html|text/i.test(ct)) return null;
    let html = await r.text();
    const title = (html.match(/<title[^>]*>([^<]{0,200})/i) || [])[1] || "";
    html = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
               .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&")
               .replace(/\s+/g, " ").trim();
    return ((title ? title + "\n" : "") + html.slice(0, 5000)) || null;
  } catch (e) { return null; }
}
function extractJson(s) {
  s = String(s).replace(/```json|```/g, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const config = { path: "/api/extract" };
