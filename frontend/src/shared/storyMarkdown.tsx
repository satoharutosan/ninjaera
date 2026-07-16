/**
 * Minimal safe markdown → React nodes for Our Story body.
 * Supports: paragraphs, **bold**, *italic*, headings (# ## ###),
 * unordered/ordered lists, and [links](https://...).
 */
import type { ReactNode } from "react";

function inlineFormat(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const raw = m[0];
    if (raw.startsWith("**")) {
      nodes.push(<strong key={`${keyPrefix}-b-${i}`}>{raw.slice(2, -2)}</strong>);
    } else if (raw.startsWith("*")) {
      nodes.push(<em key={`${keyPrefix}-i-${i}`}>{raw.slice(1, -1)}</em>);
    } else if (m[2] && m[3]) {
      nodes.push(
        <a key={`${keyPrefix}-a-${i}`} href={m[3]} target="_blank" rel="noopener noreferrer" className="underline">
          {m[2]}
        </a>,
      );
    }
    last = m.index + raw.length;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function renderStoryMarkdown(body: string, color?: string): ReactNode {
  const lines = (body || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let bi = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    if (/^###\s+/.test(line)) {
      blocks.push(<h4 key={`h-${bi++}`} className="text-base font-medium mt-4 mb-1" style={{ color, fontFamily: "Roboto" }}>{inlineFormat(line.replace(/^###\s+/, ""), `h4-${bi}`)}</h4>);
      i += 1; continue;
    }
    if (/^##\s+/.test(line)) {
      blocks.push(<h3 key={`h-${bi++}`} className="text-lg font-medium mt-4 mb-1" style={{ color, fontFamily: "Roboto" }}>{inlineFormat(line.replace(/^##\s+/, ""), `h3-${bi}`)}</h3>);
      i += 1; continue;
    }
    if (/^#\s+/.test(line)) {
      blocks.push(<h2 key={`h-${bi++}`} className="text-xl font-medium mt-4 mb-2" style={{ color, fontFamily: "Roboto" }}>{inlineFormat(line.replace(/^#\s+/, ""), `h2-${bi}`)}</h2>);
      i += 1; continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(<li key={`ul-${bi}-${items.length}`} className="text-sm leading-relaxed mb-1">{inlineFormat(lines[i].replace(/^[-*]\s+/, ""), `uli-${bi}-${items.length}`)}</li>);
        i += 1;
      }
      blocks.push(<ul key={`ul-${bi++}`} className="list-disc pl-5 mb-3" style={{ color }}>{items}</ul>);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(<li key={`ol-${bi}-${items.length}`} className="text-sm leading-relaxed mb-1">{inlineFormat(lines[i].replace(/^\d+\.\s+/, ""), `oli-${bi}-${items.length}`)}</li>);
        i += 1;
      }
      blocks.push(<ol key={`ol-${bi++}`} className="list-decimal pl-5 mb-3" style={{ color }}>{items}</ol>);
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^#{1,3}\s+/.test(lines[i]) && !/^[-*]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`p-${bi++}`} className="text-sm leading-relaxed mb-3" style={{ color, fontFamily: "Roboto" }}>
        {inlineFormat(para.join(" "), `p-${bi}`)}
      </p>,
    );
  }

  return <>{blocks}</>;
}
