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
    dateSafe,
    dailyConversion,
    timelineUtils,
    projectAppearance,
    blocksModule,
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
    load('/src/utils/dateSafe.ts'),
    load('/src/components/dailySchedule/conversion.ts'),
    load('/src/utils/timeline-utils.ts'),
    load('/src/components/dailySchedule/projectAppearance.ts'),
    load('/src/utils/blocks.ts'),
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
  const today = dateSafe.todayStr();

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
    assert.ok(getBlock('p1', 'b1').header.completedDate);
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

  check('同节点练习任务会完成今天到期的最早一轮，且不改变后续日期', () => {
    const first = smartBlock('learn', '知识学习', ['leaf']);
    first.header.isCompleted = true;
    first.header.completedDate = dateSafe.addDays(today, -1);
    const practice = smartBlock('practice', '对应练习', ['leaf']);
    const reviewTasks = [
      { id: 'r1', topicName: 'leaf', graphNodeId: 'leaf', dueDate: today, originalDueDate: today, roundOrder: 1, isCompleted: false, complexity: 'normal' },
      { id: 'r2', topicName: 'leaf', graphNodeId: 'leaf', dueDate: dateSafe.addDays(today, 2), originalDueDate: dateSafe.addDays(today, 2), roundOrder: 2, isCompleted: false, complexity: 'normal' },
    ];
    resetStores({ nodes: [node('leaf', null, 'activated')], tasks: [project('p1', [first, practice])], reviewTasks });
    useTimelineStore.getState().updateBlockHeader('p1', 'practice', { isCompleted: true });
    const [r1, r2] = useEbbStore.getState().reviewTasks;
    assert.equal(r1.isCompleted, true);
    assert.equal(r1.completedDate, today);
    assert.equal(r1.completionSource, 'project-task');
    assert.equal(r1.completionSourceBlockId, 'practice');
    assert.equal(r2.isCompleted, false);
    assert.equal(r2.dueDate, dateSafe.addDays(today, 2));
  });

  check('每日安排先完成绑定节点的项目任务，会自动完成当天晚间的同节点复习', () => {
    const learned = smartBlock('learn', '知识学习', ['leaf']);
    learned.header.isCompleted = true;
    const practice = smartBlock('practice', '当天练习', ['leaf']);
    const projectSourceId = sourceIds.getProjectBlockSourceId('p1', 'practice');
    const reviewSourceId = sourceIds.getReviewSourceId('r1');
    resetStores({
      nodes: [node('leaf', null, 'activated')],
      tasks: [project('p1', [learned, practice])],
      reviewTasks: [
        { id: 'r1', topicName: 'leaf', graphNodeId: 'leaf', dueDate: today, roundOrder: 1, isCompleted: false },
        { id: 'r2', topicName: 'leaf', graphNodeId: 'leaf', dueDate: dateSafe.addDays(today, 3), roundOrder: 2, isCompleted: false },
      ],
      schedules: {
        [today]: {
          date: today,
          items: [
            { id: 'morning-project', title: '当天练习', source: 'project', sourceId: projectSourceId, slot: 'morning' },
            { id: 'evening-review', title: '晚间复习', source: 'review', sourceId: reviewSourceId, slot: 'evening' },
          ],
          blocks: [],
        },
      },
    });

    // 与每日安排两个视图的点击处理一致：解析来源后更新项目任务源数据。
    const clickedItem = useDailyScheduleStore.getState().schedules[today].items[0];
    const parsed = dailyConversion.parseSourceId(clickedItem.sourceId);
    assert.deepEqual(parsed, { source: 'project', parentTaskId: 'p1', blockId: 'practice' });
    useTimelineStore.getState().updateBlockHeader(parsed.parentTaskId, parsed.blockId, {
      isCompleted: true,
      completedDate: today,
    });

    const reviews = useEbbStore.getState().reviewTasks;
    assert.equal(reviews.find((task) => task.id === 'r1').isCompleted, true);
    assert.equal(reviews.find((task) => task.id === 'r1').completedDate, today);
    assert.equal(reviews.find((task) => task.id === 'r2').isCompleted, false);
    assert.equal(useDailyScheduleStore.getState().schedules[today].items[1].sourceId, reviewSourceId);
  });

  check('每日安排项目标签与时间轴共用颜色规则，并随项目颜色实时变化', () => {
    const task = project('p1', [smartBlock('b1', '项目任务', ['leaf'])]);
    task.groupId = 'g1';
    const firstGroup = {
      id: 'g1', name: '考研政治', start: '2026-07-01', end: '2026-08-31',
      color: '#F87171', children: [task],
    };
    const sourceId = sourceIds.getProjectBlockSourceId('p1', 'b1');
    const timelineTheme = timelineUtils.resolveTaskTheme(task, firstGroup.color);
    const firstAppearance = projectAppearance.resolveProjectAppearance(sourceId, [task], [firstGroup]);
    assert.equal(firstAppearance.name, task.name);
    assert.deepEqual(firstAppearance.theme, timelineTheme);
    assert.notEqual(firstAppearance.theme.backgroundColor, '#6366F1');

    const changedGroup = { ...firstGroup, color: '#A78BFA' };
    const changedAppearance = projectAppearance.resolveProjectAppearance(sourceId, [task], [changedGroup]);
    assert.equal(
      changedAppearance.theme.backgroundColor,
      timelineUtils.resolveTaskTheme(task, changedGroup.color).backgroundColor,
    );
    assert.notEqual(changedAppearance.theme.backgroundColor, firstAppearance.theme.backgroundColor);

    const explicitTask = { ...task, color: '#DCFCE7' };
    const explicitAppearance = projectAppearance.resolveProjectAppearance(sourceId, [explicitTask], [changedGroup]);
    assert.equal(explicitAppearance.theme.backgroundColor, '#DCFCE7');

    const changedTypeTask = {
      ...task,
      blocks: task.blocks.map((block) => block.id === 'b1'
        ? { ...block, header: { ...block.header, tag: '做题', tagColor: '#60A5FA' } }
        : block),
    };
    const changedTypeAppearance = projectAppearance.resolveProjectAppearance(
      sourceId,
      [changedTypeTask],
      [firstGroup],
    );
    assert.equal(changedTypeAppearance.categoryName, '做题');
    assert.equal(changedTypeAppearance.categoryColor, '#60A5FA');
    assert.equal(
      timelineUtils.resolveTaskTheme(changedTypeTask, firstGroup.color).backgroundColor,
      timelineTheme.backgroundColor,
    );
  });

  check('先手动完成 EBB 再完成同节点练习，不会提前消耗下一轮', () => {
    const first = smartBlock('learn', '知识学习', ['leaf']);
    first.header.isCompleted = true;
    const practice = smartBlock('practice', '对应练习', ['leaf']);
    const reviewTasks = [
      { id: 'r1', topicName: 'leaf', graphNodeId: 'leaf', dueDate: today, originalDueDate: today, roundOrder: 1, isCompleted: false, complexity: 'normal' },
      { id: 'r2', topicName: 'leaf', graphNodeId: 'leaf', dueDate: dateSafe.addDays(today, 1), originalDueDate: dateSafe.addDays(today, 1), roundOrder: 2, isCompleted: false, complexity: 'normal' },
    ];
    resetStores({ nodes: [node('leaf', null, 'activated')], tasks: [project('p1', [first, practice])], reviewTasks });
    assert.equal(useEbbStore.getState().toggleReviewTask('r1'), null);
    useTimelineStore.getState().updateBlockHeader('p1', 'practice', { isCompleted: true });
    const tasks = useEbbStore.getState().reviewTasks;
    assert.equal(tasks.filter((task) => task.isCompleted).length, 1);
    assert.equal(tasks[0].completionSource, 'manual');
    assert.equal(tasks[1].isCompleted, false);
    assert.equal(tasks[1].dueDate, dateSafe.addDays(today, 1));
  });

  check('同一节点同一天完成多个项目任务，最多自动完成一轮', () => {
    const first = smartBlock('learn', '知识学习', ['leaf']);
    first.header.isCompleted = true;
    const p1 = smartBlock('practice-1', '练习一', ['leaf']);
    const p2 = smartBlock('practice-2', '练习二', ['leaf']);
    const reviewTasks = [
      { id: 'r1', topicName: 'leaf', graphNodeId: 'leaf', dueDate: today, roundOrder: 1, isCompleted: false },
      { id: 'r2', topicName: 'leaf', graphNodeId: 'leaf', dueDate: dateSafe.addDays(today, 1), roundOrder: 2, isCompleted: false },
    ];
    resetStores({ nodes: [node('leaf', null, 'activated')], tasks: [project('p1', [first, p1, p2])], reviewTasks });
    useTimelineStore.getState().updateBlockHeader('p1', 'practice-1', { isCompleted: true });
    useTimelineStore.getState().updateBlockHeader('p1', 'practice-2', { isCompleted: true });
    const tasks = useEbbStore.getState().reviewTasks;
    assert.equal(tasks.filter((task) => task.isCompleted).length, 1);
    assert.equal(tasks[0].completionSourceBlockId, 'practice-1');
    assert.equal(tasks[1].isCompleted, false);
  });

  check('练习可提前一天完成下一轮，但提前超过一天只记录额外巩固', () => {
    const first = smartBlock('learn', '知识学习', ['leaf']);
    first.header.isCompleted = true;
    const practice = smartBlock('practice', '对应练习', ['leaf']);
    resetStores({
      nodes: [node('leaf', null, 'activated')],
      tasks: [project('p1', [first, practice])],
      reviewTasks: [{ id: 'r1', topicName: 'leaf', graphNodeId: 'leaf', dueDate: dateSafe.addDays(today, 1), roundOrder: 1, isCompleted: false }],
    });
    useTimelineStore.getState().updateBlockHeader('p1', 'practice', { isCompleted: true });
    assert.equal(useEbbStore.getState().reviewTasks[0].isCompleted, true);

    const practice2 = smartBlock('practice-2', '远期练习', ['leaf']);
    resetStores({
      nodes: [node('leaf', null, 'activated')],
      tasks: [project('p2', [first, practice2])],
      reviewTasks: [{ id: 'r2', topicName: 'leaf', graphNodeId: 'leaf', dueDate: dateSafe.addDays(today, 2), roundOrder: 1, isCompleted: false }],
    });
    useTimelineStore.getState().updateBlockHeader('p2', 'practice-2', { isCompleted: true });
    assert.equal(useEbbStore.getState().reviewTasks[0].isCompleted, false);
  });

  check('逾期轮次由练习完成时只顺延后续日期，并在取消练习后安全恢复', async () => {
    const first = smartBlock('learn', '知识学习', ['leaf']);
    first.header.isCompleted = true;
    const practice = smartBlock('practice', '逾期练习', ['leaf']);
    const oldNextDate = dateSafe.addDays(today, 2);
    const reviewSourceId = sourceIds.getReviewSourceId('r2');
    resetStores({
      nodes: [node('leaf', null, 'activated')],
      tasks: [project('p1', [first, practice])],
      reviewTasks: [
        { id: 'r1', topicName: 'leaf', graphNodeId: 'leaf', dueDate: dateSafe.addDays(today, -2), roundOrder: 1, isCompleted: false },
        { id: 'r2', topicName: 'leaf', graphNodeId: 'leaf', dueDate: oldNextDate, roundOrder: 2, isCompleted: false },
      ],
      schedules: {
        [oldNextDate]: {
          date: oldNextDate,
          items: [{ id: 'daily-r2', sourceId: reviewSourceId, name: 'leaf', source: 'review', timeSlot: 'morning', order: 0 }],
          blocks: [],
        },
      },
    });
    useTimelineStore.getState().updateBlockHeader('p1', 'practice', { isCompleted: true });
    await nextTick();
    let reviews = useEbbStore.getState().reviewTasks;
    assert.equal(reviews[0].isCompleted, true);
    assert.equal(reviews[1].dueDate, dateSafe.addDays(oldNextDate, 2));
    assert.equal(useDailyScheduleStore.getState().schedules[oldNextDate].items.length, 0);

    useTimelineStore.getState().updateBlockHeader('p1', 'practice', { isCompleted: false });
    await nextTick();
    reviews = useEbbStore.getState().reviewTasks;
    assert.equal(reviews[0].isCompleted, false);
    assert.equal(reviews[1].dueDate, oldNextDate);
  });

  check('当天刚完成最后一轮后再完成项目任务，节点保持金色且不新增补充轮次', () => {
    const first = smartBlock('learn', '知识学习', ['leaf']);
    first.header.isCompleted = true;
    const practice = smartBlock('practice', '最后练习', ['leaf']);
    resetStores({
      nodes: [node('leaf', null, 'activated')],
      tasks: [project('p1', [first, practice])],
      reviewTasks: [{ id: 'r1', topicName: 'leaf', graphNodeId: 'leaf', dueDate: today, roundOrder: 1, isCompleted: false }],
    });
    assert.equal(useEbbStore.getState().toggleReviewTask('r1'), null);
    useTimelineStore.getState().updateBlockHeader('p1', 'practice', { isCompleted: true });
    assert.equal(useEbbStore.getState().reviewTasks.length, 1);
    assert.equal(useEbbStore.getState().reviewTasks[0].isCompleted, true);
  });

  check('全部轮次在以前完成后再次学习，只增加一次明日补充复习', () => {
    const first = smartBlock('learn', '知识学习', ['leaf']);
    first.header.isCompleted = true;
    const reinforce = smartBlock('reinforce', '再次强化', ['leaf']);
    const another = smartBlock('another', '同日继续强化', ['leaf']);
    resetStores({
      nodes: [node('leaf', null, 'activated')],
      tasks: [project('p1', [first, reinforce, another])],
      reviewTasks: [{
        id: 'r1', topicName: 'leaf', graphNodeId: 'leaf', dueDate: dateSafe.addDays(today, -10),
        roundOrder: 1, isCompleted: true, completedDate: dateSafe.addDays(today, -5),
      }],
    });
    useTimelineStore.getState().updateBlockHeader('p1', 'reinforce', { isCompleted: true });
    let reviews = useEbbStore.getState().reviewTasks;
    assert.equal(reviews.length, 2);
    assert.equal(reviews[1].isSupplemental, true);
    assert.equal(reviews[1].dueDate, dateSafe.addDays(today, 1));
    useTimelineStore.getState().updateBlockHeader('p1', 'another', { isCompleted: true });
    reviews = useEbbStore.getState().reviewTasks;
    assert.equal(reviews.length, 2);
    assert.equal(reviews[1].isCompleted, false);
  });

  check('取消补充复习的来源任务会移除尚未完成的补充轮次', () => {
    const first = smartBlock('learn', '知识学习', ['leaf']);
    first.header.isCompleted = true;
    const reinforce = smartBlock('reinforce', '再次强化', ['leaf']);
    resetStores({
      nodes: [node('leaf', null, 'activated')],
      tasks: [project('p1', [first, reinforce])],
      reviewTasks: [{ id: 'r1', topicName: 'leaf', graphNodeId: 'leaf', dueDate: dateSafe.addDays(today, -2), roundOrder: 1, isCompleted: true, completedDate: dateSafe.addDays(today, -1) }],
    });
    useTimelineStore.getState().updateBlockHeader('p1', 'reinforce', { isCompleted: true });
    assert.equal(useEbbStore.getState().reviewTasks.length, 2);
    useTimelineStore.getState().updateBlockHeader('p1', 'reinforce', { isCompleted: false });
    assert.equal(useEbbStore.getState().reviewTasks.length, 1);
  });

  check('删除已完成的练习任务块会撤销它自动完成的轮次', () => {
    const learned = smartBlock('learn', '知识学习', ['leaf']);
    learned.header.isCompleted = true;
    const practice = smartBlock('practice', '对应练习', ['leaf']);
    resetStores({
      nodes: [node('leaf', null, 'activated')],
      tasks: [project('p1', [learned, practice])],
      reviewTasks: [
        { id: 'r1', topicName: 'leaf', graphNodeId: 'leaf', dueDate: today, roundOrder: 1, isCompleted: false },
        { id: 'r2', topicName: 'leaf', graphNodeId: 'leaf', dueDate: dateSafe.addDays(today, 3), roundOrder: 2, isCompleted: false },
      ],
    });
    useTimelineStore.getState().updateBlockHeader('p1', 'practice', { isCompleted: true });
    assert.equal(useEbbStore.getState().reviewTasks.find((task) => task.id === 'r1').isCompleted, true);
    useTimelineStore.getState().removeBlock('p1', 'practice');
    assert.equal(useEbbStore.getState().reviewTasks.find((task) => task.id === 'r1').isCompleted, false);
    assert.equal(useTimelineStore.getState().tasks[0].blocks.some((block) => block.id === 'practice'), false);
  });

  check('删除首次学习项目会释放节点并清理尚未开始的排期', () => {
    resetStores({ nodes: [node('leaf')], tasks: [project('p1', [smartBlock('learn', '知识学习', ['leaf'])])] });
    useTimelineStore.getState().updateBlockHeader('p1', 'learn', { isCompleted: true });
    assert.ok(useEbbStore.getState().reviewTasks.length > 0);
    useTimelineStore.getState().deleteTask('p1');
    assert.equal(useTimelineStore.getState().tasks.length, 0);
    assert.equal(useEbbStore.getState().reviewTasks.length, 0);
    assert.notEqual(useGraphStore.getState().nodes[0].status, 'activated');
  });

  check('后续轮次已完成时，取消来源练习不会篡改既有复习历史', () => {
    const learned = smartBlock('learn', '知识学习', ['leaf']);
    learned.header.isCompleted = true;
    const practice = smartBlock('practice', '对应练习', ['leaf']);
    practice.header.isCompleted = true;
    resetStores({
      nodes: [node('leaf', null, 'activated')],
      tasks: [project('p1', [learned, practice])],
      reviewTasks: [
        {
          id: 'r1', topicName: 'leaf', graphNodeId: 'leaf', dueDate: today, roundOrder: 1,
          isCompleted: true, completedDate: today, completionSource: 'project-task',
          completionSourceTaskId: 'p1', completionSourceBlockId: 'practice',
        },
        {
          id: 'r2', topicName: 'leaf', graphNodeId: 'leaf', dueDate: dateSafe.addDays(today, 1),
          roundOrder: 2, isCompleted: true, completedDate: today, completionSource: 'manual',
        },
      ],
    });
    useTimelineStore.getState().updateBlockHeader('p1', 'practice', { isCompleted: false });
    const reviews = useEbbStore.getState().reviewTasks;
    assert.equal(reviews.find((task) => task.id === 'r1').isCompleted, true);
    assert.equal(reviews.find((task) => task.id === 'r2').isCompleted, true);
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
    assert.equal(useEbbStore.getState().reviewTasks.length, 0);
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

  check('批量编辑与跨分组拖动复用单任务联动，不遗留旧节点、EBB 或每日安排', () => {
    const sourceId = sourceIds.getProjectBlockSourceId('p1', 'b1');
    resetStores({
      nodes: [node('old'), node('next')],
      tasks: [project('p1', [smartBlock('b1', '旧名称', ['old'])])],
      schedules: {
        '2026-07-17': {
          date: '2026-07-17',
          items: [{ id: 's1', sourceId, name: '旧名称', source: 'project', timeSlot: 'morning', order: 0, duration: 30 }],
          blocks: [],
        },
      },
    });
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { isCompleted: true, completedDate: '2026-07-17' });
    const edited = structuredClone(getBlock('p1', 'b1'));
    edited.header = {
      ...edited.header,
      title: '新名称',
      duration: 45,
      date: '2026-07-18',
      graphNodeIds: ['next'],
      graphNodeId: 'next',
    };
    useTimelineStore.getState().updateTaskBlocks('p1', [edited]);
    assert.equal(useGraphStore.getState().nodes.find((item) => item.id === 'old').status, 'unactivated');
    assert.equal(useGraphStore.getState().nodes.find((item) => item.id === 'next').status, 'activated');
    assert.equal(useEbbStore.getState().reviewTasks.some((task) => task.graphNodeId === 'old'), false);
    assert.equal(useEbbStore.getState().reviewTasks.some((task) => task.graphNodeId === 'next'), true);
    assert.equal(useDailyScheduleStore.getState().schedules['2026-07-17'].items.length, 0);
  });

  check('EBB 收件箱批量生成的轮次编号唯一且连续', () => {
    resetStores();
    useEbbStore.setState({
      inboxItems: [{
        id: 'inbox-1', topicName: '批量主题', tag: '测试', status: 'staged',
        intervals: [1, 2, 4, 7], startDate: '2026-07-18', complexity: 'normal', createdAt: new Date().toISOString(),
      }],
    });
    const generated = useEbbStore.getState().generateTasksFromInbox(['inbox-1']);
    assert.deepEqual(generated.map((task) => task.roundOrder), [1, 2, 3, 4]);
    assert.equal(new Set(generated.map((task) => task.roundOrder)).size, generated.length);
  });

  check('EBB 标准化会过滤无效日期、去重 ID、修复重复轮次和大纲循环', () => {
    const normalized = ebbModule.normalizeEbbData({
      reviewTasks: [
        { id: 'r1', topicName: '主题', dueDate: '2026-07-18', roundOrder: 1, isCompleted: false },
        { id: 'r2', topicName: '主题', dueDate: '2026-07-19', roundOrder: 1, isCompleted: false },
        { id: 'bad', topicName: '坏日期', dueDate: '2026-02-30', isCompleted: false },
      ],
      inboxItems: [],
      outlineNodes: [
        { id: 'o1', type: 'book', name: '一', parentId: 'o2', childrenIds: ['o2'], orderIndex: 0 },
        { id: 'o2', type: 'chapter', name: '二', parentId: 'o1', childrenIds: ['o1'], orderIndex: 1 },
      ],
      ebbSettings: baseSettings,
    });
    assert.equal(normalized.reviewTasks.some((task) => task.id === 'bad'), false);
    assert.equal(new Set(normalized.reviewTasks.map((task) => task.roundOrder)).size, 2);
    const outlineById = new Map(normalized.outlineNodes.map((item) => [item.id, item]));
    for (const item of normalized.outlineNodes) {
      assert.notEqual(outlineById.get(item.parentId)?.parentId, item.id);
    }
  });

  check('积分按实际完成日期统计，而不是计划日期', () => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const task = {
      id: 'points-1', topicName: '逾期后完成', dueDate: '2020-01-01', roundOrder: 1,
      isCompleted: true, completedDate: today, complexity: 'normal',
    };
    assert.ok(scheduler.calcTodayPoints([task], baseSettings) > 0);
    assert.ok(scheduler.calcWeekPoints([task], baseSettings) > 0);
  });

  check('每日安排标准化拒绝零时长、24:00 和重复 ID 时间块', () => {
    const normalized = dailyModule.normalizeDailySchedules({
      '2026-07-18': {
        date: '2026-07-18', items: [],
        blocks: [
          { id: 'ok', sourceId: 'free-ok', name: '正常', source: 'free', startTime: '23:15', endTime: '23:45' },
          { id: 'zero', sourceId: 'free-zero', name: '零时长', source: 'free', startTime: '23:45', endTime: '23:45' },
          { id: 'midnight', sourceId: 'free-midnight', name: '午夜', source: 'free', startTime: '23:30', endTime: '24:00' },
          { id: 'ok', sourceId: 'free-dup', name: '重复', source: 'free', startTime: '09:00', endTime: '09:30' },
        ],
      },
    });
    assert.deepEqual(normalized['2026-07-18'].blocks.map((block) => block.id), ['ok']);
  });

  check('时间轴和每日安排会合并高频变化并同步写入本地镜像', async () => {
    resetStores({ tasks: [project('p1', [smartBlock('b1', '镜像任务', [])])] });
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { title: '已保存' });
    useDailyScheduleStore.getState().addScheduledItem('2026-07-18', {
      sourceId: 'free-mirror', name: '镜像安排', source: 'free', timeSlot: 'morning',
    });
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.ok(localStorage.getItem('smart-timeline-data:mirror'));
    assert.ok(localStorage.getItem('daily-schedule-data:mirror'));
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

  check('单词任务作为项目任务块保存，累计数量由初始值和每日记录共同派生', () => {
    const header = {
      taskKind: 'vocabulary', title: '考研英语单词', tag: '单词', tagColor: '#10B981',
      date: '2026-07-01', duration: 0, isCompleted: false,
      vocabularyTotalWords: 5500, vocabularyInitialCompletedWords: 1200,
      vocabularyRecords: { '2026-07-19': 50, '2026-07-20': 80 },
    };
    assert.equal(blocksModule.isVocabularyTask(header), true);
    assert.equal(blocksModule.getVocabularyLearnedWords(header), 1330);
    assert.equal(blocksModule.getVocabularyTotalWords(header), 5500);
    assert.equal(blocksModule.isQuantityTask(header), true);
    assert.equal(blocksModule.getQuantityUnit(header), '个');
    assert.equal(blocksModule.getQuantityCompleted(header), 1330);
  });

  check('通用数量任务支持自定义单位，并按剩余量和截止日动态调整每日建议', () => {
    const header = {
      taskKind: 'quantity', title: '考研数学题库', tag: '做题', tagColor: '#60A5FA',
      date: '2026-07-20', deadline: '2026-07-22', duration: 0, isCompleted: false,
      quantityUnit: '题', quantityTotal: 1000, quantityInitialCompleted: 700,
      quantityRecords: {},
    };
    assert.equal(blocksModule.isQuantityTask(header), true);
    assert.equal(blocksModule.getQuantityCompleted(header), 700);
    assert.deepEqual(blocksModule.getQuantityDailySuggestion(header, '2026-07-20'), {
      remaining: 300, daysRemaining: 2, suggested: 100, overdue: false,
    });
    header.quantityRecords['2026-07-20'] = 50;
    assert.deepEqual(blocksModule.getQuantityDailySuggestion(header, '2026-07-20'), {
      remaining: 300, daysRemaining: 2, suggested: 100, overdue: false,
    });
    assert.deepEqual(blocksModule.getQuantityDailyStatus(header, '2026-07-20'), {
      state: 'in-progress', actual: 50, target: 100, remainingToTarget: 50,
    });
    assert.deepEqual(blocksModule.getQuantityDailySuggestion(header, '2026-07-21'), {
      remaining: 250, daysRemaining: 1, suggested: 125, overdue: false,
    });
    header.quantityRecords['2026-07-20'] = 100;
    assert.deepEqual(blocksModule.getQuantityDailyStatus(header, '2026-07-20'), {
      state: 'achieved', actual: 100, target: 100, remainingToTarget: 0,
    });
    const openEnded = { ...header, deadline: undefined, quantityRecords: { '2026-07-20': 12 } };
    assert.deepEqual(blocksModule.getQuantityDailyStatus(openEnded, '2026-07-20'), {
      state: 'recorded', actual: 12, remainingToTarget: 0,
    });
  });

  check('通用数量任务和每日记录可进入完整工作区备份并通过校验', () => {
    const quantity = smartBlock('quantity', '专业课背诵', [], false);
    quantity.header = {
      ...quantity.header,
      taskKind: 'quantity', duration: 0, deadline: '2026-08-10',
      quantityUnit: '章', quantityTotal: 30, quantityInitialCompleted: 3,
      quantityRecords: { '2026-07-19': 1 },
    };
    resetStores({ tasks: [project('p1', [quantity])] });
    const backup = backupModule.createWorkspaceBackup();
    const saved = backup.timeline.tasks[0].blocks[0];
    assert.equal(saved.header.quantityRecords['2026-07-19'], 1);
    assert.equal(saved.header.quantityUnit, '章');
    const validation = backupModule.validateWorkspaceBackup(backup);
    assert.equal(validation.errors.length, 0);
    assert.equal(validation.summary.issues.length, 0);
  });

  check('更新单词任务每日记录不会生成独立全局计划，并跟随项目任务持久化', () => {
    const vocabulary = smartBlock('vocab', '考研英语单词', [], false);
    vocabulary.header = {
      ...vocabulary.header,
      taskKind: 'vocabulary', duration: 0,
      vocabularyTotalWords: 100, vocabularyInitialCompletedWords: 10, vocabularyRecords: {},
    };
    resetStores({ tasks: [project('p1', [vocabulary])] });
    useTimelineStore.getState().updateBlockHeader('p1', 'vocab', { vocabularyRecords: { '2026-07-19': 20 } });
    let header = getBlock('p1', 'vocab').header;
    assert.equal(blocksModule.getVocabularyLearnedWords(header), 30);
    useTimelineStore.getState().updateBlockHeader('p1', 'vocab', { vocabularyRecords: { '2026-07-19': 25 } });
    header = getBlock('p1', 'vocab').header;
    assert.equal(blocksModule.getVocabularyLearnedWords(header), 35);
  });

  check('完整工作区备份包含项目内单词任务、每日记录和日程引用并通过校验', () => {
    const vocabulary = smartBlock('vocab', '备份词汇', [], false);
    vocabulary.header = {
      ...vocabulary.header,
      taskKind: 'vocabulary', duration: 0,
      vocabularyTotalWords: 200, vocabularyInitialCompletedWords: 20,
      vocabularyRecords: { '2026-07-19': 10 },
    };
    const sourceId = sourceIds.getProjectBlockSourceId('p1', 'vocab');
    resetStores({
      tasks: [project('p1', [vocabulary])],
      schedules: { '2026-07-19': { date: '2026-07-19', items: [{ id: 'sv1', sourceId, name: '备份词汇', source: 'project', timeSlot: 'evening', order: 0 }], blocks: [] } },
    });
    const backup = backupModule.createWorkspaceBackup();
    const saved = backup.timeline.tasks[0].blocks[0];
    assert.equal(saved.header.vocabularyRecords['2026-07-19'], 10);
    const validation = backupModule.validateWorkspaceBackup(backup);
    assert.equal(validation.errors.length, 0);
    assert.equal(validation.summary.issues.length, 0);
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
