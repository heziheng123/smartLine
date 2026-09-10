import { expect, test } from '@playwright/test';

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible({ timeout: 30_000 });
  await page.getByTitle('每日安排').click();
  await page.getByRole('button', { name: '快速开始专注' }).click();
  await page.getByRole('button', { name: '打开专注面板' }).click();
  await expect(page.getByRole('dialog', { name: '专注面板' })).toBeVisible();
  await expect(page.getByRole('main', { name: '专注计时' })).toBeVisible();
});

test('free timing can stop from the global control bar and freezes the saved duration', async ({ page }) => {
  await page.getByRole('button', { name: '新建主题' }).click();
  await page.getByLabel('主题名称').fill('自由计时验收');
  await page.getByRole('button', { name: '创建主题' }).click();
  await page.locator('summary[aria-label="自由计时验收更多开始方式"]').click();
  await page.getByRole('button', { name: '自由计时', exact: true }).click();
  await expect(page.getByLabel('当前专注控制条')).toContainText('进行中');

  await page.getByRole('button', { name: '关闭专注面板' }).click();
  await page.getByTitle('每日安排').click();
  await expect(page.getByRole('button', { name: '结束专注' })).toBeVisible();
  await page.getByRole('button', { name: '结束专注' }).click();
  const frozenClock = page.locator('.focus-current__duration');
  const stoppedAt = await frozenClock.textContent();
  await page.waitForTimeout(1_200);
  await expect(frozenClock).toHaveText(stoppedAt ?? '');
  await expect(page.getByText('已停止', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续计时' }).click();
  await expect(page.getByText('进行中', { exact: true }).first()).toBeVisible();
});

test('daily review opens independently from the compact start flow', async ({ page }) => {
  await page.getByRole('button', { name: '关闭专注面板' }).click();
  await page.getByTitle('每日安排').click();
  await page.getByRole('button', { name: '打开专注复盘' }).click();
  await expect(page.getByRole('dialog', { name: '专注复盘' })).toBeVisible();
  await expect(page.getByRole('main', { name: '专注复盘' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '核心摘要' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '当前专注' })).toHaveCount(0);
});

test('manual record derives end time and valid minutes from the required start time', async ({ page }) => {
  await page.getByRole('button', { name: '新建主题' }).click();
  await page.getByLabel('主题名称').fill('补录联动验收');
  await page.getByRole('button', { name: '创建主题' }).click();
  await page.getByRole('button', { name: '添加记录' }).click();
  const values = await page.evaluate(() => {
    const toInput = (time: number) => new Date(time - new Date(time).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
    const start = Date.now() - 3 * 60 * 60_000;
    return { start: toInput(start), end45: toInput(start + 45 * 60_000), end90: toInput(start + 90 * 60_000) };
  });
  await page.getByLabel('开始时间').fill(values.start);
  await page.getByLabel('有效分钟').fill('45');
  await expect(page.getByLabel('结束时间')).toHaveValue(values.end45);
  await page.getByLabel('结束时间').fill(values.end90);
  await expect(page.getByLabel('有效分钟')).toHaveValue('90');
});

test('management and review use separate panels while keeping the same saved data', async ({ page }) => {
  await page.evaluate(async () => {
    const { useFocusStore } = await import('/src/focus/store.ts');
    const store = useFocusStore.getState();
    const first = await store.createSubject({ name: '数学分析', color: '#4f46e5', weeklyTargetMinutes: 300, defaultBackgroundPolicy: 'continue' });
    const second = await useFocusStore.getState().createSubject({ name: '英语阅读', color: '#10b981', weeklyTargetMinutes: 180, defaultBackgroundPolicy: 'continue' });
    const timeZone = 'Asia/Shanghai';
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - 30 * 60_000);
    const previousEndedAt = new Date(endedAt.getTime() - 24 * 60 * 60_000);
    const previousStartedAt = new Date(previousEndedAt.getTime() - 30 * 60_000);
    const stamp = endedAt.toISOString();
    await useFocusStore.getState().createManualSession({
      id: crypto.randomUUID(), source: 'manual', subjectId: first.id, startedAt: startedAt.toISOString(), endedAt: stamp,
      activeSeconds: 1_500, interruptions: [{ startedAt: new Date(startedAt.getTime() + 10 * 60_000).toISOString(), endedAt: new Date(startedAt.getTime() + 15 * 60_000).toISOString(), source: 'manual', reason: 'urgent' }],
      localDate, timeZone, createdAt: stamp, updatedAt: stamp, mode: 'free',
    });
    await useFocusStore.getState().createManualSession({
      id: crypto.randomUUID(), source: 'manual', subjectId: second.id, startedAt: previousStartedAt.toISOString(), endedAt: previousEndedAt.toISOString(),
      activeSeconds: 1_800, interruptions: [], localDate: new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(previousEndedAt), timeZone, createdAt: stamp, updatedAt: stamp, mode: 'pomodoro', targetMinutes: 30,
    });
  });

  await expect(page.getByRole('heading', { name: '当前专注' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '我的专注主题' })).toBeVisible();
  await page.getByRole('button', { name: '查看复盘' }).click();
  const analytics = page.getByLabel('数据复盘');
  await expect(analytics).toContainText('总专注');
  await expect(analytics).toContainText('本周专注');
  await expect(analytics).toContainText('平均单次');
  await expect(page.getByRole('img', { name: /专注时长趋势/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '投入时段' })).toBeVisible();
  await expect(page.getByRole('img', { name: /分时段专注投入/ })).toBeVisible();
  await page.getByRole('button', { name: '日', exact: true }).click();
  await expect(analytics).toContainText('会话');
  await expect(analytics).toContainText('活跃主题');
  await expect(page.getByRole('heading', { name: '时间投入构成' })).toBeVisible();
  await page.getByRole('button', { name: '周', exact: true }).click();
  await expect(page.getByRole('button', { name: '周', exact: true })).toHaveClass(/is-active/);
  await expect(page.locator('.focus-subject-bar-chart li > div > i')).toHaveCount(2);
  await expect(page.getByRole('img', { name: /专注时长趋势/ }).locator('circle')).toHaveCount(7);
});

test('weekly quality and review plan compare real sessions without changing timer records', async ({ page }) => {
  const seeded = await page.evaluate(async () => {
    const { useFocusStore } = await import('/src/focus/store.ts');
    const subject = await useFocusStore.getState().createSubject({ name: '质量复盘', color: '#4f46e5', defaultBackgroundPolicy: 'continue' });
    const timeZone = 'Asia/Shanghai';
    const localDate = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
    const add = async (daysAgo: number, activeSeconds: number, interruptions: number) => {
      const endedAt = new Date(Date.now() - daysAgo * 86_400_000);
      const startedAt = new Date(endedAt.getTime() - 30 * 60_000);
      const stamp = endedAt.toISOString();
      await useFocusStore.getState().createManualSession({
        id: crypto.randomUUID(), source: 'manual', subjectId: subject.id, startedAt: startedAt.toISOString(), endedAt: stamp,
        activeSeconds, interruptions: interruptions ? [{ startedAt: new Date(startedAt.getTime() + 5 * 60_000).toISOString(), endedAt: new Date(startedAt.getTime() + 7 * 60_000).toISOString(), source: 'manual', reason: 'urgent' }] : [],
        localDate: localDate(endedAt), timeZone, createdAt: stamp, updatedAt: stamp, mode: 'pomodoro', targetMinutes: 25,
      });
    };
    await add(0, 1_500, 1);
    await add(8, 1_200, 0);
    return { subjectId: subject.id };
  });
  await page.getByRole('button', { name: '查看复盘' }).click();
  await expect(page.getByRole('heading', { name: '专注质量' })).toBeVisible();
  await expect(page.getByLabel('本周与上周专注质量对比')).toContainText('番茄目标达成率');
  await expect(page.getByRole('heading', { name: '周度复盘' })).toBeVisible();
  await page.getByLabel('下周调整').fill('增加质量复盘主题，减少临时事务打断。');
  await page.getByRole('button', { name: '保存计划' }).click();
  await expect.poll(() => page.evaluate(async () => {
    const { useFocusStore } = await import('/src/focus/store.ts');
    return useFocusStore.getState().focusWeeklyReviews.map((item) => item.nextWeekPlan);
  })).toContain('增加质量复盘主题，减少临时事务打断。');
  await expect(page.locator('.focus-history-section')).toContainText('质量复盘');
  expect(seeded.subjectId).toBeTruthy();
});

test('daily schedule can start a focus session without leaving the planning workspace', async ({ page }) => {
  await page.getByRole('button', { name: '新建主题' }).click();
  await page.getByLabel('主题名称').fill('计划内快速开始');
  await page.getByRole('button', { name: '创建主题' }).click();
  await page.getByRole('button', { name: '关闭专注面板' }).click();
  await page.getByTitle('每日安排').click();

  await page.getByRole('button', { name: '快速开始专注' }).click();
  const quickStart = page.getByRole('dialog', { name: '快速开始专注' });
  await expect(quickStart.getByLabel('专注主题')).toHaveValue(/.+/);
  await quickStart.getByRole('button', { name: '自由计时', exact: true }).click();
  await expect(page.getByLabel('当前专注控制条')).toContainText('计划内快速开始');
  await expect(page.getByTitle('每日安排')).toHaveAttribute('aria-selected', 'true');
});

test('quick start exposes recent subjects as one-click starts with their last mode', async ({ page }) => {
  await page.evaluate(async () => {
    const { useFocusStore } = await import('/src/focus/store.ts');
    const subject = await useFocusStore.getState().createSubject({ name: '最近阅读', color: '#4f46e5', defaultBackgroundPolicy: 'continue' });
    const endedAt = new Date(Date.now() - 60_000);
    const startedAt = new Date(endedAt.getTime() - 1_500_000);
    const timeZone = 'Asia/Shanghai';
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(endedAt);
    await useFocusStore.getState().createManualSession({
      id: crypto.randomUUID(), source: 'manual', subjectId: subject.id, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), activeSeconds: 1_500,
      interruptions: [], localDate, timeZone, createdAt: endedAt.toISOString(), updatedAt: endedAt.toISOString(), mode: 'pomodoro', targetMinutes: 25,
    });
  });
  await page.getByRole('button', { name: '关闭专注面板' }).click();
  await page.getByTitle('每日安排').click();
  await page.getByRole('button', { name: '快速开始专注' }).click();
  const recent = page.getByLabel('最近专注');
  await expect(recent).toContainText('最近阅读');
  await expect(recent).toContainText('开始 25 分钟');
  await recent.getByRole('button').click();
  await expect(page.getByLabel('当前专注控制条')).toContainText('最近阅读');
});

test('saving a timer presents a compact completion result', async ({ page }) => {
  await page.evaluate(async () => {
    const { useFocusStore } = await import('/src/focus/store.ts');
    const { useActiveFocusStore } = await import('/src/focus/activeSession.ts');
    const { createActiveFocusSession } = await import('/src/focus/session.ts');
    const { createActiveFocusSessionAtomically } = await import('/src/focus/persistence.ts');
    const subject = await useFocusStore.getState().createSubject({ name: '结束结果验收', color: '#10b981', defaultBackgroundPolicy: 'continue' });
    const active = createActiveFocusSession({
      sessionId: crypto.randomUUID(), workspaceId: 'local', subjectId: subject.id, timeZone: 'Asia/Shanghai', mode: 'pomodoro', targetMinutes: 25,
    }, new Date(Date.now() - 90_000));
    await createActiveFocusSessionAtomically(active);
    useActiveFocusStore.setState({ active });
  });
  await page.getByRole('button', { name: '结束', exact: true }).click();
  await page.getByRole('button', { name: '保存并结束' }).click();
  const result = page.getByRole('dialog', { name: '本次专注结果' });
  await expect(result).toContainText('专注已保存');
  await expect(result).toContainText('有效时长');
  await expect(result).toContainText('暂停 / 打断');
  await expect(result).toContainText('25 分钟目标');
});

test('recent records filter by subject, mode and date range without changing saved data', async ({ page }) => {
  const seeded = await page.evaluate(async () => {
    const { useFocusStore } = await import('/src/focus/store.ts');
    const first = await useFocusStore.getState().createSubject({ name: '筛选数学', color: '#4f46e5', defaultBackgroundPolicy: 'continue' });
    const second = await useFocusStore.getState().createSubject({ name: '筛选英语', color: '#10b981', defaultBackgroundPolicy: 'continue' });
    const timeZone = 'Asia/Shanghai';
    const dateFor = (daysAgo: number) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - daysAgo * 86_400_000));
    const add = async (subjectId: string, daysAgo: number, mode: 'free' | 'pomodoro') => {
      const endedAt = new Date(Date.now() - daysAgo * 86_400_000);
      const startedAt = new Date(endedAt.getTime() - 300_000);
      const timestamp = new Date().toISOString();
      await useFocusStore.getState().createManualSession({
        id: crypto.randomUUID(), source: 'manual', subjectId, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), activeSeconds: 300,
        interruptions: [], localDate: dateFor(daysAgo), timeZone, createdAt: timestamp, updatedAt: timestamp,
        ...(mode === 'pomodoro' ? { mode, targetMinutes: 25 } : { mode }),
      });
    };
    await add(first.id, 0, 'free');
    await add(first.id, 10, 'pomodoro');
    await add(second.id, 0, 'free');
    return { firstId: first.id, today: dateFor(0) };
  });

  await page.getByRole('button', { name: '查看复盘' }).click();

  const history = page.locator('.focus-history-section .focus-history');
  await expect(history.locator('article')).toHaveCount(3);
  await page.getByLabel('按主题筛选').selectOption(seeded.firstId);
  await expect(history).toContainText('筛选数学');
  await expect(history).not.toContainText('筛选英语');
  await expect(history.locator('article')).toHaveCount(2);
  await page.getByLabel('按时间筛选').selectOption('today');
  await expect(history.locator('article')).toHaveCount(1);
  await page.getByLabel('按模式筛选').selectOption('free');
  await expect(history.locator('article')).toHaveCount(1);
  await page.getByLabel('按时间筛选').selectOption('custom');
  await page.getByLabel('记录开始日期').fill(seeded.today);
  await page.getByLabel('记录结束日期').fill(seeded.today);
  await expect(history.locator('article')).toHaveCount(1);
});

test('history editing preserves exact seconds and fixed metadata while supporting interruptions', async ({ page }) => {
  const seeded = await page.evaluate(async () => {
    const { useFocusStore } = await import('/src/focus/store.ts');
    const subject = await useFocusStore.getState().createSubject({ name: '精确编辑', color: '#f97316', defaultBackgroundPolicy: 'continue' });
    const timeZone = 'Asia/Shanghai';
    const endedAt = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 23_000);
    const startedAt = new Date(endedAt.getTime() - 10 * 60_000);
    const timestamp = endedAt.toISOString();
    const format = (value: Date) => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      }).formatToParts(value).map((part) => [part.type, part.value]));
      return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
    };
    const id = crypto.randomUUID();
    await useFocusStore.getState().createManualSession({
      id, source: 'manual', subjectId: subject.id, startedAt: startedAt.toISOString(), endedAt: timestamp,
      activeSeconds: 91, interruptions: [], localDate: format(endedAt).slice(0, 10), timeZone,
      createdAt: timestamp, updatedAt: timestamp, mode: 'free',
    });
    return {
      id, timeZone, createdAt: timestamp,
      startedAt: format(startedAt), endedAt: format(endedAt),
      interruptionStart: format(new Date(startedAt.getTime() + 2 * 60_000)),
      interruptionEnd: format(new Date(startedAt.getTime() + 3 * 60_000)),
    };
  });

  await page.getByRole('button', { name: '查看复盘' }).click();

  await page.getByRole('button', { name: '修正', exact: true }).click();
  const form = page.locator('form.focus-create').filter({ has: page.getByLabel('有效时长（分钟）') });
  await expect(form.getByLabel('开始时间')).toHaveValue(seeded.startedAt);
  await expect(form.getByLabel('结束时间')).toHaveValue(seeded.endedAt);
  await expect(form.getByLabel('有效时长（分钟）')).toHaveValue('1.5167');
  await form.getByLabel('有效时长（分钟）').fill('2.05');
  await form.getByRole('button', { name: '添加打断记录' }).click();
  const interruptions = form.locator('fieldset');
  await interruptions.getByLabel('开始').fill(seeded.interruptionStart);
  await interruptions.getByLabel('结束').fill(seeded.interruptionEnd);
  await interruptions.getByLabel('来源').selectOption('background');
  await interruptions.getByLabel('原因').selectOption('urgent');
  await form.getByRole('button', { name: '保存修正' }).click();
  await expect(page.getByRole('status')).toContainText('人工修正');

  const updated = await page.evaluate(async (id) => {
    const { useFocusStore } = await import('/src/focus/store.ts');
    return useFocusStore.getState().focusSessions.find((session) => session.id === id);
  }, seeded.id);
  expect(updated).toMatchObject({
    id: seeded.id,
    source: 'manual',
    timeZone: seeded.timeZone,
    createdAt: seeded.createdAt,
    activeSeconds: 123,
    interruptions: [{ source: 'background', reason: 'urgent' }],
    correctedFields: ['activeSeconds', 'interruptions'],
  });
  expect(updated?.correctedAt).toEqual(expect.any(String));
});

test('interrupted running sessions automatically include the intervening time', async ({ page }) => {
  await page.evaluate(async () => {
    const { createActiveFocusSession } = await import('/src/focus/session.ts');
    const { createActiveFocusSessionAtomically, persistActiveFocusSession } = await import('/src/focus/persistence.ts');
    const now = Date.now();
    const active = createActiveFocusSession({
      sessionId: crypto.randomUUID(), workspaceId: 'local', subjectId: 'recovery-subject', timeZone: 'Asia/Shanghai', mode: 'free',
    }, new Date(now - 120_000));
    await createActiveFocusSessionAtomically(active);
    await persistActiveFocusSession({ ...active, lastTrustedAt: new Date(now - 60_000).toISOString() }, active);
  });
  await page.reload();
  await page.getByTitle('每日安排').click();
  await page.getByRole('button', { name: '快速开始专注' }).click();
  await page.getByRole('button', { name: '打开专注面板' }).click();

  await expect(page.getByText('进行中', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('等待恢复确认', { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    const { useActiveFocusStore } = await import('/src/focus/activeSession.ts');
    const active = useActiveFocusStore.getState().active;
    return active ? Math.floor((active.accumulatedActiveMs + Date.now() - Date.parse(active.runningSince ?? active.lastTrustedAt)) / 1000) : 0;
  })).toBeGreaterThanOrEqual(120);
});

test('concurrent tabs permit one active timer and reject a stale transition', async ({ page, context }) => {
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('tablist', { name: '主导航' })).toBeVisible({ timeout: 30_000 });
  const attempt = (candidate: typeof page, sessionId: string) => candidate.evaluate(async (id) => {
    const { createActiveFocusSession } = await import('/src/focus/session.ts');
    const { createActiveFocusSessionAtomically } = await import('/src/focus/persistence.ts');
    try {
      await createActiveFocusSessionAtomically(createActiveFocusSession({
        sessionId: id, workspaceId: 'local', subjectId: 'subject', timeZone: 'Asia/Shanghai', mode: 'free',
      }));
      return true;
    } catch {
      return false;
    }
  }, sessionId);
  const starts = await Promise.all([attempt(page, 'tab-one'), attempt(second, 'tab-two')]);
  expect(starts.filter(Boolean)).toHaveLength(1);

  const snapshot = await page.evaluate(async () => {
    const { loadActiveFocusSession } = await import('/src/focus/persistence.ts');
    return loadActiveFocusSession();
  });
  expect(snapshot).not.toBeNull();
  const transition = (candidate: typeof page, seconds: number) => candidate.evaluate(async ({ current, offset }) => {
    const { pauseActiveFocusSession } = await import('/src/focus/session.ts');
    const { persistActiveFocusSession } = await import('/src/focus/persistence.ts');
    if (!current) return { ok: false, error: 'missing active session' };
    try {
      const next = pauseActiveFocusSession(current, undefined, 'background', new Date(Date.parse(current.startedAt) + offset * 1_000));
      await persistActiveFocusSession(next, current);
      return { ok: true, error: '' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, { current: snapshot, offset: seconds });
  const transitions = await Promise.all([transition(page, 60), transition(second, 61)]);
  expect(transitions.filter((result) => result.ok), JSON.stringify(transitions)).toHaveLength(1);
});

test('a busy owner tab does not make another tab falsely recover a running session', async ({ page, context }) => {
  await page.getByRole('button', { name: '新建主题' }).click();
  await page.getByLabel('主题名称').fill('跨标签页租约');
  await page.getByRole('button', { name: '创建主题' }).click();
  await page.locator('summary[aria-label="跨标签页租约更多开始方式"]').click();
  await page.getByRole('button', { name: '自由计时', exact: true }).click();

  const blocked = page.evaluate(() => {
    const until = performance.now() + 500;
    while (performance.now() < until) { /* simulate a busy owner tab */ }
  });
  const second = await context.newPage();
  await second.goto('/');
  await blocked;
  await expect.poll(() => second.evaluate(async () => {
    const { useActiveFocusStore } = await import('/src/focus/activeSession.ts');
    return useActiveFocusStore.getState().active?.state;
  })).toBe('running');
});

test('repeated formalization remains idempotent and writes one saved session', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { useFocusStore } = await import('/src/focus/store.ts');
    const { createActiveFocusSession, finalizeActiveFocusSession } = await import('/src/focus/session.ts');
    const { createActiveFocusSessionAtomically, finalizeActiveFocusSessionAtomically } = await import('/src/focus/persistence.ts');
    const subject = await useFocusStore.getState().createSubject({ name: '幂等保存', color: '#2563eb', defaultBackgroundPolicy: 'continue' });
    const startedAt = new Date(Date.now() - 60_000);
    const active = createActiveFocusSession({
      sessionId: crypto.randomUUID(), workspaceId: 'local', subjectId: subject.id, timeZone: 'Asia/Shanghai', mode: 'free',
    }, startedAt);
    await createActiveFocusSessionAtomically(active);
    const session = finalizeActiveFocusSession(active, { endedAt: new Date(startedAt.getTime() + 60_000) });
    await finalizeActiveFocusSessionAtomically(session, 'local');
    const data = await finalizeActiveFocusSessionAtomically(session, 'local');
    return { id: session.id, count: data.focusSessions.filter((candidate) => candidate.id === session.id).length };
  });
  expect(result.count).toBe(1);
  await page.reload();
  await page.getByTitle('每日安排').click();
  await page.getByRole('button', { name: '打开专注复盘' }).click();
  await expect(page.getByText('幂等保存', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('等待恢复确认', { exact: true })).toHaveCount(0);
});
