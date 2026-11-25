import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
} from 'docx';
import type { Block } from './specification';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const multiline = (s: string): string => esc(s).replace(/\n/g, '<br>');

/** Printable HTML (rendered to PDF by Electron). */
export function specToHtml(blocks: Block[], title: string): string {
  const body = blocks
    .map((b) => {
      switch (b.kind) {
        case 'title':
          return `<div class="title"><h1>${esc(b.text)}</h1>${b.subtitle ? `<p class="sub">${esc(b.subtitle)}</p>` : ''}</div>`;
        case 'h1':
        case 'h2':
        case 'h3':
          return `<${b.kind}>${esc(b.text)}</${b.kind}>`;
        case 'p':
          return `<p>${multiline(b.text)}</p>`;
        case 'note':
          return `<p class="note">${multiline(b.text)}</p>`;
        case 'list':
          return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
        case 'kv':
          return `<table class="kv">${b.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${multiline(v)}</td></tr>`).join('')}</table>`;
        case 'table': {
          const cols = b.widths ? `<colgroup>${b.widths.map((w) => `<col style="width:${w}%">`).join('')}</colgroup>` : '';
          return `<table class="grid">${cols}<thead><tr>${b.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows
            .map((r) => `<tr>${r.map((c) => `<td>${multiline(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`;
        }
        case 'pagebreak':
          return '<div class="pb"></div>';
      }
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { margin: 18mm 14mm; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #111; }
h1 { font-size: 17pt; margin: 18px 0 6px; border-bottom: 2px solid #1b2a41; padding-bottom: 3px; }
h2 { font-size: 12.5pt; margin: 16px 0 4px; page-break-after: avoid; }
h3 { font-size: 11pt; margin: 12px 0 4px; }
.title h1 { font-size: 26pt; border: 0; margin-top: 40px; } .sub { font-size: 14pt; color: #444; margin-top: 0; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; }
th, td { border: 1px solid #888; padding: 3px 6px; text-align: left; vertical-align: top; }
thead th { background: #e3e8f2; } table.grid tr { page-break-inside: avoid; }
table.kv th { width: 22%; background: #f0f2f6; }
.note { background: #fff4d6; border-left: 4px solid #b45309; padding: 6px 10px; }
.pb { page-break-after: always; }
</style></head><body>
${body}
</body></html>`;
}

// ---------- Word (.docx) ----------

const HEADINGS = { h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3 } as const;
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: '888888' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const PAGE_WIDTH_DXA = 9638; // A4 minus 2 cm margins

const cellParas = (text: string, bold = false): Paragraph[] =>
  (text || '').split('\n').map((line) => new Paragraph({ children: [new TextRun({ text: line, bold, size: 19 })], spacing: { after: 40 } }));

function makeTable(header: string[] | null, rows: string[][], widths?: number[], firstColHeader = false): Table {
  const total = widths?.reduce((a, b) => a + b, 0) ?? 100;
  const dxa = (i: number, n: number): number => Math.round(((widths?.[i] ?? 100 / n) / total) * PAGE_WIDTH_DXA);
  const mk = (c: string, i: number, n: number, head: boolean, shade: boolean): TableCell =>
    new TableCell({
      children: cellParas(c, head || (firstColHeader && i === 0)),
      width: { size: dxa(i, n), type: WidthType.DXA },
      borders: BORDERS,
      shading: shade ? { type: ShadingType.CLEAR, fill: head ? 'E3E8F2' : 'F0F2F6', color: 'auto' } : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
    });
  const n = header?.length ?? rows[0]?.length ?? 1;
  const trs: TableRow[] = [];
  if (header) trs.push(new TableRow({ tableHeader: true, cantSplit: true, children: header.map((h, i) => mk(h, i, n, true, true)) }));
  for (const r of rows) trs.push(new TableRow({ cantSplit: true, children: r.map((c, i) => mk(c, i, n, false, firstColHeader && i === 0)) }));
  return new Table({
    rows: trs,
    width: { size: PAGE_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: Array.from({ length: n }, (_, i) => dxa(i, n)),
  });
}

export async function specToDocx(blocks: Block[], title: string): Promise<Uint8Array> {
  const children: FileChild[] = [];
  const gap = () => new Paragraph({ children: [], spacing: { after: 120 } });
  for (const b of blocks) {
    switch (b.kind) {
      case 'title':
        children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: b.text, bold: true, size: 52 })], spacing: { before: 600, after: 120 } }));
        if (b.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: b.subtitle, size: 28, color: '444444' })], spacing: { after: 360 } }));
        break;
      case 'h1':
      case 'h2':
      case 'h3':
        children.push(new Paragraph({ heading: HEADINGS[b.kind], children: [new TextRun({ text: b.text })], spacing: { before: 240, after: 80 }, keepNext: true }));
        break;
      case 'p':
        children.push(new Paragraph({ children: [new TextRun({ text: b.text, size: 20 })], spacing: { after: 100 } }));
        break;
      case 'note':
        children.push(
          new Paragraph({
            children: [new TextRun({ text: b.text, size: 20 })],
            shading: { type: ShadingType.CLEAR, fill: 'FFF4D6', color: 'auto' },
            border: { left: { style: BorderStyle.SINGLE, size: 24, color: 'B45309', space: 6 } },
            spacing: { before: 80, after: 120 },
          }),
        );
        break;
      case 'list':
        for (const item of b.items) children.push(new Paragraph({ children: [new TextRun({ text: item, size: 20 })], bullet: { level: 0 } }));
        break;
      case 'kv':
        children.push(makeTable(null, b.rows.map(([k, v]) => [k, v]), [22, 78], true), gap());
        break;
      case 'table':
        children.push(makeTable(b.header, b.rows.length ? b.rows : [b.header.map(() => '')], b.widths), gap());
        break;
      case 'pagebreak':
        children.push(new Paragraph({ children: [], pageBreakBefore: true }));
        break;
    }
  }
  const doc = new Document({
    title,
    creator: 'Requirements to Verification',
    styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: `${title}   Page `, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], size: 16 })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
