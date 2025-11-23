/**
 * ABC COMP Field Definitions
 * Special multi-line composition field with attributes and components
 */

export interface CompComponent {
  component: string
  description: string
}

export interface CompAttribute {
  attribute: string
  description: string
  requiresValue: boolean
  components: CompComponent[]
  color?: string // Special color for syntax highlighting
}

// Define the MusicNotes attribute with A-G components
export const compAttributes: CompAttribute[] = [
  {
    attribute: "MusicNotes",
    description: "Musical note letters (standalone, no value required)",
    requiresValue: false,
    color: "musicNote", // Special color identifier
    components: [
      { component: "A", description: "Note A" },
      { component: "B", description: "Note B" },
      { component: "C", description: "Note C" },
      { component: "D", description: "Note D" },
      { component: "E", description: "Note E" },
      { component: "F", description: "Note F" },
      { component: "G", description: "Note G" }
    ]
  }
]

// Create a flat map of all components for quick lookup
export const allCompComponents = new Map<string, CompComponent>()
compAttributes.forEach(attr => {
  attr.components.forEach(comp => {
    allCompComponents.set(comp.component, comp)
  })
})

// Create a set of all attribute names for validation
export const validCompAttributes = new Set(
  compAttributes.map(attr => attr.attribute)
)

// Helper to check if a string is a valid COMP component
export function isValidCompComponent(component: string): boolean {
  return allCompComponents.has(component)
}

// Helper to get attribute for a component
export function getAttributeForComponent(component: string): CompAttribute | undefined {
  for (const attr of compAttributes) {
    if (attr.components.some(c => c.component === component)) {
      return attr
    }
  }
  return undefined
}

// Helper to check if an attribute requires a value
export function compAttributeRequiresValue(attribute: string): boolean {
  const attr = compAttributes.find(a => a.attribute === attribute)
  return attr ? attr.requiresValue : true
}
