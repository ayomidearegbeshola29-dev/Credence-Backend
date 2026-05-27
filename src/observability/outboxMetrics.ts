import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)

let _promClient: any | null | undefined = undefined
function tryLoadPromClient() {
    if (_promClient !== undefined) return _promClient
    try {
        _promClient = _require('prom-client')
    } catch {
        _promClient = null
    }
    return _promClient
}

let _deadLetterCounter: any | undefined = undefined

export function incrementOutboxDeadLetter(errorCode: string = 'UNKNOWN') {
    const prom = tryLoadPromClient()
    if (!prom) return

    if (!_deadLetterCounter) {
        try {
            _deadLetterCounter = new prom.Counter({
                name: 'outbox_dead_letter_total',
                help: 'Total number of outbox events moved to dead-letter',
                labelNames: ['error_code'],
                registers: [prom.register],
            })
        } catch {
            _deadLetterCounter = null
        }
    }

    if (_deadLetterCounter) {
        try {
            _deadLetterCounter.inc({ error_code: errorCode }, 1)
        } catch {
            // swallow metric errors
        }
    }
}

export function _resetOutboxMetricsCacheForTests(): void {
    _promClient = undefined
    _deadLetterCounter = undefined
}
