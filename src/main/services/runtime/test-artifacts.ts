import { z } from "zod";
import { AppError } from "../../lib/errors";
import type { RuntimeArtifacts } from "./manifest";

const localUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  }, "Test artifacts must use loopback HTTP origins");
const artifact = z
  .object({
    url: localUrl,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().positive().max(2_000_000_000),
  })
  .strict();
const model = artifact.extend({ name: z.string().min(1).max(100) });
const manifest = z
  .object({
    cpu: artifact,
    gpu: artifact,
    models: z
      .object({ base: model, small: model, "large-v3-turbo": model })
      .strict(),
  })
  .strict();

// The main process may call this only inside its isolated !app.isPackaged E2E
// branch; production never reads arbitrary manifest URLs from the environment.
export function parseTestArtifacts(raw: unknown): RuntimeArtifacts {
  const result = manifest.safeParse(raw);
  if (!result.success)
    throw new AppError(
      "E2E_MANIFEST_INVALID",
      "E2E runtime manifest must be complete and use loopback HTTP URLs.",
    );
  return result.data;
}
