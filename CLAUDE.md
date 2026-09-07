# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

A personal, single-user meal-delivery-subscription manager. It solves three pain points: (1) knowing which delivery to order for, given current stock and days already planned for eating elsewhere, (2) catching food before it expires unplanned — including flagging which meals should go in the freezer, based on an actual Breakfast/Lunch/Dinner consumption plan rather than a guess, and (3) planning which meal-slots will use a subscription meal. Ordering and delivery are treated as two distinct real-world events (log the order, then separately receipt what actually arrives) rather than one step.

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
- `meals` — one row per physical meal item, created only once a delivery is receipted (either via the order→receipt flow or a manual add): `delivery_date` (which batch it arrived with, denormalized rather than a separate deliveries table), `expiry_date`, `assigned_date` (unused by any current UI — a leftover single-meal-per-day assignment column from before the slot planner; not wired up, safe to repurpose), `eaten`/`eaten_date`.
- `order_plans` — a logged order: `delivery_date` (expected), `planned_qty`, `received_at` (null until the delivery is receipted — this is what "pending receipt" means).
- `order_plan_items` — the expected meal names for an order plan, parsed from the pasted box-contents summary at order time. Each row tracks `received` (set during receipt) and `meal_id` (linked to the `meals` row created for it, or left null if that item didn't actually arrive).
- `non_subscription_days` — flat `date` + `reason` (`eating_out`/`self_cooking`/`other`) table. Still read by `computeOrderNeed` for the Home dashboard's order-need number, but there's no UI to write to it any more (the old Calendar day-level flag was replaced by the slot planner below) — this stat and the slot planner are deliberately *not* unified yet (see `meal_slots`), so in practice this table stays empty and order-need falls back to assuming every day is an eating day.
- `meal_slots` — the Breakfast/Lunch/Dinner planner: `date` + `meal_type` (`breakfast`/`lunch`/`dinner`) + `status` (`subscription`/`not_subscription`/`freezer`), `UNIQUE(date, meal_type)`. Sparse by design — a day/slot with no row is "undecided"; there is no stored `undecided` status. Tapping a slot in the UI cycles undecided → subscription → not_subscription → freezer → undecided, each step a `PUT /meal-slots` that either upserts a row or deletes it (status `null`) to go back to undecided.

Dates are stored as `YYYY-MM-DD` TEXT and parsed as UTC (`new Date(str + 'T00:00:00Z')`) throughout, to avoid timezone drift — see `server/lib/dates.js` for the shared `addDays`/`daysBetween`/`todayStr` helpers.

Business logic is pure functions with no DB access, mirroring `supplement-tracker`'s `stock.js` pattern:
- `server/lib/schedule.js` — `nextDeliveryInfo()` computes the next delivery date and order-by cutoff from the fixed weekday config, rolling forward a week if the current cutoff has already passed.
- `server/lib/stock.js` — `computeOrderNeed()` counts "eating days" (calendar days minus flagged non-subscription days) until the next delivery and through the following cycle, compares against current unexpired/uneaten stock, and returns a suggested order quantity. `computeExpiryWarnings()` flags uneaten meals expiring within a few days. `computeFreezerCandidates()` greedily matches uneaten stock (earliest-expiring first) against planned `subscription`-status slot dates (earliest first, from `meal_slots`) — any meal that can't be matched to a slot on or before its own expiry date will expire unused under the current plan, so it's returned as a freezer candidate. Only explicitly-planned `subscription` slots count as consumption; `undecided` slots count as zero (this function is intentionally independent from `computeOrderNeed`'s day-level assumption — see the `meal_slots`/`non_subscription_days` note above).

Routes, mounted per-resource at `${BASE}/api/<resource>`:
- `/schedule` — `GET/PATCH /` (the singleton config row).
- `/meals` — `GET /` (filters: `?eaten=0`, `?unassigned=1`), `POST /` (single manual add — for a meal not from a logged delivery), `POST /batch` (bulk-add with a shared `delivery_date`/`expiry_date`, kept for scripting/back-compat but the UI no longer surfaces it directly), `PATCH /:id` (also used to set/clear `assigned_date`), `POST /:id/eat`, `DELETE /:id`.
- `/order-plans` — `GET /` (add `?pending=1` for orders awaiting receipt), `GET /:id`, `POST /paste` (log an order: `{delivery_date, names}` from the parsed box-contents paste — creates/updates the order plan and its `order_plan_items`), `POST /:id/receipt` (`{default_expiry_date, items:[{id, received, expiry_date?}]}` — for each received item, creates the actual `meals` row using its expiry override or the default, and stamps `received_at`), plus plain `POST /`/`PATCH /:id` for manual order-plan edits.
- `/non-subscription-days` — `GET /?start=&end=`, `POST /`, `DELETE /:id`. Backend only now — no UI writes to this (see `meal_slots` note above).
- `/meal-slots` — `GET /?start=&end=` (sparse list — only non-undecided rows exist), `PUT /` (`{date, meal_type, status}`; `status: null` deletes the row, resetting to undecided).
- `/dashboard` — `GET /`: the aggregated payload (`nextDeliveryInfo` + `computeOrderNeed` + `computeExpiryWarnings` + `pendingReceipts` + `freezerCandidates`) the Home page loads. `pendingReceipts` is any order plan whose delivery date has passed but hasn't been receipted; `freezerCandidates` comes from `computeFreezerCandidates` fed by current stock and `subscription`-status `meal_slots`.
- `/calendar` — `GET /?start=&end=`: legacy per-day `{date, assignedMeal, isNonSubscriptionDay, nonSubscriptionDay}` endpoint from the pre-slot-planner Calendar. No longer called by any page; kept only because nothing has asked to remove it yet.

**Client**: plain `react-router-dom`, TanStack Query, Tailwind (same CSS-var theme convention as `supplement-tracker`/`reno-manager`, amber/orange accent). `client/src/api/client.js` uses the `makeEntity(slug)` CRUD factory pattern from `reno-manager`. Pages: `Home` (dashboard/reminders — order-need banner, freezer-candidates card, expiry warnings, and a banner linking to Deliveries when something needs receipting — the mobile landing screen), `Deliveries` (two tabs: **Log order** — paste the box-contents summary from the ordering site, parsed client-side by `client/src/lib/parseBoxPaste.js` into meal names via `POST /order-plans/paste`; **Receive delivery** — pick a pending order plan, check off what actually arrived, set a default expiry date with per-item override, `POST /order-plans/:id/receipt`), `Inventory` (manual single-meal add for ad-hoc entries + eaten toggle + filters — bulk entry lives in Deliveries now), `Calendar` (14-day rolling Breakfast/Lunch/Dinner slot planner — tap a slot to cycle undecided → subscription → not_subscription → freezer), `Settings` (edit the weekly schedule). `Layout` renders a sidebar nav on desktop and a bottom-tab nav on mobile — the app is used mostly from a phone day-to-day.

The Calendar page is planning-only right now — it doesn't yet let you pick *which* specific stock meal fills a `subscription` slot (that's an intentionally deferred "level 2" of detail); it only tracks the yes/no/freezer decision per slot, which is what `computeFreezerCandidates` needs.

`parseBoxPaste.js` expects the site's repeating `<meal name>x1<calories> kcal / <protein>g Protein` pattern (observed on simmereats.com's box-contents summary) with no separator between entries — if the ordering site's format ever changes, that regex is the only place to update; it's deliberately isolated from the rest of the order-logging flow.

## Scope boundaries (deliberate)

Manual data entry only — no live provider API integration, just paste-and-parse of a manually copied page snippet. One fixed weekly delivery/order-by cadence — no multiple concurrent subscriptions or irregular schedules. No auto-prioritization of which meal to eat — expiry info is surfaced on Home/Inventory/Calendar, the user still picks. No push notifications — "reminders" means the Home dashboard on load. No auth (single user).
