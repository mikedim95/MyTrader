# Horizon Trade Backend

Express + TypeScript backend for the Horizon Trade frontend.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

3. Start the backend:

```bash
npm run dev
```

The API runs on `http://localhost:3001` by default.

## Endpoints

- `GET /health`
- `GET /api/health`
- `GET /ready`
- `GET /api/ready`
- `GET /api/dashboard`
- `GET /api/orders`
- `GET /api/mining/overview`
- `GET /api/mining/nicehash`

## Notes

- Live account endpoints currently return empty responses while the app runs in public-data and demo-only mode.

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
