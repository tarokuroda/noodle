import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { forceCollide } from "d3-force-3d";
import { ExternalLink, Presentation, X } from "lucide-react";
import { api, TAGS } from "../api.js";
import { FileViewer } from "./Library.jsx";
import NotePanel from "./NotePanel.jsx";

const TAG_HEX = {
  lecture: "#4f5bd5", tutorial: "#2fa36b", "past paper": "#e5484d", assignment: "#f08c00", reading: "#8e4ec6", other: "#8b93a7",
};
const TOPIC = "#d6336c";
const NOTE = "#ffc94a";
const FILTERS = [
  { key: "pdf", label: "PDFs" },
  { key: "other", label: "Slides & videos" },
  { key: "page", label: "Moodle pages" },
  { key: "topic", label: "Topics" },
  { key: "note", label: "Notes" },
];

const idOf = (end) => (typeof end === "object" ? end.id : end);

export default function Graph({ course, files, onOpenFile, onOpenNote, notesVersion }) {
  const [data, setData] = useState(null);
  const [show, setShow] = useState({ pdf: true, other: true, page: false, topic: true, note: true });
  const [hover, setHover] = useState(null);
  const [side, setSide] = useState(null); // { type: 'file'|'topic'|'note', ... }
  const [size, setSize] = useState({ w: 800, h: 600 });
  const wrap = useRef(null);
  const fg = useRef(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (course) api(`/graph?course=${course.id}`).then(setData);
  }, [course, notesVersion]);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [side]);

  const graph = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    const fileOk = (n) => (n.kind === "pdf" ? show.pdf : n.kind === "page" ? show.page : show.other);
    const files_ = data.nodes.filter((n) => n.type === "file" && fileOk(n));
    const ids = new Set(files_.map((n) => n.id));
    const notes_ = show.note ? data.nodes.filter((n) => n.type === "note") : [];
    notes_.forEach((n) => ids.add(n.id));
    // topics only when they still connect 2+ visible files
    const topicCount = {};
    data.links.forEach((l) => l.kind === "topic" && ids.has(l.source) && (topicCount[l.target] = (topicCount[l.target] || 0) + 1));
    const topics = show.topic ? data.nodes.filter((n) => n.type === "topic" && topicCount[n.id] >= 2) : [];
    topics.forEach((n) => ids.add(n.id));
    const links = data.links
      .filter((l) => l.kind !== "structure" && ids.has(l.source) && ids.has(l.target))
      .map((l) => ({ ...l }));
    // course structure: chain the visible files in page order within each section
    let prev = null;
    for (const n of files_) {
      if (prev && prev.section_num === n.section_num) links.push({ source: prev.id, target: n.id, kind: "structure" });
      prev = n;
    }
    return { nodes: [...files_, ...topics, ...notes_], links };
  }, [data, show]);

  const neighbors = useMemo(() => {
    const m = {};
    graph.links.forEach((l) => {
      const a = idOf(l.source), b = idOf(l.target);
      (m[a] ||= new Set()).add(b);
      (m[b] ||= new Set()).add(a);
    });
    return m;
  }, [graph]);

  useEffect(() => {
    const f = fg.current;
    if (!f) return;
    if (import.meta.env.DEV) window.__noodleGraph = { fg: f, graph };
    f.d3Force("charge").strength((n) => (n.type === "topic" ? -260 : -90)).distanceMax(420);
    f.d3Force("link").distance((l) => (l.kind === "topic" ? 60 : l.kind === "link" ? 50 : 26)).strength((l) => (l.kind === "structure" ? 0.5 : 0.18));
    f.d3Force("collide", forceCollide((n) => (n.type === "topic" ? 34 : n.type === "note" ? 18 : 10)));
    f.d3ReheatSimulation();
  }, [graph]);

  const active = hover || (side?.node ?? null);
  const lit = (id) => !active || id === active.id || neighbors[active.id]?.has(id);

  const draw = (node, ctx, scale) => {
    const on = lit(node.id);
    ctx.globalAlpha = on ? 1 : 0.1;
    const fontPx = (px) => `${700} ${px / scale}px Nunito, sans-serif`;
    let r = 4.5;
    if (node.type === "topic") {
      r = 4 + Math.min(node.count, 12) * 0.55;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = "#fde7ef";
      ctx.fill();
      ctx.lineWidth = 1.6 / scale;
      ctx.strokeStyle = TOPIC;
      ctx.stroke();
    } else if (node.type === "note") {
      r = 6;
      ctx.beginPath();
      ctx.roundRect(node.x - r, node.y - r, 2 * r, 2 * r, 3);
      ctx.fillStyle = NOTE;
      ctx.fill();
      ctx.lineWidth = 1.4 / scale;
      ctx.strokeStyle = "#1e2235";
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      const c = TAG_HEX[node.tag] || TAG_HEX.other;
      if (node.status === "ok") {
        ctx.fillStyle = c;
        ctx.fill();
      } else {
        ctx.lineWidth = 1.4 / scale;
        ctx.strokeStyle = c;
        ctx.stroke();
      }
    }
    const isActive = active && node.id === active.id;
    const showLabel =
      isActive || (active && on) || node.type === "note" || (node.type === "topic" && (node.count >= 4 || scale > 1.6)) || scale > 2.6;
    if (showLabel) {
      const size = node.type === "topic" ? 11.5 : node.type === "note" ? 12 : 11;
      ctx.font = fontPx(size);
      const label = node.label.length > 42 ? node.label.slice(0, 40) + "…" : node.label;
      const w = ctx.measureText(label).width;
      const y = node.y + r + (size + 2) / scale;
      if (isActive || node.type === "note") {
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fillRect(node.x - w / 2 - 3 / scale, y - (size - 1) / scale, w + 6 / scale, (size + 4) / scale);
      }
      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3.5 / scale;
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.strokeText(label, node.x, y);
      ctx.fillStyle = node.type === "topic" ? "#a61e4d" : "#1e2235";
      ctx.fillText(label, node.x, y);
    }
    ctx.globalAlpha = 1;
  };

  const linkColor = (l) => {
    const on = !active || idOf(l.source) === active.id || idOf(l.target) === active.id;
    const a = on ? 1 : 0.08;
    if (l.kind === "link") return `rgba(240,180,41,${a})`;
    if (l.kind === "topic") return `rgba(214,51,108,${0.28 * a + (on && active ? 0.45 : 0)})`;
    return `rgba(139,147,167,${0.35 * a})`;
  };

  const click = (node) => {
    if (node.type === "topic") {
      const ids = new Set(graph.links.filter((l) => idOf(l.target) === node.id).map((l) => idOf(l.source)));
      setSide({ type: "topic", node, files: graph.nodes.filter((n) => ids.has(n.id) && n.type === "file") });
    } else if (node.type === "note") {
      setSide({ type: "note", node, path: node.path });
    } else {
      setSide({ type: "file", node, id: node.file_id, page: 1, nonce: Date.now() });
    }
  };

  const sideFile = side?.type === "file" && files.find((f) => f.id === side.id);

  return (
    <div className="graph-wrap">
      <div className="graph-main">
        <div className="bar">
          <div className="title">
            <h1>{course?.shortname.split("_")[0]} mapped</h1>
            <p>Files coloured by type, linked by the topics they share and by your notes.</p>
          </div>
          <div className="toggles">
            {FILTERS.map((f) => (
              <button key={f.key} className={`chip ${show[f.key] ? "on" : ""}`} aria-pressed={show[f.key]} onClick={() => setShow((s) => ({ ...s, [f.key]: !s[f.key] }))}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="graph-canvas" ref={wrap}>
          {data && (
            <ForceGraph2D
              ref={fg}
              graphData={graph}
              width={size.w}
              height={size.h}
              backgroundColor="#ffffff"
              nodeCanvasObject={draw}
              nodePointerAreaPaint={(node, color, ctx) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.type === "topic" ? 10 : 7, 0, 2 * Math.PI);
                ctx.fill();
              }}
              linkColor={linkColor}
              linkWidth={(l) => (l.kind === "link" ? 2.2 : l.kind === "topic" ? 1 : 0.8)}
              onNodeHover={(n) => setHover(n || null)}
              onNodeClick={click}
              onBackgroundClick={() => setSide(null)}
              cooldownTicks={220}
              warmupTicks={60}
              onEngineStop={() => {
                if (!fitted.current) {
                  fg.current?.zoomToFit(600, 40);
                  fitted.current = true;
                }
              }}
            />
          )}
          <div className="legend">
            {TAGS.map((t) => (
              <span key={t}><i style={{ background: TAG_HEX[t] }} />{t}</span>
            ))}
            <span><i className="topic" />topic</span>
            <span><i className="note" />note</span>
          </div>
        </div>
      </div>
      {side && (
        <div className="side-panel">
          <button className="icon-btn side-close" onClick={() => setSide(null)} aria-label="Close">
            <X size={18} />
          </button>
          {side.type === "topic" && (
            <div className="topic-card">
              <span className="badge topic-badge">Topic</span>
              <h2>{side.node.label}</h2>
              <p>{side.node.summary}</p>
              <h3>{side.files.length} files cover this</h3>
              <div className="topic-files">
                {side.files.map((n) => (
                  <button key={n.id} className="file" style={{ paddingLeft: 8 }} onClick={() => click(n)}>
                    <span className="tagdot" style={{ background: TAG_HEX[n.tag] }} />
                    <span className="fname">{n.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {side.type === "note" && <NotePanel key={side.path} path={side.path} course={course} onOpenFile={onOpenFile} onOpenNote={(p) => setSide({ type: "note", node: { id: `n:${p}` }, path: p })} />}
          {side.type === "file" && sideFile && (sideFile.status !== "ok" || (sideFile.kind !== "pdf" && sideFile.kind !== "page")) && (
            <div className="topic-card">
              <span className="badge">{sideFile.tag}</span>
              <h2>{sideFile.name}</h2>
              <p className="muted">{sideFile.section}</p>
              {sideFile.status === "ok" ? (
                <button className="btn primary" onClick={() => onOpenFile(sideFile)}>
                  <Presentation size={16} /> Open in its Windows app
                </button>
              ) : (
                <a className="btn" href={sideFile.moodle_url} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} /> Open in Moodle
                </a>
              )}
            </div>
          )}
          {side.type === "file" && sideFile && sideFile.status === "ok" && (sideFile.kind === "pdf" || sideFile.kind === "page") && (
            <FileViewer file={sideFile} open={side} setOpen={(o) => setSide({ ...side, ...o })} compact />
          )}
        </div>
      )}
    </div>
  );
}
