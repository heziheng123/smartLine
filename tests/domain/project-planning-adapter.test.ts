import assert from 'node:assert/strict';
import test from 'node:test';
import { projectDatePatch, projectTaskDatePatch } from '../../src/projectPlanning/datePatch.ts';
import { findProjectTask, projectReferenceSnapshot, projectTaskReferenceId } from '../../src/projectPlanning/projection.ts';
import type { Task } from '../../src/types/index.ts';

test('project task date patches reject invalid and inverted ranges', () => {
  assert.deepEqual(projectDatePatch('2026-08-01', '2026-08-20'), {
    start: '2026-08-01',
    end: '2026-08-20',
  });
  assert.equal(projectDatePatch('2026-02-30', '2026-03-01'), null);
  assert.equal(projectDatePatch('2026-08-20', '2026-08-01'), null);
  assert.deepEqual(projectTaskDatePatch('2026-08-02', '2026-08-20'), {
    date: '2026-08-02',
    deadline: '2026-08-20',
  });
  assert.equal(projectTaskDatePatch('2026-08-20', '2026-08-02'), null);
});

const project: Task = {
  id: 'project-1',
  name: '英语强化',
  start: '2026-08-01',
  end: '2026-08-31',
  color: '#34c759',
  blocks: [{ type: 'smart-task', id: 'reading', body: '', header: { title: '阅读', tag: '英语', tagColor: '#34c759', date: '2026-08-02', deadline: '2026-08-20', duration: 30, isCompleted: false } }],
};

test('project references resolve projects and their smart-task children without copying data', () => {
  const taskId = projectTaskReferenceId(project.id, 'reading');
  assert.equal(findProjectTask([project], taskId)?.block.header.title, '阅读');
  assert.deepEqual(projectReferenceSnapshot({ targetType: 'project', targetId: project.id }, { projects: [project], milestones: [] }), {
    title: '英语强化',
    subtitle: '2026-08-01 — 2026-08-31',
    color: '#34c759',
    progress: 0,
  });
  assert.equal(projectReferenceSnapshot({ targetType: 'task', targetId: taskId }, { projects: [project], milestones: [] })?.title, '阅读');
});
