# api Specification

## Purpose
TBD - created by archiving change add-health-check. Update Purpose after archive.
## Requirements
### Requirement: Health Check Endpoint
The system SHALL expose a `GET /health` endpoint returning the service health status as JSON.

#### Scenario: Service is healthy
- GIVEN the unified server is running
- WHEN a client sends `GET /health`
- THEN the response status SHALL be 200
- AND the response body SHALL contain `{ "status": "ok", "uptime": <seconds>, "timestamp": "<ISO date>" }`
- AND the `Content-Type` SHALL be `application/json`

#### Scenario: Service is degraded
- GIVEN a dependency (e.g., feedback data directory) is unavailable
- WHEN a client sends `GET /health`
- THEN the response status SHALL be 503
- AND the response body SHALL contain `{ "status": "degraded", "reason": "<description>" }`

### Requirement: No Authentication Required
The health endpoint SHALL be publicly accessible without authentication.

#### Scenario: Public access without credentials
- GIVEN a monitoring tool without any authentication credentials
- WHEN the tool sends GET /health
- THEN the endpoint SHALL return a valid response
- AND the endpoint MUST NOT expose sensitive information
- AND the endpoint MUST NOT allow state mutations

