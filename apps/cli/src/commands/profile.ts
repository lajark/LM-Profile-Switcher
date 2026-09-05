/**
 * `lmps profile <list|show|create|edit|clone|delete|import|export>`.
 * Reads/writes go through the injected ProfileStore and text seams; every value
 * presented to the user is either a stable summary or a store-sanitized document.
 */
import { parseCommandArgs, type CommandSpec } from '../options.js';
import { CliError } from '../errors.js';
import type { CliDeps, CommandOutput } from '../seams.js';

const SUBCOMMANDS: Record<string, CommandSpec> = {
  list: { flags: { model: 'string', task: 'string' }, maxPositional: 0 },
  show: { maxPositional: 1 },
  create: { flags: { name: 'string', file: 'string' }, maxPositional: 0 },
  edit: { flags: { patch: 'string' }, maxPositional: 1 },
  clone: { maxPositional: 2 },
  delete: { flags: { yes: 'boolean' }, maxPositional: 1 },
  import: { flags: { 'allow-rename': 'boolean' }, maxPositional: 1 },
  export: { flags: { format: 'string' }, short: { '-o': 'output' }, maxPositional: 1 },
};

function usage(message: string): CliError {
  return new CliError('USAGE', message, { detail: message });
}

export async function runProfileCommand(deps: CliDeps, args: readonly string[]): Promise<CommandOutput> {
  const raw = args[0];
  if (raw === undefined || raw.startsWith('-')) {
    throw usage('profile requires a subcommand (list|show|create|edit|clone|delete|import|export)');
  }
  const spec = SUBCOMMANDS[raw];
  if (spec === undefined) {
    throw usage(`unknown profile subcommand: ${raw}`);
  }
  const sub = parseCommandArgs(spec, args.slice(1));

  switch (raw) {
    case 'list':
      return runList(deps, sub);
    case 'show':
      return runShow(deps, sub);
    case 'create':
      return runCreate(deps, sub);
    case 'edit':
      return runEdit(deps, sub);
    case 'clone':
      return runClone(deps, sub);
    case 'delete':
      return runDelete(deps, sub);
    case 'import':
      return runImport(deps, sub);
    case 'export':
      return runExport(deps, sub);
  }
  throw usage(`unknown profile subcommand: ${raw}`);
}

interface ParsedSub {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function runList(deps: CliDeps, sub: ParsedSub): CommandOutput {
  const modelFilter = typeof sub.flags.model === 'string' ? sub.flags.model : null;
  const taskFilter = typeof sub.flags.task === 'string' ? sub.flags.task : null;
  const profiles = deps.store
    .list()
    .filter(
      (profile) =>
        (modelFilter === null || profile.model.modelKey === modelFilter) &&
        (taskFilter === null || profile.task.type === taskFilter),
    );

  const summaries = profiles.map((profile) => ({
    id: profile.id,
    displayName: profile.displayName,
    model: { modelKey: profile.model.modelKey, family: profile.model.family },
    task: { type: profile.task.type },
    updatedAt: profile.metadata.updatedAt,
  }));

  const text =
    summaries.length === 0
      ? deps.t('profile.list.none')
      : summaries
          .map((summary) =>
            deps.t('profile.list.line', { id: summary.id, task: summary.task.type, model: summary.model.modelKey }),
          )
          .join('\n');
  return { text, data: { count: summaries.length, profiles: summaries } };
}

function runShow(deps: CliDeps, sub: ParsedSub): CommandOutput {
  const id = positional(sub, 'show');
  // exportJson reuses the store sanitizer: token/secret fields → null, private paths → <private>.
  const doc = JSON.parse(deps.store.exportJson(id)) as {
    id: string;
    task: { type: string };
    model: { modelKey: string };
    metadata: { createdAt: string; updatedAt: string };
  };
  const text = [
    deps.t('profile.show.line', { id: doc.id, task: doc.task.type, model: doc.model.modelKey }),
    deps.t('profile.show.createdAt', { at: doc.metadata.createdAt }),
    deps.t('profile.show.updatedAt', { at: doc.metadata.updatedAt }),
  ].join('\n');
  return { text, data: { profile: doc } };
}

async function runCreate(deps: CliDeps, sub: ParsedSub): Promise<CommandOutput> {
  const name = sub.flags.name;
  const file = sub.flags.file;
  if (typeof name !== 'string' || typeof file !== 'string') {
    throw usage('--name <id> and --file <json|yaml|-> are required for create');
  }
  // Fail fast on a colliding id before reading input; a duplicate is a usage
  // error no matter what the incoming document says.
  if (profileExists(deps, name)) {
    throw new CliError('USAGE', 'a profile with this id already exists', { params: { key: 'error.profileExists' } });
  }
  const text = await readSource(deps, file);
  let created;
  if (file === '-') {
    created = deps.store.importFromJson(text, { strict: false }); // stdin defaults to JSON
  } else {
    const ext = extensionOf(file);
    if (ext === '.yaml' || ext === '.yml') {
      created = deps.store.importFromYaml(text, { strict: false });
    } else if (ext === '.json') {
      created = deps.store.importFromJson(text, { strict: false });
    } else {
      throw usage('create: unsupported file extension (use .json, .yaml or .yml)');
    }
  }
  if (created.id !== name) {
    deps.store.delete(created.id); // rollback: never leave a half-applied create
    throw new CliError('USAGE', 'document id does not match --name', {
      params: { key: 'profile.create.nameMismatch', values: { actual: created.id, expected: name } },
    });
  }
  return { text: deps.t('profile.create.created', { id: name }), data: { id: name } };
}

function runEdit(deps: CliDeps, sub: ParsedSub): CommandOutput {
  const id = positional(sub, 'edit');
  const patchPath = sub.flags.patch;
  if (typeof patchPath !== 'string') {
    const doc = deps.store.exportJson(id);
    return {
      text: `${deps.t('profile.edit.template', { id })}\n${doc}`,
      literal: doc,
    };
  }
  let patchText: string;
  try {
    patchText = deps.readTextFile(patchPath);
  } catch (cause) {
    throw new CliError('USAGE', 'cannot read patch file', {
      params: { key: 'error.fileRead', values: { path: patchPath } },
      cause,
    });
  }
  let patch: Record<string, unknown>;
  try {
    patch = JSON.parse(patchText) as Record<string, unknown>;
  } catch (cause) {
    throw new CliError('USAGE', 'patch document is not valid JSON', {
      detail: 'patch document is not valid JSON',
      cause,
    });
  }
  const updated = deps.store.update(id, patch as unknown as Parameters<typeof deps.store.update>[1]);
  return {
    text: deps.t('profile.edit.updated', { id: updated.id }),
    data: { id: updated.id, updatedAt: updated.metadata.updatedAt },
  };
}

function runClone(deps: CliDeps, sub: ParsedSub): CommandOutput {
  const [source, target] = sub.positionals;
  if (source === undefined || target === undefined) {
    throw usage('clone requires <source> <newId>');
  }
  const src = deps.store.get(source);
  const now = deps.now();
  const created = deps.store.create({
    ...src,
    id: target,
    metadata: { ...src.metadata, createdAt: now, updatedAt: now },
  });
  return { text: deps.t('profile.clone.cloned', { id: created.id }), data: { id: created.id } };
}

function runDelete(deps: CliDeps, sub: ParsedSub): CommandOutput {
  const id = positional(sub, 'delete');
  if (sub.flags.yes !== true) {
    throw new CliError('USAGE', 'delete requires --yes', { params: { key: 'profile.delete.requiresYes' } });
  }
  deps.store.delete(id);
  return { text: deps.t('profile.delete.deleted', { id }), data: { id } };
}

function runImport(deps: CliDeps, sub: ParsedSub): CommandOutput {
  const path = sub.positionals[0];
  if (path === undefined) throw usage('import requires a file path');
  const ext = extensionOf(path);
  if (ext !== '.json' && ext !== '.yaml' && ext !== '.yml') {
    throw new CliError('USAGE', 'unsupported import extension', { params: { key: 'profile.import.badExtension' } });
  }
  let text: string;
  try {
    text = deps.readTextFile(path);
  } catch (cause) {
    throw new CliError('USAGE', 'cannot read import file', {
      params: { key: 'error.fileRead', values: { path } },
      cause,
    });
  }
  const allowRename = sub.flags['allow-rename'] === true;
  const imported =
    ext === '.json'
      ? deps.store.importFromJson(text, { strict: true, allowRename })
      : deps.store.importFromYaml(text, { strict: true, allowRename });
  return { text: deps.t('profile.import.imported', { id: imported.id }), data: { id: imported.id } };
}

function runExport(deps: CliDeps, sub: ParsedSub): CommandOutput {
  const id = positional(sub, 'export');
  const format = typeof sub.flags.format === 'string' ? sub.flags.format : 'json';
  if (format !== 'json' && format !== 'yaml') {
    throw usage('--format must be json or yaml');
  }
  const doc = format === 'json' ? deps.store.exportJson(id) : deps.store.exportYaml(id);
  const output = sub.flags.output;
  if (typeof output !== 'string') {
    // Export writes the document verbatim; not even --json wraps it in an envelope.
    return { text: doc, literal: doc };
  }
  try {
    deps.writeTextFile(output, doc);
  } catch (cause) {
    throw new CliError('USAGE', 'cannot write output file', {
      params: { key: 'error.fileWrite', values: { path: output } },
      cause,
    });
  }
  return {
    text: deps.t('profile.export.exported', { format, path: output }),
    data: { path: output, format, sizeBytes: doc.length },
  };
}

function positional(sub: ParsedSub, command: string): string {
  const value = sub.positionals[0];
  if (value === undefined) {
    throw usage(`profile ${command} requires a profile id`);
  }
  return value;
}

/** Reports whether a profile with this id already exists; any store error counts as missing. */
function profileExists(deps: CliDeps, id: string): boolean {
  try {
    deps.store.get(id);
    return true;
  } catch {
    return false;
  }
}

/** Reads a file, or stdin for `-`. I/O failures surface as usage errors. */
async function readSource(deps: CliDeps, file: string): Promise<string> {
  if (file === '-') return deps.readStdin();
  try {
    return deps.readTextFile(file);
  } catch (cause) {
    throw new CliError('USAGE', 'cannot read input file', {
      params: { key: 'error.fileRead', values: { path: file } },
      cause,
    });
  }
}

function extensionOf(path: string): string {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index).toLowerCase();
}