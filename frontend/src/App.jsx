import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "lucide-react";
import Sidebar, { NAV } from "./components/Sidebar.jsx";
import Logo from "./components/Logo.jsx";
import { LibraryView } from "./components/Library.jsx";
import Ask from "./components/Ask.jsx";
import Graph from "./components/Graph.jsx";
import Login from "./components/Login.jsx";
import Courses from "./components/Courses.jsx";
import Timeline from "./components/Timeline.jsx";
import Friends from "./components/Friends.jsx";
import FriendsPreview from "./components/FriendsPreview.jsx";
import { api, REAL_FRIENDS } from "./api.js";

export default function App() {
  const [auth, setAuth] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [filesVersion, setFilesVersion] = useState(0);
  const [courses, setCourses] = useState(null);
  const [courseId, setCourseId] = useState(null);
  const [files, setFiles] = useState([]);
  const [view, setView] = useState("library");
  const [open, setOpen] = useState(null); // { id, page, nonce }
  const [toast, setToast] = useState(null);
  const [thread, setThread] = useState([]);
  const [notes, setNotes] = useState([]);
  const [notesVersion, setNotesVersion] = useState(0);
  const [sideNote, setSideNote] = useState(null);
  const [mainNote, setMainNote] = useState(null);
  const [navOpen, setNavOpen] = useState(false); // the sidebar as a drawer on narrow screens
  // a dragged sidebar width, remembered between visits; null = the stylesheet's default
  const [sidebarW, setSidebarW] = useState(() => {
    try {
      return +localStorage.getItem("noodle:sidebar-w") || null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      sidebarW ? localStorage.setItem("noodle:sidebar-w", sidebarW) : localStorage.removeItem("noodle:sidebar-w");
    } catch {}
  }, [sidebarW]);

  const toastTimer = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // the drawer closes once you've picked something from it
  useEffect(() => setNavOpen(false), [view, open?.id, sideNote, mainNote, courseId]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e) => e.key === "Escape" && setNavOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const loadCourses = useCallback(
    () =>
      api("/courses").then((cs) => {
        setCourses(cs);
        setCourseId((id) => id ?? cs[0]?.id ?? null);
      }),
    []
  );

  useEffect(() => {
    loadCourses().then(() => {});
    api("/auth/status").then(setAuth).catch(() => setAuth({ logged_in: true, offline: true }));
  }, [loadCourses]);

  useEffect(() => {
    if (courses && courses.length === 0) setView("courses");
  }, [courses]);

  useEffect(() => {
    if (courseId) api(`/files?course=${courseId}`).then(setFiles);
  }, [courseId, filesVersion]);

  useEffect(() => {
    if (courseId) api(`/notes?course=${courseId}`).then(setNotes);
  }, [courseId, notesVersion]);

  const notesChanged = useCallback(() => setNotesVersion((v) => v + 1), []);

  // remember the open file and view between launches (best effort: storage can be unavailable)
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !files.length) return;
    restored.current = true;
    try {
      const last = JSON.parse(localStorage.getItem("noodle:last") || "null");
      if (last?.course === courseId && files.some((f) => f.id === last.file)) setOpen({ id: last.file, page: last.page || 1, nonce: 1 });
    } catch {
      /* ignore */
    }
  }, [files, courseId]);
  useEffect(() => {
    if (!open || !restored.current) return;
    try {
      localStorage.setItem("noodle:last", JSON.stringify({ course: courseId, file: open.id, page: open.page }));
    } catch {
      /* ignore */
    }
  }, [open, courseId]);

  const course = useMemo(() => courses?.find((c) => c.id === courseId), [courses, courseId]);
  const byId = useMemo(() => Object.fromEntries(files.map((f) => [f.id, f])), [files]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  const openFile = useCallback(
    (f, page) => {
      if (typeof f === "number") f = byIdRef.current[f];
      if (!f) return;
      if (f.status !== "ok") {
        window.open(f.moodle_url, "_blank", "noreferrer");
        return;
      }
      if (f.viewer === "pdf" || f.viewer === "page") {
        setOpen({ id: f.id, page: page || 1, nonce: Date.now() });
        setMainNote((m) => {
          if (m) setSideNote(m); // a note opened on its own stays beside the file it links to
          return null;
        });
        setView("library");
      } else {
        api(`/files/${f.id}/open`, { method: "POST" })
          .then(() => showToast(`Opening ${f.name} in its Windows app`))
          .catch((e) => showToast(e.message));
      }
    },
    [showToast]
  );

  const openFile_ = byId[open?.id];

  const openNote = useCallback(
    (path) => {
      setView("library");
      if (openFile_) setSideNote(path);
      else setMainNote(path);
    },
    [openFile_]
  );

  const newNote = useCallback(
    async (title) => {
      const n = await api("/notes", { method: "POST", body: { course: courseId, title } });
      notesChanged();
      openNote(n.path);
    },
    [courseId, notesChanged, openNote]
  );

  const synced = useCallback(() => {
    loadCourses();
    setFilesVersion((v) => v + 1);
    setNotesVersion((v) => v + 1);
  }, [loadCourses]);

  if (auth && (!auth.logged_in || showLogin)) {
    return (
      <Login
        initialSite={auth.site}
        onBack={auth.logged_in ? () => setShowLogin(false) : null}
        onLoggedIn={(st) => {
          setAuth(st);
          setShowLogin(false);
          setView("courses");
        }}
      />
    );
  }

  return (
    <div className={`app ${navOpen ? "nav-open" : ""}`} style={sidebarW ? { "--sidebar-w": `${sidebarW}px` } : undefined}>
      <Sidebar
        width={sidebarW}
        onResize={setSidebarW}
        view={view}
        setView={setView}
        course={course}
        files={files}
        notes={notes}
        openId={open?.id}
        openNote={sideNote || mainNote}
        onOpen={openFile}
        onOpenNote={openNote}
        onNewNote={newNote}
        courses={courses || []}
        setCourseId={setCourseId}
        onSync={() => setView("courses")}
        profile={auth?.profile}
      />
      <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />
      <main className="main">
        <div className="mobile-bar">
          <button className="icon-btn" onClick={() => setNavOpen(true)} aria-label="Open the menu" aria-expanded={navOpen}>
            <Menu size={22} />
          </button>
          <Logo size={26} />
          <span className="brand-name">Noodle</span>
          <span className="mobile-where">{view === "courses" ? "Sync" : NAV.find((n) => n.id === view)?.label}</span>
        </div>
        {view === "library" && (
          <LibraryView
            course={course}
            file={openFile_}
            open={open}
            setOpen={setOpen}
            sideNote={sideNote}
            setSideNote={setSideNote}
            mainNote={mainNote}
            onOpenFile={openFile}
            onOpenNote={openNote}
            onNotesChanged={notesChanged}
            onNavigate={setView}
          />
        )}
        {view === "ask" && <Ask course={course} files={files} thread={thread} setThread={setThread} />}
        {view === "timeline" && <Timeline onOpenFile={openFile} />}
        {view === "friends" &&
          (REAL_FRIENDS ? (
            <Friends course={course} onOpenNote={openNote} onNotesChanged={notesChanged} showToast={showToast} />
          ) : (
            <FriendsPreview course={course} />
          ))}
        {view === "courses" && (
          <Courses auth={auth} onSynced={synced} onRelogin={() => setShowLogin(true)} onOpenLibrary={() => setView("library")} />
        )}
        {view === "graph" && <Graph course={course} files={files} onOpenFile={openFile} notesVersion={notesVersion} />}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
