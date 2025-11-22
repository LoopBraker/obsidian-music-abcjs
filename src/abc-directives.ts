/**
 * ABC Directives Definitions
 * Standard ABC notation directives (%%keyword) and their descriptions
 */

export interface DirectiveConfig {
  keyword: string
  description: string
  scope?: string  // page, tune, generation, etc.
  defaultValue?: string
}

// Valid ABC directives (without %% prefix)
export const validDirectives = new Set([
  // Page format
  "pageheight", "pagewidth", "topmargin", "botmargin",
  "leftmargin", "rightmargin", "indent", "landscape",
  "staffwidth",
  
  // Font directives
  "titlefont", "subtitlefont", "composerfont", "partsfont", "tempofont",
  "gchordfont", "headerfont", "historyfont", "footerfont",
  "annotationfont", "infofont", "measurefont", "repeatfont",
  "textfont", "voicefont", "vocalfont", "wordsfont",
  "setfont-1", "setfont-2", "setfont-3", "setfont-4",

  // Spacing directives
  "topspace", "titlespace", "titleleft", "subtitlespace", "textspace",
  "aligncomposer", "musicspace", "composerspace", "wordsspace",
  "vocalspace", "infospace", "partsspace", "staffsep",
  "sysstaffsep", "barsperstaff", "parskipfac", "lineskipfac",
  "stretchstaff", "stretchlast", "maxshrink", "maxstaffsep",
  "maxsysstaffsep", "newpage", "scale", "staves", "vskip",
  "splittune",

  // Measures/Bars 
  "barnumbers", "measurenb", "measurebox",
  "setbarnb", "contbarnb", "alignbars",

  // Other
  "score", "percmap",
])

// Directive Definitions with descriptions
export const directiveDefinitions: Record<string, string> = {
  // Page format
  "pageheight": "%%pageheight ⟨length⟩: sets the page height to ⟨length⟩. Default: 11 inches; scope: page; not available in abc2svg. For European A4 paper, the right value is 29.7cm.",
  "pagewidth": "%%pagewidth ⟨length⟩: sets the page width to ⟨length⟩. Default: 8.5 inches; scope: page; not available in abc2svg. For European A4 paper, the right value is 21cm.",
  "topmargin": "%%topmargin⟨length⟩: sets the page top margin to⟨length⟩.Default:1cm;scope:page;",
  "botmargin": "%%botmargin ⟨length⟩ sets the page bottom margin to ⟨length⟩. Default: 1 cm; scope: page",
  "leftmargin": "%%leftmargin ⟨length⟩: sets the page left margin to ⟨length⟩. Default: 1.8 cm; scope: page, restart.",
  "rightmargin": "%%rightmargin ⟨length⟩: sets the page right margin to ⟨length⟩. Default: 1.8 cm; scope:page, restart.",
  "indent": "%%indent ⟨length⟩: sets the indentation for the first line or system to ⟨length⟩. Default: 0; scope: tune.",
  "landscape": "%%landscape ⟨logical⟩: if 1, sets the page layout as landscape. Default: 0; scope: page;",
  "staffwidth": "%%staffwidth ⟨length⟩: used as an alternative to the %%pageheight and %%pagewidth directives. Default: none; scope: generation.",
  
  // Font directives
  "titlefont": "Font for the title",
  "subtitlefont": "Font for subtitles",
  "composerfont": "Font for composer name",
  "partsfont": "Font for part labels",
  "tempofont": "Font for tempo markings",
  "gchordfont": "Font for guitar chords",
  "headerfont": "Font for headers",
  "historyfont": "Font for history field",
  "footerfont": "Font for footers",
  "annotationfont": "Font for annotations",
  "infofont": "Font for info fields",
  "measurefont": "Font for measure numbers",
  "repeatfont": "Font for repeat marks",
  "textfont": "Font for text",
  "voicefont": "Font for voice labels",
  "vocalfont": "Font for vocal parts",
  "wordsfont": "Font for lyrics",
  "setfont-1": "Custom font 1",
  "setfont-2": "Custom font 2",
  "setfont-3": "Custom font 3",
  "setfont-4": "Custom font 4",
  
  // Spacing directives
  "topspace": "Space above tune",
  "titlespace": "Space after title",
  "titleleft": "Left-align title",
  "subtitlespace": "Space after subtitle",
  "textspace": "Space around text",
  "aligncomposer": "Align composer text",
  "musicspace": "Space above music",
  "composerspace": "Space after composer",
  "wordsspace": "Space around lyrics",
  "vocalspace": "Space for vocal parts",
  "infospace": "Space for info fields",
  "partsspace": "Space between parts",
  "staffsep": "Separation between staves",
  "sysstaffsep": "Separation between systems",
  "barsperstaff": "Number of bars per staff",
  "parskipfac": "Paragraph skip factor",
  "lineskipfac": "Line skip factor",
  "stretchstaff": "Stretch staff to fill width",
  "stretchlast": "Stretch last staff",
  "maxshrink": "Maximum staff shrinkage",
  "maxstaffsep": "Maximum staff separation",
  "maxsysstaffsep": "Maximum system separation",
  "newpage": "Force a new page",
  "scale": "Scale factor for entire tune",
  "staves": "Staff grouping",
  "vskip": "Vertical skip",
  "splittune": "Split tune across pages",
  
  // Measures/Bars
  "barnumbers": "Show bar numbers",
  "measurenb": "Measure numbering interval",
  "measurebox": "Box around measure numbers",
  "setbarnb": "Set bar number",
  "contbarnb": "Continue bar numbering",
  "alignbars": "Align bars across staves",
  
  // Other
  "score": "Score layout definition",
  "percmap": "Percussion mapping"
}

// Helper to check if a directive is valid
export function isValidDirective(keyword: string): boolean {
  return validDirectives.has(keyword)
}

// Helper to get directive description
export function getDirectiveDescription(keyword: string): string {
  return directiveDefinitions[keyword] || "ABC directive"
}
