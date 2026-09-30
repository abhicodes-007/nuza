/**
 * Whole-row and whole-column edits to a markdown table.
 *
 * A cell can be edited where it sits, but adding or taking away a row or a
 * column moves every pipe after it - so these read the table's source into
 * rows of cells, change that, and write the table out again, with its columns
 * padded to line up and its alignment kept.
 */

export type Alignment = "left" | "center" | "right" | null;

export interface TableModel {
  alignment: Alignment[];
  header: string[];
  rows: string[][];
}

/**
 * The cells of one table line: split on pipes that are not escaped, with the
 * pipes at either end - which are optional in GFM - taken off first.
 */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  const text = line.trim();

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\\" && i + 1 < text.length) {
      current += char + text[i + 1];
      i++;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);

  if (text.startsWith("|")) cells.shift();
  if (text.endsWith("|") && !text.endsWith("\\|")) cells.pop();
  return cells.map((cell) => cell.trim());
}

function alignmentOf(cell: string): Alignment | undefined {
  const text = cell.replace(/\s/g, "");
  if (!/^:?-+:?$/.test(text)) return undefined;
  const left = text.startsWith(":");
  const right = text.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : null;
}

/** The table in `source`, or null if it is not one - no delimiter row under a header. */
export function parseTable(source: string): TableModel | null {
  const lines = source.split("\n").filter((line) => line.trim() !== "");
  if (lines.length < 2) return null;

  const header = splitRow(lines[0]);
  const delimiter = splitRow(lines[1]).map(alignmentOf);
  if (delimiter.some((align) => align === undefined)) return null;

  const width = header.length;
  const fit = (cells: string[]) =>
    cells.length >= width
      ? cells.slice(0, width)
      : [...cells, ...Array<string>(width - cells.length).fill("")];

  return {
    header,
    alignment: header.map((_, column) => delimiter[column] ?? null),
    rows: lines.slice(2).map((line) => fit(splitRow(line))),
  };
}

function delimiterFor(align: Alignment, width: number) {
  if (align === "center") return `:${"-".repeat(width - 2)}:`;
  if (align === "left") return `:${"-".repeat(width - 1)}`;
  if (align === "right") return `${"-".repeat(width - 1)}:`;
  return "-".repeat(width);
}

/** The table as markdown, every column padded to its widest cell. */
export function formatTable({ header, alignment, rows }: TableModel): string {
  const widths = header.map((cell, column) =>
    Math.max(3, cell.length, ...rows.map((row) => (row[column] ?? "").length))
  );

  const line = (cells: string[]) =>
    `| ${cells
      .map((cell, column) => {
        const pad = widths[column] - cell.length;
        if (alignment[column] === "right") return " ".repeat(pad) + cell;
        if (alignment[column] === "center") {
          const before = Math.floor(pad / 2);
          return " ".repeat(before) + cell + " ".repeat(pad - before);
        }
        return cell + " ".repeat(pad);
      })
      .join(" | ")} |`;

  return [
    line(header),
    `| ${widths.map((width, column) => delimiterFor(alignment[column], width)).join(" | ")} |`,
    ...rows.map(line),
  ].join("\n");
}

/** A new empty body row, placed before the body row at `at` (the count of rows puts it last). */
export function insertRow(model: TableModel, at: number): TableModel {
  const index = Math.max(0, Math.min(at, model.rows.length));
  const empty = model.header.map(() => "");
  return { ...model, rows: [...model.rows.slice(0, index), empty, ...model.rows.slice(index)] };
}

/** The table without body row `index`. The header row is not a row that can go. */
export function deleteRow(model: TableModel, index: number): TableModel {
  if (index < 0 || index >= model.rows.length) return model;
  return { ...model, rows: model.rows.filter((_, row) => row !== index) };
}

/** A new empty column, placed before the column at `at`. */
export function insertColumn(model: TableModel, at: number): TableModel {
  const index = Math.max(0, Math.min(at, model.header.length));
  const splice = <T>(cells: T[], value: T) => [...cells.slice(0, index), value, ...cells.slice(index)];
  return {
    header: splice(model.header, ""),
    alignment: splice<Alignment>(model.alignment, null),
    rows: model.rows.map((row) => splice(row, "")),
  };
}

/** The table without column `index`. The last column stays: a table needs one. */
export function deleteColumn(model: TableModel, index: number): TableModel {
  if (model.header.length <= 1 || index < 0 || index >= model.header.length) return model;
  const drop = <T>(cells: T[]) => cells.filter((_, column) => column !== index);
  return { header: drop(model.header), alignment: drop(model.alignment), rows: model.rows.map(drop) };
}

/**
 * Which cell of the table `source` the text at `offset` is in: `row` is -1 for
 * the header and counts body rows from 0, `column` counts from 0. Null on the
 * delimiter row, which holds no cells.
 */
export function cellAt(source: string, offset: number): { row: number; column: number } | null {
  const lines = source.split("\n");
  let start = 0;

  for (let index = 0; index < lines.length; index++) {
    const end = start + lines[index].length;
    if (offset <= end) {
      if (index === 1) return null;
      // Everything before the offset, closed off with a stand-in for the cell
      // itself, splits into the cells before it and this one.
      const column = splitRow(lines[index].slice(0, offset - start) + "x").length - 1;
      return { row: index === 0 ? -1 : index - 2, column };
    }
    start = end + 1;
  }
  return null;
}
