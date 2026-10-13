import type { ErrorCodeValue } from '@anonmatch/shared'

/**
 * The only error type services throw.
 *
 * Having exactly one means the transport has exactly one catch block, so a new
 * failure mode cannot be added without deciding what the client is told. The
 * `code` is the signal the client branches on; `message` is for humans and must
 * never leak internals such as peer identity or stack detail.
 *
 * Services throw, they never catch. Swallowing an error here is what turned the
 * M1 auth bug into one opaque message for four different root causes.
 */
export class ServiceError extends Error {
  readonly code: ErrorCodeValue

  constructor(code: ErrorCodeValue, message: string) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
  }
}

export function isServiceError(value: unknown): value is ServiceError {
  return value instanceof ServiceError
}
