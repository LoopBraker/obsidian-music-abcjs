# COMP Field Implementation Test

This file demonstrates the new COMP: info field with the MusicNotes attribute.

## Example ABC notation with COMP field:

```abc
X:1
T:Test Song with COMP field
M:4/4
L:1/4
K:C
COMP: MusicNotes A B C
COMP: D E F G
COMP: A
```

## Features Implemented:

1. **COMP: Info Field**: A special multi-line field that can span multiple lines
   - All lines starting with `COMP:` belong to this field

2. **MusicNotes Attribute**: A standalone attribute (no value required)
   - Groups the music note components A-G
   - Has special cyan/meta color highlighting

3. **Music Note Components**: A, B, C, D, E, F, G
   - Can be used directly without explicitly calling the attribute
   - Have special red/atom color highlighting
   - Show up in autocompletion

4. **Syntax Highlighting Colors**:
   - `COMP:` key - purple (keyword)
   - `MusicNotes` attribute - cyan (meta)
   - `A`, `B`, `C`, `D`, `E`, `F`, `G` components - red (atom)

5. **Autocompletion**:
   - Type `COMP:` and you'll get suggestions for:
     - Attributes (MusicNotes)
     - Components (A, B, C, D, E, F, G)

## Files Modified:

1. **src/abc-comp.ts** (NEW): Defines COMP attributes and components
2. **src/abc-infofields.ts**: Added COMP to valid info keys
3. **src/abc.grammar**: Added CompLine, CompKey, CompContent, MusicNoteComponent, CompAttribute
4. **src/abc-lang.ts**: 
   - Added import for COMP definitions
   - Added autocompletion for COMP field
   - Added syntax highlighting for COMP elements

## Next Steps to Expand:

You can easily add more attributes to the COMP field by editing `src/abc-comp.ts`:

```typescript
export const compAttributes: CompAttribute[] = [
  {
    attribute: "MusicNotes",
    description: "Musical note letters (standalone, no value required)",
    requiresValue: false,
    color: "musicNote",
    components: [
      { component: "A", description: "Note A" },
      // ... etc
    ]
  },
  // Add more attributes here, for example:
  // {
  //   attribute: "Dynamics",
  //   description: "Dynamic markings",
  //   requiresValue: false,
  //   color: "dynamic",
  //   components: [
  //     { component: "pp", description: "Pianissimo" },
  //     { component: "p", description: "Piano" },
  //     // ... etc
  //   ]
  // }
]
```
