# Imladri waitlist

> iOS coding agents: start with the [linked implementation blueprint](https://github.com/try-imladri/imladri-ios-blueprint/blob/main/AGENT_START_HERE.md) and [reuse map](https://github.com/try-imladri/imladri-ios-blueprint/blob/main/REUSE_MAP.md). This reviewed snapshot preserves the current Cloudflare source. Public read access was authorized on November 21, 2026; reading or cloning needs no GitHub token. See [provenance](PROVENANCE.json) and [handoff notes](HANDOFF-NOTES.md); runtime credentials and customer data are excluded.

Original Imladri logo, walking silhouettes, local fonts, and monochrome themes. Vinext + Cloudflare Worker/D1 + Resend.

## Owner handoff

- `/` is the landing page. `/join` is the separate full-page signup screen. `/thanks` has the private confirmation session and shareable referral link.
- `/contact` saves private messages in six categories: **Privacy**, **Partnership**, **Suggestions**, **Support**, **Feedback**, and **Other**. A successful submission shows a reference. Contacting Imladri does not subscribe the sender to the waitlist or campaigns, and sends no welcome or contact notification email.
- `/admin` is the owner dashboard. In the final `ADMIN_AUTH_MODE=access` configuration, only `osama@imladri.com` may sign in through Cloudflare Access using a passkey, from any network. Access sessions are configured for six hours. Admin pages, RSC requests, and every private API require a valid, server-verified Access JWT for that exact owner email and this application; the owner's IP address is not an access requirement in this mode.
- Denied access returns to `/`. The server verifies the JWT signature and its configured issuer, application audience, owner email, user subject, application token type, and time claims before rendering private pages or accessing data. Identity headers and old application cookies cannot grant Access-mode access. **Sign out** clears legacy application authentication and opens Cloudflare Access logout before returning to the landing page. Access mode does not request a separate application email code.
- **Overview** shows actual signups, active subscribers, visitor-session conversion, cities, demographic breakdowns, sources, campaign labels, and referrals. Reporting days use America/Chicago; record timestamps are stored in UTC.
- **Signups** shows every collected form field. Filter by city, exact email, demographic, source, or status, open a record for details, or export matching records as CSV.
- **Messages** is the private contact inbox, protected by the same owner passkey access. Filter by category or status, read complete messages, and move them between **new** (Unread), **read**, and **resolved**. Category totals and unread counts update with each status change.
- Dashboard records refresh every 30 seconds while the page is visible and when you return to it. **Refresh data** reloads totals and the active signup table, contact inbox, or outbox while preserving filters, pagination, expanded details, and email drafts.
- **Emails** shows delivery state and retry controls. Draft and preview monthly updates or city launch notices before explicitly sending them. Sending is resumable, and unsubscribed/expired records are excluded.
- There are no signup caps, city targets, or demographic launch gates. The form requires an adult age range, 18+ confirmation, and email consent.
- Welcome email uses the existing verified sender `Osama from Imladri <osama@imladri.com>`. Failures preserve the signup and appear in the durable outbox. Request background work, a one-minute Cloudflare scheduled handler, and owner retry controls handle interrupted delivery.
- Welcome, monthly updates, launch notices, and deletion messages share a branded, responsive HTML template with the two-face logo, IMLADRI wordmark, and plain-text fallback. The email uses a consistent light palette with a white header and black logo and wordmark on desktop and mobile, declares `color-scheme: light only` for current Gmail apps, and retains responsive spacing. The header also has a fixed white gradient for clients that invert background colors. Templates render at delivery time, so older encrypted outbox payloads stay compatible; already received emails keep their original HTML.
- **Emails** includes a signup-confirmation preview and **Send test to my inbox**. The test can go only to the signed-in owner, is rate-limited and idempotent on retry, and does not create a signup or contact subscribers. Campaign previews use the same HTML wrapper. Test messages clearly identify sample action links.
- Subscriber emails include unsubscribe and deletion links. Link-scanner GETs never opt someone out or delete records; explicit POST confirmation does. One-click email unsubscribe is supported.
- Configure `EMAIL_POSTAL_ADDRESS` with the business mailing address for email footers before sending promotional updates. No address is invented; the owner preview reports when this setup item is missing. The address is appended at send time without rewriting encrypted queued messages. See the [FTC commercial-email guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business).

## Updating the site

- Landing copy and signup form: `components/waitlist/` and `app/join/`.
- Canonical options: `lib/waitlist/config.ts`. Welcome email text/delivery: `lib/waitlist/mail.ts`. Shared branded HTML: `lib/waitlist/email-template.ts`. Owner preview/test: `lib/waitlist/email-preview.ts` and `components/waitlist/admin-email-preview.tsx`.
- Contact form and inbox: `components/waitlist/contact.tsx`, `components/waitlist/admin-contact-panel.tsx`, and `lib/waitlist/contact.ts`. Contact schema changes belong in numbered D1 migrations.
- Privacy copy: `app/privacy/page.tsx`. This is an implementation-aligned draft; obtain the qualified review called for in the brief before promoting the waitlist.
- Layout, colors, and responsive type: `app/globals.css`. Exact original assets and font licenses: `public/assets/`.
- Pricing copy and the public city-count section have been removed as requested. City breakdowns remain available in the owner dashboard.

## Data and secrets

Personal answers and queued email bodies are encrypted with AES-GCM. Normalized waitlist emails have a unique HMAC lookup index; age and gender grouping keys are also keyed hashes. Public statistics contain aggregate city counts; private signup details require the confirmation receipt. CSV exports are owner-only and protect against spreadsheet formula injection.

Contact names, email addresses, subjects, and message bodies are encrypted with AES-GCM. Category, status, reference, and timestamps remain queryable for the inbox. Contact receipts expose only a reference and confirmation. A unique keyed hash of the client request ID makes retries idempotent: the same payload and request ID return the original reference, while a changed payload using that ID is rejected. The form checks Origin, input sizes, a honeypot, and short-lived rate limits. Contact messages stay separate from waitlist records and the email outbox.

Identifiable waitlist records expire after 365 days. Bounded housekeeping runs on waitlist activity and the Cloudflare schedule; `/api/admin/maintenance` can run it explicitly. Unsubscribe immediately cancels pending marketing delivery. Deletion removes the personal record and its outbox records. Analytics use first-party sessions and sanitized attribution labels, with no advertising pixels or stored raw IP addresses. Short-lived abuse buckets are keyed hashes.

Contact records also expire after 365 days, regardless of inbox status. Expired messages are excluded from inbox lists, summaries, and details, and removed by the same bounded housekeeping. Owner deletion removes the contact record immediately.

Secrets live in your Cloudflare Worker settings and ignored local `.dev.vars`, never in source or browser code. Preserve the data key while its records exist: changing it makes old encrypted data unreadable. Signing-key rotation invalidates email action links and lookup hashes. Back up keys securely along with data.

Runtime keys and settings: `WAITLIST_DATA_KEY`, `WAITLIST_SIGNING_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, optional `EMAIL_POSTAL_ADDRESS`, `ADMIN_EMAILS`, `ADMIN_AUTH_MODE`, `ADMIN_ACCESS_ISSUER`, `ADMIN_ACCESS_AUD`, `ADMIN_ACCESS_EMAILS`, and `SITE_BASE_URL` (or `PUBLIC_APP_URL`). `ADMIN_ALLOWED_IPS` is required only by the legacy `ip` and staged `access+ip` modes. `wrangler.cloudflare.json` defines the Worker, owner-account D1 database, custom domains, scheduled work, and nonsecret settings. `vite.cloudflare.config.ts` builds directly for Cloudflare without Sites authentication or connector plugins. The old Sites configuration is retained only as development history.

## Owner access configuration and cutover

Configure Cloudflare Access on both `imladri.com` and `www.imladri.com` for `/admin*` and `/api/admin*`. The policy must permit only `osama@imladri.com` and require the Passkeys login method, with Passkeys as the only enabled identity provider. Set the application session to six hours, enable HttpOnly and binding cookies with SameSite Lax, and send denied users to `/`.

Pin `ADMIN_ACCESS_ISSUER` to the exact HTTPS Cloudflare Access team issuer and `ADMIN_ACCESS_AUD` to this application's single 64-character audience tag. Set both `ADMIN_ACCESS_EMAILS` and `ADMIN_EMAILS` to the sole permitted address, `osama@imladri.com`. Only addresses present in both settings can sign in. The server uses the actual verified JWT email as the owner identity. The Worker obtains signing keys only from the pinned team's certificate endpoint; malformed configuration, missing or invalid tokens, and Worker subrequests fail closed.

The validator supports a comma-separated Access list of at most 16 exact addresses and no empty entries; production uses only the business owner address above. An empty intersection with `ADMIN_EMAILS` denies access. Legacy `ADMIN_ACCESS_EMAIL` remains a single-email fallback only when `ADMIN_ACCESS_EMAILS` is absent. An explicitly empty or malformed plural setting never falls back to the singular value.

- `ip` is the legacy mode and the default when `ADMIN_AUTH_MODE` is absent. It requires an exact permitted connecting IP plus the application email-code/session flow. Codes expire after ten minutes; legacy sessions last at most eight hours with a thirty-minute idle limit.
- `access+ip` is a staging mode requiring both the verified Access owner JWT and the existing IP allowlist. Neither proof alone grants access; the application email-code endpoints are disabled.
- `access` is the final passkey mode. It requires the verified Access JWT and does not consult `ADMIN_ALLOWED_IPS`. Unknown or empty mode values deny private access.

Keep the existing IP secret while preparing the Access application and pinned configuration. Use `access+ip` when staging with the existing permitted network; it will deliberately deny a different network. Before removing the IP restriction, verify the intended owner and Passkeys policy, then deploy explicit `ADMIN_AUTH_MODE=access`. Check owner access to the dashboard, contact inbox and APIs, denied/forged requests, both hostnames, and the complete Sign out flow. These are cutover requirements, not a statement that live checks have completed.

Remove `ADMIN_ALLOWED_IPS` from the Worker only after those checks pass in `access` mode. Keep `ADMIN_AUTH_MODE=access` explicit: its absence falls back to legacy `ip` mode. Restore a valid IP secret before any rollback to `ip` or `access+ip`. In IP modes, the secret accepts exact comma-separated IPv4 or IPv6 addresses without CIDR ranges; Cloudflare Pseudo IPv4 must remain Off.

## Local development

Apply migrations locally with `npx wrangler d1 migrations apply imladri-waitlist --local --config wrangler.cloudflare.json --persist-to .wrangler/cloudflare-state`. Run `npm run dev -- --port 5173`, then open `http://127.0.0.1:5173`. Local `.dev.vars` intentionally contains no live Resend key, so fixtures cannot send real email. Local legacy admin development can use explicit `ADMIN_AUTH_MODE=ip`, an exact local trusted connecting-IP allowlist, and the existing email-code/session checks. The isolated tests provide synthetic mail delivery; Access-mode tests use signed synthetic JWTs rather than disabling verification.

Check types with `npx tsc --noEmit`. Run `node --test tests/backend.test.mjs tests/access.test.mjs tests/mail-template.test.mjs` for 47 backend integration checks, 16 Access security checks, and 8 email-template checks. They use isolated Miniflare D1 databases, synthetic mail transport, and signed test JWTs. Backend coverage includes contact encryption, all categories, status changes, validation, concurrent retries, rate limits, waitlist/email isolation, access control, retention, robust pagination, and owner-only email tests. Email tests cover branding, escaping, real action links, plain-text compatibility, and optional mailing-address rendering. Access coverage includes exact-email allowlists, rejection of other or revoked emails, malformed allowlists, mode boundaries, pinned claims and signatures, key rotation/outages, forgery rejection, legacy-session rejection, and logout routing.

Generate schema changes with `npm run db:generate`; keep applied migrations immutable. Apply production migrations to the specific owner-account D1 database before deploying code that needs them. The initial database schema and migration ledger were applied through the owner Cloudflare console. Never replay initialization SQL on an initialized database.

Run `npm run build` then `npm run deploy` to build and deploy directly to Cloudflare. The build verifies the real D1 binding and rejects old Sites authentication markers. Keep invocation logs disabled because unsubscribe and deletion links carry signed action tokens; explicit application warnings contain no personal data. Hosted acceptance evidence and screenshots are in ignored `outputs/`.

Cloudflare **Always Use HTTPS** is enabled for the zone. Keep it enabled so plain-HTTP page, form, and static-asset requests redirect to HTTPS without changing Worker asset routing.
