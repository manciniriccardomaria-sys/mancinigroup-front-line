# Trattative e rendicontazione giornaliera

Il flusso è attivo per Marina Bartoli (fonti `005` e `043`), Nicoletta
Cecchini (fonte `017`) e Riccardo collaboratore (fonte `098`).

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

## Rendicontazione giornaliera

Il catalogo `pilotReportCatalog.ts` mostra quattro riquadri: **Ricezione,
Promozione, Emissione, Terzi**. I report usano `daily_reports`, che alimenta
lo storico e le analisi amministrative.
Le voci Retail vengono sostituite da ULTRA Salute, SMEG, ULTRA Casa e ULTRA
Impresa, con contatori distinti per proposta, emissione e preventivo per terzi.
Vitariv/consegne, ScegliAllianz/consegne e Recensioni sono in Promozione.
La sezione “Voci precedenti” è rimossa dalla schermata giornaliera; i vecchi
contatori Retail e Winback manuali restano nello storico, senza ripartizioni
presunte tra prodotti. ScegliAllianz/proposte è rimosso, mentre rimane la
consegna. Protection riunisce Longevity Care e Lovia nel gruppo Preventivi e
proposte. Il + apre la scelta del prodotto, poi la scheda cliente. Il totale
mostrato somma i due contatori; i salvataggi e lo storico conservano gli ID
`longevityCare` e `contattiProtection` e il prodotto scelto. Il bordo superiore
di Emissione è verde e gli indicatori sono blu.
Le proposte e la consegna Vitariv richiedono la scheda cliente e non mostrano il meno; le altre
attività conservano i contatori manuali. Le voci “Contatti” già collegate
alla scheda cliente mantengono il flusso esistente.

La consegna Vitariv richiede CF, nome, cognome e nascita, con la stessa
ricerca e autocompilazione delle proposte. Un'unica transazione salva
l'anagrafica del cliente, il dettaglio della consegna nella raccolta isolata
`negotiation_test_deliveries` e l'incremento giornaliero. Annullare o fallire
il salvataggio non aumenta il contatore; ritentare con lo stesso ID non
duplica la consegna. Le consegne non compaiono come trattative aperte.

### Winback nel report giornaliero

I tre contatori leggono le schede del calendario delle fonti del profilo.
**Da effettuare** indica le chiamate in programma oggi, **Arretrate** quelle
ancora da effettuare con data precedente, **Fatte** quelle con un esito
registrato oggi. Un tentativo con esito non raggiungibile può risultare tra
le chiamate fatte e rimanere da effettuare o arretrato. Ogni contatore apre
il calendario su oggi, con il filtro selezionato. Ogni profilo può lavorare
le chiamate dal calendario con i propri permessi operativi.

## Funzionamento

Il + apre una finestra con codice fiscale, nome, cognome e data di nascita.
Proposta e data italiana sono precompilate. Nelle trattative di Marina è
preselezionata la fonte `005`. La fonte `043` è disponibile nel menu.
Per Nicoletta è preselezionata la fonte `017` e per Riccardo la `098`.
Annullare chiude la scheda senza registrare l’attività.

Il codice fiscale cerca prima le anagrafiche già inserite dal profilo, poi
l'anagrafica generale `customer_registry`, con lettura diretta del documento
identificato dal CF. Se il cliente non è disponibile, la ricerca consulta
gli archivi `new_clients`, `call_tasks` ed `expiration_records`. La ricerca
negli archivi è limitata alle fonti assegnate al profilo.
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

## Accesso ai dati

`negotiation_test_deals`, `negotiation_test_customers` e
`negotiation_test_deliveries` conservano i dati per profilo. Le regole
verificano proprietario, fonte, categoria e dati richiesti. I report già
registrati da Riccardo nel profilo di prova sono stati riportati in
`daily_reports`. Riccardo gestisce le chiamate della fonte `098`.

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
