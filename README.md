# 單車騎行農民曆 · Cycling Almanac

以二十四節氣為底的台灣單車路線分析工具：**AI 讀懂路線文字、真實路網規劃與逐段坡度、每點撤退車站（路網距離驗證）、GPX 匯出與導航交接**。

## 架構

```
public/index.html            前端（由 build.py 產生；含節氣農民曆、路線引擎、地圖）
public/vendor/leaflet/       地圖函式庫（已內建，不靠 CDN）
public/vendor/pdf/           PDF 報告用：html2canvas-pro 2.5.0、jsPDF 4.2.1（MIT，按下「下載 PDF 報告」時才載入）
netlify/functions/
  extract.mts    /api/extract   AI 地名抽取（Anthropic API）
  geocode.mts    /api/geocode   地名定位（Google Places → OSM 備援）
  route.mts      /api/route     真實自行車路網（OpenRouteService：幾何+海拔+逐步指示）
  matrix.mts     /api/matrix    路網距離矩陣（撤退車站驗證）
  tdx-stations.mts /api/stations 台鐵全站清單（TDX，選用）
build.py                     前端產生器：python3 build.py → public/index.html
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
| `EXTRACT_MODEL` | 選用 | 覆寫抽取模型 | 預設 `claude-sonnet-4-6` |

## 部署後驗證清單

1. `https://你的網址/api/stations` → 應回 JSON（未設 TDX 時 `stations:[]` 加註記即正常）。
2. 首頁貼一段遊記 → 按「AI 解析路線」→ 應逐一定位並列出地點膠囊；若顯示紅字錯誤，訊息會直指缺哪把金鑰。
3. 加入兩點後：路段條應顯示「均坡/最陡/坡度帶」與海拔剖面圖、地圖出現坡度著色路線、每點「轉進機會」標「路網 x.x km」。
4. 「下載 GPX」→ 匯入碼錶或手錶確認軌跡；「在 Google 地圖開啟導航」→ 應以單車模式帶入各點；「下載 PDF 報告」→ 應下載一份 A4 PDF（標頭、總評、地圖、圖例、整條時間軸、坡度分級，頁尾有頁碼）。
5. 若看到「直線推估」字樣 → 時間軸該段會寫出未接通原因（例如「ORS：路點附近找不到可騎道路（502 #2010）；Valhalla：…；OSRM：…」）。顯示「金鑰無效」時檢查 `ORS_API_KEY` 後 redeploy；其餘多為路點落在步道或園區內部，改選道路上的點即可。

## 已驗證與已知限制（誠實聲明）

- 五支 Functions 的成功與失敗路徑、前端全流程（AI→定位→路網→坡度→撤退→GPX）、坡度數學（4.8 km / 306 m ↗ 應得均坡 6.4%，實測相符）、服務中斷時的降級，皆以模擬回應在本機測畢。**對外部服務的實連（Anthropic/ORS/Google/TDX）需部署後依上列清單驗證**。
- 路網四道防線（v2.7）：ORS（伺服器端，吸附半徑不設限，必要時換一般自行車模式並以 2 km 兜底）→ 連線類失敗重試一次 → Valhalla（FOSSGIS，瀏覽器以 GET `?json=` 直連，與 openstreetmap.org 網站同法，不觸發跨網域預檢）→ OSRM 自行車（FOSSGIS）→ 四道全敗才直線推估，並標示原因。備援路段的海拔由 Open-Meteo 補齊；海拔服務失敗時路線照用、坡度以兩端海拔推估並標「海拔推估」。
- 地圖下方的圖例逐一說明每種符號：坡度色線、直線推估虛線、序號路點圖釘（綠起點／紅途經／黑終點、環線合併如「1·8」）、補給點（v2.7.1 起全部標示：縮小時是小圓點，紫＝超商、藍＝飲水、深灰＝公廁；zoom 15 以上換成購物袋／水滴／WC 圖示；圖例內可暫時隱藏，選擇記在瀏覽器）、以及 OpenStreetMap 底圖自身的符號。
- PDF 報告（v2.7.1）：文字區塊以 html2canvas-pro 擷取（版面固定以桌機寬度排，手機上存出來也是同樣的 A4 版面；高度剖面圖依 A4 寬度重畫），地圖另以 canvas 依 Web Mercator 重繪（OSM 圖磚＋坡度色線＋補給點＋路點圖釘，附 © OpenStreetMap contributors）；每頁整頁一張 JPEG，時間軸只在站點／路段交界換頁。圖磚抓不到時地圖仍畫出路線並註明。內容為圖像，PDF 內文字無法選取或搜尋。
- ORS 逐步指示目前僅支援簡體中文（`zh-cn`），暫無 zh-TW。
- 地圖底圖用 OpenStreetMap 公共圖磚，個人量級使用符合其政策；若流量成長請改接自有圖磚源。
- 天氣仍為「示範情境」——接 CWA 逐時預報是明確的下一步（於 `wx()` 替換即可）。
- ETA 配速固定 15 km/h + 爬升修正；之後可由你的實騎 GPX 回饋校準。

## 開發

改前端 → 編輯 `build.py` → `python3 build.py`。本機整合測試：`netlify dev`（需 Netlify CLI 與環境變數）。`test-fns.mjs` 為 Functions 的離線單元測試（`node --experimental-strip-types test-fns.mjs`）。
