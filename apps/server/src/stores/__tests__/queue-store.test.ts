import { describe, expect, it } from 'vitest'
import { InMemoryQueueStore } from '../queue-store.js'

describe('InMemoryQueueStore', () => {
  it('yields entries oldest first', () => {
    const store = new InMemoryQueueStore()
    store.enqueue('s1', 'google:1', 100)
    store.enqueue('s2', 'google:2', 200)
    store.enqueue('s3', 'google:3', 300)

    expect(store.entries().map((entry) => entry.socketId)).toEqual(['s1', 's2', 's3'])
    expect(store.entries().map((entry) => entry.joinedAt)).toEqual([100, 200, 300])
  })

  it('hands back a fresh array, so a caller cannot splice the queue by accident', () => {
    const store = new InMemoryQueueStore()
    store.enqueue('s1', 'google:1', 100)
    store.enqueue('s2', 'google:2', 200)

    // The declared return type is `readonly`, so TypeScript already stops a
    // caller from splicing it. This proves the runtime agrees: every call
    // returns a new array rather than a window onto the store's own.
    const first = store.entries()
    const second = store.entries()

    expect(first).not.toBe(second)
    expect(first.map((entry) => entry.socketId)).toEqual(['s1', 's2'])
    expect(store.size()).toBe(2)
  })

  it('removes by socket id and keeps the rest in order', () => {
    const store = new InMemoryQueueStore()
    for (const id of ['s1', 's2', 's3']) store.enqueue(id, `google:${id}`, 0)

    expect(store.remove('s2')).toBe(true)

    expect(store.entries().map((entry) => entry.socketId)).toEqual(['s1', 's3'])
    expect(store.size()).toBe(2)
  })

  it('keeps its index correct after a removal, so a second removal is right too', () => {
    const store = new InMemoryQueueStore()
    for (const id of ['s1', 's2', 's3', 's4']) store.enqueue(id, `google:${id}`, 0)

    // A stale index after a splice is the bug that deletes the wrong person,
    // which shows up much later as "the wrong stranger matched me".
    store.remove('s1')
    expect(store.remove('s3')).toBe(true)

    expect(store.entries().map((entry) => entry.socketId)).toEqual(['s2', 's4'])
  })

  it('removing the head does not lose the tail', () => {
    const store = new InMemoryQueueStore()
    for (const id of ['s1', 's2', 's3']) store.enqueue(id, `google:${id}`, 0)

    store.remove('s1')

    expect(store.size()).toBe(2)
    expect(store.entries()[1]?.socketId).toBe('s3')
  })

  it('reports removing an unknown socket rather than pretending it worked', () => {
    const store = new InMemoryQueueStore()

    expect(store.remove('ghost')).toBe(false)
    expect(store.size()).toBe(0)
  })

  it('replaces rather than duplicates an entry for a socket already queued', () => {
    const store = new InMemoryQueueStore()
    store.enqueue('s1', 'google:1', 100)
    store.enqueue('s1', 'google:1', 200)

    expect(store.size()).toBe(1)
    expect(store.entries()[0]?.joinedAt).toBe(200)
  })

  it('re-enqueueing after a removal appends to the back, not the original spot', () => {
    const store = new InMemoryQueueStore()
    for (const id of ['s1', 's2', 's3']) store.enqueue(id, `google:${id}`, 0)

    store.remove('s1')
    store.enqueue('s1', 'google:1', 400)

    // Rejoining means waiting again, so the tail is the honest answer.
    expect(store.entries().map((entry) => entry.socketId)).toEqual(['s2', 's3', 's1'])
  })
})
