import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "react-pdf/dist/Page/TextLayer.css";
import { Highlighter } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Selection rects relative to their page, as fractions of the page size, merged per line. */
function selectionOnPage(scroller) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const text = sel.toString().replace(/\s+/g, " ").trim();
  if (text.length < 2) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const pageEl = node?.closest?.("[data-page]");
  if (!pageEl || !scroller.contains(pageEl)) return null;
  const box = pageEl.getBoundingClientRect();
  const lines = [];
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 1) continue;
    if (r.top > box.bottom || r.bottom < box.top) continue; // only the first page of a cross-page selection
    const rect = { x: (r.left - box.left) / box.width, y: (r.top - box.top) / box.height, w: r.width / box.width, h: r.height / box.height };
    const same = lines.find((l) => Math.abs(l.y - rect.y) < rect.h * 0.5);
    if (same) {
      const right = Math.max(same.x + same.w, rect.x + rect.w);
      same.x = Math.min(same.x, rect.x);
      same.w = right - same.x;
      same.h = Math.max(same.h, rect.h);
    } else lines.push(rect);
  }
  if (!lines.length) return null;
  const last = range.getBoundingClientRect();
  return { page: +pageEl.dataset.page, rects: lines, text, anchor: { x: last.right, y: last.bottom } };
}

export default function PdfViewer({ file, page = 1, nonce, highlights = [], onHighlight, onPage, flashPage }) {
  const scroller = useRef(null);
  const [num, setNum] = useState(0);
  const [aspect, setAspect] = useState(1.414);
  const [width, setWidth] = useState(800);
  const [visible, setVisible] = useState(() => new Set([1, 2, 3]));
  const [current, setCurrent] = useState(1);
  const [pending, setPending] = useState(null);
  const [flash, setFlash] = useState(null);
  const jumpRef = useRef(null); // page we just jumped to: keep it aligned while pages above finish rendering

  const align = (n) => {
    const el = scroller.current?.querySelector(`[data-page="${n}"]`);
    if (el) scroller.current.scrollTop = el.offsetTop - 20;
  };

  const currentRef = useRef(1);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => {
      // keep the page you're reading in view when the panel next to the PDF opens or closes
      if (!jumpRef.current && currentRef.current > 1) {
        jumpRef.current = currentRef.current;
        setTimeout(() => (jumpRef.current = null), 1500);
      }
      setWidth(Math.max(320, Math.min(980, e.contentRect.width - 48)));
    });
    ro.observe(scroller.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setNum(0);
    setPending(null);
  }, [file.id]);

  const onLoad = async (pdf) => {
    const p1 = await pdf.getPage(1);
    const v = p1.getViewport({ scale: 1 });
    setAspect(v.height / v.width);
    setNum(pdf.numPages);
  };

  useEffect(() => {
    if (!num) return;
    const io = new IntersectionObserver(
      (entries) =>
        setVisible((prev) => {
          const s = new Set(prev);
          entries.forEach((e) => (e.isIntersecting ? s.add(+e.target.dataset.page) : s.delete(+e.target.dataset.page)));
          return s;
        }),
      { root: scroller.current, rootMargin: "1200px 0px" }
    );
    scroller.current.querySelectorAll("[data-page]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [num, file.id]);

  // jump to the requested page (citations, p.N links, search results)
  useEffect(() => {
    if (!num) return;
    const target = Math.min(Math.max(1, page || 1), num);
    const el = scroller.current.querySelector(`[data-page="${target}"]`);
    if (el) {
      align(target);
      jumpRef.current = target;
      currentRef.current = target;
      const release = setTimeout(() => (jumpRef.current = null), 3000);
      setCurrent(target);
      if (flashPage !== false && target > 1) {
        setFlash(target);
        const t = setTimeout(() => setFlash(null), 1600);
        return () => (clearTimeout(t), clearTimeout(release));
      }
      return () => clearTimeout(release);
    }
  }, [num, page, nonce, file.id]);

  useEffect(() => {
    if (jumpRef.current) align(jumpRef.current);
  }, [width, aspect]);

  const onWheel = () => (jumpRef.current = null);

  const onScroll = useCallback(() => {
    const sc = scroller.current;
    const y = sc.scrollTop + sc.clientHeight / 3;
    let n = 1;
    for (const el of sc.querySelectorAll("[data-page]")) {
      if (el.offsetTop <= y) n = +el.dataset.page;
      else break;
    }
    if (!jumpRef.current) currentRef.current = n;
    setCurrent(n);
    setPending(null);
  }, []);

  useEffect(() => onPage?.(current, num), [current, num]);

  const onMouseUp = () => {
    if (!onHighlight) return;
    setTimeout(() => setPending(selectionOnPage(scroller.current)), 0);
  };

  const save = () => {
    if (!pending) return;
    onHighlight(pending);
    window.getSelection()?.removeAllRanges();
    setPending(null);
  };

  const height = Math.round(width * aspect);
  return (
    <div className="pdf-scroll" ref={scroller} onScroll={onScroll} onWheel={onWheel} onMouseDown={onWheel} onMouseUp={onMouseUp}>
      <Document
        key={file.id}
        file={`/api/files/${file.id}/raw`}
        onLoadSuccess={onLoad}
        loading={<div className="pdf-page pdf-loading" style={{ width, height }} aria-label="Opening the PDF" />}
        error={<p className="muted pdf-error">This PDF couldn't be opened.</p>}
      >
        {Array.from({ length: num }, (_, i) => i + 1).map((n) => (
          <div
            key={n}
            data-page={n}
            className={`pdf-page ${flash === n ? "flash" : ""}`}
            style={{ width, minHeight: height }}
          >
            {visible.has(n) && (
              <Page
                pageNumber={n}
                width={width}
                renderAnnotationLayer={false}
                loading={<div className="pdf-loading" style={{ height }} />}
                onRenderSuccess={() => jumpRef.current && jumpRef.current >= n && align(jumpRef.current)}
              />
            )}
            {highlights
              .filter((h) => h.page === n)
              .flatMap((h) =>
                h.rects.map((r, i) => (
                  <div
                    key={`${h.id}-${i}`}
                    className={`hl ${h.friend_name ? "friend" : ""}`}
                    title={h.friend_name ? `${h.friend_name}: ${h.text}` : h.text}
                    style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                  />
                ))
              )}
            <span className="page-num">{n}</span>
          </div>
        ))}
      </Document>
      {pending && (
        <button
          className="btn yellow hl-btn"
          style={{ left: pending.anchor.x - 40, top: pending.anchor.y + 8 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={save}
        >
          <Highlighter size={15} /> Highlight
        </button>
      )}
    </div>
  );
}
