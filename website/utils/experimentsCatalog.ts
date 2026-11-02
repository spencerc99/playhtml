// ABOUTME: Lists every public playhtml experiment with its name, route, and source.
// ABOUTME: Shared by the homepage archive and the floating experiment badge.

export interface ExperimentCatalogEntry {
  number: string;
  name: string;
  description: string;
  href?: string;
  image?: string;
  actionLabel?: string;
  recommended?: boolean;
  // Path under website/ that holds the experiment's code, for the source link.
  sourcePath?: string;
  related?: { label: string; href: string };
}

export const experiments: ExperimentCatalogEntry[] = [
  {
    number: "EX-01",
    sourcePath: "experiments/one",
    name: "one color",
    description: "A shared color field",
    href: "/experiments/one/",
    image: "/experiments/index-previews/ex-01.png",
    actionLabel: "Open",
  },
  {
    number: "EX-02",
    sourcePath: "experiments/two",
    name: "cursor party",
    description: "Dance with other cursors",
    href: "/experiments/two/",
    image: "/experiments/index-previews/ex-02.png",
    actionLabel: "Open",
  },
  {
    number: "EX-03",
    sourcePath: "fridge.tsx",
    name: "the poems we found",
    description: "A huge collective fridge poetry game",
    href: "/fridge",
    image: "/experiments/index-previews/ex-03.png",
    actionLabel: "Open",
    recommended: true,
  },
  {
    number: "EX-04",
    sourcePath: "experiments/4",
    name: "every color",
    description: "Every color added by someone",
    href: "/experiments/4/",
    image: "/experiments/index-previews/ex-04.png",
    actionLabel: "Open",
    recommended: true,
  },
  {
    number: "EX-05",
    sourcePath: "experiments/5",
    name: "minute faces (together)",
    related: {
      label: "sequel to minute faces",
      href: "https://clock.spencer.place",
    },
    description: "A day colored minute by minute",
    href: "/experiments/5/",
    image: "/experiments/index-previews/ex-05.png",
    actionLabel: "Open",
    recommended: true,
  },
  {
    number: "EX-06",
    sourcePath: "experiments/6",
    name: "screen sizes",
    description: "Every screen size visited",
    href: "/experiments/6/",
    image: "/experiments/index-previews/ex-06.png",
    actionLabel: "Open",
  },
  {
    number: "EX-07",
    sourcePath: "experiments/7",
    name: "when cursors meet",
    description: "Hold hands through the browser",
    href: "/experiments/7/",
    image: "/experiments/index-previews/ex-07.png",
    actionLabel: "Open",
  },
  {
    number: "EX-08",
    sourcePath: "experiments/8",
    name: "grid paper",
    description: "A shared sheet of paper",
    href: "/experiments/8/",
    image: "/experiments/index-previews/ex-08.png",
    actionLabel: "Open",
  },
  {
    number: "EX-09",
    sourcePath: "experiments/9",
    name: "cursor bar",
    description: "Rewind after a long day scrolling",
    href: "/experiments/9/",
    image: "/experiments/index-previews/ex-09.png",
    actionLabel: "Open",
    recommended: true,
  },
  {
    number: "EX-10",
    sourcePath: "experiments/cinderblock",
    name: "cinderblock yard",
    description: "Build heavy structures together",
    href: "/experiments/cinderblock/",
    image: "/experiments/index-previews/ex-10.png",
    actionLabel: "Open",
    recommended: true,
  },
];

export function findExperiment(
  number: string,
): ExperimentCatalogEntry | undefined {
  return experiments.find((experiment) => experiment.number === number);
}
