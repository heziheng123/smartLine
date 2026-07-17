import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createServer } from 'vite';

class MemoryStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  clear() { this.#data.clear(); }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  removeItem(key) { this.#data.delete(String(key)); }
  setItem(key, value) { this.#data.set(String(key), String(value)); }
}

const listeners = new Map();
globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
globalThis.crypto ??= webcrypto;
globalThis.navigator ??= { onLine: true };
globalThis.window = globalThis;
globalThis.addEventListener = (type, listener) => {
  const values = listeners.get(type) ?? new Set();
  values.add(listener);
  listeners.set(type, values);
};
globalThis.removeEventListener = (type, listener) => listeners.get(type)?.delete(listener);
globalThis.dispatchEvent = (event) => {
  listeners.get(event.type)?.forEach((listener) => listener(event));
  return true;
};

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const load = (path) => server.ssrLoadModule(path);

try {
  const [
    scheduler,
    activation,
    ebbConstants,
    timelineModule,
    graphModule,
    ebbModule,
    dailyModule,
    backupModule,
    sourceIds,
  ] = await Promise.all([
    load('/src/ebb/scheduler.ts'),
    load('/src/graph/activation.ts'),
    load('/src/ebb/constants.ts'),
    load('/src/store/index.ts'),
    load('/src/graph/store.ts'),
    load('/src/ebb/store.ts'),
    load('/src/components/dailySchedule/store.ts'),
    load('/src/services/workspaceBackup.ts'),
    load('/src/components/dailySchedule/sourceIds.ts'),
  ]);

  const { useTimelineStore } = timelineModule;
  const { useGraphStore } = graphModule;
  const { useEbbStore } = ebbModule;
  const { useDailyScheduleStore } = dailyModule;
  const baseSettings = ebbConstants.getDefaultEbbData().ebbSettings;

  const resetStores = ({ nodes = [], tasks = [], groups = [], reviewTasks = [], schedules = {} } = {}) => {
    useTimelineStore.setState({ tasks, groups, notes: [], milestones: [], isHydrated: true });
    useGraphStore.setState({ nodes, isHydrated: true });
    useEbbStore.setState({
      reviewTasks,
      inboxItems: [],
      outlineNodes: [],
      ebbSettings: baseSettings,
      undoStack: [],
      isHydrated: true,
    });
    useDailyScheduleStore.setState({ schedules, isHydrated: true });
  };

  const smartBlock = (id, title, graphNodeIds, autoSyncEbb = true) => ({
    type: 'smart-task',
    id,
    header: {
      title,
      tag: '系统模拟',
      tagColor: '#3b82f6',
      date: '2026-07-17',
      duration: 30,
      isCompleted: false,
      graphNodeIds,
      autoSyncEbb,
      complexity: 'normal',
    },
    body: '',
  });

  const project = (id, blocks) => ({
    id,
    name: `项目-${id}`,
    start: '2026-07-01',
    end: '2026-08-31',
    blocks,
  });

  const node = (id, parentId = null, status = 'unactivated', extra = {}) => ({
    id,
    name: id,
    parentId,
    createdAt: 1,
    status,
    ...extra,
  });

  const getBlock = (taskId, blockId) => useTimelineStore.getState().tasks
    .find((task) => task.id === taskId)?.blocks.find((block) => block.id === blockId);
  const nextTick = () => new Promise((resolve) => setTimeout(resolve, 5));

  check('父节点仅在全部可见子节点激活后激活，归档子节点不阻塞', () => {
    const nodes = [node('parent'), node('a', 'parent'), node('b', 'parent')];
    let states = activation.computeNodeActivationStates(nodes);
    assert.equal(states.get('parent').isActivated, false);
    nodes[1].status = 'activated';
    states = activation.computeNodeActivationStates(nodes);
    assert.equal(states.get('parent').isActivated, false);
    nodes[2].status = 'activated';
    states = activation.computeNodeActivationStates(nodes);
    assert.equal(states.get('parent').isActivated, true);
    nodes[2] = { ...nodes[2], status: 'unactivated', isArchived: true };
    states = activation.computeNodeActivationStates(nodes);
    assert.equal(states.get('parent').isActivated, true);
  });

  check('EBB 轮次顺序稳定，改期不改变轮次编号', () => {
    const rounds = [
      { id: 'r1', topicName: '主题', graphNodeId: 'a', dueDate: '2026-07-20', originalDueDate: '2026-07-18', roundOrder: 1, isCompleted: false },
      { id: 'r2', topicName: '主题', graphNodeId: 'a', dueDate: '2026-07-19', originalDueDate: '2026-07-19', roundOrder: 2, isCompleted: false },
    ];
    assert.equal(scheduler.computeRounds(rounds).roundMap.get('r1'), 1);
    assert.match(scheduler.checkCanComplete('r2', rounds), /1/);
    rounds[0].isCompleted = true;
    assert.equal(scheduler.checkCanComplete('r2', rounds), null);
    assert.equal(scheduler.checkCanComplete('r1', rounds), null);
  });

  check('增加轮次继承原节点，且金色完成态可回到有待完成轮次', () => {
    const completed = [
      { id: 'r1', topicName: '主题', graphNodeId: 'a', dueDate: '2026-07-10', originalDueDate: '2026-07-10', roundOrder: 1, isCompleted: true },
    ];
    const next = scheduler.buildNextRoundTask(completed, baseSettings);
    assert.ok(next);
    assert.equal(next.graphNodeId, 'a');
    assert.equal(next.roundOrder, 2);
    assert.equal(next.isCompleted, false);
    assert.equal(scheduler.computeTopicStats([...completed, next])[0].pendingRounds, 1);
  });

  check('完成绑定节点任务会激活叶节点并生成 EBB；取消会完整回滚', () => {
    resetStores({ nodes: [node('leaf')], tasks: [project('p1', [smartBlock('b1', '任务一', ['leaf'])])] });
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { isCompleted: true });
    assert.equal(getBlock('p1', 'b1').header.isCompleted, true);
    assert.equal(useGraphStore.getState().nodes[0].status, 'activated');
    assert.ok(useEbbStore.getState().reviewTasks.length > 0);

    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { isCompleted: false });
    assert.equal(getBlock('p1', 'b1').header.isCompleted, false);
    assert.equal(getBlock('p1', 'b1').header.completedDate, undefined);
    assert.equal(useGraphStore.getState().nodes[0].status, 'unactivated');
    assert.equal(useEbbStore.getState().reviewTasks.length, 0);
  });

  check('关闭自动同步时仍激活节点，但不创建 EBB 轮次', () => {
    resetStores({ nodes: [node('leaf')], tasks: [project('p1', [smartBlock('b1', '任务一', ['leaf'], false)])] });
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { isCompleted: true });
    assert.equal(useGraphStore.getState().nodes[0].status, 'activated');
    assert.equal(useEbbStore.getState().reviewTasks.length, 0);
  });

  check('同一节点绑定多个任务时，取消其中一个不会误删节点状态或 EBB 排期', () => {
    resetStores({
      nodes: [node('leaf')],
      tasks: [project('p1', [smartBlock('b1', '任务一', ['leaf']), smartBlock('b2', '任务二', ['leaf'])])],
    });
    const store = useTimelineStore.getState();
    store.updateBlockHeader('p1', 'b1', { isCompleted: true });
    store.updateBlockHeader('p1', 'b2', { isCompleted: true });
    const before = useEbbStore.getState().reviewTasks.length;
    assert.ok(before > 0);
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { isCompleted: false });
    assert.equal(useGraphStore.getState().nodes[0].status, 'activated');
    assert.equal(useEbbStore.getState().reviewTasks.length, before);
    useTimelineStore.getState().updateBlockHeader('p1', 'b2', { isCompleted: false });
    assert.equal(useGraphStore.getState().nodes[0].status, 'unactivated');
    assert.equal(useEbbStore.getState().reviewTasks.length, 0);
  });

  check('父节点上的任务不会绕过“全部子节点完成”规则', () => {
    resetStores({
      nodes: [node('parent'), node('a', 'parent'), node('b', 'parent')],
      tasks: [project('p1', [smartBlock('b1', '父节点任务', ['parent'])])],
    });
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { isCompleted: true });
    const parent = useGraphStore.getState().nodes.find((item) => item.id === 'parent');
    assert.notEqual(parent.status, 'activated');
    assert.equal(activation.computeNodeActivationStates(useGraphStore.getState().nodes).get('parent').isActivated, false);
  });

  check('EBB 完成必须按顺序，且已完成轮次可取消完成', () => {
    const reviewTasks = [
      { id: 'r1', topicName: '主题', graphNodeId: 'leaf', dueDate: '2026-07-18', originalDueDate: '2026-07-18', roundOrder: 1, isCompleted: false },
      { id: 'r2', topicName: '主题', graphNodeId: 'leaf', dueDate: '2026-07-19', originalDueDate: '2026-07-19', roundOrder: 2, isCompleted: false },
    ];
    resetStores({ nodes: [node('leaf', null, 'activated')], reviewTasks });
    assert.ok(useEbbStore.getState().toggleReviewTask('r2'));
    assert.equal(useEbbStore.getState().reviewTasks.find((task) => task.id === 'r2').isCompleted, false);
    assert.equal(useEbbStore.getState().toggleReviewTask('r1'), null);
    assert.equal(useEbbStore.getState().reviewTasks.find((task) => task.id === 'r1').isCompleted, true);
    assert.equal(useEbbStore.getState().toggleReviewTask('r1'), null);
    assert.equal(useEbbStore.getState().reviewTasks.find((task) => task.id === 'r1').isCompleted, false);
  });

  check('已有复习历史后取消项目任务，不会删除已完成历史和后续排期', () => {
    resetStores({ nodes: [node('leaf')], tasks: [project('p1', [smartBlock('b1', '任务一', ['leaf'])])] });
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { isCompleted: true });
    const firstRound = [...useEbbStore.getState().reviewTasks]
      .sort((a, b) => a.roundOrder - b.roundOrder)[0];
    assert.equal(useEbbStore.getState().toggleReviewTask(firstRound.id), null);
    const beforeIds = useEbbStore.getState().reviewTasks.map((task) => task.id);
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { isCompleted: false });
    assert.deepEqual(useEbbStore.getState().reviewTasks.map((task) => task.id), beforeIds);
    assert.equal(useEbbStore.getState().reviewTasks.find((task) => task.id === firstRound.id).isCompleted, true);
  });

  check('已完成任务改绑节点时，旧节点释放、新叶节点激活并迁移未开始排期', () => {
    resetStores({
      nodes: [node('old'), node('next')],
      tasks: [project('p1', [smartBlock('b1', '迁移任务', ['old'])])],
    });
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { isCompleted: true });
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { graphNodeIds: ['next'], graphNodeId: 'next' });
    assert.equal(useGraphStore.getState().nodes.find((item) => item.id === 'old').status, 'unactivated');
    assert.equal(useGraphStore.getState().nodes.find((item) => item.id === 'next').status, 'activated');
    assert.equal(useEbbStore.getState().reviewTasks.some((task) => task.graphNodeId === 'old'), false);
    assert.equal(useEbbStore.getState().reviewTasks.some((task) => task.graphNodeId === 'next'), true);
  });

  check('已完成任务切换自动同步，可创建或撤销尚未开始的 EBB 排期', () => {
    resetStores({ nodes: [node('leaf')], tasks: [project('p1', [smartBlock('b1', '任务一', ['leaf'], false)])] });
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { isCompleted: true });
    assert.equal(useEbbStore.getState().reviewTasks.length, 0);
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { autoSyncEbb: true });
    assert.ok(useEbbStore.getState().reviewTasks.length > 0);
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { autoSyncEbb: false });
    assert.equal(useEbbStore.getState().reviewTasks.length, 0);
    assert.equal(useGraphStore.getState().nodes[0].status, 'activated');
  });

  check('项目任务改名和时长会同步每日安排，日期变化会移除旧排期', () => {
    const sourceId = sourceIds.getProjectBlockSourceId('p1', 'b1');
    resetStores({
      nodes: [node('leaf')],
      tasks: [project('p1', [smartBlock('b1', '旧名称', ['leaf'])])],
      schedules: {
        '2026-07-17': {
          date: '2026-07-17',
          items: [{ id: 's1', sourceId, name: '旧名称', source: 'project', timeSlot: 'morning', order: 0, duration: 30 }],
          blocks: [{ id: 't1', sourceId, name: '旧名称', source: 'project', startTime: '09:00', endTime: '09:30' }],
        },
      },
    });
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { title: '新名称', duration: 45 });
    let schedule = useDailyScheduleStore.getState().schedules['2026-07-17'];
    assert.equal(schedule.items[0].name, '新名称');
    assert.equal(schedule.items[0].duration, 45);
    assert.equal(schedule.blocks[0].name, '新名称');
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { date: '2026-07-18' });
    schedule = useDailyScheduleStore.getState().schedules['2026-07-17'];
    assert.equal(schedule.items.length, 0);
    assert.equal(schedule.blocks.length, 0);
  });

  check('EBB 单轮改期保留原计划日期、轮次编号，并清理每日安排旧引用', async () => {
    const review = { id: 'r1', topicName: '主题', graphNodeId: 'leaf', dueDate: '2026-07-18', originalDueDate: '2026-07-18', roundOrder: 1, isCompleted: false };
    const sourceId = sourceIds.getReviewSourceId('r1');
    resetStores({
      nodes: [node('leaf', null, 'activated')],
      reviewTasks: [review],
      schedules: {
        '2026-07-18': {
          date: '2026-07-18',
          items: [{ id: 's1', sourceId, name: '主题', source: 'review', timeSlot: 'morning', order: 0 }],
          blocks: [],
        },
      },
    });
    useEbbStore.getState().updateReviewTask('r1', { dueDate: '2026-07-22' });
    await nextTick();
    const updated = useEbbStore.getState().reviewTasks[0];
    assert.equal(updated.dueDate, '2026-07-22');
    assert.equal(updated.originalDueDate, '2026-07-18');
    assert.equal(updated.roundOrder, 1);
    assert.equal(useDailyScheduleStore.getState().schedules['2026-07-18'].items.length, 0);
  });

  check('重启复习计划会归档旧轮次、继承节点并清理旧每日安排', async () => {
    const review = { id: 'r1', topicName: '主题', graphNodeId: 'leaf', dueDate: '2026-07-18', originalDueDate: '2026-07-18', roundOrder: 1, isCompleted: true, completedDate: '2026-07-18', complexity: 'normal' };
    const sourceId = sourceIds.getReviewSourceId('r1');
    resetStores({
      nodes: [node('leaf', null, 'activated')],
      reviewTasks: [review],
      schedules: {
        '2026-07-18': { date: '2026-07-18', items: [{ id: 's1', sourceId, name: '主题', source: 'review', timeSlot: 'morning', order: 0 }], blocks: [] },
      },
    });
    assert.equal(useEbbStore.getState().restartReviewCycle('graph:leaf', '2026-07-20'), true);
    await nextTick();
    const all = useEbbStore.getState().reviewTasks;
    assert.equal(all.find((task) => task.id === 'r1').isArchived, true);
    const replacements = all.filter((task) => !task.isArchived);
    assert.ok(replacements.length > 0);
    assert.ok(replacements.every((task) => task.graphNodeId === 'leaf' && !task.isCompleted));
    assert.equal(useDailyScheduleStore.getState().schedules['2026-07-18'].items.length, 0);
  });

  check('每日安排尚未加载时收到清理请求，加载完成后仍会执行', async () => {
    const sourceId = sourceIds.getProjectBlockSourceId('p1', 'b1');
    resetStores({
      schedules: {
        '2026-07-17': { date: '2026-07-17', items: [{ id: 's1', sourceId, name: '待清理', source: 'project', timeSlot: 'morning', order: 0 }], blocks: [] },
      },
    });
    useDailyScheduleStore.setState({ isHydrated: false });
    useDailyScheduleStore.getState().removeBySourceIds([sourceId]);
    assert.equal(useDailyScheduleStore.getState().schedules['2026-07-17'].items.length, 1);
    await useDailyScheduleStore.getState().hydrateStore();
    assert.equal(useDailyScheduleStore.getState().schedules['2026-07-17']?.items.length ?? 0, 0);
  });

  check('旧版仅存在于分组 children 的任务会被规范化并可正常取消完成', () => {
    resetStores();
    const child = project('legacy', [smartBlock('legacy-block', '旧任务', [])]);
    child.blocks[0].header.isCompleted = true;
    child.blocks[0].header.completedDate = '2026-07-17';
    useTimelineStore.getState().replaceData({
      tasks: [],
      groups: [{ id: 'g1', name: '旧分组', start: '2026-07-01', end: '2026-07-31', children: [child] }],
      notes: [],
      milestones: [],
    });
    assert.ok(useTimelineStore.getState().tasks.some((task) => task.id === 'legacy'));
    useTimelineStore.getState().updateBlockHeader('legacy', 'legacy-block', { isCompleted: false });
    assert.equal(getBlock('legacy', 'legacy-block').header.isCompleted, false);
  });

  check('备份检查能识别孤儿绑定、重复块 ID、无效时间和 EBB 轮次冲突', () => {
    const valid = {
      kind: 'smart-line-workspace',
      schemaVersion: backupModule.WORKSPACE_SCHEMA_VERSION,
      revision: Date.now(),
      exportedAt: new Date().toISOString(),
      deviceId: 'system-simulation',
      timeline: { tasks: [project('p1', [smartBlock('dup', '任务', ['missing-node']), smartBlock('dup', '重复', [])])], groups: [], notes: [], milestones: [] },
      graph: { nodes: [] },
      ebb: {
        reviewTasks: [
          { id: 'r1', topicName: '主题', dueDate: '2026-07-18', roundOrder: 1, isCompleted: false },
          { id: 'r2', topicName: '主题', dueDate: '2026-07-19', roundOrder: 1, isCompleted: false },
        ],
        inboxItems: [],
        outlineNodes: [],
        ebbSettings: baseSettings,
      },
      daily: {
        schedules: {
          '2026-07-17': {
            date: '2026-07-17',
            items: [],
            blocks: [{ id: 'tb1', sourceId: 'project::missing::block', name: '异常', source: 'project', startTime: '25:00', endTime: '09:00' }],
          },
        },
      },
      settings: {},
    };
    const result = backupModule.validateWorkspaceBackup(valid);
    assert.equal(result.errors.length, 0);
    assert.ok(result.summary.issues.some((issue) => /知识节点/.test(issue)));
    assert.ok(result.summary.issues.some((issue) => /重复/.test(issue)));
    assert.ok(result.summary.issues.some((issue) => /时间/.test(issue)));
    assert.ok(result.summary.issues.some((issue) => /轮次/.test(issue)));
  });

  let passed = 0;
  for (const item of checks) {
    await item.fn();
    passed += 1;
    console.log(`✓ ${item.name}`);
  }
  console.log(`\n系统场景模拟通过：${passed}/${checks.length}`);
} finally {
  await server.close();
}
