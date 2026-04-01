# Enphase IQ Gateway — API Investigation Findings

**Investigated**: 2026-03-31  
**Device**: 192.168.50.236  
**Gateway Serial**: 202315086671  
**Firmware**: D8.3.5167  
**Enphase System ID**: 3786775 (decoded from provided user ID)

---

## Device Profile

| Field | Value |
|-------|-------|
| IP Address | 192.168.50.236 (WiFi, DHCP) |
| WiFi signal | 2/5 bars |
| MAC (WiFi) | 90:48:46:29:1F:C6 |
| Firmware | D8.3.5167 (build epoch 1748337296) |
| Part number | 800-00663-r05 |
| Microinverters | **32 IQ PCUs** (all comm level 5 = excellent) |
| Consumption meter | **Yes** (`imeter: true`) — measures both production AND consumption |
| Battery storage | None (no ACB, no Encharge units) |
| Cloud connected | Yes — reporting to Enlighten every ~15 seconds |
| Tariff type | single_rate |
| Auth mode | JWT Bearer token (`web-tokens: true`) |

---

## Authentication

### Local API Token (required for all data endpoints)
Firmware D8.3.5167 uses JWT Bearer token authentication. Older digest/password auth no longer works.

**Token type**: System Owner (1 year validity)  
**How to obtain**: Run `./get-token.sh` — it logs into Enphase Enlighten and exchanges credentials for a local JWT.

**Using the token**:
```bash
curl -sk -H "Authorization: Bearer <TOKEN>" https://192.168.50.236/production.json
```

**Token acquisition flow**:
1. POST to `https://enlighten.enphaseenergy.com/login/login.json` with Enlighten email/password
2. Extract `session_id` from response
3. POST to `https://entrez.enphaseenergy.com/tokens` with `{session_id, serial_num, username}`
4. Returns JWT string — valid 1 year for system owner

---

## API Endpoints

### Accessible WITHOUT Auth

| Endpoint | Method | Description | Sample Data |
|----------|--------|-------------|-------------|
| `/info.xml` | GET | Gateway identity | Serial, firmware version, package versions |
| `/home.json` | GET | Network & system status | WiFi signal, inverter count, cloud connectivity, last report time |

**`/home.json` example** (abridged):
```json
{
  "timezone": "US/Pacific",
  "network": { "web_comm": true, "last_enlighten_report_time": 1775005831 },
  "comm": { "num": 32, "level": 5, "pcu": { "num": 32 } },
  "tariff": "single_rate"
}
```

---

### Require JWT Auth (Bearer token)

#### Production & Consumption

| Endpoint | Returns |
|----------|---------|
| `/api/v1/production` | `wattsNow`, `wattHoursToday`, `wattHoursLifetime` |
| `/production.json` | Full production + consumption breakdown (multiple reading types) |
| `/api/v1/production/inverters` | Array of 32 per-inverter readings |

**`/api/v1/production` expected shape**:
```json
{
  "wattsNow": 4823,
  "wattHoursToday": 18500,
  "wattHoursSevenDays": 95000,
  "wattHoursLifetime": 12800000
}
```

**`/production.json` expected shape**:
```json
{
  "production": [
    { "type": "inverters", "activeCount": 32, "readingTime": ..., "wNow": 4823, "whLifetime": ... },
    { "type": "eim", "activeCount": 1, "wNow": 4812, "whToday": 18500, "whLifetime": ..., "rmsVoltage": 241.2 }
  ],
  "consumption": [
    { "type": "eim", "measurementType": "total-consumption", "wNow": 1200, "whToday": 8300 },
    { "type": "eim", "measurementType": "net-consumption", "wNow": -3612, "whToday": ... }
  ],
  "storage": []
}
```
> `net-consumption` negative = exporting to grid. `total-consumption` = house load.

**`/api/v1/production/inverters` expected shape** (32 items):
```json
[
  {
    "serialNumber": "482235012345",
    "lastReportDate": 1775005831,
    "devType": 1,
    "lastReportWatts": 152,
    "maxReportWatts": 295
  },
  ...
]
```

#### Meter Readings (real-time, ~64ms refresh)

| Endpoint | Returns |
|----------|---------|
| `/ivp/meters` | Meter EIDs and configuration |
| `/ivp/meters/readings` | Instantaneous W, VAR, VA, PF, Hz, V, A for each meter |
| `/ivp/meters/gridReading` | Grid: voltage, frequency, current, power |

**`/ivp/meters/readings` expected shape**:
```json
[{
  "eid": 704643328,
  "timestamp": 1775005831,
  "actEnergyDlvd": 12800000,
  "actEnergyRcvd": 4500,
  "apparentEnergy": 13100000,
  "reactEnergyLagg": 850000,
  "reactEnergyLead": 12000,
  "instantaneousDemand": 4812.5,
  "activePower": 4812.5,
  "apparentPower": 4900.1,
  "reactivePower": -120.3,
  "pwrFactor": 0.98,
  "voltage": 241.3,
  "current": 19.98,
  "freq": 60.01,
  "channels": [...]
}]
```

> This endpoint updates every ~15 seconds (gateway polling cycle). It has the richest electrical data including power factor, reactive power, and voltage.

#### Device Inventory

| Endpoint | Returns |
|----------|---------|
| `/inventory.json` | All devices: inverters, meters, relays, batteries |
| `/api/v1/envoyinfo` | Gateway serial, software version, timezone |

**`/inventory.json` expected shape** (abridged):
```json
[{
  "type": "PCU",
  "devices": [
    { "part_num": "IQ7PLUS-72-2-US", "installed": 1, "serial_num": "482235012345", "device_status": ["envoy.global.ok"] },
    ...  // 32 total
  ]
}]
```

#### Energy Data

| Endpoint | Returns |
|----------|---------|
| `/ivp/pdm/energy` | Energy from power distribution modules (longer time series) |
| `/api/v1/eim/energy_today` | Today's energy summary from EIM meter |

---

## Enphase Cloud "Watt" API

The "Watt" in the Enphase developer portal refers to a **plan tier** — not a separate product. The cloud API has three tiers:

| Tier | Monthly Cost | Data Access |
|------|-------------|-------------|
| **Watt** | Free | System-level production, daily/monthly summaries |
| **Kilowatt** | Paid | 15-minute intervals, consumption data |
| **Megawatt** | Enterprise | Sub-15-min intervals, all data types |

**Base URL**: `https://api.enphaseenergy.com/api/v4/`  
**Auth**: OAuth 2.0 (authorization code flow) + API key header  
**System ID**: `3786775` (decoded from provided user hex ID)  
**Rate limits**: 300 req/min, 1.6M req/month (Watt tier)  

**Key cloud endpoints**:
```
GET /api/v4/systems/{system_id}/summary         — lifetime + today totals
GET /api/v4/systems/{system_id}/energy_lifetime — production by date
GET /api/v4/systems/{system_id}/stats           — 5-min intervals (Watt plan: 1 day history)
GET /api/v4/systems/{system_id}/consumption_stats — consumption (Kilowatt+ tier)
GET /api/v4/systems/{system_id}/telemetry/production_micro — per-microinverter (Kilowatt+)
```

**Setup required**: Register at https://developer.enphaseenergy.com, create an app, complete OAuth consent flow.

### Local API vs Cloud API Trade-offs

| | Local API | Cloud (Watt tier) |
|--|-----------|------------------|
| **Latency** | ~15s (gateway polling) | 5-15 min delay |
| **Data richness** | Full: per-inverter, meters, voltage, PF | System totals only (free tier) |
| **Historical depth** | Short (gateway stores ~7 days) | Years of history |
| **Network requirement** | Must be on home LAN | Works anywhere |
| **Setup complexity** | Get 1-year token once | Register app + OAuth flow |
| **Consumption data** | Yes (this gateway has imeter) | Kilowatt tier only |
| **Cost** | Free | Free (Watt), paid (Kilowatt+) |

**Recommendation**: Local API first — richer data, immediate, no additional cost. Cloud API as fallback for historical data or remote access.

---

## Data Rates & Polling

- Gateway polls inverters every **~15 seconds**
- `/ivp/meters/readings` returns cached reading (same 15s cadence)
- Enlighten cloud receives data from gateway on same ~15s cycle but shows it with 5-15 min delay
- Safe polling interval for Darwin: **15–30 seconds** for live display, **5 minutes** for historical aggregation

---

## What's Confirmed Working (No Auth)

```bash
# Device identity
curl -sk https://192.168.50.236/info.xml

# Network status, inverter count, cloud connectivity
curl -sk https://192.168.50.236/home.json
```

Both return valid data. All production/consumption endpoints return HTTP 401 until a JWT token is provided.

---

## CORS Status — Critical for Browser Integration

Tested via OPTIONS preflight from `https://www.darwin.one`:
- Gateway returns **204 No Content** on OPTIONS requests (no error)
- But returns **NO `Access-Control-Allow-Origin` header**
- **Conclusion**: Direct browser fetch from Darwin → gateway will be BLOCKED by CORS

This means the Darwin React app **cannot call the gateway directly**. Options:
1. **Local CORS proxy**: A small Node/Python HTTP server on the home network that adds CORS headers and proxies to 192.168.50.236 (simplest for local-only use)
2. **Enlighten cloud API**: Works from anywhere, no CORS issues, but needs developer account + OAuth setup and data is delayed
3. **Lambda proxy + VPN**: Not practical (Lambda is in AWS, can't reach local network)

**Recommended for Phase 1**: Local CORS proxy (`scripts/enphase/proxy.js`) — user runs it on their home machine, Darwin calls `http://localhost:8080/enphase/...`

---

## Next Steps

1. **Run `./get-token.sh`** to obtain JWT token (requires Enlighten email + password)
2. **Run `./test-api.sh`** to test all endpoints and save actual response shapes
3. **Decide on browser access approach** (local proxy vs cloud API — see CORS section above)
4. **Implement Darwin solar page** (see brainstorm below)

---

## Darwin Integration Brainstorm

See `BRAINSTORM.md` for detailed implementation proposal.
