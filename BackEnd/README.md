# Horizon Trade Backend

Express + TypeScript backend for the Horizon Trade frontend, with Binance integration.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

3. Add Binance credentials (or use the frontend Settings page to provide session credentials):

```env
BINANCE_API_KEY=your_key
BINANCE_API_SECRET=your_secret
BINANCE_TESTNET=false
```

4. Start the backend:

```bash
npm run dev
```

The API runs on `http://localhost:3001` by default.

## Endpoints

- `GET /api/health`
- `GET /api/binance/connection`
- `POST /api/binance/connection`
- `DELETE /api/binance/connection`
- `GET /api/dashboard`
- `GET /api/orders`
- `GET /api/mining/overview`
- `GET /api/mining/nicehash`

## Notes

- If Binance credentials are unavailable or invalid, the API returns empty live-data responses (no demo/mock payloads).
- Session credentials sent through `POST /api/binance/connection` are kept in memory only (not persisted to disk).

### Optional Mining/NiceHash env inputs

You can provide mining data from your own collector by setting these variables:

- `NICEHASH_API_KEY`
- `NICEHASH_API_SECRET`
- `NICEHASH_ORG_ID`
- `NICEHASH_API_HOST` (default: `https://api2.nicehash.com`)

For live rig data in the NiceHash tab, the NiceHash API key should include `VMDS` (view mining data) in addition to wallet read access.

- `MINERS_BASIC_JSON` (JSON array of miner objects)
- `MINING_TOTAL_MINERS`
- `MINING_ACTIVE_MINERS`
- `MINING_TOTAL_HASHRATE_TH`
- `MINING_TOTAL_POWER_W`
- `MINING_AVG_CHIP_TEMP_C`
- `MINING_EST_DAILY_REVENUE_USD`
- `NICEHASH_CONNECTED`
- `NICEHASH_POOL_STATUS`
- `NICEHASH_POOL_NAME`
- `NICEHASH_POOL_URL`
- `NICEHASH_ALGORITHM`
- `NICEHASH_ASSIGNED_MINERS`
- `NICEHASH_HASHRATE_TH`
- `NICEHASH_POWER_W`
- `NICEHASH_EST_DAILY_REVENUE_USD`
