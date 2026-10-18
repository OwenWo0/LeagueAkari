/**
 * Deterministic plain-text model bodies for ARAM assistant e2e.
 * Markers like [e2e:opening-match] are stable assert anchors.
 */

const OPENING_MATCH_ZH = `[e2e:opening-match]
海克斯大乱斗 · 开局阵容攻略（模拟）

当前假设：你方已就位，模式为 ARAM: Mayhem。以下为进入对局前的默认建议，不依赖截图。

1. 定位：先明确自己是前排承伤、中排续航还是后排输出，开局不要硬抢对面半血。
2. 出门：优先保证基础续航与鞋子节奏；第一件核心装再决定是否打爆发。
3. 开场选卡：出生后三选一会出现，优先选能立刻生效、且不依赖复杂连招的增益。
4. 团战：第一次塔下团以「活着打伤害」为主，避免为了抢人头提前交闪。
5. 证据边界：本回复为 e2e 固定 mock，未读取真实付费模型，也不声称统计胜率。
`

const AUGMENT_PICK_ZH = `[e2e:augment-pick]
海克斯大乱斗 · 开场三选一（模拟识图）

识别到的三张卡（仅基于可见文本，不猜测）：
1. 战争交响乐（棱彩）— 获得致命节奏与征服者基石符文。
2. 秘术冲拳（棱彩）— 普攻命中时缩短基础技能剩余冷却。
3. 王中王，靴中靴（棱彩 / 任务）— 立即获得随机进阶鞋子，完成任务可再换一双。

推荐：秘术冲拳
理由：开场即可提升技能周转，对多数英雄都有稳定收益；「战争交响乐」更吃攻击节奏，「王中王，靴中靴」前期收益偏移动与任务进度。

不确定项：若实际截图文字模糊，请重拍或改用本地三卡文本分析。本回复为 e2e 固定 mock。
`

const OPENING_MATCH_EN = `[e2e:opening-match]
ARAM Mayhem · opening lineup guide (mock)

Assumes your team is ready in Mayhem. This is the default pre-fight guide and does not use a screenshot.

1. Role: decide frontline, mid-line sustain, or backline damage before the first fight.
2. Buy: secure sustain and boots tempo first; lock a core item direction after the first augment.
3. Opening pick: take an augment that works immediately without a long quest setup.
4. First fight: stay alive under tower; do not burn Flash only for a kill.
5. Evidence boundary: fixed e2e mock text, not a live paid model, and not a win-rate claim.
`

const AUGMENT_PICK_EN = `[e2e:augment-pick]
ARAM Mayhem · opening three-card pick (mock vision)

Visible cards (no guessing):
1. Symphony of War (Prismatic) — Gain Lethal Tempo and Conqueror.
2. Mystic Punch (Prismatic) — On-hit reduces remaining basic-ability cooldowns.
3. Sneakerhead (Prismatic / Quest) — Immediate upgraded boots; quest swaps for another pair.

Pick: Mystic Punch
Why: Immediate skill uptime for most champions. Symphony of War needs attack cadence; Sneakerhead is more boots/quest tempo.

If OCR text were unclear, retake the screenshot or use local three-card text mode. Fixed e2e mock.
`

function detectScenario(bodyText) {
  const text = String(bodyText || '')
  if (/PROBE_OK|connectivity probe/i.test(text)) return 'probe'
  if (
    /Identify only the augment names|Compare the effects of exactly the three|Selected local cards:/i.test(
      text
    )
  ) {
    return 'augment-pick'
  }
  if (/lineup guide|阵容攻略|Give a concise ARAM lineup/i.test(text)) return 'opening-match'
  // Automatic opening capture uses screenshot purpose text.
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
