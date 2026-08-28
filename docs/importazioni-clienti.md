# Configurazione importazioni clienti

Gli eventuali file campione conservati nel progetto devono essere inseriti in
`importazioni-private/`, cartella esclusa da Git e non pubblicata su GitHub Pages.

## Flusso nel gestionale

L'amministratore seleziona sempre il tipo di caricamento dal menu, carica il
file e avvia prima l'analisi. L'analisi non scrive dati e mostra:

- foglio letto e numero di righe valide o saltate;
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
| Data inizio rapporto | `Iniz. Rapp.` |
| Data di nascita | `Nascita` |
| Cellulare | `Cellulare` |
| Coperture cliente | `Cop. Cl` |

Sono verificate due disposizioni dello stesso export: `R/Z/BC` e `U/AC/BF`
per nascita, cellulare e coperture. Entrambe vengono risolte dalle intestazioni.

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
| Codice fiscale / P.IVA | N |
| Tipo scadenza | K |
| Prossima scadenza | AH |
| Targa | U |
| Cellulare | Z |
| Premio auto annuale | CP |

Non sono disponibili codice cliente, email, premio lordo e stato polizza. Le
campagne annuali usano la prossima scadenza letta in `AH` e sottraggono il
numero di giorni configurato nella campagna.

## 03_Winback_Clienti.xlsx

Scheda: `Winback`. Se il file esportato dal portale non contiene una scheda
con questo nome, l'import legge automaticamente il primo foglio disponibile.

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

Per il Winback si possono selezionare e importare piu' file Excel insieme, uno
per ciascun mese di competenza disponibile. L'importazione e' cumulativa: i
mesi gia' caricati non vengono cancellati o sostituiti. Se viene ricaricato lo
stesso cliente con la stessa polizza e la stessa data di uscita, la chiamata
esistente viene aggiornata o lasciata invariata.
