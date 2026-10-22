# AICC Sentinel: operator quickstart

An outbound-only availability watcher for `stage.copilt.org` (and, read-only, `api.copilt.org/health`). Python 3.11+ standard library, no installs. Design, failure-domain table and owner decisions: `DESIGN.md`.

**Read this first: on the Mac it is not 24/7.** (Prepared 24/7 variant for production: `github/README.md`; production targets: `targets.production.toml`, dark phase: `targets.dark.toml`.) A sleeping, shut or offline Mac watches nothing and sends nothing. Overnight it is blind until it wakes. For round-the-clock coverage you need the GitHub Actions variant (public repo only) or a free VM elsewhere (see `DESIGN.md` section 4).

Needs Python 3.11 or newer (`python3.12`; the macOS `/usr/bin/python3` is too old). All commands below run from the repo root.

## Try it without sending anything

```bash
# what would be probed (opens no socket at all)
python3.12 infra/sentinel/sentinel.py --config infra/sentinel/targets.stage.toml --plan

# one real round against the staging URLs, printing the Telegram messages instead of sending them (state in a scratch file)
python3.12 infra/sentinel/sentinel.py --config infra/sentinel/targets.stage.toml --once --dry-run --state-file /tmp/aicc-sentinel-try.json

# tests (loopback fakes only)
npm run sentinel:test
```

## Install on the Mac (user LaunchAgent)

```bash
bash infra/sentinel/macos/install-launchd.sh            # DRY-RUN: prints every step and the plist, changes nothing
bash infra/sentinel/macos/install-launchd.sh --apply    # does it
```

What `--apply` does: copies `sentinel.py` and the targets file (installed as `targets.toml`) into `~/Library/Application Support/aicc-sentinel/` (0700), writes `~/Library/LaunchAgents/com.aicc.sentinel.plist`, creates `~/Library/Logs/aicc-sentinel/`, then `launchctl bootstrap gui/<uid>`. It refuses to run as root, never creates the secrets file, and finds a Python 3.11+ itself (or pass `--python /abs/path`).

The agent runs once at load and every 120 s afterwards (`StartInterval`, one short process per run, state in a file). The edge target runs every tick; the 300 s targets run on the first tick at or after 300 s, so about every 360 s.

Is it alive?

```bash
python3.12 infra/sentinel/sentinel.py --status      # last run time, per-target state; exit 0 alive, 1 stale or a target down, 2 never ran
tail -n 50 ~/Library/Logs/aicc-sentinel/sentinel.out.log
launchctl print gui/$(id -u)/com.aicc.sentinel | head -20
```

Without Telegram secrets you still get log lines (`EVENT DOWN ...`) and a macOS notification with fixed text (`--macos-notify` is in the plist). The first notification may need a permission click in System Settings > Notifications (UNVERIFIED).

## Telegram secrets (create, check, rotate, remove)

```bash
bash infra/sentinel/macos/sentinel-secrets.sh            # two SILENT prompts: bot token, chat id. Nothing is echoed, nothing is on the command line.
bash infra/sentinel/macos/sentinel-secrets.sh --check    # exists, mode 0600, both keys present (values never shown)
python3.12 infra/sentinel/sentinel.py --config infra/sentinel/targets.stage.toml --test-notify   # sends one [TEST] message
```

* The file is `~/.config/aicc-sentinel/secrets.env`, mode 0600 (the sentinel ignores a group/world-readable file). It is written atomically.
* **Rotate:** revoke the old token in @BotFather (`/revoke`), run `sentinel-secrets.sh` again (it replaces the file), run `--test-notify`. No restart is needed: each run reads the file.
* **Remove:** `bash infra/sentinel/macos/sentinel-secrets.sh --remove`. Telegram is then disabled; logging and local notifications continue.
* Never put the token in the plist, the targets file, a command line, a chat message or a commit.

## Uninstall

```bash
bash infra/sentinel/macos/install-launchd.sh --uninstall           # dry-run
bash infra/sentinel/macos/install-launchd.sh --uninstall --apply   # bootout, remove plist and ~/Library/Application Support/aicc-sentinel
bash infra/sentinel/macos/sentinel-secrets.sh --remove             # optional: delete the Telegram secrets
rm -rf ~/Library/Logs/aicc-sentinel                                # optional: logs
```

## What you will see

| Message | Meaning |
|---|---|
| `[DOWN] stage-edge` ... `(failed at: dns)` | 3 of the last 5 checks failed; the part that failed is named: `dns`, `connect`, `tls`, `http`, `body`, `header` or `latency` |
| `[RECOVERED] ...` | 2 good checks in a row after a DOWN that was announced |
| `[DOWN, still]` | reminder every 6 h while it stays down |
| `[WARNING] ... TLS certificate expires in N days` | under 14 days left; not a DOWN |
| log: `inconclusive ... result discarded` | a dns/connect failure while a handshake to `api.telegram.org` also failed: this Mac looks offline, nothing is counted |

A single failed check never pages. Checks that are never made: `/wp-login.php`, `/wp-admin/`, `/wp-cron.php`, cart, checkout, my-account. Only GET (never POST or any write), no cookies, no credentials.

## Other files

| File | Purpose |
|---|---|
| `targets.stage.toml` | the staging targets (committed, no secrets) |
| `targets.production.example.toml` | www.copilt.org targets, **NOT ACTIVE until cutover**, every target `enabled = false`, referenced by nothing |
| `targets.example.toml` | the original generic example |
| `examples/github-actions-sentinel.yml.example` | the optional 24/7 variant; read its header before enabling (public repo, default branch, two secrets, pin action SHAs) |
| `macos/` | plist template, installer, secrets helper |

CLI summary: `--config FILE --once [--due-only] [--state-file PATH] [--heartbeat PATH] [--quiet-ok] [--macos-notify] [--fail-on-down] [--fail-n N --window-m M] [--host-label NAME] [--dry-run] [--plan] [--status] [--test-notify]`.
