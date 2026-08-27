export interface GameGuide {
  title: string;
  game: string;
  description: string;
  url: string;
  repo: string;
  tags: string[];
}

export const games: GameGuide[] = [
  {
    title: "RE4 Guía",
    game: "Resident Evil 4 (2005)",
    description:
      "Guía y tracker offline del original de 2005 (port Wii/HD → Switch): medallones, tesoros, arsenal y walkthrough capítulo a capítulo.",
    url: "https://artemiop.com/resident-evil-4-guide/",
    repo: "https://github.com/ArtemioPadilla/resident-evil-4-guide",
    tags: ["ES/EN", "PWA offline", "19 capítulos"],
  },
  {
    title: "WW Guía",
    game: "The Legend of Zelda: The Wind Waker HD",
    description:
      "Guía del Gran Mar: los 6 templos, Triforce Charts, Heart Pieces, arsenal y secretos de las islas.",
    url: "https://artemiop.com/zelda-wind-waker-guide/",
    repo: "https://github.com/ArtemioPadilla/zelda-wind-waker-guide",
    tags: ["ES/EN", "PWA offline", "18 islas"],
  },
  {
    title: "OoT Guía",
    game: "The Legend of Zelda: Ocarina of Time 3D",
    description:
      "Los 100 Gold Skulltulas, Heart Pieces, canciones de ocarina y los 8 templos — niño y adulto.",
    url: "https://artemiop.com/zelda-ocarina-of-time-guide/",
    repo: "https://github.com/ArtemioPadilla/zelda-ocarina-of-time-guide",
    tags: ["ES/EN", "PWA offline", "12 capítulos"],
  },
  {
    title: "Pokopia Guía",
    game: "Pokémon Pokopia",
    description:
      "Pokédex completista, recetas de construcción, coleccionables y las áreas del paraíso — el spin-off sandbox de Game Freak.",
    url: "https://artemiop.com/pokemon-pokopia-guide/",
    repo: "https://github.com/ArtemioPadilla/pokemon-pokopia-guide",
    tags: ["ES/EN", "PWA offline", "300 Pokémon"],
  },
];
