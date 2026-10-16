import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import { LibraryView } from "./components/Library.jsx";
import Ask from "./components/Ask.jsx";
import Graph from "./components/Graph.jsx";
import { api } from "./api.js";

export default function App() {
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

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  const loadCourses = useCallback(
    () =>
      api("/courses").then((cs) => {
        setCourses(cs);
        setCourseId((id) => id ?? cs[0]?.id ?? null);
      }),
    []
  );

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    if (courseId) api(`/files?course=${courseId}`).then(setFiles);
  }, [courseId]);

  useEffect(() => {
    if (courseId) api(`/notes?course=${courseId}`).then(setNotes);
  }, [courseId, notesVersion]);

  const notesChanged = useCallback(() => setNotesVersion((v) => v + 1), []);

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
      if (f.kind === "pdf" || f.kind === "page") {
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

  return (
    <div className="app">
      <Sidebar
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
      />
      <main className="main">
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
          />
        )}
        {view === "ask" && <Ask course={course} files={files} thread={thread} setThread={setThread} />}
        {view === "graph" && <Graph course={course} files={files} onOpenFile={openFile} notesVersion={notesVersion} />}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
