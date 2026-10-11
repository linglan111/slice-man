export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AppError("CANCELLED", "操作已取消");
}
export function publicError(error: unknown): {
  success: false;
  error: string;
  code: string;
} {
  if (error instanceof AppError)
    return { success: false, error: error.message, code: error.code };
  if (error instanceof Error && error.name === "AbortError")
    return { success: false, error: "操作已取消", code: "CANCELLED" };
  return {
    success: false,
    error: "操作失败，请检查文件权限、配置或重试。",
    code: "OPERATION_FAILED",
  };
}
