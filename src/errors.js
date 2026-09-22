export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    const body = { error: { code: this.code, message: this.message } };
    if (this.details !== undefined) body.error.details = this.details;
    return body;
  }
}

export const badRequest = (message, details) => new ApiError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new ApiError(401, 'UNAUTHORIZED', message);
export const notFound = (resource, id) =>
  new ApiError(404, 'NOT_FOUND', `${resource} with id '${id}' was not found`);
export const conflict = (message) => new ApiError(409, 'CONFLICT', message);
export const validationError = (details) =>
  new ApiError(422, 'VALIDATION_ERROR', 'Request body failed validation', details);

export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json(err.toJSON());
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }
  console.error(err);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` },
  });
}
