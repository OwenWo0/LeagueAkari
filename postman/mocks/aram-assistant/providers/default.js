/**
 * Local ARAM vision provider mock for e2e / simulation.
 * Routes by x-akari-e2e-scenario header or prompt contents.
 */
const http = require('http')
const { detectScenario, extractPromptText, responseForScenario } = require('./scenario-responses')

const PORT = process.env.PORT || 4900

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function resolveScenario(req, payload) {
  const forced = String(req.headers['x-akari-e2e-scenario'] || '')
    .trim()
    .toLowerCase()
  if (forced === 'opening-match' || forced === 'augment-pick' || forced === 'probe') {
    return forced
  }
  return detectScenario(extractPromptText(payload))
}

function resolveLocale(req) {
  const header = String(req.headers['x-akari-e2e-locale'] || '')
    .trim()
    .toLowerCase()
  return header === 'en' ? 'en' : 'zh'
}

function openaiEnvelope(text, model) {
  return {
    id: 'chatcmpl-e2e-mock',
    object: 'chat.completion',
    model: typeof model === 'string' && model ? model : 'e2e-mock',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: text }
      }
    ]
  }
}

function geminiEnvelope(text) {
  return {
    candidates: [
      {
        finishReason: 'STOP',
        content: { role: 'model', parts: [{ text }] }
      }
    ]
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '', 'http://localhost')
  const pathname = url.pathname.replace(/^\/providers(?=\/)/, '')

  if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(
      JSON.stringify({
        ok: true,
        scenarios: ['opening-match', 'augment-pick', 'probe']
      })
    )
  }

  try {
    // @endpoint POST /openai/v1/chat/completions  (also /providers/openai/...)
    if (req.method === 'POST' && pathname === '/openai/v1/chat/completions') {
      const payload = await readJsonBody(req)
      const scenario = resolveScenario(req, payload)
      const text = responseForScenario(scenario, extractPromptText(payload), resolveLocale(req))
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'x-akari-e2e-scenario': scenario
      })
      return res.end(JSON.stringify(openaiEnvelope(text, payload.model)))
    }

    // @endpoint POST /gemini/v1beta/models/{{model}}:generateContent
    if (
      req.method === 'POST' &&
      /^\/gemini\/v1beta\/models\/([^/]+):generateContent$/.test(pathname)
    ) {
      const payload = await readJsonBody(req)
      const scenario = resolveScenario(req, payload)
      const text = responseForScenario(scenario, extractPromptText(payload), resolveLocale(req))
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'x-akari-e2e-scenario': scenario
      })
      return res.end(JSON.stringify(geminiEnvelope(text)))
    }
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    return res.end(
      JSON.stringify({
        error: { message: String(error?.message || error), type: 'invalid_request_error' }
      })
    )
  }

  res.writeHead(501, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Endpoint not defined in this fixture contract' }))
})

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[aram-assistant-mock] listening on http://127.0.0.1:${PORT}`)
})
