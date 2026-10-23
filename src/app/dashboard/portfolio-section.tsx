"use client";

import { addPortfolioEntry, removePortfolioEntry } from "./actions";

export type PortfolioEntry = {
  id: string;
  ticker: string;
  asset_type: "stock" | "etf";
  entry_type: "investment" | "dividend";
  event_date: string;
  units: number | string | null;
  investment_amount: number | string | null;
  commission_amount: number | string | null;
  dividend_amount: number | string | null;
};

type PortfolioSectionProps = {
  entries: PortfolioEntry[];
  error: string;
  today: string;
};

type ChartPoint = {
  date: string;
  invested: number;
  withDividends: number;
};

const chart = {
  width: 640,
  height: 240,
  left: 58,
  right: 12,
  top: 18,
  bottom: 36,
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeZone: "Europe/Warsaw",
  }).format(new Date(`${value}T12:00:00Z`));
}

function buildChartPoints(entries: PortfolioEntry[]): ChartPoint[] {
  const points: ChartPoint[] = [];
  let invested = 0;
  let dividends = 0;

  for (const entry of entries) {
    if (entry.entry_type === "investment") {
      invested += Number(entry.investment_amount) + Number(entry.commission_amount);
    } else {
      dividends += Number(entry.dividend_amount);
    }

    const previous = points.at(-1);
    const point = {
      date: entry.event_date,
      invested,
      withDividends: invested + dividends,
    };
    if (previous?.date === entry.event_date) {
      points[points.length - 1] = point;
    } else {
      points.push(point);
    }
  }

  return points;
}

function chartLine(points: ChartPoint[], value: (point: ChartPoint) => number, max: number): string {
  const plotWidth = chart.width - chart.left - chart.right;
  const plotHeight = chart.height - chart.top - chart.bottom;
  return points.map((point, index) => {
    const x = points.length < 2
      ? chart.left + plotWidth / 2
      : chart.left + (index / (points.length - 1)) * plotWidth;
    const y = chart.top + plotHeight - (value(point) / max) * plotHeight;
    return `${x},${y}`;
  }).join(" ");
}

export default function PortfolioSection({
  entries,
  error,
  today,
}: PortfolioSectionProps) {
  const points = buildChartPoints(entries);
  const maximum = Math.max(
    1,
    ...points.flatMap((point) => [point.invested, point.withDividends]),
  );
  const investedPath = chartLine(points, (point) => point.invested, maximum);
  const dividendPath = chartLine(points, (point) => point.withDividends, maximum);
  const latest = points.at(-1);
  const portfolioError = error === "portfolio-invalid"
    ? "Sprawdź ticker, datę, ilość i kwoty. Data nie może być z przyszłości."
    : error === "portfolio-save"
      ? "Nie udało się zapisać wpisu. Spróbuj ponownie."
      : "";

  return (
    <section aria-labelledby="portfolio-title" className="dashboard-section" id="portfolio">
      <div className="dashboard-section-heading">
        <div>
          <span className="eyebrow">03 · TWOJE WPŁATY I DYWIDENDY</span>
          <h2 id="portfolio-title">Portfel</h2>
        </div>
        <span className="section-caption">Prywatny rejestr dla Twojego konta</span>
      </div>
      <p className="dashboard-data-note">
        Wykres pokazuje wyłącznie wpłacony kapitał (z prowizją) oraz ten kapitał
        powiększony o zapisane dywidendy. Nie jest to wycena portfela ani
        aktualna wartość aktywów. Aplikacja nie pobiera cen akcji ani ETF-ów.
      </p>

      {portfolioError && <p className="notice notice-error" role="alert">{portfolioError}</p>}

      {entries.length === 0 ? (
        <p className="dashboard-empty">Dodaj pierwszy zakup lub otrzymaną dywidendę.</p>
      ) : (
        <>
          <div className="portfolio-chart-summary">
            <div>
              <span>Wpłacony kapitał z prowizjami</span>
              <strong>{formatMoney(latest?.invested ?? 0)}</strong>
            </div>
            <div>
              <span>Kapitał i otrzymane dywidendy</span>
              <strong>{formatMoney(latest?.withDividends ?? 0)}</strong>
            </div>
          </div>
          <figure className="portfolio-chart">
            <svg
              aria-label="Wykres sumy wpłat i sumy wpłat powiększonej o otrzymane dywidendy"
              role="img"
              viewBox={`0 0 ${chart.width} ${chart.height}`}
            >
              {[0, 0.5, 1].map((fraction) => {
                const y = chart.top + (chart.height - chart.top - chart.bottom) * (1 - fraction);
                return (
                  <g key={fraction}>
                    <line
                      className="portfolio-chart-grid"
                      x1={chart.left}
                      x2={chart.width - chart.right}
                      y1={y}
                      y2={y}
                    />
                    <text className="portfolio-chart-axis" x={chart.left - 8} y={y + 4} textAnchor="end">
                      {formatMoney(maximum * fraction)}
                    </text>
                  </g>
                );
              })}
              {points.length > 0 && (
                <>
                  <polyline className="portfolio-chart-invested" points={investedPath} />
                  <polyline className="portfolio-chart-dividends" points={dividendPath} />
                </>
              )}
              {points.length > 0 && (
                <>
                  <text className="portfolio-chart-axis" x={chart.left} y={chart.height - 8}>
                    {formatDate(points[0].date)}
                  </text>
                  <text
                    className="portfolio-chart-axis"
                    x={chart.width - chart.right}
                    y={chart.height - 8}
                    textAnchor="end"
                  >
                    {formatDate(points.at(-1)!.date)}
                  </text>
                </>
              )}
            </svg>
            <figcaption>
              <span><i className="portfolio-legend-invested" />Wpłacony kapitał z prowizjami</span>
              <span><i className="portfolio-legend-dividends" />Wpłaty i otrzymane dywidendy</span>
            </figcaption>
          </figure>
        </>
      )}

      <div className="portfolio-entry-forms">
        <form action={addPortfolioEntry} className="portfolio-form">
          <h3>Dodaj zakup</h3>
          <input name="entry_type" type="hidden" value="investment" />
          <label>
            Ticker
            <input autoComplete="off" maxLength={20} name="ticker" placeholder="np. KGH" required />
          </label>
          <label>
            Rodzaj instrumentu
            <select defaultValue="stock" name="asset_type">
              <option value="stock">Akcja</option>
              <option value="etf">ETF</option>
            </select>
          </label>
          <label>
            Data zakupu
            <input defaultValue={today} max={today} name="event_date" required type="date" />
          </label>
          <label>
            Ilość sztuk
            <input min="0.000001" name="units" required step="0.000001" type="number" />
          </label>
          <label>
            Kwota inwestycji (PLN)
            <input min="0.01" name="investment_amount" required step="0.01" type="number" />
          </label>
          <label>
            Prowizja (PLN)
            <input defaultValue="0" min="0" name="commission_amount" required step="0.01" type="number" />
          </label>
          <button className="button button-primary" type="submit">Zapisz zakup</button>
        </form>

        <form action={addPortfolioEntry} className="portfolio-form">
          <h3>Dodaj dywidendę</h3>
          <input name="entry_type" type="hidden" value="dividend" />
          <label>
            Ticker
            <input autoComplete="off" maxLength={20} name="ticker" placeholder="np. KGH" required />
          </label>
          <label>
            Rodzaj instrumentu
            <select defaultValue="stock" name="asset_type">
              <option value="stock">Akcja</option>
              <option value="etf">ETF</option>
            </select>
          </label>
          <label>
            Data otrzymania
            <input defaultValue={today} max={today} name="event_date" required type="date" />
          </label>
          <label>
            Otrzymana kwota (PLN)
            <input min="0.01" name="dividend_amount" required step="0.01" type="number" />
          </label>
          <button className="button button-primary" type="submit">Zapisz dywidendę</button>
        </form>
      </div>

      {entries.length > 0 && (
        <div className="portfolio-history">
          <h3>Historia</h3>
          <ul>
            {[...entries].reverse().map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{entry.ticker} · {entry.asset_type === "etf" ? "ETF" : "akcja"}</strong>
                  <span>
                    {entry.entry_type === "investment"
                      ? `Zakup: ${formatMoney(Number(entry.investment_amount) + Number(entry.commission_amount))} z prowizją · ${entry.units} szt.`
                      : `Dywidenda: ${formatMoney(Number(entry.dividend_amount))}`}
                    {" · "}{formatDate(entry.event_date)}
                  </span>
                </div>
                <form action={removePortfolioEntry}>
                  <input name="entry_id" type="hidden" value={entry.id} />
                  <button aria-label={`Usuń wpis ${entry.ticker} z dnia ${entry.event_date}`} className="button button-quiet" type="submit">
                    Usuń
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
