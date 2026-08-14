# raspberry-mopitor — Spécifications

Dashboard de monitoring pour Raspberry Pi : une page web servie en local qui affiche
en temps réel l'état de la machine (CPU, RAM, température, disque, réseau).

## Objectifs

- **Léger** : le Pi peut être petit (Zero 2 W, Pi 3) et partagé entre plusieurs
  conteneurs — le monitor doit consommer le moins possible.
- **Propre** : repo public, code lisible, facile à prendre en main pour un contributeur.
- **Temps réel** : rafraîchissement configurable, jusqu'à ~100-200 ms.

## Scope

### v1 (live uniquement, pas de stockage)

| Métrique | Détail |
|---|---|
| CPU | usage global + par cœur, fréquence, load average (1/5/15 min) |
| Mémoire | RAM utilisée/disponible/totale, swap |
| Température | température CPU, seuils visuels (vert/jaune/rouge) |
| Ventilateur | vitesse en RPM via hwmon (Pi 5 Active Cooler…) — absent si le ventilateur n'a pas de tachymètre (fans GPIO 2 fils) |
| Disque | espace utilisé/total sur `/` |
| Réseau | débit rx/tx par seconde (interface principale) |
| Système | hostname, modèle de Pi, OS/kernel, uptime |

### v2 (plus tard)

- Historique + graphes (SQLite léger, rétention automatique) — Recharts côté front
- Liste des processus top N (CPU/RAM)
- Stats par conteneur Docker
- Alertes par seuil (mail/webhook)

## Stack

| Couche | Choix | Pourquoi |
|---|---|---|
| Backend | Node.js 20+ / TypeScript | préférence projet, écosystème contributeurs |
| Métriques | [`systeminformation`](https://systeminformation.io/) | très complet sur Linux/Pi (température, modèle…), zéro dépendance native |
| Serveur HTTP | `node:http` natif | pas de framework : surface de dépendances minimale |
| Temps réel | WebSocket ([`ws`](https://github.com/websockets/ws)) | une connexion unique, le serveur pousse — adapté aux fréquences élevées (100-200 ms), contrairement au polling HTTP |
| Frontend | React + Vite + TypeScript | écosystème de composants/graphes le plus riche pour la v2 |
| Style | Tailwind CSS | grille de cards responsive (mobile/tablette/desktop) rapide et propre |
| Graphes (v2) | Recharts | bonne intégration React, responsive par défaut |
| Déploiement | Docker + docker-compose | le Pi est partagé entre plusieurs services conteneurisés |

## Architecture

```
┌─────────────┐  WebSocket (JSON)   ┌──────────────────────────┐
│  Navigateur  │ ◄────────────────── │  Serveur Node (le Pi)     │
│  React SPA   │                     │  ├─ http: sert la SPA     │
│              │ ──────────────────► │  ├─ ws: push des snapshots │
└─────────────┘   (connexion seule)  │  └─ systeminformation      │
                                     └──────────────────────────┘
```

- Le serveur échantillonne les métriques à intervalle fixe (`REFRESH_INTERVAL_MS`)
  et pousse un snapshot JSON identique à tous les clients connectés.
- **Aucune collecte quand personne n'est connecté** (zéro coût au repos).
- Le front est découplé du back : il ne consomme que le JSON du WebSocket.
  Changer de framework front plus tard ne casse rien côté serveur.

### Protocole WebSocket

Endpoint : `GET /ws` (upgrade). Deux types de messages, du serveur vers le client :

```jsonc
// à la connexion — infos qui ne changent pas
{ "type": "static", "data": {
  "app": { "version": "0.1.0", "latestVersion": "0.2.0",
           "updateAvailable": true, "releaseUrl": "https://github.com/..." },
  "hostname": "...", "model": "Raspberry Pi 4 Model B",
  "os": "...", "kernel": "...", "arch": "...", "cpuModel": "...", "cores": 4 } }

// à la connexion et à chaque changement — config partagée par tous les clients
{ "type": "config", "data": { "refreshIntervalMs": 1000,
  "minIntervalMs": 100, "maxIntervalMs": 60000 } }

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
```

Du client vers le serveur, un seul message :

```jsonc
// change l'intervalle d'échantillonnage — serveur borne à [100, 60000] ms
// puis rediffuse un message "config" à TOUS les clients (valeur partagée)
{ "type": "setInterval", "intervalMs": 500 }
```

La reconnexion est automatique côté front (backoff exponentiel).

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

## Déploiement Docker

Image multi-stage : build du client (Vite) + build du serveur (tsc) → runtime
`node:20-alpine` minimal qui sert la SPA compilée et le WebSocket.

Pour que les métriques reflètent **le Pi hôte** et pas le conteneur :

| Réglage compose | Rôle |
|---|---|
| `network_mode: host` | voir les vraies interfaces (eth0/wlan0) + exposer le port directement |
| `pid: host` | voir les processus de l'hôte (utile pour la v2) |
| `volumes: /:/host:ro` | lire l'usage disque réel de l'hôte (`DISK_PATH=/host`) |

Lecture seule partout — pas de `--privileged`. `/proc` (CPU, RAM) et `/sys`
(température) sont déjà globaux vus depuis le conteneur.

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
- **CI** : `ci.yml` build server + client sur chaque PR et push sur `main`.

## Structure du repo

```
server/                  # backend Node/TS
  src/
    server.ts            # bootstrap HTTP + upgrade WS
    config.ts            # lecture des env vars
    types.ts             # types du protocole (miroir dans client/src/types.ts)
    ws/hub.ts            # clients connectés + boucle de broadcast
    metrics/             # un collecteur par domaine + agrégateur index.ts
client/                  # frontend React/Vite/TS
  src/
    hooks/useMetrics.ts  # connexion WS + reconnexion auto
    components/          # une card par métrique
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

## Roadmap

1. **v1** — dashboard live complet ✅
2. **v1.x** — réglage de l'intervalle depuis l'UI ✅ · images GHCR + check de
   version ✅ · polish UI, i18n éventuelle
3. **v2** — historique/graphes, processus, conteneurs Docker, alertes
