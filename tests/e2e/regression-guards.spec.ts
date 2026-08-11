import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
});

test('rich text sanitizer removes layout injection and unsafe image protocols', async ({ page }) => {
  const sanitized = await page.evaluate(async () => {
    const { sanitizeHtml } = await import('/src/utils/sanitize.ts');
    return sanitizeHtml(`
      <div id="spoof" class="overlay" style="position:fixed;inset:0;background:url(https://tracker.invalid/a)">
        safe <script>alert(1)</script>
        <img src="data:image/svg+xml,<svg onload=alert(1)></svg>" onerror="alert(2)">
        <a href="https://example.com" target="_blank" style="position:fixed">link</a>
      </div>
    `);
  });

  expect(sanitized).toContain('safe');
  expect(sanitized).not.toMatch(/style=|class=|id=|script|onerror|data:image|tracker\.invalid/i);
  expect(sanitized).not.toMatch(/target=/i);
});

test('manual group dates reject missing and reversed ranges', async ({ page }) => {
  await page.locator('.tl-workspace-bar').getByTitle('更多').click();
  await page.getByRole('menuitem', { name: '新建项目分组' }).click();
  const dialog = page.locator('.tl-dialog');
  await dialog.getByLabel('分组名称').fill('日期校验分组');
  await dialog.getByLabel('自动从子任务计算日期范围').uncheck();

  const save = dialog.getByRole('button', { name: '创建' });
  await expect(save).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('必须填写');

  await dialog.getByLabel('开始日期').fill('2026-08-20');
  await dialog.getByLabel('结束日期').fill('2026-08-10');
  await expect(save).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('不能早于');

  await dialog.getByLabel('结束日期').fill('2026-08-30');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(save).toBeEnabled();
});

test('overdue maintenance preserves archives and batches undo with daily restoration', async ({ page }) => {
  const frozen = await page.evaluate(async () => {
    const [{ useTimelineStore }, { useDailyScheduleStore }, { useOperationHistory }] = await Promise.all([
      import('/src/store/index.ts'),
      import('/src/components/dailySchedule/store.ts'),
      import('/src/services/operationHistory.ts'),
    ]);
    const block = (id: string, date: string, isArchived = false) => ({
      type: 'smart-task' as const,
      id,
      header: {
        title: id,
        tag: 'test',
        tagColor: '#000000',
        date,
        duration: 30,
        isCompleted: false,
        isArchived,
      },
      body: '',
    });
    const tasks = [
      { id: 'freeze-a', name: 'freeze-a', start: '2026-01-01', end: '2026-12-31', blocks: [block('block-a', '2026-01-01')] },
      { id: 'freeze-b', name: 'freeze-b', start: '2026-01-01', end: '2026-12-31', blocks: [block('block-b', '2026-01-02')] },
      { id: 'archive-c', name: 'archive-c', start: '2026-01-01', end: '2026-12-31', blocksUpdatedAt: 'unchanged', blocks: [block('block-c', '2026-01-01', true)] },
    ];
    useTimelineStore.setState({ tasks, groups: [] });
    useDailyScheduleStore.setState({
      isHydrated: true,
      schedules: {
        '2026-01-01': {
          date: '2026-01-01',
          items: [{ id: 'daily-a', sourceId: 'project-blk:freeze-a::block-a', name: 'a', source: 'project', timeSlot: 'morning', order: 0 }],
          blocks: [],
        },
        '2026-01-02': {
          date: '2026-01-02',
          items: [{ id: 'daily-b', sourceId: 'project-blk:freeze-b::block-b', name: 'b', source: 'project', timeSlot: 'morning', order: 0 }],
          blocks: [],
        },
      },
    });
    useOperationHistory.getState().clear();
    const count = useTimelineStore.getState().freezeOverdueBlocks([
      { taskId: 'freeze-a', blockId: 'block-a', expectedDate: '2026-01-01' },
      { taskId: 'freeze-b', blockId: 'block-b', expectedDate: '2026-01-02' },
      { taskId: 'archive-c', blockId: 'block-c', expectedDate: '2026-01-01' },
    ], '2026-08-09T00:00:00.000Z');
    const headers = Object.fromEntries(useTimelineStore.getState().tasks.map((task) => [
      task.id,
      task.blocks[0]?.type === 'smart-task' ? task.blocks[0].header : {},
    ]));
    return {
      count,
      headers,
      updatedAt: Object.fromEntries(useTimelineStore.getState().tasks.map((task) => [task.id, task.blocksUpdatedAt])),
      historyCount: useOperationHistory.getState().entries.length,
      dailyCount: Object.values(useDailyScheduleStore.getState().schedules)
        .reduce((sum, day) => sum + day.items.length + day.blocks.length, 0),
    };
  });

  expect(frozen.count).toBe(2);
  expect(frozen.headers['freeze-a'].date).toBe('2026-01-01');
  expect(frozen.headers['freeze-b'].date).toBe('2026-01-02');
  expect(frozen.headers['freeze-a'].frozenAt).toBe('2026-08-09T00:00:00.000Z');
  expect(frozen.headers['freeze-b'].frozenAt).toBe('2026-08-09T00:00:00.000Z');
  expect(frozen.headers['archive-c'].date).toBe('2026-01-01');
  expect(frozen.updatedAt['archive-c']).toBe('unchanged');
  expect(frozen.historyCount).toBe(1);
  expect(frozen.dailyCount).toBe(0);

  const restored = await page.evaluate(async () => {
    const [{ useTimelineStore }, { useDailyScheduleStore }, { useOperationHistory }] = await Promise.all([
      import('/src/store/index.ts'),
      import('/src/components/dailySchedule/store.ts'),
      import('/src/services/operationHistory.ts'),
    ]);
    const undone = await useOperationHistory.getState().undo();
    return {
      undone,
      dates: Object.fromEntries(useTimelineStore.getState().tasks.map((task) => [
        task.id,
        task.blocks[0]?.type === 'smart-task' ? task.blocks[0].header.date : undefined,
      ])),
      dailyCount: Object.values(useDailyScheduleStore.getState().schedules)
        .reduce((sum, day) => sum + day.items.length + day.blocks.length, 0),
    };
  });
  expect(restored).toEqual({
    undone: true,
    dates: {
      'freeze-a': '2026-01-01',
      'freeze-b': '2026-01-02',
      'archive-c': '2026-01-01',
    },
    dailyCount: 2,
  });
});

test('manual rescheduling releases recovered state and undo restores it', async ({ page }) => {
  const changed = await page.evaluate(async () => {
    const [{ useTimelineStore }, { normalizeManualProjectTaskPatch }, { collectBacklogTasks }, { useOperationHistory }] = await Promise.all([
      import('/src/store/index.ts'),
      import('/src/services/projectTaskCommands.ts'),
      import('/src/domain/taskBacklog.ts'),
      import('/src/services/operationHistory.ts'),
    ]);
    const frozenAt = '2026-08-10T00:00:00.000Z';
    useTimelineStore.setState({
      tasks: [{
        id: 'recovered-project',
        name: 'recovered-project',
        start: '2026-01-01',
        end: '2026-12-31',
        blocks: [{
          type: 'smart-task',
          id: 'recovered-block',
          header: {
            title: 'recovered-task',
            tag: 'test',
            tagColor: '#000000',
            date: '2026-01-01',
            frozenAt,
            duration: 30,
            isCompleted: false,
          },
          body: '',
        }],
      }],
      groups: [],
    });
    useOperationHistory.getState().clear();

    const result = useTimelineStore.getState().updateBlockHeader(
      'recovered-project',
      'recovered-block',
      normalizeManualProjectTaskPatch({ date: '2026-08-12' }),
    );
    const task = useTimelineStore.getState().tasks[0];
    const header = task.blocks[0]?.type === 'smart-task' ? task.blocks[0].header : {};
    const backlogCount = collectBacklogTasks(useTimelineStore.getState().tasks).length;
    const historyCount = useOperationHistory.getState().entries.length;
    const undone = await useOperationHistory.getState().undo();
    const restoredBlock = useTimelineStore.getState().tasks[0].blocks[0];
    const restored = restoredBlock?.type === 'smart-task' ? restoredBlock.header : {};
    return { result, header, backlogCount, historyCount, undone, restored };
  });

  expect(changed.result.changed).toBe(true);
  expect(changed.header.date).toBe('2026-08-12');
  expect(changed.header.frozenAt).toBeUndefined();
  expect(changed.backlogCount).toBe(0);
  expect(changed.historyCount).toBe(1);
  expect(changed.undone).toBe(true);
  expect(changed.restored.date).toBe('2026-01-01');
  expect(changed.restored.frozenAt).toBe('2026-08-10T00:00:00.000Z');
});

test('batch date edits and load normalization cannot retain an invalid recovered marker', async ({ page }) => {
  const state = await page.evaluate(async () => {
    const [{ useTimelineStore }, { normalizeTimelineTask }] = await Promise.all([
      import('/src/store/index.ts'),
      import('/src/store/timelineData.ts'),
    ]);
    const frozenAt = '2026-08-10T00:00:00.000Z';
    const project = {
      id: 'batch-project',
      name: 'batch-project',
      start: '2026-01-01',
      end: '2026-12-31',
      blocks: [{
        type: 'smart-task' as const,
        id: 'batch-block',
        header: {
          title: 'batch-task',
          tag: 'test',
          tagColor: '#000000',
          date: '2026-01-01',
          frozenAt,
          duration: 30,
          isCompleted: false,
        },
        body: '',
      }],
    };
    useTimelineStore.setState({ tasks: [project], groups: [] });
    useTimelineStore.getState().updateTaskBlocks('batch-project', [{
      ...project.blocks[0],
      header: { ...project.blocks[0].header, date: '2026-08-12' },
    }]);
    const batchBlock = useTimelineStore.getState().tasks[0].blocks[0];
    const batchHeader = batchBlock?.type === 'smart-task' ? batchBlock.header : {};
    const normalized = normalizeTimelineTask({
      ...project,
      blocks: [{
        ...project.blocks[0],
        header: { ...project.blocks[0].header, date: '2099-01-01' },
      }],
    });
    const normalizedBlock = normalized.blocks[0];
    const normalizedHeader = normalizedBlock?.type === 'smart-task' ? normalizedBlock.header : {};
    return { batchHeader, normalizedHeader };
  });

  expect(state.batchHeader.date).toBe('2026-08-12');
  expect(state.batchHeader.frozenAt).toBeUndefined();
  expect(state.normalizedHeader.date).toBe('2099-01-01');
  expect(state.normalizedHeader.frozenAt).toBeUndefined();
});
