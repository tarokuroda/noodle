import { useEffect, useRef, useState } from "react";
import { NotebookPen, Share2, X } from "lucide-react";
import { api } from "../api.js";

/** Pick friends and notes, then share: only the notes and their highlights go into the shared folder. */
export default function ShareDialog({ course, initial = [], onClose, onShared }) {
  const [info, setInfo] = useState(null);
  const [notes, setNotes] = useState([]);
  const [to, setTo] = useState(new Set());
  const [picked, setPicked] = useState(new Set(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dialog = useRef(null);

  // focus moves into the dialog, Escape closes it, and focus goes back where it was
  useEffect(() => {
    const before = document.activeElement;
    dialog.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);

  useEffect(() => {
    api("/friends").then((f) => {
      setInfo(f);
      if (f.friends?.length === 1) setTo(new Set([f.friends[0].id]));
    });
    if (course) api(`/notes?course=${course.id}`).then((ns) => setNotes(ns.filter((n) => !/\(from .+\)$/.test(n.title))));
  }, [course]);

  const toggle = (set, setSet, key) => {
    const n = new Set(set);
    n.has(key) ? n.delete(key) : n.add(key);
    setSet(n);
  };

  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api("/friends/share", { method: "POST", body: { notes: [...picked], to: [...to] } });
      onShared?.(res);
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const code = course?.shortname.split("_")[0];
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Share notes" ref={dialog} tabIndex={-1}>
        <button className="icon-btn side-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>
          <Share2 size={18} /> Share notes
        </h2>
        {!info ? (
          <p className="muted">Loading…</p>
        ) : !info.me ? (
          <p>Set up Friends first: open <b>Friends</b> in the sidebar, pick your name and the shared folder.</p>
        ) : info.friends.length === 0 ? (
          <p>Add a friend first: open <b>Friends</b> in the sidebar and add someone from the shared folder.</p>
        ) : (
          <>
            <h3>With</h3>
            <div className="pick-list">
              {info.friends.map((f) => (
                <label key={f.id} className="pick">
                  <input type="checkbox" checked={to.has(f.id)} onChange={() => toggle(to, setTo, f.id)} />
                  <span className="avatar sm" style={{ background: f.color }}>{f.name.slice(0, 1)}</span>
                  {f.name}
                </label>
              ))}
            </div>
            <h3>
              Notes in {code}
              <button className="link-btn" onClick={() => setPicked(picked.size === notes.length ? new Set() : new Set(notes.map((n) => n.path)))}>
                {picked.size === notes.length && notes.length ? "Select none" : "Select all"}
              </button>
            </h3>
            <div className="pick-list notes">
              {notes.map((n) => (
                <label key={n.path} className="pick">
                  <input type="checkbox" checked={picked.has(n.path)} onChange={() => toggle(picked, setPicked, n.path)} />
                  <NotebookPen size={14} /> {n.title}
                </label>
              ))}
              {notes.length === 0 && <p className="muted small">No notes in {code} yet.</p>}
            </div>
            <p className="muted small">
              Your notes and highlights go into <code>{info.folder}</code>. Course files never leave your laptop: your friend's Noodle puts the
              highlights on their own copy.
            </p>
            {error && <p className="error">{error}</p>}
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={busy || !to.size || !picked.size} onClick={share}>
                <Share2 size={14} /> {busy ? "Sharing…" : `Share ${picked.size || ""} note${picked.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
