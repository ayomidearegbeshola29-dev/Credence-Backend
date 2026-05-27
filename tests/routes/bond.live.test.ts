import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createBondRouter } from '../../src/routes/bond.js'
import { BondStore, BondService } from '../../src/services/bond/index.js'

function createApp() {
  const store = new BondStore()
  const service = new BondService(store)
  const app = express()
  app.use('/api/bond', createBondRouter(service))
  return { app, store }
}

describe('Bond route integration', () => {
  it('returns 404 for a valid Ethereum address with no bond record', async () => {
    const { app } = createApp()

    const res = await request(app).get(
      '/api/bond/0x1234567890123456789012345678901234567890'
    )

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/No bond record found/)
  })

  it('returns 400 for an invalid bond address', async () => {
    const { app } = createApp()

    const res = await request(app).get('/api/bond/not-an-address')

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Invalid address format')
  })
})
