"use client";

import {
  AvatarQuality,
  StreamingEvents,
  VoiceChatTransport,
  VoiceEmotion,
  StartAvatarRequest,
  STTProvider,
  ElevenLabsModel,
} from "@heygen/streaming-avatar";
import { useEffect, useRef, useState } from "react";
import { useMemoizedFn, useUnmount } from "ahooks";

import { Button } from "./Button";
import { AvatarConfig } from "./AvatarConfig";
import { AvatarVideo } from "./AvatarSession/AvatarVideo";
import { useStreamingAvatarSession } from "./logic/useStreamingAvatarSession";
// import { AvatarControls } from "./AvatarSession/AvatarControls"; // não vamos expor controlos do chat interno
import { StreamingAvatarProvider, StreamingAvatarSessionState } from "./logic";
import { LoadingIcon } from "./Icons";
import { AVATARS } from "@/app/lib/constants";

// ⚙️ Definição mínima para arrancar vídeo/voz da HeyGen (sem agente)
const DEFAULT_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Low,
  avatarName: AVATARS[0].avatar_id,
  knowledgeId: undefined, // nada de KB interna
  voice: {
    rate: 1.2,
    emotion: VoiceEmotion.EXCITED,
    model: ElevenLabsModel.eleven_flash_v2_5, // podes trocar por multilingual_v2 se for a tua preferência
  },
  language: "pt-PT", // evita a intro noutra língua
  voiceChatTransport: VoiceChatTransport.WEBSOCKET,
  sttSettings: {
    provider: STTProvider.DEEPGRAM,
  },
};

function InteractiveAvatar() {
  const { initAvatar, startAvatar, stopAvatar, sessionState, stream } =
    useStreamingAvatarSession();

  const [config, setConfig] = useState<StartAvatarRequest>(DEFAULT_CONFIG);
  const [userInput, setUserInput] = useState("");
  const [busy, setBusy] = useState(false);
  const mediaStream = useRef<HTMLVideoElement>(null);
  const avatarRef = useRef<any>(null);

  // Obtém token de acesso do teu backend
  async function fetchAccessToken() {
    const res = await fetch("/api/get-access-token", { method: "POST" });
    if (!res.ok) throw new Error(`Falha no token (${res.status})`);
    return res.text();
  }

  // Arranca sessão SEM voice chat (não queremos alimentar o LLM interno)
  const startSession = useMemoizedFn(async () => {
    try {
      const token = await fetchAccessToken();
      const avatar = initAvatar(token);
      avatarRef.current = avatar;

      // (logs úteis)
      avatar.on(StreamingEvents.STREAM_READY, (e) =>
        console.log("STREAM_READY", e.detail)
      );
      avatar.on(StreamingEvents.AVATAR_START_TALKING, () =>
        console.log("AVATAR_START_TALKING")
      );
      avatar.on(StreamingEvents.AVATAR_STOP_TALKING, () =>
        console.log("AVATAR_STOP_TALKING")
      );
      avatar.on(StreamingEvents.STREAM_DISCONNECTED, () =>
        console.log("STREAM_DISCONNECTED")
      );

      // MUITO IMPORTANTE: não chamar startVoiceChat()
      await startAvatar(config);
    } catch (err) {
      console.error("Erro a iniciar a sessão do avatar:", err);
      alert("Erro a iniciar o avatar. Vê os logs/quotas da HeyGen.");
    }
  });

  useUnmount(() => {
    stopAvatar();
  });

  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current!.play();
      };
    }
  }, [mediaStream, stream]);

  // Envia pergunta para a Alma (teu /api/alma) e fala a resposta com o avatar
  const askAlma = useMemoizedFn(async () => {
    const q = userInput.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      // 1) pergunta ao teu backend (que fala com o Grok4)
      const r = await fetch("/api/alma", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });

      if (!r.ok) {
        const txt = await r.text();
        console.warn("Falha /api/alma:", txt);
        const msg =
          (txt && txt.slice(0, 200)) ||
          `Erro no /api/alma (${r.status})`;
        await avatarRef.current?.speak({ text: msg });
        return;
      }

      const j = await r.json();
      const answer = j?.answer || "Sem resposta do modelo.";

      // 2) fala pelo avatar HeyGen
      await avatarRef.current?.speak({ text: answer });
    } catch (e: any) {
      console.error("Erro a contactar o Alma Server:", e);
      await avatarRef.current?.speak({
        text:
          "Erro ao contactar o cérebro Alma. Tenta novamente em instantes.",
      });
    } finally {
      setBusy(false);
      setUserInput("");
    }
  });

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex flex-col rounded-xl bg-zinc-900 overflow-hidden">
        <div className="relative w-full aspect-video overflow-hidden flex flex-col items-center justify-center">
          {sessionState !== StreamingAvatarSessionState.INACTIVE ? (
            <AvatarVideo ref={mediaStream} />
          ) : (
            <AvatarConfig config={config} onConfigChange={setConfig} />
          )}
        </div>

        <div className="flex flex-col gap-3 items-center justify-center p-4 border-t border-zinc-700 w-full">
          {sessionState === StreamingAvatarSessionState.CONNECTED ? (
            // Em vez de AvatarControls/MessageHistory (que usam o LLM deles),
            // mostramos um input simples que pergunta à Alma e faz speak().
            <div className="w-full max-w-3xl flex gap-2">
              <input
                className="flex-1 rounded-md bg-zinc-800 px-3 py-2 outline-none"
                placeholder="Pergunta à Alma…"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") askAlma();
                }}
                disabled={busy}
              />
              <Button onClick={askAlma} disabled={busy}>
                {busy ? "A pensar…" : "Enviar"}
              </Button>
            </div>
          ) : sessionState === StreamingAvatarSessionState.INACTIVE ? (
            <div className="flex flex-row gap-4">
              <Button onClick={startSession}>
                Iniciar (sem Voice Chat)
              </Button>
            </div>
          ) : (
            <LoadingIcon />
          )}
        </div>
      </div>
      {/* Não renderizamos MessageHistory para não alimentar o agente interno */}
    </div>
  );
}

// Provider a apontar para /api (rotas server do teu Railway)
export default function InteractiveAvatarWrapper() {
  return (
    <StreamingAvatarProvider basePath="/api">
      <InteractiveAvatar />
    </StreamingAvatarProvider>
  );
}
