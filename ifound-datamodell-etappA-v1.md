# ifound — datamodell etapp A

**Version 1 · 1 september 2026 · underlag för Supabase-migrering**

Utgår från att geometrin kommer från en extern tjänst hos Lantmäteriet och därmed förändras löpande. Det är den förutsättningen som formar hela modellen.

---

## Det bärande beslutet: fastighetsbeteckningen är inte en nyckel

Idag är nyckeln beteckningen, normaliserad genom `normParcel`. HERMELINEN 12.

Det fungerar så länge datan är en fryst fil. Med en levande tjänst går det sönder, och det går sönder på det värsta tänkbara stället: en avstyckning. HERMELINEN 12 upphör och blir HERMELINEN 15 och 16. Alla gillningar, intressen, önskepriser och anspråk som pekade på den gamla beteckningen pekar på ingenting.

Det är inte ett kantfall. Avstyckning är den händelse hela intäktsmodellen bygger på.

Därför får varje fastighet ett eget internt id som ifound äger och som aldrig ändras. Beteckningen blir ett attribut, inte en identitet.

```sql
create table parcels (
  id              uuid primary key default gen_random_uuid(),
  beteckning      text not null,
  beteckning_norm text not null,          -- normParcel-logiken, för sökning
  kommun          text not null,
  lm_objektid     text,                   -- Lantmäteriets identitet om den finns
  centroid        geography(point, 4326),
  bbox            geography(polygon, 4326),
  area_m2         numeric,
  status          text not null default 'aktiv',  -- aktiv | ersatt
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now()
);

create index on parcels using gist (centroid);
create index on parcels (beteckning_norm);
create unique index on parcels (lm_objektid) where lm_objektid is not null;
```

`beteckning_norm` finns för att användare söker på beteckning och för att din nuvarande kod gör det. Men ingenting i systemet får peka på den — bara `id`.

---

## Släktskap mellan fastigheter

När en fastighet delas eller slås ihop registreras sambandet. Det är detta som gör att en gillning kan följa med.

```sql
create table parcel_lineage (
  id           uuid primary key default gen_random_uuid(),
  predecessor  uuid not null references parcels(id),
  successor    uuid not null references parcels(id),
  relation     text not null,             -- avstyckning | sammanlaggning | omreg
  detected_at  timestamptz not null default now(),
  method       text not null,             -- lm_objektid | geometri | manuell
  confidence   numeric                    -- 0–1, andel överlappande yta
);
```

**Hur släktskapet upptäcks utan att lita på Lantmäteriet.**

Fråga dem gärna om de har en beständig objektidentitet och ett sätt att lista förändringar sedan ett datum. Men bygg inte modellen på att svaret är ja.

Den robusta metoden är geometrisk. Vid varje synkning: dyker en fastighet upp som inte fanns förut, och ligger dess polygon till mer än nittio procent inuti en fastighet som just försvann — då är den en efterföljare. Två eller fler efterföljare till samma föregångare är en avstyckning. Flera föregångare till en efterföljare är en sammanläggning.

Det kräver att du sparar tillräckligt av den gamla geometrin för att kunna jämföra. Centroid och bbox räcker för de flesta fall och är billigt att lagra.

**Vad som händer med användardata vid avstyckning.** Gillningar och intressen flyttas inte automatiskt, för då skulle en person som gillat en villa plötsligt ha gillat en tomt hon aldrig sett. De pekar kvar på föregångaren, som får status `ersatt`. Vid uppslag följer systemet kedjan framåt och visar efterföljarna.

---

## Avstyckningsnotisen — den som gör hela det här värt besväret

När `parcel_lineage` får en rad med `relation = 'avstyckning'` finns det per definition en ny fastighet där tidigare bara fanns en. Och du vet exakt vilka som gillat föregångaren.

```sql
create table lineage_notifications (
  id          uuid primary key default gen_random_uuid(),
  lineage_id  uuid not null references parcel_lineage(id),
  user_id     uuid not null references auth.users(id),
  sent_at     timestamptz,
  clicked_at  timestamptz
);
```

Det är den varmaste byggleaden som går att konstruera. Personen har redan visat att hon fastnat för platsen, och nu finns det mark där. Med en fryst fil hade du aldrig fått veta att det hänt.

Mät `clicked_at`. Går den siffran bra är det ett eget argument i en investerarpresentation.

---

## Aktivitetstabellerna

Små, ändras ofta, frågas ut per kartvy.

```sql
create table parcel_likes (
  user_id    uuid not null references auth.users(id),
  parcel_id  uuid not null references parcels(id),
  created_at timestamptz not null default now(),
  primary key (user_id, parcel_id)
);

create table parcel_interests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id),
  parcel_id  uuid not null references parcels(id),
  message    text,
  created_at timestamptz not null default now()
);

create table parcel_follows (
  user_id    uuid not null references auth.users(id),
  parcel_id  uuid not null references parcels(id),
  created_at timestamptz not null default now(),
  primary key (user_id, parcel_id)
);

create table wish_prices (
  parcel_id  uuid primary key references parcels(id),
  user_id    uuid not null references auth.users(id),
  amount_sek bigint,
  is_public  boolean not null default false,
  updated_at timestamptz not null default now()
);
```

**Aggregat, inte råa räkningar.** Kartan behöver antal per fastighet för synliga rutor. Räkna inte om det vid varje panorering.

```sql
create materialized view parcel_activity as
select p.id as parcel_id,
       count(distinct l.user_id) as likes,
       count(distinct i.user_id) as interests
from parcels p
left join parcel_likes l on l.parcel_id = p.id
left join parcel_interests i on i.parcel_id = p.id
group by p.id;
```

---

## Avstyckningsintressen — tabellen som bär affären

Den enda som genererar intäkt. Den ska ha mest omsorg.

```sql
create table subdivision_interests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  parcel_id     uuid not null references parcels(id),
  drawn_area    geography(polygon, 4326),  -- användarens skiss, ej juridisk
  drawn_area_m2 numeric,
  message       text,
  intent        text,                       -- utforskar | planerar | redo
  created_at    timestamptz not null default now(),

  -- leadhantering
  lead_status   text not null default 'ny', -- ny | kvalificerad | levererad | avvisad
  delivered_to  text,
  delivered_at  timestamptz,
  consent_share boolean not null default false
);
```

`consent_share` är inte valfri. Att lämna en persons uppgifter till en husleverantör kräver att hon vet om det och har sagt ja. Formuleringen i gränssnittet måste vara begriplig, inte en kryssruta i en villkorstext.

`intent` är det som skiljer ett lead värt pengar från en klickning. Fråga rakt ut i flödet: utforskar du, planerar du, eller är du redo att bygga? Utan den säljer du volym istället för kvalitet, och det är inte en affär som håller.

---

## Mätning av tratten

Tre siffror. Fler behövs inte i etapp A.

```sql
create table funnel_events (
  id         uuid primary key default gen_random_uuid(),
  session_id text not null,
  user_id    uuid references auth.users(id),
  event      text not null,   -- guide_oppnad | avstyckning_klickad | intresse_skickat
  parcel_id  uuid references parcels(id),
  created_at timestamptz not null default now()
);

create index on funnel_events (event, created_at);
```

Anonym session räcker för de två första stegen. Kräv inte konto för att mäta — då mäter du bara de som redan konverterat.

---

## Typrättelser med röstmodell

Enligt det vi landade i: tröskeln är ett tills det finns volym, en verifierad ägare räknas ensam, och övergångar till och från obebyggd tomt kräver mer eftersom de styr avstyckningsknappen och därmed leadgenereringen.

```sql
create table type_corrections (
  id           uuid primary key default gen_random_uuid(),
  parcel_id    uuid not null references parcels(id),
  user_id      uuid not null references auth.users(id),
  proposed     text not null,
  is_owner     boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (parcel_id, user_id)
);

create table parcel_types (
  parcel_id    uuid primary key references parcels(id),
  type         text not null,
  source       text not null,   -- osm | grannskap | area | anvandarrattad | agare | admin
  votes        int not null default 0,
  locked       boolean not null default false,
  updated_at   timestamptz not null default now()
);
```

`locked` är för admin. Behövs den ofta har tröskeln fel värde.

---

## Ägardata

Egen livscykel, egen tabell. Byggnadstyp och upplåtelseform ska aldrig blandas ihop igen.

```sql
create table parcel_ownership (
  parcel_id   uuid primary key references parcels(id),
  form        text not null,   -- brf | hyresratt | allmannytta | samfalld
  owner_name  text,
  org_nr      text,
  source      text not null,   -- bolagsverket | lantmateriet | manuell
  verified_at timestamptz
);
```

---

## Anspråk

```sql
create table claims (
  id            uuid primary key default gen_random_uuid(),
  parcel_id     uuid not null references parcels(id),
  user_id       uuid not null references auth.users(id),
  status        text not null default 'pending',
  claim_role    text,           -- agare | styrelse | forvaltare
  verified_by   text,           -- admin | bankid
  verified_at   timestamptz,
  created_at    timestamptz not null default now()
);
```

`claim_role` finns för att en bostadsrättsförening claimas av styrelsen, inte av en boende. Utan fältet blir det otydligt vad ett godkännande betyder.

**Personnummer lagras aldrig här.** Bara resultatet av verifieringen. Det står redan i överlämningen och gäller fortfarande.

---

## Juridiskt: gränserna är inte juridiskt bindande

Lantmäteriet skriver ut det i sin egen karttjänst, och de har rätt att göra det. Fastighetsindelningen är dagsaktuell, men gränserna har tillkommit under lång tid med vitt skilda metoder. Lägesnoggrannheten varierar från centimeternivå till ett medelfel på tiotals meter, särskilt på landsbygden där många gränser digitaliserades för hand. Enligt lag är det gränsmärket på marken som gäller.

**Var det måste stå i ifound, och varför just där:**

I kartvyn, som en diskret rad. Inte som en modal ruta någon klickar bort.

I fastighetspanelen, bredvid arealen. Arean är beräknad ur samma osäkra geometri.

**Och framför allt i avstyckningsflödet.** Det är där risken finns. Någon ritar en tomt ovanpå en gräns med tiotals meters fel, får en kostnadsuppskattning, kontaktar en husleverantör och planerar utifrån något som inte stämmer. Där räcker inte en fotnot — det behöver stå i själva ritverktyget, innan skissen sparas.

Formulering att utgå från:

> Gränserna i kartan är hämtade från Lantmäteriet och stämmer inte alltid med verkligheten. De är inte juridiskt gällande. Din skiss är en idé, inte ett underlag för lantmäteriförrättning.

**Tre saker till att ta med Lantmäteriet vid offertförfrågan:**

Får geometrin cachas, och i så fall hur länge? Det avgör om du kan lägga ett lager framför tjänsten eller måste anropa den vid varje kartvy.

Vad kräver riktlinjerna för extern lagring av fastighetsregisterinformation, som uppdaterades i januari 2026? Supabase i Irland är extern lagring.

Finns en förändringstjänst som listar vad som ändrats sedan ett datum? Svaret avgör om avstyckningsnotisen blir enkel eller om du måste jämföra geometri själv.

---

## Migrering från localStorage

Ordningen spelar roll. Appen ska fungera hela vägen.

1. Fyll `parcels` från befintlig geojson. Sätt `beteckning_norm` med samma logik som `normParcel` så att inget tappas.
2. Skriv en uppslagsfunktion beteckning → `id` och använd den överallt. Fortfarande localStorage bakom.
3. Dubbelskriv: nya händelser går till både localStorage och Supabase. Läs fortfarande från localStorage.
4. Byt läsning till Supabase, en tabell i taget. Börja med `subdivision_interests` — den är minst och viktigast.
5. Migrera befintlig localStorage-data vid inloggning. En engångsflytt per användare.
6. Ta bort skrivningen till localStorage.

Steg 3 och 4 är de som gör att du kan avbryta mitt i utan att något går sönder.

---

## Vad som medvetet inte finns här

Vykort, mäklarobjekt, notisinställningar och meddelandetrådar. De hör till etapp B eller senare. Läggs de till nu blir migreringen större än den behöver vara, och etapp A ska ge dig mätdata snabbt — inte en komplett databas.
