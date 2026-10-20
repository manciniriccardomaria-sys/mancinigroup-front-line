# Trattative: prova sul collaboratore Riccardo

Il flusso è attivo esclusivamente per `manciniriccardo9@gmail.com`, come
collaboratore di test della fonte `098 · MANCINI RICCARDO MARIA`.
La password non è conservata nel repository.

## Attività collegate

- Preventivi Motor (se)
- Preventivi Retail (se)
- Preventivi Motor (terzi)
- Preventivi Retail (terzi)
- SMEG
- Longevity Care
- ScegliAllianz
- Contatti Fondo Pensione
- Contatti Protection
- Contatti Energia
- Contatti Noleggio

Consegne, emissioni, Winback, sinistri e altre operazioni mantengono i normali
contatori. Le categorie sono selezionate per ID, anche se un amministratore
ne modifica l'etichetta. Per aggiungere altre proposte occorre aggiornare
`PROPOSAL_CATEGORY_IDS` e la corrispondente validazione in `firestore.rules`.

## Funzionamento

Il + apre una finestra con codice fiscale, nome, cognome e data di nascita.
Proposta e data italiana sono precompilate e non modificabili. La fonte è
quella assegnata al collaboratore. Annullare non registra alcuna attività.

Il codice fiscale cerca prima le anagrafiche già inserite nel test, poi gli
archivi `new_clients`, `call_tasks` ed `expiration_records`, senza modificarli.
Gli import conservano spesso un unico campo `Cognome Nome`: in quel caso i
campi sono compilati con una separazione iniziale e viene chiesto di
verificarli, soprattutto per i cognomi composti. I dati mancanti restano
da completare. `customer_clusters` non contiene il CF e non viene interrogato.

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
