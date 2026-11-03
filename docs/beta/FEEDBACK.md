# Beta feedback / Retour de bêta

Copy this page, fill in what applies, and send it back to the person who gave you the archives. A short answer is fine; "I stopped at this step" is the most useful thing you can send.

Copiez cette page, remplissez ce qui s'applique, et renvoyez-la à la personne qui vous a remis les archives. Une réponse courte convient ; « je me suis arrêté à cette étape » est ce que vous pouvez envoyer de plus utile.

## Your setup / Votre poste

- Node, or browser and version / Node, ou navigateur et version:
- Temporal: native or polyfill (the first line of `node try.mjs`) / natif ou polyfill :
- TypeScript version and `moduleResolution`:
- Bundler / Empaqueteur :
- Time zone of the machine / Fuseau de la machine :

## Installing and starting / Installer et démarrer

- Where did you stop, and for how long? / Où vous êtes-vous arrêté, et combien de temps ?
- What did the guide leave out? / Qu'est-ce que le guide a oublié ?

## A real date bug / Un vrai bogue de date

- What did your project do with dayjs? Input, expected, obtained. / Que faisait votre projet avec dayjs ? Entrée, attendu, obtenu.
- Does the comparison produce this case? If not, it should: please give the input. / La comparaison produit-elle ce cas ? Sinon, elle le devrait : donnez l'entrée.

## Performance

- Operation, input size, your measure and how you took it. / Opération, taille de l'entrée, votre mesure et comment vous l'avez prise.
- Bytes added to your real bundle, with and without the polyfill. / Octets ajoutés à votre vrai paquet, avec et sans le polyfill.

## Security / Sécurité

- An input that makes a function that returns a `Result` throw, hang or take a long time. / Une entrée qui fait lever une erreur, bloquer ou durer une fonction qui rend un `Result`.
- **Do not put a vulnerability in a public issue.** / **Ne mettez pas une faille dans un ticket public.**

## Documentation

- A sentence you had to read twice, a claim you could not check. / Une phrase relue deux fois, une affirmation que vous n'avez pas pu vérifier.

## The API / L'API

- A name or a shape you would change, and what you would write instead. / Un nom ou une forme que vous changeriez, et ce que vous écririez à la place.
- A function you expected and did not find. / Une fonction attendue et absente.
