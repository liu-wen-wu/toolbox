# Design: Health Check Endpoint

## Technical Approach

### Route Definition
Add a new route handler in the existing HTTP request router in `server/index.js`:

```javascript
if (pathname === '/health') {
  res.setHeader('Content-Type', 'application/json');
  try {
    // Verify feedback directory is readable as a basic dependency check
    fs.accessSync(FEEDBACK_DIR, fs.constants.R_OK);
    res.statusCode = 200;
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }));
  } catch (err) {
    res.statusCode = 503;
    res.end(JSON.stringify({
      status: 'degraded',
      reason: 'feedback data directory not accessible',
      timestamp: new Date().toISOString()
    }));
  }
  return;
}
```

### Placement
Insert before the WebSocket upgrade handler and after the request body parsing, so it's a fast-path check that doesn't go through the feedback or deploy logic.

### Error Handling
- If `fs.accessSync` throws, return 503 with a descriptive reason
- Wrap in try/catch to prevent uncaught exceptions

## Key Decisions
- **No database check** — this server doesn't have a DB dependency; the feedback file system is the only stateful dependency
- **Sync access check** — lightweight enough (just a stat syscall) that async isn't needed
- **`/health` on GET only** — POST, PUT, etc. return 404

## Dependencies
- None beyond Node.js built-ins (`fs`, `process`)
- No new npm packages required
