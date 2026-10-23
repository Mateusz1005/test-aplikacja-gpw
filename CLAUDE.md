# Instrukcje dla Claude — GPW Analiza

## Zasady pracy

- Najpierw sprawdzaj bieżące pliki, migracje i testy. Małe, powiązane zmiany
  wdrażaj etapami.
- Zmiany dotyczące logowania, sesji, resetu hasła, uprawnień, płatności,
  migracji albo RLS wymagają najpierw przedstawienia planu i uzyskania zgody
  właściciela aplikacji.
- Po zmianach uruchom najwęższe właściwe testy, `npm run lint`,
  `npm run typecheck` i `npm run build`.
- Nie wykonuj zdalnej migracji ani wdrożenia produkcyjnego bez wyraźnej zgody
  właściciela. Do zdalnego Supabase używaj lokalnie uwierzytelnionego CLI; nie
  proś o wklejanie haseł do bazy ani kluczy uprzywilejowanych do rozmowy.
- Nie twórz ani nie ujawniaj przykładowych prawdziwych danych, poświadczeń,
  kluczy czy tokenów. Sekrety należą do `.env.local` lub menedżera sekretów,
  nigdy do kodu, `NEXT_PUBLIC_*`, README ani commita.

## Architektura i granice zaufania

- Aplikacja: Next.js App Router, TypeScript, Supabase Auth/Postgres/RLS.
- `SUPABASE_SERVICE_ROLE_KEY` wolno importować wyłącznie w modułach
  serwerowych oznaczonych `server-only`; nigdy w komponentach klienta, `proxy`
  ani zmiennych `NEXT_PUBLIC_*`.
- W każdej Server Action i chronionej stronie sprawdzaj uwierzytelnionego
  użytkownika i wymagany dostęp/rolę po stronie serwera. Proxy odświeża sesję,
  ale samo nie jest granicą autoryzacji.
- Sesje używają ciasteczek `HttpOnly`, `SameSite=Lax` oraz `Secure` w produkcji.
  Nie przechowuj tokenów w `localStorage`.
- Wszystkie tabele zawierające prywatne dane muszą mieć włączone RLS,
  minimalne granty i testy pokazujące izolację dwóch użytkowników.
- Operacje administratora są serwerowe, audytowane i muszą ponownie sprawdzać
  rolę `admin`. Użytkownik nie może sam nadać sobie roli ani dostępu.
- Usuwanie lub blokowanie kont administratorów przez panel jest niedozwolone.
- Rejestruj tylko potrzebne zdarzenia. Nie zapisuj adresu IP w historii
  logowań, o ile właściciel nie zatwierdzi odrębnie potrzeby i retencji.

## Hasła i wiadomości e-mail

- Reset hasła nie może ujawniać, czy konto istnieje. Komunikat dla
  nieistniejącego i istniejącego konta pozostaje taki sam.
- Używaj jednorazowego, krótkotrwałego recovery Supabase Auth; nie zapisuj ani
  nie loguj jawnych tokenów, linków resetu ani haseł. Supabase Auth odpowiada
  za zapis skrótu tokenu i jednorazowe użycie.
- Po zmianie hasła globalnie unieważnij sesje i wymagaj ponownego logowania.
- E-maile wysyłaj przez `src/lib/integrations/email.ts`. Klucz Resend jest
  sekretem serwerowym, a adres nadawcy musi być zapisany w konfiguracji
  administratora i pochodzić ze zweryfikowanej domeny.
- Błędy loguj bez sekretów i bez tokenów. Nie ukrywaj awarii usług jako
  pomyślnego wyniku; przy resetach hasła zachowaj jednak ten sam komunikat
  zewnętrzny ze względu na ochronę przed enumeracją kont.

## Dostęp i triale

- Nowe konto dostaje 7 dni dostępu `trial` bez subskrypcji; adres e-mail może
  otrzymać taki trial tylko raz, także po usunięciu konta.
- `subscription_trial` ma domyślnie 30 dni. Integracja płatności nie jest
  jeszcze zaimplementowana; status subskrypcji nadaje administrator.
- Dostęp ręczny trwa domyślnie 30 dni, może być przedłużony lub bezterminowy.
- Admin może zablokować konto; wygaśnięcie terminu samo blokuje dostęp bez
  konieczności okresowego zadania zmieniającego bazę.
- Zmiany statusu dostępu zapisuj w `admin_audit_log`.

## Migracje i testy

- Każdą nową zmianę schematu dodaj jako kolejną migrację
  `supabase/migrations/YYYYMMDDHHMMSS_opis.sql`; nie edytuj już wdrożonych
  migracji.
- Rozważ bezpieczny backfill, unikalność, klucze obce, retencję i migrację
  zwrotną przed zastosowaniem.
- Dodawaj lub aktualizuj testy SQL/pgtap dla RLS: właściciel, inny użytkownik,
  niezalogowany użytkownik, administrator oraz odmowa samodzielnego nadania
  uprawnień.
- Migracje testuj na lokalnym Supabase przed wdrożeniem zdalnym.
- Raportuj dokładnie, jeśli test wymaga Supabase CLI, Dockera, poświadczeń lub
  zewnętrznej konfiguracji, których brak.

## Wymagania produktowe

- Interfejs i teksty dla użytkownika są po polsku.
- Nigdy nie pobieraj ani nie pokazuj cen akcji, wartości indeksów, obrotów czy
  wycen rynkowych.
- Dane finansowe muszą pochodzić z dokumentów źródłowych lub deterministycznych
  obliczeń. AI nie generuje liczb.
- Każda informacja wymaga daty, źródła i etykiety `Pewne` albo `Niepewne`.
- Nie formułuj rekomendacji kupna, sprzedaży ani indywidualnej porady
  inwestycyjnej.
