# The Cell Therapy Trial Map

Live data for the LinkedIn newsletter *The Cell Therapy Trial Map*: CAR-T and TCR-T trials worldwide since 2008, from ClinicalTrials.gov and the WHO ICTRP registries.

The page is a dashboard with six tabs: Overview, Map, Trends, In vivo, Trials and Method. On the Map tab, click or search a country to see its trial history and trial list. Every chart has a CSV download.

- `index.html`: the dashboard page
- `css/style.css`: layout, dark and light themes
- `js/app.js`: counts the trials and draws every tab (same counting rules as the R script)
- `data/trials.csv`: one row per trial, written by the R script `cart_trials_world_v2.R`; replaced at each update
- `data/world.csv`: country outlines (Natural Earth) in the Equal Earth projection, with each country's region
- `d3.min.js`: d3 v7.9.0 (ISC licence), used to draw the charts and the map
- `fonts/`: IBM Plex Sans, IBM Plex Mono and Bricolage Grotesque (SIL Open Font License, see the OFL files)
- `preview.png`: the image shown when the link is shared

Monthly update: replace `data/trials.csv` only. The page reads it when it loads.

Links can open a tab or a country directly, for example `#map=China`, `#invivo` or `#trials`.

Counts are trials, not patients. Method and limits are described on the Method tab. Layout inspired by The Climate Brink dashboard.
