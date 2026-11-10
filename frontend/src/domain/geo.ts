/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export function pathKm(points: { lat: number; lng: number }[]) {
  let d = 0
  for (let i = 1; i < points.length; i++) d += haversineKm(points[i - 1]!, points[i]!)
  return d
}

/**
 * Sequence suggestion: nearest-neighbour from the current first stop, then 2-opt improvement.
 * Good enough for 5–80 stops on a phone, no routing server needed.
 */
export function suggestSequence<T extends { lat: number; lng: number }>(stops: T[]): T[] {
  if (stops.length < 3) return stops
  const left = stops.slice(1)
  const out = [stops[0]!]
  while (left.length) {
    const last = out[out.length - 1]!
    let bi = 0
    let bd = Infinity
    left.forEach((s, i) => {
      const d = haversineKm(last, s)
      if (d < bd) {
        bd = d
        bi = i
      }
    })
    out.push(left.splice(bi, 1)[0]!)
  }
  let improved = true
  while (improved) {
    improved = false
    for (let i = 1; i < out.length - 2; i++) {
      for (let k = i + 1; k < out.length - 1; k++) {
        const before = haversineKm(out[i - 1]!, out[i]!) + haversineKm(out[k]!, out[k + 1]!)
        const after = haversineKm(out[i - 1]!, out[k]!) + haversineKm(out[i]!, out[k + 1]!)
        if (after + 1e-9 < before) {
          out.splice(i, k - i + 1, ...out.slice(i, k + 1).reverse())
          improved = true
        }
      }
    }
  }
  return out
}
