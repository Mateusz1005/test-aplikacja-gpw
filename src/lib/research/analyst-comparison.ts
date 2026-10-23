import type { ResearchItem } from "@/lib/research/google-news";

export const analystThemes = [
  "Popyt i sprzedaż",
  "Marże i koszty",
  "Kontrakty i realizacja",
  "Inwestycje i rozwój",
  "Zadłużenie i płynność",
  "Strategia i cele",
  "Otoczenie i regulacje",
  "Wyniki finansowe",
] as const;

export type AnalystTheme = (typeof analystThemes)[number];

export type AnalystEvidence = {
  item: ResearchItem;
  excerpt: string | null;
  themes: AnalystTheme[];
};

export type AnalystThemeDifference = {
  theme: AnalystTheme;
  sources: string[];
};

export type AnalystComparison = {
  evidence: AnalystEvidence[];
  sharedThemes: AnalystTheme[];
  differingThemes: AnalystThemeDifference[];
  hasComparableEvidence: boolean;
};

export type PrivateForecastComparison = {
  privateThemes: AnalystTheme[];
  publicThemes: AnalystTheme[];
  sharedThemes: AnalystTheme[];
  privateOnlyThemes: AnalystTheme[];
  publicOnlyThemes: AnalystTheme[];
  evidence: AnalystEvidence[];
  hasComparableEvidence: boolean;
};

const accessRestrictionPattern =
  /paywall|subskrypc|abonament|tre[śs][ćc].{0,30}p[łl]atn|dost[ęe]p.{0,30}p[łl]atn|premium|zaloguj si[ęe]|wykup dost[ęe]p/i;

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pl-PL");
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function themesInText(value: string): AnalystTheme[] {
  const text = normalizeText(value);
  const themes: AnalystTheme[] = [];
  if (hasAny(text, ["popyt", "sprzedaz", "przychod", "wolumen", "klient", "zamowien"])) {
    themes.push("Popyt i sprzedaż");
  }
  if (hasAny(text, ["marz", "koszt", "rentown", "ebitda", "inflac", "wynagrodz"])) {
    themes.push("Marże i koszty");
  }
  if (hasAny(text, ["kontrakt", "backlog", "portfel zamowien", "przetarg", "realizac"])) {
    themes.push("Kontrakty i realizacja");
  }
  if (hasAny(text, ["inwestyc", "capex", "rozbudow", "akwizyc", "przejec", "moc produk"])) {
    themes.push("Inwestycje i rozwój");
  }
  if (hasAny(text, ["zadluz", "dlug", "plynnosc", "przeplyw pien", "refinans", "kredyt"])) {
    themes.push("Zadłużenie i płynność");
  }
  if (hasAny(text, ["strateg", "zarzad", "cel", "plan", "guidance"])) {
    themes.push("Strategia i cele");
  }
  if (
    hasAny(text, ["regulac", "ustaw", "kurs walut", "stopy procent", "podatk"]) ||
    /(^|[^a-z])(eur|usd)([^a-z]|$)/.test(text)
  ) {
    themes.push("Otoczenie i regulacje");
  }
  if (hasAny(text, ["wynik", "zysk", "strat", "raport", "earnings", "prognoz", "szacunk"])) {
    themes.push("Wyniki finansowe");
  }
  return themes;
}

function cleanExcerpt(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const excerpt = value.replace(/\s+/g, " ").trim();
  return excerpt.length >= 24 ? excerpt.slice(0, 360) : null;
}

export function hasPublicAnalystExcerpt(item: ResearchItem): boolean {
  const excerpt = cleanExcerpt(item.description);
  return excerpt !== null &&
    !accessRestrictionPattern.test(`${item.title} ${item.source} ${excerpt}`);
}

export function compareAnalystEvidence(items: ResearchItem[]): AnalystComparison {
  const evidence = items.map((item) => {
    const excerpt = cleanExcerpt(item.description);
    return {
      item,
      excerpt,
      themes: [...new Set(themesInText(excerpt ?? ""))],
    };
  });
  const themesBySource = new Map<string, Set<AnalystTheme>>();
  for (const entry of evidence) {
    const themes = themesBySource.get(entry.item.source) ?? new Set<AnalystTheme>();
    entry.themes.forEach((theme) => themes.add(theme));
    themesBySource.set(entry.item.source, themes);
  }

  const sourceEntries = [...themesBySource.entries()].filter(([, themes]) => themes.size > 0);
  const sharedThemes = analystThemes.filter(
    (theme) => sourceEntries.length >= 2 && sourceEntries.every(([, themes]) => themes.has(theme)),
  );
  const differingThemes = analystThemes.flatMap((theme) => {
    const sources = sourceEntries
      .filter(([, themes]) => themes.has(theme))
      .map(([source]) => source);
    return sources.length > 0 && sources.length < sourceEntries.length
      ? [{ theme, sources }]
      : [];
  });

  return {
    evidence,
    sharedThemes,
    differingThemes,
    hasComparableEvidence: sourceEntries.length >= 2 && differingThemes.length > 0,
  };
}

export function comparePrivateForecast(
  privateText: string,
  publicItems: ResearchItem[],
): PrivateForecastComparison {
  const privateThemes = [...new Set(themesInText(privateText))];
  const publicComparison = compareAnalystEvidence(
    publicItems.filter(hasPublicAnalystExcerpt),
  );
  const publicThemes = analystThemes.filter((theme) =>
    publicComparison.evidence.some((entry) => entry.themes.includes(theme)),
  );
  const sharedThemes = privateThemes.filter((theme) => publicThemes.includes(theme));
  const privateOnlyThemes = privateThemes.filter((theme) => !publicThemes.includes(theme));
  const publicOnlyThemes = publicThemes.filter((theme) => !privateThemes.includes(theme));

  return {
    privateThemes,
    publicThemes,
    sharedThemes,
    privateOnlyThemes,
    publicOnlyThemes,
    evidence: publicComparison.evidence,
    hasComparableEvidence: privateThemes.length > 0 && publicThemes.length > 0,
  };
}
