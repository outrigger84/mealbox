import express from 'express'
import db from '../db.js'

export const scheduleRouter = express.Router()

scheduleRouter.get('/', (req, res) => {
  const config = db.prepare('SELECT * FROM schedule_config WHERE id = 1').get()
  res.json(config)
})

scheduleRouter.patch('/', (req, res) => {
  const current = db.prepare('SELECT * FROM schedule_config WHERE id = 1').get()
  const updated = { ...current, ...req.body }
  db.prepare(`
    UPDATE schedule_config
    SET delivery_weekday = @delivery_weekday,
        order_by_weekday = @order_by_weekday,
        order_by_time = @order_by_time,
        default_order_qty = @default_order_qty,
        updated_at = datetime('now')
    WHERE id = 1
  `).run(updated)
  res.json(db.prepare('SELECT * FROM schedule_config WHERE id = 1').get())
})
