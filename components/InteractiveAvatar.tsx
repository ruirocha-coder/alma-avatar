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
import { AvatarControls } from "./AvatarSession/AvatarControls";
import { useVoiceChat } from "./logic/useVoiceChat";
import { StreamingAvatarProvider, StreamingAvatarSessionState } from "./logic";
import { LoadingIcon } from "./Icons";
import { MessageHistory } from "./AvatarSession/MessageHistory";

import { AVATARS } from "@/app/lib/constants";

// ⚠️ Deixa knowledgeId = undefined (sem agent/knowledge) para impedir LLM interno
const DEFAULT_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Low,
  avatarName: AVATARS[0].avatar_id,
  knowledgeId: undefined,
  voice: {
    rate: 1.5,
    emotion: VoiceEmotion.EXCITED,
    model: ElevenLabsModel.eleven_flash_v2_5,
  },
  language: "en", // não mexemos para evitar side-effects no STT; o texto do Grok sai em PT
  voiceChatTransport: VoiceChatTransport.WEBSOCKET,
  sttSettings: {
    provider: STTProvider.DEEPGRAM,
  },
};

function InteractiveAvatar() {
  const { initAvatar, startAvatar, stopAvatar, sessionState, stream } =
    useStreamingAvatarSession();
  const { startVoiceChat } = useVoiceChat();

  const [config, setConfig] = useState<StartAvatarRequest>(DEFAULT_CONFIG);

  const mediaStream = useRef<HTMLVideoElement>(null);
  const userBufferRef = useRef<string>(""); // onde acumulamos o que o utilizador disse

  async function fetchAccessToken() {
    const response = await fetch("/api/get-access-token", { method: "POST" });
    if (!response.ok) throw new Error("Falha ao obter access token");
    const token = await response.text();
    return token;
  }

  // chama o teu Alma Server (Next route em /api/alma)
  async function askAlma(question: string): Promise<string> {
    try {
      const r = await fetch("/api/alma", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!r.ok) {
        const txt = await r.text();
        console.error("Erro /api/alma:", txt);
        return "Não consegui obter resposta do Alma Server.";
      }
      const j = await r.json();
      return j.answer || "Sem resposta do Alma.";
    } catch (e: any) {
      console.error("Exceção /api/alma:", e?.message || e);
      return "Erro a contactar o Alma Server.";
    }
  }

  const startSessionV2 = useMemoizedFn(async (isVoiceChat: boolean) => {
    try {
      const token = await fetchAccessToken();
      const avatar = initAvatar(token);

      // —— EVENTOS: só ouvimos o UTILIZADOR e respondemos com o Grok ——
      // (1) Quando o stream ficar pronto, tentamos interromper qualquer greeting interno
      avatar.on(StreamingEvents.STREAM_READY, async () => {
        try {
          if ((avatar as any)?.interrupt) {
            await (avatar as any).interrupt();
          }
        } catch {}
      });

      // (2) Mensagens parciais do utilizador enquanto fala → acumulamos
      avatar.on(StreamingEvents.USER_TALKING_MESSAGE, (event: any) => {
        const partial =
          event?.detail?.text ??
          event?.detail?.message ??
          event?.text ??
          "";
        if (partial) userBufferRef.current = partial;
      });

      // (3) Utilizador terminou a fala → perguntamos ao Alma e o avatar fala a resposta
      avatar.on(StreamingEvents.USER_END_MESSAGE, async (event: any) => {
        // tenta usar texto final do evento; se não houver, usa o buffer
        const finalText =
          event?.detail?.text ??
          event?.detail?.message ??
          event?.text ??
          userBufferRef.current ??
          "";

        userBufferRef.current = "";

        const question = (finalText || "").trim();
        if (!question) return;

        const answer = await askAlma(question);

        try {
          // interrompe qualquer áudio pendente
          if ((avatar as any)?.interrupt) {
            await (avatar as any).interrupt();
          }
          // fala APENAS o texto do Grok (Alma Server)
          await (avatar as any).speak({ text: answer });
        } catch (e) {
          console.error("Falha no speak()", e);
        }
      });

      // —— IMPORTANTE: não registamos AVATAR_* handlers nem triggers que façam o LLM interno falar ——

      await startAvatar({
        ...config,
        // reforço para evitar agente interno por engano:
        knowledgeId: undefined,
      });

      if (isVoiceChat) {
        await startVoiceChat();
      }
    } catch (error) {
      console.error("Error starting avatar session:", error);
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
            <AvatarControls />
          ) : sessionState === StreamingAvatarSessionState.INACTIVE ? (
            <div className="flex flex-row gap-4">
              <Button onClick={() => startSessionV2(true)}>Start Voice Chat</Button>
              <Button onClick={() => startSessionV2(false)}>Start Text Chat</Button>
            </div>
          ) : (
            <LoadingIcon />
          )}
        </div>
      </div>
      {sessionState === StreamingAvatarSessionState.CONNECTED && <MessageHistory />}
    </div>
  );
}

export default function InteractiveAvatarWrapper() {
  return (
    <StreamingAvatarProvider basePath={process.env.NEXT_PUBLIC_BASE_API_URL}>
      <InteractiveAvatar />
    </StreamingAvatarProvider>
  );
}
