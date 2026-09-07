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
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_date TEXT NOT NULL UNIQUE,
    ordered INTEGER NOT NULL DEFAULT 0,
    planned_qty INTEGER,
    notes TEXT,
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
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS non_subscription_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL DEFAULT 'other',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`)

seed()

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
