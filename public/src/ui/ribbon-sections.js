/**
 * The ribbon's sections and the layers of customization behind each:
 *
 *   ribbon row (basic controls) → section popout (that section's options, ⌄) → Customize panel (everything)
 *
 * `keys`: settings the section's ribbon controls change. `groups`: option groups (settings-schema.js) shown in the
 * section's popout. A section's ↺ reset restores both to their defaults. The Presets section has no popout; its
 * reset puts both presets back to Standard.
 */
export const RIBBON_SECTIONS = {
  view: {
    title: "View",
    keys: ["viewMode", "maxDepth"],
    groups: ["filter"],
  },
  recipes: {
    title: "Recipes",
    keys: ["pathMode", "includeForgePromotions"],
    groups: ["recipes"],
  },
  presets: {
    title: "Presets",
    keys: [],
    groups: [],
  },
  layout: {
    title: "Layout",
    keys: ["direction", "layoutEngine"],
    groups: ["layout"],
  },
  forces: {
    title: "Forces",
    keys: ["repelForce", "linkDistance"],
    groups: ["forces"],
  },
  style: {
    title: "Style",
    keys: ["nodeColorMode", "edgeRouting"],
    groups: ["nodes", "edges", "forge", "canvas"],
  },
  labels: {
    title: "Labels",
    keys: ["showLabels", "showQuantities", "showCostInLabel", "labelFadeZoom"],
    groups: ["labels", "highlight"],
  },
};

/**
 * Every setting a section's reset restores: its ribbon controls plus everything in its popout.
 * @param {string} sectionId
 * @param {{ id: string, options: { key: string }[] }[]} optionGroups  all option groups (Customize + Settings)
 */
export function sectionResetKeys(sectionId, optionGroups) {
  const section = RIBBON_SECTIONS[sectionId];
  const groupKeys = optionGroups
    .filter((group) => section.groups.includes(group.id))
    .flatMap((group) => group.options.map((option) => option.key));
  return [...new Set([...section.keys, ...groupKeys])];
}
