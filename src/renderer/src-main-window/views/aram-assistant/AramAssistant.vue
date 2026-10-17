<template>
  <main class="space-y-4 p-4 lg:p-6">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">{{ t('aramAssistant.title') }}</h1>
        <p class="mt-1 text-sm opacity-75">{{ t('aramAssistant.intro') }}</p>
      </div>
      <NButton :loading="catalogUpdating" @click="updateCatalog">
        {{
          catalogUpdating ? t('aramAssistant.catalog.updating') : t('aramAssistant.catalog.update')
        }}
      </NButton>
    </header>

    <NAlert v-if="state.catalogFallbackCode" type="warning" :show-icon="false">
      {{ t('aramAssistant.catalog.fallback') }}
    </NAlert>
    <NAlert v-if="pageErrorCode" type="error" :title="t('aramAssistant.error.title')">
      {{ errorMessage(pageErrorCode) }}
    </NAlert>

    <div class="grid gap-4 xl:grid-cols-2">
      <NCard :title="t('aramAssistant.match.title')">
        <div class="flex flex-wrap items-center gap-2">
          <NTag :type="state.matchContext.connection === 'connected' ? 'success' : 'default'">
            {{ t(`aramAssistant.match.${state.matchContext.connection}`) }}
          </NTag>
          <NTag>{{ t('aramAssistant.match.mode') }}: {{ modeLabel(state.matchContext.mode) }}</NTag>
          <NTag v-if="state.matchContext.phase"
            >{{ t('aramAssistant.match.phase') }}: {{ state.matchContext.phase }}</NTag
          >
          <NTag v-if="state.matchContext.gameId">Game {{ state.matchContext.gameId }}</NTag>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <label class="space-y-1">
            <span class="text-sm opacity-75">{{ t('aramAssistant.match.champion') }}</span>
            <NSelect
              v-model:value="championOverride"
              clearable
              filterable
              :options="championOptions"
              @update:value="setChampionOverride"
            />
          </label>
          <label class="space-y-1">
            <span class="text-sm opacity-75">{{ t('aramAssistant.match.mode') }}</span>
            <NSelect v-model:value="selectedMode" :options="modeOptions" />
          </label>
        </div>
        <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
          <span class="text-sm opacity-75">
            {{ championOverride ? t('aramAssistant.match.manualOverride') : currentChampionLabel }}
          </span>
          <NButton size="small" quaternary @click="restoreFollow">
            {{ t('aramAssistant.match.follow') }}
          </NButton>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <div class="mb-1 text-sm opacity-75">{{ t('aramAssistant.match.allies') }}</div>
            <div class="flex flex-wrap gap-1.5">
              <NTag
                v-for="(member, index) in state.matchContext.allies"
                :key="`ally-${index}`"
                size="small"
              >
                {{ member.name || member.championId || '—' }}
              </NTag>
              <span v-if="!state.matchContext.allies.length" class="text-sm opacity-55">—</span>
            </div>
          </div>
          <div>
            <div class="mb-1 text-sm opacity-75">{{ t('aramAssistant.match.enemies') }}</div>
            <div class="flex flex-wrap gap-1.5">
              <NTag
                v-for="(member, index) in state.matchContext.enemies"
                :key="`enemy-${index}`"
                size="small"
              >
                {{ member.name || member.championId || '—' }}
              </NTag>
              <span v-if="!state.matchContext.enemies.length" class="text-sm opacity-55">—</span>
            </div>
          </div>
        </div>

        <NDivider />
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="font-medium">{{ t('aramAssistant.guide.title') }}</div>
            <div class="mt-1 text-sm opacity-65">{{ t('aramAssistant.guide.defaultOff') }}</div>
          </div>
          <NSwitch
            :value="settings.automaticGuide"
            :aria-label="t('aramAssistant.guide.automatic')"
            @update:value="setAutomaticGuide"
          />
        </div>
        <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span class="text-sm opacity-75">{{ t('aramAssistant.match.automaticContext') }}</span>
          <NSwitch
            :value="settings.automaticContext"
            :aria-label="t('aramAssistant.match.automaticContext')"
            @update:value="setAutomaticContext"
          />
        </div>
        <div class="mt-4">
          <NButton type="primary" :disabled="state.active" @click="runGuide">
            {{ t('aramAssistant.guide.run') }}
          </NButton>
        </div>
      </NCard>

      <NCard :title="t('aramAssistant.provider.title')">
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="space-y-1">
            <span class="text-sm opacity-75">{{ t('aramAssistant.provider.active') }}</span>
            <NSelect
              v-model:value="activeProvider"
              :options="providerOptions"
              @update:value="setActiveProvider"
            />
          </label>
          <label class="space-y-1">
            <span class="text-sm opacity-75">{{ t('aramAssistant.provider.timeout') }}</span>
            <NInputNumber
              :value="settings.requestTimeoutMs / 1000"
              :min="5"
              :max="120"
              :step="5"
              class="w-full"
              @update:value="setTimeoutSeconds"
            />
          </label>
        </div>

        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <label class="space-y-1 sm:col-span-2">
            <span class="text-sm opacity-75">{{ t('aramAssistant.provider.baseUrl') }}</span>
            <NInput v-model:value="providerDraft.baseUrl" maxlength="2048" />
          </label>
          <label class="space-y-1">
            <span class="text-sm opacity-75">{{ t('aramAssistant.provider.model') }}</span>
            <NInput v-model:value="providerDraft.model" maxlength="256" />
          </label>
          <div class="flex items-end">
            <NButton @click="saveProviderSettings">{{ t('aramAssistant.provider.save') }}</NButton>
          </div>
        </div>

        <NDivider />
        <label class="block space-y-1">
          <span class="text-sm opacity-75"
            >{{ t('aramAssistant.provider.apiKey') }} · {{ providerName(activeProvider) }}</span
          >
          <NInput
            v-model:value="credentialDraft"
            type="password"
            show-password-on="click"
            autocomplete="off"
          />
        </label>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <NButton type="primary" :disabled="!credentialDraft.trim()" @click="saveCredential">
            {{ t('aramAssistant.provider.saveKey') }}
          </NButton>
          <NButton :disabled="!activeCredential.configured" @click="clearCredential">
            {{ t('aramAssistant.provider.clearKey') }}
          </NButton>
          <NTag :type="activeCredential.configured ? 'success' : 'default'">
            {{
              activeCredential.configured
                ? t('aramAssistant.provider.configured')
                : t('aramAssistant.provider.missing')
            }}
          </NTag>
          <NTag v-if="activeCredential.storageMode === 'encrypted-file'" type="success">
            {{ t('aramAssistant.provider.encrypted') }}
          </NTag>
          <NTag v-else-if="activeCredential.storageMode === 'memory-only'" type="warning">
            {{ t('aramAssistant.provider.memory') }}
          </NTag>
          <NTag v-else-if="activeCredential.storageMode === 'storage-error'" type="error">
            {{ t('aramAssistant.provider.storageError') }}
          </NTag>
        </div>
        <p class="mt-2 text-sm opacity-65">{{ t('aramAssistant.provider.note') }}</p>

        <NDivider />
        <label class="block space-y-1">
          <span class="text-sm opacity-75">{{ t('aramAssistant.provider.statsSource') }}</span>
          <NSelect
            v-model:value="statsSource"
            :options="statsSourceOptions"
            @update:value="setStatsSource"
          />
        </label>
        <p class="mt-2 text-sm opacity-65">{{ t('aramAssistant.provider.statsNote') }}</p>
      </NCard>
    </div>

    <NCard :title="t('aramAssistant.analysis.title')">
      <p class="mb-3 text-sm opacity-65">{{ t('aramAssistant.analysis.imageOnly') }}</p>
      <div class="grid gap-4 xl:grid-cols-2">
        <section class="space-y-3 rounded-lg border border-black/10 p-3 dark:border-white/10">
          <h2 class="font-medium">{{ t('aramAssistant.analysis.screenshot') }}</h2>
          <div class="flex flex-wrap gap-2">
            <NButton secondary @click="loadDisplays">{{
              t('aramAssistant.analysis.loadDisplays')
            }}</NButton>
            <NButton secondary @click="chooseImageFile">{{
              t('aramAssistant.analysis.chooseFile')
            }}</NButton>
          </div>
          <div class="flex flex-wrap gap-2">
            <NSelect
              v-model:value="selectedDisplayId"
              class="min-w-52 flex-1"
              :placeholder="t('aramAssistant.analysis.display')"
              :options="displayOptions"
            />
            <NButton :disabled="!selectedDisplayId" @click="captureDisplay">{{
              t('aramAssistant.analysis.capture')
            }}</NButton>
          </div>
          <div v-if="screenshotPreview" class="space-y-2">
            <div class="text-sm font-medium">{{ t('aramAssistant.analysis.preview') }}</div>
            <img
              :src="screenshotPreview.previewDataUrl"
              :alt="t('aramAssistant.analysis.preview')"
              class="max-h-80 max-w-full rounded-md border border-black/10 object-contain dark:border-white/10"
            />
            <p class="text-sm opacity-65">{{ t('aramAssistant.analysis.previewHint') }}</p>
            <div class="flex flex-wrap gap-2">
              <NButton
                type="primary"
                :loading="state.active"
                :disabled="state.active"
                @click="analyzeScreenshot"
              >
                {{ t('aramAssistant.analysis.analyzeImage') }}
              </NButton>
              <NButton :disabled="state.active" @click="discardPreview">{{
                t('aramAssistant.analysis.cancelPreview')
              }}</NButton>
            </div>
          </div>
          <NEmpty v-else :description="t('aramAssistant.analysis.noPreview')" size="small" />
        </section>

        <section class="space-y-3 rounded-lg border border-black/10 p-3 dark:border-white/10">
          <h2 class="font-medium">{{ t('aramAssistant.analysis.text') }}</h2>
          <p class="text-sm opacity-65">{{ t('aramAssistant.analysis.selectThree') }}</p>
          <div class="space-y-2">
            <label v-for="(_, index) in selectedCardIds" :key="index" class="block space-y-1">
              <span class="text-sm opacity-75">{{
                t(`aramAssistant.analysis.card${['One', 'Two', 'Three'][index]}`)
              }}</span>
              <NSelect
                v-model:value="selectedCardIds[index]"
                filterable
                :options="candidateOptions"
                :placeholder="t('aramAssistant.catalog.search')"
              />
            </label>
          </div>
          <NButton
            type="primary"
            :disabled="
              state.active ||
              selectedCardIds.some((id) => !id) ||
              new Set(selectedCardIds).size !== 3
            "
            :loading="state.active"
            @click="analyzeText"
          >
            {{ t('aramAssistant.analysis.analyzeText') }}
          </NButton>
        </section>
      </div>

      <div v-if="state.active || state.lastErrorCode || state.latestResult" class="mt-4 space-y-3">
        <NAlert
          v-if="state.active"
          type="info"
          :show-icon="false"
          class="flex items-center justify-between gap-3"
        >
          <span>{{ t('aramAssistant.analysis.running') }}</span>
          <NButton size="small" @click="cancelAnalysis">{{
            t('aramAssistant.analysis.cancel')
          }}</NButton>
        </NAlert>
        <NAlert v-if="state.lastErrorCode" type="error" :title="t('aramAssistant.error.title')">
          {{ errorMessage(state.lastErrorCode) }}
        </NAlert>
        <section
          v-if="state.latestResult"
          class="rounded-lg border border-black/10 p-4 dark:border-white/10"
        >
          <h2 class="mb-2 font-medium">{{ t('aramAssistant.analysis.result') }}</h2>
          <div class="break-words whitespace-pre-wrap">{{ state.latestResult.output }}</div>
        </section>
      </div>
    </NCard>

    <NCard :title="t('aramAssistant.catalog.title')">
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <NTag>{{ t(`aramAssistant.catalog.${state.catalogSource}`) }}</NTag>
        <NTag>{{ t('aramAssistant.catalog.sourcePatch') }} {{ catalog?.sourcePatch || '—' }}</NTag>
        <NTag>{{ t('aramAssistant.catalog.count', { count: catalog?.cardCount ?? 0 }) }}</NTag>
        <NTag type="warning">{{ t('aramAssistant.catalog.notVerified') }}</NTag>
      </div>
      <div v-if="catalog" class="mb-3 space-y-1 text-xs opacity-75">
        <div class="flex flex-wrap gap-x-2 gap-y-1">
          <span>{{ t('aramAssistant.catalog.source') }}: {{ catalog.sourceName }}</span>
          <a
            :href="catalog.sourceUrl"
            target="_blank"
            rel="noreferrer"
            class="text-[var(--la-color-link)] underline"
          >
            {{ t('aramAssistant.catalog.sourceData') }}
          </a>
          <a
            :href="catalog.sourcePageUrl"
            target="_blank"
            rel="noreferrer"
            class="text-[var(--la-color-link)] underline"
          >
            {{ t('aramAssistant.catalog.sourcePage') }}
          </a>
          <span>{{ t('aramAssistant.catalog.fetchedAt') }}: {{ catalog.fetchedAt }}</span>
          <span>{{ t('aramAssistant.catalog.licenseStatus') }}: {{ catalog.licenseStatus }}</span>
        </div>
        <div class="break-all">
          <span>{{ t('aramAssistant.catalog.sha256') }}:</span> <code>{{ catalog.rawSha256 }}</code>
        </div>
      </div>
      <p class="mb-3 text-sm opacity-65">{{ t('aramAssistant.catalog.selectableOnly') }}</p>
      <div class="grid gap-2 md:grid-cols-4">
        <NInput
          v-model:value="catalogQuery"
          :placeholder="t('aramAssistant.catalog.search')"
          clearable
          maxlength="160"
          @update:value="searchCatalog"
        />
        <NSelect
          v-model:value="rarityFilter"
          :options="rarityOptions"
          @update:value="searchCatalog"
        />
        <NSelect v-model:value="kindFilter" :options="kindOptions" @update:value="searchCatalog" />
        <NSelect
          v-model:value="scopeFilter"
          :options="scopeOptions"
          @update:value="searchCatalog"
        />
      </div>
      <div class="mt-3 grid gap-3 lg:grid-cols-2">
        <article
          v-for="entry in pagedEntries"
          :key="entry.id"
          class="rounded-lg border border-black/10 p-3 dark:border-white/10"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 class="font-medium">{{ localized(entry.name) }}</h3>
              <div class="mt-1 flex flex-wrap gap-1.5">
                <NTag size="small">{{ t(`aramAssistant.catalog.${entry.rarity}`) }}</NTag>
                <NTag size="small">{{ t(`aramAssistant.catalog.${entry.kind}`) }}</NTag>
                <NTag size="small">{{ t(`aramAssistant.catalog.${entry.scope}`) }}</NTag>
                <NTag size="small" :type="entry.textStatus === 'verified' ? 'success' : 'warning'">
                  {{ t(`aramAssistant.catalog.${entry.textStatus}`) }}
                </NTag>
                <NTag
                  size="small"
                  :type="entry.currentPatchChange === 'changed' ? 'warning' : 'default'"
                >
                  {{ t(`aramAssistant.catalog.${entry.currentPatchChange}`) }}
                </NTag>
              </div>
            </div>
            <NButton
              size="small"
              :type="isConfirmed(entry.id) ? 'success' : 'default'"
              :disabled="isConfirmed(entry.id)"
              @click="confirmAugment(entry.id)"
              >{{
                isConfirmed(entry.id)
                  ? t('aramAssistant.analysis.selected')
                  : t('aramAssistant.analysis.confirmSelected')
              }}</NButton
            >
          </div>
          <p class="mt-2 text-sm whitespace-pre-wrap opacity-80">{{ localized(entry.effect) }}</p>
          <div class="mt-2 flex flex-wrap gap-1">
            <NTag v-for="tag in entry.tags.slice(0, 5)" :key="tag" size="small" :bordered="false">{{
              tag
            }}</NTag>
          </div>
        </article>
        <NEmpty v-if="!pagedEntries.length" :description="t('aramAssistant.catalog.noResults')" />
      </div>
      <div class="mt-4 flex items-center justify-between gap-2">
        <NButton :disabled="page <= 1" @click="page -= 1">{{
          t('aramAssistant.catalog.previous')
        }}</NButton>
        <span class="text-sm opacity-75">{{
          t('aramAssistant.catalog.page', { current: page, total: totalPages })
        }}</span>
        <NButton :disabled="page >= totalPages" @click="page += 1">{{
          t('aramAssistant.catalog.next')
        }}</NButton>
      </div>
    </NCard>

    <NCard :title="t('aramAssistant.analysis.history')">
      <p class="mb-3 text-sm opacity-65">{{ t('aramAssistant.analysis.sessionOnly') }}</p>
      <NEmpty
        v-if="state.history.length === 0"
        :description="t('aramAssistant.analysis.emptyHistory')"
        size="small"
      />
      <div v-else class="flex flex-wrap gap-2">
        <NTag v-for="item in state.history" :key="item.id" type="success">{{
          localized(item.name)
        }}</NTag>
      </div>
      <NButton class="mt-3" :disabled="state.history.length === 0" @click="undoConfirmedAugment">
        {{ t('aramAssistant.analysis.undo') }}
      </NButton>
    </NCard>
  </main>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { useAramAssistantStore } from '@main-window/shards/aram-assistant/store'
import { AramAssistantRenderer } from '@main-window/shards/aram-assistant'
import type {
  AramAnalysisInput,
  AramMatchContext,
  AugmentCatalog,
  AugmentCatalogEntry,
  BilingualText,
  CatalogSearchOptions,
  ProviderProtocol
} from '@shared/types/aram-assistant'
import type { ChampionDataSourceId } from '@shared/data-adapter/champion-data'
import { useTranslation } from 'i18next-vue'
import {
  NAlert,
  NButton,
  NCard,
  NDivider,
  NEmpty,
  NInput,
  NInputNumber,
  NSelect,
  NSwitch,
  NTag,
  useMessage
} from 'naive-ui'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

const { t, i18next } = useTranslation()
const assistant = useInstance(AramAssistantRenderer)
const store = useAramAssistantStore()
const message = useMessage()
const settings = store.settings
const state = store.state

const catalog = ref<AugmentCatalog | null>(null)
const championChoices = ref<Array<{ id: number; name: string }>>([])
const displays = ref<Array<{ sourceId: string; name: string; displayId: string | null }>>([])
const screenshotPreview = ref<{
  token: string
  previewDataUrl: string
  width: number
  height: number
} | null>(null)
const selectedDisplayId = ref<string | null>(null)
const catalogQuery = ref('')
const rarityFilter = ref<CatalogSearchOptions['rarity']>('all')
const kindFilter = ref<CatalogSearchOptions['kind']>('all')
const scopeFilter = ref<CatalogSearchOptions['scope']>('all')
const entries = ref<AugmentCatalogEntry[]>([])
const selectedCardIds = ref<[string | null, string | null, string | null]>([null, null, null])
const page = ref(1)
const catalogUpdating = ref(false)
const pageErrorCode = ref<string | null>(null)
const activeProvider = ref<ProviderProtocol>(settings.activeProvider)
const providerDraft = reactive({ ...settings.providers[settings.activeProvider] })
const credentialDraft = ref('')
const championOverride = ref<number | null>(state.manualChampionOverrideId)
const selectedMode = ref<'aram' | 'aram_mayhem'>('aram_mayhem')
const statsSource = ref<ChampionDataSourceId>(settings.statsSource)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchGeneration = 0

const providerOptions = computed(() => [
  { label: t('aramAssistant.provider.gemini'), value: 'gemini' },
  { label: t('aramAssistant.provider.openai'), value: 'openai' }
])
const modeOptions = computed(() => [
  { label: t('aramAssistant.mode.aram'), value: 'aram' },
  { label: t('aramAssistant.mode.aramMayhem'), value: 'aram_mayhem' }
])
const championOptions = computed(() =>
  championChoices.value.map(({ id, name }) => ({ label: name, value: id }))
)
const displayOptions = computed(() =>
  displays.value.map((display) => ({ label: display.name, value: display.sourceId }))
)
const candidateOptions = computed(() =>
  (catalog.value?.entries ?? [])
    .filter((entry) => entry.kind !== 'special' && entry.textStatus === 'verified')
    .map((entry) => ({ label: localized(entry.name), value: entry.id }))
)
const activeCredential = computed(() => state.credentialStatus[activeProvider.value])
const totalPages = computed(() => Math.max(1, Math.ceil(entries.value.length / 10)))
const pagedEntries = computed(() => entries.value.slice((page.value - 1) * 10, page.value * 10))
const currentChampionLabel = computed(() => {
  const champion = state.matchContext.selfChampion
  return champion?.name || t('aramAssistant.match.noChampion')
})
const rarityOptions = computed(() =>
  ['all', 'silver', 'gold', 'prismatic'].map((value) => ({
    label: t(`aramAssistant.catalog.${value}`),
    value
  }))
)
const kindOptions = computed(() =>
  ['all', 'standard', 'ability', 'quest', 'special'].map((value) => ({
    label: t(`aramAssistant.catalog.${value}`),
    value
  }))
)
const scopeOptions = computed(() =>
  ['all', 'aram', 'shared'].map((value) => ({
    label: t(`aramAssistant.catalog.${value}`),
    value
  }))
)
const statsSourceOptions = computed(() => [
  { label: t('aramAssistant.provider.opgg'), value: 'opgg' },
  { label: t('aramAssistant.provider.qq101'), value: 'qq101' }
])

watch(activeProvider, (protocol) => {
  Object.assign(providerDraft, settings.providers[protocol])
  credentialDraft.value = ''
})
watch(
  () => state.manualChampionOverrideId,
  (value) => (championOverride.value = value)
)
watch(
  () => settings.activeProvider,
  (value) => (activeProvider.value = value)
)
watch(
  () => settings.statsSource,
  (value) => (statsSource.value = value)
)
watch(
  () => state.matchGeneration,
  () => {
    void discardPreview()
  }
)
watch(entries, () => (page.value = 1))

onMounted(() => {
  void initialize()
})
onBeforeUnmount(() => {
  searchGeneration += 1
  if (searchTimer) clearTimeout(searchTimer)
  if (screenshotPreview.value) void assistant.discardScreenshot(screenshotPreview.value.token)
})

async function initialize() {
  try {
    const [loadedCatalog, choices, credentials] = await Promise.all([
      assistant.getCatalog(),
      assistant.getChampionChoices(),
      assistant.refreshCredentialStatuses()
    ])
    catalog.value = loadedCatalog
    championChoices.value = choices
    state.credentialStatus = credentials
    championOverride.value = await assistant.getManualChampionOverride()
    await searchCatalog()
  } catch (error) {
    showError(error)
  }
}

function localized(value: BilingualText) {
  return i18next.language.startsWith('zh') ? value.zh : value.en
}

function modeLabel(mode: AramMatchContext['mode']) {
  if (mode === 'aram') return t('aramAssistant.mode.aram')
  if (mode === 'aram_mayhem') return t('aramAssistant.mode.aramMayhem')
  return '—'
}

function providerName(protocol: ProviderProtocol) {
  return t(`aramAssistant.provider.${protocol}`)
}

async function setActiveProvider(protocol: ProviderProtocol) {
  activeProvider.value = protocol
  await runAction(() => assistant.setActiveProvider(protocol))
}

async function saveProviderSettings() {
  await runAction(async () => {
    await assistant.setProviderSettings(activeProvider.value, { ...providerDraft })
    await assistant.setActiveProvider(activeProvider.value)
    message.success(t('aramAssistant.provider.saved'))
  })
}

async function saveCredential() {
  const value = credentialDraft.value
  await runAction(async () => {
    await assistant.setCredential(activeProvider.value, value)
    credentialDraft.value = ''
    state.credentialStatus = await assistant.refreshCredentialStatuses()
    message.success(t('aramAssistant.provider.credentialSaved'))
  })
}

async function clearCredential() {
  await runAction(async () => {
    await assistant.setCredential(activeProvider.value, '')
    state.credentialStatus = await assistant.refreshCredentialStatuses()
    credentialDraft.value = ''
  })
}

async function setAutomaticGuide(enabled: boolean) {
  await runAction(() => assistant.setAutomaticGuide(enabled))
}

async function setAutomaticContext(enabled: boolean) {
  await runAction(() => assistant.setAutomaticContext(enabled))
}

async function setTimeoutSeconds(value: number | null) {
  if (value !== null) await runAction(() => assistant.setRequestTimeout(value * 1000))
}

async function setStatsSource(source: ChampionDataSourceId) {
  statsSource.value = source
  await runAction(() => assistant.setStatsSource(source))
}

async function setChampionOverride(value: number | null) {
  championOverride.value = value
  await runAction(() => assistant.setManualChampionOverride(value))
}

async function restoreFollow() {
  await setChampionOverride(null)
}

async function runGuide() {
  await analyze({ kind: 'lineup-guide', mode: selectedMode.value })
}

async function analyzeScreenshot() {
  if (!screenshotPreview.value) return
  const token = screenshotPreview.value.token
  screenshotPreview.value = null
  await analyze({ kind: 'augment-advice', mode: selectedMode.value, screenshotToken: token })
}

async function analyzeText() {
  const cardIds = selectedCardIds.value.filter((id): id is string => Boolean(id))
  await analyze({ kind: 'augment-advice', mode: selectedMode.value, cardIds })
}

async function analyze(input: AramAnalysisInput) {
  pageErrorCode.value = null
  try {
    await assistant.analyze(input)
  } catch (error) {
    if (!state.lastErrorCode) showError(error)
  }
}

async function cancelAnalysis() {
  await runAction(() => assistant.cancelAnalysis())
}

async function loadDisplays() {
  await runAction(async () => {
    displays.value = await assistant.listDisplays()
    selectedDisplayId.value = displays.value[0]?.sourceId ?? null
  })
}

async function captureDisplay() {
  if (!selectedDisplayId.value) return
  await runAction(async () => {
    const preview = await assistant.prepareDesktopScreenshot(selectedDisplayId.value!)
    screenshotPreview.value = preview
  })
}

async function chooseImageFile() {
  await runAction(async () => {
    const preview = await assistant.chooseImageFile()
    screenshotPreview.value = preview
  })
}

async function discardPreview() {
  const preview = screenshotPreview.value
  screenshotPreview.value = null
  if (preview) await runAction(() => assistant.discardScreenshot(preview.token))
}

async function updateCatalog() {
  catalogUpdating.value = true
  pageErrorCode.value = null
  try {
    await assistant.updateCatalog()
    catalog.value = await assistant.getCatalog()
    await searchCatalog()
    message.success(
      t('aramAssistant.catalog.updated', {
        patch: catalog.value.sourcePatch,
        count: catalog.value.cardCount
      })
    )
  } catch (error) {
    showError(error)
  } finally {
    catalogUpdating.value = false
  }
}

function searchCatalog() {
  const generation = ++searchGeneration
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    try {
      const results = await assistant.searchCards({
        query: catalogQuery.value,
        rarity: rarityFilter.value,
        kind: kindFilter.value,
        scope: scopeFilter.value
      })
      if (generation === searchGeneration) entries.value = results
    } catch (error) {
      if (generation === searchGeneration) showError(error)
    }
  }, 120)
}

async function confirmAugment(cardId: string) {
  await runAction(async () => {
    await assistant.confirmAugment(cardId)
    message.success(t('aramAssistant.analysis.confirmed'))
  })
}

async function undoConfirmedAugment() {
  await runAction(() => assistant.undoConfirmedAugment())
}

function isConfirmed(cardId: string) {
  return state.history.some((item) => item.cardId === cardId)
}

async function runAction(action: () => unknown | Promise<unknown>) {
  pageErrorCode.value = null
  try {
    await action()
  } catch (error) {
    showError(error)
  }
}

function errorMessage(code: string) {
  const key = `aramAssistant.error.${code}`
  const value = t(key)
  return value === key ? t('aramAssistant.error.fallback') : value
}

function showError(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'fallback'
  pageErrorCode.value = code
}
</script>
