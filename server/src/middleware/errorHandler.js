export function errorHandler(error, _request, response, _next) {
  console.error(error);
  response.status(500).json({ message: "服务器处理请求时发生错误" });
}