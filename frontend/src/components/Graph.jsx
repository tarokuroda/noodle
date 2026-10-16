import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { forceCollide, forceX, forceY } from "d3-force-3d";
import { ExternalLink, LoaderCircle, Maximize, Minus, Plus, Presentation, X } from "lucide-react";
import { api, TAGS } from "../api.js";
import { FileViewer } from "./Library.jsx";
import NotePanel from "./NotePanel.jsx";

const TAG_HEX = {
  lecture: "#4f5bd5", tutorial: "#2fa36b", "past paper": "#e5484d", assignment: "#f08c00", reading: "#8e4ec6", other: "#8b93a7",
};
const TOPIC = "#d6336c";
const NOTE = "#ffc94a";
const FIT_PAD = 40;
const LEGEND_H = 70; // the legend's corner of the canvas, kept clear when fitting the map
const FILTERS = [
  { key: "pdf", label: "PDFs" },
  { key: "other", label: "Slides & videos" },
  { key: "page", label: "Moodle pages" },
  { key: "topic", label: "Topics" },
  { key: "note", label: "Notes" },
];

const idOf = (end) => (typeof end === "object" ? end.id : end);
// the hubs: AI topics, or without them the course's own sections, which read as topics too
const isHub = (n) => n.type === "topic" || n.type === "section";
// "Week 3 (22nd of October): Normal Shocks" -> "Normal Shocks"; "Assessment and Feedback" stays as it is
const sectionTopic = (s) => {
  const plain = (s || "").replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  return plain.slice(plain.indexOf(":") + 1).trim() || plain || "Section";
};
// "MECH0024_Lecture3Delivered2025.pptx" -> "Lecture3Delivered2025": no room on the map for codes and extensions
const fileLabel = (name, code) =>
  name
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s_-]*`, "i"), "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim() || name;

export default function Graph({ course, files, onOpenFile, onOpenNote, notesVersion }) {
  const [data, setData] = useState(null);
  const [show, setShow] = useState({ pdf: true, other: true, page: false, topic: true, note: true });
  const [hover, setHover] = useState(null);
  const [side, setSide] = useState(null); // { type: 'file'|'topic'|'note', ... }
  const [size, setSize] = useState({ w: 800, h: 600 });
  const wrap = useRef(null);
  const fg = useRef(null);
  const fitted = useRef(false);
  const hubs = useRef({ data: null, byId: {} }); // section hubs keep their place while filters change
  const code = course?.shortname.split("_")[0] || "";

  useEffect(() => {
    if (course) api(`/graph?course=${course.id}`).then(setData);
  }, [course, notesVersion]);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [side]);

  // AI topics come from .noodle/demo/ai.json; without them the backend links similar files instead
  const hasTopics = useMemo(() => !!data?.nodes.some((n) => n.type === "topic"), [data]);

  const graph = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    const fileOk = (n) => (n.viewer === "pdf" ? show.pdf : n.viewer === "page" ? show.page : show.other);
    const files_ = data.nodes.filter((n) => n.type === "file" && fileOk(n));
    files_.forEach((n) => (n.short ||= fileLabel(n.label, code)));
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
    if (!hasTopics && show.topic) {
      // each section of the course page is a hub for its visible files
      if (hubs.current.data !== data) hubs.current = { data, byId: {} };
      const sections = [];
      for (const n of files_) {
        let s = sections[sections.length - 1];
        if (s?.num !== n.section_num) {
          const id = `s:${n.section_num}`;
          s = hubs.current.byId[id] ||= { id, type: "section", num: n.section_num, name: n.section, label: sectionTopic(n.section) };
          s.count = 0;
          sections.push(s);
        }
        s.count++;
        links.push({ source: n.id, target: s.id, kind: "section" });
      }
      return { nodes: [...files_, ...sections, ...notes_], links };
    }
    // course structure: chain the visible files in page order within each section
    let prev = null;
    for (const n of files_) {
      if (prev && prev.section_num === n.section_num) links.push({ source: prev.id, target: n.id, kind: "structure" });
      prev = n;
    }
    return { nodes: [...files_, ...topics, ...notes_], links };
  }, [data, show, hasTopics, code]);

  const neighbors = useMemo(() => {
    const m = {};
    graph.links.forEach((l) => {
      const a = idOf(l.source), b = idOf(l.target);
      (m[a] ||= new Set()).add(b);
      (m[b] ||= new Set()).add(a);
    });
    return m;
  }, [graph]);

  // hubs grow with their files, files with their links
  const radius = (n) =>
    isHub(n) ? 7 + Math.min(n.count, 12) * 0.7 : n.type === "note" ? 7 : 4 + Math.min(neighbors[n.id]?.size || 0, 10) * 0.45;

  useEffect(() => {
    const f = fg.current;
    if (!f) return;
    if (import.meta.env.DEV) window.__noodleGraph = { fg: f, graph };
    const DIST = { topic: 60, link: 50, section: 40, similar: 70 };
    const PULL = { structure: 0.5, section: 0.35, similar: 0.08 };
    f.d3Force("charge").strength((n) => (isHub(n) ? -260 : -70)).distanceMax(420);
    f.d3Force("link").distance((l) => DIST[l.kind] ?? 26).strength((l) => PULL[l.kind] ?? 0.18);
    f.d3Force("collide", forceCollide((n) => radius(n) + (isHub(n) ? 14 : 6)));
    // a little gravity, so loose notes and small clusters stay near the rest instead of drifting off
    f.d3Force("x", forceX(0).strength(0.05));
    f.d3Force("y", forceY(0).strength(0.05));
    f.d3ReheatSimulation();
  }, [graph]);

  const active = hover || (side?.node ?? null);
  const lit = (id) => !active || id === active.id || neighbors[active.id]?.has(id);

  const draw = (node, ctx, scale) => {
    const on = lit(node.id);
    ctx.globalAlpha = on ? 1 : 0.1;
    const fontPx = (px) => `${700} ${px / scale}px Nunito, sans-serif`;
    const r = radius(node);
    if (isHub(node)) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = TOPIC;
      ctx.fill();
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    } else if (node.type === "note") {
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
    // section and note labels always show; file labels fade in as you zoom, the bigger files first
    const showLabel =
      isActive || (active && on) || node.type === "note" || node.type === "section" ||
      (node.type === "topic" && (node.count >= 4 || scale > 1.6)) || scale * r > 7;
    if (showLabel) {
      const size = isHub(node) ? 12.5 : node.type === "note" ? 12 : 11;
      ctx.font = fontPx(size);
      const text = isActive ? node.label : node.short || node.label;
      const max = isActive ? 60 : isHub(node) ? 28 : 34;
      const label = text.length > max ? text.slice(0, max - 1) + "…" : text;
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
      ctx.fillStyle = isHub(node) ? "#a61e4d" : "#1e2235";
      ctx.fillText(label, node.x, y);
    }
    ctx.globalAlpha = 1;
  };

  const linkColor = (l) => {
    const on = !active || idOf(l.source) === active.id || idOf(l.target) === active.id;
    const a = on ? 1 : 0.08;
    const lift = on && active ? 0.45 : 0;
    if (l.kind === "link") return `rgba(240,180,41,${a})`;
    if (l.kind === "topic" || l.kind === "section") return `rgba(214,51,108,${0.35 * a + lift})`;
    if (l.kind === "similar") return `rgba(79,91,213,${0.3 * a + lift})`;
    return `rgba(139,147,167,${0.35 * a})`;
  };

  const click = (node) => {
    if (isHub(node)) {
      const ids = new Set(graph.links.filter((l) => idOf(l.target) === node.id).map((l) => idOf(l.source)));
      setSide({ type: "topic", node, files: graph.nodes.filter((n) => ids.has(n.id) && n.type === "file") });
    } else if (node.type === "note") {
      setSide({ type: "note", node, path: node.path });
    } else {
      setSide({ type: "file", node, id: node.file_id, page: 1, nonce: Date.now() });
    }
    // the side panel narrows the map: bring what was clicked back into view once it has
    setTimeout(() => fg.current?.centerAt(node.x, node.y, 500), 120);
  };

  const sideFile = side?.type === "file" && files.find((f) => f.id === side.id);
  // the legend only lists what's on the map right now
  const present = new Set(graph.nodes.map((n) => (n.type === "file" ? n.tag : n.type === "section" ? "topic" : n.type)));
  const zoomBy = (k) => fg.current?.zoom(fg.current.zoom() * k, 250);
  // like zoomToFit, but the map sits above the legend instead of behind it
  const fit = (ms) => {
    const box = fg.current?.getGraphBbox();
    if (!box || !Number.isFinite(box.x[0])) return;
    const w = Math.max(box.x[1] - box.x[0], 1), h = Math.max(box.y[1] - box.y[0], 1);
    const k = Math.min((size.w - 2 * FIT_PAD) / w, (size.h - 2 * FIT_PAD - LEGEND_H) / h, 4);
    fg.current.zoom(k, ms);
    fg.current.centerAt((box.x[0] + box.x[1]) / 2, (box.y[0] + box.y[1]) / 2 + LEGEND_H / 2 / k, ms);
  };

  return (
    <div className="graph-wrap">
      <div className="graph-main">
        <div className="bar">
          <div className="title">
            <h1>{code} mapped</h1>
            <p>
              {hasTopics
                ? "Files coloured by type, linked by the topics they share and by your notes."
                : show.topic
                  ? "Files coloured by type around each week's topic, linked to similar files and by your notes."
                  : "Files coloured by type, linked to similar files and by your notes."}
            </p>
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
          {!data && (
            <div className="graph-loading">
              <LoaderCircle size={22} className="spin" />
              Mapping {code}…
            </div>
          )}
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
                ctx.arc(node.x, node.y, radius(node) + 3, 0, 2 * Math.PI);
                ctx.fill();
              }}
              linkColor={linkColor}
              linkWidth={(l) => (l.kind === "link" ? 2.2 : l.kind === "topic" || l.kind === "section" ? 1.1 : 0.9)}
              onNodeHover={(n) => setHover(n || null)}
              onNodeClick={click}
              onBackgroundClick={() => setSide(null)}
              cooldownTicks={220}
              warmupTicks={60}
              onEngineStop={() => {
                if (!fitted.current) {
                  fit(600);
                  fitted.current = true;
                }
              }}
            />
          )}
          {data && (
            <>
              <div className="legend">
                {TAGS.filter((t) => present.has(t)).map((t) => (
                  <span key={t}><i style={{ background: TAG_HEX[t] }} />{t}</span>
                ))}
                {present.has("topic") && <span><i className="topic" />topic</span>}
                {present.has("note") && <span><i className="note" />note</span>}
              </div>
              <div className="zoom" role="group" aria-label="Zoom">
                <button className="icon-btn" onClick={() => zoomBy(1.4)} aria-label="Zoom in" title="Zoom in">
                  <Plus size={16} />
                </button>
                <button className="icon-btn" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out">
                  <Minus size={16} />
                </button>
                <button className="icon-btn" onClick={() => fit(400)} aria-label="Fit the whole map" title="Fit the whole map">
                  <Maximize size={15} />
                </button>
              </div>
            </>
          )}
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
              {side.node.type === "section" ? (
                <>
                  <h2>{side.node.name}</h2>
                  <h3>{side.files.length} {side.files.length === 1 ? "file" : "files"} in this part of the course</h3>
                </>
              ) : (
                <>
                  <h2>{side.node.label}</h2>
                  <p>{side.node.summary}</p>
                  <h3>{side.files.length} files cover this</h3>
                </>
              )}
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
          {side.type === "file" && sideFile && (sideFile.status !== "ok" || sideFile.viewer === "app") && (
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
          {side.type === "file" && sideFile && sideFile.status === "ok" && sideFile.viewer !== "app" && (
            <FileViewer file={sideFile} open={side} setOpen={(o) => setSide({ ...side, ...o })} compact />
          )}
        </div>
      )}
    </div>
  );
}
