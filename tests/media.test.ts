import { describe, expect, test } from "bun:test";
import {
  MAX_ATTACHMENT_BYTES,
  attachmentProblem,
  formatSize,
  relativePath,
  writeMedia,
} from "../src/lib/media";

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

describe("relativePath", () => {
  test("climbs out of the note's folder and into the target's", () => {
    expect(relativePath("/vault/notes", "/vault/media/x.png")).toBe("../media/x.png");
    expect(relativePath("C:\\vault\\notes", "C:\\vault\\media\\x.png")).toBe("../media/x.png");
  });

  test("gives the whole path when the target is on another drive", () => {
    expect(relativePath("C:\\vault\\notes", "D:\\media\\x.png")).toBe("D:/media/x.png");
  });

  test("gives the whole path when the target is on another share, or off it", () => {
    expect(relativePath("\\\\nas\\notes\\vault", "\\\\other\\pics\\x.png")).toBe("//other/pics/x.png");
    expect(relativePath("C:\\vault", "\\\\nas\\pics\\x.png")).toBe("//nas/pics/x.png");
  });

  test("treats a drive letter, or a share name, the same in either case", () => {
    expect(relativePath("c:\\vault\\notes", "C:\\vault\\media\\x.png")).toBe("../media/x.png");
    expect(relativePath("\\\\NAS\\Notes\\vault", "\\\\nas\\notes\\media\\x.png")).toBe("../media/x.png");
  });

  test("still compares folder names below the root as written", () => {
    expect(relativePath("/vault/Notes", "/vault/notes/x.png")).toBe("../notes/x.png");
  });
});
