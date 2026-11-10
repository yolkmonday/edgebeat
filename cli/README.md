# upflare

Install and update [Upflare](https://github.com/yolkmonday/upflare), an open-source uptime monitor that runs on one Cloudflare Worker.

> Coming soon — not yet published to npm.

## Usage

```sh
export CLOUDFLARE_API_TOKEN=...   # recommended: see "API token" below
bunx upflare setup      # install
bunx upflare update     # update an existing install
bunx upflare help
bunx upflare --version
```

`npx upflare ...` works too (Node 20+).

Setup reads the API token from `CLOUDFLARE_API_TOKEN` or asks for it (input is hidden), picks your account, optionally asks for an admin password (leave empty to generate one), then prints a checklist and the result. A generated password is printed as soon as it is stored, so it is not lost if a later step fails:

```
✓ Database
✓ Script
Admin password (shown once): ...
✓ Secrets (set ENCRYPTION_KEY, ADMIN_PASSWORD)
...
Status page: https://upflare.<you>.workers.dev/
Admin:       https://upflare.<you>.workers.dev/admin
```

The CLI checks the install through the Cloudflare API, not through `workers.dev`. If `*.workers.dev` is blocked on your network (some ISPs do this), setup still finishes and prints a warning: open the status page in a browser on another network.

## Flags

| Flag | Meaning |
|------|---------|
| `--api-token <token>` | API token. Prefer `CLOUDFLARE_API_TOKEN`: a flag is visible in `ps` and shell history. Falls back to the variable, then an interactive prompt. |
| `--account <id>` | Account id. Auto-picked when you have one account, asked when you have several. |
| `--name <name>` | Worker and database name (default `upflare`, `^[a-z0-9-]{1,63}$`). |
| `--admin-password <p>` | `setup` only. Admin password, at least 12 characters and not `change-me`. Generated when omitted. |
| `--subdomain <s>` | `setup` only. workers.dev subdomain, used only when the account has none. |
| `--yes` | Non-interactive: never asks. Needs the token and, with several accounts, `--account`. |

Exit codes: `0` success, `1` install error, `2` usage error.

## API token permissions

Create a token at https://dash.cloudflare.com/profile/api-tokens with:

- Account · Workers Scripts · Edit
- Account · D1 · Edit
- Account · Account Settings · Read

The token is only used for the run. It is never written to disk or printed. Pass it through `CLOUDFLARE_API_TOKEN` rather than `--api-token`, which other users can see in `ps` and which lands in your shell history.

## What gets created

- A D1 database named like the Worker.
- A Worker (default `upflare`) with the bundled code, static assets and a one-minute cron trigger.
- Two Worker secrets, set only when absent: `ENCRYPTION_KEY` and `ADMIN_PASSWORD`.
- Your `workers.dev` subdomain, if the account has none yet.

Re-running `setup` after an interrupted run resumes where it stopped and keeps existing secrets.

## Updating

`upflare update` uploads the new code and applies pending database migrations only. Secrets and data are left untouched, so `--admin-password` and `--subdomain` are refused. An installer older than the installed Upflare refuses to run: use `bunx upflare@latest update`.

Installs managed by a git repository (Deploy to Cloudflare button, manual deploy) cannot be updated here: pull upstream and redeploy instead.
