# The Cell Therapy Trial Map

Live data for the LinkedIn newsletter *The Cell Therapy Trial Map*: CAR-T and TCR-T trials worldwide since 2008, from ClinicalTrials.gov and the WHO ICTRP registries.

- `index.html`: the page (map, charts, tables, method)
- `data/trials.csv`: one row per trial, written by the R script `cart_trials_world_v2.R`; replaced at each update
- `data/world.csv`: country outlines (Natural Earth) in the Equal Earth projection, with each country's region
- `d3.min.js`: d3 v7.9.0 (ISC licence), used to draw the charts

Counts are trials, not patients. Method and limits are described on the page.
