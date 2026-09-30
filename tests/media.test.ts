import { describe, expect, test } from "bun:test";
import { MAX_ATTACHMENT_BYTES, attachmentProblem, formatSize, writeMedia } from "../src/lib/media";

describe("formatSize", () => {
  test("says megabytes the way a person would", () => {
    expect(formatSize(312 * 1024 * 1024)).toBe("312 MB");
    expect(formatSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatSize(200 * 1024)).toBe("200 KB");
    expect(formatSize(10)).toBe("1 KB");
  });
});

describe("attachmentProblem", () => {
  test("lets a file up to the limit through", () => {
    expect(attachmentProblem(new Blob([new Uint8Array(1024)]))).toBeNull();
    expect(attachmentProblem({ size: MAX_ATTACHMENT_BYTES } as Blob)).toBeNull();
  });

  test("names the size of a file over it", () => {
    expect(attachmentProblem({ size: 300 * 1024 * 1024 } as Blob)).toBe(
      "it is 300 MB, and files over 50 MB can't be added"
    );
  });

  test("refuses before a byte of it is read", async () => {
    let read = false;
    const huge = {
      size: MAX_ATTACHMENT_BYTES + 1,
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    } as unknown as Blob;

    await expect(writeMedia("/vault/media", "movie.mov", huge)).rejects.toThrow("can't be added");
    expect(read).toBe(false);
  });
});
