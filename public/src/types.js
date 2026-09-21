/**
 * Shared JSDoc type definitions (no runtime code). Editors pick these up via jsconfig.json.
 *
 * @typedef {'item' | 'currency' | 'guild' | 'named'} EntityKindName
 * @typedef {'api' | 'mf' | 'custom'} RecipeSourceName
 *
 * @typedef {object} Item
 * @property {number} id
 * @property {string} name
 * @property {string} icon
 * @property {string} [rarity]
 * @property {string} [type]
 * @property {number} [level]
 * @property {string} [chatLink]
 * @property {string[]} flags
 *
 * @typedef {object} Entity  Display info for any node kind (item, currency, guild upgrade, generic ingredient).
 * @property {string} name
 * @property {string | null} icon
 * @property {string} [rarity]
 * @property {string} [type]
 * @property {number} [level]
 * @property {string} [chatLink]
 * @property {string[]} flags
 *
 * @typedef {object} Ingredient
 * @property {'Item' | 'Currency' | 'GuildUpgrade' | 'Named'} type
 * @property {number | string} id  Numeric id, or the wiki page name for `Named` ingredients.
 * @property {number} count
 *
 * @typedef {object} Recipe
 * @property {number | string} id
 * @property {RecipeSourceName} source
 * @property {string} type
 * @property {number} outputItemId
 * @property {number} outputCount  Can be fractional for random-yield Mystic Forge recipes.
 * @property {string[]} disciplines
 * @property {number} minRating
 * @property {number} craftTimeMs
 * @property {string[]} flags
 * @property {Ingredient[]} ingredients
 * @property {boolean} [isPromotion]  Mystic Forge material promotion (skipped unless includeForgePromotions; not a "forge result").
 *
 * @typedef {object} TreeNode  One occurrence of an ingredient in the crafting tree.
 * @property {string} path  Stable id from the root, e.g. "r/0/2".
 * @property {EntityKindName} kind
 * @property {number | string} entityId
 * @property {number} quantity
 * @property {number} depth
 * @property {TreeNode | null} parent
 * @property {TreeNode[]} children
 * @property {Recipe | null} recipe
 * @property {number} recipeIndex
 * @property {number} alternativeRecipeCount
 * @property {number} craftCount
 * @property {boolean} isCollapsed  Has a recipe but its ingredients aren't shown.
 * @property {boolean} isCycle  Recipe loops back to an ancestor; never expanded.
 * @property {number | null} buyCost
 * @property {number | null} craftCost
 * @property {boolean} [isCraftCostPartial]
 * @property {number | null} effectiveCost  Craft cost when expanded, buy cost otherwise.
 * @property {boolean} isBuyCheaper
 * @property {boolean} isPlannedPurchase  bought rather than crafted, per the ribbon's Path mode
 *
 * @typedef {object} GraphNode  A node as drawn: one per tree occurrence, or one per entity in merged view.
 * @property {string} nodeId
 * @property {EntityKindName} kind
 * @property {number | string} entityId
 * @property {number} quantity
 * @property {number} craftCount
 * @property {number} effectiveCost
 * @property {number | null} buyCost
 * @property {number | null} craftCost
 * @property {boolean} isCostComplete
 * @property {number} depth
 * @property {Recipe | null} recipe
 * @property {number} recipeIndex
 * @property {number} alternativeRecipeCount
 * @property {boolean} isCollapsed
 * @property {boolean} isCycle
 * @property {boolean} hasChildren
 * @property {boolean} isBuyCheaper
 * @property {boolean} isPlannedPurchase
 * @property {string} collapseKey
 * @property {number} occurrenceCount
 * @property {boolean} isRoot
 *
 * @typedef {object} GraphEdge
 * @property {string} edgeId
 * @property {string} sourceId  Product (parent) node id.
 * @property {string} targetId  Ingredient (child) node id.
 * @property {number} quantity
 *
 * @typedef {object} GraphModel
 * @property {GraphNode[]} nodes
 * @property {GraphEdge[]} edges
 * @property {Map<string, GraphNode>} nodesById
 */
export {};
