export type FinancialLine = {
  label: string;
  category: "Wyniki" | "Bilans" | "Przepływy pieniężne" | "Wniosek biegłego";
  excerpt: string;
  pageNumber: number;
};

export type FinancialDocumentSummary = {
  documentKind: "financial-statements" | "auditor-review" | "other";
  documentLabel: string;
  companyName: string | null;
  reportingPeriod: string | null;
  lines: FinancialLine[];
  categoryCoverage: Array<{
    category: Exclude<FinancialLine["category"], "Wniosek biegłego">;
    labels: string[];
  }>;
  auditorConclusion: FinancialLine | null;
  limitation: string;
};

export type ComparedFinancialLine = {
  label: string;
  current: FinancialLine;
  comparison: FinancialLine;
};

const financialLinePatterns: Array<{
  label: string;
  category: FinancialLine["category"];
  pattern: RegExp;
}> = [
  {
    label: "Przychody",
    category: "Wyniki",
    pattern: /^(?:przychody(?!\s+(?:finansowe|z\s+tytułu|operacyjne|z\s+inwestycji))(?:\s+netto)?(?:\s+ze\s+sprzedaży(?:\s+dóbr\s+i\s+usług)?)?|przychody\s+z\s+umów\s+z\s+klientami|revenue|revenues|sales(?:\s+revenue)?)\b/i,
  },
  {
    label: "Wynik operacyjny",
    category: "Wyniki",
    pattern: /^(?:zysk|strata|zysk\s*\(strata\))\s+(?:\/\s*strata\s+)?z\s+działalności\s+operacyjnej\b|^(?:operating\s+(?:profit|loss)|operating\s+income)\b/i,
  },
  {
    label: "EBITDA",
    category: "Wyniki",
    pattern: /^ebitda\b/i,
  },
  {
    label: "Wynik przed opodatkowaniem",
    category: "Wyniki",
    pattern: /^(?:zysk|strata|zysk\s*\(strata\))\s+(?:\/\s*strata\s+)?przed\s+opodatkowaniem\b|^(?:profit|loss)\s+before\s+tax\b/i,
  },
  {
    label: "Wynik netto działalności kontynuowanej",
    category: "Wyniki",
    pattern: /^(?:zysk|strata|zysk\s*\(strata\))\s+netto\s+z\s+działalności\s+kontynuowanej\b/i,
  },
  {
    label: "Wynik netto działalności zaniechanej",
    category: "Wyniki",
    pattern: /^(?:zysk|strata|zysk\s*\(strata\))\s+netto\s+z\s+działalności\s+zaniechanej\b/i,
  },
  {
    label: "Wynik netto",
    category: "Wyniki",
    pattern: /^(?:\(?(?:strata\)?\s*\/\s*)?zysk|zysk\s*\(strata\)|strata)\s+(?:netto|za\s+okres|przypadający)|^(?:net\s+profit|net\s+income|profit\s+for\s+(?:the\s+)?period)\b/i,
  },
  {
    label: "Przepływy operacyjne",
    category: "Przepływy pieniężne",
    pattern: /^(?:przepływy\s+pieniężne\s+netto\s+z\s+działalności\s+operacyjnej|net\s+cash\s+(?:flow|flows)\s+from\s+operating\s+activities)\b/i,
  },
  {
    label: "Zobowiązania",
    category: "Bilans",
    pattern: /^(?:zobowiązania\s+długoterminowe|zobowiązania\s+krótkoterminowe|zobowiązania\s+ogółem|total\s+liabilities|non-current\s+liabilities|current\s+liabilities)\b/i,
  },
  {
    label: "Środki pieniężne",
    category: "Bilans",
    pattern: /^(?:(?:środki\s+pieniężne(?:\s+i\s+ich\s+ekwiwalenty)?)(?!\s+(?:netto\s+z|na\s+(?:początek|koniec)))|cash\s+and\s+cash\s+equivalents)\b/i,
  },
  {
    label: "Aktywa",
    category: "Bilans",
    pattern: /^(?:aktywa\s+razem|suma\s+aktywów|total\s+assets)\b/i,
  },
  {
    label: "Kapitał własny",
    category: "Bilans",
    pattern: /^(?:kapitał\s+własny|total\s+equity|equity\s+attributable)\b/i,
  },
  {
    label: "Przepływy inwestycyjne",
    category: "Przepływy pieniężne",
    pattern: /^(?:przepływy\s+pieniężne\s+netto\s+z\s+działalności\s+inwestycyjnej|net\s+cash\s+(?:flow|flows)\s+from\s+investing\s+activities)\b/i,
  },
  {
    label: "Przepływy finansowe",
    category: "Przepływy pieniężne",
    pattern: /^(?:przepływy\s+pieniężne\s+netto\s+z\s+działalności\s+finansowej|net\s+cash\s+(?:flow|flows)\s+from\s+financing\s+activities)\b/i,
  },
];

const numericTokenPattern =
  /(?<![A-Za-zÀ-ž])(?:[-−]?\s*(?:\d{1,3}(?:[ .\u00a0\u202f]\d{3})+|\d+)(?:[,.]\d+)?%?)(?![A-Za-zÀ-ž])/g;
const statementHeadingPattern =
  /(?:sprawozdanie|rachunek)\s+z\s+(?:sytuacji\s+finansowej|wyniku|wyników|całkowitych\s+dochodów|zysków\s+(?:i|lub)\s+strat|przepływów\s+pieniężnych)|statement\s+of\s+(?:financial\s+position|profit\s+or\s+loss|cash\s+flows)/i;
const periodPatterns = [
  /\b\d{1,2}[./]\d{1,2}[./]\d{4}\s*(?:r\.?)?\s*[-–—]\s*\d{1,2}[./]\d{1,2}[./]\d{4}\s*r?\.?/i,
  /(?:za\s+)?(?:i|ii|1|2)\s+półrocze\s+\d{4}(?:\s+roku)?/i,
  /(?:za\s+okres|za\s+rok)\s+od\s+.{1,70}?\s+do\s+\d{1,2}\s+[a-ząćęłńóśźż]+\s+\d{4}\s*r?\.?/i,
  /(?:for\s+the\s+period)\s+from\s+.{1,70}?\s+to\s+\d{1,2}\s+[a-z]+\s+\d{4}/i,
  /(?:na\s+dzień|as\s+at)\s+\d{1,2}\s+[a-ząćęłńóśźż]+\s+\d{4}/i,
];

function splitPages(text: string): Array<{ pageNumber: number; text: string }> {
  const pages = [...text.matchAll(/--- Strona (\d+) ---\s*([\s\S]*?)(?=--- Strona \d+ ---|$)/g)];
  if (pages.length === 0) {
    return [{ pageNumber: 1, text }];
  }

  return pages.map((match) => ({
    pageNumber: Number(match[1]),
    text: match[2],
  }));
}

function cleanCandidateLine(line: string): string {
  return line
    .replace(/\s+/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

function looksLikeNumericStatementRow(sourceLine: string, excerpt: string): boolean {
  const numbers = sourceLine.match(numericTokenPattern) ?? [];
  return numbers.length >= 1 && excerpt.length <= 320;
}

function findCompanyName(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ");
  const groupMatch = normalized.match(
    /grup(?:a|y)\s+kapitałow(?:a|ej)\s+(.{1,100}?\bS\s*\.?\s*A\s*\.?)(?=\s|$|[,;])/i,
  );
  if (groupMatch?.[1]) {
    return groupMatch[1]
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\s*S\s*\.?\s*A\s*\.?$/i, " S.A.") || null;
  }

  const headerMatch = normalized.match(
    /dla\s+akcjonariuszy(?:\s+oraz\s+rady\s+nadzorczej)?\s+(.{1,80}?\bS\.A\.)(?=\s|$)/i,
  );
  if (headerMatch?.[1]) {
    return headerMatch[1].trim().replace(/\s+/g, " ");
  }

  return null;
}

function findReportingPeriod(text: string): string | null {
  const pages = splitPages(text);
  const frontMatter = pages.slice(0, 5).map(({ text: pageText }) => pageText).join(" ");
  const normalizedTexts = [frontMatter, pages.map(({ text: pageText }) => pageText).join(" ")]
    .map((value) => value.replace(/\s+/g, " "));
  for (const normalized of normalizedTexts) {
    for (const pattern of periodPatterns) {
      const match = normalized.match(pattern);
      if (match) {
        return match[0].replace(/\s+/g, " ").trim();
      }
    }
  }
  return null;
}

function findAuditorConclusion(
  pages: Array<{ pageNumber: number; text: string }>,
): FinancialLine | null {
  for (const { pageNumber, text } of pages) {
    const conclusionHeading = /(?:^|\n)\s*(?:wniosek|opinia)\s*(?:\n|$)/i.exec(text);
    if (!conclusionHeading) {
      continue;
    }

    const conclusionText = text.slice(conclusionHeading.index + conclusionHeading[0].length);
    const start = /(?:Na podstawie przeprowadzonego przeglądu|Based on our review)\b/i.exec(
      conclusionText,
    );
    if (!start) {
      continue;
    }

    const excerpt = cleanCandidateLine(conclusionText.slice(start.index))
      .split(/\b(?:BDO|Podpisano|Signed on behalf of)\b/i)[0]
      .trim();
    if (excerpt.length > 0) {
      return {
        label: "Wniosek biegłego rewidenta",
        category: "Wniosek biegłego",
        excerpt: excerpt.slice(0, 1200),
        pageNumber,
      };
    }
  }

  return null;
}

export function summarizeFinancialDocument(text: string): FinancialDocumentSummary {
  const pages = splitPages(text);
  const allText = pages.map(({ text: pageText }) => pageText).join("\n");
  const isAuditorReview =
    /raport\s+niezależnego\s+biegłego\s+rewidenta[\s\S]{0,180}?z\s+przeglądu/i.test(allText) ||
    /independent\s+auditor'?s?\s+review\s+report/i.test(allText);
  const hasFinancialStatements = pages.some(({ text: pageText }) =>
    statementHeadingPattern.test(pageText),
  );
  const documentKind = hasFinancialStatements
    ? "financial-statements"
    : isAuditorReview
      ? "auditor-review"
      : "other";
  const lines: FinancialLine[] = [];
  const seenLines = new Set<string>();
  const summaryPages = pages.filter(
    ({ pageNumber, text: pageText }) =>
      pageNumber <= 5 && /wybrane\s+dane\s+finansowe/i.test(pageText),
  );
  const lineSourcePages = summaryPages.length > 0
    ? summaryPages
    : pages.filter(({ text: pageText }) => statementHeadingPattern.test(pageText));

  if (documentKind === "financial-statements") {
    for (const { pageNumber, text: pageText } of lineSourcePages) {
      for (const rawLine of pageText.split(/\r?\n/)) {
        const excerpt = cleanCandidateLine(rawLine);
        if (!looksLikeNumericStatementRow(rawLine, excerpt)) {
          continue;
        }
        const candidateText = excerpt.replace(/^nota\s+[\d.]+\s*/i, "");
        const metric = financialLinePatterns.find(({ pattern }) => pattern.test(candidateText));
        if (!metric) {
          continue;
        }
        const key = excerpt.toLocaleLowerCase("pl-PL");
        if (seenLines.has(key)) {
          continue;
        }
        seenLines.add(key);
        lines.push({
          label: metric.label,
          category: metric.category,
          excerpt: excerpt.slice(0, 320),
          pageNumber,
        });
      }
    }
  }

  const auditorConclusion = isAuditorReview ? findAuditorConclusion(pages) : null;
  const financialCategories = [
    "Wyniki",
    "Bilans",
    "Przepływy pieniężne",
  ] as const;
  const categoryCoverage = financialCategories.map((category) => ({
    category,
    labels: [...new Set(
      lines.filter((line) => line.category === category).map((line) => line.label),
    )],
  }));
  const documentLabel = documentKind === "auditor-review"
    ? "Raport biegłego rewidenta z przeglądu"
    : documentKind === "financial-statements"
      ? "Sprawozdanie finansowe"
      : "Dokument do sprawdzenia";
  const limitation = documentKind === "auditor-review"
    ? "To raport z przeglądu, a nie pełne sprawozdanie finansowe. Wniosek biegłego dotyczy zgodności prezentacji z właściwymi zasadami rachunkowości; nie jest opinią z badania ani oceną wyników spółki."
    : documentKind === "financial-statements" && lines.length > 0
      ? "Poniżej pokazano oryginalne wiersze rozpoznane w podsumowaniu lub głównych tabelach sprawozdania. Odczyt nie normalizuje jednostek ani nie gwarantuje poprawnego przypisania kolumn — każdą wartość należy porównać ze wskazaną stroną oryginału."
      : documentKind === "financial-statements"
        ? "Rozpoznano nagłówki sprawozdania, ale nie udało się pewnie wydobyć najważniejszych liczbowych wierszy. Układ tabel może wymagać weryfikacji albo ręcznego odczytu."
        : "Nie udało się potwierdzić, że dokument zawiera pełne sprawozdanie finansowe. Liczby należy sprawdzić w oryginalnym PDF.";

  return {
    documentKind,
    documentLabel,
    companyName: findCompanyName(allText),
    reportingPeriod: findReportingPeriod(allText),
    lines,
    categoryCoverage,
    auditorConclusion,
    limitation,
  };
}

export function compareFinancialLines(
  current: FinancialDocumentSummary,
  comparison: FinancialDocumentSummary,
): ComparedFinancialLine[] {
  if (
    current.documentKind !== "financial-statements" ||
    comparison.documentKind !== "financial-statements"
  ) {
    return [];
  }

  const comparisonLines = new Map<string, FinancialLine[]>();
  for (const line of comparison.lines) {
    const key = `${line.category}:${line.label}`;
    const entries = comparisonLines.get(key) ?? [];
    entries.push(line);
    comparisonLines.set(key, entries);
  }

  const currentCounts = new Map<string, number>();
  for (const line of current.lines) {
    const key = `${line.category}:${line.label}`;
    currentCounts.set(key, (currentCounts.get(key) ?? 0) + 1);
  }

  return current.lines.flatMap((line) => {
    const key = `${line.category}:${line.label}`;
    const matchingLines = comparisonLines.get(key) ?? [];
    if (currentCounts.get(key) !== 1 || matchingLines.length !== 1) {
      return [];
    }
    const comparisonLine = matchingLines[0];
    return [{ label: line.label, current: line, comparison: comparisonLine }];
  });
}
