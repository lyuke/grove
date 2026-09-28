# Terminal icon font

`SymbolsNerdFontMono-Regular.woff2` is a lossless WOFF2 conversion of the mono symbols font from Nerd Fonts v3.4.0. Only icon Unicode ranges are registered; normal terminal text continues to use SF Mono / Menlo.

- Source: https://github.com/ryanoasis/nerd-fonts/tree/v3.4.0/patched-fonts/NerdFontsSymbolsOnly
- Original TTF SHA-256: `f0f624d9b474bea1662cf7e862d44aebe1ae1f6c7f9cb7a0ca5d0e5ac9561c60`
- WOFF2 SHA-256: `a75e3c6fa2d575b39a0289daf14d05d88600a5ca95484f5c958683c88b1aa303`
- License: `resources/licenses/NerdFontsSymbols-MIT.txt`, shipped with the application.

Recreate using fontTools with WOFF support: load the upstream TTF with `TTFont`, set `font.flavor = "woff2"`, then save. The full upstream glyph set is retained, including supplementary-plane Material Design icons.
