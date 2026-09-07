# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

A personal, single-user meal-delivery-subscription manager. It solves three pain points: (1) knowing which delivery to order for, given current stock and days already planned for eating elsewhere, (2) catching food before it expires unplanned, and (3) assigning delivered meals to the days they'll be eaten.

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
- `meals` — one row per physical meal item: `delivery_date` (which batch it arrived with, denormalized rather than a separate deliveries table), `expiry_date`, `assigned_date` (the calendar day chosen to eat it — this single column *is* the calendar-assignment feature, no join table), `eaten`/`eaten_date`.
- `order_plans` — optional record of intent to order for a given `delivery_date` (`planned_qty`, `ordered` flag). Not required for the core dashboard math, just a place to note what was actually ordered.
- `non_subscription_days` — flat `date` + `reason` (`eating_out`/`self_cooking`/`other`) table used to subtract non-subscription eating from demand calculations.

Dates are stored as `YYYY-MM-DD` TEXT and parsed as UTC (`new Date(str + 'T00:00:00Z')`) throughout, to avoid timezone drift — see `server/lib/dates.js` for the shared `addDays`/`daysBetween`/`todayStr` helpers.

Business logic is pure functions with no DB access, mirroring `supplement-tracker`'s `stock.js` pattern:
- `server/lib/schedule.js` — `nextDeliveryInfo()` computes the next delivery date and order-by cutoff from the fixed weekday config, rolling forward a week if the current cutoff has already passed.
- `server/lib/stock.js` — `computeOrderNeed()` counts "eating days" (calendar days minus flagged non-subscription days) until the next delivery and through the following cycle, compares against current unexpired/uneaten stock, and returns a suggested order quantity. `computeExpiryWarnings()` flags uneaten meals expiring within a few days, including whether they're still unassigned to a day.

Routes, mounted per-resource at `${BASE}/api/<resource>`:
- `/schedule` — `GET/PATCH /` (the singleton config row).
- `/meals` — `GET /` (filters: `?eaten=0`, `?unassigned=1`), `POST /`, `POST /batch` (bulk-add a delivery — one shared `delivery_date`/`expiry_date`, many names), `PATCH /:id` (also used to set/clear `assigned_date`), `POST /:id/eat`, `DELETE /:id`.
- `/order-plans` — `GET /`, `POST /` (upsert by `delivery_date`), `PATCH /:id`.
- `/non-subscription-days` — `GET /?start=&end=`, `POST /`, `DELETE /:id`.
- `/dashboard` — `GET /`: the single aggregated payload (`nextDeliveryInfo` + `computeOrderNeed` + `computeExpiryWarnings`) the Home page loads.
- `/calendar` — `GET /?start=&end=`: per-day `{date, assignedMeal, isNonSubscriptionDay, nonSubscriptionDay}` for the calendar view.

**Client**: plain `react-router-dom`, TanStack Query, Tailwind (same CSS-var theme convention as `supplement-tracker`/`reno-manager`, amber/orange accent). `client/src/api/client.js` uses the `makeEntity(slug)` CRUD factory pattern from `reno-manager`. Pages: `Home` (dashboard/reminders — the mobile landing screen), `Inventory` (bulk delivery-batch add + eaten toggle + filters), `Calendar` (14-day rolling view, tap a day to assign a meal or flag it non-subscription), `Settings` (edit the weekly schedule). `Layout` renders a sidebar nav on desktop and a bottom-tab nav on mobile — the app is used mostly from a phone day-to-day.

## Scope boundaries (deliberate)

Manual data entry only — no provider API/email import. One fixed weekly delivery/order-by cadence — no multiple concurrent subscriptions or irregular schedules. No auto-prioritization of which meal to eat — expiry info is surfaced on Home/Inventory/Calendar, the user still picks. No push notifications — "reminders" means the Home dashboard on load. No auth (single user).
