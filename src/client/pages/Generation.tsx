import { useState } from "react";
import { api, errorMessage } from "../api.js";
import { useSession } from "../session.js";
import { Badge, Button, Notice, Panel, PanelHeader, TextArea } from "../components/ui.js";

interface ImageResult {
  mimeType: string;
  base64: string;
  model: string;
  prompt: string;
}

export function VideoPage() {
  const { entitlement } = useSession();
  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">Render</span>
          <h1>Video Generation</h1>
          <p>Storyboard clips here, then render when a video model is connected to this server.</p>
        </div>
        <div className="page-head-action">
          <Badge tone="warning">Not configured</Badge>
        </div>
      </header>

      <Notice tone="warning" title="No video model is connected">
        NOVA does not fake renders. The Video module, storyboard storage and pipeline are in place, but this
        server has no video generation provider configured, so every render request returns an explicit
        "not configured" response instead of a placeholder video.
      </Notice>

      <Panel>
        <PanelHeader title="Storyboard" subtitle="Plan the shots you will render later" />
        <div className="video-board">
          {["Opening title", "Product reveal", "Feature montage", "Closing card"].map((shot, index) => (
            <div key={shot} className="shot">
              <span className="shot-index">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{shot}</strong>
                <p>Draft slot · awaiting a configured video model</p>
              </div>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          disabled
          title="Video generation requires a configured provider"
        >
          Render storyboard
        </Button>
        <p className="muted small">
          Plan status: {entitlement?.planName ?? "—"} · {entitlement?.status ?? "—"}
        </p>
      </Panel>
    </div>
  );
}

export function ImagePage() {
  const { entitlement } = useSession();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<ImageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await api<{ image: { mimeType: string; base64: string }; prompt: string; model: string }>(
        "/api/generate/image",
        { method: "POST", body: JSON.stringify({ prompt: prompt.trim() }) },
      );
      setResult({ ...payload.image, prompt: payload.prompt, model: payload.model });
    } catch (cause) {
      setResult(null);
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">Generate</span>
          <h1>Image Generation</h1>
          <p>
            Requests go to the NOVA server, which calls Gemini with a server-side key. Nothing is generated
            locally and no key is ever sent to the browser.
          </p>
        </div>
      </header>

      {!entitlement?.aiAllowed ? (
        <Notice tone="warning" title="Generation is locked">
          {entitlement?.reason ?? "Your plan does not include AI generation yet."}
        </Notice>
      ) : null}

      <Panel>
        <PanelHeader title="Prompt" subtitle="Describe the image you want" />
        <form className="stack-tight" onSubmit={generate}>
          <TextArea
            rows={3}
            value={prompt}
            placeholder="A violet holographic interface floating above a black desk, cinematic lighting…"
            onChange={(event) => setPrompt(event.target.value)}
          />
          <Button type="submit" icon="images" loading={loading} disabled={!prompt.trim() || !entitlement?.aiAllowed}>
            Generate image
          </Button>
        </form>
        {error ? (
          <Notice tone="danger" title="Generation unavailable">
            {error}
          </Notice>
        ) : null}
      </Panel>

      {result ? (
        <Panel>
          <PanelHeader title="Result" subtitle={`${result.model} · ${result.prompt}`} />
          <img
            className="generated-image"
            alt={result.prompt}
            src={`data:${result.mimeType};base64,${result.base64}`}
          />
        </Panel>
      ) : null}
    </div>
  );
}
