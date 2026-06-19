# Elenco fonti

L'elenco ufficiale delle associazioni codice/nome e' salvato in
`src/sourceDirectory.ts`.

La fonte deve essere identificata dalla coppia `codice + nome`, perche' alcuni
codici hanno piu' associazioni:

- `000`: MOLFETTA UMBERTO; DIRETTA D'AGENZIA
- `004`: MOLFETTA 1; DIRETTA
- `026`: TERLIZZI 1; DIRETTA
- `031`: MOLFETTA VIA CORMIO; MANCINI GROUP SAS DI MANCINI E DALIANI POLI SAS

Durante l'importazione, se nel file e' presente soltanto uno di questi codici
senza il nome della fonte, il record deve essere segnalato come ambiguo invece
di assegnarlo automaticamente.
