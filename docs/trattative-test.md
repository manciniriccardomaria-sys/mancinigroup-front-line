# Trattative: prova sul collaboratore Riccardo

Il flusso è attivo esclusivamente per `manciniriccardo9@gmail.com`, come
collaboratore di test della fonte `098 · MANCINI RICCARDO MARIA`.
La password non è conservata nel repository.

## Attività collegate

- Preventivi Motor (se)
- ULTRA Salute · proposte
- ULTRA Casa · proposte
- ULTRA Impresa · proposte
- SMEG
- Protection → Longevity Care oppure Lovia
- Contatti Fondo Pensione
- Contatti Energia
- Contatti Noleggio
- Vitariv · consegne (scheda cliente, senza apertura di una trattativa)

Preventivi per terzi, consegne ScegliAllianz, emissioni, sinistri e altre operazioni mantengono i normali
contatori. Le categorie sono selezionate per ID, anche se un amministratore
ne modifica l'etichetta. Per aggiungere altre proposte occorre aggiornare
`PROPOSAL_CATEGORY_IDS` e la corrispondente validazione in `firestore.rules`.

## Rendicontazione giornaliera del profilo di test

Il catalogo locale `pilotReportCatalog.ts` mostra esclusivamente a Riccardo
quattro riquadri: **Ricezione, Promozione, Emissione, Terzi**. Il catalogo
condiviso `report_categories` e i report degli altri operatori non cambiano.
Le voci Retail vengono sostituite da ULTRA Salute, SMEG, ULTRA Casa e ULTRA
Impresa, con contatori distinti per proposta, emissione e preventivo per terzi.
Vitariv/consegne, ScegliAllianz/consegne e Recensioni sono in Promozione.
La sezione “Voci precedenti” è rimossa dalla schermata giornaliera; i vecchi
contatori Retail e Winback manuali restano nello storico, senza ripartizioni
presunte tra prodotti. ScegliAllianz/proposte è rimosso, mentre rimane la
consegna. Protection riunisce Longevity Care e Lovia nel gruppo Preventivi e
proposte. Il + apre la scelta del prodotto, poi la scheda cliente. Il totale
mostrato somma i due contatori; i salvataggi e lo storico conservano gli ID
`longevityCare` e `contattiProtection` e il prodotto scelto. Le righe non hanno
evidenziazioni verdi; il bordo di Emissione e gli indicatori usano il blu.
Le proposte e la consegna Vitariv richiedono la scheda cliente e non mostrano il meno; le altre
attività conservano i contatori manuali. Le voci “Contatti” già collegate
alla scheda cliente mantengono il flusso esistente.

La consegna Vitariv richiede CF, nome, cognome e nascita, con la stessa
ricerca e autocompilazione delle proposte. Un'unica transazione salva
l'anagrafica del cliente, il dettaglio della consegna nella raccolta isolata
`negotiation_test_deliveries` e l'incremento giornaliero. Annullare o fallire
il salvataggio non aumenta il contatore; ritentare con lo stesso ID non
duplica la consegna. Le consegne non compaiono come trattative aperte.

### Winback automatico nel test

La scheda in alto a destra deriva i totali dal registro isolato
`pilot_winback_calls`, filtrando per operatore e giornata italiana. Il
dettaglio permette di registrare una chiamata effettivamente effettuata
su una scheda Winback reale della fonte 098 o assegnata al collaboratore.
Salvare aggiorna solo il registro di test, mai `call_tasks` o i report
operativi. Le regole verificano cliente e fonte contro la scheda reale.

Ogni chiamata è un evento con un ID stabile per i tentativi di salvataggio:
ritentare non duplica il conteggio. Correggere l’esito modifica lo stesso
evento, preservando giorno, operatore, cliente e fonte. Chiamate ripetute
sono eventi distinti; raggiunti e recuperati contano clienti unici, anche
quando presenti su più polizze. Il riepilogo è disponibile anche nello
storico. Gli eventi precedenti all'attivazione del registro non vengono
ricostruiti dallo stato corrente delle chiamate e non vengono confusi con
il vecchio contatore manuale. Nessun dato dimostrativo viene inserito online.

## Funzionamento

Il + apre una finestra con codice fiscale, nome, cognome e data di nascita.
Proposta e data italiana sono precompilate e non modificabili. La fonte è
quella assegnata al collaboratore. Annullare non registra alcuna attività.

Il codice fiscale cerca prima le anagrafiche già inserite nel test, poi
l'anagrafica generale `customer_registry`, con lettura diretta del documento
identificato dal CF. Solo se il cliente non è presente usa gli archivi
`new_clients`, `call_tasks` ed `expiration_records`, senza modificarli.
Gli import dell'anagrafica generale separano `Cognome Nome` verificando le
lettere del CF, anche per i cognomi composti. Le separazioni incerte vengono
segnalate e restano correggibili. I CF associati a dati discordanti sono
riconosciuti ma richiedono la compilazione manuale dopo verifica. I dati
mancanti restano da completare. `customer_clusters` non contiene il CF e non
viene interrogato.

Gli amministratori possono aggiornare l'elenco in **Importazioni → Anagrafica
clienti**, caricando l'export “Tutti i clienti” in formato `.xlsx`. Il pannello
mostra analisi, duplicati, anomalie, progresso, ultimo import e una ricerca
CF/P.IVA sul dato effettivamente memorizzato. Le partite IVA sono conservate
nell'archivio; la finestra delle proposte continua a richiedere il CF di una
persona fisica.

L'import salva esclusivamente identificativo, nominativo, nascita, fonte,
stato e provenienza della riga. Non importa i dati economici, le coperture,
le informazioni sui sinistri o i consensi dell'export e non genera chiamate.
Ogni identificativo ha un documento unico. Ricaricare lo stesso file non
crea duplicati, mentre un file aggiornato modifica le anagrafiche presenti
senza cancellare quelle assenti dal nuovo elenco. I gruppi discordanti
conservano le varianti per la verifica dell'amministratore.

Un'unica transazione salva anagrafica, trattativa e incremento del report.
Ritentare lo stesso salvataggio non duplica la proposta. Il meno delle
proposte è disabilitato perché il numero corrisponde alle proposte registrate;
OK e KO modificano solo l'esito, senza ridurre le attività svolte.
L'esito può essere corretto o riportato a “In corso”.

Il tab Trattative permette di filtrare cliente/CF, coppia codice e nome fonte,
proposta, stato, intervallo della proposta, data di nascita e giorni trascorsi.
I giorni sono calcolati per calendario e aggiornati anche a pagina aperta.

## Separazione dai dati operativi

Le tre raccolte del test sono:

- `negotiation_test_reports`
- `negotiation_test_deals`
- `negotiation_test_customers`

Le regole consentono l'accesso solo al proprietario nell'account di test e
validano fonte, categoria e dati richiesti. Il pilota non può scrivere in
`daily_reports` o modificare le chiamate operative. Il suo calendario chiamate
è nascosto e il profilo è escluso dalle analisi amministrative.

Il frontend e le regole Firestore devono essere pubblicati entrambi;
il deploy Pages non aggiorna le regole. Usare il database indicato in
`firebase.json`, non quello `(default)`.

## Verifica

```sh
npm run lint
npm run build
node --test tests/*.test.mjs
```

Prova manuale: aprire una proposta e annullarla; verificare che il conteggio
resti uguale; salvare una proposta con un cliente nuovo; controllare dati e
fonte in Trattative; provare filtri, OK, KO e riapertura; inserire nuovamente
lo stesso CF e verificare l'autocompilazione; ricaricare per verificare la
persistenza. Non usare le password nei file di test o negli screenshot.
