# Cleaning Concierge Onboarding Playbook

Goal: launch a new cleaning client in under 1 hour.

## 1. Gather client information (10 minutes)

Collect the following details:

- Company legal name + marketing name
- Default currency for quotes (USD, EUR, etc.)
- Service areas (cities, neighbourhoods) that must match entered addresses
- Operating hours (weekday/weekend)
- Pricing structure (base fee, per-room/bath/square metre) and any discounts
- Add-on services (inside oven, fridge, window count, etc.)
- Policies (cancellation, supplies, satisfaction guarantees)
- Preferred OpenAI / payment credentials (placeholders acceptable during onboarding)

## 2. Update the knowledge base (15 minutes)

1. Open `src/kb/cleaning.yml`.
2. Edit the `company` section with the new client name, currency, service areas, and hours.
3. Update `pricing` values, including frequency discounts.
4. Adjust `addons` and `policies` with the client’s specifics.
5. Save the file and (optionally) run `npm test` to ensure schema validation passes.

For additional FAQs, drop Markdown files under `docs/` (e.g. `docs/services.md`). The RAG module automatically ingests them on server restart or via `/admin/reload-kb`.

## 3. Configure environment variables (10 minutes)

Duplicate `.env.example` to `.env` and fill in:

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1
STRIPE_KEY=sk_test_placeholder
CURRENCY=USD
COMPANY_NAME=Client Name
```

Optional adapters:

```
PAYMENT_PROVIDER=local
CALENDAR_PROVIDER=local
CRM_PROVIDER=local
```

For production, store real provider keys in the hosting platform’s secret manager.

## 4. Local smoke test (10 minutes)

```bash
npm install
npm run dev
```

- Visit `http://localhost:3000`
- Click **Get a Quote**, confirm totals align with the YAML pricing.
- Click **Book a Time**, choose a date, confirm availability slots render.
- Complete the booking flow until the payment link is generated.
- Ask a policy question (e.g. “What’s your cancellation policy?”) and verify the answer cites the correct source.

## 5. Deploy (15 minutes)

Follow `deploy.md` for either Render (Docker) or Vercel + Cloudflare Pages.

Checklist post-deploy:

- `https://your-api/health` returns `status: ok`
- Widget loads from Cloudflare Pages and talks to the API
- `/admin/metrics` shows conversion stats updating when you test the flow
- “Talk to an Agent” populates `inbox/handoff.json`

## 6. Handoff to the client

- Provide the widget URL or embed code snippet (coming soon) for their website.
- Share guidance on updating `cleaning.yml` for future pricing tweaks (commit + deploy).
- Set expectations on next integrations (Stripe, Google Calendar, HubSpot) managed via adapter env flags.

By following the steps above, a new cleaning business can be configured, tested, and deployed in under an hour.
