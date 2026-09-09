/**
 * Profile editor (M3-002): create/update form over the domain contract.
 * Client-side mirrors of the id regex and required-field rules catch obvious
 * mistakes before the sidecar's schema validation (which still guards the
 * write). Edit mode seeds from the sanitized `profiles.show` document and shows
 * that document as the JSON preview; create mode previews the live draft.
 */
import { useCallback, useEffect, useState } from 'react';
import type { I18nService, ResourceKey, TranslationFunction } from '@lmps/i18n/browser';
import { rpc } from '../api';
import { useTypedRpc } from '../hooks';
import type { LocalizedText, ProfileDocument } from '../types';

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SCHEMA_VERSION = 2;

export type EditorState = { mode: 'create' } | { mode: 'edit'; id: string };

interface EditorViewProps {
  i18n: I18nService;
  state: EditorState;
  onSaved: () => void;
  onCancel: () => void;
}

interface Draft {
  id: string;
  zhName: string;
  enName: string;
  enDesc: string;
  modelKey: string;
  family: string;
  quantization: string;
  taskType: string;
  taskKind: string;
  contextLength: string;
  gpuOffload: string;
  gpuOffloadNumeric: string;
  temperature: string;
  mode: string;
}

function emptyDraft(): Draft {
  return {
    id: '',
    zhName: '',
    enName: '',
    enDesc: '',
    modelKey: '',
    family: '',
    quantization: '',
    taskType: 'quick-chat',
    taskKind: 'quick-chat',
    contextLength: '',
    gpuOffload: 'auto',
    gpuOffloadNumeric: '',
    temperature: '',
    mode: '',
  };
}

/** Rounds a raw input string to an integer ≥ min, or undefined when NaN. */
function toInt(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value) : undefined;
}

function toFloat(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function EditorView({ i18n, state, onSaved, onCancel }: EditorViewProps) {
  const t: TranslationFunction = i18n.t;
  const isEdit = state.mode === 'edit';
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<string[]>([]);
  const [sourceDoc, setSourceDoc] = useState<ProfileDocument | null>(null);

  const meta = useTypedRpc<{ taskKinds: string[] }>();
  const source = useTypedRpc<{ profile: ProfileDocument }>();
  const submit = useTypedRpc<{ id: string }>();

  useEffect(() => {
    meta.run(() => rpc.profilesMeta());
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    source.run(() => rpc.profilesShow(state.mode === 'edit' ? state.id : ''));
  }, [isEdit, state]);

  useEffect(() => {
    if (source.state.kind !== 'done') return;
    const doc = source.state.value.profile;
    setSourceDoc(doc);
    setDraft({
      id: doc.id ?? '',
      zhName: doc.displayName?.['zh-CN'] ?? '',
      enName: doc.displayName?.en ?? '',
      enDesc: doc.description?.en ?? '',
      modelKey: doc.model?.modelKey ?? '',
      family: doc.model?.family ?? '',
      quantization: doc.model?.quantization ?? '',
      taskType: doc.task?.type ?? 'quick-chat',
      taskKind: doc.task?.kind ?? 'quick-chat',
      contextLength: String(doc.runtime?.contextLength ?? ''),
      gpuOffload:
        typeof doc.runtime?.gpuOffload === 'string' ? doc.runtime.gpuOffload : 'auto',
      gpuOffloadNumeric:
        typeof doc.runtime?.gpuOffload === 'number' ? String(doc.runtime.gpuOffload) : '',
      temperature: String(doc.generation?.temperature ?? ''),
      mode: doc.behavior?.mode ?? '',
    });
  }, [source.state]);

  useEffect(() => {
    if (submit.state.kind !== 'done') return;
    onSaved();
  }, [submit.state, onSaved]);

  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const gpuOffloadValue = (): string | number | undefined => {
    if (draft.gpuOffload === 'number') return toFloat(draft.gpuOffloadNumeric);
    return draft.gpuOffload === '' ? undefined : draft.gpuOffload;
  };

  const buildDocument = (): ProfileDocument => {
    const model: ProfileDocument['model'] = { modelKey: draft.modelKey };
    if (draft.family.trim() !== '') model.family = draft.family.trim();
    if (draft.quantization.trim() !== '') model.quantization = draft.quantization.trim();

    const task: ProfileDocument['task'] = { type: draft.taskType.trim() };
    if (draft.taskKind !== '') task.kind = draft.taskKind;

    const runtime: ProfileDocument['runtime'] = {};
    const contextLength = toInt(draft.contextLength);
    if (contextLength !== undefined && contextLength >= 1) runtime.contextLength = contextLength;
    const offload = gpuOffloadValue();
    if (offload !== undefined) runtime.gpuOffload = offload;

    const generation: ProfileDocument['generation'] = {};
    const temperature = toFloat(draft.temperature);
    if (temperature !== undefined) generation.temperature = temperature;

    const displayName: LocalizedText = { 'zh-CN': draft.zhName, en: draft.enName };
    const doc: ProfileDocument = {
      schemaVersion: SCHEMA_VERSION,
      id: draft.id.trim(),
      displayName,
      model,
      task,
      metadata: { createdAt: nowIso(), updatedAt: nowIso(), ...(sourceDoc?.metadata ?? {}) },
    };
    if (draft.enDesc.trim() !== '') {
      doc.description = { ...(sourceDoc?.description ?? {}), en: draft.enDesc.trim() };
    }
    if (Object.keys(runtime).length > 0) doc.runtime = runtime;
    if (Object.keys(generation).length > 0) doc.generation = generation;
    if (draft.mode !== '') doc.behavior = { mode: draft.mode };
    return doc;
  };

  const buildPatch = (): Record<string, unknown> => {
    const doc = buildDocument();
    // id is immutable and metadata is stamped by the store; never patch them.
    return Object.fromEntries(
      Object.entries(doc).filter(([key]) => !['id', 'schemaVersion', 'metadata'].includes(key)),
    );
  };

  const validate = (): string[] => {
    const problems: string[] = [];
    if (!isEdit && !ID_RE.test(draft.id.trim())) {
      problems.push(t('desktop.editor.id.invalid'));
    }
    if (draft.zhName.trim() === '' || draft.enName.trim() === '') {
      problems.push(t('desktop.editor.displayName.required'));
    }
    if (draft.modelKey.trim() === '') {
      problems.push(t('desktop.editor.model.modelKey'));
    }
    const contextLength = toInt(draft.contextLength);
    if (contextLength !== undefined && contextLength < 1) {
      problems.push(t('desktop.editor.runtime.context'));
    }
    return problems;
  };

  const onSubmit = () => {
    const problems = validate();
    setErrors(problems);
    if (problems.length > 0) return;
    if (isEdit) {
      submit.run(() => rpc.profilesUpdate(state.mode === 'edit' ? state.id : '', buildPatch()));
    } else {
      submit.run(() => rpc.profilesCreate(buildDocument() as unknown as Record<string, unknown>));
    }
  };

  const taskKinds = meta.state.kind === 'done' ? meta.state.value.taskKinds : [];
  const preview = isEdit
    ? JSON.stringify(sourceDoc ?? null, null, 2)
    : JSON.stringify(buildDocument(), null, 2);

  return (
    <div className="editor-view">
      <div className="view-head">
        <h2>{t(isEdit ? 'desktop.editor.title.edit' : 'desktop.editor.title.create')}</h2>
        <div className="btn-row">
          <button type="button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary" disabled={submit.state.kind === 'running'} onClick={onSubmit}>
            {t('common.save')}
          </button>
        </div>
      </div>

      {source.state.kind === 'error' && <p className="error">{source.state.failure.message}</p>}

      <div className="form-grid">
        <label className="field">
          <span>{t('desktop.editor.id')}</span>
          <input
            value={draft.id}
            disabled={isEdit}
            placeholder={isEdit ? (state.mode === 'edit' ? state.id : '') : ''}
            onChange={(event) => set('id', event.target.value)}
          />
          <span className="hint">
            {isEdit ? state.mode === 'edit' ? state.id : '' : t('desktop.editor.id.help')}
          </span>
        </label>

        <label className="field">
          <span>{t('desktop.editor.displayName.zh')}</span>
          <input value={draft.zhName} onChange={(event) => set('zhName', event.target.value)} />
        </label>

        <label className="field">
          <span>{t('desktop.editor.displayName.en')}</span>
          <input value={draft.enName} onChange={(event) => set('enName', event.target.value)} />
        </label>

        <label className="field">
          <span>{t('desktop.editor.description.en')}</span>
          <input value={draft.enDesc} onChange={(event) => set('enDesc', event.target.value)} />
        </label>

        <label className="field">
          <span>{t('desktop.editor.model.modelKey')}</span>
          <input value={draft.modelKey} onChange={(event) => set('modelKey', event.target.value)} />
        </label>

        <label className="field">
          <span>{t('desktop.editor.model.family')}</span>
          <input value={draft.family} onChange={(event) => set('family', event.target.value)} />
        </label>

        <label className="field">
          <span>{t('desktop.editor.model.quantization')}</span>
          <input value={draft.quantization} onChange={(event) => set('quantization', event.target.value)} />
        </label>

        <label className="field">
          <span>{t('desktop.editor.task.type')}</span>
          <input value={draft.taskType} onChange={(event) => set('taskType', event.target.value)} />
        </label>

        <label className="field">
          <span>{t('desktop.editor.task.kind')}</span>
          <select value={draft.taskKind} onChange={(event) => set('taskKind', event.target.value)}>
            <option value="">{t('desktop.editor.task.kind.none')}</option>
            {taskKinds.map((kind) => (
              <option key={kind} value={kind}>
                {t(`desktop.tasks.${kind}` as ResourceKey)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>{t('desktop.editor.runtime.context')}</span>
          <input
            type="number"
            min={1}
            value={draft.contextLength}
            onChange={(event) => set('contextLength', event.target.value)}
          />
        </label>

        <label className="field">
          <span>{t('desktop.editor.runtime.gpuOffload')}</span>
          <select value={draft.gpuOffload} onChange={(event) => set('gpuOffload', event.target.value)}>
            <option value="auto">auto</option>
            <option value="max">max</option>
            <option value="off">off</option>
            <option value="number">{t('common.unknown')}</option>
          </select>
          {draft.gpuOffload === 'number' && (
            <input
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={draft.gpuOffloadNumeric}
              onChange={(event) => set('gpuOffloadNumeric', event.target.value)}
            />
          )}
        </label>

        <label className="field">
          <span>{t('desktop.editor.generation.temperature')}</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={draft.temperature}
            onChange={(event) => set('temperature', event.target.value)}
          />
        </label>

        <label className="field">
          <span>{t('desktop.editor.behavior.mode')}</span>
          <select value={draft.mode} onChange={(event) => set('mode', event.target.value)}>
            <option value="">{t('common.unknown')}</option>
            <option value="exclusive">exclusive</option>
            <option value="coexist">coexist</option>
          </select>
        </label>
      </div>

      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((message) => (
            <li key={message} className="error">
              {message}
            </li>
          ))}
        </ul>
      )}

      {submit.state.kind === 'error' && (
        <p className="error">
          {i18n.t(submit.state.failure.code === 'STORE_ALREADY_EXISTS'
            ? 'desktop.error.rpc.alreadyExists'
            : submit.state.failure.code === 'PROFILE_INVALID'
              ? 'desktop.error.rpc.profileInvalid'
              : 'desktop.error.rpc.unknown', { message: submit.state.failure.message })}
        </p>
      )}

      <details className="json-preview">
        <summary>{t('desktop.editor.json')}</summary>
        <pre className="result">{preview}</pre>
      </details>

      <div className="view-foot btn-row">
        <button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="primary" disabled={submit.state.kind === 'running'} onClick={onSubmit}>
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}