/**
 * @nimiq/identicons ships untyped. This is the bundled ES module, which carries
 * its SVG parts inline; the package's `browser` entry fetches them from a
 * node_modules path at runtime instead, which doesn't exist in a build.
 */
declare module '@nimiq/identicons/dist/identicons.bundle.min.js' {
  export default class Identicons {
    /** SVG markup for `text`, hashed exactly as given. */
    static svg(text: string): Promise<string>
    /** The same SVG as a base64 `data:image/svg+xml` URL. */
    static toDataUrl(text: string): Promise<string>
  }
}
