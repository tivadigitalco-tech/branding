# Brand Studio: tivadigi.com.au/branding

Production runs as the Worker in `gate/`, on the route `tivadigi.com.au/branding*`. It lets a request through only when the visitor is signed in to Tiva HQ (tivadigi.com.au): the Worker forwards the visitor's cookies to `https://tivadigi.com.au/` and treats a 2xx answer as signed in. Anyone else is sent to `https://tivadigi.com.au/login?next=/branding/...`. It serves `public/` as static assets and `POST /branding/api/generate` from `functions/api/generate.js`.

### Gate Worker deploy (Workers Builds)
Workers & Pages > Create > Import a repository > `tivadigitalco-tech/branding`. Root directory `gate`, build command empty, deploy command `npx wrangler deploy`. Then Worker > Settings > Variables and Secrets > add Secret `ANTHROPIC_API_KEY`. CLI equivalent: `cd gate && npx wrangler deploy && npx wrangler secret put ANTHROPIC_API_KEY`.

Change HQ's session check URL with the `HQ_SESSION_CHECK` variable if `/` stops being a cheap signed-in-only page.

The sections below describe the original Cloudflare Pages setup (branding.tivadigi.com.au behind Cloudflare Access), kept as a fallback.

Static page plus one Cloudflare Pages Function.

```
public/index.html            the app (self-contained, images inlined)
public/_headers, robots.txt  no-index, basic security headers
functions/api/generate.js    POST /api/generate -> Claude Messages API (streams text back)
wrangler.toml                project name, output dir, non-secret vars
```

The page talks only to `/api/generate`. The Anthropic key is a Pages secret and never reaches the browser. Client briefs stay in each visitor's browser (localStorage); nothing is stored server-side.

## Deploy
Dashboard drag-and-drop upload does not deploy `functions/`, so Generate would fail. Use A or B.

### Option A: GitHub (auto-deploys on push)
1. Push this folder to a GitHub repo (repo root = this folder).
2. Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git > pick the repo.
3. Build settings: Framework preset **None**, build command **empty**, output directory **public**.
4. Save and Deploy.

### Option B: CLI upload
```
npm i -g wrangler
wrangler login
wrangler pages project create brand-studio --production-branch main
wrangler pages deploy public --project-name brand-studio
```
Run from this folder so `functions/` is picked up.

## Secret
Pages project > Settings > Variables and Secrets > Add, type **Secret**, Production (and Preview if used):
- `ANTHROPIC_API_KEY` = key from console.anthropic.com

CLI equivalent: `wrangler pages secret put ANTHROPIC_API_KEY --project-name brand-studio`

Redeploy after adding it. Optional plain variables: `CLAUDE_MODEL` (default `claude-opus-5-5`), `MAX_TOKENS` (default 32000), `ALLOWED_ORIGINS` (comma-separated; add `https://brand-studio.pages.dev` to test on the pages.dev URL).

## Custom domain
Pages project > Custom domains > Set up a custom domain > `branding.tivadigi.com.au`.
- DNS on Cloudflare: record is created automatically.
- DNS elsewhere: add `CNAME branding -> brand-studio.pages.dev` at the DNS host, then return to Cloudflare to verify. TLS is issued automatically.

## Access control (do this before sharing the URL)
`/api/generate` spends API credit for anyone who can reach it. The origin check stops other websites calling it, not scripts. Put the site behind Cloudflare Access:
1. Zero Trust > Access > Applications > Add > Self-hosted.
2. Domain `branding.tivadigi.com.au` (path empty, covers `/api/*` too). Also add `brand-studio.pages.dev` or disable that hostname.
3. Policy: Allow, Include > Emails (yours, staff, specific clients) or Email domain. One-time PIN login works without an identity provider.
4. Free for up to 50 users.

Also set a monthly spend limit in the Anthropic console.

## Local test
```
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .dev.vars
wrangler pages dev public
```
Open http://localhost:8788. Add `http://localhost:8788` to `ALLOWED_ORIGINS` in `.dev.vars` if the origin check blocks it.

## Changes from the claude.ai prototype
- Added doctype, viewport and noindex meta.
- Inserted a small runtime shim before the app script that provides `window.claude.use('sample')` (calls `/api/generate`, streams progress, parses JSON) and `window.claude.use('downloads')` (normal browser download). App logic is unchanged.
- Generate-unavailable warning text now points at the function and secret.

## Updating the app
Replace `public/index.html` with a new export, re-insert the shim `<script>` block (its fetch URL must stay relative: `api/generate`) (marked "Self-hosted runtime") before the first `<script>`, and redeploy.
