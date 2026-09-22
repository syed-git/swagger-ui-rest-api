/**
 * Tiny route registry: every endpoint is declared once with its OpenAPI
 * metadata and registered on the Express router at the same time, so the
 * Swagger document can never drift from the real routes.
 */
export class Registry {
  constructor(router) {
    this.router = router;
    this.operations = [];
  }

  /**
   * @param {object} op
   * @param {'get'|'post'|'put'|'patch'|'delete'} op.method
   * @param {string} op.path            Express style path, e.g. /accounts/:id/policies
   * @param {string} op.tag
   * @param {string} op.summary
   * @param {string} [op.description]
   * @param {object[]} [op.parameters]  OpenAPI parameter objects (path params auto-added)
   * @param {object} [op.requestBody]   OpenAPI request body object
   * @param {object} [op.responses]     OpenAPI responses object (defaults added)
   * @param {Function} op.handler       async (req, res) => void
   */
  add(op) {
    const { method, path, handler, ...meta } = op;
    this.operations.push({ method, path, ...meta });
    this.router[method](path, async (req, res, next) => {
      try {
        await handler(req, res);
      } catch (err) {
        next(err);
      }
    });
  }

  list() {
    return this.operations.map((o) => ({
      method: o.method.toUpperCase(),
      path: toOpenApiPath(o.path),
      tag: o.tag,
      summary: o.summary,
    }));
  }
}

export const toOpenApiPath = (expressPath) => expressPath.replace(/:([A-Za-z_]+)/g, '{$1}');
