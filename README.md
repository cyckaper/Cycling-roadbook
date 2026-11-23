# 單車騎行農民曆 · Cycling Almanac

以二十四節氣為底的台灣單車路線分析工具：**AI 讀懂路線文字、真實路網規劃與逐段坡度、每點撤退車站（路網距離驗證）、GPX 匯出與導航交接**。

## 架構

```
public/index.html            前端 —— 產生物：由 build.py 產生，請勿直接編輯（含節氣農民曆、路線引擎、地圖）
public/sw.js                 離線殼層 Service Worker（首頁網路優先，其餘同源資產 stale-while-revalidate；改版時遞增 V 快取版本）
public/manifest.webmanifest  PWA 資訊清單
public/vendor/leaflet/       地圖函式庫（已內建，不靠 CDN）
public/vendor/pdf/           PDF 報告用：html2canvas-pro 2.5.0、jsPDF 4.2.1（MIT，按下「下載 PDF 報告」時才載入）
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
4. 「下載 GPX」→ 匯入碼錶或手錶確認軌跡；「在 Google 地圖開啟導航」→ 應以單車模式帶入各點；「下載 PDF 報告」→ 應下載一份 A4 PDF（標頭、總評、地圖、圖例、整條時間軸、坡度分級，頁尾有頁碼）。
5. 若看到「直線推估」字樣 → 時間軸該段會寫出未接通原因（例如「ORS：路點附近找不到可騎道路（502 #2010）；Valhalla：…；OSRM：…」）。顯示「金鑰無效」時檢查 `ORS_API_KEY` 後 redeploy；其餘多為路點落在步道或園區內部，改選道路上的點即可。
6. 地點順序（v2.6.4 起）：在已有路線時從清單加一個地點 → 應插在繞路最少的位置並出現說明列（可按「改放最後」）；拖曳地點膠囊（手機長按約 0.3 秒再拖）或在膠囊上按 Alt＋←／→ 可調整順序，快速滑動仍是捲動頁面。
7. 手動調整保留（v2.7.3）：AI 解析後手動加入／移動地點，再按「AI 解析路線」且文字沒改 → 應不重新解析、清單不變；改了文字再解析 → 手動加入且在路線附近的地點應依順路位置補回。

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

**`public/index.html` 是產生物，請勿直接編輯。** 所有前端改動都在 `build.py`，流程如下：

1. 編輯 `build.py`：騎點庫 `GAZ`、車站 `STATIONS`、二十四節氣 `TERMS` 與起日 `TERM_STARTS` 是檔案上方的 Python 資料；HTML／CSS／JS 在下方的 `TEMPLATE`（內含 `/*__GAZ__*/` 等四個佔位符，執行時以 JSON 填入）。
2. 執行 `python3 build.py`，重新產生 `public/index.html`。產生是可重複的：同一份 `build.py` 每次都得到逐位元組相同的檔案。
3. 把 `build.py` 與 `public/index.html` **一起提交**。Netlify 直接發布 `public/`，不會在雲端執行 `build.py`。
4. 改版時順手遞增 `build.py` 內的版本字串（console 與頁尾 colophon）以及 `public/sw.js` 的 `V` 快取版本，已安裝的離線用戶端才會更新殼層。

若曾直接改過 `index.html`，請先把改動搬回 `build.py` 再重新產生，否則下次執行 `build.py` 時會被覆蓋。

本機整合測試：`netlify dev`（需 Netlify CLI 與環境變數）。`test-fns.mjs` 為 Functions 的離線單元測試（`node --experimental-strip-types test-fns.mjs`）。
