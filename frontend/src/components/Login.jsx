import { useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { api } from "../api.js";
import Logo from "./Logo.jsx";

export default function Login({ initialSite, onLoggedIn, onBack }) {
  const [site, setSite] = useState(initialSite || "https://moodle.ucl.ac.uk");
  const [link, setLink] = useState("");
  const [started, setStarted] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const openLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api("/auth/start", { method: "POST", body: { site } });
      setSite(res.site);
      window.open(res.launch_url, "_blank", "noreferrer");
      setStarted(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onLoggedIn(await api("/auth/paste", { method: "POST", body: { link } }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        {onBack && (
          <button className="icon-btn login-back" onClick={onBack} aria-label="Back">
            <ArrowLeft size={18} />
          </button>
        )}
        <Logo size={64} />
        <h1>Log in to your Moodle</h1>
        <p className="muted">Noodle works with any Moodle site. You log in on Moodle's own page, so Noodle never sees your password.</p>

        <label className="field">
          <span>Your Moodle site</span>
          <input value={site} onChange={(e) => setSite(e.target.value)} />
        </label>

        <ol className="steps">
          <li className={started ? "done" : ""}>
            <div>
              <b>Open the Moodle login</b> and sign in as usual.
              <button className="btn primary" onClick={openLogin} disabled={busy || !site.trim()}>
                <ExternalLink size={15} /> Open Moodle login
              </button>
            </div>
          </li>
          <li>
            <div>
              <b>Copy the app link.</b> On the page that says <i>“Click here to launch the app”</i>, right-click that link and choose <i>Copy link address</i>.
            </div>
          </li>
          <li>
            <form onSubmit={submit}>
              <b>Paste it here.</b>
              <div className="paste">
                <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="moodlemobile://token=…" aria-label="Moodle app link" />
                <button className="btn yellow" disabled={busy || !link.trim()}>Log in</button>
              </div>
            </form>
          </li>
        </ol>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
