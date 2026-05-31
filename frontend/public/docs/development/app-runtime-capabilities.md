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
    "queue": {
      "default_mode": "queued"
    }
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

## External HTTP and APIs

`POST /api/apps/:app_id/http` lets apps perform controlled outbound HTTP/API requests through IORA. It requires `ExternalHttpRequest` and only allows `http` or `https` URLs. Loopback URLs are rejected.

```json
{
  "url": "https://api.github.com/repos/owner/repo/pulls/42",
  "method": "GET",
  "headers": {
    "Accept": "application/vnd.github+json"
  },
  "timeout_secs": 30
}
```

Sensitive hop-by-hop or identity headers such as `Host`, `Authorization`, `Cookie`, and `Content-Length` are filtered by the bridge. App-specific secrets should be handled by the secrets service or a dedicated integration bridge instead of being sent directly from the UI.
