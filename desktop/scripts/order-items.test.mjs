import test from 'node:test'
import assert from 'node:assert/strict'
import { appendOrderItems } from '../src/shared/orderItems.mjs'

function context(post) {
  const values = new Map()
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) }
  const calls = []
  return {
    api: { post: (...args) => { calls.push(args); return post(...args) } },
    storage, server: Math.random().toString(), orderId: 'order-1',
    lines: [{lineId:'draft-1',product:{id:'dish-1'},qty:2}], newKey: () => 'key-1',
    calls, values,
  }
}
test('duplicate clicks share one batch and a stable key', async () => {
  let finish
  const options = context(() => new Promise(resolve => { finish=resolve }))
  const first = appendOrderItems(options)
  const second = appendOrderItems(options)
  assert.equal(first, second)
  await Promise.resolve()
  finish({data:{id:'order-1',items:[]}})
  assert.deepEqual(await first, {order:{id:'order-1',items:[]},sentIds:['draft-1']})
  assert.equal(options.calls.length, 1)
  assert.equal(options.values.size, 0)
})
test('timeout retries the original batch even if new draft lines were added', async () => {
  let fail = true
  const options = context(() => {
    if (fail) return Promise.reject(new Error('timeout'))
    return Promise.resolve({data:{id:'order-1',items:[]}})
  })
  await assert.rejects(appendOrderItems(options))
  fail = false
  options.lines.push({lineId:'draft-2',product:{id:'dish-2'},qty:1})
  const result = await appendOrderItems(options)
  assert.deepEqual(options.calls[0][1],options.calls[1][1])
  assert.deepEqual(options.calls[0][2],options.calls[1][2])
  assert.deepEqual(result.sentIds,['draft-1'])
})
