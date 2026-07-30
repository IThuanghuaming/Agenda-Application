export const elements = {
  taskForm: document.querySelector("#task-form"),
  taskInput: document.querySelector("#task-input"),
  taskList: document.querySelector("#task-list"),
  taskTemplate: document.querySelector("#task-template"),
  emptyState: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyDescription: document.querySelector("#empty-description"),
  pendingCount: document.querySelector("#pending-count"),
  completedCount: document.querySelector("#completed-count"),
  failedCount: document.querySelector("#failed-count"),
  totalLabel: document.querySelector("#total-label"),
  filterBar: document.querySelector(".filter-bar"),
  filterButtons: document.querySelectorAll(".filter-button"),
  taskSearch: document.querySelector("#task-search"),
  dateFilter: document.querySelector("#date-filter"),
  resetListFiltersButton: document.querySelector("#reset-list-filters"),
  clearCompletedButton: document.querySelector("#clear-completed"),
  clearAllButton: document.querySelector("#clear-all"),
  importFileInput: document.querySelector("#import-file"),
  importButton: document.querySelector("#import-button"),
  importStatus: document.querySelector("#import-status"),
  reminderDialog: document.querySelector("#reminder-dialog"),
  reminderMessage: document.querySelector("#reminder-message"),
  timeFeedbackDialog: document.querySelector("#time-feedback-dialog"),
  timeFeedbackMessage: document.querySelector("#time-feedback-message"),
};

export const TaskView = {
  renderTaskItems({ visibleTasks, priorityLabels, statusLabels, formatCreationDate, setTaskTimingContent }) {
    const fragment = document.createDocumentFragment();

    visibleTasks.forEach((task) => {
      const taskElement = elements.taskTemplate.content.firstElementChild.cloneNode(true);
      const checkbox = taskElement.querySelector(".task-checkbox");
      const taskText = taskElement.querySelector(".task-text");
      const priorityBadge = taskElement.querySelector(".priority-badge");
      const statusBadge = taskElement.querySelector(".status-badge");
      const creationDate = taskElement.querySelector(".creation-date");
      const timingElement = taskElement.querySelector(".task-timing");
      const timingButton = taskElement.querySelector(".timing-button");
      const startButton = taskElement.querySelector(".start-button");
      const editButton = taskElement.querySelector(".edit-button");
      const deleteButton = taskElement.querySelector(".delete-button");
      const editPriority = taskElement.querySelector(`input[name="edit-priority"][value="${task.priority}"]`);

      taskElement.dataset.taskId = task.id;
      taskElement.classList.add(`priority-${task.priority}`, `status-${task.status}`);
      taskElement.classList.toggle("is-completed", task.status === "completed");
      checkbox.checked = task.status === "completed";
      checkbox.setAttribute("aria-label", `${task.status === "completed" ? "标记为待完成" : "标记为已完成"}：${task.text}`);
      taskText.textContent = task.text;
      priorityBadge.textContent = priorityLabels[task.priority];
      statusBadge.textContent = statusLabels[task.status];
      creationDate.textContent = `创建 ${formatCreationDate(task.createdAt)}`;
      editPriority.checked = true;
      setTaskTimingContent(task, timingElement, startButton);
      timingButton.hidden = task.status !== "pending" || Boolean(task.timing?.endAt);
      timingButton.textContent = task.timing ? "修改时间" : "设置时间";
      timingButton.setAttribute("aria-label", `${timingButton.textContent}：${task.text}`);
      startButton.setAttribute("aria-label", `开始任务：${task.text}`);
      editButton.setAttribute("aria-label", `编辑任务：${task.text}`);
      deleteButton.setAttribute("aria-label", `删除任务：${task.text}`);
      fragment.append(taskElement);
    });

    elements.taskList.replaceChildren(fragment);
  },
};