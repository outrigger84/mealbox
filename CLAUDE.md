# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

A personal, single-user meal-delivery-subscription manager. It solves three pain points: (1) knowing which delivery to order for, given current stock and days already planned for eating elsewhere, (2) catching food before it expires unplanned, and (3) assigning delivered meals to the days they'll be eaten. Ordering and delivery are treated as two distinct real-world events (log the order, then separately receipt what actually arrives) rather than one step.

This app is part of a fleet of independent apps behind nginx/PM2 on this server — see `/root/SYSTEM.md` for the shared architecture (base path, port, PM2, nginx conventions) and `/root/CLAUDE.md` for the fleet index. This file covers only what's specific to `mealbox` (port 3011, base `/mealbox`).

## Commands

```bash
npm run dev      # concurrently runs server (Express) + client (Vite)
npm run build    # vite build, output to server/public/
npm run start    # starts Express server
```

No test suite exists for this app.

## Architecture

**Server**: SQLite at `server/data/mealbox.db`.

Tables:
- `schedule_config` — single-row (`id=1`) settings: fixed weekly `delivery_weekday`/`order_by_weekday` (0=Sun..6=Sat), display-only `order_by_time`, `default_order_qty`.
- `meals` — one row per physical meal item, created only once a delivery is receipted (either via the order→receipt flow or a manual add): `delivery_date` (which batch it arrived with, denormalized rather than a separate deliveries table), `expiry_date`, `assigned_date` (the calendar day chosen to eat it — this single column *is* the calendar-assignment feature, no join table), `eaten`/`eaten_date`.
- `order_plans` — a logged order: `delivery_date` (expected), `planned_qty`, `received_at` (null until the delivery is receipted — this is what "pending receipt" means).
- `order_plan_items` — the expected meal names for an order plan, parsed from the pasted box-contents summary at order time. Each row tracks `received` (set during receipt) and `meal_id` (linked to the `meals` row created for it, or left null if that item didn't actually arrive).
- `non_subscription_days` — flat `date` + `reason` (`eating_out`/`self_cooking`/`other`) table used to subtract non-subscription eating from demand calculations.

Dates are stored as `YYYY-MM-DD` TEXT and parsed as UTC (`new Date(str + 'T00:00:00Z')`) throughout, to avoid timezone drift — see `server/lib/dates.js` for the shared `addDays`/`daysBetween`/`todayStr` helpers.

Business logic is pure functions with no DB access, mirroring `supplement-tracker`'s `stock.js` pattern:
- `server/lib/schedule.js` — `nextDeliveryInfo()` computes the next delivery date and order-by cutoff from the fixed weekday config, rolling forward a week if the current cutoff has already passed.
- `server/lib/stock.js` — `computeOrderNeed()` counts "eating days" (calendar days minus flagged non-subscription days) until the next delivery and through the following cycle, compares against current unexpired/uneaten stock, and returns a suggested order quantity. `computeExpiryWarnings()` flags uneaten meals expiring within a few days, including whether they're still unassigned to a day.

Routes, mounted per-resource at `${BASE}/api/<resource>`:
- `/schedule` — `GET/PATCH /` (the singleton config row).
- `/meals` — `GET /` (filters: `?eaten=0`, `?unassigned=1`), `POST /` (single manual add — for a meal not from a logged delivery), `POST /batch` (bulk-add with a shared `delivery_date`/`expiry_date`, kept for scripting/back-compat but the UI no longer surfaces it directly), `PATCH /:id` (also used to set/clear `assigned_date`), `POST /:id/eat`, `DELETE /:id`.
- `/order-plans` — `GET /` (add `?pending=1` for orders awaiting receipt), `GET /:id`, `POST /paste` (log an order: `{delivery_date, names}` from the parsed box-contents paste — creates/updates the order plan and its `order_plan_items`), `POST /:id/receipt` (`{default_expiry_date, items:[{id, received, expiry_date?}]}` — for each received item, creates the actual `meals` row using its expiry override or the default, and stamps `received_at`), plus plain `POST /`/`PATCH /:id` for manual order-plan edits.
- `/non-subscription-days` — `GET /?start=&end=`, `POST /`, `DELETE /:id`.
- `/dashboard` — `GET /`: the aggregated payload (`nextDeliveryInfo` + `computeOrderNeed` + `computeExpiryWarnings` + `pendingReceipts`, the last being any order plan whose delivery date has passed but hasn't been receipted) the Home page loads.
- `/calendar` — `GET /?start=&end=`: per-day `{date, assignedMeal, isNonSubscriptionDay, nonSubscriptionDay}` for the calendar view.

**Client**: plain `react-router-dom`, TanStack Query, Tailwind (same CSS-var theme convention as `supplement-tracker`/`reno-manager`, amber/orange accent). `client/src/api/client.js` uses the `makeEntity(slug)` CRUD factory pattern from `reno-manager`. Pages: `Home` (dashboard/reminders, including a banner linking to Deliveries when something needs receipting — the mobile landing screen), `Deliveries` (two tabs: **Log order** — paste the box-contents summary from the ordering site, parsed client-side by `client/src/lib/parseBoxPaste.js` into meal names via `POST /order-plans/paste`; **Receive delivery** — pick a pending order plan, check off what actually arrived, set a default expiry date with per-item override, `POST /order-plans/:id/receipt`), `Inventory` (manual single-meal add for ad-hoc entries + eaten toggle + filters — bulk entry lives in Deliveries now), `Calendar` (14-day rolling view, tap a day to assign a meal or flag it non-subscription), `Settings` (edit the weekly schedule). `Layout` renders a sidebar nav on desktop and a bottom-tab nav on mobile — the app is used mostly from a phone day-to-day.

`parseBoxPaste.js` expects the site's repeating `<meal name>x1<calories> kcal / <protein>g Protein` pattern (observed on simmereats.com's box-contents summary) with no separator between entries — if the ordering site's format ever changes, that regex is the only place to update; it's deliberately isolated from the rest of the order-logging flow.

## Scope boundaries (deliberate)

Manual data entry only — no live provider API integration, just paste-and-parse of a manually copied page snippet. One fixed weekly delivery/order-by cadence — no multiple concurrent subscriptions or irregular schedules. No auto-prioritization of which meal to eat — expiry info is surfaced on Home/Inventory/Calendar, the user still picks. No push notifications — "reminders" means the Home dashboard on load. No auth (single user).
