// Parses a pasted "your box" summary (e.g. from simmereats.com/client) into meal names.
// Expected repeating pattern per meal — name, then a quantity marker, then macros:
//   "<name>x<quantity><calories> kcal / <protein>g Protein"
// The site sometimes puts these on separate lines when copied, so whitespace
// (including newlines, via the 's' flag on '.') between every token is tolerated.
// The page also sometimes prepends "YOUR BOX" and/or "edit order" chrome (in either
// order, with or without a space between them) — stripped out before matching since
// neither ever appears as part of a real meal name.
// Quantity is always a single digit (the site doesn't sell 10+ of one meal) — captured
// separately from the calorie count so a "2" quantity doesn't get greedily absorbed into it.
const MEAL_PATTERN = /(.+?)\s*x\s*(\d)\s*\d+\s*kcal\s*\/\s*[\d.]+\s*g\s*Protein/gis

export function parseBoxPaste(rawText) {
  const cleaned = rawText.replace(/your box/gi, '').replace(/edit order/gi, '').trim()
  const names = []
  let match
  while ((match = MEAL_PATTERN.exec(cleaned)) !== null) {
    const name = match[1].replace(/\s+/g, ' ').trim()
    const quantity = parseInt(match[2], 10)
    if (name) {
      for (let i = 0; i < quantity; i++) names.push(name)
    }
  }
  return names
}
