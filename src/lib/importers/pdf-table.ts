/**
 * Reads the text of a digital (not scanned) PDF and rebuilds a table from it: text is grouped into lines by
 * vertical position, split into cells wherever there is a visible gap, and cells are lined up into columns by
 * their horizontal position. The result goes through the same column-mapping and preview step as a CSV/Excel file.
 */
type Piece = { x0: number; x1: number; y: number; h: number; s: string };
type Cell = { x0: number; x1: number; s: string };

export async function pdfToRows(buf: Buffer): Promise<string[][]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  } catch {
    throw new Error("This PDF could not be opened");
  }
  const lines: Cell[][] = [];
  const maxPages = Math.min(doc.numPages, 200);
  for (let p = 1; p <= maxPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const pieces: Piece[] = [];
    for (const it of content.items as { str?: string; transform: number[]; width: number; height: number }[]) {
      if (!it.str || !it.str.trim()) continue;
      pieces.push({ x0: it.transform[4], x1: it.transform[4] + it.width, y: it.transform[5], h: it.height || Math.abs(it.transform[3]) || 10, s: it.str.trim() });
    }
    // group into lines (top to bottom), tolerance = a third of the text height
    pieces.sort((a, b) => b.y - a.y || a.x0 - b.x0);
    const rows: Piece[][] = [];
    for (const pc of pieces) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last[0].y - pc.y) <= Math.max(2, pc.h / 3)) last.push(pc);
      else rows.push([pc]);
    }
    for (const row of rows) {
      row.sort((a, b) => a.x0 - b.x0);
      const cells: Cell[] = [];
      for (const pc of row) {
        const prev = cells[cells.length - 1];
        // text of one cell is separated by at most a normal word space; a wider gap starts a new cell
        if (prev && pc.x0 - prev.x1 < pc.h * 0.9) { prev.s += (pc.x0 - prev.x1 > pc.h * 0.1 ? " " : "") + pc.s; prev.x1 = pc.x1; }
        else cells.push({ x0: pc.x0, x1: pc.x1, s: pc.s });
      }
      lines.push(cells);
    }
  }
  await doc.destroy?.();

  const tableLines = lines.filter((l) => l.length >= 2);
  if (!tableLines.length) return [];

  // columns = merged horizontal extents of all cells
  const spans = tableLines.flatMap((l) => l.map((c) => [c.x0, c.x1] as [number, number])).sort((a, b) => a[0] - b[0]);
  const cols: [number, number][] = [];
  for (const [a, b] of spans) {
    const last = cols[cols.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else cols.push([a, b]);
  }
  const colOf = (c: Cell) => {
    const mid = (c.x0 + c.x1) / 2;
    let best = 0, dist = Infinity;
    cols.forEach(([a, b], i) => { const d = mid >= a && mid <= b ? 0 : Math.min(Math.abs(mid - a), Math.abs(mid - b)); if (d < dist) { dist = d; best = i; } });
    return best;
  };
  const out = tableLines.map((l) => {
    const r: string[] = Array(cols.length).fill("");
    for (const c of l) { const i = colOf(c); r[i] = r[i] ? `${r[i]} ${c.s}` : c.s; }
    return r;
  });
  // drop columns that are empty everywhere, and repeated page headers
  const keep = cols.map((_, i) => out.some((r) => r[i] !== ""));
  const slim = out.map((r) => r.filter((_, i) => keep[i]));
  const header = slim[0].join("|");
  return slim.filter((r, i) => i === 0 || r.join("|") !== header);
}
