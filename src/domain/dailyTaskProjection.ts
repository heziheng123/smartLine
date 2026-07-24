import type { ReviewTask } from '@/ebb/types';
import type { AggregatedTodo, SmartTaskHeader } from '@/types';
import { isTaskAvailableOnDate } from '@/domain/taskRules';
import { getQuantityDailyStatus, isQuantityTask } from '@/utils/blocks';

export interface DailyProjection<T> {
  pending: T[];
  completed: T[];
}

/**
 * Rebuild the minimum task header needed by the shared date and quantity rules.
 * Daily views consume AggregatedTodo objects, while the canonical rules consume
 * SmartTaskHeader objects. Keeping this adapter here prevents each view from
 * quietly inventing a different interpretation of the same task.
 */
export function getProjectedTaskHeader(todo: AggregatedTodo): Partial<SmartTaskHeader> {
  return {
    taskKind: todo._taskKind,
    date: todo.scheduled,
    deadline: todo.due,
    isCompleted: todo.checked,
    vocabularyTotalWords: todo._vocabularyTotalWords,
    vocabularyInitialCompletedWords: todo._vocabularyInitialCompletedWords,
    vocabularyRecords: todo._vocabularyRecords,
    quantityUnit: todo._quantityUnit,
    quantityTotal: todo._quantityTotal,
    quantityInitialCompleted: todo._quantityInitialCompleted,
    quantityRecords: todo._quantityRecords,
  };
}

/** Canonical project-task projection shared by slot mode and time-block mode. */
export function projectTasksForDate(
  todos: AggregatedTodo[],
  date: string,
): DailyProjection<AggregatedTodo> {
  const pending: AggregatedTodo[] = [];
  const completed: AggregatedTodo[] = [];

  for (const todo of todos) {
    const header = getProjectedTaskHeader(todo);
    if (isQuantityTask(header)) {
      const status = getQuantityDailyStatus(header, date);
      if (status.state === 'achieved' || status.state === 'recorded') {
        completed.push(todo);
      } else if (!todo.checked && isTaskAvailableOnDate(header, date)) {
        pending.push(todo);
      }
      continue;
    }

    if (todo.checked) {
      if (todo.scheduled === date || todo.due === date) completed.push(todo);
    } else if (isTaskAvailableOnDate(header, date)) {
      pending.push(todo);
    }
  }

  return { pending, completed };
}

/** Canonical EBB projection shared by every daily planning presentation. */
export function reviewTasksForDate(
  tasks: ReviewTask[],
  date: string,
  today: string,
): DailyProjection<ReviewTask> {
  const pending: ReviewTask[] = [];
  const completed: ReviewTask[] = [];

  for (const task of tasks) {
    if (task.isCompleted) {
      if ((task.completedDate ?? task.dueDate) === date) completed.push(task);
      continue;
    }
    if (task.dueDate === date || (date === today && task.dueDate < today)) {
      pending.push(task);
    }
  }

  return { pending, completed };
}
