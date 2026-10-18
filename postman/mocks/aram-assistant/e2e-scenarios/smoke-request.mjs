#!/usr/bin/env node
/**
 * L1 contract smoke for the ARAM assistant local provider mock.
 *
 *   node postman/mocks/aram-assistant/e2e-scenarios/smoke-request.mjs
 *
 * - starts the mock on :4900 when /health is not already up
 * - POSTs opening / augment (with image) / probe prompts to /openai/v1/chat/completions
 * - asserts HTTP status, echoed model, non-empty content, [e2e:…] anchors and section titles
 * - exits 0 only when every scenario passes
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROVIDER = path.resolve(HERE, '../providers/default.js')
const MODEL = 'e2e-smoke-model'
const BASE_URL = (
  process.env.ARAM_MOCK_BASE_URL || `http://127.0.0.1:${process.env.PORT || '4900'}`
).replace(/\/+$/, '')
const PORT = new URL(BASE_URL).port || '4900'

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

const OPENING_PROMPT = [
  'You are a League of Legends ARAM Mayhem assistant.',
  'Mode: aram_mayhem',
  '## Champion & role evidence',
  'Champion: Annie',
  'Mayhem stats: none available for this champion; continue with role judgment only.',
  '## Lineup',
  'Phase: InProgress',
  'Allies: Annie, Olaf, Galio, Twitch, Sona',
  '## Screenshot / cards & catalog',
  'Pick input: no screenshot and no local cards were supplied.',
  '## Output contract',
  'Task: short lineup plan for this champion.',
  '1) 定位 — one short line on role / job this game',
  '2) 出装 — core items and optional situational buys',
  '3) 打法 — 3-5 short bullets on how to play with this team'
].join('\n')

const AUGMENT_PROMPT = [
  'You are a League of Legends ARAM Mayhem assistant.',
  'Mode: aram_mayhem',
  '## Champion & role evidence',
  'Champion: Veigar',
  '## Lineup',
  'Phase: InProgress',
  '## Screenshot / cards & catalog',
  'Pick input: one screenshot is attached. Identify only the three currently offered cards that are clearly legible.',
  '## Output contract',
  'Task: choose one offered card, then give build and play tips.',
  '1) 推荐 — one card name + one short reason',
  '2) 出装 — core items and optional situational buys for that pick',
  '3) 打法 — 3-5 short bullets for this champion with the pick'
].join('\n')

const PROBE_PROMPT =
  'This is a League Akari vision connectivity probe. Reply with exactly PROBE_OK, then one short English word describing the image. No other text.'

let child = null
let startedByUs = false

async function mockHealth() {
  try {
    const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(800) })
    return response.ok
  } catch {
    return false
  }
}

async function waitForHealth(timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await mockHealth()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

async function startMockIfNeeded() {
  if (await mockHealth()) {
    console.log(`[smoke] reusing mock at ${BASE_URL}`)
    return
  }
  startedByUs = true
  child = spawn(process.execPath, [PROVIDER], {
    env: { ...process.env, PORT },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stderr.on('data', (chunk) => process.stderr.write(`[mock] ${chunk}`))
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`[mock] exited with code ${code}`)
  })
  if (!(await waitForHealth())) {
    throw new Error(`mock did not become healthy at ${BASE_URL}/health within 8s`)
  }
  console.log(`[smoke] started mock at ${BASE_URL}`)
}

async function stopMock() {
  if (!child || !startedByUs) return
  if (child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000))
    ])
  }
  child = null
}

async function postChat({ prompt, withImage = false, scenarioHeader }) {
  const content = [{ type: 'text', text: prompt }]
  if (withImage) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${PNG_1X1}` }
    })
  }
  const headers = { 'Content-Type': 'application/json' }
  if (scenarioHeader) headers['x-akari-e2e-scenario'] = scenarioHeader
  const response = await fetch(`${BASE_URL}/openai/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content }], temperature: 0.3 })
  })
  const raw = await response.text()
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    throw new Error(`response was not JSON (status ${response.status}): ${raw.slice(0, 200)}`)
  }
  return {
    status: response.status,
    scenarioHeader: response.headers.get('x-akari-e2e-scenario'),
    body,
    text: body?.choices?.[0]?.message?.content ?? ''
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function verify(name, result, expectedScenario, anchors) {
  assert(result.status === 200, `${name}: expected HTTP 200, got ${result.status}`)
  assert(
    result.scenarioHeader === expectedScenario,
    `${name}: expected scenario header ${expectedScenario}, got ${result.scenarioHeader}`
  )
  assert(
    result.body?.model === MODEL,
    `${name}: expected echoed model ${MODEL}, got ${result.body?.model}`
  )
  assert(result.body?.object === 'chat.completion', `${name}: unexpected response object`)
  assert(
    Array.isArray(result.body?.choices) && result.body.choices.length === 1,
    `${name}: choices`
  )
  assert(result.body.choices[0]?.finish_reason === 'stop', `${name}: finish_reason`)
  assert(typeof result.text === 'string' && result.text.trim().length > 0, `${name}: empty content`)
  for (const anchor of anchors) {
    assert(result.text.includes(anchor), `${name}: content is missing ${JSON.stringify(anchor)}`)
  }
  return `${name} -> ${expectedScenario} (${result.text.length} chars)`
}

async function main() {
  const results = []
  await startMockIfNeeded()

  const opening = await postChat({ prompt: OPENING_PROMPT })
  results.push(
    verify('opening', opening, 'opening-match', [
      '[e2e:opening-match]',
      '1) 定位',
      '2) 出装',
      '3) 打法'
    ])
  )

  const augment = await postChat({ prompt: AUGMENT_PROMPT, withImage: true })
  results.push(
    verify('augment', augment, 'augment-pick', [
      '[e2e:augment-pick]',
      '1) 推荐',
      '2) 出装',
      '3) 打法',
      '秘术冲拳'
    ])
  )

  const probe = await postChat({ prompt: PROBE_PROMPT })
  results.push(verify('probe', probe, 'probe', ['PROBE_OK']))

  // Header must win over prompt detection.
  const forced = await postChat({ prompt: OPENING_PROMPT, scenarioHeader: 'augment-pick' })
  results.push(verify('forced-header', forced, 'augment-pick', ['[e2e:augment-pick]', '1) 推荐']))

  for (const line of results) console.log(`  PASS ${line}`)
  console.log(`\n[smoke] ${results.length}/${results.length} scenarios passed`)
}

try {
  await main()
} catch (error) {
  console.error(`\n[smoke] FAILED: ${error?.message || error}`)
  process.exitCode = 1
} finally {
  await stopMock()
}
