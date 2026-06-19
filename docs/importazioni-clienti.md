# Configurazione importazioni clienti

I file Excel devono essere inseriti nella cartella locale `importazioni-private/`,
che e' esclusa da Git e non viene pubblicata su GitHub Pages.

## Regola comune per il weekend

Dopo aver calcolato la data della chiamata, se questa cade di sabato o domenica
viene spostata al lunedi' successivo.

## Normalizzazione fonti

La fonte non piu' attiva `019` viene convertita automaticamente nella fonte
`008 - BELLAPIANTA MARIA VALERIA` durante tutte le importazioni.

## 01_Nuovi_Clienti.xlsx

Scheda: `NuoviClienti`

| Dato | Colonna |
| --- | --- |
| Nome e cognome | A |
| Fonte | G |
| Data inizio rapporto | I |
| Data di nascita | R |
| Cellulare | Z |
| Coperture cliente | BC |

Non sono disponibili codice cliente, numero polizza ed email.
Per riconoscere lo stesso cliente si usa la combinazione normalizzata di nome e
cognome, data di nascita e fonte. La data della campagna si calcola aggiungendo
alla data di inizio rapporto il numero di mesi configurato dall'agente.

## 02_Scadenze_Clienti.xlsx

Scheda: `Scadenze`

| Dato | Colonna |
| --- | --- |
| Nome e cognome | C |
| Numero polizza | D |
| Fonte | E |
| Ramo/tipologia polizza | H |
| Tipo scadenza | K |
| Data base | N |
| Targa | U |
| Cellulare | AW |

Non sono disponibili codice cliente, email, premio lordo e stato polizza.

La scadenza viene calcolata dalla data in colonna `N`:

- se `K = R`, aggiungere 6 mesi;
- se `K = A`, aggiungere 12 mesi.

La chiamata viene programmata 10 giorni prima della scadenza calcolata.

## 03_Winback_Clienti.xlsx

Scheda: `Winback`

| Dato | Colonna |
| --- | --- |
| Nome e cognome | C |
| Numero polizza | D |
| Fonte | E |
| Ultimo premio lordo | I |
| Data uscita da Allianz | N |
| Targa | R |
| Cellulare | AR |

Non sono disponibili codice cliente, email, ramo/tipologia polizza e motivo
dell'uscita. La targa sostituisce il ramo come informazione mostrata.

La chiamata viene programmata 10 giorni prima dell'anniversario successivo
della data di uscita. Esempio: uscita il 16 giugno 2025, anniversario il
16 giugno 2026 e data calcolata il 6 giugno 2026. Poiche' il 6 giugno 2026 e'
sabato, la chiamata viene spostata a lunedi' 8 giugno 2026.
