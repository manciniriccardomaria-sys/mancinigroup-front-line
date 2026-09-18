# Configurazione importazioni clienti

Gli eventuali file campione conservati nel progetto devono essere inseriti in
`importazioni-private/`, cartella esclusa da Git e non pubblicata su GitHub Pages.

## Flusso nel gestionale

L'amministratore seleziona sempre il tipo di caricamento dal menu, carica il
file e avvia prima l'analisi. L'analisi non scrive dati e mostra:

- foglio letto e numero di righe valide o saltate;
- numero di duplicati interni ignorati;
- intestazione effettivamente trovata e relativa colonna;
- metodo di riconoscimento usato;
- anteprima dei primi clienti.

La scrittura in Firestore parte solo con `Conferma e importa`. Se nessun record
e' valido, l'importazione e' bloccata.

## Intestazioni confermate

Per `Nuovi clienti` e `Cluster clienti` le colonne vengono individuate cercando
le intestazioni reali, non tramite una lettera fissa. Il confronto ignora solo
maiuscole/minuscole, spazi superflui e caratteri Unicode equivalenti; non usa
sinonimi inventati.

### Nuovi clienti

| Dato | Intestazione esatta |
| --- | --- |
| Nome e cognome | `Contraente` |
| Fonte | `Fonte` |
| Codice fiscale / P.IVA | `Cod.Fiscale / P.IVA` |
| Data inizio rapporto | `Iniz. Rapp.` |
| Data di nascita | `Nascita` |
| Cellulare | `Cellulare` |
| Coperture cliente | `Cop. Cl` |

Sono verificate due disposizioni dello stesso export: `R/Z/BC` e `U/AC/BF`
per nascita, cellulare e coperture. Entrambe vengono risolte dalle intestazioni.

I duplicati vengono riconosciuti prima tramite il valore normalizzato di
`Cod.Fiscale / P.IVA`. Se il dato manca, si usa la combinazione di nome
normalizzato, data di nascita e fonte. Le righe duplicate nello stesso file
vengono unite prima di generare le chiamate e sono indicate nell'anteprima.

### Cluster clienti

Le intestazioni confermate sono `Contraente`, `Fonte`,
`Dt. Prox Scad Quiet`, `Nascita`, `Indirizzo`, `Cellulare`, `Anz. Cl`,
`N. Pol. Tot. Cl`, `Premi Annui Cl` e `Prv Tot. Cl`.

### Scadenze e Winback

L'export clienti esteso usato per alcune scadenze viene riconosciuto tramite le
intestazioni confermate `Contraente`, `Fonte`, `Cod.Fiscale / P.IVA`,
`Dt. Prox Scad Cl`, `Cellulare` e `Pr. Ann. Auto Cl`.

Gli altri formati Scadenze e Winback continuano temporaneamente a usare le
posizioni storiche indicate sotto. Nell'anteprima il gestionale mostra sempre
l'intestazione realmente presente in ciascuna posizione. Le posizioni saranno
sostituite da intestazioni esatte quando saranno disponibili i due file campione.

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

Non sono disponibili codice cliente, numero polizza ed email. Il codice fiscale
o P.IVA viene cercato tramite la relativa intestazione, quindi la posizione puo'
cambiare tra un export e l'altro. La data della campagna si calcola aggiungendo
alla data di inizio rapporto il numero di mesi configurato dall'agente.

## 02_Scadenze_Clienti.xlsx

Scheda: `Scadenze`

| Dato | Colonna |
| --- | --- |
| Nome e cognome | C |
| Numero polizza | D |
| Fonte | E |
| Ramo/tipologia polizza | H |
| Codice fiscale / P.IVA | N |
| Tipo scadenza | K |
| Prossima scadenza | AH |
| Targa | U |
| Cellulare | Z |
| Premio auto annuale | CP |

Non sono disponibili codice cliente, email, premio lordo e stato polizza. Le
campagne annuali usano la prossima scadenza letta in `AH` e sottraggono il
numero di giorni configurato nella campagna.

Una scadenza entra in una campagna annuale soltanto quando il record contiene
un numero di polizza e il tipo scadenza in colonna `K` e' `A`. L'export clienti
esteso, che non espone questi due dati di polizza, non viene considerato una
fonte valida per le campagne annuali: `Dt. Prox Scad Cl` puo' infatti indicare
anche una scadenza di rata.

## 03_Winback_Clienti.xlsx

Scheda: `Winback`. Se il file esportato dal portale non contiene una scheda
con questo nome, l'import legge automaticamente il primo foglio disponibile.

| Dato | Colonna |
| --- | --- |
| Nome e cognome | C |
| Numero polizza | D |
| Fonte | E |
| Ultimo premio lordo | I |
| Frequenza premio (`Fr.`) | L |
| Data uscita da Allianz | N |
| Targa | R |
| Cellulare | AR |

Non sono disponibili codice cliente, email, ramo/tipologia polizza e motivo
dell'uscita. La targa sostituisce il ramo come informazione mostrata.
Il premio lordo mostrato viene annualizzato usando `Fr.`: con valore `S` il
premio della colonna I viene moltiplicato per 2; con valore `A` resta invariato.

La chiamata viene programmata 15 giorni prima del prossimo anniversario della
data di uscita. Sono ammessi soltanto il primo e il secondo anniversario: in un
anno `Y` vengono quindi lavorate le uscite di `Y-1` e `Y-2`. Se la data di
chiamata cade di sabato o domenica viene spostata al lunedi' successivo.
Nel calendario e nel monitoraggio la chiamata mostra rispettivamente la
dicitura `Uscito 1 anno fa` oppure `Uscito 2 anni fa`.

Ogni ciclo e' identificato anche dall'anno dell'anniversario. Ricaricare lo
stesso file nello stesso anno non duplica la chiamata; nell'anno successivo
viene invece creato un nuovo ciclo, senza sovrascrivere lo storico. I record
che arriverebbero al terzo anniversario o a uno successivo vengono ignorati.

Quando una chiamata Winback viene chiusa con lo stato `Ripreso / tornato
cliente`, la stessa polizza e la stessa uscita non generano il secondo
anniversario. Durante una successiva importazione viene eliminata anche
un'eventuale chiamata T+2 ancora aperta gia' generata. Una nuova uscita dello
stesso cliente mantiene invece una data di uscita diversa e avvia un nuovo
ciclo Winback.

### Piano di caricamento Winback

Per il mese di anniversario `M` dell'anno `Y`, entro il giorno 15 del mese
precedente vanno caricati insieme:

- il file del mese `M` relativo alle uscite di `Y-1`;
- il file del mese `M` relativo alle uscite di `Y-2`.

Per gennaio il caricamento va fatto entro il 15 dicembre dell'anno precedente.
Esempio: per le chiamate di ottobre 2026 si caricano entro il 15 settembre 2026
i file delle uscite di ottobre 2025 e ottobre 2024. Per gennaio 2027 si
caricano entro il 15 dicembre 2026 i file di gennaio 2026 e gennaio 2025.

La finestra scorre ogni anno:

| Anno chiamate | Uscite da caricare |
| --- | --- |
| 2026 | 2025 e 2024 |
| 2027 | 2026 e 2025 |
| 2028 | 2027 e 2026 |

Per il Winback si possono selezionare e importare piu' file Excel insieme, uno
per ciascun mese di competenza disponibile. L'importazione e' cumulativa: i
mesi gia' caricati non vengono cancellati o sostituiti. Se viene ricaricato lo
stesso cliente con la stessa polizza, la stessa data di uscita e lo stesso anno
di anniversario, la chiamata esistente viene aggiornata o lasciata invariata.
L'aggiornamento e' consentito soltanto se la chiamata e' ancora nello stato `Da
chiamare`: una chiamata gia' lavorata mantiene data, contenuti e stato originali.
