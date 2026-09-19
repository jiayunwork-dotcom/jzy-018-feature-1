// 带类型的业务错误：HTTP 层据此产出统一的错误说明。

export class AppError extends Error {
  /**
   * @param {string} type 稳定的机器可读错误类型，如 INVALID_X
   * @param {string} message 面向调用方的说明（指出是哪一项不合规）
   * @param {number} statusCode HTTP 状态码
   * @param {object} [details] 附加上下文（字段名、下标等）
   */
  constructor(type, message, statusCode = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.type = type;
    this.statusCode = statusCode;
    this.details = details;
  }
}
