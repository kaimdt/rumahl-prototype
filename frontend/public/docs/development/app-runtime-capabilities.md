# App Runtime Capabilities

Apps and plugins can declare generic integration surfaces and runtime capabilities in their manifest. IORA exposes these declarations through a central integration registry so every UI area can discover extensions without hard-coding a service such as IORA Assist.

## Manifest example

```json
{
  "id": "github-review-bot",
  "name": "GitHub Review Bot",
  "version": "1.0.0",
  "type": "app",
  "permissions": [
    "AppActionExecute",
    "AppQueueManage",
    "ExternalHttpRequest",
    "AppRuntimeAuditRead",
    "AppSecretsRead",
    "AppSecretsWrite",
    "GitHubPullRequestRead",
    "GitHubPullRequestComment"
  ],
  "integrations": [
    {
      "surface": "assist",
      "label": "Pull request review bot",
      "actions": ["review_pr", "summarize_pr"]
    },
    {
      "surface": "admin.apps",
      "label": "Queued automation jobs"
    }
  ],
  "capabilities": {
    "actions": ["review_pr", "summarize_pr"],
    "runtime": {
      "limits": { "http_per_minute": 60 }
    },
    "queue": {
      "default_mode": "queued"
    }
  },
  "network_access": {
    "allowed_domains": ["api.github.com"],
    "allowed_local_ips": ["192.168.1.50"],
    "allow_network_scan": false
  },
  "external_apis": [
    {
      "name": "GitHub API",
      "base_url": "https://api.github.com"
    }
  ]
}
```

Unknown manifest fields are preserved as forward-compatible extension metadata, so new surfaces can be added before a dedicated typed manifest field exists.

## Registry

`GET /api/apps/integrations` returns installed app/plugin integrations with app metadata, declared surfaces, custom pages, capabilities, granted permissions, and denied permissions.

`GET /api/apps/:app_id/capabilities` returns one app's runtime permissions and declared capability metadata.

The App Store installed-apps view uses this registry to show integration badges for apps that hook into UI areas such as navigation, pages, widgets, scheduler, messaging, webhooks, storage, database, Assist, or external APIs.

## Jobs and queues

`POST /api/apps/:app_id/jobs` creates an app runtime job. The request body supports:

```json
{
  "action": "review_pr",
  "mode": "queued",
  "payload": {
    "repository": "owner/repo",
    "pull_request": 42
  },
  "target_url": "https://example.com/iora/action"
}
```

`mode` can be `queued` or `parallel`. Queued jobs are processed in order per app. Parallel jobs start immediately. Jobs keep status, timestamps, result, error, and log lines.

Job endpoints:

- `GET /api/apps/:app_id/jobs`
- `GET /api/apps/:app_id/jobs/:job_id`
- `POST /api/apps/:app_id/jobs/:job_id/cancel`

Running jobs requires `AppActionExecute`. Canceling queued jobs requires `AppQueueManage`.

## Runtime audit

Autonomous apps can inspect their own runtime activity through:

- `GET /api/apps/:app_id/audit`

This requires `AppRuntimeAuditRead` and returns recent app-scoped events for jobs, secrets, external HTTP requests, and network probes. Secret values are never written to the audit log.

## App secrets

Apps can store their own encrypted secrets in IORA and reference them from runtime calls without sending API tokens through the UI or manifest.

Secret endpoints:

- `GET /api/apps/:app_id/secrets`
- `POST /api/apps/:app_id/secrets`
- `PUT /api/apps/:app_id/secrets/:secret_id`
- `DELETE /api/apps/:app_id/secrets/:secret_id`
- `POST /api/apps/:app_id/secrets/:secret_id/reveal`

Create request:

```json
{
  "name": "github-token",
  "value": "ghp_example",
  "secret_type": "api_token",
  "description": "GitHub API token for pull request automation"
}
```

Secrets are stored encrypted at rest under the local app store data directory. Listing secrets returns metadata only. Revealing a value or injecting it into an HTTP request requires `AppSecretsRead`; creating or updating requires `AppSecretsWrite`; deleting requires `AppSecretsManage`.

## External HTTP and APIs

`POST /api/apps/:app_id/http` lets apps perform controlled outbound HTTP/API requests through IORA. It requires `ExternalHttpRequest` and only allows `http` or `https` URLs. Loopback URLs are rejected.

If `network_access.allowed_domains` or `external_apis[].base_url` is declared, outbound HTTP is restricted to those hosts. Wildcards such as `*.example.com` are supported. Local/private IP targets require `NetworkLocalAccess` and must match `network_access.allowed_local_ips` when that list is present.

By default, each app can make 60 runtime HTTP requests per minute. Apps can lower or raise the limit up to 600 with `runtime.limits.http_per_minute`; `0` disables the per-minute runtime limit and should only be used for trusted apps.

```json
{
  "url": "https://api.github.com/repos/owner/repo/pulls/42",
  "method": "GET",
  "headers": { "Accept": "application/vnd.github+json" },
  "bearer_token_secret": "github-token",
  "timeout_secs": 30
}
```

Headers can also be populated from secrets:

```json
{
  "url": "https://api.example.com/data",
  "method": "GET",
  "secret_headers": {
    "X-Api-Key": "example-api-key"
  }
}
```

Sensitive hop-by-hop headers such as `Host` and `Content-Length` are filtered by the bridge. App-specific API keys should be referenced through `bearer_token_secret` or `secret_headers` instead of being sent as plaintext request headers.

## Network devices

Apps can perform a controlled single-host TCP probe instead of a broad network scan:

- `POST /api/apps/:app_id/network/probe`

```json
{
  "host": "192.168.1.50",
  "port": 80,
  "timeout_secs": 5
}
```

This requires `NetworkScan`. If the target resolves to a local/private IP, `NetworkLocalAccess` is also required and `network_access.allowed_local_ips` is enforced when configured.
