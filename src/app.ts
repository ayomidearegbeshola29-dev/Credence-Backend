import express from 'express'
import { createHealthRouter } from './routes/health.js'
import { createDefaultProbes } from './services/health/probes.js'
import trustRouter from './routes/trust.js'
import bulkRouter from './routes/bulk.js'
import { createAdminRouter } from './routes/admin/index.js'
import { createAnalyticsRouter } from './routes/analytics.js'
import { AnalyticsService } from './services/analytics/service.js'
import { pool } from './db/pool.js'
import { validate } from './middleware/validate.js'
import {
  buildPaginationMeta,
  PaginationValidationError,
  parsePaginationParams,
} from './lib/pagination.js'
import {
  bondPathParamsSchema,
  attestationsPathParamsSchema,
  createAttestationBodySchema,
} from './schemas/index.js'
import { compressionMiddleware, compressionMetricsMiddleware } from './middleware/compression.js'
import { metricsMiddleware, register } from './middleware/metrics.js'
import { createWebhookRouter } from './routes/webhooks.js'
import { MemoryWebhookStore } from './services/webhooks/memoryStore.js'
import { auditLogService } from './services/audit/index.js'

const app = express()

// Metrics endpoint for Prometheus
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType)
  res.end(await register.metrics())
})

app.use(metricsMiddleware)
app.use(compressionMetricsMiddleware)
app.use(compressionMiddleware)
app.use(express.json())
// Health – full readiness check with per-dependency status
const healthProbes = createDefaultProbes()
app.use('/api/health', createHealthRouter(healthProbes))

// Trust score
app.use('/api/trust', trustRouter)

// Bond status (stub – to be wired to Horizon in a future milestone)
app.get(
  '/api/bond/:address',
  validate({ params: bondPathParamsSchema }),
  (req, res) => {
    const { address } = req.validated!.params! as { address: string }
    res.json({
      address,
      bondedAmount: '0',
      bondStart: null,
      bondDuration: null,
      active: false,
    })
  },
)

// Attestations – list
app.get(
  '/api/attestations/:address',
  validate({ params: attestationsPathParamsSchema }),
  (req, res) => {
    const { address } = req.validated!.params! as { address: string }
    try {
      const { page, limit, offset } = parsePaginationParams(req.query as Record<string, unknown>)
      res.json({
        address,
        attestations: [],
        offset,
        ...buildPaginationMeta(0, page, limit),
      })
    } catch (error) {
      if (error instanceof PaginationValidationError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.details,
        })
        return
      }

      throw error
    }
  },
)

// Attestations – create
app.post(
  '/api/attestations',
  validate({ body: createAttestationBodySchema }),
  (req, res) => {
    const body = req.validated!.body! as { subject: string; value: string; key?: string }
    res.status(201).json({
      subject: body.subject,
      value: body.value,
      key: body.key ?? null,
    })
  },
)

// Bulk verification (enterprise)
app.use('/api/bulk', bulkRouter)

// Admin API
app.use('/api/admin', createAdminRouter())

// Webhook management (secret rotation, etc.)
const webhookStore = new MemoryWebhookStore()
app.use('/api/webhooks', createWebhookRouter(webhookStore, auditLogService))

const analyticsThresholdSeconds = Number(process.env.ANALYTICS_STALENESS_SECONDS ?? '300')
const analyticsService = process.env.DATABASE_URL
  ? new AnalyticsService(pool, analyticsThresholdSeconds)
  : undefined
app.use('/api/analytics', createAnalyticsRouter(analyticsService))

export default app
