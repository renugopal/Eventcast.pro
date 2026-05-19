// Allows Wrangler to import *.html template files as plain text strings.
// Requires [[rules]] type = "Text" globs = ["templates/**/*.html"] in wrangler.toml.
declare module '*.html' {
  const content: string;
  export default content;
}
