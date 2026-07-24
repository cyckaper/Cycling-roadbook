// AI 地名抽取：把整段行程文字交給 Claude，依行進順序抽出沿線地點
// 需要環境變數 ANTHROPIC_API_KEY（Netlify → Site settings → Environment variables）
const SYSTEM = `你是台灣單車路線的地名抽取器。使用者會貼一段路線敘述、遊記或地點清單。
請依「實際行進順序」抽出沿線會經過或停留的地點（車站、景點、老街、廟宇、橋、隧道口、山口、有店名的補給點）。
規則：
1) 只輸出 JSON，格式 {"waypoints":[{"name":"地名","region":"鄉鎮市區"}]}，不要任何其他文字或說明。
2) 略過：日期、距離、爬升數字、網址、感嘆與道別語（如「武嶺見」「終於」「明天見」）、純敘述句。
3) 地名保留原文寫法，不要改寫、不要編造不存在的地點。
4) region 填該點所在行政區：台灣填鄉鎮市區（如「新城鄉」「花蓮市」）；海外填州／省或城市英文或當地名（如「Illinois」「京都市」），不確定就省略該欄位。
5) 同一地點重複提到只收一次（除非行程真的再度經過）。
6) 最多 30 點。`;

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
