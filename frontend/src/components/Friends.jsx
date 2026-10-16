import { useCallback, useEffect, useState } from "react";
import { Check, FolderSync, Highlighter, Inbox, NotebookPen, Send, Share2, UserPlus, Users, X } from "lucide-react";
import ShareDialog from "./ShareDialog.jsx";
import { api } from "../api.js";

const ago = (ts) => {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

function Avatar({ who, size }) {
  return (
    <span className={`avatar ${size || ""}`} style={{ background: who?.color || "#8b93a7" }}>
      {(who?.name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

function Setup({ data, onDone }) {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState(data.folder || data.suggested_folder || "");
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try {
      onDone(await api("/friends/setup", { method: "POST", body: { name, folder } }));
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form className="friends-setup" onSubmit={submit}>
      <h2>
        <FolderSync size={20} /> Share notes through a folder you all sync
      </h2>
      <p>
        Make a folder in your UCL OneDrive (or Google Drive, Dropbox) and share it with your classmates. They add it to their own drive (in OneDrive:{" "}
        <b>Add shortcut to My files</b>) and pick the same folder in their Noodle.
      </p>
      <label>
        Your name, as friends will see it
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Taro" autoFocus required />
      </label>
      <label>
        Shared folder
        <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="C:\Users\you\OneDrive - University College London\Noodle Friends" required />
      </label>
      <ul className="muted small">
        <li>Only the notes and highlights you choose to share go in this folder. Course files never do: each friend's Noodle uses its own copy.</li>
        <li>Anyone with access to the folder can read what's shared in it, so share the folder only with friends.</li>
        <li>Your Moodle login stays on this laptop.</li>
      </ul>
      {error && <p className="error">{error}</p>}
      <button className="btn primary">
        <Check size={15} /> Start sharing
      </button>
    </form>
  );
}

export default function Friends({ course, onOpenNote, onNotesChanged, showToast }) {
  const [data, setData] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => api("/friends").then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000); // shares arrive as fast as the cloud folder syncs
    return () => clearInterval(t);
  }, [load]);

  const act = async (path, body, done) => {
    setBusy(body.id);
    try {
      const res = await api(path, { method: "POST", body });
      done?.(res);
    } catch (e) {
      showToast?.(e.message);
    } finally {
      setBusy(null);
      load();
    }
  };

  const importShare = (s) =>
    act("/friends/import", { id: s.id }, (res) => {
      onNotesChanged?.();
      const missing = res.unmatched ? ` (${res.unmatched} on files you don't have)` : "";
      showToast?.(`Added ${s.from.name}'s notes and ${res.matched} highlight${res.matched === 1 ? "" : "s"}${missing}`);
    });

  if (!data) return <div className="preview-page" />;
  if (!data.me || data.folder_missing)
    return (
      <div className="preview-page">
        <div className="bar">
          <div className="title">
            <h1>Friends</h1>
            <p>{data.folder_missing ? `Can't find the shared folder ${data.folder}. Is your drive syncing?` : "Share notes and highlights with classmates."}</p>
          </div>
        </div>
        <div className="preview-body">
          <Setup data={data} onDone={setData} />
        </div>
      </div>
    );

  const code = course?.shortname.split("_")[0];
  return (
    <div className="preview-page">
      <div className="bar">
        <div className="title">
          <h1>Friends</h1>
          <p title={data.folder}>
            Sharing through <code>{data.folder.split(/[\\/]/).slice(-2).join("\\")}</code>. Only notes and highlights travel; course files stay on each laptop.
          </p>
        </div>
        <button className="btn primary" onClick={() => setSharing(true)} disabled={!data.friends.length} title={data.friends.length ? "" : "Add a friend first"}>
          <Share2 size={15} /> Share notes
        </button>
      </div>
      <div className="preview-body friends">
        <aside className="friend-list">
          <div className="friend me">
            <Avatar who={data.me} />
            <div>
              <b>{data.me.name} (you)</b>
              <span className="muted small">Friend code {data.me.id}</span>
            </div>
          </div>
          <h2>
            <Users size={17} /> Your friends
          </h2>
          {data.friends.map((f) => (
            <div key={f.id} className="friend">
              <Avatar who={f} />
              <div>
                <b>{f.name}</b>
                <span className="muted small">{f.in_folder ? `Code ${f.id}` : "Not in the folder any more"}</span>
              </div>
              <button className="icon-btn" title={`Remove ${f.name}`} aria-label={`Remove ${f.name}`} onClick={() => act("/friends/remove", { id: f.id })}>
                <X size={15} />
              </button>
            </div>
          ))}
          {data.friends.length === 0 && <p className="muted small">No friends yet. Add someone below once they've set up Noodle with this folder.</p>}
          <h2>
            <UserPlus size={17} /> In this folder
          </h2>
          {data.people.map((p) => (
            <div key={p.id} className="friend">
              <Avatar who={p} />
              <div>
                <b>{p.name}</b>
                <span className="muted small">Code {p.id}</span>
              </div>
              <button className="btn small-btn" disabled={busy === p.id} onClick={() => act("/friends/add", { id: p.id }, () => showToast?.(`Added ${p.name}`))}>
                Add
              </button>
            </div>
          ))}
          {data.people.length === 0 && (
            <p className="muted small">Nobody new here. Share the folder with a classmate, then they set up Noodle with it.</p>
          )}
        </aside>
        <div className="feed">
          <h2 className="feed-head">
            <Inbox size={17} /> Shared with you
          </h2>
          {data.inbox.map((s) => (
            <div key={s.id} className="feed-item">
              <Avatar who={s.from} />
              <div className="feed-text">
                <p>
                  <b>{s.from.name}</b> shared <b>{s.notes[0]}</b>
                  {s.notes.length > 1 && ` and ${s.notes.length - 1} more note${s.notes.length > 2 ? "s" : ""}`}
                </p>
                <div className="feed-card">
                  <Highlighter size={16} /> {s.highlights} highlight{s.highlights === 1 ? "" : "s"}
                  {s.highlights > 0 && <span className="muted small">· {s.matched === s.highlights ? "all on files you have" : `${s.matched} on files you have`}</span>}
                  <span className="course-chip">{s.course}</span>
                </div>
                <span className="muted small">{ago(s.created)}</span>
              </div>
              {s.imported ? (
                <div className="feed-actions">
                  <button className="btn" onClick={() => onOpenNote(s.imported[0])}>
                    <NotebookPen size={14} /> Open
                  </button>
                  <span className="muted small"><Check size={12} /> In your notes</span>
                </div>
              ) : (
                <button className="btn yellow" disabled={busy === s.id || !s.have_course} title={s.have_course ? "" : `Sync ${s.course} first`} onClick={() => importShare(s)}>
                  {busy === s.id ? "Adding…" : "Add to my notes"}
                </button>
              )}
            </div>
          ))}
          {data.inbox.length === 0 && (
            <p className="muted feed-empty">
              Nothing yet. When a friend shares notes with you, they appear here as soon as {data.folder.toLowerCase().includes("onedrive") ? "OneDrive" : "your drive"} has synced them.
            </p>
          )}
          {data.sent.length > 0 && (
            <>
              <h2 className="feed-head">
                <Send size={16} /> You shared
              </h2>
              {data.sent.map((s) => (
                <div key={s.id} className="feed-item sent">
                  <div className="feed-text">
                    <p>
                      <b>{s.notes.join(", ")}</b> with {s.to.join(", ")}
                    </p>
                    <span className="muted small">
                      {s.highlights} highlight{s.highlights === 1 ? "" : "s"} · {s.course} · {ago(s.created)}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      {sharing && (
        <ShareDialog
          course={course}
          onClose={() => setSharing(false)}
          onShared={(r) => {
            showToast?.(`Shared ${r.notes} note${r.notes === 1 ? "" : "s"} and ${r.highlights} highlight${r.highlights === 1 ? "" : "s"} from ${code}`);
            load();
          }}
        />
      )}
    </div>
  );
}
