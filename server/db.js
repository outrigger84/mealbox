import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, 'data')
mkdirSync(dataDir, { recursive: true })

const db = new Database(join(dataDir, 'mealbox.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS schedule_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    delivery_weekday INTEGER NOT NULL DEFAULT 2,
    order_by_weekday INTEGER NOT NULL DEFAULT 5,
    order_by_time TEXT,
    default_order_qty INTEGER NOT NULL DEFAULT 7,
    breakfast_enabled INTEGER NOT NULL DEFAULT 0,
    lunch_enabled INTEGER NOT NULL DEFAULT 1,
    dinner_enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_date TEXT NOT NULL UNIQUE,
    ordered INTEGER NOT NULL DEFAULT 0,
    planned_qty INTEGER,
    notes TEXT,
    received_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    delivery_date TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    assigned_date TEXT,
    eaten INTEGER NOT NULL DEFAULT 0,
    eaten_date TEXT,
    frozen_at TEXT,
    freeze_type TEXT CHECK (freeze_type IN ('light','deep')),
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_plan_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_plan_id INTEGER NOT NULL REFERENCES order_plans(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    received INTEGER NOT NULL DEFAULT 0,
    meal_id INTEGER REFERENCES meals(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS non_subscription_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL DEFAULT 'other',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS meal_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner')),
    status TEXT NOT NULL CHECK (status IN ('subscription','not_subscription','freezer')),
    meal_id INTEGER REFERENCES meals(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(date, meal_type)
  );
`)

migrate()
seed()

function migrate() {
  const orderPlanColumns = db.prepare("PRAGMA table_info(order_plans)").all().map((c) => c.name)
  if (!orderPlanColumns.includes('received_at')) {
    db.exec('ALTER TABLE order_plans ADD COLUMN received_at TEXT')
  }

  const mealSlotColumns = db.prepare("PRAGMA table_info(meal_slots)").all().map((c) => c.name)
  if (!mealSlotColumns.includes('meal_id')) {
    db.exec('ALTER TABLE meal_slots ADD COLUMN meal_id INTEGER REFERENCES meals(id) ON DELETE SET NULL')
  }

  const mealColumns = db.prepare("PRAGMA table_info(meals)").all().map((c) => c.name)
  if (!mealColumns.includes('frozen_at')) {
    db.exec('ALTER TABLE meals ADD COLUMN frozen_at TEXT')
  }
  if (!mealColumns.includes('freeze_type')) {
    db.exec("ALTER TABLE meals ADD COLUMN freeze_type TEXT CHECK (freeze_type IN ('light','deep'))")
  }

  const scheduleColumns = db.prepare("PRAGMA table_info(schedule_config)").all().map((c) => c.name)
  if (!scheduleColumns.includes('breakfast_enabled')) {
    db.exec('ALTER TABLE schedule_config ADD COLUMN breakfast_enabled INTEGER NOT NULL DEFAULT 0')
  }
  if (!scheduleColumns.includes('lunch_enabled')) {
    db.exec('ALTER TABLE schedule_config ADD COLUMN lunch_enabled INTEGER NOT NULL DEFAULT 1')
  }
  if (!scheduleColumns.includes('dinner_enabled')) {
    db.exec('ALTER TABLE schedule_config ADD COLUMN dinner_enabled INTEGER NOT NULL DEFAULT 1')
  }
}

function seed() {
  const configRow = db.prepare('SELECT id FROM schedule_config WHERE id = 1').get()
  if (!configRow) {
    db.prepare(`
      INSERT INTO schedule_config (id, delivery_weekday, order_by_weekday, order_by_time, default_order_qty)
      VALUES (1, 2, 5, '18:00', 7)
    `).run()
  }

  const { count } = db.prepare('SELECT COUNT(*) as count FROM meals').get()
  if (count > 0) return

  const today = new Date()
  const fmt = (d) => d.toISOString().slice(0, 10)
  const addDays = (d, n) => {
    const copy = new Date(d)
    copy.setUTCDate(copy.getUTCDate() + n)
    return copy
  }

  const deliveryDate = fmt(today)
  const insertMeal = db.prepare(`
    INSERT INTO meals (name, delivery_date, expiry_date, notes)
    VALUES (@name, @delivery_date, @expiry_date, @notes)
  `)

  const mealSeed = [
    { name: 'Chicken Tikka Masala', delivery_date: deliveryDate, expiry_date: fmt(addDays(today, 5)), notes: null },
    { name: 'Beef Lasagne', delivery_date: deliveryDate, expiry_date: fmt(addDays(today, 4)), notes: null },
    { name: 'Thai Green Curry', delivery_date: deliveryDate, expiry_date: fmt(addDays(today, 6)), notes: null },
  ]

  for (const m of mealSeed) insertMeal.run(m)
}

export default db
