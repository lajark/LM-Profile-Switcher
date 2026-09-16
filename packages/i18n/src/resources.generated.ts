// GENERATED FILE — do not edit manually.
// Source of truth: locales/zh-CN/common.json, locales/en/common.json.
// Regenerate with `corepack pnpm run i18n:generate`.
// __CHECKSUM__: e094dcbd81fb753596f364da595441efaeab51a6252100dad11441fa793c94a9

export const DEFAULT_NAMESPACE = 'common';

export const resourceKeys = [
  'app.name',
  'app.descriptor',
  'common.cancel',
  'common.confirm',
  'common.save',
  'common.unknown',
  'profile.activate',
  'profile.active',
  'profile.activateSuccess',
  'profile.alreadyActive',
  'profile.rollbackSuccess',
  'profile.rollbackFailed',
  'optimizer.safe',
  'optimizer.balanced',
  'optimizer.performance',
  'optimizer.longContext',
  'optimizer.estimated',
  'benchmark.title',
  'benchmark.cancelled',
  'benchmark.completed',
  'benchmark.failed',
  'benchmark.failedWithCode',
  'benchmark.canceled',
  'benchmark.status',
  'benchmark.loadMs',
  'benchmark.ttft',
  'benchmark.prefill',
  'benchmark.decode',
  'benchmark.memoryPeak',
  'benchmark.samples',
  'benchmark.fingerprint',
  'benchmark.promptSuite',
  'benchmark.saved',
  'benchmark.batteryGuard',
  'benchmark.preflight',
  'benchmark.invalidRange',
  'benchmarkAll.header',
  'benchmarkAll.skipped',
  'error.modelNotFound',
  'error.capabilityUnsupported',
  'error.usage',
  'error.unknownCommand',
  'error.serverOffline',
  'error.lmUnreachable',
  'error.invalidLocale',
  'error.profileNotFound',
  'error.profileExists',
  'error.badId',
  'error.importFailed',
  'error.fileRead',
  'error.fileWrite',
  'error.validationFailed',
  'error.lockBusy',
  'error.activationPreflight',
  'error.activationStepFailed',
  'error.internal',
  'settings.language',
  'settings.thirdPartyNotices',
  'cli.usage',
  'cli.noCommand',
  'verbose.line',
  'hook.status.unconfigured',
  'hook.status.address',
  'hook.status.line',
  'hook.state.enabled',
  'hook.state.disabled',
  'hook.token.stored',
  'hook.token.missing',
  'hook.token.notStored',
  'hook.token.show',
  'hook.token.rotated',
  'hook.rules.show.none',
  'hook.rules.taskClause',
  'hook.rules.disabledMark',
  'hook.rules.rule',
  'hook.rules.valid',
  'hook.rules.invalid',
  'hook.rules.missingProfile',
  'hook.enable.updated',
  'hook.disable.updated',
  'hook.error.invalidRules',
  'hook.error.notConfigured',
  'proxy.status.unconfigured',
  'proxy.status.line',
  'proxy.state.enabled',
  'proxy.state.disabled',
  'proxy.state.locked',
  'proxy.state.unlocked',
  'proxy.aliases.show.none',
  'proxy.aliases.show.empty',
  'proxy.aliases.alias',
  'proxy.aliases.activateMark',
  'proxy.aliases.disabledMark',
  'proxy.aliases.valid',
  'proxy.aliases.invalid',
  'proxy.aliases.missingProfile',
  'proxy.aliases.added.new',
  'proxy.aliases.added.replaced',
  'proxy.aliases.removed',
  'proxy.enable.updated',
  'proxy.disable.updated',
  'proxy.error.invalidAliases',
  'proxy.error.notConfigured',
  'proxy.error.aliasMissing',
  'profile.list.none',
  'profile.list.line',
  'profile.show.line',
  'profile.show.createdAt',
  'profile.show.updatedAt',
  'profile.create.created',
  'profile.create.nameMismatch',
  'profile.edit.updated',
  'profile.edit.template',
  'profile.clone.cloned',
  'profile.delete.deleted',
  'profile.delete.requiresYes',
  'profile.import.imported',
  'profile.import.badExtension',
  'profile.export.exported',
  'apply.idempotent',
  'apply.activated',
  'apply.canceled',
  'apply.recovered',
  'apply.failed',
  'apply.requiresYes',
  'optimize.title',
  'optimize.ruleVersion',
  'optimize.noSafeCandidate',
  'optimize.noSafeCandidateYes',
  'optimize.lowConfidence',
  'optimize.savedButNotActivated',
  'optimize.confidenceHigh',
  'optimize.confidenceLow',
  'optimize.headroom',
  'optimize.memGpu',
  'optimize.memTotal',
  'optimize.ramReserve',
  'optimize.ramHeadroom',
  'optimize.measuredPeak',
  'optimize.degraded',
  'optimize.rebenchmark',
  'optimize.measured',
  'resourceFit.gpuResident',
  'resourceFit.hybridMemory',
  'resourceFit.hostMemory',
  'resourceFit.resourceUnknown',
  'resourceFit.resourceInsufficient',
  'candidate.head',
  'candidate.score',
  'candidate.unsafe',
  'diff.field',
  'error.optimizeEstimateFailed',
  'models.none',
  'models.line',
  'current.none',
  'current.line',
  'snapshot.line',
  'hardware.title',
  'hardware.os',
  'hardware.cpu',
  'hardware.memory',
  'hardware.gpu',
  'hardware.gpuUnknown',
  'hardware.gpuNone',
  'hardware.volume',
  'hardware.volumeExternal',
  'hardware.probedAt',
  'lang.show',
  'lang.set',
  'doctor.title',
  'doctor.status.ok',
  'doctor.status.fail',
  'doctor.status.warn',
  'doctor.warn.discovery',
  'doctor.bundleNotice',
  'doctor.check.store',
  'doctor.check.config',
  'doctor.check.locale',
  'doctor.check.node',
  'doctor.check.discovery',
  'doctor.check.hardware',
  'desktop.status.connecting',
  'desktop.status.connected',
  'desktop.status.help',
  'desktop.status.disconnected',
  'desktop.status.authFailed',
  'desktop.status.startFailed',
  'desktop.action.probe',
  'desktop.action.hardware',
  'desktop.action.sdkInfo',
  'desktop.locale.label',
  'desktop.locale.zhCN',
  'desktop.locale.en',
  'desktop.settings.label',
  'desktop.settings.placeholder',
  'desktop.probe.title',
  'desktop.hardware.title',
  'desktop.sdkInfo.title',
  'desktop.result.error',
  'desktop.hint.idle',
  'desktop.nav.profiles',
  'desktop.nav.optimize',
  'desktop.nav.benchmark',
  'desktop.nav.hardware',
  'desktop.nav.help',
  'desktop.profiles.title',
  'desktop.profiles.filter',
  'desktop.profiles.new',
  'desktop.profiles.empty',
  'desktop.profiles.nothing',
  'desktop.profiles.edit',
  'desktop.profiles.delete',
  'desktop.profiles.confirmDelete',
  'desktop.profiles.optimize',
  'desktop.profiles.benchmark',
  'desktop.profiles.updatedAt',
  'desktop.profiles.apply',
  'desktop.profiles.applying',
  'desktop.profiles.applyConfirm',
  'desktop.profiles.activeBadge',
  'desktop.nav.models',
  'desktop.nav.settings',
  'desktop.models.title',
  'desktop.models.subtitle',
  'desktop.models.refresh',
  'desktop.models.filter',
  'desktop.models.refreshing',
  'desktop.models.retry',
  'desktop.models.preparation',
  'desktop.models.readiness.hardware',
  'desktop.models.readiness.lmStudio',
  'desktop.models.readiness.discovery',
  'desktop.models.readiness.hardwareReady',
  'desktop.models.readiness.hardwareHelp',
  'desktop.models.readiness.version',
  'desktop.models.readiness.lmStudioHelp',
  'desktop.models.readiness.modelCount',
  'desktop.models.readiness.discoveryHelp',
  'desktop.models.status.ready',
  'desktop.models.status.partial',
  'desktop.models.status.offline',
  'desktop.models.status.unavailable',
  'desktop.models.status.unknown',
  'desktop.models.status.running',
  'desktop.models.status.idle',
  'desktop.models.runtime.title',
  'desktop.models.runtime.none',
  'desktop.models.needsOrganization',
  'desktop.models.empty.title',
  'desktop.models.empty.body',
  'desktop.models.empty.filtered',
  'desktop.models.empty.noProfiles',
  'desktop.models.listTitle',
  'desktop.models.listCount',
  'desktop.models.modelDetailsUnknown',
  'desktop.models.parametersUnknown',
  'desktop.models.parameters',
  'desktop.models.viewDetails',
  'desktop.models.optimize',
  'desktop.models.availability.available',
  'desktop.models.availability.missing',
  'desktop.models.availability.unknown',
  'desktop.models.scenarioCount',
  'desktop.models.back',
  'desktop.models.modelFamilyUnknown',
  'desktop.models.warning.missing',
  'desktop.models.warning.unknown',
  'desktop.models.scenario.none',
  'desktop.models.scenario.select',
  'desktop.models.benchmarkCount',
  'desktop.models.profiles.title',
  'desktop.models.profiles.description',
  'desktop.models.default.stale',
  'desktop.models.default.badge',
  'desktop.models.default.set',
  'desktop.models.default.saved',
  'desktop.models.default.choose',
  'desktop.models.launch.title',
  'desktop.models.launch.none',
  'desktop.models.launch.defaultHint',
  'desktop.models.launch.staleHint',
  'desktop.models.launch.unmeasured',
  'desktop.models.launch.safeDefault',
  'desktop.models.launch.safeHint',
  'desktop.models.benchmarks.title',
  'desktop.models.benchmark',
  'desktop.models.start',
  'desktop.models.starting',
  'desktop.models.started',
  'desktop.models.startFailed',
  'desktop.models.warning.replace',
  'desktop.models.legacyEdit',
  'desktop.models.evidence.current',
  'desktop.models.evidence.stale',
  'desktop.models.evidence.changed',
  'desktop.models.evidence.partial',
  'desktop.models.evidence.unmeasured',
  'desktop.settings.title',
  'desktop.settings.language',
  'desktop.settings.languageHint',
  'desktop.footer.disclaimer',
  'desktop.help.title',
  'desktop.help.font.smaller',
  'desktop.help.font.larger',
  'desktop.help.intro.heading',
  'desktop.help.intro.body',
  'desktop.help.install.heading',
  'desktop.help.install.step1',
  'desktop.help.install.step2',
  'desktop.help.install.step3',
  'desktop.help.install.step4',
  'desktop.help.usage.heading',
  'desktop.help.usage.step1',
  'desktop.help.usage.step2',
  'desktop.help.usage.step3',
  'desktop.help.usage.step4',
  'desktop.help.usage.step5',
  'desktop.help.usage.step6',
  'desktop.help.data.heading',
  'desktop.help.data.body',
  'desktop.help.limits.heading',
  'desktop.help.limits.body',
  'desktop.editor.title.create',
  'desktop.editor.title.edit',
  'desktop.editor.id',
  'desktop.editor.id.help',
  'desktop.editor.id.invalid',
  'desktop.editor.displayName.zh',
  'desktop.editor.displayName.en',
  'desktop.editor.displayName.required',
  'desktop.editor.description.en',
  'desktop.editor.model.modelKey',
  'desktop.editor.model.family',
  'desktop.editor.model.quantization',
  'desktop.editor.task.type',
  'desktop.editor.task.kind',
  'desktop.editor.task.kind.none',
  'desktop.editor.runtime.context',
  'desktop.editor.runtime.gpuOffload',
  'desktop.editor.generation.temperature',
  'desktop.editor.behavior.mode',
  'desktop.editor.json',
  'desktop.editor.saved',
  'desktop.models.optimizeFlow.title',
  'desktop.models.optimizeFlow.intro',
  'desktop.models.optimizeFlow.unsavedBaseline',
  'desktop.models.optimizeFlow.unsavedHint',
  'desktop.models.optimizeFlow.baseline',
  'desktop.models.optimizeFlow.baselineHint',
  'desktop.models.optimizeFlow.candidate',
  'desktop.models.optimizeFlow.candidateHint',
  'desktop.models.optimizeFlow.run',
  'desktop.models.optimizeFlow.skip',
  'desktop.models.optimizeFlow.prepare',
  'desktop.models.optimizeFlow.retestSelected',
  'desktop.models.optimizeFlow.preparing',
  'desktop.models.optimizeFlow.status',
  'desktop.models.optimizeFlow.noRecommendation',
  'desktop.models.optimizeFlow.selected',
  'desktop.models.optimizeFlow.evidence.label',
  'desktop.models.optimizeFlow.evidence.measured',
  'desktop.models.optimizeFlow.evidence.unmeasured',
  'desktop.models.optimizeFlow.evidence.failed',
  'desktop.models.optimizeFlow.evidence.canceled',
  'desktop.models.optimizeFlow.evidence.notRun',
  'desktop.models.optimizeFlow.saveId',
  'desktop.models.optimizeFlow.setDefault',
  'desktop.models.optimizeFlow.save',
  'desktop.models.optimizeFlow.saved',
  'desktop.models.optimizeFlow.notReady',
  'desktop.models.optimizeFlow.done',
  'desktop.optimize.title',
  'desktop.optimize.select',
  'desktop.optimize.preview',
  'desktop.optimize.rules',
  'desktop.optimize.candidates',
  'desktop.optimize.none',
  'desktop.optimize.confidence',
  'desktop.optimize.diff.path',
  'desktop.optimize.diff.baseline',
  'desktop.optimize.diff.candidate',
  'desktop.optimize.rationale.zh',
  'desktop.optimize.rationale.en',
  'desktop.optimize.warning',
  'desktop.optimize.save',
  'desktop.optimize.saved',
  'desktop.optimize.notActivated',
  'desktop.optimize.refused.noSafe',
  'desktop.optimize.refused.lowConfidence',
  'desktop.benchmark.title',
  'desktop.benchmark.select',
  'desktop.benchmark.samples',
  'desktop.benchmark.maxTokens',
  'desktop.benchmark.allowBattery',
  'desktop.benchmark.run',
  'desktop.benchmark.running',
  'desktop.benchmark.noResult',
  'desktop.benchmark.notValidated',
  'desktop.benchmark.errorCode',
  'desktop.benchmark.taskType',
  'desktop.benchmark.lmStudio',
  'desktop.unit.gib',
  'desktop.benchmark.metrics',
  'desktop.benchmark.field',
  'desktop.benchmark.value',
  'desktop.benchmark.status.ok',
  'desktop.benchmark.status.failed',
  'desktop.benchmark.status.canceled',
  'desktop.benchmark.fingerprint',
  'desktop.benchmark.promptSuite',
  'desktop.benchmark.metric.tokensPerSecond',
  'desktop.benchmark.metric.latencyP50Ms',
  'desktop.benchmark.metric.loadMs',
  'desktop.benchmark.metric.ttftMs',
  'desktop.benchmark.metric.prefillTokensPerSecond',
  'desktop.benchmark.metric.decodeTokensPerSecond',
  'desktop.benchmark.metric.memoryPeakBytes',
  'desktop.benchmark.metric.samples',
  'desktop.hardware.os',
  'desktop.hardware.cpu',
  'desktop.hardware.cores',
  'desktop.hardware.threads',
  'desktop.hardware.memory',
  'desktop.hardware.memory.total',
  'desktop.hardware.memory.available',
  'desktop.hardware.gpus',
  'desktop.hardware.vram',
  'desktop.hardware.volumes',
  'desktop.hardware.power',
  'desktop.hardware.onBattery',
  'desktop.hardware.onPlugged',
  'desktop.hardware.fingerprint',
  'desktop.hardware.probedAt',
  'desktop.hardware.diagnostics',
  'desktop.hardware.sdkInfo',
  'desktop.error.rpc.lmUnreachable',
  'desktop.error.rpc.profileNotFound',
  'desktop.error.rpc.alreadyExists',
  'desktop.error.rpc.profileInvalid',
  'desktop.error.rpc.optimizeRefused',
  'desktop.error.rpc.batteryGuard',
  'desktop.error.rpc.lockBusy',
  'desktop.error.rpc.methodUnsupported',
  'desktop.error.rpc.unknown',
  'desktop.tasks.quick-chat',
  'desktop.tasks.long-document',
  'desktop.tasks.rag',
  'desktop.tasks.investment-due-diligence',
  'desktop.tasks.meeting-minutes',
  'desktop.tasks.coding',
  'desktop.tasks.structured-extraction',
  'desktop.tasks.agent',
  'desktop.tasks.creative-writing',
  'desktop.tasks.vision',
  'desktop.tasks.custom',
  'tray.status.failed',
  'tray.status.currentActive',
  'tray.status.currentNone',
  'tray.status.unreachable',
  'tray.status.busy',
  'tray.section.recent',
  'tray.section.all',
  'tray.error.unreachable',
  'tray.error.lockBusy',
  'tray.error.canceled',
  'tray.error.stepFailed',
  'tray.action.unload',
  'tray.action.open',
  'tray.action.quit',
] as const;

export type ResourceKey = (typeof resourceKeys)[number];

export interface CommonResources {
  'app.name': string;
  'app.descriptor': string;
  'common.cancel': string;
  'common.confirm': string;
  'common.save': string;
  'common.unknown': string;
  'profile.activate': string;
  'profile.active': string;
  'profile.activateSuccess': string;
  'profile.alreadyActive': string;
  'profile.rollbackSuccess': string;
  'profile.rollbackFailed': string;
  'optimizer.safe': string;
  'optimizer.balanced': string;
  'optimizer.performance': string;
  'optimizer.longContext': string;
  'optimizer.estimated': string;
  'benchmark.title': string;
  'benchmark.cancelled': string;
  'benchmark.completed': string;
  'benchmark.failed': string;
  'benchmark.failedWithCode': string;
  'benchmark.canceled': string;
  'benchmark.status': string;
  'benchmark.loadMs': string;
  'benchmark.ttft': string;
  'benchmark.prefill': string;
  'benchmark.decode': string;
  'benchmark.memoryPeak': string;
  'benchmark.samples': string;
  'benchmark.fingerprint': string;
  'benchmark.promptSuite': string;
  'benchmark.saved': string;
  'benchmark.batteryGuard': string;
  'benchmark.preflight': string;
  'benchmark.invalidRange': string;
  'benchmarkAll.header': string;
  'benchmarkAll.skipped': string;
  'error.modelNotFound': string;
  'error.capabilityUnsupported': string;
  'error.usage': string;
  'error.unknownCommand': string;
  'error.serverOffline': string;
  'error.lmUnreachable': string;
  'error.invalidLocale': string;
  'error.profileNotFound': string;
  'error.profileExists': string;
  'error.badId': string;
  'error.importFailed': string;
  'error.fileRead': string;
  'error.fileWrite': string;
  'error.validationFailed': string;
  'error.lockBusy': string;
  'error.activationPreflight': string;
  'error.activationStepFailed': string;
  'error.internal': string;
  'settings.language': string;
  'settings.thirdPartyNotices': string;
  'cli.usage': string;
  'cli.noCommand': string;
  'verbose.line': string;
  'hook.status.unconfigured': string;
  'hook.status.address': string;
  'hook.status.line': string;
  'hook.state.enabled': string;
  'hook.state.disabled': string;
  'hook.token.stored': string;
  'hook.token.missing': string;
  'hook.token.notStored': string;
  'hook.token.show': string;
  'hook.token.rotated': string;
  'hook.rules.show.none': string;
  'hook.rules.taskClause': string;
  'hook.rules.disabledMark': string;
  'hook.rules.rule': string;
  'hook.rules.valid': string;
  'hook.rules.invalid': string;
  'hook.rules.missingProfile': string;
  'hook.enable.updated': string;
  'hook.disable.updated': string;
  'hook.error.invalidRules': string;
  'hook.error.notConfigured': string;
  'proxy.status.unconfigured': string;
  'proxy.status.line': string;
  'proxy.state.enabled': string;
  'proxy.state.disabled': string;
  'proxy.state.locked': string;
  'proxy.state.unlocked': string;
  'proxy.aliases.show.none': string;
  'proxy.aliases.show.empty': string;
  'proxy.aliases.alias': string;
  'proxy.aliases.activateMark': string;
  'proxy.aliases.disabledMark': string;
  'proxy.aliases.valid': string;
  'proxy.aliases.invalid': string;
  'proxy.aliases.missingProfile': string;
  'proxy.aliases.added.new': string;
  'proxy.aliases.added.replaced': string;
  'proxy.aliases.removed': string;
  'proxy.enable.updated': string;
  'proxy.disable.updated': string;
  'proxy.error.invalidAliases': string;
  'proxy.error.notConfigured': string;
  'proxy.error.aliasMissing': string;
  'profile.list.none': string;
  'profile.list.line': string;
  'profile.show.line': string;
  'profile.show.createdAt': string;
  'profile.show.updatedAt': string;
  'profile.create.created': string;
  'profile.create.nameMismatch': string;
  'profile.edit.updated': string;
  'profile.edit.template': string;
  'profile.clone.cloned': string;
  'profile.delete.deleted': string;
  'profile.delete.requiresYes': string;
  'profile.import.imported': string;
  'profile.import.badExtension': string;
  'profile.export.exported': string;
  'apply.idempotent': string;
  'apply.activated': string;
  'apply.canceled': string;
  'apply.recovered': string;
  'apply.failed': string;
  'apply.requiresYes': string;
  'optimize.title': string;
  'optimize.ruleVersion': string;
  'optimize.noSafeCandidate': string;
  'optimize.noSafeCandidateYes': string;
  'optimize.lowConfidence': string;
  'optimize.savedButNotActivated': string;
  'optimize.confidenceHigh': string;
  'optimize.confidenceLow': string;
  'optimize.headroom': string;
  'optimize.memGpu': string;
  'optimize.memTotal': string;
  'optimize.ramReserve': string;
  'optimize.ramHeadroom': string;
  'optimize.measuredPeak': string;
  'optimize.degraded': string;
  'optimize.rebenchmark': string;
  'optimize.measured': string;
  'resourceFit.gpuResident': string;
  'resourceFit.hybridMemory': string;
  'resourceFit.hostMemory': string;
  'resourceFit.resourceUnknown': string;
  'resourceFit.resourceInsufficient': string;
  'candidate.head': string;
  'candidate.score': string;
  'candidate.unsafe': string;
  'diff.field': string;
  'error.optimizeEstimateFailed': string;
  'models.none': string;
  'models.line': string;
  'current.none': string;
  'current.line': string;
  'snapshot.line': string;
  'hardware.title': string;
  'hardware.os': string;
  'hardware.cpu': string;
  'hardware.memory': string;
  'hardware.gpu': string;
  'hardware.gpuUnknown': string;
  'hardware.gpuNone': string;
  'hardware.volume': string;
  'hardware.volumeExternal': string;
  'hardware.probedAt': string;
  'lang.show': string;
  'lang.set': string;
  'doctor.title': string;
  'doctor.status.ok': string;
  'doctor.status.fail': string;
  'doctor.status.warn': string;
  'doctor.warn.discovery': string;
  'doctor.bundleNotice': string;
  'doctor.check.store': string;
  'doctor.check.config': string;
  'doctor.check.locale': string;
  'doctor.check.node': string;
  'doctor.check.discovery': string;
  'doctor.check.hardware': string;
  'desktop.status.connecting': string;
  'desktop.status.connected': string;
  'desktop.status.help': string;
  'desktop.status.disconnected': string;
  'desktop.status.authFailed': string;
  'desktop.status.startFailed': string;
  'desktop.action.probe': string;
  'desktop.action.hardware': string;
  'desktop.action.sdkInfo': string;
  'desktop.locale.label': string;
  'desktop.locale.zhCN': string;
  'desktop.locale.en': string;
  'desktop.settings.label': string;
  'desktop.settings.placeholder': string;
  'desktop.probe.title': string;
  'desktop.hardware.title': string;
  'desktop.sdkInfo.title': string;
  'desktop.result.error': string;
  'desktop.hint.idle': string;
  'desktop.nav.profiles': string;
  'desktop.nav.optimize': string;
  'desktop.nav.benchmark': string;
  'desktop.nav.hardware': string;
  'desktop.nav.help': string;
  'desktop.profiles.title': string;
  'desktop.profiles.filter': string;
  'desktop.profiles.new': string;
  'desktop.profiles.empty': string;
  'desktop.profiles.nothing': string;
  'desktop.profiles.edit': string;
  'desktop.profiles.delete': string;
  'desktop.profiles.confirmDelete': string;
  'desktop.profiles.optimize': string;
  'desktop.profiles.benchmark': string;
  'desktop.profiles.updatedAt': string;
  'desktop.profiles.apply': string;
  'desktop.profiles.applying': string;
  'desktop.profiles.applyConfirm': string;
  'desktop.profiles.activeBadge': string;
  'desktop.nav.models': string;
  'desktop.nav.settings': string;
  'desktop.models.title': string;
  'desktop.models.subtitle': string;
  'desktop.models.refresh': string;
  'desktop.models.filter': string;
  'desktop.models.refreshing': string;
  'desktop.models.retry': string;
  'desktop.models.preparation': string;
  'desktop.models.readiness.hardware': string;
  'desktop.models.readiness.lmStudio': string;
  'desktop.models.readiness.discovery': string;
  'desktop.models.readiness.hardwareReady': string;
  'desktop.models.readiness.hardwareHelp': string;
  'desktop.models.readiness.version': string;
  'desktop.models.readiness.lmStudioHelp': string;
  'desktop.models.readiness.modelCount': string;
  'desktop.models.readiness.discoveryHelp': string;
  'desktop.models.status.ready': string;
  'desktop.models.status.partial': string;
  'desktop.models.status.offline': string;
  'desktop.models.status.unavailable': string;
  'desktop.models.status.unknown': string;
  'desktop.models.status.running': string;
  'desktop.models.status.idle': string;
  'desktop.models.runtime.title': string;
  'desktop.models.runtime.none': string;
  'desktop.models.needsOrganization': string;
  'desktop.models.empty.title': string;
  'desktop.models.empty.body': string;
  'desktop.models.empty.filtered': string;
  'desktop.models.empty.noProfiles': string;
  'desktop.models.listTitle': string;
  'desktop.models.listCount': string;
  'desktop.models.modelDetailsUnknown': string;
  'desktop.models.parametersUnknown': string;
  'desktop.models.parameters': string;
  'desktop.models.viewDetails': string;
  'desktop.models.optimize': string;
  'desktop.models.availability.available': string;
  'desktop.models.availability.missing': string;
  'desktop.models.availability.unknown': string;
  'desktop.models.scenarioCount': string;
  'desktop.models.back': string;
  'desktop.models.modelFamilyUnknown': string;
  'desktop.models.warning.missing': string;
  'desktop.models.warning.unknown': string;
  'desktop.models.scenario.none': string;
  'desktop.models.scenario.select': string;
  'desktop.models.benchmarkCount': string;
  'desktop.models.profiles.title': string;
  'desktop.models.profiles.description': string;
  'desktop.models.default.stale': string;
  'desktop.models.default.badge': string;
  'desktop.models.default.set': string;
  'desktop.models.default.saved': string;
  'desktop.models.default.choose': string;
  'desktop.models.launch.title': string;
  'desktop.models.launch.none': string;
  'desktop.models.launch.defaultHint': string;
  'desktop.models.launch.staleHint': string;
  'desktop.models.launch.unmeasured': string;
  'desktop.models.launch.safeDefault': string;
  'desktop.models.launch.safeHint': string;
  'desktop.models.benchmarks.title': string;
  'desktop.models.benchmark': string;
  'desktop.models.start': string;
  'desktop.models.starting': string;
  'desktop.models.started': string;
  'desktop.models.startFailed': string;
  'desktop.models.warning.replace': string;
  'desktop.models.legacyEdit': string;
  'desktop.models.evidence.current': string;
  'desktop.models.evidence.stale': string;
  'desktop.models.evidence.changed': string;
  'desktop.models.evidence.partial': string;
  'desktop.models.evidence.unmeasured': string;
  'desktop.settings.title': string;
  'desktop.settings.language': string;
  'desktop.settings.languageHint': string;
  'desktop.footer.disclaimer': string;
  'desktop.help.title': string;
  'desktop.help.font.smaller': string;
  'desktop.help.font.larger': string;
  'desktop.help.intro.heading': string;
  'desktop.help.intro.body': string;
  'desktop.help.install.heading': string;
  'desktop.help.install.step1': string;
  'desktop.help.install.step2': string;
  'desktop.help.install.step3': string;
  'desktop.help.install.step4': string;
  'desktop.help.usage.heading': string;
  'desktop.help.usage.step1': string;
  'desktop.help.usage.step2': string;
  'desktop.help.usage.step3': string;
  'desktop.help.usage.step4': string;
  'desktop.help.usage.step5': string;
  'desktop.help.usage.step6': string;
  'desktop.help.data.heading': string;
  'desktop.help.data.body': string;
  'desktop.help.limits.heading': string;
  'desktop.help.limits.body': string;
  'desktop.editor.title.create': string;
  'desktop.editor.title.edit': string;
  'desktop.editor.id': string;
  'desktop.editor.id.help': string;
  'desktop.editor.id.invalid': string;
  'desktop.editor.displayName.zh': string;
  'desktop.editor.displayName.en': string;
  'desktop.editor.displayName.required': string;
  'desktop.editor.description.en': string;
  'desktop.editor.model.modelKey': string;
  'desktop.editor.model.family': string;
  'desktop.editor.model.quantization': string;
  'desktop.editor.task.type': string;
  'desktop.editor.task.kind': string;
  'desktop.editor.task.kind.none': string;
  'desktop.editor.runtime.context': string;
  'desktop.editor.runtime.gpuOffload': string;
  'desktop.editor.generation.temperature': string;
  'desktop.editor.behavior.mode': string;
  'desktop.editor.json': string;
  'desktop.editor.saved': string;
  'desktop.models.optimizeFlow.title': string;
  'desktop.models.optimizeFlow.intro': string;
  'desktop.models.optimizeFlow.unsavedBaseline': string;
  'desktop.models.optimizeFlow.unsavedHint': string;
  'desktop.models.optimizeFlow.baseline': string;
  'desktop.models.optimizeFlow.baselineHint': string;
  'desktop.models.optimizeFlow.candidate': string;
  'desktop.models.optimizeFlow.candidateHint': string;
  'desktop.models.optimizeFlow.run': string;
  'desktop.models.optimizeFlow.skip': string;
  'desktop.models.optimizeFlow.prepare': string;
  'desktop.models.optimizeFlow.retestSelected': string;
  'desktop.models.optimizeFlow.preparing': string;
  'desktop.models.optimizeFlow.status': string;
  'desktop.models.optimizeFlow.noRecommendation': string;
  'desktop.models.optimizeFlow.selected': string;
  'desktop.models.optimizeFlow.evidence.label': string;
  'desktop.models.optimizeFlow.evidence.measured': string;
  'desktop.models.optimizeFlow.evidence.unmeasured': string;
  'desktop.models.optimizeFlow.evidence.failed': string;
  'desktop.models.optimizeFlow.evidence.canceled': string;
  'desktop.models.optimizeFlow.evidence.notRun': string;
  'desktop.models.optimizeFlow.saveId': string;
  'desktop.models.optimizeFlow.setDefault': string;
  'desktop.models.optimizeFlow.save': string;
  'desktop.models.optimizeFlow.saved': string;
  'desktop.models.optimizeFlow.notReady': string;
  'desktop.models.optimizeFlow.done': string;
  'desktop.optimize.title': string;
  'desktop.optimize.select': string;
  'desktop.optimize.preview': string;
  'desktop.optimize.rules': string;
  'desktop.optimize.candidates': string;
  'desktop.optimize.none': string;
  'desktop.optimize.confidence': string;
  'desktop.optimize.diff.path': string;
  'desktop.optimize.diff.baseline': string;
  'desktop.optimize.diff.candidate': string;
  'desktop.optimize.rationale.zh': string;
  'desktop.optimize.rationale.en': string;
  'desktop.optimize.warning': string;
  'desktop.optimize.save': string;
  'desktop.optimize.saved': string;
  'desktop.optimize.notActivated': string;
  'desktop.optimize.refused.noSafe': string;
  'desktop.optimize.refused.lowConfidence': string;
  'desktop.benchmark.title': string;
  'desktop.benchmark.select': string;
  'desktop.benchmark.samples': string;
  'desktop.benchmark.maxTokens': string;
  'desktop.benchmark.allowBattery': string;
  'desktop.benchmark.run': string;
  'desktop.benchmark.running': string;
  'desktop.benchmark.noResult': string;
  'desktop.benchmark.notValidated': string;
  'desktop.benchmark.errorCode': string;
  'desktop.benchmark.taskType': string;
  'desktop.benchmark.lmStudio': string;
  'desktop.unit.gib': string;
  'desktop.benchmark.metrics': string;
  'desktop.benchmark.field': string;
  'desktop.benchmark.value': string;
  'desktop.benchmark.status.ok': string;
  'desktop.benchmark.status.failed': string;
  'desktop.benchmark.status.canceled': string;
  'desktop.benchmark.fingerprint': string;
  'desktop.benchmark.promptSuite': string;
  'desktop.benchmark.metric.tokensPerSecond': string;
  'desktop.benchmark.metric.latencyP50Ms': string;
  'desktop.benchmark.metric.loadMs': string;
  'desktop.benchmark.metric.ttftMs': string;
  'desktop.benchmark.metric.prefillTokensPerSecond': string;
  'desktop.benchmark.metric.decodeTokensPerSecond': string;
  'desktop.benchmark.metric.memoryPeakBytes': string;
  'desktop.benchmark.metric.samples': string;
  'desktop.hardware.os': string;
  'desktop.hardware.cpu': string;
  'desktop.hardware.cores': string;
  'desktop.hardware.threads': string;
  'desktop.hardware.memory': string;
  'desktop.hardware.memory.total': string;
  'desktop.hardware.memory.available': string;
  'desktop.hardware.gpus': string;
  'desktop.hardware.vram': string;
  'desktop.hardware.volumes': string;
  'desktop.hardware.power': string;
  'desktop.hardware.onBattery': string;
  'desktop.hardware.onPlugged': string;
  'desktop.hardware.fingerprint': string;
  'desktop.hardware.probedAt': string;
  'desktop.hardware.diagnostics': string;
  'desktop.hardware.sdkInfo': string;
  'desktop.error.rpc.lmUnreachable': string;
  'desktop.error.rpc.profileNotFound': string;
  'desktop.error.rpc.alreadyExists': string;
  'desktop.error.rpc.profileInvalid': string;
  'desktop.error.rpc.optimizeRefused': string;
  'desktop.error.rpc.batteryGuard': string;
  'desktop.error.rpc.lockBusy': string;
  'desktop.error.rpc.methodUnsupported': string;
  'desktop.error.rpc.unknown': string;
  'desktop.tasks.quick-chat': string;
  'desktop.tasks.long-document': string;
  'desktop.tasks.rag': string;
  'desktop.tasks.investment-due-diligence': string;
  'desktop.tasks.meeting-minutes': string;
  'desktop.tasks.coding': string;
  'desktop.tasks.structured-extraction': string;
  'desktop.tasks.agent': string;
  'desktop.tasks.creative-writing': string;
  'desktop.tasks.vision': string;
  'desktop.tasks.custom': string;
  'tray.status.failed': string;
  'tray.status.currentActive': string;
  'tray.status.currentNone': string;
  'tray.status.unreachable': string;
  'tray.status.busy': string;
  'tray.section.recent': string;
  'tray.section.all': string;
  'tray.error.unreachable': string;
  'tray.error.lockBusy': string;
  'tray.error.canceled': string;
  'tray.error.stepFailed': string;
  'tray.action.unload': string;
  'tray.action.open': string;
  'tray.action.quit': string;
}
