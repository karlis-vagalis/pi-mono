# Art Styles

Ask Pi to use `random_style` for an art-direction prompt. Each call picks two to five distinct categories, such as typography, architecture, or texture, and joins one style from each with `x`.

Omit `categories` to draw from the full list. To narrow the draw, pass one or more distinct category names. For example, a poster brief could use:

```json
{ "categories": ["Typography styles", "Color styles", "Layout styles"] }
```

Only the listed categories can contribute a style. With one category, the tool returns one style.

## Install

```bash
pi install npm:@karlis-vagalis/pi-art-styles
```

Run `/reload` in an existing Pi session.
