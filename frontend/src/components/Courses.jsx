import { useEffect, useRef, useState } from "react";
import { Check, LogIn, RefreshCw } from "lucide-react";
import { api } from "../api.js";

export function NoodleProgress({ value }) {
  return (
    <div className="noodle-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
      <div className="noodle-fill" style={{ width: `${Math.max(3, value)}%` }} />
    </div>
  );
}

export default function Courses({ auth, onSynced, onRelogin }) {
  const [courses, setCourses] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const poll = useRef(null);

  useEffect(() => {
    api("/moodle/courses")
      .then((cs) => {
        setCourses(cs);
        setPicked(new Set(cs.filter((c) => c.selected || c.synced).map((c) => c.id)));
      })
      .catch((e) => setError(e.message));
    api("/sync/status").then((j) => j.running && follow());
    return () => clearInterval(poll.current);
  }, []);

  const follow = () => {
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      const j = await api("/sync/status");
      setJob(j);
      if (!j.running) {
        clearInterval(poll.current);
        onSynced();
      }
    }, 400);
  };

  const sync = async () => {
    setError(null);
    try {
      setJob(await api("/sync", { method: "POST", body: { courses: [...picked] } }));
      follow();
    } catch (e) {
      setError(e.message);
    }
  };

  const toggle = (id) =>
    setPicked((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const pct = job?.total ? (100 * job.done) / job.total : job?.running ? 4 : 100;
  const sorted = courses && [...courses].sort((a, b) => (b.synced || b.selected) - (a.synced || a.selected) || a.shortname.localeCompare(b.shortname));

  return (
    <div className="courses">
      <div className="bar">
        <div className="title">
          <h1>Your Moodle courses</h1>
          <p>
            {auth?.user ? `Logged in as ${auth.user}` : "Logged in"} · {auth?.site?.replace(/^https?:\/\//, "")}
            {auth?.token && ` · key ${auth.token}`}
          </p>
        </div>
        <button className="btn" onClick={onRelogin}>
          <LogIn size={14} /> Use a different account
        </button>
      </div>
      <div className="courses-body">
        <div className="sync-card">
          <div>
            <h2>Pick the courses to keep on your laptop</h2>
            <p className="muted">Files over 100 MB stay on Moodle; you can still open them from Noodle.</p>
          </div>
          <button className="btn primary big" onClick={sync} disabled={job?.running || picked.size === 0}>
            <RefreshCw size={17} className={job?.running ? "spin" : ""} /> {job?.running ? "Syncing…" : `Sync ${picked.size || ""} course${picked.size === 1 ? "" : "s"}`}
          </button>
        </div>
        {job && (
          <div className="sync-status" aria-live="polite">
            <NoodleProgress value={pct} />
            <div className="sync-line">
              {job.running ? (
                <span>
                  <b>{job.phase}</b> {job.total ? `${job.done} of ${job.total}` : ""} <span className="muted">{job.current}</span>
                </span>
              ) : job.error ? (
                <span className="error">Sync stopped: {job.error}</span>
              ) : (
                <span className="sync-done">
                  <Check size={18} /> {job.message}
                </span>
              )}
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="course-list">
          {!courses && !error && <p className="muted">Loading your courses from Moodle…</p>}
          {sorted?.map((c) => (
            <label key={c.id} className={`course-row ${picked.has(c.id) ? "on" : ""}`}>
              <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
              <span className="course-code">{c.shortname.split("_")[0]}</span>
              <span className="course-name">{c.fullname.replace(/^[A-Z]{4}\d{4}:\s*/, "")}</span>
              {c.synced && <span className="badge synced">On your laptop</span>}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
