import express from 'express'
import { getWallplanEvents } from '../lib/wallplanClient.js'

export const wallplanRouter = express.Router()

wallplanRouter.get('/', async (req, res) => {
  const { start, end } = req.query
  if (!start || !end) return res.status(400).json({ error: 'start and end are required' })
  res.json(await getWallplanEvents(start, end))
})
