# Deploying Frog as its own standalone PWA

Frog is already a **self-contained, installable PWA** by construction: its own Docker
stack (backend + nginx-served frontend), its own web manifest + service worker, its own
icons, all served from the root of one origin (see `docs/ARCHITECTURE.md` → *Packaging*).
Nothing here is a code change — this is the operational recipe for running it as an app you
can install on a phone or desktop, separate from anything else you host.

> Placeholders throughout — substitute your own values. Real hostnames, IPs, and paths
> belong in your `.env` and your own notes, never in this repo.

## The one rule: its own origin

A PWA installs as a **distinct app** — its own home-screen icon, its own offline cache
scope — **only when it's served from its own origin over HTTPS**. So the goal is: give Frog
its own hostname.

Three consequences worth stating, because they rule out the tempting shortcuts:

- **Don't mount it under a subpath of another app** (e.g. `https://hub.example/frog/`). The
  manifest, service worker, and icons all assume they sit at the root of the origin, and a
  second app's service worker on the same origin would fight Frog's for the same scope.
- **Don't iframe it into another app.** Frog's nginx sets `frame-ancestors 'self'` in its
  CSP, which blocks cross-origin framing by design.
- **Link to it, don't embed it.** If you want to reach Frog from another dashboard, add a
  plain external link/tile that points at Frog's own origin.

## Steps

1. **Configure** — `cp .env.example .env`, then set `GAMES_ROM_DIR` to your ROM folder and
   (optionally) your IGDB credentials. Pick a `FRONTEND_PORT` that doesn't collide with
   anything else on the host (default `8585`).

2. **Fetch the engine** — `scripts/fetch-emulatorjs.sh` (see the README).

3. **Bring the stack up** — `docker compose up -d`. The nginx frontend now answers on
   `http://localhost:${FRONTEND_PORT}` (LAN HTTP is enough to *use* it, but not to *install*
   it as a PWA — that needs HTTPS at its own origin, next step).

4. **Front it with its own HTTPS hostname.** Put a TLS-terminating reverse proxy in front of
   the container port, on a hostname dedicated to Frog — for example:

   - a **Tailscale** `serve`/`funnel` mapping on a dedicated `*.ts.net` name
     (`your-frog.example.ts.net` → `http://localhost:${FRONTEND_PORT}`), or
   - any reverse proxy (Caddy/nginx/Traefik) that terminates TLS for a name like
     `frog.example.com` and proxies to the container.

   The frontend already accepts a proxied `Host` header for `*.ts.net` names; for a
   different domain, allow it the same way.

5. **Install it.** Open the HTTPS URL on the device and use the browser's *Add to Home
   Screen* / *Install*. It installs as **Frog**, with the frog icon, in its own window, and
   downloaded games play offline.

## Host-side checklist (fill in for your box)

Keep these in your own ops notes, not in the repo:

- The concrete hostname and the reverse-proxy/`serve` mapping.
- Any firewall rule needed to reach `FRONTEND_PORT` from where the proxy runs.
- Whether the host already runs another copy of Frog (or another app that links to games) —
  decide whether the standalone deployment **replaces** that or runs **alongside** it. That
  decision is intentionally left open here.
