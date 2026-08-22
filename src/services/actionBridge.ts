export type WeekMatrixContext = {
  cursor: string;
  mode: 'week' | 'month';
  groupMode: 'tag' | 'project';
};

const DAILY_TARGET_DATE_KEY = 'smart-line-daily-target-date';
const WEEK_RETURN_CONTEXT_KEY = 'smart-line-week-return-context';
const WEEK_RESTORE_CONTEXT_KEY = 'smart-line-week-restore-context';
const GRAPH_FOCUS_NODE_KEY = 'smart-line-graph-focus-node';
const EBB_FOCUS_REVIEW_KEY = 'smart-line-ebb-focus-review';

type View = 'timeline' | 'ebb' | 'daily-schedule' | 'week-matrix' | 'knowledge-graph';

function navigate(view: View, detail: Record<string, unknown> = {}) {
  window.dispatchEvent(new CustomEvent('tl-navigate', { detail: { view, ...detail } }));
}

function takeJson<T>(key: string): T | null {
  try {
    const value = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

function storeJson(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* optional bridge state */ }
}

export function openDailyFromWeek(date: string, context: WeekMatrixContext) {
  try { sessionStorage.setItem(DAILY_TARGET_DATE_KEY, date); } catch { /* target date is optional */ }
  storeJson(WEEK_RETURN_CONTEXT_KEY, context);
  navigate('daily-schedule', { date, weekContext: context });
}

export function takeDailyWeekReturnContext() {
  return takeJson<WeekMatrixContext>(WEEK_RETURN_CONTEXT_KEY);
}

export function returnToWeek(context: WeekMatrixContext) {
  storeJson(WEEK_RESTORE_CONTEXT_KEY, context);
  navigate('week-matrix', { weekContext: context });
}

export function takeWeekRestoreContext() {
  return takeJson<WeekMatrixContext>(WEEK_RESTORE_CONTEXT_KEY);
}

export function openParentProject(taskId: string) {
  navigate('timeline', { taskId });
}

export function openProjectDocument(taskId: string, blockId: string) {
  navigate('timeline', { taskId, blockId });
}

export function openWeekPosition(date: string) {
  const context = { cursor: date, mode: 'week', groupMode: 'tag' } satisfies WeekMatrixContext;
  storeJson(WEEK_RESTORE_CONTEXT_KEY, context);
  navigate('week-matrix', { weekContext: context });
}

export function openKnowledgeNode(nodeId: string) {
  try { sessionStorage.setItem(GRAPH_FOCUS_NODE_KEY, nodeId); } catch { /* focus is optional */ }
  navigate('knowledge-graph');
}

export function takeKnowledgeNodeFocus() {
  try {
    const nodeId = sessionStorage.getItem(GRAPH_FOCUS_NODE_KEY);
    sessionStorage.removeItem(GRAPH_FOCUS_NODE_KEY);
    return nodeId;
  } catch {
    return null;
  }
}

export function openReviewPlan(reviewTaskId: string) {
  try { sessionStorage.setItem(EBB_FOCUS_REVIEW_KEY, reviewTaskId); } catch { /* focus is optional */ }
  navigate('ebb');
}

export function takeReviewPlanFocus() {
  try {
    const taskId = sessionStorage.getItem(EBB_FOCUS_REVIEW_KEY);
    sessionStorage.removeItem(EBB_FOCUS_REVIEW_KEY);
    return taskId;
  } catch {
    return null;
  }
}
