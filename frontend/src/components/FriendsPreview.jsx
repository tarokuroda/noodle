import { Highlighter, NotebookPen, Share2, UserPlus, Users } from "lucide-react";

// Sample data for the preview: fictional classmates, no real accounts or sharing yet.
const FRIENDS = [
  { name: "Maya Chen", initials: "MC", color: "#4f5bd5", status: "Revising nozzles" },
  { name: "Leo Okafor", initials: "LO", color: "#2fa36b", status: "Worksheet 6" },
  { name: "Priya Shah", initials: "PS", color: "#d6336c", status: "Exergy notes" },
  { name: "Sam Rivera", initials: "SR", color: "#f08c00", status: "Offline" },
];

const FEED = [
  { who: 0, icon: NotebookPen, what: "shared her notes on", on: "Lecture 7: Exit flows", when: "12 min ago", detail: "14 highlights, 3 linked lectures" },
  { who: 1, icon: Highlighter, what: "highlighted 9 passages in", on: "Worksheet 6 Solutions", when: "1 h ago", detail: "Dissociation and pollutant emissions" },
  { who: 2, icon: Share2, what: "shared a topic map of", on: "Exergy", when: "yesterday", detail: "6 files, 2 notes" },
  { who: 0, icon: NotebookPen, what: "added you to the note", on: "Shock relations cheat sheet", when: "2 days ago", detail: "Normal and oblique shocks on one page" },
];

export default function FriendsPreview({ course }) {
  const code = course?.shortname.split("_")[0] || "your course";
  return (
    <div className="preview-page">
      <div className="bar">
        <div className="title">
          <h1>
            Friends <span className="badge">Preview</span>
          </h1>
          <p>Share notes and highlights with classmates. Files stay on each laptop; only your notes travel.</p>
        </div>
        <button className="btn" disabled title="Coming soon">
          <UserPlus size={15} /> Invite a friend
        </button>
      </div>
      <div className="preview-body friends">
        <aside className="friend-list">
          <h2>
            <Users size={17} /> {code} study group
          </h2>
          {FRIENDS.map((f) => (
            <div key={f.name} className="friend">
              <span className="avatar" style={{ background: f.color }}>{f.initials}</span>
              <div>
                <b>{f.name}</b>
                <span className="muted small">{f.status}</span>
              </div>
            </div>
          ))}
        </aside>
        <div className="feed">
          {FEED.map((e, i) => {
            const f = FRIENDS[e.who];
            const Icon = e.icon;
            return (
              <div key={i} className="feed-item">
                <span className="avatar" style={{ background: f.color }}>{f.initials}</span>
                <div className="feed-text">
                  <p>
                    <b>{f.name.split(" ")[0]}</b> {e.what} <b>{e.on}</b>
                  </p>
                  <div className="feed-card">
                    <Icon size={16} /> {e.detail}
                  </div>
                  <span className="muted small">{e.when}</span>
                </div>
                <button className="btn" disabled title="Coming soon">Open</button>
              </div>
            );
          })}
          <p className="muted small sample-note">Sample activity: sharing isn't switched on in this build.</p>
        </div>
      </div>
    </div>
  );
}
