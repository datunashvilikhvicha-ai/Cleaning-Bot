# Deploying Cleaning Concierge

This guide covers the current deployment setup for the API server and the static widget.

## 1. Prerequisites

- Node.js 22 locally for running smoke tests
- Docker installed (recommended for reproducible builds)
- Accounts on Render or Vercel, plus Cloudflare for the static widget
- OpenAI API key and any other secret values available in `.env`

## 2. Environment variables

| Variable | Description |
| --- | --- |
| `OPENAI_API_KEY` | Key for OpenAI Chat Completions |
| `OPENAI_MODEL` | Model id (e.g. `gpt-4.1`) |
| `STRIPE_KEY` | Placeholder until Stripe integration is wired |
| `CURRENCY` | Default billing currency |
| `COMPANY_NAME` | Display name in responses |
| `PAYMENT_PROVIDER` | Adapter id (`local` by default) |
| `CALENDAR_PROVIDER` | Adapter id for availability (`local`) |
| `CRM_PROVIDER` | Adapter id for saving leads (`local`) |

For production, use platform secret managers (Render/Vercel console or Cloudflare Workers KV).

## 3. Build & test before deploy

```bash
npm ci
npm test
npm run build    # optional, we use tsx in dev
```

## 4. Deploying the API server

### Option A: Render (Docker)

1. Push the repo to GitHub (or a private Git remote).
2. On Render, create a new "Web Service".
3. Choose **Deploy from Dockerfile** and point Render to the repository.
4. Set the service to use the `Dockerfile` (production image) and Node 22 runtime.
5. In the **Environment** tab, add the environment variables listed above.
6. Set the **Start Command** to the default `CMD` from the Dockerfile (`node dist/server/app.js`).
7. Hit deploy. Render will build the image using Dockerfile and expose the server on the provided domain.

### Option B: Vercel (Node build)

Vercel can run Node servers using the build output.

1. Add the repo as a Vercel project.
2. In **Settings → Build & Development Settings**, set:
   - Framework preset: `Other`
   - Build command: `npm install && npm run build`
   - Output directory: `dist`
   - Node version: `22.x`
3. Add the environment variables in **Settings → Environment Variables**.
4. Create a `vercel.json` (optional) if you want to customise routes; otherwise Vercel will serve the compiled server from `dist/server/app.js` via a Node entry point.
5. Deploy—Vercel will install dependencies, run `npm run build`, and start the server.

> Note: the repository currently uses `tsx watch` for local dev and does not ship a compiled `dist`. Update `npm run build` to compile TypeScript to `dist/` before production deploys (e.g. `tsc`).

## 5. Deploying the widget

The `public/index.html` widget is a static asset and can be hosted separately.

### Cloudflare Pages (recommended)

1. Run `npm install` (not required for the widget build itself, but helpful for future automation).
2. Ensure `public/index.html` is production-ready.
3. In Cloudflare Pages, create a new project:
   - Build command: `echo "skip"` (or leave blank since we just serve static files)
   - Output folder: `public`
4. Upload or connect the repository branch; Pages will deploy the static content to a CDN-backed URL.
5. Configure CORS on the API server (already defaults to `*`) so the widget can call `/chat` and other endpoints.

### Alternative static hosting

Any static host (Netlify, Vercel static site, S3/CloudFront) works—just serve `public/` as-is. Remember to point the widget's fetch URL to the deployed API server.

## 6. Smoke test after deploy

1. Hit `https://your-api-domain/health` – expect `{ status: 'ok' ... }`.
2. Load the widget (Cloudflare Pages URL), click **Get a Quote**, **Book a Time**, and run through the flow.
3. Check `https://your-api-domain/admin/metrics` to confirm analytics events are recording.

## 7. Future improvements

- Replace the local adapters by setting `PAYMENT_PROVIDER`, `CALENDAR_PROVIDER`, `CRM_PROVIDER` once integrations are ready.
- Add CI pipelines (GitHub Actions) to build & push Docker images automatically.
- Use Terraform or Pulumi for infrastructure-as-code when scaling beyond a single project.
