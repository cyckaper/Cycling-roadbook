// 地名定位 v2.4：三段式含合理性閘門
// 1a) 有前點(near)時先以 ±0.5° 視窗在台灣找(串鏈地名就近解析)
// 1b) 台灣全域
// 2)  全球備援——但有 near 時，候選必須落在 near 250 km 內，否則寧可回空（略過勝於瞬移）
export default async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const region = (url.searchParams.get("region") || "").trim();
  const near = (url.searchParams.get("near") || "").trim();
  if (!q) return json({ results: [], error: "missing q" }, 400);

  let bias = null;
  if (near) {
    const [la, ln] = near.split(",").map(Number);
    if (isFinite(la) && isFinite(ln)) bias = { la, ln };
  }
  const nearTW = bias ? (bias.la > 20 && bias.la < 27 && bias.ln > 118 && bias.ln < 123.5) : true;
  const NEAR_KM = 250;
  const byNear = rs => bias ? rs.slice().sort((a, b) =>
    hav(bias.la, bias.ln, a.lat, a.lng) - hav(bias.la, bias.ln, b.lat, b.lng)) : rs;

  const gkey = Netlify.env.get("GOOGLE_MAPS_API_KEY");
  let results = [], source = "none";

  if (gkey) {
    if (nearTW) {
      results = byNear(await gPlaces(gkey, region ? `${q} ${region}` : `${q} 台灣`, "zh-TW", "TW", bias));
      if (results.length) source = "google";
    }
    if (!results.length) {
      let glob = await gPlaces(gkey, region ? `${q} ${region}` : q, null, null, bias);
      if (bias) glob = glob.filter(r => hav(bias.la, bias.ln, r.lat, r.lng) <= NEAR_KM);
      if (glob.length) { results = glob; source = "google"; }
    }
  }

  if (!results.length) {
    if (bias && nearTW) {
      results = await nominatim([q, region].filter(Boolean).join(" "), "tw", bias, 0.15);
      if (results.length) source = "osm";
    }
    if (!results.length && nearTW) {
      results = byNear(await nominatim([q, region, "台灣"].filter(Boolean).join(" "), "tw", null, 0));
      if (results.length) source = "osm";
    }
    if (!results.length) {
      let glob = await nominatim([q, region].filter(Boolean).join(" "), null, null, 0);
      if (bias) glob = byNear(glob.filter(r => hav(bias.la, bias.ln, r.lat, r.lng) <= NEAR_KM));
      if (glob.length) { results = glob; source = "osm"; }
    }
  }

  return json({ results, source });
};

async function gPlaces(key, textQuery, lang, regionCode, bias) {
  try {
    const body = { textQuery, maxResultCount: 3 };
    if (lang) body.languageCode = lang;
    if (regionCode) body.regionCode = regionCode;
    if (bias) body.locationBias = { circle: { center: { latitude: bias.la, longitude: bias.ln }, radius: 30000 } };
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.places || []).map(p => ({
      name: p.displayName?.text || textQuery,
      address: p.formattedAddress || "",
      lat: p.location?.latitude, lng: p.location?.longitude,
    })).filter(p => isFinite(p.lat) && isFinite(p.lng));
  } catch (e) { return []; }
}

async function nominatim(query, countrycodes, box, half) {
  try {
    const cc = countrycodes ? "&countrycodes=" + countrycodes : "";
    const vb = box ? `&viewbox=${(box.ln - half).toFixed(3)},${(box.la + half).toFixed(3)},${(box.ln + half).toFixed(3)},${(box.la - half).toFixed(3)}&bounded=1` : "";
    const r = await fetch(
      "https://nominatim.openstreetmap.org/search?format=json&accept-language=zh-TW,en&limit=3" + cc + vb + "&q=" + encodeURIComponent(query),
      { headers: { "User-Agent": "cycling-roadbook-netlify-function", "Accept": "application/json" } }
    );
    if (!r.ok) return [];
    const j = await r.json();
    return (j || []).map(p => ({
      name: (p.display_name || query).split(",")[0],
      address: p.display_name || "",
      lat: +p.lat, lng: +p.lon,
    })).filter(p => isFinite(p.lat) && isFinite(p.lng));
  } catch (e) { return []; }
}

function hav(a, b, c, d) {
  const R = 6371, r = x => x * Math.PI / 180;
  const dLa = r(c - a), dLn = r(d - b);
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
}

export const config = { path: "/api/geocode" };
