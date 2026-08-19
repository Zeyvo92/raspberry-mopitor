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
| Ventilateur | vitesse en RPM via hwmon (Pi 5 Active Cooler…), affichée en jauge circulaire avec hélice animée — card masquée si le ventilateur n'a pas de tachymètre (fans GPIO 2 fils) |
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

### v2.1 — santé matérielle, réseau/disque complets, confort (livré)

| Fonction | Détail |
|---|---|
| Bridage | registre `get_throttled` du firmware : sous-tension, fréquence plafonnée, bridage, seuil thermique doux — état instantané **et** latché depuis le boot. Bandeau d'alerte sur tous les onglets |
| Consommation | watts lus dans hwmon : `power1_input` (µW) ou paires `inN_input`/`currN_input` du PMIC (Pi 5), total + top 5 des rails (estimation ailleurs, voir v2.2) |
| Sondes | températures autres que le SoC (NVMe, PMIC) listées sous la card Température |
| CPU | gouverneur cpufreq et fréquence maximale, lus à la connexion |
| Stockage | modèle de la carte SD/eMMC et usure estimée (`life_time`, par paliers de 10 %) |
| Réseau | toutes les interfaces montantes (débit + compteurs), qualité et niveau du lien Wi-Fi (`/proc/net/wireless`) |
| Disque | tous les systèmes de fichiers montés, et débit de lecture/écriture des périphériques bloc |
| Thème | clair / sombre / système, mémorisé ; une seule palette de tokens CSS |
| PWA | manifeste + service worker *network-first* : installable, ouvrable Pi éteint |
| Kiosque | `?kiosk=1` ou bouton : plein écran, sans onglets ni curseur, cards agrandies |
| Processus | filtre texte (nom / utilisateur / commande) et sparkline CPU par processus |

### v2.2 — consommation électrique (livré)

| Fonction | Détail |
|---|---|
| Puissance estimée | les cartes sans PMIC (Pi 4 et antérieurs) n'ont aucun capteur : la puissance y est **modélisée** à partir du profil de la carte (repos → pleine charge, table dans `metrics/power.ts`) et de la charge CPU. Marquée `source: "estimate"` jusque dans l'UI (« ≈ 4,6 W »), calibrable au wattmètre via `POWER_IDLE_W`/`POWER_MAX_W`, désactivable avec `POWER_ESTIMATE=false` |
| Énergie | intégration watts × temps en Wh, cumulée **par jour local** et persistée dans l'historique : aujourd'hui, 7 jours, 30 jours, total, plus la puissance moyenne. Portée par la boucle `history`, la seule qui tourne sans navigateur connecté |
| Coût | `ENERGY_PRICE` (prix du kWh) et `ENERGY_CURRENCY` affichent le coût de chaque fenêtre ; sans prix, seuls les kWh sont montrés |
| Graphe | la puissance est enregistrée dans `samples.power` et tracée dans l'onglet Historique (masquée si la machine n'a jamais rapporté un watt) |

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

### D'où viennent les métriques

`systeminformation` reste la source des métriques qu'il obtient à bas coût (CPU,
mémoire, température principale, uptime, conteneurs, processus). Trois
collecteurs le contournent volontairement, parce que sur Linux il *fork un
shell* à chaque appel — insoutenable à 100 ms de cadence :

| Collecteur | Source directe | Ce que faisait `systeminformation` |
|---|---|---|
| réseau | `/proc/net/dev` (+ `/proc/net/route`, `/proc/net/wireless`) | un `exec` de `cat …/statistics/*` **par interface et par tick** |
| disque (usage) | `/proc/mounts` + `statfs(2)` | `df -kPT` + `cat /proc/mounts` en `execSync` |
| disque (débit) | `/proc/diskstats` | `lsblk` + `cat /proc/diskstats` |

Une lecture de fichier remplace donc plusieurs processus par tick, et les
compteurs bruts permettent en prime de calculer les débits sur l'intervalle
réel plutôt que sur celui espéré. Les hôtes sans procfs (un contributeur sur
macOS) retombent sur `systeminformation` : l'interface par défaut et le montage
principal, sans plus.

Le matériel Pi (bridage, rails d'alimentation, sondes, gouverneur, usure carte)
se lit dans sysfs, chaque chemin étant surchargeable par variable
d'environnement — c'est ce qui rend ces collecteurs testables sur fixtures.

### Historique

- Table `samples(ts PRIMARY KEY, cpu, cpu_temp, mem_*, disk_*, net_*, fan_rpm,
  power)`. `ts` en clé primaire = pas d'index supplémentaire, les requêtes par
  plage sont des parcours de rowid.
- Table `energy(day PRIMARY KEY, wh, seconds)` : un compteur par jour local,
  écrit à chaque échantillon. Trois ordres de grandeur plus petite que
  `samples`, elle n'est **pas** purgée — un compteur de consommation qui
  redémarre à zéro chaque semaine ne servirait à rien.
- Les colonnes ajoutées après coup (`samples.power`) le sont par migration
  explicite au démarrage (`PRAGMA table_info` + `ALTER TABLE`) : `CREATE TABLE
  IF NOT EXISTS` ne touche pas une base existante, et personne ne doit perdre
  une semaine d'historique en mettant à jour.
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
  "app": { "version": "0.4.2", "latestVersion": "0.4.3",
           "updateAvailable": true, "releaseUrl": "https://github.com/..." },
  // ce que ce déploiement sait servir : l'UI masque le reste
  "features": { "history": true, "processes": true, "containers": false },
  "hostname": "...", "model": "Raspberry Pi 4 Model B",
  "os": "...", "kernel": "...", "arch": "...", "cpuModel": "...", "cores": 4,
  // politique cpufreq et usure du support de boot, lues à la connexion
  "governor": "ondemand", "cpuMaxGhz": 2.4,
  "storage": { "device": "mmcblk0", "name": "SC32G", "lifeUsedPercent": 20 } } }

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
  "temperature": { "cpu": 52.1,            // null si sonde indisponible
                   // sondes hors SoC (NVMe, PMIC) — vide sur la plupart des cartes
                   "sensors": [ { "name": "nvme", "celsius": 41.9 } ] },
  "fan": { "rpm": 3241 },                  // null sans tachymètre (hwmon)
  "disk": { "mount": "/", "total": 0, "used": 0,
            "filesystems": [ { "mount": "/boot/firmware", "type": "vfat",
                               "total": 0, "used": 0 } ],
            "io": { "readSec": 0, "writeSec": 0 } },  // null sans /proc/diskstats
  "network": { "iface": "eth0", "rxSec": 0, "txSec": 0,
               "interfaces": [ { "iface": "eth0", "rxSec": 0, "txSec": 0,
                                 "rxBytes": 0, "txBytes": 0 } ],
               // null sur un hôte sans radio
               "wifi": { "iface": "wlan0", "quality": 90, "signalDbm": -47 } },
  // null hors matériel Pi : les quatre bits du firmware, maintenant et latchés
  "throttle": { "raw": 327685,
                "now": { "underVoltage": true, "freqCapped": false,
                         "throttled": true, "softTempLimit": false },
                "sinceBoot": { "underVoltage": true, "freqCapped": false,
                               "throttled": true, "softTempLimit": false } },
  // null si la carte ne mesure ni ne modélise sa consommation
  // source: "sensor" (PMIC/wattmètre) ou "estimate" (profil de carte + charge)
  "power": { "watts": 7.65, "source": "sensor",
             "rails": [ { "name": "EXT5V", "watts": 6 } ] },
  // null tant que le compteur n'a rien accumulé (ou HISTORY=false)
  "energy": { "todayKwh": 0.12, "weekKwh": 0.84, "monthKwh": 3.6,
              "totalKwh": 12.5, "since": "2026-08-01", "avgWatts": 5.1,
              "pricePerKwh": 0.2516, "currency": "€" }
} }

// réponse à "getHistory" — série agrégée, trous compris
{ "type": "history", "data": {
  "rangeMs": 3600000, "bucketMs": 10000, "from": 1723296400000,
  "points": [ { "ts": 1723296400000, "cpu": 12.5, "cpuTemp": 52.1,
                "memUsed": 0, "memTotal": 0, "swapUsed": 0,
                "diskUsed": 0, "diskTotal": 0,
                "netRx": 0, "netTx": 0, "fanRpm": 3241,
                "power": 7.65 } ] } }

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
- **Graphes** : le sélecteur de plage est unique et au-dessus des graphes ; les points live prolongent la série entre deux requêtes (un point
  par bucket, pour garder une densité homogène) ; `syncId` synchronise le
  curseur de tous les graphes, ce qui permet de corréler un pic CPU avec la
  température, le réseau et la puissance appelée.
- **Couleurs** : teintes choisies dans la bande de luminosité sombre
  (OKLCH L 0.48-0.67) et vérifiées avec un validateur de palette contre le fond
  des cards (#121215). Le seul graphe à deux séries est le réseau :
  descendant `#0c9ad9` / montant `#ec4899` se séparent de ΔE 12.7 en deutéranopie
  (seuil 8) et 30.3 en vision normale (seuil 15). Les deux séries sont en plus
  étiquetées (légende + flèches ↓/↑) : l'identité ne repose jamais sur la
  couleur seule. Les valeurs restent en encre neutre, la couleur ne sert qu'à
  identifier la série.
- **Poids** : Recharts est chargé en chunk séparé, à l'ouverture de l'onglet
  Historique — le premier chargement reste à ~73 kB gzip.
- **i18n** : dictionnaires typés (`en` fait foi, toute clé manquante casse le
  build), langue détectée puis mémorisée dans `localStorage`.
- **Thème** : une seule palette de tokens (`--color-app`, `--color-surface`,
  `--color-ink*`…) déclarée dans `@theme`, redéfinie sous `[data-theme="light"]`.
  Tailwind v4 compile chaque utilitaire en `var(--color-…)`, donc rien dans les
  composants ne connaît le thème : le provider écrit le thème *résolu* sur
  `<html data-theme>` (le choix « système » est arbitré en JS, pas en CSS). Les
  couleurs de séries des graphes ne changent pas d'un thème à l'autre — la bande
  OKLCH 0.48-0.67 passe les 3:1 sur `#121215` **et** sur `#ffffff` (3.0:1 pour le
  vert CPU, le plus juste des cinq) — seule la chrome (grille, axes, curseur)
  bascule.
- **Bandeau de bridage** : affiché au-dessus des onglets, donc sur toutes les
  vues. `role="alert"` quand la condition est en cours, `role="status"`
  quand elle est seulement latchée depuis le boot.
- **Kiosque** : `?kiosk=1` ou le bouton ⛶ — onglets et réglages retirés, grille
  ramenée à deux colonnes, curseur masqué, plein écran demandé (les navigateurs
  ne l'accordent que sur geste utilisateur, l'entrée par URL reste donc
  fenêtrée). Échap sort.
- **PWA** : manifeste + service worker *network-first*. Le Pi est sur le même
  LAN : la fraîcheur prime, le cache ne sert qu'à ouvrir l'interface quand le Pi
  est injoignable — elle s'affiche alors « déconnectée » au lieu d'une page
  d'erreur. Les icônes PNG sont générées depuis le favicon par
  `client/scripts/generate-icons.mjs` (aucun rasteriseur dans la chaîne d'outils).
- **Processus** : un champ de filtre (nom, utilisateur, ligne de commande) et une
  sparkline CPU par ligne, alimentée côté client — le serveur devrait sinon
  mémoriser chaque PID vu.

## Configuration (variables d'environnement)

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `8585` | port HTTP/WS |
| `REFRESH_INTERVAL_MS` | `1000` | intervalle d'échantillonnage **initial** (borné à [`100`, `60000`]) — modifiable ensuite depuis l'UI |
| `DISK_PATH` | `/` | point de montage surveillé (`/host` en Docker) |
| `HOST_ROOT` | `/host` | racine de l'hôte montée en lecture seule — sert à lire le `/etc/os-release` de l'hôte (fallback : celui du conteneur). Le modèle de Pi, lui, vient du device tree (`/sys/firmware/devicetree/base/model`), non namespacé |
| `HWMON_ROOT` | `/sys/class/hwmon` | racine hwmon : tachymètre, sondes de température additionnelles et rails d'alimentation |
| `THROTTLE_PATH` | *(auto)* | registre de bridage du firmware ; vide = chemins Pi usuels, `/host` compris |
| `CPUFREQ_ROOT` | `/sys/devices/system/cpu` | gouverneur et fréquence maximale |
| `BLOCK_ROOT` | `/sys/block` | périphériques bloc, où se lit l'usure SD/eMMC |
| `PROC_NET_WIRELESS` | `/proc/net/wireless` | qualité et niveau du lien Wi-Fi |
| `STATIC_DIR` | `../client/dist` | fichiers statiques de la SPA |
| `UPDATE_CHECK` | `true` | `false` pour désactiver le check de version |
| `UPDATE_CHECK_REPO` | `Zeyvo92/raspberry-mopitor` | repo dont les releases font référence (forks) |
| `APP_VERSION` | *(auto)* | version affichée — injectée dans l'image Docker depuis le tag git, sinon lue dans `package.json` |
| `POWER_ESTIMATE` | `true` | `false` : pas de puissance modélisée sur les cartes sans capteur |
| `POWER_IDLE_W` | *(profil)* | consommation au repos, en watts — remplace le profil de la carte |
| `POWER_MAX_W` | *(profil)* | consommation à pleine charge, en watts |
| `ENERGY_PRICE` | `0` | prix du kWh ; `0` = aucun coût affiché |
| `ENERGY_CURRENCY` | `€` | symbole affiché à côté des coûts (aucune conversion) |
| `HISTORY` | `true` | `false` : aucune écriture disque, monitoring strictement live (donc pas de compteur d'énergie) |
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
  build multi-arch (arm64, amd64) → push sur GHCR
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
- **CI** : `ci.yml` typecheck + build + tests (couverture) server et client, sur
  chaque PR et push sur `main`.

## Tests

- **Outillage** : [Vitest](https://vitest.dev/) des deux côtés (+ Testing Library
  et jsdom côté client), couverture v8 avec **seuils à 100 %** (statements,
  branches, functions, lines) imposés en CI.
- **Serveur** (`server/test/`) : unitaires sur la config, le semver/le checker de
  version (API GitHub mockée en local), chaque collecteur (`systeminformation`
  mocké) et les lecteurs sysfs/procfs — device tree, os-release, hwmon
  (ventilateur, sondes, rails), `get_throttled`, cpufreq, usure carte,
  `/proc/net/dev`, `/proc/net/route`, `/proc/net/wireless`, `/proc/mounts`,
  `/proc/diskstats` — montés en arborescences de fixtures temporaires
  (`test/fixtures.ts`) : un Pi 5, un Pi 4 ou une machine sans capteur se
  reproduisent exactement, et aucune attente ne dépend du matériel du runner ; l'historique tourne sur une base SQLite en mémoire (agrégation par
  buckets, trous, purge, écritures qui échouent, `node:sqlite` absent) ; le hub
  WebSocket est testé avec des sockets simulées et des fake timers (cadence,
  clamp, broadcast multi-clients, abonnements aux topics, déconnexions pendant
  l'échantillonnage) ; `app.ts` est testé en intégration réelle (HTTP + WS +
  vrais collecteurs). Exclusions justifiées : `server.ts` (bootstrap du
  process), la garde anti-traversal (inatteignable, la normalisation WHATWG
  des URL la précède) et la garde anti-boucle-infinie des échelles de graphe.
- **Client** (`*.test.ts[x]` à côté du code) : formatters et échelles d'axes,
  dictionnaires i18n (mêmes clés et mêmes placeholders dans chaque langue),
  hook `useMetrics` (WebSocket simulée : reconnexion/backoff, abonnements,
  requêtes d'historique, prolongation live de la série), le provider de thème
  (préférence système, changement à chaud, stockage indisponible, `matchMedia`
  absent ou sans API d'écoute) et le mode kiosque (URL, Échap, API Fullscreen
  refusée ou absente), chaque composant (états vides, seuils de couleur, badge
  de mise à jour, tri et filtrage des processus, bandeau de bridage…).
  Recharts est rendu avec un `ResponsiveContainer` de taille fixe, jsdom
  n'ayant pas de layout. Exclusions : `main.tsx` (bootstrap DOM) et les
  utilitaires de test.
- **Commandes** : `npm test` ou `npm run test:coverage` dans `server/` et
  `client/`.

## Structure du repo

```
server/                  # backend Node/TS
  src/
    server.ts            # bootstrap du process (ouvre l'historique, écoute)
    app.ts               # serveur HTTP + upgrade WS, testable sans listen
    config.ts            # lecture des env vars
    types.ts             # types du protocole (miroir dans client/src/types.ts)
    ws/hub.ts            # clients, topics et diffusion
    ws/loop.ts           # boucle collecte→diffusion démarrable/arrêtable
    history/store.ts     # SQLite : écriture, agrégation, purge
    history/recorder.ts  # échantillonnage périodique (réutilise le live)
    history/energy.ts    # intégration watts→Wh, compteurs par jour local
    metrics/             # un collecteur par domaine + agrégateur index.ts
      sysfs.ts           # lectures sysfs tolérantes partagées
      throttle.ts        # registre de bridage du firmware
      power.ts           # rails d'alimentation (hwmon) + estimation par carte
  test/
    fixtures.ts          # arborescences sysfs/procfs jetables
client/                  # frontend React/Vite/TS
  src/
    hooks/useMetrics.ts  # connexion WS, abonnements, reconnexion auto
    theme.tsx            # choix clair/sombre/système + thème résolu
    kiosk.ts             # mode kiosque (URL, plein écran, Échap)
    components/          # cards, jauge, onglets, tables, panneau historique
    charts/              # thème, échelles et graphe générique Recharts
    i18n/                # dictionnaires en/fr + provider
    types.ts             # miroir des types serveur
  public/                # favicon, icônes PWA, manifeste, service worker
  scripts/               # générateur d'icônes PNG
Dockerfile               # multi-stage
docker-compose.yml
docs/SPECS.md            # ce document
```

## Affichage du ventilateur

hwmon ne publie pas le régime nominal du ventilateur : une valeur brute en RPM
ne dit rien sans échelle. La jauge est donc calée sur **8000 RPM** (vitesse max
de l'Active Cooler du Pi 5) et s'étend automatiquement si un ventilateur tourne
plus vite, de sorte que le remplissage signifie toujours « à quel point il
pousse ». L'hélice tourne à une vitesse **indicative** : à plein régime un
ventilateur fait ~130 tours/seconde, irreprésentable à l'écran, donc la plage
est ramenée à 2,5 s → 0,12 s par tour. L'animation respecte
`prefers-reduced-motion`.

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
4. **v2.1** — bridage/sous-tension ✅ · consommation ✅ · sondes et gouverneur ✅
   · réseau et disque complets ✅ · thème clair ✅ · PWA ✅ · kiosque ✅
5. **v2.2** — puissance estimée hors Pi 5 ✅ · compteurs d'énergie et coût ✅
   · courbe de puissance dans l'historique ✅
6. **v2.x** — alertes par seuil (mail/webhook)
