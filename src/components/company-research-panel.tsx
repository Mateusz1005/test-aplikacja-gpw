import {
  getResearchCutoff,
  isRelevantCompanyTitle,
  searchRecentGoogleNewsVariants,
  type ResearchItem,
  type ResearchFeed,
} from "@/lib/research/google-news";
import {
  compareAnalystEvidence,
  hasPublicAnalystExcerpt,
} from "@/lib/research/analyst-comparison";

type CompanyResearchPanelProps = {
  companyName: string;
  ticker: string;
  officialSourceUrl: string;
  investorRelationsUrl: string | null;
  nextReportingDate: string | null;
  nextReportingSourceUrl: string | null;
  nextReportingVerifiedAt: string | null;
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeZone: "Europe/Warsaw",
  }).format(new Date(value));
}

function formatCheckTime(value: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  }).format(new Date(value));
}

function isPastDate(value: string): boolean {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Warsaw",
  }).format(new Date());
  return value < today;
}

function searchUrl(query: string): string {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  return url.toString();
}

function relevantFeed(
  feed: ResearchFeed,
  companyName: string,
  ticker: string,
  kind?: "analyst" | "video",
): ResearchFeed {
  return {
    ...feed,
    items: feed.items
      .filter((item) =>
        isRelevantCompanyTitle(item.title, companyName, ticker) &&
        (kind !== "analyst" || isAnalystMaterial(item)) &&
        (kind !== "video" || isVideoMaterial(item)),
      )
      .slice(0, kind === "analyst" ? 18 : 6),
  };
}

function isAnalystMaterial(item: ResearchItem): boolean {
  return /anality|prognoz|rekomend|rating|domu maklersk|broker|target price|szacunk/i.test(
    `${item.title} ${item.source}`,
  );
}

function isVideoMaterial(item: ResearchItem): boolean {
  return /youtube|wideo|video|podcast|webinar|wywiad|om[oó]wien/i.test(
    `${item.title} ${item.source}`,
  );
}

function isReportingScheduleMaterial(item: ResearchItem): boolean {
  return /kalendarz|terminarz|termin.{0,20}publik|dat.{0,20}publik|harmonogram/i.test(
    `${item.title} ${item.source}`,
  );
}

function analystCategory(item: ResearchItem): "Prognozy i szacunki" | "Rekomendacje i oceny" | "Komentarze" {
  const text = `${item.title} ${item.source}`;
  if (/prognoz|szacunk|target price/i.test(text)) {
    return "Prognozy i szacunki";
  }
  if (/rekomend|rating/i.test(text)) {
    return "Rekomendacje i oceny";
  }
  return "Komentarze";
}

function ResearchList({
  feed,
  emptyMessage,
}: {
  feed: ResearchFeed;
  emptyMessage: string;
}) {
  if (!feed.available) {
    return (
      <p className="search-hint">
        Nie udało się pobrać wyników z Google News. Otwórz wyszukiwanie źródłowe
        poniżej i zweryfikuj materiały bezpośrednio u wydawcy.
      </p>
    );
  }

  if (feed.items.length === 0) {
    return (
      <>
        <p className="search-hint">{emptyMessage}</p>
        {feed.checkedAt && (
          <p className="research-feed-freshness">
            Google News RSS · sprawdzono {formatCheckTime(feed.checkedAt)}
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <ul className="research-item-list">
        {feed.items.map((item) => (
          <li key={`${item.url}-${item.publishedAt}`}>
            <a href={item.url} rel="noreferrer" target="_blank">{item.title}</a>
            <span>
              {item.source} · {formatDate(item.publishedAt)} · Niepewne
            </span>
          </li>
        ))}
      </ul>
      {feed.checkedAt && (
        <p className="research-feed-freshness">
          Google News RSS · sprawdzono {formatCheckTime(feed.checkedAt)}
        </p>
      )}
    </>
  );
}

export default async function CompanyResearchPanel({
  companyName,
  ticker,
  officialSourceUrl,
  investorRelationsUrl,
  nextReportingDate,
  nextReportingSourceUrl,
  nextReportingVerifiedAt,
}: CompanyResearchPanelProps) {
  const afterDate = getResearchCutoff(new Date()).toISOString().slice(0, 10);
  const companyQuery = `"${companyName}"`;
  const tickerQuery = ticker;
  const searchVariants = (terms: string) => [
    `${companyQuery} ${terms}`,
    `${tickerQuery} ${terms}`,
  ];

  const [newsResults, analystResults, videoResults, reportingResults] = await Promise.all([
    searchRecentGoogleNewsVariants(
      [`${companyQuery}`, `${tickerQuery}`],
      new Date(),
    ),
    searchRecentGoogleNewsVariants(
      searchVariants("(prognoza OR analitycy OR rekomendacja OR rating OR komentarz analityczny)"),
      new Date(),
    ),
    searchRecentGoogleNewsVariants(
      searchVariants("(YouTube OR wideo OR video OR podcast OR webinar OR wywiad OR omówienie)"),
      new Date(),
    ),
    searchRecentGoogleNewsVariants(
      searchVariants("(kalendarz OR terminarz OR harmonogram) (publikacji raportów OR raportów okresowych)"),
      new Date(),
    ),
  ]);
  const news = relevantFeed(newsResults, companyName, ticker);
  const analystFeed = relevantFeed(analystResults, companyName, ticker, "analyst");
  const analystCommentary = {
    ...analystFeed,
    items: analystFeed.items.filter(hasPublicAnalystExcerpt),
  };
  const analystComparison = compareAnalystEvidence(analystCommentary.items);
  const videoItems = relevantFeed(videoResults, companyName, ticker, "video");
  const reportingSchedule = {
    ...reportingResults,
    items: reportingResults.items
      .filter((item) =>
        isRelevantCompanyTitle(item.title, companyName, ticker) &&
        isReportingScheduleMaterial(item),
      )
      .slice(0, 5),
  };
  const relationSearch = searchUrl(`${companyName} ${ticker} relacje inwestorskie`);
  const reportingSearch = searchUrl(
    `site:gpw.pl "${companyName}" kalendarz publikacji raportów`,
  );
  const newsSearch = searchUrl(`${companyName} ${ticker} wiadomości`);
  const analystSearch = searchUrl(`${companyName} ${ticker} prognozy analityków dom maklerski`);
  const videoSearch = new URL("https://www.google.com/search");
  videoSearch.searchParams.set("tbm", "vid");
  videoSearch.searchParams.set(
    "q",
    `("${companyName}" OR ${ticker}) omówienie raportu after:${afterDate}`,
  );
  videoSearch.searchParams.set("tbs", "qdr:m6");

  return (
    <section aria-label={`Informacje o spółce ${ticker}`} className="company-research">
      <h4>Informacje i źródła</h4>
      <div className="research-source-links">
        <a href={investorRelationsUrl ?? relationSearch} rel="noreferrer" target="_blank">
          {investorRelationsUrl
            ? "Oficjalne relacje inwestorskie"
            : "Wyszukaj relacje inwestorskie (link niepotwierdzony)"}
        </a>
        <a href={officialSourceUrl} rel="noreferrer" target="_blank">
          Lista spółek GPW
        </a>
        <a href={reportingSearch} rel="noreferrer" target="_blank">
          Sprawdź kalendarz raportów na GPW
        </a>
      </div>
      <p className="dashboard-data-note">
        {investorRelationsUrl
          ? "Adres relacji inwestorskich pochodzi z katalogu spółek."
          : "Katalog nie zawiera potwierdzonego adresu relacji inwestorskich; pokazane wyszukiwanie nie jest oficjalnym linkiem. "}
        Kapitalizacja i wartości rynkowe nie są prezentowane.
      </p>

      <div className="research-feed">
        <h5>Najnowsze informacje</h5>
        <ResearchList
          emptyMessage="Nie znaleziono pasujących materiałów z ostatnich sześciu miesięcy."
          feed={news}
        />
        <a href={newsSearch} rel="noreferrer" target="_blank">
          Otwórz wyszukiwanie wiadomości
        </a>
      </div>

      <div className="research-feed">
        <h5>Komentarze i prognozy analityków</h5>
        <p className="search-hint">
          Pokazujemy tylko zajawki dostępne publicznie w feedzie; materiały
          sygnalizujące dostęp płatny są pomijane. Nie pobieramy ani nie
          kopiujemy pełnych publikacji. Sam nagłówek nie jest podstawą
          porównania, a dostępność pełnego artykułu w serwisie wydawcy może się
          różnić. Porównuj wartości bezpośrednio w źródłach;
          rozbieżne prognozy nie są uśredniane ani zamieniane w rekomendację.
          Aplikacja nie omija paywalli.
        </p>
        {analystComparison.evidence.length > 0 ? (
          <section aria-label="Porównanie przesłanek analityków" className="analyst-evidence">
            <h6>Co może różnić podejścia?</h6>
            {analystComparison.hasComparableEvidence ? (
              <>
                <p className="search-hint">
                  W publicznie widocznych zajawkach z różnych źródeł pojawiają
                  się odmienne akcenty. To porównanie treści zajawek, nie dowód
                  na różne założenia modeli ani pełna analiza raportów.
                </p>
                <ul className="analyst-difference-list">
                  {analystComparison.differingThemes.map(({ theme, sources }) => (
                    <li key={theme}>
                      <strong>{theme}</strong>
                      <span>Widoczne w: {sources.join(", ")}</span>
                    </li>
                  ))}
                  {analystComparison.sharedThemes.length > 0 && (
                    <li>
                      <strong>Wspólne akcenty</strong>
                      <span>{analystComparison.sharedThemes.join(", ")}</span>
                    </li>
                  )}
                </ul>
              </>
            ) : (
              <p className="search-hint">
                Brak wystarczających publicznych zajawek z co najmniej dwóch
                źródeł, by porównać przesłanki. Tytuły bez treści są pomijane;
                aplikacja nie dopowiada przyczyn rozbieżności.
              </p>
            )}
            <ul className="analyst-evidence-list">
              {analystComparison.evidence.map(({ item, excerpt, themes }) => (
                <li key={`${item.url}-${item.publishedAt}`}>
                  <strong>{analystCategory(item)}</strong>
                  <a href={item.url} rel="noreferrer" target="_blank">{item.title}</a>
                  <span>{item.source} · {formatDate(item.publishedAt)} · Niepewne</span>
                  {excerpt ? (
                    <blockquote>{excerpt}</blockquote>
                  ) : (
                    <p className="search-hint">
                      Brak dostępnej zajawki; widoczny jest tylko nagłówek.
                    </p>
                  )}
                  {themes.length > 0 ? (
                    <span>Tematy z tytułu i zajawki: {themes.join(", ")}</span>
                  ) : (
                    <span>Nie rozpoznano konkretnej przesłanki w tytule ani zajawce.</span>
                  )}
                </li>
              ))}
            </ul>
            {analystCommentary.checkedAt && (
              <p className="research-feed-freshness">
                Google News RSS · sprawdzono {formatCheckTime(analystCommentary.checkedAt)}
              </p>
            )}
          </section>
        ) : (
          <ResearchList
            emptyMessage="Brak pasujących prognoz, rekomendacji lub komentarzy w pobranym feedzie. Sprawdź wyniki wyszukiwania."
            feed={analystCommentary}
          />
        )}
        <a href={analystSearch} rel="noreferrer" target="_blank">
          Szukaj prognoz i komentarzy
        </a>
      </div>

      <div className="research-feed">
        <h5>Materiały do obejrzenia</h5>
        <ResearchList
          emptyMessage="Nie znaleziono pasujących filmów z ostatnich sześciu miesięcy."
          feed={videoItems}
        />
        <a href={videoSearch.toString()} rel="noreferrer" target="_blank">
          Otwórz wyniki wyszukiwania wideo z ostatnich sześciu miesięcy
        </a>
        <p className="search-hint">
          Linki prowadzą do materiałów lub wyników wyszukiwania. Treść filmów
          nie jest kopiowana ani analizowana.
        </p>
      </div>

      <div className="research-feed">
        <h5>Najbliższe sprawozdanie finansowe</h5>
        {nextReportingDate && nextReportingSourceUrl && nextReportingVerifiedAt ? (
          <>
            <p className="search-hint">
              Termin podany przez emitenta lub źródło GPW · Pewne na dzień
              weryfikacji:{" "}
              <strong>{formatDate(nextReportingDate)}</strong>. Informację
              sprawdzono {formatDate(nextReportingVerifiedAt)}.
              {isPastDate(nextReportingDate) &&
                " Podany termin już minął — sprawdź aktualny harmonogram."}
            </p>
            <a href={nextReportingSourceUrl} rel="noreferrer" target="_blank">
              Otwórz źródło terminu raportu
            </a>
          </>
        ) : null}
        {reportingSchedule.items.length > 0 ? (
          <>
            <p className="search-hint">
              Automatycznie znalezione publikacje o harmonogramie — to nie jest
              potwierdzenie terminu spółki. Data przy linku oznacza publikację
              materiału, nie dzień raportu.
            </p>
            <ResearchList
              emptyMessage=""
              feed={reportingSchedule}
            />
          </>
        ) : (
          <p className="search-hint">
            {nextReportingDate && nextReportingSourceUrl
              ? "Nie znaleziono dodatkowych aktualnych zapowiedzi harmonogramu."
              : reportingResults.available
                ? "Nie znaleziono aktualnej zapowiedzi harmonogramu w automatycznie sprawdzonym feedzie."
                : "Nie udało się automatycznie pobrać zapowiedzi harmonogramu."}{" "}
            Daty nie są wyliczane z poprzednich okresów.{" "}
            <a href={reportingSearch} rel="noreferrer" target="_blank">
              Otwórz wyszukiwanie kalendarza raportów
            </a>
            .
          </p>
        )}
        {!nextReportingDate && reportingSchedule.items.length === 0 && (
          <p className="search-hint">
            Brak pokrycia analitycznego dla terminu następnego raportu: nie
            znaleziono potwierdzonej daty ani aktualnej zapowiedzi w źródłach.
          </p>
        )}
      </div>
    </section>
  );
}
