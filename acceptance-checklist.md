# Acceptance Checklist

Use this list before handing the concierge to a new client or promoting to production.

## Functional correctness
- [ ] **Quote math matches knowledge base** – run representative quotes (standard/deep, different frequencies) and confirm totals equal the calculation in `src/kb/cleaning.yml`.
- [ ] **Service area validation** – attempt a booking with an address outside `company.serviceAreas`; API should reject it.
- [ ] **No overlapping bookings** – simulate sequential bookings for the same slot and ensure the calendar adapter prevents overlap (local adapter already enforces time slicing; replace with real calendar logic before go-live).
- [ ] **Payment link integrity** – every generated link includes the booking id and total amount in the query string; analytics should log a `payment_link_generated` event with the same values.
- [ ] **FAQ answers cite sources** – ask policy/pricing questions and confirm responses include the KB key or Markdown filename in metadata/cards.

## Security & compliance
- [ ] **PII redacted from logs** – inspect server logs during flow; ensure emails, phone numbers, addresses, and secret-looking strings are masked.
- [ ] **Human handoff records saved** – trigger “Talk to an Agent” and verify the conversation snapshot lands in `inbox/handoff.json`.

## Performance
- [ ] **Median FAQ latency < 1.5s** – run several FAQ questions and check `/admin/metrics` response-time averages for the last 7 days.
- [ ] **Median tool-flow latency < 3s** – run quote → booking → payment flow; confirm `/admin/metrics` average response times remain under 3000 ms.

## Analytics & funnel
- [ ] **Dashboard shows funnel** – visit `/admin/metrics`; ensure quotes, bookings, payment links, deflection rate, and handoff counts populate for last 7/30 days.

When every box is checked (with evidence saved in your release notes), the deployment is ready for client use.
