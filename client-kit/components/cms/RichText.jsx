import { Fragment } from "react";
import { sanitizeDoc } from "@/lib/cms-richtext";

// Renders a Tiptap JSON doc (or a plain string) through the allowlist.
// No hooks → usable from Server and Client Components alike.
export default function RichText({ value, className, ...rest }) {
  const doc = sanitizeDoc(value);
  return (
    <div className={className} data-cms-rich="" {...rest}>
      {doc.content.map((node, i) => renderNode(node, i))}
    </div>
  );
}

function renderNode(node, key) {
  switch (node.type) {
    case "paragraph":
      return <p key={key}>{renderChildren(node)}</p>;
    case "bulletList":
      return <ul key={key}>{renderChildren(node)}</ul>;
    case "orderedList":
      return <ol key={key}>{renderChildren(node)}</ol>;
    case "listItem":
      return <li key={key}>{renderChildren(node)}</li>;
    case "hardBreak":
      return <br key={key} />;
    case "text":
      return <Fragment key={key}>{renderMarks(node.text, node.marks)}</Fragment>;
    default:
      return null;
  }
}

function renderChildren(node) {
  return node.content?.map((child, i) => renderNode(child, i));
}

function renderMarks(text, marks = []) {
  return marks.reduce((inner, mark) => {
    if (mark.type === "bold") return <strong>{inner}</strong>;
    if (mark.type === "italic") return <em>{inner}</em>;
    if (mark.type === "link") {
      const href = mark.attrs.href;
      const external = /^https?:\/\//i.test(href);
      return (
        <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {inner}
        </a>
      );
    }
    return inner;
  }, text);
}
