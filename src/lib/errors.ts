export class AppError extends Error {
  constructor(
    message: string,
    public code: "NOT_FOUND" | "FORBIDDEN" | "UNAUTHENTICATED" | "VALIDATION" | "CONFLICT" | "RATE_LIMITED",
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "Record") => new AppError(`${what} not found`, "NOT_FOUND");
export const forbidden = (msg = "You do not have permission to do that") => new AppError(msg, "FORBIDDEN");
export const validation = (msg: string, fieldErrors?: Record<string, string>) =>
  new AppError(msg, "VALIDATION", fieldErrors);
export const conflict = (msg: string) => new AppError(msg, "CONFLICT");
