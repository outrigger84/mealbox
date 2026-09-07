import { config } from 'dotenv'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

import express from 'express'
import { scheduleRouter } from './routes/schedule.js'
import { mealsRouter } from './routes/meals.js'
import { orderPlansRouter } from './routes/order-plans.js'
import { nonSubscriptionDaysRouter } from './routes/non-subscription-days.js'
import { mealSlotsRouter } from './routes/meal-slots.js'
import { dashboardRouter } from './routes/dashboard.js'
import { calendarRouter } from './routes/calendar.js'

const app = express()
const PORT = 3011
const BASE = '/mealbox'

app.use(express.json())

app.use(`${BASE}/api/schedule`, scheduleRouter)
app.use(`${BASE}/api/meals`, mealsRouter)
app.use(`${BASE}/api/order-plans`, orderPlansRouter)
app.use(`${BASE}/api/non-subscription-days`, nonSubscriptionDaysRouter)
app.use(`${BASE}/api/meal-slots`, mealSlotsRouter)
app.use(`${BASE}/api/dashboard`, dashboardRouter)
app.use(`${BASE}/api/calendar`, calendarRouter)

app.use(BASE, express.static(join(__dirname, 'public')))

app.get(`${BASE}/*`, (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'))
})

app.get('/', (req, res) => res.redirect(BASE + '/'))

app.listen(PORT, () => {
  console.log(`mealbox running on port ${PORT} at ${BASE}/`)
})
