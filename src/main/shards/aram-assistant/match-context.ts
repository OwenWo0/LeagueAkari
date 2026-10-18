import { EMPTY_PUUID } from '@shared/constants/common'
import type {
  AramChampionRef,
  AramConnection,
  AramMatchContext,
  AramMode
} from '@shared/types/aram-assistant'
import type { ChampSelectSession } from '@shared/types/league-client/champ-select'
import type { ChampionSimple, Queue } from '@shared/types/league-client/game-data'
import type { GameflowSession } from '@shared/types/league-client/gameflow'
import type { SummonerInfo } from '@shared/types/league-client/summoner'

export type {
  AramConnection,
  AramMatchContext,
  AramMode,
  AramChampionRef
} from '@shared/types/aram-assistant'

export interface AramMatchSource {
  connection: AramConnection
  phase: string | null
  gameflowSession: GameflowSession | null
  champSelectSession: ChampSelectSession | null
  currentSummoner: SummonerInfo | null
  champions: Record<number, ChampionSimple>
  queues: Record<number, Queue & { gameMode?: string }>
}

export function deriveAramMatchContext(source: AramMatchSource): AramMatchContext {
  const gameData = source.gameflowSession?.gameData
  const champSelect = source.champSelectSession
  const queueId = positiveId(gameData?.queue?.id) ?? positiveId(champSelect?.queueId)
  const gameId = positiveId(gameData?.gameId) ?? positiveId(champSelect?.gameId)
  const mode = resolveAramMode(
    queueId,
    source.queues[queueId ?? -1]?.gameMode ?? source.gameflowSession?.map?.gameMode
  )
  const context: AramMatchContext = {
    connection: source.connection,
    phase: safeLabel(source.phase, 80),
    queueId,
    mode,
    mapId: positiveId(gameData?.queue?.mapId) ?? positiveId(source.gameflowSession?.map?.id),
    gameId,
    selfChampion: null,
    allies: [],
    enemies: [],
    champSelectSessionId: safeLabel(champSelect?.id, 128)
  }

  if (source.phase === 'ChampSelect' && champSelect) {
    const myTeam = champSelect.myTeam ?? []
    const theirTeam = champSelect.theirTeam ?? []
    const selfMember = myTeam.find((member) => member.cellId === champSelect.localPlayerCellId)
    context.selfChampion = selfMember ? championRef(selfMember.championId, source.champions) : null
    context.allies = myTeam.map((member) => championRef(member.championId, source.champions))
    context.enemies = theirTeam.map((member) => championRef(member.championId, source.champions))
    return context
  }

  if (!gameData) return context
  const player = source.currentSummoner
  const playerPuuid = validPuuid(player?.puuid)
  const playerSummonerId = positiveId(player?.summonerId)
  const findSelf = (members: typeof gameData.teamOne) =>
    members.find((member) => {
      if (playerPuuid && validPuuid(member.puuid) === playerPuuid) return true
      return playerSummonerId !== null && positiveId(member.summonerId) === playerSummonerId
    })
  const selfOne = findSelf(gameData.teamOne ?? [])
  const selfTwo = selfOne ? undefined : findSelf(gameData.teamTwo ?? [])
  const self = selfOne ?? selfTwo
  if (!self) return context

  const selections = gameData.playerChampionSelections ?? []
  const selectionFor = (member: (typeof gameData.teamOne)[number]) => {
    const puuid = validPuuid(member.puuid)
    return puuid ? selections.find((selection) => validPuuid(selection.puuid) === puuid) : undefined
  }
  const gameChampionRef = (member: (typeof gameData.teamOne)[number]) =>
    championRef(
      positiveId(member.championId) ?? positiveId(selectionFor(member)?.championId),
      source.champions
    )
  const ownTeam = selfOne ? (gameData.teamOne ?? []) : (gameData.teamTwo ?? [])
  const otherTeam = selfOne ? (gameData.teamTwo ?? []) : (gameData.teamOne ?? [])
  context.selfChampion = gameChampionRef(self)
  context.allies = ownTeam.map(gameChampionRef)
  context.enemies = otherTeam.map(gameChampionRef)
  return context
}

export function shouldResetMatch(options: {
  previous: AramMatchContext | null
  next: AramMatchContext
  previousPhase: string | null
}): boolean {
  const { previous, next, previousPhase } = options
  if (isChampSelectGameHandoff(previous, next)) return false
  if (
    previous?.gameId !== null &&
    previous?.gameId !== undefined &&
    next.gameId !== null &&
    previous.gameId !== next.gameId
  ) {
    return true
  }
  if (
    next.champSelectSessionId &&
    previous?.champSelectSessionId !== next.champSelectSessionId &&
    ((previous?.champSelectSessionId !== null && previous?.champSelectSessionId !== undefined) ||
      next.phase === 'ChampSelect')
  ) {
    return true
  }
  return (
    next.phase === 'ChampSelect' && ['EndOfGame', 'WaitingForStats'].includes(previousPhase || '')
  )
}

export function isChampSelectGameHandoff(
  previous: AramMatchContext | null,
  next: AramMatchContext
): boolean {
  if (
    previous?.phase !== 'ChampSelect' ||
    !previous.champSelectSessionId ||
    (next.champSelectSessionId !== null &&
      next.champSelectSessionId !== previous.champSelectSessionId) ||
    !['GameStart', 'InProgress'].includes(next.phase || '') ||
    previous.connection !== 'connected' ||
    next.connection !== 'connected' ||
    previous.gameId === null ||
    next.gameId === null ||
    previous.mode !== next.mode
  ) {
    return false
  }
  return previous.queueId === null || next.queueId === null || previous.queueId === next.queueId
}

export function isReadyForAutomaticGuide(context: AramMatchContext): boolean {
  return (
    context.connection === 'connected' &&
    (context.mode === 'aram' || context.mode === 'aram_mayhem') &&
    context.gameId !== null &&
    context.gameId > 0 &&
    Boolean(context.selfChampion?.name) &&
    context.allies.length === 5 &&
    context.allies.every((member) => Boolean(member.name))
  )
}

/** Opening Mayhem augment UI appears shortly after spawn; only needs self + InProgress. */
export function isReadyForAutomaticAugmentCapture(context: AramMatchContext): boolean {
  return (
    context.connection === 'connected' &&
    context.mode === 'aram_mayhem' &&
    context.phase === 'InProgress' &&
    context.gameId !== null &&
    context.gameId > 0 &&
    Boolean(context.selfChampion?.name)
  )
}

export function resolveAramMode(queueId: number | null, gameMode?: string | null): AramMode {
  if (queueId === 2400 || gameMode?.toUpperCase() === 'KIWI') return 'aram_mayhem'
  if (queueId === 450 || gameMode?.toUpperCase() === 'ARAM') return 'aram'
  return 'other'
}

export function championRef(
  id: unknown,
  champions: Record<number, Pick<ChampionSimple, 'name'>>
): AramChampionRef {
  const championId = positiveId(id)
  if (championId === null) return { championId: null, name: null }
  const name = safeLabel(champions[championId]?.name, 100)
  return { championId, name: name && !/^\d+$/.test(name) ? name : null }
}

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function validPuuid(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value !== EMPTY_PUUID ? value : null
}

function safeLabel(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const label = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return label && label.length <= maxLength ? label : null
}
