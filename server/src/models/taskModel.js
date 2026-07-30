import { database } from "../config/database.js";

const selectColumns = `
  id, text, status, priority, timing_mode, configured_deadline,
  duration_minutes, started_at, end_at, reminder_shown,
  created_at, updated_at, sort_order
`;

function rowToTask(row) {
  if (!row) return null;

  const hasTiming = row.timing_mode === "deadline" || row.timing_mode === "duration";

  return {
    id: row.id,
    text: row.text,
    status: row.status,
    priority: row.priority,
    timing: hasTiming
      ? {
          mode: row.timing_mode,
          configuredDeadline: row.configured_deadline,
          durationMinutes: row.duration_minutes,
          startedAt: row.started_at,
          endAt: row.end_at,
          reminderShown: Boolean(row.reminder_shown),
        }
      : null,
    createdAt: row.created_at,
  };
}

function taskToParams(task, sortOrder = 0) {
  const now = Date.now();
  const timing = task.timing ?? null;

  return {
    id: task.id,
    text: task.text.trim(),
    status: task.status ?? "pending",
    priority: task.priority ?? "medium",
    timingMode: timing?.mode ?? null,
    configuredDeadline: timing?.configuredDeadline ?? null,
    durationMinutes: timing?.durationMinutes ?? null,
    startedAt: timing?.startedAt ?? null,
    endAt: timing?.endAt ?? null,
    reminderShown: timing?.reminderShown ? 1 : 0,
    createdAt: Number(task.createdAt) || now,
    updatedAt: now,
    sortOrder,
  };
}

const insertStatement = database.prepare(`
  INSERT INTO tasks (
    id, text, status, priority, timing_mode, configured_deadline,
    duration_minutes, started_at, end_at, reminder_shown,
    created_at, updated_at, sort_order
  ) VALUES (
    @id, @text, @status, @priority, @timingMode, @configuredDeadline,
    @durationMinutes, @startedAt, @endAt, @reminderShown,
    @createdAt, @updatedAt, @sortOrder
  )
`);

const replaceTransaction = database.transaction((tasks) => {
  database.prepare("DELETE FROM tasks").run();
  tasks.forEach((task, index) => insertStatement.run(taskToParams(task, index)));
});

const importTransaction = database.transaction((tasks) => {
  const currentMaximum = database
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS value FROM tasks")
    .get().value;
  tasks.forEach((task, index) =>
    insertStatement.run(taskToParams(task, currentMaximum + index + 1)),
  );
});

export const TaskModel = {
  findAll({ status, query, createdDate } = {}) {
    this.expireOverdue();
    const conditions = [];
    const parameters = {};

    if (["pending", "completed", "failed"].includes(status)) {
      conditions.push("status = @status");
      parameters.status = status;
    }
    if (query) {
      conditions.push("LOWER(text) LIKE @query");
      parameters.query = `%${query.toLowerCase()}%`;
    }
    if (createdDate) {
      const start = new Date(`${createdDate}T00:00:00`).getTime();
      const end = new Date(`${createdDate}T23:59:59.999`).getTime();
      if (Number.isFinite(start) && Number.isFinite(end)) {
        conditions.push("created_at BETWEEN @createdFrom AND @createdTo");
        parameters.createdFrom = start;
        parameters.createdTo = end;
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return database
      .prepare(`SELECT ${selectColumns} FROM tasks ${where} ORDER BY sort_order, created_at DESC`)
      .all(parameters)
      .map(rowToTask);
  },

  findById(id) {
    return rowToTask(
      database.prepare(`SELECT ${selectColumns} FROM tasks WHERE id = ?`).get(id),
    );
  },

  create(task) {
    const nextOrder = database
      .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM tasks")
      .get().value;
    insertStatement.run(taskToParams(task, nextOrder));
    return this.findById(task.id);
  },

  update(id, task) {
    const existing = this.findById(id);
    if (!existing) return null;

    const merged = { ...existing, ...task, id };
    const params = taskToParams(merged);
    database.prepare(`
      UPDATE tasks SET
        text = @text,
        status = @status,
        priority = @priority,
        timing_mode = @timingMode,
        configured_deadline = @configuredDeadline,
        duration_minutes = @durationMinutes,
        started_at = @startedAt,
        end_at = @endAt,
        reminder_shown = @reminderShown,
        created_at = @createdAt,
        updated_at = @updatedAt
      WHERE id = @id
    `).run(params);
    return this.findById(id);
  },

  remove(id) {
    return database.prepare("DELETE FROM tasks WHERE id = ?").run(id).changes > 0;
  },

  clear(status) {
    const result = status
      ? database.prepare("DELETE FROM tasks WHERE status = ?").run(status)
      : database.prepare("DELETE FROM tasks").run();
    return result.changes;
  },

  replaceAll(tasks) {
    replaceTransaction(tasks);
    return this.findAll();
  },

  importMany(tasks) {
    importTransaction(tasks);
    return tasks.length;
  },

  reorder(ids) {
    const update = database.prepare("UPDATE tasks SET sort_order = ? WHERE id = ?");
    database.transaction((taskIds) => {
      taskIds.forEach((id, index) => update.run(index, id));
    })(ids);
  },

  expireOverdue() {
    return database.prepare(`
      UPDATE tasks
      SET status = 'failed', updated_at = @now
      WHERE status = 'pending' AND end_at IS NOT NULL AND end_at <= @now
    `).run({ now: Date.now() }).changes;
  },
};