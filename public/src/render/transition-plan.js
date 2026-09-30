/**
 * Where things come from and go to when one graph turns into the next. Pure: no DOM.
 *
 * A new node grows out of its nearest ancestor that was already on screen, so expanding a node visibly unfolds it; a
 * removed node folds back into its nearest ancestor that stays (collapsing reads the same way in reverse).
 */

/**
 * @param {{ previous: Map<string, {x: number, y: number}>, nodeIds: string[], parentOf: Map<string, string>,
 *           previousParentOf?: Map<string, string>, rootId?: string }} graphs
 *   previous: positions on screen now; parentOf: child → parent in the new graph; previousParentOf: the same for the
 *   old graph (to fold removed nodes into their parents).
 */
export function planTransition({
  previous,
  nodeIds,
  parentOf,
  previousParentOf = new Map(),
  rootId,
}) {
  const kept = new Set(nodeIds);

  /** Where a node starts: where it is now, else where its nearest existing ancestor is, else the old root. */
  const startOf = (id) => {
    if (previous.has(id)) return previous.get(id);
    const visited = new Set([id]); // merged graphs can contain cycles
    for (
      let parent = parentOf.get(id);
      parent && !visited.has(parent);
      parent = parentOf.get(parent)
    ) {
      if (previous.has(parent)) return previous.get(parent);
      visited.add(parent);
    }
    return (rootId && previous.get(rootId)) || null;
  };

  /**
   * Where each removed node goes: its nearest ancestor that stays (by the old graph's links, or by tree path ids like
   * "r/0/3"), else the anchor, else nowhere (it fades where it is).
   */
  const ghostDestinations = (finalPositions, anchorId = null) => {
    const destinations = new Map();
    for (const [id, position] of previous) {
      if (kept.has(id)) continue;
      let destination = null;
      const visited = new Set([id]);
      for (
        let parent = previousParentOf.get(id);
        parent && !visited.has(parent) && !destination;
        parent = previousParentOf.get(parent)
      ) {
        destination = finalPositions.get(parent) ?? null;
        visited.add(parent);
      }
      for (let path = id; !destination && path.includes("/");) {
        path = path.slice(0, path.lastIndexOf("/"));
        destination = finalPositions.get(path) ?? null;
      }
      destination ??= (anchorId && finalPositions.get(anchorId)) || position;
      destinations.set(id, destination);
    }
    return destinations;
  };

  return { startOf, ghostDestinations };
}
