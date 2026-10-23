# GPW Analiza

Wieloużytkownikowa aplikacja webowa do katalogowania spółek GPW i rozwijania
analiz opartych na raportach oraz oficjalnych źródłach. Odczytuje wybrane
pozycje ze sprawozdań PDF i pozwala zestawić surowe wiersze z drugim dokumentem,
ale nie tworzy pełnej analizy narracyjnej ani nie aktualizuje automatycznie
wspólnej analizy spółki. Aplikacja nie pobiera ani nie wyświetla kursów,
obrotów, wartości indeksów ani wycen rynkowych.

## Wymagania

- Node.js 20.9 lub nowszy
- Projekt Supabase
- Konto Resend ze zweryfikowaną domeną nadawcy (wysyłanie resetów haseł)

## Konfiguracja Supabase

1. Zaloguj się do Supabase CLI w terminalu: `supabase login`.
2. Skopiuj `.env.example` do `.env.local`.
3. W panelu Supabase, w **Project Settings → API**, skopiuj Project URL,
   klucz publiczny `publishable` oraz klucz serwerowy `service_role` do
   odpowiednich wpisów w `.env.local`. Klucza `service_role` nigdy nie dodawaj
   do `NEXT_PUBLIC_*`, kodu frontendu ani repozytorium. Jeśli włączysz
   harmonogram RSS, ustaw też własny, losowy `RESEARCH_MONITOR_CRON_SECRET`
   (minimum 32 znaki) i przechowuj go wyłącznie w sekretach serwera.
4. Ustaw `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.
5. W `INITIAL_ADMIN_EMAIL` wpisz swój adres e-mail. Zarejestruj konto tym
   adresem i potwierdź je, zanim aktywujesz rolę administratora.
6. Po połączeniu projektu z Supabase CLI zastosuj migracje:

   ```bash
   supabase link --project-ref TWÓJ_PROJECT_REF
   supabase db push
   ```

   Możesz też wykonać migracje w Supabase SQL Editor, po kolei:
   `supabase/migrations/202610160001_auth_and_user_preferences.sql`,
   `supabase/migrations/202610160002_admin_access_and_audit.sql`,
   `supabase/migrations/202610170001_company_catalog_and_watchlist.sql`,
   `supabase/migrations/20261020232100_company_documents_and_shared_analysis.sql`,
   `supabase/migrations/202610220001_private_portfolio_entries.sql`,
   `supabase/migrations/20261022220000_instrument_research_sources.sql`,
   `supabase/migrations/20261023093500_research_monitoring.sql` oraz
   `supabase/migrations/20261023120000_private_analyst_forecasts.sql`.
   Ponieważ migracja monitoringu ma wcześniejszy znacznik czasu niż już
   zastosowana migracja prognoz, zdalne zastosowanie będzie wymagało
   `supabase db push --include-all`. Przed zdalnym uruchomieniem sprawdź listę
   migracji i uzyskaj zgodę właściciela projektu.
7. W **Authentication → URL Configuration** ustaw adres strony na
   `http://localhost:3000` i dodaj dozwolony redirect
   `http://localhost:3000/auth/callback`.
8. W konfiguracji e-mail Supabase Auth ustaw wygaśnięcie OTP/linków recovery na
   45 minut lub krócej oraz włącz weryfikację adresu e-mail. Supabase Auth
   generuje jednorazowy token i przechowuje jego skrót po stronie bazy Auth.
9. W Resend zweryfikuj domenę. Wpisz klucz API jako `RESEND_API_KEY` w
   `.env.local`; adres nadawcy z tej domeny zapiszesz później w `/admin`.
10. Uruchom aplikację:

   ```bash
   npm install
   npm run dev
   ```

   Otwórz [http://localhost:3000](http://localhost:3000).

Podany klucz `publishable` jest kluczem publicznym klienta, nie adresem
projektu ani kluczem `service_role`. Nie pozwala samodzielnie połączyć CLI z
projektem ani wykonać zdalnej migracji.

## Pierwszy administrator

1. W `.env.local` ustaw `INITIAL_ADMIN_EMAIL` na zweryfikowany adres właściciela.
2. Załóż konto tym adresem, potwierdź go z wiadomości e-mail i zaloguj się.
3. Otwórz [http://localhost:3000/admin/setup](http://localhost:3000/admin/setup)
   i wybierz **Aktywuj konto administratora**. Jednorazowa operacja sprawdza
   zweryfikowany e-mail oraz to, czy administrator nie został już utworzony.
4. Po aktywacji usuń `INITIAL_ADMIN_EMAIL` z `.env.local` i uruchom aplikację
   ponownie. Dalsze zarządzanie kontami odbywa się w
   [http://localhost:3000/admin](http://localhost:3000/admin).

Panel nie pozwala zmieniać ani usuwać kont administratorów. Nowe konta dostają
7-dniowy trial bez subskrypcji. Trial 30-dniowy i aktywną subskrypcję można
przydzielić ręcznie w panelu; integracja płatności nie jest jeszcze podłączona.
Po wygaśnięciu okresu konto może się zalogować, ale dostęp do aplikacji jest
zablokowany do czasu przyznania kolejnego okresu.

## Import katalogu spółek

Administrator może dodać lub zaktualizować katalog w panelu `/admin`, przesyłając
plik CSV UTF-8 albo XLSX z jednym arkuszem. Plik może mieć maksymalnie 750 KB i
1000 rekordów. Wymagane nagłówki (kolejność dowolna):

```text
company_name,ticker,isin,market,source_url,source_date,confidence
```

`market` musi mieć wartość `gpw_main`, `source_url` musi wskazywać na HTTPS w
domenie `gpw.pl`, `source_date` musi być datą `YYYY-MM-DD`, a `confidence` —
`certain` albo `uncertain`. Cały plik jest walidowany przed zapisem; błędny
rekord blokuje import. Rekordy są dopasowywane po ISIN i rynku, a istniejące
pozycje aktualizowane. Import nie usuwa wpisów nieobecnych w pliku. Każdy
udany import zapisuje liczbę przetworzonych rekordów w dzienniku administratora.
Pliki należy przygotować na podstawie oficjalnych źródeł i nie dodawać do nich
cen ani wycen rynkowych.

## Raporty i wspólna analiza

Migracja `20261020232100_company_documents_and_shared_analysis.sql` przygotowuje
wspólny katalog dokumentów spółek oraz wersjonowane elementy analizy z
obowiązkowymi odnośnikami do źródeł. Zalogowany użytkownik z aktywnym dostępem
może wgrać PDF z poziomu wyszukanej lub obserwowanej spółki. Raport trafia do
wspólnej biblioteki, gdzie pozostali użytkownicy z aktywnym dostępem mogą go
zobaczyć i pobrać przez krótkotrwały link prywatny. Obowiązuje limit 25 MiB
na plik. Rekord dokumentu przechowuje SHA-256, autora uploadu, typ raportu,
okres i opcjonalne źródło. Ten sam plik nie może zostać dodany dwa razy dla
tej samej spółki.

PDF-y są przechowywane jako obiekty w prywatnym Supabase Storage, a nie w
wierszach bazy danych. Nie wygasają automatycznie. Przy założeniu średnio 5 MB
na raport 1000 plików zajmie około 5 GB; rzeczywiste zużycie zależy od
rozmiarów uploadowanych raportów i limitów planu Supabase. Usunięcie katalogu
i historii jest zablokowane przez ograniczenia bazy.

Po zatwierdzeniu przez proces serwerowy przetworzone dokumenty i wspólna
analiza są dostępne użytkownikom z aktywnym dostępem. Wersje analizy zachowują
datę, etykietę `Pewne`/`Niepewne`, uzasadnienie zmiany oraz lokalizację
potwierdzenia w dokumencie. Użytkownicy nie mogą bezpośrednio edytować
wspólnego katalogu ani analizy; zapisy są zarezerwowane dla zaufanych operacji
serwerowych.

Ta migracja tworzy wyłącznie schemat, prywatny bucket i polityki RLS. Aplikacja
nie wykonuje OCR, okresowego sprawdzania serwisów, automatycznego pobierania
raportów ani aktualizowania analizy. Użytkownik z dostępem może na żądanie
wyświetlić wyciągnięty tekst PDF; tekst jest przetwarzany tymczasowo i nie
trafia do bazy. Skanów wymagających OCR nie da się odczytać. Funkcja nie
generuje rekomendacji ani nie aktualizuje wspólnej analizy. Czytnik grupuje
rozpoznane pozycje na wyniki, bilans i przepływy pieniężne; każdy wiersz
zachowuje oryginalny zapis, numer strony i odnośnik do odpowiadającego mu
tekstu. Obejmuje wybrane pozycje, m.in. przychody, wyniki, aktywa,
zobowiązania, kapitał własny i przepływy operacyjne, inwestycyjne oraz
finansowe. Rozpoznanie liczb z układu tabel jest niepewne; wartości i jednostki
trzeba porównać z PDF. Czytnik koncentruje się na wierszach z podsumowania lub
głównych tabel sprawozdania, pomijając noty objaśniające. Gdy pełne
sprawozdanie zawiera także raport biegłego z przeglądu, klasyfikowane jest jako
sprawozdanie finansowe; sam raport z przeglądu nie jest prezentowany jako
ocena wyników spółki. Dwa dokumenty
tego samego rodzaju można zestawić, jeśli oba są dostępne. Aplikacja łączy
wyłącznie jednoznaczne wiersze o tej samej kategorii i etykiecie; powtarzające
się lub niejednoznaczne pozycje pomija. Nie wylicza dynamiki ani nie zakłada,
że okresy, waluty i zakresy konsolidacji są porównywalne.

Po wgraniu raportu aplikacja od razu otwiera jego czytnik i próbuje odczytać
PDF. Podsumowanie pokazuje rozpoznany zakres i wiersze ze stronami źródłowymi;
wiersz z jedną odczytaną wartością może być pokazany, ale wymaga weryfikacji
w oryginale. Czytnik nie tworzy automatycznych wniosków o poprawie lub
pogorszeniu wyników. Dla dodanego dokumentu widoczny jest też podany okres,
data publikacji i link źródłowy, jeśli użytkownik go dodał.

## Prywatne prognozy analityków

Migracja `20261023120000_private_analyst_forecasts.sql` tworzy oddzielny,
prywatny bucket i tabelę dla prognoz PDF dodanych przez użytkownika. Załącznik
jest przypisany do konta i spółki, może zawierać nazwę analityka, okres,
datę oraz link źródłowy. Tylko właściciel i administratorzy mogą odczytać
metadane i plik; inne konta i anonimowi użytkownicy nie mają dostępu. Panel
administratora udostępnia administratorom listę i czytnik tych załączników.
Pliki są usuwane z prywatnego bucketu przy usuwaniu konta, o ile operacja
Storage zakończy się powodzeniem.

Tekst załącznika jest odczytywany na żądanie, bez zapisu tekstu w bazie i bez
wysyłania go do zewnętrznych usług. Porównanie wskazuje jedynie tematy
rozpoznane w załączniku i publicznie widocznych zajawkach Google News RSS; nie
porównuje modeli ani wartości liczbowych i nie wyjaśnia przyczyn rozbieżności.
Nagłówki bez dostępnej treści są pomijane. Nie pobieramy pełnych publikacji,
nie kopiujemy płatnych treści ani nie omijamy paywalli. Feed nie daje jednak
pewności, że pełna strona wydawcy jest bezpłatna; dostęp do niej może podlegać
ograniczeniom. Należy wgrywać wyłącznie dokumenty, które użytkownik ma prawo
udostępnić aplikacji. OCR skanów nie jest dostępny.

## Aktualności i portfel

Po wyszukaniu spółki aplikacja pobiera aktualności z Google News RSS, osobno
wyszukując po nazwie i tickerze, a następnie scala i usuwa duplikaty. Nie
gwarantuje to kompletności wyników ani nie zastępuje weryfikacji u wydawcy.
Prezentuje odnośniki wraz z datą publikacji, wydawcą oraz etykietą `Niepewne`.
Feed analityków pomija pozycje bez publicznej zajawki oraz te, których treść
sygnalizuje ograniczony lub płatny dostęp. Jeśli Google News RSS udostępnia
zajawkę, aplikacja pokazuje jej krótki fragment, wydawcę, datę i rozpoznane
tematy (np. popyt, marże, kontrakty, zadłużenie lub strategię). Przy co
najmniej dwóch źródłach wskazuje różnice i wspólne akcenty widoczne w tych
zajawkach. Nie traktuje ich jako potwierdzonych założeń modeli; gdy widoczne
są tylko nagłówki albo brak różnic tematycznych,
informuje, że nie ma podstaw do wyjaśnienia rozbieżności. Pełne treści należy
sprawdzić u wydawców. Aplikacja nie uśrednia prognoz ani nie formułuje
rekomendacji. Wyniki RSS są
ograniczone do ostatnich sześciu miesięcy. Linki do wideo są wyszukiwane
oddzielnie; treść filmów nie jest kopiowana ani analizowana. Jeżeli katalog
nie zawiera bezpośredniego adresu relacji inwestorskich, aplikacja generuje
wyszukiwanie na podstawie spółki — użytkownik nie musi uzupełniać ani
potwierdzać linku. Dodatkowo automatycznie szuka świeżych publikacji o
harmonogramie raportów. Wyniki te są oznaczane jako niepewne, a ich data
publikacji nie jest mylona z datą raportu. Potwierdzony termin może być
dostarczony w katalogu jako dokładniejsze źródło; przy jego braku aplikacja
nie zgaduje daty. Te pola katalogu pozostają opcjonalne w imporcie CSV i XLSX.

Migracja `20261022220000_instrument_research_sources.sql` dodaje opcjonalne
źródła relacji inwestorskich i terminu raportu do katalogu. Automatyczne
wyszukiwanie nie wymaga ręcznego uzupełniania tych pól; służą one jedynie jako
dokładniejsze źródło, gdy zostały dostarczone. Migracja jest zastosowana w
lokalnym Supabase i nie jest wdrażana zdalnie automatycznie.

Migracja `202610220001_private_portfolio_entries.sql` dodaje prywatny rejestr
zakupów akcji/ETF-ów i otrzymanych dywidend. Wykres pokazuje skumulowane wpłaty
wraz z prowizjami oraz wpłaty powiększone o zapisane dywidendy — nie wycenę
aktywów. Nie pobieramy kursów, cen ani wartości indeksów. RLS ogranicza wpisy
do właściciela z aktywnym dostępem. Migrację należy najpierw zastosować i
przetestować lokalnie; nie jest ona wdrażana zdalnie automatycznie.

## Monitorowanie aktualności

Migracja `20261023093500_research_monitoring.sql` tworzy tabele do śledzenia
odkrytych aktualności z Google News RSS. Użytkownik może ręcznie uruchomić
wyszukiwanie dla wybranej spółki; znalezione pozycje są zapisywane z datą
publikacji, wydawcą, URL-em i opcjonalnym opisem. To monitorowanie nie pobiera
raportów PDF ani nie gwarantuje natychmiastowego wykrycia publikacji.

Endpointy `/api/research/monitor` wymagają zalogowanego użytkownika z aktywnym
dostępem. `POST` wyszukuje aktualności, usuwa duplikaty po URL i aktualizuje
stan sprawdzenia. `GET` odczytuje pozycje przez klienta Supabase bieżącego
użytkownika, więc RLS nadal ogranicza dostęp. Klucz `service_role` jest używany
wyłącznie po stronie serwera do zapisu po sprawdzeniu sesji i dostępu.

Dashboard wyświetla aktualności dla wyszukanej spółki i przycisk
**Sprawdź teraz**. Wpisy są wspólne dla użytkowników aplikacji z aktywnym
dostępem. Obecnie nie ma jeszcze funkcji oznaczania ich jako przejrzane, więc
pozostają oznaczone jako nowe.

Monitorowanie działa na żądanie użytkownika. Dodatkowo endpoint
`POST /api/research/monitor/cron` jest przygotowany do wywoływania przez
zewnętrzne zadanie cron co 6 godzin. Sprawdza spółki na listach obserwowanych
aktywnych użytkowników oraz administratorów, maksymalnie sześć spółek na
jedno uruchomienie; jeśli pozostają zaległe pozycje, zwraca ich liczbę w polu
`deferred`. Endpoint wymaga nagłówka `Authorization: Bearer ...` z sekretem
`RESEARCH_MONITOR_CRON_SECRET` (co najmniej 32 znaki). Ustaw ten sam losowy
sekret w konfiguracji serwera i w panelu zadania cron; nie zapisuj go w URL,
repozytorium ani w kodzie.

Przykładowe polecenie harmonogramu (po wdrożeniu aplikacji i ustawieniu
sekretu), uruchamiane co 6 godzin:

```sh
curl --fail --silent --show-error \
  -X POST \
  -H "Authorization: Bearer TWÓJ_SEKRET" \
  "https://TWOJA-DOMENA/api/research/monitor/cron"
```

Harmonogram nie został jeszcze
skonfigurowany na koncie Cyber_Folks. Z publicznie dostępnych informacji nie
mogłem potwierdzić obsługi zadania cron w pakiecie `cyber_IN! v2.0`. Zrzuty
udostępnione przez właściciela wskazują, że pakiet obsługuje Node.js i Next.js,
ale ma limity CPU/RAM/procesów; aplikacja wymaga uruchomienia serwerowego
(SSR i API Routes), a nie samego statycznego eksportu. Dostępność i limity
zadań cron trzeba potwierdzić w panelu hostingu lub u Cyber_Folks. Google News RSS
może publikować materiały z opóźnieniem, więc sześciogodzinny harmonogram nie
gwarantuje wykrycia ich natychmiast. Migracja RLS została zastosowana lokalnie
i nie została wysłana do zdalnego Supabase.

### Darmowe środowisko testowe

Do tymczasowych testów online można użyć środowiska Preview na Vercel Hobby,
pozostawiając Cyber_Folks jako planowany hosting docelowy. Vercel obsługuje
Preview dla gałęzi innych niż produkcyjna. Darmowy plan Hobby dopuszcza
harmonogram cron najwyżej raz dziennie, dlatego testy endpointu cron co
6 godzin należy wykonać ręcznie albo w osobnym harmonogramie testowym; nie
oznacza to zmiany docelowego hostingu.

Preview powinien korzystać z oddzielnego projektu Supabase przeznaczonego do
testów, nie z produkcyjnej bazy. Nie należy wdrażać migracji testowych do
zdalnego projektu produkcyjnego ani kopiować do Preview produkcyjnych sekretów,
danych użytkowników lub prywatnych dokumentów. Do uruchomienia Preview
potrzebne jest repozytorium GitHub podłączone do Vercel oraz samodzielnie
ustawione zmienne środowiskowe w panelu Vercel. W tej chwili repozytorium
workspace nie jest skonfigurowane jako Git, więc wdrożenie Preview wymaga
najpierw przygotowania repozytorium i połączenia kont przez właściciela.

## Reset hasła

Użytkownik wybiera **Nie pamiętam hasła** na ekranie logowania. Odpowiedź
aplikacji jest taka sama bez względu na to, czy konto istnieje. Jeśli istnieje,
Resend wysyła krótkotrwały, jednorazowy link. Skrót tokenu i jego termin
ważności obsługuje Supabase Auth; aplikacja nie zapisuje jawnego tokenu. Po
zmianie hasła aplikacja unieważnia wszystkie sesje Supabase i wymaga ponownego
logowania. Administrator może wysłać taki sam link z panelu.

## Sesje i prywatność

- Sesje Supabase są odświeżane po stronie serwera i zapisywane w ciasteczkach
  `HttpOnly`, `SameSite=Lax`, `Secure` w środowisku produkcyjnym.
- Rola administratora jest weryfikowana po stronie serwera na każdej stronie
  i czynności administracyjnej; sam ukryty przycisk nie stanowi zabezpieczenia.
- Włączenie RLS ogranicza bezpośredni dostęp do ustawień, uprawnień, historii
  logowań i dziennika administracyjnego.
- Klucz `service_role` jest używany wyłącznie w modułach serwerowych.
- Rejestrowane są udane logowania i zmiany administratora. Nie zapisujemy
  adresu IP w historii logowań.
- Historia resetu opiera się na recovery Supabase Auth. Czas ważności ustawia
  się w panelu Supabase Auth i musi być ograniczony (zalecane: 45 minut).

## Kontrola jakości

- `npm run lint` — lint
- `npm run typecheck` — kontrola typów
- `npm run build` — kompilacja produkcyjna
- `supabase test db` — testy RLS i izolacji danych (wymaga Supabase CLI oraz
  uruchomionego lokalnego Supabase/Dockera)

## Zakres

Obecny etap obejmuje uwierzytelnianie, sesje, okresy dostępu, role, panel
administratora, historię logowań, dziennik zmian, reset hasła e-mailem oraz
podstawowy katalog spółek i prywatną listę obserwowanych z notatkami.
Wyszukiwarka priorytetyzuje ticker, a nazwę i ISIN obsługuje jako alternatywne
kryteria. Dashboard pokazuje dane identyfikacyjne katalogu, źródło, datę i
etykietę pewności; nie zawiera danych rynkowych. RLS izoluje prywatne listy
oraz załączniki prognoz użytkowników. Czytnik PDF udostępnia wyciąg tekstu na
żądanie, a publiczne zestawienia analityczne opierają się wyłącznie na
dostępnych zajawkach; aplikacja nie formułuje rekomendacji.
