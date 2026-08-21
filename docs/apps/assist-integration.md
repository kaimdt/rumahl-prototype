# App Assist Integration

Apps can integrate with ORA Assist by declaring Assist/GitHub permissions in `manifest.json` and by adding an optional `assist` block. rumahl Home exposes a permission-gated bridge so apps do not need direct access to the `rumahl-assist` service or GitHub credentials.

## Manifest

```json
{
  "id": "com.example.pr-bot",
  "name": "PR Review Bot",
  "version": "1.0.0",
  "developer": "Example",
  "description": "Reacts to GitHub pull requests and starts ORA Assist tasks.",
  "type": "app",
  "permissions": [
    "AssistContextRead",
    "AssistEventsSubscribe",
    "AssistTaskCreate",
    "GitHubPullRequestRead",
    "GitHubPullRequestComment"
  ],
  "assist": {
    "enabled": true,
    "name": "PR Review Bot",
    "description": "Creates AI review tasks from GitHub pull request events.",
    "capabilities": ["github_pr_review", "agent_task_create"],
    "events": ["github.pull_request.opened", "github.pull_request.synchronize"]
  }
}
```

The app is shown in ORA Assist when `assist.enabled` is true or when it has granted `Assist*`/`GitHub*` permissions.

## Bridge Endpoints

All endpoints are served by `rumahl-home` and require the corresponding granted permission for `:app_id`.

| Endpoint | Permission | Purpose |
| --- | --- | --- |
| `GET /api/apps/assist/integrations` | none | Lists apps visible in ORA Assist. |
| `GET /api/apps/:app_id/assist/context` | `AssistContextRead` | Reads the current ORA Assist context. |
| `GET /api/apps/:app_id/assist/events` | `AssistEventsSubscribe` | Subscribes to Assist notifications/events. |
| `POST /api/apps/:app_id/assist/tasks` | `AssistTaskCreate` | Creates an ORA Assist agent task. |
| `POST /api/apps/:app_id/assist/chat` | `AssistChat` | Sends an app-originated chat request to ORA Assist. |
| `ANY /api/apps/:app_id/assist/github/*path` | `GitHubRead`, `GitHubWrite`, or narrower PR/workflow permissions | Proxies GitHub operations through ORA Assist. |

Task and chat requests are enriched with an `origin` object so downstream Assist tooling can audit which app started the work.

## Example Flow

1. GitHub sends a pull request webhook to the app.
2. The app calls `GET /api/apps/:app_id/assist/github/repos/:owner/:repo/pulls/:number` to load PR metadata.
3. The app calls `POST /api/apps/:app_id/assist/tasks` with a review prompt and PR context.
4. The app optionally comments on the PR through `POST /api/apps/:app_id/assist/github/repos/:owner/:repo/pulls/:number/comment` when the Assist task has produced a result.

Apps should request only the narrow permissions they need. Commenting on PRs and triggering workflows require explicit user consent during ZIP install.
