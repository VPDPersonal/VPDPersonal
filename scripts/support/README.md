# Shared support artwork

The Pages build publishes the same four files for every Aspid package under
`https://vpdpersonal.github.io/VPDPersonal/support/`. Each repository supplies its own link destinations and accessible labels.

| File | Use |
| --- | --- |
| `kofi-button.svg`, `unity-asset-store-button.svg` | GitHub README buttons, 48px tall. Set each image to 50% width on desktop. For mobile, use a picture source with the same URL plus `#stacked` and 100% width. |
| `kofi-cup.png`, `unity-mark.svg` | Icons for localized website buttons. Put the white Unity mark on a dark background. |

Edit the button artwork in `templates/` and the original marks in `icons/`. The build embeds each icon in its button and publishes the standalone icon beside it.
