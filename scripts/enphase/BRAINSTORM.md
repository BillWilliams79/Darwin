# Enphase Solar Integration — Darwin Brainstorm

**Device**: 32 IQ microinverters, consumption metering, firmware D8.3.5167  
**Available data**: Production W, consumption W, net grid W, per-inverter W, voltage, frequency, power factor  
**Polling cadence**: 15–30 second live, 5 min for charts

---

## What Data We Actually Have

With the local JWT token, every 15 seconds we can get:

| Metric | Source | Example Value |
|--------|--------|---------------|
| Solar production (W) | `/api/v1/production` | 4,823 W |
| House consumption (W) | `/production.json` consumption.eim | 1,200 W |
| Grid net (W) | consumption net-consumption wNow | −3,612 W (exporting) |
| Today's production (Wh) | `/api/v1/production` | 18.5 kWh |
| Lifetime production (Wh) | `/api/v1/production` | 12,800 kWh |
| Per-inverter output (W) | `/api/v1/production/inverters` | 32 × ~152 W |
| Grid voltage (V) | `/ivp/meters/readings` | 241.3 V |
| Grid frequency (Hz) | `/ivp/meters/readings` | 60.01 Hz |
| Power factor | `/ivp/meters/readings` | 0.98 |

---

## Feature Ideas (Ranked by Value)

### 1. Live Solar Dashboard (HIGH VALUE — BUILD FIRST)
**New `/solar` route** in Darwin.

Real-time panel showing key stats, updating every 15–30 seconds:

```
┌─────────────────────────────────────────────────────────┐
│  ☀️  Solar — Live                        Updated: 12:43  │
├───────────────────┬───────────────────┬─────────────────┤
│  PRODUCING        │  CONSUMING        │  NET GRID       │
│  4,823 W          │  1,200 W          │  ↑ 3,623 W      │
│  ████████████▒▒▒  │  ███▒▒▒▒▒▒▒▒▒▒▒  │  EXPORTING      │
├───────────────────┴───────────────────┴─────────────────┤
│  Today: 18.5 kWh produced  •  8.3 kWh consumed          │
│  Lifetime: 12,800 kWh  •  ~$2,048 saved                 │
└─────────────────────────────────────────────────────────┘
```

**Tech**: React component, `useEffect` with `setInterval(15000)`, direct HTTPS fetch to `192.168.50.236` (works when on home WiFi). No backend needed.

**Key question**: Cross-origin? The browser enforces CORS. The Enphase gateway likely sends CORS headers allowing `*` or the local origin, but this needs testing. If blocked, needs a lightweight proxy (a single Lambda or local Node server).

---

### 2. Per-Inverter Heatmap (HIGH VALUE — VISUAL WOW)
Show all 32 inverters as a grid, colored by output percentage.

```
Inverter Output Map (32 panels)
Green = >80% | Yellow = 50-80% | Orange = <50% | Red = reporting 0

[■][■][■][■][■][■][■][■]    Row 1: roof south
[■][■][■][■][■][■][■][■]    Row 2: roof south
[■][■][■][■][■][■][■][■]    Row 3: roof west
[■][■][■][■][■][■][■][■]    Row 4: roof west
```

Hover over any inverter → shows serial, current W, max W, last report time.

**Data**: `/api/v1/production/inverters` (32 readings every 15s)  
**Value**: Quickly identifies shading issues, failed inverters, dirty panels.

---

### 3. Production vs Consumption Chart (HIGH VALUE — RECHARTS)
Darwin already uses Recharts (Maps/Trends view). Add a time-series area chart:

- X-axis: time (today, or last 7 days)
- Two area series: solar production (yellow/orange) and consumption (blue)
- Green shading where production > consumption (exporting / "free energy")
- Red shading where consumption > production (importing from grid)

This would use the same Recharts patterns already in `src/Maps/TrendsView.jsx`.

**Data challenge**: Local API only stores ~7 days of history. For longer history, need Enlighten cloud API (Watt tier free plan). A Lambda could periodically save readings to RDS to build a longer local history.

---

### 4. Energy Savings Calculator (MEDIUM VALUE)
Based on today's production:
- `kWh_produced × electricity_rate = $ saved today`
- Configurable rate (e.g., $0.25/kWh PG&E blended rate)
- Show: "Today: 18.5 kWh = $4.63 saved"
- Show: "This month: est. 450 kWh = $112 saved"
- Show: "Lifetime: 12,800 kWh = $3,200 saved"

Rate could be stored in Darwin profile table (add a `solar_rate` column) or just hardcoded initially.

---

### 5. Solar Status Widget on Dashboard (MEDIUM VALUE)
Small widget on the main Darwin dashboard (if one exists) or as a sticky element on the `/solar` page:

- Just the 3 numbers: Producing X W / Consuming Y W / Net Z W
- Colored indicator: green (exporting), yellow (consuming some grid), red (solar offline)
- Links to the full `/solar` page

---

### 6. Grid Metrics Panel (LOW VALUE — NICE TO HAVE)
For the technically curious:
- Grid voltage: 241.3 V (nominal 240V — monitoring for sags/swells)
- Frequency: 60.01 Hz (nominal 60 Hz)
- Power factor: 0.98 (very good — 1.0 is perfect)
- Would alert if voltage drops below 230V or frequency drifts

---

### 7. Historical Storage in RDS (ENABLER — UNLOCKS MORE)
A Lambda (new or Lambda-Recurrence extension) that:
- Runs every 15 min via EventBridge
- Calls the local gateway API (from within the same network) — or via Enlighten cloud API
- Writes reading to new `solar_readings` table in RDS

Enables: 30-day/90-day/yearly charts, trend analysis, anomaly detection.

**Schema** (migration):
```sql
CREATE TABLE solar_readings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reading_ts TIMESTAMP NOT NULL,
  production_w DECIMAL(8,2),
  consumption_w DECIMAL(8,2),
  net_w DECIMAL(8,2),
  production_wh_today DECIMAL(10,2),
  creator_fk VARCHAR(255),
  INDEX idx_reading_ts (reading_ts)
);
```

---

### 8. Enphase Cloud API Integration (FUTURE — IF NEEDED)
If historical data depth or remote access is needed:
- Register app at developer.enphaseenergy.com (free Watt tier)
- OAuth connect via a new `/solar/connect` route (similar to Strava OAuth flow already in Darwin)
- Stores token in `user_integrations` table (same as Strava integration)
- Fetch 90 days of production history on connect

**Not needed immediately** — local API is richer and immediate.

---

## Recommended Build Order

| Phase | Feature | Effort |
|-------|---------|--------|
| **Phase 1** | Live Solar Dashboard (`/solar`) | 1–2 days |
| **Phase 1** | Per-inverter heatmap | 0.5 day |
| **Phase 2** | Production vs Consumption chart (Recharts) | 1 day |
| **Phase 2** | Energy savings calculator | 0.5 day |
| **Phase 3** | RDS storage + long-term history | 1–2 days |
| **Future** | Enlighten cloud API OAuth | 2 days |

---

## Implementation Architecture Decision

**Key question**: Can the Darwin React app call `https://192.168.50.236` directly from the browser?

**Option A — Direct browser fetch (BLOCKED)**
- **CORS test result**: Gateway returns 204 on OPTIONS but sends NO `Access-Control-Allow-Origin` header → browser will reject the fetch
- Direct browser calls from Darwin (at `https://www.darwin.one`) to `192.168.50.236` will fail with CORS error
- Not viable without a proxy

**Option B — Lambda proxy (most flexible)**  
- Small Lambda endpoint: `GET /darwin/solar/production` → fetches from gateway on behalf of browser
- Pro: Works from anywhere (if Lambda can reach the gateway — only if on same network OR via cloud API)
- Con: Lambda can't reach 192.168.50.236 from AWS (different network) — needs cloud API instead
- **Actually**: A Lambda proxy for the LOCAL gateway doesn't work remotely. Lambda would need to use the Enlighten cloud API for remote access.

**Option C — Hybrid (recommended)**
- On home network: browser calls gateway directly (fast, real-time, rich data)
- Away from home: fall back to Enlighten cloud API (historical, delayed)
- Darwin detects which mode to use: try gateway first, if timeout → use cloud

**For Phase 1**: Start with Option A (direct browser call). Test CORS. If CORS blocks, add a simple CORS proxy or store the JWT in the browser and route via a serverless function.

---

## Token Storage in Darwin

The local JWT needs to be stored somewhere in the React app:
- **Option 1**: Environment variable `VITE_ENPHASE_TOKEN` — simple, hardcoded, not dynamic
- **Option 2**: User enters token once in Darwin Settings → stored in `user_integrations` table (same pattern as Strava)
- **Option 3**: Darwin triggers OAuth flow → stores token in DB

**Recommendation**: Start with Option 1 (env var) for Phase 1. Upgrade to Option 2 (DB-backed, same as Strava) for Phase 2.
