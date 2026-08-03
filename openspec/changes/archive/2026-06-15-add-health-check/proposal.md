# Proposal: Add Health Check Endpoint

## Why
The unified server lacked a health check with dependency verification and timestamp, making it difficult for monitoring tools and Nginx to accurately verify service health.

## What Changes
- `GET /health` now returns a `timestamp` field in JSON response  
- Dependency check: verifies feedback data directory is readable  
- Returns 503 + `{ status: "degraded", reason: "..." }` when unhealthy  
- Both `/health` and `GET /` benefit from these improvements
