/**
 * @template T
 * @typedef {Object} OkResult
 * @property {true} ok
 * @property {T} value
 */

/**
 * @typedef {Object} ErrResult
 * @property {false} ok
 * @property {Error} error
 */

/**
 * @template T
 * @typedef {OkResult<T> | ErrResult} Result
 */

/**
 * Create a successful Result
 * @template T
 * @param {T} value - The success value
 * @returns {OkResult<T>}
 */
export const Ok = (value) => ({ ok: true, value });

/**
 * Create a failed Result
 * @param {Error | string} error - The error
 * @returns {ErrResult}
 */
export const Err = (error) => ({
  ok: false,
  error: error instanceof Error ? error : new Error(error)
});
