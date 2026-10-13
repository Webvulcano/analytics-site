// JSON-LD <script> tag. Use this instead of dangerouslySetInnerHTML + JSON.stringify:
// JSON.stringify does not escape "<", so CMS text containing "</script>" would close the tag
// and inject markup into the page. Escaping < > & (and the JS line separators) keeps the JSON
// identical for parsers (\u003c is still "<") but makes it inert as HTML.
// No hooks → usable from Server and Client Components alike.

const UNSAFE = /[<>&\u2028\u2029]/g;

export function jsonLdString(data) {
  return JSON.stringify(data).replace(UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export default function JsonLd({ data }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
