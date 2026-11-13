const pending = new Map()

export function appendOrderItems({ api, storage, server, orderId, lines, newKey = () => crypto.randomUUID() }) {
  const slot = `marjon_order_append:${encodeURIComponent(server)}:${orderId}`
  if (pending.has(slot)) return pending.get(slot)
  const request = Promise.resolve().then(async () => {
    let attempt = JSON.parse(storage.getItem(slot) || 'null')
    if (!attempt) {
      attempt = {
        key: `desktop-append:${newKey()}`,
        lineIds: lines.map(line => line.lineId),
        items: lines.map(line => ({
          product_id: line.product.id, quantity: line.qty, note: line.note || null,
          takeaway: !!line.takeaway, modifiers: line.modifiers || [],
        })),
      }
      storage.setItem(slot, JSON.stringify(attempt))
    }
    if (!attempt.key || !Array.isArray(attempt.lineIds) || !Array.isArray(attempt.items)) {
      throw new Error('Invalid pending order addition')
    }
    try {
      const { data } = await api.post(`/pos/orders/${orderId}/items/bulk`, {
        items: attempt.items,
      }, { headers: { 'Idempotency-Key': attempt.key } })
      if (data?.id !== orderId || !Array.isArray(data.items)) throw new Error('Order addition was not confirmed')
      storage.removeItem(slot)
      return { order: data, sentIds: attempt.lineIds }
    } catch (error) {
      if ([400, 401, 403, 404, 405, 422].includes(error?.response?.status)) storage.removeItem(slot)
      throw error
    }
  }).finally(() => pending.delete(slot))
  pending.set(slot, request)
  return request
}
