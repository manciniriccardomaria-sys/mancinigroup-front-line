# Calendario chiamate

## Fonti e presa in carico

La fonte rappresenta il titolare del portafoglio clienti. Puo' essere:

- una dipendente che usa l'app;
- un collaboratore esterno.

La fonte originale del cliente non cambia quando una dipendente aiuta un'altra
fonte. Il calendario conserva quindi due informazioni distinte:

- `fonte`: titolare originale del cliente;
- `assegnatario`: dipendente che prende in carico la chiamata.

Ogni dipendente vede prioritariamente i clienti della propria fonte. Puo'
consultare le altre fonti e prendere in carico una chiamata per aiutare una
collega. La presa in carico evita che due persone lavorino contemporaneamente
lo stesso cliente.

## Stati

Lo stato iniziale e' sempre `Da chiamare`. Tutti gli stati restano modificabili:

- Da chiamare
- Chiamato
- Da richiamare
- Non raggiungibile
- Cambio/Rottamaz. macchina
- Cliente perso

Quando viene scelto `Da richiamare`, la nuova data di chiamata e' obbligatoria.
La cronologia conserva autore, data e ora di ogni variazione.

## Arretrati

Le chiamate scadute che non risultano completate restano visibili nel
calendario e nell'elenco operativo, evidenziate come arretrate. Una chiamata
rinviata usa la nuova data indicata per il richiamo.

## Informazioni necessarie prima dell'implementazione

Per collegare gli account alle fonti serve una tabella con:

- email della dipendente;
- codice e nome della sua fonte principale;
- eventuali altre fonti gestite dalla stessa dipendente;
- indicazione delle fonti appartenenti a collaboratori.

## Dipendenti autorizzate e fonti

| Dipendente | Email | Fonti |
| --- | --- | --- |
| Marina Bartoli | b.marinamancinigroup@gmail.com | 005, 043 |
| Isabella Cappelluti | isabella.cappelluti@gmail.com | 057, 022 |
| Nicoletta Cecchini | nicolemancinigroup@gmail.com | 017 |
| Rosa Ruggieri | rossellamancinigroup@gmail.com | 003, 045 |
| Angela Sforza | s.angelamancinigroup@gmail.com | 028, 082, 038 |
| Maria Valeria Bellapianta | valeriamancinigroup@gmail.com | 008 |

La fonte dismessa `019` viene assegnata alla fonte `008`.
