# Change Log

All notable changes to the "Rainbow Brackets 2" extension will be documented in this file.

<!-- Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file. -->

## [v1.2.0]

- Closing brackets that match an opening bracket of the first color are no longer red, as if they had no opening bracket (#6, #7, #9)
- Brackets in strings, comments and regular expressions are left alone (#10). They are found with the syntax highlighting grammar of the language, like VS Code's own bracket pair colorization does. `rainbowBrackets.ignoreStringsAndComments` turns this off
- Changing the color theme no longer stops the extension (#12)
- The first squiggly bracket color follows the theme again. It was dark gray in dark themes
- `rainbowBrackets.roundBracketsColor` is applied (#8), and each color setting takes any number of colors
- Settings apply without reloading
- Every visible editor is colored, not only the active one
- Large files are scanned in the background, and only the brackets around the visible lines are decorated
- The extension starts after VS Code has finished starting

## [v1.1.0]

- Excluded languages are checked for the editor being switched to
- Default colors for squiggly brackets

## [v1.0.0]

- Initial release
