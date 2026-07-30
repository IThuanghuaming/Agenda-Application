import { TaskModel } from "../models/taskModel.js";
import { elements, TaskView } from "../views/taskView.js";
const REMINDER_THRESHOLD_MS = 10 * 60 * 1000;

const {
  taskForm, taskInput, taskList, emptyState, emptyTitle, emptyDescription,
  pendingCount, completedCount, failedCount, totalLabel, filterBar,
  filterButtons, taskSearch, dateFilter, resetListFiltersButton,
  clearCompletedButton, clearAllButton, importFileInput, importButton,
  importStatus, reminderDialog, reminderMessage, timeFeedbackDialog,
  timeFeedbackMessage,
} = elements;
const priorityLabels = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};

const statusLabels = {
  pending: "待完成",
  completed: "已完成",
  failed: "未完成",
};

let tasks = [];
let activeFilter = "all";
let draggedTaskId = null;
const reminderQueue = [];
let saveQueue = Promise.resolve();

function normalizeTiming(timing) {
  if (!timing || !["deadline", "duration"].includes(timing.mode)) {
    return null;
  }

  const normalized = {
    mode: timing.mode,
    configuredDeadline:
      typeof timing.configuredDeadline === "string"
        ? timing.configuredDeadline
        : null,
    durationMinutes: Number.isFinite(Number(timing.durationMinutes))
      ? Number(timing.durationMinutes)
      : null,
    startedAt: Number.isFinite(Number(timing.startedAt))
      ? Number(timing.startedAt)
      : null,
    endAt: Number.isFinite(Number(timing.endAt)) ? Number(timing.endAt) : null,
    reminderShown: Boolean(timing.reminderShown),
  };

  if (
    (normalized.mode === "deadline" && !normalized.configuredDeadline) ||
    (normalized.mode === "duration" && !normalized.durationMinutes)
  ) {
    return null;
  }

  return normalized;
}

function saveTasks() {
  const snapshot = structuredClone(tasks);

  saveQueue = saveQueue
    .then(() => TaskModel.replaceAll(snapshot))
    .catch((error) => {
      showImportStatus(`保存失败：${error.message}`, true);
    });

  return saveQueue;
}
function createTaskId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizePriority(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/优先级/g, "");

  if (["高", "high", "h"].includes(normalized)) {
    return "high";
  }

  if (["低", "low", "l"].includes(normalized)) {
    return "low";
  }

  return "medium";
}

function parseTxt(content) {
  const items = [];

  content.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      return;
    }

    const priorityPatterns = [
      /^(.*?)[\s,，|｜]+(高|中|低)(?:优先级)?\s*$/,
      /^(.*?)\s*[（(【[]\s*(高|中|低)(?:优先级)?\s*[）)】\]]\s*$/,
    ];
    let text = line;
    let priority = "medium";

    for (const pattern of priorityPatterns) {
      const match = line.match(pattern);

      if (match && match[1].trim()) {
        text = match[1].trim();
        priority = normalizePriority(match[2]);
        break;
      }
    }

    items.push({ text, priority });
  });

  return { items, skipped: 0 };
}

function parseCsvRows(content) {
  const rows = [];
  let row = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character === '"') {
      if (insideQuotes && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (character === "," && !insideQuotes) {
      row.push(field);
      field = "";
    } else if (character === "\n" && !insideQuotes) {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r" || insideQuotes) {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function parseCsv(content) {
  const rows = parseCsvRows(content).filter((row) =>
    row.some((value) => value.trim()),
  );

  if (!rows.length) {
    return { items: [], skipped: 0 };
  }

  rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const textHeaders = ["任务", "任务内容", "待办", "待办事项", "text", "task", "content"];
  const priorityHeaders = ["优先级", "priority"];
  const detectedTextIndex = headers.findIndex((header) =>
    textHeaders.includes(header),
  );
  const hasHeader = detectedTextIndex >= 0;
  const textIndex = hasHeader ? detectedTextIndex : 0;
  const priorityIndex = hasHeader
    ? headers.findIndex((header) => priorityHeaders.includes(header))
    : 1;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const items = [];
  let skipped = 0;

  dataRows.forEach((row) => {
    const text = (row[textIndex] ?? "").trim();

    if (!text) {
      skipped += 1;
      return;
    }

    items.push({
      text,
      priority: normalizePriority(
        priorityIndex >= 0 ? row[priorityIndex] : "",
      ),
    });
  });

  return { items, skipped };
}

function parseJson(content) {
  const parsed = JSON.parse(content.replace(/^\uFEFF/, ""));

  if (!Array.isArray(parsed)) {
    throw new Error("JSON 顶层内容必须是数组");
  }

  const items = [];
  let skipped = 0;

  parsed.forEach((entry) => {
    if (typeof entry === "string" && entry.trim()) {
      items.push({ text: entry.trim(), priority: "medium" });
      return;
    }

    if (!entry || typeof entry !== "object") {
      skipped += 1;
      return;
    }

    const text = String(
      entry.text ?? entry.task ?? entry.content ?? entry["任务"] ?? entry["任务内容"] ?? "",
    ).trim();

    if (!text) {
      skipped += 1;
      return;
    }

    items.push({ text, priority: normalizePriority(entry.priority ?? entry["优先级"]) });
  });

  return { items, skipped };
}

function showImportStatus(message, isError = false) {
  importStatus.textContent = message;
  importStatus.classList.toggle("is-error", isError);
  importStatus.hidden = false;
}

async function importTasksFromFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const content = await file.text();
  let result;

  if (extension === "txt") {
    result = parseTxt(content);
  } else if (extension === "csv") {
    result = parseCsv(content);
  } else if (extension === "json") {
    result = parseJson(content);
  } else {
    throw new Error("请选择 TXT、CSV 或 JSON 文件");
  }

  if (!result.items.length) {
    throw new Error("文件中没有可导入的任务");
  }

  const importedTasks = result.items.map((item) => ({
    id: createTaskId(),
    text: item.text,
    status: "pending",
    priority: item.priority,
    timing: null,
    createdAt: Date.now(),
  }));

  tasks = [...importedTasks, ...tasks];
  saveTasks();
  renderTasks();

  const skippedText = result.skipped
    ? `，跳过 ${result.skipped} 条无效记录`
    : "";
  showImportStatus(`已从 ${file.name} 导入 ${importedTasks.length} 项任务${skippedText}`);
}

function getLocalDateKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCreationDate(timestamp) {
  const date = new Date(timestamp);
  const options = {
    month: "numeric",
    day: "numeric",
  };

  if (date.getFullYear() !== new Date().getFullYear()) {
    options.year = "numeric";
  }

  return new Intl.DateTimeFormat("zh-CN", options).format(date);
}

function hasListFilters() {
  return (
    activeFilter !== "all" ||
    Boolean(taskSearch.value.trim()) ||
    Boolean(dateFilter.value)
  );
}

function getVisibleTasks() {
  const query = taskSearch.value.trim().toLocaleLowerCase();
  const selectedDate = dateFilter.value;

  return tasks.filter((task) => {
    const matchesStatus =
      activeFilter === "all" || task.status === activeFilter;
    const matchesQuery =
      !query || task.text.toLocaleLowerCase().includes(query);
    const matchesDate =
      !selectedDate || getLocalDateKey(task.createdAt) === selectedDate;

    return matchesStatus && matchesQuery && matchesDate;
  });
}
function formatDateTime(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function setTaskTimingContent(task, timingElement, startButton) {
  if (!task.timing) {
    timingElement.hidden = true;
    startButton.hidden = true;
    return;
  }

  timingElement.hidden = false;
  timingElement.classList.toggle(
    "is-counting",
    task.status === "pending" && Boolean(task.timing.endAt),
  );

  if (task.status === "failed") {
    timingElement.textContent = "计时已结束";
    startButton.hidden = true;
  } else if (task.status === "completed") {
    timingElement.textContent = "任务已完成";
    startButton.hidden = true;
  } else if (task.timing.endAt) {
    timingElement.textContent = `剩余 ${formatCountdown(task.timing.endAt - Date.now())}`;
    startButton.hidden = true;
  } else if (task.timing.mode === "deadline") {
    timingElement.textContent = `截止 ${formatDateTime(task.timing.configuredDeadline)}`;
    startButton.hidden = false;
  } else {
    timingElement.textContent = `预计 ${task.timing.durationMinutes} 分钟`;
    startButton.hidden = false;
  }
}

function renderTasks() {
  const visibleTasks = getVisibleTasks();
  TaskView.renderTaskItems({
    visibleTasks,
    priorityLabels,
    statusLabels,
    formatCreationDate,
    setTaskTimingContent,
  });
  updateSummary(visibleTasks.length);
}
function updateSummary(visibleCount) {
  const completed = tasks.filter((task) => task.status === "completed").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const pending = tasks.length - completed - failed;

  pendingCount.textContent = pending;
  completedCount.textContent = completed;
  failedCount.textContent = failed;
  totalLabel.textContent = hasListFilters()
    ? `显示 ${visibleCount} / ${tasks.length} 项`
    : `共 ${tasks.length} 项`;
  clearCompletedButton.hidden = completed === 0;
  clearAllButton.hidden = tasks.length === 0;
  resetListFiltersButton.hidden = !hasListFilters();
  emptyState.hidden = visibleCount > 0;

  if (tasks.length === 0) {
    emptyTitle.textContent = "今天还没有任务";
    emptyDescription.textContent = "写下今天要做的第一件事吧 ✨";
  } else {
    emptyTitle.textContent = "没有找到匹配的任务";
    emptyDescription.textContent =
      taskSearch.value.trim() || dateFilter.value
        ? "请尝试调整关键词、日期或状态筛选。"
        : activeFilter === "pending"
          ? "当前没有待完成任务。"
          : activeFilter === "completed"
            ? "还没有已完成的任务，继续加油！"
            : "没有超时未完成的任务。";
  }
}


function syncTaskTimeFields(form) {
  const mode = form.querySelector(
    'input[name="task-timing-mode"]:checked',
  ).value;
  const deadlineField = form.querySelector(".task-deadline-field");
  const durationField = form.querySelector(".task-duration-field");
  const deadlineInput = form.querySelector(".task-deadline-input");
  const durationInput = form.querySelector(".task-duration-input");

  deadlineField.hidden = mode !== "deadline";
  durationField.hidden = mode !== "duration";

}

function configureTimeSettingsForm(taskElement, task) {
  const form = taskElement.querySelector(".time-settings-form");
  const mode = task.timing?.mode ?? "deadline";
  const deadlineInput = form.querySelector(".task-deadline-input");
  const durationInput = form.querySelector(".task-duration-input");

  form.querySelector(
    `input[name="task-timing-mode"][value="${mode}"]`,
  ).checked = true;
  deadlineInput.value = task.timing?.configuredDeadline ?? "";
  durationInput.value = task.timing?.durationMinutes ?? "";
  form.querySelector(".remove-time-button").hidden = !task.timing;
  syncTaskTimeFields(form);
  return form;
}

function closeInlineForms() {
  taskList
    .querySelectorAll(".task-item.is-editing, .task-item.is-setting-time")
    .forEach((item) => {
      item.classList.remove("is-editing", "is-setting-time");
      item.querySelector(".edit-form").hidden = true;
      item.querySelector(".time-settings-form").hidden = true;
      item.draggable = true;
    });
}
function showTimeFeedback(message, focusTarget) {
  timeFeedbackMessage.textContent = message;

  if (!timeFeedbackDialog.open) {
    timeFeedbackDialog.showModal();
  }

  if (focusTarget) {
    timeFeedbackDialog.addEventListener(
      "close",
      () => focusTarget.focus(),
      { once: true },
    );
  }
}
function startTask(task) {
  if (!task.timing || task.status !== "pending" || task.timing.endAt) {
    return;
  }

  const now = Date.now();
  const endAt =
    task.timing.mode === "deadline"
      ? new Date(task.timing.configuredDeadline).getTime()
      : now + task.timing.durationMinutes * 60 * 1000;

  if (endAt <= now) {
    showTimeFeedback("该任务的截止时间已经过去，请重新设置时间。");
    return;
  }

  task.timing.startedAt = now;
  task.timing.endAt = endAt;
  task.timing.reminderShown = false;
  saveTasks();
  renderTasks();
  processTimers();
}

function showNextReminder() {
  if (!reminderQueue.length || reminderDialog.open) {
    return;
  }

  const task = reminderQueue.shift();
  reminderMessage.textContent = `“${task.text}”仅剩 10 分钟，请及时处理。`;

  if (typeof reminderDialog.showModal === "function") {
    reminderDialog.showModal();
  } else {
    window.alert(reminderMessage.textContent);
    showNextReminder();
  }
}

function queueReminder(task) {
  reminderQueue.push({ id: task.id, text: task.text });
  showNextReminder();
}

function updateCountdownDisplays(now = Date.now()) {
  taskList.querySelectorAll(".task-item").forEach((taskElement) => {
    const task = tasks.find((item) => item.id === taskElement.dataset.taskId);

    if (task?.status === "pending" && task.timing?.endAt) {
      const creationDate = taskElement.querySelector(".creation-date");
    const timingElement = taskElement.querySelector(".task-timing");
      timingElement.textContent = `剩余 ${formatCountdown(task.timing.endAt - now)}`;
    }
  });
}

function processTimers() {
  const now = Date.now();
  let shouldSave = false;
  let shouldRender = false;

  tasks.forEach((task) => {
    if (task.status !== "pending" || !task.timing?.endAt) {
      return;
    }

    const remaining = task.timing.endAt - now;

    if (remaining <= 0) {
      task.status = "failed";
      shouldSave = true;
      shouldRender = true;
    } else if (
      remaining <= REMINDER_THRESHOLD_MS &&
      !task.timing.reminderShown
    ) {
      task.timing.reminderShown = true;
      shouldSave = true;
      queueReminder(task);
    }
  });

  if (shouldSave) {
    saveTasks();
  }

  if (shouldRender) {
    renderTasks();
  } else {
    updateCountdownDisplays(now);
  }
}

function persistTaskOrder() {
  const visibleIds = Array.from(taskList.querySelectorAll(".task-item")).map(
    (item) => item.dataset.taskId,
  );
  const visibleIdSet = new Set(visibleIds);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  let visibleIndex = 0;

  tasks = tasks.map((task) =>
    visibleIdSet.has(task.id)
      ? taskById.get(visibleIds[visibleIndex++])
      : task,
  );
  saveTasks();
  renderTasks();
}

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = taskInput.value.trim();
  const selectedPriority = taskForm.querySelector(
    'input[name="priority"]:checked',
  );

  if (!text || !selectedPriority) {
    if (!text) {
      taskInput.focus();
    }
    return;
  }

  tasks.unshift({
    id: createTaskId(),
    text,
    status: "pending",
    priority: selectedPriority.value,
    timing: null,
    createdAt: Date.now(),
  });

  saveTasks();
  renderTasks();
  taskForm.reset();
  taskInput.focus();
});

taskInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    taskForm.requestSubmit();
  }
});


importButton.addEventListener("click", () => {
  importFileInput.click();
});

importFileInput.addEventListener("change", async () => {
  const [file] = importFileInput.files;

  if (!file) {
    return;
  }

  importButton.disabled = true;
  importStatus.hidden = true;

  try {
    await importTasksFromFile(file);
  } catch (error) {
    showImportStatus(`导入失败：${error.message}`, true);
  } finally {
    importButton.disabled = false;
    importFileInput.value = "";
  }
});

taskSearch.addEventListener("input", renderTasks);
dateFilter.addEventListener("change", renderTasks);

resetListFiltersButton.addEventListener("click", () => {
  taskSearch.value = "";
  dateFilter.value = "";
  activeFilter = "all";
  filterButtons.forEach((button) => {
    const isActive = button.dataset.filter === "all";
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  renderTasks();
});
filterBar.addEventListener("click", (event) => {
  const filterButton = event.target.closest(".filter-button");

  if (!filterButton) {
    return;
  }

  activeFilter = filterButton.dataset.filter;
  filterButtons.forEach((button) => {
    const isActive = button === filterButton;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  renderTasks();
});

clearCompletedButton.addEventListener("click", () => {
  tasks = tasks.filter((task) => task.status !== "completed");
  saveTasks();
  renderTasks();
});

clearAllButton.addEventListener("click", () => {
  const confirmed = window.confirm(
    "确定要清空全部任务吗？此操作无法撤销。",
  );

  if (!confirmed) {
    return;
  }

  tasks = [];
  saveTasks();
  renderTasks();
});

taskList.addEventListener("change", (event) => {
  if (!event.target.matches(".task-checkbox")) {
    return;
  }

  const taskElement = event.target.closest(".task-item");
  const task = tasks.find((item) => item.id === taskElement.dataset.taskId);

  if (!task) {
    return;
  }

  if (event.target.checked) {
    task.status = "completed";
  } else {
    task.status =
      task.timing?.endAt && task.timing.endAt <= Date.now()
        ? "failed"
        : "pending";
  }
  saveTasks();
  renderTasks();
});

taskList.addEventListener("submit", (event) => {
  const timeForm = event.target.closest(".time-settings-form");

  if (timeForm) {
    event.preventDefault();
    const taskElement = timeForm.closest(".task-item");
    const task = tasks.find((item) => item.id === taskElement.dataset.taskId);
    const mode = timeForm.querySelector(
      'input[name="task-timing-mode"]:checked',
    ).value;
    const deadlineInput = timeForm.querySelector(".task-deadline-input");
    const durationInput = timeForm.querySelector(".task-duration-input");

    if (mode === "deadline") {
      const deadline = new Date(deadlineInput.value).getTime();

      if (!deadlineInput.value || deadline <= Date.now()) {
        showTimeFeedback("所选时间已经过去，请选择一个未来的截止时间。", deadlineInput);
        return;
      }

      task.timing = {
        mode,
        configuredDeadline: deadlineInput.value,
        durationMinutes: null,
        startedAt: null,
        endAt: null,
        reminderShown: false,
      };
    } else {
      const durationMinutes = Number.parseInt(durationInput.value, 10);

      if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
        showTimeFeedback("预计用时不能少于 1 分钟，请重新填写。", durationInput);
        return;
      }

      task.timing = {
        mode,
        configuredDeadline: null,
        durationMinutes,
        startedAt: null,
        endAt: null,
        reminderShown: false,
      };
    }

    saveTasks();
    renderTasks();
    return;
  }

  const editForm = event.target.closest(".edit-form");

  if (!editForm) {
    return;
  }

  event.preventDefault();
  const taskElement = editForm.closest(".task-item");
  const task = tasks.find((item) => item.id === taskElement.dataset.taskId);
  const editInput = editForm.querySelector(".edit-input");
  const selectedPriority = editForm.querySelector(
    'input[name="edit-priority"]:checked',
  );
  const updatedText = editInput.value.trim();

  if (!task || !updatedText || !selectedPriority) {
    editInput.focus();
    return;
  }

  task.text = updatedText;
  task.priority = selectedPriority.value;
  saveTasks();
  renderTasks();
});
taskList.addEventListener("click", (event) => {
  const taskElement = event.target.closest(".task-item");

  if (!taskElement) {
    return;
  }

  const task = tasks.find((item) => item.id === taskElement.dataset.taskId);

  if (event.target.matches('input[name="task-timing-mode"]')) {
    syncTaskTimeFields(taskElement.querySelector(".time-settings-form"));
    return;
  }

  if (event.target.closest(".timing-button")) {
    closeInlineForms();
    const timeForm = configureTimeSettingsForm(taskElement, task);
    taskElement.classList.add("is-setting-time");
    taskElement.draggable = false;
    timeForm.hidden = false;
    const activeInput = timeForm.querySelector(
      task.timing?.mode === "duration"
        ? ".task-duration-input"
        : ".task-deadline-input",
    );
    activeInput.focus();
    return;
  }

  if (event.target.closest(".cancel-time-button")) {
    taskElement.classList.remove("is-setting-time");
    taskElement.draggable = true;
    taskElement.querySelector(".time-settings-form").hidden = true;
    return;
  }

  if (event.target.closest(".remove-time-button")) {
    task.timing = null;
    saveTasks();
    renderTasks();
    return;
  }

  if (event.target.closest(".start-button")) {
    startTask(task);
    return;
  }

  if (event.target.closest(".edit-button")) {
    closeInlineForms();
    const editForm = taskElement.querySelector(".edit-form");
    const editInput = editForm.querySelector(".edit-input");
    taskElement.classList.add("is-editing");
    taskElement.draggable = false;
    editForm.hidden = false;
    editInput.value = task.text;
    editForm.querySelector(
      `input[name="edit-priority"][value="${task.priority}"]`,
    ).checked = true;
    editInput.focus();
    editInput.select();
    return;
  }

  if (event.target.closest(".cancel-edit-button")) {
    taskElement.classList.remove("is-editing");
    taskElement.draggable = true;
    taskElement.querySelector(".edit-form").hidden = true;
    return;
  }

  if (event.target.closest(".delete-button")) {
    tasks = tasks.filter((item) => item.id !== taskElement.dataset.taskId);
    saveTasks();
    renderTasks();
  }
});
taskList.addEventListener("dragstart", (event) => {
  const taskElement = event.target.closest(".task-item");

  if (
    !taskElement ||
    taskElement.classList.contains("is-editing") ||
    taskElement.classList.contains("is-setting-time")
  ) {
    event.preventDefault();
    return;
  }

  draggedTaskId = taskElement.dataset.taskId;
  taskElement.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedTaskId);
});

taskList.addEventListener("dragover", (event) => {
  const draggingElement = taskList.querySelector(".task-item.dragging");
  const targetElement = event.target.closest(".task-item");

  if (!draggingElement || !targetElement || draggingElement === targetElement) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  const bounds = targetElement.getBoundingClientRect();
  const insertAfter = event.clientY > bounds.top + bounds.height / 2;
  taskList.insertBefore(
    draggingElement,
    insertAfter ? targetElement.nextSibling : targetElement,
  );
});

taskList.addEventListener("drop", (event) => {
  event.preventDefault();
  persistTaskOrder();
  draggedTaskId = null;
});

taskList.addEventListener("dragend", () => {
  const draggingElement = taskList.querySelector(".task-item.dragging");

  if (draggingElement) {
    draggingElement.classList.remove("dragging");
  }

  if (draggedTaskId) {
    persistTaskOrder();
  }
  draggedTaskId = null;
});

reminderDialog.addEventListener("close", showNextReminder);

async function initializeApplication() {
  try {
    tasks = (await TaskModel.getAll()).map((task) => ({
      ...task,
      priority: priorityLabels[task.priority] ? task.priority : "medium",
      status: statusLabels[task.status] ? task.status : "pending",
      timing: normalizeTiming(task.timing),
      createdAt: Number.isFinite(Number(task.createdAt))
        ? Number(task.createdAt)
        : Date.now(),
    }));
    renderTasks();
    processTimers();
    window.setInterval(processTimers, 1000);
  } catch (error) {
    showImportStatus(`无法连接后端：${error.message}`, true);
    renderTasks();
  }
}

initializeApplication();