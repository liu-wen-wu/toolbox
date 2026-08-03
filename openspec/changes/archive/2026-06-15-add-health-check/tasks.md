# Tasks: Add Health Check Endpoint

## 1. Route Implementation
- [x] 1.1 Add `/health` route handler in `server/index.js`
- [x] 1.2 Implement health check logic with dependency verification
- [x] 1.3 Return proper HTTP status codes (200 / 503)

## 2. Verification
- [x] 2.1 Test `GET /health` returns 200 with valid JSON
- [x] 2.2 Test degraded scenario (simulate unreadable data directory)
- [x] 2.3 Verify Nginx can proxy `/health` without issues
