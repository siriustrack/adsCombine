export type Err<E> = {
  value?: never;
  error: E;
};

export type Ok<T> = {
  value: T;
  error?: never;
};

export type Result<T, E> = Ok<T> | Err<E>;

export const wrapPromiseResult = async <T, E>(value: Promise<T>): Promise<Result<T, E>> => {
  try {
    const result = await value;
    return { value: result, error: null as never };
  } catch (error) {
    return { value: null as never, error: error as E };
  }
};

export const errResult = <E>(error: E): Result<never, E> => {
  return { error, value: null as never };
};

export const okResult = <T>(value: T): Result<T, never> => {
  return { value, error: null as never};
};
