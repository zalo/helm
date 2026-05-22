# Submitting push notifications

The terminal server on this box exposes a loopback-only HTTP endpoint that
fans a notification out to every subscribed device (e.g. an iPhone with the
Terminal PWA installed to the Home Screen).

There are two ways to call it:

## 1. `tm-notify` (recommended)

A Python wrapper installed at `~/.claude/bin/tm-notify`. If `~/.claude/bin`
is on your `$PATH`, just:

```bash
tm-notify "Build finished"
tm-notify "Tests passed" "All 234 green"
tm-notify "Heads up" "Long task completed" --url /?session=work
tm-notify "Deploy" "Production updated" --tag deploy
```

Arguments:

- `title` (required) — first positional arg, shown bold on the device.
- `body` (optional) — second positional arg, the longer text below the title.
- `--url <path-or-url>` — where to navigate when the notification is tapped.
  Defaults to `/`. Use relative paths (e.g. `/?session=my-session`) to open
  the PWA; absolute URLs are allowed too.
- `--tag <tag>` — notifications sharing a tag replace one another on the
  device (no spam pile-up). Use a stable tag per logical event type, e.g.
  `--tag build`, `--tag deploy`, `--tag long-task-$NAME`.
- `--icon <url>` — override the default icon.

Exits 0 on success and prints a JSON summary like
`{"sent": 1, "gone": 0, "errors": 0, "total": 1}` — `sent` is how many
devices got it, `gone` is dead subscriptions that were pruned, `total` is
how many subscriptions remain after the call.

## 2. `curl` to the endpoint

If you're in a language that doesn't have `tm-notify` on `$PATH` (or you
want zero dependencies), POST JSON to the local API:

```bash
curl -fsSL -X POST http://127.0.0.1:3000/api/notify \
  -H 'content-type: application/json' \
  -d '{"title":"Done","body":"Long task completed","url":"/?session=work","tag":"long-task"}'
```

The request **must originate from this machine** — the server checks the
peer IP and rejects anything that isn't `127.0.0.1` / `::1` with HTTP 403.

Payload fields (all but `title` optional):

| field | type   | meaning                                                            |
|-------|--------|--------------------------------------------------------------------|
| title | string | Required. Shown in bold.                                           |
| body  | string | Body text.                                                         |
| url   | string | Click destination. Defaults to `/`.                                |
| tag   | string | Group key — same tag replaces an earlier unopened notification.    |
| icon  | string | URL of the icon (defaults to the app icon).                        |
| data  | object | Free-form metadata passed through to the SW (rarely needed).       |

Response is the same JSON summary as `tm-notify` returns:
`{"sent": N, "gone": M, "errors": E, "total": T}`.

## Subscribing a new device

`tm-notify` only delivers to devices that have already opted in:

1. On the device, open the Terminal UI in Safari.
2. Share → **Add to Home Screen** (iOS requires this step before push
   permission can be granted).
3. Open the installed app from the Home Screen.
4. On the sessions list, tap **Enable notifications** and grant the prompt.

You can check how many devices are currently subscribed:

```bash
curl -s http://127.0.0.1:3000/api/push/subscriptions
# → {"subscriptions": [...], "count": N}
```

If `count` is 0, `tm-notify` will return `sent: 0` and nothing will land on a
phone — that's the expected behaviour, not a bug.

## Common patterns

**Notify when a long task finishes:**

```bash
make build && tm-notify "Build done" "$(date)"        \
            || tm-notify "Build FAILED" "Check the log" --tag build
```

**Heartbeat from a CI-style loop, replacing the last one:**

```bash
while ...; do
  tm-notify "Run $i of $N" "$(measure)" --tag heartbeat
  sleep 60
done
```

The `--tag heartbeat` makes each new notification replace the previous one
instead of stacking on the lock screen.

**Open a specific tmux session in the UI on tap:**

```bash
tm-notify "agent-work needs input" "Question pending" --url /?session=my-session
```
