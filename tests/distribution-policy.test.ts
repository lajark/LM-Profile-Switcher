import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '..');

describe('distribution policy', () => {
  it('records the declared visibility defaults in the distribution policy', () => {
    const policy = readFileSync(
      resolve(workspaceRoot, 'PROJECT_DISTRIBUTION_POLICY.md'),
      'utf8',
    );
    // project-spec.json is internal engineering tooling (LOCAL-ONLY) and is
    // not shipped with the public repository; only the policy file is public.
    expect(policy).toContain('repository_visibility: "public"');
    expect(policy).toContain('release_visibility: "none"');
  });

  it('keeps local workspace, reports, and release staging out of Git by default', () => {
    const ignoredPaths = new Set(
      readFileSync(resolve(workspaceRoot, '.gitignore'), 'utf8')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#')),
    );

    expect(ignoredPaths.has('.workspace/')).toBe(true);
    expect(ignoredPaths.has('reports/')).toBe(true);
    expect(ignoredPaths.has('artifacts/')).toBe(true);
  });
});
