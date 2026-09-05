import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  createI18n,
  createMemoryLanguageStore,
  loadResourceFiles,
  type I18nResources,
  type LanguageStore,
} from '@lmps/i18n';

// fileURLToPath 而非 .pathname：.pathname 在 Windows 上会产生前导斜杠，无法被 node:fs 使用
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const realResources = loadResourceFiles(workspaceRoot);

function partialChineseWithoutProfileKey(): I18nResources {
  // 构造 zh-CN 缺少一个真实 key 的资源，用于验证按需回退到英文
  const zh = JSON.parse(JSON.stringify(realResources['zh-CN'])) as {
    common: Record<string, string>;
  };
  delete zh.common['profile.activateSuccess'];
  return { ...realResources, 'zh-CN': zh };
}

function failingStore(initial: ReturnType<typeof createMemoryLanguageStore> | null = null): LanguageStore {
  const inner = initial ?? createMemoryLanguageStore();
  return {
    get: () => inner.get(),
    set: () => {
      throw new Error('storage unavailable');
    },
  };
}

describe('initial locale resolution', () => {
  it('prefers an explicit initial locale over store, system, and default', () => {
    const service = createI18n({
      resources: realResources,
      initialLocale: 'zh-CN',
      systemLocale: 'en',
      store: createMemoryLanguageStore('en'),
    });
    expect(service.getLocale()).toBe('zh-CN');
    expect(service.locale).toBe('zh-CN');
  });

  it('uses the injected store when no explicit locale is given', () => {
    const service = createI18n({
      resources: realResources,
      store: createMemoryLanguageStore('zh-CN'),
      systemLocale: 'en',
    });
    expect(service.getLocale()).toBe('zh-CN');
    service.dispose();
  });

  it('ignores an invalid persisted locale and falls through to the system locale', () => {
    const service = createI18n({
      resources: realResources,
      store: createMemoryLanguageStore('fr'),
      systemLocale: 'zh-CN',
    });
    expect(service.getLocale()).toBe('zh-CN');
    service.dispose();
  });

  it('detects the system locale when no store value exists', () => {
    const service = createI18n({
      resources: realResources,
      systemLocale: 'zh-CN',
    });
    expect(service.getLocale()).toBe('zh-CN');
    service.dispose();
  });

  it('defaults to English when everything is unknown', () => {
    const service = createI18n({ resources: realResources });
    expect(service.getLocale()).toBe('en');
    service.dispose();
  });
});

describe('translation', () => {
  it('translates a key with interpolation in Chinese', () => {
    const service = createI18n({ resources: realResources, initialLocale: 'zh-CN' });
    expect(service.t('profile.activateSuccess', { name: 'Mistral-7B' })).toBe('已激活 Mistral-7B');
    expect(service.t('common.cancel')).toBe('取消');
    service.dispose();
  });

  it('translates a key with interpolation in English', () => {
    const service = createI18n({ resources: realResources, initialLocale: 'en' });
    expect(service.t('profile.activateSuccess', { name: 'Mistral-7B' })).toBe('Activated Mistral-7B');
    expect(service.t('common.cancel')).toBe('Cancel');
    service.dispose();
  });

  it('falls back to English for a key missing in the active locale', () => {
    const service = createI18n({
      resources: partialChineseWithoutProfileKey(),
      initialLocale: 'zh-CN',
    });
    const translated = service.t('profile.activateSuccess', { name: 'demo' });
    expect(translated).toBe('Activated demo');
    expect(translated).not.toContain('已激活');
    service.dispose();
  });

  it('does not HTML-escape interpolated values', () => {
    const service = createI18n({ resources: realResources, initialLocale: 'en' });
    expect(service.t('profile.alreadyActive', { name: 'A < B & C' })).toBe(
      'A < B & C is already active',
    );
    service.dispose();
  });
});

describe('immediate switching and persistence', () => {
  it('switches language immediately and notifies listeners in order', () => {
    const service = createI18n({ resources: realResources, initialLocale: 'en' });
    const seen: string[] = [];
    const unsubscribe = service.onLocaleChanged((locale) => seen.push(locale));

    service.setLocale('zh-CN');
    expect(service.getLocale()).toBe('zh-CN');
    expect(service.t('common.save')).toBe('保存');
    expect(seen).toEqual(['zh-CN']);

    service.setLocale('en');
    expect(seen).toEqual(['zh-CN', 'en']);

    unsubscribe();
    service.setLocale('zh-CN');
    expect(seen).toEqual(['zh-CN', 'en']);
    service.dispose();
  });

  it('persists the locale through the injected store on every switch', () => {
    const store = createMemoryLanguageStore('en');
    const service = createI18n({ resources: realResources, store });

    service.setLocale('zh-CN');
    expect(store.get()).toBe('zh-CN');
    service.dispose();
  });

  it('treats switching to the current locale as a no-op', () => {
    const store = createMemoryLanguageStore('en');
    const service = createI18n({ resources: realResources, store, initialLocale: 'en' });
    const listener = vi.fn();
    service.onLocaleChanged(listener);

    service.setLocale('en');
    expect(listener).not.toHaveBeenCalled();
    expect(store.get()).toBe('en');
    service.dispose();
  });

  it('ignores unsupported locale values without switching', () => {
    const service = createI18n({ resources: realResources, initialLocale: 'en' });
    const listener = vi.fn();
    service.onLocaleChanged(listener);

    service.setLocale('fr');
    expect(service.getLocale()).toBe('en');
    expect(listener).not.toHaveBeenCalled();
    service.dispose();
  });

  it('keeps the switch when persistence fails and reports the error', () => {
    const handler = vi.fn();
    const service = createI18n({
      resources: realResources,
      initialLocale: 'en',
      store: failingStore(),
      persistenceErrorHandler: handler,
    });

    service.setLocale('zh-CN');
    expect(service.getLocale()).toBe('zh-CN');
    expect(handler).toHaveBeenCalledOnce();
    expect(String((handler.mock.calls[0] ?? [])[0])).toContain('storage unavailable');
    service.dispose();
  });

  it('disposes listeners and stops reporting after dispose', () => {
    const service = createI18n({ resources: realResources, initialLocale: 'en' });
    const listener = vi.fn();
    service.onLocaleChanged(listener);
    service.dispose();

    service.setLocale('zh-CN');
    expect(listener).not.toHaveBeenCalled();
  });
});