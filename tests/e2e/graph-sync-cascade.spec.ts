import { expect, test } from '@playwright/test';

const rootNode = {
  id: 'sync-root',
  name: 'Root',
  parentId: null,
  createdAt: 1,
};

const childNode = {
  id: 'sync-child',
  name: 'Child',
  parentId: rootNode.id,
  createdAt: 2,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ nodes }) => {
    localStorage.clear();
    localStorage.setItem('line-graph-storage:mirror', JSON.stringify({ nodes }));
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify({
      tasks: [], groups: [], notes: [], milestones: [], lifeStages: [],
    }));
  }, { nodes: [rootNode, childNode] });
  await page.goto('/');
  await expect.poll(async () => page.evaluate(async () => {
    const { useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    return useGraphStore.getState().isHydrated && useGraphStore.getState().nodes.length;
  })).toBe(2);
});

test('remote graph hydration does not cascade, while explicit deletion still cleans references', async ({ page }) => {
  const result = await page.evaluate(async ({ root, child }) => {
      const {
        useGraphStore,
        useTimelineStore,
        useEbbStore,
        useDailyScheduleStore,
      } = await import('/src/testing/workspaceStoreAccess.ts');
    const {
      setWorkspaceQueueSuppressed,
    } = await import('/src/services/workspaceSyncQueueCore.ts');

    const calls = {
      timeline: [] as string[][],
      ebb: [] as string[][],
      daily: [] as string[][],
    };
    useTimelineStore.setState({
      removeGraphNodeReferences: (ids: string[]) => calls.timeline.push([...ids]),
    });
    useEbbStore.setState({
      removeGraphNodeReferences: (ids: string[]) => calls.ebb.push([...ids]),
    });
    useDailyScheduleStore.setState({
      removeRetrospectiveNodeReferences: (ids: string[]) => calls.daily.push([...ids]),
    });

    const current = useGraphStore.getState();
    useGraphStore.setState({
      liveblocks: { ...current.liveblocks, isStorageLoading: true },
    });
    setWorkspaceQueueSuppressed(true);
    try {
      // This is how Liveblocks hydration reaches the outer Zustand store. A
      // smaller remote snapshot must not be interpreted as a user deletion.
      useGraphStore.setState({ nodes: [root] });
    } finally {
      setWorkspaceQueueSuppressed(false);
    }
    const afterHydration = {
      timeline: calls.timeline.length,
      ebb: calls.ebb.length,
      daily: calls.daily.length,
    };

    useGraphStore.setState({
      nodes: [root, child],
      liveblocks: { ...useGraphStore.getState().liveblocks, isStorageLoading: false },
    });
    useGraphStore.getState().deleteNode(root.id);

    return {
      afterHydration,
      calls,
      remainingNodeIds: useGraphStore.getState().nodes.map((node) => node.id),
    };
  }, { root: rootNode, child: childNode });

  expect(result.afterHydration).toEqual({ timeline: 0, ebb: 0, daily: 0 });
  expect(result.calls.timeline).toEqual([[rootNode.id, childNode.id]]);
  expect(result.calls.ebb).toEqual([[rootNode.id, childNode.id]]);
  expect(result.calls.daily).toEqual([[rootNode.id, childNode.id]]);
  expect(result.remainingNodeIds).toEqual([]);
});
