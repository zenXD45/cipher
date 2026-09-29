# Cipher — design system

The interface is editorial and information-dense: a serif wordmark and
headings (Newsreader), system sans for everything else, honest crypto
states visible in the chrome rather than hidden in a tooltip. The visual
through-line is one documented shape scale, soft tinted shadows, and quiet
motion.

All tokens live in `frontend/src/index.css` under `:root` /
`[data-theme='dark']`. Components must use tokens — no one-off hex values,
no ad-hoc radii.

## Shape — one scale, followed everywhere

| Token | Value | Used by |
| --- | --- | --- |
| `--r-surface` | `14px` | cards, panels, the settings dialog, message bubbles |
| `--r-control` | `9px` | inputs, textareas, buttons |
| `--r-pill` | `999px` | chips, badges, avatars, presence dots |

Anything that reads as a "card or container" is 14px; anything you type
into or press is 9px; anything that is a token/label/picture of a person
is fully round. Mixed radii inside one component are a bug.

## Color

Two themes, switched by `data-theme` on `<html>` (persisted in
`localStorage`, applied before first paint by `initTheme()`).

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` | `#f5f2ea` | `#16130f` |
| `--surface` | `#fcfaf4` | `#1d1913` |
| `--surface-2` | `#eee9dd` | `#282218` |
| `--ink` | `#211d14` | `#ece5d4` |
| `--ink-muted` | `#6b6354` | `#b3a990` |
| `--accent` | `#17614f` | `#5ea887` |
| `--danger` | `#a53d2f` | `#e27665` |

Paper-warm neutrals, one deep green accent (light) that flips to a lighter
sage (dark) to hold contrast. Text/background pairs are asserted ≥ 4.5:1 by
the browser test suite (`bubble text`, `sidebar name`, `send button`
contrast checks).

## Elevation

Shadows are tinted with the warm neutral of the theme, never pure black:

- `--shadow-1` — resting elevation (cards, bubbles).
- `--shadow-2` — raised elevation (dialog, sidebar over content).

## Motion

| Token | Value | Role |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | entrances, everything default |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | paired exits |
| `--d-fast` | `120ms` | hover/press |
| `--d-med` | `180ms` | small panels, list rows |
| `--d-modal` | `240ms` | dialog, message entrance |

Rules the code follows:

- **Press feedback** is physical: `.btn:active → scale(0.97)`,
  `.icon-btn:active → scale(0.92)`, `.conv-row:active → scale(0.99)`.
  Nothing ever scales to `0`.
- **Entrances** fade up (`translateY(4px) scale(0.98) → none`); the
  message bubble starts at `0.98`, not `0`, so it settles instead of
  popping.
- Nothing animates longer than `240ms`; no `ease-in` on entrances.
- `prefers-reduced-motion: reduce` collapses all animation/transition
  durations to `0.001ms` (global block in `index.css`) — asserted by the
  browser test.

## Typography

- `--font-serif`: Newsreader (self-hosted variable `woff2`, weights
  400–900, one file) — wordmark, headings, fingerprints, message-time in
  the dossier. No external font hosts.
- `--font-ui`: system sans stack — body, controls, lists.
- Headings: weight 600, `letter-spacing: -0.01em`.

## Layout

- Desktop (> 860px): two panes — `340px` conversation list + fluid thread.
- ≤ 860px: single pane; opening a thread hides the list and shows a
  back button (`.back-btn`); back returns to the list. Verified at
  390/768/1440px with zero horizontal overflow by the browser test.

## Accessibility

- `:focus-visible` → `2px solid var(--accent)` outline with `2px` offset
  (inputs additionally get a 3px accent halo via `box-shadow`).
- Interactive targets keep their `aria-label`s (`Settings`, `Log out`,
  `Search users`, `Message`, `Send message`, `Close`); the dialog is
  `role="dialog" aria-modal="true"` with focus moved to the first field on
  open and restored on close.
- Semantic hooks the test suite asserts on: `.sidebar`, `.conv-list`,
  `.conv-row`, `.chat-window`, `.message-bubble`, `.message-time`,
  `.read-receipt[data-read]`, `.chip-e2ee`, `.thread-empty`, `.list-empty`.
