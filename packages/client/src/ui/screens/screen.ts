/** Every top-level screen (boot, auth, creation, game) mounts one root element and can be torn down. */
export interface Screen {
  el: HTMLElement;
  destroy(): void;
}
