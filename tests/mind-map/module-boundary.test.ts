import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const moduleRoot = path.resolve('src/mindMap');
const forbiddenImports = [
  '@/store',
  '@/ebb',
  '@/lifeMap',
  '@/graph',
  '@/components/dailySchedule/store',
  '@/services/workspaceSync',
  '@/services/workspaceBackup',
  '@/services/workspaceLocalWriteJournal',
  '@/services/workspaceOfflineQueue',
  '@/services/actionBridge',
  '@/services/projectTaskCommands',
  '@/services/projectTaskEffectCommit',
] as const;
const allowedInfrastructureImports = new Set(['@/store/client']);
const allowedDomainImports = new Map<string, Set<string>>([
  ['@/lifeMap', new Set([
    'src/mindMap/commands.ts',
    'src/mindMap/lifeMapMigration.ts',
    'src/mindMap/lifePlanning.ts',
    'src/mindMap/LifePlanningPanel.tsx',
    'src/mindMap/MindMapWorkspace.tsx',
    'src/mindMap/model.ts',
    'src/mindMap/syncCore.ts',
    'src/mindMap/timelineProjection.ts',
    'src/mindMap/timelineProjectionHooks.ts',
  ])],
]);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

test('the mind map module cannot import existing SmartLine business domains', async () => {
  const violations: string[] = [];
  for (const file of await sourceFiles(moduleRoot)) {
    const source = await readFile(file, 'utf8');
    const imports = [...source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]);
    const relativeFile = path.relative(process.cwd(), file).replaceAll('\\', '/');
    for (const forbidden of forbiddenImports) {
      if (imports.some((specifier) => !allowedInfrastructureImports.has(specifier)
        && (specifier === forbidden || specifier.startsWith(forbidden + '/')))
        && !allowedDomainImports.get(forbidden)?.has(relativeFile)) {
        violations.push(relativeFile + ' -> ' + forbidden);
      }
    }
  }
  assert.deepEqual(violations, []);
});
