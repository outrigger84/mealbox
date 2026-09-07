const BASE = '/mealbox/api'

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
  if (res.status === 204) return null
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

function makeEntity(slug) {
  return {
    list: (query) => request('GET', `/${slug}${query ? `?${query}` : ''}`),
    get: (id) => request('GET', `/${slug}/${id}`),
    create: (data) => request('POST', `/${slug}`, data),
    update: (id, data) => request('PATCH', `/${slug}/${id}`, data),
    delete: (id) => request('DELETE', `/${slug}/${id}`),
  }
}

export const meals = {
  ...makeEntity('meals'),
  batchCreate: (data) => request('POST', '/meals/batch', data),
  markEaten: (id) => request('POST', `/meals/${id}/eat`),
  markUneaten: (id) => request('POST', `/meals/${id}/uneat`),
  freeze: (id, freeze_type) => request('POST', `/meals/${id}/freeze`, { freeze_type }),
  unfreeze: (id) => request('POST', `/meals/${id}/unfreeze`),
}

export const orderPlans = {
  ...makeEntity('order-plans'),
  listPending: () => request('GET', '/order-plans?pending=1'),
  logOrder: (delivery_date, names) => request('POST', '/order-plans/paste', { delivery_date, names }),
  receipt: (id, default_expiry_date, items) => request('POST', `/order-plans/${id}/receipt`, { default_expiry_date, items }),
}

export const nonSubscriptionDays = {
  ...makeEntity('non-subscription-days'),
  listRange: (start, end) => request('GET', `/non-subscription-days?start=${start}&end=${end}`),
}

export const mealSlots = {
  listRange: (start, end) => request('GET', `/meal-slots?start=${start}&end=${end}`),
  setStatus: (date, meal_type, status) => request('PUT', '/meal-slots', { date, meal_type, status }),
  assignMeal: (date, meal_type, meal_id) => request('PUT', '/meal-slots/meal', { date, meal_type, meal_id }),
  setNote: (date, meal_type, note) => request('PUT', '/meal-slots/note', { date, meal_type, note }),
}

export const dashboard = {
  get: () => request('GET', '/dashboard'),
  getProjection: (periods) => request('GET', `/dashboard/projection?periods=${periods}`),
}

export const calendar = {
  getRange: (start, end) => request('GET', `/calendar?start=${start}&end=${end}`),
}

export const wallplan = {
  getRange: (start, end) => request('GET', `/wallplan?start=${start}&end=${end}`),
}

export const schedule = {
  get: () => request('GET', '/schedule'),
  update: (data) => request('PATCH', '/schedule', data),
  getCycle: (offset = 0) => request('GET', `/schedule/cycle?offset=${offset}`),
}
