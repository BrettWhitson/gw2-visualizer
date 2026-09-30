import { mount, unmount } from "svelte";

/**
 * Mount a Svelte component into an element of a page that isn't Svelte yet, replacing what's in it, so old and new
 * UI share a page while pieces move over one at a time.
 * @template {Record<string, any>} Props
 * @param {import('svelte').Component<Props>} Component
 * @param {HTMLElement} target
 * @param {Props} props
 * @returns {{ destroy(): void }}
 */
export function mountIsland(Component, target, props) {
  target.replaceChildren();
  const instance = mount(Component, { target, props });
  return { destroy: () => unmount(instance) };
}
