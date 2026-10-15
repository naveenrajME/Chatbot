import { memo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import CopyButton from "./CopyButton.jsx";

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

function CodeBlock({ node, children, ...props }) {
  const ref = useRef(null);
  const classes = node?.children?.[0]?.properties?.className ?? [];
  const lang = classes.map(String).find(c => c.startsWith("language-"))?.slice(9);
  return (
    <div className="code">
      <div className="code-bar">
        <span>{lang || "code"}</span>
        <CopyButton className="code-copy" getText={() => ref.current?.innerText ?? ""} />
      </div>
      <pre ref={ref} {...props}>{children}</pre>
    </div>
  );
}

const components = {
  pre: CodeBlock,
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  table: ({ node, ...props }) => <div className="tbl"><table {...props} /></div>,
};

function Markdown({ text }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
      {text}
    </ReactMarkdown>
  );
}

export default memo(Markdown);
