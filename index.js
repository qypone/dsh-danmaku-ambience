/** Host half of the Danmaku bundle.
 *
 * The whole feature is browser-side: `client.js` registers a danmaku layer
 * into `shell.overlay` and a row into `settings.general.item`. Nothing needs
 * the Host, so this half only exists so the bundle has a plugin row that the
 * Loader can mount. Keeping it empty means the plugin needs no tools, no
 * services, and no profile configuration.
 *
 * @param _ctx - the Host plugin context (unused).
 */
export function apply(_ctx) {
  return () => {};
}
