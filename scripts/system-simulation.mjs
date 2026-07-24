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
globalThis.CustomEvent ??= class CustomEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    this.detail = init.detail;
  }
};
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
    persistenceModule,
    categoryModule,
    excelImportModule,
    taskRulesModule,
    dailyTaskProjection,
    timelineDataModule,
    ebbDataModule,
    projectTaskCommands,
    projectTaskQuery,
    projectTaskEffects,
    ebbTaskSyncPlanner,
    graphBindingModule,
    choiceModule,
    taskBacklogModule,
    ebbComplexity,
    operationHistoryModule,
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
    load('/src/utils/persistence.ts'),
    load('/src/ebb/category.ts'),
    load('/src/utils/excelImport.ts'),
    load('/src/domain/taskRules.ts'),
    load('/src/domain/dailyTaskProjection.ts'),
    load('/src/store/timelineData.ts'),
    load('/src/ebb/dataNormalization.ts'),
    load('/src/services/projectTaskCommands.ts'),
    load('/src/domain/projectTaskQuery.ts'),
    load('/src/domain/projectTaskEffects.ts'),
    load('/src/ebb/taskSyncPlanner.ts'),
    load('/src/graph/bindingStore.ts'),
    load('/src/services/choice.ts'),
    load('/src/domain/taskBacklog.ts'),
    load('/src/ebb/complexity.ts'),
    load('/src/services/operationHistory.ts'),
  ]);

  const { useTimelineStore } = timelineModule;
  const { useGraphStore } = graphModule;
  const { useEbbStore } = ebbModule;
  const { useDailyScheduleStore } = dailyModule;
  const { useGraphBindingStore } = graphBindingModule;
  const {
    buildRootNodeMap,
    collectReviewCategories,
    getReviewCategoryColor,
    resolveReviewCategory,
  } = categoryModule;

  check('EBB分类统一使用知识大盘根节点，独立内容保留手动标签', () => {
    const nodes = [
      { id: 'root-a', name: '教育学', parentId: null, createdAt: 1 },
      { id: 'child-a', name: '战国教育', parentId: 'root-a', createdAt: 2 },
    ];
    const rootMap = buildRootNodeMap(nodes);
    const linked = resolveReviewCategory(
      { graphNodeId: 'child-a', tag: '来源项目任务标题' },
      rootMap,
    );
    const manual = resolveReviewCategory({ tag: '手动标签' }, rootMap);
    assert.deepEqual(linked, {
      key: 'root:root-a',
      label: '教育学',
      kind: 'root',
      rootNodeId: 'root-a',
    });
    assert.deepEqual(manual, {
      key: 'manual:手动标签',
      label: '手动标签',
      kind: 'manual',
    });
    const categories = collectReviewCategories([
      { id: 'r1', topicName: '战国教育', dueDate: '2026-07-22', isCompleted: false, graphNodeId: 'child-a', tag: '来源项目任务标题' },
      { id: 'r2', topicName: '独立主题', dueDate: '2026-07-22', isCompleted: false, tag: '手动标签' },
    ], rootMap);
    assert.deepEqual(categories.map((category) => category.label), ['教育学', '手动标签']);
  });

  check('EBB根节点改名和换父级立即更新分类，颜色按稳定根ID保留', () => {
    const task = { graphNodeId: 'leaf', tag: '旧项目标题' };
    const before = buildRootNodeMap([
      { id: 'root-a', name: '教育学', parentId: null, createdAt: 1 },
      { id: 'root-b', name: '心理学', parentId: null, createdAt: 2 },
      { id: 'leaf', name: '学习理论', parentId: 'root-a', createdAt: 3 },
    ]);
    const originalCategory = resolveReviewCategory(task, before);
    assert.equal(originalCategory?.label, '教育学');
    assert.equal(getReviewCategoryColor(originalCategory, { 'root:root-a': '#123456' }), '#123456');

    const renamed = buildRootNodeMap([
      { id: 'root-a', name: '教育学原理', parentId: null, createdAt: 1 },
      { id: 'root-b', name: '心理学', parentId: null, createdAt: 2 },
      { id: 'leaf', name: '学习理论', parentId: 'root-a', createdAt: 3 },
    ]);
    const renamedCategory = resolveReviewCategory(task, renamed);
    assert.equal(renamedCategory?.label, '教育学原理');
    assert.equal(getReviewCategoryColor(renamedCategory, { 'root:root-a': '#123456' }), '#123456');

    const moved = buildRootNodeMap([
      { id: 'root-a', name: '教育学原理', parentId: null, createdAt: 1 },
      { id: 'root-b', name: '心理学', parentId: null, createdAt: 2 },
      { id: 'leaf', name: '学习理论', parentId: 'root-b', createdAt: 3 },
    ]);
    assert.equal(resolveReviewCategory(task, moved)?.label, '心理学');
  });

  check('知识节点复习续轮不再复制旧项目标题，独立复习保留手动标签', () => {
    const linkedNext = scheduler.buildNextRoundTask([{
      id: 'linked-old',
      topicName: '战国教育',
      dueDate: '2026-07-20',
      originalDueDate: '2026-07-20',
      roundOrder: 1,
      isCompleted: true,
      graphNodeId: 'child-a',
      tag: '旧项目任务标题',
      complexity: 'normal',
    }], ebbConstants.DEFAULT_EBB_SETTINGS);
    const manualNext = scheduler.buildNextRoundTask([{
      id: 'manual-old',
      topicName: '独立主题',
      dueDate: '2026-07-20',
      originalDueDate: '2026-07-20',
      roundOrder: 1,
      isCompleted: true,
      tag: '手动标签',
      complexity: 'normal',
    }], ebbConstants.DEFAULT_EBB_SETTINGS);

    assert.equal(linkedNext?.tag, undefined);
    assert.equal(linkedNext?.graphNodeId, 'child-a');
    assert.equal(manualNext?.tag, '手动标签');
  });
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
    assert.ok(useEbbStore.getState().reviewTasks.every((task) => task.tag === undefined));

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

  check('IndexedDB成功写入后会清除localStorage完整数据镜像', async () => {
    resetStores({ tasks: [project('p1', [smartBlock('b1', '镜像任务', [])])] });
    useTimelineStore.getState().updateBlockHeader('p1', 'b1', { title: '已保存' });
    useDailyScheduleStore.getState().addScheduledItem('2026-07-18', {
      sourceId: 'free-mirror', name: '镜像安排', source: 'free', timeSlot: 'morning',
    });
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(localStorage.getItem('smart-timeline-data:mirror'), null);
    assert.equal(localStorage.getItem('daily-schedule-data:mirror'), null);
  });

  check('IndexedDB写入失败时会保留localStorage应急日志', async () => {
    const failing = persistenceModule.createCoalescedPersistence({
      mirrorKey: 'failure:mirror',
      label: 'failure-test',
      delay: 1,
      writeAsync: async () => { throw new Error('simulated IndexedDB failure'); },
    });
    await failing.writeNow({ safe: true });
    assert.deepEqual(JSON.parse(localStorage.getItem('failure:mirror')), { safe: true });
  });

  check('工作区快照使用压缩去重数据块并可完整还原', async () => {
    resetStores({
      tasks: [project('snapshot-project', [smartBlock('snapshot-block', '快照任务', [])])],
      schedules: { '2026-07-21': { date: '2026-07-21', items: [], blocks: [] } },
    });
    const snapshot = await backupModule.createLocalSnapshot('系统模拟');
    assert.equal(snapshot.format, 2);
    assert.ok(snapshot.chunks?.timeline);
    assert.equal(snapshot.backup, undefined);
    const restored = await backupModule.materializeWorkspaceSnapshot(snapshot);
    assert.equal(restored.timeline.tasks[0].id, 'snapshot-project');
    assert.ok((await backupModule.getSnapshotStorageStats()).chunkCount > 0);
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

  check('数量任务的开始日期不可清除，批量编辑与保存层均保留业务约束', () => {
    const quantity = smartBlock('quantity-start', '专业课背诵', [], false);
    quantity.header = {
      ...quantity.header,
      taskKind: 'quantity',
      date: '2026-07-10',
      duration: 0,
      quantityUnit: '章',
      quantityTotal: 30,
      quantityInitialCompleted: 0,
      quantityRecords: {},
    };
    const sourceId = sourceIds.getProjectBlockSourceId('p1', quantity.id);
    resetStores({
      tasks: [project('p1', [quantity])],
      schedules: {
        '2026-07-10': {
          date: '2026-07-10',
          items: [{ id: 'quantity-item', sourceId, name: quantity.header.title, source: 'project', timeSlot: 'morning', order: 0 }],
          blocks: [],
        },
      },
    });

    useTimelineStore.getState().updateBlockHeader('p1', quantity.id, { date: undefined });
    assert.equal(getBlock('p1', quantity.id).header.date, '2026-07-10');
    assert.equal(useDailyScheduleStore.getState().schedules['2026-07-10'].items.length, 1);

    const [row] = excelImportModule.blocksToRows([quantity]);
    const [cleared] = excelImportModule.cleanseRows([{ ...row, date: '', dateRaw: '' }]);
    assert.match(cleared._error, /开始日期/);
    const [merged] = excelImportModule.mergeBatchEditRows([{ ...row, date: '', dateRaw: '', _error: '' }], [quantity]);
    assert.equal(merged.header.date, '2026-07-10');
  });

  check('普通任务与持续任务共享统一时间语义，不再把持续任务的开始日判为逾期', () => {
    assert.equal(taskRulesModule.getTaskTemporalState({ date: undefined, isCompleted: false }, '2026-07-20'), 'unscheduled');
    assert.equal(taskRulesModule.getTaskTemporalState({ taskKind: 'quantity', isCompleted: false }, '2026-07-20'), 'invalid');
    const continuous = {
      taskKind: 'quantity',
      date: '2026-07-01',
      deadline: '2026-07-31',
      isCompleted: false,
    };
    assert.equal(taskRulesModule.getTaskTemporalState(continuous, '2026-07-20'), 'active');
    assert.equal(taskRulesModule.isTaskAvailableOnDate(continuous, '2026-07-20'), true);
    assert.equal(taskRulesModule.getTaskPlanningDate(continuous, '2026-07-20'), '2026-07-20');
    assert.equal(taskRulesModule.getTaskTemporalState(continuous, '2026-08-01'), 'overdue');
    assert.equal(taskRulesModule.isTaskAvailableOnDate({ ...continuous, isCompleted: true }, '2026-07-20'), false);
  });

  check('每日安排的时段和时间块模式共享同一任务投影', () => {
    const quantityTodo = {
      id: 'quantity-projection', text: '背诵单词', checked: false,
      parentTaskId: 'p1', parentTaskTitle: '英语', scheduled: '2026-07-01', due: '2026-07-31',
      _blockId: 'quantity', _taskKind: 'quantity', _quantityTotal: 100,
      _quantityInitialCompleted: 0, _quantityRecords: { '2026-07-20': 5 },
    };
    const standardTodo = {
      id: 'standard-projection', text: '普通任务', checked: false,
      parentTaskId: 'p1', parentTaskTitle: '英语', scheduled: '2026-07-20', _blockId: 'standard',
      _taskKind: 'standard',
    };
    let projected = dailyTaskProjection.projectTasksForDate(
      [quantityTodo, standardTodo],
      '2026-07-20',
    );
    assert.deepEqual(projected.pending.map((task) => task.id), ['quantity-projection', 'standard-projection']);
    assert.deepEqual(projected.completed, []);

    projected = dailyTaskProjection.projectTasksForDate(
      [{ ...quantityTodo, _quantityRecords: { '2026-07-20': 100 } }],
      '2026-07-20',
    );
    assert.deepEqual(projected.pending, []);
    assert.equal(projected.completed[0].id, 'quantity-projection');

    const reviews = dailyTaskProjection.reviewTasksForDate([
      { id: 'overdue-review', topicName: '逾期复习', dueDate: '2026-07-19', isCompleted: false },
      { id: 'today-review', topicName: '今日复习', dueDate: '2026-07-20', isCompleted: false },
    ], '2026-07-20', '2026-07-20');
    assert.deepEqual(reviews.pending.map((task) => task.id), ['overdue-review', 'today-review']);
  });

  check('大型 Store 拆分后的纯数据层保持旧数据修复和规范化契约', () => {
    const legacyQuantity = smartBlock('legacy-quantity', '旧数量任务', [], false);
    legacyQuantity.header = {
      ...legacyQuantity.header,
      taskKind: 'quantity',
      date: undefined,
      quantityTotal: 20,
      quantityRecords: { '2026-07-10': 2 },
    };
    const timeline = timelineDataModule.normalizeTimelineData({
      tasks: [{ id: 'p1', name: '项目', start: '2026-07-01', end: '2026-07-31', blocks: [legacyQuantity] }],
      groups: [{
        id: 'g1', name: '分组', start: '2026-07-01', end: '2026-07-31', color: '#fff', autoDate: true,
        children: [{ id: 'p1', name: '项目', start: '2026-07-01', end: '2026-07-31', blocks: [legacyQuantity] }],
      }],
      notes: [{ id: 'invalid-note' }],
      milestones: [],
    });
    assert.equal(timeline.tasks.length, 1);
    assert.equal(timeline.groups[0].children[0].groupId, 'g1');
    assert.equal(timeline.tasks[0].blocks[0].header.date, '2026-07-10');
    assert.equal(timeline.notes.length, 0);

    const ebb = ebbDataModule.normalizeEbbData({
      reviewTasks: [
        { id: 'r1', topicName: '主题', dueDate: '2026-07-20', isCompleted: false, roundOrder: 2 },
        { id: 'r1', topicName: '主题', dueDate: '2026-07-20', isCompleted: false, roundOrder: 2 },
      ],
      inboxItems: [],
      outlineNodes: [
        { id: 'a', name: 'A', type: 'chapter', parentId: 'b', childrenIds: ['b'], orderIndex: 0 },
        { id: 'b', name: 'B', type: 'section', parentId: 'a', childrenIds: ['a'], orderIndex: 1 },
      ],
      ebbSettings: ebbConstants.DEFAULT_EBB_SETTINGS,
    });
    assert.equal(ebb.reviewTasks.length, 1);
    assert.equal(ebb.reviewTasks[0].originalDueDate, '2026-07-20');
    assert.ok(ebb.outlineNodes.some((node) => node.parentId === null));
  });

  check('项目任务创建、改期、完成、归档和删除统一经过命令边界', () => {
    resetStores({ tasks: [project('command-project', [])] });
    const block = smartBlock('command-task', '命令任务', [], false);
    const created = projectTaskCommands.createProjectTask('command-project', block);
    assert.equal(created.ok, true);
    assert.equal(created.impact.operation, 'create');
    assert.ok(created.impact.affectedDomains.includes('daily-schedule'));
    assert.equal(getBlock('command-project', block.id).header.date, '2026-07-17');
    assert.equal(projectTaskCommands.rescheduleProjectTask('command-project', block.id, '2026-07-23').ok, true);
    assert.equal(getBlock('command-project', block.id).header.date, '2026-07-23');
    assert.equal(projectTaskCommands.setProjectTaskCompletion('command-project', block.id, true, '2026-07-23').ok, true);
    assert.equal(getBlock('command-project', block.id).header.isCompleted, true);
    assert.equal(projectTaskCommands.setProjectTaskArchived('command-project', block.id, true, '2026-07-23T08:00:00.000Z').ok, true);
    assert.equal(getBlock('command-project', block.id).header.isArchived, true);
    assert.equal(projectTaskCommands.deleteProjectTask('command-project', block.id).ok, true);
    assert.equal(useTimelineStore.getState().tasks[0].blocks.length, 0);

    const invalidQuantity = smartBlock('invalid-command-task', '缺少开始日期', [], false);
    invalidQuantity.header = { ...invalidQuantity.header, taskKind: 'quantity', date: undefined, duration: 0, quantityTotal: 10 };
    const rejected = projectTaskCommands.createProjectTask('command-project', invalidQuantity);
    assert.equal(rejected.ok, false);
  });

  check('项目任务重复保存会返回无变化结果，不写盘也不生成伪撤销能力', () => {
    const block = smartBlock('same-task', '保持不变', [], false);
    resetStores({ tasks: [project('p1', [block])] });
    const taskBefore = useTimelineStore.getState().tasks[0];
    const directResult = useTimelineStore.getState().updateBlockHeader('p1', 'same-task', {
      title: '保持不变',
      duration: 30,
    });
    assert.equal(directResult.changed, false);
    assert.deepEqual(directResult.affectedDomains, []);
    assert.equal(useTimelineStore.getState().tasks[0], taskBefore);

    const commandResult = projectTaskCommands.updateProjectTask('p1', 'same-task', {
      title: '保持不变',
    });
    assert.equal(commandResult.ok, true);
    assert.equal(commandResult.impact.changed, false);
    assert.equal(commandResult.impact.undoable, false);
    assert.deepEqual(commandResult.impact.affectedDomains, ['project']);
  });

  check('项目任务提交报告准确描述每日安排清理，归档不会遗留已安排卡片', () => {
    const block = smartBlock('archive-task', '待归档任务', [], false);
    const sourceId = sourceIds.getProjectBlockSourceId('p1', 'archive-task');
    resetStores({
      tasks: [project('p1', [block])],
      schedules: {
        '2026-07-17': {
          date: '2026-07-17',
          items: [{
            id: 'scheduled-project-task',
            sourceId,
            name: '待归档任务',
            source: 'project',
            timeSlot: 'morning',
            order: 0,
          }],
          blocks: [],
        },
      },
    });
    const result = useTimelineStore.getState().updateBlockHeader('p1', 'archive-task', {
      isArchived: true,
    });
    assert.equal(result.changed, true);
    assert.equal(result.dailyScheduleAction, 'removed');
    assert.ok(result.affectedDomains.includes('daily-schedule'));
    assert.ok(result.affectedDomains.includes('week-matrix'));
    assert.equal(
      useDailyScheduleStore.getState().schedules['2026-07-17'].items.length,
      0,
    );
  });

  check('知识大盘可以确认分组内项目任务的节点绑定', async () => {
    const groupedTask = { ...project('grouped-task', [smartBlock('grouped-block', '分组任务', [])]), groupId: 'g1' };
    resetStores({
      groups: [{
        id: 'g1',
        name: '分组',
        start: '2026-07-01',
        end: '2026-08-31',
        color: '#60A5FA',
        children: [groupedTask],
      }],
      nodes: [node('node-a')],
    });
    useGraphBindingStore.setState({
      active: true,
      taskId: 'grouped-task',
      blockId: 'grouped-block',
      taskTitle: '分组任务',
      originalNodeIds: [],
      selectedNodeIds: ['node-a'],
    });
    assert.equal(await useGraphBindingStore.getState().confirm(), 'saved');
    const storedBlock = useTimelineStore.getState().groups[0].children[0].blocks[0];
    assert.deepEqual(storedBlock.header.graphNodeIds, ['node-a']);
  });

  check('已完成任务改绑会要求明确选择复习策略，取消时不提交修改', async () => {
    const completedBlock = smartBlock('binding-block', '已完成任务', ['node-a']);
    completedBlock.header = {
      ...completedBlock.header,
      isCompleted: true,
      completedDate: '2026-07-23',
    };
    const oldReview = {
      id: 'old-review',
      topicName: '旧节点',
      graphNodeId: 'node-a',
      dueDate: '2026-07-25',
      originalDueDate: '2026-07-25',
      roundOrder: 1,
      isCompleted: false,
      complexity: 'normal',
      smStatus: 'scheduled',
    };
    resetStores({
      tasks: [project('p1', [completedBlock])],
      nodes: [
        node('node-a', null, 'activated', { name: '旧节点' }),
        node('node-b', null, 'unactivated', { name: '新节点' }),
      ],
      reviewTasks: [oldReview],
    });
    useGraphBindingStore.setState({
      active: true,
      isConfirming: false,
      taskId: 'p1',
      blockId: 'binding-block',
      taskTitle: '已完成任务',
      originalNodeIds: ['node-a'],
      selectedNodeIds: ['node-b'],
    });

    let presentedChoices = [];
    const removeHandler = choiceModule.setChoiceHandler(async (options) => {
      presentedChoices = options.choices.map((choice) => choice.value);
      return null;
    });
    try {
      assert.equal(await useGraphBindingStore.getState().confirm(), 'cancelled');
    } finally {
      removeHandler();
    }
    assert.deepEqual(presentedChoices, [
      'transfer',
      'association-only',
      'keep-existing-reviews',
    ]);
    assert.equal(useGraphBindingStore.getState().active, true);
    assert.deepEqual(getBlock('p1', 'binding-block').header.graphNodeIds, ['node-a']);
    assert.deepEqual(useEbbStore.getState().reviewTasks, [oldReview]);
  });

  check('已完成任务选择仅修改关联时更新节点但不改动复习计划', async () => {
    const completedBlock = smartBlock('binding-block', '已完成任务', ['node-a']);
    completedBlock.header = {
      ...completedBlock.header,
      isCompleted: true,
      completedDate: '2026-07-23',
    };
    const oldReview = {
      id: 'old-review',
      topicName: '旧节点',
      graphNodeId: 'node-a',
      dueDate: '2026-07-25',
      originalDueDate: '2026-07-25',
      roundOrder: 1,
      isCompleted: false,
      complexity: 'normal',
      smStatus: 'scheduled',
    };
    resetStores({
      tasks: [project('p1', [completedBlock])],
      nodes: [node('node-a', null, 'activated'), node('node-b')],
      reviewTasks: [oldReview],
    });
    useGraphBindingStore.setState({
      active: true,
      isConfirming: false,
      taskId: 'p1',
      blockId: 'binding-block',
      taskTitle: '已完成任务',
      originalNodeIds: ['node-a'],
      selectedNodeIds: ['node-b'],
    });
    const removeHandler = choiceModule.setChoiceHandler(
      async () => 'association-only',
    );
    try {
      assert.equal(await useGraphBindingStore.getState().confirm(), 'saved');
    } finally {
      removeHandler();
    }
    assert.deepEqual(getBlock('p1', 'binding-block').header.graphNodeIds, ['node-b']);
    assert.equal(useGraphStore.getState().nodes.find((item) => item.id === 'node-a').status, 'unactivated');
    assert.equal(useGraphStore.getState().nodes.find((item) => item.id === 'node-b').status, 'activated');
    assert.deepEqual(useEbbStore.getState().reviewTasks, [oldReview]);
  });

  check('项目任务跨模块影响由统一规划器处理完成、撤销、改绑和自动复习', () => {
    const graphNodes = [
      { id: 'node-a', name: '教育学', parentId: null, createdAt: 1 },
      { id: 'node-b', name: '心理学', parentId: null, createdAt: 2 },
    ];
    const pending = smartBlock('target', '学习理论', ['node-a'], true);
    const completed = {
      ...pending,
      header: { ...pending.header, isCompleted: true, completedDate: '2026-07-23' },
    };

    const completePlan = projectTaskEffects.planProjectTaskEffects({
      tasks: [project('p1', [pending])],
      taskId: 'p1',
      blockId: 'target',
      currentHeader: pending.header,
      nextHeader: completed.header,
      graphNodes,
    });
    assert.deepEqual(completePlan.graphNodeIdsToActivate, ['node-a']);
    assert.deepEqual(completePlan.graphNodeIdsToDeactivate, []);
    assert.deepEqual(
      completePlan.ebbPayloads.map(({ action, graphNodeId, triggerSchedule }) => ({
        action, graphNodeId, triggerSchedule,
      })),
      [{ action: 'add', graphNodeId: 'node-a', triggerSchedule: true }],
    );

    const undoPlan = projectTaskEffects.planProjectTaskEffects({
      tasks: [project('p1', [completed])],
      taskId: 'p1',
      blockId: 'target',
      currentHeader: completed.header,
      nextHeader: pending.header,
      graphNodes,
    });
    assert.deepEqual(undoPlan.graphNodeIdsToDeactivate, ['node-a']);
    assert.deepEqual(undoPlan.ebbPayloads.map(({ action }) => action), ['revert-source', 'remove']);

    const anotherCompleted = smartBlock('other', '另一来源', ['node-a'], true);
    anotherCompleted.header = { ...anotherCompleted.header, isCompleted: true };
    const sharedNodePlan = projectTaskEffects.planProjectTaskEffects({
      tasks: [project('p1', [completed, anotherCompleted])],
      taskId: 'p1',
      blockId: 'target',
      currentHeader: completed.header,
      nextHeader: pending.header,
      graphNodes,
    });
    assert.deepEqual(sharedNodePlan.graphNodeIdsToDeactivate, []);
    assert.deepEqual(sharedNodePlan.ebbPayloads.map(({ action }) => action), ['revert-source']);

    const reboundPlan = projectTaskEffects.planProjectTaskEffects({
      tasks: [project('p1', [completed])],
      taskId: 'p1',
      blockId: 'target',
      currentHeader: completed.header,
      nextHeader: { ...completed.header, graphNodeIds: ['node-b'] },
      graphNodes,
    });
    assert.deepEqual(reboundPlan.graphNodeIdsToActivate, ['node-b']);
    assert.deepEqual(reboundPlan.graphNodeIdsToDeactivate, ['node-a']);
    assert.deepEqual(
      reboundPlan.ebbPayloads.map(({ action, graphNodeId }) => ({ action, graphNodeId })),
      [
        { action: 'add', graphNodeId: 'node-b' },
        { action: 'revert-source', graphNodeId: 'node-a' },
        { action: 'remove', graphNodeId: 'node-a' },
      ],
    );

    const associationOnlyPlan = projectTaskEffects.planProjectTaskEffects({
      tasks: [project('p1', [completed])],
      taskId: 'p1',
      blockId: 'target',
      currentHeader: completed.header,
      nextHeader: { ...completed.header, graphNodeIds: ['node-b'] },
      graphNodes,
      bindingStrategy: 'association-only',
    });
    assert.deepEqual(associationOnlyPlan.graphNodeIdsToActivate, ['node-b']);
    assert.deepEqual(associationOnlyPlan.graphNodeIdsToDeactivate, ['node-a']);
    assert.deepEqual(associationOnlyPlan.ebbPayloads, []);

    const keepExistingPlan = projectTaskEffects.planProjectTaskEffects({
      tasks: [project('p1', [completed])],
      taskId: 'p1',
      blockId: 'target',
      currentHeader: completed.header,
      nextHeader: { ...completed.header, graphNodeIds: ['node-b'] },
      graphNodes,
      bindingStrategy: 'keep-existing-reviews',
    });
    assert.deepEqual(keepExistingPlan.graphNodeIdsToActivate, ['node-b']);
    assert.deepEqual(keepExistingPlan.graphNodeIdsToDeactivate, ['node-a']);
    assert.deepEqual(
      keepExistingPlan.ebbPayloads.map(({ action, graphNodeId }) => ({ action, graphNodeId })),
      [{ action: 'add', graphNodeId: 'node-b' }],
    );

    const disableAutoSyncPlan = projectTaskEffects.planProjectTaskEffects({
      tasks: [project('p1', [completed])],
      taskId: 'p1',
      blockId: 'target',
      currentHeader: completed.header,
      nextHeader: { ...completed.header, autoSyncEbb: false },
      graphNodes,
    });
    assert.deepEqual(disableAutoSyncPlan.ebbPayloads.map(({ action }) => action), ['remove']);
  });

  check('项目任务触发的 EBB 推进、顺延和撤销由纯事务规划器稳定计算', () => {
    const reviewTasks = [
      {
        id: 'round-1', topicName: '学习理论', graphNodeId: 'node-a',
        dueDate: '2026-07-20', originalDueDate: '2026-07-20',
        roundOrder: 1, isCompleted: false, complexity: 'normal', smStatus: 'scheduled',
      },
      {
        id: 'round-2', topicName: '学习理论', graphNodeId: 'node-a',
        dueDate: '2026-07-22', originalDueDate: '2026-07-22',
        roundOrder: 2, isCompleted: false, complexity: 'normal', smStatus: 'scheduled',
      },
    ];
    const payload = {
      action: 'add',
      graphNodeId: 'node-a',
      topicName: '学习理论',
      sourceTaskId: 'p1',
      sourceBlockId: 'b1',
    };
    const progressed = ebbTaskSyncPlanner.planEbbTaskSync({
      reviewTasks,
      ebbSettings: ebbConstants.DEFAULT_EBB_SETTINGS,
      payload,
      today: '2026-07-23',
    });
    assert.equal(progressed.changed, true);
    assert.equal(progressed.reviewTasks[0].isCompleted, true);
    assert.equal(progressed.reviewTasks[0].completionSource, 'project-task');
    assert.deepEqual(progressed.reviewTasks[0].previousSchedule, [
      { reviewTaskId: 'round-2', dueDate: '2026-07-22' },
    ]);
    assert.equal(progressed.reviewTasks[1].dueDate, '2026-07-25');
    assert.deepEqual(progressed.dailySourceIdsToRemove, [
      sourceIds.getReviewSourceId('round-2'),
    ]);

    const reverted = ebbTaskSyncPlanner.planEbbTaskSync({
      reviewTasks: progressed.reviewTasks,
      ebbSettings: ebbConstants.DEFAULT_EBB_SETTINGS,
      payload: { ...payload, action: 'revert-source' },
      today: '2026-07-23',
    });
    assert.equal(reverted.reviewTasks[0].isCompleted, false);
    assert.equal(reverted.reviewTasks[0].completionSource, undefined);
    assert.equal(reverted.reviewTasks[1].dueDate, '2026-07-22');
    assert.deepEqual(reverted.dailySourceIdsToRemove, [
      sourceIds.getReviewSourceId('round-2'),
    ]);

    const completedHistory = reviewTasks.map((task, index) => ({
      ...task,
      isCompleted: true,
      completedDate: `2026-07-${20 + index}`,
    }));
    const supplemental = ebbTaskSyncPlanner.planEbbTaskSync({
      reviewTasks: completedHistory,
      ebbSettings: ebbConstants.DEFAULT_EBB_SETTINGS,
      payload,
      today: '2026-07-23',
      createReviewTaskId: () => 'supplemental-3',
    });
    assert.equal(supplemental.reviewTasks.at(-1).id, 'supplemental-3');
    assert.equal(supplemental.reviewTasks.at(-1).roundOrder, 3);
    assert.equal(supplemental.reviewTasks.at(-1).dueDate, '2026-07-24');
    assert.equal(supplemental.reviewTasks.at(-1).isSupplemental, true);
  });

  check('任务总览筛选、排序和统计共享同一查询规则', () => {
    const records = [
      { id: 'overdue', header: { ...smartBlock('a', '逾期', [], false).header, date: '2026-07-10' } },
      { id: 'today', header: { ...smartBlock('b', '今天', [], false).header, date: '2026-07-23' } },
      { id: 'unscheduled', header: { ...smartBlock('c', '未排期', [], false).header, date: undefined } },
      { id: 'completed', header: { ...smartBlock('d', '完成', [], false).header, date: '2026-07-23', isCompleted: true } },
    ];
    const toRecord = (item) => ({
      projectId: 'p1', tag: item.header.tag, title: item.header.title,
      searchableText: item.header.title, header: item.header,
    });
    const pending = projectTaskQuery.filterAndSortProjectTasks(
      records,
      toRecord,
      { query: '', projectId: 'all', tag: 'all', status: 'pending', date: 'all' },
      '2026-07-23',
    );
    assert.deepEqual(pending.map((item) => item.id), ['overdue', 'today', 'unscheduled']);
    const stats = projectTaskQuery.summarizeProjectTasks(records, (item) => item.header, '2026-07-23');
    assert.deepEqual(stats, { total: 4, pending: 3, today: 1, overdue: 1, unscheduled: 1, completed: 1 });
  });

  check('旧数量任务缺少日期时按进度记录或项目开始日恢复，并能被备份校验识别', () => {
    const missingWithRecord = {
      taskKind: 'vocabulary',
      vocabularyRecords: { '2026-07-12': 10, '2026-07-15': 20 },
    };
    assert.equal(
      blocksModule.recoverRequiredTaskStartDate(missingWithRecord, '2026-07-01'),
      '2026-07-12',
    );
    assert.equal(
      blocksModule.recoverRequiredTaskStartDate({ taskKind: 'quantity', quantityRecords: {} }, '2026-07-01'),
      '2026-07-01',
    );

    const quantity = smartBlock('invalid-quantity', '缺少日期的背诵任务', [], false);
    quantity.header = {
      ...quantity.header,
      taskKind: 'quantity',
      date: undefined,
      duration: 0,
      quantityUnit: '章',
      quantityTotal: 10,
      quantityInitialCompleted: 0,
      quantityRecords: {},
    };
    resetStores({ tasks: [project('p1', [quantity])] });
    const backup = backupModule.createWorkspaceBackup();
    const validation = backupModule.validateWorkspaceBackup(backup);
    assert.ok(validation.summary.issues.some((issue) => /开始日期/.test(issue)));
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

  check('quantity progress rejects dates before the task start date', () => {
    const quantity = smartBlock('future-quantity', 'Future quantity', [], false);
    quantity.header = {
      ...quantity.header,
      taskKind: 'quantity',
      date: '2026-07-25',
      duration: 0,
      quantityUnit: 'item',
      quantityTotal: 100,
      quantityInitialCompleted: 0,
      quantityRecords: {},
    };
    resetStores({ tasks: [project('future-project', [quantity])] });
    const result = projectTaskCommands.recordQuantityProgress(
      'future-project',
      'future-quantity',
      '2026-07-24',
      10,
    );
    assert.equal(result.ok, false);
    assert.equal(blocksModule.getQuantityCompleted(getBlock('future-project', 'future-quantity').header), 0);
  });

  check('single review reschedule undo restores the original daily placement', async () => {
    operationHistoryModule.useOperationHistory.getState().clear();
    const review = {
      id: 'reschedule-snapshot',
      topicName: 'Snapshot review',
      dueDate: '2026-07-18',
      originalDueDate: '2026-07-18',
      roundOrder: 1,
      isCompleted: false,
    };
    const sourceId = sourceIds.getReviewSourceId(review.id);
    resetStores({
      reviewTasks: [review],
      schedules: {
        '2026-07-18': {
          date: '2026-07-18',
          items: [{ id: 'snapshot-item', sourceId, name: review.topicName, source: 'review', timeSlot: 'evening', order: 0 }],
          blocks: [{ id: 'snapshot-block', sourceId, name: review.topicName, startTime: '20:00', endTime: '20:30', color: '#fff' }],
        },
      },
    });
    useEbbStore.getState().updateReviewTask(review.id, { dueDate: '2026-07-22' });
    assert.equal(useDailyScheduleStore.getState().schedules['2026-07-18'].items.length, 0);
    assert.equal(await operationHistoryModule.useOperationHistory.getState().undo(), true);
    assert.equal(useEbbStore.getState().reviewTasks[0].dueDate, '2026-07-18');
    assert.equal(useDailyScheduleStore.getState().schedules['2026-07-18'].items[0].timeSlot, 'evening');
    assert.equal(useDailyScheduleStore.getState().schedules['2026-07-18'].blocks[0].startTime, '20:00');
  });

  check('Excel import validates calendar dates and preserves decimal durations', () => {
    assert.equal(excelImportModule.normalizeDate('2026-02-29'), '');
    assert.equal(excelImportModule.normalizeDate('2026-13-40'), '');
    assert.equal(excelImportModule.normalizeDate('Jul 6, 2026'), '2026-07-06');
    assert.equal(excelImportModule.normalizeDate('Feb 29, 2024'), '2024-02-29');
    assert.equal(excelImportModule.parseDuration('17.5'), 17.5);
    assert.equal(excelImportModule.parseDuration('1.5小时'), 90);
  });

  check('project task complexity drives generated review intervals and appended rounds keep points', () => {
    const currentHeader = {
      ...smartBlock('complexity-task', 'Hard task', ['complexity-leaf']).header,
      complexity: 'hard',
      isCompleted: false,
    };
    const nextHeader = { ...currentHeader, isCompleted: true };
    const effects = projectTaskEffects.planProjectTaskEffects({
      tasks: [project('complexity-project', [{ ...smartBlock('complexity-task', 'Hard task', ['complexity-leaf']), header: currentHeader }])],
      taskId: 'complexity-project',
      blockId: 'complexity-task',
      currentHeader,
      nextHeader,
      graphNodes: [node('complexity-leaf', null, 'unactivated')],
    });
    assert.equal(effects.ebbPayloads[0].complexity, 'hard');
    const generated = ebbTaskSyncPlanner.planEbbTaskSync({
      reviewTasks: [],
      ebbSettings: ebbConstants.DEFAULT_EBB_SETTINGS,
      payload: effects.ebbPayloads[0],
      today: '2026-07-24',
      createReviewTaskId: (() => { let id = 0; return () => `hard-${++id}`; })(),
    });
    assert.equal(generated.reviewTasks.length, ebbConstants.DEFAULT_COMPLEXITY_CONFIGS.hard.intervals.length);
    assert.ok(generated.reviewTasks.every((task) => task.complexity === 'hard'));
    assert.equal(ebbComplexity.getPointWeight(10, 'hard'), 0.5);
  });

  check('continuous quantity tasks contribute to every active week workload date', () => {
    const quantity = smartBlock('weekly-quantity', 'Weekly quantity', [], false);
    quantity.header = {
      ...quantity.header,
      taskKind: 'quantity',
      date: '2026-07-20',
      duration: 0,
      quantityUnit: 'item',
      quantityTotal: 100,
      quantityInitialCompleted: 0,
      quantityRecords: {},
    };
    const dates = ['2026-07-20', '2026-07-21', '2026-07-22'];
    const workloads = taskBacklogModule.calculateDateWorkloads({
      dates,
      tasks: [project('weekly-project', [quantity])],
      reviewTasks: [],
      schedules: {},
      preferences: {
        weekdayCapacityMinutes: 240,
        weekendCapacityMinutes: 360,
        showTaskCount: true,
        showDuration: true,
      },
    });
    assert.deepEqual(dates.map((date) => workloads.get(date).quantityCount), [1, 1, 1]);
    assert.deepEqual(dates.map((date) => workloads.get(date).taskCount), [1, 1, 1]);
  });

  check('an overdue review completed today remains in today completed projection', () => {
    const projected = dailyTaskProjection.reviewTasksForDate([{
      id: 'completed-overdue',
      topicName: 'Completed overdue review',
      dueDate: '2026-07-20',
      completedDate: '2026-07-24',
      isCompleted: true,
    }], '2026-07-24', '2026-07-24');
    assert.deepEqual(projected.pending, []);
    assert.equal(projected.completed[0].id, 'completed-overdue');
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
