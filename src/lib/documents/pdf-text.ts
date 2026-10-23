import "server-only";

import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_PDF_PAGES = 500;
const MAX_EXTRACTED_CHARACTERS = 500_000;

export class PdfTextExtractionError extends Error {
  readonly reason: "no-text" | "too-many-pages" | "too-much-text";

  constructor(
    reason: "no-text" | "too-many-pages" | "too-much-text",
  ) {
    super(reason);
    this.name = "PdfTextExtractionError";
    this.reason = reason;
  }
}

type PdfTextItem = {
  str: string;
  hasEOL: boolean;
  transform: number[];
  width: number;
};

function isPdfTextItem(item: unknown): item is PdfTextItem {
  if (typeof item !== "object" || item === null || !("str" in item)) {
    return false;
  }

  return (
    typeof item.str === "string" &&
    "hasEOL" in item &&
    typeof item.hasEOL === "boolean" &&
    "transform" in item &&
    Array.isArray(item.transform) &&
    item.transform.length >= 6 &&
    item.transform.every((value) => typeof value === "number") &&
    "width" in item &&
    typeof item.width === "number"
  );
}

function extractPageText(items: unknown[]): string {
  const textItems = items
    .filter(isPdfTextItem)
    .filter((item) => item.str.length > 0)
    .sort(
      (left, right) =>
        right.transform[5] - left.transform[5] ||
        left.transform[4] - right.transform[4],
    );
  const lines: { baseline: number; items: PdfTextItem[] }[] = [];

  for (const item of textItems) {
    const baseline = item.transform[5];
    const currentLine = lines.at(-1);
    if (currentLine && Math.abs(currentLine.baseline - baseline) <= 1.5) {
      currentLine.items.push(item);
    } else {
      lines.push({ baseline, items: [item] });
    }
  }

  return lines
    .map(({ items: lineItems }) => {
      let line = "";
      let previousEnd: number | null = null;

      for (const item of lineItems.sort(
        (left, right) => left.transform[4] - right.transform[4],
      )) {
        const gap =
          previousEnd === null ? 0 : item.transform[4] - previousEnd;
        const previousCharacter = line.at(-1) ?? "";
        const nextCharacter = item.str[0] ?? "";

        if (
          gap > 24 &&
          !/\s/.test(previousCharacter) &&
          !/\s/.test(nextCharacter)
        ) {
          line += "\t";
        } else if (
          gap > 1.5 &&
          !/\s/.test(previousCharacter) &&
          !/\s/.test(nextCharacter)
        ) {
          line += " ";
        }

        line += item.str;
        previousEnd = item.transform[4] + item.width;
      }

      return line.replace(/[ \t]+$/g, "").trim();
    })
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export async function extractPdfText(data: Uint8Array) {
  const loadingTask = getDocument({
    data,
    verbosity: VerbosityLevel.ERRORS,
    useSystemFonts: true,
  });

  try {
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      throw new PdfTextExtractionError("too-many-pages");
    }

    const pages: string[] = [];
    let characterCount = 0;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = extractPageText(content.items).trim();

      characterCount += pageText.length;
      if (characterCount > MAX_EXTRACTED_CHARACTERS) {
        throw new PdfTextExtractionError("too-much-text");
      }

      pages.push(`--- Strona ${pageNumber} ---\n${pageText}`);
    }

    const text = pages.join("\n\n").trim();
    const hasExtractableText = pages.some((page) =>
      page.split("\n").slice(1).join("\n").trim().length > 0,
    );
    if (!hasExtractableText) {
      throw new PdfTextExtractionError("no-text");
    }

    return { pageCount: document.numPages, text };
  } finally {
    await loadingTask.destroy();
  }
}
