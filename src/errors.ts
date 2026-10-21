export class RuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'RuntimeError';
  }
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof RuntimeError) {
    return {
      code: error.code,
      message: error.message,
      recoverable: true,
      ...error.details,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'UNEXPECTED_ERROR',
      message: error.message,
      recoverable: false,
    };
  }

  return {
    code: 'UNEXPECTED_ERROR',
    message: String(error),
    recoverable: false,
  };
}
