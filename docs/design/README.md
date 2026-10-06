# Design: Affichage

The visual identity of the citizen app (`apps/citizen`) is **Affichage**: paper
sheets pasted on a public wall. Chosen by Marouane on 6 October 2026 from seven
directions, then refined over four presentations. Locked in on the same day.

Open any page in a browser; each is a single self-contained HTML file (fonts
from Google Fonts, everything else inline). They are the record of the
decision and the reference for implementation, and can be reused for a proof
of concept or a publication.

| Page | What it is |
| --- | --- |
| `01-seven-directions.html` | The Today screen in seven looks. Affichage, Glass Chamber, Clay Commune and Kinetic were shortlisted. |
| `02-file-page-in-seven-looks.html` | The file page, the app's densest screen, in the four shortlisted looks plus variants. Affichage won. |
| `03-affichage-identity.html` | The identity itself: the six swaps that separate it from generic neo-brutalism, palette, material, type, the six motion verbs, both screens rebuilt, and the three-PR plan. |
| `04-affichage-screens.html` | Nineteen screens of the wider app in Affichage, with a button lab at the top. |

## Rules of the look

- Paper `#F8F3E6` on wall `#EFE8D6`, ink `#121212`, amber `#F5A623` (yours),
  navy `#1B2A4A` (official), red `#D8321F` (numbers, dates, alarms only).
- Text is black only on paper or amber, white only on navy, ink or red.
  Never black on navy.
- Titles and labels: Big Shoulders Display (900 and 700). Body: Public Sans.
  Data: JetBrains Mono. The stencil face was rejected as hard to read.
- No drop shadows. Depth is a second coloured sheet behind, turned about one
  degree, held by staples or a tack. Torn edges and paper grain.
- Motion verbs: paste, press, peel, tear, flap, march.
- Buttons use the press model with the **ink backing** variant: hold flattens
  the sheet onto its backing, release springs back and flips the label.
- Never lay out two text columns that can both wrap. Labels stay on one
  line, values get their own column or row. Check at 360 px.
- Pictures are prints taped on, four at most, stripped of location, time and
  device before upload. Official documents wear navy, resident ones red.

## Implementation plan

Landed in `apps/citizen` on 2026-10-06 in three PRs behind a flag (tokens and type #34,
sheets and marks #35, motion #36), then made the only look with the flag removed and a
night mode (navy wall, paper sheets) in the PR after. The app's `src/tokens.css` is now the
source of the material; this folder stays the record of the decision.
