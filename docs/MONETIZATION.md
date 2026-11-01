# Arbora: accounts, membership and monetization

Status: plan, 1 Nov 2026. Built in [Stage 15](./BUILD_STAGES.md#stage-15-accounts-and-membership) (`F-ACCOUNT`, [PLAN § 4.18](./PLAN.md#418-accounts-and-membership-f-account), [ADR 0008](./PLAN.md#adr-0008-a-required-account-and-a-membership-for-the-power-features)).

## The decision

- **Everyone signs in.** The app asks for an Arbora account on first launch and before any project opens. One account works on every machine the person uses.
- **Arbora Pro** is the paid membership: **$5 USD a month** or **$50 USD a year** (two months free, 17 % off). Prices are in USD, with Stripe's local-currency presentment where available.
- **Arbora Free** stays useful, so that signing in is not a dead end and people can see why Pro is worth it. Every new account gets **14 days of Pro** without a card.

## What Arbora is selling

Arbora does not resell models. Agents bring their own login, models and billing (ADR 0002); Arbora never sees a provider key. So the membership pays for the tool and its development, not for compute. Two things follow:

1. The marginal cost of a user is close to zero (an account row and a few entitlement checks a day), so a low price is sustainable and the free tier can be generous.
2. Gating should follow **leverage**: what saves an experienced user hours (many agents at once, design mode, the design-match loop, worktrees) is Pro. What a first-time user needs to see the point (open a project, run the dev server, one agent, point at a component) is Free.

### Who pays

| Segment | What they want | Plan |
| --- | --- | --- |
| Solo front-end developers and indie hackers | Point-and-prompt, design tweaks without a design tool round trip | Pro monthly, then yearly |
| Agencies and freelancers | Many projects, many agents, the design-match loop from Figma | Pro yearly; Team later |
| Students and open-source maintainers | Learning, side projects | Free, or Pro at no cost through an application (later) |
| Companies | Seats, invoices, SSO | Team plan (later, not Stage 15) |

### Price points and what they cost to collect

| | Monthly $5 | Yearly $50 |
| --- | --- | --- |
| Stripe card fee (2.9 % + $0.30, US cards; international cards cost more) | $0.45 (9 %) | $1.75 (3.5 %) |
| Stripe Billing (0.7 % of volume) | $0.04 | $0.35 |
| Stripe Tax, if used (0.5 % per transaction) | $0.03 | $0.25 |
| **Net per year** | about $54 of $60 | about $47.65 of $50 |

Fees are Stripe's published US rates as of November 2026; check them again before launch.

The fixed $0.30 makes monthly plans expensive to collect, so the yearly plan is the default selection on the pricing page and in the app, and its "2 months free" is shown. Do not go below $5 a month: the fee would eat more of it.

A merchant of record (Paddle, or Lemon Squeezy) handles VAT and sales tax worldwide for you, at roughly 5 % + $0.50 per transaction: about $0.75 (15 %) of every $5 month. Stripe with Stripe Tax is cheaper, but **you** must register for tax where you pass the thresholds (the EU VAT OSS, the UK, US states with economic nexus, Canada's GST/HST). Recommendation: start on Stripe Billing with Checkout and the Customer Portal. Turn on Stripe Tax only after adding the registrations it needs (without a registration Stripe calculates and collects no tax). If tax registration becomes a burden, move to a merchant of record; the app does not change, because it only reads entitlements from your server.

## Free and Pro, by stage

"Free" means signed in without a membership. Everything here assumes the account is signed in; nothing works signed out.

| Stage | Feature | Free | Pro | Why |
| --- | --- | --- | --- | --- |
| 0 Foundation | Window, projects, command palette, keybindings, themes (light/dark/system) | ✓ | ✓ | The shell |
| 1 Browser panel | Embedded browser, viewport presets, screenshots, console and network problems, React/Vue DevTools | ✓ | ✓ | The product's surface; must feel complete |
| 2 Terminal | Tabs, splits, dev server run/restart, URL detection | ✓ | ✓ | Table stakes |
| 3 Agent panel | Any ACP agent, threads, permissions, plans, ACP log | ✓, **1 agent running at a time** | ✓, unlimited concurrent agents | Shows the value; parallel agents is leverage |
| 4 Agent mode (`Mod+K`) | Point at a component, prompt with source and screenshot | ✓ | ✓ | The hook; never gate the first wow |
| 5 Browser tools (MCP) | The agent screenshots, clicks and checks its own work | ✓ | ✓ | Gating it makes Free agents worse, and the user blames Arbora |
| 6 Design mode (`Mod+D`) | Visual editing, before/after screenshots and the diff sent to the agent | Try it: **3 design saves per month** | ✓ unlimited | Strong Pro reason; a taste in Free sells it |
| 7 Files and editor | Explorer, quick open, search, editor, Prettier/ESLint/tsc on save, diff viewer | ✓ | ✓ | Expected; gating feels hostile |
| 8 Git and GitHub | Status, hunks, commit, branches, push/pull, `gh` pull requests | ✓ | ✓ | Expected |
| 8 Git | Agent-drafted commit messages and PR descriptions | ✓ | ✓ | Uses the user's own agent; costs Arbora nothing |
| 9 Distribution and polish | Onboarding, Settings, updates, diagnostics, notifications and sounds | ✓ | ✓ | Trust and support |
| 9 Polish | Projects page and switcher | ✓ | ✓ | |
| 9 Polish | **Project groups** and **agent groups** | — | ✓ | Organising many projects and agents is a power-user need |
| 10 Grove | The many-agents workspace, attention badge, default agent | View only, with the 1-agent limit | ✓ | Grove is the multi-agent feature |
| 11 Stretch | Worktree sessions, Tailwind write-through, design session history, action traces, LSP, source-map mapping, Grove orchestration | LSP and source maps ✓ | ✓ all | Write-through, worktrees and orchestration are leverage; LSP is expected |
| 12a Tabs | App tab plus reference tabs | ✓, **up to 3 reference tabs** | ✓ unlimited | Everyday browsing stays Free |
| 12b Cross-tab work | Prompt from any tab to any project, the design-match loop (Figma → app), `browser_compare` | — | ✓ | The headline Pro feature for agencies |
| 12c Passwords | 1Password fill and save for the user | ✓ | ✓ | Security features are never gated |
| 12c Passwords | `browser_login`: agents log in through 1Password | — | ✓ | Automation, not safety |
| 13 Themes | `theme.json` colour packs | ✓ import | ✓ | Cosmetic; community themes help adoption |
| 14 Extensions | Approved catalog (Svelte DevTools, Bitwarden, Robocop) | ✓ | ✓ | Small, and helps adoption |

### Rules for gating (keep to these when new features land)

1. **Never gate safety, privacy or the user's data.** Permission cards, redaction, sandboxing, password filling for the user, diagnostics export, uninstall, exporting threads and design sessions: always on. A lapsed membership must never hide or delete the user's threads, groups or settings; Pro-only items become read-only.
2. **Never gate the first success.** Open a project, start the dev server, connect an agent, `Mod+K` a component and see the change: all Free.
3. **Gate leverage, not friction.** Parallel agents, Grove, design mode at volume, the design-match loop, worktrees, write-through, agent logins, groups.
4. **Limits count things the app already knows locally** (running agents, design saves this month, reference tabs). Arbora does not send usage to the server; the month counter lives in local settings. A determined user can reset it. That is acceptable at $5; do not build tracking to stop it.
5. **Show the gate where the user meets it**, with what Pro unlocks and the price ("Run another agent with Pro, $50/year"). One click opens checkout. No nagging elsewhere: no banners, no countdowns outside the trial's last 3 days.
6. **Agents keep working when a membership lapses mid-session.** Limits apply to the next start, not to a turn in flight.

## Trial, upgrades and lapses

- **Trial:** 14 days of Pro from account creation, no card. The app shows "Pro trial: N days left" in Settings → Account, and a single reminder 3 days before the end. When it ends the account is Free; nothing is lost.
- **Upgrade:** Settings → Account → **Upgrade**, any gate's **Upgrade** button, or the website pricing page. All open Stripe Checkout in the system browser with the account's email prefilled. The yearly plan is preselected.
- **After payment:** Stripe's webhook updates the account on your server; the app refreshes entitlements when the browser returns (the checkout success page deep-links `arbora://account/refresh`), on window focus, and every 6 hours.
- **Manage, cancel, switch plans, invoices:** **Manage membership** opens the Stripe Customer Portal. Cancelling keeps Pro to the end of the paid period.
- **Failed payments:** Stripe retries (Smart Retries) for up to 2 weeks and emails the customer. Pro stays on during that period (`past_due` counts as Pro); the account turns Free when the subscription is cancelled for non-payment.
- **Refunds:** a 14-day no-questions refund on the first yearly payment, through the Stripe Dashboard. Say so on the pricing page; it lowers the barrier to the yearly plan.
- **Launch offer (optional):** "Founding member: $40/year for life" for the first 500 yearly members, as a separate Stripe Price kept on renewal. It rewards early users without discounting everyone forever.

Later, not in Stage 15: a Team plan (seats, one invoice, an admin page; around $10 per seat a month), education and OSS programs, regional pricing.

## Sign-in design (summary; the build steps are in Stage 15)

- **Accounts live on your server**, next to the website: the website's sign-in, pricing page and download page use the same account. Recommended stack: the website on Next.js (Vercel), **Supabase Auth** for sign-in (email magic link, GitHub, Google) and Postgres for accounts and entitlements, **Stripe Billing** for payments. Clerk or Auth0 can replace Supabase Auth; the app only talks to your API.
- **The desktop app signs in through the system browser**, never a password field inside Arbora: OAuth 2.0 authorization code with PKCE, as RFC 8252 describes for native apps. Arbora opens `https://<site>/app/sign-in?...` in the default browser; after sign-in the site redirects to `arbora://auth/callback?code=...` (a registered protocol handler) or, where the protocol cannot be registered (the tarball, some Linux desktops), to a loopback `http://127.0.0.1:<port>/callback`. A device-code fallback ("enter this code on arbora.dev/activate") covers machines without a browser.
- **Tokens:** a short-lived access token and a refresh token, kept in the OS keychain through Electron `safeStorage` (Keychain, DPAPI, libsecret). Where `safeStorage` is unavailable (Linux without a keyring), ask before storing it encrypted with a machine key, and say so (Stage 9 gotcha).
- **Entitlements, not raw subscription data, go to the app:** `GET /v1/entitlements` returns a signed JWT (Ed25519) with `{ sub, email, plan: "free" | "pro", trialEndsAt, periodEndsAt, limits, exp }`. The app verifies it with a public key compiled into the build. It refreshes on startup, focus and every 6 hours, and works **offline for 14 days** on the last valid token. After that it asks to go online; it never locks a project the user is in the middle of.
- **What the server learns:** the account email, the plan, the app version and OS at refresh time, and when the app last refreshed. No project names, paths, prompts, agent names or usage. Update the "no telemetry" principle to say exactly that, and publish it in the privacy policy.
- **Enforcement is in the main process,** with the renderer showing the result. Unsigned builds can be patched; accept it. The server-signed entitlement keeps honest users honest; do not add obfuscation or an online check on every action.

## What to set up outside the code

| What | Where | Notes |
| --- | --- | --- |
| Stripe account | dashboard.stripe.com | Business details, payout bank account, statement descriptor "ARBORA". Use a [sandbox](https://docs.stripe.com/sandboxes.md) for development and CI, not live mode. |
| Product and prices | Stripe → Product catalog | Product "Arbora Pro"; prices `pro_monthly` $5/month and `pro_yearly` $50/year (lookup keys, so the code does not hard-code price ids). |
| Customer Portal | Stripe → Settings → Billing → Customer portal | Allow cancel (at period end), switch monthly ↔ yearly, update payment method, invoices. |
| Webhook endpoint | Stripe → Developers → Webhooks | `https://<site>/api/stripe/webhook`; events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Verify the signature. |
| API key | Stripe → Developers → API keys | A restricted key (`rk_…`) with only what the server needs (Checkout Sessions, Customers, Subscriptions read, Billing Portal sessions), in the server's environment, never in the app. |
| Tax | Stripe → Tax | Only after registering where required; see above. |
| Auth provider | Supabase project (or Clerk) | Email magic link plus GitHub and Google OAuth apps. Redirect URLs: the website, `arbora://auth/callback`, `http://127.0.0.1/*` (loopback). |
| Signing key for entitlements | Server secret | Ed25519 key pair; the private key on the server, the public key in `packages/shared` (rotate by shipping two public keys). |
| Legal pages | Website | Terms of service, privacy policy (what the server stores, above), refund policy, and the imprint your country requires. |
| Support email | Website and Stripe | Stripe shows it on receipts. |

## Measuring whether it works (without telemetry in the app)

Use the server and Stripe, not the app:

- Sign-ups per week, trial starts, trial → paid conversion (target 5–10 % for a developer tool), monthly vs yearly mix (aim for over 60 % yearly), churn (monthly under 5 %, yearly renewal over 70 %).
- The checkout funnel from Stripe (sessions created → completed).
- The website download page's own analytics, if any.
- Ask in the app, once, after 7 days: "What would make Arbora worth paying for?" with a free-text box that sends only that text when the user presses Send.

## Order of work

1. Stage 15a: accounts and sign-in, with every user on a Pro trial and no gates yet.
2. Stage 15b: Stripe Checkout, the Customer Portal, webhooks and signed entitlements.
3. Stage 15c: the gates and upgrade prompts from the table above, behind a server-side switch so they can be turned on after the website's pricing page is live.
