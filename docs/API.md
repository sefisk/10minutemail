# 10MinuteMail API Documentation

## Base URL

```
http://localhost:3000
```

## Authentication

Most endpoints require a Bearer token obtained when creating an inbox.

```
Authorization: Bearer <access_token>
```

Admin endpoints require the `X-Admin-Key` header instead.

---

## Public Endpoints

### Create Inbox

Create a new temporary email inbox.

**`POST /v1/inboxes`**

#### Mode A — External Mailbox (Bring-Your-Own)

```json
{
  "mode": "external",
  "email_address": "user@example.com",
  "pop3_host": "pop.example.com",
  "pop3_port": 995,
  "pop3_tls": true,
  "pop3_username": "user@example.com",
  "pop3_password": "your-password",
  "token_ttl_seconds": 600
}
```

#### Mode B — System-Generated Inbox

```json
{
  "mode": "generated",
  "token_ttl_seconds": 600
}
```

#### Response (201)

```json
{
  "inbox_id": "550e8400-e29b-41d4-a716-446655440000",
  "email_address": "sarah.mitchell42@tmpmail.local",
  "inbox_type": "generated",
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_expires_at": "2025-01-15T10:20:00.000Z",
  "created_at": "2025-01-15T10:10:00.000Z"
}
```

> **Security**: Real POP3 passwords are never returned after creation. Only the access token is provided.

---

### Fetch Messages

Retrieve messages from an inbox. Automatically fetches new mail from POP3 server.

**`GET /v1/inboxes/:id/messages`**

**Headers**: `Authorization: Bearer <token>`

**Query Parameters**:

| Parameter   | Type    | Default | Description                          |
|-------------|---------|---------|--------------------------------------|
| `since_uid` | string  | —       | Only return messages after this UID  |
| `limit`     | integer | 20      | Max messages to return (1-50)        |
| `fetch_new` | boolean | true    | Fetch new mail from POP3 first       |

#### Response (200)

```json
{
  "inbox_id": "550e8400-e29b-41d4-a716-446655440000",
  "messages": [
    {
      "id": "msg-uuid",
      "uid": "12345",
      "message_id": "<abc@example.com>",
      "sender": "sender@example.com",
      "recipients": [{"address": "you@tmpmail.local", "name": ""}],
      "subject": "Welcome!",
      "text_body": "Hello, welcome to our service...",
      "html_body": "<html>...</html>",
      "headers": {"date": "...", "from": "..."},
      "size_bytes": 4523,
      "received_at": "2025-01-15T10:12:00.000Z",
      "fetched_at": "2025-01-15T10:15:00.000Z",
      "attachments": [
        {
          "id": "att-uuid",
          "filename": "report.pdf",
          "content_type": "application/pdf",
          "size_bytes": 102400,
          "content_id": null
        }
      ]
    }
  ],
  "count": 1
}
```

---

### Download Attachment

Download a message attachment as a binary file stream.

**`GET /v1/inboxes/:id/messages/:uid/attachments/:attachmentId`**

**Headers**: `Authorization: Bearer <token>`

**Response**: Binary file stream with appropriate Content-Type and Content-Disposition headers.

---

### Rotate Token

Revoke the current token and issue a new one.

**`POST /v1/inboxes/:id/token:rotate`**

**Headers**: `Authorization: Bearer <current_token>`

```json
{
  "token_ttl_seconds": 900
}
```

#### Response (200)

```json
{
  "inbox_id": "550e8400-e29b-41d4-a716-446655440000",
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_expires_at": "2025-01-15T10:35:00.000Z"
}
```

---

### Delete Inbox

Permanently delete an inbox and wipe all associated data (messages, attachments, tokens, encrypted credentials).

**`DELETE /v1/inboxes/:id`**

**Headers**: `Authorization: Bearer <token>`

#### Response (200)

```json
{
  "inbox_id": "550e8400-e29b-41d4-a716-446655440000",
  "deleted": true
}
```

---

## Admin Endpoints

All admin endpoints require the `X-Admin-Key` header.

```
X-Admin-Key: your-admin-api-key
```

### Manage Domains

#### Add Domain

**`POST /v1/admin/domains`**

```json
{
  "domain": "tempbox.io",
  "pop3_host": "mail.tempbox.io",
  "pop3_port": 995,
  "pop3_tls": true
}
```

#### List Domains

**`GET /v1/admin/domains`**

#### Update Domain

**`PUT /v1/admin/domains/:id`**

```json
{
  "is_active": false
}
```

#### Delete Domain

**`DELETE /v1/admin/domains/:id`**

---

### Bulk Generate Emails

Generate multiple random email inboxes at once across one or more domains.

**`POST /v1/admin/generate`**

```json
{
  "count": 50,
  "domain_ids": ["uuid-of-domain-1", "uuid-of-domain-2"],
  "token_ttl_seconds": 86400
}
```

- `count`: 1–1000 inboxes per request
- `domain_ids`: Optional. If omitted, uses all active domains (round-robin).
- `token_ttl_seconds`: 60–604800 (up to 7 days). Admins bypass the normal 1-hour limit.

#### Response (201)

```json
{
  "batch_id": "batch-uuid",
  "generated": 50,
  "inboxes": [
    {
      "inbox_id": "uuid",
      "email_address": "sarah.mitchell42@tempbox.io",
      "password": "base64url-random-password",
      "access_token": "eyJ...",
      "token_expires_at": "2025-01-16T10:10:00.000Z"
    }
  ]
}
```

> Passwords are only returned at creation time.

---

### Export Inboxes

Export generated inboxes in `email:password` format.

**`GET /v1/admin/export`**

**Query Parameters**:

| Parameter   | Type   | Default  | Description                              |
|-------------|--------|----------|------------------------------------------|
| `format`    | string | `text`   | Output format: `text`, `json`, or `csv`  |
| `domain_id` | uuid   | —        | Filter by specific domain                |
| `status`    | string | `active` | `active` or `all`                        |

#### Response — text format (default)

```
sarah.mitchell42@tempbox.io:aB3xY9mK...
jthompson@tmpmail.io:pQ7wR2nL...
emma.cloud99@tempbox.io:kT5uV8jH...
```

#### Response — json format

```json
{
  "count": 3,
  "entries": [
    {
      "email": "sarah.mitchell42@tempbox.io",
      "password": "aB3xY9mK...",
      "inbox_id": "uuid",
      "status": "active",
      "created_at": "2025-01-15T10:10:00.000Z"
    }
  ]
}
```

#### Response — csv format

```csv
email,password,inbox_id,status,created_at
sarah.mitchell42@tempbox.io,aB3xY9mK...,uuid,active,2025-01-15T10:10:00.000Z
```

---

### System Stats

**`GET /v1/admin/stats`**

Returns aggregate counts for inboxes, tokens, messages, and domains.

---

## Health Checks

### Liveness

**`GET /health`** — No auth required.

### Readiness

**`GET /ready`** — No auth required.

---

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable error description",
    "details": ["optional", "additional", "info"]
  }
}
```

### Error Codes

| Code                  | HTTP Status | Description                    |
|-----------------------|-------------|--------------------------------|
| `VALIDATION_ERROR`    | 400         | Invalid request parameters     |
| `AUTHENTICATION_ERROR`| 401         | Missing or invalid credentials |
| `AUTHORIZATION_ERROR` | 403         | Insufficient permissions       |
| `NOT_FOUND`           | 404         | Resource not found             |
| `CONFLICT`            | 409         | Resource conflict              |
| `RATE_LIMIT_EXCEEDED` | 429         | Too many requests              |
| `POP3_ERROR`          | 502         | POP3 server communication error|
| `INTERNAL_ERROR`      | 500         | Unexpected server error        |

---

## Rate Limits

| Endpoint Group   | Limit         | Window   |
|------------------|---------------|----------|
| Global           | 100 requests  | 1 minute |
| Create Inbox     | 5 requests    | 1 minute |
| Fetch Messages   | 30 requests   | 1 minute |

Rate limit headers are included in responses:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705312260
```

---

## Interactive API Docs

Swagger UI is available at: `GET /docs`
