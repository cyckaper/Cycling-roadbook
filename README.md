# 單車騎行農民曆 · Cycling Almanac

以二十四節氣為底的台灣單車路線分析工具：**AI 讀懂路線文字、真實路網規劃與逐段坡度、每點撤退車站（路網距離驗證）、GPX 匯出與導航交接**。

## 架構

```
public/index.html            前端 —— 產生物：由 build.py 產生，請勿直接編輯（含節氣農民曆、路線引擎、地圖）
public/sw.js                 離線殼層 Service Worker（首頁網路優先，其餘同源資產 stale-while-revalidate；改版時遞增 V 快取版本）
public/manifest.webmanifest  PWA 資訊清單
public/vendor/leaflet/       地圖函式庫（已內建，不靠 CDN）
netlify/functions/
  extract.mts    /api/extract   AI 地名抽取（Anthropic API）
  geocode.mts    /api/geocode   地名定位（Google Places → OSM 備援）
  route.mts      /api/route     真實自行車路網（OpenRouteService：幾何+海拔+逐步指示）
  matrix.mts     /api/matrix    路網距離矩陣（撤退車站驗證）
  supply.mts     /api/supply    沿線補給點：超商／公廁／飲水（OpenStreetMap Overpass）
  weather.mts    /api/weather   逐時天氣（CWA 鄉鎮逐3小時預報 → Open-Meteo 備援）
  tdx-stations.mts /api/stations 台鐵全站清單（TDX，選用）
build.py                     前端唯一來源：騎點庫／車站／節氣資料 + HTML 模板；python3 build.py → public/index.html
```

分工原則：**AI 負責讀懂（文字→地名序列），地圖服務負責定位與路網（座標、路徑、坡度、距離），前端引擎負責天時（ETA、風向、風險、節氣）**。任一外部服務不可用時，前端自動降級為直線推估並如實標示，不會靜默給錯。

## 部署（GitHub → Netlify）

1. 推上 GitHub，Netlify「Import from Git」選此 repo。建置設定會自動讀 `netlify.toml`（publish=`public`，functions=`netlify/functions`），不需 build command。
2. Site settings → Environment variables 加入金鑰（見下表），**Redeploy**。

| 變數 | 必要性 | 用途 | 申請 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | AI 解析必要 | /api/extract | console.anthropic.com（每次抽取約臺幣一角以內） |
| `ORS_API_KEY` | 路網/坡度/撤退必要 | /api/route、/api/matrix | openrouteservice.org 免費註冊（directions 2000 次/日、matrix 500 次/日） |
| `GOOGLE_MAPS_API_KEY` | 建議 | 小店級地標定位 | Google Cloud 啟用 **Places API (New)**；未設時退 OSM，涵蓋率較低 |
| `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET` | 選用 | 台鐵全站清單 | tdx.transportdata.tw；未設時用內建約 130 站 |
| `CWA_API_KEY` | 建議 | /api/weather 逐時天氣 | opendata.cwa.gov.tw 註冊取得授權碼；未設時退 Open-Meteo，來源如實標示 |
| `EXTRACT_MODEL` | 選用 | 覆寫抽取模型 | 預設 `claude-sonnet-4-6` |

## 部署後驗證清單

1. `https://你的網址/api/stations` → 應回 JSON（未設 TDX 時 `stations:[]` 加註記即正常）。
2. 首頁貼一段遊記 → 按「AI 解析路線」→ 應逐一定位並列出地點膠囊；若顯示紅字錯誤，訊息會直指缺哪把金鑰。
3. 加入兩點後：路段條應顯示「均坡/最陡/坡度帶」與海拔剖面圖、地圖出現坡度著色路線、每點「轉進機會」標「路網 x.x km」。
4. 「下載 GPX」→ 匯入碼錶或手錶確認軌跡；「在 Google 地圖開啟導航」→ 應以單車模式帶入各點。
5. 若看到「直線推估」字樣 → 代表 `ORS_API_KEY` 未生效，檢查環境變數後 redeploy。

## 已驗證與已知限制（誠實聲明）

- 五支 Functions 的成功與失敗路徑、前端全流程（AI→定位→路網→坡度→撤退→GPX）、坡度數學（4.8 km / 306 m ↗ 應得均坡 6.4%，實測相符）、服務中斷時的降級，皆以模擬回應在本機測畢。**對外部服務的實連（Anthropic/ORS/Google/TDX）需部署後依上列清單驗證**。
- ORS 逐步指示目前僅支援簡體中文（`zh-cn`），暫無 zh-TW。
- 地圖底圖用 OpenStreetMap 公共圖磚，個人量級使用符合其政策；若流量成長請改接自有圖磚源。
- 天氣仍為「示範情境」——接 CWA 逐時預報是明確的下一步（於 `wx()` 替換即可）。
- ETA 配速固定 15 km/h + 爬升修正；之後可由你的實騎 GPX 回饋校準。

## 開發

**`public/index.html` 是產生物，請勿直接編輯。** 所有前端改動都在 `build.py`，流程如下：

1. 編輯 `build.py`：騎點庫 `GAZ`、車站 `STATIONS`、二十四節氣 `TERMS` 與起日 `TERM_STARTS` 是檔案上方的 Python 資料；HTML／CSS／JS 在下方的 `TEMPLATE`（內含 `/*__GAZ__*/` 等四個佔位符，執行時以 JSON 填入）。
2. 執行 `python3 build.py`，重新產生 `public/index.html`。產生是可重複的：同一份 `build.py` 每次都得到逐位元組相同的檔案。
3. 把 `build.py` 與 `public/index.html` **一起提交**。Netlify 直接發布 `public/`，不會在雲端執行 `build.py`。
4. 改版時順手遞增 `build.py` 內的版本字串（console 與頁尾 colophon）以及 `public/sw.js` 的 `V` 快取版本，已安裝的離線用戶端才會更新殼層。

若曾直接改過 `index.html`，請先把改動搬回 `build.py` 再重新產生，否則下次執行 `build.py` 時會被覆蓋。

本機整合測試：`netlify dev`（需 Netlify CLI 與環境變數）。`test-fns.mjs` 為 Functions 的離線單元測試（`node --experimental-strip-types test-fns.mjs`）。
