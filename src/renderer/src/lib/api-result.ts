import type { Result } from '../../../shared/contracts';

export async function requireResult<T>(request: Promise<Result<T>>): Promise<T> {
  const result = await request;
  if (result.success === false) throw new Error(`${result.error} (${result.code})`);
  return result.data;
}
