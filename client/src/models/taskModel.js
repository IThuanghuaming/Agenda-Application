const API_URL = "/api/tasks";

async function request(url, options = {}) {
  let response;

  try {
    response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch {
    throw new Error("无法连接后端，请在项目根目录运行 npm run dev");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message =
      body.message ||
      (response.status >= 500
        ? "无法连接后端，请在项目根目录运行 npm run dev"
        : `请求失败（${response.status}）`);
    throw new Error(message);
  }

  return response.status === 204 ? null : response.json();
}

export const TaskModel = {
  getAll() {
    return request(API_URL);
  },

  replaceAll(tasks) {
    return request(API_URL, {
      method: "PUT",
      body: JSON.stringify({ tasks }),
    });
  },
};