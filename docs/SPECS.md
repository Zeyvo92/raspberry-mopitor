# raspberry-mopitor — Spécifications

Dashboard de monitoring pour Raspberry Pi : une page web servie en local qui affiche
en temps réel l'état de la machine (CPU, RAM, température, disque, réseau), en
conserve l'historique et détaille processus et conteneurs.

## Objectifs

- **Léger** : le Pi peut être petit (Zero 2 W, Pi 3) et partagé entre plusieurs
  conteneurs — le monitor doit consommer le moins possible.
- **Propre** : repo public, code lisible, facile à prendre en main pour un contributeur.
- **Temps réel** : rafraîchissement configurable, jusqu'à ~100-200 ms.

## Scope

### v1 — live (livré)

| Métrique | Détail |
|---|---|
| CPU | usage global + par cœur, fréquence, load average (1/5/15 min) |
| Mémoire | RAM utilisée/disponible/totale, swap |
| Température | température CPU, seuils visuels (vert/jaune/rouge) |
| Ventilateur | vitesse en RPM via hwmon (Pi 5 Active Cooler…) — absent si le ventilateur n'a pas de tachymètre (fans GPIO 2 fils) |
| Disque | espace utilisé/total sur `/` |
| Réseau | débit rx/tx par seconde (interface principale) |
| Système | hostname, modèle de Pi, OS/kernel, uptime |

### v2 — historique, processus, conteneurs (livré)

| Fonction | Détail |
|---|---|
| Historique | SQLite (`node:sqlite`, aucune dépendance native), rétention automatique, agrégation par buckets côté serveur |
| Graphes | Recharts : CPU, température, mémoire, réseau — plages 15 min → 7 jours |
| Processus | top N par CPU **et** par mémoire, tri côté client |
| Conteneurs | CPU/mémoire/réseau par conteneur Docker, si le socket est monté |
| i18n | anglais / français, détecté depuis le navigateur, mémorisé |

### Plus tard

- Alertes par seuil (mail/webhook)

## Stack

| Couche | Choix | Pourquoi |
|---|---|---|
| Backend | Node.js 24 / TypeScript | préférence projet, écosystème contributeurs |
| Métriques | [`systeminformation`](https://systeminformation.io/) | très complet sur Linux/Pi (température, modèle, processus, Docker…), zéro dépendance native |
| Serveur HTTP | `node:http` natif | pas de framework : surface de dépendances minimale |
| Temps réel | WebSocket ([`ws`](https://github.com/websockets/ws)) | une connexion unique, le serveur pousse — adapté aux fréquences élevées (100-200 ms), contrairement au polling HTTP |
| Historique | `node:sqlite` (intégré à Node) | pas de module natif à compiler sur le Pi, pas de service externe |
| Frontend | React + Vite + TypeScript | écosystème de composants/graphes le plus riche |
| Style | Tailwind CSS | grille de cards responsive (mobile/tablette/desktop) rapide et propre |
| Graphes | Recharts | bonne intégration React, responsive par défaut ; chargé en *lazy chunk* (voir plus bas) |
| Déploiement | Docker + docker-compose | le Pi est partagé entre plusieurs services conteneurisés |

## Architecture

```
┌─────────────┐  WebSocket (JSON)   ┌────────────────────────────────┐
│  Navigateur  │ ◄────────────────── │  Serveur Node (le Pi)           │
│  React SPA   │                     │  ├─ http: sert la SPA           │
│              │ ──────────────────► │  ├─ ws/hub: clients + topics    │
└─────────────┘   (abonnements,      │  ├─ metrics/: collecteurs       │
                   requêtes histo)   │  └─ history/: SQLite + recorder │
                                     └────────────────────────────────┘
```

Quatre boucles indépendantes, chacune démarrée seulement quand elle sert :

| Boucle | Cadence | Tourne quand |
|---|---|---|
| `metrics` | `REFRESH_INTERVAL_MS` (réglable depuis l'UI) | ≥ 1 client connecté |
| `processes` | `PROCESSES_INTERVAL_MS` | ≥ 1 client abonné au topic (onglet ouvert) |
| `containers` | `DOCKER_INTERVAL_MS` | ≥ 1 client abonné au topic |
| `history` | `HISTORY_INTERVAL_MS` | toujours (sauf `HISTORY=false`) |

- **Aucune collecte live quand personne n'est connecté** (zéro coût au repos).
- L'historique est la seule exception assumée : un historique troué la nuit ne
  sert à rien. Il réutilise les snapshots déjà collectés par la boucle live
  quand un client regarde, et n'échantillonne lui-même que sinon.
- Le front est découplé du back : il ne consomme que le JSON du WebSocket.

### Historique

- Table unique `samples(ts PRIMARY KEY, cpu, cpu_temp, mem_*, disk_*, net_*, fan_rpm)`.
  `ts` en clé primaire = pas d'index supplémentaire, les requêtes par plage sont
  des parcours de rowid.
- `PRAGMA journal_mode=WAL` + `synchronous=NORMAL` : écritures courtes et peu
  d'usure de carte SD, au prix des toutes dernières secondes en cas de coupure.
- **Downsampling en SQL** : `GROUP BY (ts / bucket) * bucket` avec
  `bucket = max(HISTORY_INTERVAL_MS, plage / 360)`. Une requête renvoie donc
  ~360 points quelle que soit la plage. Le `CAST(? AS INTEGER)` est nécessaire :
  les paramètres liés arrivent en REAL et une division flottante donnerait un
  bucket par ligne.
- Les trous sont renvoyés explicitement (points à `null`) : une coupure se voit
  sur le graphe au lieu d'être lissée.
- Purge : `DELETE FROM samples WHERE ts < now - retention`, au démarrage puis
  toutes les heures.
- Tout échec (SQLite indisponible, disque plein, montage en lecture seule) est
  dégradé silencieusement : `features.history = false`, le monitoring continue.

### Protocole WebSocket

Endpoint : `GET /ws` (upgrade). Messages du serveur vers le client :

```jsonc
// à la connexion — infos qui ne changent pas
{ "type": "static", "data": {
  "app": { "version": "0.3.0", "latestVersion": "0.3.1",
           "updateAvailable": true, "releaseUrl": "https://github.com/..." },
  // ce que ce déploiement sait servir : l'UI masque le reste
  "features": { "history": true, "processes": true, "containers": false },
  "hostname": "...", "model": "Raspberry Pi 4 Model B",
  "os": "...", "kernel": "...", "arch": "...", "cpuModel": "...", "cores": 4 } }

// à la connexion et à chaque changement — config partagée par tous les clients
{ "type": "config", "data": { "refreshIntervalMs": 1000,
  "minIntervalMs": 100, "maxIntervalMs": 60000,
  "historyIntervalMs": 10000, "historyRetentionHours": 168 } }

// à chaque tick — métriques live
{ "type": "metrics", "data": {
  "ts": 1723300000000,
  "uptime": 123456,
  "cpu": { "load": 12.5, "perCore": [10, 15, 8, 17], "freqGhz": 1.8,
           "loadAvg": [0.42, 0.35, 0.30] },
  "memory": { "total": 0, "used": 0, "available": 0,
              "swapTotal": 0, "swapUsed": 0 },
  "temperature": { "cpu": 52.1 },          // null si sonde indisponible
  "fan": { "rpm": 3241 },                  // null sans tachymètre (hwmon)
  "disk": { "mount": "/", "total": 0, "used": 0 },
  "network": { "iface": "eth0", "rxSec": 0, "txSec": 0 }
} }

// réponse à "getHistory" — série agrégée, trous compris
{ "type": "history", "data": {
  "rangeMs": 3600000, "bucketMs": 10000, "from": 1723296400000,
  "points": [ { "ts": 1723296400000, "cpu": 12.5, "cpuTemp": 52.1,
                "memUsed": 0, "memTotal": 0, "swapUsed": 0,
                "diskUsed": 0, "diskTotal": 0,
                "netRx": 0, "netTx": 0, "fanRpm": 3241 } ] } }

// topic "processes" — union du top N CPU et du top N mémoire
{ "type": "processes", "data": {
  "ts": 1723300000000, "total": 118, "running": 2, "sleeping": 116,
  "list": [ { "pid": 812, "name": "node", "cpu": 4.2, "memPercent": 3.1,
              "memBytes": 129000000, "user": "pi", "command": "node dist/server.js" } ] } }

// topic "containers" — stats par conteneur Docker
{ "type": "containers", "data": {
  "ts": 1723300000000,
  "list": [ { "id": "9f2c1b4a5e6d", "name": "pihole", "image": "pihole/pihole",
              "state": "running", "cpuPercent": 1.4,
              "memUsage": 0, "memLimit": 0,
              "netRxSec": 0, "netTxSec": 0, "startedAt": 1723200000000 } ] } }
```

Du client vers le serveur :

```jsonc
// change l'intervalle d'échantillonnage — serveur borne à [100, 60000] ms
// puis rediffuse un message "config" à TOUS les clients (valeur partagée)
{ "type": "setInterval", "intervalMs": 500 }

// remplace la liste des topics auxquels CE client est abonné (onglet ouvert) ;
// les topics dont la feature est absente sont ignorés
{ "type": "subscribe", "topics": ["processes"] }

// demande une série ; la plage est bornée à [1 min, 30 jours]
{ "type": "getHistory", "rangeMs": 3600000 }
```

La reconnexion est automatique côté front (backoff exponentiel) et rejoue
l'abonnement et la dernière plage demandée.

## Interface

- **Onglets** : Dashboard (cards live) · Historique (graphes) · Processus ·
  Conteneurs. Les deux derniers ne s'affichent que si la feature est disponible,
  et l'abonnement WebSocket suit l'onglet ouvert.
- **Graphes** : le sélecteur de plage est unique et au-dessus des quatre
  graphes ; les points live prolongent la série entre deux requêtes (un point
  par bucket, pour garder une densité homogène) ; `syncId` synchronise le
  curseur des quatre graphes, ce qui permet de corréler un pic CPU avec la
  température et le réseau.
- **Couleurs** : teintes choisies dans la bande de luminosité sombre
  (OKLCH L 0.48-0.67) et vérifiées avec un validateur de palette contre le fond
  des cards (#121215). Le seul graphe à deux séries est le réseau :
  descendant `#0c9ad9` / montant `#ec4899` se séparent de ΔE 12.7 en deutéranopie
  (seuil 8) et 30.3 en vision normale (seuil 15). Les deux séries sont en plus
  étiquetées (légende + flèches ↓/↑) : l'identité ne repose jamais sur la
  couleur seule. Les valeurs restent en encre neutre, la couleur ne sert qu'à
  identifier la série.
- **Poids** : Recharts est chargé en chunk séparé, à l'ouverture de l'onglet
  Historique — le premier chargement reste à ~70 kB gzip.
- **i18n** : dictionnaires typés (`en` fait foi, toute clé manquante casse le
  build), langue détectée puis mémorisée dans `localStorage`.

## Configuration (variables d'environnement)

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `8585` | port HTTP/WS |
| `REFRESH_INTERVAL_MS` | `1000` | intervalle d'échantillonnage **initial** (borné à [`100`, `60000`]) — modifiable ensuite depuis l'UI |
| `DISK_PATH` | `/` | point de montage surveillé (`/host` en Docker) |
| `HOST_ROOT` | `/host` | racine de l'hôte montée en lecture seule — sert à lire le `/etc/os-release` de l'hôte (fallback : celui du conteneur). Le modèle de Pi, lui, vient du device tree (`/sys/firmware/devicetree/base/model`), non namespacé |
| `HWMON_ROOT` | `/sys/class/hwmon` | racine hwmon du kernel (tachymètre ventilateur) — surchargée uniquement pour les tests |
| `STATIC_DIR` | `../client/dist` | fichiers statiques de la SPA |
| `UPDATE_CHECK` | `true` | `false` pour désactiver le check de version |
| `UPDATE_CHECK_REPO` | `Zeyvo92/raspberry-mopitor` | repo dont les releases font référence (forks) |
| `APP_VERSION` | *(auto)* | version affichée — injectée dans l'image Docker depuis le tag git, sinon lue dans `package.json` |
| `HISTORY` | `true` | `false` : aucune écriture disque, monitoring strictement live |
| `HISTORY_DB` | `server/data/history.db` | fichier SQLite (`/data/history.db` en Docker, sur un volume nommé) |
| `HISTORY_INTERVAL_MS` | `10000` | période d'enregistrement (≈ 5 Mo par semaine) |
| `HISTORY_RETENTION_HOURS` | `168` | au-delà, les échantillons sont purgés |
| `PROCESSES` | `true` | `false` : onglet Processus masqué |
| `PROCESSES_INTERVAL_MS` | `3000` | cadence du scan `/proc` (uniquement onglet ouvert) |
| `PROCESSES_TOP_N` | `12` | lignes conservées par critère de tri |
| `DOCKER_STATS` | `true` | `false` : pas de stats conteneurs même si le socket est monté |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | socket Docker (lu aussi par `systeminformation`) |
| `DOCKER_INTERVAL_MS` | `3000` | cadence des stats conteneurs (uniquement onglet ouvert) |

## Déploiement Docker

Image multi-stage : build du client (Vite) + build du serveur (tsc) → runtime
`node:24-alpine` minimal qui sert la SPA compilée et le WebSocket.

Pour que les métriques reflètent **le Pi hôte** et pas le conteneur :

| Réglage compose | Rôle |
|---|---|
| `network_mode: host` | voir les vraies interfaces (eth0/wlan0) + exposer le port directement |
| `pid: host` | voir les processus de l'hôte (onglet Processus) |
| `volumes: /:/host:ro` | lire l'usage disque réel de l'hôte (`DISK_PATH=/host`) |
| `volumes: mopitor-data:/data` | conserver la base d'historique entre deux mises à jour d'image |

Lecture seule partout — pas de `--privileged`. `/proc` (CPU, RAM) et `/sys`
(température, ventilateur) sont déjà globaux vus depuis le conteneur.

Le socket Docker n'est **pas** monté par défaut : le monter revient à donner un
contrôle root-équivalent du démon au conteneur. C'est un opt-in documenté dans
`docker-compose.yml` (mount + `group_add` avec le GID du groupe `docker`, car le
conteneur tourne en utilisateur non privilégié). Sans lui, l'onglet Conteneurs
n'apparaît simplement pas.

## Distribution & mises à jour

- **Releases** : un tag `vX.Y.Z` poussé déclenche la GitHub Action `release.yml` :
  build multi-arch (arm64, armv7, amd64) → push sur GHCR
  (`ghcr.io/zeyvo92/raspberry-mopitor`, tags `X.Y.Z`, `X.Y`, `latest`)
  → création de la GitHub Release. Rien n'est compilé sur le Pi.
- **Check de version** : au démarrage puis toutes les 6 h, le serveur interroge
  `GET /repos/<repo>/releases/latest` (API GitHub, anonyme, timeout 8 s).
  Le résultat est intégré au message `static` (`app.updateAvailable`) et l'UI
  affiche un badge « vX.Y.Z available » cliquable vers la release. Tout échec
  (Pi hors-ligne, rate-limit, aucune release) est silencieux : le monitoring
  ne dépend jamais du check. Désactivable via `UPDATE_CHECK=false`.
- **Mise à jour utilisateur** : `docker compose pull && docker compose up -d`.
  Auto-update possible en ajoutant Watchtower côté utilisateur (son choix).
- **CI** : `ci.yml` typecheck + tests + build, server et client, sur chaque PR
  et push sur `main`.

## Structure du repo

```
server/                  # backend Node/TS
  src/
    server.ts            # bootstrap HTTP + upgrade WS
    config.ts            # lecture des env vars
    types.ts             # types du protocole (miroir dans client/src/types.ts)
    ws/hub.ts            # clients, topics et diffusion
    ws/loop.ts           # boucle collecte→diffusion démarrable/arrêtable
    history/store.ts     # SQLite : écriture, agrégation, purge
    history/recorder.ts  # échantillonnage périodique (réutilise le live)
    metrics/             # un collecteur par domaine + agrégateur index.ts
  test/                  # tests unitaires (node:test + tsx)
client/                  # frontend React/Vite/TS
  src/
    hooks/useMetrics.ts  # connexion WS, abonnements, reconnexion auto
    components/          # cards, onglets, tables, panneau historique
    charts/              # thème, échelles et graphe générique Recharts
    i18n/                # dictionnaires en/fr + provider
    types.ts             # miroir des types serveur
Dockerfile               # multi-stage
docker-compose.yml
docs/SPECS.md            # ce document
```

## Conventions

- Commits au format [Conventional Commits](https://www.conventionalcommits.org/) :
  `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`…
  (scope optionnel : `feat(server):`, `fix(client):`)
- Les titres de PR suivent le même format (utile en cas de squash merge).
- Tout ajout au protocole se fait dans `server/src/types.ts` **et**
  `client/src/types.ts` (les deux fichiers sont identiques).

## Roadmap

1. **v1** — dashboard live complet ✅
2. **v1.x** — réglage de l'intervalle depuis l'UI ✅ · images GHCR + check de
   version ✅ · polish UI ✅ · i18n FR/EN ✅
3. **v2** — historique/graphes ✅ · processus ✅ · conteneurs Docker ✅
4. **v2.x** — alertes par seuil (mail/webhook)
