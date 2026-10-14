# Piano

App web pour apprendre des morceaux au piano, avec un piano numérique branché en Bluetooth ou en USB (pensée pour un Roland FP-10).

## Lancer

```bash
npm install
npm run dev
```

Puis ouvrir <http://localhost:5173> dans **Chrome** ou **Edge**. Safari ne sait pas encore parler aux instruments MIDI.

## Connecter le FP-10 en Bluetooth (Mac)

1. Allumer le piano. Si un téléphone y est connecté (app Roland), le déconnecter : le piano n'accepte qu'une connexion Bluetooth à la fois.
2. Ouvrir « Configuration audio et MIDI », menu Fenêtre › Afficher le studio MIDI, cliquer l'icône Bluetooth, puis « Connecter » en face du piano.
3. Dans l'app, accepter l'accès aux appareils MIDI. Le nom du piano s'affiche en haut à droite.

Avec un câble USB, le piano est reconnu dès qu'il est branché.

## Ce que fait la version 0.1

- **Écouter** : l'app joue tout le morceau, avec les notes qui tombent et le clavier qui s'allume.
- **Attente** : le morceau s'arrête sur chaque note à jouer, signalée en jaune, jusqu'à ce qu'elle soit jouée.
- **Rythme** : le morceau avance au tempo choisi ; chaque note est jugée juste, ratée ou fausse.
- Choix des mains jouées (l'app joue l'autre), vitesse de 20 à 150 %, boucle sur des mesures, frise pour repartir d'une mesure.
- **Chercher** : environ 10 800 pièces pour piano seul, triées du plus facile au plus difficile puis par popularité :
  - 579 pièces classiques du [Mutopia Project](https://www.mutopiaproject.org/) (domaine public ou Creative Commons), avec leur partition PDF ;
  - 10 179 partitions MuseScore placées dans le domaine public par leurs auteurs, issues du jeu de données [PDMX](https://zenodo.org/records/15571083), dont beaucoup d'arrangements faciles de grands thèmes. Chacune indique la difficulté choisie par son auteur, sa note et son nombre de vues.

  Chaque pièce indique aussi un niveau estimé (1 à 5) et si les deux mains sont séparées dans le fichier. La recherche comprend les titres français courants (« symphonie », « lettre à Élise », « 5e »). « Ajouter » met la pièce dans « Mes morceaux », avec sa source, sa licence et un lien vers sa partition.
- Import de fichiers MIDI, un ou plusieurs à la fois (bouton ou glisser-déposer), gardés dans le navigateur. Trois morceaux de démo.
- **Partition** : au choix, notes qui tombent seules, partition + notes, ou partition en grand. Un curseur suit le morceau sur la partition, reprises comprises. Les démos et les pièces MuseScore (PDMX) ont leur partition ; pour Mutopia, un lien ouvre le PDF.
- **Doigtés** : chaque note reçoit un numéro de doigt (1 pouce … 5 auriculaire), affiché en pastille sur les notes qui tombent et sur la touche à jouer en mode Attente.
  - **Écrits** (pastille blanche) : ceux de la partition, quand son auteur en a mis. Ils apparaissent aussi sur la partition. Les démos sont entièrement doigtées ; dans la recherche, un badge et un filtre « Avec doigtés » repèrent les pièces doigtées (365 sur 10 179).
  - **Calculés** (pastille bleu pâle à bord pointillé, badge « Doigtés calculés (auto) ») : pour toutes les autres notes, l'app propose un doigté d'après le modèle ergonomique de Parncutt et al. (1997). C'est une suggestion : sur 347 pièces doigtées par leur auteur, le calcul retrouve 56 % de leurs doigtés (58 % sur les pièces faciles). Il réussit bien les gammes et les positions à cinq doigts, moins les passages chargés.
  - Un menu choisit : écrits + calculés, écrits seulement, ou aucun.
- **Mains** : des mains vues de dessus, posées sur le clavier, jouent le morceau avec ces doigtés : le doigt qui joue s'enfonce, celui qui va jouer clignote, la main glisse vers sa position suivante. En mode Attente ou Rythme, la main que joue l'app reste estompée.
- Mains : un fichier avec une piste par main donne des mains exactes. Avec une seule piste, l'app devine les mains en suivant la position de chacune (« mains estimées »).
- Son de piano dans l'appareil (échantillons Salamander Grand Piano, CC-BY, chargés depuis tonejs.github.io) ou joué par le piano lui-même (« Son : piano »).
- Sans piano : clavier à l'écran (souris ou doigts) ou clavier d'ordinateur (rangée du milieu à partir de Q en AZERTY, W et X pour changer d'octave, Espace pour lancer).
- En mode Attente ou Rythme, jouer une note sur le piano lance l'exercice.

## Limites connues

- iPad et iPhone : aucun navigateur ne gère le MIDI. Il faudra une version app.
- Une tablette sur le réseau local ne peut pas utiliser le MIDI en HTTP simple : il faudra héberger l'app en HTTPS.
- Pour un fichier MIDI à une seule piste, les mains sont devinées : c'est souvent juste, pas toujours.
- Le niveau est estimé d'après les notes (vitesse de la main la plus occupée, touches noires, déplacements) et situe chaque pièce par rapport aux autres du catalogue. Il trie bien les extrêmes (comptines, Chopin) mais confond parfois le milieu : un ordre de grandeur, pas l'avis d'un professeur.
- « Ajouter » depuis le catalogue passe par le serveur de développement (relais vers Mutopia, fichiers PDMX locaux). Une version hébergée aura besoin d'un équivalent.
- La licence d'une partition PDMX est celle déclarée par son auteur : sûre pour une œuvre ancienne, pas forcément pour l'arrangement d'une chanson récente.
- Pas de partition dans l'app pour les pièces Mutopia ni pour les fichiers MIDI importés (un MIDI ne contient pas de partition).
- Les doigtés calculés ne s'affichent pas sur la partition (seulement les doigtés écrits).
- Les mains sont une simulation : elles montrent quel doigt va sur quelle touche, pas la posture, le poignet ou le geste réel.
- Quand un morceau commence par une levée (la Lettre à Élise, par exemple), les numéros de mesure de l'app sont décalés d'une mesure partielle par rapport à la partition.
- Le son de piano demande une connexion internet ; sans elle, un son de synthèse le remplace.

## Trouver d'autres morceaux

- [piano-midi.de](http://www.piano-midi.de/) : répertoire classique avec une piste par main (licence CC BY-SA), plutôt avancé. Le site refuse les robots : télécharger les fichiers dans le navigateur, puis les glisser tous ensemble dans l'app.
- [MuseScore](https://musescore.com/) : beaucoup d'arrangements faciles, dont des musiques actuelles. Exporter en MIDI depuis son compte.

## Catalogues

**Mutopia** : `public/catalog/mutopia.json`, livré avec l'app, est construit par `node scripts/build-catalog.mjs`. Le script parcourt Mutopia à une requête par seconde (une vingtaine de minutes la première fois), garde tout en cache dans `.cache/`, et analyse chaque pièce avec le code de l'app (mains, niveau). `--offline` reconstruit à partir du cache seul.

**PDMX** : il reste sur la machine, dans `.cache/pdmx/` (hors du dépôt), et le serveur de développement le sert sous `/pdmx/`. Sans lui, la recherche ne montre que Mutopia. Pour le construire (environ 440 Mo à télécharger, une minute d'analyse, 90 Mo de fichiers MIDI gardés) :

```bash
mkdir -p .cache/pdmx
curl -L -o .cache/pdmx/PDMX.csv https://zenodo.org/api/records/15571083/files/PDMX.csv/content
curl -L -o .cache/pdmx/mid.tar.gz https://zenodo.org/api/records/15571083/files/mid.tar.gz/content
node scripts/build-pdmx-catalog.mjs
```

Les partitions (MusicXML) s'ajoutent ensuite. L'archive de Zenodo pèse 1,9 Go : le script la lit au fil du téléchargement et ne garde que les partitions du catalogue (environ 150 Mo), sans rien stocker d'autre :

```bash
curl --http1.1 -L https://zenodo.org/api/records/15571083/files/mxl.tar.gz/content | node scripts/add-pdmx-scores.mjs
```

La copie de PDMX sur Hugging Face, plus rapide, ne contient pas les partitions MusicXML.

Le script du catalogue garde les pièces pour piano seul (une ou deux pistes de piano), sans conflit de licence, vues au moins 50 fois. Les filtres anti-doublons de PDMX ne sont pas utilisés : ils écartaient des arrangements utiles (toutes les versions de la Symphonie n° 5, par exemple). PDMX : Long et al., 2024, jeu de données sous licence CC BY 4.0.

## Développement

```bash
node scripts/eval-fingering.mjs   # fiabilité des doigtés calculés sur les pièces doigtées de PDMX
npm test        # tests du moteur et de la lecture des morceaux
npm run build   # vérification des types et version de production dans dist/
```

- `src/song` : modèle d'un morceau, lecture des fichiers MIDI, attribution des mains, démos.
- `src/engine/player.ts` : le moteur (temps, modes, jugement des notes, boucle).
- `src/audio`, `src/input` : son, piano MIDI, clavier d'ordinateur.
- `src/ui/renderer.ts` : dessin du clavier et des notes qui tombent.
- `src/main.ts` : l'interface qui relie le tout.
