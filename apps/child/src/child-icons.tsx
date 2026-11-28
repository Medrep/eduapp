// Path data from the approved Modern Learning v1.0 Child icon set.
const paths = {
  alert: "M12 3 2 21h20L12 3Z M12 9v5 M12 17h.01",
  back: "M19 12H5 M12 19L5 12l7-7",
  book: "M12 6C9 3 5 3 2 4v15c4-1 7 0 10 2 3-2 6-3 10-2V4c-3-1-7-1-10 2Z M12 6v15 M5 8h4 M5 12h4 M15 8h4 M15 12h4",
  check: "m5 12 4 4L19 6",
  chevron: "m9 18 6-6-6-6",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 6v6l4 2",
  device: "M5 2h14v20H5z M10 19h4",
  download: "M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4",
  history: "M3 9h18L12 3 3 9Z M5 11v7 M10 11v7 M14 11v7 M19 11v7 M3 21h18",
  leaf: "M20 4C8 3 4 9 5 15c1 5 7 6 11 2 3-3 4-8 4-13Z M4 20 15 9 M9 15v-4 M12 12h5",
  math: "M4 7h7 M7.5 3.5v7 M15 5l5 5 M20 5l-5 5 M4 17h7 M15 15h5 M15 19h5",
  offline: "M3 9a15 15 0 0 1 18 0 M6 13a10 10 0 0 1 12 0 M9 17a5 5 0 0 1 6 0 M12 21h.01 M3 3l18 18",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M10 2h4l.8 3 2 .9 2.7-1.5 2 3.5-2 2.1v4l2 2.1-2 3.5-2.7-1.5-2 .9-.8 3h-4l-.8-3-2-.9-2.7 1.5-2-3.5 2-2.1v-4l-2-2.1 2-3.5 2.7 1.5 2-.9Z",
};

export type IconName = keyof typeof paths;

export function Icon({ name }: { name: IconName }) {
  return <svg aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d={paths[name]} />
  </svg>;
}
