import { describe, expect, test } from "bun:test";
import {
  cellAt,
  deleteColumn,
  deleteRow,
  formatTable,
  insertColumn,
  insertRow,
  parseTable,
  splitRow,
} from "../src/lib/markdown/tableEdit";

const source = ["| Name | Value |", "| :--- | ----: |", "| one  | 1 |", "| two  | 2 |"].join("\n");

describe("splitRow", () => {
  test("splits on pipes, with or without the ones at either end", () => {
    expect(splitRow("| a | b |")).toEqual(["a", "b"]);
    expect(splitRow("a | b")).toEqual(["a", "b"]);
  });

  test("keeps an escaped pipe inside its cell", () => {
    expect(splitRow("| a \\| b | c |")).toEqual(["a \\| b", "c"]);
  });

  test("keeps empty cells", () => {
    expect(splitRow("| a |  | c |")).toEqual(["a", "", "c"]);
  });
});

describe("parseTable", () => {
  test("reads the header, alignment and rows", () => {
    expect(parseTable(source)).toEqual({
      header: ["Name", "Value"],
      alignment: ["left", "right"],
      rows: [
        ["one", "1"],
        ["two", "2"],
      ],
    });
  });

  test("fits short and long rows to the header", () => {
    const model = parseTable("| a | b |\n| - | - |\n| 1 |\n| 1 | 2 | 3 |");
    expect(model?.rows).toEqual([
      ["1", ""],
      ["1", "2"],
    ]);
  });

  test("is not a table without a delimiter row", () => {
    expect(parseTable("| a | b |\n| c | d |")).toBeNull();
  });
});

describe("formatTable", () => {
  test("pads columns and keeps each one's alignment", () => {
    expect(formatTable(parseTable(source)!)).toBe(
      ["| Name | Value |", "| :--- | ----: |", "| one  |     1 |", "| two  |     2 |"].join("\n")
    );
  });

  test("reads back as the same table", () => {
    const model = parseTable(source)!;
    expect(parseTable(formatTable(model))).toEqual(model);
  });
});

describe("row and column edits", () => {
  const model = parseTable(source)!;

  test("inserts an empty row where asked, and at the end", () => {
    expect(insertRow(model, 1).rows).toEqual([
      ["one", "1"],
      ["", ""],
      ["two", "2"],
    ]);
    expect(insertRow(model, 99).rows.at(-1)).toEqual(["", ""]);
  });

  test("deletes a body row, never the header", () => {
    expect(deleteRow(model, 0).rows).toEqual([["two", "2"]]);
    expect(deleteRow(model, 5)).toBe(model);
  });

  test("inserts an empty, unaligned column", () => {
    const wider = insertColumn(model, 1);
    expect(wider.header).toEqual(["Name", "", "Value"]);
    expect(wider.alignment).toEqual(["left", null, "right"]);
    expect(wider.rows[0]).toEqual(["one", "", "1"]);
  });

  test("deletes a column, but keeps the last one", () => {
    const narrower = deleteColumn(model, 0);
    expect(narrower.header).toEqual(["Value"]);
    expect(narrower.alignment).toEqual(["right"]);
    expect(deleteColumn(narrower, 0)).toBe(narrower);
  });
});

describe("cellAt", () => {
  const table = "| a | b |\n| - | - |\n| c |   |";

  test("finds the header's cells", () => {
    expect(cellAt(table, 2)).toEqual({ row: -1, column: 0 });
    expect(cellAt(table, 6)).toEqual({ row: -1, column: 1 });
  });

  test("finds a body cell, empty ones included", () => {
    const body = table.indexOf("| c");
    expect(cellAt(table, body + 2)).toEqual({ row: 0, column: 0 });
    expect(cellAt(table, body + 6)).toEqual({ row: 0, column: 1 });
  });

  test("has no cell on the delimiter row", () => {
    expect(cellAt(table, table.indexOf("| -") + 2)).toBeNull();
  });
});
