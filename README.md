# ManciniGroup Front Line

App React/Vite per la rendicontazione giornaliera Front Line, con autenticazione Firebase e database Firestore.

## Avvio locale

Prerequisiti:

- Node.js 22 o superiore
- npm

Comandi:

```bash
npm install
npm run dev
```

L'app locale parte su `http://localhost:3000`.

## Build statica

```bash
npm run build
```

La build viene generata in `dist/`. La configurazione Vite usa asset relativi (`base: './'`) e `HashRouter`, quindi l'app funziona anche sotto un percorso GitHub Pages come:

```text
https://<utente-github>.github.io/<nome-repository>/
```

Le route interne usano il formato hash, ad esempio:

```text
https://<utente-github>.github.io/<nome-repository>/#/login
```

## Deploy su GitHub Pages

1. Crea un repository GitHub e carica questi file.
2. Vai in `Settings > Pages`.
3. In `Build and deployment`, scegli `GitHub Actions`.
4. Fai push sul branch `main`.
5. La workflow `.github/workflows/deploy.yml` esegue `npm ci`, `npm run build` e pubblica `dist/` su GitHub Pages.

## Configurazione Firebase

Per usare login email/password o Google su GitHub Pages:

1. Apri Firebase Console.
2. Vai in `Authentication > Settings > Authorized domains`.
3. Aggiungi il dominio:

```text
<utente-github>.github.io
```

Il file `firebase-applet-config.json` contiene la configurazione client Firebase. La chiave API Firebase web non e' un segreto, ma le regole Firestore devono comunque essere configurate correttamente.
