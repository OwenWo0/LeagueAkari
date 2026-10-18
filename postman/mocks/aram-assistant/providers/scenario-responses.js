/**
 * Deterministic plain-text model bodies for ARAM assistant e2e.
 * Markers like [e2e:opening-match] are stable assert anchors.
 *
 * The bodies intentionally follow the current main-process output contract:
 *   augment: 1) 推荐 / 2) 出装 / 3) 打法
 *   lineup:  1) 定位 / 2) 出装 / 3) 打法
 * Keep them short; do not turn them into OCR transcripts or card encyclopedias.
 */

const OPENING_MATCH_ZH = `[e2e:opening-match]
1) 定位
后排法术输出与先手控制，用晕眩开团，而不是第一个进场吃伤害。

2) 出装
核心：卢登的伙伴 → 灭世者的死亡之帽；可选：中娅沙漏、影焰。

3) 打法
- 开局跟队清线，优先保证等级与装备节奏。
- 第一波团站后排，等前排开团后再交控制。
- 中期围绕队友大招打先手，打完一套就后撤等冷却。
- 本回复为 e2e 固定 mock，不声称统计胜率。
`

const AUGMENT_PICK_ZH = `[e2e:augment-pick]
1) 推荐
秘术冲拳 — 普攻命中缩短基础技能冷却，开场就能把技能周转拉起来。

2) 出装
核心：卢登的伙伴 → 灭世者的死亡之帽；可选：中娅沙漏、影焰。

3) 打法
- 开局用技能清线，保持与队友同侧，别单独压过河道。
- 团战站后排，等前排开团后再交控制与爆发。
- 秘术冲拳靠高频普攻触发，技能间隙记得穿插平 A。
`

const OPENING_MATCH_EN = `[e2e:opening-match]
1) Role
Backline damage with pick-off control; open fights with crowd control instead of walking in first.

2) Build
Core: Luden's Companion -> Rabadon's Deathcap; Optional: Zhonya's Hourglass, Shadowflame.

3) Play
- Clear waves with your team and protect level and item tempo.
- Stand back in the first fight; follow your frontline's engage.
- Mid game, look for picks with your ultimate, then back off for cooldowns.
- Fixed e2e mock text; no win-rate claim.
`

const AUGMENT_PICK_EN = `[e2e:augment-pick]
1) Pick
Mystic Punch — on-hit attacks reduce basic-ability cooldowns, so ability uptime starts immediately.

2) Build
Core: Luden's Companion -> Rabadon's Deathcap; Optional: Zhonya's Hourglass, Shadowflame.

3) Play
- Clear waves with abilities and stay on your team's side of the lane.
- Play from the backline and follow your frontline's engage.
- Weave basic attacks between spells to trigger Mystic Punch.
`

function detectScenario(bodyText) {
  const text = String(bodyText || '')
  // Probe is checked first: its prompt must never be mistaken for a game analysis.
  if (/PROBE_OK|connectivity probe/i.test(text)) return 'probe'
  // Current prompt: "## Output contract" + "1) 推荐" or an augment pick input (see _buildPrompt).
  // The lineup prompt also contains "Pick input: no screenshot ...", so only match the two
  // pick-specific variants here; otherwise it would be routed as augment-advice.
  if (
    /1\)\s*推荐|1\)\s*Pick\b|Pick input: one screenshot is attached|Pick input: exactly these three local cards|Identify only the three currently offered cards/i.test(
      text
    )
  ) {
    return 'augment-pick'
  }
  // Current prompt: "1) 定位" / "Task: short lineup plan" (see _buildPrompt).
  if (/1\)\s*定位|1\)\s*Role\b|Task: short lineup plan|lineup guide|阵容攻略/i.test(text)) {
    return 'opening-match'
  }
  // Legacy probes kept so older fixtures still route while the new contract is primary.
  if (/Identify only the augment names|Selected local cards:/i.test(text)) return 'augment-pick'
  if (/visibly legible in the supplied screenshot/i.test(text)) return 'augment-pick'
  return 'opening-match'
}

/**
 * E2e fixtures default to Chinese. Pass locale 'en' only when explicitly requested.
 */
function responseForScenario(scenario, _bodyText, locale = 'zh') {
  const zh = locale !== 'en'
  switch (scenario) {
    case 'probe':
      return 'PROBE_OK landscape'
    case 'augment-pick':
      return zh ? AUGMENT_PICK_ZH : AUGMENT_PICK_EN
    case 'opening-match':
    default:
      return zh ? OPENING_MATCH_ZH : OPENING_MATCH_EN
  }
}

function extractPromptText(payload) {
  if (!payload || typeof payload !== 'object') return ''
  // OpenAI chat completions
  const messages = payload.messages
  if (Array.isArray(messages)) {
    return messages
      .map((message) => {
        const content = message?.content
        if (typeof content === 'string') return content
        if (Array.isArray(content)) {
          return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
        }
        return ''
      })
      .join('\n')
  }
  // Gemini generateContent
  const contents = payload.contents
  if (Array.isArray(contents)) {
    return contents
      .flatMap((entry) => (Array.isArray(entry?.parts) ? entry.parts : []))
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
  }
  return JSON.stringify(payload)
}

module.exports = {
  OPENING_MATCH_ZH,
  OPENING_MATCH_EN,
  AUGMENT_PICK_ZH,
  AUGMENT_PICK_EN,
  detectScenario,
  responseForScenario,
  extractPromptText
}
