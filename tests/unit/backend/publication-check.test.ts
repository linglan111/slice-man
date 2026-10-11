import { describe, expect, it, vi } from "vitest";
import type * as FileSystem from "node:fs/promises";
const mocks = vi.hoisted(() => ({ link: vi.fn(), rm: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  link: mocks.link,
  rm: mocks.rm,
}));
import { publish } from "../../../src/main/services/media/lib/media-service";
describe("safe output publication errors", () => {
  it.each(["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EPERM"])(
    "gives an actionable supported-volume error for %s",
    async (code) => {
      mocks.link.mockRejectedValueOnce(
        Object.assign(new Error("native filesystem detail"), { code }),
      );
      await expect(publish("temporary", "destination")).rejects.toMatchObject({
        code: "DESTINATION_UNSUPPORTED",
      });
      expect(mocks.rm).not.toHaveBeenCalled();
    },
  );
  it("distinguishes target permission from unsupported publication", async () => {
    mocks.link.mockRejectedValueOnce(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );
    await expect(publish("temporary", "destination")).rejects.toMatchObject({
      code: "DESTINATION_PERMISSION",
    });
  });
});
