import { randomUUID } from "node:crypto";
import { TaskModel } from "../models/taskModel.js";

const priorities = new Set(["high", "medium", "low"]);
const statuses = new Set(["pending", "completed", "failed"]);

function normalizeTiming(timing) {
  if (timing == null) return null;
  if (!["deadline", "duration"].includes(timing.mode)) {
    throw new Error("计时模式无效");
  }
  if (timing.mode === "deadline" && !timing.configuredDeadline) {
    throw new Error("指定时间任务必须包含截止时间");
  }
  const durationMinutes = timing.durationMinutes == null
    ? null
    : Number(timing.durationMinutes);
  if (
    timing.mode === "duration" &&
    (!Number.isInteger(durationMinutes) || durationMinutes < 1)
  ) {
    throw new Error("预计用时必须是大于 0 的整数");
  }

  return {
    mode: timing.mode,
    configuredDeadline: timing.configuredDeadline ?? null,
    durationMinutes,
    startedAt: timing.startedAt == null ? null : Number(timing.startedAt),
    endAt: timing.endAt == null ? null : Number(timing.endAt),
    reminderShown: Boolean(timing.reminderShown),
  };
}

function normalizeTask(input, { requireId = false } = {}) {
  const text = String(input?.text ?? "").trim();
  const id = input?.id || randomUUID();

  if ((requireId && !input?.id) || !text || text.length > 200) {
    throw new Error("任务内容不能为空且不能超过 200 个字符");
  }
  if (!priorities.has(input?.priority ?? "medium")) {
    throw new Error("任务优先级无效");
  }
  if (!statuses.has(input?.status ?? "pending")) {
    throw new Error("任务状态无效");
  }

  return {
    id: String(id),
    text,
    priority: input?.priority ?? "medium",
    status: input?.status ?? "pending",
    timing: normalizeTiming(input?.timing),
    createdAt: Number(input?.createdAt) || Date.now(),
  };
}

function handleValidationError(response, error) {
  response.status(400).json({ message: error.message });
}

export const TaskController = {
  list(request, response) {
    const tasks = TaskModel.findAll({
      status: request.query.status,
      query: request.query.q,
      createdDate: request.query.createdDate,
    });
    response.json(tasks);
  },

  create(request, response) {
    try {
      response.status(201).json(TaskModel.create(normalizeTask(request.body)));
    } catch (error) {
      handleValidationError(response, error);
    }
  },

  update(request, response) {
    try {
      const existing = TaskModel.findById(request.params.id);
      if (!existing) return response.status(404).json({ message: "任务不存在" });
      const task = TaskModel.update(
        request.params.id,
        normalizeTask({ ...existing, ...request.body, id: request.params.id }),
      );
      response.json(task);
    } catch (error) {
      handleValidationError(response, error);
    }
  },

  remove(request, response) {
    if (!TaskModel.remove(request.params.id)) {
      return response.status(404).json({ message: "任务不存在" });
    }
    response.status(204).end();
  },

  replaceAll(request, response) {
    try {
      if (!Array.isArray(request.body?.tasks) || request.body.tasks.length > 10000) {
        throw new Error("任务列表格式无效或数量超过限制");
      }
      const tasks = request.body.tasks.map((task) =>
        normalizeTask(task, { requireId: true }),
      );
      response.json(TaskModel.replaceAll(tasks));
    } catch (error) {
      handleValidationError(response, error);
    }
  },

  importMany(request, response) {
    try {
      if (!Array.isArray(request.body?.tasks) || request.body.tasks.length > 1000) {
        throw new Error("导入内容格式无效或一次超过 1000 项");
      }
      const tasks = request.body.tasks.map(normalizeTask);
      TaskModel.importMany(tasks);
      response.status(201).json({ imported: tasks.length });
    } catch (error) {
      handleValidationError(response, error);
    }
  },

  reorder(request, response) {
    if (!Array.isArray(request.body?.ids)) {
      return response.status(400).json({ message: "排序数据格式无效" });
    }
    TaskModel.reorder(request.body.ids.map(String));
    response.status(204).end();
  },

  clearCompleted(_request, response) {
    response.json({ deleted: TaskModel.clear("completed") });
  },

  clearAll(_request, response) {
    response.json({ deleted: TaskModel.clear() });
  },
};