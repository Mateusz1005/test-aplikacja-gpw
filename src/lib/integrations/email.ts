import "server-only";

type PasswordResetEmail = {
  from: string;
  resetUrl: string;
  to: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendPasswordResetEmail({
  from,
  resetUrl,
  to,
}: PasswordResetEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error("Brakuje serwerowego klucza dostawcy poczty.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Link do zmiany hasła — GPW Analiza",
      text: `Aby zmienić hasło do GPW Analiza, otwórz ten jednorazowy link: ${resetUrl}\n\nJeśli nie prosiłeś(-aś) o zmianę hasła, zignoruj tę wiadomość.`,
      html: `<p>Otrzymaliśmy prośbę o zmianę hasła do GPW Analiza.</p><p><a href="${escapeHtml(resetUrl)}">Ustaw nowe hasło</a></p><p>Link jest jednorazowy i wygasa po czasie skonfigurowanym w Supabase Auth.</p><p>Jeśli nie prosiłeś(-aś) o zmianę hasła, zignoruj tę wiadomość.</p>`,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const responseBody = await response.text();
    console.error("Dostawca poczty odrzucił wysyłkę e-maila.", {
      status: response.status,
      response: responseBody.slice(0, 1000),
    });
    throw new Error(`Nie udało się wysłać wiadomości e-mail (HTTP ${response.status}).`);
  }
}
